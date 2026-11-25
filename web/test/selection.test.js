// Checks pointer and touch selection, dragging slots, menu actions, and selection bars.

import { setup, selectPane, outputCount, tab, pagePosition, gridPage, fixture, captureLayout } from "./browser.js"
import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { zoom } from "./workspace.js"
import { measure } from "./measure.js"

test("Input clicks retain the last valid sequence at the page limit", async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
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
    assert.equal(await outputCount(page).textContent(), "0 pages")
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).click()
    assert.equal(await selection.inputValue(), "")
    assert.notEqual(await selection.getAttribute("aria-invalid"), "true")
  } finally {
    await browser.close()
  }
})

test("Sparse Output selections follow physical order through edits", async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await outputCount(page).waitFor({ state: "attached" })
      const views = page.locator(".mobile-workspace-tabs")
      await selectPane(views.getByRole("button", { name: "Output", exact: true }), "tap")
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
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true })
        await preparation.fill("1")
        const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
        await grip.scrollIntoViewIfNeeded()
        const bounds = await grip.boundingBox()
        await send("touchStart", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 })
        assert.equal(
          await page.locator(".header-feedback [role=status]").filter({ hasText: "Move to Output" }).count(),
          0,
        )
        await page.locator(".header-feedback [role=status]").filter({ hasText: "Move to Output" }).waitFor()
        assert.equal(
          await views
            .getByRole("button", { name: "Output", exact: true })
            .evaluate((element) => getComputedStyle(element).borderStyle),
          "dashed",
        )
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 - 20 })
        assert.equal(
          await page.locator(".header-feedback [role=status]").filter({ hasText: "Move to Output" }).count(),
          0,
          "Progress toward Output dismisses the delayed hint",
        )
        await send("touchEnd")
        assert.equal(await outputCount(page).textContent(), "8 pages")
        assert.equal(await preparation.inputValue(), "1", "Input rejects drops without consuming the preparation")
        await send("touchStart", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 })
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 })
        const outputTab = await views.getByRole("button", { name: "Output", exact: true }).boundingBox()
        await send("touchMove", { x: outputTab.x + outputTab.width / 2, y: outputTab.y + outputTab.height / 2 })
        await page.waitForTimeout(750)
        assert.equal(await input.isVisible(), true, "Hovering Output does not change the pane before the drop")
        assert.equal(
          await page.locator(".header-feedback [role=status]").filter({ hasText: "Move to Output" }).count(),
          0,
        )
        await send("touchEnd")
        await output.waitFor({ state: "visible" })
        await page.waitForFunction(
          () =>
            document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
              ?.textContent === "9 pages",
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
          await page.waitForFunction(
            ({ panel, position }) => panel.querySelector(".page-current")?.textContent.trim() === String(position),
            { panel: await output.elementHandle(), position },
          )
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
        assert.equal(await outputCount(page).textContent(), "9 pages")
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme, textSize] of [
      [810, 1080, "light", "100%"],
      [390, 844, "dark", "200%"],
    ]) {
      page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.emulateMedia({ colorScheme })
      await setup(page)
      // Some touch engines send two clicks without a native double-click event.
      if (width === 390)
        await page.addInitScript(() =>
          document.addEventListener("dblclick", (event) => event.stopImmediatePropagation(), true),
        )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await outputCount(page).waitFor({ state: "attached" })
      await page.evaluate((size) => {
        document.documentElement.style.fontSize = size
        if (size === "200%") document.body.style.fontFamily = "DejaVu Sans"
      }, textSize)
      const session = await page.context().newCDPSession(page)
      const send = (type, point) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] })
      const total = () => outputCount(page).textContent()
      const lens = page.getByRole("region", { name: /^Magnified page / })
      for (const name of ["Input", "Output"]) {
        await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }), "tap")
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
        assert.equal(await field.getAttribute("inputmode"), "numeric")
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
        await tab(pane, "Grid")
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
        await target.waitFor()
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await setup(page)
    await page.addInitScript(() => {
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
          await pane.locator(".grid-view").evaluate((element) => (element.scrollTop = 0))
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

test("Dragging keeps page slots and previews through cancel and drop", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.emulateMedia({ colorScheme: reducedMotion === "reduce" ? "dark" : "light" })
      await setup(page)
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
      if (reducedMotion === "reduce") await page.setViewportSize({ width: 1920, height: 1440 })
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
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
      assert.equal(
        await transfer.evaluate((data) => data.image.width),
        1,
        "Native drag image is suppressed in favor of the live numbered overlay",
      )
      const raster = await page.locator(".drag-image[data-card]").evaluate((image) => {
        const canvas = image.querySelector("canvas"),
          context = canvas.getContext("2d")
        return {
          width: parseFloat(canvas.style.inlineSize),
          height: parseFloat(canvas.style.blockSize),
          density: canvas.width / parseFloat(canvas.style.inlineSize),
          rotate: getComputedStyle(image).rotate,
          color: Array.from(
            context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.7), 1, 1).data,
          ),
        }
      })
      assert.ok(raster.width <= 120)
      assert.ok(raster.height <= 160)
      assert.ok(raster.density >= 2)
      assert.ok(raster.color[0] < 64, "The visible page supplies the preview")
      assert.ok(raster.color[3] > 150)
      assert.equal(raster.rotate, reducedMotion === "reduce" ? "none" : "-3deg")
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
        `The destination image matches the card's image bounds (${JSON.stringify({ reference, ghost: ghost.image, slot })})`,
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
      assert.deepEqual(inserted.slice(3), survivors.slice(2), "A fading removed page cannot move the insertion target")
      await output.getByLabel("Page selection", { exact: true }).fill("1-8")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await page.waitForFunction(() => !document.querySelector(".composition-output .composition-card"))
      await source.dispatchEvent("dragstart", { dataTransfer: transfer })
      await output.dispatchEvent("dragover", { dataTransfer: transfer })
      await output.locator(".composition-empty .drop-placeholder").waitFor()
      await output.dispatchEvent("drop", { dataTransfer: transfer })
      assert.equal(await outputCount(page).textContent(), "1 page")
      assert.equal(await page.locator(".drag-image").count(), 0)
      assert.deepEqual(errors, [])
      await transfer.dispose()
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Dragging page images and grips preserves selection and page focus", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
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
    await output.locator(".grid-view").evaluate((element) => (element.scrollTop = 0))
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
        assert.equal(await outputCount(page).textContent(), "7 pages")
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
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
      assert.equal(await outputCount(page).textContent(), "8 pages")
      assert.equal(await output.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await page.getByRole("dialog", { name: "Help", exact: true }).isVisible(), false)
    }
    await page.keyboard.press("Escape")
    assert.equal(await input.locator(".input-options").evaluate((element) => element.open), false)
    assert.equal(await prepared.inputValue(), "1-4")
    assert.equal(await selected.inputValue(), "2")
    await thumbnail.focus()
    await page.keyboard.press("Delete")
    assert.equal(await outputCount(page).textContent(), "7 pages")
    await prepared.fill("1")
    await input.getByLabel("Input page actions", { exact: true }).click()
    await prepared.press("Enter")
    assert.equal(
      await outputCount(page).textContent(),
      "8 pages",
      "The selection field retains its own Enter action after configuring repetitions",
    )
  } finally {
    await browser?.close()
  }
})

test("Output menu labels fit one line with narrow and enlarged text", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    const output = page.locator(".composition-output")
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const [width, size] of [
        [1100, "100%"],
        [390, "100%"],
        [320, "200%"],
      ]) {
        await page.setViewportSize({ width, height: 900 })
        await page.evaluate((value) => {
          document.documentElement.style.fontSize = value
          document.body.style.fontFamily = value === "200%" ? "DejaVu Sans, sans-serif" : ""
        }, size)
        const switcher = page.getByRole("button", { name: "Output", exact: true })
        await selectPane(switcher)
        for (const view of ["Grid", "Page"]) {
          await tab(output, view)
          await output.getByLabel("Page selection", { exact: true }).fill("2-3")
          await output.getByLabel("Output page actions", { exact: true }).click()
          const increase = output.locator('.menu-options button[aria-label="Zoom in"]')
          if (await increase.isVisible()) await increase.click()
          const controls = await output.locator(".menu-options").evaluate((element) => {
            const panel = element.getBoundingClientRect()
            return [...element.querySelectorAll(".selected-actions button, :scope > button")]
              .filter((button) => button.checkVisibility())
              .map((button) => {
                const box = button.getBoundingClientRect()
                const label = [...button.childNodes].find(
                  (node) => node.nodeType === Node.TEXT_NODE && node.textContent.trim(),
                )
                const text = document.createRange()
                text.selectNode(label)
                return {
                  label: button.textContent.trim(),
                  lines: text.getClientRects().length,
                  fits: button.scrollWidth <= button.clientWidth + 1 && box.x >= panel.x && box.right <= panel.right,
                  width: box.width,
                  height: box.height,
                }
              })
          })
          assert.deepEqual(
            controls.slice(-4).map((button) => button.label),
            ["Before", "Blank after this", "Blank after last", "Repeat"],
          )
          assert.ok(
            controls.every((button) => button.lines === 1 && button.fits),
            JSON.stringify({ width, size, controls }),
          )
          assert.ok(
            controls.every((button) => button.width === controls[0].width && button.height === controls[0].height),
            JSON.stringify(controls),
          )
          await page.keyboard.press("Escape")
        }
      }
    }
  } finally {
    await browser.close()
  }
})

test("Selection bars expose meaningful actions in both panes", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Selection.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ metadata: Array.from({ length: 7 }, (_, index) => ({ name: `Sheet ${index + 1}` })) }),
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
    assert.equal(await input.locator(".page-label .page-name").count(), 7)
    assert.equal(
      await input.locator(".sequence-entry > .entry > :first-child").getAttribute("class"),
      "sequence-options input-options",
    )
    await prepared.fill("99")
    assert.equal(await prepared.getAttribute("aria-invalid"), "true")
    assert.equal(await add.count(), 0)
    await inputClear.click()
    await input.getByLabel("Input page actions", { exact: true }).click()
    const menu = input.locator(".menu-options")
    const compact = await menu.evaluate((element) => {
      const checkbox = element.querySelector(".align").getBoundingClientRect()
      return { height: element.getBoundingClientRect().height, checkbox: checkbox.height }
    })
    assert.ok(compact.height <= 220, JSON.stringify(compact))
    assert.ok(compact.checkbox >= 44, "The compact menu retains a full checkbox target")
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
      assert.equal(await input.locator(".page-label .page-name").count(), 7, text)
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
    assert.equal(await input.locator(".page-label .page-name").count(), 7)
    assert.equal(
      await output.locator(".sequence-entry > .entry > :first-child").getAttribute("class"),
      "sequence-options output-options",
    )
    await selected.fill("1-2")
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      const remove = output.getByRole("button", { name: "Remove selected Output pages", exact: true })
      await remove.hover()
      for (const pressed of [false, true]) {
        if (pressed) await page.mouse.down()
        const colors = await remove.evaluate((button) => {
          const style = getComputedStyle(button)
          return { background: style.backgroundColor, foreground: style.color }
        })
        assert.notEqual(colors.background, "rgba(0, 0, 0, 0)", `${colorScheme}, pressed=${pressed}: filled Remove`)
        assert.notEqual(colors.background, colors.foreground, `${colorScheme}: visible minus`)
      }
      await page.mouse.move(0, 0)
      await page.mouse.up()
    }
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
      assert.equal(await output.locator(".occurrence-actions").getByRole("button").count(), text ? 0 : 28, text)
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
    assert.equal(await output.getByRole("button", { name: "Repeat", exact: true }).count(), 0)
    await output.getByLabel("Start each repeat on front", { exact: true }).check()
    assert.equal(await output.getByRole("button", { name: "Repeat", exact: true }).count(), 1)
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
    assert.equal(await outputCount(page).textContent(), "8 pages")
    assert.equal(await selected.inputValue(), "1")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    assert.equal(await output.locator(".page-actions button").count(), 4)
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
    assert.deepEqual(
      await output
        .locator('.page-origin-info .page-details tr:has(th:text-is("Original page"), th:text-is("Size")) td')
        .allTextContents(),
      ["3", "1", "3"],
    )
    assert.equal(await selected.inputValue(), "1-3")
    await output.getByLabel("Output page actions", { exact: true }).focus()
    await page.keyboard.press("Delete")
    assert.equal(await outputCount(page).textContent(), "0 pages")
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
