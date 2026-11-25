// Checks workspace pane views, dialogs, help shortcuts, settings, and onboarding tours.

import { setup, selectPane, outputCount, tab, fixture } from "./browser.js"
import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { mkdir } from "node:fs/promises"
import { measure } from "./measure.js"
import { chromium } from "playwright"

test("Page returns preserve independent pane views and compact tab navigation", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    await tab(input, "List")
    await tab(output, "Page")
    await output.locator(".page-scroll").press("v")
    assert.equal(await output.locator(".composition-grid").isVisible(), true)
    assert.equal(await input.locator(".page-list").isVisible(), true)
    await tab(output, "List")
    await tab(input, "Page")
    await input.locator(".page-scroll").press("v")
    assert.equal(await input.locator(".page-list").isVisible(), true)
    assert.equal(await output.locator(".page-list").isVisible(), true)
    await page.setViewportSize({ width: 320, height: 900 })
    const switcher = page.getByRole("navigation", { name: "Workspace view", exact: true })
    for (const [name, pane] of [
      ["Input", input],
      ["Output", output],
    ]) {
      await selectPane(switcher.getByRole("button", { name, exact: true }))
      const tabs = pane.getByRole("tablist")
      const grid = tabs.getByRole("tab", { name: "Grid", exact: true })
      const list = tabs.getByRole("tab", { name: "List", exact: true })
      const detail = tabs.getByRole("tab", { name: "Page", exact: true })
      await tab(pane, "Grid")
      await grid.press("ArrowRight")
      assert.equal(await list.getAttribute("aria-selected"), "true")
      assert.equal(await list.evaluate((element) => document.activeElement === element), true)
      await page.keyboard.press("ArrowRight")
      assert.equal(await detail.getAttribute("aria-selected"), "true")
      await pane.locator(".page-scroll").press("v")
      assert.equal(await list.getAttribute("aria-selected"), "true", name + " returns to List")
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
    }
  } finally {
    await browser.close()
  }
})

test("Each Input retains its Pages presentation after switching Inputs", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page.locator('input[type="file"]').first().setInputFiles({
      name: "First.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    const input = page.locator(".selection-panel")
    const upload = page.locator(".composer").locator('input[type=file][aria-label="Open PDF"]')
    await tab(input, "List")
    await upload.setInputFiles({ name: "Second.pdf", mimeType: "application/pdf", buffer: fixture() })
    await page.locator(".status-input").filter({ hasText: "Second.pdf" }).waitFor({ state: "attached" })
    assert.equal(await input.locator(".composition-grid").isVisible(), true)
    await page.locator(".input-picker > summary h2").click()
    await input.locator(".input-list button[data-source]").filter({ hasText: "First.pdf" }).click()
    assert.equal(await input.locator(".page-list").isVisible(), true)
    await page.locator(".input-picker > summary h2").click()
    await input.locator(".input-list button[data-source]").filter({ hasText: "Second.pdf" }).click()
    assert.equal(await input.locator(".composition-grid").isVisible(), true)
    await page.locator(".input-picker > summary h2").click()
    await input.getByRole("button", { name: "Remove Input", exact: true }).click()
    assert.equal(await input.locator(".page-list").isVisible(), true)
    await upload.setInputFiles({ name: "Third.pdf", mimeType: "application/pdf", buffer: fixture() })
    await page.locator(".status-input").filter({ hasText: "Third.pdf" }).waitFor({ state: "attached" })
    assert.equal(await input.locator(".composition-grid").isVisible(), true)
    await page.locator(".input-picker > summary h2").click()
    await input.locator(".input-list button[data-source]").filter({ hasText: "First.pdf" }).click()
    assert.equal(await input.locator(".page-list").isVisible(), true)
  } finally {
    await browser.close()
  }
})

test("Dialogs dismiss outside taps without native light dismissal", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    for (const [width, height] of [
      [810, 1048],
      [1080, 778],
      [1440, 900],
    ]) {
      await page.setViewportSize({ width, height })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Settings", "Help"]) {
          const opener = page.getByRole("button", { name, exact: true })
          const drawer = page.getByRole("dialog", { name, exact: true })
          await opener.tap()
          // Exercise the application's dismissal when the browser does not implement closedby.
          await drawer.evaluate((element) => element.removeAttribute("closedby"))
          await drawer.getByRole("heading", { name, exact: true }).tap()
          assert.equal(await drawer.isVisible(), true, "Inside taps keep the dialog open")
          const bounds = await drawer.boundingBox()
          await page.mouse.move(bounds.x + 20, bounds.y + 20)
          await page.mouse.down()
          await page.mouse.move(bounds.x - 20, bounds.y + 20)
          await page.mouse.up()
          assert.equal(await drawer.isVisible(), true, "A drag from the dialog to its backdrop keeps it open")
          await page.touchscreen.tap(bounds.x / 2, height / 2)
          await drawer.waitFor({ state: "hidden" })
          assert.equal(await opener.evaluate((element) => element === document.activeElement), true)
          await opener.click()
          await page.keyboard.press("Escape")
          await drawer.waitFor({ state: "hidden" })
        }
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Help stays available across pointer types and tours retain visible focus", async () => {
  const server = await serve()
  await mkdir("../.local/tmp/web/layout/tour", { recursive: true })
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, reducedMotion: "reduce" })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
      const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      await welcome.getByRole("button", { name: "Take a tour", exact: true }).click()
      const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
      for (const step of ["input-grid", "input-list", "input-page"]) {
        await tour.getByRole("button", { name: "Next", exact: true }).click()
        await page.waitForFunction(
          (key) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === key,
          step,
        )
      }
      assert.match(await tour.innerText(), /On touch screens, use the page-selection field/)
      assert.match(await tour.innerText(), /With a mouse, the heading grip selects or unselects/)
      const input = page.locator(".selection-panel")
      for (const [width, text, colorScheme] of [
        [375, "200%", "dark"],
        [1024, "100%", "light"],
      ]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme })
        await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
        assert.equal(await input.getByRole("textbox", { name: "Page selection", exact: true }).isVisible(), true)
        assert.equal(await input.locator(".inspection-heading > .page-grip").isVisible(), !hasTouch)
        assert.equal(
          await tour.evaluate((guide) => {
            const box = guide.getBoundingClientRect()
            return box.left >= 0 && box.right <= innerWidth && box.top >= 0 && box.bottom <= innerHeight
          }),
          true,
          `${width}px ${text}: Input Page guidance fits the viewport`,
        )
        await page.screenshot({ path: `../.local/tmp/web/layout/tour/${hasTouch ? "touch" : "mouse"}-${width}.png` })
      }
      await tour.getByRole("button", { name: "End tour", exact: true }).click()
      assert.equal(
        await page
          .getByRole("button", { name: "Help", exact: true })
          .evaluate((button) => button === document.activeElement),
        true,
        "Ending the tour returns focus to a visible header control",
      )
      await input.getByRole("textbox", { name: "Page selection", exact: true }).click()
      for (const width of [375, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(await page.locator(".help-button").isVisible(), true, `${width}px: Help remains available`)
        assert.equal(await page.getByRole("button", { name: "Help", exact: true }).count(), 1)
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Keyboard starts at the logo and uses thin secondary focus contours", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        colorScheme,
        reducedMotion: "reduce",
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      await page.keyboard.press("Tab")
      assert.equal(await page.locator(".brand").evaluate((element) => element === document.activeElement), true)
      const contour = async (locator) => {
        await page.keyboard.press("Tab")
        await locator.focus()
        return locator.evaluate((element) => {
          const style = getComputedStyle(element)
          return {
            secondary: style.outlineColor === getComputedStyle(document.querySelector(".help-button")).color,
            width: parseFloat(style.outlineWidth),
          }
        })
      }
      assert.deepEqual(await contour(page.locator(".brand")), { secondary: true, width: 1 })
      const input = page.locator(".selection-panel")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).focus()
      const entry = input.locator(".sequence-entry > .entry")
      assert.equal(
        await entry.evaluate(
          (element) =>
            getComputedStyle(element).borderTopColor === getComputedStyle(document.querySelector(".help-button")).color,
        ),
        true,
      )
      await page.getByRole("button", { name: "Help", exact: true }).click()
      const close = page.getByRole("button", { name: "Close help", exact: true })
      assert.deepEqual(await contour(close), { secondary: true, width: 1 })
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test("Shortcut help follows the visible views, preserves focus, and starts the tour", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Shortcuts.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    await selection.fill("1,2")
    await selection.press("Enter")
    const help = page.getByRole("button", { name: "Help", exact: true })
    const helpDialog = page.getByRole("dialog", { name: "Help", exact: true })
    const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
    await selection.press("?")
    assert.equal(await helpDialog.isVisible(), false, "Typing a question mark keeps help closed")
    assert.equal(await selection.inputValue(), "?")
    await selection.fill("")
    for (const [inputMode, outputMode] of [
      ["Grid", "Grid"],
      ["List", "List"],
      ["Page", "Grid"],
      ["Grid", "Page"],
      ["Page", "Page"],
      ["Style", "Page"],
    ]) {
      await tab(input, inputMode)
      await tab(output, outputMode)
      await help.click()
      const keyboardTopic = helpDialog.getByRole("tab", { name: "Keyboard", exact: true })
      await keyboardTopic.press("Control+ArrowRight")
      assert.equal(await keyboardTopic.getAttribute("aria-selected"), "true", "Modified arrows retain the Help topic")
      const chooser = helpDialog.getByRole("combobox", { name: "Output shortcut view", exact: true })
      assert.equal(await chooser.inputValue(), outputMode.toLowerCase())
      const before = await helpDialog.boundingBox()
      const inputHelp = helpDialog.getByRole("region", { name: `Input ${inputMode.toLowerCase()}`, exact: true })
      const outputHelp = helpDialog.getByRole("region", { name: `Output ${outputMode.toLowerCase()}`, exact: true })
      for (const [owner, mode, section] of [
        ["Input", inputMode, inputHelp],
        ["Output", outputMode, outputHelp],
      ]) {
        await helpDialog
          .getByRole("combobox", { name: `${owner} shortcut view`, exact: true })
          .selectOption(mode.toLowerCase())
        assert.equal(await section.isVisible(), true)
        assert.equal(await helpDialog.locator(".keyboard-contexts > section:visible").count(), 2)
        assert.deepEqual(await helpDialog.boundingBox(), before, "Context changes retain the dialog dimensions")
        if (mode === "Style") assert.match(await section.innerText(), /Move to the next Style control/)
        else {
          assert.equal(await section.getByRole("heading", { name: "Edit", exact: true }).isVisible(), true)
          assert.match(
            await section.locator(".shortcut-list").last().innerText(),
            owner === "Input" ? /Add prepared pages from the page field/ : /Remove selected pages from the page field/,
          )
          assert.match(
            await section.innerText(),
            mode === "Page"
              ? /Reset zoom/
              : mode === "List"
                ? /Move one screen of rows/
                : /Start at the first \/ last page/,
          )
        }
      }
      assert.equal(await input.getByRole("tab", { name: inputMode, exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(
        await output.getByRole("tab", { name: outputMode, exact: true }).getAttribute("aria-selected"),
        "true",
      )
      const dimensions = await helpDialog.boundingBox()
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).click()
      assert.deepEqual(await helpDialog.boundingBox(), dimensions, "Help retains its largest tab's dimensions")
      const mouseHelp = helpDialog.getByRole("tabpanel", { name: "Mouse", exact: true })
      assert.equal(await mouseHelp.isVisible(), true)
      const actions = mouseHelp.getByRole("table", { name: "Mouse actions", exact: true })
      assert.deepEqual(await actions.getByRole("columnheader").allTextContents(), ["Action", "Result"])
      assert.match(
        await actions.getByRole("row").filter({ hasText: "Double-click an Input Grid image" }).innerText(),
        /Adds prepared pages/,
      )
      assert.match(
        await actions.getByRole("row").filter({ hasText: "Double-click a Page image" }).innerText(),
        /Zooms to 200%/,
      )
      assert.match(await mouseHelp.innerText(), /Opens Page or returns to Grid or List/)
      assert.match(await mouseHelp.innerText(), /Selects or unselects a page/)
      assert.match(await mouseHelp.innerText(), /Click a Page counter\s+Shows page details when available/)
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).press("Home")
      assert.equal(
        await helpDialog.getByRole("tab", { name: "Keyboard", exact: true }).getAttribute("aria-selected"),
        "true",
      )
      await page.keyboard.press("ArrowRight")
      assert.equal(
        await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).getAttribute("aria-selected"),
        "true",
      )
      assert.equal(await outputCount(page).textContent(), "2 pages")
      await page.keyboard.press("Escape")
      await helpDialog.waitFor({ state: "hidden" })
      assert.equal(await help.evaluate((item) => item === document.activeElement), true)
      await page.keyboard.press("?")
      await helpDialog.waitFor()
      assert.equal(
        await helpDialog.getByRole("combobox", { name: "Output shortcut view", exact: true }).inputValue(),
        outputMode.toLowerCase(),
      )
      assert.equal(await outputHelp.isVisible(), true, "Reopening Help selects the current pane context")
      await page.keyboard.press("Escape")
    }
    await tab(input, "List")
    await tab(output, "Grid")
    for (const [width, height, theme, font] of [
      [2560, 1440, "dark", ""],
      [1920, 1080, "light", ""],
      [1920, 960, "light", ""],
      [1920, 960, "dark", "DejaVu Sans"],
      [1440, 900, "dark", ""],
      [1440, 900, "light", "DejaVu Sans"],
      [1440, 900, "dark", "DejaVu Sans"],
      [1920, 900, "dark", "DejaVu Sans"],
      [2560, 900, "light", "DejaVu Sans"],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(
        ({ theme: scheme, font: family }) => {
          document.documentElement.dataset.theme = scheme
          document.body.style.fontFamily = family
        },
        { theme, font },
      )
      await help.click()
      for (const topic of ["Keyboard", "Mouse"]) {
        await helpDialog.getByRole("tab", { name: topic, exact: true }).click()
        const dimensions = await helpDialog.evaluate((dialog) =>
          [dialog, ...dialog.querySelectorAll(".help-panels > [role=tabpanel]")].map((element) => ({
            name: element.className || element.getAttribute("aria-labelledby"),
            width: element.clientWidth,
            height: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          })),
        )
        assert.ok(
          dimensions.every((size) => size.scrollHeight <= size.height + 1 && size.scrollWidth <= size.width + 1),
          `${topic} Help fits ${width}×${height} with ${font || "the system font"} without scrolling: ${JSON.stringify(dimensions)}`,
        )
      }
      await page.keyboard.press("Escape")
    }
    for (const [width, text] of [
      [375, "100%"],
      [320, "200%"],
    ]) {
      await page.setViewportSize({ width, height: 667 })
      await page.evaluate((size) => {
        document.body.style.fontFamily = size === "200%" ? "DejaVu Sans, sans-serif" : ""
        document.documentElement.style.fontSize = size
      }, text)
      await help.click()
      await helpDialog.getByRole("tab", { name: "Keyboard", exact: true }).click()
      const before = await helpDialog.boundingBox()
      const selectors = helpDialog.getByRole("combobox")
      const inputBox = await selectors.nth(0).boundingBox(),
        outputBox = await selectors.nth(1).boundingBox()
      assert.ok(outputBox.y >= inputBox.y + inputBox.height, "Narrow shortcut panes stack")
      for (const view of ["grid", "list", "page", "style"]) {
        await helpDialog.getByRole("combobox", { name: "Input shortcut view", exact: true }).selectOption(view)
        assert.deepEqual(await helpDialog.boundingBox(), before, "Enlarged context changes keep the dialog stable")
        assert.equal(await helpDialog.locator(".keyboard-contexts > section:visible").count(), 2)
      }
      assert.equal(await helpDialog.evaluate((e) => e.scrollWidth <= e.clientWidth), true)
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).click()
      const mouseTable = helpDialog.getByRole("table", { name: "Mouse actions", exact: true })
      const columns = await mouseTable.evaluate((table) => {
        const headers = [...table.querySelectorAll("th")].map((cell) => cell.getBoundingClientRect())
        return [...table.querySelectorAll("tbody tr")].every((row) =>
          [...row.children].every(
            (cell, index) =>
              Math.abs(cell.getBoundingClientRect().left - headers[index].left) < 1 &&
              cell.scrollWidth <= cell.clientWidth + 1,
          ),
        )
      })
      assert.equal(columns, true, `${width}px, ${text}: Mouse cells align with their headers without overflow`)
      await page.keyboard.press("Escape")
    }
    await page.evaluate(() => {
      document.body.style.removeProperty("font-family")
      document.documentElement.style.fontSize = "100%"
    })
    await page.setViewportSize({ width: 1440, height: 1100 })
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click()
    await page.keyboard.press("Space")
    await page.waitForFunction(() => document.activeElement?.matches(".page-image[aria-pressed=false]"))
    const helpCursor = await page.evaluate(() => document.activeElement.getAttribute("aria-label"))
    await page.keyboard.press("?")
    await helpDialog.waitFor()
    await page.keyboard.press("Escape")
    await page.waitForFunction((name) => document.activeElement?.getAttribute("aria-label") === name, helpCursor)
    await help.click()
    await helpDialog.getByRole("button", { name: "Start Tour", exact: true }).click()
    await tour.waitFor()
    assert.equal(await helpDialog.isVisible(), false)
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    assert.match(await tour.innerText(), /Select pages using images, grips, or the page field/)
    assert.match(await tour.innerText(), /Borders and the page field show the same selection/)
    assert.match(await tour.innerText(), /clears the preparation/)
    assert.match(await tour.innerText(), /Without a selection, a card’s \+ adds one copy/)
    await tour.getByRole("button", { name: "End tour", exact: true }).click()
    assert.equal(await help.evaluate((item) => item === document.activeElement), true)
    assert.equal(await selection.inputValue(), "")
    assert.equal(await outputCount(page).textContent(), "2 pages")
  } finally {
    await browser?.close()
  }
})

test(
  "Settings steps lens magnification by two and keeps its value beside the controls",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      const settings = page.getByRole("dialog", { name: "Settings", exact: true })
      await page.getByRole("button", { name: "Settings", exact: true }).click()
      assert.match(await settings.locator("dl").innerText(), /Version[\s\S]+Build ID/)
      const repository = settings.getByRole("link", { name: "Mainz on GitHub (opens in a new tab)", exact: true })
      assert.equal(await repository.getAttribute("href"), "https://github.com/roktas/mainz")
      const repositoryBounds = await repository.boundingBox()
      assert.ok(repositoryBounds.width >= 44 && repositoryBounds.height >= 44)
      const value = settings.getByLabel("Lens magnification", { exact: true })
      const close = settings.getByRole("button", { name: "Close Settings", exact: true })
      assert.equal(
        await close.evaluate((button) => button.matches(":focus-visible")),
        false,
        "Pointer opening does not outline Close",
      )
      assert.equal(
        await settings.evaluate((dialog) => document.activeElement === dialog),
        true,
        "Pointer opening focuses Settings drawer",
      )
      const decrease = settings.getByRole("button", { name: "Decrease lens magnification", exact: true })
      const increase = settings.getByRole("button", { name: "Increase lens magnification", exact: true })
      assert.equal(await value.textContent(), "16×")
      for (const expected of [8, 4, 2]) {
        await decrease.press("Enter")
        assert.equal(await value.textContent(), `${expected}×`)
      }
      assert.equal(await decrease.isDisabled(), true, "lower boundary")
      for (const expected of [4, 8, 16, 32, 64, 128]) {
        await increase.press(expected === 16 ? "Space" : "Enter")
        assert.equal(await value.textContent(), `${expected}×`)
      }
      assert.equal(await increase.isDisabled(), true, "upper boundary")
      for (const width of [320, 810, 1440])
        for (const theme of ["light", "dark"])
          for (const scale of [100, 200]) {
            const label = `${width}px, ${theme}, ${scale}% text`
            await page.setViewportSize({ width, height: 1080 })
            await page.evaluate(
              (appearance) => {
                document.documentElement.dataset.theme = appearance.theme
                document.documentElement.style.fontSize = `${appearance.scale}%`
              },
              { theme, scale },
            )
            await measure(page.locator(".selection-panel"))
            const boxes = await Promise.all([value.boundingBox(), decrease.boundingBox(), increase.boundingBox()])
            for (const box of boxes.slice(1)) {
              assert.ok(box.width >= 44 && box.height >= 44, `${label}: full touch target`)
              assert.ok(
                Math.abs(box.y + box.height / 2 - boxes[0].y - boxes[0].height / 2) < 1,
                `${label}: value center`,
              )
            }
            assert.ok(
              boxes[0].x + boxes[0].width <= boxes[1].x && boxes[1].x + boxes[1].width <= boxes[2].x,
              `${label}: separate controls`,
            )
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label)
          }
      for (const expected of [64, 32, 16]) {
        await decrease.click()
        assert.equal(await value.textContent(), `${expected}×`)
      }
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "Settings", exact: true }).press("Enter")
      assert.equal(await value.textContent(), "16×", "Closing Settings retains lens magnification")
      assert.equal(
        await close.evaluate((button) => button === document.activeElement && button.matches(":focus-visible")),
        true,
        "Keyboard opening keeps visible Close focus",
      )
      await close.press("Tab")
      assert.equal(
        await decrease.evaluate((button) => button === document.activeElement && button.matches(":focus-visible")),
        true,
        "Keyboard navigation keeps visible control focus",
      )
      await page.keyboard.press("Escape")
      // Touch clicks can carry zero detail even after a pointer activation.
      const opener = page.getByRole("button", { name: "Settings", exact: true })
      await opener.dispatchEvent("pointerdown", { pointerType: "touch" })
      await opener.dispatchEvent("click", { detail: 0 })
      assert.equal(
        await close.evaluate((button) => button.matches(":focus-visible")),
        false,
        "Touch opening does not outline Close",
      )
      await page.keyboard.press("Escape")
      await page.setViewportSize({ width: 1440, height: 1080 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const inputSwitch = page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true })
      if (await inputSwitch.isVisible()) await inputSwitch.click()
      await page
        .locator('.composer input[type=file][aria-label="Open PDF"]')
        .first()
        .setInputFiles({
          name: "Lens.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
      await page.locator(".status-input").filter({ hasText: "Lens.pdf" }).waitFor({ state: "attached" })
      const rasters = []
      for (const [expected, steps] of [
        [2, -3],
        [128, 6],
      ]) {
        await page.getByRole("button", { name: "Settings", exact: true }).click()
        for (let index = 0; index < Math.abs(steps); index++) await (steps < 0 ? decrease : increase).click()
        assert.equal(await value.textContent(), `${expected}×`)
        await close.click()
        const canvas = page.locator(".selection-panel .thumbnail canvas").first()
        await page.locator('.selection-panel .thumbnail[aria-busy="false"]').first().waitFor()
        const bounds = await canvas.boundingBox()
        await canvas.hover({
          position: {
            x: (bounds.width * 20) / 595.2756,
            y: (bounds.height * (841.8898 - 250)) / 841.8898,
          },
        })
        const lens = page.getByRole("region", { name: `Magnified page 1 at ${expected}×`, exact: true })
        await lens.waitFor()
        await page.waitForFunction(() => document.querySelector(".lens")?.getAttribute("aria-busy") === "false")
        rasters.push(
          await lens
            .locator("canvas")
            .evaluate((raster) => ({ width: raster.width, height: raster.height, pixels: raster.toDataURL() })),
        )
        await page.mouse.move(0, 0)
        await lens.waitFor({ state: "detached" })
      }
      assert.ok(rasters[0].width > 0 && rasters[0].height > 0)
      assert.equal(rasters[0].width, rasters[1].width, "Magnification retains the bounded crop width")
      assert.equal(rasters[0].height, rasters[1].height, "Magnification retains the bounded crop height")
      assert.notEqual(rasters[0].pixels, rasters[1].pixels, "The endpoint values change the rendered crop")
    } finally {
      await browser?.close()
    }
  },
)

test("Page addition hint skips on any click", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "no-preference",
    })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0] + "?demo=empty")
    const flight = page.locator(".page-flight:popover-open")
    const total = () => outputCount(page).textContent()
    const pause = () => flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.pause()))
    await flight.waitFor()
    await pause()
    await page.locator(".header-feedback [role=status]").click()
    assert.equal(await flight.count(), 0, "Clicking outside page controls immediately skips a paused animation")
    assert.equal(
      await page.getByRole("banner").getByRole("status").count(),
      0,
      "Skipping also dismisses the addition notice",
    )
    assert.equal(await total(), "0 pages")
    await page.reload()
    await flight.waitFor()
    await pause()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "Settings", exact: true })
    assert.equal(await settings.isVisible(), true, "The same click still opens Settings")
    assert.equal(await flight.count(), 0)
    await settings.getByRole("button", { name: "Close Settings", exact: true }).click()
    for (const width of [390, 810]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))))
      await page.reload()
      await flight.waitFor()
      await pause()
      const header = await page.locator(".header-inner").boundingBox()
      await selectPane(
        page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }),
        "tap",
      )
      assert.equal(await flight.count(), 0, "Touch activation also skips the animation immediately")
      assert.deepEqual(
        await page.locator(".header-inner").boundingBox(),
        header,
        `${width}px: Notice dismissal keeps the header in place`,
      )
      assert.equal(await page.locator(".composition-output").isVisible(), true)
      assert.equal(await total(), "0 pages")
    }
  } finally {
    await browser?.close()
  }
})

test("Onboarding reset is consumed once and preserves other preferences", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    const url = server.resolvedUrls.local[0]
    await page.goto(url)
    await page.evaluate(() => {
      localStorage.setItem("mainz:onboarding", "19")
      localStorage.setItem("mainz:theme", "dark")
    })
    const open = async () => {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "welcome.pdf", mimeType: "application/pdf", buffer: fixture() })
      await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "welcome.pdf", null, {
        timeout: 30000,
      })
    }
    await page.goto(`${url}?reset&keep=1#practice`)
    await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).waitFor()
    assert.equal(new URL(page.url()).search, "?keep=1")
    assert.equal(new URL(page.url()).hash, "#practice")
    assert.deepEqual(
      await page.evaluate(() => [localStorage.getItem("mainz:onboarding"), localStorage.getItem("mainz:theme")]),
      [null, "dark"],
    )
    await open()
    const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
    await welcome.waitFor()
    await welcome.getByRole("button", { name: "Skip", exact: true }).click()
    await page.reload()
    await open()
    assert.equal(await welcome.isVisible(), false)
    assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), "19")
  } finally {
    await browser?.close()
  }
})

test("Tours reveal their targets and restore pane views, preparation, and focus", { timeout: 90000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    const prepared = fixture()
    await page.goto(server.resolvedUrls.local[0])
    const errors = []
    const recordError = (error) => errors.push(error.message)
    page.on("pageerror", recordError)
    await page.setViewportSize({ width: 1440, height: 1100 })
    await page.emulateMedia({ reducedMotion: "reduce" })
    const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
    const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
    const help = page.getByRole("button", { name: "Help", exact: true })
    const startTour = async () => {
      await help.click()
      await page
        .getByRole("dialog", { name: "Help", exact: true })
        .getByRole("button", { name: "Start Tour", exact: true })
        .click()
    }
    const workspaceSteps = [
      "input-grid",
      "input-list",
      "input-page",
      "style",
      "output-grid",
      "output-list",
      "output-selection",
      "output-page",
      "download",
    ]
    await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).waitFor()
    assert.ok(!(await welcome.isVisible()), "Onboarding waits for a successfully opened PDF")
    assert.ok(
      (await page.locator(".header-note").getAttribute("title")) === "Processed on your device. No uploads.",
      "The header note explains local processing on hover",
    )
    const step = async (key) => {
      await page.waitForFunction(
        (value) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === value,
        key,
      )
      const target = page.locator(`[data-tour-target="${key}"]`)
      await target.waitFor()
      assert.ok(await target.isVisible(), `Tour target ${key} is visible`)
      await page.waitForFunction((value) => {
        const guide = document.querySelector(".help-tour:popover-open")
        const control = document.querySelector(`[data-tour-target="${value}"]`)
        if (!guide || !control) return false
        const backdrop = getComputedStyle(guide, "::backdrop")
        const width = parseFloat(backdrop.width)
        const height = parseFloat(backdrop.height)
        const left = parseFloat(backdrop.left) - width / 2
        const top = parseFloat(backdrop.top) - height / 2
        const tab = document.querySelector(`[data-tour-tab="${value}"]`)
        const parts = [control, ...(tab ? [tab] : [])].map((part) => part.getBoundingClientRect())
        return (
          parts.every(
            (part) =>
              left <= Math.max(0, part.left - 16) + 1 &&
              top <= Math.max(0, part.top - 16) + 1 &&
              left + width >= Math.min(innerWidth, part.right + 16) - 1 &&
              top + height >= Math.min(innerHeight, part.bottom + 16) - 1,
          ) &&
          width <= Math.max(...parts.map((part) => part.right)) - Math.min(...parts.map((part) => part.left)) + 64 &&
          height <= Math.max(...parts.map((part) => part.bottom)) - Math.min(...parts.map((part) => part.top)) + 64
        )
      }, key)
      assert.ok(
        await tour.getByRole("heading", { level: 2 }).evaluate((heading) => {
          const title = heading.getBoundingClientRect()
          const card = heading.closest(".help-tour").getBoundingClientRect()
          return title.top >= card.top && title.bottom <= card.bottom
        }),
        `Tour ${key} starts with its title visible`,
      )
      assert.ok(
        await tour.evaluate((guide) => {
          const backdrop = getComputedStyle(guide, "::backdrop")
          return (
            backdrop.filter.startsWith("blur(") && backdrop.boxShadow !== "none" && backdrop.pointerEvents === "none"
          )
        }),
        `Tour ${key} has a soft spotlight without blocking controls`,
      )
      const tab = page.locator(`[data-tour-tab="${key}"]`)
      if (await tab.count()) {
        assert.ok(
          (await tab.getAttribute("aria-selected")) === "true" &&
            (await tab.getAttribute("data-tour-active")) === "true",
          `Tour ${key} illuminates the selected tab together with its content`,
        )
      }
      if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))
        assert.ok(
          await tour.evaluate((guide) => guide.getAnimations({ subtree: true }).length === 0),
          `Tour ${key} honors reduced motion`,
        )
      if (key === "output-selection") {
        const unselected =
          (await target.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === ""
        for (const name of ["Remove selected Output pages", "Duplicate selected Output pages"])
          assert.ok(
            (await target.getByRole("button", { name, exact: true }).isDisabled()) === unselected,
            `Tour shows ${name}, disabled without a selection`,
          )
      }
      if (key === "download")
        for (const action of ["Export recipe", "Print PDF", "View PDF"])
          assert.ok((await tour.innerText()).includes(action), `Tour explains ${action}`)
    }
    const open = async (name, buffer) => {
      const count = await page.locator(".input-list button[data-source]").count()
      await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
      await page.waitForFunction(
        ({ label, previous }) =>
          (document.querySelector(".composer:not([inert]) .input-current")?.textContent === label &&
            document.querySelectorAll(".input-list button[data-source]").length === previous + 1) ||
          document.querySelector(".header-feedback .feedback[data-kind=error]"),
        { label: name, previous: count },
        { timeout: 60000 },
      )
      assert.ok(
        (await page.locator(".input-current").count()) > 0 &&
          (await page.locator(".input-current").textContent()) === name &&
          (await page.locator(".input-list button[data-source]").count()) === count + 1,
        `Open ${name}: ${(await page.locator("[role=alert]").allTextContents()).join("; ")}`,
      )
    }
    assert.ok(
      await page.locator(".footnote").evaluate((footer) => getComputedStyle(footer).borderTopWidth === "0px"),
      "Landing status has no divider",
    )
    const fileDrag = await page.evaluateHandle((bytes) => {
      const data = new DataTransfer()
      data.items.add(new File([Uint8Array.from(bytes)], "Practice book.pdf", { type: "application/pdf" }))
      return data
    }, Array.from(prepared))
    const landing = page.locator(".drop-zone")
    const landingHeight = (await landing.boundingBox()).height
    await landing.dispatchEvent("dragenter", { dataTransfer: fileDrag })
    assert.ok(
      await landing.getByText("Drop a PDF to open", { exact: true }).isVisible(),
      "PDF drag shows an explicit file target",
    )
    await landing.locator(".welcome").dispatchEvent("dragenter", { dataTransfer: fileDrag })
    await landing.locator(".welcome").dispatchEvent("dragleave", { dataTransfer: fileDrag })
    assert.ok(
      (await landing.getByText("Drop a PDF to open", { exact: true }).isVisible()) &&
        (await landing.boundingBox()).height === landingHeight,
      "Nested file drag events preserve the target and layout",
    )
    await landing.dispatchEvent("drop", { dataTransfer: fileDrag })
    await fileDrag.dispose()
    await page.waitForFunction(
      () => document.querySelector(".input-current")?.textContent === "Practice book.pdf",
      null,
      { timeout: 60000 },
    )
    assert.ok(!(await page.locator(".drop-prompt").count()), "Opening the dropped PDF clears file drag feedback")
    await welcome.waitFor()
    assert.ok(
      await welcome
        .getByRole("button", { name: "Skip", exact: true })
        .evaluate((button) => button === document.activeElement),
      "The first opened PDF shows onboarding with a focused primary action",
    )
    await welcome.getByRole("button", { name: "Take a tour", exact: true }).click()
    await step("input")
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step("input-grid")
    await page.waitForFunction(() =>
      document
        .querySelector(".help-tour")
        .getAnimations({ subtree: true })
        .some((animation) => animation.effect.pseudoElement === "::backdrop"),
    )
    assert.ok(
      await tour.evaluate(async (guide) => {
        const pulse = guide
          .getAnimations({ subtree: true })
          .find((animation) => animation.effect.pseudoElement === "::backdrop")
        const valid = pulse.effect.getTiming().duration === 280
        await pulse.finished
        return valid
      }),
      "A new tour target briefly fades the spotlight backdrop",
    )
    await page.emulateMedia({ reducedMotion: "reduce" })
    await tour.getByRole("button", { name: "Back", exact: true }).click()
    await step("input")
    for (const key of [
      "input-grid",
      "input-list",
      "input-page",
      "output-grid",
      "output-list",
      "output-selection",
      "output-page",
      "download",
    ]) {
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await step(key)
    }
    assert.ok(
      (await tour.locator(".tour-progress").textContent()).includes("/ 9"),
      "Empty Output shows Pages and selection actions without adding sample pages",
    )
    await page.keyboard.press("Escape")
    await tour.waitFor({ state: "hidden" })
    assert.ok(
      await help.evaluate((button) => button === document.activeElement),
      "Escape dismisses the tour and returns focus to Help",
    )
    await page.reload()
    await open("Practice book.pdf", prepared)
    assert.ok(!(await welcome.isVisible()), "Onboarding dismissal persists after reopening a PDF")
    await page
      .locator(".selection-panel")
      .getByRole("textbox", { name: "Page selection", exact: true })
      .fill("3-5,2,2,7")
    await page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true }).press("Enter")
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "6 pages",
    )
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    assert.ok(
      (await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === "",
      "Bulk addition clears the Input preparation",
    )
    assert.ok(
      (await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === "1-6",
      "Bulk addition selects the new Output block",
    )
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("3-5,2,2,7")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    const inputGrid = () => input.getByRole("tab", { name: "Grid", exact: true })
    const inputStyle = () => input.getByRole("tab", { name: "Style", exact: true })
    const outputGrid = () => output.getByRole("tab", { name: "Grid", exact: true })
    const outputPage = () => output.getByRole("tab", { name: "Page", exact: true })
    await inputStyle().click()
    await outputPage().click()
    await startTour()
    await step("input")
    assert.ok(
      await page.locator('[data-tour-target="input"] input[aria-label="Open PDF"]').evaluate((field) => field.multiple),
      "The Input step includes the file chooser that accepts several PDFs",
    )
    for (const key of workspaceSteps) {
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await step(key)
      if (key === "input-grid")
        assert.ok((await inputGrid().getAttribute("aria-selected")) === "true", "Tour opens Input Grid")
      if (key === "input-page")
        assert.ok(
          (await input.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected")) === "true",
          "Tour opens Input Page",
        )
      if (key === "style")
        assert.ok(
          (await inputStyle().getAttribute("aria-selected")) === "true" &&
            (await inputStyle().getAttribute("data-tour-active")) === "true",
          "Tour selects and highlights Style",
        )
      if (key === "output-grid")
        assert.ok((await outputGrid().getAttribute("aria-selected")) === "true", "Tour opens Output Grid")
      if (key === "output-page")
        assert.ok((await outputPage().getAttribute("aria-selected")) === "true", "Tour opens Output Page")
    }
    assert.ok(
      (await tour.locator(".tour-progress").textContent()).includes("/ 10"),
      "Style adds one step to the nine-step tour",
    )
    await tour.getByRole("button", { name: "Finish", exact: true }).click()
    assert.ok(
      (await inputStyle().getAttribute("aria-selected")) === "true" &&
        (await outputPage().getAttribute("aria-selected")) === "true",
      "Tour restores the previous workspace tabs",
    )
    assert.ok((await outputCount(page).textContent()) === "6 pages", "Tour preserves Output")
    await startTour()
    await step("input")
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step("input-grid")
    await page.evaluate(() => window.scrollBy(0, 32))
    await step("input-grid")
    await page.setViewportSize({ width: 390, height: 900 })
    await step("input-grid")
    await page.setViewportSize({ width: 1440, height: 1100 })
    await step("input-grid")
    await tour.getByRole("button", { name: "End tour", exact: true }).click()
    await tour.waitFor({ state: "hidden" })
    assert.ok(
      (await inputStyle().getAttribute("aria-selected")) === "true" &&
        (await outputPage().getAttribute("aria-selected")) === "true" &&
        (await outputCount(page).textContent()) === "6 pages" &&
        (await help.evaluate((button) => button === document.activeElement)),
      "End tour restores the previous tabs and focus without changing Output",
    )
    await startTour()
    await step("input")
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step("input-grid")
    await page.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }).click()
    await tour.waitFor({ state: "hidden" })
    const selectedSequence = page
      .locator(".selection-panel")
      .getByRole("textbox", { name: "Page selection", exact: true })
    assert.ok(
      (await selectedSequence.inputValue()) === "3-5, 2, 2, 7, 1",
      "Clicking a toured grip selects its page without restoring Style over the click",
    )
    assert.ok(
      (await inputGrid().getAttribute("aria-selected")) === "true",
      "Workspace interaction retains the pane and tab being used",
    )
    await selectedSequence.fill("3-5,2,2,7")
    await inputStyle().click()
    await startTour()
    await step("input")
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step("input-grid")
    await selectedSequence.focus()
    await tour.waitFor({ state: "hidden" })
    assert.ok(
      await selectedSequence.evaluate((field) => field === document.activeElement),
      "Keyboard focus can leave the tour for a workspace control without losing its tab",
    )
    await inputGrid().click()
    await outputGrid().click()
    assert.ok(
      (await page
        .locator(".selection-panel")
        .getByRole("textbox", { name: "Page selection", exact: true })
        .inputValue()) === "3-5,2,2,7",
      "Tour preserves the exact page sequence",
    )
    for (const [width, size] of [
      [390, "100%"],
      [320, "200%"],
    ]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), size)
      await startTour()
      await step("input")
      for (const key of workspaceSteps) {
        await tour.getByRole("button", { name: "Next", exact: true }).click()
        await step(key)
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          `Workspace tour ${key} fits ${width}px with ${size} text`,
        )
        const exit = await tour.getByRole("button", { name: "End tour", exact: true }).boundingBox()
        const card = await tour.boundingBox()
        assert.ok(
          exit.y >= card.y && exit.y + exit.height <= card.y + card.height,
          `End tour stays visible at ${key} with ${size} text`,
        )
      }
      await tour.getByRole("button", { name: "Finish", exact: true }).click()
      assert.ok(
        (await page.locator(".composer").getAttribute("data-view")) === "input",
        "Tour restores the mobile Input view",
      )
    }
    await page.evaluate(() => (document.documentElement.style.fontSize = ""))
    await page.setViewportSize({ width: 1440, height: 1100 })
  } finally {
    await browser.close()
  }
})

test("Blank-only Output offers its six-step tour without adding pages", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.locator(".landing-recipe input[type=file]").setInputFiles({
      name: "Blank.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          inputs: {},
          sources: {},
          parts: [{ pages: [{ blank: { width: 210, height: 297 } }] }],
        }),
      ),
    })
    await page.getByRole("button", { name: "Apply recipe", exact: true }).click()
    const blankOutput = page.locator(".composition-output")
    await page.getByRole("button", { name: "Help", exact: true }).click()
    await page.getByRole("button", { name: "Start Tour", exact: true }).click()
    const blankTour = page.getByRole("dialog", { name: "Product tour", exact: true })
    await blankTour.waitFor()
    for (const key of ["output-grid", "output-list", "output-selection", "output-page", "download"]) {
      await page.waitForFunction(
        (value) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === value,
        key,
      )
      assert.equal(await page.locator(`[data-tour-target="${key}"]`).isVisible(), true)
      if (key !== "download") await blankTour.getByRole("button", { name: "Next", exact: true }).click()
    }
    assert.match(await blankTour.locator(".tour-progress").textContent(), /\/ 5/)
    for (const action of ["Export recipe", "Print PDF", "View PDF"])
      assert.ok((await blankTour.innerText()).includes(action), `Tour explains ${action}`)
    await blankTour.getByRole("button", { name: "Finish", exact: true }).click()
    assert.equal(await blankOutput.locator(".composition-totals strong").textContent(), "1 page")
    assert.equal((await blankOutput.locator(".composition-totals").innerText()).trim(), "1 page, 1 sheet")
  } finally {
    await browser.close()
  }
})

test(
  "The first-action hint waits for onboarding and keeps its timing and notice contrast",
  { timeout: 45000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      })
      await page.goto(server.resolvedUrls.local[0])
      const openHintInput = async () => {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "First action.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ prepared: false }),
          })
        await page.locator(".input-current").waitFor({ state: "attached" })
      }
      await openHintInput()
      const instruction = "Select pages · Use + to add to Output"
      const status = page.locator(".footnote [role=status] span")
      const notice = page.locator(".header-feedback [role=status]").filter({ hasText: instruction })
      const instructionText = notice
      const flight = page.locator(".page-flight:popover-open")
      const hintWelcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      const hintTour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await hintWelcome.waitFor()
      assert.equal(await notice.count(), 0)
      await hintWelcome.getByRole("button", { name: "Take a tour", exact: true }).click()
      await hintTour.waitFor()
      assert.equal(await notice.count(), 0)
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click()
      await flight.waitFor()
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector(".page-flight"), "::backdrop").opacity) > 0.9,
      )
      assert.deepEqual(
        await flight.evaluate((element) => {
          const { delay, duration } = element
            .getAnimations()
            .find((animation) => !animation.effect.pseudoElement)
            .effect.getTiming()
          return { delay, duration }
        }),
        { delay: 2600, duration: 4200 },
      )
      assert.equal(await flight.evaluate((element) => getComputedStyle(element).opacity), "0")
      assert.equal((await instructionText.textContent()).trim(), instruction)
      assert.equal(
        await page.getByRole("button", { name: "Select Input page 1", exact: true }).getAttribute("aria-pressed"),
        "true",
      )
      assert.equal(await outputCount(page).textContent(), "0 pages")
      const origin = await page.locator('[data-tour-target="first-page"] .thumbnail canvas').boundingBox()
      const spotlight = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop")
        return [style.translate, style.insetInlineStart, style.insetBlockStart]
      })
      await page.waitForFunction(
        (left) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > left,
        origin.x + 8,
      )
      const fading = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop")
        return {
          position: [style.translate, style.insetInlineStart, style.insetBlockStart],
          opacity: Number(style.opacity),
        }
      })
      assert.deepEqual(fading.position, spotlight, "The spotlight stays over Input while the copy moves")
      assert.ok(
        fading.opacity > 0.25 && fading.opacity < 0.9,
        "The copy starts moving while the fading light is visible",
      )
      await page.waitForFunction(
        (right) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > right,
        origin.x + origin.width,
      )
      assert.equal(
        await instructionText.evaluate((element) => getComputedStyle(element).opacity),
        "1",
        "Notice text keeps its full contrast during display",
      )
      await flight.waitFor({ state: "hidden" })
      assert.equal((await instructionText.textContent()).trim(), instruction)
      assert.equal(await outputCount(page).textContent(), "0 pages")
      assert.equal(
        await instructionText.evaluate((element) => getComputedStyle(element).fontWeight),
        "700",
        "The instruction uses the header notification treatment",
      )
      const headerBounds = await page.getByRole("banner").boundingBox()
      const noticeBounds = await notice.boundingBox()
      assert.ok(
        noticeBounds.y >= headerBounds.y &&
          noticeBounds.y + noticeBounds.height <= headerBounds.y + headerBounds.height,
        "The addition instruction stays within the header",
      )
      assert.match(await status.textContent(), /Opened 1 page/)
      await notice.waitFor({ state: "hidden", timeout: 15000 })
      assert.match(await status.textContent(), /Opened 1 page/)
    } finally {
      await browser.close()
    }
  },
)

test("First-action feedback respects reduced motion and enlarged phone text", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    for (const [width, text, reducedMotion] of [
      [1440, "100%", "reduce"],
      [390, "200%", "no-preference"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 900 }, reducedMotion })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Hint.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).scrollIntoViewIfNeeded()
      const notice = page.locator(".header-feedback [role=status]").filter({ hasText: "Select pages" })
      await notice.waitFor()
      const bounds = await notice.boundingBox()
      assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width + 1)
      const flight = page.locator(".page-flight:popover-open")
      if (reducedMotion === "reduce") assert.equal(await flight.count(), 0)
      else {
        await flight.waitFor()
        await page.emulateMedia({ reducedMotion: "reduce" })
        await flight.waitFor({ state: "hidden" })
      }
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await notice.waitFor({ state: "hidden" })
      assert.match(await page.locator(".footnote [role=status]").innerText(), /Added 1 page/)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})
