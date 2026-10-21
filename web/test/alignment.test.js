// Checks centered grips and Page thumbnail alignment once per distinct card calibration.

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

for (const hasTouch of [false, true])
  test(
    `Grid grips and Page thumbnail references stay aligned for ${hasTouch ? "touch" : "mouse"}`,
    { timeout: 600000 },
    async (t) => {
      const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
      let browser, label
      try {
        await server.listen()
        browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
        const page = await browser.newPage({ hasTouch, isMobile: hasTouch, reducedMotion: "reduce" })
        page.setDefaultTimeout(45000)
        // Capacity and calibration boundaries belong to grid.test.js; alignment needs only a few complete columns.
        await page.route("**/grid.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 32) }),
        )
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "32 PDF pages",
        )
        for (const [width, height] of hasTouch
          ? [
              [320, 568],
              [390, 844],
              [667, 250],
              [744, 1047],
              [744, 1133],
              [768, 1024],
              [810, 1080],
              [820, 1080],
              [1024, 768],
              [1080, 810],
              [1180, 730],
              [1000, 1200],
              [1024, 1300],
              [1360, 980],
              [1133, 744],
            ]
          : [
              [390, 844],
              [810, 1080],
              [1440, 1100],
              [1920, 982],
              [2560, 1310],
              [2200, 1100],
              [2960, 1500],
              [3840, 1900],
              [3840, 2050],
            ]) {
          t.diagnostic(`${hasTouch ? "Touch" : "Mouse"} ${width}×${height}`)
          await page.setViewportSize({ width, height })
          for (const text of ["100%", "200%"]) {
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
            for (const name of ["Input", "Output"]) {
              const views = page.locator(".mobile-workspace-tabs")
              if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
              const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
              for (const density of ["Normal", "Compact"]) {
                label = `${hasTouch ? "Touch" : "Mouse"} ${name} ${density}, ${width}×${height}, ${text} text`
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
      } catch (error) {
        error.message += `\nLayout: ${label}`
        throw error
      } finally {
        await browser?.close()
        await server.close()
      }
    },
  )

test("App header uses available width before wrapping its actions", { timeout: 45000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const width of [785, 810, 820, 834, 900, 1024]) {
        await page.setViewportSize({ width, height: 1094 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const bounds = await page.locator(".header-inner").evaluate((header) => {
            const brand = header.querySelector(".brand").getBoundingClientRect()
            const actions = [...header.querySelector(".header-actions").children]
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.width && rect.height)
            return {
              brand: brand.right,
              actions: actions.map((rect) => ({ left: rect.left, y: rect.y + rect.height / 2 })),
              overflow: document.documentElement.scrollWidth > innerWidth,
            }
          })
          assert.equal(bounds.overflow, false)
          assert.ok(bounds.actions.every((rect) => rect.left > bounds.brand))
          assert.ok(
            bounds.actions.every((rect) => Math.abs(rect.y - bounds.actions[0].y) < 1),
            `${width}px, ${text}, ${colorScheme}: Header actions share one row`,
          )
        }
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Calibrations keep five-digit numbers clear of centered grips", { timeout: 180000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [true, false]) {
      const page = await browser.newPage({
        viewport: { width: 744, height: 1047 },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Prepared pages with a very long descriptive input filename.pdf",
          mimeType: "application/pdf",
          buffer: fixture(false),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(Array(10).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
      await page.keyboard.press("Escape")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "10000 PDF pages",
      )
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      for (const [width, height] of hasTouch
        ? [
            [667, 250],
            [740, 1047],
            [740, 1100],
            [805, 980],
            [820, 1080],
            [1080, 700],
            [1180, 730],
            [1000, 1200],
            [1024, 1300],
            [1360, 980],
          ]
        : [
            [1280, 700],
            [2200, 1100],
            [2960, 1500],
            [2560, 1310],
            [3840, 1900],
            [3840, 2050],
          ]) {
        await page.setViewportSize({ width, height })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          for (const density of ["Normal", "Compact"]) {
            await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
            await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
            await output.getByRole("button", { name: "Select Output page 10000", exact: true }).waitFor()
            await checkGrips(output, `${width}×${height}, ${text}, ${density}, five digits`)
            const gap = await output
              .locator(".composition-card")
              .last()
              .evaluate((card) => {
                const number = card
                  .querySelector(".page-origin > :is(summary,.card-number) strong")
                  .getBoundingClientRect()
                const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
                return grip.left - number.right
              })
            assert.ok(
              gap >= 2,
              `${width}×${height}, ${text}, ${density}: five digits keep clear of the grip (${gap}px)`,
            )
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          }
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})
