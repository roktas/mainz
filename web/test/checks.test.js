// Exercises shared Recipe cases through loading, explicit review, and reference alignment.

import { outputCount } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir } from "node:fs/promises"
import { chromium } from "playwright"
import { serve } from "./server.ts"

test(
  "Recipe overwrite preserves the file on cancellation and commits only confirmed references",
  { timeout: 45000 },
  async () => {
    const server = await serve()
    const base = server.resolvedUrls.local[0]
    const original = await (await fetch(`${base}checks/review.json`)).text()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        window.overwriteMode = "cancel"
        // Replace the OS picker and I/O timing; keep real browser file writes and commits.
        window.showSaveFilePicker = async (options) => {
          window.overwriteOptions = options
          window.overwriteActivated = navigator.userActivation.isActive
          const mode = window.overwriteMode
          if (mode === "cancel") throw new DOMException("Picker cancelled.", "AbortError")
          if (mode === "denied") throw new DOMException("File access was denied.", "NotAllowedError")
          const root = await navigator.storage.getDirectory()
          const handle = await root.getFileHandle(options.suggestedName)
          return {
            createWritable: async () => {
              const stream = await handle.createWritable()
              return {
                write: async (blob) => {
                  await stream.write(blob)
                  if (mode === "hold") await new Promise((resolve) => (window.releaseWrite = resolve))
                },
                close: async () => {
                  await new Promise((resolve) => (window.releaseCommit = resolve))
                  await stream.close()
                },
                abort: async () => {
                  await stream.abort()
                  window.overwriteAborted = true
                },
              }
            },
          }
        }
      })
      await page.goto(`${base}?demo=recipe-review`)
      await page.evaluate(async (text) => {
        const root = await navigator.storage.getDirectory()
        const handle = await root.getFileHandle("review.json", { create: true })
        const stream = await handle.createWritable()
        await stream.write(text)
        await stream.close()
      }, original)
      const contents = () =>
        page.evaluate(async () => {
          const root = await navigator.storage.getDirectory()
          return (await (await root.getFileHandle("review.json")).getFile()).text()
        })
      await page.getByRole("button", { name: "Review PDF", exact: true }).click()
      await page.getByRole("button", { name: "Use anyway", exact: true }).click()
      await page.getByRole("button", { name: "Apply recipe", exact: true }).click()
      const offer = page.locator(".header-feedback").getByRole("button", { name: "References updated", exact: true })
      const panel = page.locator(".message-details:popover-open")
      const overwrite = panel.getByRole("button", { name: "Overwrite", exact: true })
      let downloads = 0
      page.on("download", () => downloads++)
      await offer.click()
      await panel.getByRole("textbox", { name: "Filename", exact: true }).fill("My copy.json")
      await overwrite.click()
      await offer.waitFor()
      assert.equal(await contents(), original, "Cancelling the native picker leaves the Recipe unchanged")
      await offer.click()
      assert.equal(await panel.getByRole("textbox", { name: "Filename", exact: true }).inputValue(), "My copy.json")
      await page.evaluate(() => (window.overwriteMode = "denied"))
      await overwrite.click()
      const feedback = page.locator(".header-feedback")
      await feedback.getByRole("alert").getByRole("button", { name: "Recipe export failed", exact: true }).click()
      assert.match(await panel.innerText(), /File access was denied/)
      assert.equal(await contents(), original)
      await page.evaluate(() => (window.overwriteMode = "hold"))
      await overwrite.click()
      await page.waitForFunction(() => !!window.releaseWrite)
      const selection = page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("999")
      await feedback.getByRole("button", { name: "Cancel", exact: true }).click()
      await page.evaluate(() => window.releaseWrite())
      await page.waitForFunction(() => window.overwriteAborted)
      await selection.fill("1")
      await offer.waitFor()
      assert.equal(await contents(), original, "Cancelling a staged write does not commit it")
      await offer.click()
      await panel.getByRole("textbox", { name: "Filename", exact: true }).fill("bad/name.json")
      assert.ok(await panel.getByRole("button", { name: "Save", exact: true }).isDisabled())
      assert.ok(await overwrite.isEnabled(), "Overwrite does not depend on the copy filename")
      await page.evaluate(() => (window.overwriteMode = "commit"))
      await overwrite.click()
      await page.waitForFunction(() => !!window.releaseCommit)
      assert.ok(await feedback.getByRole("button", { name: "Cancel", exact: true }).isDisabled())
      await page.evaluate(() => window.releaseCommit())
      await feedback.getByRole("status").filter({ hasText: "Recipe overwritten" }).waitFor()
      const saved = JSON.parse(await contents())
      const previous = JSON.parse(original)
      assert.deepEqual(saved.parts, previous.parts)
      assert.deepEqual(saved.sources, previous.sources)
      assert.deepEqual(saved.metadata, previous.metadata)
      assert.notEqual(saved.inputs.book.sha256, previous.inputs.book.sha256)
      assert.equal(await page.evaluate(() => window.overwriteOptions.suggestedName), "review.json")
      assert.equal(await page.evaluate(() => window.overwriteActivated), true)
      assert.equal(downloads, 0, "Overwrite writes the chosen file without downloading another copy")
    } finally {
      await browser.close()
    }
  },
)

test("Recipe Apply errors use the header without moving matched PDF rows", { timeout: 60000 }, async () => {
  const server = await serve()
  const base = server.resolvedUrls.local[0]
  const recipe = await (await fetch(`${base}checks/count.json`)).json()
  recipe.metadata = { title: "Recipe checks", coverPage: 3 }
  const pdf = Buffer.from(await (await fetch(`${base}checks/count.pdf`)).arrayBuffer())
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })
      await page.goto(base)
      await page.locator(".landing-recipe input").setInputFiles({
        name: "cover-review.json",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(recipe)),
      })
      await page
        .locator('.binding-row input[type="file"]')
        .setInputFiles({ name: "book.pdf", mimeType: "application/pdf", buffer: pdf })
      await page.locator(".header-feedback").getByRole("button", { name: "Review PDF", exact: true }).click()
      await page.locator(".binding-check:popover-open").getByRole("button", { name: "Use anyway", exact: true }).click()
      const row = page.locator(".binding-row")
      const apply = page.getByRole("button", { name: "Apply recipe", exact: true })
      const before = [await row.boundingBox(), await apply.boundingBox()]
      await apply.click()
      const feedback = page.locator(".header-feedback")
      await feedback.getByRole("alert").waitFor()
      assert.equal(await feedback.getByRole("alert").textContent(), "Could not load recipe")
      await feedback.getByRole("alert").getByRole("button").click()
      assert.match(
        await page.locator(".message-details:popover-open").innerText(),
        /Cover page must identify a physical Output page/,
      )
      const dismiss = await feedback.getByRole("button", { name: "Dismiss error", exact: true }).boundingBox()
      const cancel = await page
        .locator(".load-actions")
        .getByRole("button", { name: "Cancel", exact: true })
        .boundingBox()
      const popup = await page.locator(".message-details:popover-open").boundingBox()
      assert.ok(Math.abs(dismiss.width - cancel.width) < 1 && Math.abs(dismiss.height - cancel.height) < 1)
      assert.ok(Math.abs(dismiss.x + dismiss.width / 2 - popup.x - popup.width / 2) < 1)
      await page.keyboard.press("Escape")
      assert.deepEqual([await row.boundingBox(), await apply.boundingBox()], before)
      assert.ok(await apply.isEnabled(), "A failed Apply retains its Inputs and retry action")
    } finally {
      await browser.close()
    }
  }
})

test("Recipe Input checks share policy and preserve explicit alignment intent", { timeout: 180000 }, async () => {
  const server = await serve()
  const base = server.resolvedUrls.local[0]
  const response = await fetch(`${base}checks/cases.json`)
  assert.ok(response.ok, "Generate shared examples with bundle exec rake fixtures:recipe")
  const cases = await response.json()
  const screenshots = new URL("../../.local/tmp/web/layout/recipe/", import.meta.url)
  await mkdir(screenshots, { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      for (const entry of cases) {
        await page.goto(`${base}?demo=recipe-${entry.id}`)
        const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
        const row = panel.locator(".binding-row")
        await page.waitForFunction(
          (state) => document.querySelector(".binding-row")?.dataset.state === state,
          entry.state,
        )
        const apply = panel.getByRole("button", { name: "Apply recipe", exact: true })
        assert.equal(await apply.isDisabled(), entry.state === "error" || entry.state === "review", entry.id)
        const details = row.getByRole("button", { name: "Input result for Recipe checks", exact: true })
        const dialog = page.locator(".binding-check:popover-open")
        for (const [width, text, colorScheme] of [
          [1100, "100%", "light"],
          [768, "200%", "dark"],
          [390, "100%", "light"],
          [320, "200%", "dark"],
        ]) {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
          await page.emulateMedia({ colorScheme })
          const bounds = await panel.evaluate((element) => ({
            width: element.clientWidth,
            content: element.scrollWidth,
          }))
          assert.ok(
            bounds.content <= bounds.width + 1,
            `${entry.id}, ${engine.name()}, ${width}px: ${JSON.stringify(bounds)}`,
          )
          const geometry = () =>
            row.evaluate((element) =>
              [element, element.querySelector(".binding-cover"), element.querySelector(".binding-target")].map(
                (item) => {
                  const box = item.getBoundingClientRect()
                  return { x: box.x + scrollX, y: box.y + scrollY, width: box.width, height: box.height }
                },
              ),
            )
          const alignment = await row.evaluate((element) => {
            const file = element.querySelector(".binding-file").getBoundingClientRect()
            const label = element.querySelector(".binding-status > span").getBoundingClientRect()
            return {
              left: Math.abs(file.x - label.x),
              height: label.height,
            }
          })
          assert.ok(alignment.left < 1 && alignment.height > 0, `${entry.id}: aligned filename and result`)
          const before = await geometry()
          await page.screenshot({
            path: new URL(`${entry.id}-${engine.name()}-${width}.png`, screenshots).pathname,
            fullPage: true,
          })
          await details.click()
          await dialog.waitFor()
          assert.deepEqual(await geometry(), before, "Opening explanations does not move the row, cover, or PDF box")
          assert.equal(
            await dialog.getByRole("button", { name: "Use anyway", exact: true }).count(),
            entry.state === "review" ? 1 : 0,
          )
          assert.equal(await dialog.locator("ul").count(), ["review", "count"].includes(entry.id) ? 1 : 0)
          const popup = await dialog.evaluate((element) => ({
            width: element.clientWidth,
            content: element.scrollWidth,
          }))
          assert.ok(popup.content <= popup.width + 1)
          await page.screenshot({
            path: new URL(`${entry.id}-${engine.name()}-${width}-details.png`, screenshots).pathname,
            fullPage: true,
          })
          await page.keyboard.press("Escape")
          await dialog.waitFor({ state: "hidden" })
          assert.deepEqual(await geometry(), before)
          assert.ok(await details.evaluate((element) => element === document.activeElement))
        }
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        if (entry.state === "error") continue
        if (entry.state === "review") {
          await details.click()
          const accept = dialog.getByRole("button", { name: "Use anyway", exact: true })
          await accept.focus()
          await page.keyboard.press("Enter")
          assert.ok(await apply.isEnabled())
          const pdf = await (await fetch(`${base}checks/${entry.pdf}`)).arrayBuffer()
          await row
            .locator('input[type="file"]')
            .setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) })
          await page.waitForFunction(() => document.querySelector(".binding-file")?.textContent === "replacement.pdf")
          await details.click()
          assert.ok(await apply.isDisabled(), "Replacing a PDF clears acceptance")
          await accept.click()
        }
        await apply.click()
        await panel.waitFor({ state: "hidden" })
        await page.locator(".composer").waitFor()
        const alignment = page
          .locator(".header-feedback")
          .getByRole("button", { name: "References updated", exact: true })
        if (entry.state === "ready") {
          assert.equal(await alignment.count(), 0)
          continue
        }
        await alignment.click()
        const pending = page.waitForEvent("download")
        await page.locator(".message-details:popover-open").getByRole("button", { name: "Save", exact: true }).click()
        const file = await pending
        const bytes = await readFile(await file.path())
        const aligned = JSON.parse(bytes)
        const original = await (await fetch(`${base}checks/${entry.id}.json`)).json()
        assert.deepEqual(aligned.parts, original.parts)
        assert.deepEqual(aligned.sources, original.sources)
        assert.deepEqual(aligned.metadata, original.metadata)
        assert.equal(aligned.inputs.book.pageCount, entry.id === "count" ? 2 : 3)
        assert.notEqual(aligned.inputs.book.sha256, original.inputs.book.sha256)
        await page.goto(base)
        await page
          .locator(".landing-recipe input")
          .setInputFiles({ name: file.suggestedFilename(), mimeType: "application/json", buffer: bytes })
        await panel
          .locator('input[type="file"]')
          .last()
          .setInputFiles({
            name: "book.pdf",
            mimeType: "application/pdf",
            buffer: Buffer.from(await (await fetch(`${base}checks/${entry.pdf}`)).arrayBuffer()),
          })
        await page.waitForFunction(() => document.querySelector(".binding-row")?.dataset.state === "ready")
        assert.equal(await apply.isDisabled(), false)
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Updated Recipe edits its filename in header feedback and preserves the saved plan",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const base = server.resolvedUrls.local[0]
    const screenshots = new URL("../../.local/tmp/web/layout/recipe/", import.meta.url)
    await mkdir(screenshots, { recursive: true })
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.goto(`${base}?demo=recipe-review`)
        const review = page.locator(".header-feedback").getByRole("button", { name: "Review PDF", exact: true })
        await review.waitFor()
        await page.clock.install()
        await page.clock.runFor(11000)
        assert.ok(await review.isVisible(), "Required review does not expire before a decision")
        await review.hover()
        assert.equal(await review.evaluate((button) => getComputedStyle(button).backgroundColor), "rgba(0, 0, 0, 0)")
        assert.equal(await review.evaluate((button) => getComputedStyle(button).boxShadow), "none")
        await review.click()
        const inspection = page.locator(".binding-check:popover-open")
        await inspection.waitFor()
        for (const [width, size] of [
          [390, "100%"],
          [320, "200%"],
        ]) {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), size)
          const controls = await page
            .locator(".load-choices > :is(button, label), .binding-accept")
            .evaluateAll((buttons) =>
              buttons.map((button) => {
                const label = [...button.childNodes].find(
                  (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
                )
                const text = document.createRange()
                text.selectNode(label)
                return {
                  label: button.textContent.trim(),
                  lines: text.getClientRects().length,
                  fits: button.scrollWidth <= button.clientWidth + 1,
                }
              }),
            )
          assert.ok(
            controls.length === 3 && controls.every((button) => button.lines === 1 && button.fits),
            JSON.stringify({ width, controls }),
          )
        }
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        assert.ok(await page.locator(".binding-result .binding-file").filter({ hasText: "book.pdf" }).isVisible())
        const approval = await inspection.evaluate((element) => {
          const panel = element.getBoundingClientRect()
          const action = element.querySelector(".binding-accept")
          const button = action.getBoundingClientRect()
          const previous = action.previousElementSibling.getBoundingClientRect()
          return {
            center: Math.abs(panel.x + panel.width / 2 - button.x - button.width / 2),
            gap: button.y - previous.bottom,
          }
        })
        assert.ok(approval.center < 1 && approval.gap >= 12, JSON.stringify(approval))
        await inspection.getByRole("button", { name: "Use anyway", exact: true }).click()
        await page.getByRole("button", { name: "Apply recipe", exact: true }).click()
        await page.locator(".composer").waitFor()
        const action = page.locator(".header-feedback").getByRole("button", { name: "References updated", exact: true })
        await action.waitFor()
        const output = page.locator(".composition-output")
        await output.getByRole("tab", { name: "Page", exact: true }).click()
        await output.locator(".page-scroll").focus()
        await output.locator(".page-scroll").press("Space")
        assert.equal(
          await outputCount(page).textContent(),
          "4 pages",
          "A passive header message does not block workspace shortcuts",
        )
        const composer = await page.locator(".composer").boundingBox()
        let downloads = 0
        page.on("download", () => downloads++)
        for (const [width, size, colorScheme] of [
          [1100, "100%", "dark"],
          [390, "100%", "light"],
          [320, "200%", "dark"],
        ]) {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), size)
          await page.emulateMedia({ colorScheme })
          await action.click()
          const menu = page.locator(".message-details:popover-open")
          const controls = await menu.evaluate((element) => {
            const panel = element.getBoundingClientRect()
            const description = element.querySelector("p").getBoundingClientRect()
            const fields = element.querySelector("form").getBoundingClientRect()
            const lineHeight = parseFloat(getComputedStyle(element.querySelector("p")).lineHeight)
            const group = element.querySelector(".feedback-actions").getBoundingClientRect()
            const close = element.querySelector(":scope > button svg").getBoundingClientRect()
            return [...element.querySelectorAll("form > :is(button, .entry)")].map((button) => {
              const box = button.getBoundingClientRect()
              const text = document.createRange()
              text.selectNodeContents(button)
              const input = button.querySelector("input")
              return {
                label: input ? input.getAttribute("aria-label") : button.textContent.trim(),
                width: box.width,
                height: box.height,
                lines: input ? undefined : text.getClientRects().length,
                fits: button.scrollWidth <= button.clientWidth + 1 && box.x >= panel.x && box.right <= panel.right,
                color: getComputedStyle(button).backgroundColor,
                border: getComputedStyle(button).borderTopWidth,
                center: Math.abs(group.x + group.width / 2 - panel.x - panel.width / 2),
                x: box.x,
                y: box.y,
                explanationGap: fields.y - description.bottom,
                explanationHeight: description.height,
                lineHeight,
                closeOffset: Math.abs(close.y + close.height / 2 - description.y - lineHeight / 2),
              }
            })
          })
          assert.deepEqual(
            controls.map((button) => button.label),
            ["Filename", "Save", "Dismiss", "Overwrite"],
          )
          assert.ok(
            controls.every(
              (button) =>
                (button.lines === undefined || button.lines === 1) &&
                button.fits &&
                button.center < 1 &&
                button.closeOffset < 1,
            ),
            JSON.stringify(controls),
          )
          assert.ok(
            controls.every(
              (control) =>
                Math.abs(control.width - controls[0].width) < 1 && Math.abs(control.height - controls[0].height) < 1,
            ),
            JSON.stringify(controls),
          )
          assert.notEqual(
            controls[0].color,
            controls[2].color,
            "The filename field has a different surface from buttons",
          )
          assert.equal(controls[0].border, "0px", "The filename uses an underline rather than a button outline")
          assert.notEqual(controls[3].color, controls[1].color, "Overwrite and Save have different action colors")
          if (width === 320) {
            assert.ok(
              controls.every(
                (control, index) =>
                  Math.abs(control.x - controls[0].x) < 1 && (!index || control.y > controls[index - 1].y),
              ),
              JSON.stringify(controls),
            )
          } else {
            assert.ok(
              Math.abs(controls[0].x - controls[2].x) < 1 && Math.abs(controls[1].x - controls[3].x) < 1,
              JSON.stringify(controls),
            )
            assert.ok(
              Math.abs(controls[0].y - controls[1].y) < 1 &&
                Math.abs(controls[2].y - controls[3].y) < 1 &&
                controls[2].y > controls[0].y,
              JSON.stringify(controls),
            )
            assert.ok(controls[1].x - controls[0].x - controls[0].width >= 18, JSON.stringify(controls))
          }
          if (width === 1100)
            assert.ok(
              controls[0].explanationGap >= 12 &&
                controls[0].explanationGap <= 16 &&
                controls[0].explanationHeight <= 2 * controls[0].lineHeight + 1,
              JSON.stringify(controls),
            )
          await page.screenshot({
            path: new URL(`menu-${engine.name()}-${width}.png`, screenshots).pathname,
            fullPage: true,
          })
          await page.keyboard.press("Escape")
        }
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await action.click()
        const panel = page.locator(".message-details:popover-open")
        const name = panel.getByRole("textbox", { name: "Filename", exact: true })
        assert.match(await name.inputValue(), /^review_\d{4}-\d{4}-\d{4}-\d{4}\.json$/)
        assert.equal(downloads, 0, "Opening filename editing does not download a Recipe")
        await name.fill("Keep this draft.json")
        await page.keyboard.press("Escape")
        await panel.waitFor({ state: "hidden" })
        assert.equal(downloads, 0)
        await action.click()
        assert.equal(await name.inputValue(), "Keep this draft.json")
        for (const [width, text, colorScheme] of [
          [1100, "100%", "dark"],
          [768, "200%", "light"],
          [390, "100%", "light"],
          [320, "200%", "dark"],
        ]) {
          await page.setViewportSize({ width, height: 900 })
          await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
          await page.emulateMedia({ colorScheme })
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          const buttons = await panel.locator("form > button").evaluateAll((elements) =>
            elements.map((button) => {
              const range = document.createRange()
              range.selectNodeContents(button)
              return {
                lines: range.getClientRects().length,
                fits: button.scrollWidth <= button.clientWidth + 1,
                width: button.getBoundingClientRect().width,
              }
            }),
          )
          assert.ok(
            buttons.every((button) => button.lines === 1 && button.fits),
            JSON.stringify({ width, buttons }),
          )
          assert.ok(buttons.every((button) => Math.abs(button.width - buttons[0].width) < 1))
          await name.fill("bad/name.json")
          const feedback = page.locator('.header-feedback .feedback[data-kind="error"]')
          await feedback.getByRole("alert").waitFor()
          assert.equal(await feedback.getByRole("alert").innerText(), "Check the filename")
          assert.match(await panel.innerText(), /slashes/)
          assert.equal(await name.getAttribute("aria-invalid"), "true")
          assert.ok(
            await name.evaluate((element) => element === document.activeElement),
            "Validation keeps the filename editor focused",
          )
          const geometry = await feedback.evaluate((element) => {
            const box = element.getBoundingClientRect()
            const header = document.querySelector(".header-inner").getBoundingClientRect()
            const host = element.closest(".header-feedback")
            const hostBox = host.getBoundingClientRect()
            const message = element.querySelector(".feedback-message").getBoundingClientRect()
            return {
              center: Math.abs(box.x + box.width / 2 - header.x - header.width / 2),
              message: Math.abs(box.y + box.height / 2 - message.y - message.height / 2),
              top: box.y,
              bottom: box.bottom,
              headerBottom: header.bottom,
              overflow: document.documentElement.scrollWidth > innerWidth,
              hostTop: hostBox.top,
              hostBottom: hostBox.bottom,
              headerTop: header.top,
              background: getComputedStyle(host).backgroundColor,
              ownsField: element.contains(document.querySelector(".message-details:popover-open input")),
            }
          })
          assert.ok(
            geometry.center < 1 && geometry.message < 1 && !geometry.overflow,
            JSON.stringify({ engine: engine.name(), width, text, ...geometry }),
          )
          assert.ok(geometry.top >= 0 && geometry.bottom <= geometry.headerBottom + 1, JSON.stringify(geometry))
          assert.ok(geometry.ownsField, "The filename editor stays within the active header message")
          assert.ok(
            geometry.hostTop >= geometry.headerTop && geometry.hostBottom <= geometry.headerBottom - 0.5,
            JSON.stringify(geometry),
          )
          assert.equal(
            geometry.background,
            "rgba(0, 0, 0, 0)",
            "The feedback background does not cover the header separator",
          )
          assert.ok(await panel.getByRole("button", { name: "Save", exact: true }).isDisabled())
          await page.screenshot({
            path: new URL(`updated-${engine.name()}-${width}.png`, screenshots).pathname,
            fullPage: true,
          })
          await name.fill("References")
        }
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await name.fill("   ")
        assert.ok(await panel.getByRole("button", { name: "Save", exact: true }).isDisabled())
        await name.fill("References")
        const pending = page.waitForEvent("download")
        await name.press("Enter")
        const file = await pending
        assert.equal(file.suggestedFilename(), "References.json")
        const aligned = JSON.parse(await readFile(await file.path()))
        const original = await (await fetch(`${base}checks/review.json`)).json()
        assert.deepEqual(aligned.parts, original.parts)
        assert.deepEqual(aligned.sources, original.sources)
        assert.deepEqual(aligned.metadata, original.metadata)
        await panel.waitFor({ state: "hidden" })
        await page
          .locator(".header-feedback")
          .getByRole("status")
          .filter({ hasText: "Updated recipe exported" })
          .waitFor()
        const after = await page.locator(".composer").boundingBox()
        assert.ok(Math.abs(composer.y - after.y) < 1, "Header feedback does not move the workspace")
        assert.equal(downloads, 1)
        assert.deepEqual(errors, [])
      } finally {
        await browser.close()
      }
    }
  },
)

test("Shared browser processes isolate scenario storage and close only their own contexts", async () => {
  const first = await launch(chromium),
    second = await launch(chromium)
  const a = await first.newContext(),
    b = await second.newContext()
  try {
    assert.equal(a.browser(), b.browser())
    await a.addCookies([{ name: "scenario", value: "first", url: "http://localhost" }])
    assert.deepEqual(await b.cookies(), [])
    await first.close()
    const page = await b.newPage()
    await page.setContent("<p>Second scenario remains usable</p>")
    assert.equal(await page.locator("p").innerText(), "Second scenario remains usable")
  } finally {
    await first.close()
    await second.close()
  }
})
