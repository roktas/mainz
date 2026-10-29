// Checks worker ownership, failure recovery, and immutable page and style reuse.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium, webkit } from "playwright"
import { createServer } from "vite"
import { serve } from "./server.ts"
import { fixture, trackWorkers } from "./browser.js"

test("Processor failures remain recoverable in Chromium and WebKit", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL : undefined })
    try {
      const page = await browser.newPage()
      await page.goto(server.resolvedUrls.local[0])
      const result = await page.evaluate(
        async (buffer) => {
          const { Processor } = await import("/src/processor.ts")
          const processor = new Processor()
          const bytes = Uint8Array.from(buffer)
          try {
            const failures = []
            for (const [input, changes] of [
              [bytes.with(0, 0), undefined],
              [bytes, { apply: { "guides-stroke-opacity": 2 }, reset: [] }],
            ]) {
              try {
                await processor.run(input, failures.length, changes)
              } catch (error) {
                failures.push(error.failure)
              }
            }
            const edited = await processor.run(bytes, 3, { apply: { "guides-stroke-opacity": 0.65 }, reset: [] })
            return {
              failures: failures.map((failure) => [failure.kind, failure.record?.code ?? failure.message]),
              pages: edited.description.pageCount,
              opacity: edited.description.parameters["guides-stroke-opacity"].parameter.value,
            }
          } finally {
            processor.dispose()
          }
        },
        [...fixture({ count: 3 })],
      )
      assert.deepEqual(
        result,
        {
          failures: [
            ["processor", "pdf-syntax"],
            ["processor", "invalid-request"],
          ],
          pages: 3,
          opacity: 0.65,
        },
        engine.name(),
      )
    } finally {
      await browser.close()
    }
  }
})

function wasm(instance) {
  const heap = new Uint8Array(1024)
  let size = 0,
    status = 0,
    opened = false,
    failOperation = false
  const record = (value, code = 0) => {
    const bytes = new TextEncoder().encode(JSON.stringify(value))
    heap.set(bytes)
    size = bytes.length
    status = code
  }
  return {
    HEAPU8: heap,
    _malloc: () => 256,
    _free() {},
    _mainz_result: () => 0,
    _mainz_size: () => size,
    _mainz_status: () => status,
    _mainz_read(pointer) {
      if (opened) {
        record({ hostError: "Document remains open." }, 2)
        return 0
      }
      opened = true
      failOperation = heap[pointer] === 1
      record({})
      return 1
    },
    _mainz_describe() {
      if (failOperation) record({ code: "pdf-syntax", message: "Processing failed." }, 1)
      else record({ version: 1, pageCount: 1, pages: {}, parameters: {} })
    },
    _mainz_close() {
      if (instance === 1) record({ hostError: "Close failed." }, 2)
      else {
        opened = false
        record({})
      }
    },
  }
}

test("Processor workers pin their module and recover from failed document cleanup", { timeout: 30000 }, async () => {
  let unexpected = false
  const server = await createServer({
    server: { port: 0, host: "127.0.0.1" },
    plugins: [
      {
        name: "processor-failures",
        configureServer(value) {
          value.middlewares.use((request, response, next) => {
            if (!["/processor.mjs", "/unexpected.mjs"].includes(request.url)) return next()
            response.setHeader("Content-Type", "text/javascript")
            if (request.url === "/unexpected.mjs") {
              unexpected = true
              response.end('throw new Error("Unexpected processor module.")')
            } else response.end(`let instances = 0; export default () => (${wasm.toString()})(++instances);`)
          })
        },
      },
    ],
  })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.addInitScript(() => {
      const Original = Worker
      window.Worker = class extends Original {
        postMessage(message, options) {
          super.postMessage({ ...message, moduleUrl: window.workerModuleUrl }, options)
        }
      }
    })
    await page.goto(server.resolvedUrls.local[0])
    const results = await page.evaluate(async () => {
      const { Processor } = await import("/src/processor.ts")
      const replies = []
      for (const [flag, path] of [
        [0, "processor.mjs"],
        [1, "processor.mjs"],
        [0, "unexpected.mjs"],
      ]) {
        window.workerModuleUrl = new URL(path, location.href).href
        const processor = new Processor()
        const run = async (value, revision) => {
          try {
            const result = await processor.run(Uint8Array.of(value), revision)
            return { bytes: [...new Uint8Array(result.bytes)], description: result.description }
          } catch (error) {
            return { failure: error.failure ?? { message: error.message } }
          }
        }
        try {
          replies.push({ flag, first: await run(flag, 1), retry: await run(0, 2) })
        } finally {
          processor.dispose()
        }
      }
      return replies
    })
    assert.equal(unexpected, false, "Request data cannot select the processor module")
    for (const { flag, first, retry } of results) {
      assert.deepEqual(first, {
        failure: flag
          ? { kind: "processor", record: { code: "pdf-syntax", message: "Processing failed." } }
          : { kind: "host", message: "Close failed." },
      })
      assert.deepEqual(retry, {
        bytes: [0],
        description: { version: 1, pageCount: 1, pages: {}, parameters: {} },
      })
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Processors bound idle runtimes and reuse immutable page buffers across retries", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.addInitScript(trackWorkers)
    await page.addInitScript(() => {
      window.transferred = []
      const post = Worker.prototype.postMessage
      Worker.prototype.postMessage = function (message, transfers) {
        if ("bytes" in message) window.transferred.push(message.bytes.byteLength)
        return post.call(this, message, transfers)
      }
    })
    await page.route("**/sample.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 40 }) }),
    )
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { Processor } = await import("/src/processor.ts")
      const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())
      const original = bytes.slice()
      const processors = Array.from({ length: 8 }, () => new Processor())
      const alive = () => window.workers.filter((w) => w.url.includes("processor.worker") && !w.terminated).length
      const counts = []
      const equal = (a, b) => a.length === b.length && a.every((value, index) => value === b[index])
      try {
        for (const processor of processors) {
          await processor.run(bytes, 1)
          counts.push(alive())
        }
        const pair = await Promise.all(processors.slice(0, 2).map((processor) => processor.run(bytes, 2)))
        const concurrent = pair.every((reply) => reply.description.pageCount === 40)
        const processor = processors[0]
        const changes = { apply: {}, reset: [], buffer: { input: "sample", pages: [0, 2] } }
        const first = await processor.run(bytes, 3, changes)
        const cached = await processor.run(bytes, 4, changes)
        const transfers = window.transferred.slice(-2)
        let failed = false
        try {
          await processor.run(bytes, 5, { ...changes, buffer: { input: "sample", pages: [] } })
        } catch {
          failed = true
        }
        const retry = await processor.run(bytes, 6, changes)
        const retryTransfer = window.transferred.at(-1)
        const pending = processor.run(bytes, 7, changes).catch((error) => error.name)
        const other = processors[1].run(bytes, 8)
        processor.cancel()
        const cancelled = await pending
        const independent = (await other).description.pageCount
        const reopened = await processor.run(bytes, 9, changes)
        return {
          counts,
          concurrent,
          transfers,
          retryTransfer,
          size: bytes.length,
          failed,
          equal: [cached, retry, reopened].every((reply) =>
            equal(new Uint8Array(first.bytes), new Uint8Array(reply.bytes)),
          ),
          immutable: equal(bytes, original),
          cancelled,
          independent,
        }
      } finally {
        for (const processor of processors) processor.dispose()
      }
    })
    assert.deepEqual(result.counts, Array(8).fill(1))
    assert.equal(result.concurrent, true)
    assert.deepEqual(result.transfers, [result.size, 0])
    assert.equal(result.retryTransfer, result.size)
    assert.equal(result.failed, true)
    assert.equal(result.equal, true)
    assert.equal(result.immutable, true)
    assert.equal(result.cancelled, "AbortError")
    assert.equal(result.independent, 40)
    assert.equal(await page.evaluate(() => window.workers.every((w) => w.terminated)), true)
  } finally {
    await browser?.close()
  }
})

test("Style updates combine resets with overrides and preserve their immutable Input", { timeout: 30000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.route("**/sample.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 3 }) }),
    )
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { Processor } = await import("/src/processor.ts")
      const processor = new Processor()
      const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())
      try {
        const saved = await processor.run(bytes, 1, {
          apply: { "guides-stroke-color": "#123456", "guides-stroke-opacity": 0.7 },
          reset: [],
        })
        const input = new Uint8Array(saved.bytes)
        const original = input.slice()
        const changes = {
          apply: { "guides-stroke-color": "#ABCDEF", "guides-stroke-width": 0.4 },
          reset: ["guides-stroke-color", "guides-stroke-opacity"],
        }
        const changed = await processor.run(input, 2, changes)
        const repeated = await processor.run(input, 3, changes)
        new Uint8Array(repeated.bytes).fill(0)
        repeated.description.parameters["guides-stroke-color"].parameter.value = "#000000"
        const cached = await processor.run(input, 4, changes)
        const unchanged = await processor.run(new Uint8Array(changed.bytes), 5, {
          apply: { "guides-stroke-color": "#ABCDEF" },
          reset: ["guides-stroke-color"],
        })
        let failure
        try {
          await processor.run(input, 6, { ...changes, reset: ["unknown"] })
        } catch (error) {
          failure = error.failure
        }
        const retry = await processor.run(input, 7, changes)
        const subset = await processor.run(input, 8, {
          ...changes,
          buffer: { input: "styled", pages: [0, 2] },
        })
        const reusedSubset = await processor.run(input, 9, {
          ...changes,
          buffer: { input: "styled", pages: [0, 2] },
        })
        const full = await processor.run(input, 10, changes)
        const tampered = input.slice()
        tampered[0] = 0
        let rejected = false
        try {
          await processor.run(tampered, 11, changes)
        } catch (error) {
          rejected = error.failure?.record?.code === "pdf-syntax"
        }
        const target = new Uint8Array(changed.bytes)
        return {
          parameters: cached.description.parameters,
          immutable: input.every((value, index) => value === original[index]),
          identical: [cached, unchanged, retry].every((reply) => {
            const candidate = new Uint8Array(reply.bytes)
            return candidate.length === target.length && candidate.every((value, index) => value === target[index])
          }),
          failure,
          rejected,
          pageCounts: [subset, reusedSubset, full].map((reply) => reply.description.pageCount),
        }
      } finally {
        processor.dispose()
      }
    })
    assert.equal(result.parameters["guides-stroke-color"].parameter.value, "#ABCDEF")
    assert.equal(result.parameters["guides-stroke-width"].parameter.value, 0.4)
    assert.equal(Object.hasOwn(result.parameters["guides-stroke-opacity"].parameter, "value"), false)
    assert.equal(result.immutable, true)
    assert.equal(result.identical, true)
    assert.equal(result.failure.kind, "processor")
    assert.equal(result.failure.record.code, "invalid-request")
    assert.equal(result.rejected, true)
    assert.deepEqual(result.pageCounts, [2, 2, 3])
  } finally {
    await browser?.close()
  }
})

test("Composition reuse preserves bytes, reports, and exact Input bindings", { timeout: 30000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.route("**/sample.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 3 }) }),
    )
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { Processor } = await import("/src/processor.ts")
      const processor = new Processor()
      const bytes = new Uint8Array(await (await fetch("/sample.pdf")).arrayBuffer())
      const recipe = {
        version: 1,
        sources: { book: { input: "input", overrides: { "guides-stroke-width": 0.04 } } },
        parts: [
          {
            pages: [
              { source: "book", page: 0 },
              { source: "book", page: 2 },
            ],
            copies: 1,
            front: false,
          },
        ],
      }
      const run = (id, buffer, revision) => processor.compose(recipe, [{ id, bytes: buffer }], revision)
      try {
        await processor.run(bytes, 0)
        const first = await run("input", bytes, 1)
        const second = await run("input", bytes, 2)
        new Uint8Array(second.bytes).fill(0)
        second.report.pages[0].page = 99
        const reused = await run("input", bytes, 3)
        const failures = []
        for (const [id, candidate] of [
          ["other", bytes],
          ["input", bytes.with(0, 0)],
        ]) {
          try {
            await run(id, candidate, 4)
          } catch (error) {
            failures.push(error.failure.record.code)
          }
        }
        const retry = await run("input", bytes, 5)
        return {
          identical: [reused, retry].every((reply) =>
            new Uint8Array(reply.bytes).every((value, index) => value === new Uint8Array(first.bytes)[index]),
          ),
          report: reused.report,
          failures,
          count: reused.description.pageCount,
        }
      } finally {
        processor.dispose()
      }
    })
    assert.equal(result.identical, true)
    assert.equal(result.count, 2)
    assert.deepEqual(result.report.pages, [
      { source: "book", page: 0, part: 0, copy: 0 },
      { source: "book", page: 2, part: 0, copy: 0 },
    ])
    assert.deepEqual(result.failures, ["invalid-request", "pdf-syntax"])
  } finally {
    await browser?.close()
  }
})
