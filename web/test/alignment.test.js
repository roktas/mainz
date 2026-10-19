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
    assert.ok(Math.abs(gap) < 1, "Grid pagination meets the status bar without a spacer")
  }
}

test(
  "Grid layouts preserve column capacity, centered grips, usable targets, and Page thumbnail references",
  { timeout: 240000 },
  async () => {
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
        await page.locator(".composition-totals strong").waitFor({ state: "attached" })
        const cases = hasTouch
          ? [
              [320, 568, 1, 2],
              [358, 667, 2, 4],
              [375, 667, 2, 4],
              [390, 844, 2, 4],
              [393, 852, 2, 4],
              [413, 852, 2, 4],
              [440, 956, 2, 4],
              [640, 960, 3, 5],
              [744, 1133, 4, 7],
              [744, 600, 4, 7],
              [768, 1024, 4, 7],
              [810, 1080, 4, 8],
              [810, 790, 4, 8],
              [810, 600, 4, 8],
              [820, 1180, 4, 8],
              [834, 1194, 4, 8],
              [920, 900, 5, 8],
              [940, 900, 2, 4],
              [1024, 768, 3, 5],
              [1080, 810, 3, 5],
              [1133, 744, 3, 5],
              [1180, 820, 3, 5],
              [1440, 1100, 3, 5],
            ]
          : [
              [390, 844, 2, 4],
              [810, 1080, 4, 9],
              [1440, 1100, 3, 6],
              [1920, 1080, 3, 6],
              [2560, 1440, 4, 8],
            ]
        for (const [width, height, normal, columns] of cases) {
          await page.setViewportSize({ width, height })
          await page.emulateMedia({ colorScheme: width === 810 ? "light" : "dark" })
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            await pane.getByRole("button", { name: `Normal ${name} grid`, exact: true }).click()
            assert.equal(
              await pane
                .locator(".composition-grid")
                .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
              normal,
            )
            const normalMargin = hasTouch ? { 1024: 14, 1080: 27 }[width] : undefined
            if (normalMargin !== undefined) {
              await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
              const geometry = await pane
                .locator(".composition-card")
                .first()
                .evaluate((card) => {
                  const bounds = card.getBoundingClientRect(),
                    pageBounds = card.querySelector("canvas").getBoundingClientRect()
                  return {
                    width: pageBounds.width,
                    height: pageBounds.height,
                    margin: (bounds.width - pageBounds.width) / 2,
                  }
                })
              assert.ok(
                width === 1080
                  ? geometry.width > 101 && geometry.width < 103
                  : geometry.width > 118 && geometry.width < 120,
              )
              assert.equal(geometry.height, width === 1080 ? 144 : 168)
              assert.ok(geometry.margin < normalMargin, "Normal keeps its calibrated thumbnail margins")
            }
            await checkGrips(pane, `${name} Normal, ${width}×${height}: grips stay centered in both selection states`)
            if (await views.isVisible()) await checkPagination(pane)
            await pane.getByRole("button", { name: `Compact ${name} grid`, exact: true }).click()
            assert.equal(
              await pane
                .locator(".composition-grid")
                .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
              columns,
              `${name}, ${width}×${height}, ${hasTouch ? "touch" : "mouse"}`,
            )
            const margin = hasTouch
              ? { 375: 11, 390: 13, 393: 13, 440: 19, 744: 17, 768: 19, 810: 16, 1024: 16 }[width]
              : undefined
            if (margin !== undefined) {
              await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
              const geometry = await pane
                .locator(".composition-card")
                .first()
                .evaluate((card) => {
                  const pageBounds = card.querySelector("canvas").getBoundingClientRect(),
                    bounds = card.getBoundingClientRect()
                  return {
                    image: pageBounds.width,
                    left: pageBounds.left - bounds.left,
                    right: bounds.right - pageBounds.right,
                    targets: [...card.querySelector(".page-label").children]
                      .slice(0, 2)
                      .map((element) => element.getBoundingClientRect().width),
                  }
                })
              assert.ok(geometry.left < margin && geometry.right < margin)
              assert.ok(Math.abs(geometry.left - geometry.right) < 1, "The image stays centered")
              assert.ok(geometry.image > 57 && geometry.image < 59, "The portrait thumbnail retains its size")
              assert.ok(
                geometry.targets.every((target) => target >= 24),
                "Both heading targets remain usable",
              )
              if (width === 810)
                await page.waitForFunction(
                  (selector) => document.querySelector(selector).children.length === 56,
                  name === "Input" ? ".selection-panel .composition-grid" : ".composition-output .composition-grid",
                )
            }
            if (await views.isVisible()) await checkPagination(pane)
            if (hasTouch && width >= 358 && width <= 440)
              await page.waitForFunction(
                (selector) => document.querySelector(selector).children.length === 16,
                name === "Input" ? ".selection-panel .composition-grid" : ".composition-output .composition-grid",
              )
            await checkGrips(pane, `${name} Compact, ${width}×${height}: grips stay centered in both selection states`)
            const card = await pane.locator(".composition-card").first().boundingBox()
            await tab(pane, "Page")
            const reference = await pane.locator(".page-reference").evaluate((element) => ({
              columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
              width: element.firstElementChild.getBoundingClientRect().width,
            }))
            assert.equal(reference.columns, columns, "Page uses the same columns as Grid")
            assert.ok(Math.abs(reference.width - card.width) < 1, "Page retains Grid's thumbnail reference width")
            await tab(pane, "Grid")
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          }
          if (hasTouch && width === 1080) {
            for (const [nextHeight, capacity] of [
              [1200, 25],
              [810, 25],
            ]) {
              await page.setViewportSize({ width, height: nextHeight })
              for (const selector of [".selection-panel", ".composition-output"]) {
                await page.waitForFunction(
                  (value) =>
                    document.querySelector(`${value.selector} .composition-grid`).children.length === value.capacity,
                  { selector, capacity },
                )
              }
            }
          }
          await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            for (const density of ["Normal", "Compact"]) {
              await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
              await checkGrips(pane, `${name} ${density}, ${width}×${height}, 200% text`)
              if (await views.isVisible()) await checkPagination(pane)
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
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
  },
)
