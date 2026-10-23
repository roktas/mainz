// Checks service-worker installation concurrency and complete rollback at the browser boundaries.

import assert from "node:assert/strict"
import { createHash, webcrypto } from "node:crypto"
import { readFileSync } from "node:fs"
import test from "node:test"
import { runInNewContext } from "node:vm"
import { transformWithOxc } from "vite"

const { code: source } = await transformWithOxc(
  readFileSync(new URL("../src/offline.worker.ts", import.meta.url), "utf8"),
  "src/offline.worker.ts",
)
const ASSETS = Array.from({ length: 12 }, (_, index) => ({
  path: `asset-${index}`,
  sha256: createHash("sha256").update(`asset-${index}`).digest("hex"),
}))

function installation({
  corrupt = false,
  responses = [],
}: { corrupt?: boolean; responses?: (number | Error | Response)[] } = {}) {
  type Install = { waitUntil: (promise: Promise<void>) => void }
  const listeners = new Map<string, (event: Install) => void>()
  const entries = new Set()
  let release: () => void
  let hashed: () => void
  const gate = new Promise<void>((resolve) => (release = resolve))
  const digest = new Promise<void>((resolve) => (hashed = resolve))
  let active = 0,
    peak = 0,
    requested = 0,
    deleted = 0
  runInNewContext(source, {
    VERSION: "test",
    ASSETS,
    URL,
    Request,
    Uint8Array,
    setTimeout: (callback: () => void) => setImmediate(callback),
    crypto: {
      subtle: {
        digest: async (...args: Parameters<typeof webcrypto.subtle.digest>) => {
          const result = await webcrypto.subtle.digest(...args)
          hashed!()
          return result
        },
      },
    },
    self: {
      registration: { scope: "https://example.test/composer/" },
      addEventListener: (event: string, listener: (event: Install) => void) => listeners.set(event, listener),
    },
    caches: {
      open: async () => ({ put: async (url: string) => entries.add(url) }),
      delete: async () => {
        deleted++
        entries.clear()
      },
    },
    fetch: async (request: Request) => {
      requested++
      peak = Math.max(peak, ++active)
      const name = new URL(request.url).pathname.split("/").at(-1)
      try {
        if (name === "asset-0") {
          const response = responses.shift()
          if (response instanceof Error) throw response
          if (response instanceof Response) return response
          if (response) return new Response("Unavailable", { status: response })
          if (corrupt) return new Response("wrong digest")
        }
        await gate
        return new Response(name)
      } finally {
        active--
      }
    },
  })
  let completed: Promise<void>
  listeners.get("install")!({ waitUntil: (promise) => (completed = promise) })
  return {
    completed: completed!,
    digest,
    release: () => release!(),
    state: () => ({ active, peak, requested, deleted, entries: entries.size }),
  }
}

test("Offline installation overlaps a bounded number of verified asset requests", async () => {
  const run = installation()
  try {
    await new Promise(setImmediate)
    assert.ok(run.state().requested > 1, "Small assets do not wait for every preceding network round trip")
    assert.ok(run.state().peak <= 4, "Installation retains at most four response bodies at once")
    run.release()
    await run.completed
    assert.equal(run.state().entries, 12)
    assert.equal(run.state().deleted, 0)
  } finally {
    run.release()
    await run.completed.catch(() => {})
  }
})

test("A failed digest waits for in-flight writes before deleting the partial offline cache", async () => {
  const run = installation({ corrupt: true })
  let failed = false
  const completion = run.completed.catch((error) => {
    failed = true
    return error
  })
  try {
    await run.digest
    await new Promise(setImmediate)
    assert.equal(failed, false, "Other asset writes must finish before rollback")
    run.release()
    assert.match((await completion).message, /Incompatible application asset/)
    assert.equal(run.state().active, 0)
    assert.equal(run.state().entries, 0)
    assert.equal(run.state().deleted, 1)
    assert.equal(run.state().requested, 4, "Incompatible bytes are not retried")
  } finally {
    run.release()
    await completion
  }
})

test("Offline installation retries transient downloads and stops on permanent failures", async (t) => {
  for (const [name, responses, requested, succeeds] of [
    ["network and server recovery", [new TypeError("Network failed"), 503], 14, true],
    [
      "interrupted response body",
      [
        new Response(
          new ReadableStream({
            start(controller) {
              controller.error(new TypeError("Download interrupted"))
            },
          }),
        ),
      ],
      13,
      true,
    ],
    ["rate limiting", [429], 13, true],
    ["server failure after three attempts", [503, 503, 503, 200], 6, false],
    ["missing asset", [404, 200], 4, false],
  ] as const) {
    await t.test(name, async () => {
      const run = installation({ responses: [...responses] })
      run.release()
      if (succeeds) {
        await run.completed
        assert.equal(run.state().entries, 12)
        assert.equal(run.state().deleted, 0)
      } else {
        await assert.rejects(run.completed, /Missing application asset/)
        assert.equal(run.state().entries, 0)
        assert.equal(run.state().deleted, 1)
      }
      assert.equal(run.state().requested, requested)
      assert.ok(run.state().peak <= 4)
    })
  }
})
