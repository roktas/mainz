// Exercises shared Recipe cases through loading, explicit review, and reference alignment.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir } from "node:fs/promises"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"

test("Recipe Input checks share policy and preserve explicit alignment intent", { timeout: 180000 }, async () => {
  const server = await serve()
  const base = server.resolvedUrls.local[0]
  const response = await fetch(`${base}checks/cases.json`)
  assert.ok(response.ok, "Generate shared examples with bundle exec rake fixtures:recipe")
  const cases = await response.json()
  const screenshots = new URL("../../.local/tmp/web/layout/recipe/", import.meta.url)
  await mkdir(screenshots, { recursive: true })
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
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
            const icon = element.querySelector(".binding-status > svg").getBoundingClientRect()
            return {
              left: Math.abs(file.x - label.x),
              center: Math.abs(label.y + label.height / 2 - icon.y - icon.height / 2),
            }
          })
          assert.ok(alignment.left < 1 && alignment.center < 1, `${entry.id}: aligned result and icon`)
          const before = await geometry()
          await page.screenshot({
            path: new URL(`${entry.id}-${engine.name()}-${width}.png`, screenshots).pathname,
            fullPage: true,
          })
          await details.click()
          await dialog.waitFor()
          assert.deepEqual(await geometry(), before, "Opening explanations does not move the row, cover, or PDF box")
          assert.equal(await dialog.getByRole("checkbox").count(), entry.state === "review" ? 1 : 0)
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
          const accept = dialog.getByRole("checkbox", { name: "Use this PDF anyway", exact: true })
          await accept.focus()
          await page.keyboard.press("Space")
          assert.ok(await accept.isChecked())
          await page.keyboard.press("Escape")
          const pdf = await (await fetch(`${base}checks/${entry.pdf}`)).arrayBuffer()
          await row
            .locator('input[type="file"]')
            .setInputFiles({ name: "replacement.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) })
          await page.waitForFunction(() => document.querySelector(".binding-file")?.textContent === "replacement.pdf")
          await details.click()
          assert.equal(await accept.isChecked(), false, "Replacing a PDF clears acceptance")
          assert.ok(await apply.isDisabled())
          await accept.check()
          await page.keyboard.press("Escape")
        }
        await apply.click()
        await panel.waitFor({ state: "hidden" })
        await page.locator(".composer").waitFor()
        const alignment = page.getByRole("region", { name: "Updated Recipe", exact: true })
        if (entry.state === "ready") {
          assert.equal(await alignment.count(), 0)
          continue
        }
        const pending = page.waitForEvent("download")
        await alignment.getByRole("button", { name: "Save updated recipe", exact: true }).click()
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
