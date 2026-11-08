// Checks scrollable Grid, virtualized pages, and frame geometry; alignment owns theme and selection combinations.

import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium, webkit } from "playwright"
import { fixture, captureLayout, tab, checkStatus, checkPagination } from "./browser.js"
import { measure, gridDensity } from "./measure.js"
import inventory from "./viewports.json" with { type: "json" }
import { bounds as gridBounds, quality } from "./quality.ts"

test(
  "Grid virtualizes 250 pages with a fixed scroll viewport and preserves card geometry",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      for (const width of [390, 768, 1440]) {
        const page = await browser.newPage({ viewport: { width, height: 900 } })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Large.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ prepared: false, count: 250 }),
          })
        const viewport = page.locator(".selection-panel .grid-view")
        const list = viewport.locator(".composition-grid")
        await list.locator(".composition-card").first().waitFor()
        const inspect = async () =>
          viewport.evaluate((element) => {
            const grid = element.querySelector(".composition-grid")
            const cards = [...grid.querySelectorAll(".composition-card")]
            const first = cards[0]
            return {
              visible: cards.length,
              from: Number(grid.dataset.from),
              first: Number(first.querySelector(".page-image").dataset.page),
              last: Number(cards.at(-1).querySelector(".page-image").dataset.page),
              height: element.clientHeight,
              total: element.scrollHeight,
              width: first.getBoundingClientRect().width,
              cardHeight: first.getBoundingClientRect().height,
            }
          })
        const start = await inspect()
        assert.ok(start.visible < 30, JSON.stringify(start))
        assert.equal(start.width, 148)
        assert.equal(start.cardHeight, 240)
        assert.ok(start.total > start.height, JSON.stringify(start))
        await viewport.evaluate((element) => (element.scrollTop = element.scrollHeight))
        await list.locator('.page-image[data-page="249"]').waitFor()
        const end = await inspect()
        assert.equal(end.last, 249)
        assert.ok(end.visible < 30, JSON.stringify(end))
        assert.ok(Math.abs(end.height - start.height) < 2, JSON.stringify({ start, end }))
        assert.ok(Math.abs(end.total - start.total) < 10, JSON.stringify({ start, end }))
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test("Grid scroll windows keep 300 pages reachable with stable card geometry", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Long.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 300 }),
      })
    const grid = page.locator(".selection-panel .grid-view")
    await grid.waitFor()
    const cards = grid.locator(".composition-card")
    const firstWidth = await cards.first().evaluate((element) => element.getBoundingClientRect().width)
    assert.equal(Math.round(firstWidth), 148)
    const initial = await grid.evaluate((element) => ({
      content: element.scrollHeight,
      viewport: element.clientHeight,
      count: element.querySelectorAll(".composition-card").length,
    }))
    assert.ok(initial.content > initial.viewport * 10, JSON.stringify(initial))
    assert.ok(initial.count < 30, `Virtual window rendered ${initial.count} of 300 cards`)

    await grid.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await grid.locator('.page-image[data-page="299"]').waitFor()
    assert.ok((await cards.count()) < 30)
    const lastWidth = await cards.last().evaluate((element) => element.getBoundingClientRect().width)
    assert.ok(Math.abs(lastWidth - firstWidth) < 1)

    await grid.locator('.page-image[data-page="299"]').focus()
    await page.keyboard.press("Home")
    await grid.locator('.page-image[data-page="0"]').waitFor()
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "0")
    await page.keyboard.press("End")
    await grid.locator('.page-image[data-page="299"]').waitFor()
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "299")

    await page.setViewportSize({ width: 390, height: 844 })
    await grid.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await grid.locator('.page-image[data-page="299"]').waitFor()
    const narrow = await grid.evaluate((element) => ({
      viewport: element.clientWidth,
      overflow: element.scrollWidth - element.clientWidth,
      count: element.querySelectorAll(".composition-card").length,
    }))
    assert.ok(narrow.overflow <= 1 && narrow.count < 30, JSON.stringify(narrow))
    const input = page.locator(".selection-panel")
    const savedScroll = await grid.evaluate((element) => element.scrollTop)
    await tab(input, "List")
    await tab(input, "Grid")
    assert.ok((await grid.evaluate((element) => element.scrollTop)) >= savedScroll - 1)

    await page.setViewportSize({ width: 1440, height: 900 })
    await input.getByRole("button", { name: "Select all", exact: true }).click()
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    const output = page.locator(".composition-output .grid-view")
    await output.waitFor()
    await output.evaluate((element) => (element.scrollTop = element.scrollHeight))
    await output.locator('.page-image[data-page="299"]').waitFor()
    assert.ok((await output.locator(".composition-card").count()) < 30)
  } finally {
    await browser.close()
  }
})

test(
  "Grid preserves the first visible page through Flow switches and responsive resizing",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Long.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false, count: 300 }),
        })
      const input = page.locator(".selection-panel")
      const grid = input.locator(".grid-view")
      await grid.locator(".composition-card").first().waitFor()
      await grid.evaluate((element) => (element.scrollTop = 12500))
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .composition-grid")?.dataset.from === "94",
      )
      const first = await grid.evaluate((element) => element.scrollTop)
      await tab(input, "List")
      await input.locator(".page-list").waitFor()
      await tab(input, "Grid")
      await grid.waitFor()
      await page.waitForTimeout(200)
      assert.ok(Math.abs((await grid.evaluate((element) => element.scrollTop)) - first) <= 1)

      await page.setViewportSize({ width: 1440, height: 900 })
      await page.waitForFunction(() => document.querySelector(".selection-panel .grid-view")?.dataset.columns === "3")
      await page.waitForTimeout(200)
      const wide = await grid.evaluate((element) => {
        const cards = [...element.querySelectorAll(".composition-card")]
        return {
          first: Number(cards[0].querySelector(".page-image").dataset.page),
          columns: Number(element.dataset.columns),
          count: cards.length,
          width: cards[0].getBoundingClientRect().width,
          height: cards[0].getBoundingClientRect().height,
        }
      })
      assert.ok(wide.first >= 84 && wide.first <= 102, JSON.stringify(wide))
      assert.equal(wide.columns, 3)
      assert.ok(wide.count < 30)
      assert.equal(wide.width, 148)
      assert.equal(wide.height, 240)
      await tab(input, "List")
      await tab(input, "Grid")
      await page.waitForTimeout(200)
      const restored = await grid.evaluate((element) => ({
        columns: Number(element.dataset.columns),
        first: Number(element.querySelector(".page-image")?.dataset.page),
      }))
      assert.equal(restored.columns, 3)
      assert.ok(Math.abs(restored.first - wide.first) <= 3, JSON.stringify({ wide, restored }))
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  },
)

test("Grid back folds stay smaller than Page folds", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const input = page.locator(".selection-panel")
    const grid = input.locator('.composition-card[data-face="back"]').first()
    await grid.waitFor()
    const gridFold = await grid.evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue("--fold")))
    await tab(input, "Page")
    const pageFold = await input
      .locator(".page-view")
      .evaluate((element) => parseFloat(getComputedStyle(element).getPropertyValue("--fold")))
    assert.equal(gridFold, 12)
    assert.equal(pageFold, 24)
  } finally {
    await browser.close()
  }
})

test(
  "Normal Grid centers physical numbers and bounds long section details with page labels",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const chapter = "Chapter 16. External filters, programs and commands " + "Long title ".repeat(6)
    const section = "16.6. Communications commands " + "Long section ".repeat(6)
    for (const engine of [chromium, webkit]) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Labels.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 300,
              labels: Array.from({ length: 300 }, (_, page) => String(page - 5)),
              outline: [
                { title: chapter, page: 294 },
                { title: section, page: 294, parent: 0 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await gridDensity(input, "Normal Input grid")
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        await page.locator(".contents:popover-open .destination").filter({ hasText: section }).click()
        const card = input.locator('.composition-card:has(.page-image[data-page="294"])')
        const details = card.getByLabel("Details for Input page 295", { exact: true })
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await details.scrollIntoViewIfNeeded()
          const position = await details.evaluate((button) => {
            const number = button.querySelector("strong").getBoundingClientRect()
            const target = button.getBoundingClientRect()
            const frame = button.closest(".composition-card").getBoundingClientRect()
            return {
              centered: Math.abs(number.x + number.width / 2 - target.x - target.width / 2) < 1,
              inset: number.left - frame.left,
            }
          })
          assert.ok(position.centered && position.inset >= 8, JSON.stringify(position))
          await details.click()
          const panel = card.locator(".page-origin-info")
          assert.equal(await panel.getByRole("row", { name: "Page Label 289", exact: true }).count(), 1)
          const bounds = await panel.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return {
              fits: box.left >= 0 && box.right <= innerWidth + 1,
              overflow: element.scrollWidth > element.clientWidth + 1,
            }
          })
          assert.ok(bounds.fits && !bounds.overflow, JSON.stringify(bounds))
          await details.click()
        }
        await tab(input, "List")
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        await page.locator(".contents:popover-open .destination").filter({ hasText: section }).click()
        const heading = input.locator(".list-heading").first()
        const style = await heading.evaluate((button) => ({
          border: getComputedStyle(button).borderTopWidth,
          caps: getComputedStyle(button).fontVariantCaps,
          align: getComputedStyle(button).textAlign,
        }))
        assert.deepEqual(style, { border: "0px", caps: "all-small-caps", align: "start" })
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Unoutlined.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ prepared: false, count: 1, labels: ["i"] }),
          })
        await gridDensity(input, "Normal Input grid")
        await input.getByLabel("Details for Input page 1", { exact: true }).click()
        await input.locator(".page-origin-info").getByRole("row", { name: "Page Label i", exact: true }).waitFor()
      } finally {
        await browser.close()
      }
    }
  },
)

test("List keyboard ranges and inspection preserve their pane, selection, and focus", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const inputSelection = input.getByRole("textbox", { name: "Page selection", exact: true }),
        outputSelection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await tab(input, "List")
      await tab(output, "Page")
      await inputSelection.fill("")
      await input.locator('.list-choice[data-page="0"]').focus()
      await page.keyboard.press("Shift+N")
      const navigation = {
        output: (await output.locator(".page-position").innerText()).replace(/\s/g, ""),
        input: await input.locator(".list-choice:focus").getAttribute("data-page"),
      }
      await inputSelection.fill("")
      await input.locator('.list-choice[data-page="0"]').focus()
      await page.keyboard.press("Shift+ArrowDown")
      const inputRange = await inputSelection.inputValue()
      await tab(output, "List")
      await outputSelection.fill("")
      await output.locator('.list-choice[data-page="0"]').focus()
      await page.keyboard.press("Shift+ArrowDown")
      const outputRange = await outputSelection.inputValue()
      await inputSelection.fill("1,4")
      await input.locator('.list-choice[data-page="1"]').dblclick()
      const inspected = {
        selection: await inputSelection.inputValue(),
        page: (await input.locator(".page-position").innerText()).replace(/\s/g, ""),
      }
      await tab(input, "List")
      const focus = []
      for (const [pane, selection, name] of [
        [input, inputSelection, "Input"],
        [output, outputSelection, "Output"],
      ]) {
        await selection.fill("1,2")
        await pane.getByRole("button", { name: `Unselect ${name} page 1`, exact: true }).press("Enter")
        focus.push(
          await pane.locator('.list-choice[data-page="0"]').evaluate((element) => element === document.activeElement),
        )
      }
      assert.deepEqual(
        { navigation, inputRange, outputRange, inspected, focus },
        {
          navigation: { output: "1/8", input: "1" },
          inputRange: "1-2",
          outputRange: "1-2",
          inspected: { selection: "1,4", page: "2/4" },
          focus: [true, true],
        },
      )
    } finally {
      await browser.close()
    }
  }
})

test("List row actions preserve selection and move individual occurrences", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await tab(input, "List")
      await tab(output, "List")
      const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("")
      const add = input.getByRole("button", { name: "Add Input page 2 to Output", exact: true })
      const before = await add.boundingBox()
      await selection.fill("2, 4")
      assert.equal(await add.count(), 0)
      const tick = input.getByRole("button", { name: "Unselect Input page 2", exact: true })
      assert.deepEqual(await tick.boundingBox(), before, "The tick replaces Add without shifting the row")
      await tick.click()
      assert.equal(await selection.inputValue(), "4")
      await add.click()
      assert.equal(await selection.inputValue(), "4", "Adding one row retains the other selected pages")
      assert.equal(await output.locator(".page-list > .list-row").count(), 9)
      const outputSelection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await outputSelection.fill("")

      const rows = output.locator(".page-list > .list-row")
      assert.equal(
        await rows
          .first()
          .locator(".occurrence-actions:visible")
          .evaluate((element) => element.getBoundingClientRect().width),
        134,
      )
      const ids = await rows.evaluateAll((elements) => elements.map((element) => element.id))
      assert.equal(
        await output.getByRole("button", { name: "Move Output page 1 earlier", exact: true }).isDisabled(),
        true,
      )
      assert.equal(
        await output.getByRole("button", { name: "Move Output page 9 later", exact: true }).isDisabled(),
        true,
      )
      await output.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).click()
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), [
        ids[1],
        ids[0],
        ...ids.slice(2),
      ])
      assert.equal(
        await rows
          .first()
          .locator(".list-choice")
          .evaluate((element) => element === document.activeElement),
        true,
      )
      await output.getByRole("button", { name: "Move Output page 1 later", exact: true }).click()
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), ids)

      await outputSelection.fill("2, 4")
      assert.equal(await output.getByRole("button", { name: "Duplicate Output page 2", exact: true }).count(), 0)
      await output.getByRole("button", { name: "Unselect Output page 2", exact: true }).click()
      assert.equal(await outputSelection.inputValue(), "4")
      await output.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).click()
      assert.equal(await outputSelection.inputValue(), "4", "Moving an unselected row retains the selection")
      await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
      assert.equal(await outputSelection.inputValue(), "5")
      assert.equal(await output.getByRole("button", { name: "Unselect Output page 5", exact: true }).count(), 1)
      for (const pane of [input, output]) {
        await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
        const choice = pane.locator(".list-choice").first()
        await choice.hover()
        await page.mouse.down()
        assert.deepEqual(
          await choice.evaluate((element) => {
            const style = getComputedStyle(element)
            return { background: style.backgroundColor, filter: style.filter, transition: style.transitionDuration }
          }),
          { background: "rgba(0, 0, 0, 0)", filter: "none", transition: "0s" },
        )
        await page.mouse.up()
        assert.equal(await choice.getAttribute("aria-pressed"), "true")
        assert.equal(await choice.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)")
      }
      const touch = await browser.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await touch.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await touch.goto(`${server.resolvedUrls.local[0]}?demo`)
      await touch.locator(".composer[aria-busy=false]").waitFor()
      await touch
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .tap()
      const touchOutput = touch.locator(".composition-output")
      await tab(touchOutput, "List")
      assert.equal(
        await touchOutput.locator(".list-actions button:visible").evaluateAll((elements) =>
          elements.every((element) => {
            const box = element.getBoundingClientRect()
            return box.width >= 44 && box.height >= 44
          }),
        ),
        true,
      )
    } finally {
      await browser.close()
    }
  }
})

test("List details stay anchored and row highlights remain flat", { timeout: 90000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await launch(engine)
    let page
    try {
      page = await browser.newPage({ reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      for (const [width, text] of [
        [1440, "100%"],
        [768, "100%"],
        [390, "200%"],
        [320, "100%"],
      ]) {
        await page.setViewportSize({ width, height: 1100 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        for (const colorScheme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme })
          for (const name of ["Input", "Output"]) {
            const switcher = page
              .getByRole("navigation", { name: "Workspace view", exact: true })
              .getByRole("button", { name, exact: true })
            if (await switcher.isVisible()) await switcher.click()
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            await tab(pane, "List")
            await pane.locator("[data-returning]").waitFor({ state: "detached" })
            const choice = pane.locator(".list-choice").first()
            for (const selection of ["", "1, 3"]) {
              await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill(selection)
              await choice.hover()
              assert.equal(await choice.evaluate((element) => getComputedStyle(element).boxShadow), "none")
              assert.equal(
                await pane
                  .locator(".page-list > .list-row")
                  .first()
                  .evaluate((element) => getComputedStyle(element).boxShadow),
                "none",
              )
              if (selection) {
                const colors = await choice.evaluate((element) => {
                  const row = element.closest("li"),
                    probe = document.createElement("span")
                  probe.style.cssText = "background:var(--accent);color:var(--on-accent)"
                  row.append(probe)
                  const expected = getComputedStyle(probe),
                    background = expected.backgroundColor,
                    foreground = expected.color
                  const result = {
                    primary: getComputedStyle(row).backgroundColor === background,
                    contrast: [
                      element,
                      row.querySelector(".page-origin > button"),
                      row.querySelector('.list-actions [aria-pressed="true"]'),
                    ].every((control) => getComputedStyle(control).color === foreground),
                  }
                  probe.remove()
                  return result
                })
                assert.deepEqual(colors, { primary: true, contrast: true })
              }
            }
            const number = pane.getByRole("button", { name: `Details for ${name} page 1`, exact: true })
            await number.click()
            const details = pane.locator(".card-menu-options:popover-open")
            await details.waitFor()
            const panel = await details.boundingBox(),
              trigger = await number.boundingBox()
            assert.ok(panel.width < 400 && panel.x >= 0 && panel.x + panel.width <= width + 1)
            assert.equal(await details.locator(".detail-name").innerText(), "COVER")
            assert.ok(
              Math.min(Math.abs(panel.y - trigger.y - trigger.height), Math.abs(trigger.y - panel.y - panel.height)) <
                40,
            )
            assert.equal(await details.evaluate((element) => getComputedStyle(element).textAlign), "start")
            assert.match(
              await details.innerText(),
              name === "Input" ? /Output\s+1× → 1/ : /demo\.pdf\s+Original page\s+1/,
            )
            await page.keyboard.press("Escape")
            assert.equal(await details.count(), 0)
            assert.equal(await number.evaluate((element) => element === document.activeElement), true)
            await choice.focus()
            await page.keyboard.press("ArrowDown")
            assert.equal(
              await pane
                .locator('.list-choice[data-page="1"]')
                .evaluate(
                  (element) => element === document.activeElement && getComputedStyle(element).outlineStyle !== "none",
                ),
              true,
            )
            assert.equal(
              await pane.locator(".page-list").evaluate((element) => element.scrollWidth <= element.clientWidth),
              true,
            )
          }
        }
      }
    } catch (error) {
      if (page) await captureLayout(page, `list-details-${engine.name()}`, { error: error.message })
      throw error
    } finally {
      await browser.close()
    }
  }
})

test("Page metadata retains physical selection through Grid, List, and captions", { timeout: 90000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  let page
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    const metadata = [
      { name: "Practice", tags: ["guides"] },
      { name: "Details", tags: ["detail"] },
      { name: "Practice" },
      { name: "An extended page name with unbrokenwords".repeat(3) },
      {},
      {},
    ]
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 6, metadata }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    await input.locator('.page-image[data-page="4"]').waitFor()
    assert.deepEqual(
      await input.locator(".page-image").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.page))),
      [0, 1, 2, 3, 4, 5],
    )
    await selection.fill("")
    await input.locator('.page-image[data-page="0"]').click()
    await input.locator('.page-image[data-page="4"]').click({ modifiers: ["Shift"] })
    assert.equal(await selection.inputValue(), "1-5")
    await tab(input, "List")
    assert.deepEqual(
      await input.locator(".list-choice").evaluateAll((nodes) => nodes.map((node) => Number(node.dataset.page))),
      [0, 1, 2, 3, 4, 5],
    )
    await input.locator('.list-choice[data-page="1"]').focus()
    await page.keyboard.press("v")
    assert.equal(await input.locator(".inspection-heading .page-name").textContent(), "Details")
    await tab(input, "Grid")
    assert.equal(await input.locator(".page-image").count(), 6)
    assert.equal(await selection.inputValue(), "1-5")
    await tab(output, "List")
    assert.equal(await output.locator(".page-list > .list-row").count(), 6)
    await tab(input, "List")
    await input.locator('.list-choice[data-page="2"]').focus()
    await page.keyboard.press("ArrowDown")
    assert.equal(
      await input.locator('.list-choice[data-page="3"]').evaluate((element) => element === document.activeElement),
      true,
    )
    await tab(input, "Grid")
    await page.setViewportSize({ width: 390, height: 1100 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
    const overflow = await page.evaluate(() =>
      [...document.querySelectorAll(".selection-panel *, .composition-output *")]
        .filter(
          (element) =>
            element.getBoundingClientRect().right > innerWidth + 1 && element.getBoundingClientRect().width > 0,
        )
        .map((element) => [element.className, element.getBoundingClientRect().width])
        .slice(0, 15),
    )
    await captureLayout(page, "page-metadata", { overflow })
    assert.equal(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      true,
      JSON.stringify(overflow),
    )
  } finally {
    await browser.close()
  }
})

test("Metadata-only Inputs expose every page in Grid, List, and Page", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 1000 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/demo.pdf", (route) =>
      route.fulfill({
        contentType: "application/pdf",
        body: fixture({
          prepared: false,
          count: 2,
          metadata: [
            { name: "Detail", tags: ["detail"] },
            { name: "Reference", tags: ["reference"] },
          ],
        }),
      }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel")
    assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).count(), 0)
    await input.locator('.page-image[data-page="1"]').waitFor()
    assert.equal(await input.locator(".page-image").count(), 2)
    await tab(input, "List")
    assert.equal(await input.locator(".page-list > .list-row").count(), 2)
    await input.locator('.list-choice[data-page="1"]').focus()
    await page.keyboard.press("v")
    assert.equal(await input.locator(".inspection-heading .page-name").textContent(), "Reference")
    await tab(input, "Grid")
    await input.locator('.page-image[data-page="1"]').waitFor()
  } finally {
    await browser.close()
  }
})

test("Grid headers reveal page names without changing card geometry", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({
          contentType: "application/pdf",
          body: fixture({
            count: 4,
            metadata: [{ name: "Cover" }, { name: "ITAL-GUID-79A4-WXGX" }, { name: "ITAL-CROS-79A4-WXGF" }, {}],
          }),
        }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Input", "Output"]) {
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          for (const density of ["Normal", "Compact"]) {
            await gridDensity(pane, `${density} ${name} grid`)
            await page.mouse.move(1, 1)
            const card = pane.locator(".composition-card").nth(1),
              heading = card.locator(".page-label > .page-origin, .page-label > .page-number"),
              caption = heading.locator(".page-name")
            await measure(pane)
            const before = await card.boundingBox()
            const unnamed = await pane.locator(".composition-card").nth(3).boundingBox()
            assert.equal(before.height, unnamed.height, "Names keep the same card height")
            assert.equal(await caption.isVisible(), false)
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            await heading.hover()
            await caption.waitFor({ state: "visible" })
            assert.equal(await caption.innerText(), "ITAL-GUID-79A4-WXGX")
            assert.equal(await caption.isVisible(), true)
            const tooltip = await caption.boundingBox()
            assert.ok(tooltip.x >= 0 && tooltip.x + tooltip.width <= 1440 && tooltip.height < 44)
            assert.deepEqual(await card.boundingBox(), before)
            await page.mouse.move(1, 1)
            assert.equal(await caption.isVisible(), false)
          }
        }
      }
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await gridDensity(input, "Normal Input grid")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
      await input
        .locator(".input-footer")
        .nth(1)
        .getByRole("button", { name: "Add Input page 2 to Output", exact: true })
        .click()
      assert.match(await output.locator(".composition-totals").innerText(), /^5 pages/)
    } finally {
      await browser.close()
    }
  }
})

test("List bounds long sequences and restores the surviving Output row", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await tab(input, "List")
    assert.ok((await input.locator(".page-list > .list-row").count()) < 80)
    assert.equal(await input.locator(".list-row").first().getAttribute("aria-setsize"), "240")
    assert.equal(
      await input
        .locator(".page-list")
        .evaluate((element) => element.clientHeight < element.scrollHeight && element.clientHeight > 0),
      true,
    )
    await input.locator('.list-choice[data-page="0"]').focus()
    await page.keyboard.press("End")
    assert.equal(
      await input.locator('.list-choice[data-page="239"]').evaluate((element) => element === document.activeElement),
      true,
    )
    await tab(input, "Grid")
    await input.locator('.page-image[data-page="239"]').waitFor()
    await tab(output, "List")
    await output.getByRole("button", { name: "Remove Output page 1", exact: true }).press("Enter")
    await page.waitForFunction(() => document.activeElement?.matches('.composition-output .list-choice[data-page="0"]'))
    assert.ok((await output.locator(".page-list > .list-row").count()) < 80)
    assert.equal(await output.locator(".list-row").first().getAttribute("aria-setsize"), "239")
  } finally {
    await browser.close()
  }
})

test("List rows contain long names and actions with enlarged text", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  let page, label
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    const names = [
      "ITAL-ARCH-60A4-WXGF",
      "ITAL-ARCH-60A4-WXGF",
      "UNBROKEN".repeat(8),
      "MONO-SCUH-05A4-GXGC",
      "Details",
      "Reference",
    ]
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({
        contentType: "application/pdf",
        body: fixture({ count: names.length, metadata: names.map((name) => ({ name })) }),
      }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const [width, text] of [
      [1440, "100%"],
      [390, "200%"],
    ]) {
      await page.setViewportSize({ width, height: 1100 })
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Input", "Output"]) {
          const switcher = page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
          if (await switcher.isVisible()) await switcher.click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          for (const density of ["Normal", "Compact"]) {
            await tab(pane, "Grid")
            await gridDensity(pane, `${density} ${name} grid`)
            await tab(pane, "List")
            let widths
            for (const selected of [false, true]) {
              await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill(selected ? "1" : "")
              label = `${name}, ${width}px, ${text}, ${colorScheme}, ${density}, selected=${selected}`
              const rows = await pane.locator(".page-list > .list-row").evaluateAll((elements) =>
                elements.map((row) => {
                  const bounds = row.getBoundingClientRect(),
                    choice = row.querySelector(".list-choice")
                  const range = document.createRange()
                  range.selectNodeContents(choice)
                  const content = range.getBoundingClientRect()
                  const style = getComputedStyle(choice)
                  return {
                    name: choice.textContent.trim(),
                    title: choice.title,
                    accessible: choice.getAttribute("aria-label"),
                    width: choice.getBoundingClientRect().width,
                    ellipsis: style.whiteSpace === "nowrap" && style.textOverflow === "ellipsis",
                    lineHeight:
                      parseFloat(style.lineHeight) +
                      parseFloat(style.paddingBlockStart) +
                      parseFloat(style.paddingBlockEnd),
                    contained: [
                      ...(style.textOverflow === "ellipsis" ? [] : [content]),
                      choice.getBoundingClientRect(),
                      ...[...row.querySelectorAll("button, summary")]
                        .map((control) => control.getBoundingClientRect())
                        .filter((box) => box.width && box.height),
                    ].every(
                      (box) =>
                        box.left >= bounds.left - 1 &&
                        box.right <= bounds.right + 1 &&
                        box.top >= bounds.top - 1 &&
                        box.bottom <= bounds.bottom + 1,
                    ),
                    top: bounds.top,
                    bottom: bounds.bottom,
                  }
                }),
              )
              assert.equal(rows.length, names.length, label)
              for (const [index, row] of rows.entries()) {
                assert.equal(row.name, names[index], label)
                assert.equal(row.title, "Select or unselect this page. Shift-click selects a range.", label)
                assert.ok(row.accessible.includes(names[index]), label)
                assert.equal(row.ellipsis, width === 390, label)
                if (width === 390) assert.ok(row.bottom - row.top <= Math.max(44, row.lineHeight) + 1, label)
                if (selected)
                  assert.ok(Math.abs(row.width - widths[index]) < 1, `${label}: selection retains name width`)
                assert.ok(
                  row.contained && (!index || rows[index - 1].bottom <= row.top + 1),
                  `${label}: ${JSON.stringify(row)}`,
                )
              }
              widths = rows.map((row) => row.width)
              assert.equal(
                await pane.locator(".page-list").evaluate((element) => element.scrollWidth <= element.clientWidth),
                true,
                label,
              )
            }
          }
          await captureLayout(page, `page-list-${name.toLowerCase()}-${width}-${colorScheme}`, { label })
        }
      }
    }
  } catch (error) {
    if (page) await captureLayout(page, "page-list-names", { label, error: error.message })
    throw error
  } finally {
    await browser.close()
  }
})

test("Normal card targets stay separate through phone pane and text transitions", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser, page, label
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    for (const width of [320, 390, 412, 440]) {
      await page.setViewportSize({ width, height: width === 440 ? 956 : 924 })
      for (const text of ["100%", "200%"]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        for (const name of ["Input", "Output"]) {
          await page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
            .click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await gridDensity(pane, `Normal ${name} grid`)
          await measure(pane)
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          for (const selected of [false, true]) {
            await field.fill(selected ? "1" : "")
            label = `${width}px, ${text}, ${name}, selected=${selected}`
            const card = pane.locator(".composition-card").first()
            await card.scrollIntoViewIfNeeded()
            const targets = await card.evaluate((element) =>
              [
                ...element.querySelectorAll(
                  ":scope > .page-label summary, :scope > .page-label .page-grip, :scope > .occurrence-actions button",
                ),
              ]
                .filter((button) => button.getClientRects().length && getComputedStyle(button).visibility !== "hidden")
                .map((button) => {
                  const rect = button.getBoundingClientRect(),
                    after = getComputedStyle(button, "::after")
                  const left = rect.left + parseFloat(after.left),
                    right = rect.right - parseFloat(after.right)
                  const top = rect.top + parseFloat(after.top),
                    bottom = rect.bottom - parseFloat(after.bottom)
                  const points = [left + 1, (left + right) / 2, right - 1].flatMap((x) =>
                    [top + 1, (top + bottom) / 2, bottom - 1].map((y) => ({
                      x,
                      y,
                      hits: document.elementFromPoint(x, y)?.closest("button, summary") === button,
                    })),
                  )
                  return { label: button.getAttribute("aria-label"), left, right, top, bottom, points }
                }),
            )
            assert.ok(targets.length >= 2, label)
            for (const target of targets) {
              assert.ok(
                target.right - target.left >= 44 && target.bottom - target.top >= 44,
                `${label}: ${JSON.stringify(target)}`,
              )
              assert.ok(
                target.points.every(({ hits }) => hits),
                `${label}: ${JSON.stringify(target)}`,
              )
            }
            const number = targets[0]
            for (const point of number.points.filter((_, index) => index % 3 === 1)) {
              await page.touchscreen.tap(point.x, point.y)
              assert.equal(await card.locator(".page-origin[open]").count(), 1, label)
              assert.equal(await field.inputValue(), selected ? "1" : "", label)
              await page.touchscreen.tap(point.x, point.y)
            }
            const grip = targets[1]
            await page.touchscreen.tap((grip.left + grip.right) / 2, (grip.top + grip.bottom) / 2)
            assert.equal(await field.inputValue(), selected ? "" : "1", label)
          }
          await checkPagination(pane, label)
        }
      }
    }
  } catch (error) {
    if (page) await captureLayout(page, "normal-targets", { label, error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

const dimensions = (sample) =>
  ["input", "output"].flatMap((pane) =>
    ["normal", "compact"].map((density) => {
      const grid = sample.layout[pane][density]
      return [grid.capacity, grid.card.width, grid.card.height, grid.image.height, grid.gaps]
    }),
  )

test("Normal card targets route footer and grip taps across consecutive rows", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser, page, label, targets
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    for (const width of [440, 768, 772, 774, 778, 780]) {
      for (const text of ["100%", "200%"]) {
        await page.setViewportSize({ width, height: text === "100%" ? (width === 440 ? 956 : 1100) : 2200 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        await page.emulateMedia({ colorScheme: text === "100%" ? "light" : "dark" })
        for (const name of ["Input", "Output"]) {
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await gridDensity(pane, `Normal ${name} grid`)
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          await pane.getByRole("slider").press("Home")
          const grid = await measure(pane)
          assert.ok(grid.matrix[1] >= 2, `${width}px, ${text}, ${name}: two complete rows`)
          const lower = grid.matrix[0] + 1
          for (const selected of [false, true]) {
            const selection = selected ? `1,${lower}` : ""
            const actions = selected || name === "Input" ? [] : ["Remove", "Duplicate"]
            for (const action of [...actions, "Select or drag"]) {
              label = `${width}px, ${text}, ${name}, selected=${selected}, ${action}`
              await field.fill(selection)
              await measure(pane)
              await pane
                .locator(".composition-card")
                .nth(lower - 1)
                .scrollIntoViewIfNeeded()
              targets = await pane.evaluate((element, column) => {
                const cards = element.querySelectorAll(".composition-card")
                return [
                  ...cards[0].querySelectorAll(":scope > .occurrence-actions button"),
                  cards[column].querySelector(".page-grip"),
                ]
                  .filter(
                    (button) => button.getClientRects().length && getComputedStyle(button).visibility !== "hidden",
                  )
                  .map((button) => {
                    const rect = button.getBoundingClientRect(),
                      after = getComputedStyle(button, "::after")
                    const left = rect.left + parseFloat(after.left),
                      right = rect.right - parseFloat(after.right)
                    const top = rect.top + parseFloat(after.top),
                      bottom = rect.bottom - parseFloat(after.bottom)
                    const y = button.classList.contains("page-grip") ? top + 1 : bottom - 1
                    return {
                      label: button.getAttribute("aria-label"),
                      left,
                      right,
                      top,
                      bottom,
                      points: [left + 1, (left + right) / 2, right - 1].map((x) => ({
                        x,
                        y,
                        hits: document.elementFromPoint(x, y)?.closest("button, summary") === button,
                      })),
                    }
                  })
              }, grid.matrix[0])
              for (const target of targets) {
                assert.ok(target.right - target.left >= 44 && target.bottom - target.top >= 44, label)
                assert.ok(
                  target.points.every(({ hits }) => hits),
                  `${label}: ${JSON.stringify(target)}`,
                )
                if (target !== targets.at(-1)) assert.ok(target.bottom <= targets.at(-1).top, label)
              }
              const target =
                targets.find((entry) => entry.label.startsWith(action)) ??
                targets.find((entry) => entry.label.startsWith("Actions"))
              assert.ok(target, label)
              const before = parseInt(await page.locator(".composition-totals strong").textContent())
              await page.touchscreen.tap(target.points[1].x, target.points[1].y)
              if (action === "Select or drag") {
                assert.equal(await field.inputValue(), selected ? "1" : String(lower), label)
                assert.equal(parseInt(await page.locator(".composition-totals strong").textContent()), before, label)
              } else {
                if (target.label.startsWith("Actions")) {
                  const menu = pane.locator(".occurrence-menu:popover-open")
                  const button = menu.getByRole("button", { name: new RegExp(`^${action} Output page`) })
                  const box = await button.boundingBox()
                  assert.ok(box.width >= 44 && box.height >= 44, label)
                  await button.tap()
                }
                const expected = before + (action === "Remove" ? -1 : 1)
                await page.waitForFunction(
                  (count) => document.querySelector(".composition-totals strong")?.textContent === `${count} pages`,
                  expected,
                )
                if (name === "Input") assert.equal(await field.inputValue(), selection, label)
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (page) await captureLayout(page, "normal-row-targets", { label, targets, error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

const capture = (page) =>
  page.evaluate(async () => {
    const probe = await import("/src/geometry.ts")
    let result
    for (const compact of [false, true]) {
      for (const pane of ["Input", "Output"])
        document.querySelector(`button[aria-label="Switch to ${compact ? "Compact" : "Normal"} ${pane} grid"]`)?.click()
      const current = await probe.stable()
      result ??= { ...current, layout: { ...current.layout, input: {}, output: {} } }
      const density = compact ? "compact" : "normal"
      for (const pane of ["input", "output"]) result.layout[pane][density] = current.layout[pane][density]
    }
    return result
  })

const standard = process.env.MAINZ_TEST_MODE === "standard"

test("Workspace scrolling keeps Grid and Page controls clear of status", { timeout: 120000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 62 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "62 pages")
    for (const [width, height, scale, bottom] of [
      [390, 699, 100, 0],
      [375, 667, 100, 0],
      [390, 797, 100, 34],
      [320, 568, 200, 0],
      [844, 390, 100, 0],
      [1080, 724, 200, 0],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(
        (appearance) => {
          document.documentElement.style.fontSize = `${appearance.scale}%`
          document.querySelector(".footnote").style.paddingBlockEnd = `calc(var(--gap) + ${appearance.bottom}px)`
        },
        { scale, bottom },
      )
      const colorScheme = "light"
      await t.test(`${width}×${height}, ${scale}%, ${colorScheme}`, async () => {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Input", "Output"]) {
          const views = page.locator(".mobile-workspace-tabs")
          if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, "Grid")
          await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill("56-62")
          for (const density of ["Normal", "Compact"]) {
            await gridDensity(pane, `${density} ${name} grid`)
            const grid = await measure(pane)
            assert.ok(grid.caption.bottom <= grid.status + 1, `${name} ${density}: status clears pagination`)
            await checkStatus(page)
            const slider = pane.getByRole("slider")
            await slider.focus()
            await slider.press("End")
            assert.equal(await slider.inputValue(), await slider.getAttribute("max"))
          }
          await tab(pane, "Page")
          await pane.locator(".page-scroll canvas").waitFor()
          await checkStatus(page)
          const navigation = await pane.locator(".page-navigation").boundingBox()
          const status = await page.locator(".footnote").boundingBox()
          assert.ok(navigation.y + navigation.height <= status.y + 1, `${name}: status clears Page controls`)
        }
      })
    }
  } finally {
    await browser?.close()
  }
})

test("Grid keeps feasible matrices across nearby desktop calibration boundaries", { timeout: 420000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "80 pages")
    let initial
    for (const [width, height, minimumNormal, minimumCompact] of [
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2560 + delta, 1440, 16, 64]),
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2560, 1420 + delta, delta < 0 ? 12 : 16, 56]),
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2200 + delta, 1298, 9, 36]),
    ]) {
      await page.setViewportSize({ width, height })
      const colorScheme = "light"

      await page.emulateMedia({ colorScheme })
      const label = `${width}×${height}, ${colorScheme}`
      await t.test(label, async () => {
        const sample = await capture(page)
        initial ??= dimensions(sample)
        assert.deepEqual(quality(sample), [], label)
        for (const pane of ["input", "output"]) {
          assert.ok(
            sample.layout[pane].normal.capacity[2] >= minimumNormal,
            `${pane}, ${label}: Normal retains its feasible matrix (${sample.layout[pane].normal.capacity})`,
          )
          assert.ok(
            sample.layout[pane].compact.capacity[2] >= minimumCompact,
            `${pane}, ${label}: Compact retains its feasible matrix (${sample.layout[pane].compact.capacity})`,
          )
        }
      })
    }
    await page.setViewportSize({ width: 2557, height: 1440 })
    await page.emulateMedia({ colorScheme: "light" })
    assert.deepEqual(
      dimensions(await capture(page)),
      initial,
      "Equal geometry does not depend on resize or density history",
    )
  } finally {
    await browser?.close()
  }
})

test("Grid retains feasible matrices across fractional desktop pane widths", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "80 pages")
    for (const width of [1461.75, 1462, 1462.25]) {
      await page.locator("main").evaluate((element, size) => (element.style.inlineSize = `${size}px`), width)
      const colorScheme = "light"

      await page.emulateMedia({ colorScheme })
      const sample = await capture(page)
      assert.deepEqual(quality(sample), [], `${width}px, ${colorScheme}`)
      for (const pane of ["input", "output"]) {
        assert.deepEqual(sample.layout[pane].normal.capacity, [4, 4, 16])
        assert.deepEqual(sample.layout[pane].compact.capacity, [8, 8, 64])
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Touch portrait Normal Grid fits readable cards across nearby phone dimensions", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 440, height: 956 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
      const output = page.locator(".composition-output")
      await output.getByLabel("Page selection", { exact: true }).fill("19-32")
      for (const [width, height] of [
        [412, 924],
        [411, 924],
        [413, 924],
        [427, 952],
        [426, 952],
        [428, 952],
        [440, 956],
        [439, 956],
        [441, 956],
        [440, 955],
        [440, 957],
      ]) {
        await page.setViewportSize({ width, height })
        for (const colorScheme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme })
          await gridDensity(output, "Normal Output grid")
          const normal = await checkGrid(output, `${width}×${height}, ${colorScheme}, Normal`)
          const rows = width >= 426 ? 2 : 1
          assert.deepEqual(normal.matrix, [2, rows, 2 * rows], `${engine.name()}, ${width}×${height}, ${colorScheme}`)
          await gridDensity(output, "Compact Output grid")
          const compact = await checkGrid(output, `${width}×${height}, ${colorScheme}, Compact`)
          assert.ok(Math.abs(compact.gaps[1] - 0.8 * compact.gaps[0]) < 1)
          checkDensityRatio(normal.image.height, compact.image.height, `${width}×${height}`)
          assert.ok(Math.abs(normal.frame.height - compact.frame.height) < 1)
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test("Phone Compact gaps keep the narrow-screen allowance below tablet widths", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 440, height: 956 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    for (const width of [440, 599, 600, 601, 744]) {
      await page.setViewportSize({ width, height: 1133 })
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      assert.deepEqual(quality(sample), [], `${width}px`)
      for (const pane of ["input", "output"]) {
        const compact = sample.layout[pane].compact
        assert.equal(compact.authored.rowFactor, width < 600 ? 0.8 : 0.9)
        if (width === 440) {
          assert.ok(compact.gaps[1] < 0.85 * compact.gaps[0])
          compact.gaps[1] = 0.75 * compact.gaps[0]
        }
      }
      if (width === 440) assert.ok(quality(sample).some((failure) => failure.rule === "balanced row and column gaps"))
    }
  } finally {
    await browser?.close()
  }
})

test("Measured touch frames retain complete readable matrices", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 360, height: 672 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    for (const [width, height, bottom, normal, compact] of [
      [360, 672, 24, [2, 1, 2], [3, 1, 3]],
      [392, 764, 24, [2, 1, 2], [4, 2, 8]],
      [750, 1080, 32, [4, 2, 8], [8, 4, 32]],
      [750, 1144, 0, [4, 2, 8], [8, 5, 40]],
      [1006, 481, 33, [3, 1, 3], [5, 1, 5]],
      [800, 1160, 32, [5, 2, 10], [9, 5, 45]],
      [876, 1280, 32, [5, 3, 15], [10, 6, 60]],
      [1400, 756, 32, [3, 1, 3], [6, 2, 12]],
    ]) {
      await page.setViewportSize({ width, height })
      // Replay Android's measured bottom budget without claiming native acquisition.
      await page
        .locator(".footnote")
        .evaluate((element, inset) => (element.style.paddingBlockEnd = `calc(var(--gap) + ${inset}px)`), bottom)
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      assert.deepEqual(quality(sample), [], `${width}×${height}`)
      for (const pane of ["input", "output"]) {
        assert.deepEqual(sample.layout[pane].normal.matrix, normal, `${pane} Normal, ${width}×${height}`)
        assert.deepEqual(sample.layout[pane].compact.matrix, compact, `${pane} Compact, ${width}×${height}`)
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Measured touch calibrations isolate viewport bounds and primary input", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser
  const bands = [
    { width: [1000, 1080], height: [450, 650], normal: [136, 232, 10] },
    { width: [860, 900], height: [1280, 1320], normal: [136, 219.109375, 10.5] },
    { width: [1380, 1450], height: [740, 800], compact: [74, 110, 6] },
  ]
  try {
    for (const mode of ["touch", "mouse", "hybrid"]) {
      browser = await launch(chromium, {
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        args:
          mode === "hybrid"
            ? ["--blink-settings=primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=2"]
            : [],
      })
      const page = await browser.newPage({
        hasTouch: mode === "touch",
        isMobile: mode === "touch",
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "60 pages")
      for (const band of bands) {
        const [left, right] = band.width,
          [bottom, top] = band.height
        const middleWidth = Math.floor((left + right) / 2),
          middleHeight = Math.floor((bottom + top) / 2)
        const points =
          mode === "touch"
            ? [
                [left, middleHeight, true],
                [right - 1, middleHeight, true],
                [left - 1, middleHeight, false],
                [right, middleHeight, false],
                [middleWidth, bottom, true],
                [middleWidth, top - 1, true],
                [middleWidth, bottom - 1, false],
                [middleWidth, top, false],
              ]
            : [[middleWidth, middleHeight, false]]
        for (const [width, height, active] of points) {
          await page.setViewportSize({ width, height })
          const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
          assert.equal(sample.environment.pointer, mode === "touch" ? "coarse" : "fine")
          if (mode === "hybrid") assert.equal(sample.environment.media["(any-pointer: coarse)"], true)
          for (const density of ["normal", "compact"]) {
            if (!band[density]) continue
            const [cardWidth, cardHeight, padding] = active
              ? band[density]
              : density === "normal"
                ? mode === "touch" && height > width
                  ? [136, 228.25, 8]
                  : [148, 240, 14]
                : mode !== "touch" && left === 1380
                  ? [null, 121, 6.4]
                  : [null, 125, 7.5]
            for (const pane of ["input", "output"]) {
              const grid = sample.layout[pane][density],
                label = `${mode}, ${width}×${height}, ${pane} ${density}`
              // Desktop fitting changes rendered cards; input isolation concerns the preferred calibration.
              const actual =
                mode === "touch"
                  ? [grid.card.width, grid.card.height, grid.margins[0]]
                  : ["--grid-width", "--grid-height", "--thumbnail-padding"].map((name) => {
                      const value = grid.variables[name]
                      return parseFloat(value) * (value.endsWith("rem") ? 16 : 1)
                    })
              if (cardWidth !== null) assert.ok(Math.abs(actual[0] - cardWidth) < 1, `${label}: card width`)
              assert.ok(Math.abs(actual[1] - cardHeight) < 1, `${label}: card height`)
              assert.ok(Math.abs(actual[2] - padding) < 1, `${label}: image padding`)
            }
          }
        }
      }
      await browser.close()
      browser = undefined
    }
  } finally {
    await browser?.close()
  }
})

test("Touch portrait pagination uses available height above the safe area", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    // Match a standalone tablet's bottom inset without treating its screen as the usable viewport.
    await page.locator(".footnote").evaluate((element) => (element.style.paddingBlockEnd = "calc(var(--gap) + 20px)"))
    for (const [width, height] of [
      [810, 1048],
      [820, 1094],
      [834, 1080],
    ]) {
      await page.setViewportSize({ width, height })
      for (const name of ["Input", "Output"]) {
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        for (const density of ["Normal", "Compact"]) {
          await gridDensity(pane, `${density} ${name} grid`)
          const geometry = await measure(pane)
          assert.deepEqual(geometry.capacity.slice(0, 2), density === "Compact" ? [9, 4] : [5, 2])
          assert.ok(Math.abs(geometry.image.height - (density === "Compact" ? 69.5 : 144)) < 1)
          assert.ok(geometry.clearance >= 8 && geometry.scroll <= 1)
          const gap = geometry.status - geometry.caption.bottom
          assert.ok(gap >= 8 && gap <= 32, `${name}, ${width}, ${density}: caption clearance ${gap}`)
        }
      }
    }
  } finally {
    await browser?.close()
  }
})

function checkDensityRatio(normal, compact, label) {
  const ratio = normal / compact
  assert.ok(
    Math.min(ratio, 2) / Math.max(ratio, 2) >= 0.85,
    `${label}: Normal to Compact image scale stays near 2 (${ratio.toFixed(2)})`,
  )
}

async function checkGrid(pane, label) {
  await pane
    .page()
    .evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
  await pane.page().evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  const geometry = await measure(pane)
  const gapRatio = await pane.evaluate((element) =>
    element.dataset.density === "compact" &&
    matchMedia("(hover: none) and (pointer: coarse) and (orientation: portrait) and (width < 600px)").matches
      ? 0.8
      : 0.85,
  )
  assert.deepEqual(gridBounds(geometry, await pane.getAttribute("data-density"), gapRatio), [], label)
  return geometry
}

test("Touch Grid uses complete rows within the available viewport", { timeout: 150000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    const colorScheme = "light"
    await page.emulateMedia({ colorScheme })
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    for (const {
      viewport: [width, height],
      matrices: { normal, compact },
    } of inventory.cases.filter((item) => item.pointer === "coarse")) {
      await page.setViewportSize({ width, height })
      for (const name of ["Input", "Output"]) {
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        let normalFrame, normalImage
        for (const [density, reference] of [
          ["Normal", normal],
          ["Compact", compact],
        ]) {
          await gridDensity(pane, `${density} ${name} grid`)
          const label = `${name} ${density}, ${width}×${height}, ${colorScheme}`
          const geometry = await checkGrid(pane, label)
          if (density === "Normal") normalImage = geometry.image.height
          else checkDensityRatio(normalImage, geometry.image.height, label)
          assert.deepEqual(geometry.matrix, reference, `${label}: Complete rows match the viewport reference`)
          if (geometry.scroll > 1)
            assert.equal(geometry.matrix[1], 1, `${label}: Short viewports scroll only for the minimum complete row`)
          if (width === 810 && height === 1080) {
            assert.ok(geometry.scroll <= 1, `${label}: iPad portrait pagination needs no scrolling`)
            if (density === "Normal") normalFrame = geometry.frame
            else
              assert.ok(Math.abs(normalFrame.height - geometry.frame.height) < 1, `${label}: Densities share one frame`)
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
  }
})

test("Desktop Grid retains measured capacity within readable bounds", { timeout: 600000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    const colorScheme = "light"
    await page.emulateMedia({ colorScheme })
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    for (const {
      viewport: [width, height],
      matrices: { normal, compact },
    } of inventory.cases.filter((item) => item.pointer === "fine" && item.matrices)) {
      await page.setViewportSize({ width, height })
      const sample = await capture(page)
      const label = `${width}×${height}, ${colorScheme}`
      assert.deepEqual(quality(sample), [], label)
      for (const name of ["input", "output"])
        for (const [density, reference] of [
          ["normal", normal],
          ["compact", compact],
        ]) {
          const grid = sample.layout[name][density]
          assert.ok(
            grid.matrix.slice(0, 2).every((count, axis) => count >= reference[axis]),
            `${name} ${density}, ${label}: retains at least ${reference[0]}×${reference[1]} complete cards; actual ${grid.matrix}`,
          )
          if (width === 1920 && height === 961)
            assert.ok(
              Math.abs(grid.margins[0] - (density === "normal" ? 14 : 6.4)) < 0.1,
              `${name} ${density}, ${label}: scaling preserves image padding`,
            )
        }
    }
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "desktop").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
  }
})

test("Grid fitting respects viewport bounds and input capabilities", { timeout: 900000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    for (const mode of ["mouse", "hybrid", "touch"]) {
      browser = await launch(chromium, {
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        args:
          mode === "hybrid"
            ? ["--blink-settings=primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=2"]
            : [],
      })
      const page = await browser.newPage({
        hasTouch: mode === "touch",
        isMobile: mode === "touch",
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      // Complete columns and repeated gaps suffice here; the reference test checks full viewport capacity.
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "60 pages")
      const cases =
        mode === "mouse"
          ? [
              [1280, 699],
              [1280, 700],
              [1800, 949],
              [1800, 950],
              [1920, 961],
              [1999, 999],
              [1799, 961],
              [2000, 961],
              [1920, 1000],
              [1920, 1199],
              [1920, 1200],
              [1279, 982],
              [2140, 982],
              [2200, 1099],
              [2200, 1100],
              [2240, 1260],
              [2399, 1349],
              [2199, 1260],
              [2400, 1260],
              [2240, 1350],
              [2559, 1419],
              [2240, 1420],
              [2960, 1499],
              [2960, 1500],
              [3008, 1692],
              [3199, 1749],
              [2959, 1692],
              [3200, 1692],
              [3008, 1750],
              [3840, 1899],
              [3840, 1900],
              [3840, 1922],
              [3840, 2049],
              [3840, 2050],
              [3840, 2160],
              [4159, 2249],
              [3840, 2250],
              [3839, 1922],
              [4160, 1922],
              [2560, 1279],
              [2560, 1280],
              [2560, 1314],
              [2560, 1315],
              [2560, 1318],
              [2560, 1323],
              [2879, 1349],
              [2560, 1350],
              [2560, 1419],
              [2879, 1419],
              [2560, 1420],
              [2560, 1440],
              [2879, 1420],
              [2560, 1799],
              [2560, 1800],
              [2559, 1310],
              [2880, 1310],
              [1080, 810],
              [810, 1080],
              [1024, 1334],
              [1366, 1024],
              [1365, 865],
              [1537, 1001],
            ]
          : mode === "hybrid"
            ? [
                [1920, 961],
                [3840, 1922],
                [2560, 1310],
                [2560, 1318],
                [1080, 810],
                [810, 1080],
                [1024, 1334],
                [1366, 1024],
                [2222, 1111],
              ]
            : [
                [1920, 961, "default"],
                [3840, 1922, "default"],
                [2560, 1310, "default"],
                [666, 375, "default"],
                [667, 250, "phone"],
                [812, 311, "phone"],
                [896, 414, "phone"],
                [900, 499, "phone"],
                [999, 499, "default"],
                [1000, 414, "default"],
                [812, 249, "default"],
                [812, 500, "default"],
                [1080, 810, "landscape"],
                [1079, 810, "default"],
                [1080, 700, "landscape"],
                [1080, 724, "landscape"],
                [1080, 699, "default"],
                [1133, 810, "default"],
                [1080, 900, "default"],
                [1180, 730, "wide"],
                [1194, 802, "wide"],
                [1219, 899, "wide"],
                [1179, 730, "default"],
                [1220, 730, "default"],
                [1180, 729, "default"],
                [1180, 900, "default"],
                [1000, 1200, "large"],
                [1024, 1280, "large"],
                [1000, 1300, "large"],
                [1023, 1334, "large"],
                [1024, 1299, "large"],
                [1024, 1300, "large-tall"],
                [1049, 1399, "large-tall"],
                [999, 1200, "default"],
                [1050, 1200, "default"],
                [1050, 1334, "default"],
                [1024, 1199, "default"],
                [1024, 1400, "default"],
                [1360, 980, "large-landscape"],
                [1366, 1024, "large-landscape"],
                [1379, 1059, "large-landscape"],
                [1359, 1024, "default"],
                [1380, 1024, "default"],
                [1366, 979, "default"],
                [1366, 1060, "default"],
                [810, 1080, "portrait"],
                [805, 980, "portrait"],
                [804, 980, "default"],
                [805, 979, "default"],
                [834, 1219, "portrait"],
                [835, 1080, "default"],
                [810, 1220, "default"],
                [820, 1080, "portrait"],
                [829, 1119, "portrait"],
                [805, 1048, "portrait"],
                [834, 1119, "portrait"],
                [819, 1094, "portrait"],
                [830, 1094, "portrait"],
                [820, 1079, "portrait"],
                [820, 1047, "portrait"],
                [820, 1120, "portrait"],
                [740, 1047, "small"],
                [744, 1047, "small"],
                [749, 1089, "small"],
                [739, 1047, "default"],
                [750, 1047, "default"],
                [744, 1046, "default"],
                [744, 1090, "default"],
                [740, 1100, "tall"],
                [744, 1133, "tall"],
                [749, 1159, "tall"],
                [739, 1100, "default"],
                [750, 1100, "default"],
                [744, 1099, "default"],
                [744, 1160, "default"],
                [527, 917, "default"],
                [917, 527, "default"],
              ]
      // The desktop reference sweep already checks both panes at these exact mouse viewports.
      for (const [width, height, calibration] of cases.filter(
        ([w, h]) =>
          mode !== "mouse" ||
          !inventory.cases.some((item) => item.pointer === "fine" && item.viewport[0] === w && item.viewport[1] === h),
      )) {
        await t.test(`${mode}, ${width}×${height}`, async () => {
          await page.setViewportSize({ width, height })
          if (mode === "hybrid")
            assert.deepEqual(
              await page.evaluate(() => [
                matchMedia("(pointer: fine)").matches,
                matchMedia("(any-pointer: coarse)").matches,
                matchMedia("(hover: hover)").matches,
              ]),
              [true, true, true],
            )
          const pane = page.locator(".selection-panel")
          const touchPortrait = mode === "touch" && height > width
          let normalFrame, normalImage
          for (const density of ["Normal", "Compact"]) {
            await gridDensity(pane, `${density} Input grid`)
            const label = `${mode}, ${width}×${height}, ${density}`
            const geometry = await checkGrid(pane, label)
            if (density === "Normal") {
              normalImage = geometry.image.height
              normalFrame = geometry.scroll <= 1 ? geometry.frame : undefined
            } else {
              checkDensityRatio(normalImage, geometry.image.height, label)
              if (normalFrame)
                assert.ok(
                  Math.abs(normalFrame.height - geometry.frame.height) < 1,
                  `${label}: Density does not change the available height`,
                )
            }
            if (mode === "touch") {
              const normal =
                {
                  phone: [136, 142, 232, 10],
                  portrait: [142, 142, 231, 9.5],
                  large: [142, 142, 231, 9.5],
                  "large-tall": [142, 142, 231, 9.5],
                  small: [137, 137, 226, 9],
                  landscape: [136, 136, 234, 11],
                  "large-landscape": [152, 152, 236, 12],
                }[calibration] ?? (touchPortrait ? [136, 136, 228.25, 8] : [148, 148, 240, 14])
              const compact = {
                landscape: [74.57, 116.5, 116.5],
                wide: [79, 119, 119],
                "large-tall": [81, 114, 115],
                "large-landscape": [83, 120.625, 120.625],
                tall: [77.7, 109.5, 111],
              }[calibration] ?? [74, ...(touchPortrait ? [109.5, 111] : [125, 125])]
              if (density === "Normal") {
                assert.ok(geometry.card.width >= normal[0] - 0.02 && geometry.card.width <= normal[1] + 0.02, label)
                assert.ok(Math.abs(geometry.card.height - normal[2]) < 0.02, `${label}: Touch height stays scoped`)
                assert.ok(Math.abs(geometry.margins[0] - normal[3]) < 1, `${label}: Touch padding stays scoped`)
              } else {
                assert.ok(Math.abs(geometry.card.width - compact[0]) < 0.02, `${label}: Touch width stays scoped`)
                assert.ok(
                  geometry.card.height >= compact[1] && geometry.card.height <= compact[2],
                  `${label}: Touch height stays scoped`,
                )
              }
            }
            if (geometry.scroll > 1)
              assert.equal(geometry.matrix[1], 1, `${label}: Only a minimum row requires document scrolling`)
            if (width === 2560 && height === 1310)
              assert.deepEqual(
                geometry.matrix,
                density === "Normal" ? [4, 3, 12] : [8, 6, 48],
                `${label}: Shared rules approach the calibrated matrix`,
              )
          }
        })
      }
      if (mode === "mouse") {
        await page.setViewportSize({ width: 2560, height: 1310 })
        await page.locator("main").evaluate((element) => (element.style.inlineSize = "1462px"))
        const pane = page.locator(".selection-panel")
        for (const density of ["Normal", "Compact"]) {
          await gridDensity(pane, `${density} Input grid`)
          const geometry = await checkGrid(pane, `QHD narrow pane, ${density}`)
          assert.deepEqual(geometry.matrix, density === "Normal" ? [4, 3, 12] : [8, 6, 48])
        }
      }
      await browser.close()
      browser = undefined
    }
  } finally {
    await browser?.close()
  }
})

test("Partial Grid batches retain full-matrix card positions and dimensions", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, hasTouch] of [
      [1537, 1001, false],
      [3840, 1922, false],
      [360, 672, true],
      [392, 764, true],
      [750, 1144, true],
      [1006, 481, true],
      [876, 1280, true],
      [1400, 756, true],
    ].filter(([viewportWidth]) => !standard || [1537, 392].includes(viewportWidth))) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 239 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "239 pages",
      )
      for (const name of ["Input", "Output"]) {
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const slots = () =>
          pane.locator(".composition-card:not([inert])").evaluateAll((cards) =>
            cards.map((card) => {
              const bounds = card.getBoundingClientRect()
              return [bounds.x, bounds.y, bounds.width, bounds.height]
            }),
          )
        for (const density of ["Normal", "Compact"]) {
          const label = `${name} ${density}, ${width}×${height}`
          await gridDensity(pane, `${density} ${name} grid`)
          const range = pane.getByRole("slider", { name: `${name} thumbnail range`, exact: true })
          await range.press("Home")
          await pane.getByRole("button", { name: `Select ${name} page 1`, exact: true }).waitFor()
          const reference = await checkGrid(pane, label)
          const full = await slots()
          await range.press("End")
          await pane.getByRole("button", { name: `Select ${name} page 239`, exact: true }).waitFor()
          await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
          const partial = await slots()
          assert.equal(partial.length, 239 % reference.matrix[2], `${label}: The final batch is partial`)
          for (const [index, bounds] of partial.entries())
            assert.ok(
              bounds.every((value, axis) => Math.abs(value - full[index][axis]) < 1),
              `${label}: Sparse cards keep their full-matrix slot ${index}`,
            )
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Grid density switches paint complete batches without intermediate overflow", { timeout: 90000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  let page, label
  try {
    for (const touch of [false, true]) {
      page = await browser.newPage({ hasTouch: touch, isMobile: touch })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 128 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      for (const viewportWidth of touch ? [320, 390, 768] : [1440, 1920]) {
        await page.setViewportSize({ width: viewportWidth, height: 1080 })
        for (const enlarged of [false, true]) {
          await page.emulateMedia({
            colorScheme: enlarged ? "dark" : "light",
            reducedMotion: enlarged ? "reduce" : "no-preference",
          })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), enlarged ? "200%" : "100%")
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            await gridDensity(pane, `Normal ${name} grid`)
            await measure(pane)
            await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill(enlarged ? "1" : "")
            for (const [turn, density] of ["Compact", "Normal", "Compact", "Normal"].entries()) {
              label = `${viewportWidth}px, ${enlarged ? "200%, dark, reduced motion" : "100%, light"}, ${name}, ${density}`
              const control = pane.locator(".grid-density")
              assert.equal(await control.count(), 1)
              assert.equal(await control.getAttribute("aria-label"), `Switch to ${density} ${name} grid`)
              assert.equal(await control.getAttribute("aria-pressed"), null)
              const bounds = await control.boundingBox()
              assert.equal(bounds.width, 46, `${label}: one square target`)
              assert.equal(bounds.height, 46, `${label}: one square target`)
              await control.focus()
              const painted = await control.evaluate(async (button) => {
                const element = button.closest(".selection-panel, .composition-output")
                button.click()
                const frames = []
                let spinners = 0
                for (let frame = 0; frame < 6; frame++) {
                  await new Promise(requestAnimationFrame)
                  spinners = Math.max(spinners, element.querySelectorAll(".render-status").length)
                  const grid = element.querySelector(".composition-grid").getBoundingClientRect()
                  const cards = [...element.querySelectorAll(".composition-card")].map((card) => {
                    const { x, y, width, height, bottom } = card.getBoundingClientRect()
                    return { x, y, width, height, bottom }
                  })
                  frames.push({
                    cards,
                    bottom: grid.bottom,
                    pageHeight: document.documentElement.scrollHeight,
                    scroll: scrollY,
                    focused: document.activeElement === button,
                  })
                }
                return { frames, spinners }
              })
              assert.equal(await pane.getAttribute("data-density"), density.toLowerCase())
              for (const frame of painted.frames) {
                assert.ok(
                  frame.cards.every((card) => card.bottom <= frame.bottom + 1),
                  `${label}: complete rows`,
                )
                assert.deepEqual(frame, painted.frames.at(-1), `${label}: final geometry from the first frame`)
                assert.ok(frame.focused, `${label}: density control retains focus`)
              }
              if (turn >= 2) assert.equal(painted.spinners, 0, `${label}: cached pages never show loading placeholders`)
              await page.waitForFunction(() => !document.querySelector('.thumbnail[aria-busy="true"]'))
            }
          }
        }
      }
      await page.close()
    }
  } catch (error) {
    if (page && !page.isClosed()) await captureLayout(page, "density", { label, error: error.message })
    throw error
  } finally {
    await browser.close()
  }
})

test("Grid initializes density from the completed preparation", { timeout: 30000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await launch(engine)
    try {
      for (const [count, density] of [
        [4, "normal"],
        [8, "normal"],
        [9, "compact"],
      ]) {
        const page = await browser.newPage({
          viewport: { width: 440, height: 956 },
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 3,
          reducedMotion: "reduce",
        })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.route("**/demo.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture({ count }) }),
        )
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.waitForFunction(
          (expected) =>
            document.querySelector('.selection-panel input[aria-label="Page selection"]')?.value === `1-${expected}`,
          count,
        )
        const input = page.locator(".selection-panel")
        await measure(input)
        assert.equal(await input.getAttribute("data-density"), density, `${engine.name()}, ${count} pages`)
        if (density === "normal") assert.equal((await measure(input)).capacity[2], 4)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Grid density retains inspection and compact page commands", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await gridDensity(input, "Compact Input grid")
    await gridDensity(output, "Compact Output grid")
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).click()
    await gridDensity(input, "Normal Input grid")
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).waitFor()
    assert.equal(await output.locator(".composition-card").count(), 24, "Each pane retains its own density")
    await page.setViewportSize({ width: 2560, height: 1440 })
    await measure(input)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await measure(input)
    assert.equal(await input.getByRole("button", { name: "Select Input page 12", exact: true }).isVisible(), true)
    const slider = input.getByRole("slider")
    await slider.press("Home")
    for (let step = 0; step < 3; step++) await slider.press("ArrowRight")
    assert.equal((await input.locator(".batch-caption").innerText()).replace(/\s+/g, ""), "4/40·19–24/240")
    await tab(input, "Page")
    assert.equal(await input.locator(".grid-density").isVisible(), false)
    await tab(input, "Grid")
    await gridDensity(input, "Compact Input grid")

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      await gridDensity(output, "Normal Output grid")
      const normalNumber = output.locator(".composition-card .page-origin > summary").first()
      await normalNumber.hover()
      const hoverColor = await normalNumber.evaluate((element) => getComputedStyle(element).color)
      await gridDensity(output, "Compact Output grid")
      const number = output.locator(".composition-card .card-number").first()
      await number.hover()
      assert.deepEqual(
        await number.evaluate((element) => {
          const style = getComputedStyle(element)
          return [style.color, style.backgroundColor, style.boxShadow]
        }),
        [hoverColor, "rgba(0, 0, 0, 0)", "none"],
      )
      for (const pane of [input, output]) {
        const first = pane.locator(".composition-card").first()
        await first.locator(".page-image").click()
        assert.equal(
          await first.evaluate((element) => {
            const card = element.getBoundingClientRect()
            const label = element.querySelector(".page-label")
            const heading = label.getBoundingClientRect()
            const divider = getComputedStyle(label, "::after")
            const stroke = parseFloat(getComputedStyle(element).borderInlineStartWidth)
            return (
              heading.left + parseFloat(divider.insetInlineStart) >= card.left + stroke &&
              heading.right - parseFloat(divider.insetInlineEnd) <= card.right - stroke
            )
          }),
          true,
          "The heading separator stays inside the selected card's border",
        )
        await first.locator(".page-image").click()
      }
      const opener = output.getByRole("button", { name: "Details for Output page 1", exact: true })
      await opener.focus()
      await opener.press("Enter")
      const menu = page.locator(".card-menu-options:popover-open")
      await menu.waitFor()
      await page.keyboard.press("Escape")
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true)
      await opener.click()
      await menu.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "241 pages",
      )
      assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "")
      await opener.click()
      await menu.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 pages",
      )
    }
  } finally {
    await browser.close()
  }
})

test("Grid pagination bounds its marks and retains exact page navigation", { timeout: 60000 }, async () => {
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
      .setInputFiles({
        name: "A long input filename for pagination.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false }),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const [repeated, copies, total] of [
      [1, 1, 1],
      [1, 63, 64],
      [1, 936, 1000],
      [9, 1000, 10000],
    ]) {
      await input.getByLabel("Page selection", { exact: true }).fill(Array(repeated).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill(String(copies))
      await page.keyboard.press("Escape")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      for (const density of ["Normal", "Compact"]) {
        await gridDensity(output, `${density} Output grid`)
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const batch = Number(await output.locator(".grid-view").getAttribute("data-batch"))
        const batches = Math.ceil(total / batch)
        const slider = output.getByRole("slider", { name: "Output thumbnail range", exact: true })
        if (total === 1 && density === "Normal") continue
        assert.equal(await output.locator(".batch-marks > span").count(), Math.min(batches, 64))
        assert.equal(await slider.getAttribute("max"), String(batches - 1))
        if (batches > 1) {
          await slider.press("End")
          assert.equal(await slider.inputValue(), String(batches - 1))
          assert.equal(
            await slider.getAttribute("aria-valuetext"),
            `Grid page ${batches} of ${batches}, pages ${(batches - 1) * batch + 1}–${total} of ${total}`,
          )
          await output.getByRole("button", { name: `Select Output page ${total}`, exact: true }).waitFor()
          await slider.press("Home")
          assert.equal(await slider.inputValue(), "0")
        } else assert.equal(await slider.isDisabled(), true)
      }
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 1100 })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const density of ["Normal", "Compact"]) {
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = name === "Input" ? input : output
            await gridDensity(pane, `${density} ${name} grid`)
            assert.ok((await pane.locator(".batch-marks > span").count()) <= 64)
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          }
        }
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Compact pagination retains readable four- and five-digit numbers", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Numbers.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await gridDensity(output, "Compact Output grid")
      for (const [copies, total] of [
        [1, 1000],
        [9, 10000],
      ]) {
        await input
          .getByRole("textbox", { name: "Page selection", exact: true })
          .fill(Array(copies).fill("1").join(","))
        await input.getByLabel("Input page actions", { exact: true }).click()
        await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
        await page.keyboard.press("Escape")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await measure(output)
        assert.equal(await output.locator(".composition-totals strong").textContent(), `${total} pages`)
        assert.ok(
          Number(await output.locator(".grid-view").getAttribute("data-columns")) < 8,
          "Long numbers reserve wider cells",
        )
        await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
        await output.getByRole("button", { name: `Select Output page ${total}`, exact: true }).waitFor()
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
          if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
          await measure(output)
          await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            for (const family of ["DejaVu Sans", "Liberation Sans"]) {
              await output.evaluate((pane, value) => (pane.style.fontFamily = value), family)
              for (const number of [total - 1, total])
                await output.getByRole("button", { name: `Select Output page ${number}`, exact: true }).waitFor()
              const spacing = await output.locator(".composition-card").evaluateAll((cards) =>
                cards.map((card) => {
                  const number = card.querySelector(".card-number strong").getBoundingClientRect()
                  const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
                  const bounds = card.getBoundingClientRect()
                  return {
                    numberGap: grip.left - number.right,
                    foldGap: bounds.right - 15 - grip.right,
                    offset: grip.left + grip.width / 2 - bounds.left - bounds.width / 2,
                    font: parseFloat(getComputedStyle(card.querySelector(".card-number")).fontSize),
                  }
                }),
              )
              assert.ok(
                spacing.every(
                  ({ numberGap, foldGap, offset }) => numberGap >= 2 && foldGap >= 2 && Math.abs(offset) < 1,
                ),
                `${family}, ${text}, touch=${hasTouch}: ${total} pages keep numbers, grips, and folds apart: ${JSON.stringify(spacing.filter(({ numberGap, foldGap, offset }) => numberGap < 2 || foldGap < 2 || Math.abs(offset) >= 1))}`,
              )
              const focusClearance = await output
                .getByRole("slider", { name: "Output thumbnail range", exact: true })
                .evaluate((slider) => {
                  const style = getComputedStyle(slider)
                  const outlineBottom =
                    slider.getBoundingClientRect().bottom +
                    parseFloat(style.outlineOffset) +
                    parseFloat(style.outlineWidth)
                  return (
                    slider.closest(".page-batches").querySelector(".batch-caption").getBoundingClientRect().top -
                    outlineBottom
                  )
                })
              assert.ok(focusClearance >= -0.5, "Keyboard pagination focus stays clear of its caption")
              const last = spacing.at(-1)
              assert.ok(
                last.font >= (text === "200%" ? 22 : 11),
                "Long page numbers retain the 0.6875rem readability floor",
              )
            }
          }
        }
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await measure(output)
        await output.evaluate((pane) => pane.style.removeProperty("font-family"))
      }
      await page.setViewportSize({ width: 390, height: 900 })
      await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%"
        document.documentElement.dataset.theme = "dark"
      })
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test(
  "Page labels and compact details retain aligned controls across themes and views",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Labels.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ prepared: false, count: 4, labels: ["i", "2", "iii", "4"] }),
          })
        const input = page.locator(".selection-panel")
        for (const width of [320, 390, 768, 1440])
          for (const colorScheme of ["light", "dark"])
            for (const text of ["100%", "200%"]) {
              await page.setViewportSize({ width, height: 1100 })
              await page.emulateMedia({ colorScheme })
              await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
              await tab(input, "Grid")
              await gridDensity(input, "Normal Input grid")
              const card = input.locator(".composition-card").first()
              const label = card.locator(".grid-pdf-label")
              assert.equal(await label.textContent(), "i")
              assert.equal(
                await input.locator('.composition-card:has(.page-image[data-page="1"]) .grid-pdf-label').count(),
                0,
              )
              const position = await label.evaluate((element) => {
                const box = element.getBoundingClientRect(),
                  frame = element.closest(".composition-card").getBoundingClientRect()
                return { inset: box.x - frame.x, bottom: frame.bottom - box.bottom }
              })
              assert.ok(
                position.inset >= 8 && position.inset <= 10 && Math.abs(position.bottom) <= 2,
                JSON.stringify(position),
              )
              await gridDensity(input, "Compact Input grid")
              const inset = await input
                .getByLabel("Details for Input page 1", { exact: true })
                .evaluate(
                  (button) =>
                    button.querySelector("strong").getBoundingClientRect().left -
                    button.closest(".composition-card").getBoundingClientRect().left,
                )
              assert.ok(inset >= 8, String(inset))
              await input.getByLabel("Details for Input page 1", { exact: true }).click()
              const detail = input.locator(".card-menu-options:popover-open")
              const control = detail.getByRole("button", { name: "Add Input page 1 to Output", exact: true })
              const alignment = await control.evaluate((button) => {
                const box = button.getBoundingClientRect(),
                  panel = button.closest("[popover]").getBoundingClientRect(),
                  icon = button.querySelector("svg").getBoundingClientRect()
                return {
                  center: Math.abs(box.x + box.width / 2 - panel.x - panel.width / 2),
                  iconCenter: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
                  size: icon.width,
                }
              })
              assert.ok(
                alignment.center < 1 && alignment.iconCenter < 1 && alignment.size >= 24,
                JSON.stringify(alignment),
              )
              await page.keyboard.press("Escape")
              for (const view of ["Grid", "List", "Page"]) {
                await tab(input, view)
                if ([390, 1440].includes(width) && text === "100%")
                  await captureLayout(page, `todo-${engine.name()}-${width}-${colorScheme}-${view}`)
                const separators = await page.evaluate(() => {
                  const edges = (selector) => {
                    const element = document.querySelector(selector),
                      box = element.getBoundingClientRect(),
                      style = getComputedStyle(element),
                      outset = parseFloat(style.borderImageOutset.split(" ")[1])
                    return [box.left - outset, box.right + outset]
                  }
                  return { header: edges(".header-inner"), tabs: edges(".source-tabs"), footer: edges(".footnote") }
                })
                assert.ok(
                  Math.abs(separators.header[0] - separators.tabs[0]) < 1 &&
                    Math.abs(separators.footer[0] - separators.tabs[0]) < 1,
                  JSON.stringify({ width, text, view, separators }),
                )
                assert.ok(Math.abs(separators.header[1] - separators.footer[1]) < 1, JSON.stringify(separators))
              }
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            }
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Toolbar page navigation preserves Selection and keeps narrow view tabs readable",
  { timeout: 180000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Navigate.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 30,
              labels: Array.from({ length: 30 }, (_, i) => `Label ${i + 1}`),
              outline: [
                { title: "Start", page: 0 },
                { title: "End", page: 29 },
              ],
            }),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await input.getByLabel("Page selection", { exact: true }).fill("1-30")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        for (const width of engine === chromium ? [320, 375, 390, 810, 1440] : [375, 810])
          for (const text of ["100%", "200%"]) {
            await page.setViewportSize({ width, height: 1100 })
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
            await page.emulateMedia({ colorScheme: text === "100%" ? "light" : "dark" })
            for (const [pane, name] of [
              [input, "Input"],
              [output, "Output"],
            ]) {
              const switcher = page
                .getByRole("navigation", { name: "Workspace view", exact: true })
                .getByRole("button", { name, exact: true })
              if (await switcher.isVisible()) await switcher.click()
              const selection = pane.getByLabel("Page selection", { exact: true })
              await selection.fill("1,3")
              for (const view of ["Grid", "List", "Page"]) {
                await tab(pane, view)
                const trigger = pane.getByRole("button", { name: `Go to page in ${name}`, exact: true })
                await trigger.click()
                const popup = pane.locator(".page-destination-panel:popover-open")
                const bounds = await popup.boundingBox(),
                  anchor = await trigger.boundingBox()
                assert.ok(
                  bounds.x >= 8 && bounds.x + bounds.width <= width - 8,
                  JSON.stringify({ width, text, bounds }),
                )
                assert.ok(
                  bounds.y >= anchor.y + anchor.height && bounds.y - anchor.y - anchor.height < 8,
                  JSON.stringify({ bounds, anchor }),
                )
                const field = pane.getByRole("textbox", { name: `${name} page number`, exact: true })
                if (width === 375 && text === "100%")
                  for (const invalid of ["0", "31", "2-3", "2,2", "2.0"]) {
                    await field.fill(invalid)
                    await field.press("Enter")
                    assert.equal(await field.getAttribute("aria-invalid"), "true")
                    assert.equal(await selection.inputValue(), "1,3")
                  }
                await field.fill("20")
                await field.press("Enter")
                await field.waitFor({ state: "hidden" })
                if (view === "Page") assert.match(await pane.locator(".page-position").innerText(), /^20\s*\//)
                else
                  await pane
                    .locator(`.${view === "List" ? "list-choice" : "page-image"}[data-page="19"]`)
                    .waitFor({ state: "visible" })
                assert.equal(await selection.inputValue(), "1,3")
                assert.equal(await output.locator(".composition-totals strong").textContent(), "30 pages")
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
                if (width === 375 && text === "100%")
                  assert.equal(
                    await pane.getByRole("tab", { name: view, exact: true }).locator("span:not(.edit-dot)").isVisible(),
                    false,
                  )
                if (width !== 375 || text !== "100%") continue
                await trigger.click()
                await field.fill("4")
                await page.keyboard.press("Escape")
                await field.waitFor({ state: "hidden" })
                assert.equal(await selection.inputValue(), "1,3")
                for (const [shortcut, position] of [
                  ["First", 0],
                  ["Last", 29],
                ]) {
                  await trigger.click()
                  await pane.getByRole("button", { name: `${shortcut} ${name} page`, exact: true }).click()
                  if (view === "Page")
                    assert.equal(parseInt(await pane.locator(".page-position").innerText(), 10), position + 1)
                  else
                    await pane
                      .locator(`.${view === "List" ? "list-choice" : "page-image"}[data-page="${position}"]`)
                      .waitFor({ state: "visible" })
                  assert.equal(await selection.inputValue(), "1,3")
                }
              }
            }
          }
        await page.setViewportSize({ width: 1440, height: 1100 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await tab(output, "Grid")
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        await gridDensity(output, "Normal Output grid")
        const card = output.locator(".composition-card").first()
        await card.hover()
        assert.equal(await card.locator(".card-inline-actions button").count(), 4)
        assert.equal(
          await card.locator(".card-inline-actions").evaluate((node) => getComputedStyle(node).display),
          "contents",
        )
      } finally {
        await browser.close()
      }
    }
  },
)
