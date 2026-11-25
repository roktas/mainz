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
    EXAMPLES: [],
    URL,
    Request,
    Response,
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

test("Offline worker isolates demo cache, rejects tampered payloads, handles fragments, and prunes retired entries", async () => {
  const scope = "https://example.test/composer/"
  const demoBytes = new TextEncoder().encode("%PDF-1.7 demo")
  const demoUrl = `${scope}dolor.pdf`
  const demoHash = createHash("sha256").update(demoBytes).digest("hex")
  const stores = new Map<string, Map<string, Response>>()
  const openStore = (name: string) => {
    let store = stores.get(name)
    if (!store) stores.set(name, (store = new Map()))
    return store
  }
  let fetchBody: Uint8Array<ArrayBuffer> = demoBytes
  let storageAvailable = true
  const seenRequests: Request[] = []
  const listeners = new Map<string, (event: unknown) => void>()
  runInNewContext(source, {
    VERSION: "v2",
    ASSETS: [],
    EXAMPLES: [{ path: "dolor.pdf", sha256: demoHash, bytes: demoBytes.byteLength }],
    URL,
    Request,
    Response,
    ArrayBuffer,
    Uint8Array,
    crypto: {
      subtle: { digest: (...args: Parameters<typeof webcrypto.subtle.digest>) => webcrypto.subtle.digest(...args) },
    },
    self: {
      location: { origin: "https://example.test" },
      registration: { scope },
      clients: { claim: async () => {}, matchAll: async () => [] },
      skipWaiting: async () => {},
      addEventListener: (event: string, listener: (event: unknown) => void) => listeners.set(event, listener),
    },
    caches: {
      keys: async () => [...stores.keys()],
      open: async (name: string) => {
        if (!storageAvailable) throw new Error("Storage unavailable")
        const store = openStore(name)
        return {
          put: async (url: string, response: Response) => {
            store.set(url, response)
          },
          keys: async () => [...store.keys()].map((url) => ({ url })),
          delete: async (request: { url: string } | string) =>
            store.delete(typeof request === "string" ? request : request.url),
        }
      },
      match: async (url: string, options?: { cacheName?: string }) => {
        if (!storageAvailable) throw new Error("Storage unavailable")
        return options?.cacheName ? stores.get(options.cacheName)?.get(url) : undefined
      },
      delete: async (name: string) => stores.delete(name),
    },
    fetch: async (request: Request) => {
      seenRequests.push(request)
      return new Response(fetchBody)
    },
  })

  const exampleStore = openStore(`mainz:${scope}:examples`)
  // Non-catalog URL (such as a user PDF) and tampered payload are rejected by remember-example.
  const waits: Promise<void>[] = []
  listeners.get("message")!({
    data: { type: "remember-example", url: `${scope}user.pdf`, bytes: demoBytes.buffer.slice(0) },
    waitUntil: (promise: Promise<void>) => waits.push(promise),
  })
  const tampered = new TextEncoder().encode("%PDF-1.7 evil")
  listeners.get("message")!({
    data: { type: "remember-example", url: demoUrl, bytes: tampered.buffer.slice(0) },
    waitUntil: (promise: Promise<void>) => waits.push(promise),
  })
  await Promise.all(waits)
  assert.equal(exampleStore.size, 0)

  function requestDemo(request: Request) {
    let reply: Promise<Response> | undefined
    listeners.get("fetch")!({ request, respondWith: (response: Promise<Response>) => (reply = response) })
    assert.ok(reply)
    return reply
  }

  const pageTwo = new Request(`${demoUrl}#page=2`)
  fetchBody = tampered
  assert.equal((await requestDemo(pageTwo)).status, 503)
  assert.equal(exampleStore.size, 0)

  // Valid demo response with URL fragment succeeds and caches under normalized URL + hash.
  fetchBody = demoBytes
  assert.equal((await requestDemo(pageTwo)).status, 200)
  assert.equal(exampleStore.has(`${demoUrl}?sha256=${demoHash}`), true)

  // Demo requests strip caller Range headers so network fallback fetches the complete verified asset.
  exampleStore.clear()
  seenRequests.length = 0
  const ranged = await requestDemo(new Request(demoUrl, { headers: { Range: "bytes=0-3" } }))
  assert.equal(ranged.status, 200)
  assert.equal(seenRequests.length, 1)
  assert.equal(seenRequests[0].headers.get("range"), null)
  assert.equal(exampleStore.has(`${demoUrl}?sha256=${demoHash}`), true)

  // Activation prunes retired caches and stale demo revisions while keeping current verified demo.
  openStore(`mainz:${scope}:v1`)
  exampleStore.set(`${demoUrl}?sha256=stale`, new Response("old"))
  let activated: Promise<void> | undefined
  listeners.get("activate")!({ waitUntil: (promise: Promise<void>) => (activated = promise) })
  await activated
  assert.equal(stores.has(`mainz:${scope}:v1`), false)
  assert.equal(exampleStore.has(`${demoUrl}?sha256=stale`), false)
  assert.equal(exampleStore.has(`${demoUrl}?sha256=${demoHash}`), true)

  storageAvailable = false
  const online = await requestDemo(pageTwo)
  assert.equal(online.status, 200)
  assert.equal(await online.text(), "%PDF-1.7 demo")
  fetchBody = tampered
  assert.equal((await requestDemo(pageTwo)).status, 503)
})
