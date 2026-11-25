// Checks workspace downloads, style validation reuse, cover fill, and TOC preservation.

import { setup, outputCount, tab, fixture, checkStatus } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"

test(
  "Download explains the referenced Input limit before preparation and recovers after removal",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const button = page.locator(".composer").getByRole("button", { name: "Download", exact: true })
      const pdf = fixture({ prepared: false })
      for (let index = 0; index < 33; index++) {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name: "Independent.pdf", mimeType: "application/pdf", buffer: pdf })
        await page.locator(".composer[aria-busy=false]").waitFor()
        await page.locator(".header-feedback .opening-progress").waitFor({ state: "hidden" })
        if (index === 32) {
          assert.equal(await button.isEnabled(), true, "Unused open Inputs do not count")
          assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
        }
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await page.waitForFunction(
          (count) =>
            document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
              ?.textContent === `${count} ${count === 1 ? "page" : "pages"}`,
          index + 1,
        )
      }
      assert.equal(await button.isDisabled(), true)
      assert.match(await page.locator(".header-feedback .message-details").textContent(), /32 Inputs.*Remove pages/)
      assert.equal(await page.locator(".export-dialog[open]").count(), 0)
      await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("33")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await button.isEnabled(), true)
      assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Download blocks only invalid styles used by Output, including after Input switching",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Styled.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const download = page.locator(".composer").getByRole("button", { name: "Download", exact: true })
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      await tab(input, "Style")
      const color = input.getByRole("textbox", { name: "Guide Color", exact: true })
      await color.fill("invalid")
      assert.equal(await download.isDisabled(), true)
      assert.match(await download.getAttribute("title"), /Styled\.pdf: fix Guide color before Download/)
      await page
        .locator(".composer")
        .locator('input[type=file][aria-label="Open PDF"]')
        .setInputFiles({
          name: "Ordinary.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
      await page.locator(".status-input").filter({ hasText: "Ordinary.pdf" }).waitFor({ state: "attached" })
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await download.isDisabled(), true, "An inactive Input's relevant draft still blocks Download")
      const selection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("1")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await download.isEnabled(), true, "Unused invalid styles do not block Download")
      const pending = page.waitForEvent("download")
      await download.click()
      assert.equal(await (await pending).failure(), null)
      await page.locator(".input-picker > summary h2").click()
      await input.locator(".input-list button[data-source]").first().click()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      assert.equal(await download.isDisabled(), true, "Adding an affected page restores the draft error")
      await tab(input, "Style")
      await color.fill("#123456")
      await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
      assert.equal(await download.isEnabled(), true)
      assert.deepEqual(errors, [], "Clearing an active report cannot leave child effects reading a removed report")
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Whole-Input downloads preserve navigation and metadata while subsets prune the TOC",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        const xmp =
          '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:mainz="https://github.com/roktas/mainz/ns/1.0/"><dc:title><rdf:Alt><rdf:li xml:lang="x-default">Original book</rdf:li></rdf:Alt></dc:title><dc:creator><rdf:Seq><rdf:li>Original author</rdf:li></rdf:Seq></dc:creator><dc:rights>Original rights</dc:rights><mainz:coverPage>3</mainz:coverPage></rdf:Description></rdf:RDF></x:xmpmeta>'
        const original = fixture({
          count: 4,
          profileCount: 2,
          xmp,
          outline: [
            { title: "Book", page: 1 },
            { title: "Detail", page: 2, parent: 0 },
          ],
          labels: ["i", "ii", "1", "2"],
          metadata: [{ name: "Cover" }, { name: "Opening" }, { name: "Exercise" }, {}],
        })
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name: "Original.pdf", mimeType: "application/pdf", buffer: original })
        await page.locator(".composer[aria-busy=false]").waitFor()
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await output.getByRole("button", { name: "Set Output filename", exact: true }).click()
        const emptyEditor = page.getByRole("dialog", { name: "Output filename", exact: true })
        assert.equal(await emptyEditor.locator(".file-cover").count(), 0)
        await emptyEditor.getByRole("textbox", { name: "Filename", exact: true }).fill("Early name.pdf")
        await emptyEditor.getByRole("button", { name: "Save", exact: true }).click()
        assert.equal(
          await page.locator(".filename-panel:popover-open").count(),
          0,
          "Filename saves while Output is empty",
        )
        await input.getByLabel("Page selection", { exact: true }).fill("1-4")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        const download = async () => {
          const pending = page.waitForEvent("download")
          await output.getByRole("button", { name: "Download", exact: true }).click()
          return [...(await readFile(await (await pending).path()))]
        }
        await output.getByRole("button", { name: "Set Output filename", exact: true }).click()
        const editor = page.locator(".filename-panel:popover-open")
        await editor.getByRole("textbox", { name: "Filename", exact: true }).fill("Styled copy.pdf")
        await editor.getByRole("button", { name: "Save", exact: true }).click()
        assert.deepEqual(await download(), [...original], "A filename-only change retains the original PDF bytes")
        await tab(input, "Style")
        await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
        await output.getByRole("button", { name: "Download", exact: true }).waitFor()
        const styled = await download()
        const inspect = async (buffer) =>
          page.evaluate(async (bytes) => {
            const { openPDF } = await import("/src/pdf.ts")
            const { Processor } = await import("/src/processor.ts")
            const task = await openPDF(Uint8Array.from(bytes)),
              processor = new Processor()
            try {
              const pdf = await task.promise
              const summarize = async (items) =>
                Promise.all(
                  (items ?? []).map(async (item) => ({
                    title: item.title,
                    page: (await pdf.getPageIndex(item.dest[0])) + 1,
                    children: await summarize(item.items),
                  })),
                )
              const result = await processor.run(Uint8Array.from(bytes), 1)
              return {
                outline: await summarize(await pdf.getOutline()),
                labels: await pdf.getPageLabels(),
                metadata: (await pdf.getMetadata()).metadata?.getRaw(),
                names: result.description.pages.map((entry) => entry.name),
                width: Object.values(result.description.parameters).find(
                  (entry) => entry.parameter.schema.title === "Guide width",
                ).parameter.value,
              }
            } finally {
              processor.dispose()
              await task.destroy()
            }
          }, buffer)
        const saved = await inspect(styled)
        assert.deepEqual(saved.outline, [
          { title: "Book", page: 2, children: [{ title: "Detail", page: 3, children: [] }] },
        ])
        assert.deepEqual(saved.labels, ["i", "ii", "1", "2"])
        assert.deepEqual(saved.names, ["Cover", "Opening", "Exercise", undefined])
        assert.equal(saved.metadata, xmp)
        assert.equal(saved.width, 0.04)
        await output.getByLabel("Page selection", { exact: true }).fill("1,4")
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        const subset = await inspect(await download())
        assert.deepEqual(subset.outline, [
          { title: "Book", page: 1, children: [{ title: "Detail", page: 2, children: [] }] },
        ])
        assert.deepEqual(subset.names, ["Opening", "Exercise"])
        await page.close()
      } finally {
        await browser.close()
      }
    }
  },
)

test("Download reuses completed full-document styles and invalidates changed Output", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.addInitScript(() => {
      window.processingRequests = 0
      const post = Worker.prototype.postMessage
      Worker.prototype.postMessage = function (message, ...rest) {
        if (message.plan || message.changes) window.processingRequests++
        return post.call(this, message, ...rest)
      }
    })
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Ready.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ count: 3, profileCount: 2 }),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1-3")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    const ready = () => output.locator('button[aria-label="Download"]:enabled').waitFor()
    await ready()
    await tab(input, "Style")
    const profile = input.getByRole("combobox", { name: "Style profile", exact: true })
    const saved = []
    const download = async () => {
      const pending = page.waitForEvent("download")
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
      saved.push([...(await readFile(await (await pending).path()))])
    }
    for (const value of ["inkjet", "generic"]) {
      await profile.selectOption(value)
      await ready()
      const requests = await page.evaluate(() => window.processingRequests)
      await download()
      assert.equal(await page.evaluate(() => window.processingRequests), requests, "Ready PDF needs no second plan")
    }
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    await ready()
    const before = await page.evaluate(() => window.processingRequests)
    await download()
    assert.equal(await page.evaluate(() => window.processingRequests), before + 1, "Changed page order is composed")
    const descriptions = await page.evaluate(async (files) => {
      const { Processor } = await import("/src/processor.ts")
      const processor = new Processor()
      try {
        const results = []
        for (const [index, bytes] of files.entries()) {
          const result = await processor.run(Uint8Array.from(bytes), index)
          results.push({
            count: result.description.pageCount,
            width: Object.values(result.description.parameters).find(
              (entry) => entry.parameter.schema.title === "Guide width",
            ).parameter.value,
          })
        }
        return results
      } finally {
        processor.dispose()
      }
    }, saved)
    assert.deepEqual(descriptions, [
      { count: 3, width: 0.04 },
      { count: 3, width: undefined },
      { count: 6, width: undefined },
    ])
  } finally {
    await browser?.close()
  }
})

test("Cancelling a paused batch inspection releases the next Source", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    const input = page.locator(".selection-panel")
    for (const name of ["First", "Second"]) {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: `${name}.pdf`,
          mimeType: "application/pdf",
          buffer: fixture({ count: 3, profileCount: 2, family: "queue" }),
        })
      await input
        .locator(".input-current")
        .filter({ hasText: `${name}.pdf` })
        .waitFor()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
    }
    await tab(input, "Style")
    await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts")
      const task = await openPDF(new Uint8Array(await (await fetch("/dolor.pdf")).arrayBuffer()))
      const pdf = await task.promise
      const prototype = Object.getPrototypeOf(await pdf.getPage(1))
      const render = prototype.render
      window.holdBatchInspection = true
      prototype.render = function (...args) {
        const drawing = render.apply(this, args)
        drawing.onContinue = (proceed) => {
          if (window.holdBatchInspection) window.batchInspectionPaused = true
          else proceed()
        }
        return drawing
      }
      await task.destroy()
    })
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    await page.waitForFunction(() => window.batchInspectionPaused)
    await page.evaluate(() => (window.holdBatchInspection = false))
    await page.getByRole("button", { name: "Cancel style processing", exact: true }).click()
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    await page.locator(".header-feedback").getByRole("alert").getByRole("button").click()
    await page.getByRole("button", { name: "Retry Input styles", exact: true }).click()
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    assert.equal(
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).isEnabled(),
      true,
    )
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
  } finally {
    await browser.close()
  }
})

test(
  "Info reports actions, errors stay in the header, and newer feedback survives style processing",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Status.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ profileCount: 2 }),
        })
      const status = page.locator(".footnote [role=status]")
      await page.locator(".input-current").filter({ hasText: "Status.pdf" }).waitFor({ timeout: 60000 })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await status.textContent(), "Added 2 pages to Output.")
      await input.getByRole("tab", { name: "Style", exact: true }).click()
      const profile = input.getByRole("combobox", { name: "Style profile", exact: true })
      await profile.selectOption("inkjet")
      await status.filter({ hasText: "Applied Inkjet profile." }).waitFor()
      const width = input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true })
      assert.equal(await width.inputValue(), "0.04")
      await width.fill("0")
      const validation = page.locator(".header-feedback .feedback[data-kind=error]")
      assert.equal(await validation.getByRole("alert").textContent(), "Check Guide Width")
      await validation.getByRole("alert").getByRole("button").click()
      assert.match(await page.locator(".message-details:popover-open").innerText(), /Width must be greater than zero/)
      await page.keyboard.press("Escape")
      assert.equal(await status.count(), 0)
      assert.notEqual(
        await validation.evaluate((element) => getComputedStyle(element).color),
        await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
      )
      await input.getByRole("button", { name: "Reset Guide Width", exact: true }).click()
      await status.filter({ hasText: "Restored Guide width to the original style." }).waitFor()
      assert.equal(
        await status.evaluate((element) => getComputedStyle(element).color),
        await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
      )
      assert.equal(Number(await width.inputValue()), 0.2 * (25.4 / 72)) // The authored 0.2 pt width in mm.
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await output.getByRole("button", { name: "Select Output page 2", exact: true }).click()
      await output.getByLabel("Output page actions", { exact: true }).click()
      // Both actions occur before the debounced style processing starts.
      await page.evaluate(() => {
        const select = document.querySelector(".style-profile select")
        select.value = "inkjet"
        select.dispatchEvent(new Event("change", { bubbles: true }))
        document.querySelector('button[aria-label="Move selected pages earlier"]').click()
      })
      await output.locator('button[aria-label="Download"]:enabled').waitFor()
      assert.equal(await width.inputValue(), "0.04")
      assert.equal(await status.textContent(), "Moved 1 page earlier.")
      await page.evaluate(() => {
        const select = document.querySelector(".style-profile select")
        select.value = "generic"
        select.dispatchEvent(new Event("change", { bubbles: true }))
      })
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).click()
      assert.equal(await status.textContent(), "Cancelled style processing. Your choices are retained.")
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await checkStatus(page)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await page.locator(".header-feedback").getByRole("alert").getByRole("button").click()
      await page.getByRole("button", { name: "Retry Input styles", exact: true }).click()
      await status.filter({ hasText: "Updated styles." }).waitFor()
      const pending = page.waitForEvent("download")
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
      const saved = await pending
      assert.equal(await saved.failure(), null)
      assert.equal(await status.textContent(), `Downloaded 2 pages · ${saved.suggestedFilename()}.`)
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Broken.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("invalid PDF"),
        })
      await page
        .locator(".header-feedback .feedback[data-kind=error]")
        .filter({ hasText: "Could not open Broken.pdf." })
        .waitFor()
      assert.equal(await status.count(), 0)
      assert.match(
        await page.locator(".header-feedback .feedback[data-kind=error]").textContent(),
        /PDF Composer cannot read this PDF/,
      )
      assert.equal(await outputCount(page).textContent(), "2 pages")
      assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 1)
      // Preserve PDF byte offsets to isolate an unknown manifest field.
      const unknown = Buffer.from(fixture().toString().replace('"groups":', '"extra": '))
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Unknown.pdf",
        mimeType: "application/pdf",
        buffer: unknown,
      })
      await page
        .locator(".header-feedback .feedback[data-kind=error]")
        .filter({ hasText: "Could not open Unknown.pdf." })
        .waitFor()
      assert.equal(await status.count(), 0)
      const banner = page.locator(".header-feedback .feedback[data-kind=error]")
      assert.match(await banner.textContent(), /style information.*invalid or incompatible/)
      assert.match(await banner.textContent(), /Your workspace is retained\. Choose a PDF to retry\./)
      assert.match(await banner.textContent(), /prepare it again with the current Mainz format/)
      assert.equal(await outputCount(page).textContent(), "2 pages")
      for (const [viewportWidth, text, colorScheme] of [
        [1440, "100%", "light"],
        [320, "200%", "dark"],
        [390, "200%", "light"],
      ]) {
        await page.setViewportSize({ width: viewportWidth, height: 1000 })
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await page.evaluate((value) => {
          document.documentElement.style.fontSize = value
          scrollTo(0, 0)
        }, text)
        assert.notEqual(
          await banner.evaluate((element) => getComputedStyle(element).color),
          await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
        )
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        const bounds = await page.locator(".header-feedback").boundingBox(),
          workspace = await page.locator(".composer").boundingBox()
        assert.ok(bounds.y + bounds.height <= workspace.y, JSON.stringify({ bounds, workspace }))
        await checkStatus(page)
      }
      await page.locator(".header-feedback").getByRole("alert").getByRole("button").click()
      await page.getByRole("button", { name: "Dismiss error", exact: true }).focus()
      await page.keyboard.press("Enter")
      assert.equal(await banner.count(), 0)
    } finally {
      await browser?.close()
    }
  },
)

test("Demo Cover is first and its fill survives Download and reopening", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.getByText("Demo workspace ready.", { exact: true }).waitFor()
    const input = page.locator(".selection-panel")
    await tab(input, "Style")
    assert.deepEqual(
      await input.locator(".style-group > summary > span:not(.count) > span:first-child").allTextContents(),
      ["Cover", "Patterns", "Guides", "Margins", "Watermark"],
    )
    const cover = page.getByRole("textbox", { name: "Cover", exact: true })
    assert.equal(await cover.inputValue(), "#A0892C")
    await page.evaluate(() => (document.documentElement.style.fontFamily = '"DejaVu Sans", sans-serif'))
    for (const width of [320, 375, 390, 768, 810, 1024, 1194, 1280, 1440, 1920]) {
      await page.setViewportSize({ width, height: 1100 })
      for (const theme of ["light", "dark"])
        for (const text of ["100%", "200%"]) {
          await page.evaluate(
            ({ theme: palette, text: scale }) => {
              document.documentElement.dataset.theme = palette
              document.documentElement.style.fontSize = scale
            },
            { theme, text },
          )
          assert.equal(
            await cover.evaluate((element) => {
              const style = getComputedStyle(element)
              const canvas = document.createElement("canvas").getContext("2d")
              canvas.font = style.font
              const available = element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight)
              return canvas.measureText(element.value).width <= available
            }),
            true,
            `${width}px, ${theme}, ${text}: the complete Cover color stays visible`,
          )
          const label = await input
            .locator(".control")
            .filter({ has: cover })
            .locator(".control-label label")
            .boundingBox()
          const pattern = await input
            .getByRole("group", { name: "Pattern", exact: true })
            .locator("h4 > span")
            .first()
            .boundingBox()
          assert.ok(
            Math.abs(label.x - pattern.x) < 1,
            `${width}px, ${theme}, ${text}: individual and Quartet titles align`,
          )
          const coverControl = input.locator(".control").filter({ has: cover })
          const coverGroup = input.locator(".style-group").filter({ has: cover })
          const patternObject = input.getByRole("group", { name: "Pattern", exact: true })
          const widgets = await Promise.all([
            coverControl.boundingBox(),
            patternObject.locator(".quartet-bar").boundingBox(),
          ])
          const group = await coverGroup.boundingBox()
          for (const widget of widgets) {
            assert.ok(Math.abs(widget.x - label.x) < 1, "Titles and widget blocks share one inline start")
            assert.ok(
              Math.abs(widget.x + widget.width - group.x - group.width) < 1,
              "Widget right edges stay at the group edge",
            )
          }
          const heading = await coverGroup.locator(":scope > summary").boundingBox()
          const presentation = await coverGroup.locator(":scope > summary").evaluate((summary) => {
            const title = getComputedStyle(summary.querySelector("span > span:first-child"))
            return {
              transform: title.textTransform,
              spacing: parseFloat(title.letterSpacing),
            }
          })
          assert.equal(presentation.transform, "uppercase", "Group names are distinct from object titles")
          assert.ok(
            presentation.spacing > 0 && heading.height >= 44,
            "Group headings retain their tracking and tap target",
          )
          const groupTitle = await coverGroup
            .locator(":scope > summary > span:not(.count) > span:first-child")
            .boundingBox()
          const arrow = await coverGroup.locator(":scope > summary > svg").boundingBox()
          assert.ok(Math.abs(label.x - groupTitle.x) < 1, "Group and object titles align without indentation")
          assert.ok(arrow.x > groupTitle.x + groupTitle.width, "The disclosure arrow follows the group title")
          assert.ok(
            Math.abs(arrow.y + arrow.height / 2 - groupTitle.y - groupTitle.height / 2) < 1,
            `${width}px, ${theme}, ${text}: the disclosure arrow stays centered on the group title`,
          )
          assert.ok(
            label.y - heading.y - heading.height <= 24,
            "The first individual control has a compact heading gap",
          )
          const summaries = await input.locator(".quartet-text > span:last-child").evaluateAll((values) =>
            values.map((value) => {
              const range = document.createRange()
              range.selectNodeContents(value)
              const bounds = value.getBoundingClientRect()
              const component = value.closest(".quartet-component").getBoundingClientRect()
              return {
                value: value.textContent,
                lines: range.getClientRects().length,
                fits: bounds.left >= component.left && bounds.right <= component.right,
              }
            }),
          )
          assert.ok(
            summaries.every((item) => item.lines === 1 && item.fits),
            JSON.stringify({ width, theme, text, summaries }),
          )
          if (width === 1920 && text === "100%") {
            const wrapped = await input.locator(".control-description").evaluateAll((descriptions) =>
              descriptions
                .filter((description) => description.checkVisibility())
                .filter((description) => {
                  const range = document.createRange()
                  range.selectNodeContents(description.querySelector("span") ?? description)
                  return range.getClientRects().length > 1
                })
                .map((description) => description.textContent),
            )
            assert.deepEqual(wrapped, [], "Visible descriptions fit one line on Full HD")
          }
        }
    }
    const section = input.locator(".style-group").first()
    const summary = section.locator(":scope > summary")
    const title = summary.locator("span:not(.count) > span:first-child")
    await page.setViewportSize({ width: 320, height: 1100 })
    await title.evaluate((element) => (element.textContent = "Cover".repeat(12)))
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      "Long group names wrap within the narrow pane",
    )
    await title.evaluate((element) => (element.textContent = "Cover"))
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    const opened = await title.boundingBox()
    const openColor = await title.evaluate((element) => getComputedStyle(element).color)
    await summary.hover()
    assert.notEqual(await title.evaluate((element) => getComputedStyle(element).color), openColor)
    assert.deepEqual(await title.boundingBox(), opened, "Hover does not move the group title")
    await page.mouse.move(0, 0)
    await summary.focus()
    await summary.press("Enter")
    assert.equal(await section.evaluate((element) => element.open), false)
    assert.notEqual(await title.evaluate((element) => getComputedStyle(element).color), openColor)
    assert.deepEqual(await title.boundingBox(), opened, "Disclosure state does not move its title")
    await summary.press("Enter")
    assert.equal(await title.evaluate((element) => getComputedStyle(element).color), openColor)
    const focused = await summary.evaluate((element) => getComputedStyle(element).outlineColor)
    await summary.click()
    assert.equal(await summary.evaluate((element) => getComputedStyle(element).outlineColor), "rgba(0, 0, 0, 0)")
    await summary.press("Enter")
    assert.equal(await summary.evaluate((element) => getComputedStyle(element).outlineColor), focused)
    await cover.fill("#21478E")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    const downloaded = page.waitForEvent("download")
    await page.getByRole("button", { name: "Download", exact: true }).click()
    const buffer = await readFile(await (await downloaded).path())
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Cover.pdf", mimeType: "application/pdf", buffer })
    await page.locator(".status-input").filter({ hasText: "Cover.pdf" }).waitFor({ state: "attached" })
    await tab(input, "List")
    await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
    await tab(input, "Style")
    assert.equal(await input.getByRole("textbox", { name: "Cover", exact: true }).inputValue(), "#21478E")
  } finally {
    await browser.close()
  }
})

test("Opening, editing, and Download preserve arranged pages and accepted styles", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Journey.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ metadata: [{ name: "Cover" }, {}, { name: "Chapter" }] }),
      })
    const input = page.locator(".selection-panel")
    await input.getByLabel("Page selection", { exact: true }).fill("3,1,3")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    await tab(input, "Style")
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
    const pending = page.waitForEvent("download")
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const download = await pending,
      bytes = await readFile(await download.path())
    const inspected = await page.evaluate(async (bytes) => {
      const { Processor } = await import("/src/processor.ts")
      const worker = new Processor()
      try {
        return (await worker.run(Uint8Array.from(bytes), 1)).description
      } finally {
        worker.dispose()
      }
    }, Array.from(bytes))
    assert.equal(inspected.pageCount, 3)
    assert.equal(
      inspected.parameters[
        Object.keys(inspected.parameters).find(
          (id) => inspected.parameters[id].parameter.binding.property === "stroke-color",
        )
      ].parameter.value,
      "#884488",
    )
    assert.deepEqual(
      inspected.pages.map((page) => page.name),
      ["Chapter", "Cover", "Chapter"],
    )
    assert.equal(await outputCount(page).textContent(), "3 pages")
    const warnings = []
    page.on("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
    await page.locator(".drop-zone").waitFor()
    assert.deepEqual(warnings, [], "Downloaded choices return Home without an unsaved warning")
  } finally {
    await browser.close()
  }
})
