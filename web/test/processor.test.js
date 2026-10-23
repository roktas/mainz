// Checks processor module ownership and recovery when the WASM cleanup boundary fails.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer } from "vite"
import { serve } from "./server.ts"
import { fixture, trackWorkers } from "./browser.js"

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
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 40) }),
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
