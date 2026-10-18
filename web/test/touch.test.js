// Checks touch Grid layouts, grips, and selection gestures.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer, fixture, captureLayout, tab, pagePosition } from "./browser.js"

test("Touch Grid matrices match phone and iPad references", { timeout: 120000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser, page
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const [width, height, input, output, compact] of [
        [320, 568, [1, 8, 8], [1, 12, 12], [2, 3, 6]],
        [375, 667, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [390, 844, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [393, 852, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [440, 956, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [667, 375, [3, 3, 8], [3, 4, 12], [6, 6, 36]],
        [844, 390, [4, 2, 8], [4, 3, 12], [8, 7, 56]],
        [852, 393, [4, 2, 8], [4, 3, 12], [8, 7, 56]],
        [956, 440, [2, 2, 4], [2, 2, 4], [4, 4, 16]],
        [744, 1133, [4, 2, 8], [4, 3, 12], [7, 7, 49]],
        [1133, 744, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
        [768, 1024, [4, 2, 8], [4, 3, 12], [7, 7, 49]],
        [1024, 768, [3, 2, 6], [3, 2, 6], [5, 4, 20]],
        [810, 1080, [4, 2, 8], [4, 3, 12], [8, 7, 56]],
        [1080, 810, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
      ]) {
        await page.setViewportSize({ width, height })
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
        )
        for (const [name, normal] of [
          ["Input", input],
          ["Output", output],
        ]) {
          const tabs = page.locator(".mobile-workspace-tabs")
          if (await tabs.isVisible()) await tabs.getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          for (const [density, reference] of [
            ["Normal", normal],
            ["Compact", compact],
          ]) {
            await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            const geometry = await pane.locator(".composition-grid").evaluate((element) => {
              const cards = [...element.children].map((card) => card.getBoundingClientRect())
              const frame = element.getBoundingClientRect()
              return {
                matrix: [
                  new Set(cards.map((card) => card.left)).size,
                  new Set(cards.map((card) => card.top)).size,
                  cards.length,
                ],
                fits: cards.every((card) => card.left >= frame.left - 1 && card.right <= frame.right + 1),
                overflow: document.documentElement.scrollWidth > innerWidth,
              }
            })
            const label = `${name} ${density}, ${width}×${height}, ${colorScheme}`
            assert.deepEqual(
              geometry.matrix,
              reference,
              `${label}: Rendered columns, rows, and pages match the reference`,
            )
            assert.ok(geometry.fits, `${label}: Cards stay inside the pane`)
            assert.equal(geometry.overflow, false, `${label}: The workspace fits horizontally`)
          }
        }
      }
    }
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "grid").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Touch grips restrict Grid drops and keep Selection unfocused", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme, reducedMotion] of [
      [810, 1080, "light", "no-preference"],
      [1080, 810, "dark", "reduce"],
      [390, 844, "dark", "no-preference"],
      [1440, 1600, "light", "reduce"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
        reducedMotion,
      })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.emulateMedia({ colorScheme })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await output.locator(".composition-totals strong").waitFor({ state: "attached" })
      const views = page.locator(".mobile-workspace-tabs")
      if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).tap()
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).tap()
      const cards = output.locator(".composition-card")
      const ids = () => cards.evaluateAll((items) => items.map((item) => item.id))
      const before = await ids()
      const selection = output.getByRole("textbox", { name: "Page selection", exact: true })
      const originalSelection = await selection.inputValue()
      const session = await page.context().newCDPSession(page)
      const send = (type, point) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
      const begin = async () => {
        const grip = cards.first().locator(".page-grip")
        await grip.scrollIntoViewIfNeeded()
        const bounds = await grip.boundingBox()
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        await send("touchStart", point)
        const press = await cards.first().evaluate((element) => ({
          border: getComputedStyle(element).borderColor,
          accent: getComputedStyle(element.querySelector(".page-grip")).color,
          dragging: document.querySelector(".composer").hasAttribute("data-touch-drag"),
        }))
        assert.equal(press.border, press.accent, "Pressing a grip highlights its card before any movement")
        assert.equal(press.dragging, false)
        await send("touchMove", { ...point, x: point.x + 10 })
        await page.locator(".composer[data-touch-drag]").waitFor()
      }
      await begin()
      const targets = await output.evaluate((element) => {
        const grid = element.querySelector(".composition-grid")
        const card = grid.querySelector(".composition-card")
        return {
          pane: getComputedStyle(element).outlineStyle,
          grid: getComputedStyle(grid).outlineStyle,
          duration: getComputedStyle(card).transitionDuration,
          selection: getComputedStyle(grid).userSelect,
        }
      })
      assert.equal(targets.pane, "none", "The pane header and Selection are outside the drop outline")
      assert.equal(targets.grid, "dashed")
      assert.equal(targets.selection, "none")
      assert.equal(targets.duration.split(", ")[0], reducedMotion === "reduce" ? "0s" : "0.28s")
      const heading = await output.locator(".editing-toolbar").boundingBox()
      await send("touchMove", { x: heading.x + heading.width / 2, y: heading.y + heading.height / 2 })
      await send("touchEnd")
      assert.deepEqual(await ids(), before, "Dropping on the toolbar leaves the document unchanged")
      assert.equal(await selection.inputValue(), originalSelection)
      await begin()
      const destination = await cards.nth(2).boundingBox()
      await send("touchMove", {
        x: destination.x + destination.width * 0.8,
        y: destination.y + destination.height / 2,
      })
      await page.locator(".composition-output[data-preview]").waitFor()
      assert.deepEqual(await ids(), before, "A preview does not commit the move")
      await send("touchEnd")
      await page.waitForFunction(
        (id) => document.querySelectorAll(".output-pages > .composition-card")[2]?.id === id,
        before[0],
      )
      assert.deepEqual(await ids(), [before[1], before[2], before[0], ...before.slice(3)])
      assert.equal(await selection.inputValue(), originalSelection, "The release does not select the source grip")
      assert.equal(await selection.evaluate((element) => element === document.activeElement), false)
      assert.equal(
        await page.locator(".drag-image, .composer[data-touch-drag], .composition-output[data-preview]").count(),
        0,
      )
      await begin()
      await send("touchCancel")
      assert.deepEqual(await ids(), [before[1], before[2], before[0], ...before.slice(3)])
      assert.equal(await page.locator(".drag-image, .composer[data-touch-drag]").count(), 0)

      if (await views.isVisible()) {
        await views.getByRole("button", { name: "Input", exact: true }).tap()
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).tap()
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true })
        await preparation.fill("1")
        const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
        await grip.scrollIntoViewIfNeeded()
        const bounds = await grip.boundingBox()
        await send("touchStart", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 })
        assert.equal(await input.locator(".input-drop-hint").count(), 0)
        await input.locator(".input-drop-hint").waitFor()
        assert.equal(
          await views
            .getByRole("button", { name: "Output", exact: true })
            .evaluate((element) => getComputedStyle(element).borderStyle),
          "dashed",
        )
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 - 20 })
        assert.equal(
          await input.locator(".input-drop-hint").count(),
          0,
          "Progress toward Output dismisses the delayed hint",
        )
        await send("touchEnd")
        assert.equal(await page.locator(".composition-totals strong").innerText(), "6 PDF pages")
        assert.equal(await preparation.inputValue(), "1", "Input rejects drops without consuming the preparation")
        await send("touchStart", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 })
        const outputTab = await views.getByRole("button", { name: "Output", exact: true }).boundingBox()
        await send("touchMove", { x: outputTab.x + outputTab.width / 2, y: outputTab.y + outputTab.height / 2 })
        await page.waitForTimeout(750)
        assert.equal(await input.isVisible(), true, "Hovering Output does not change the pane before the drop")
        assert.equal(await input.locator(".input-drop-hint").count(), 0)
        await send("touchEnd")
        await output.waitFor({ state: "visible" })
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "7 PDF pages",
        )
        assert.equal(await input.locator('input[aria-label="Page selection"]').inputValue(), "")
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
      }
      if (width === 1440) {
        const beforePage = await ids()
        await tab(output, "Page")
        await output.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const inspected = await pagePosition(output)
        assert.match(inspected, /^3\s*\/\s*6$/)
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true })
        await preparation.fill("3")
        const beginPage = async () => {
          const grip = input.getByRole("button", { name: "Select or drag Input page 3 to Output", exact: true })
          await grip.scrollIntoViewIfNeeded()
          const bounds = await grip.boundingBox()
          const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
          await send("touchStart", point)
          await send("touchMove", { ...point, x: point.x + 10 })
          await page.locator(".composer[data-touch-drag]").waitFor()
        }
        const hover = async (direction, position) => {
          const bounds = await output
            .getByRole("button", { name: `${direction} Output page`, exact: true })
            .boundingBox()
          assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= height, "The navigation target is inside the viewport")
          await send("touchMove", {
            x: bounds.x + bounds.width * (direction === "Previous" ? 0.25 : 0.75),
            y: bounds.y + bounds.height / 2,
          })
          await output
            .locator(".page-position")
            .filter({ hasText: new RegExp(`^${position}\\s*/\\s*6$`) })
            .waitFor()
          await output.locator(".page-drop-ghost canvas").waitFor()
        }
        await beginPage()
        await hover("Next", 4)
        await send("touchCancel")
        assert.equal(await pagePosition(output), inspected, "Cancelling Page navigation restores inspection")
        assert.equal(await preparation.inputValue(), "3")
        await beginPage()
        await hover("Previous", 2)
        await send("touchEnd")
        assert.match(await pagePosition(output), /^3\s*\/\s*7$/, "Insertion preserves the inspected occurrence")
        assert.equal(await preparation.inputValue(), "")
        assert.equal(await output.locator(".composition-totals strong").innerText(), "7 PDF pages")
        assert.equal(await page.locator(".drag-image, .page-drop-ghost, .composer[data-touch-drag]").count(), 0)
        await tab(output, "Grid")
        await cards.nth(2).waitFor()
        const afterPage = await ids()
        assert.equal(afterPage[0], beforePage[0])
        assert.ok(!beforePage.includes(afterPage[1]), "The new page occupies the insertion slot")
        assert.deepEqual(afterPage.slice(2), beforePage.slice(1, afterPage.length - 1))
      }
      assert.deepEqual(errors, [])
      await session.detach()
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Touch Selection keeps the keyboard closed and image gestures preserve pages", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme, textSize] of [
      [810, 1080, "light", "100%"],
      [390, 844, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.emulateMedia({ colorScheme })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      // Some touch engines send two clicks without a native double-click event.
      if (width === 390)
        await page.addInitScript(() =>
          document.addEventListener("dblclick", (event) => event.stopImmediatePropagation(), true),
        )
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composition-totals strong").waitFor({ state: "attached" })
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      const session = await page.context().newCDPSession(page)
      const send = (type, point) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
      const total = () => page.locator(".composition-totals strong").innerText()
      const lens = page.getByRole("region", { name: /^Magnified page / })
      for (const name of ["Input", "Output"]) {
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).tap()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
        assert.equal(await field.getAttribute("inputmode"), "numeric")
        await pane.getByRole("button", { name: `Compact ${name} grid`, exact: true }).tap()
        const cards = pane.locator(".composition-card")
        const clear = pane.getByRole("button", {
          name: name === "Input" ? "Clear page sequence" : "Clear Output selection",
          exact: true,
        })
        await field.fill("2-4,6")
        await clear.tap()
        assert.equal(await field.inputValue(), "")
        assert.equal(
          await pane.locator(".composition-grid").evaluate((element) => element === document.activeElement),
          true,
        )
        await cards.first().locator(".page-image").tap()
        assert.equal(await field.inputValue(), "1")
        await clear.tap()
        assert.equal(await field.inputValue(), "")
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
        await pane.getByRole("button", { name: "Select all", exact: true }).tap()
        assert.equal(await field.inputValue(), name === "Input" ? "1-7" : "1-6")
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
        await clear.press("Space")
        assert.equal(await field.inputValue(), "")
        assert.equal(await field.evaluate((element) => element === document.activeElement), true)
        if (name === "Output") {
          await field.fill("1")
          await pane.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).tap()
          assert.equal(await total(), "7 PDF pages")
          assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
          await pane.getByRole("button", { name: "Remove selected Output pages", exact: true }).tap()
          assert.equal(await total(), "6 PDF pages")
          assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
        }
        await field.fill("2-4,6")
        await pane.getByRole("tab", { name: "Grid", exact: true }).tap()
        const before = await total()
        const target = cards.first().locator(".page-image canvas")
        await target.scrollIntoViewIfNeeded()
        const bounds = await target.boundingBox()
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        await send("touchStart", point)
        await lens.waitFor()
        const crop = await lens.boundingBox()
        assert.ok(crop.x >= 12 && crop.x + crop.width <= width - 12)
        assert.ok(crop.y >= 12 && crop.y + crop.height <= height - 12)
        await send("touchMove", { ...point, x: point.x + 8 })
        await lens.waitFor()
        await send("touchEnd")
        await lens.waitFor({ state: "hidden" })
        assert.equal(await field.inputValue(), "2-4,6", "Holding and releasing the lens leaves Selection unchanged")
        assert.equal(await total(), before)
        await send("touchStart", point)
        await lens.waitFor()
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { ...point, id: 1 },
            { x: width - 16, y: 100, id: 2 },
          ],
        })
        await lens.waitFor({ state: "hidden" })
        await send("touchCancel")
        await send("touchStart", point)
        await send("touchMove", { ...point, y: point.y - 40 })
        await send("touchCancel")
        await page.waitForTimeout(320)
        assert.equal(await lens.count(), 0, "Scrolling before the hold cancels a pending lens")
        assert.equal(await field.inputValue(), "2-4,6")
        await target.tap()
        await target.tap()
        await pane.locator(".page-view").waitFor()
        assert.equal(await field.inputValue(), "2-4,6", "Double tap restores Selection before opening Page")
        assert.match(await pagePosition(pane), name === "Input" ? /^1\s*\/\s*7$/ : /^1\s*\/\s*6$/)
        assert.equal(await total(), before)
        const sheet = pane.locator(".page-scroll canvas")
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        await sheet.scrollIntoViewIfNeeded()
        const pageBounds = await sheet.boundingBox()
        await send("touchStart", {
          x: pageBounds.x + pageBounds.width / 2,
          y: Math.min(height - 16, Math.max(16, pageBounds.y + pageBounds.height / 2)),
        })
        await lens.waitFor()
        await send("touchEnd")
        await lens.waitFor({ state: "hidden" })
        assert.equal(await field.inputValue(), "2-4,6")
        assert.equal(await total(), before, "Holding a Page image does not add or duplicate it")
        if (name === "Output") {
          await sheet.tap()
          await pane.getByRole("button", { name: "Next Output page", exact: true }).tap()
          await sheet.tap()
          assert.equal(await total(), before, "Taps on different inspected pages do not combine into a copy")
          await pane.getByRole("button", { name: "Previous Output page", exact: true }).tap()
          for (const expected of ["7 PDF pages", "8 PDF pages"]) {
            await sheet.tap()
            await sheet.tap()
            await page.waitForFunction(
              (text) => document.querySelector(".composition-totals strong")?.textContent === text,
              expected,
            )
            await page.waitForTimeout(400)
          }
          assert.equal(await field.inputValue(), "4-6, 8", "Double taps preserve the originally selected occurrences")
        }
      }
      assert.deepEqual(errors, [])
      await session.detach()
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})
