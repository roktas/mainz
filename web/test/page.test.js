// Checks Page navigation, zoom, inspection, and shared Grid state.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { mkdir, readFile } from "node:fs/promises"
import { measure } from "./measure.js"
import { chromium, webkit } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { fixture, hasCursor, tab, pagePosition, image, pixel, captureLayout } from "./browser.js"

const standard = process.env.MAINZ_TEST_MODE === "standard"

test("Long Page counters keep enlarged text and reachable zoom actions", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    await mkdir("../.local/tmp/web/layout/page-counter", { recursive: true })
    for (const engine of [chromium, webkit]) {
      browser = await engine.launch()
      page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:installation", "seen")
      })
      await page.goto(server.resolvedUrls.local[0])
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Counter.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      await page.locator(".input-current").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByLabel("Page selection", { exact: true }).fill(Array(10).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      for (const density of ["Normal", "Compact"]) {
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await tab(output, "Grid")
        await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
        await tab(output, "Page")
        if (density === "Compact")
          await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        await output.locator(".page-scroll").press("End")
        assert.match(await pagePosition(output), /10000\s*\/ 10000/)
        for (const [width, text, theme] of [
          [320, "200%", "light"],
          [320, "200%", "dark"],
          [390, "200%", "dark"],
          [768, "200%", "light"],
          [320, "100%", "dark"],
        ]) {
          await page.setViewportSize({ width, height: 844 })
          await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
          await page.emulateMedia({ colorScheme: theme })
          const views = page.locator(".mobile-workspace-tabs")
          if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
          await output.locator(".page-scroll").press("Home")
          await aligned(output)
          await output.locator(".page-scroll").press("End")
          await aligned(output)
          const geometry = await output.locator(".inspection-heading").evaluate((heading) => {
            const counter = heading.querySelector(".page-number-control")
            const bounds = counter.getBoundingClientRect()
            const frame = heading.getBoundingClientRect()
            const tools = [...heading.querySelectorAll(".page-tools button")]
              .filter((button) => button.checkVisibility({ visibilityProperty: true }))
              .map((button) => button.getBoundingClientRect())
            return {
              separate: tools.every((tool) => tool.left >= bounds.right),
              contained: bounds.left >= frame.left && bounds.right <= frame.right,
              font: getComputedStyle(counter.querySelector(".page-position")).fontSize,
              expectedFont: getComputedStyle(
                heading.closest(".composition-output").querySelector(".page-navigation button"),
              ).fontSize,
            }
          })
          const diagnostic = `${engine.name()}, ${density}, ${width}, ${text}, ${theme}`
          assert.equal(geometry.separate && geometry.contained, true, diagnostic)
          assert.equal(geometry.font, geometry.expectedFont, `${diagnostic}: counter retains full text size`)
          if (width === 320 && text === "200%") {
            assert.equal(await output.locator(".page-view").getAttribute("data-controls"), "menu", diagnostic)
            await output.locator(".page-view").screenshot({
              path: `../.local/tmp/web/layout/page-counter/${engine.name()}-${density}-${theme}.png`,
            })
            await output.locator(".page-scroll").press("+")
            const trigger = output.getByLabel("Output page actions", { exact: true })
            await trigger.click()
            const menu = output.locator(".sequence-options")
            const reset = menu.getByRole("button", { name: "Reset zoom", exact: true })
            const target = await reset.boundingBox()
            assert.ok(target.width >= 44 && target.height >= 44 && target.x >= 0 && target.x + target.width <= width)
            await reset.press("Enter")
            assert.equal((await output.getByLabel("Output page zoom", { exact: true }).textContent()).trim(), "100%")
            await menu.getByRole("button", { name: "Fit width", exact: true }).click()
            await trigger.click()
            await aligned(output)
            const fitted = await output.locator(".page-scroll").evaluate((viewport) => {
              const canvas = viewport.querySelector("canvas").getBoundingClientRect()
              const gutter = parseFloat(getComputedStyle(viewport.firstElementChild).paddingBlockStart)
              return { image: canvas.width, available: viewport.clientWidth - 2 * gutter }
            })
            assert.ok(
              fitted.image <= fitted.available + 1 && fitted.available - fitted.image < 4,
              `${diagnostic}: menu fits the page width (${JSON.stringify(fitted)})`,
            )
          } else {
            assert.notEqual(await output.locator(".page-view").getAttribute("data-controls"), "menu", diagnostic)
          }
        }
      }
      await browser.close()
      browser = undefined
    }
  } catch (error) {
    if (page) await captureLayout(page, "page-counter", { error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

test("Arrows enter Grid without selection and Page keys change thumbnail groups", { timeout: 60000 }, async (t) => {
  const server = await serve()
  let browser, page, scenario, batch
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [density, width, theme, textSize] of [
      ["Normal", 1440, "light", "100%"],
      ["Compact", 1440, "dark", "100%"],
      ["Normal", 390, "light", "200%"],
      ["Compact", 390, "dark", "200%"],
    ].filter(
      ([gridDensity, viewportWidth]) =>
        !standard ||
        (gridDensity === "Normal" && viewportWidth === 1440) ||
        (gridDensity === "Compact" && viewportWidth === 390),
    )) {
      page = await browser.newPage({
        viewport: { width, height: 900 },
        reducedMotion: width === 390 ? "reduce" : "no-preference",
        colorScheme: theme,
      })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "60 pages")
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      for (const name of ["Input", "Output"]) {
        scenario = `${name} ${density}, ${width}px, ${textSize} text`
        t.diagnostic(scenario)
        if (width === 390)
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        )
        await measure(pane)
        const field = pane.getByLabel("Page selection", { exact: true })
        batch = Number(await pane.locator(".grid-view").getAttribute("data-batch"))
        await field.focus()
        await page.keyboard.press("ArrowRight")
        assert.equal(await field.evaluate((element) => document.activeElement === element), true, "Fields keep arrows")
        await page.keyboard.press("PageDown")
        assert.equal(await pane.locator(".batch-slider input").inputValue(), "0", "Fields keep PageDown")
        await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } })
        await page.keyboard.press("PageDown")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${batch + 1}`,
        )
        await page.keyboard.press("PageUp")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 1`,
        )
        for (const [key, expected] of [
          ["ArrowLeft", 2 * batch],
          ["ArrowRight", batch + 1],
        ]) {
          if (key === "ArrowLeft")
            await pane.getByRole("button", { name: `Next ${name} thumbnails`, exact: true }).click()
          await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } })
          await page.keyboard.press(key)
          await page.waitForFunction(
            (label) => document.activeElement?.getAttribute("aria-label") === label,
            `Select ${name} page ${expected}`,
          )
          assert.equal(await field.inputValue(), "", "Starting navigation leaves Selection empty")
          assert.equal(await pane.locator(".batch-slider input").inputValue(), "1", "Entry retains the current group")
          await page.waitForFunction(hasCursor)
          if (density === "Normal")
            assert.equal(
              await pane
                .getByRole("button", {
                  name: name === "Input" ? `Add Input page ${expected} to Output` : `Duplicate Output page ${expected}`,
                  exact: true,
                })
                .isVisible(),
              true,
              "The individual + stays available during keyboard navigation",
            )
        }
        await page.keyboard.press("PageUp")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 1`,
        )
        await page.keyboard.press("ArrowRight")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 2`,
        )
        assert.equal(await field.inputValue(), "")
        await page.keyboard.press("Space")
        assert.equal(await field.inputValue(), "2")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 3`,
        )
        const selectedBatch = Number(await pane.locator(".batch-slider input").inputValue())
        await page.keyboard.press("PageDown")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${(selectedBatch + 1) * batch + 1}`,
        )
        assert.equal(await field.inputValue(), "2", "Changing groups retains Selection")
        await page.keyboard.press("PageUp")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${selectedBatch * batch + 1}`,
        )
        await page.keyboard.press("Home")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 1`,
        )
        await page.keyboard.press("PageUp")
        assert.equal(await pane.locator(".batch-slider input").inputValue(), "0")
        await pane.getByRole("slider", { name: `${name} thumbnail range`, exact: true }).focus()
        await page.keyboard.press("PageDown")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${batch + 1}`,
        )
        assert.equal(await pane.locator(".batch-slider input").inputValue(), "1", "Pagination PageDown moves one group")
        if (name === "Input" && width === 1440) {
          const other = page.locator(".composition-output")
          await tab(other, "Page")
          const before = await pagePosition(other)
          await field.fill("")
          await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } })
          await page.keyboard.press("ArrowRight")
          await page.waitForFunction(
            (label) => document.activeElement?.getAttribute("aria-label") === label,
            `Select Input page ${batch + 1}`,
          )
          assert.equal(await pagePosition(other), before, "Grid entry keeps the other pane's Page unchanged")
          await field.fill("2")
          await pane.getByRole("button", { name: `Select Input page ${batch + 1}`, exact: true }).focus()
          await page.keyboard.press("PageDown")
          await page.waitForFunction(
            (label) => document.activeElement?.getAttribute("aria-label") === label,
            `Select Input page ${2 * batch + 1}`,
          )
          assert.equal(await pagePosition(other), before, "Grid pagination keeps the other pane's Page unchanged")
          await tab(other, "Grid")
          await pane.getByRole("button", { name: `Select Input page ${2 * batch + 1}`, exact: true }).focus()
        }
        await page.keyboard.press("End")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 60`,
        )
        await page.keyboard.press("PageDown")
        assert.equal(await field.inputValue(), "2")
        assert.equal(await page.locator(".composition-totals strong").textContent(), "60 pages")
        await field.fill("")
        await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } })
        await page.keyboard.press("ArrowLeft")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 60`,
        )
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.close()
      page = undefined
    }
  } catch (error) {
    if (page)
      await captureLayout(page, "grid-navigation", {
        label: scenario,
        expectedBatch: batch,
        error: error.message,
        current: await page.evaluate(() => ({
          batches: [...document.querySelectorAll(".grid-view")].map((view) => ({
            pane: view.closest(".selection-panel") ? "Input" : "Output",
            batch: view.getAttribute("data-batch"),
          })),
          focus: document.activeElement?.getAttribute("aria-label"),
        })),
      })
    throw error
  } finally {
    await browser?.close()
  }
})

test("Page and Grid share viewport bounds and density keeps the fitted image size", { timeout: 90000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    // Grid tests own full matrix packing; Page needs a populated shared frame.
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const [width, height] of [
        [1920, 1080],
        [2240, 1260],
        [2560, 1440],
        [3840, 2160],
      ].filter(([viewportWidth]) => !standard || [1920, 3840].includes(viewportWidth))) {
        await t.test(`${width}×${height}, ${colorScheme}`, async () => {
          await page.setViewportSize({ width, height })
          await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
          await page.waitForFunction(
            () => document.querySelector(".composition-totals strong")?.textContent === "80 pages",
          )
          await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
          await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
          const before = await measure(input)
          await tab(output, "Page")
          await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
          await zoom(output, "Reset zoom")
          await aligned(output)
          const geometry = await page.evaluate(() => {
            const grid = document.querySelector(".grid-view"),
              view = document.querySelector(".page-view")
            const scroll = view.querySelector(".page-scroll").getBoundingClientRect()
            const sheet = view.querySelector("canvas").getBoundingClientRect()
            const actions = view.querySelector(".page-actions").getBoundingClientRect()
            const frame = view.getBoundingClientRect()
            return {
              rows: Number(grid.dataset.rows),
              frames: [grid, view].map((element) => element.getBoundingClientRect().height),
              image: [sheet.width, sheet.height],
              surround: [scroll.width, scroll.height],
              margins: [sheet.top - scroll.top, scroll.bottom - sheet.bottom],
              side: sheet.left - scroll.left,
              heading: view.querySelector(".inspection-heading").getBoundingClientRect().height,
              actionOffset: actions.x + actions.width / 2 - frame.x - frame.width / 2,
              fillsViewport: document.documentElement.scrollHeight <= innerHeight,
              footerGap:
                document.querySelector(".footnote").getBoundingClientRect().top -
                parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom) -
                frame.bottom,
            }
          })
          assert.equal(geometry.rows, before.capacity[1], "Page retains its companion Grid's row capacity")
          assert.equal(geometry.heading, 45, "Output Page keeps its controls on one heading row")
          assert.ok(Math.abs(geometry.actionOffset) < 1, "Page actions stay centered")
          assert.equal(geometry.frames[0], geometry.frames[1], "Grid and Page keep one shared frame")
          assert.ok(Math.abs(geometry.margins[0] - geometry.margins[1]) < 1, "Page stays vertically centered")
          if (geometry.fillsViewport)
            assert.ok(Math.abs(geometry.footerGap) < 1, "Spare viewport height fills the frame above the status bar")
          else
            assert.ok(
              geometry.margins.every((margin) => margin <= Math.max(48, geometry.side * 1.5) + 1),
              "Fitted margins stay balanced when the workspace exceeds the viewport height",
            )
          assert.ok(
            geometry.image.every((size, axis) => size <= geometry.surround[axis]),
            "Fit keeps the complete PDF within its available image area",
          )
        })
      }
    }
    await t.test("Responsive zoom and empty Output retain the shared frame", async () => {
      await page.setViewportSize({ width: 1920, height: 1080 })
      const viewport = output.getByRole("region", { name: "PDF viewport", exact: true })
      const fittedFrame = await output.locator(".page-view").boundingBox()
      await zoom(output, "Zoom in")
      assert.equal(
        (await output.locator(".page-view").boundingBox()).height,
        fittedFrame.height,
        "Page zoom keeps the shared frame height",
      )
      await zoom(output, "Reset zoom")
      await viewport.focus()
      await page.keyboard.press("End")
      await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
      await page.waitForFunction(() => {
        const sheet = document.querySelector(".page-view canvas")
        return sheet && sheet.clientWidth > sheet.clientHeight
      })
      const landscape = await output.locator(".page-view").boundingBox()
      assert.equal(landscape.height, fittedFrame.height, "Page proportions keep the shared viewport frame")
      await tab(input, "Page")
      await input.locator(".pdf-viewport[aria-busy=false]").waitFor()
      const heights = await page
        .locator(".page-view")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
      assert.equal(heights[0], heights[1], "Two Pages share the height needed by the taller fitted page")
      assert.equal(heights[0], landscape.height)
      await page.setViewportSize({ width: 390, height: 844 })
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      await page.waitForFunction(() => document.querySelector(".composition-output .page-view")?.clientHeight < 600)
      assert.ok(
        (await output.locator(".page-view").boundingBox()).height < 600,
        "The hidden mobile Page does not enlarge the visible Page's frame",
      )
      await page.setViewportSize({ width: 1920, height: 1080 })
      await tab(input, "Grid")
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Normal Output grid", exact: true }).click()
      await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("Home")
      await tab(output, "Page")
      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
      await aligned(output)
      const natural = await image(output).boundingBox()
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      await tab(output, "Page")
      await page.waitForFunction(({ width, height }) => {
        const bounds = document.querySelector(".composition-output .page-view canvas")?.getBoundingClientRect()
        return bounds && Math.abs(bounds.width - width) < 1 && Math.abs(bounds.height - height) < 1
      }, natural)
      await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
      const compact = await image(output).boundingBox()
      assert.ok(
        Math.abs(compact.width - natural.width) < 1 && Math.abs(compact.height - natural.height) < 1,
        "Density preserves the fitted PDF at 200% text",
      )
      await page.evaluate(() => (document.documentElement.style.fontSize = ""))
      await page.setViewportSize({ width: 1920, height: 1080 })
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.waitForFunction(() => document.querySelector(".selection-panel .grid-view")?.dataset.batch === "24")
      assert.equal(
        await input.locator(".grid-view").getAttribute("data-rows"),
        "4",
        "An empty Output Page keeps Input within the shared viewport budget",
      )
      assert.deepEqual(errors, [])
    })
  } finally {
    await browser?.close()
  }
})

test("Page pinch zoom preserves its anchor and shares the button zoom range", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme] of [
      [810, 1080, "light"],
      [390, 844, "dark"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.emulateMedia({ colorScheme })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composition-totals strong").waitFor({ state: "attached" })
      const session = await page.context().newCDPSession(page)
      for (const name of ["Input", "Output"]) {
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).tap()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const selection = pane.getByRole("textbox", { name: "Page selection", exact: true })
        const prepared = await selection.inputValue()
        await tab(pane, "Page")
        const canvas = pane.locator(".page-scroll canvas")
        for (const [distance, value] of [
          [140, 175],
          [220, 275],
        ]) {
          await zoom(pane, "Reset zoom")
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
          await canvas.scrollIntoViewIfNeeded()
          const before = await canvas.boundingBox()
          const raster = await canvas.evaluate((element) => element.width)
          const center = {
            x: before.x + before.width * 0.6,
            y: Math.min(height - 100, before.y + before.height * 0.55),
          }
          const anchor = { x: (center.x - before.x) / before.width, y: (center.y - before.y) / before.height }
          const points = (separation) => [
            { x: center.x - separation / 2, y: center.y, id: 1 },
            { x: center.x + separation / 2, y: center.y, id: 2 },
          ]
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(80) })
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(distance) })
          const enlarged = await canvas.boundingBox()
          assert.ok(Math.abs(enlarged.width - before.width * (value / 100)) < 1)
          assert.equal(
            await canvas.evaluate((element) => element.width),
            raster,
            "The live gesture reuses the existing raster",
          )
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
          await page.waitForFunction(
            ({ label, value: percentage }) =>
              [...document.querySelectorAll("output")].some(
                (element) => element.getAttribute("aria-label") === label && element.textContent === `${percentage}%`,
              ),
            { label: `${name} page zoom`, value },
          )
          await page.waitForFunction(
            (selector) => {
              const element = document.querySelector(`${selector} .page-scroll canvas`)
              return element && !element.style.transform && element.parentElement.getAttribute("aria-busy") === "false"
            },
            name === "Input" ? ".selection-panel" : ".composition-output",
          )
          const after = await canvas.boundingBox()
          const region = await pane.locator(".page-scroll").evaluate((element) => ({
            x: element.scrollLeft,
            max: element.scrollWidth - element.clientWidth,
            bounds: element.getBoundingClientRect().toJSON(),
          }))
          const unscrolled = after.x + region.x
          const expected = Math.max(unscrolled - region.max, Math.min(unscrolled, center.x - after.width * anchor.x))
          assert.ok(
            Math.abs(after.x - expected) < 2,
            `Pinch anchors within the horizontal scroll bounds: ${JSON.stringify({ name, width, before, after, center, anchor, region })}`,
          )
          if (!region.max)
            assert.ok(
              Math.abs(after.x + after.width / 2 - region.bounds.x - region.bounds.width / 2) < 1,
              "An image that fits horizontally stays centered",
            )
          assert.ok(
            Math.abs(after.y + after.height * anchor.y - center.y) < 2,
            `Pinch keeps the vertical anchor under the fingers: ${JSON.stringify({ name, width, before, after, center, anchor })}`,
          )
          assert.equal(await page.evaluate(() => visualViewport.scale), 1)
          assert.equal(await selection.inputValue(), prepared)
          assert.equal(await page.locator(".composition-totals strong").textContent(), "8 pages")
          await zoom(pane, "Zoom in")
          assert.equal(await pane.locator("output").textContent(), value === 175 ? "200%" : "300%")
          await zoom(pane, "Zoom out")
          assert.equal(await pane.locator("output").textContent(), value === 175 ? "150%" : "200%")
          await zoom(pane, "Reset zoom")
          assert.equal(await pane.locator("output").textContent(), "100%")
        }
        if (width === 810 && name === "Output") {
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
          await canvas.scrollIntoViewIfNeeded()
          const bounds = await canvas.boundingBox()
          const pointsAt = (distance) => [
            { x: width / 2 - distance / 2, y: bounds.y + 150, id: 1 },
            { x: width / 2 + distance / 2, y: bounds.y + 150, id: 2 },
          ]
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pointsAt(80) })
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pointsAt(160) })
          await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] })
          assert.equal(await pane.locator("output").textContent(), "100%", "Cancellation retains the previous zoom")
          assert.equal(await canvas.evaluate((element) => element.style.transform), "")
          for (const [start, end, expected] of [
            [80, 480, "600%"],
            [10, 400, "3200%"],
            [400, 4, "50%"],
          ]) {
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pointsAt(start) })
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pointsAt(end) })
            await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
            assert.equal(await pane.locator("output").textContent(), expected)
            await page.waitForFunction(() => {
              const element = document.querySelector(".composition-output .page-scroll canvas")
              return !element.style.transform && element.parentElement.getAttribute("aria-busy") === "false"
            })
          }
          assert.equal(await selection.inputValue(), prepared)
          assert.equal(await page.locator(".composition-totals strong").textContent(), "8 pages")
        }
      }
      assert.deepEqual(errors, [])
      await session.detach()
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Page cancellation clears a pending pinch before the next render", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composition-totals strong").waitFor({ state: "attached" })
    await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
    const pane = page.locator(".composition-output")
    for (const action of ["touchcancel", "blur", "navigate", "hidden", "detach"]) {
      await tab(pane, "Page")
      await zoom(pane, "Reset zoom")
      await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
      const result = await pane.locator(".page-scroll").evaluate(async (viewport, action) => {
        const canvas = viewport.querySelector("canvas")
        const pane = viewport.closest(".composition-output")
        const bounds = canvas.getBoundingClientRect()
        const touch = (distance) =>
          [0, 1].map(
            (id) =>
              new Touch({
                identifier: id,
                target: canvas,
                clientX: bounds.x + bounds.width / 2 + (id ? distance : -distance),
                clientY: bounds.y + Math.min(100, bounds.height / 2),
              }),
          )
        for (const [type, touches] of [
          ["touchstart", touch(20)],
          ["touchmove", touch(40)],
          ["touchend", []],
        ])
          viewport.dispatchEvent(new TouchEvent(type, { touches, bubbles: true, cancelable: true }))
        const pending = !!canvas.style.transform
        if (action === "touchcancel") viewport.dispatchEvent(new TouchEvent("touchcancel", { bubbles: true }))
        else if (action === "blur") window.dispatchEvent(new Event("blur"))
        else if (action === "navigate")
          viewport.closest(".page-view").querySelector('button[aria-label="Next Output page"]').click()
        else if (action === "detach")
          [...pane.querySelectorAll('[role="tab"]')].find((tab) => tab.textContent.trim() === "Grid").click()
        else pane.style.display = "none"
        if (action === "navigate") await new Promise((resolve) => requestAnimationFrame(resolve))
        if (action === "hidden" || action === "detach")
          await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
        const cleared = !canvas.style.transform && !canvas.style.transformOrigin
        pane.style.removeProperty("display")
        return { pending, cleared }
      }, action)
      assert.deepEqual(result, { pending: true, cleared: true }, action)
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
  }
})

test("The lens waits for a settled mouse and cancels pending openings", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, theme, textSize] of [
      [1440, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.clock.install({ time: 0 })
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:theme", choice)
      }, theme)
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      const lens = page.getByRole("region", { name: /^Magnified page / })
      for (const name of ["Input", "Output"]) {
        for (const view of ["Grid", "Page"]) {
          await page.clock.resume()
          if (width === 390)
            await page
              .getByRole("navigation", { name: "Workspace view", exact: true })
              .getByRole("button", { name, exact: true })
              .click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, view)
          const canvas = pane.locator(view === "Grid" ? ".thumbnail canvas" : ".page-scroll canvas").first()
          await canvas.scrollIntoViewIfNeeded()
          await page.waitForFunction(
            (element) =>
              element.width > 0 &&
              !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]") &&
              !document.querySelector(".header-feedback .style-progress"),
            await canvas.elementHandle(),
          )
          await page.evaluate(() => document.fonts.ready)
          await page.mouse.move(0, 0)
          await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000))
          const bounds = await canvas.boundingBox()
          const move = async (fraction) => {
            const area = await canvas.boundingBox()
            await canvas.hover({ position: { x: area.width * fraction, y: area.height / 2 } })
          }
          for (const fraction of [0.2, 0.3, 0.4, 0.5]) {
            await move(fraction)
            await page.clock.runFor(100)
            assert.equal(await lens.count(), 0, `${name} ${view}: continuous movement does not open the lens`)
          }
          await page.clock.runFor(100)
          await lens.waitFor()
          assert.equal(await lens.isVisible(), true, `${name} ${view}: a brief stop opens the lens`)
          await page.clock.runFor(200)
          await lens.locator("canvas").waitFor()
          const before = await lens.locator("canvas").evaluate((element) => element.toDataURL())
          await move(0.7)
          assert.notEqual(
            await lens.locator("canvas").evaluate((element) => element.toDataURL()),
            before,
            `${name} ${view}: the open lens follows immediately`,
          )
          await page.mouse.move(0, 0)
          assert.equal(await lens.count(), 0, `${name} ${view}: leaving closes the lens`)
          for (const action of ["leave", "Escape", "click", "wheel"]) {
            await move(0.5)
            await page.clock.runFor(100)
            if (action === "leave") await page.mouse.move(0, 0)
            else if (action === "Escape") await page.keyboard.press("Escape")
            else if (action === "click")
              await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
            else await page.mouse.wheel(0, 1)
            await page.clock.runFor(300)
            assert.equal(await lens.count(), 0, `${name} ${view}: ${action} cancels a pending opening`)
            await page.mouse.move(0, 0)
          }
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test(
  "Grid and Page share edits while inspection, original appearance, and Sources stay independent",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        ignoreDefaultArgs: ["--hide-scrollbars"],
      })
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "reduce",
      })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const ready = () =>
        page.waitForFunction(
          () =>
            !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]") &&
            !document.querySelector(".header-feedback .style-progress"),
        )
      const open = async (buffer) => {
        const count = Number((await input.locator(".input-heading .count").allTextContents())[0] ?? 0)
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name: "Filled.pdf", mimeType: "application/pdf", buffer })
        await page.waitForFunction(
          (previous) => Number(document.querySelector(".input-heading .count")?.textContent) === previous + 1,
          count,
        )
        await ready()
      }
      const select = input.getByRole("textbox", { name: "Page selection", exact: true })
      const color = async (canvas, y, expected) => {
        await page.waitForFunction(
          ({ canvas: element, y: fraction, expected: rgba }) => {
            const actual = element
              .getContext("2d")
              .getImageData(Math.floor(element.width / 2), Math.floor(element.height * fraction), 1, 1).data
            return rgba.every((value, index) => actual[index] === value)
          },
          { canvas: await canvas.elementHandle(), y, expected },
        )
        assert.deepEqual(await pixel(canvas, y), expected)
      }
      await open(fixture({ grouped: true, fillOnly: true }))
      await select.fill("7,2,2")
      await tab(input, "Page")
      await zoom(input, "Reset zoom")
      assert.match(await pagePosition(input), /1\s*\/ 7/)
      const inputGrip = input.getByRole("button", {
        name: "Select or drag Input page 1 to Output",
        exact: true,
      })
      await inputGrip.press("Space")
      assert.equal(await inputGrip.getAttribute("aria-pressed"), "true")
      assert.equal(await select.inputValue(), "7, 2, 2, 1")
      await inputGrip.press("Space")
      assert.equal(await inputGrip.getAttribute("aria-pressed"), "false")
      assert.equal(await select.inputValue(), "7, 2, 2")
      await select.fill("7,2,2")
      await input.getByRole("button", { name: "Next Input page", exact: true }).click()
      assert.equal(await select.inputValue(), "7,2,2")
      await tab(input, "Grid")
      await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
      await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).press("Space")
      assert.equal(await select.inputValue(), "")
      assert.equal(await output.locator(".composition-totals strong").textContent(), "1 page")
      await tab(input, "Page")
      await select.fill("7,2,2")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await output.locator(".composition-totals strong").textContent(), "4 pages")
      assert.equal(await select.inputValue(), "")
      await select.fill("7,2,2")
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
      await tab(output, "Page")
      await zoom(output, "Reset zoom")
      assert.match(await pagePosition(output), /3\s*\/ 4/)
      await tab(input, "Style")
      await input.getByLabel("Edit Fill", { exact: true }).click()
      await input.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#ff0000")
      await ready()
      await tab(input, "Page")
      await ready()
      const fold = await input.locator(".fold-fill").evaluate((el) => ({
        fill: getComputedStyle(el).fill,
        stroke: getComputedStyle(el).stroke,
        width: getComputedStyle(el).strokeWidth,
        edge: getComputedStyle(el.nextElementSibling).strokeWidth,
      }))
      assert.equal(fold.stroke, fold.fill)
      assert.equal(fold.width, "2px")
      assert.equal(fold.width, fold.edge)
      await color(image(input), 0.7, [0, 0, 0, 255])
      await color(image(output), 0.7, [255, 0, 0, 255])
      const dragFeedback = async (control, expected, layers = 1) => {
        await ready()
        const feedbackData = await page.evaluateHandle(() => {
          const dataTransfer = new DataTransfer()
          const setImage = dataTransfer.setDragImage.bind(dataTransfer)
          dataTransfer.setDragImage = (canvas, x, y) => {
            dataTransfer.rendered =
              canvas.isConnected &&
              getComputedStyle(canvas).visibility === "visible" &&
              canvas.getBoundingClientRect().width === canvas.width &&
              canvas.getBoundingClientRect().height === canvas.height
            setImage(canvas, x, y)
            dataTransfer.image = canvas
            dataTransfer.pointer = [x, y]
          }
          return dataTransfer
        })
        await control.dispatchEvent("dragstart", { dataTransfer: feedbackData })
        const feedback = await feedbackData.evaluate((data) => ({
          width: data.image.width,
          height: data.image.height,
          pointer: data.pointer,
          rendered: data.rendered,
          color: Array.from(
            data.image
              .getContext("2d")
              .getImageData(Math.floor(data.image.width / 2), Math.floor(data.image.height * 0.7), 1, 1).data,
          ),
          lowerLeft: data.image.getContext("2d").getImageData(0, data.image.height - 3, 1, 1).data[3],
          lowerRight: data.image.getContext("2d").getImageData(data.image.width - 3, data.image.height - 3, 1, 1)
            .data[3],
          edges: [2, 8, 14].map((y) => {
            const row = data.image.getContext("2d").getImageData(0, y, data.image.width, 1).data
            for (let x = data.image.width - 1; x >= 0; x--) if (row[x * 4 + 3]) return x
          }),
        }))
        assert.ok(feedback.width > 44 && feedback.width <= 120)
        assert.ok(feedback.height > 44 && feedback.height <= 160)
        const offset = (layers - 1) * 6
        assert.ok(Math.abs((feedback.width - offset) / (feedback.height - offset) - 210 / 297) < 0.02)
        assert.equal(feedback.lowerLeft, layers === 1 ? 255 : 0)
        assert.equal(feedback.lowerRight, 255)
        assert.deepEqual(
          feedback.edges.map((edge) => edge - feedback.edges[0]),
          [0, layers > 1 ? 6 : 0, offset],
          "The drag image shows the correct number of stacked sheets",
        )
        assert.deepEqual(feedback.color, expected)
        assert.deepEqual(feedback.pointer, [feedback.width / 2, 12])
        assert.equal(feedback.rendered, true)
        await control.dispatchEvent("dragend", { dataTransfer: feedbackData })
        assert.equal(await page.locator(".composer[data-drag]").count(), 0)
        assert.equal(await page.locator(".drag-image").count(), 0)
        await feedbackData.dispose()
      }
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 3)
      await tab(input, "Grid")
      await ready()
      await dragFeedback(input.getByRole("button", { name: "Select Input page 2", exact: true }), [0, 0, 0, 255], 3)
      await dragFeedback(input.getByRole("button", { name: "Add to Output", exact: true }), [0, 0, 0, 255], 3)
      await tab(input, "Page")
      await tab(output, "Grid")
      await ready()
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 3", exact: true }),
        [255, 0, 0, 255],
      )
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 3)
      await select.fill("2,7")
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 2)
      await select.fill("2")
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255])
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
      await input.getByLabel("Input page actions", { exact: true }).click()
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 2)
      await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
      await select.fill("7,2,2")
      const outputField = output.getByRole("textbox", { name: "Page selection", exact: true })
      const session = await page.context().newCDPSession(page)
      // Keep selection-triggered thumbnail redraws in flight on fast runners.
      await session.send("Emulation.setCPUThrottlingRate", { rate: 6 })
      await outputField.fill("1-3")
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 3", exact: true }),
        [255, 0, 0, 255],
        3,
      )
      await outputField.fill("2-3")
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 3", exact: true }),
        [255, 0, 0, 255],
        2,
      )
      await outputField.fill("")
      await session.send("Emulation.setCPUThrottlingRate", { rate: 1 })
      await session.detach()
      await tab(output, "Page")
      await ready()
      const lensColor = async (pane, expected) => {
        await page.mouse.move(0, 0)
        const bounds = await image(pane).boundingBox()
        await image(pane).hover({ position: { x: bounds.width / 2, y: bounds.height * 0.7 } })
        await page.locator('.lens[aria-busy="false"]').waitFor()
        await color(page.locator(".lens canvas"), 0.5, expected)
        await page.mouse.move(0, 0)
      }
      await lensColor(input, [0, 0, 0, 255])
      await lensColor(output, [255, 0, 0, 255])
      await output.getByRole("button", { name: "Compare page", exact: true }).click()
      await ready()
      await lensColor(output, [0, 0, 0, 255])
      const lensEdge = async (canvas) => {
        await canvas.scrollIntoViewIfNeeded()
        await page.evaluate(() => new Promise(requestAnimationFrame))
        const bounds = await canvas.boundingBox()
        await canvas.hover({ position: { x: bounds.width / 2, y: bounds.height * 0.45 } })
        const lens = page.locator('.lens[aria-busy="false"] canvas')
        await lens.waitFor()
        return lens.evaluate((el) => {
          const pixels = el.getContext("2d").getImageData(Math.floor(el.width / 2), 0, 1, el.height).data
          return Array.from({ length: el.height }, (_, y) => y).find((y) => pixels[y * 4 + 1] < 128)
        })
      }
      for (const [width, height] of [
        [1440, 1100],
        [2560, 1440],
      ]) {
        await page.setViewportSize({ width, height })
        await zoom(output, "Reset zoom")
        await tab(output, "Grid")
        await output.getByRole("button", { name: "Normal Output grid", exact: true }).click()
        await ready()
        const edge = await lensEdge(output.locator(".thumbnail canvas").nth(2))
        assert.ok(edge > 160 && edge < 320)
        await tab(output, "Page")
        await ready()
        const gutters = () =>
          output.locator(".page-scroll").evaluate((el) => {
            const canvas = el.querySelector("canvas").getBoundingClientRect()
            const start = el.getBoundingClientRect().left + el.clientLeft
            return [
              canvas.left - start + el.scrollLeft,
              start + el.clientWidth - canvas.right + el.scrollWidth - el.clientWidth - el.scrollLeft,
            ]
          })
        assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "Page lens uses the Grid thumbnail scale")
        await zoom(output, "Zoom in")
        await ready()
        const first = await gutters()
        assert.ok(
          first[0] >= 18 && Math.abs(first[0] - first[1]) < 1,
          `${width}: 150% zoom keeps balanced image gutters ${first}`,
        )
        assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "150% zoom retains the thumbnail lens scale")
        await zoom(output, "Zoom in")
        await ready()
        const second = await gutters()
        assert.ok(
          second[0] >= 18 && Math.abs(second[0] - second[1]) < 1,
          `${width}: 200% zoom keeps balanced image gutters ${second}`,
        )
        assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "200% zoom retains the thumbnail lens scale")
        const trailingGap = await output.locator(".page-scroll").evaluate((el) => {
          el.scrollLeft = el.scrollWidth - el.clientWidth
          return (
            el.getBoundingClientRect().left +
            el.clientLeft +
            el.clientWidth -
            el.querySelector("canvas").getBoundingClientRect().right
          )
        })
        assert.ok(
          Math.abs(trailingGap - second[0]) < 1,
          `${width}: zoom retains balanced gutters at the scroll end (${trailingGap}, expected ${second[0]})`,
        )
        await tab(output, "Grid")
        await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
        await ready()
        const compactEdge = await lensEdge(output.locator(".page-image canvas").nth(2))
        await tab(output, "Page")
        await ready()
        assert.ok(
          Math.abs((await lensEdge(image(output))) - compactEdge) < 8,
          "Page lens uses the enlarged Compact image scale",
        )
      }
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Normal Output grid", exact: true }).click()
      await tab(output, "Page")
      await ready()
      await output.locator(".page-scroll").evaluate((element) => {
        element.scrollLeft = (element.scrollWidth - element.clientWidth) * 0.3
        element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.6
      })
      await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollTop > 0)
      const viewport = output.locator(".page-scroll")
      const pan = async (pane) => {
        const scroller = pane.locator(".page-scroll")
        await scroller.scrollIntoViewIfNeeded()
        await scroller.evaluate((el) => {
          el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.3
          el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.6
        })
        await page.evaluate(() => new Promise(requestAnimationFrame))
        const element = await scroller.elementHandle()
        const start = await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))
        const box = await scroller.boundingBox()
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2
        await page.mouse.move(x, y)
        await page.mouse.down()
        for (let step = 1; step <= 3; step++) {
          await page.mouse.move(x + step * 10, y + step * 10)
          await page.waitForFunction(
            ({ element: el, start: offset, step: distance }) =>
              Math.abs(el.scrollLeft - offset.x + distance * 10) < 1 &&
              Math.abs(el.scrollTop - offset.y + distance * 10) < 1,
            { element, start, step },
          )
          assert.equal(await scroller.evaluate((el) => getComputedStyle(el).cursor), "grabbing")
        }
        await page.mouse.move(x, box.y - 10)
        await page.waitForFunction(({ element: el, start: offset }) => el.scrollTop > offset.y + 30, {
          element,
          start,
        })
        await page.mouse.up()
        const end = await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))
        await page.mouse.move(x, y)
        assert.deepEqual(await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })), end)
        assert.equal(await scroller.evaluate((el) => getComputedStyle(el).cursor), "grab")
        await page.mouse.down()
        await scroller.evaluate((el) => el.releasePointerCapture(1))
        await page.mouse.move(x + 20, y + 20)
        await page.mouse.up()
        assert.deepEqual(await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })), end)
      }
      await pan(output)
      const region = await viewport.evaluate((element) => ({
        x: element.scrollLeft / (element.scrollWidth - element.clientWidth),
        y: element.scrollTop / (element.scrollHeight - element.clientHeight),
        width: element.querySelector("canvas").width,
      }))
      await page.setViewportSize({ width: 1100, height: 1100 })
      await page.waitForFunction((expected) => {
        const element = document.querySelector(".composition-output .page-scroll")
        return (
          element.querySelector("canvas").width < expected.width &&
          Math.abs(element.scrollLeft / (element.scrollWidth - element.clientWidth) - expected.x) < 0.02 &&
          Math.abs(element.scrollTop / (element.scrollHeight - element.clientHeight) - expected.y) < 0.02
        )
      }, region)
      await page.setViewportSize({ width: 1440, height: 1100 })
      await ready()
      await open(fixture({ grouped: true, fillOnly: true }))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(input, "Style")
      await input.getByLabel("Edit Fill", { exact: true }).click()
      await input.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#0000ff")
      await ready()
      const outputPosition = await pagePosition(output)
      await output.getByRole("button", { name: "Show original page", exact: true }).click()
      await ready()
      assert.equal(await page.locator(".input-current").innerText(), "Filled.pdf")
      assert.match(await pagePosition(input), /2\s*\/ 7/)
      assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "200%")
      assert.equal(await select.inputValue(), "7,2,2")
      assert.equal(await pagePosition(output), outputPosition)
      assert.equal(
        await output.getByRole("button", { name: "Compare page", exact: true }).getAttribute("aria-pressed"),
        "true",
      )
      const regions = await page.locator(".page-scroll").evaluateAll((elements) =>
        elements.map((el) => ({
          x: el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth),
          y: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
        })),
      )
      assert.ok(Math.abs(regions[0].y - regions[1].y) < 0.02, JSON.stringify(regions))
      assert.ok(Math.abs(regions[0].x - regions[1].x) < 0.02, JSON.stringify(regions))
      await pan(input)
      await input.getByRole("button", { name: "Next Input page", exact: true }).click()
      await zoom(output, "Zoom out")
      assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "200%")
      assert.equal(await pagePosition(output), outputPosition)
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await output.getByLabel("Page selection", { exact: true }).fill("3")
      await viewport.press("Control+ArrowRight")
      assert.match(await pagePosition(output), /4\s*\/ 5/)
      await viewport.press("Control+ArrowLeft")
      assert.match(await pagePosition(output), /3\s*\/ 5/)
      await viewport.press("Control+ArrowRight")
      assert.match(await pagePosition(output), /4\s*\/ 5/)
      await viewport.press("Control+ArrowLeft")
      assert.match(await pagePosition(output), /3\s*\/ 5/)
      await viewport.press("Delete")
      assert.match(await pagePosition(output), /3\s*\/ 4/)
      await output.getByRole("button", { name: "Duplicate Output page 3", exact: true }).click()
      assert.equal(await output.locator(".composition-totals strong").textContent(), "5 pages")
      await zoom(input, "Reset zoom")
      await zoom(output, "Reset zoom")
      await input.getByRole("button", { name: "Previous Input page", exact: true }).click()
      await ready()
      for (const pane of [input, output]) {
        const scroller = pane.locator(".page-scroll")
        await scroller.scrollIntoViewIfNeeded()
        const start = await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }))
        const bounds = await scroller.boundingBox()
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
        await page.mouse.down()
        await page.mouse.move(bounds.x + bounds.width / 2 - 30, bounds.y + bounds.height / 2 - 40)
        await page.mouse.up()
        assert.deepEqual(await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })), start)
        assert.equal(await scroller.evaluate((el) => getComputedStyle(el).cursor), "auto")
      }
      const dropBox = await output.locator(".inspection-target").boundingBox()
      await input.locator(".inspection-heading .page-grip").dragTo(output.locator(".inspection-target"), {
        targetPosition: { x: dropBox.width - 2, y: 100 },
      })
      assert.equal(await output.locator(".composition-totals strong").textContent(), "8 pages")
      assert.equal(await select.inputValue(), "")
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
      for (let position = 2; position < 7; position++)
        await input.getByRole("button", { name: "Next Input page", exact: true }).click()
      await ready()
      for (const pane of [input, output]) {
        assert.equal(await aligned(pane), true, "Page controls remain aligned after composition edits")
        assert.equal(await pane.locator(".page-actions button").count(), pane === input ? 1 : 0)
      }
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await readFile(await (await pending).path())
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await open(saved)
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(input, "Style")
      await input.getByLabel("Edit Fill", { exact: true }).click()
      await input.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#00ff00")
      await ready()
      await input.getByRole("button", { name: "Reset all styles", exact: true }).click()
      await tab(input, "Page")
      await ready()
      await color(image(input), 0.7, [255, 0, 0, 255])
      if (
        (await output.getByRole("button", { name: "Compare page", exact: true }).getAttribute("aria-pressed")) ===
        "true"
      ) {
        await output.getByRole("button", { name: "Compare page", exact: true }).click()
        await ready()
      }
      await color(image(output), 0.7, [0, 0, 0, 255])
      await output.getByRole("button", { name: "Compare page", exact: true }).click()
      await ready()
      await color(image(output), 0.7, [255, 0, 0, 255])
      await output.getByLabel("Output page actions", { exact: true }).click()
      await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
      await output.getByRole("button", { name: "Previous Output page", exact: true }).click()
      await tab(output, "Grid")
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 1", exact: true }),
        [255, 255, 255, 255],
      )
      await tab(output, "Page")
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      await viewport.press("Delete")
      assert.equal(
        await viewport.evaluate((element) => element === document.activeElement),
        true,
        "Removing the final pages preserves viewport focus",
      )
      await select.fill(Array(10).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await output.locator(".composition-totals strong").textContent(), "10000 pages")
      const beforeDrop = await pagePosition(output)
      const beforeSelection = await output.getByLabel("Page selection", { exact: true }).inputValue()
      await input.locator(".inspection-heading .page-grip").dispatchEvent("dragstart", {
        dataTransfer: transfer,
      })
      await output
        .getByRole("button", { name: "Next Output page", exact: true })
        .dispatchEvent("dragover", { dataTransfer: transfer })
      await page.waitForFunction(
        () =>
          document.querySelector(".composition-output .inspection-heading .page-current")?.textContent.trim() === "2",
      )
      await output.locator(".inspection-target").dispatchEvent("drop", { dataTransfer: transfer })
      assert.equal(await pagePosition(output), beforeDrop)
      assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), beforeSelection)
      assert.equal(await output.locator(".composition-totals strong").textContent(), "10000 pages")
      assert.match(
        await page.locator(".header-feedback .feedback[data-kind=error]").innerText(),
        /supports up to 10000/,
      )
      assert.equal(await output.locator("[data-drop]").count(), 0)
      await page.setViewportSize({ width: 320, height: 900 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
      await aligned(output)
      assert.equal(
        await output.locator(".inspection-heading").evaluate((element) => {
          const total = element.querySelector(".page-total").getBoundingClientRect()
          const tools = element.querySelector(".page-tools").getBoundingClientRect()
          return total.right <= tools.left && Math.abs(total.top + total.height / 2 - tools.top - tools.height / 2) < 1
        }),
        true,
        "Large page totals share one row with the controls at enlarged text sizes",
      )
      for (let step = 0; step < 4; step++) await zoom(output, "Zoom in")
      await ready()
      const scroller = output.locator(".page-scroll")
      const offset = await scroller.evaluate(
        (element) =>
          new Promise((resolve) => {
            element.addEventListener("scroll", () => resolve({ x: element.scrollLeft, y: element.scrollTop }), {
              once: true,
            })
            element.scrollLeft = (element.scrollWidth - element.clientWidth) * 0.3
            element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.4
          }),
      )
      assert.ok(offset.x > 0 && offset.y > 0)
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }).click()
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
      await page.waitForFunction((expected) => {
        const element = document.querySelector(".composition-output .page-scroll")
        return Math.abs(element.scrollLeft - expected.x) < 1 && Math.abs(element.scrollTop - expected.y) < 1
      }, offset)
      await transfer.dispose()
      assert.deepEqual(errors, [])
    } finally {
      await browser?.close()
    }
  },
)

test("Touch Page swipes navigate only without horizontal overflow", { timeout: 120000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    for (const [width, height, colorScheme] of [
      [390, 844, "dark"],
      [810, 1048, "light"],
      [1080, 778, "dark"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
        colorScheme,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const session = await page.context().newCDPSession(page)
      const send = (type, touchPoints = []) => session.send("Input.dispatchTouchEvent", { type, touchPoints })
      for (const name of ["Input", "Output"]) {
        const tabs = page.locator(".mobile-workspace-tabs")
        if (await tabs.isVisible()) await tabs.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await pane.getByLabel("Page selection", { exact: true }).fill("2,4")
        await tab(pane, "Page")
        await zoom(pane, "Reset zoom")
        const viewport = pane.locator(".page-scroll")
        const jump = async (number) => {
          await pane.getByRole("button", { name: `Go to ${name} page`, exact: true }).click()
          const field = pane.getByRole("textbox", { name: `Go to ${name} page`, exact: true })
          await field.fill(String(number))
          await field.press("Enter")
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        }
        const point = async () => {
          await viewport.scrollIntoViewIfNeeded()
          const frame = await viewport.boundingBox(),
            canvas = await image(pane).boundingBox()
          return {
            x:
              (Math.max(24, frame.x, canvas.x) + Math.min(width - 24, frame.x + frame.width, canvas.x + canvas.width)) /
              2,
            y:
              (Math.max(24, frame.y, canvas.y) +
                Math.min(height - 64, frame.y + frame.height, canvas.y + canvas.height)) /
              2,
            id: 1,
          }
        }
        const swipe = async (x, y = 0) => {
          const start = await point()
          await send("touchStart", [start])
          for (const progress of [0.25, 0.5, 0.75, 1])
            await send("touchMove", [{ ...start, x: start.x + x * progress, y: start.y + y * progress }])
          await send("touchEnd")
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        }
        await jump(2)
        await swipe(-96)
        assert.match(await pagePosition(pane), /^3\s*\//, `${name} ${width}: Swipe left advances`)
        await swipe(96)
        assert.match(await pagePosition(pane), /^2\s*\//, `${name} ${width}: Swipe right goes back`)
        await swipe(-20)
        await swipe(-40, -100)
        assert.match(await pagePosition(pane), /^2\s*\//, "Short and vertical gestures do not navigate")
        if (width === 1080) {
          await zoom(pane, "Zoom in")
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
          assert.ok(await viewport.evaluate((element) => element.scrollWidth <= element.clientWidth + 1))
          await swipe(-96)
          assert.match(await pagePosition(pane), /^3\s*\//, "A zoomed image that still fits horizontally can navigate")
          assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), "150%")
          await swipe(96)
          assert.match(await pagePosition(pane), /^2\s*\//)
          await zoom(pane, "Reset zoom")
        }
        await jump(1)
        await swipe(96)
        assert.match(await pagePosition(pane), /^1\s*\//)
        const last = name === "Input" ? 4 : 8
        await jump(last)
        await swipe(-96)
        assert.match(await pagePosition(pane), new RegExp(`^${last}\\s*\\/`))
        await jump(2)
        for (const interruption of ["touchCancel", "blur", "resize"]) {
          const start = await point()
          await send("touchStart", [start])
          await send("touchMove", [{ ...start, x: start.x - 96 }])
          if (interruption === "touchCancel") await send(interruption)
          else {
            await page.evaluate((type) => window.dispatchEvent(new Event(type)), interruption)
            await send("touchEnd")
          }
          assert.match(await pagePosition(pane), /^2\s*\//, interruption)
        }
        const start = await point()
        await send("touchStart", [start])
        await send("touchMove", [{ ...start, x: start.x - 60 }])
        await send("touchStart", [
          { ...start, x: start.x - 60 },
          { ...start, id: 2, x: start.x + 40 },
        ])
        await send("touchEnd")
        assert.match(await pagePosition(pane), /^2\s*\//, "A second finger cancels page navigation")
        if (width === 810) {
          const held = await point()
          await send("touchStart", [held])
          await page.locator(".lens").waitFor()
          await send("touchMove", [{ ...held, x: held.x - 96 }])
          await send("touchEnd")
          await page.locator(".lens").waitFor({ state: "hidden" })
          assert.match(await pagePosition(pane), /^2\s*\//, "A held lens does not turn into page navigation")
        }
        for (let step = 0; step < 4; step++) await zoom(pane, "Zoom in")
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        assert.ok(await viewport.evaluate((element) => element.scrollWidth > element.clientWidth + 1))
        await viewport.evaluate((element) => (element.scrollLeft = 0))
        await swipe(-96)
        assert.ok(await viewport.evaluate((element) => element.scrollLeft > 0), "Overflowing pages pan natively")
        await viewport.evaluate((element) => (element.scrollLeft = element.scrollWidth))
        await swipe(-96)
        assert.match(await pagePosition(pane), /^2\s*\//, "Panning at an image edge never changes page")
        assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), "2,4")
        assert.equal(await page.locator(".composition-totals strong").textContent(), "8 pages")
      }
      await session.detach()
      await page.close()
    }
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const pane = page.locator(".selection-panel")
    await tab(pane, "Page")
    await zoom(pane, "Reset zoom")
    await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
    const canvas = await image(pane).boundingBox()
    const position = await pagePosition(pane)
    await page.mouse.move(canvas.x + canvas.width / 2, canvas.y + canvas.height / 2)
    await page.mouse.down()
    await page.mouse.move(canvas.x + canvas.width / 2 - 96, canvas.y + canvas.height / 2, { steps: 5 })
    await page.mouse.up()
    assert.equal(await pagePosition(pane), position, "Mouse dragging on a touch-capable device does not navigate")
  } finally {
    await browser.close()
  }
})

test("Page width fitting and horizontal keys preserve composition and focus", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ ignoreDefaultArgs: ["--hide-scrollbars"] })
    try {
      for (const touch of [false, true]) {
        const page = await browser.newPage({
          viewport: touch ? { width: 810, height: 1080 } : { width: 1440, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          reducedMotion: "reduce",
        })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        for (const name of ["Input", "Output"]) {
          const views = page.locator(".mobile-workspace-tabs")
          if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, "Page")
          const selection = pane.getByLabel("Page selection", { exact: true })
          await selection.fill("1,2")
          const prepared = await selection.inputValue()
          const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
          await zoom(pane, "Reset zoom")
          await pane.getByRole("button", { name: "Fit width", exact: true }).click()
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
          assert.ok(Number((await pane.locator(".page-zoom output").textContent()).replace("%", "")) > 100)
          assert.ok(await viewport.evaluate((el) => el.scrollWidth - el.clientWidth <= 1))
          await viewport.press("Home")
          await viewport.press("ArrowRight")
          assert.match(await pagePosition(pane), /2\s*\//)
          await viewport.press("ArrowLeft")
          assert.match(await pagePosition(pane), /1\s*\//)
          await viewport.press("ArrowLeft")
          assert.match(await pagePosition(pane), /1\s*\//, "Navigation stops at the first page")
          await viewport.press("End")
          const last = await pagePosition(pane)
          await viewport.press("ArrowRight")
          assert.equal(await pagePosition(pane), last, "Navigation stops at the last page")
          assert.equal(await viewport.evaluate((el) => el === document.activeElement), true)
          await pane.getByRole("button", { name: "Reset zoom", exact: true }).click()
          assert.equal(await pane.locator(".page-zoom output").textContent(), "100%")
          await viewport.press("0")
          assert.equal(await pane.locator(".page-zoom output").textContent(), "100%", "0 always resets")
          await viewport.press("Home")
          await viewport.press("ArrowRight")
          assert.match(await pagePosition(pane), /2\s*\//, "Fit also supports horizontal page keys")
          while ((await pane.locator(".page-zoom output").textContent()) !== "400%") await zoom(pane, "Zoom in")
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
          assert.ok(await viewport.evaluate((el) => el.scrollWidth > el.clientWidth + 1))
          const position = await pagePosition(pane)
          await viewport.evaluate((el) => (el.scrollLeft = 0))
          await viewport.press("ArrowLeft")
          assert.equal(await pagePosition(pane), position, "A wider image does not navigate at its start edge")
          await viewport.press("ArrowRight")
          assert.ok(await viewport.evaluate((el) => el.scrollLeft > 0), "Horizontal arrows pan a wider image")
          await viewport.evaluate((el) => (el.scrollLeft = el.scrollWidth))
          await viewport.press("ArrowRight")
          assert.equal(await pagePosition(pane), position, "A wider image does not navigate at its end edge")
          await viewport.press("n")
          assert.match(await pagePosition(pane), /3\s*\//, "N still navigates at every zoom")
          await selection.press("ArrowLeft")
          assert.match(await pagePosition(pane), /3\s*\//, "Fields retain their native arrow keys")
          assert.equal(await selection.inputValue(), prepared)
          assert.equal(await page.locator(".composition-totals strong").textContent(), "8 pages")
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Page uses one frame contour for keyboard focus and none for pointer zoom", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    let page, label
    try {
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Input", "Output"]) {
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, "Page")
          const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
          const increase = pane.getByRole("button", { name: "Zoom in", exact: true })
          for (const selected of [false, true]) {
            label = `${engine.name()}, ${colorScheme}, ${name}, selected=${selected}`
            await pane.getByLabel("Page selection", { exact: true }).fill(selected ? "1" : "")
            await increase.click()
            const inspect = () =>
              viewport.evaluate((element) => {
                const frame = element.closest(".page-view")
                const style = getComputedStyle(element)
                const border = getComputedStyle(frame)
                const probe = document.createElement("span")
                frame.append(probe)
                probe.style.color = "var(--secondary)"
                const secondary = getComputedStyle(probe).color
                probe.remove()
                return {
                  focused: document.activeElement === element,
                  outline: style.outlineColor,
                  frame: border.borderColor,
                  secondary,
                  bounds: frame.getBoundingClientRect().toJSON(),
                }
              })
            const pointer = await inspect()
            assert.equal(pointer.focused, true, label)
            assert.equal(pointer.outline, "rgba(0, 0, 0, 0)", `${label}: no internal clipped outline`)
            assert.notEqual(pointer.frame, pointer.secondary, `${label}: pointer zoom does not show keyboard focus`)
            await page.keyboard.press("0")
            await page.keyboard.press("Home")
            await page.keyboard.press("ArrowRight")
            assert.match(await pagePosition(pane), /2\s*\//, label)
            await page.keyboard.press("ArrowLeft")
            const keyboard = await inspect()
            assert.equal(keyboard.focused, true, label)
            assert.equal(keyboard.frame, keyboard.secondary, `${label}: the complete frame owns keyboard focus`)
            assert.equal(keyboard.outline, "rgba(0, 0, 0, 0)", label)
            assert.deepEqual(keyboard.bounds, pointer.bounds, `${label}: focus does not change frame geometry`)
            await increase.click()
            assert.notEqual((await inspect()).frame, keyboard.secondary, `${label}: pointer input clears the contour`)
          }
        }
      }
    } catch (error) {
      if (page) await captureLayout(page, "page-focus", { label, error: error.message })
      throw error
    } finally {
      await browser.close()
    }
  }
})

test(
  "Pointer Page zoom keeps navigation on the document and keyboard controls retain focus",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
          colorScheme: "dark",
          reducedMotion: "reduce",
        })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        for (const name of ["Input", "Output"]) {
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, "Page")
          await zoom(pane, "Reset zoom")
          const increase = pane.getByRole("button", { name: "Zoom in", exact: true })
          await increase.click()
          await pane.getByRole("button", { name: "Reset zoom", exact: true }).click()
          await page.keyboard.press("ArrowRight")
          assert.match(
            await pagePosition(pane),
            /2\s*\//,
            `${engine.name()} ${name}: pointer reset leaves Page navigation ready`,
          )
          await page.keyboard.press("ArrowLeft")
          assert.match(await pagePosition(pane), /1\s*\//)
          assert.equal(
            await pane.locator(".page-tools :focus-visible").count(),
            0,
            "Page arrows do not focus a zoom control",
          )
          assert.equal(
            await pane
              .getByRole("region", { name: "PDF viewport", exact: true })
              .evaluate((element) => element === document.activeElement),
            true,
            "Pointer zoom gives subsequent Page keys to the document",
          )
          await increase.focus()
          await page.keyboard.press("Space")
          assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), "150%")
          assert.equal(
            await increase.evaluate(
              (element) => element === document.activeElement && element.matches(":focus-visible"),
            ),
            true,
            "Keyboard activation preserves the button and its visible focus",
          )
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test("Page double activation toggles anchored zoom and preserves composition", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch({ channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL : undefined })
    try {
      for (const [width, height, hasTouch, colorScheme] of [
        [1440, 1100, false, "light"],
        [810, 1080, true, "dark"],
        [390, 844, true, "light"],
      ]) {
        const page = await browser.newPage({
          viewport: { width, height },
          hasTouch,
          isMobile: hasTouch,
          colorScheme,
          reducedMotion: "reduce",
        })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.locator(".composer[aria-busy=false]").waitFor()
        for (const name of ["Input", "Output"]) {
          const tabs = page.locator(".mobile-workspace-tabs")
          if (await tabs.isVisible()) await tabs.getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await pane.getByLabel("Page selection", { exact: true }).fill("2,4")
          await tab(pane, "Page")
          await zoom(pane, "Reset zoom")
          const canvas = image(pane)
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
          await canvas.scrollIntoViewIfNeeded()
          const before = await canvas.boundingBox()
          const point = { x: before.width * 0.63, y: before.height / 2 }
          const prepared = await pane.getByLabel("Page selection", { exact: true }).inputValue()
          const beforePosition = await pagePosition(pane)
          const total = await page.locator(".composition-totals strong").textContent()
          const activate = async (at) => {
            if (hasTouch) {
              await canvas.tap({ position: at })
              await canvas.tap({ position: at })
            } else await canvas.dblclick({ position: at })
          }
          await activate(point)
          const selector = name === "Input" ? ".selection-panel" : ".composition-output"
          await page.waitForFunction(
            ({ selector: root, width: pixels }) => {
              const element = document.querySelector(`${root} .page-scroll canvas`)
              return (
                Math.abs(element.getBoundingClientRect().width - pixels) < 2 &&
                !element.style.transform &&
                element.parentElement.getAttribute("aria-busy") === "false"
              )
            },
            { selector, width: before.width * 2 },
          )
          assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), "200%")
          const after = await canvas.boundingBox()
          const region = await pane
            .locator(".page-scroll")
            .evaluate((element) => ({ x: element.scrollLeft, max: element.scrollWidth - element.clientWidth }))
          const unscrolled = after.x + region.x
          const expected = Math.max(
            unscrolled - region.max,
            Math.min(unscrolled, before.x + point.x - after.width * 0.63),
          )
          assert.ok(
            Math.abs(after.x - expected) < 2,
            `${engine.name()} ${name} ${width}: Zoom retains the activation point within scroll bounds`,
          )
          await activate()
          await page.waitForFunction(
            ({ selector: root, width: pixels }) => {
              const element = document.querySelector(`${root} .page-scroll canvas`)
              return (
                Math.abs(element.getBoundingClientRect().width - pixels) < 2 &&
                element.parentElement.getAttribute("aria-busy") === "false"
              )
            },
            { selector, width: before.width },
          )
          assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), "100%")
          assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), prepared)
          assert.equal(await pagePosition(pane), beforePosition)
          assert.equal(await page.locator(".composition-totals strong").textContent(), total)
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Repeated Page copies emphasize status without changing focus or geometry", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme, hasTouch, reducedMotion] of [
      [1440, 1100, "light", false, "no-preference"],
      [810, 1080, "dark", true, "no-preference"],
      [390, 844, "light", true, "reduce"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        colorScheme,
        hasTouch,
        isMobile: hasTouch,
        reducedMotion,
      })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composition-totals strong").waitFor({ state: "attached" })
      if (hasTouch)
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).tap()
      const pane = page.locator(".composition-output")
      await tab(pane, "Page")
      await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
      const canvas = image(pane),
        status = page.locator(".status-messages [role=status] .status-message")
      await canvas.scrollIntoViewIfNeeded()
      const before = await canvas.boundingBox()
      let previous = -1,
        message
      for (const count of [9, 10]) {
        await pane.locator(".page-scroll").press("Space")
        assert.equal(await pane.locator(".composition-totals strong").textContent(), `${count} pages`)
        assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), "")
        assert.equal(await pane.locator(".page-scroll").evaluate((element) => element === document.activeElement), true)
        const after = await canvas.boundingBox()
        assert.equal(after.width, before.width)
        assert.equal(after.height, before.height)
        if (message) assert.equal(await status.textContent(), message, "Repeated reports have the same text")
        message = await status.textContent()
        const start = await status.evaluate(async (element) => {
          const animation = element.getAnimations()[0]
          if (!animation) return -1
          await animation.ready
          return animation.startTime ?? -1
        })
        if (reducedMotion === "reduce") assert.equal(start, -1)
        else {
          assert.ok(start > previous, "Status emphasis restarts on a repeated copy")
          assert.equal(
            await status.evaluate(
              (element) =>
                getComputedStyle(element).backgroundColor !== getComputedStyle(element.parentElement).backgroundColor,
            ),
            true,
          )
        }
        const statusBounds = await status.boundingBox(),
          column = await page.locator(".status-messages").boundingBox()
        if (width >= 810) assert.ok(statusBounds.width < column.width - 20, "Emphasis stays around the message")
        previous = start
      }
      await status.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
      assert.equal(
        await status.evaluate(
          (element) =>
            getComputedStyle(element).backgroundColor === getComputedStyle(element.parentElement).backgroundColor,
        ),
        true,
      )
      assert.equal(
        await status.evaluate(
          (element) => getComputedStyle(element).color === getComputedStyle(element.parentElement).color,
        ),
        true,
      )
      assert.equal(await status.textContent(), message, "Emphasis ends without dismissing the report")
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Output Page keeps original PDF labels through composition and Input changes", { timeout: 60000 }, async (t) => {
  const server = await serve()
  await mkdir("../.local/tmp/web/layout/page-labels", { recursive: true })
  let browser, page
  const long = "Appendix-Reference-with-a-very-long-label-99999"
  const instructions = "0.2 w 20 100 400 300 re S\n"
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R /PageLabels << /Nums [0 << /S /r >> 2 << /S /D /St 3 >> 3 << /P (${long}) >>] >> >>`,
    "<< /Type /Pages /Kids [4 0 R 5 0 R 6 0 R 7 0 R] /Count 4 /MediaBox [0 0 595 842] >>",
    `<< /Length ${instructions.length} >>\nstream\n${instructions}endstream`,
    ...Array.from({ length: 4 }, () => "<< /Type /Page /Parent 2 0 R /Contents 3 0 R /Resources <<>> >>"),
  ]
  let pdf = "%PDF-1.7\n"
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Labeled.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selected = output.getByLabel("Page selection", { exact: true })
    const labels = output.locator(".inspection-heading .page-number > .page-context")
    const jump = async (position, label, count = 5) => {
      await output.getByRole("button", { name: "Go to Output page", exact: true }).click()
      const entry = output.getByRole("textbox", { name: "Go to Output page", exact: true })
      await entry.fill(String(position))
      await entry.press("Enter")
      assert.match(await pagePosition(output), new RegExp(`^${position}\\s*/ ${count}$`))
      assert.deepEqual(await labels.allTextContents(), label ? [label] : [])
    }
    await tab(input, "Page")
    assert.equal(await input.locator(".inspection-heading .page-context").innerText(), "i")
    await input.getByLabel("Page selection", { exact: true }).fill("2,1,2,3,4")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    await tab(output, "Page")
    await jump(1, "ii")
    await jump(2, "i")
    await jump(3, "ii")
    await jump(4, "3")
    await jump(5, long)
    assert.equal(await labels.getAttribute("title"), long)
    assert.equal(await labels.isVisible(), true)
    for (const [width, text, font, colorScheme] of [
      [1440, "100%", "", "light"],
      [390, "200%", "", "light"],
      [390, "200%", "DejaVu Sans, sans-serif", "light"],
      [390, "200%", "DejaVu Sans, sans-serif", "dark"],
    ]) {
      t.diagnostic(`Page label: ${width}px, ${text}, ${font || "system font"}, ${colorScheme}`)
      await page.setViewportSize({ width, height: 1000 })
      await page.emulateMedia({ colorScheme })
      await page.evaluate(
        ({ size, family }) => {
          document.documentElement.style.fontSize = size
          document.body.style.fontFamily = family
        },
        { size: text, family: font },
      )
      const views = page.locator(".mobile-workspace-tabs")
      if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
      await page.waitForFunction(
        (label) => {
          const context = document.createElement("canvas").getContext("2d")
          context.font = getComputedStyle(label).font
          const box = label.getBoundingClientRect()
          const heading = label.closest(".inspection-heading")
          const counter = heading.querySelector(".page-number-control").getBoundingClientRect()
          const tools = heading.querySelector(".page-tools").getBoundingClientRect()
          return (
            box.width + 1 >= context.measureText("Appendix…").width &&
            box.left >= counter.right &&
            box.right <= tools.left + 1
          )
        },
        await labels.elementHandle(),
      )
      await aligned(output)
      if ((await output.locator(".page-view").getAttribute("data-controls")) !== "all") {
        await output.getByLabel("Output page actions", { exact: true }).click()
        const menu = output.locator(".output-options")
        assert.equal(await menu.getByRole("button", { name: "Compare page", exact: true }).isVisible(), true)
        assert.equal(await menu.getByRole("button", { name: "Show original page", exact: true }).isEnabled(), true)
        await output.getByLabel("Output page actions", { exact: true }).click()
      }
      await output.locator(".page-view").screenshot({
        path: `../.local/tmp/web/layout/page-labels/${font ? "dejavu" : "system"}-${width}-${colorScheme}.png`,
      })
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "100%"
      document.body.style.fontFamily = ""
    })
    await jump(4, "3")
    await selected.fill("4")
    await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
    assert.match(await pagePosition(output), /^3\s*\/ 5$/)
    assert.deepEqual(await labels.allTextContents(), [], "The counter already shows the identical PDF label")
    await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
    assert.match(await pagePosition(output), /^2\s*\/ 5$/)
    assert.deepEqual(await labels.allTextContents(), ["3"], "A reordered numeric label identifies its original page")
    await selected.fill("1-2")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click()
    await jump(3, "ii", 7)
    await jump(4, "3", 7)
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
    await jump(3, undefined, 8)
    assert.equal(await output.locator(".blank-sheet").isVisible(), true)
    await jump(4, "ii", 8)
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Plain.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
    await input.locator(".input-current").filter({ hasText: "Plain.pdf" }).waitFor()
    assert.deepEqual(await labels.allTextContents(), ["ii"], "Switching Input keeps the inspected occurrence's label")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await jump(4, undefined, 9)
    assert.equal(await output.locator(".blank-sheet").count(), 0, "An ordinary unlabeled page has no invented label")
    await jump(5, "ii", 9)
  } catch (error) {
    if (page) await captureLayout(page, "page-labels", { error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

test("Grid and Page switches preserve selections, zoom, and the inspected page", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Navigation.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 17 }),
      })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    const pageFocused = () => page.evaluate(() => !!document.activeElement?.matches(".page-image, .page-scroll"))
    const modifiedClick = async (thumbnail) => {
      await thumbnail.scrollIntoViewIfNeeded()
      const box = await thumbnail.boundingBox()
      const focusedBefore = await thumbnail.evaluate((element) => element === document.activeElement)
      await page.keyboard.down("ControlOrMeta")
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      assert.equal(
        await thumbnail.evaluate((element) => element === document.activeElement),
        focusedBefore,
        "Modified press preserves existing focus until the view switches",
      )
      await page.mouse.up()
      await page.keyboard.up("ControlOrMeta")
    }
    await prepared.fill("1-17")
    await prepared.press("Enter")
    await selected.fill("2,15")
    await prepared.fill("2,4")
    await input.getByRole("slider", { name: "Input thumbnail range", exact: true }).press("End")
    const inputImage = input.getByRole("button", { name: "Select Input page 16", exact: true })
    await modifiedClick(inputImage)
    await ready()
    assert.match(await pagePosition(input), /16\s*\/ 17/)
    assert.equal(await pageFocused(), false, "Mouse view switching leaves page focus to normal navigation")
    await zoom(input, "Zoom in")
    await ready()
    await image(input).click({ modifiers: ["ControlOrMeta"], position: { x: 100, y: 100 } })
    assert.equal(await inputImage.isVisible(), true, "Grid returns to the inspected thumbnail batch")
    assert.equal(await pageFocused(), false)
    await inputImage.click({ modifiers: ["Meta"] })
    await ready()
    assert.match(await pagePosition(input), /16\s*\/ 17/)
    assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "150%")
    await image(input).click({ modifiers: ["Meta"], position: { x: 100, y: 100 } })
    await inputImage.focus()
    await page.keyboard.down("v")
    await input.getByRole("region", { name: "PDF viewport", exact: true }).waitFor()
    await page.keyboard.down("v")
    await page.keyboard.up("v")
    assert.equal(
      await input.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"),
      "true",
      "Held V switches once",
    )
    await page.keyboard.press("Shift+V")
    assert.equal(await inputImage.evaluate((element) => element === document.activeElement), true)
    await prepared.press("v")
    assert.equal(
      await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"),
      "true",
      "Typing V in a field does not switch views",
    )
    await prepared.fill("2,4")
    const outputGrip = output.getByRole("button", { name: "Select or drag Output page 15", exact: true })
    await outputGrip.tap()
    assert.equal(await selected.inputValue(), "2", "Output grips unselect on touch activation")
    await outputGrip.tap()
    assert.equal(await selected.inputValue(), "2, 15")
    const outputImage = output.getByRole("button", { name: "Select Output page 15", exact: true })
    await modifiedClick(outputImage)
    await ready()
    assert.match(await pagePosition(output), /15\s*\/ 17/)
    assert.equal(await pageFocused(), false)
    await image(output).click({ modifiers: ["ControlOrMeta"] })
    assert.equal(await outputImage.isVisible(), true)
    assert.equal(await pageFocused(), false)
    await outputImage.focus()
    await page.keyboard.press("v")
    await ready()
    assert.match(await pagePosition(output), /15\s*\/ 17/)
    await page.keyboard.press("v")
    assert.equal(await outputImage.evaluate((element) => element === document.activeElement), true)
    assert.equal(await prepared.inputValue(), "2,4")
    assert.equal(await selected.inputValue(), "2, 15")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await outputImage.click()
    await page.keyboard.press("Control+ArrowRight")
    await page.keyboard.press("Control+ArrowRight")
    assert.equal(await pageFocused(), true, "Keyboard movement retains page focus")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await output.getByRole("button", { name: "Remove Output page 17", exact: true }).click()
    assert.equal(await pageFocused(), true, "Mouse removal focuses a surviving thumbnail")
  } finally {
    await browser?.close()
  }
})

test("Grid selection keeps painted pages in place", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, theme, textSize] of [
      [2560, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" })
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:theme", choice)
      }, theme)
      await page.goto(server.resolvedUrls.local[0])
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Selections.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      const prepared = page.locator(".selection-panel").getByLabel("Page selection", { exact: true })
      await prepared.fill("1-7")
      await prepared.press("Enter")
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
            .click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        for (const density of ["Normal", "Compact"]) {
          const field = pane.getByLabel("Page selection", { exact: true })
          await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
          await field.fill("")
          const range = pane.getByRole("slider", { name: `${name} thumbnail range`, exact: true })
          if (await range.count()) await range.press("Home")
          await page.waitForFunction(
            (selector) => {
              const panel = document.querySelector(selector)
              const canvases = [...panel.querySelectorAll(".composition-card canvas")]
              return (
                canvases.length > 0 &&
                canvases.length === panel.querySelectorAll(".composition-card").length &&
                canvases.every((canvas) => canvas.width && canvas.height) &&
                !panel.querySelector("[aria-busy=true]")
              )
            },
            name === "Input" ? ".selection-panel" : ".composition-output",
          )
          const painted = () =>
            pane.locator(".composition-card canvas").evaluateAll((canvases) =>
              canvases.map((canvas) => {
                const card = canvas.closest(".composition-card").getBoundingClientRect()
                const rectangle = canvas.getBoundingClientRect()
                const area = canvas.closest(".thumbnail").getBoundingClientRect()
                return {
                  x: rectangle.x - card.x,
                  y: rectangle.y - card.y,
                  width: rectangle.width,
                  height: rectangle.height,
                  centered: Math.abs(rectangle.top - area.top - (area.bottom - rectangle.bottom)) < 1,
                  pixels: canvas.toDataURL(),
                }
              }),
            )
          await measure(pane)
          const count = await pane.locator(".composition-card").count()
          const footers = pane.locator(".composition-card > .input-footer, .composition-card > .occurrence-actions")
          const footerLines = async () => {
            if (density === "Compact") return
            assert.equal(await footers.count(), count, `${name}: every visible card retains its footer`)
            assert.equal(
              await footers.evaluateAll((elements) =>
                elements.every((element) => {
                  const style = getComputedStyle(element)
                  return parseFloat(style.borderBlockStartWidth) > 0 && element.getBoundingClientRect().height > 0
                }),
              ),
              true,
              `${name}: footer lines and space remain available`,
            )
          }
          const before = await painted()
          assert.ok(
            before.every((item) => item.centered),
            "Images keep equal upper and lower margins",
          )
          await footerLines()
          await pane.evaluate((element) => {
            element.dataset.loading = "false"
            const observer = new MutationObserver((mutations) => {
              if (
                mutations.some((mutation) =>
                  [...mutation.addedNodes].some(
                    (node) =>
                      node instanceof Element &&
                      (node.matches(".render-status") || node.querySelector(".render-status")),
                  ),
                )
              )
                element.dataset.loading = "true"
            })
            observer.observe(element, { childList: true, subtree: true })
          })
          for (const number of [1, count]) {
            await pane.getByRole("button", { name: `Select ${name} page ${number}`, exact: true }).click()
            await page.waitForFunction(
              () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
            )
            const after = await painted()
            await footerLines()
            for (const [index, actual] of after.entries()) {
              const { pixels, ...bounds } = actual
              const { pixels: original, ...expected } = before[index]
              assert.deepEqual(bounds, expected, `${name} ${density} page ${index + 1} keeps its position and size`)
              assert.ok(pixels === original, `${name} page ${index + 1} keeps its painted content`)
            }
          }
          await field.fill("")
          await page.waitForFunction(
            () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
          )
          assert.deepEqual(await painted(), before, `${name} restores controls without moving or repainting pages`)
          await footerLines()
          assert.equal(await pane.getAttribute("data-loading"), "false", "Selection does not flash a loading indicator")
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Unused and modified Grid keys preserve pointer controls and native shortcut priority", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "8 pages")
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    await prepared.fill("")
    for (const [name, pane] of [
      ["Input", input],
      ["Output", output],
    ]) {
      const thumbnail = pane.getByRole("button", { name: `Select ${name} page 1`, exact: true })
      await thumbnail.click()
      await thumbnail.click()
      for (const key of ["Control", "Alt", "Meta", "CapsLock", "x", "Shift"]) {
        await page.keyboard.press(key)
        assert.equal(await thumbnail.evaluate((element) => element === document.activeElement), true)
        assert.equal(await thumbnail.evaluate(hasCursor), false, `${name}: ${key} does not create a page cursor`)
        assert.equal(
          await pane
            .getByRole("button", {
              name: name === "Input" ? "Add Input page 1 to Output" : "Duplicate Output page 1",
              exact: true,
            })
            .isVisible(),
          true,
        )
      }
      await thumbnail.dispatchEvent("keydown", { key: "Dead" })
      await thumbnail.dispatchEvent("keydown", { key: "ArrowRight", isComposing: true })
      for (const key of ["Control+Space", "Control+Enter", "Alt+Space", "Shift+Space", "Shift+Enter"]) {
        await page.keyboard.press(key)
        assert.equal(await thumbnail.evaluate(hasCursor), false, `${name}: ${key} does not create a page cursor`)
        assert.equal(await pane.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
        assert.equal(await thumbnail.evaluate((element) => element === document.activeElement), true)
        assert.equal(await (name === "Input" ? prepared : selected).inputValue(), "")
      }
      await thumbnail.press("ArrowRight")
      await page.keyboard.press("ArrowLeft")
      await page.waitForFunction(() => document.activeElement?.matches(".composition-grid"))
      const scroll = await page.evaluate(() => scrollY)
      await page.keyboard.press("Space")
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await page.evaluate(() => scrollY), scroll, "Space at a Grid boundary does not scroll the workspace")
      assert.equal(await (name === "Input" ? prepared : selected).inputValue(), "")
    }
    await selected.fill("2")
    for (const pane of [input, output]) {
      await pane.getByRole("tab", { name: "Grid", exact: true }).focus()
      await page.keyboard.press("Control+ArrowLeft")
      assert.equal(await selected.inputValue(), "1", "Ctrl+arrows move Output while focus is on a view tab")
      assert.equal(await pane.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      await page.keyboard.press("Control+ArrowRight")
      assert.equal(await selected.inputValue(), "2")
    }
    await tab(output, "Page")
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).focus()
    for (const key of ["+", "=", "-"]) {
      await page.keyboard.press(key)
      assert.equal(
        await output.getByLabel("Output page zoom", { exact: true }).innerText(),
        "100%",
        "Input Grid zoom keys do not change a Page in the other pane",
      )
    }
    await prepared.fill("1")
    const total = await output.locator(".composition-totals strong").textContent()
    await prepared.dispatchEvent("keydown", { key: "Enter", isComposing: true })
    assert.equal(
      await output.locator(".composition-totals strong").textContent(),
      total,
      "IME confirmation does not add prepared pages",
    )
  } finally {
    await browser?.close()
  }
})

test(
  "Page shortcuts follow the mouse side and page counters open a stable inline entry",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Pages.pdf", mimeType: "application/pdf", buffer: fixture() })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const prepared = input.getByLabel("Page selection", { exact: true })
      const selected = output.getByLabel("Page selection", { exact: true })
      await prepared.fill("1-7")
      await prepared.press("Enter")
      await prepared.fill("2,4")
      await selected.fill("3,5")
      await tab(input, "Page")
      await zoom(input, "Reset zoom")
      await tab(output, "Page")
      await zoom(output, "Reset zoom")
      for (const [name, pane, other, x] of [
        ["Input", input, output, 8],
        ["Output", output, input, 1432],
      ]) {
        const viewport = other.getByRole("region", { name: "PDF viewport", exact: true })
        await viewport.focus()
        await page.mouse.move(x, 20)
        for (const [key, value] of [
          ["=", "150%"],
          ["-", "100%"],
          ["Shift+Equal", "150%"],
          ["0", "100%"],
          ["Shift+Equal", "150%"],
          ["Shift+Z", "100%"],
        ]) {
          await page.keyboard.press(key)
          assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), value)
          assert.equal(
            await viewport.evaluate((element) => element === document.activeElement),
            true,
            "Zoom never moves focus",
          )
        }
        for (const [key, number] of [
          ["PageDown", 2],
          ["PageUp", 1],
          ["n", 2],
          ["Shift+P", 1],
          ["End", 7],
          ["PageDown", 7],
          ["Home", 1],
          ["PageUp", 1],
        ]) {
          await page.keyboard.press(key)
          assert.match(await pagePosition(pane), new RegExp(`${number}\\s*\\/ 7`), `${name}: ${key}`)
          assert.equal(
            await viewport.evaluate((element) => element === document.activeElement),
            true,
            "Browsing never moves focus",
          )
        }
        const counter = () => pane.locator(".page-current").boundingBox()
        const total = () => pane.locator(".page-total").boundingBox()
        await aligned(pane)
        const before = [await counter(), await total()]
        await page.keyboard.press(name === "Input" ? "g" : "Shift+G")
        const field = pane.getByRole("textbox", { name: `Go to ${name} page`, exact: true })
        await field.waitFor()
        assert.equal(
          await field.evaluate(
            (element) =>
              element === document.activeElement &&
              element.selectionStart === 0 &&
              element.selectionEnd === element.value.length,
          ),
          true,
        )
        assert.deepEqual([await counter(), await total()], before, "G keeps both parts of the counter in place")
        for (const value of ["", "0", "8", "1.5", "-1", "2x", "9007199254740993"]) {
          await field.fill(value)
          await field.press("Enter")
          assert.equal(await field.getAttribute("aria-invalid"), "true", `Invalid page ${value} stays editable`)
          assert.equal(
            await pane.getByRole("button", { name: `Previous ${name} page`, exact: true }).isDisabled(),
            true,
            "Invalid entry does not navigate",
          )
        }
        await field.press("Escape")
        assert.match(await pagePosition(pane), /1\s*\/ 7/)
        await pane.locator(".page-total").click()
        await field.waitFor()
        assert.deepEqual([await counter(), await total()], before, "Clicking the total keeps the counter in place")
        await field.fill("3")
        await field.press("Enter")
        assert.match(await pagePosition(pane), /3\s*\/ 7/)
        assert.equal(
          await pane
            .getByRole("region", { name: "PDF viewport", exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        )
        assert.equal(await prepared.inputValue(), "2,4")
        assert.equal(await selected.inputValue(), "3,5")
      }
      await tab(input, "Grid")
      await page.evaluate(() => document.activeElement?.blur())
      await page.mouse.move(8, 20)
      await page.keyboard.press("End")
      assert.match(
        await pagePosition(output),
        /7\s*\/ 7/,
        "A closed Page on the pointer side falls back to the other Page",
      )
      await page.keyboard.press("Shift+Equal")
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%")
      const gridPage = input.getByRole("button", { name: "Select Input page 1", exact: true })
      await gridPage.focus()
      await page.keyboard.press("n")
      assert.equal(
        await input
          .getByRole("button", { name: "Select Input page 2", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Conflicting Grid shortcuts keep their target",
      )
      await prepared.focus()
      await prepared.press("Home")
      assert.equal(await prepared.evaluate((element) => element.selectionStart === 0), true, "Fields retain Home")
      await tab(output, "Grid")
      await page.evaluate(() => {
        document.activeElement?.blur()
        scrollTo(0, 0)
      })
      for (const key of ["Shift+Equal", "-", "0", "z", "Home", "End", "g"]) await page.keyboard.press(key)
      assert.equal(
        await page.evaluate(() => document.activeElement === document.body && scrollY === 0),
        true,
        "No Page means no focus or scroll changes",
      )
      assert.equal(await page.locator(".page-jump").count(), 0)
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
        await tab(pane, "Page")
        await pane.getByRole("button", { name: `Go to ${name} page`, exact: true }).scrollIntoViewIfNeeded()
        await aligned(pane)
        const counter = () =>
          pane.locator(".inspection-heading").evaluate((heading) => {
            const origin = heading.getBoundingClientRect()
            return [".page-current", ".page-total", ".page-grip"].map((selector) => {
              const rect = heading.querySelector(selector)?.getBoundingClientRect()
              return rect && { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }
            })
          })
        const before = await counter()
        await pane.getByRole("button", { name: `Go to ${name} page`, exact: true }).click()
        const field = pane.getByRole("textbox", { name: `Go to ${name} page`, exact: true })
        await field.waitFor()
        assert.deepEqual(await counter(), before, "Enlarged mobile text preserves the counter and Input grip")
        const bounds = await field.boundingBox()
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, "The larger entry stays in the pane")
        await field.press("Escape")
        await page.evaluate(() => document.activeElement?.blur())
        await page.mouse.move(name === "Input" ? 382 : 8, 20)
        await page.keyboard.press("Home")
        assert.match(await pagePosition(pane), /1\s*\/ 7/, "Hidden mobile Pages do not take shortcuts")
      }
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Large Sources reuse selected-page PDFs and keep original page identities in Page and Compare",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        window.styleResults = []
        const Original = window.Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (message.changes || message.job) {
              const record = { pages: message.changes?.buffer?.pages, count: undefined }
              window.styleResults.push(record)
              this.addEventListener("message", function done(event) {
                if (event.data.revision === message.revision) {
                  record.count = event.data.description?.pageCount
                  this.removeEventListener("message", done)
                }
              })
            }
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Large.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ count: 51 }),
        })
      await page.locator(".input-current").filter({ hasText: "Large.pdf" }).waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      const color = () =>
        input
          .locator("article.control")
          .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
          .locator("input[type=text]")
      const add = async (selection) => {
        await input.getByRole("tab", { name: "Grid", exact: true }).click()
        await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(selection)
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await output.locator('button[aria-label="Download"]:enabled').waitFor()
      }
      const change = async (value) => {
        await input.getByRole("tab", { name: "Style", exact: true }).click()
        await color().fill(value)
        await output.locator('button[aria-label="Download"]:enabled').waitFor()
      }
      await add("47,3,25,3")
      await change("#123456")
      assert.deepEqual(await page.evaluate(() => window.styleResults), [{ pages: [2, 24, 46], count: 3 }])
      for (const [position, original] of [
        [1, 47],
        [2, 3],
      ]) {
        const details = output.getByLabel(`Details for Output page ${position}`, { exact: true })
        await details.click()
        assert.match(
          await output.locator(".page-origin[open] .page-origin-info").innerText(),
          new RegExp(`Large\\.pdf\\s+p\\. ${original}`),
        )
        await details.click()
      }
      await output.getByRole("tab", { name: "Page", exact: true }).click()
      await output.locator('.page-scroll canvas[aria-label="PDF page 47"]').waitFor()
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor()
      const styled = await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL())
      await output.getByRole("button", { name: "Compare page", exact: true }).click()
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor()
      assert.notEqual(await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL()), styled)
      await output.getByRole("button", { name: "Show original page", exact: true }).click()
      await input.locator('.page-scroll canvas[aria-label="PDF page 47"]').waitFor()
      await input.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor()
      assert.match(await pagePosition(input), /47\s*\/ 51/)
      assert.equal(await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "")
      await input.getByRole("tab", { name: "Grid", exact: true }).click()
      assert.equal(await input.getByRole("button", { name: "Select Input page 47", exact: true }).isVisible(), true)
      await output.getByRole("button", { name: "Compare page", exact: true }).click()
      await change("#654321")
      assert.deepEqual(await page.evaluate(() => window.styleResults.at(-1)), {
        pages: [2, 24, 46],
        count: 3,
      })
      await add("40")
      assert.deepEqual(await page.evaluate(() => window.styleResults.at(-1)), {
        pages: [2, 24, 39, 46],
        count: 4,
      })
      await output.getByRole("button", { name: "Next Output page", exact: true }).click()
      await output.locator('.page-scroll canvas[aria-label="PDF page 3"]').waitFor()
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor()
      assert.match(await pagePosition(output), /2\s*\/ 5/)
      await add("1-13")
      assert.deepEqual(await page.evaluate(() => window.styleResults.at(-1)), {
        pages: undefined,
        count: 51,
      })
      assert.equal(await output.locator(".composition-totals strong").textContent(), "18 pages")

      const sample = await readFile("test/fixtures/demo.pdf")
      const retained = await page.evaluate(async (bytes) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        const original = Uint8Array.from(bytes)
        const changes = { apply: {}, reset: [], buffer: { input: "ordinary-page", pages: [0] } }
        try {
          const first = await processor.run(original, 1, changes)
          const cached = await processor.run(original, 2, changes)
          return {
            first: first.description.pageCount,
            cached: cached.description.pageCount,
            size: cached.bytes.byteLength,
          }
        } finally {
          processor.dispose()
        }
      }, Array.from(sample))
      assert.equal(retained.first, 1)
      assert.equal(retained.cached, 1)
      assert.ok(retained.size > 0)
      assert.deepEqual(errors, [])
    } finally {
      await browser?.close()
    }
  },
)
