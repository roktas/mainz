// Checks cancellation of native and touch transfers at workspace lifecycle boundaries.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer } from "./browser.js"

test(
  "Interrupted transfers release their previews and leave subsequent actions usable",
  { timeout: 60000 },
  async (t) => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
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
          else if (interruption === "resize") await page.setViewportSize({ width: 1430, height: 990 })
          else if (interruption === "pointercancel") await page.locator("body").dispatchEvent("pointercancel", contact)
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
        }
      }
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)
