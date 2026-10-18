// Checks fitted Page headings and navigation across viewports.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { zoom } from "./workspace.js"
import { createServer, tab, image, captureLayout } from "./browser.js"

test("Page headings and navigation follow fitted image edges", { timeout: 240000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser, page
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    for (const [width, height, colorScheme, text] of [
      [1280, 900, "light", "100%"],
      [1920, 720, "dark", "100%"],
      [375, 667, "light", "100%"],
      [320, 568, "dark", "100%"],
      [390, 844, "dark", "200%"],
      [640, 960, "light", "100%"],
      [641, 960, "dark", "100%"],
      [768, 1024, "light", "100%"],
      ...["light", "dark"].flatMap((theme) =>
        [
          [667, 375],
          [844, 390],
          [956, 440],
          [744, 1133],
          [1133, 744],
          [810, 1080],
          [1080, 810],
        ].flatMap(([viewportWidth, viewportHeight]) =>
          ["100%", "200%"].map((textSize) => [viewportWidth, viewportHeight, theme, textSize]),
        ),
      ),
    ]) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme })
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
      for (const [selector, name] of [
        [".selection-panel", "Input"],
        [".composition-output", "Output"],
      ]) {
        const pane = page.locator(selector)
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        await tab(pane, "Page")
        const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
        for (const key of ["Home", "End"]) {
          await viewport.focus()
          await page.keyboard.press(key)
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          const fitted = await image(pane).boundingBox()
          for (const action of [undefined, "Zoom out", "Fit page", "Zoom in", "Fit page"]) {
            if (action) await zoom(pane, action)
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            const geometry = await pane.locator(".page-view").evaluate((view) => {
              const box = (query) => view.querySelector(query).getBoundingClientRect()
              const grip = view.querySelector(".inspection-heading .page-grip")?.getBoundingClientRect()
              const fit = [...view.querySelector('button[aria-label="Fit page"]').children].find(
                (child) => getComputedStyle(child).display !== "none",
              )
              const items = [...view.querySelector(".page-zoom").children]
                .map((child) => child.getBoundingClientRect())
                .filter((rect) => rect.width > 1)
              return {
                starts: [box(".page-current").left, box(".page-navigation > button:first-child svg").left],
                ends: [fit.getBoundingClientRect().right, box(".page-navigation > button:last-child svg").right],
                grip: grip && grip.x + grip.width / 2,
                gripTop: grip?.top,
                toolTop: box(".page-tools").top,
                items: items.length,
                centers: items.map((rect) => rect.x + rect.width / 2),
                rows: items.map((rect) => rect.y + rect.height / 2),
                heading: box(".inspection-heading").toJSON(),
                targets: [...view.querySelectorAll(".page-tools button")].map((button) => {
                  const rect = button.getBoundingClientRect()
                  return rect.toJSON()
                }),
                zoom: view.querySelector(".page-zoom output").textContent,
                fit: fit.tagName === "svg" ? "icon" : fit.textContent,
              }
            })
            const label = `${name}, ${width}×${height}, ${colorScheme}, ${text}, ${key}, ${action ?? "Fit"}`
            assert.ok(
              geometry.starts.every((x) => Math.abs(x - fitted.x) < 1),
              `${label}: counter and Previous align with the image start`,
            )
            assert.ok(
              geometry.ends.every((x) => Math.abs(x - fitted.x - fitted.width) < 1),
              `${label}: Fit and Next align with the image end`,
            )
            if (geometry.grip !== undefined)
              assert.ok(Math.abs(geometry.grip - fitted.x - fitted.width / 2) < 1, `${label}: the grip stays centered`)
            const compact = width <= 640
            assert.equal(geometry.items, compact ? 3 : 4, `${label}: the zoom group uses the screen layout`)
            const spacing = geometry.centers.slice(1).map((center, index) => center - geometry.centers[index])
            assert.ok(
              spacing.every((gap) => Math.abs(gap - spacing[0]) < 1),
              `${label}: zoom items are evenly spaced`,
            )
            assert.ok(
              geometry.rows.every((center) => Math.abs(center - geometry.rows[0]) < 1),
              `${label}: zoom items stay on one row`,
            )
            assert.ok(
              geometry.targets.every((target) => target.width >= 44 && target.height >= 44),
              `${label}: touch targets keep their size`,
            )
            assert.ok(
              geometry.targets.every(
                (target) =>
                  target.left >= geometry.heading.left - 1 &&
                  target.right <= geometry.heading.right + 1 &&
                  target.top >= geometry.heading.top - 1 &&
                  target.bottom <= geometry.heading.bottom + 1,
              ),
              `${label}: Page controls stay inside their heading`,
            )
            assert.ok(
              geometry.targets.every(
                (target, index, targets) => index === 0 || target.left >= targets[index - 1].right - 1,
              ),
              `${label}: Page controls retain separate targets`,
            )
            assert.equal(
              geometry.fit,
              compact && geometry.zoom !== "100%" ? geometry.zoom : "icon",
              `${label}: Fit shows an icon or the current zoom`,
            )
            if (width === 375 && name === "Input" && key === "Home" && !action)
              assert.equal(geometry.toolTop, geometry.gripTop, `${label}: fitting tools stay on the first row`)
          }
        }
      }
    }
    assert.deepEqual(errors, [], "Page layout and resizing have no browser errors")
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "page").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
    await server.close()
  }
})
