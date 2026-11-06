// Checks preview raster ownership and eviction in the browser canvas implementation.

import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium, webkit } from "playwright"
import { fixture, tab, pixel, trackWorkers } from "./browser.js"
import { gridDensity } from "./measure.js"

test("The maintained demo declares its book title and physical page names", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const record = await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts")
      const { Processor } = await import("/src/processor.ts")
      const bytes = new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer())
      const processor = new Processor(),
        task = await openPDF(bytes),
        pdf = await task.promise
      try {
        const { info, metadata } = await pdf.getMetadata()
        const result = await processor.run(bytes, 1)
        return { title: metadata.get("dc:title"), infoTitle: info.Title, pages: result.description.pages }
      } finally {
        processor.dispose()
        await task.destroy()
      }
    })
    assert.deepEqual(record, {
      title: "Italic Strokes",
      infoTitle: "Italic Strokes",
      pages: [
        { name: "COVER" },
        { name: "ITAL-GUID-79A4-WXGX" },
        { name: "ITAL-CROS-79A4-WXGF" },
        { name: "ITAL-CROS-79A4-WXGR" },
      ],
    })
  } finally {
    await browser.close()
  }
})

test("Input metadata keeps bounded fields and uses valid title fallbacks", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const values = await page.evaluate(async () => {
      const { metadata } = await import("/src/pdf.ts")
      const record = new Map([
        ["dc:title", "XMP title"],
        ["dc:description", "Practice pages"],
        ["dc:creator", ["One", "Two"]],
        ["dc:rights", "© Example"],
        ["mainz:coverpage", "3"],
        ["x:" + "界".repeat(43), "Too many bytes in the key"],
        ["x:broken", "\ud800"],
      ])
      const pdf = { numPages: 4, getMetadata: async () => ({ metadata: record, info: { Title: "Info title" } }) }
      const first = await metadata(pdf, "file.pdf")
      record.set("dc:title", "invalid\u0001title")
      const fallback = await metadata(pdf, "file.pdf")
      record.set("mainz:coverpage", "5")
      pdf.getMetadata = async () => ({ metadata: record, info: { Title: "" } })
      const filename = await metadata(pdf, "file.pdf")
      record.delete("dc:creator")
      pdf.getMetadata = async () => ({ metadata: record, info: { Author: " Info author " } })
      const author = await metadata(pdf, "file.pdf")
      pdf.getMetadata = async () => ({ metadata: undefined, info: { Author: "x".repeat(4097) } })
      const oversized = await metadata(pdf, "file.pdf")
      pdf.getMetadata = async () => {
        throw new Error("No document metadata")
      }
      const absent = await metadata(pdf, "file.pdf")
      return {
        first,
        fallback: fallback.title,
        filename: [filename.title, filename.coverPage],
        author: author.xmp["dc:creator"],
        oversized,
        absent,
      }
    })
    assert.deepEqual(values, {
      first: {
        title: "XMP title",
        coverPage: 3,
        xmp: {
          "dc:title": "XMP title",
          "dc:description": "Practice pages",
          "dc:creator": "One, Two",
          "dc:rights": "© Example",
          "mainz:coverpage": "3",
        },
      },
      author: "Info author",
      oversized: { title: "file.pdf", coverPage: 1 },
      fallback: "Info title",
      filename: ["file.pdf", 1],
      absent: { title: "file.pdf", coverPage: 1 },
    })
  } finally {
    await browser.close()
  }
})

test(
  "Shared PNG thumbnails decode once and keep Page pixels and decoder fallback independent",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    try {
      for (const failure of [false, true]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        const png = Buffer.from(
          await page.evaluate(() => {
            const canvas = document.createElement("canvas")
            canvas.width = 80
            canvas.height = 40
            const context = canvas.getContext("2d")
            context.fillStyle = "red"
            context.fillRect(0, 0, 40, 40)
            context.fillStyle = "blue"
            context.fillRect(40, 0, 40, 40)
            return canvas.toDataURL().split(",")[1]
          }),
          "base64",
        )
        await page.addInitScript((reject) => {
          localStorage.setItem("mainz:onboarding", "19")
          window.previewDecodes = 0
          const decode = window.createImageBitmap
          window.createImageBitmap = (...arguments_) => {
            window.previewDecodes++
            return reject ? Promise.reject(new Error("Image decoder unavailable")) : decode(...arguments_)
          }
        }, failure)
        await page.route("**/grid.pdf", (route) =>
          route.fulfill({
            contentType: "application/pdf",
            body: fixture({
              count: 4,
              metadata: Array.from({ length: 4 }, () => ({ preview: "preview.png" })),
              preview: png,
            }),
          }),
        )
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.locator(".composer[aria-busy=false]").waitFor()
        await page.waitForFunction(
          () =>
            document.querySelectorAll(".thumbnail canvas").length > 1 &&
            !document.querySelector('.thumbnail[aria-busy="true"]'),
        )
        assert.equal(await page.evaluate(() => window.previewDecodes), 1, await page.locator("body").innerText())
        const input = page.locator(".selection-panel")
        const thumbnail = input.locator(".thumbnail canvas").first()
        const pattern = await thumbnail.evaluate((canvas) => {
          const context = canvas.getContext("2d")
          const at = (x, y) =>
            Array.from(
              context.getImageData(Math.floor(canvas.width * x), Math.floor(canvas.height * y), 1, 1).data,
            ).slice(0, 3)
          const center = context.getImageData(0, Math.floor(canvas.height / 2), canvas.width, 1).data
          const column = context.getImageData(Math.floor(canvas.width / 4), 0, 1, canvas.height).data
          const [horizontal, vertical] = [center, column].map((data) =>
            Array.from({ length: data.length / 4 }, (_, i) => i).filter((i) => data[i * 4 + 1] < 100),
          )
          return {
            left: at(0.25, 0.5),
            right: at(0.75, 0.5),
            top: at(0.5, 0.05),
            bottom: at(0.5, 0.95),
            width: horizontal.length,
            height: vertical.length,
          }
        })
        assert.deepEqual(pattern.top, [255, 255, 255])
        assert.deepEqual(pattern.bottom, [255, 255, 255])
        if (failure) {
          assert.deepEqual(pattern.left, [255, 255, 255])
          assert.deepEqual(pattern.right, [255, 255, 255])
        } else {
          assert.deepEqual(pattern.left, [255, 0, 0])
          assert.deepEqual(pattern.right, [0, 0, 255])
          assert.ok(Math.abs(pattern.width / pattern.height - 2) < 0.1, "PNG pixels retain their 2:1 proportions")
        }
        await gridDensity(input, "Compact Input grid")
        await page.waitForFunction(() => !document.querySelector('.thumbnail[aria-busy="true"]'))
        assert.equal(await page.evaluate(() => window.previewDecodes), 1)
        await tab(input, "Page")
        await page.waitForFunction(
          () => document.querySelector('.selection-panel .pdf-viewport[aria-busy="false"] canvas')?.width > 0,
        )
        assert.ok(
          (await pixel(input.locator(".page-scroll canvas"), 0.5)).slice(0, 3).every((channel) => channel > 240),
        )
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test(
  "Removing the last PNG document releases its idle preview worker and permits reopening",
  { timeout: 30000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    const png = Buffer.from(
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
      "base64",
    )
    try {
      const page = await browser.newPage()
      await page.addInitScript(trackWorkers)
      await page.route("**/preview.pdf", (route) =>
        route.fulfill({
          contentType: "application/pdf",
          body: fixture({ prepared: false, count: 1, metadata: [{ preview: "preview.png" }], preview: png }),
        }),
      )
      await page.goto(server.resolvedUrls.local[0])
      const result = await page.evaluate(async () => {
        const { Documents, openPDF, thumbnail } = await import("/src/pdf.ts")
        const { Processor } = await import("/src/processor.ts")
        const input = new Uint8Array(await (await fetch("/preview.pdf")).arrayBuffer())
        const processor = new Processor()
        const { description } = await processor.run(input, 1)
        processor.dispose()
        const documents = new Documents(),
          counts = [],
          pixels = []
        try {
          for (let attempt = 0; attempt < 2; attempt++) {
            const task = await openPDF(input),
              pdf = await task.promise
            documents.add(pdf, task, { bytes: input, description })
            const raster = await thumbnail(pdf, 0)
            pixels.push([...raster.getContext("2d").getImageData(0, 0, 1, 1).data])
            counts.push(
              window.workers.filter((worker) => worker.url.includes("processor.worker") && !worker.terminated).length,
            )
            documents.dispose()
            counts.push(
              window.workers.filter((worker) => worker.url.includes("processor.worker") && !worker.terminated).length,
            )
            if (raster.width !== 0) throw new Error("Removed PNG raster remains allocated.")
          }
          return { counts, pixels }
        } finally {
          documents.dispose()
        }
      })
      assert.deepEqual(result.counts, [1, 0, 1, 0])
      assert.deepEqual(result.pixels, [
        [0, 0, 0, 255],
        [0, 0, 0, 255],
      ])
    } finally {
      await browser.close()
    }
  },
)

test("Overlapping preview generations release their own pages and never paint stale results", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { mount, unmount, tick, Pdf } = await import("/test/fixtures/preview.ts")
      const { loadRenderer } = await import("/src/pdf.ts")
      await loadRenderer()
      const frames = new Map(),
        requests = [],
        handles = [],
        tasks = [],
        canvases = [],
        errors = []
      let resize,
        next = 0
      const original = { ResizeObserver, requestAnimationFrame, cancelAnimationFrame }
      window.ResizeObserver = class {
        constructor(callback) {
          resize = callback
        }
        observe() {}
        disconnect() {}
      }
      window.requestAnimationFrame = (callback) => {
        frames.set(++next, callback)
        return next
      }
      window.cancelAnimationFrame = (id) => frames.delete(id)
      const advance = async () => {
        const batch = [...frames.values()]
        frames.clear()
        for (const callback of batch) callback()
        await tick()
      }
      const target = document.createElement("div")
      document.body.append(target)
      const pdf = { getPage: () => new Promise((resolve) => requests.push(resolve)) }
      let component
      try {
        component = mount(Pdf, { target, props: { pdf, page: 0, thumbnail: true, error: (text) => errors.push(text) } })
        await tick()
        const viewport = target.querySelector(".thumbnail")
        const redraw = async () => {
          viewport.style.inlineSize = `${400 + requests.length * 20}px`
          resize()
          await advance()
        }
        const acquire = async (index) => {
          const handle = { cleaned: 0, rendered: 0 }
          handles[index] = handle
          requests[index]({
            getViewport: ({ scale }) => ({ width: 100 * scale, height: 100 * scale }),
            cleanup: () => handle.cleaned++,
            render: ({ canvas }) => {
              canvases.push(canvas)
              handle.rendered++
              let resolve, reject
              const task = {
                promise: new Promise((yes, no) => {
                  resolve = yes
                  reject = no
                }),
                cancel: () => {
                  task.cancelled = true
                  reject(new Error("Cancelled"))
                },
                finish: (color) => {
                  const context = canvas.getContext("2d")
                  context.fillStyle = color
                  context.fillRect(0, 0, canvas.width, canvas.height)
                  resolve()
                },
              }
              tasks.push(task)
              return task
            },
          })
          await tick()
        }
        await redraw()
        await acquire(0)
        await redraw()
        await redraw()
        await acquire(2)
        await advance()
        await acquire(1)
        tasks[0].finish("#008000")
        await tick()
        const canvas = target.querySelector("canvas")
        const pixels = () => [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]
        const first = pixels()
        await redraw()
        await acquire(3)
        await advance()
        const retained = pixels()
        await redraw()
        await acquire(4)
        await advance()
        tasks.at(-1).finish("#0000ff")
        await tick()
        const last = pixels()
        await redraw()
        await unmount(component)
        component = undefined
        await acquire(5)
        return {
          handles,
          errors,
          first,
          retained,
          last,
          cancelled: tasks.filter((task) => task.cancelled).length,
          released: canvases.every((raster) => raster.width === 0 && raster.height === 0),
          removed: !target.querySelector("canvas"),
        }
      } finally {
        if (component) await unmount(component)
        Object.assign(window, original)
        target.remove()
      }
    })
    assert.deepEqual(result.handles, [
      { cleaned: 1, rendered: 0 },
      { cleaned: 1, rendered: 0 },
      { cleaned: 1, rendered: 1 },
      { cleaned: 1, rendered: 1 },
      { cleaned: 1, rendered: 1 },
      { cleaned: 1, rendered: 0 },
    ])
    assert.deepEqual(result.errors, [])
    assert.deepEqual(result.first, [0, 128, 0, 255])
    assert.deepEqual(result.retained, result.first)
    assert.deepEqual(result.last, [0, 0, 255, 255])
    assert.equal(result.cancelled, 1)
    assert.equal(result.released, true)
    assert.equal(result.removed, true)
  } finally {
    await browser?.close()
  }
})

test(
  "Thumbnails retain fine guides without reusing Page rasters or changing Page pixels",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit])
      for (const dpr of [0.5, 1, 1.5, 2]) {
        const browser = await launch(engine)
        try {
          const page = await browser.newPage({ deviceScaleFactor: dpr })
          await page.goto(server.resolvedUrls.local[0])
          const result = await page.evaluate(async () => {
            const { mount, unmount, tick, Pdf } = await import("/test/fixtures/preview.ts")
            const { openPDF, releaseRasters } = await import("/src/pdf.ts")
            const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()))
            const pdf = await task.promise
            const target = document.createElement("div")
            document.body.append(target)
            const images = [],
              errors = []
            try {
              for (const thumbnail of [false, true, false, true]) {
                const component = mount(Pdf, {
                  target,
                  props: { pdf, page: 1, thumbnail, thumbnailWidth: 100, error: (text) => errors.push(text) },
                })
                try {
                  await tick()
                  const frame = target.querySelector(".thumbnail, .pdf-viewport")
                  frame.style.cssText = "inline-size:100px;block-size:142px;min-block-size:0;padding:0"
                  const canvas = frame.querySelector("canvas")
                  canvas.style.inlineSize = "100px"
                  while (frame.getAttribute("aria-busy") === "true") await new Promise(requestAnimationFrame)
                  const pixels = canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
                  let chroma = 0
                  for (let y = Math.floor(canvas.height * 0.2); y < canvas.height * 0.9; y++)
                    for (let x = Math.floor(canvas.width * 0.15); x < canvas.width * 0.85; x++) {
                      const offset = (y * canvas.width + x) * 4
                      const channels = [pixels[offset], pixels[offset + 1], pixels[offset + 2]]
                      chroma += Math.max(...channels) - Math.min(...channels)
                    }
                  images.push({
                    thumbnail,
                    width: canvas.width,
                    height: canvas.height,
                    chroma,
                    pixels: canvas.toDataURL(),
                  })
                } finally {
                  await unmount(component)
                }
              }
              return { images, errors }
            } finally {
              releaseRasters(pdf)
              await task.destroy()
              target.remove()
            }
          })
          assert.deepEqual(result.errors, [])
          const [direct, thumbnail, directAgain, thumbnailAgain] = result.images
          assert.deepEqual([thumbnail.width, thumbnail.height], [direct.width, direct.height])
          // The 150 DPI Poppler reference retains these guides with substantially less color weight than direct Page sampling.
          if (dpr < 2) assert.ok(thumbnail.chroma < direct.chroma * 0.9 && thumbnail.chroma > direct.chroma * 0.1)
          else assert.equal(thumbnail.pixels, direct.pixels)
          assert.equal(directAgain.pixels, direct.pixels)
          assert.equal(thumbnailAgain.pixels, thumbnail.pixels)
        } finally {
          await browser.close()
        }
      }
  },
)

test("Input inspection bounds pending metadata and releases pages on completion, cancellation, and failure", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { inspectPDF } = await import("/src/pdf.ts")
      const results = []
      for (const mode of ["complete", "cancel", "failure"]) {
        let pending = 0,
          peak = 0,
          acquired = 0,
          released = 0,
          labels = 0,
          failure
        const pdf = {
          numPages: 100,
          getPage: async (number) => {
            acquired++
            peak = Math.max(peak, ++pending)
            await Promise.resolve()
            pending--
            return {
              getViewport: () => {
                if (mode === "failure" && number === 8) throw new Error("Invalid page geometry")
                return { width: number * 72, height: 144 }
              },
              render: () => ({ promise: Promise.resolve() }),
              cleanup: () => released++,
            }
          },
          getPageLabels: async () => {
            labels++
            return ["Cover"]
          },
        }
        let geometry
        try {
          geometry = await inspectPDF(pdf, () => mode === "cancel" && acquired > 1)
        } catch (error) {
          failure = error.message
        }
        results.push({
          mode,
          peak,
          acquired,
          released,
          labels,
          failure,
          count: geometry?.sizes.length,
          first: geometry?.sizes[0],
          last: geometry?.sizes.at(-1),
          names: geometry?.labels,
        })
      }
      return results
    })
    assert.deepEqual(result[0], {
      mode: "complete",
      peak: 16,
      acquired: 101,
      released: 101,
      labels: 1,
      failure: undefined,
      count: 100,
      first: { width: 25.4, height: 50.8 },
      last: { width: 2540, height: 50.8 },
      names: ["Cover"],
    })
    for (const entry of result.slice(1)) {
      assert.equal(entry.peak, 16)
      assert.equal(entry.acquired, 17)
      assert.equal(entry.released, entry.acquired)
      assert.equal(entry.labels, 0)
      assert.equal(entry.count, undefined)
    }
    assert.equal(result[2].failure, "Invalid page geometry")
  } finally {
    await browser?.close()
  }
})

test("Thumbnail allocation stays within its pixel limit and releases failed renders", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { mount, unmount, tick, Pdf } = await import("/test/fixtures/preview.ts")
      const { cachedRaster, releaseRasters } = await import("/src/pdf.ts")
      const surfaces = [],
        allocations = [],
        errors = [],
        images = []
      const pdf = {
        async getPage() {
          return {
            getViewport: ({ scale }) => ({ width: 595.3 * scale, height: 841.9 * scale }),
            cleanup() {},
            render({ canvas }) {
              surfaces.push(canvas)
              allocations.push(canvas.width * canvas.height)
              return {
                promise: surfaces.length === 2 ? Promise.reject(new Error("Renderer failed")) : Promise.resolve(),
                cancel() {},
              }
            },
          }
        },
      }
      const target = document.createElement("div")
      document.body.append(target)
      const component = mount(Pdf, {
        target,
        props: { pdf, page: 0, thumbnail: true, error: (text) => errors.push(text) },
      })
      let cached
      try {
        await tick()
        const frame = target.querySelector(".thumbnail"),
          canvas = frame.querySelector("canvas")
        for (const [index, [width, height]] of [
          [1800, 2500],
          [1900, 2600],
          [5000, 7000],
        ].entries()) {
          frame.style.cssText = `inline-size:${width}px;block-size:${height}px;min-block-size:0;padding:0`
          while (surfaces.length <= index || frame.getAttribute("aria-busy") === "true")
            await new Promise(requestAnimationFrame)
          images.push({ width: canvas.width, height: canvas.height, failed: frame.hasAttribute("data-error") })
          cached ??= cachedRaster(pdf, 0)
        }
      } finally {
        await unmount(component)
        releaseRasters(pdf)
        target.remove()
      }
      return {
        images,
        allocations,
        errors,
        released: surfaces.every((surface) => surface.width === 0 && surface.height === 0),
        cacheReleased: cached.width === 0 && cached.height === 0,
      }
    })
    assert.ok(result.allocations.every((pixels) => pixels > 0 && pixels <= 16 * 1024 * 1024))
    assert.ok(result.images.every((image) => image.width * image.height <= 16 * 1024 * 1024))
    assert.deepEqual(result.images[1], { ...result.images[0], failed: true })
    assert.equal(result.images[2].failed, false)
    assert.deepEqual(result.errors, ["Page 1: Renderer failed"])
    assert.equal(result.released, true)
    assert.equal(result.cacheReleased, true)
  } finally {
    await browser.close()
  }
})

test(
  "Remounted thumbnails paint cached pages immediately without rendering them again",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    try {
      const page = await browser.newPage()
      await page.goto(server.resolvedUrls.local[0])
      const result = await page.evaluate(async () => {
        const { mount, unmount, tick, Pdf } = await import("/test/fixtures/preview.ts")
        const { loadRenderer, releaseRasters } = await import("/src/pdf.ts")
        await loadRenderer()
        let renders = 0
        const errors = []
        const pdf = {
          async getPage() {
            return {
              getViewport: ({ scale }) => ({ width: 100 * scale, height: 100 * scale }),
              cleanup() {},
              render({ canvas }) {
                renders++
                const context = canvas.getContext("2d")
                context.fillStyle = "#008000"
                context.fillRect(0, 0, canvas.width, canvas.height)
                return { promise: Promise.resolve(), cancel() {} }
              },
            }
          },
        }
        const target = document.createElement("div")
        document.body.append(target)
        const samples = []
        for (const width of [100, 200, 100, 200]) {
          const component = mount(Pdf, {
            target,
            props: { pdf, page: 0, thumbnail: true, error: (text) => errors.push(text) },
          })
          await tick()
          const viewport = target.querySelector(".thumbnail")
          viewport.style.cssText = `inline-size:${width}px;block-size:${width}px;min-block-size:0;padding:0`
          const canvas = viewport.querySelector("canvas")
          const immediate = canvas.width > 0 && !viewport.querySelector(".render-status")
          while (viewport.getAttribute("aria-busy") === "true") await new Promise(requestAnimationFrame)
          const pixels = [...canvas.getContext("2d").getImageData(0, 0, 1, 1).data]
          samples.push({ immediate, renders, pixels })
          await unmount(component)
        }
        releaseRasters(pdf)
        target.remove()
        return { samples, errors }
      })
      assert.deepEqual(result.errors, [])
      assert.deepEqual(
        result.samples.map(({ immediate }) => immediate),
        [false, true, true, true],
      )
      assert.deepEqual(
        result.samples.map(({ renders }) => renders),
        [1, 2, 2, 2],
      )
      for (const sample of result.samples) assert.deepEqual(sample.pixels, [0, 128, 0, 255])
    } finally {
      await browser.close()
    }
  },
)

test("Document ownership releases tasks and rasters once, including validation failures", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { Documents, cacheRaster, cachedRaster, verifyPDF } = await import("/src/pdf.ts")
      const documents = new Documents(),
        opened = {},
        styled = {}
      const released = []
      documents.add(opened, { destroy: async () => released.push("opened") })
      documents.add(styled, { destroy: async () => released.push("styled") })
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 32
      cacheRaster(opened, 0, 1, canvas)
      const styledCanvas = canvas.cloneNode()
      cacheRaster(styled, 0, 1, styledCanvas)
      const original = cachedRaster(opened, 0, 1),
        preview = cachedRaster(styled, 0, 1)
      documents.retain([opened, styled, opened])
      const shared = released.length === 0 && original === canvas && preview === styledCanvas
      documents.retain([opened])
      documents.retain([opened])
      const comparison = original.width === 32 && preview.width === 0
      documents.dispose()
      documents.dispose()
      let cleaned = 0,
        failure
      try {
        await verifyPDF({
          getPage: async () => ({
            getViewport: () => {
              throw new Error("Invalid viewport")
            },
            cleanup: () => cleaned++,
          }),
        })
      } catch (error) {
        failure = error.message
      }
      return { shared, comparison, released, cleared: original.width === 0, cleaned, failure }
    })
    assert.deepEqual(result, {
      shared: true,
      comparison: true,
      released: ["styled", "opened"],
      cleared: true,
      cleaned: 1,
      failure: "Invalid viewport",
    })
  } finally {
    await browser?.close()
  }
})

test("Releasing PDF rasters clears only that document and preserves the shared cache budget", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { cacheRaster, cachedRaster, releaseRasters } = await import("/src/pdf.ts")
      const first = {},
        second = {}
      const side = 512
      const raster = () => {
        const canvas = document.createElement("canvas")
        canvas.width = canvas.height = side
        canvas.getContext("2d").fillRect(0, 0, side, side)
        return canvas
      }
      const canvas = raster()
      cacheRaster(first, 1, 1, canvas)
      cacheRaster(first, 2, 1, raster())
      cacheRaster(second, 1, 1, raster())
      const duplicate = raster()
      const rejected = cacheRaster(first, 1, 1, duplicate) === false && duplicate.width === side
      duplicate.width = duplicate.height = 0
      const adopted = cachedRaster(first, 1, 1) === canvas
      const closed = [cachedRaster(first, 1, 1), cachedRaster(first, 2, 1)]
      const retained = cachedRaster(second, 1, 1)
      releaseRasters(first)
      releaseRasters(first)
      const removed = [cachedRaster(first, 1, 1), cachedRaster(first, 2, 1)].every((entry) => !entry)
      const cleared = closed.every((entry) => entry.width === 0 && entry.height === 0)
      const shared = cachedRaster(second, 1, 1) === retained && retained.width === side
      for (let number = 2; number <= 32; number++) cacheRaster(second, number, 1, raster())
      const full = Array.from({ length: 32 }, (_, index) => !!cachedRaster(second, index + 1, 1)).every(Boolean)
      cacheRaster(second, 33, 1, raster())
      const evicted = !cachedRaster(second, 1, 1) && retained.width === 0
      const latest = cachedRaster(second, 33, 1)
      releaseRasters(second)
      cacheRaster(first, 1, 1, raster())
      const reopened = cachedRaster(first, 1, 1).width === side
      releaseRasters(first)
      return { adopted, rejected, removed, cleared, shared, full, evicted, released: latest.width === 0, reopened }
    })
    assert.deepEqual(result, {
      adopted: true,
      rejected: true,
      removed: true,
      cleared: true,
      shared: true,
      full: true,
      evicted: true,
      released: true,
      reopened: true,
    })
  } finally {
    await browser?.close()
  }
})

test("Source replacement retains opened rasters for comparison and releases them on removal", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts")
      const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()))
      const prototype = Object.getPrototypeOf(await task.promise)
      const getPage = prototype.getPage
      window.previewPDFs = new Set()
      prototype.getPage = function (...args) {
        window.previewPDFs.add(this)
        return getPage.apply(this, args)
      }
      await task.destroy()
    })
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Prepared.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel")
    await input.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
    await page.evaluate(async () => {
      const { cacheRaster, cachedRaster } = await import("/src/pdf.ts")
      const pdf = [...window.previewPDFs][0]
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 32
      cacheRaster(pdf, 9999, 1, canvas)
      window.openedRaster = cachedRaster(pdf, 9999, 1)
    })
    await input.getByLabel("Page selection", { exact: true }).fill("1,1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.waitForFunction(
      () => window.previewPDFs.size >= 2 && !document.querySelector(".header-feedback .style-progress"),
    )
    assert.equal(
      await page.evaluate(() => window.openedRaster.width),
      32,
      "Completed styles keep the opened PDF for comparison",
    )
    const output = page.locator(".composition-output")
    await output.getByLabel("Page selection", { exact: true }).fill("1-2")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await input.locator(".input-picker > summary").click()
    await input.getByRole("button", { name: "Remove Input", exact: true }).click()
    await page.waitForFunction(() => window.openedRaster.width === 0)
    assert.equal(await page.locator(".composer").count(), 0)
  } finally {
    await browser?.close()
  }
})
