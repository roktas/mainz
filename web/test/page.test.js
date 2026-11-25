// Checks Page viewport sizing, pinch zoom, lens opening, touch gestures, and PDF labels.

import { setup, selectPane, outputCount, fixture, tab, pagePosition, image, captureLayout } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { mkdir } from "node:fs/promises"
import { measure } from "./measure.js"
import { chromium } from "playwright"
import { aligned, zoom } from "./workspace.js"

const standard = process.env.MAINZ_TEST_MODE !== "full"

test("Long Page counters keep enlarged text and reachable zoom actions", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    await mkdir("../.local/tmp/web/layout/page-counter", { recursive: true })
    for (const engine of engines) {
      browser = await launch(engine)
      page = await browser.newPage({
        viewport: { width: 1440, height: 900 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.addInitScript(() => {
        localStorage.setItem("mainz:installation", "seen")
      })
      await page.goto(server.resolvedUrls.local[0])
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Counter.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      await page.locator(".input-current").waitFor({ state: "attached" })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByLabel("Page selection", { exact: true }).fill(Array(10).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.setViewportSize({ width: 1440, height: 900 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await tab(output, "Grid")
      await tab(output, "Page")
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
        await selectPane(views.getByRole("button", { name: "Output", exact: true }))
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
        const diagnostic = `${engine.name()}, ${width}, ${text}, ${theme}`
        assert.equal(geometry.separate && geometry.contained, true, diagnostic)
        assert.equal(geometry.font, geometry.expectedFont, `${diagnostic}: counter retains full text size`)
        if (width === 320 && text === "200%") {
          await output.locator('.page-view[data-controls="menu"]').waitFor()
          await output.locator(".page-view").screenshot({
            path: `../.local/tmp/web/layout/page-counter/${engine.name()}-${width}-${text}-${theme}.png`,
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
        }
      }
      await browser.close()
      browser = undefined
    }
  } catch (error) {
    if (page && !page.isClosed()) await captureLayout(page, "page-counter", { error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

test("Page and Grid share viewport bounds and preserve fitted image sizes", { timeout: 90000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await setup(page)
    // Grid tests own scroll geometry; Page needs a populated shared frame.
    await page.route("**/magna.pdf", (route) =>
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
            () =>
              document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
                ?.textContent === "80 pages",
          )
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
              frames: [grid, view].map((element) => element.closest(".page-content").getBoundingClientRect().height),
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
          assert.equal(geometry.rows, before.matrix[1], "Page retains its companion Grid's visible row count")
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
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      await page.waitForFunction(() => document.querySelector(".composition-output .page-view")?.clientHeight < 600)
      assert.ok(
        (await output.locator(".page-view").boundingBox()).height < 600,
        "The hidden mobile Page does not enlarge the visible Page's frame",
      )
      await page.setViewportSize({ width: 1920, height: 1080 })
      await tab(input, "Grid")
      await tab(output, "Grid")
      await output.locator(".grid-view").evaluate((element) => (element.scrollTop = 0))
      await tab(output, "Page")
      await page.setViewportSize({ width: 390, height: 844 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
      await aligned(output)
      const natural = await image(output).boundingBox()
      await tab(output, "Grid")
      await tab(output, "Page")
      await page.waitForFunction(({ width, height }) => {
        const bounds = document.querySelector(".composition-output .page-view canvas")?.getBoundingClientRect()
        return bounds && Math.abs(bounds.width - width) < 1 && Math.abs(bounds.height - height) < 1
      }, natural)
      await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
      const returned = await image(output).boundingBox()
      assert.ok(
        Math.abs(returned.width - natural.width) < 1 && Math.abs(returned.height - natural.height) < 1,
        "Pages changes preserve the fitted PDF at 200% text",
      )
      await page.evaluate(() => (document.documentElement.style.fontSize = ""))
      await page.setViewportSize({ width: 1920, height: 1080 })
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor()
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await tab(input, "Grid")
      const visible = await input.locator(".grid-view").evaluate((element) => {
        const rect = element.getBoundingClientRect()
        return rect.height > 0 && element.scrollWidth <= element.clientWidth + 1
      })
      assert.equal(visible, true, "An empty Output keeps the Input Grid in its fixed frame")
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, colorScheme] of [
      [810, 1080, "light"],
      [390, 844, "dark"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.emulateMedia({ colorScheme })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await outputCount(page).waitFor({ state: "attached" })
      const session = await page.context().newCDPSession(page)
      for (const name of ["Input", "Output"]) {
        await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }), "tap")
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
          assert.equal(await outputCount(page).textContent(), "8 pages")
          const reset = pane.getByRole("button", { name: "Reset zoom", exact: true })
          assert.equal(await reset.innerText(), `${value}%`)
          const gap = await reset.evaluate((button) => {
            const fit = button.querySelector("svg").getBoundingClientRect()
            const percent = button.querySelector(".fit-level").getBoundingClientRect()
            return fit.left - percent.right
          })
          assert.ok(gap >= 10, "The percentage and fit icon have space between them")
          assert.equal(await pane.getByRole("button", { name: "Zoom in", exact: true }).count(), 0)
          await zoom(pane, "Zoom in")
          assert.equal(await pane.locator("output").textContent(), value === 175 ? "200%" : "300%")
          await zoom(pane, "Zoom out")
          assert.equal(await pane.locator("output").textContent(), value === 175 ? "150%" : "200%")
          await reset.tap()
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
          assert.equal(await outputCount(page).textContent(), "8 pages")
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await outputCount(page).waitFor({ state: "attached" })
    await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, theme, textSize] of [
      [1440, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.clock.install({ time: 0 })
      await setup(page)
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:theme", choice)
      }, theme)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      const lens = page.getByRole("region", { name: /^Magnified page / })
      for (const name of ["Input", "Output"]) {
        for (const view of ["Grid", "Page"]) {
          await page.clock.resume()
          if (width === 390)
            await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
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

test("Touch Page swipes navigate only without horizontal overflow", { timeout: 120000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const session = await page.context().newCDPSession(page)
      const send = (type, touchPoints = []) => session.send("Input.dispatchTouchEvent", { type, touchPoints })
      for (const name of ["Input", "Output"]) {
        const tabs = page.locator(".mobile-workspace-tabs")
        await selectPane(tabs.getByRole("button", { name, exact: true }))
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await pane.getByLabel("Page selection", { exact: true }).fill("2,4")
        await tab(pane, "Page")
        await zoom(pane, "Reset zoom")
        const viewport = pane.locator(".page-scroll")
        const jump = async (number) => {
          await pane.getByRole("button", { name: `Go to page in ${name}`, exact: true }).click()
          const field = pane.getByRole("textbox", { name: `${name} page number`, exact: true })
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
        assert.equal(await outputCount(page).textContent(), "8 pages")
      }
      await session.detach()
      await page.close()
    }
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
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

test("Page double activation toggles anchored zoom and preserves composition", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine, { channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL : undefined })
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
        await setup(page)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
        await page.locator(".composer[aria-busy=false]").waitFor()
        for (const name of ["Input", "Output"]) {
          const tabs = page.locator(".mobile-workspace-tabs")
          await selectPane(tabs.getByRole("button", { name, exact: true }))
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
          const total = await outputCount(page).textContent()
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
          assert.equal(await outputCount(page).textContent(), total)
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await outputCount(page).waitFor({ state: "attached" })
      if (hasTouch)
        await selectPane(
          page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }),
          "tap",
        )
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
        assert.equal(await outputCount(page).textContent(), `${count} pages`)
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Labeled.pdf", mimeType: "application/pdf", buffer: Buffer.from(pdf) })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selected = output.getByLabel("Page selection", { exact: true })
    const labels = output.locator(".inspection-heading .counter-label > button")
    const jump = async (position, label, count = 5) => {
      await output.getByRole("button", { name: "Go to page in Output", exact: true }).click()
      const entry = output.getByRole("textbox", { name: "Output page number", exact: true })
      await entry.fill(String(position))
      await entry.press("Enter")
      assert.match(await pagePosition(output), new RegExp(`^${position}\\s*/ ${count}$`))
      assert.deepEqual(await labels.allTextContents(), label ? [label] : [])
    }
    await tab(input, "List")
    assert.deepEqual(await input.locator(".list-pdf-label").allTextContents(), ["i", "ii", long])
    await tab(input, "Page")
    await input.getByRole("button", { name: "Page label: i", exact: true }).press("n")
    await input.getByRole("button", { name: "Page label: ii", exact: true }).press("n")
    await input.locator(".page-scroll:focus").waitFor()
    assert.match(await pagePosition(input), /^3\s*\/ 4$/)
    assert.equal(await input.locator(".inspection-heading .counter-label").count(), 0)
    await input.getByLabel("Page selection", { exact: true }).fill("2,1,2,3,4")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    await tab(output, "List")
    assert.deepEqual(
      (await output.locator(".list-number .page-origin > button").allTextContents()).map((text) => text.trim()),
      ["1", "2", "3", "4", "5"],
    )
    for (const [index, source, label] of [
      [1, 2, "ii"],
      [2, 1, "i"],
      [3, 2, "ii"],
      [4, 3],
      [5, 4, long],
    ]) {
      await output.getByRole("button", { name: `Details for Output page ${index}`, exact: true }).click()
      const details = output.locator(".card-menu-options:popover-open")
      await details.getByRole("row", { name: `Original page ${source}`, exact: true }).waitFor()
      if (label) await details.getByRole("row", { name: `Page Label ${label}`, exact: true }).waitFor()
      await page.keyboard.press("Escape")
    }
    await tab(output, "Page")
    await jump(1, "ii")
    await output.getByRole("button", { name: "Details for Output page 1", exact: true }).click()
    const details = output.locator(".page-origin-info:popover-open")
    await details.getByRole("row", { name: "Original page 2", exact: true }).waitFor()
    await details.getByRole("row", { name: "Page Label ii", exact: true }).waitFor()
    await page.keyboard.press("Escape")
    await labels.click()
    const explanation = output.getByRole("region", { name: "Page label · ii", exact: true })
    assert.match(await explanation.innerText(), /The source PDF supplies this label/)
    assert.equal(await details.isVisible(), false)
    await explanation.getByRole("button", { name: "Close details", exact: true }).click()
    assert.match(await pagePosition(output), /^1\s*\/ 5$/)
    await labels.press("n")
    const nextLabel = output.getByRole("button", { name: "Page label: i", exact: true })
    assert.equal(await nextLabel.evaluate((element) => element === document.activeElement), true)
    assert.match(await pagePosition(output), /^2\s*\/ 5$/)
    await jump(3, "ii")
    await jump(4, "3")
    await jump(5, long)
    assert.match(await labels.getAttribute("title"), /The source PDF supplies this label/)
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
      await selectPane(views.getByRole("button", { name: "Output", exact: true }))
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const labelBounds = await labels.evaluate((element) => {
        const box = element.getBoundingClientRect()
        const frame = element.closest(".page-view")
        const position = frame.querySelector(".page-position")
        const counter = position.querySelector(".page-total").getBoundingClientRect()
        const dot = getComputedStyle(position, "::after")
        const dotEnd = position.getBoundingClientRect().right - parseFloat(dot.marginInlineEnd)
        const labelStart = box.left + parseFloat(getComputedStyle(element).paddingInlineStart)
        const tools = frame.querySelector(".page-tools").getBoundingClientRect()
        return {
          aligned: box.left >= counter.right,
          beforeDot: dotEnd - parseFloat(dot.width) - counter.right,
          afterDot: labelStart - dotEnd,
          separate: box.right <= tools.left + 1,
          label: box.toJSON(),
          tools: tools.toJSON(),
          controls: frame.dataset.controls,
        }
      })
      assert.ok(labelBounds.aligned && labelBounds.separate, JSON.stringify(labelBounds))
      assert.ok(Math.abs(labelBounds.beforeDot - labelBounds.afterDot) < 1, JSON.stringify(labelBounds))
      const navigation = await labels.evaluate((element) => {
        const nav = element.closest(".page-view").querySelector(".page-navigation")
        const actions = nav.querySelector(".page-actions").getBoundingClientRect()
        const previous = nav.querySelector('[data-step="-1"]').getBoundingClientRect()
        const next = nav.querySelector('[data-step="1"]').getBoundingClientRect()
        return {
          previous: actions.left - previous.right,
          next: next.left - actions.right,
        }
      })
      assert.ok(
        navigation.previous >= -1 && Math.abs(navigation.previous - navigation.next) < 1,
        JSON.stringify(navigation),
      )
      await aligned(output)
      if ((await output.locator(".page-view").getAttribute("data-controls")) !== "all") {
        await output.getByLabel("Output page actions", { exact: true }).click()
        assert.equal(await output.getByRole("button", { name: "Compare page", exact: true }).isVisible(), false)
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
    assert.deepEqual(await labels.allTextContents(), ["3"], "The original PDF label remains beside the counter")
    await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
    assert.match(await pagePosition(output), /^2\s*\/ 5$/)
    assert.deepEqual(await labels.allTextContents(), ["3"], "Reordering retains the original PDF label")
    await selected.fill("1-2")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Repeat", exact: true }).click()
    await jump(3, "ii", 7)
    await jump(4, "3", 7)
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Before", exact: true }).click()
    await jump(3, undefined, 8)
    assert.equal(await output.locator(".blank-sheet").isVisible(), true)
    await jump(4, "ii", 8)
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Plain.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
    await input.locator(".input-current").filter({ hasText: "Plain.pdf" }).waitFor({ state: "attached" })
    assert.deepEqual(await labels.allTextContents(), ["ii"], "Switching Input keeps the inspected occurrence's label")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await jump(4, undefined, 9)
    assert.equal(await output.locator(".blank-sheet").count(), 0, "An ordinary unlabeled page has no invented label")
    await jump(5, "ii", 9)
    await labels.press("p")
    assert.match(await pagePosition(output), /^4\s*\/ 9$/)
    await output.locator(".page-scroll:focus").waitFor()
  } catch (error) {
    if (page) await captureLayout(page, "page-labels", { error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})
