// Checks optional lens rendering against delayed and failed PDF.js operations.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer } from "./browser.js"

const harness = {
  name: "lens-fixture",
  resolveId: (id) => (id === "/lens-fixture.js" ? id : undefined),
  load: (id) =>
    id === "/lens-fixture.js"
      ? `import { mount, unmount } from "svelte";
         import Lens from "/src/Lens.svelte";
         window.mountLens = (props) => {
           const instance = mount(Lens, { target: document.getElementById("app"), props });
           window.unmountLens = () => unmount(instance);
         };`
      : undefined,
}

async function fixture(page, url, delayed = false) {
  await page.goto(url)
  await page.addScriptTag({ type: "module", url: `${url}lens-fixture.js` })
  await page.waitForFunction(() => !!window.mountLens)
  await page.evaluate((waitForPage) => {
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
      render: ({ canvas: raster }) => {
        const state = window.lensPDF
        state.started++
        state.peak = Math.max(state.peak, ++state.active)
        let timer, reject
        const promise = new Promise((resolve, fail) => {
          reject = fail
          if (!window.holdLensRender)
            timer = setTimeout(() => {
              raster.getContext("2d").fillRect(0, 0, raster.width, raster.height)
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
      rendering: false,
      pdf: {
        getPage: () => {
          window.lensPDF.acquired++
          return waitForPage
            ? new Promise((resolve) => (window.releaseLensPage = () => resolve(sheet)))
            : Promise.resolve(sheet)
        },
      },
    })
  }, delayed)
}

test("Lens teardown releases acquired pages after delayed or failed renderer loading", { timeout: 60000 }, async () => {
  const server = await createServer({ plugins: [harness], server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      await fixture(page, server.resolvedUrls.local[0])
      await page.evaluate(async () => (await import("/src/pdf.ts")).loadRenderer())
      await page.clock.install()
      await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
      await page.locator("#lens-source").hover()
      await page.clock.runFor(200)
      await page.locator(".lens").waitFor()
      for (let step = 0; step < 12; step++) {
        await page.mouse.move(80 + step * 5, 200)
        await page.clock.runFor(16)
      }
      const moving = await page.evaluate(() => window.lensPDF)
      assert.ok(moving.started >= 2, "Detail renders progress while the pointer keeps moving")
      assert.equal(moving.cancelled, 0, "Movement does not discard active PDF work")
      assert.equal(moving.peak, 1, "Only one detail render runs at a time")
      assert.equal(moving.acquired, 1, "Movement retains the acquired PDF.js page and its decoded operators")
      assert.equal(moving.cleaned, 0, "The open lens keeps its page ready for the next crop")
      await page.clock.runFor(200)
      await page.locator('.lens[aria-busy="false"]').waitFor()
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
