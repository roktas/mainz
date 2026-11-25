// Checks PDF Output viewing, native sharing, printing, Quartet styling, and filename drafts.

import {
  setup,
  selectPane,
  outputCount,
  fixture,
  tab,
  trackWorkers,
  outputAction,
  captureLayout,
  inputChooser,
} from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"

const inventory = JSON.parse(await readFile(new URL("./dim.json", import.meta.url), "utf8"))

test(
  "Output file details become XMP identity when the downloaded PDF opens as a later Input",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.getByText("Demo workspace ready.", { exact: true }).waitFor()
      await page.locator(".input-picker > summary").click()
      await page.locator(".composer").getByRole("button", { name: "Details for Input 1", exact: true }).click()
      assert.ok(await page.getByRole("region", { name: "Italic Strokes", exact: true }).isVisible())
      assert.deepEqual(await page.locator(".guidance:popover-open th").allTextContents(), [
        "Filename",
        "Title",
        "Producer",
      ])
      await page.getByRole("button", { name: "Close details", exact: true }).click()
      await page.locator(".input-picker > summary").click()
      await (await outputAction(page, "Set Output filename")).click()
      const editor = page.locator(".filename-panel")
      await editor.getByRole("textbox", { name: "Filename", exact: true }).fill("collected.pdf")
      const title = editor.getByRole("textbox", { name: "Title", exact: true })
      await title.fill("Bad\u0001title")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      await title.fill("Collected strokes & guides")
      const cover = editor.getByRole("spinbutton", { name: "Cover page", exact: true })
      await cover.fill("2")
      await cover.press("Tab")
      await editor.locator('img[alt="Cover · page 2"]').waitFor()
      await editor.getByRole("button", { name: "Save", exact: true }).click()
      const pending = page.waitForEvent("download")
      await page.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await pending
      assert.equal(saved.suggestedFilename(), "collected.pdf")
      const bytes = await readFile(await saved.path())
      await page
        .locator(".composer")
        .locator('input[type=file][aria-label="Open PDF"]')
        .setInputFiles({ name: "collected.pdf", mimeType: "application/pdf", buffer: bytes })
      await page.locator(".status-input").filter({ hasText: "collected.pdf" }).waitFor({ state: "attached" })
      await page.locator(".input-picker > summary").click()
      await page.locator(".composer").getByRole("button", { name: "Details for Input 2", exact: true }).click()
      const details = page.getByRole("region", { name: "Collected strokes & guides", exact: true })
      assert.match(await details.innerText(), /Cover page\s+2/)
    } finally {
      await browser.close()
    }
  },
)

test(
  "View prepares before opening the Output PDF and retains cancellation and popup recovery",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium, { channel: "chromium" })
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await setup(page)
      await page.addInitScript(() => {
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.holdExport && message.plan) {
              window.resumeExport = () => super.postMessage(message, ...rest)
              return
            }
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      await page.evaluate(() => (window.holdExport = true))
      const before = await output.boundingBox()
      await (await outputAction(page, "View PDF")).click()
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
      await (await outputAction(page, "View PDF")).click()
      await progress.getByRole("button", { name: "Cancel", exact: true }).click()
      assert.equal(page.context().pages().length, 1)
      assert.match(await page.locator(".footnote").innerText(), /View cancelled/)
      // Reject the browser popup only, then retry the already completed PDF with a fresh user gesture.
      await page.evaluate(() => {
        window.holdExport = false
        window.originalOpen = window.open
        window.open = () => null
      })
      await (await outputAction(page, "View PDF")).click()
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
  const browser = await launch(chromium, { channel: "chromium" })
  try {
    const page = await browser.newPage({
      viewport: { width: 810, height: 1080 },
      hasTouch: true,
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/158.0.8127.2 Mobile Safari/604.1",
    })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    await page.getByRole("button", { name: "Output", exact: true }).tap()
    const downloads = []
    page.on("download", (download) => downloads.push(download))
    const pending = page.waitForEvent("popup")
    await (await outputAction(page, "View PDF")).tap()
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

test(
  "Installed View and separate Print recover a completed PDF when the reserved viewer closes",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium, { channel: "chromium" })
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await setup(page)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "standalone", { get: () => true })
        Object.defineProperty(navigator, "vendor", { value: "Apple Computer, Inc." })
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.holdExport && message.plan) {
              window.resumeExport = () => super.postMessage(message, ...rest)
            } else super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const pending = page.waitForEvent("popup")
      await (await outputAction(page, "View PDF")).click()
      const viewer = await pending
      await viewer.waitForURL(/^blob:/)
      assert.ok(viewer.url().startsWith("blob:"))
      assert.equal(await page.getByRole("dialog", { name: "View", exact: true }).isVisible(), false)
      assert.equal(await page.locator(".composition-output .composition-totals").innerText(), "8 pages, 4 sheets")
      await viewer.close()
      await page.evaluate(() => (window.holdExport = true))
      const cancelled = page.waitForEvent("popup")
      await (await outputAction(page, "View PDF")).click()
      const waiting = await cancelled
      assert.equal(waiting.url(), "about:blank")
      const closed = waiting.waitForEvent("close")
      await page.locator(".header-feedback").getByRole("button", { name: "Cancel", exact: true }).click()
      await closed
      assert.match(await page.locator(".footnote").innerText(), /View cancelled/)
      for (const action of ["View", "Print"]) {
        await page.evaluate(() => (window.resumeExport = undefined))
        const reserved = page.waitForEvent("popup")
        await (await outputAction(page, `${action} PDF`)).click()
        const popup = await reserved
        assert.equal(popup.url(), "about:blank")
        await popup.close()
        await page.waitForFunction(() => !!window.resumeExport)
        await page.evaluate(() => {
          window.resumeExport()
          window.resumeExport = undefined
        })
        const recovery = page.getByRole("dialog", { name: action, exact: true })
        if (action === "View") {
          const retry = page.waitForEvent("popup")
          await recovery.getByRole("link", { name: "Retry", exact: true }).click()
          const ready = await retry
          await ready.waitForURL(/^blob:/)
          await ready.close()
        } else {
          await recovery.getByRole("link", { name: "Open PDF to print", exact: true }).waitFor()
          const download = page.waitForEvent("download")
          await recovery.getByRole("link", { name: "Download PDF", exact: true }).click()
          assert.match((await readFile(await (await download).path())).subarray(0, 8).toString(), /^%PDF-/)
        }
        assert.equal(await outputCount(page).textContent(), "8 pages")
      }
    } finally {
      await browser.close()
    }
  },
)

test("Mobile Share preserves named PDFs and desktop Download", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: "chromium" })
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
      await setup(page)
      await page.addInitScript(({ platform, api }) => {
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
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const button = page.locator(".composer").getByRole("button", { name: entry.label, exact: true })
      const heading = page.locator(
        ".composer[data-compact] > .workspace-bar, .composer:not([data-compact]) .composition-output > .section-heading",
      )
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
        await selectPane(switcher)
        const box = await button.boundingBox()
        assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width)
        const frame = await heading.boundingBox()
        assert.ok(box.x + box.width <= frame.x + frame.width + 1, JSON.stringify({ entry, width, size, box, frame }))
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
            await page
              .locator(".composer")
              .evaluate((el) =>
                el.hasAttribute("data-compact")
                  ? 24
                  : parseFloat(getComputedStyle(el).getPropertyValue("--document-icon-size")) *
                    parseFloat(getComputedStyle(document.documentElement).fontSize),
              ),
          )
          if (width === 390 || width === 320) {
            await mkdir("../.local/tmp/web/layout/export", { recursive: true })
            await heading.screenshot({
              path: `../.local/tmp/web/layout/export/share-${entry.platform}-${width}-${theme}.png`,
            })
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
        assert.match(file.name, /^dolor_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
        assert.equal(file.type, "application/pdf")
        assert.equal(file.magic, "%PDF-")
        await mkdir("../.local/tmp/web/layout/export", { recursive: true })
        await heading.screenshot({ path: `../.local/tmp/web/layout/export/share-${entry.platform}.png` })
      } else {
        const pending = page.waitForEvent("download")
        await button.click()
        const download = await pending
        assert.match(download.suggestedFilename(), /^dolor_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
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
    const browser = await launch(chromium, { channel: "chromium" })
    try {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/158.0.8127.2 Mobile Safari/604.1",
        reducedMotion: "reduce",
      })
      await setup(page)
      await page.addInitScript(trackWorkers)
      await page.addInitScript(() => {
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
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const button = page.locator(".composer").getByRole("button", { name: "Share", exact: true })
      await page.getByRole("button", { name: "Output", exact: true }).click()
      const before = await page.evaluate(() => window.workers.length)
      await button.click()
      const ready = page.getByRole("dialog", { name: "Share", exact: true })
      await ready.getByText("PDF ready to share", { exact: true }).waitFor()
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
      assert.match(await outputCount(page).locator("..").textContent(), /8 pages,\s*4\s+sheets/)
      await page.evaluate(() => (window.allowed = false))
      await button.click()
      await ready.getByText("This PDF cannot be shared. Use Download").waitFor()
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

test("Output controls retain desktop spacing and compact menu access", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const width of [320, 375, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1000 })
      for (const size of [100, 200]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), size)
        const print = await outputAction(page, "Print PDF")
        const view = page.locator(".composer").getByRole("button", { name: "View PDF", exact: true })
        const download = page.locator(".composer").getByRole("button", { name: "Download", exact: true })
        const a = await print.boundingBox(),
          b = await view.boundingBox(),
          c = await download.boundingBox()
        const compact = await page.locator(".composer").evaluate((el) => el.hasAttribute("data-compact"))
        let filenameHeight
        assert.equal(a.width, b.width)
        assert.equal(a.height, b.height)
        assert.ok(a.width >= 44 && a.height >= 44 && c.width >= 44 && c.height >= 44)
        if (compact) {
          assert.ok(b.y + b.height <= a.y, "View precedes Print in the document menu")
          assert.equal(c.width, c.height)
          assert.equal(await download.locator("span").isVisible(), false)
          const filename = page.getByRole("textbox", { name: "Output filename", exact: true })
          filenameHeight = (await filename.locator("..").boundingBox()).height
          await page.keyboard.press("Escape")
        } else {
          const disclosure = page.locator(".output-name > svg:last-child")
          assert.ok(await disclosure.isVisible(), "Output filename editing has a visible disclosure")
          assert.equal(await page.locator(".output-name").getAttribute("aria-haspopup"), "dialog")
          assert.ok(a.x + a.width < b.x && b.x + b.width < c.x)
          assert.ok(Math.abs(a.y + a.height / 2 - c.y - c.height / 2) < 1)
          const ink = await page
            .locator(".composition-output .output-actions > :is(.print-action, .view-action) path")
            .evaluateAll((paths) =>
              paths.map((path) => {
                const box = path.getBBox(),
                  matrix = path.getScreenCTM()
                return {
                  left: new DOMPoint(box.x, box.y).matrixTransform(matrix).x,
                  right: new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix).x,
                }
              }),
            )
          assert.ok(Math.abs(ink[1].left - ink[0].right - (c.x - ink[1].right)) < 1)
          const open = await page.locator(".input-heading > .file-picker").boundingBox()
          assert.ok(Math.abs(open.width - c.width) < 1 && Math.abs(open.height - c.height) < 1)
        }
        await (await outputAction(page, "Set Output filename")).click()
        const editor = page.locator(".filename-panel:popover-open")
        const buttons = await editor
          .locator(".filename-actions button")
          .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
        const bounds = await editor.boundingBox()
        const actionBounds = await editor.locator(".filename-actions").boundingBox()
        if (compact)
          assert.ok(
            Math.abs(filenameHeight - (await editor.locator(".entry").first().boundingBox()).height) < 1,
            `${width}, ${size}%: filename fields share one height`,
          )
        for (const box of buttons)
          assert.ok(box.width >= 104 && box.height >= 44 && box.x >= bounds.x && box.right <= bounds.x + bounds.width)
        const sameRow = Math.abs(buttons[0].y - buttons[1].y) < 1
        assert.ok(sameRow ? buttons[1].x - buttons[0].right >= 12 : buttons[1].y - buttons[0].bottom >= 12)
        assert.ok(
          Math.abs((buttons[0].x + buttons[1].right) / 2 - actionBounds.x - actionBounds.width / 2) < 1,
          `${width}, ${size}%: ${JSON.stringify({ bounds, buttons })}`,
        )
        if (width === 375 && size === 100)
          assert.ok(
            buttons.every((box) => box.width < bounds.width * 0.45),
            "Compact actions leave space at both sides",
          )
        await editor.getByRole("button", { name: "Close filename", exact: true }).click()
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
    }
  } finally {
    await browser.close()
  }
})

test("Mobile Output keeps Download direct and document actions in its menu", { timeout: 90000 }, async () => {
  const server = await serve()
  const cases = inventory.cases.filter((entry) => entry.pointer === "coarse")
  await mkdir("../.local/tmp/web/layout/export", { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      for (const {
        id,
        viewport: [width, height],
      } of cases) {
        await page.setViewportSize({ width, height })
        for (const size of [100, 200]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), size)
          await page.emulateMedia({ colorScheme: size === 100 ? "dark" : "light" })
          const switcher = page.getByRole("button", { name: "Output", exact: true })
          if (!(await switcher.isVisible())) continue
          if ((await switcher.getAttribute("aria-pressed")) === "false") await switcher.click()
          const label = `${engine.name()}, ${id}, ${size}%`
          await switcher.click()
          const actions = page.locator(".document-actions > :is(button, .output-filename)")
          const boxes = await actions.evaluateAll((elements) =>
            elements.map((el) => el.getBoundingClientRect().toJSON()),
          )
          assert.equal(boxes.length, 4)
          for (const [index, box] of boxes.entries()) {
            assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.right <= width + 1, label)
            assert.ok(Math.abs(box.width - boxes[0].width) < 1, label)
            if (index > 1) assert.ok(Math.abs(box.height - boxes[1].height) < 1, label)
            if (index) assert.ok(box.y >= boxes[index - 1].bottom, label)
          }
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label)
          await page.keyboard.press("Escape")
          if (width === 375 && height === 667)
            await page
              .locator(".workspace-bar")
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
    const browser = await launch(chromium, { channel: "chromium" })
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
      const trigger = page.locator(".composer").getByRole("button", { name: "Set Output filename", exact: true })
      await trigger.click()
      const editor = page.locator(".filename-panel"),
        field = editor.getByLabel("Filename", { exact: true })
      assert.ok(await editor.getByRole("button", { name: "Save", exact: true }).isEnabled())
      assert.ok((await field.boundingBox()).height >= 44)
      await field.fill("bad/name")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      const validation = page.locator(".header-feedback")
      assert.equal(await validation.getByRole("alert").innerText(), "Check the filename")
      await validation.getByRole("alert").getByRole("button").click()
      assert.match(await page.locator(".message-details:popover-open").innerText(), /slashes/)
      await page.keyboard.press("Escape")
      await field.fill("Bad\u0085name")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      await field.fill("Practice")
      await editor.getByRole("button", { name: "Save", exact: true }).click()
      const action = page.locator(".composer").getByRole("button", { name: "Print PDF", exact: true })
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
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
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
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=single&paint`)
        const input = page.locator(".selection-panel")
        await page.locator(".composer[aria-busy=false]").waitFor()
        await mkdir("../.local/tmp/web/layout/export", { recursive: true })
        for (const [width, theme, size, expected] of [
          [1440, "light", 100, true],
          [1920, "dark", 100, true],
          [1920, "dark", 200, true],
          [390, "dark", 100, false],
        ]) {
          await page.setViewportSize({ width, height: width === 375 ? 667 : width === 768 ? 1024 : 1000 })
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

test(
  "Downloading used Inputs retains warnings for unused style changes and invalid drafts",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      for (const value of ["#884488", "invalid"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        const open = async (name, buffer) => {
          await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
          await page.waitForFunction(
            (expected) => document.querySelector(".input-current")?.textContent === expected,
            name,
          )
        }
        await open("Unused.pdf", fixture())
        await input.getByLabel("Page selection", { exact: true }).fill("1")
        await input.getByLabel("Page selection", { exact: true }).press("Enter")
        await tab(input, "Style")
        await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill(value)
        await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        await open("Used.pdf", fixture({ prepared: false }))
        await input.getByLabel("Page selection", { exact: true }).fill("1")
        await input.getByLabel("Page selection", { exact: true }).press("Enter")
        const pending = page.waitForEvent("download")
        await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
        assert.equal(await (await pending).failure(), null)
        page.once("dialog", (dialog) => dialog.dismiss())
        const confirmation = page.waitForEvent("dialog")
        await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
        assert.equal((await confirmation).type(), "confirm")
        assert.equal(await input.locator(".input-current").textContent(), "Used.pdf")
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test(
  "iPhone Home Screen Print shares the generated PDF and retains recovery after cancellation",
  { timeout: 60000, skip: process.env.MAINZ_SKIP_WEBKIT === "1" },
  async () => {
    const server = await serve()
    const browser = await launch(webkit)
    try {
      const page = await browser.newPage({
        viewport: { width: 428, height: 926 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await setup(page)
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "userAgent", { value: "iPhone" })
        Object.defineProperty(navigator, "standalone", { value: true })
        Object.defineProperty(navigator, "vendor", { value: "Apple Computer, Inc." })
        navigator.canShare = ({ files }) => files.length === 1 && files[0].type === "application/pdf"
        navigator.share = async ({ files }) => {
          window.shared = { name: files[0].name, bytes: [...new Uint8Array(await files[0].arrayBuffer())] }
          if (window.shareFailure) throw new Error("Share unavailable")
          throw new DOMException("Cancelled", "AbortError")
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      const popups = []
      page.on("popup", (popup) => popups.push(popup))
      await (await outputAction(page, "Print PDF")).click()
      const dialog = page.getByRole("dialog", { name: "Print", exact: true })
      const share = dialog.getByRole("button", { name: "Share PDF to print", exact: true })
      await share.click()
      await page.waitForFunction(() => window.shared)
      await share.waitFor({ state: "visible" })
      const shared = await page.evaluate(() => window.shared)
      assert.match(shared.name, /\.pdf$/)
      assert.equal(Buffer.from(shared.bytes).subarray(0, 5).toString(), "%PDF-")
      assert.equal(popups.length, 0, "Print stays in the installed app until the system menu opens")
      assert.equal(await dialog.isVisible(), true, "Cancellation retains the prepared PDF")
      assert.equal(await page.locator('.header-feedback .feedback[data-kind="error"]').count(), 0)
      await page.evaluate(() => (window.shareFailure = true))
      await share.click()
      await page
        .getByText("Could not open the print menu. Open or download the PDF to print it", { exact: true })
        .waitFor()
      const pending = page.waitForEvent("download")
      await dialog.getByRole("link", { name: "Download PDF", exact: true }).click()
      const downloaded = await pending
      assert.ok((await readFile(await downloaded.path())).equals(Buffer.from(shared.bytes)))
      assert.equal(await outputCount(page).textContent(), "8 pages")
    } finally {
      await browser.close()
    }
  },
)

test(
  "Output source blocks follow additions, duplication, moves, and Blank ownership",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        for (const width of [320, 390, 768, 1440]) {
          const page = await browser.newPage({
            viewport: { width, height: 1100 },
            reducedMotion: "reduce",
            hasTouch: width === 390,
            colorScheme: width === 390 ? "dark" : "light",
          })
          page.setDefaultTimeout(10000)
          await setup(page)
          await page.goto(server.resolvedUrls.local[0])
          if (width === 768) await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
          const input = page.locator(".selection-panel")
          const output = page.locator(".composition-output")
          const switcher = page.getByRole("navigation", { name: "Workspace view", exact: true })
          const reveal = async (name) => {
            const control = switcher.getByRole("button", { name, exact: true })
            if (!(await control.isVisible()) || (await control.getAttribute("aria-pressed")) === "true") return
            try {
              await control.click()
            } catch (error) {
              try {
                const state = await control.evaluate((element) => ({
                  documentVisibility: document.visibilityState,
                  bounds: element.getBoundingClientRect().toJSON(),
                  display: getComputedStyle(element).display,
                  visibility: getComputedStyle(element).visibility,
                  inert: !!element.closest("[inert]"),
                  compact: !!element.closest(".composer[data-compact]"),
                  view: element.closest(".composer")?.getAttribute("data-view"),
                  focus: document.activeElement?.getAttribute("aria-label"),
                  scroll: [scrollX, scrollY],
                  popovers: [...document.querySelectorAll(":popover-open")].map((panel) => panel.className),
                }))
                const details = { engine: engine.name(), width, action: name, ...state }
                console.error("Workspace switch failed:", JSON.stringify(details))
                await captureLayout(page, `source-blocks/${engine.name()}-${width}`, details)
              } catch (capture) {
                console.error("Could not capture the failed workspace switch:", capture)
              }
              throw error
            }
          }
          const blocks = async (expected) => {
            await page.waitForFunction((titles) => {
              const actual = [...document.querySelectorAll(".composition-output :is(.list-disclosure, .grid-ribbon)")]
                .map(
                  (button) =>
                    button.getAttribute("aria-label").match(/^(?:Fold|Unfold) Output section: (Book [AB])$/)?.[1],
                )
                .filter(Boolean)
              return JSON.stringify(actual) === JSON.stringify(titles)
            }, expected)
          }
          for (const [name, selection] of [
            ["Book A", "3,5"],
            ["Book B", "2,9"],
          ]) {
            await page
              .locator('input[type=file][aria-label="Open PDF"]')
              .first()
              .setInputFiles({
                name: `${name}.pdf`,
                mimeType: "application/pdf",
                buffer: fixture({
                  prepared: false,
                  count: 10,
                  outline: [
                    { title: "Contents", page: 0 },
                    { title: "Early", page: 0, parent: 0 },
                    { title: "Late", page: 5, parent: 0 },
                  ],
                }),
              })
            await page.locator(".composer[aria-busy=false]").waitFor()
            await reveal("Input")
            await page
              .locator(".status-input")
              .filter({ hasText: `${name}.pdf` })
              .waitFor({ state: "attached" })
            await input.getByLabel("Page selection", { exact: true }).fill(selection)
            await input.getByRole("button", { name: "Add to Output", exact: true }).click()
          }
          await reveal("Output")
          await tab(output, "List")
          const unfold = output.getByRole("button", { name: "Unfold all Output sections", exact: true })
          if (await unfold.isVisible()) await unfold.click()
          await blocks(["Book A", "Book B"])
          const late = output.locator('.list-section:has(.list-heading[data-page="3"])')
          assert.deepEqual(await late.locator(".list-ancestor").allTextContents(), ["Contents"])
          await late.getByRole("button", { name: "Details for Output page 4", exact: true }).click()
          assert.deepEqual(
            await page
              .locator(".card-menu-options:popover-open .section-path .path-step > span:last-child")
              .allTextContents(),
            ["Book B", "Contents", "Late"],
          )
          await page.keyboard.press("Escape")
          const selection = output.getByLabel("Page selection", { exact: true })
          await selection.fill("1-2")
          await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).press("Enter")
          await blocks(["Book A", "Book B"])
          assert.equal(await outputCount(page).textContent(), "6 pages")
          await selection.fill("5")
          await output.getByLabel("Output page actions", { exact: true }).click()
          await output.getByRole("button", { name: "Before", exact: true }).click()
          await blocks(["Book A", "Book B"])
          await selection.fill("3-4")
          const move = async (direction) => {
            const control = output.getByRole("button", { name: `Move selected pages ${direction}`, exact: true })
            if (!(await control.isVisible())) await output.getByLabel("Output page actions", { exact: true }).click()
            await control.click()
          }
          for (let step = 0; step < 2; step++) await move("later")
          await blocks(["Book A", "Book B", "Book A", "Book B"])
          for (let step = 0; step < 2; step++) await move("earlier")
          await blocks(["Book A", "Book B"])
          await selection.fill("")
          await tab(output, "Grid")
          await blocks(["Book A", "Book B"])
          await output.getByRole("button", { name: "Fold Output section: Book A", exact: true }).click()
          assert.equal(await output.locator(".composition-card").count(), 3, "The A block includes its Blank")
          await tab(output, "List")
          await output.getByRole("button", { name: "Unfold Output section: Book A", exact: true }).click()
          await reveal("Input")
          await inputChooser(page).click()
          await page.locator(".input-choice-select").filter({ hasText: "Book A.pdf" }).click()
          await input.getByLabel("Page selection", { exact: true }).fill("9")
          await input.getByRole("button", { name: "Add to Output", exact: true }).click()
          await reveal("Output")
          await blocks(["Book A", "Book B", "Book A"])
          await selection.fill("")
          await mkdir("../.local/tmp/web/layout/source-blocks", { recursive: true })
          await page.screenshot({ path: `../.local/tmp/web/layout/source-blocks/${engine.name()}-${width}.png` })
          if (engine === chromium && width === 1440) {
            const pending = page.waitForEvent("download")
            await (await outputAction(page, "Download")).click()
            const download = await pending
            const saved = await page.evaluate(
              async (bytes) => {
                const { openPDF } = await import("/src/pdf.ts")
                const task = await openPDF(new Uint8Array(bytes))
                try {
                  const pdf = await task.promise
                  const roots = await pdf.getOutline()
                  return await Promise.all(
                    roots.map(async (entry) => [entry.title, (await pdf.getPageIndex(entry.dest[0])) + 1]),
                  )
                } finally {
                  await task.destroy()
                }
              },
              [...(await readFile(await download.path()))],
            )
            assert.deepEqual(saved, [
              ["Book A", 1],
              ["Book B", 6],
              ["Book A", 8],
            ])
          }
          await selection.fill("6-7")
          await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
          await blocks([])
          assert.equal(await outputCount(page).textContent(), "6 pages")
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test("Compact and full Output filename entries reject the same raw drafts", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator('.composer[aria-busy="false"]').waitFor()
    await (await outputAction(page, "Set Output filename")).click()
    const editor = page.locator(".filename-panel:popover-open")
    await editor.getByRole("textbox", { name: "Filename", exact: true }).fill("\tchanged.pdf")
    assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
    await editor.getByRole("textbox", { name: "Filename", exact: true }).fill(" practice ")
    await editor.getByRole("button", { name: "Save", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 1000 })
    await outputAction(page, "View PDF")
    const compact = page.getByRole("textbox", { name: "Output filename", exact: true })
    assert.equal(await compact.inputValue(), "practice.pdf")
    await compact.fill("\tchanged.pdf")
    await compact.press("Tab")
    assert.equal(await compact.inputValue(), "practice.pdf")
    await compact.fill(" next.PDF ")
    await compact.press("Tab")
    assert.equal(await compact.inputValue(), "next.PDF")
  } finally {
    await browser.close()
  }
})
