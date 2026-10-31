// Checks page selection, gestures, focus, and keyboard actions.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { zoom } from "./workspace.js"
import { tab, pagePosition, gridPage, fixture, hasCursor, captureLayout } from "./browser.js"
import { measure } from "./measure.js"

test("Input clicks retain the last valid sequence at the page limit", async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
    const input = page.locator(".selection-panel")
    const selection = input.getByLabel("Page selection", { exact: true })
    await selection.fill(Array(10000).fill("1").join(","))
    await input.getByRole("button", { name: "Select Input page 2", exact: true }).click()
    assert.equal(await selection.getAttribute("aria-invalid"), "true")
    assert.equal(
      await input.getByRole("button", { name: "Select Input page 2", exact: true }).getAttribute("aria-pressed"),
      "false",
    )
    assert.equal(await input.getByRole("button", { name: "Add to Output", exact: true }).isDisabled(), true)
    assert.equal(await page.locator(".composition-totals strong").textContent(), "0 pages")
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).click()
    assert.equal(await selection.inputValue(), "")
    assert.notEqual(await selection.getAttribute("aria-invalid"), "true")
  } finally {
    await browser.close()
  }
})

test("Sparse Output selections follow physical order through edits", async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { Output } = await import("/src/output.svelte.ts")
      const output = new Output(() => [])
      const pages = Array.from({ length: 10000 }, (_, index) => ({
        id: String(index),
        content: { blank: { width: 210, height: 297 } },
      }))
      const part = { id: "part", pages, copies: 1, front: false }
      output.commit([part])
      output.select(["9999", "4", "5000", "missing"])
      const selected = [...output.selected]
      output.commit([{ ...part, pages: pages.toReversed() }])
      const reordered = [...output.selected]
      output.commit([{ ...part, pages: pages.slice(0, 5) }])
      const surviving = [...output.selected]
      output.select([])
      return { selected, reordered, surviving, cleared: [...output.selected] }
    })
    assert.deepEqual(result, {
      selected: ["4", "5000", "9999"],
      reordered: ["9999", "5000", "4"],
      surviving: ["4"],
      cleared: [],
    })
  } finally {
    await browser.close()
  }
})

test("Touch grips restrict Grid drops and keep Selection unfocused", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
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
      await measure(output)
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
      assert.equal(targets.duration.split(", ")[0], reducedMotion === "reduce" ? "0s" : "0.45s")
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
        assert.equal(await page.locator(".composition-totals strong").textContent(), "8 pages")
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
          () => document.querySelector(".composition-totals strong")?.textContent === "9 pages",
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
        assert.match(inspected, /^3\s*\/\s*8$/)
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
            .filter({ hasText: new RegExp(`^${position}\\s*/\\s*8$`) })
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
        assert.match(await pagePosition(output), /^3\s*\/\s*9$/, "Insertion preserves the inspected occurrence")
        assert.equal(await preparation.inputValue(), "")
        assert.equal(await output.locator(".composition-totals strong").textContent(), "9 pages")
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
  }
})

test("Touch Selection keeps the keyboard closed and image gestures preserve pages", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  let page
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme, textSize] of [
      [810, 1080, "light", "100%"],
      [390, 844, "dark", "200%"],
    ]) {
      page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true })
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
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size
        if (size === "200%") document.body.style.fontFamily = "DejaVu Sans"
      }, textSize)
      const session = await page.context().newCDPSession(page)
      const send = (type, point) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
      const total = () => page.locator(".composition-totals strong").textContent()
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
        await field.fill("2,4")
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
        assert.equal(await field.inputValue(), name === "Input" ? "1-4" : "1-8")
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
        await clear.press("Space")
        assert.equal(await field.inputValue(), "")
        assert.equal(await field.evaluate((element) => element === document.activeElement), true)
        if (name === "Output") {
          await field.fill("1")
          await pane.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).tap()
          assert.equal(await total(), "9 pages")
          assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
          await pane.getByRole("button", { name: "Remove selected Output pages", exact: true }).tap()
          assert.equal(await total(), "8 pages")
          assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false)
        }
        await field.fill("2,4")
        await pane.getByRole("tab", { name: "Grid", exact: true }).tap()
        const before = await total()
        const target = (await gridPage(pane, 1)).locator('.thumbnail[aria-busy="false"] canvas')
        await page.waitForFunction(
          (element) =>
            [...element.querySelectorAll(".composition-card")].every(
              (card) => !card.inert && !card.getAnimations().length,
            ),
          await pane.elementHandle(),
        )
        // Native touch dispatch does not avoid the sticky status bar.
        await target.evaluate((element) => element.scrollIntoView({ block: "center" }))
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const bounds = await target.boundingBox()
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 }
        assert.equal(
          await target.evaluate((canvas, { x, y }) => document.elementFromPoint(x, y) === canvas, point),
          true,
          `${name}, ${width}px: The touch hold reaches the page above the status bar`,
        )
        await send("touchStart", point)
        await lens.waitFor()
        const crop = await lens.boundingBox()
        assert.ok(crop.x >= 12 && crop.x + crop.width <= width - 12)
        assert.ok(crop.y >= 12 && crop.y + crop.height <= height - 12)
        await send("touchMove", { ...point, x: point.x + 8 })
        await lens.waitFor()
        await send("touchEnd")
        await lens.waitFor({ state: "hidden" })
        assert.equal(await field.inputValue(), "2,4", "Holding and releasing the lens leaves Selection unchanged")
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
        assert.equal(await field.inputValue(), "2,4")
        await target.tap()
        await target.tap()
        await pane.locator(".page-view").waitFor()
        assert.equal(await field.inputValue(), "2,4", "Double tap restores Selection before opening Page")
        assert.match(await pagePosition(pane), name === "Input" ? /^1\s*\/\s*4$/ : /^1\s*\/\s*8$/)
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
        assert.equal(await field.inputValue(), "2,4")
        assert.equal(await total(), before, "Holding a Page image does not add or duplicate it")
        if (name === "Output") {
          await sheet.tap()
          await pane.getByRole("button", { name: "Next Output page", exact: true }).tap()
          await sheet.tap()
          assert.equal(await total(), before, "Taps on different inspected pages preserve composition")
          await pane.getByRole("button", { name: "Previous Output page", exact: true }).tap()
          await zoom(pane, "Reset zoom")
          for (const expected of ["200%", "100%"]) {
            await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
            await sheet.tap()
            await sheet.tap()
            await page.waitForFunction(
              (text) => document.querySelector('output[aria-label="Output page zoom"]')?.textContent === text,
              expected,
            )
          }
          assert.equal(await total(), before)
          assert.equal(await field.inputValue(), "2,4", "Double taps preserve Selection")
        }
      }
      assert.deepEqual(errors, [])
      await session.detach()
      await page.close()
    }
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "touch-selection").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
  }
})

test("Grid images and grips share selection and ordinary page focus", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      localStorage.setItem("mainz:theme", "light")
    })
    await page.goto(server.resolvedUrls.local[0])
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Ranges.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "Dark theme", exact: true }).click()
      for (const reducedMotion of ["reduce", "no-preference"]) {
        await page.emulateMedia({ reducedMotion })
        for (const [pane, clear] of [
          [input, "Clear page sequence"],
          [page.locator(".composition-output"), "Clear Output selection"],
        ]) {
          const reset = pane.getByRole("button", { name: clear, exact: true })
          if (await reset.count()) await reset.click()
          const selection = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await pane.getByRole("slider").press("Home")
          const cards = pane.locator(".composition-card")
          const frame = await cards.first().boundingBox()
          const colors = () => cards.evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor))
          await selection.fill("1-3")
          const original = await colors()
          await selection.fill("")
          await cards.first().locator(".page-image").click()
          assert.equal(await selection.inputValue(), "1", "Image clicks select the page")
          assert.equal(await cards.first().evaluate((item) => getComputedStyle(item).outlineStyle), "none")
          const grip = await cards.first().locator(".page-grip").boundingBox()
          await page.mouse.click(grip.x - 5, grip.y + grip.height / 2)
          assert.equal(await selection.inputValue(), "", "The extended grip area toggles its page's selection")
          assert.equal(await cards.first().evaluate((item) => getComputedStyle(item).outlineStyle), "none")
          await cards.first().locator(".page-grip").click()
          assert.equal(await selection.inputValue(), "1", "Clicking the grip selects its page")
          assert.equal(
            await cards
              .first()
              .locator(".page-image")
              .evaluate((item) => item === document.activeElement),
            true,
            "Grip activation keeps ordinary page focus",
          )
          await cards.first().locator(".page-grip").click()
          assert.equal(await selection.inputValue(), "")
          assert.equal(
            await cards
              .first()
              .locator(".page-image")
              .evaluate((item) => item === document.activeElement),
            true,
            "Grip activation keeps the page ready for keyboard use",
          )
          await cards.first().locator(".page-grip").click()
          await cards
            .nth(2)
            .locator(".page-grip")
            .click({ modifiers: ["Shift"] })
          assert.equal(await selection.inputValue(), "1-3")
          const selectedFrame = await cards.first().boundingBox()
          assert.ok(Math.abs(selectedFrame.width - frame.width) < 0.1)
          assert.ok(Math.abs(selectedFrame.height - frame.height) < 0.1)
          assert.equal(
            await cards.first().evaluate((item) => {
              const card = item.getBoundingClientRect()
              const thumbnail = item.querySelector(".thumbnail").getBoundingClientRect()
              return thumbnail.left >= card.left + 1.9 && thumbnail.right <= card.right - 1.9
            }),
            true,
            "The thumbnail stays inside the complete selection border",
          )
          const highlighted = await colors()
          assert.ok(highlighted.slice(0, 3).every((color, index) => color !== original[index]))
          assert.deepEqual(highlighted.slice(3), original.slice(3), "Only the chosen range gets a temporary tint")
          assert.equal(await cards.nth(2).evaluate((item) => getComputedStyle(item).outlineStyle), "none")
          await page.keyboard.down("Shift")
          assert.equal(
            await cards
              .nth(2)
              .locator(".page-grip")
              .evaluate((item) => {
                const style = getComputedStyle(item)
                return style.outlineStyle === "none" || style.outlineColor === "rgba(0, 0, 0, 0)"
              }),
            true,
            "Shift does not draw a box around the grip",
          )
          await page.keyboard.up("Shift")
          await page.waitForFunction(
            ({ selector, expected }) =>
              Array.from(document.querySelectorAll(selector)).every(
                (item, index) => getComputedStyle(item).backgroundColor === expected[index],
              ),
            {
              selector: pane === input ? ".source-catalog .composition-card" : ".output-pages .composition-card",
              expected: original,
            },
          )
          assert.equal(await selection.inputValue(), "1-3", "The range stays selected after its highlight ends")
          await cards.first().locator(".page-image").click()
          assert.equal(await selection.inputValue(), "2-3")
          assert.equal(
            await cards
              .first()
              .locator(".page-image")
              .evaluate((item) => item === document.activeElement),
            true,
            "Image selection makes that page current",
          )
          await page.keyboard.press("Space")
          assert.equal(
            await selection.inputValue(),
            pane === input ? "2-3, 1" : "1-3",
            "Space toggles the page last clicked with the mouse",
          )
          await cards
            .nth(4)
            .locator(".page-image")
            .click({ modifiers: ["Shift"] })
          assert.equal(
            await selection.inputValue(),
            pane === input ? "2-3, 1, 4-5" : "1-5",
            "Shift-clicking keeps Input order and extends the range",
          )
        }
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Dragging opens stable page slots, previews density, and commits only on drop", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const sizes = new Map()
    for (const density of ["Normal", "Compact"]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion })
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.emulateMedia({ colorScheme: reducedMotion === "reduce" ? "dark" : "light" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "Dragging.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ grouped: true, fillOnly: true }),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await input.getByLabel("Page selection", { exact: true }).fill("1-7")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await measure(output)
        await output.locator(".composition-card").nth(6).waitFor()
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        if (density === "Compact") {
          await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
          await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
        }
        if (reducedMotion === "reduce")
          await page.setViewportSize({ width: 1920, height: density === "Compact" ? 1080 : 1440 })
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        )
        // Retained canvases can still have their previous fit after a viewport change.
        await page.waitForFunction(() => {
          const images = [...document.querySelectorAll(".composer .page-image canvas")]
          return (
            images.length &&
            images.every((canvas) => {
              const box = canvas.getBoundingClientRect()
              return (
                canvas.width > 0 &&
                Math.abs(box.width - parseFloat(canvas.style.inlineSize)) < 1 &&
                Math.abs(box.height - parseFloat(canvas.style.blockSize)) < 1
              )
            })
          )
        })
        const cards = output.locator(".composition-card")
        const ids = () => cards.evaluateAll((items) => items.map((item) => item.id))
        const settle = () =>
          page.waitForFunction(() =>
            [...document.querySelectorAll(".composer .composition-card")].every((item) => !item.getAnimations().length),
          )
        const transfer = await page.evaluateHandle(() => {
          const data = new DataTransfer()
          const setImage = data.setDragImage.bind(data)
          data.setDragImage = (canvas, x, y) => {
            data.image = canvas
            setImage(canvas, x, y)
          }
          return data
        })
        const source = input.getByRole("button", { name: "Select Input page 1", exact: true })
        const before = await ids()
        const bounds = await cards.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()))
        const reference = await cards.first().evaluate((card) => {
          const frame = card.getBoundingClientRect(),
            raster = card.querySelector(".page-image canvas").getBoundingClientRect()
          return [raster.x - frame.x, raster.y - frame.y, raster.width, raster.height]
        })
        const target = cards.nth(3)
        const point = { clientX: bounds[3].left + bounds[3].width / 4, clientY: bounds[3].top + bounds[3].height / 2 }
        await source.dispatchEvent("dragstart", { dataTransfer: transfer })
        const raster = await transfer.evaluate((data) => {
          const canvas = data.image,
            context = canvas.getContext("2d")
          const edge = (fraction) => {
            const pixels = context.getImageData(0, Math.floor(canvas.height * fraction), canvas.width, 1).data
            return Array.from({ length: canvas.width }, (_, x) => x).find((x) => pixels[x * 4 + 3] > 128)
          }
          return {
            width: canvas.width,
            height: canvas.height,
            top: edge(0.25),
            bottom: edge(0.75),
            color: Array.from(
              context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.7), 1, 1).data,
            ),
          }
        })
        assert.ok(raster.width <= (density === "Compact" ? 84 : 120))
        assert.ok(raster.height <= (density === "Compact" ? 116 : 160))
        assert.ok(raster.color[0] < 64, "The visible page supplies the preview, including in Compact")
        assert.ok(raster.color[3] > 150)
        if (reducedMotion === "reduce")
          assert.equal(raster.top, raster.bottom, "Reduced motion keeps the sheet straight")
        else assert.ok(raster.bottom > raster.top, "The carried page has a slight tilt")
        if (density === "Normal") sizes.set(reducedMotion, raster.width * raster.height)
        else assert.ok(raster.width * raster.height < sizes.get(reducedMotion) * 0.75)
        await target.dispatchEvent("dragover", { dataTransfer: transfer, ...point })
        const hole = output.locator(".drop-placeholder")
        await hole.waitFor()
        if (reducedMotion === "no-preference")
          await page.waitForFunction(
            (id) =>
              document
                .getElementById(id)
                .getAnimations()
                .some((animation) => animation.transitionProperty === "translate"),
            await target.getAttribute("id"),
          )
        assert.equal(
          await target.evaluate((element) => getComputedStyle(element).transitionDuration.split(", ")[0]),
          reducedMotion === "reduce" ? "0s" : "0.45s",
          "Native insertion previews retain their accepted timing",
        )
        await settle()
        const slot = await hole.boundingBox(),
          shifted = await target.boundingBox()
        assert.ok(Math.abs(slot.x - bounds[3].x) < 1 && Math.abs(slot.y - bounds[3].y) < 1)
        assert.ok(
          Math.abs(shifted.x - bounds[4].x) < 1 && Math.abs(shifted.y - bounds[4].y) < 1,
          "The target moves into its neighbor's old slot",
        )
        const ghost = await hole.locator("canvas").evaluate((canvas) => {
          const box = canvas.getBoundingClientRect()
          const scale = Math.min(box.width / canvas.width, box.height / canvas.height)
          const width = canvas.width * scale,
            height = canvas.height * scale
          return {
            image: [box.x + (box.width - width) / 2, box.y + (box.height - height) / 2, width, height],
            opacity: Number(getComputedStyle(canvas).opacity),
            color: Array.from(
              canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.7), 1, 1)
                .data,
            ),
          }
        })
        assert.ok(
          ghost.image.every((value, axis) => Math.abs(value - [slot.x, slot.y, 0, 0][axis] - reference[axis]) < 1),
          `${density}: The destination image matches the card's image bounds (${JSON.stringify({ reference, ghost: ghost.image, slot })})`,
        )
        assert.ok(ghost.opacity > 0 && ghost.opacity < 0.5, "The destination shows a faint copy of the page")
        assert.deepEqual(ghost.color, [0, 0, 0, 255], "The destination keeps the dragged page's content")
        const grid = output.locator(".output-pages")
        for (let step = 0; step < 3; step++)
          await grid.dispatchEvent("dragover", {
            dataTransfer: transfer,
            clientX: slot.x + slot.width / 2,
            clientY: slot.y + slot.height / 2,
          })
        assert.deepEqual(await hole.boundingBox(), slot, "Holding over the open slot does not move it")
        assert.deepEqual(await ids(), before, "Hovering leaves document order unchanged")
        await page.keyboard.press("Escape")
        await settle()
        assert.equal(await hole.count(), 0)
        assert.deepEqual(await ids(), before)
        assert.equal(await output.locator("[data-preview-hidden]").count(), 0)
        await source.dispatchEvent("dragstart", { dataTransfer: transfer })
        await target.dispatchEvent("dragover", { dataTransfer: transfer, ...point })
        await grid.dispatchEvent("drop", { dataTransfer: transfer })
        await cards.nth(7).waitFor()
        const copied = await ids()
        assert.deepEqual(copied.slice(0, 3), before.slice(0, 3))
        assert.deepEqual(copied.slice(4), before.slice(3))
        await output.getByLabel("Page selection", { exact: true }).fill("1,4")
        await settle()
        const groupTarget = cards.nth(6),
          destination = await groupTarget.boundingBox()
        await cards.nth(0).locator(".page-grip").dispatchEvent("dragstart", { dataTransfer: transfer })
        await groupTarget.dispatchEvent("dragover", {
          dataTransfer: transfer,
          clientX: destination.x + destination.width * 0.75,
          clientY: destination.y + destination.height / 2,
        })
        await hole.waitFor()
        assert.equal(await output.locator("[data-preview-hidden]").count(), 2, "Moving pages vacate their old slots")
        await grid.dispatchEvent("drop", { dataTransfer: transfer })
        assert.deepEqual(await ids(), [
          copied[1],
          copied[2],
          copied[4],
          copied[5],
          copied[6],
          copied[0],
          copied[3],
          copied[7],
        ])
        await cards.first().evaluate((card) => {
          card.addEventListener(
            "outrostart",
            () => queueMicrotask(() => card.getAnimations().forEach((animation) => animation.pause())),
            { once: true },
          )
        })
        await output.getByLabel("Page selection", { exact: true }).fill("1")
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        const remaining = output.locator(".composition-card:not([inert])")
        await page.waitForFunction(
          () => document.querySelectorAll(".composition-output .composition-card:not([inert])").length === 7,
        )
        const survivors = await remaining.evaluateAll((items) => items.map((item) => item.id))
        const retired = await source.evaluate((element, data) => {
          element.dispatchEvent(new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer: data }))
          return [...document.querySelectorAll(".composition-output .composition-card.removing")].every(
            (card) => !card.getClientRects().length,
          )
        }, transfer)
        assert.equal(retired, true, "A new drag retires outgoing cards before its first slot measurement")
        const liveTarget = remaining.nth(2),
          liveBounds = await liveTarget.boundingBox()
        await liveTarget.dispatchEvent("dragover", {
          dataTransfer: transfer,
          clientX: liveBounds.x + liveBounds.width / 4,
          clientY: liveBounds.y + liveBounds.height / 2,
        })
        await grid.dispatchEvent("drop", { dataTransfer: transfer })
        const inserted = await remaining.evaluateAll((items) => items.map((item) => item.id))
        assert.deepEqual(inserted.slice(0, 2), survivors.slice(0, 2))
        assert.deepEqual(
          inserted.slice(3),
          survivors.slice(2),
          "A fading removed page cannot move the insertion target",
        )
        await output.getByLabel("Page selection", { exact: true }).fill("1-8")
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        await page.waitForFunction(() => !document.querySelector(".composition-output .composition-card"))
        await source.dispatchEvent("dragstart", { dataTransfer: transfer })
        await output.dispatchEvent("dragover", { dataTransfer: transfer })
        await output.locator(".composition-empty .drop-placeholder").waitFor()
        await output.dispatchEvent("drop", { dataTransfer: transfer })
        assert.equal(await output.locator(".composition-totals strong").textContent(), "1 page")
        assert.equal(await page.locator(".drag-image").count(), 0)
        assert.deepEqual(errors, [])
        await transfer.dispose()
        await page.close()
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Dragging page images and grips preserves selection and page focus", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Gestures.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    await prepared.fill("1-7")
    await prepared.press("Enter")
    await output.getByRole("slider").press("Home")
    await prepared.fill("1,3,3")
    await selected.fill("1,3")
    for (const pane of [input, output]) {
      const target = pane.locator(".composition-card").nth(1).locator(".page-image")
      for (const [selector, modified] of [
        [".page-image", false],
        [".page-grip", false],
        [".page-grip", true],
      ]) {
        const control = pane.locator(".composition-card").nth(2).locator(selector)
        await control.scrollIntoViewIfNeeded()
        await target.focus()
        const bounds = await control.boundingBox()
        const x = bounds.x + bounds.width / 2,
          y = bounds.y + bounds.height / 2
        if (modified) await page.keyboard.down("ControlOrMeta")
        await page.mouse.move(x, y)
        await page.mouse.down()
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.endsWith("page 2"))
        assert.equal(await target.evaluate((element) => element === document.activeElement), true)
        await page.mouse.move(x + 40, y + 40, { steps: 5 })
        await page.waitForFunction(() => !!document.querySelector(".composer")?.getAttribute("data-drag"))
        assert.equal(await prepared.inputValue(), "1,3,3")
        assert.equal(await selected.inputValue(), "1,3")
        assert.equal(
          await target.evaluate((element) => element === document.activeElement),
          true,
          "Starting a native drag preserves existing page focus",
        )
        await page.keyboard.press("Escape")
        await page.mouse.up()
        if (modified) await page.keyboard.up("ControlOrMeta")
        assert.equal(await prepared.inputValue(), "1,3,3")
        assert.equal(await selected.inputValue(), "1,3")
        assert.equal(await target.evaluate((element) => element === document.activeElement), true)
        assert.equal(await output.locator(".composition-totals strong").textContent(), "7 pages")
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Open menus retain page commands from both panes", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    await selected.fill("2")
    await input.getByLabel("Input page actions", { exact: true }).click()
    const thumbnail = output.getByRole("button", { name: "Select Output page 1", exact: true })
    await thumbnail.focus()
    for (const key of ["Shift+ArrowRight", "Space", "Enter", "Delete", "Control+ArrowLeft", "?", "v"]) {
      await page.keyboard.press(key)
      assert.equal(await selected.inputValue(), "2", `${key} retains selection while a menu is open`)
      assert.equal(await output.locator(".composition-totals strong").textContent(), "8 pages")
      assert.equal(await output.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await page.getByRole("dialog", { name: "Help", exact: true }).isVisible(), false)
    }
    await page.keyboard.press("Escape")
    assert.equal(await input.locator(".input-options").evaluate((element) => element.open), false)
    assert.equal(await prepared.inputValue(), "1-4")
    assert.equal(await selected.inputValue(), "2")
    await thumbnail.focus()
    await page.keyboard.press("Delete")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "7 pages")
    await prepared.fill("1")
    await input.getByLabel("Input page actions", { exact: true }).click()
    await prepared.press("Enter")
    assert.equal(
      await output.locator(".composition-totals strong").textContent(),
      "8 pages",
      "The selection field retains its own Enter action after configuring repetitions",
    )
  } finally {
    await browser?.close()
  }
})

test("Grid keyboard selection toggles at the cursor and stops at boundaries", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, theme, textSize] of [
      [1440, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" })
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:theme", choice)
      }, theme)
      await page.goto(server.resolvedUrls.local[0])
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Selection.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ count: 14 }),
        })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      const prepared = input.getByLabel("Page selection", { exact: true })
      await prepared.fill("1-14")
      await prepared.press("Enter")
      if (width === 390)
        await page
          .getByRole("navigation", { name: "Workspace view", exact: true })
          .getByRole("button", { name: "Output", exact: true })
          .click()
      await output.getByLabel("Page selection", { exact: true }).fill("")
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
            .click()
        const panel = name === "Input" ? input : output
        const selection = panel.getByLabel("Page selection", { exact: true })
        const cards = panel.locator("button.page-image")
        const cursor = async (number) => {
          const footers = panel.locator(".composition-card > .input-footer, .composition-card > .occurrence-actions")
          assert.equal(
            await footers
              .locator("button")
              .evaluateAll((buttons) => buttons.every((button) => getComputedStyle(button).visibility === "visible")),
            true,
            "Keyboard navigation keeps individual footer controls visible",
          )
          if (!number || number === 15) {
            await page.waitForFunction(() => document.activeElement?.matches(".composition-grid"))
            assert.equal(
              await cards.evaluateAll((buttons) => buttons.some((button) => button.matches(":focus-visible"))),
              false,
              "No page retains a focus frame at a boundary",
            )
            assert.equal(
              await cards.evaluateAll((buttons) =>
                buttons.some(
                  (button) =>
                    getComputedStyle(button.closest(".composition-card")).borderTopColor ===
                    getComputedStyle(document.querySelector(".workspace-icon")).color,
                ),
              ),
              false,
              "No page retains a cursor contour at a boundary",
            )
          } else {
            await page.waitForFunction(
              (expected) =>
                document.activeElement?.getAttribute("aria-label") ===
                `Select ${expected.name} page ${expected.number}`,
              { name, number },
            )
            assert.equal(
              await panel
                .getByRole("button", { name: `Select ${name} page ${number}`, exact: true })
                .evaluate(hasCursor),
              true,
              "The cursor stays visible on selected and unselected pages",
            )
          }
        }
        const steps = async (scenario) => {
          for (const [key, text, position] of scenario) {
            await page.keyboard.press(key)
            assert.equal(await selection.inputValue(), text, `${name}: ${key}`)
            try {
              await cursor(position)
            } catch (error) {
              error.message += `\n${name}, ${width}px, ${key}: expected page ${position}; focus ${await page.evaluate(() => document.activeElement?.getAttribute("aria-label"))}`
              throw error
            }
          }
        }
        const range = panel.getByRole("slider", { name: `${name} thumbnail range`, exact: true })
        const firstBatch = () => range.press("Home")
        await firstBatch()
        await selection.fill("")
        await cards.first().click()
        assert.equal(await cards.first().evaluate(hasCursor), false, "Pointer selection has no page cursor")
        await steps([
          ["Shift", "1", 2],
          ["Shift+ArrowRight", "1-2", 3],
          ["Shift+ArrowLeft", "1", 2],
          ["Shift+ArrowLeft", "", 0],
          ["Shift+ArrowLeft", "", 0],
          ["ArrowRight", "", 1],
          ["Shift+ArrowRight", "1", 2],
          ["Shift+ArrowRight", "1-2", 3],
          ["ArrowRight", "1-2", 4],
          ["Shift+ArrowRight", "1-2, 4", 5],
          ["Shift+ArrowLeft", "1-2", 4],
          ["Shift+ArrowLeft", "1-3", 3],
          ["Shift+ArrowRight", "1-2", 4],
        ])
        await selection.fill("")
        await (await gridPage(panel, 2)).click()
        await steps([
          ["Shift+ArrowRight", "2-3", 4],
          ["ArrowRight", "2-3", 5],
          ["Shift+ArrowRight", "2-3, 5", 6],
          ["Shift+ArrowRight", "2-3, 5-6", 7],
          ["Shift+ArrowLeft", "2-3, 5", 6],
          ["Shift+ArrowLeft", "2-3", 5],
          ["ArrowLeft", "2-3", 4],
          ["ArrowLeft", "2-3", 3],
          ["Shift+ArrowRight", "2", 4],
          ["Shift+ArrowLeft", "2-3", 3],
          ["Shift+ArrowLeft", "3", 2],
        ])
        await selection.fill(name === "Input" ? "7,7" : "7")
        await (await gridPage(panel, 3)).focus()
        await steps([
          ["Shift+ArrowRight", name === "Input" ? "7, 7, 3" : "3, 7", 4],
          ["Shift+ArrowRight", name === "Input" ? "7, 7, 3-4" : "3-4, 7", 5],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7, 3" : "3, 7", 4],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7" : "7", 3],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7, 2" : "2, 7", 2],
          ["Shift+ArrowRight", name === "Input" ? "7, 7" : "7", 3],
        ])
        await selection.fill("")
        await firstBatch()
        await cards.last().focus()
        const boundary = Number(await panel.locator(".grid-view").getAttribute("data-batch"))
        await steps([
          ["Shift+ArrowRight", String(boundary), boundary + 1],
          ["Shift+ArrowRight", `${boundary}-${boundary + 1}`, boundary + 2],
          ["Shift+ArrowLeft", String(boundary), boundary + 1],
          ["Shift+ArrowLeft", "", boundary === 1 ? 0 : boundary],
        ])
        await range.press("End")
        await panel.getByRole("button", { name: `Select ${name} page 14`, exact: true }).focus()
        await steps([
          ["Shift+ArrowRight", "14", 15],
          ["Shift+ArrowRight", "14", 15],
          ["ArrowRight", "14", 15],
          ["Shift+ArrowLeft", "", 14],
          ["Shift+ArrowRight", "14", 15],
          ["ArrowLeft", "14", 14],
        ])
        await selection.fill("")
        await firstBatch()
        await cards.first().focus()
        for (let number = 1; number <= 14; number++) await page.keyboard.press("Shift+ArrowRight")
        assert.equal(await selection.inputValue(), "1-14")
        await cursor(15)
        for (let number = 14; number >= 1; number--) await page.keyboard.press("Shift+ArrowLeft")
        assert.equal(await selection.inputValue(), "")
        await cursor(0)
        if (name === "Input") {
          await selection.fill("1,9-10")
          await cards.first().focus()
          await page.keyboard.press("Delete")
          assert.equal(await selection.inputValue(), "1,9-10", "Delete keeps immutable Input pages and preparation")
        } else {
          const total = () => output.locator(".composition-totals strong").textContent()
          await selection.fill("1,13-14")
          await (await gridPage(panel, 2)).focus()
          await cards.last().dispatchEvent("keydown", { key: "Delete", repeat: true })
          await page.keyboard.press("Alt+Delete")
          assert.equal(await total(), "14 pages", "Held or modified Delete keeps the composition")
          await page.keyboard.press("Delete")
          assert.equal(await total(), "11 pages")
          assert.equal(await selection.inputValue(), "")
          await cursor(1)
          await page.keyboard.press("Space")
          await page.keyboard.press("Delete")
          assert.equal(await total(), "10 pages")
          await cursor(1)
          await selection.fill("1-10")
          await cards.last().press("ArrowRight")
          await page.keyboard.press("Delete")
          await output.locator(".composition-empty").waitFor()
          assert.equal(
            await output
              .getByRole("tab", { name: "Grid", exact: true })
              .evaluate((element) => element === document.activeElement),
            true,
            "Removing every page from a boundary returns focus to its view tab",
          )
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Selection bars expose meaningful actions in both panes", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Selection.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    const inputAll = input.getByRole("button", { name: "Select all", exact: true })
    const inputClear = input.getByRole("button", { name: "Clear page sequence", exact: true })
    const add = input.getByRole("button", { name: "Add to Output", exact: true })
    const group = output.getByRole("group", { name: "Selected Output pages", exact: true })
    assert.equal(await selected.isDisabled(), true)
    assert.equal(await output.locator(".sequence-entry button, .sequence-options").count(), 0)
    assert.equal(await inputClear.count(), 0)
    assert.equal(await add.count(), 0)
    assert.equal(await input.locator(".input-footer button").count(), 7)
    assert.equal(
      await input.locator(".sequence-entry > .entry > :first-child").getAttribute("class"),
      "sequence-options input-options",
    )
    await prepared.fill("99")
    assert.equal(await prepared.getAttribute("aria-invalid"), "true")
    assert.equal(await add.count(), 0)
    await inputClear.click()
    await input.getByLabel("Input page actions", { exact: true }).click()
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
    await page.keyboard.press("Escape")
    assert.equal(await inputClear.count(), 1, "Configuration can be cleared before selecting pages")
    await inputClear.click()
    for (const [text, all, copies] of [
      ["4", 1, 1],
      ["4,2,2", 1, 3],
      ["1-7", 0, 7],
      ["7,1-6", 1, 7],
      ["1-7,1", 1, 8],
    ]) {
      await prepared.fill(text)
      assert.equal(await inputAll.count(), all, text)
      assert.equal(await input.locator(".input-footer button").count(), 0, text)
      assert.match(await input.locator(".sequence-help").innerText(), new RegExp(`${copies} pages? selected`))
    }
    await prepared.fill("2,")
    assert.equal(await add.isDisabled(), true, "Invalid text keeps the last preparation but blocks addition")
    await inputAll.click()
    assert.equal(await prepared.inputValue(), "1-7")
    assert.equal(await prepared.evaluate((element) => element === document.activeElement), true)
    await tab(input, "Page")
    assert.equal(await input.locator(".page-actions button").count(), 0)
    await inputClear.click()
    assert.equal(await input.locator(".page-actions button").count(), 1)
    await tab(input, "Grid")
    await prepared.fill("1-7")
    await add.click()
    assert.equal(await prepared.evaluate((element) => element === document.activeElement), true)
    assert.equal(await inputClear.count(), 0)
    assert.equal(await input.locator(".input-footer button").count(), 7)
    assert.equal(
      await output.locator(".sequence-entry > .entry > :first-child").getAttribute("class"),
      "sequence-options output-options",
    )
    for (const [text, earlier, later] of [
      ["", false, false],
      ["1", false, true],
      ["4", true, true],
      ["7", true, false],
      ["2-4", true, true],
      ["1-3", false, true],
      ["5-7", true, false],
      ["1-7", false, false],
      ["1,7", false, false],
      ["2,4", true, true],
    ]) {
      await selected.fill(text)
      const expected = text
        ? [
            "Move selected pages earlier",
            "Move selected pages later",
            "Remove selected Output pages",
            "Duplicate selected Output pages",
          ]
        : []
      assert.deepEqual(
        await group
          .getByRole("button")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        expected,
        text,
      )
      if (text) {
        assert.equal(
          await group.getByRole("button", { name: "Move selected pages earlier", exact: true }).isEnabled(),
          earlier,
          text,
        )
        assert.equal(
          await group.getByRole("button", { name: "Move selected pages later", exact: true }).isEnabled(),
          later,
          text,
        )
      }
      await output.getByLabel("Output page actions", { exact: true }).click()
      assert.deepEqual(
        await output
          .getByRole("button", { name: /^Move selected pages/ })
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        text ? ["Move selected pages earlier", "Move selected pages later"] : [],
        text,
      )
      if (text) {
        assert.equal(
          await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).isEnabled(),
          earlier,
          text,
        )
        assert.equal(
          await output.getByRole("button", { name: "Move selected pages later", exact: true }).isEnabled(),
          later,
          text,
        )
      }
      await page.keyboard.press("Escape")
      assert.equal(await output.locator(".occurrence-actions button").count(), text ? 0 : 14, text)
      assert.equal(
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).count(),
        text ? 1 : 0,
        text,
      )
      assert.equal(
        await output.getByRole("button", { name: "Select all", exact: true }).count(),
        text === "1-7" ? 0 : 1,
        text,
      )
    }
    await output.getByLabel("Output page actions", { exact: true }).click()
    assert.equal(await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).count(), 0)
    assert.match(await output.locator(".menu-options").innerText(), /Select consecutive pages/)
    await page.keyboard.press("Escape")
    await selected.fill("2-4")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("1")
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 0)
    await output.getByLabel("Start each repeat on front", { exact: true }).check()
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 1)
    await page.keyboard.press("Escape")
    await selected.fill("2,")
    assert.equal(
      await group.getByRole("button").evaluateAll((buttons) => buttons.every((button) => button.disabled)),
      true,
    )
    await selected.fill("1")
    await tab(output, "Page")
    assert.equal(await output.locator(".page-actions button").count(), 0)
    await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Space")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "8 pages")
    assert.equal(await selected.inputValue(), "1")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    assert.equal(await output.locator(".page-actions button").count(), 2)
    await tab(output, "Grid")
    await selected.fill("1-8")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await prepared.fill("3,1,3")
    await add.click()
    assert.deepEqual(await output.locator(".page-origin-info .page-context").allTextContents(), [
      "p. 3",
      "p. 1",
      "p. 3",
    ])
    assert.equal(await selected.inputValue(), "1-3")
    await output.getByLabel("Output page actions", { exact: true }).focus()
    await page.keyboard.press("Delete")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "0 pages")
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      "Removing all pages returns focus when the menu control disappears",
    )
  } finally {
    await browser?.close()
  }
})

test("Output separates page controls from group actions for keyboard and mouse", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const interaction of ["keyboard", "mouse"]) {
      // Keep all ten pages visible while checking group actions across copies.
      const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Groups.pdf", mimeType: "application/pdf", buffer: fixture() })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const prepared = input.getByRole("textbox", { name: "Page selection", exact: true })
      const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
      const total = () => output.locator(".composition-totals strong").textContent()
      const contents = () =>
        output.locator(".composition-card:not([inert]) .page-origin-info .page-context").allTextContents()
      if (interaction === "keyboard") {
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).press("Space")
        await page.keyboard.press("Enter")
      } else {
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
      }
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      if (interaction === "keyboard") {
        await input.getByRole("button", { name: "Select Input page 2", exact: true }).focus()
        await page.keyboard.press("Shift+ArrowRight")
        await page.keyboard.press("Shift+ArrowRight")
        await page.keyboard.press("Shift+ArrowRight")
        await page.keyboard.press("Enter")
      } else {
        await input.getByRole("button", { name: "Select Input page 2", exact: true }).click()
        await input.getByRole("button", { name: "Select Input page 4", exact: true }).click({ modifiers: ["Shift"] })
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      }
      assert.equal(await total(), "4 pages", "Addition transfers every selected Input page")
      assert.equal(await prepared.inputValue(), "", "Successful group addition resets the preparation")
      assert.equal(await selected.inputValue(), "2-4")
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3", "p. 4"])
      assert.equal(
        await output.locator(".composition-card.range-highlight").count(),
        3,
        "Addition highlights the new group",
      )
      assert.equal(
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).isDisabled(),
        true,
      )
      assert.equal(
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).isEnabled(),
        true,
        "Removal remains meaningful for a group",
      )
      assert.match(await output.locator(".sequence-help").innerText(), /3 pages selected/)
      assert.match(await output.locator(".sequence-help").innerText(), /Use the selection bar/)
      assert.equal(
        await output.locator(".occurrence-actions button").count(),
        0,
        "Selection temporarily removes every individual card action",
      )
      await selected.fill("99")
      await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Enter")
      assert.equal(await total(), "4 pages", "Invalid selection text blocks group edits")
      await selected.fill("2-4")
      if (interaction === "keyboard") {
        await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Control+ArrowLeft")
      } else {
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
      }
      assert.deepEqual(
        await contents(),
        ["p. 2", "p. 3", "p. 4", "p. 1"],
        "Movement keeps the selected pages together and in order",
      )
      assert.equal(await selected.inputValue(), "1-3")
      assert.equal(
        await output.locator(".composition-card.range-highlight").count(),
        3,
        "Movement highlights the moved group",
      )
      if (interaction === "keyboard") await page.keyboard.press("Control+ArrowRight")
      else {
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
      }
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3", "p. 4"])
      for (const position of [4, 7]) {
        if (interaction === "keyboard") await page.keyboard.press("Shift+Equal")
        else await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
        assert.equal(await total(), `${position + 3} pages`, "Each addition makes exactly one group copy")
        assert.equal(await selected.inputValue(), `${position + 1}-${position + 3}`)
        assert.equal(
          await output.locator(".composition-card.range-highlight").count(),
          3,
          "Duplication highlights the new group copy",
        )
      }
      assert.deepEqual(await contents(), [
        "p. 1",
        "p. 2",
        "p. 3",
        "p. 4",
        "p. 2",
        "p. 3",
        "p. 4",
        "p. 2",
        "p. 3",
        "p. 4",
      ])
      if (interaction === "keyboard") await page.keyboard.press("Delete")
      else await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await total(), "7 pages", "Removal removes the selected copy and leaves other copies intact")
      await selected.fill("5-7")
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 7", exact: true }).press("-")
      else await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await total(), "4 pages")
      await selected.fill("2,4")
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Enter")
      else await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
      assert.deepEqual(
        await contents(),
        ["p. 1", "p. 2", "p. 3", "p. 4", "p. 2", "p. 4"],
        "Nonconsecutive targets copy in print order",
      )
      await selected.fill("2,4")
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Control+ArrowLeft")
      else {
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
      }
      assert.equal(await selected.inputValue(), "1, 3", "Movement preserves gaps in the selection")
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      assert.equal(await selected.inputValue(), "")
      assert.equal(await selected.evaluate((element) => element === document.activeElement), true)
      await selected.fill("1")
      assert.equal(await output.locator(".occurrence-actions button").count(), 0)
      const group = output.getByRole("group", { name: "Selected Output pages", exact: true })
      assert.deepEqual(
        await group
          .getByRole("button")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        [
          "Move selected pages earlier",
          "Move selected pages later",
          "Remove selected Output pages",
          "Duplicate selected Output pages",
        ],
      )
      assert.match(await output.locator(".sequence-help").innerText(), /1 page selected/)
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      assert.equal(await output.getByRole("button", { name: "Clear Output selection", exact: true }).count(), 0)
      assert.equal(await group.count(), 0)
      await output.getByRole("button", { name: "Duplicate Output page 4", exact: true }).click()
      assert.deepEqual(
        await contents(),
        ["p. 2", "p. 1", "p. 4", "p. 3", "p. 3", "p. 2", "p. 4"],
        "Without a selection, a card action uses its own occurrence",
      )
      await selected.fill("2,4")
      await selected.press("End")
      await selected.press(",")
      await selected.press("6")
      assert.equal(await selected.inputValue(), "2,4,6")
      assert.equal(await selected.evaluate((element) => element === document.activeElement), true)
      assert.match(await output.locator(".sequence-help").innerText(), /3 pages selected/)
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test(
  "Grid shortcuts resolve both pane selections and allow mouse then keyboard actions",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      const warnings = []
      page.on("console", (entry) => {
        if (entry.type() === "warning") warnings.push(entry.text())
      })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
      })
      await page.goto(server.resolvedUrls.local[0])
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Selections.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const prepared = input.getByLabel("Page selection", { exact: true })
      const selected = output.getByLabel("Page selection", { exact: true })
      const contents = () =>
        output.locator(".composition-card:not([inert]) .page-origin-info .page-context").allTextContents()
      const clear = async () => {
        if (!(await selected.isDisabled())) {
          const all = output.getByRole("button", { name: "Select all", exact: true })
          if (await all.count()) await all.click()
          await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        }
        const reset = input.getByRole("button", { name: "Clear page sequence", exact: true })
        if (await reset.count()) await reset.click()
      }
      for (const pane of ["Input", "Output"]) {
        for (const inputSelection of [false, true]) {
          for (const outputSelection of [false, true]) {
            for (const key of [
              "Enter",
              "Shift+Equal",
              "Delete",
              "-",
              "Control+ArrowLeft",
              "Control+ArrowRight",
              "Escape",
            ]) {
              await clear()
              await prepared.fill("1-4")
              await prepared.press("Enter")
              if (outputSelection) await selected.fill("2,4")
              else await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
              if (inputSelection) await prepared.fill("2-3")
              const current = (pane === "Input" ? input : output).getByRole("button", {
                name: `Select ${pane} page 1`,
                exact: true,
              })
              await current.focus()
              if (key === "Escape") await page.mouse.move(pane === "Input" ? 8 : 1432, 20)
              await page.keyboard.press(key)
              let expected = ["p. 1", "p. 2", "p. 3", "p. 4"]
              if (pane === "Input" && key === "Enter" && inputSelection) {
                expected.push("p. 2", "p. 3")
              } else if (pane === "Output" && outputSelection && ["Enter", "Shift+Equal"].includes(key)) {
                expected.push("p. 2", "p. 4")
              } else if (key === "Delete" || (pane === "Output" && key === "-")) {
                if (outputSelection) expected = ["p. 1", "p. 3"]
              } else if (outputSelection && key === "Control+ArrowLeft") {
                expected = ["p. 2", "p. 1", "p. 4", "p. 3"]
              }
              const scenario = `${pane} ${key}; Input selection=${inputSelection}, Output selection=${outputSelection}`
              assert.deepEqual(await contents(), expected, scenario)
              assert.equal(
                await prepared.inputValue(),
                inputSelection && !(pane === "Input" && ["Escape", "Enter"].includes(key)) ? "2-3" : "",
                scenario,
              )
              if (key === "Escape") {
                assert.equal(await selected.inputValue(), pane === "Input" && outputSelection ? "2,4" : "", scenario)
                assert.equal(
                  await (pane === "Input" ? input : output)
                    .getByRole("tab", { name: "Grid", exact: true })
                    .evaluate((element) => element === document.activeElement),
                  true,
                  "Escape ends page navigation without leaving a cursor on an unselected page",
                )
              }
            }
          }
        }
      }
      for (const selectInputAgain of [false, true]) {
        await clear()
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).click()
        await input.getByRole("button", { name: "Select Input page 3", exact: true }).click({ modifiers: ["Shift"] })
        await page.keyboard.press("Enter")
        assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"])
        assert.equal(await selected.inputValue(), "1-3")
        assert.equal(await prepared.inputValue(), "")
        if (selectInputAgain) await input.getByRole("button", { name: "Select Input page 1", exact: true }).click()
        await page.keyboard.press("Delete")
        assert.deepEqual(
          await contents(),
          [],
          "Input → Enter → Delete removes the new Output group without changing pane",
        )
        assert.equal(
          await prepared.inputValue(),
          selectInputAgain ? "1" : "",
          "Output removal preserves Input selection",
        )
      }
      await clear()
      await prepared.fill("1-3")
      await prepared.press("Enter")
      await selected.fill("2-3")
      await prepared.fill("1")
      await prepared.press("Delete")
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"], "Delete in a text field only edits text")
      await output.getByLabel("Output page actions", { exact: true }).click()
      await page.keyboard.press("Delete")
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"], "Open menus retain their keys")
      await page.keyboard.press("Escape")
      await page.keyboard.press("Delete")
      assert.deepEqual(await contents(), ["p. 1"], "Delete works again after a menu closes")
      await clear()
      await prepared.fill("1-3")
      await prepared.press("Enter")
      await selected.fill("2-3")
      await output.getByRole("button", { name: "Select Output page 1", exact: true }).click()
      await page.keyboard.press("Enter")
      assert.deepEqual(
        await contents(),
        ["p. 1", "p. 2", "p. 3", "p. 1", "p. 2", "p. 3"],
        "Mouse selection can immediately duplicate with Enter",
      )
      await page.keyboard.press("Delete")
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"], "The copied group can immediately be removed")
      await prepared.fill("2-3")
      await selected.fill("1-3")
      await page.locator(".input-picker > summary").click()
      await page.keyboard.press("Escape")
      assert.equal(await prepared.inputValue(), "2-3", "Closing the Input chooser preserves preparation")
      assert.equal(await selected.inputValue(), "1-3", "Closing the Input chooser preserves Output selection")
      const inputOptions = input.getByLabel("Input page actions", { exact: true })
      const outputOptions = output.getByLabel("Output page actions", { exact: true })
      await inputOptions.click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("3")
      await input.getByLabel("Start each repeat on front", { exact: true }).check()
      await page.keyboard.press("Escape")
      await outputOptions.click()
      await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("4")
      await output.getByLabel("Start each repeat on front", { exact: true }).check()
      await page.keyboard.press("Escape")
      await outputOptions.dispatchEvent("keydown", { key: "Escape", repeat: true })
      assert.equal(await prepared.inputValue(), "2-3", "Held Escape does not clear after dismissing a menu")
      assert.equal(await selected.inputValue(), "1-3")
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.keyboard.press("Escape")
      assert.equal(await prepared.inputValue(), "2-3", "Closing a dialog preserves Input preparation")
      assert.equal(await selected.inputValue(), "1-3", "Closing a dialog preserves Output selection")
      await page.mouse.move(8, 20)
      await page.keyboard.press("Escape")
      assert.equal(await prepared.inputValue(), "", "Escape also works after a dialog returns focus to Help")
      assert.equal(await selected.inputValue(), "1-3", "Clearing Input preserves Output selection")
      await page.mouse.move(1432, 20)
      await page.keyboard.press("Escape")
      assert.equal(await selected.inputValue(), "")
      await inputOptions.click()
      assert.equal(await input.getByRole("textbox", { name: "Repetitions", exact: true }).inputValue(), "1")
      assert.equal(await input.getByLabel("Start each repeat on front", { exact: true }).isChecked(), false)
      await page.keyboard.press("Escape")
      await selected.fill("1-3")
      await outputOptions.click()
      assert.equal(
        await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).inputValue(),
        "2",
      )
      assert.equal(await output.getByLabel("Start each repeat on front", { exact: true }).isChecked(), false)
      await page.keyboard.press("Escape")
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await clear()
        await page.emulateMedia({ reducedMotion })
        await prepared.fill("1-3")
        await prepared.press("Enter")
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).focus()
        await output.locator(".composition-card").evaluateAll((cards) => {
          window.removalFrames = []
          for (const card of cards)
            card.addEventListener("outrostart", () =>
              queueMicrotask(() => {
                window.removalFrames.push({
                  inert: card.inert,
                  removing: card.classList.contains("removing"),
                  fade: card.getAnimations().some((animation) => animation.effect.getTiming().duration === 300),
                })
                // Deliver a resize while the last cards are still fading.
                const grid = card.closest(".grid-view")
                if (grid) grid.style.inlineSize = "calc(100% - 1px)"
              }),
            )
        })
        await page.keyboard.press("Delete")
        assert.equal(
          await output.locator(".composition-totals strong").textContent(),
          "0 pages",
          "Removal changes data immediately",
        )
        await page.waitForFunction(() => window.removalFrames.length === 3)
        assert.deepEqual(
          await page.evaluate(() => window.removalFrames),
          Array.from({ length: 3 }, () => ({ inert: true, removing: true, fade: reducedMotion === "no-preference" })),
          "All removed cards receive feedback and cannot receive input",
        )
        await page.waitForFunction(() => !document.querySelector(".output-pages .composition-card"))
      }
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.mouse.move(0, 0)
      assert.equal(
        await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).isVisible(),
        true,
        "Returning to the mouse restores individual controls after keyboard navigation",
      )
      await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).click()
      assert.equal(
        await input
          .getByRole("button", { name: "Select Input page 4", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      )
      await tab(input, "Page")
      assert.match(await pagePosition(input), /4\s*\/ 7/, "A card addition updates the page opened for inspection")
      await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).click()
      assert.equal(
        await input
          .getByRole("region", { name: "PDF viewport", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Input Page addition keeps normal focus in Input",
      )
      await tab(output, "Page")
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
      assert.equal(
        await output
          .getByRole("region", { name: "PDF viewport", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Output Page editing retains normal viewport focus",
      )
      assert.equal(
        await output.locator(".sequence-entry.range-highlight").count(),
        1,
        "Page editing highlights its updated selection controls",
      )
      await prepared.fill("1")
      await page.mouse.move(1432, 20)
      await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Escape")
      assert.equal(await prepared.inputValue(), "1")
      assert.equal(await selected.inputValue(), "")
      assert.equal(
        await output
          .getByRole("tab", { name: "Page", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Escape ends Page navigation as well as Grid navigation",
      )
      await prepared.fill("99")
      await selected.fill("1")
      await page.mouse.move(8, 20)
      await prepared.press("Escape")
      assert.equal(await prepared.inputValue(), "", "Escape clears invalid field text like Clear")
      assert.equal(await prepared.getAttribute("aria-invalid"), "false")
      assert.equal(await selected.inputValue(), "1")
      await prepared.fill("1")
      await selected.fill("1")
      await output.getByRole("button", { name: "Go to Output page", exact: true }).click()
      const entry = output.getByRole("textbox", { name: "Go to Output page", exact: true })
      await entry.fill("2")
      await entry.press("Escape")
      assert.equal(await prepared.inputValue(), "1", "Cancelling page entry preserves Input preparation")
      assert.equal(await selected.inputValue(), "1", "Cancelling page entry preserves Output selection")
      await page.keyboard.press("Escape")
      assert.equal(await prepared.inputValue(), "1", "Clearing Output preserves Input preparation")
      assert.equal(await selected.inputValue(), "")
      assert.deepEqual(warnings, [])
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Escape clears the target selection without moving inspection or scroll positions",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const [name, width, scale, theme] of [
        ["Input", 1440, 100, "light"],
        ["Output", 1440, 100, "light"],
        ["Input", 390, 200, "dark"],
        ["Output", 390, 200, "dark"],
      ]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 500 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page.locator("input[type=file]").first().setInputFiles({
          name: "Position.pdf",
          mimeType: "application/pdf",
          buffer: fixture(),
        })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        const prepared = input.getByLabel("Page selection", { exact: true })
        const selected = output.getByLabel("Page selection", { exact: true })
        const pane = name === "Input" ? input : output
        await prepared.fill("1-7")
        await prepared.press("Enter")
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
        for (const mode of ["Grid", "Page"]) {
          await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
          await page.setViewportSize({ width: 1440, height: 500 })
          await prepared.fill("2-3")
          await selected.fill("1-3")
          if (mode === "Grid") {
            await (await gridPage(pane, 6)).focus()
            await page.keyboard.press("ArrowRight")
          } else {
            await zoom(pane, "Zoom in")
            await zoom(pane, "Zoom in")
          }
          await page.setViewportSize({ width, height: 500 })
          await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), scale)
          if (width === 390)
            await page
              .getByRole("navigation", { name: "Workspace view", exact: true })
              .getByRole("button", { name, exact: true })
              .click()
          if (mode === "Page") {
            await page.waitForFunction(
              () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
            )
            await pane.getByRole("region", { name: "PDF viewport", exact: true }).evaluate((element) => {
              element.scrollTop = 200
              element.scrollLeft = 50
              element.focus({ preventScroll: true })
            })
          } else await (await gridPage(pane, 7)).focus()
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }))
          assert.ok(before.y > 0, "The view tab is above the current viewport")
          const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
          const region =
            mode === "Page"
              ? await viewport.evaluate((element) => ({ x: element.scrollLeft, y: element.scrollTop }))
              : undefined
          await page.mouse.move(name === "Input" ? 8 : width - 8, 20)
          await page.keyboard.press("Escape")
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          assert.equal(await prepared.inputValue(), name === "Input" ? "" : "2-3")
          assert.equal(await selected.inputValue(), name === "Output" ? "" : "1-3")
          assert.deepEqual(
            await page.evaluate(() => ({ x: scrollX, y: scrollY })),
            await page.evaluate(
              (position) => ({
                x: position.x,
                y: Math.min(position.y, document.documentElement.scrollHeight - innerHeight),
              }),
              before,
            ),
            `${name} ${mode}: Escape keeps the window position within the document bounds`,
          )
          if (mode === "Page") {
            assert.deepEqual(
              await viewport.evaluate((element) => ({ x: element.scrollLeft, y: element.scrollTop })),
              region,
            )
            assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), "200%")
          } else await tab(pane, "Page")
          assert.match(await pagePosition(pane), /7\s*\/ 7/, "Escape preserves the inspected page")
        }
        await page.close()
      }
    } finally {
      await browser?.close()
    }
  },
)

test("Selection and view shortcuts target the mouse pane and preserve native keys", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Shortcuts.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ count: 13 }),
      })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("button", { name: "Normal Input grid", exact: true }).press("Space")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    await prepared.fill("1-13")
    await prepared.press("Enter")
    await prepared.fill("2,4")
    await selected.fill("3,5")
    await output.locator(".page-image").first().focus()
    await page.keyboard.press("Control+a")
    assert.equal(await selected.inputValue(), "1-13", "Before mouse use, shortcuts follow the focused pane")
    assert.equal(await prepared.inputValue(), "2,4")
    await page.keyboard.press("Escape")
    assert.equal(await selected.inputValue(), "")
    assert.equal(await prepared.inputValue(), "2,4")
    for (const mode of ["Grid", "Page"]) {
      await tab(input, mode)
      await tab(output, mode)
      for (const [name, pane, other, x] of [
        ["Input", input, output, 8],
        ["Output", output, input, 1432],
      ]) {
        await prepared.fill("2,4")
        await selected.fill("3,5")
        const focus =
          mode === "Grid"
            ? other.locator(".page-image").first()
            : other.getByRole("region", { name: "PDF viewport", exact: true })
        await focus.focus()
        await page.mouse.move(x, 20)
        for (const key of ["Control+a", "Control+a", "Meta+a"]) {
          await page.keyboard.press(key)
          assert.equal(await prepared.inputValue(), name === "Input" ? "1-13" : "2,4")
          assert.equal(await selected.inputValue(), name === "Output" ? "1-13" : "3,5")
          assert.equal(
            await focus.evaluate((element) => element === document.activeElement),
            true,
            `${name} ${mode}: selecting the mouse pane preserves focus in the other pane`,
          )
        }
        await page.keyboard.press("Escape")
        assert.equal(await prepared.inputValue(), name === "Input" ? "" : "2,4")
        assert.equal(await selected.inputValue(), name === "Output" ? "" : "3,5")
        assert.equal(
          await pane
            .getByRole("tab", { name: mode, exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        )
      }
    }
    await prepared.fill("2,4")
    await selected.fill("3,5")
    await page.mouse.move(1432, 20)
    await prepared.focus()
    await page.keyboard.press("ControlOrMeta+a")
    assert.deepEqual(await prepared.evaluate((element) => [element.selectionStart, element.selectionEnd]), [0, 3])
    assert.equal(await selected.inputValue(), "3,5", "The native select-all shortcut selects field text")
    await prepared.press("v")
    assert.equal(await prepared.inputValue(), "v", "Fields retain letter entry")
    await prepared.fill("2,4")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await page.keyboard.press("Control+a")
    assert.equal(await selected.inputValue(), "3,5", "An open menu keeps selection shortcuts")
    await page.keyboard.press("Escape")
    assert.equal(await prepared.inputValue(), "2,4")
    assert.equal(await selected.inputValue(), "3,5", "Escape closes the menu before clearing selection")
    await tab(input, "Grid")
    await tab(output, "Page")
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).focus()
    await page.mouse.move(1432, 20)
    for (const [key, number] of [
      ["End", 13],
      ["Home", 1],
    ]) {
      await page.keyboard.press(key)
      assert.equal(
        await input
          .getByRole("button", { name: `Select Input page ${number}`, exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Grid Home/End keep their focus target",
      )
      assert.equal(await prepared.inputValue(), "2,4")
      assert.match(await pagePosition(output), /1\s*\/ 13/, "Grid navigation does not browse the other Page")
    }
    await page.mouse.move(8, 20)
    await output.getByRole("region", { name: "PDF viewport", exact: true }).focus()
    await page.keyboard.press("v")
    const viewport = input.getByRole("region", { name: "PDF viewport", exact: true })
    assert.equal(await viewport.evaluate((element) => element === document.activeElement), true)
    assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
    await page.keyboard.press("Tab")
    assert.equal(
      await viewport.evaluate((element) => element === document.activeElement),
      false,
      "Tab moves focus normally",
    )
    await page.keyboard.press("Shift+Tab")
    assert.equal(await viewport.evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press("Shift+V")
    assert.equal(
      await input
        .getByRole("button", { name: "Select Input page 1", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    )
    assert.equal(await prepared.inputValue(), "2,4")
    assert.equal(await selected.inputValue(), "3,5")
    await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
    const action = input.getByRole("button", { name: "Add Input page 1 to Output", exact: true })
    await action.focus()
    await page.mouse.move(8, 20)
    await page.keyboard.press("Control+a")
    assert.equal(
      await prepared.evaluate((element) => element === document.activeElement),
      true,
      "When selection removes the focused footer action, focus returns to the field",
    )
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark"
      document.documentElement.style.fontSize = "200%"
    })
    for (const [name, pane] of [
      ["Input", input],
      ["Output", output],
    ]) {
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name, exact: true })
        .click()
      const pages = pane.getByLabel("Page selection", { exact: true })
      await pages.fill("2,4")
      await pane.getByRole("tab", { name: name === "Input" ? "Grid" : "Page", exact: true }).focus()
      await page.mouse.move(name === "Input" ? 382 : 8, 20)
      await page.keyboard.press("Control+a")
      assert.equal(await pages.inputValue(), "1-13", "The visible mobile pane receives shortcuts from either half")
      await page.keyboard.press("Escape")
      assert.equal(await pages.inputValue(), "")
    }
  } finally {
    await browser?.close()
  }
})

test("Page and Grid keyboard actions respect key priority and the visible page order", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Keyboard.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    const total = () => output.locator(".composition-totals strong").textContent()
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).waitFor()
    const cards = input.locator("button.page-image")
    await input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }).click()
    assert.equal(await selection.inputValue(), "1", "Clicking a grip selects the page")
    assert.equal(
      await cards
        .first()
        .evaluate((element) => getComputedStyle(element.closest(".composition-card")).outlineStyle === "dashed"),
      false,
      "Mouse selection does not add a keyboard focus frame",
    )
    await page.keyboard.press("Space")
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("ArrowUp")
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".composition-grid")), true)
    await page.keyboard.press("ArrowRight")
    assert.equal(await cards.first().evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press("ArrowRight")
    assert.equal(await cards.nth(1).evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press("Shift+P")
    assert.equal(await cards.first().evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press("n")
    assert.equal(await cards.nth(1).evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press("ArrowDown")
    assert.equal(await cards.nth(4).evaluate((element) => element === document.activeElement), true)
    await page.keyboard.press("ArrowUp")
    assert.equal(await cards.nth(1).evaluate((element) => element === document.activeElement), true)
    assert.equal(await selection.inputValue(), "")
    await page.keyboard.press("Space")
    assert.equal(await selection.inputValue(), "2")
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Input page 3")
    assert.equal(await cards.nth(2).evaluate(hasCursor), true, "The keyboard position has a secondary contour")
    await page.keyboard.press("Enter")
    assert.equal(await total(), "1 page")
    await cards.nth(1).dispatchEvent("keydown", { key: "Enter", repeat: true })
    assert.equal(await total(), "1 page")
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus()
    assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1")
    await page.keyboard.press("Enter")
    assert.equal(await total(), "2 pages")
    await page.keyboard.press("ArrowRight")
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".composition-grid")), true)
    await page.keyboard.press("ArrowLeft")
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus()
    await page.keyboard.press("ArrowRight")
    for (const [key, position] of [
      ["n", 0],
      ["p", 2],
      ["p", 1],
      ["Shift+N", 2],
    ]) {
      await page.keyboard.press(key)
      if (!position) assert.equal(await page.evaluate(() => document.activeElement?.matches(".composition-grid")), true)
      else
        assert.equal(
          await output
            .getByRole("button", { name: `Select Output page ${position}`, exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        )
      assert.equal(await total(), "2 pages", "N/P navigate without editing the composition")
    }
    await page.keyboard.press("Space")
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus()
    await page.keyboard.press("Control+ArrowLeft")
    assert.equal(
      await output
        .getByRole("button", { name: "Select Output page 2", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await page.keyboard.press("Control+ArrowLeft")
    assert.equal(await total(), "2 pages")
    const movingCard = await output.locator(".composition-card").last().getAttribute("id")
    for (const [key, position] of [
      ["Control+ArrowRight", 1],
      ["Control+ArrowRight", 1],
      ["Control+ArrowLeft", 2],
      ["Control+ArrowLeft", 2],
      ["Control+ArrowRight", 1],
      ["Control+ArrowLeft", 2],
    ]) {
      await page.keyboard.press(key)
      assert.deepEqual(
        await output.locator(".output-pages").evaluate(() => {
          const focused = document.activeElement
          const card = focused?.closest(".composition-card")
          return {
            id: card?.id,
            name: focused?.getAttribute("aria-label"),
            frame: card && getComputedStyle(card).outlineStyle,
          }
        }),
        { id: movingCard, name: `Select Output page ${position}`, frame: "none" },
        "Movement retains the same page focus without a separate card frame",
      )
    }
    await page.keyboard.press("Shift+Equal")
    assert.equal(await total(), "3 pages")
    await page.keyboard.press("-")
    assert.equal(await total(), "2 pages")
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).waitFor()
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 2")
    await page.keyboard.press("p")
    await ready()
    await cards.nth(1).press("v")
    await tab(output, "Page")
    const inputViewport = input.getByRole("region", { name: "PDF viewport", exact: true })
    const outputViewport = output.getByRole("region", { name: "PDF viewport", exact: true })
    await page.setViewportSize({ width: 1440, height: 600 })
    for (const pane of [input, output]) {
      const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
      await zoom(pane, "Reset zoom")
      await viewport.evaluate((element) => element.scrollIntoView({ block: "start" }))
      let bounds = await viewport.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, Math.max(bounds.y, 0) + 100)
      const beforeFit = await page.evaluate(() => scrollY)
      await page.mouse.wheel(0, -120)
      await page.waitForFunction((before) => scrollY < before, beforeFit)
      assert.equal(await viewport.evaluate((element) => element.scrollTop), 0)

      await zoom(pane, "Zoom in")
      await ready()
      await viewport.evaluate((element) => {
        element.scrollIntoView({ block: "start" })
        element.scrollTop = 0
      })
      bounds = await viewport.boundingBox()
      await page.mouse.move(bounds.x + bounds.width / 2, Math.max(bounds.y, 0) + 100)
      const beforeZoom = await page.evaluate(() => scrollY)
      await page.mouse.wheel(0, 120)
      await page.waitForFunction((element) => element.scrollTop > 0, await viewport.elementHandle())
      assert.equal(await page.evaluate(() => scrollY), beforeZoom)
      await viewport.evaluate((element) => (element.scrollTop = element.scrollHeight))
      await page.mouse.wheel(0, 120)
      await page.waitForTimeout(100)
      assert.equal(await page.evaluate(() => scrollY), beforeZoom, "Zoom contains wheel scrolling at an edge")

      for (const key of ["0", "z", "Shift+Z"]) {
        await viewport.focus()
        await page.keyboard.press(key)
        assert.equal(await pane.locator(".page-tools output").innerText(), "100%")
        if (key !== "Shift+Z") await zoom(pane, "Zoom in")
      }
    }
    await page.setViewportSize({ width: 2560, height: 1100 })
    await ready()
    await inputViewport.focus()
    await outputViewport.hover()
    await page.keyboard.press("ArrowRight")
    assert.match(await pagePosition(input), /2\s*\/ 7/)
    assert.match(await pagePosition(output), /2\s*\/ 2/, "A fitted Page navigates with horizontal arrows")
    await page.keyboard.press("p")
    assert.match(await pagePosition(output), /1\s*\/ 2/)
    await page.keyboard.press("n")
    assert.match(await pagePosition(input), /2\s*\/ 7/)
    assert.match(await pagePosition(output), /2\s*\/ 2/, "Mouse position chooses Page despite focus in the other pane")
    await input.locator(".inspection-heading").hover()
    await page.keyboard.press("Shift+P")
    await page.keyboard.press("Space")
    assert.equal(await total(), "3 pages")
    await inputViewport.dispatchEvent("keydown", { key: " ", repeat: true })
    assert.equal(await total(), "3 pages")
    assert.equal(await selection.inputValue(), "")
    for (let index = 0; index < 8; index++) await page.keyboard.press("p")
    assert.match(await pagePosition(input), /1\s*\/ 7/)
    for (let index = 0; index < 8; index++) await page.keyboard.press("n")
    assert.match(await pagePosition(input), /7\s*\/ 7/)
    await page.keyboard.press("Control+ArrowLeft")
    assert.match(await pagePosition(input), /7\s*\/ 7/)
    await outputViewport.focus()
    await outputViewport.hover()
    await page.keyboard.press("Space")
    assert.equal(await total(), "4 pages")
    await page.keyboard.press("Home")
    await zoom(output, "Zoom in")
    await ready()
    await outputViewport.focus()
    await outputViewport.evaluate((element) => (element.scrollTop = 200))
    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollTop > 200)
    const scrolled = await outputViewport.evaluate((element) => element.scrollTop)
    await page.keyboard.press("ArrowUp")
    await page.waitForFunction(
      (previous) => document.querySelector(".composition-output .page-scroll").scrollTop < previous,
      scrolled,
    )
    assert.match(await pagePosition(output), /1\s*\/ 4/)
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%")
    await page.keyboard.press("Shift+Equal")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%")
    await ready()
    await outputViewport.evaluate((element) => (element.scrollLeft = 100))
    await page.keyboard.press("ArrowRight")
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollLeft > 100)
    const horizontal = await outputViewport.evaluate((element) => element.scrollLeft)
    await page.keyboard.press("ArrowLeft")
    await page.waitForFunction(
      (previous) => document.querySelector(".composition-output .page-scroll").scrollLeft < previous,
      horizontal,
    )
    assert.match(await pagePosition(output), /1\s*\/ 4/)
    await outputViewport.evaluate((element) => (element.scrollLeft = 0))
    await page.keyboard.press("ArrowLeft")
    assert.equal(await outputViewport.evaluate((element) => element.scrollLeft), 0)
    assert.match(await pagePosition(output), /1\s*\/ 4/)
    await outputViewport.evaluate((element) => (element.scrollLeft = element.scrollWidth))
    await page.keyboard.press("ArrowRight")
    assert.match(await pagePosition(output), /1\s*\/ 4/)
    await page.keyboard.press("n")
    assert.match(await pagePosition(output), /2\s*\/ 4/)
    await page.keyboard.press("p")
    assert.match(await pagePosition(output), /1\s*\/ 4/)
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%")
    await page.keyboard.press("-")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%")
    for (let step = 0; step < 8; step++) await page.keyboard.press("Shift+Equal")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "3200%")
    for (let step = 0; step < 8; step++) await page.keyboard.press("-")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "50%")
    await page.keyboard.press("Shift+Equal")
    await page.keyboard.press("Shift+Equal")
    await ready()
    await outputViewport.focus()
    for (const zone of [".inspection-heading", ".page-scroll", ".page-navigation"]) {
      await output.locator(zone).hover({ position: { x: 4, y: 4 } })
      await page.keyboard.press("n")
    }
    assert.match(await pagePosition(output), /4\s*\/ 4/)
    await page.keyboard.press("Shift+Equal")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%")
    await page.keyboard.press("-")
    assert.equal(await total(), "4 pages")
    await page.keyboard.press("Shift+Equal")
    await page.keyboard.press("Shift+Equal")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "300%")
    await ready()
    await outputViewport.evaluate((element) => (element.scrollLeft = 100))
    await page.keyboard.press("ArrowRight")
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollLeft > 100)
    await page.keyboard.press("ArrowLeft")
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollLeft === 100)
    assert.match(await pagePosition(output), /4\s*\/ 4/)
    await outputViewport.evaluate((element) => (element.scrollTop = 200))
    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollTop > 200)
    await page.keyboard.press("ArrowUp")
    assert.match(await pagePosition(output), /4\s*\/ 4/)
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("1")
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).press("Space")
    assert.equal(await total(), "5 pages")
    await selection.focus()
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("Space")
    assert.equal(await total(), "5 pages")
    assert.match(await pagePosition(output), /5\s*\/ 5/, "Insertion before the inspected page preserves its identity")
    await output.getByRole("button", { name: "Previous Output page", exact: true }).click()
    await output.getByRole("button", { name: "Next Output page", exact: true }).focus()
    await page.keyboard.press("Space")
    assert.match(await pagePosition(output), /5\s*\/ 5/)
    assert.equal(await total(), "5 pages")
    await page.setViewportSize({ width: 390, height: 900 })
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Input", exact: true })
      .click()
    await tab(input, "Grid")
    const first = await gridPage(input, 1)
    const nextRow = await first.evaluate(
      (element) => getComputedStyle(element.closest(".composition-grid")).gridTemplateColumns.split(" ").length,
    )
    await first.focus()
    await page.keyboard.press("ArrowDown")
    await page.waitForFunction(
      (position) => document.activeElement?.getAttribute("data-page") === String(position),
      nextRow,
    )
  } finally {
    await browser?.close()
  }
})

test("Output movement keeps direction buttons fixed at selection boundaries", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({ colorScheme, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      const output = page.locator(".composition-output")
      const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
      const earlier = output.getByRole("button", { name: "Move selected pages earlier", exact: true })
      const later = output.getByRole("button", { name: "Move selected pages later", exact: true })
      await output.locator(".composition-card").last().waitFor()
      async function revealMoves() {
        if (!(await output.locator(".inline-moves").isVisible()) && !(await output.locator(".menu-moves").isVisible()))
          await output.getByLabel("Output page actions", { exact: true }).click()
      }
      for (const [width, height, text] of [
        [320, 844, "100%"],
        [390, 844, "100%"],
        [768, 1024, "100%"],
        [1920, 1080, "100%"],
        [390, 844, "200%"],
        [1920, 1080, "200%"],
      ]) {
        await page.setViewportSize({ width, height })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
        await tab(output, "Grid")
        for (const density of ["Normal", "Compact"]) {
          await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
          for (const [start, direction] of [
            [8, -1],
            [1, 1],
          ]) {
            await selected.fill(String(start))
            await revealMoves()
            assert.equal(await earlier.isEnabled(), start !== 1)
            assert.equal(await later.isEnabled(), start !== 8)
            const action = direction < 0 ? earlier : later
            await action.scrollIntoViewIfNeeded()
            const bounds = [await earlier.boundingBox(), await later.boundingBox()]
            const point = bounds[direction < 0 ? 0 : 1]
            const inline = await output.locator(".inline-moves").isVisible()
            const centers = []
            for (const button of [earlier, later]) {
              const geometry = await button.evaluate((element) => {
                const control = element.getBoundingClientRect()
                const icon = element.querySelector("svg path").getBoundingClientRect()
                return {
                  x: icon.x + icon.width / 2,
                  dx: icon.x + icon.width / 2 - control.x - control.width / 2,
                  dy: icon.y + icon.height / 2 - control.y - control.height / 2,
                }
              })
              assert.ok(Math.abs(geometry.dy) < 1, "Move icons stay on their button's vertical center")
              if (inline)
                assert.ok(Math.abs(geometry.dx) < 1, "Inline move icons stay on their button's horizontal center")
              centers.push(geometry.x)
            }
            if (!inline) assert.ok(Math.abs(centers[0] - centers[1]) < 1, "Menu move icons share one column")
            for (let step = 1; step <= 2; step++) {
              await revealMoves()
              assert.deepEqual(
                [await earlier.boundingBox(), await later.boundingBox()],
                bounds,
                `${colorScheme}, ${width}, ${text}, ${density}: direction buttons retain their slots`,
              )
              assert.equal(await action.isEnabled(), true)
              const hit = await page.evaluate(
                ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"),
                { x: point.x + point.width / 2, y: point.y + point.height / 2 },
              )
              assert.equal(
                hit,
                await action.getAttribute("aria-label"),
                `${colorScheme}, ${width}, ${text}, ${density}, ${start}, step=${step}: the retained coordinate hits its action`,
              )
              await page.mouse.click(point.x + point.width / 2, point.y + point.height / 2)
              await page.waitForFunction(({ field, value }) => field.value === value, {
                field: await selected.elementHandle(),
                value: String(start + direction * step),
              })
              assert.equal(
                await selected.inputValue(),
                String(start + direction * step),
                "Repeated clicks on one position keep the same direction",
              )
            }
          }
          await selected.fill("1-8")
          await revealMoves()
          assert.equal(await earlier.isDisabled(), true)
          assert.equal(await later.isDisabled(), true)
          await page.keyboard.press("Escape")
          await selected.fill("8")
          await revealMoves()
          const blocked = await later.boundingBox()
          await page.mouse.click(blocked.x + blocked.width / 2, blocked.y + blocked.height / 2)
          assert.equal(await selected.inputValue(), "8", "A disabled direction leaves the selection unchanged")
          await page.keyboard.press("Escape")
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})
