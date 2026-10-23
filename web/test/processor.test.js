// Checks processor module ownership and recovery when the WASM cleanup boundary fails.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer } from "vite"

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
