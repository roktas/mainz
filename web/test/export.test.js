// Checks named Output PDFs, native print handoff, and floating Style editors through the workspace.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir, writeFile } from "node:fs/promises"
import { createHash } from "node:crypto"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { fixture, tab } from "./browser.js"

const inventory = JSON.parse(await readFile(new URL("./viewports.json", import.meta.url), "utf8"))

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

test("Mobile Download retains the workspace button column beside Print", { timeout: 90000 }, async () => {
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
          const reference = await switcher.boundingBox()
          const download = output.getByRole("button", { name: "Download", exact: true })
          const button = await download.boundingBox()
          const print = await output.getByRole("button", { name: "Print", exact: true }).boundingBox()
          const state = await output.locator(".output-state").boundingBox()
          const diagnostic = JSON.stringify({ engine: engine.name(), id, size, reference, button, print, state })
          assert.ok(
            Math.abs(button.width - reference.width) < 1 && Math.abs(button.height - reference.height) < 1,
            diagnostic,
          )
          assert.ok(Math.abs(button.x - reference.x) < 1, diagnostic)
          assert.ok(print.width >= 44 && print.height >= 44 && state.width >= 44, diagnostic)
          assert.ok(state.x + state.width <= print.x && print.x + print.width < button.x, diagnostic)
          assert.ok(Math.abs(print.y + print.height / 2 - button.y - button.height / 2) < 1, diagnostic)
          if (size === 100) assert.equal(await download.locator("span").isVisible(), true, diagnostic)
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
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch(engine === chromium ? { channel: "chromium" } : {})
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => {
        if (location.protocol === "http:") localStorage.setItem("mainz:onboarding", "19")
        window.printRequests = []
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
      })
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
      if (engine === chromium)
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
      let url
      if (engine === chromium) {
        await page.waitForFunction(() => window.printRequests.length > 0)
        const request = await page.evaluate(() => window.printRequests[0])
        assert.equal(request.type, "application/pdf")
        assert.equal(request.title, "Practice.pdf")
        url = request.href
        assert.equal(await print.isVisible(), false)
        assert.deepEqual(await output.locator(".section-heading").boundingBox(), before)
        assert.equal(await action.evaluate((button) => document.activeElement === button), true)
        const transitions = await page.evaluate(() => {
          window.watchPrint = false
          return window.transitions
        })
        for (const sample of transitions) assert.deepEqual(sample, transitions[0])
      } else {
        await print.getByRole("link", { name: "Open PDF to print", exact: true }).waitFor()
        assert.equal(await print.locator(".print-name").innerText(), "Practice.pdf")
        url = await print.getByRole("link", { name: "Open PDF to print", exact: true }).getAttribute("href")
      }
      const bytes = await page.evaluate(
        async (href) => [...new Uint8Array(await (await fetch(href)).arrayBuffer())],
        url,
      )
      assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-")
      const pending = page.waitForEvent("download")
      if (engine === chromium) await output.getByRole("button", { name: "Download", exact: true }).click()
      else await print.getByRole("link", { name: "Download PDF", exact: true }).click()
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
      if (engine === chromium) {
        await page.addInitScript(() => {
          window.print = () => {
            throw new Error("Printing blocked")
          }
        })
        await action.click()
        await print.getByRole("link", { name: "Open PDF to print", exact: true }).waitFor()
        assert.equal(await print.locator(".print-name").innerText(), "Practice.pdf")
        await print.getByRole("button", { name: "Close Print", exact: true }).click()
      }
      await trigger.click()
      assert.equal(await field.inputValue(), "Practice.pdf")
      await editor.getByRole("button", { name: "Use default", exact: true }).click()
      await trigger.click()
      assert.match(await field.inputValue(), /^Export_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
      await mkdir("../.local/var/printing", { recursive: true })
      await writeFile(
        `../.local/var/printing/${engine.name()}.json`,
        JSON.stringify(
          {
            browser: browser.version(),
            platform: process.platform,
            pdf: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
            inputPages: 7,
            outputPages: description.pageCount,
            mode: engine === chromium ? "native-pdf-viewer" : "open-download-fallback",
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
