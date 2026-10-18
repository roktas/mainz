// Checks Output edits, selection, gestures, and edit feedback.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { zoom } from "./workspace.js"
import { createServer, tab, fixture, pagePosition, image, hasCursor } from "./browser.js"

test("Output Page removes the current occurrence, including Blank and the final page", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await tab(output, "Page")
    const actions = output.locator(".page-actions")
    assert.deepEqual(
      await actions
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
      ["Remove Output page 1", "Duplicate Output page 1"],
    )
    await actions.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
    assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages")
    assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
    assert.equal(await actions.getByRole("button").count(), 0, "Selection hides individual actions")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await output.getByRole("button", { name: "Next Output page", exact: true }).focus()
    await page.keyboard.press("End")
    await output.locator(".blank-sheet").waitFor()
    await actions.getByRole("button", { name: "Remove Output page 6", exact: true }).click()
    assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages")
    await output.getByRole("button", { name: "Select all", exact: true }).click()
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await actions.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
    await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor()
    assert.equal(
      await output
        .getByRole("tab", { name: "Page", exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Input changes cancel their pending gestures and transfers while Output stays independent",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.pauseOpening && message.moduleUrl && message.bytes && !message.changes) {
              window.resumeOpening = () => super.postMessage(message, ...rest)
              return
            }
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const open = async (name) => {
        await page.evaluate(() => {
          window.pauseOpening = true
          window.resumeOpening = undefined
        })
        await input.locator("input[type=file]").setInputFiles({ name, mimeType: "application/pdf", buffer: fixture() })
        await page.waitForFunction(() => !!window.resumeOpening)
      }
      await output.locator(".composition-totals strong").filter({ hasText: "6 PDF pages" }).waitFor()
      await output.getByRole("button", { name: "Select Output page 1", exact: true }).click()
      await open("Second.pdf")
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await input.getByRole("button", { name: "Select Input page 1", exact: true }).dispatchEvent("dragstart", {
        dataTransfer: transfer,
      })
      await page.locator('.composer[data-drag="source"]').waitFor()
      await page.keyboard.press("Delete")
      assert.equal(await output.locator(".composition-totals strong").innerText(), "6 PDF pages")
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1")
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Second.pdf" }).waitFor()
      await page.waitForFunction(() => !document.querySelector(".composer[data-drag]"))
      assert.equal(await page.locator(".drag-image").count(), 0)
      await output.dispatchEvent("drop", { dataTransfer: transfer })
      assert.equal(await output.locator(".composition-totals strong").innerText(), "6 PDF pages")
      await input.locator(".input-picker > summary").click()
      await input.locator(".input-list button[data-source]").first().click()
      assert.equal(await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "3-5,2,2,7")
      await open("Third.pdf")
      const contact = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 500 }
      await input
        .getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
        .dispatchEvent("pointerdown", contact)
      assert.equal(await input.locator("[data-press]").count(), 1)
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Third.pdf" }).waitFor()
      assert.equal(await input.locator("[data-press]").count(), 0, "Input switching also releases a pending touch grip")
      await output.dispatchEvent("pointermove", { ...contact, clientX: 1000 })
      await output.dispatchEvent("pointerup", { ...contact, clientX: 1000 })
      assert.equal(await page.locator(".composer").getAttribute("data-drag"), null)
      assert.equal(await output.locator(".composition-totals strong").innerText(), "6 PDF pages")
      await open("Fourth.pdf")
      await page.evaluate(() => {
        const time = performance.now()
        performance.now = () => time
      })
      const thumbnail = input.getByRole("button", { name: "Select Input page 1", exact: true })
      await thumbnail.dispatchEvent("pointerdown", contact)
      await thumbnail.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Fourth.pdf" }).waitFor()
      await thumbnail.dispatchEvent("pointerdown", contact)
      await thumbnail.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => delete performance.now)
      assert.equal(await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(
        await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(),
        "1",
        "The first tap in a new Input starts a new gesture",
      )
      await open("Fifth.pdf")
      await thumbnail.dispatchEvent("pointerdown", { pointerType: "mouse", isPrimary: true, button: 0 })
      await thumbnail.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Fifth.pdf" }).waitFor()
      await thumbnail.dispatchEvent("click", { detail: 2 })
      await thumbnail.dispatchEvent("dblclick", { detail: 2 })
      assert.equal(
        await output.locator(".composition-totals strong").innerText(),
        "6 PDF pages",
        "A double-click cannot start in one Input and add pages from another",
      )
      await thumbnail.dblclick()
      assert.equal(
        await output.locator(".composition-totals strong").innerText(),
        "7 PDF pages",
        "A complete double-click still adds the current page",
      )
      await open("Sixth.pdf")
      await page.evaluate(() => {
        const time = performance.now()
        performance.now = () => time
      })
      const outputImage = output.getByRole("button", { name: "Select Output page 1", exact: true })
      await outputImage.dispatchEvent("pointerdown", contact)
      await outputImage.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Sixth.pdf" }).waitFor()
      await outputImage.dispatchEvent("pointerdown", contact)
      await outputImage.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => delete performance.now)
      assert.equal(
        await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"),
        "true",
        "Output's double-tap continues independently of Input changes",
      )
      assert.equal(await output.locator(".composition-totals strong").innerText(), "7 PDF pages")
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

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

test("Grid navigation retains physical page positions during additions", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, density, colorScheme] of [
      [1440, 1100, "Normal", "light"],
      [1440, 1100, "Compact", "dark"],
      [390, 844, "Normal", "dark"],
      [390, 844, "Compact", "light"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme, reducedMotion: "no-preference" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composition-totals strong").waitFor({ state: "attached" })
      const output = page.locator(".composition-output")
      const workspace = page.locator(".mobile-workspace-tabs > button:last-child")
      if (await workspace.isVisible()) await workspace.click()
      await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
      await output.locator(".thumbnail[aria-busy=false]").first().waitFor()
      await page.evaluate(() => {
        new MutationObserver(() => {
          document.querySelectorAll(".addition-preview").forEach((element) => {
            element.getAnimations().forEach((animation) => {
              animation.pause()
              animation.currentTime = 0
            })
          })
        }).observe(document.body, { childList: true })
      })
      const selection = output.getByLabel("Page selection", { exact: true })
      const grid = output.locator(".composition-grid")
      await selection.fill("1")
      await grid.press("Enter")
      await page.locator(".addition-preview").waitFor()
      await grid.press("Home")
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 1")
      await page.keyboard.press("ArrowRight")
      assert.equal(
        await grid.evaluate((element) => element === document.activeElement),
        true,
        `${width} ${density}: Grid retains focus while its cursor visits a hidden new page`,
      )
      for (const [key, number] of [
        ["ArrowRight", 3],
        ["ArrowRight", 4],
        ["ArrowLeft", 3],
      ]) {
        await page.keyboard.press(key)
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select Output page ${number}`,
        )
      }
      await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
      await page.keyboard.press("Shift+ArrowRight")
      assert.equal(await selection.inputValue(), "2-4", `${width} ${density}: Shift follows the clicked physical page`)
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 5")
      if (await page.locator(".addition-preview").count())
        await page.locator(".addition-preview").evaluate((element) => {
          element.getAnimations().forEach((animation) => animation.finish())
        })
      assert.equal(await selection.inputValue(), "2-4")
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Input additions reach Output without delaying edits or taking focus", { timeout: 90000 }, async (t) => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, hasTouch, colorScheme] of [
      [1920, 1080, false, "light"],
      [1920, 1080, false, "dark"],
      [1440, 1100, false, "light"],
      [1024, 768, true, "dark"],
      [810, 1080, true, "light"],
      [744, 1133, true, "dark"],
      [440, 956, true, "light"],
      [320, 568, true, "dark"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch,
        isMobile: hasTouch,
        colorScheme,
        reducedMotion: "no-preference",
      })
      const cpu = width === 810 ? 4 : 1
      await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu })
      t.diagnostic(`${width} × ${height}, ${colorScheme}, ${cpu}× CPU slowdown`)
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
      )
      // Freeze the moving preview before its first paint so geometry checks do not depend on machine speed.
      await page.evaluate(() => {
        new MutationObserver(() => {
          document
            .querySelectorAll(".addition-preview, .mobile-workspace-tabs > button:last-child")
            .forEach((element) => {
              element.getAnimations().forEach((animation) => {
                animation.pause()
                animation.currentTime = 0
              })
            })
        }).observe(document.body, { childList: true })
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output"),
        prepared = input.getByLabel("Page selection", { exact: true }),
        flight = page.locator(".addition-preview")
      const total = async () => Number.parseInt(await output.locator(".composition-totals strong").textContent(), 10)
      const finish = async () => {
        await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
        await flight.waitFor({ state: "detached" })
        assert.equal(
          await page
            .locator(".mobile-workspace-tabs > button:last-child")
            .evaluate((button) =>
              button.getAnimations().some((animation) => animation.effect.getTiming().duration === 1200),
            ),
          false,
          "Arrival or cancellation clears the Output glow",
        )
      }
      let count = 6
      const densities = [
        ["Normal", "Normal"],
        ["Compact", "Compact"],
      ]
      if (width === 1440) densities.push(["Normal", "Compact"], ["Compact", "Normal"])
      if (width === 1920)
        densities.push(["Normal", "Normal", 12], ["Normal", "Normal", 13], ["Compact", "Compact", "batch"])
      for (const [density, outputDensity, quantity = 2] of densities) {
        await input.getByRole("button", { name: `${density} Input grid`, exact: true }).click()
        if (width >= 1024)
          await output.getByRole("button", { name: `${outputDensity} Output grid`, exact: true }).click()
        const added =
          quantity === "batch" ? Number(await output.locator(".grid-view").getAttribute("data-batch")) + 1 : quantity
        await prepared.fill(Array.from({ length: added }, (_, index) => (index % 7) + 1).join(","))
        await input.locator(".thumbnail[aria-busy=false]").first().waitFor()
        if (density === "Compact") await prepared.press("Enter")
        else await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        count += added
        await flight.waitFor()
        assert.equal(await total(), count, "The complete group is added while the preview is paused")
        assert.equal(await prepared.inputValue(), "")
        assert.equal(await flight.getAttribute("data-copies"), String(Math.min(added, 3)))
        assert.equal(await flight.getAttribute("aria-hidden"), "true")
        assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
        assert.equal(await flight.evaluate((element) => getComputedStyle(element).pointerEvents), "none")
        const pending = output.locator(".composition-card[data-adding]")
        assert.ok(await pending.count())
        assert.equal(
          await pending.evaluateAll((elements) =>
            elements.every((element) => element.inert && getComputedStyle(element).visibility === "hidden"),
          ),
          true,
          "New cards wait for the moving preview",
        )
        const focused = await page.evaluate(() => document.activeElement?.outerHTML)
        const source = await input.locator('.page-image[data-page="0"] canvas').boundingBox()
        const start = await flight.boundingBox()
        const sourceX = (Math.max(0, source.x) + Math.min(width, source.x + source.width)) / 2,
          sourceY = (Math.max(0, source.y) + Math.min(height, source.y + source.height)) / 2
        assert.ok(Math.abs(start.x + start.width / 2 - sourceX) < 1, `${width} ${density}: Input x`)
        assert.ok(Math.abs(start.y + start.height / 2 - sourceY) < 1, `${width} ${density}: Input y`)
        const button = page.locator(".mobile-workspace-tabs > button:last-child")
        const destination = (await button.isVisible())
          ? button
          : output.locator(".composition-card.selected .page-image").first()
        if (!(await button.isVisible()))
          await page.waitForFunction(
            () =>
              document
                .querySelector(".composition-output .composition-card.selected .thumbnail")
                ?.getAttribute("aria-busy") === "false",
          )
        const end = await destination.evaluate((element) => {
          const bounds = element.querySelector("canvas")?.getBoundingClientRect()
          const rectangle = bounds?.width && bounds.height ? bounds : element.getBoundingClientRect()
          return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
        })
        await flight.evaluate((element) => {
          const animation = element.getAnimations()[0]
          animation.currentTime = animation.effect.getTiming().duration / 2
        })
        const middle = await flight.boundingBox()
        if (await button.isVisible()) {
          const glow = await button.evaluate((element) => {
            const animation = element.getAnimations().find((item) => item.effect.getTiming().duration === 1200)
            if (!animation) return null
            animation.currentTime = 600
            return { duration: animation.effect.getTiming().duration, shadow: getComputedStyle(element).boxShadow }
          })
          assert.equal(glow?.duration, 1200, `${width} ${density}: Output glows during the complete flight`)
          assert.notEqual(glow.shadow, "none", `${width} ${density}: Output has a visible mid-flight glow`)
        }
        const dx = end.x + end.width / 2 - sourceX,
          dy = end.y + end.height / 2 - sourceY
        const bend =
          Math.abs(dx * (middle.y + middle.height / 2 - sourceY) - dy * (middle.x + middle.width / 2 - sourceX)) /
          Math.hypot(dx, dy)
        assert.ok(bend > 8, `${width} ${density}: the preview follows a curve`)
        await flight.evaluate((element) => {
          const animation = element.getAnimations()[0]
          animation.currentTime = animation.effect.getTiming().duration - 1
        })
        const landed = await flight.boundingBox()
        assert.ok(Math.abs(landed.x + landed.width / 2 - end.x - end.width / 2) < 1, `${width} ${density}: Output x`)
        assert.ok(Math.abs(landed.y + landed.height / 2 - end.y - end.height / 2) < 1, `${width} ${density}: Output y`)
        assert.ok(
          await flight.evaluate((element) => Number(getComputedStyle(element).opacity) > 0.9),
          "The preview stays visible until arrival",
        )
        if (!(await button.isVisible())) {
          const canvas = await destination.locator("canvas").evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return { width: bounds.width, height: bounds.height }
          })
          assert.ok(Math.abs(landed.width - canvas.width) < 1, `${density} to ${outputDensity}: image width`)
          assert.ok(Math.abs(landed.height - canvas.height) < 1, `${density} to ${outputDensity}: image height`)
        }
        assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), focused)
        assert.equal(await page.locator(".composer").getAttribute("data-view"), "input")
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await finish()
        assert.equal(await pending.count(), 0, "Arrival reveals the complete group")
        assert.equal(
          await output
            .locator(".composition-card.selected")
            .first()
            .evaluate((element) => getComputedStyle(element).visibility),
          "visible",
        )
      }
      if (width === 1440) {
        await input.getByRole("button", { name: "Details for Input page 1", exact: true }).click()
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
        count++
        await flight.waitFor()
        assert.equal(await total(), count)
        assert.equal(await flight.getAttribute("data-copies"), "1")
        await page.setViewportSize({ width: width + 1, height })
        await flight.waitFor({ state: "detached" })
        assert.equal(await output.locator("[data-adding]").count(), 0, "Resize reveals the completed addition")
        assert.equal(await total(), count)
        await page.setViewportSize({ width, height })
        await tab(output, "Page")
        await prepared.fill("1")
        await prepared.press("Enter")
        count++
        await flight.waitFor()
        const heading = await output.locator("h2").boundingBox()
        await flight.evaluate((element) => {
          const animation = element.getAnimations()[0]
          animation.currentTime = animation.effect.getTiming().duration - 1
        })
        const landed = await flight.boundingBox()
        assert.ok(Math.abs(landed.x + landed.width / 2 - heading.x - heading.width / 2) < 1)
        assert.ok(Math.abs(landed.y + landed.height / 2 - heading.y - heading.height / 2) < 1)
        assert.equal(await total(), count, "An undisplayed insertion uses the Output heading")
        await finish()
        await output.getByRole("button", { name: "Select all", exact: true }).click()
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        count = 0
      }
      await tab(input, "Page")
      await input.locator('.pdf-viewport[aria-busy="false"]').waitFor()
      for (let index = 0; index < 3; index++) await zoom(input, "Zoom in")
      await input.locator('.pdf-viewport[aria-busy="false"]').waitFor()
      await image(input).scrollIntoViewIfNeeded()
      const copy = async () => {
        if (hasTouch) {
          // Separate native double-tap gestures; four rapid taps need not produce two double-clicks.
          await page.waitForTimeout(400)
          await image(input).tap()
          await image(input).tap()
        } else await image(input).dblclick()
      }
      await copy()
      count++
      await flight.waitFor()
      assert.equal(await total(), count)
      assert.equal(await flight.getAttribute("data-copies"), "1")
      const visible = await input.locator(".page-scroll").boundingBox(),
        enlarged = await image(input).boundingBox(),
        origin = await flight.boundingBox()
      const x =
          (Math.max(0, visible.x, enlarged.x) +
            Math.min(width, visible.x + visible.width, enlarged.x + enlarged.width)) /
          2,
        y =
          (Math.max(0, visible.y, enlarged.y) +
            Math.min(height, visible.y + visible.height, enlarged.y + enlarged.height)) /
          2
      assert.ok(Math.abs(origin.x + origin.width / 2 - x) < 1, "Enlarged Page starts inside its visible viewport on x")
      assert.ok(Math.abs(origin.y + origin.height / 2 - y) < 1, "Enlarged Page starts inside its visible viewport on y")
      if (width === 1440) {
        assert.equal(await output.locator(".inspection-target").getAttribute("data-adding"), "true")
        assert.equal(
          await output.locator(".inspection-target").evaluate((element) => getComputedStyle(element).visibility),
          "hidden",
          "A new Page image also waits for arrival",
        )
      }
      await copy()
      count++
      await flight.waitFor()
      assert.equal(await total(), count, "Another addition does not wait for the paused preview")
      assert.equal(await flight.count(), 1, "Repeated additions replace the previous preview")
      await page.emulateMedia({ reducedMotion: "reduce" })
      await flight.waitFor({ state: "detached" })
      assert.equal(await output.locator("[data-adding]").count(), 0)
      await copy()
      count++
      assert.equal(await total(), count)
      assert.equal(await flight.count(), 0, "Reduced motion skips the preview and still adds the page")
      if (width === 1440) {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await copy()
        await flight.waitFor()
        page.once("dialog", (dialog) => dialog.accept())
        await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
        await page.locator(".drop-zone").waitFor()
        assert.equal(await flight.count(), 0, "Leaving the workspace removes the paused preview")
      }
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Output additions, removals, and moves animate across page actions and shortcuts",
  { timeout: 120000 },
  async (t) => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const [width, height, hasTouch, colorScheme, cpu] of [
        [1440, 1100, false, "light", 4],
        [1024, 768, true, "dark", 1],
        [810, 1080, true, "dark", 1],
        [390, 844, true, "light", 4],
      ]) {
        const page = await browser.newPage({
          viewport: { width, height },
          hasTouch,
          isMobile: hasTouch,
          colorScheme,
          reducedMotion: "no-preference",
        })
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu })
        t.diagnostic(`${width} × ${height}, ${colorScheme}, ${cpu}× CPU slowdown`)
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
        )
        await page.evaluate(() => {
          new MutationObserver(() => {
            document.querySelectorAll(".addition-preview, .removal-preview").forEach((element) => {
              element.getAnimations().forEach((animation) => {
                animation.pause()
                animation.currentTime = 0
              })
            })
          }).observe(document.body, { childList: true })
        })
        const output = page.locator(".composition-output")
        const workspace = page.locator(".mobile-workspace-tabs > button:last-child")
        if (await workspace.isVisible()) await workspace.click()
        const selection = output.getByLabel("Page selection", { exact: true })
        const total = async () => Number.parseInt(await output.locator(".composition-totals strong").textContent(), 10)
        const finish = async (flight) => {
          await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
          await page.waitForFunction(() => !document.querySelector(".addition-preview, .removal-preview"))
        }
        const addition = async (action, quantity = 1, blank = false) => {
          const before = await total()
          await action()
          const flight = page.locator(".addition-preview")
          await flight.waitFor()
          await flight.evaluate(async (element) => {
            await element.getAnimations()[0].ready
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          })
          assert.equal(await flight.count(), 1, "Focus recovery does not cancel addition feedback")
          assert.equal(await total(), before + quantity, "Additions update the document before arrival")
          assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
          assert.equal(await output.locator(".composition-card[data-adding]").count(), quantity)
          if (blank)
            assert.equal(
              await flight.evaluate((canvas) => canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3]),
              0,
              "A Blank preview does not copy its neighbor's PDF image",
            )
          await finish(flight)
          assert.equal(await output.locator("[data-adding]").count(), 0)
        }
        const removal = async (action, quantity = 1) => {
          const before = await total()
          await output.locator(".composition-card").evaluateAll((cards) => {
            for (const card of cards)
              card.addEventListener(
                "outrostart",
                () =>
                  queueMicrotask(() => {
                    for (const animation of card.getAnimations()) {
                      animation.pause()
                      animation.currentTime = 0
                    }
                  }),
                { once: true },
              )
          })
          await action()
          assert.equal(await total(), before - quantity, "Removal updates the document without waiting")
          const outgoing = output.locator(".composition-card.removing")
          await page.waitForFunction(
            (expected) => document.querySelectorAll(".composition-card.removing").length === expected,
            quantity,
          )
          assert.equal(
            await outgoing.evaluateAll((cards) =>
              cards.every(
                (card) =>
                  card.inert &&
                  card.getAttribute("aria-hidden") === "true" &&
                  card.getAnimations().some((a) => a.effect.getTiming().duration === 1200),
              ),
            ),
            true,
          )
          await outgoing.evaluateAll((cards) =>
            cards.forEach((card) =>
              card.getAnimations().forEach((animation) => {
                animation.currentTime = 600
              }),
            ),
          )
          assert.equal(
            await outgoing.evaluateAll((cards) =>
              cards.every((card) => {
                const style = getComputedStyle(card)
                return (
                  Number(style.opacity) > 0.3 &&
                  Number(style.opacity) < 0.7 &&
                  new DOMMatrixReadOnly(style.transform).a < 1
                )
              }),
            ),
            true,
            "Removed cards fade and shrink over 1200 ms",
          )
          const positions = await output.locator(".composition-card:not(.removing)").evaluateAll((cards) =>
            cards.map((card) => {
              const { x, y } = card.getBoundingClientRect()
              const grid = card.parentElement.getBoundingClientRect()
              return { id: card.id, x: x - grid.x, y: y - grid.y }
            }),
          )
          await outgoing.evaluateAll((cards) =>
            cards.forEach((card) => card.getAnimations().forEach((animation) => animation.finish())),
          )
          await page.waitForFunction(() => !document.querySelector(".composition-card.removing"))
          await page.waitForFunction(() => {
            const animations = document
              .querySelector(".composition-output .composition-grid")
              .getAnimations({ subtree: true })
              .filter((animation) => animation.effect.getTiming().duration === 800)
            if (!animations.length) return false
            for (const animation of animations) {
              animation.pause()
              animation.currentTime = 400
            }
            return true
          })
          const reflow = await output.locator(".composition-grid").evaluate((grid) =>
            grid
              .getAnimations({ subtree: true })
              .filter((animation) => animation.effect.getTiming().duration === 800)
              .map((animation) => {
                const card = animation.effect.target
                const middle = card.getBoundingClientRect()
                const frame = grid.getBoundingClientRect()
                animation.finish()
                const end = card.getBoundingClientRect()
                return {
                  id: card.id,
                  middle: { x: middle.x - frame.x, y: middle.y - frame.y },
                  end: { x: end.x - frame.x, y: end.y - frame.y },
                }
              }),
          )
          assert.ok(reflow.length, `${width}: remaining cards slide after the exit`)
          for (const { id, middle, end } of reflow) {
            const start = positions.find((position) => position.id === id)
            assert.ok(start, `${width}: reflow retains the remaining occurrence`)
            assert.ok(Math.hypot(middle.x - end.x, middle.y - end.y) > 1, `${width}: reflow has not snapped to its end`)
            assert.ok(Math.abs(2 * middle.x - start.x - end.x) < 1, `${width}: reflow x midpoint`)
            assert.ok(Math.abs(2 * middle.y - start.y - end.y) < 1, `${width}: reflow y midpoint`)
          }
        }
        await selection.fill("2-3")
        if (
          !(await output
            .locator(".inline-moves")
            .getByRole("button", { name: "Move selected pages later", exact: true })
            .isVisible())
        )
          await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".output-pages")
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.effect.getTiming().duration === 1200),
        )
        if (width === 1440) {
          const elapsed = await output.locator(".composition-grid").evaluate(async (grid) => {
            const moving = grid
              .getAnimations({ subtree: true })
              .find((animation) => animation.effect.getTiming().duration === 1200)
            const started = performance.now(),
              current = Number(moving.currentTime)
            await moving.finished
            return current + performance.now() - started
          })
          assert.ok(elapsed >= 1100 && elapsed < 4000, `The first move lasts 1200 ms: ${elapsed}`)
        } else
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((animation) => animation.finish()))
        await output.locator(".composition-grid").press("Control+ArrowLeft")
        await page.waitForFunction(() =>
          document
            .querySelector(".output-pages")
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.effect.getTiming().duration === 1200),
        )
        await output
          .locator(".composition-grid")
          .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((animation) => animation.finish()))
        for (const density of ["Normal", "Compact"]) {
          t.diagnostic(`${width}: ${density} edit feedback`)
          await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
          const clear = output.getByRole("button", { name: "Clear Output selection", exact: true })
          if (await clear.isVisible()) await clear.click()
          const details = async () => {
            if (density === "Compact")
              await output.getByRole("button", { name: "Details for Output page 1", exact: true }).click()
          }
          await details()
          await addition(() => output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click())
          await selection.fill("1-2")
          await addition(
            () => output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click(),
            2,
          )
          await selection.fill("1")
          await addition(() => output.locator(".composition-grid").press("Enter"))
          assert.equal(
            await output
              .locator(".composition-card.selected .page-image")
              .evaluate((element) => element === document.activeElement),
            true,
            "Keyboard duplication focuses the copy after arrival",
          )
          await selection.fill("1")
          await output.getByLabel("Output page actions", { exact: true }).click()
          await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("2")
          await addition(() => output.getByRole("button", { name: "Repeat selected pages", exact: true }).click())
          for (const label of ["Blank before first selected page", "Add blank page at end"]) {
            await output.getByLabel("Output page actions", { exact: true }).click()
            await addition(() => output.getByRole("button", { name: label, exact: true }).click(), 1, true)
          }
          await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
          await output.locator(".page-image").first().press("Home")
          await page.mouse.move(1, 1)
          await details()
          await removal(() => output.getByRole("button", { name: "Remove Output page 1", exact: true }).click())
          for (const action of [
            () => output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click(),
            () => selection.press("Enter"),
            () => output.locator(".composition-grid").press("Delete"),
            () => output.locator(".composition-grid").press("-"),
          ]) {
            await selection.fill("1")
            await removal(action)
          }
          await selection.fill("2-3")
          for (const direction of ["earlier", "later"]) {
            assert.equal(
              await output
                .locator(".inline-moves")
                .getByRole("button", {
                  name: `Move selected pages ${direction}`,
                  exact: true,
                })
                .isVisible(),
              width !== 390,
              `${width}: movement follows available pane width`,
            )
          }
          await selection.fill("1-2")
          const before = await output.locator(".composition-card").evaluateAll((cards) => cards.map((card) => card.id))
          await output.getByLabel("Output page actions", { exact: true }).click()
          await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
          await page.waitForFunction(() =>
            document
              .querySelector(".output-pages")
              ?.getAnimations({ subtree: true })
              .some((a) => a.effect.getTiming().duration === 1200),
          )
          const after = await output.locator(".composition-card").evaluateAll((cards) => cards.map((card) => card.id))
          assert.deepEqual(
            after.slice(0, 3),
            [before[2], before[0], before[1]],
            "Moves retain occurrence identity and print order",
          )
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((a) => a.finish()))
          await output.locator(".composition-grid").press("Control+ArrowLeft")
          await page.waitForFunction(() =>
            document
              .querySelector(".output-pages")
              ?.getAnimations({ subtree: true })
              .some((a) => a.effect.getTiming().duration === 1200),
          )
          await page.emulateMedia({ reducedMotion: "reduce" })
          await page.waitForFunction(
            () =>
              document
                .querySelector(".output-pages")
                ?.getAnimations({ subtree: true })
                .every((animation) => animation.playState !== "running"),
            undefined,
            { timeout: 500 },
          )
          await page.emulateMedia({ reducedMotion: "no-preference" })
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((a) => a.finish()))
        }
        await selection.fill("1")
        await output.locator(".composition-grid").press("Enter")
        await page.locator(".addition-preview").waitFor()
        assert.equal(
          await output.locator(".composition-grid").evaluate((element) => element === document.activeElement),
          true,
          "Keyboard focus stays in Grid while a new copy is hidden",
        )
        await output.locator(".composition-grid").press("Home")
        const first = output.getByRole("button", { name: "Select Output page 1", exact: true })
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 1")
        await finish(page.locator(".addition-preview"))
        assert.equal(
          await first.evaluate((element) => element === document.activeElement),
          true,
          "Arrival preserves navigation during the preview",
        )
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        await tab(output, "Page")
        await output.locator('.pdf-viewport[aria-busy="false"], .blank-sheet').waitFor()
        const copy = async () => {
          const sheet = output.locator(".page-scroll canvas, .blank-sheet")
          if (hasTouch) {
            await page.waitForTimeout(400)
            await sheet.tap()
            await sheet.tap()
          } else await sheet.dblclick()
        }
        let count = await total()
        for (const action of [copy, () => output.locator(".page-scroll").press("Space")]) {
          await action()
          assert.equal(await total(), ++count, `${width}: ${action.toString()}`)
          await page.locator(".addition-preview").waitFor()
          await finish(page.locator(".addition-preview"))
          assert.equal(await selection.inputValue(), "", "Page copies preserve the Output selection")
        }
        await output.getByRole("button", { name: /Remove Output page/, exact: false }).click()
        const flight = page.locator(".removal-preview")
        await flight.waitFor()
        assert.equal(await total(), --count)
        assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
        assert.equal(await output.locator(".inspection-target").getAttribute("data-removing"), "true")
        await finish(flight)
        assert.equal(await output.locator("[data-removing]").count(), 0)
        await selection.fill("1")
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".composition-output .page-scroll")
            ?.getAnimations({ subtree: true })
            .some((a) => a.effect.getTiming().duration === 1200),
        )
        await page.emulateMedia({ reducedMotion: "reduce" })
        await selection.fill("1")
        await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
        assert.equal(await total(), ++count)
        assert.equal(await page.locator(".addition-preview, .removal-preview").count(), 0)
        await selection.press("Enter")
        assert.equal(await total(), --count)
        assert.equal(await page.locator(".removal-preview").count(), 0)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await selection.fill(`1-${count}`)
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        assert.equal(await total(), 0)
        if (await workspace.isVisible()) await page.locator(".mobile-workspace-tabs > button:first-child").click()
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.locator(".selection-panel .thumbnail[aria-busy=false]").first().waitFor()
        await page.locator(".input-picker > summary").click()
        await page.getByRole("button", { name: "Remove Input", exact: true }).click()
        await page.locator(".removal-preview").first().waitFor()
        assert.equal(await page.locator(".selection-panel").count(), 0)
        assert.equal(
          await page
            .locator(".removal-preview")
            .evaluateAll((elements) =>
              elements.every(
                (element) =>
                  element.getAttribute("aria-hidden") === "true" &&
                  getComputedStyle(element).pointerEvents === "none" &&
                  element.getAnimations()[0].effect.getTiming().duration === 1200,
              ),
            ),
          true,
        )
        await page
          .locator(".removal-preview")
          .evaluateAll((elements) =>
            elements.forEach((element) => element.getAnimations().forEach((animation) => animation.finish())),
          )
        await page.waitForFunction(() => !document.querySelector(".removal-preview"))
        await page.close()
      }
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Bulk page actions consume preparations and preserve selected occurrences", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Bulk.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByRole("textbox", { name: "Page selection", exact: true })
    const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
    const inputOptions = input.getByLabel("Input page actions", { exact: true })
    const outputOptions = output.getByLabel("Output page actions", { exact: true })
    const inputRepeat = input.getByRole("textbox", { name: "Repetitions", exact: true })
    const outputRepeat = output.getByRole("textbox", { name: "Repeat selected sequence", exact: true })
    const inputFront = input.getByLabel("Start each repeat on front", { exact: true })
    const outputFront = output.getByLabel("Start each repeat on front", { exact: true })
    const order = () => output.locator(".page-origin-info .page-context").allTextContents()
    const total = () => output.locator(".composition-totals strong").innerText()
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click()
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input
      .getByRole("button", { name: "Select or drag Input page 4 to Output", exact: true })
      .click({ modifiers: ["Shift"] })
    assert.equal(await prepared.inputValue(), "4", "Addition consumes the preparation and resets its anchor")
    await input.getByRole("button", { name: "Select Input page 7", exact: true }).dblclick()
    assert.equal(await prepared.inputValue(), "")
    await input
      .getByRole("button", { name: "Select or drag Input page 6 to Output", exact: true })
      .click({ modifiers: ["Shift"] })
    assert.equal(await prepared.inputValue(), "6", "Double-click consumption resets the range anchor")
    await selected.fill("1-2")
    await selected.press("Enter")
    await prepared.fill("2,4")
    await inputOptions.click()
    await inputRepeat.fill("2")
    await inputFront.check()
    await prepared.press("Enter")
    assert.deepEqual(await order(), ["p. 2", "p. 4", "p. 2", "p. 4"])
    assert.equal(await selected.inputValue(), "1-4")
    assert.equal(await prepared.inputValue(), "")
    await inputOptions.click()
    assert.equal(await inputRepeat.inputValue(), "1")
    assert.equal(await inputFront.isChecked(), false)
    await inputRepeat.fill("2")
    await prepared.fill("1,3,1")
    await input
      .getByRole("button", { name: "Select or drag Input page 6 to Output", exact: true })
      .dragTo(output.locator(".section-heading"))
    assert.equal(await prepared.inputValue(), "1,3,1")
    assert.equal(await selected.inputValue(), "5")
    await input
      .getByRole("button", { name: "Select or drag Input page 7 to Output", exact: true })
      .dragTo(output.locator(".section-heading"))
    assert.equal(await total(), "6 PDF pages")
    assert.equal(await prepared.inputValue(), "1,3,1")
    const data = await page.evaluateHandle(() => new DataTransfer())
    const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
    await grip.dispatchEvent("dragstart", { dataTransfer: data })
    await page.keyboard.press("Escape")
    assert.equal(await prepared.inputValue(), "1,3,1")
    assert.equal(await total(), "6 PDF pages")
    await grip.dragTo(output.getByRole("button", { name: "Select Output page 2", exact: true }), {
      targetPosition: { x: 5, y: 40 },
    })
    assert.deepEqual(await order(), [
      "p. 2",
      "p. 1",
      "p. 3",
      "p. 1",
      "p. 1",
      "p. 3",
      "p. 1",
      "p. 4",
      "p. 2",
      "p. 4",
      "p. 6",
      "p. 7",
    ])
    assert.equal(await selected.inputValue(), "2-7")
    assert.equal(await prepared.inputValue(), "")
    await prepared.fill("1-7,1-4")
    await inputOptions.click()
    await inputRepeat.fill("1000")
    await inputFront.check()
    await prepared.press("Enter")
    assert.equal(await total(), "12 PDF pages")
    assert.equal(await prepared.inputValue(), "1-7,1-4")
    assert.equal(await inputRepeat.inputValue(), "1000")
    assert.equal(await inputFront.isChecked(), true)
    await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
    await inputOptions.click()
    assert.equal(await inputRepeat.inputValue(), "1")
    assert.equal(await inputFront.isChecked(), false)
    await selected.fill("1-12")
    await selected.press("Enter")
    assert.equal(await total(), "0 PDF pages")
    await prepared.fill("1-5")
    await prepared.press("Enter")
    await selected.fill("2,2,4")
    assert.equal(await output.locator(".composition-card.selected").count(), 2)
    await outputOptions.click()
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 0)
    await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).press("Enter")
    assert.equal(await selected.evaluate((element) => element === document.activeElement), true)
    assert.deepEqual(await order(), ["p. 2", "p. 1", "p. 4", "p. 3", "p. 5"])
    assert.equal(await selected.inputValue(), "1, 3")
    await outputOptions.click()
    assert.equal(await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).count(), 0)
    await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
    assert.deepEqual(await order(), ["p. 1", "p. 2", "p. 3", "p. 4", "p. 5"])
    assert.equal(await selected.inputValue(), "2, 4")
    await ready()
    await output
      .getByRole("button", { name: "Select or drag Output page 4", exact: true })
      .dragTo(output.locator(".section-heading"))
    assert.deepEqual(await order(), ["p. 1", "p. 3", "p. 5", "p. 2", "p. 4"])
    assert.equal(await selected.inputValue(), "4-5")
    await tab(output, "Page")
    assert.match(await pagePosition(output), /5\s*\/ 5/)
    await tab(output, "Grid")
    const moved = output.getByRole("button", { name: "Select or drag Output page 4", exact: true })
    await moved.dispatchEvent("dragstart", { dataTransfer: data })
    await output.locator(".composition-card").nth(4).dispatchEvent("dragover", { dataTransfer: data })
    await output.locator(".composition-card").nth(4).dispatchEvent("drop", { dataTransfer: data })
    assert.deepEqual(await order(), ["p. 1", "p. 3", "p. 5", "p. 2", "p. 4"])
    assert.equal(await selected.inputValue(), "4-5")
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    assert.equal(await selected.inputValue(), "6-7")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    assert.equal(await selected.inputValue(), "", "Group removal clears its targets")
    assert.equal(await selected.evaluate((element) => element === document.activeElement), true)
    await output.getByRole("button", { name: "Remove Output page 4", exact: true }).click()
    assert.equal(await selected.inputValue(), "")
    await selected.fill("2-3")
    await outputOptions.click()
    await outputRepeat.fill("3")
    await outputFront.check()
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click()
    assert.equal(await total(), "9 PDF pages")
    assert.equal(await selected.inputValue(), "7-8")
    await outputOptions.click()
    assert.equal(await outputRepeat.inputValue(), "2")
    assert.equal(await outputFront.isChecked(), false)
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click()
    assert.equal(await total(), "11 PDF pages")
    assert.equal(await selected.inputValue(), "9-10")
    await selected.fill("99")
    assert.equal(await selected.getAttribute("aria-invalid"), "true")
    assert.equal(
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).isDisabled(),
      true,
    )
    await selected.press("Enter")
    assert.equal(await total(), "11 PDF pages")
    await selected.fill("9-11")
    await outputOptions.click()
    await outputRepeat.fill("4")
    await output.getByRole("button", { name: "Reset Output repetitions", exact: true }).click()
    assert.equal(await outputRepeat.inputValue(), "2")
    await outputRepeat.fill("3")
    await outputFront.check()
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    assert.equal(await selected.inputValue(), "")
    await selected.fill("9-11")
    await outputOptions.click()
    assert.equal(await outputRepeat.inputValue(), "2")
    assert.equal(await outputFront.isChecked(), false)
    await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
    assert.equal(await selected.inputValue(), "9")
    await outputOptions.click()
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
    assert.equal(await selected.inputValue(), "13")
    await selected.fill("1-13")
    await selected.press("Enter")
    assert.equal(await total(), "0 PDF pages")
    assert.equal(await selected.inputValue(), "")
    await prepared.fill("3,1,3")
    await inputOptions.click()
    await inputRepeat.fill("2")
    await inputFront.check()
    await page.keyboard.press("Escape")
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Bulk.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    await page.waitForFunction(() => document.querySelector(".input-heading .count")?.textContent === "2")
    assert.equal(await prepared.inputValue(), "", "Reopening a PDF starts an independent preparation")
    await inputOptions.click()
    assert.equal(await inputRepeat.inputValue(), "1")
    assert.equal(await inputFront.isChecked(), false)
    await page.keyboard.press("Escape")
    await prepared.fill("1,2")
    await page.locator(".input-picker > summary").click()
    await page.locator(".input-list button[data-source]").first().click()
    assert.equal(await prepared.inputValue(), "3,1,3", "Reopened PDFs keep independent ordered preparations")
    assert.equal(await input.locator(".composition-card.selected").count(), 2)
    assert.equal(await total(), "0 PDF pages")
    await data.dispose()
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Edited Padding retains its dimensions and page order in the downloaded PDF", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    const original = fixture()
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Padding.pdf",
      mimeType: "application/pdf",
      buffer: original,
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByRole("textbox", { name: "Page selection", exact: true })
    const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
    const options = output.getByLabel("Output page actions", { exact: true })
    await prepared.fill("7")
    await prepared.press("Enter")
    await prepared.fill("1-3")
    await input.getByLabel("Input page actions", { exact: true }).click()
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
    await input.getByLabel("Start each repeat on front", { exact: true }).check()
    await prepared.press("Enter")
    assert.equal(await output.locator(".composition-totals strong").innerText(), "10 PDF pages")
    assert.match(await output.locator(".output-state").innerText(), /3 Padding pages/)
    await selected.fill("2")
    await options.click()
    await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
    assert.equal(await selected.inputValue(), "3")
    assert.doesNotMatch(await output.locator(".output-state").innerText(), /Padding/)
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    assert.equal(await selected.inputValue(), "4")
    await selected.fill("3")
    await selected.press("Enter")
    await selected.fill("1")
    await options.click()
    await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
    assert.equal(await selected.inputValue(), "1")
    assert.deepEqual(await output.locator(".page-origin-info .page-context").allTextContents(), [
      "297.0 × 210.0 mm",
      "p. 7",
      "p. 1",
      "297.0 × 210.0 mm",
      "p. 2",
      "p. 3",
      "210.0 × 297.0 mm",
      "p. 1",
      "p. 2",
      "p. 3",
      "210.0 × 297.0 mm",
    ])
    const saved = page.waitForEvent("download")
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const download = await saved
    assert.equal(await download.failure(), null)
    const result = await page.evaluate(
      async ({ inputBytes, downloaded }) => {
        const { openPDF, loadRenderer } = await import("/src/pdf.ts")
        const { AnnotationMode } = await loadRenderer()
        const tasks = await Promise.all([openPDF(Uint8Array.from(inputBytes)), openPDF(Uint8Array.from(downloaded))])
        try {
          const [sourceDocument, resultDocument] = await Promise.all(tasks.map((task) => task.promise))
          const expected = ["landscape", 7, 1, "landscape", 2, 3, "portrait", 1, 2, 3, "portrait"]
          const failures = []
          for (const [index, source] of expected.entries()) {
            const actual = await resultDocument.getPage(index + 1)
            const size = actual.getViewport({ scale: 1 })
            const reference = await sourceDocument.getPage(
              typeof source === "number" ? source : source === "landscape" ? 7 : 1,
            )
            const dimensions = reference.getViewport({ scale: 1 })
            if (Math.abs(size.width - dimensions.width) > 0.01 || Math.abs(size.height - dimensions.height) > 0.01)
              failures.push(`Page ${index + 1}: dimensions differ from ${source}`)
            const render = async (sheet) => {
              const canvas = document.createElement("canvas")
              const viewport = sheet.getViewport({ scale: 0.25 })
              canvas.width = Math.ceil(viewport.width)
              canvas.height = Math.ceil(viewport.height)
              await sheet.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise
              return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
            }
            const pixels = await render(actual)
            const expectedPixels = typeof source === "number" ? await render(reference) : undefined
            if (
              expectedPixels
                ? pixels.length !== expectedPixels.length || pixels.some((value, i) => value !== expectedPixels[i])
                : pixels.some((value) => value !== 255)
            )
              failures.push(`Page ${index + 1}: appearance differs from ${source}`)
            actual.cleanup()
            reference.cleanup()
          }
          return { count: resultDocument.numPages, failures }
        } finally {
          await Promise.all(tasks.map((task) => task.destroy()))
        }
      },
      { inputBytes: Array.from(original), downloaded: Array.from(await readFile(await download.path())) },
    )
    assert.deepEqual(result, { count: 11, failures: [] })
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Grid images and grips share selection and ordinary page focus", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
    const input = page.locator(".selection-panel")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "Toggle theme", exact: true }).click()
      for (const reducedMotion of ["reduce", "no-preference"]) {
        await page.emulateMedia({ reducedMotion })
        for (const [pane, clear] of [
          [input, "Clear page sequence"],
          [page.locator(".composition-output"), "Clear Output selection"],
        ]) {
          const reset = pane.getByRole("button", { name: clear, exact: true })
          if (await reset.count()) await reset.click()
          const selection = pane.getByRole("textbox", { name: "Page selection", exact: true })
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
          await page.mouse.click(grip.x - 10, grip.y + grip.height / 2)
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
    await server.close()
  }
})

test("Dragging opens stable page slots, previews density, and commits only on drop", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
            buffer: fixture(true, false, 0, true, true),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await input.getByLabel("Page selection", { exact: true }).fill("1-7")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await output.locator(".composition-card").nth(6).waitFor()
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        if (density === "Compact") {
          await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
          await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
        }
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        )
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
        await settle()
        const slot = await hole.boundingBox(),
          shifted = await target.boundingBox()
        assert.ok(Math.abs(slot.x - bounds[3].x) < 1 && Math.abs(slot.y - bounds[3].y) < 1)
        assert.ok(
          Math.abs(shifted.x - bounds[4].x) < 1 && Math.abs(shifted.y - bounds[4].y) < 1,
          "The target moves into its neighbor's old slot",
        )
        const ghost = await hole.locator("canvas").evaluate((canvas) => ({
          opacity: Number(getComputedStyle(canvas).opacity),
          color: Array.from(
            canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.7), 1, 1)
              .data,
          ),
        }))
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
        await source.dispatchEvent("dragstart", { dataTransfer: transfer })
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
        assert.equal(await output.locator(".composition-totals strong").innerText(), "1 PDF page")
        assert.equal(await page.locator(".drag-image").count(), 0)
        assert.deepEqual(errors, [])
        await transfer.dispose()
        await page.close()
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Dragging page images and grips preserves selection and page focus", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
        if (modified) await page.keyboard.down("Control")
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
        if (modified) await page.keyboard.up("Control")
        assert.equal(await prepared.inputValue(), "1,3,3")
        assert.equal(await selected.inputValue(), "1,3")
        assert.equal(await target.evaluate((element) => element === document.activeElement), true)
        assert.equal(await output.locator(".composition-totals strong").innerText(), "7 PDF pages")
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Open menus retain page commands from both panes", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "6 PDF pages")
      assert.equal(await output.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await page.getByRole("dialog", { name: "Help", exact: true }).isVisible(), false)
    }
    await page.keyboard.press("Escape")
    assert.equal(await input.locator(".input-options").evaluate((element) => element.open), false)
    assert.equal(await prepared.inputValue(), "3-5,2,2,7")
    assert.equal(await selected.inputValue(), "2")
    await thumbnail.focus()
    await page.keyboard.press("Delete")
    assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages")
    await prepared.fill("1")
    await input.getByLabel("Input page actions", { exact: true }).click()
    await prepared.press("Enter")
    assert.equal(
      await output.locator(".composition-totals strong").innerText(),
      "6 PDF pages",
      "The selection field retains its own Enter action after configuring repetitions",
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Grid boundary duplication focuses the final new Output occurrence", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const output = page.locator(".composition-output")
    await output.getByLabel("Page selection", { exact: true }).fill("2,6")
    await output.getByRole("button", { name: "Select Output page 6", exact: true }).press("ArrowRight")
    await page.waitForFunction(() => document.activeElement?.matches(".output-pages"))
    await page.keyboard.press("Enter")
    assert.equal(await output.locator(".composition-totals strong").innerText(), "8 PDF pages")
    assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "7-8")
    assert.equal(
      await output
        .getByRole("button", { name: "Select Output page 8", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await page.keyboard.press("v")
    assert.match(await pagePosition(output), /8\s*\/ 8/)
    assert.equal(
      await page.locator(".selection-panel").getByLabel("Page selection", { exact: true }).inputValue(),
      "3-5,2,2,7",
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Grid keyboard selection toggles at the cursor and stops at boundaries", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
          buffer: fixture(true, false, 0, false, false, {}, 14),
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
            await cursor(position)
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
        await panel.getByRole("button", { name: `Select ${name} page 2`, exact: true }).click()
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
        await panel.getByRole("button", { name: `Select ${name} page 3`, exact: true }).focus()
        await steps([
          ["Shift+ArrowRight", name === "Input" ? "7, 7, 3" : "3, 7", 4],
          ["Shift+ArrowRight", name === "Input" ? "7, 7, 3-4" : "3-4, 7", 5],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7, 3" : "3, 7", 4],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7" : "7", 3],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7, 2" : "2, 7", 2],
          ["Shift+ArrowRight", name === "Input" ? "7, 7" : "7", 3],
        ])
        await selection.fill("")
        await cards.last().focus()
        const boundary = Number(await panel.locator(".grid-view").getAttribute("data-batch"))
        await steps([
          ["Shift+ArrowRight", String(boundary), boundary + 1],
          ["Shift+ArrowRight", `${boundary}-${boundary + 1}`, boundary + 2],
          ["Shift+ArrowLeft", String(boundary), boundary + 1],
          ["Shift+ArrowLeft", "", boundary],
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
          const total = () => output.locator(".composition-totals strong").innerText()
          await selection.fill("1,13-14")
          await panel.getByRole("button", { name: "Select Output page 2", exact: true }).focus()
          await cards.last().dispatchEvent("keydown", { key: "Delete", repeat: true })
          await page.keyboard.press("Alt+Delete")
          assert.equal(await total(), "14 PDF pages", "Held or modified Delete keeps the composition")
          await page.keyboard.press("Delete")
          assert.equal(await total(), "11 PDF pages")
          assert.equal(await selection.inputValue(), "")
          await cursor(1)
          await page.keyboard.press("Space")
          await page.keyboard.press("Delete")
          assert.equal(await total(), "10 PDF pages")
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
    await server.close()
  }
})

test("Selection bars expose meaningful actions in both panes", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
            ...(earlier ? ["Move selected pages earlier"] : []),
            ...(later ? ["Move selected pages later"] : []),
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
      await output.getByLabel("Output page actions", { exact: true }).click()
      assert.deepEqual(
        await output
          .getByRole("button", { name: /^Move selected pages/ })
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        [...(earlier ? ["Move selected pages earlier"] : []), ...(later ? ["Move selected pages later"] : [])],
        text,
      )
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
    assert.equal(await output.locator(".composition-totals strong").innerText(), "8 PDF pages")
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
    assert.equal(await output.locator(".composition-totals strong").innerText(), "0 PDF pages")
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      "Removing all pages returns focus when the menu control disappears",
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Output separates page controls from group actions for keyboard and mouse", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
      const total = () => output.locator(".composition-totals strong").innerText()
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
      assert.equal(await total(), "4 PDF pages", "Addition transfers every selected Input page")
      assert.equal(await prepared.inputValue(), "", "Successful group addition resets the preparation")
      assert.equal(await selected.inputValue(), "2-4")
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3", "p. 4"])
      assert.equal(
        await output.locator(".composition-card.range-highlight").count(),
        3,
        "Addition highlights the new group",
      )
      assert.equal(await output.getByRole("button", { name: "Move selected pages later", exact: true }).count(), 0)
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
      assert.equal(await total(), "4 PDF pages", "Invalid selection text blocks group edits")
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
        assert.equal(await total(), `${position + 3} PDF pages`, "Each addition makes exactly one group copy")
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
      assert.equal(await total(), "7 PDF pages", "Removal removes the selected copy and leaves other copies intact")
      await selected.fill("5-7")
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 7", exact: true }).press("-")
      else await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await total(), "4 PDF pages")
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
        ["Move selected pages later", "Remove selected Output pages", "Duplicate selected Output pages"],
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
    await server.close()
  }
})

test(
  "Grid shortcuts resolve both pane selections and allow mouse then keyboard actions",
  { timeout: 90000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
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
                  fade: card.getAnimations().some((animation) => animation.effect.getTiming().duration === 1200),
                })
                // Deliver a resize while the last cards are still fading.
                const grid = card.closest(".grid-view")
                if (grid) grid.style.inlineSize = "calc(100% - 1px)"
              }),
            )
        })
        await page.keyboard.press("Delete")
        assert.equal(
          await output.locator(".composition-totals strong").innerText(),
          "0 PDF pages",
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
      await server.close()
    }
  },
)

test(
  "Escape clears the target selection without moving inspection or scroll positions",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
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
            await pane.getByRole("button", { name: `Select ${name} page 6`, exact: true }).focus()
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
          } else await pane.getByRole("button", { name: `Select ${name} page 7`, exact: true }).focus()
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
      await server.close()
    }
  },
)

test("Selection and view shortcuts target the mouse pane and preserve native keys", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
        buffer: fixture(true, false, 0, false, false, {}, 13),
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
    await page.keyboard.press("Control+a")
    assert.deepEqual(await prepared.evaluate((element) => [element.selectionStart, element.selectionEnd]), [0, 3])
    assert.equal(await selected.inputValue(), "3,5", "Ctrl+A in a field selects text")
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
    await server.close()
  }
})

test("Page and Grid keyboard actions respect key priority and the visible page order", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
    const total = () => output.locator(".composition-totals strong").innerText()
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
    assert.equal(await total(), "1 PDF page")
    await cards.nth(1).dispatchEvent("keydown", { key: "Enter", repeat: true })
    assert.equal(await total(), "1 PDF page")
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus()
    assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1")
    await page.keyboard.press("Enter")
    assert.equal(await total(), "2 PDF pages")
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
      assert.equal(await total(), "2 PDF pages", "N/P navigate without editing the composition")
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
    assert.equal(await total(), "2 PDF pages")
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
    assert.equal(await total(), "3 PDF pages")
    await page.keyboard.press("-")
    assert.equal(await total(), "2 PDF pages")
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
    assert.match(await pagePosition(output), /1\s*\/ 2/)
    await page.keyboard.press("n")
    assert.match(await pagePosition(input), /2\s*\/ 7/)
    assert.match(await pagePosition(output), /2\s*\/ 2/, "Mouse position chooses Page despite focus in the other pane")
    await input.locator(".inspection-heading").hover()
    await page.keyboard.press("Shift+P")
    await page.keyboard.press("Space")
    assert.equal(await total(), "3 PDF pages")
    await inputViewport.dispatchEvent("keydown", { key: " ", repeat: true })
    assert.equal(await total(), "3 PDF pages")
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
    assert.equal(await total(), "4 PDF pages")
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
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "400%")
    for (let step = 0; step < 8; step++) await page.keyboard.press("-")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "50%")
    await page.keyboard.press("Shift+Equal")
    await page.keyboard.press("Shift+Equal")
    await ready()
    await page.locator(".composition-output .section-heading h2").click()
    for (const zone of [".inspection-heading", ".page-scroll", ".page-navigation"]) {
      await output.locator(zone).hover({ position: { x: 4, y: 4 } })
      await page.keyboard.press("n")
    }
    assert.match(await pagePosition(output), /4\s*\/ 4/)
    await page.keyboard.press("Shift+Equal")
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%")
    await page.keyboard.press("-")
    assert.equal(await total(), "4 PDF pages")
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
    assert.equal(await total(), "5 PDF pages")
    await selection.focus()
    await page.keyboard.press("ArrowLeft")
    await page.keyboard.press("Space")
    assert.equal(await total(), "5 PDF pages")
    assert.match(await pagePosition(output), /5\s*\/ 5/, "Insertion before the inspected page preserves its identity")
    await output.getByRole("button", { name: "Previous Output page", exact: true }).click()
    await output.getByRole("button", { name: "Next Output page", exact: true }).focus()
    await page.keyboard.press("Space")
    assert.match(await pagePosition(output), /5\s*\/ 5/)
    assert.equal(await total(), "5 PDF pages")
    await page.setViewportSize({ width: 390, height: 900 })
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Input", exact: true })
      .click()
    await tab(input, "Grid")
    await cards.first().focus()
    await page.keyboard.press("ArrowDown")
    assert.equal(await cards.nth(2).evaluate((element) => element === document.activeElement), true)
  } finally {
    await browser?.close()
    await server.close()
  }
})
