// Checks named Output PDFs, native sharing and printing, and floating Style editors through the workspace.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { fixture, tab, trackWorkers } from "./browser.js"

const inventory = JSON.parse(await readFile(new URL("./viewports.json", import.meta.url), "utf8"))

test(
  "View prepares before opening the Output PDF and retains cancellation and popup recovery",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch({ channel: "chromium" })
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.holdExport && message.job) {
              window.resumeExport = () => super.postMessage(message, ...rest)
              return
            }
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      await page.evaluate(() => (window.holdExport = true))
      const before = await output.boundingBox()
      await output.getByRole("button", { name: "View PDF", exact: true }).click()
      const progress = page.locator('.header-feedback .feedback[data-kind="progress"]')
      await progress.getByRole("button", { name: "Cancel", exact: true }).waitFor()
      assert.equal(page.context().pages().length, 1, "No blank preparation tab")
      assert.deepEqual(await output.boundingBox(), before)
      const pending = page.waitForEvent("popup")
      await page.evaluate(() => window.resumeExport())
      await progress.waitFor({ state: "hidden" })
      const viewer = await pending
      await viewer.waitForLoadState()
      assert.ok(viewer.url().startsWith("blob:"))
      const bytes = await page.evaluate(
        async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
        viewer.url(),
      )
      assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-")
      const description = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        try {
          return (await processor.run(new Uint8Array(buffer), 1)).description
        } finally {
          processor.dispose()
        }
      }, bytes)
      assert.equal(description.pageCount, 8)
      await viewer.close()
      await page.evaluate(() => {
        window.holdExport = true
        window.resumeExport = undefined
      })
      await output.getByRole("button", { name: "View PDF", exact: true }).click()
      await progress.getByRole("button", { name: "Cancel", exact: true }).click()
      assert.equal(page.context().pages().length, 1)
      assert.match(await page.locator(".footnote").innerText(), /View cancelled/)
      // Reject the browser popup only, then retry the already completed PDF with a fresh user gesture.
      await page.evaluate(() => {
        window.holdExport = false
        window.originalOpen = window.open
        window.open = () => null
      })
      await output.getByRole("button", { name: "View PDF", exact: true }).click()
      const failure = page.getByRole("dialog", { name: "View", exact: true })
      await failure.waitFor()
      await failure.getByRole("button", { name: "Retry", exact: true }).waitFor()
      assert.match(await failure.innerText(), /Allow popups/)
      await page.evaluate(() => (window.open = window.originalOpen))
      const retry = page.waitForEvent("popup")
      await failure.getByRole("button", { name: "Retry", exact: true }).click()
      await (await retry).close()
    } finally {
      await browser.close()
    }
  },
)

test("iPad Chrome View opens without another confirmation or download", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    const page = await browser.newPage({
      viewport: { width: 810, height: 1080 },
      hasTouch: true,
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/158.0.8127.2 Mobile Safari/604.1",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    await page.getByRole("button", { name: "Output", exact: true }).tap()
    const downloads = []
    page.on("download", (download) => downloads.push(download))
    const pending = page.waitForEvent("popup")
    await page.locator(".composition-output").getByRole("button", { name: "View PDF", exact: true }).tap()
    const viewer = await pending
    await viewer.waitForLoadState()
    assert.ok(viewer.url().startsWith("blob:"))
    assert.equal(await page.getByRole("dialog", { name: "View", exact: true }).isVisible(), false)
    assert.equal(downloads.length, 0)
    await viewer.close()
  } finally {
    await browser.close()
  }
})

test("Installed View opens the native PDF viewer without another confirmation", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      Object.defineProperty(navigator, "standalone", { get: () => true })
      const Original = Worker
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (!window.holdExport || !message.job) super.postMessage(message, ...rest)
        }
      }
    })
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const pending = page.waitForEvent("popup")
    await page.locator(".composition-output").getByRole("button", { name: "View PDF", exact: true }).click()
    const viewer = await pending
    await viewer.waitForURL(/^blob:/)
    assert.ok(viewer.url().startsWith("blob:"))
    assert.equal(await page.getByRole("dialog", { name: "View", exact: true }).isVisible(), false)
    assert.equal(await page.locator(".composition-output .composition-totals").innerText(), "8 pages, 4 sheets")
    await viewer.close()
    await page.evaluate(() => (window.holdExport = true))
    const cancelled = page.waitForEvent("popup")
    await page.locator(".composition-output").getByRole("button", { name: "View PDF", exact: true }).click()
    const waiting = await cancelled
    assert.equal(waiting.url(), "about:blank")
    const closed = waiting.waitForEvent("close")
    await page.locator(".header-feedback").getByRole("button", { name: "Cancel", exact: true }).click()
    await closed
    assert.match(await page.locator(".footnote").innerText(), /View cancelled/)
  } finally {
    await browser.close()
  }
})

test("Mobile Share preserves named PDFs and desktop Download", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    for (const entry of [
      {
        agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
        platform: "MacIntel",
        touch: true,
        api: true,
        label: "Share",
      },
      {
        agent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/158.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        touch: true,
        api: true,
        label: "Share",
      },
      { platform: "Linux x86_64", touch: false, api: true, label: "Download" },
      {
        agent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/158.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        touch: true,
        api: false,
        label: "Download",
      },
    ]) {
      const page = await browser.newPage({ reducedMotion: "reduce", userAgent: entry.agent, hasTouch: entry.touch })
      await page.addInitScript(({ platform, api }) => {
        localStorage.setItem("mainz:onboarding", "19")
        Object.defineProperty(navigator, "platform", { value: platform })
        Object.defineProperty(navigator, "canShare", { value: api ? () => true : undefined })
        Object.defineProperty(navigator, "share", {
          value: api
            ? async ({ files: [file] }) => {
                window.shared = {
                  name: file.name,
                  type: file.type,
                  magic: new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5)),
                }
              }
            : undefined,
        })
      }, entry)
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      const button = output.getByRole("button", { name: entry.label, exact: true })
      for (const [width, size, theme] of entry.touch
        ? [
            [320, 200, "light"],
            [390, 100, "dark"],
            [768, 100, "light"],
            [810, 100, "light"],
            [1440, 100, "light"],
          ]
        : [[1440, 100, "light"]]) {
        await page.setViewportSize({ width, height: 1080 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), size)
        await page.emulateMedia({ colorScheme: theme })
        const switcher = page.getByRole("button", { name: "Output", exact: true })
        if (await switcher.isVisible()) await switcher.click()
        const box = await button.boundingBox()
        assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width)
        const heading = await output.locator(".section-heading").boundingBox()
        assert.ok(
          box.x + box.width <= heading.x + heading.width + 1,
          JSON.stringify({ entry, width, size, box, heading }),
        )
        if (entry.label === "Share") {
          const center = await button.locator("path").evaluate((path) => {
            const bounds = path.getBBox()
            const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(
              path.getScreenCTM(),
            )
            return { x: point.x, y: point.y }
          })
          assert.ok(Math.abs(center.y - box.y - box.height / 2) < 1)
          if (await button.locator("span").isVisible()) {
            const glyph = await button.locator("svg").boundingBox()
            const label = await button.locator("span").boundingBox()
            assert.ok(Math.abs((glyph.x + label.x + label.width) / 2 - box.x - box.width / 2) < 1)
          } else assert.ok(Math.abs(center.x - box.x - box.width / 2) < 1)
          assert.equal(
            (await button.locator("svg").boundingBox()).width,
            (await output.locator(".print-action svg").boundingBox()).width,
          )
          if (width === 390 || width === 320) {
            await mkdir("../.local/tmp/web/layout/export", { recursive: true })
            await output
              .locator(".section-heading")
              .screenshot({ path: `../.local/tmp/web/layout/export/share-${entry.platform}-${width}-${theme}.png` })
          }
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
      if (entry.label === "Share") {
        await button.click()
        await page
          .locator(".footnote")
          .getByText(/Shared 8 pages/)
          .waitFor()
        const file = await page.evaluate(() => window.shared)
        assert.match(file.name, /^demo_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
        assert.equal(file.type, "application/pdf")
        assert.equal(file.magic, "%PDF-")
        await mkdir("../.local/tmp/web/layout/export", { recursive: true })
        await output
          .locator(".section-heading")
          .screenshot({ path: `../.local/tmp/web/layout/export/share-${entry.platform}.png` })
      } else {
        const pending = page.waitForEvent("download")
        await button.click()
        const download = await pending
        assert.match(download.suggestedFilename(), /^demo_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
        assert.equal((await readFile(await download.path())).subarray(0, 5).toString(), "%PDF-")
        assert.equal(
          await page.evaluate(async (url) => (await fetch(url)).headers.get("Content-Type"), download.url()),
          "application/pdf",
        )
        assert.equal(await page.evaluate(() => window.shared), undefined)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test(
  "Share retains the prepared file for a fresh gesture, cancellation, and Download",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch({ channel: "chromium" })
    try {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/158.0.8127.2 Mobile Safari/604.1",
        reducedMotion: "reduce",
      })
      await page.addInitScript(trackWorkers)
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        window.shareNames = []
        window.allowed = true
        Object.defineProperty(navigator, "canShare", { value: () => window.allowed })
        Object.defineProperty(navigator, "share", {
          value: async ({ files: [file] }) => {
            window.shareNames.push(file.name)
            if (window.shareNames.length === 1) throw new DOMException("A fresh gesture is required", "NotAllowedError")
            if (window.cancelShare) throw new DOMException("Cancelled", "AbortError")
            await new Promise((resolve) => (window.finishShare = resolve))
          },
        })
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      const button = output.getByRole("button", { name: "Share", exact: true })
      await page.getByRole("button", { name: "Output", exact: true }).click()
      const before = await page.evaluate(() => window.workers.length)
      await button.click()
      const ready = page.getByRole("dialog", { name: "Share", exact: true })
      await ready.getByText("PDF ready to share.", { exact: true }).waitFor()
      assert.equal(await ready.locator('.feedback[data-kind="notice"]').count(), 1)
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 1080 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        const buttons = await ready
          .locator("button")
          .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
        for (const box of buttons) {
          assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width)
          assert.ok(Math.abs(box.y + box.height / 2 - buttons[0].y - buttons[0].height / 2) < 1)
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        assert.ok((await ready.locator(".feedback-message").boundingBox()).width >= 60)
        if (width === 320) {
          await mkdir("../.local/tmp/web/layout/export", { recursive: true })
          await ready.screenshot({ path: "../.local/tmp/web/layout/export/share-ready-320.png" })
        }
      }
      const workers = await page.evaluate((start) => window.workers.slice(start), before)
      assert.ok(workers.some((worker) => worker.url.includes("processor.worker")))
      assert.ok(
        workers.filter((worker) => worker.url.includes("processor.worker")).every((worker) => worker.terminated),
      )
      const prepared = await page.evaluate(() => window.workers.length)
      await ready.getByRole("button", { name: "Share", exact: true }).click()
      await page.waitForFunction(() => window.finishShare)
      assert.equal(
        await page.evaluate(() => window.workers.length),
        prepared,
        "Sharing the ready PDF needs no new workers",
      )
      const names = await page.evaluate(() => window.shareNames)
      assert.equal(names[0], names[1])
      await page.evaluate(() => window.finishShare())
      await page
        .locator(".footnote")
        .getByText(/Shared 8 pages/)
        .waitFor()
      await page.evaluate(() => (window.cancelShare = true))
      await button.click()
      await page
        .locator(".footnote")
        .getByText(/Share cancelled/)
        .waitFor()
      assert.equal(await ready.isVisible(), false)
      assert.match(await output.locator(".composition-totals").textContent(), /8 pages,\s*4\s+sheets/)
      await page.evaluate(() => (window.allowed = false))
      await button.click()
      await ready.getByText("This PDF cannot be shared. Use Download.").waitFor()
      const pending = page.waitForEvent("download")
      await ready.getByRole("button", { name: "Download", exact: true }).click()
      const download = await pending
      assert.equal((await readFile(await download.path())).subarray(0, 5).toString(), "%PDF-")
      assert.equal(await ready.isVisible(), false)
    } finally {
      await browser.close()
    }
  },
)

test("Output actions stay reachable with enlarged text", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const output = page.locator(".composition-output")
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const size of [100, 200]) {
        await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
        const switcher = page.getByRole("button", { name: "Output", exact: true })
        const mobile = await switcher.isVisible()
        if (mobile) await switcher.click()
        const print = await output.getByRole("button", { name: "Print", exact: true }).boundingBox()
        const download = await output.getByRole("button", { name: "Download", exact: true }).boundingBox()
        const view = await output.getByRole("button", { name: "View PDF", exact: true }).boundingBox()
        assert.equal(print.width, view.width)
        assert.equal(print.height, view.height)
        assert.ok(print.x + print.width < view.x && view.x + view.width < download.x)
        const glyphs = await output
          .locator(".output-actions > button svg")
          .evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().width))
        assert.equal(glyphs[0], glyphs[1])
        assert.ok(glyphs[0] >= 28)
        if (mobile) {
          assert.equal(glyphs[0], glyphs[2])
          assert.equal(download.width, print.width)
          assert.equal(download.height, download.width)
          assert.equal(
            await output.getByRole("button", { name: "Download", exact: true }).locator("span").isVisible(),
            false,
          )
        }
        const ink = await output.locator(".output-actions > button path").evaluateAll((paths) =>
          paths.map((path) => {
            const box = path.getBBox()
            const matrix = path.getScreenCTM()
            return {
              left: new DOMPoint(box.x, box.y).matrixTransform(matrix).x,
              right: new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix).x,
            }
          }),
        )
        assert.ok(
          Math.abs(ink[1].left - ink[0].right - (download.x - ink[1].right)) < 1,
          "Visible Print–View and View–Download gaps match",
        )
        const documentIcon = page.locator(".input-heading .workspace-icon, .input-title .workspace-icon").first()
        if (await documentIcon.isVisible()) assert.equal((await documentIcon.boundingBox()).width, glyphs[0])
        assert.ok(print.width >= 44 && print.height >= 44 && download.width >= 44 && download.height >= 44)
        assert.ok(print.x >= 0 && print.x + print.width < download.x && download.x + download.width <= width)
        assert.ok(Math.abs(print.y + print.height / 2 - download.y - download.height / 2) < 1)
        const icon = await output.locator(".print-action path").evaluate((path) => {
          const box = path.getBBox()
          const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
            path.getScreenCTM(),
          )
          return { x: center.x, y: center.y }
        })
        assert.ok(Math.abs(icon.x - print.x - print.width / 2) < 1)
        assert.ok(Math.abs(icon.y - print.y - print.height / 2) < 1)
        const open = page.locator(".selection-panel .file-picker")
        if (await open.isVisible()) {
          const button = await open.boundingBox()
          assert.ok(Math.abs(button.width - download.width) < 1 && Math.abs(button.height - download.height) < 1)
          const headings = await page.evaluate(() =>
            [document.querySelector(".input-label"), document.querySelector(".output-name > span")].map((element) => {
              const style = getComputedStyle(element),
                box = element.getBoundingClientRect()
              return { font: style.font, center: box.y + box.height / 2 }
            }),
          )
          assert.equal(headings[0].font, headings[1].font)
          assert.ok(Math.abs(headings[0].center - headings[1].center) < 1)
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Set Output filename", exact: true }).click()
    await page.locator(".filename-panel").waitFor({ state: "visible" })
  } finally {
    await browser.close()
  }
})

test("Mobile Output keeps Print, View, and Download on one row", { timeout: 90000 }, async () => {
  const server = await serve()
  const cases = inventory.cases.filter((entry) => entry.pointer === "coarse")
  await mkdir("../.local/tmp/web/layout/export", { recursive: true })
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      for (const {
        id,
        viewport: [width, height],
      } of cases) {
        await page.setViewportSize({ width, height })
        for (const size of [100, 200]) {
          await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
          await page.emulateMedia({ colorScheme: size === 100 ? "dark" : "light" })
          const switcher = page.getByRole("button", { name: "Output", exact: true })
          if (!(await switcher.isVisible())) continue
          await switcher.click()
          const download = output.getByRole("button", { name: "Download", exact: true })
          const button = await download.boundingBox()
          const print = await output.getByRole("button", { name: "Print", exact: true }).boundingBox()
          const view = await output.getByRole("button", { name: "View PDF", exact: true }).boundingBox()
          const state = await output.locator(".output-state").boundingBox()
          const diagnostic = JSON.stringify({ engine: engine.name(), id, size, button, print, view, state })
          const totals = output.locator(".composition-totals")
          if (await totals.isVisible()) {
            const counts = await totals.boundingBox()
            assert.ok(Math.abs(counts.x + counts.width - state.x - state.width) < 1, diagnostic)
            const gap = print.x - counts.x - counts.width
            assert.ok(gap >= 12 && gap <= print.width, "Counts stay close to the icons with a readable gap")
          }
          assert.equal(print.width, view.width, diagnostic)
          assert.equal(print.height, view.height, diagnostic)
          assert.ok(print.x + print.width < view.x && view.x + view.width < button.x, diagnostic)
          assert.ok(print.width >= 44 && print.height >= 44 && state.width >= 44, diagnostic)
          assert.ok(state.x + state.width <= print.x && print.x + print.width < button.x, diagnostic)
          assert.ok(Math.abs(print.y + print.height / 2 - button.y - button.height / 2) < 1, diagnostic)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), diagnostic)
          if (width === 375 && height === 667)
            await output
              .locator(".section-heading")
              .screenshot({ path: `../.local/tmp/web/layout/export/mobile-${engine.name()}-SE-${size}.png` })
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test("Print receives the generated Output PDF and its selected filename", { timeout: 90000 }, async () => {
  const server = await serve()
  for (const touch of [false, true]) {
    const browser = await chromium.launch({ channel: "chromium" })
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
        hasTouch: touch,
      })
      await page.addInitScript((apple) => {
        if (location.protocol === "http:") localStorage.setItem("mainz:onboarding", "19")
        window.printRequests = []
        if (apple) {
          Object.defineProperty(navigator, "vendor", { get: () => "Apple Computer, Inc." })
          const open = window.open
          window.open = (...args) => {
            const viewer = open.apply(window, args)
            if (!viewer) return viewer
            return new Proxy(viewer, {
              get(target, key) {
                if (key === "print")
                  return () => {
                    if (window.blockPrint) throw new Error("Printing blocked")
                    window.printRequests.push({
                      href: target.location.href,
                      type: target.document.contentType,
                      title: target.document.title,
                    })
                  }
                const value = Reflect.get(target, key, target)
                return typeof value === "function" ? value.bind(target) : value
              },
            })
          }
        }
        window.addEventListener("message", (event) => {
          if (event.origin === location.origin && event.data?.kind === "print-test")
            window.printRequests.push(event.data)
        })
        // Substitute only the operating-system print dialog, retaining the real PDF viewer and generated bytes.
        window.print = () =>
          parent.postMessage(
            { kind: "print-test", href: location.href, type: document.contentType, title: document.title },
            location.origin,
          )
      }, touch)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Export.pdf", mimeType: "application/pdf", buffer: fixture({ grouped: true }) })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(input, "Style")
      await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
      await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#765432")
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
      const trigger = output.getByRole("button", { name: "Set Output filename", exact: true })
      await trigger.click()
      const editor = page.locator(".filename-panel"),
        field = editor.getByLabel("Filename", { exact: true })
      assert.equal(await editor.locator(".error").count(), 0)
      assert.ok((await field.boundingBox()).height >= 44)
      await field.fill("bad/name")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      assert.match(await editor.getByRole("alert").innerText(), /slashes/)
      await field.fill("Bad\u0085name")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      await field.fill("Practice")
      await editor.getByRole("button", { name: "Save", exact: true }).click()
      const action = output.getByRole("button", { name: "Print", exact: true })
      await action.focus()
      const before = await output.locator(".section-heading").boundingBox()
      await page.evaluate(() => {
        window.transitions = []
        window.watchPrint = true
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this page callback.
        const sample = () => {
          if (!window.watchPrint) return
          const composer = document.querySelector(".composer")
          window.transitions.push({
            scroll: [scrollX, scrollY],
            view: composer.dataset.view,
            tabs: [...composer.querySelectorAll("[role=tab][aria-selected=true]")].map((element) => element.id),
            panes: [...composer.querySelectorAll(".selection-panel, .composition-output")].map((element) =>
              element.getBoundingClientRect().toJSON(),
            ),
            panel: !!document.querySelector(".print-dialog[open]"),
          })
          requestAnimationFrame(sample)
        }
        sample()
      })
      await action.click()
      const print = page.getByRole("dialog", { name: "Print", exact: true })
      await page.waitForFunction(() => window.printRequests.length > 0)
      const request = await page.evaluate(() => window.printRequests[0])
      assert.equal(request.type, "application/pdf")
      assert.equal(request.title, "Practice.pdf")
      const url = request.href
      assert.equal(await print.isVisible(), false)
      assert.deepEqual(await output.locator(".section-heading").boundingBox(), before)
      assert.equal(await action.evaluate((button) => document.activeElement === button), true)
      const transitions = await page.evaluate(() => {
        window.watchPrint = false
        return window.transitions
      })
      for (const sample of transitions) assert.deepEqual(sample, transitions[0])

      const bytes = await page.evaluate(
        async (href) => [...new Uint8Array(await (await fetch(href)).arrayBuffer())],
        url,
      )
      assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-")
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await pending
      assert.equal(saved.suggestedFilename(), "Practice.pdf")
      assert.ok((await readFile(await saved.path())).equals(Buffer.from(bytes)), "Downloaded bytes match the print PDF")
      const description = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        try {
          return (await processor.run(new Uint8Array(buffer), 1)).description
        } finally {
          processor.dispose()
        }
      }, bytes)
      assert.equal(description.pageCount, 2, "Print gets composed Output, not the seven-page Input")
      assert.equal(description.parameters["s0:guides-stroke-color"].parameter.value, "#765432")
      await page.evaluate(() => (window.blockPrint = true))
      await page.addInitScript(() => {
        window.print = () => {
          throw new Error("Printing blocked")
        }
      })
      await action.click()
      await print.getByRole("link", { name: "Open PDF to print", exact: true }).waitFor()
      assert.equal(await print.locator(".print-name").innerText(), "Practice.pdf")
      await print.getByRole("button", { name: "Close Print", exact: true }).click()
      await trigger.click()
      assert.equal(await field.inputValue(), "Practice.pdf")
      await editor.getByRole("button", { name: "Use default", exact: true }).click()
      await trigger.click()
      assert.match(await field.inputValue(), /^Export_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
      await mkdir("../.local/var/printing", { recursive: true })
      await writeFile(
        `../.local/var/printing/chromium-${touch ? "touch" : "desktop"}.json`,
        JSON.stringify(
          {
            browser: browser.version(),
            platform: process.platform,
            pdf: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
            inputPages: 7,
            outputPages: description.pageCount,
            mode: "native-pdf-viewer",
            systemDialog: "substituted at window.print",
            result: "passed",
          },
          null,
          2,
        ),
      )
    } finally {
      await browser.close()
    }
  }
})

test(
  "Quartet editors float on desktop and keep their inline layout on narrow screens",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo&paint`)
        const input = page.locator(".selection-panel")
        await page.locator(".composer[aria-busy=false]").waitFor()
        await mkdir("../.local/tmp/web/layout/export", { recursive: true })
        for (const [width, theme, size, expected] of [
          [1440, "light", 100, true],
          [1920, "dark", 100, true],
          [1920, "dark", 200, true],
          [390, "dark", 100, false],
        ]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.emulateMedia({ colorScheme: theme })
          await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
          const trigger = input.getByRole("button", { name: "Edit Stroke", exact: true }).first()
          await trigger.scrollIntoViewIfNeeded()
          const before = await trigger.boundingBox()
          await trigger.click()
          const panel = input.locator(".quartet-dock:not([hidden])")
          await panel.waitFor()
          const floating = await panel.evaluate((element) => element.matches(":popover-open"))
          assert.equal(floating, expected)
          if (floating) {
            assert.deepEqual(await trigger.boundingBox(), before, "Opening an editor does not move its Quartet")
            const box = await panel.boundingBox()
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 1000)
          }
          await panel.screenshot({
            path: `../.local/tmp/web/layout/export/quartet-${engine.name()}-${width}-${theme}-${size}.png`,
          })
          await panel.getByRole("textbox").first().focus()
          await page.keyboard.press("Escape")
          assert.equal(await panel.count(), 0)
          assert.equal(await trigger.evaluate((button) => button === document.activeElement), true)
        }
      } finally {
        await browser.close()
      }
    }
  },
)
