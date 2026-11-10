// Checks scrollable Grid, virtualized pages, and frame geometry; alignment owns theme and selection combinations.

import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { fixture, captureLayout, tab, checkStatus, checkGridScroll } from "./browser.js"
import { measure } from "./measure.js"
import { quality } from "./quality.ts"

test("Grid and List use matching thin scrollbars in both panes", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Input", "Output"]) {
          const switcher = page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
          if (await switcher.isVisible()) await switcher.click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          const scrollbar = (selector) =>
            pane.locator(selector).evaluate((element) => ({
              width: getComputedStyle(element).scrollbarWidth,
              gutter: element.offsetWidth - element.clientWidth,
            }))
          await tab(pane, "Grid")
          const grid = await scrollbar(".grid-view")
          await tab(pane, "List")
          const list = await scrollbar(".page-list")
          assert.equal(grid.width, "thin", `${name}, ${width}px, ${colorScheme}: Grid scrollbar`)
          assert.deepEqual(list, grid, `${name}, ${width}px, ${colorScheme}: List matches Grid`)
        }
      }
    }
  } finally {
    await browser.close()
  }
})

test("Grid and List tabs preserve layout choices and Page return", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const width of [320, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const name of ["Input", "Output"]) {
        const workspace = page
          .getByRole("navigation", { name: "Workspace view", exact: true })
          .getByRole("button", { name, exact: true })
        if (await workspace.isVisible()) await workspace.click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const buttons = pane.locator('.tabs [role="tab"]')
        assert.deepEqual(
          (await buttons.evaluateAll((tabs) => tabs.map((tab) => tab.getAttribute("aria-label")))).slice(0, 3),
          ["Grid", "List", "Page"],
        )
        assert.equal((await buttons.locator("svg").count()) >= 3, true, "Each view has an icon")
        await tab(pane, "List")
        assert.equal(await pane.getByRole("tab", { name: "List", exact: true }).getAttribute("aria-selected"), "true")
        await tab(pane, "Page")
        await pane.locator(".page-scroll").focus()
        await page.keyboard.press("v")
        assert.equal(
          await pane.getByRole("tab", { name: "List", exact: true }).getAttribute("aria-selected"),
          "true",
          `${name}: Page returns to List`,
        )
        await tab(pane, "Grid")
        await page.keyboard.press("ArrowRight")
        assert.equal(
          await pane.getByRole("tab", { name: "List", exact: true }).getAttribute("aria-selected"),
          "true",
          `${name}: ArrowRight selects List`,
        )
        await page.keyboard.press("ArrowRight")
        assert.equal(await pane.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true)
      }
    }
    await page.close()
  } finally {
    await browser.close()
  }
})

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
  "Grid preserves the first visible page through tab switches and responsive resizing",
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
      await grid.evaluate((element) => {
        element.scrollTop = element.scrollHeight - element.clientHeight - 120
      })
      await page.waitForFunction(
        () => Number(document.querySelector(".selection-panel .composition-grid")?.dataset.from) >= 270,
      )
      const end = Number(await grid.locator(".composition-grid").getAttribute("data-from"))
      await page.setViewportSize({ width: 390, height: 900 })
      await page.waitForFunction(() => document.querySelector(".selection-panel .grid-view")?.dataset.columns === "2")
      const narrow = Number(await grid.locator(".composition-grid").getAttribute("data-from"))
      assert.ok(Math.abs(narrow - end) <= 8, `Near-end anchor must survive fewer columns: ${end} -> ${narrow}`)
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
    for (const engine of engines) {
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
  for (const engine of engines) {
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
  for (const engine of engines) {
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
  for (const engine of engines) {
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
  for (const engine of engines) {
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
          {
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
          await tab(pane, "Grid")
          await tab(pane, "List")
          let widths
          for (const selected of [false, true]) {
            await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill(selected ? "1" : "")
            label = `${name}, ${width}px, ${text}, ${colorScheme}, selected=${selected}`
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
              if (selected) assert.ok(Math.abs(row.width - widths[index]) < 1, `${label}: selection retains name width`)
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
          await checkGridScroll(pane, label)
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

test("Touch Grid grips select at extended bounds without toggling twice", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    for (const width of [390, 440]) {
      const page = await browser.newPage({
        viewport: { width, height: 956 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      for (const name of ["Input", "Output"]) {
        const switcher = page.locator(".mobile-workspace-tabs")
        if (await switcher.isVisible()) await switcher.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await tab(pane, "Grid")
        const card = pane.locator('.composition-card:has(.page-image[data-page="2"])')
        await card.scrollIntoViewIfNeeded()
        const grip = card.locator(".page-grip")
        const target = await grip.evaluate((element) => {
          const box = element.getBoundingClientRect()
          const pseudo = getComputedStyle(element, "::after")
          return {
            x: box.left + box.width / 2,
            upper: box.top + parseFloat(pseudo.top) + 1,
            center: box.top + box.height / 2,
          }
        })
        const selection = pane.getByRole("textbox", { name: "Page selection", exact: true })
        await selection.fill("")
        await page.touchscreen.tap(target.x, target.upper)
        assert.equal(await selection.inputValue(), "3", `${width}px ${name}: upper hit area selects`)
        await page.touchscreen.tap(target.x, target.center)
        assert.equal(await selection.inputValue(), "", `${width}px ${name}: center tap deselects once`)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

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
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          await pane.locator(".grid-view").evaluate((element) => (element.scrollTop = 0))
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
          const grid = await measure(pane)
          assert.ok(grid.scroll > 0, `${name}: Grid has a vertical scroll range`)
          assert.equal(grid.horizontalOverflow, false, `${name}: Grid has no horizontal overflow`)
          await checkStatus(page)
          const viewport = pane.locator(".grid-view")
          await viewport.evaluate((element) => (element.scrollTop = element.scrollHeight))
          await viewport.locator('.page-image[data-page="61"]').waitFor()
          const end = await viewport.evaluate((element) => ({
            top: element.scrollTop,
            max: element.scrollHeight - element.clientHeight,
          }))
          assert.ok(end.top >= end.max - 2, `${name}: Grid reaches the last page`)
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

test("Grid scroll frame keeps card targets inside the viewport", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const name of ["Input", "Output"]) {
        const switcher = page.locator(".mobile-workspace-tabs")
        if (await switcher.isVisible()) await switcher.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await tab(pane, "Grid")
        await checkGridScroll(pane, `${name}, ${width}px`)
      }
    }
  } finally {
    await browser.close()
  }
})

test("Grid layout stays within bounds at responsive widths", { timeout: 120000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&geometry`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "80 pages")
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height })
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      const label = `${width}×${height}`
      assert.deepEqual(quality(sample), [], label)
      for (const pane of ["input", "output"]) {
        const grid = sample.layout[pane].normal
        assert.ok(grid.card.width >= 136 && grid.card.width <= 152, `${pane}: readable card width at ${label}`)
        assert.ok(grid.total > grid.mounted, `${pane}: bounded virtual window at ${label}`)
        assert.ok(grid.scroll > 0, `${pane}: scrollable page sequence at ${label}`)
      }
    }
  } finally {
    await browser.close()
  }
})

test("Touch Grid keeps full pages reachable across orientations", { timeout: 120000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&geometry`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "80 pages")
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [768, 1024],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height })
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      const label = `${width}×${height}`
      assert.deepEqual(quality(sample), [], label)
      for (const pane of ["input", "output"]) {
        const grid = sample.layout[pane].normal
        assert.ok(grid.scroll > 1, `${pane}: vertical scrolling at ${label}`)
        assert.ok(grid.mounted < grid.total, `${pane}: virtual rows at ${label}`)
        assert.ok(grid.card.width >= 136, `${pane}: readable cards at ${label}`)
      }
    }
  } finally {
    await browser.close()
  }
})

test("Page labels and details retain aligned controls across themes and views", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
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
            const inset = await input
              .getByLabel("Details for Input page 1", { exact: true })
              .evaluate(
                (button) =>
                  button.querySelector("strong").getBoundingClientRect().left -
                  button.closest(".composition-card").getBoundingClientRect().left,
              )
            assert.ok(inset >= 8, String(inset))
            await input.getByLabel("Details for Input page 1", { exact: true }).click()
            const control = input.getByRole("button", { name: "Add Input page 1 to Output", exact: true })
            const alignment = await control.evaluate((button) => {
              const box = button.getBoundingClientRect(),
                frame = button.closest(".composition-card").getBoundingClientRect(),
                icon = button.querySelector("svg").getBoundingClientRect()
              return {
                contained: box.left >= frame.left && box.right <= frame.right,
                iconCenter: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
                size: box.width,
              }
            })
            assert.ok(
              alignment.contained && alignment.iconCenter < 1 && alignment.size >= 24,
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
})

test(
  "Toolbar page navigation preserves Selection and keeps narrow view tabs readable",
  { timeout: 180000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
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

test(
  "Grid section ribbons fold pages without replacing heading thumbnails or List state",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Sections.pdf",
          mimeType: "application/pdf",
          buffer: fixture({
            prepared: false,
            count: 6,
            outline: [
              { title: "First", page: 0 },
              { title: "First child", page: 1, parent: 0 },
              { title: "Second", page: 4 },
            ],
          }),
        })
      const input = page.locator(".selection-panel")
      await tab(input, "Grid")
      const first = input.locator('.composition-card:has(.page-image[data-page="0"])')
      const ribbon = first.getByRole("button", { name: "Fold Input section: First", exact: true })
      await ribbon.waitFor()
      assert.equal(await ribbon.locator("svg").count(), 1)
      assert.equal(await first.locator(".page-image canvas").count(), 1)
      assert.equal((await first.locator(".grid-ribbon").textContent()).trim(), "")
      const footer = await first
        .locator(".input-footer")
        .evaluate((element) => getComputedStyle(element).backgroundColor)
      const secondary = await first.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--secondary").trim(),
      )
      assert.ok(secondary)
      await ribbon.click()
      await input.locator('.page-image[data-page="1"]').waitFor({ state: "detached" })
      assert.deepEqual(
        await input.locator(".page-image").evaluateAll((buttons) => buttons.map((b) => Number(b.dataset.page))),
        [0, 4, 5],
      )
      assert.equal(await first.locator(".page-image canvas").count(), 1, "Fold retains the original first page image")
      assert.equal(
        await first.locator(".input-footer").evaluate((element) => getComputedStyle(element).backgroundColor),
        footer,
      )
      await tab(input, "List")
      assert.equal(
        await input
          .getByRole("button", { name: "Unfold Input section: First", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      )
      await input.getByRole("button", { name: "Unfold Input section: First", exact: true }).click()
      assert.equal(await input.locator(".list-section[data-emphasized]").count(), 1)
      assert.equal(
        await input.locator(".list-section[data-emphasized] .list-disclosure").getAttribute("aria-label"),
        "Fold Input section: First",
      )
      await tab(input, "Grid")
      await input.locator('.page-image[data-page="1"]').waitFor({ state: "visible" })
      await input.getByRole("button", { name: "Fold all Input sections", exact: true }).click()
      await input.locator('.page-image[data-page="1"]').waitFor({ state: "detached" })
      assert.deepEqual(
        await input.locator(".page-image").evaluateAll((buttons) => buttons.map((b) => Number(b.dataset.page))),
        [0, 4],
      )
      await input.getByRole("button", { name: "Unfold all Input sections", exact: true }).click()
      await input.locator('.page-image[data-page="5"]').waitFor({ state: "visible" })
      await input.getByLabel("Page selection", { exact: true }).fill("1-6")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      const output = page.locator(".composition-output")
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Fold Output section: First", exact: true }).click()
      await output.locator('.page-image[data-page="1"]').waitFor({ state: "detached" })
      assert.deepEqual(
        await output
          .locator(".page-image")
          .evaluateAll((buttons) => buttons.map((button) => Number(button.dataset.page))),
        [0, 4, 5],
      )
      assert.equal(await output.locator('.composition-card:has(.page-image[data-page="0"]) canvas').count(), 1)
      await tab(output, "List")
      assert.equal(
        await output
          .getByRole("button", { name: "Unfold Output section: First", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      )
    } finally {
      await browser.close()
    }
  },
)

test("Grid unfolds coincident TOC headings without skipping intermediate pages", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel")
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Unfold Input section: 3. Navigation and Structure", exact: true }).click()
    const visible = await input
      .locator(".page-image")
      .evaluateAll((buttons) => buttons.map((button) => Number(button.dataset.page) + 1))
    for (const number of [32, 33, 34, 35, 37])
      assert.ok(visible.includes(number), `Page ${number} must appear after expanding section 3`)
    assert.ok(!visible.includes(36), "Later nested section 3.1.2 retains its own folded state")
    assert.ok(
      await input.getByRole("button", { name: /Unfold Input section: .*3\.1\.2/ }).count(),
      "The nested section remains independently expandable",
    )
  } finally {
    await browser.close()
  }
})

test("Grid and List section styling separates unfolded, selected, and focused states", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Sections.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 8, outline: [{ title: "First", page: 0 }] }),
      })
    const input = page.locator(".selection-panel")
    const card = input.locator(".grid-section-card").first()
    const ribbon = card.locator(".grid-ribbon")
    await ribbon.waitFor()
    const appearance = async () =>
      card.evaluate((element) => {
        const reference = document.createElement("span")
        document.body.append(reference)
        const color = (token) => {
          reference.style.color = `var(${token})`
          return getComputedStyle(reference).color
        }
        const frame = element.getBoundingClientRect()
        const icon = element.querySelector(".grid-ribbon svg").getBoundingClientRect()
        const result = {
          border: getComputedStyle(element).borderTopColor,
          thickness: getComputedStyle(element).borderTopWidth,
          ribbon: getComputedStyle(element.querySelector(".grid-ribbon")).color,
          footer: getComputedStyle(element.querySelector(".input-footer")).backgroundColor,
          iconTop: icon.top + (icon.height * 2) / 24 - frame.top,
          secondary: color("--secondary"),
          primary: color("--accent"),
          ribbonOpen: color("--edge"),
          surface: getComputedStyle(element).backgroundColor,
          thumbnail: getComputedStyle(element.querySelector(".thumbnail")).backgroundColor,
          focus: color("--keyboard-focus"),
        }
        reference.remove()
        return result
      })
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme })
      await page.mouse.move(900, 780)
      let state = await appearance()
      assert.equal(state.border, state.secondary, `${theme}: unfolded outline`)
      assert.equal(state.ribbon, state.ribbonOpen, `${theme}: unfolded ribbon`)
      assert.equal(state.thickness, "2px")
      assert.ok(state.iconTop >= -1 && state.iconTop <= 2, `${theme}: ribbon reaches card top`)
      assert.equal(state.footer, "rgba(0, 0, 0, 0)", `${theme}: neutral footer`)
      await ribbon.hover()
      assert.equal((await appearance()).ribbon, state.ribbonOpen, `${theme}: hover keeps unfolded ribbon gray`)
      const clearance = await card.evaluate(
        (element) => element.getBoundingClientRect().top - element.closest(".grid-view").getBoundingClientRect().top,
      )
      assert.ok(clearance >= 8, `${theme}: lifted Grid card clears the upper viewport edge`)

      const unfoldedSurface = state.surface
      const unfoldedThumbnail = state.thumbnail
      await ribbon.click()
      await page.mouse.move(900, 780)
      assert.equal(await ribbon.getAttribute("aria-expanded"), "false")
      state = await appearance()
      assert.equal(state.ribbon, state.secondary, `${theme}: folded ribbon`)
      assert.notEqual(state.surface, unfoldedSurface, `${theme}: opened card tint`)
      assert.notEqual(state.thumbnail, unfoldedThumbnail, `${theme}: opened thumbnail tint`)
      await ribbon.click()
      await page.mouse.move(900, 780)
      await card.locator(".page-image").click()
      await page.mouse.move(900, 780)
      state = await appearance()
      assert.equal(state.border, state.primary, `${theme}: selected outline`)
      await page.keyboard.press("Tab")
      await card.locator(".page-image").focus()
      assert.equal((await appearance()).border, state.focus, `${theme}: keyboard focus outline`)
      await page.keyboard.press("Escape")
      await card.locator(".page-image").click()
    }
    await tab(input, "List")
    const section = input.locator(".list-section").first()
    await section.locator(".list-disclosure").click()
    await section.locator(".list-disclosure").click()
    const colors = await section.evaluate((element) => {
      const reference = document.createElement("span")
      document.body.append(reference)
      reference.style.color = "var(--secondary)"
      const secondary = getComputedStyle(reference).color
      reference.style.color = "var(--edge)"
      const gray = getComputedStyle(reference).color
      reference.remove()
      return {
        border: getComputedStyle(element).outlineColor,
        width: getComputedStyle(element).outlineWidth,
        ribbon: getComputedStyle(element.querySelector(".list-disclosure")).color,
        secondary,
        gray,
      }
    })
    assert.equal(colors.border, colors.secondary, "Outline covers the entire open List row")
    assert.equal(colors.width, "2px")
    assert.equal(colors.ribbon, colors.gray, "Open List ribbon uses neutral gray")
    await section.locator(".list-disclosure").hover()
    assert.equal(
      await section.locator(".list-disclosure").evaluate((element) => getComputedStyle(element).color),
      colors.gray,
    )
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await section.locator(".list-disclosure").click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .list-row")].some((row) =>
        row.getAnimations().some((animation) => {
          if (animation.id !== "fold" || animation.effect.getTiming().duration < 750) return false
          return animation.effect.getKeyframes().at(-1)?.transform?.includes("scale(0.25)")
        }),
      ),
    )
    await section.locator('.list-disclosure[aria-expanded="false"]').waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .list-section")].some((row) =>
        row
          .getAnimations({ subtree: true })
          .some((animation) => animation.id === "section-heading" && animation.effect.getTiming().duration >= 600),
      ),
    )
    await section.locator(".list-disclosure").click()
    assert.equal(
      await section.evaluate((element) =>
        element.getAnimations().some((animation) => animation.id === "section-heading"),
      ),
      false,
      "List unfold does not pulse the heading",
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .list-row")].some((row) =>
        row.getAnimations().some((animation) => {
          const frames = animation.effect.getKeyframes()
          return (
            animation.id === "unfold" &&
            animation.effect.getTiming().duration === 750 &&
            frames[0]?.transform?.includes("scale(0.25)") &&
            frames.at(-1)?.transform?.includes("scale(1)")
          )
        }),
      ),
    )
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Fold Input section: First", exact: true }).click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .composition-card")].some((card) =>
        card.getAnimations().some((animation) => {
          if (animation.id !== "fold" || animation.effect.getTiming().duration < 750) return false
          return animation.effect.getKeyframes().at(-1)?.transform?.includes("scale(0.25)")
        }),
      ),
    )
    await input.getByRole("button", { name: "Unfold Input section: First", exact: true }).waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .composition-card.grid-section-card")].some((card) =>
        card
          .getAnimations({ subtree: true })
          .some((animation) => animation.id === "section-heading" && animation.effect.getTiming().duration >= 600),
      ),
    )
    await input.getByRole("button", { name: "Unfold Input section: First", exact: true }).click()
    assert.equal(
      await card.evaluate((element) =>
        element.getAnimations({ subtree: true }).some((animation) => animation.id === "section-heading"),
      ),
      false,
      "Grid unfold does not pulse the heading",
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .composition-card")].some((card) =>
        card.getAnimations().some((animation) => {
          const frames = animation.effect.getKeyframes()
          return (
            animation.id === "unfold" &&
            animation.effect.getTiming().duration === 750 &&
            frames[0]?.transform?.includes("scale(0.25)") &&
            frames.at(-1)?.transform?.includes("scale(1)")
          )
        }),
      ),
    )
  } finally {
    await browser.close()
  }
})

test("Input title, counts, file details, and original PDF view share the pane header", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      window.open = (url) => {
        window.inputPDFURL = url
        return { opener: null }
      }
    })
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    assert.equal(await page.locator(".input-current").innerText(), "Italic Strokes")
    assert.equal(
      await page.locator(".input-current").evaluate((element) => getComputedStyle(element).fontWeight),
      "400",
    )
    assert.match(await page.locator(".input-state .composition-totals").innerText(), /4 pages, 2\s+sheets/)
    await page.locator(".input-picker > summary").click()
    assert.ok(
      await page.locator(".input-choice").first().locator("button").getByText("demo.pdf", { exact: true }).isVisible(),
    )
    assert.ok(await page.locator(".input-choice .guidance-trigger").first().isVisible())
    await page.locator(".input-picker > summary").click()
    for (const width of [320, 390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const geometry = await page.locator(".input-heading").evaluate((heading) => {
        const selectors = [".input-picker", ".view-action", ".file-picker", ".input-state"]
        const elements = selectors.map((selector) => heading.querySelector(selector))
        const rects = elements.map((element) => element.getBoundingClientRect())
        const mobile = getComputedStyle(heading.querySelector(".input-preview-tools")).display === "contents"
        const sequence = mobile ? [0, 1, 2, 3] : [0, 3, 1, 2]
        return {
          sameRow: rects.every((rect) => Math.abs(rect.y + rect.height / 2 - (rects[0].y + rects[0].height / 2)) < 2),
          ordered: sequence.slice(1).every((index, offset) => rects[sequence[offset]].right <= rects[index].left),
          within: rects.every((rect) => rect.right <= innerWidth),
          totalsVisible: getComputedStyle(heading.querySelector(".composition-totals")).visibility === "visible",
          fileLabelVisible: getComputedStyle(heading.querySelector(".file-picker > span")).display !== "none",
          titleVisible: getComputedStyle(heading.querySelector(".input-current")).display !== "none",
        }
      })
      assert.ok(geometry.sameRow && geometry.ordered && geometry.within, `${width}: ${JSON.stringify(geometry)}`)
      assert.equal(geometry.totalsVisible, true, `${width}: page and sheet totals remain visible`)
      assert.equal(geometry.fileLabelVisible, width === 1440, `${width}: the Open PDF label only appears on desktop`)
      assert.equal(geometry.titleVisible, width === 1440, `${width}: the Input title only appears on desktop`)
      assert.ok(await page.getByRole("button", { name: "View Input PDF" }).isVisible())
      if (width < 1440) {
        await page.locator(".input-picker > summary").click()
        assert.ok(await page.locator(".input-choice .guidance-trigger").first().isVisible())
        await page.locator(".input-picker > summary").click()
      }
      if (width === 390) {
        const chooser = page.waitForEvent("filechooser")
        await page.locator(".input-heading > .file-picker").click()
        assert.ok((await chooser).isMultiple(), "Open PDF still opens the multi-file picker")
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    const gaps = await page.evaluate(() => {
      const right = (selector) => document.querySelector(selector).getBoundingClientRect().right
      const left = (selector) => document.querySelector(selector).getBoundingClientRect().left
      return {
        input: left(".input-heading > .file-picker") - right(".input-preview-tools > .view-action"),
        output:
          left(".composition-output .output-actions > .primary") -
          right(".composition-output .output-actions > .view-action"),
      }
    })
    assert.ok(Math.abs(gaps.input - gaps.output) < 1.5, `Input/Output eye spacing: ${JSON.stringify(gaps)}`)
    await page.setViewportSize({ width: 320, height: 900 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "150%"))
    await page.getByRole("button", { name: "Input details" }).click()
    assert.match(await page.locator('[popover][aria-label="Input details"]').innerText(), /4 pages, 2\s+sheets/)
    await page.getByRole("button", { name: "View Input PDF" }).click()
    const bytes = await page.evaluate(async () => {
      const response = await fetch(window.inputPDFURL)
      return [...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)]
    })
    assert.deepEqual(bytes, [37, 80, 68, 70], "Viewer receives original PDF bytes")
  } finally {
    await browser.close()
  }
})
