// Checks Grid capacity, centered grips, and Page thumbnail alignment.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer, fixture, checkGrips, tab } from "./browser.js"

async function checkPagination(pane) {
  const bounds = await pane.evaluate((element) => {
    const rect = (selector) => {
      const { left, right, top, bottom } = element.querySelector(selector).getBoundingClientRect()
      return { left, right, top, bottom }
    }
    return {
      grid: rect(".composition-grid"),
      pager: rect(".page-batches"),
      slider: rect('.page-batches input[type="range"]'),
      previous: rect(".page-batches > button:first-child"),
      next: rect(".page-batches > button:last-of-type"),
      previousIcon: rect(".page-batches > button:first-child svg"),
      nextIcon: rect(".page-batches > button:last-of-type svg"),
      caption: rect(".batch-caption"),
      viewport: document.documentElement.clientWidth,
    }
  })
  assert.ok(
    Math.abs((bounds.previousIcon.left + bounds.previousIcon.right) / 2 - bounds.grid.left) < 1,
    "Previous aligns with the content's left edge",
  )
  assert.ok(
    Math.abs((bounds.nextIcon.left + bounds.nextIcon.right) / 2 - bounds.grid.right) < 1,
    "Next aligns with the content's right edge",
  )
  for (const button of [bounds.previous, bounds.next]) {
    assert.ok(Math.abs(button.top - bounds.slider.top) < 1, "Arrows share the slider's row")
    assert.ok(button.right - button.left >= 40 && button.bottom - button.top >= 44, "Arrow targets stay usable")
    assert.ok(button.left >= 0 && button.right <= bounds.viewport, "Arrow targets stay inside the viewport")
  }
  for (const icon of [bounds.previousIcon, bounds.nextIcon])
    assert.ok(
      Math.abs((icon.top + icon.bottom - bounds.slider.top - bounds.slider.bottom) / 2) < 1,
      "Arrows stay on the slider's centerline",
    )
  assert.ok(
    bounds.previous.right <= bounds.slider.left && bounds.slider.right <= bounds.next.left,
    "Targets stay separate",
  )
  assert.ok(Math.abs(bounds.slider.top - bounds.pager.top) < 1, "The slider starts the pagination row")
  assert.ok(Math.abs(bounds.caption.top + 3 - bounds.slider.bottom) < 1, "The caption stays close below the slider")
  if (pane.page().viewportSize().width <= 480) {
    await pane.page().evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const gap = await pane.evaluate(
      (element) =>
        document.querySelector(".footnote").getBoundingClientRect().top -
        element.querySelector(".page-batches").getBoundingClientRect().bottom,
    )
    assert.ok(gap >= -1, "Grid pagination stays clear of the status bar")
  }
}

test("Grid grips and Page thumbnail references stay aligned across layouts", { timeout: 240000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, isMobile: hasTouch, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
      )
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      for (const [width, height] of hasTouch
        ? [
            [320, 568],
            [375, 667],
            [390, 844],
            [744, 1133],
            [768, 1024],
            [810, 1080],
            [1024, 768],
            [1080, 810],
            [1133, 744],
          ]
        : [
            [390, 844],
            [810, 1080],
            [1440, 1100],
            [1920, 982],
            [2560, 1310],
          ]) {
        await page.setViewportSize({ width, height })
        await page.emulateMedia({ colorScheme: width === 810 ? "light" : "dark" })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            for (const density of ["Normal", "Compact"]) {
              await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
              await checkGrips(pane, `${name} ${density}, ${width}×${height}, ${text} text`)
              if (await views.isVisible()) await checkPagination(pane)
              const grid = await pane.locator(".composition-grid").evaluate((element) => ({
                columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
                width: element.firstElementChild.getBoundingClientRect().width,
              }))
              await tab(pane, "Page")
              const reference = await pane.locator(".page-reference").evaluate((element) => ({
                columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
                width: element.firstElementChild.getBoundingClientRect().width,
              }))
              assert.deepEqual(reference, grid, "Page retains Grid's columns and thumbnail width")
              await tab(pane, "Grid")
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            }
          }
        }
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      }
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})
