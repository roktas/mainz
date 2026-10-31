// Checks named Output PDFs, native print handoff, and floating Style editors through the workspace.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { fixture, tab } from "./browser.js"

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
        if (await switcher.isVisible()) await switcher.click()
        const print = await output.getByRole("button", { name: "Print", exact: true }).boundingBox()
        const download = await output.getByRole("button", { name: "Download", exact: true }).boundingBox()
        const view = await output.getByRole("button", { name: "View PDF", exact: true }).boundingBox()
        assert.equal(print.width, view.width)
        assert.equal(print.height, view.height)
        assert.ok(print.x + print.width < view.x && view.x + view.width < download.x)
        const glyphs = await output
          .locator(".output-actions > .icon-button svg")
          .evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().width))
        assert.equal(glyphs[0], glyphs[1])
        assert.ok(glyphs[0] >= 28)
        const ink = await output.locator(".output-actions > .icon-button path").evaluateAll((paths) =>
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
