// Checks Grid and Page keyboard selection, shortcuts, Escape handling, and boundary buttons.

import { setup, selectPane, outputCount, tab, pagePosition, gridPage, fixture, hasCursor } from "./browser.js"
import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { zoom } from "./workspace.js"

test("Grid keyboard selection toggles at the cursor and stops at boundaries", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, theme, textSize] of [
      [1440, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      await page.addInitScript((choice) => {
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
      const prepared = input.getByLabel("Page selection", { exact: true })
      await prepared.fill("1-14")
      await prepared.press("Enter")
      if (width === 390)
        await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      await output.getByLabel("Page selection", { exact: true }).fill("")
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
        const panel = name === "Input" ? input : output
        const selection = panel.getByLabel("Page selection", { exact: true })
        const cards = panel.locator("button.page-image")
        const cursor = async (number) => {
          if (name === "Output")
            assert.equal(
              await panel
                .locator(".composition-card > .occurrence-actions button")
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
        const resetScroll = async () => {
          const grid = panel.locator(".grid-view")
          await grid.evaluate((element) => (element.scrollTop = 0))
          await grid.locator('.page-image[data-page="0"]').waitFor()
        }
        await resetScroll()
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
        await resetScroll()
        await (await gridPage(panel, 4)).focus()
        await steps([
          ["Shift+ArrowRight", "4", 5],
          ["Shift+ArrowRight", "4-5", 6],
          ["Shift+ArrowLeft", "4", 5],
          ["Shift+ArrowLeft", "", 4],
        ])
        await (await gridPage(panel, 14)).focus()
        await steps([
          ["Shift+ArrowRight", "14", 15],
          ["Shift+ArrowRight", "14", 15],
          ["ArrowRight", "14", 15],
          ["Shift+ArrowLeft", "", 14],
          ["Shift+ArrowRight", "14", 15],
          ["ArrowLeft", "14", 14],
        ])
        await selection.fill("")
        await resetScroll()
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
          const total = () => outputCount(page).textContent()
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

test("Output separates page controls from group actions for keyboard and mouse", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const interaction of ["keyboard", "mouse"]) {
      // Keep all ten pages visible while checking group actions across copies.
      const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Groups.pdf", mimeType: "application/pdf", buffer: fixture() })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const prepared = input.getByRole("textbox", { name: "Page selection", exact: true })
      const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
      const total = () => outputCount(page).textContent()
      const contents = async () =>
        await output
          .locator(
            '.composition-card:not([inert]) .page-origin-info .page-details tr:has(th:text-is("Original page"), th:text-is("Size")) td',
          )
          .allTextContents()
      if (interaction === "keyboard") {
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).press("Space")
        await page.keyboard.press("Enter")
      } else {
        await prepared.fill("1")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
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
      assert.deepEqual(await contents(), ["1", "2", "3", "4"])
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
        ["2", "3", "4", "1"],
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
      assert.deepEqual(await contents(), ["1", "2", "3", "4"])
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
      assert.deepEqual(await contents(), ["1", "2", "3", "4", "2", "3", "4", "2", "3", "4"])
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
      assert.deepEqual(await contents(), ["1", "2", "3", "4", "2", "4"], "Nonconsecutive targets copy in print order")
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
        ["2", "1", "4", "3", "3", "2", "4"],
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
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      const warnings = []
      page.on("console", (entry) => {
        if (entry.type() === "warning") warnings.push(entry.text())
      })
      await setup(page)
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
      const contents = async () =>
        await output
          .locator(
            '.composition-card:not([inert]) .page-origin-info .page-details tr:has(th:text-is("Original page"), th:text-is("Size")) td',
          )
          .allTextContents()
      const clear = async () => {
        if (!(await selected.isDisabled())) {
          const count = parseInt(await outputCount(page).textContent())
          await selected.fill(`1-${count}`)
          await selected.press("Enter")
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
              let expected = ["1", "2", "3", "4"]
              const adds = pane === "Input" && ["Enter", "Shift+Equal"].includes(key)
              if (adds) {
                expected.push(...(inputSelection ? ["2", "3"] : ["1"]))
              } else if (pane === "Output" && ["Enter", "Shift+Equal"].includes(key)) {
                if (outputSelection) expected.push("2", "4")
                else expected = ["1", "1", "2", "3", "4"]
              } else if (key === "Delete" || (pane === "Output" && key === "-")) {
                if (outputSelection) expected = ["1", "3"]
                else if (pane === "Output" && key === "-") expected = ["2", "3", "4"]
              } else if (outputSelection && key === "Control+ArrowLeft") {
                expected = ["2", "1", "4", "3"]
              } else if (pane === "Output" && !outputSelection && key === "Control+ArrowRight") {
                expected = ["2", "1", "3", "4"]
              }
              const scenario = `${pane} ${key}; Input selection=${inputSelection}, Output selection=${outputSelection}`
              assert.deepEqual(await contents(), expected, scenario)
              assert.equal(
                await prepared.inputValue(),
                inputSelection && !adds && !(pane === "Input" && key === "Escape") ? "2-3" : "",
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
        assert.deepEqual(await contents(), ["1", "2", "3"])
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
      assert.deepEqual(await contents(), ["1", "2", "3"], "Delete in a text field only edits text")
      await output.getByLabel("Output page actions", { exact: true }).click()
      await page.keyboard.press("Delete")
      assert.deepEqual(await contents(), ["1", "2", "3"], "Open menus retain their keys")
      await page.keyboard.press("Escape")
      await page.keyboard.press("Delete")
      assert.deepEqual(await contents(), ["1"], "Delete works again after a menu closes")
      await clear()
      await prepared.fill("1-3")
      await prepared.press("Enter")
      await selected.fill("2-3")
      await output.getByRole("button", { name: "Select Output page 1", exact: true }).click()
      await page.keyboard.press("Enter")
      assert.deepEqual(
        await contents(),
        ["1", "2", "3", "1", "2", "3"],
        "Mouse selection can immediately duplicate with Enter",
      )
      await page.keyboard.press("Delete")
      assert.deepEqual(await contents(), ["1", "2", "3"], "The copied group can immediately be removed")
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
        assert.equal(await outputCount(page).textContent(), "0 pages", "Removal changes data immediately")
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
      await tab(input, "List")
      assert.equal(
        await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).isVisible(),
        true,
        "List retains individual actions after Grid keyboard navigation",
      )
      await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).press("Enter")
      assert.equal(
        await input
          .getByRole("button", { name: "Add Input page 4 to Output", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      )
      await tab(input, "Page")
      assert.match(await pagePosition(input), /4\s*\/ 7/, "A List addition updates the page opened for inspection")
      await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).press("Enter")
      assert.equal(
        await input
          .getByRole("region", { name: "PDF viewport", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Input Page addition keeps normal focus in Input",
      )
      await tab(output, "Page")
      assert.equal(await selected.inputValue(), "", "Individual Input additions keep Output unselected")
      await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
      assert.equal(
        await output
          .getByRole("region", { name: "PDF viewport", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Output Page editing retains normal viewport focus",
      )
      assert.equal(await selected.inputValue(), "", "Individual Output Page duplication preserves the empty selection")
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
      await output.getByRole("button", { name: "Go to page in Output", exact: true }).click()
      const entry = output.getByRole("textbox", { name: "Output page number", exact: true })
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
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const [name, width, scale, theme] of [
        ["Input", 1440, 100, "light"],
        ["Output", 1440, 100, "light"],
        ["Input", 390, 200, "dark"],
        ["Output", 390, 200, "dark"],
      ]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 500 }, reducedMotion: "reduce" })
        await setup(page)
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
            await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await setup(page)
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
    await tab(input, "List")
    const action = input.getByRole("button", { name: "Add Input page 1 to Output", exact: true })
    await action.focus()
    await page.mouse.move(8, 20)
    await page.keyboard.press("Control+a")
    assert.equal(
      await prepared.evaluate((element) => element === document.activeElement),
      true,
      "When selection removes the focused List action, focus returns to the field",
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
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Keyboard.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    const total = () => outputCount(page).textContent()
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
    await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }))
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const colorScheme of ["light", "dark"]) {
      const page = await browser.newPage({ colorScheme, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
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
        await selectPane(views.getByRole("button", { name: "Output", exact: true }))
        await tab(output, "Grid")
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
              `${colorScheme}, ${width}, ${text}: direction buttons retain their slots`,
            )
            assert.equal(await action.isEnabled(), true)
            const hit = await page.evaluate(
              ({ x, y }) => document.elementFromPoint(x, y)?.closest("button")?.getAttribute("aria-label"),
              { x: point.x + point.width / 2, y: point.y + point.height / 2 },
            )
            assert.equal(
              hit,
              await action.getAttribute("aria-label"),
              `${colorScheme}, ${width}, ${text}, ${start}, step=${step}: the retained coordinate hits its action`,
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
        const overflow = await page.evaluate(() => ({
          width: innerWidth,
          scroll: document.documentElement.scrollWidth,
          elements: [...document.querySelectorAll(".composer *")]
            .map((element) => ({
              tag: element.tagName,
              class: element.className,
              right: element.getBoundingClientRect().right,
            }))
            .filter((element) => element.right > innerWidth + 1),
        }))
        assert.equal(overflow.scroll <= overflow.width, true, JSON.stringify({ colorScheme, width, text, overflow }))
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})
