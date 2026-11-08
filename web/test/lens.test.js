// Checks optional lens rendering against delayed and failed PDF.js operations.

import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { chromium, webkit } from "playwright"
import { createServer, tab } from "./browser.js"
import { serve } from "./server.ts"

const harness = {
  name: "lens-fixture",
  resolveId: (id) => (id === "/lens-fixture.js" ? id : undefined),
  load: (id) =>
    id === "/lens-fixture.js"
      ? `import { flushSync, mount, unmount } from "svelte";
         import { fromStore, writable } from "svelte/store";
         import Lens from "/src/Lens.svelte";
         window.mountLens = (props) => {
           const rendering = fromStore(writable(props.rendering));
           const instance = mount(Lens, { target: document.getElementById("app"), props: {
             ...props, get rendering() { return rendering.current; }
           } });
           window.setLensRendering = (value) => flushSync(() => { rendering.current = value; });
           window.unmountLens = () => unmount(instance);
         };`
      : undefined,
}

async function fixture(page, url, delayed = false, name) {
  await page.goto(url)
  await page.addScriptTag({ type: "module", url: `${url}lens-fixture.js` })
  await page.waitForFunction(() => !!window.mountLens)
  await page.evaluate(
    ({ waitForPage, caption }) => {
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 200
      canvas.style.cssText = "position: fixed; left: 20px; top: 100px; width: 200px; height: 200px"
      canvas.id = "lens-source"
      document.getElementById("app").append(canvas)
      canvas.getContext("2d").fillRect(0, 0, 200, 200)
      window.lensPDF = { acquired: 0, cleaned: 0, started: 0, active: 0, peak: 0, cancelled: 0 }
      const sheet = {
        cleanup: () => window.lensPDF.cleaned++,
        getViewport: ({ scale }) => ({ width: 200 * scale, height: 200 * scale }),
        render: ({ canvas: raster, viewport, transform }) => {
          const state = window.lensPDF
          state.started++
          state.peak = Math.max(state.peak, ++state.active)
          let timer, reject
          const promise = new Promise((resolve, fail) => {
            reject = fail
            if (!window.holdLensRender)
              timer = setTimeout(() => {
                const context = raster.getContext("2d")
                context.fillStyle = "#0000ff"
                context.fillRect(0, 0, raster.width, raster.height)
                context.fillStyle = "#ff0000"
                context.fillRect(viewport.width * 0.35 + transform[4], 0, viewport.width * 0.01, raster.height)
                resolve()
              }, 60)
          }).finally(() => state.active--)
          return {
            promise,
            cancel: () => {
              state.cancelled++
              clearTimeout(timer)
              reject(new Error("Cancelled"))
            },
          }
        },
      }
      window.mountLens({
        canvas,
        page: 1,
        pageNumber: 7,
        name: caption,
        rendering: false,
        pdf: {
          getPage: (number) => {
            window.lensPDF.page = number
            window.lensPDF.acquired++
            return waitForPage
              ? new Promise((resolve) => (window.releaseLensPage = () => resolve(sheet)))
              : Promise.resolve(sheet)
          },
        },
      })
    },
    { waitForPage: delayed, caption: name },
  )
}

test("Lens retains a stationary hover through raster refresh and respects dismissal", { timeout: 30000 }, async () => {
  const server = await createServer({ plugins: [harness], server: { port: 0, host: "127.0.0.1" } })
  try {
    await server.listen()
    for (const engine of [chromium, webkit]) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
        await fixture(page, server.resolvedUrls.local[0])
        await page.evaluate(async () => (await import("/src/pdf.ts")).loadRenderer())
        await page.clock.install()
        await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
        const source = page.locator("#lens-source")
        await source.hover()
        await page.clock.runFor(90)
        await page.evaluate(() => window.setLensRendering(true))
        await page.clock.runFor(250)
        assert.equal(await page.locator(".lens").count(), 0)
        await page.evaluate(() => window.setLensRendering(false))
        await page.clock.runFor(300)
        await page.locator('.lens[aria-busy="false"]').waitFor()
        await page.keyboard.press("Escape")
        await page.evaluate(() => {
          window.setLensRendering(true)
          window.setLensRendering(false)
        })
        await page.clock.runFor(300)
        assert.equal(await page.locator(".lens").count(), 0, "Refresh does not undo Escape")
        await page.mouse.move(101, 200)
        await page.clock.runFor(90)
        await page.evaluate(() => window.setLensRendering(true))
        await page.keyboard.press("Escape")
        await page.evaluate(() => window.setLensRendering(false))
        await page.clock.runFor(300)
        assert.equal(await page.locator(".lens").count(), 0, "Escape during loading cancels hover intent")
        await page.mouse.move(102, 200)
        await page.clock.runFor(90)
        await page.evaluate(() => window.setLensRendering(true))
        await page.mouse.move(0, 0)
        await page.evaluate(() => window.setLensRendering(false))
        await page.clock.runFor(300)
        assert.equal(await page.locator(".lens").count(), 0, "Leaving cancels the pending hover")
      } finally {
        await browser.close()
      }
    }
  } finally {
    await server.close()
  }
})

test("Lens names stay centered and truncate within short viewports and enlarged text", { timeout: 60000 }, async () => {
  const server = await createServer({ plugins: [harness], server: { port: 0, host: "127.0.0.1" } })
  try {
    await server.listen()
    for (const engine of [chromium, webkit]) {
      const browser = await launch(engine)
      try {
        for (const hasTouch of [false, true]) {
          const page = await browser.newPage({ viewport: { width: 667, height: 250 }, hasTouch, isMobile: hasTouch })
          const name = "ITAL-" + "Very long physical page name ".repeat(12)
          await fixture(page, server.resolvedUrls.local[0], false, name)
          await page.locator("#lens-source").evaluate((canvas) => (canvas.style.zIndex = "49"))
          for (const theme of ["light", "dark"]) {
            await page.evaluate((choice) => {
              document.documentElement.dataset.theme = choice
              document.documentElement.style.fontSize = "200%"
            }, theme)
            if (hasTouch)
              await page
                .locator("#lens-source")
                .dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 100, clientY: 150 }] })
            else await page.mouse.move(100, 150)
            await page.locator('.lens[aria-busy="false"]').waitFor()
            assert.equal(await page.locator(".lens").getAttribute("aria-label"), "Magnified page 7 at 16×")
            assert.equal(await page.evaluate(() => window.lensPDF.page), 1)
            assert.equal(await page.locator(".lens-name").innerText(), name.trim())
            const geometry = await page.locator(".lens").evaluate((lens) => {
              const box = lens.getBoundingClientRect(),
                canvas = lens.querySelector("canvas").getBoundingClientRect(),
                label = lens.querySelector("p"),
                text = label.getBoundingClientRect(),
                style = getComputedStyle(label)
              return {
                bounded:
                  box.left >= 12 && box.top >= 12 && box.right <= innerWidth - 12 && box.bottom <= innerHeight - 12,
                separate: canvas.bottom <= text.top && canvas.height > 100,
                centered:
                  Math.abs(text.left + text.width / 2 - box.left - box.width / 2) < 1 && style.textAlign === "center",
                truncated: label.scrollWidth > label.clientWidth && style.textOverflow === "ellipsis",
              }
            })
            assert.deepEqual(geometry, { bounded: true, separate: true, centered: true, truncated: true })
            if (hasTouch) await page.locator("#lens-source").dispatchEvent("touchend", { touches: [] })
            else {
              await page.keyboard.press("Escape")
              await page.mouse.move(0, 0)
            }
          }
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  } finally {
    await server.close()
  }
})

test("Input and Output lenses retain physical page names in Grid and Page", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator('.composer[aria-busy="false"]').waitFor()
    for (const pane of [page.locator(".selection-panel"), page.locator(".composition-output")]) {
      const previewCanvas = pane.locator('.page-image[data-page="1"] canvas')
      await page.waitForFunction(() => !document.querySelector('.composer [aria-busy="true"]'))
      await page.mouse.move(0, 0)
      await previewCanvas.hover()
      await page.locator('.lens[aria-busy="false"]').waitFor()
      assert.equal(await page.locator(".lens-name").innerText(), "ITAL-GUID-79A4-WXGX")
      await page.keyboard.press("Escape")
      await pane.locator('.page-image[data-page="1"]').click()
      await tab(pane, "Page")
      const canvas = pane.locator('.pdf-viewport[aria-busy="false"] canvas')
      await canvas.scrollIntoViewIfNeeded()
      await page.waitForFunction(() => !document.querySelector('.composer [aria-busy="true"]'))
      await page.mouse.move(0, 0)
      await canvas.hover({ position: { x: 10, y: 10 } })
      await page.locator('.lens[aria-busy="false"]').waitFor()
      assert.equal(await page.locator(".lens-name").innerText(), "ITAL-GUID-79A4-WXGX")
      await page.keyboard.press("Escape")
      await tab(pane, "Grid")
    }
  } finally {
    await browser.close()
  }
})

test("Lens fits short viewports at every edge for mouse and touch", { timeout: 60000 }, async () => {
  const server = await createServer({ plugins: [harness], server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, isMobile: hasTouch })
      for (const [width, height] of [
        [667, 250],
        [844, 300],
      ]) {
        await page.setViewportSize({ width, height })
        await fixture(page, server.resolvedUrls.local[0])
        await page.locator("#lens-source").evaluate((canvas) => {
          document.documentElement.style.overflow = "clip"
          document.documentElement.style.scrollbarGutter = "auto"
          canvas.style.cssText = "position: fixed; inset: 0; width: 100vw; height: 100vh; z-index: 49"
        })
        for (const [x, y] of [
          [2, 2],
          [width - 2, 2],
          [width - 2, height - 2],
          [2, height - 2],
        ]) {
          if (hasTouch) {
            await page.locator("#lens-source").dispatchEvent("touchstart", {
              touches: [{ identifier: 1, clientX: x, clientY: y }],
            })
          } else await page.mouse.move(x, y)
          await page
            .locator(".lens")
            .waitFor({ timeout: 5000 })
            .catch((error) => {
              error.message += `\n${width}×${height}, touch=${hasTouch}, (${x}, ${y})`
              throw error
            })
          const box = await page.locator(".lens").boundingBox()
          assert.equal(box.width, height - 24)
          assert.equal(box.height, box.width)
          assert.ok(box.x >= 12 && box.y >= 12 && box.x + box.width <= width - 12 && box.y + box.height <= height - 12)
          if (hasTouch) await page.locator("#lens-source").dispatchEvent("touchend", { touches: [] })
          else await page.keyboard.press("Escape")
        }
        if (hasTouch)
          await page
            .locator("#lens-source")
            .dispatchEvent("touchstart", { touches: [{ identifier: 1, clientX: 50, clientY: 50 }] })
        else await page.mouse.move(50, 50)
        await page.locator(".lens").waitFor()
        await page.setViewportSize({ width: width + 1, height: height - 1 })
        await page.locator(".lens").waitFor({ state: "detached" })
        await page.evaluate(() => window.unmountLens())
      }
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Lens teardown releases acquired pages after delayed or failed renderer loading", { timeout: 60000 }, async () => {
  const server = await createServer({ plugins: [harness], server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const stage of ["page", "renderer", "failure", "render"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      let releaseRenderer
      const requested = new Promise((resolve) => {
        if (stage === "page" || stage === "render") return resolve()
        void page.route("**/pdfjs-dist.js*", async (route) => {
          await new Promise((release) => {
            releaseRenderer = release
            resolve()
          })
          if (stage === "failure") await route.abort()
          else await route.continue()
        })
      })
      await fixture(page, server.resolvedUrls.local[0], stage === "page")
      if (stage === "render") await page.evaluate(() => (window.holdLensRender = true))
      await page.locator("#lens-source").hover()
      await page.waitForFunction(() => window.lensPDF.acquired === 1)
      await requested
      if (stage === "render") await page.waitForFunction(() => window.lensPDF.active === 1)
      if (stage !== "failure") await page.keyboard.press("Escape")
      if (stage === "page") await page.evaluate(() => window.releaseLensPage())
      releaseRenderer?.()
      await page.waitForFunction(() => window.lensPDF.cleaned === 1)
      const state = await page.evaluate(() => window.lensPDF)
      assert.equal(state.active, 0, `${stage}: no render outlives its page`)
      assert.equal(state.started, stage === "render" ? 1 : 0, `${stage}: dismissed lenses never draw late`)
      if (stage === "failure") {
        assert.equal(await page.locator('.lens[aria-busy="false"]').count(), 1, "Optional failure keeps the preview")
        await page.keyboard.press("Escape")
      }
      assert.equal(await page.locator(".lens").count(), 0)
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "An open lens refines during continuous movement without restarting active renders",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ plugins: [harness], server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await fixture(page, server.resolvedUrls.local[0])
      await page.evaluate(async () => (await import("/src/pdf.ts")).loadRenderer())
      await page.clock.install()
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
      await page.locator("#lens-source").hover()
      await page.clock.runFor(200)
      await page.locator(".lens").waitFor()
      for (let step = 0; step < 12; step++) {
        await page.mouse.move(80 + step, 200)
        await page.clock.runFor(16)
      }
      const moving = await page.evaluate(() => window.lensPDF)
      assert.ok(moving.started >= 2, "Detail renders progress while the pointer keeps moving")
      assert.equal(moving.cancelled, 0, "Movement does not discard active PDF work")
      assert.equal(moving.peak, 1, "Only one detail render runs at a time")
      assert.equal(moving.acquired, 1, "Movement retains the acquired PDF.js page and its decoded operators")
      assert.equal(moving.cleaned, 0, "The open lens keeps its page ready for the next crop")
      const center = () =>
        page
          .locator(".lens canvas")
          .evaluate((canvas) =>
            Array.from(canvas.getContext("2d").getImageData(canvas.width / 2, canvas.height / 2, 1, 1).data),
          )
      assert.deepEqual(await center(), [255, 0, 0, 255], "Completed detail stays aligned while the pointer moves")
      await page.mouse.move(210, 200)
      await page.clock.runFor(1)
      assert.deepEqual(await center(), [0, 0, 0, 255], "Moving outside the completed crop shows the current fallback")
      await page.clock.runFor(200)
      await page.locator('.lens[aria-busy="false"]').waitFor()
      assert.deepEqual(await center(), [0, 0, 255, 255], "The latest position receives its own detail")
      await page.evaluate(() => window.unmountLens())
      assert.equal(await page.locator(".lens").count(), 0)
      assert.equal(await page.evaluate(() => window.lensPDF.active), 0)
      assert.equal(await page.evaluate(() => window.lensPDF.cleaned), 1)
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)
