// Checks native and touch transfer cancellation, large Output ordering, and workspace lifecycle boundaries.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { fixture } from "./browser.js"

test(
  "Large Output transfers preserve offscreen selections across cancellation and drop",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const method of ["native", "touch"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "Large.pdf",
            mimeType: "application/pdf",
            buffer: fixture(false, false, 0, false, false, {}, 10),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await input.getByLabel("Page selection", { exact: true }).fill("1-10")
        await input.getByLabel("Input page actions", { exact: true }).click()
        await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await output.getByRole("slider").press("End")
        await output.getByRole("slider").press("ArrowLeft")
        const positions = await output
          .locator(".composition-card .page-image")
          .evaluateAll((elements) => elements.map((e) => Number(e.dataset.page) + 1))
        const from = positions[0],
          to = positions.at(-1)
        assert.ok(from > 9000 && to > from + 1)
        const selection = output.getByLabel("Page selection", { exact: true })
        await selection.fill(`1,${from}`)
        const original = await selection.inputValue()
        for (const cancelled of [true, false]) {
          const result = await output.locator(".output-pages").evaluate(
            async (grid, { pointer, cancel }) => {
              const source = grid.querySelector(".page-grip"),
                box = source.getBoundingClientRect()
              const data = new DataTransfer(),
                contact = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 }
              const start = {
                bubbles: true,
                cancelable: true,
                clientX: box.x + box.width / 2,
                clientY: box.y + box.height / 2,
              }
              if (pointer === "native")
                source.dispatchEvent(new DragEvent("dragstart", { ...start, dataTransfer: data }))
              else source.dispatchEvent(new PointerEvent("pointerdown", { ...start, ...contact }))
              const over = async (bounds) => {
                const point = {
                  bubbles: true,
                  cancelable: true,
                  clientX: bounds.x + bounds.width / 4,
                  clientY: bounds.y + bounds.height / 2,
                }
                if (pointer === "native")
                  grid.dispatchEvent(new DragEvent("dragover", { ...point, dataTransfer: data }))
                else window.dispatchEvent(new PointerEvent("pointermove", { ...point, ...contact }))
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                return point
              }
              await over(grid.querySelector(".composition-card").getBoundingClientRect())
              const blocked = !grid.querySelector(".drop-placeholder")
              const point = await over(grid.querySelector(".composition-card:last-child").getBoundingClientRect())
              const preview = !!grid.querySelector(".drop-placeholder")
              if (cancel) window.dispatchEvent(new Event("blur"))
              else if (pointer === "native") grid.dispatchEvent(new DragEvent("drop", { ...point, dataTransfer: data }))
              else window.dispatchEvent(new PointerEvent("pointerup", { ...point, ...contact }))
              return { blocked, preview }
            },
            { pointer: method, cancel: cancelled },
          )
          assert.deepEqual(result, { blocked: true, preview: true }, method)
          await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          assert.equal(await selection.inputValue(), cancelled ? original : `${to - 2}-${to - 1}`, method)
          assert.equal(await output.locator(".composition-totals strong").innerText(), "10000 PDF pages")
        }
        await page.close()
      }
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Interrupted transfers release their previews and leave subsequent actions usable",
  { timeout: 60000 },
  async (t) => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await output.locator(".composition-totals strong").filter({ hasText: "6 PDF pages" }).waitFor()
      await input.getByLabel("Page selection", { exact: true }).fill("")
      for (const pointer of ["native", "touch"]) {
        for (const interruption of ["blur", "resize", "pointercancel", "secondary", "home"]) {
          if (pointer === "native" && ["pointercancel", "secondary"].includes(interruption)) continue
          t.diagnostic(`${pointer}: ${interruption}`)
          let dataTransfer
          const contact = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, clientX: 200, clientY: 500 }
          if (pointer === "native") {
            dataTransfer = await page.evaluateHandle(() => new DataTransfer())
            await input
              .getByRole("button", { name: "Select Input page 1", exact: true })
              .dispatchEvent("dragstart", { dataTransfer })
          } else {
            await input
              .getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
              .dispatchEvent("pointerdown", contact)
            await page.locator("body").dispatchEvent("pointermove", { ...contact, clientX: 220 })
          }
          await page.locator('.composer[data-drag="source"]').waitFor()
          if (interruption === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")))
          else if (interruption === "resize") {
            await page.setViewportSize({ width: 1430, height: 990 })
            await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          } else if (interruption === "pointercancel")
            await page.locator("body").dispatchEvent("pointercancel", contact)
          else if (interruption === "secondary")
            await page.locator("body").dispatchEvent("pointerdown", { ...contact, pointerId: 8, isPrimary: false })
          else await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
          assert.equal(
            await page.locator(".composer[data-drag]").count(),
            0,
            `${pointer}: ${interruption} ends the session`,
          )
          assert.equal(await page.locator(".drag-image, [data-press]").count(), 0)
          if (interruption === "home") {
            await page.goto(`${server.resolvedUrls.local[0]}?demo`)
            await output.locator(".composition-totals strong").filter({ hasText: "6 PDF pages" }).waitFor()
            await input.getByLabel("Page selection", { exact: true }).fill("")
          } else {
            if (dataTransfer) await output.dispatchEvent("drop", { dataTransfer })
            else await output.dispatchEvent("pointerup", contact)
            assert.equal(await output.locator(".composition-totals strong").innerText(), "6 PDF pages")
            await input.getByRole("button", { name: "Select Input page 1", exact: true }).click()
            assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1")
            await input.getByLabel("Page selection", { exact: true }).fill("")
          }
          await page.setViewportSize({ width: 1440, height: 1000 })
          // Finish resize cancellation before starting the next independent gesture.
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
        }
      }
    } finally {
      await browser?.close()
    }
  },
)
