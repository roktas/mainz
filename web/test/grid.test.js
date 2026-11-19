// Checks scrollable Grid, virtualized pages, and frame geometry; alignment owns theme and selection combinations.

import { setup, selectPane } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { outputCount, fixture, captureLayout, tab, checkGridScroll } from "./browser.js"
import { measure } from "./measure.js"

test("Scroll endpoints preserve native extents, selection, and keyboard scrolling", { timeout: 90000 }, async (t) => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const width of [390, 1440]) {
        t.diagnostic(`${engine.name()}, ${width}px`)
        const page = await browser.newPage({
          viewport: { width, height: 1000 },
          hasTouch: width === 390,
          reducedMotion: "reduce",
        })
        page.setDefaultTimeout(10000)
        await setup(page)
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.goto(server.resolvedUrls.local[0])
        await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
          name: "Long.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false, count: 300 }),
        })
        const input = page.locator(".selection-panel")
        const selection = input.getByLabel("Page selection", { exact: true })
        await selection.fill("2,4")
        for (const view of ["Grid", "List"]) {
          await tab(input, view)
          const viewport = input.locator(view === "Grid" ? ".grid-view" : ".page-list")
          const controls = page.getByRole("group", {
            name: `Input ${view} scroll controls`,
            exact: true,
            includeHidden: true,
          })
          await controls.waitFor()
          const extent = await viewport.evaluate((element) => [element.clientHeight, element.scrollHeight])
          await controls.evaluate((element) => element.hidePopover())
          assert.deepEqual(
            await viewport.evaluate((element) => [element.clientHeight, element.scrollHeight]),
            extent,
            "Scroll controls preserve the native thumb ratio",
          )
          await controls.evaluate((element) => element.showPopover())
          for (const [name, fraction] of [
            ["end", 1],
            ["start", 0],
          ]) {
            await controls.getByRole("button", { name: `Scroll Input ${view} to ${name}`, exact: true }).click()
            await page.waitForFunction(
              ({ element, fraction }) =>
                Math.abs(element.scrollTop - fraction * (element.scrollHeight - element.clientHeight)) <=
                Math.max(2, (element.scrollHeight - element.clientHeight) * 0.015),
              { element: await viewport.elementHandle(), fraction },
            )
            assert.equal(await selection.inputValue(), "2,4")
          }
          const item = view === "Grid" ? ".page-image" : ".list-choice"
          await viewport.locator(`${item}[data-page="0"]`).waitFor({ state: "visible" })
          await viewport.locator(`${item}[data-page="0"]`).focus()
          await page.keyboard.press("End")
          await viewport.locator(`${item}[data-page="299"]`).waitFor({ state: "visible" })
          assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "299")
          await page.keyboard.press("Home")
          await viewport.locator(`${item}[data-page="0"]`).waitFor({ state: "visible" })
          const peek = await viewport
            .locator(view === "Grid" ? ".grid-inspect" : ".list-peek")
            .first()
            .boundingBox()
          const rail = await controls.boundingBox()
          assert.ok(
            rail.x >= peek.x + peek.width - 1,
            `${engine.name()}, ${width}px, ${view}: ${JSON.stringify({ rail, peek })}`,
          )
          const field = await input.locator(".sequence-entry > .entry").boundingBox()
          const glyphs = await controls
            .locator("svg")
            .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
          assert.ok(
            glyphs.every((box) => box.x + box.width / 2 > field.x + field.width),
            "Scrollbar controls sit outside the selection-field edge",
          )
          const footer = await page.locator(".footnote").boundingBox()
          assert.ok(glyphs[1].bottom < footer.y, "The last control stays clear of the status bar")
        }
        await page.getByRole("button", { name: "Help", exact: true }).click()
        const help = page.getByRole("dialog", { name: "Help", exact: true })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        const helpControls = help.locator(".scroll-controls").first()
        await helpControls.waitFor()
        const end = helpControls.getByRole("button", { name: /to end$/ })
        await end.click()
        await helpControls.getByRole("button", { name: /to start$/ }).click()
        await page.keyboard.press("Escape")
        await help.waitFor({ state: "hidden" })
        assert.equal(await selection.inputValue(), "2,4")
        assert.deepEqual(errors, [])
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Grid scroll windows keep 300 pages reachable with stable card geometry", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
    await setup(page)
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
      await setup(page)
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

test("Page metadata retains physical selection through Grid, List, and captions", { timeout: 90000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  let page
  try {
    page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    const metadata = [
      { name: "Practice", tags: ["guides"] },
      { name: "Details", tags: ["detail"] },
      { name: "Practice" },
      { name: "An extended page name with unbrokenwords".repeat(3) },
      {},
      {},
    ]
    await page.route("**/magna.pdf", (route) =>
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
    await input.locator(':is(.list-choice, .list-heading)[data-page="1"]').focus()
    await page.keyboard.press("v")
    assert.equal(await input.locator(".inspection-heading .page-name").textContent(), "Details")
    await tab(input, "Grid")
    assert.equal(await input.locator(".page-image").count(), 6)
    assert.equal(await selection.inputValue(), "1-5")
    await tab(output, "List")
    assert.equal(await output.locator(".page-list > .list-row").count(), 6)
    await tab(input, "List")
    await input.locator(':is(.list-choice, .list-heading)[data-page="2"]').focus()
    await page.keyboard.press("ArrowDown")
    assert.equal(
      await input
        .locator(':is(.list-choice, .list-heading)[data-page="3"]')
        .evaluate((element) => element === document.activeElement),
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
    await setup(page)
    await page.route("**/dolor.pdf", (route) =>
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
    await input.locator(':is(.list-choice, .list-heading)[data-page="1"]').focus()
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
      await setup(page)
      await page.route("**/magna.pdf", (route) =>
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
      const input = page.locator(".selection-panel")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
      await input
        .locator(".input-footer")
        .nth(1)
        .getByRole("button", { name: "Add Input page 2 to Output", exact: true })
        .click()
      assert.match(await outputCount(page).locator("..").innerText(), /^5 pages/)
    } finally {
      await browser.close()
    }
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
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      for (const name of ["Input", "Output"]) {
        const switcher = page.locator(".mobile-workspace-tabs")
        await selectPane(switcher.getByRole("button", { name, exact: true }))
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

test("Grid scroll frame keeps card targets inside the viewport", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const name of ["Input", "Output"]) {
        const switcher = page.locator(".mobile-workspace-tabs")
        await selectPane(switcher.getByRole("button", { name, exact: true }))
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await tab(pane, "Grid")
        await checkGridScroll(pane, `${name}, ${width}px`)
      }
    }
  } finally {
    await browser.close()
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
        await setup(page)
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
              await selectPane(switcher)
              const selection = pane.getByLabel("Page selection", { exact: true })
              await selection.fill("1,3")
              for (const view of ["Grid", "List", "Page"]) {
                await tab(pane, view)
                if (name === "Input") {
                  const go = await pane.getByRole("button", { name: "Go to page in Input", exact: true }).boundingBox()
                  const toc = await pane.getByRole("button", { name: "Input contents", exact: true }).boundingBox()
                  assert.ok(
                    go.x >= toc.x + toc.width - 1,
                    `${engine.name()}, ${width}, ${text}, ${view}: Go to follows Contents at the right edge`,
                  )
                }
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
                if (width === 375 && text === "100%" && name === "Input" && view === "Grid")
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
                    .locator(`${view === "List" ? ":is(.list-choice, .list-heading)" : ".page-image"}[data-page="19"]`)
                    .waitFor({ state: "visible" })
                assert.equal(await selection.inputValue(), "1,3")
                assert.equal(await outputCount(page).textContent(), "30 pages")
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
                if (width === 375 && text === "100%")
                  assert.equal(
                    await pane.getByRole("tab", { name: view, exact: true }).locator("span").isVisible(),
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
                      .locator(
                        `${view === "List" ? ":is(.list-choice, .list-heading)" : ".page-image"}[data-page="${position}"]`,
                      )
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
