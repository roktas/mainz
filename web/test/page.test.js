// Checks Page navigation, frames, controls, and shared Grid state.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { createServer, tab, fixture, hasCursor, pagePosition, image } from "./browser.js"

test("Page controls retain space and alignment with wide fonts and enlarged mobile text", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const output = page.locator(".composition-output")
    await tab(output, "Page")
    for (const font of ["DejaVu Sans", "ui-sans-serif"]) {
      for (const [width, text] of [
        [1440, "100%"],
        [320, "200%"],
        [375, "200%"],
      ]) {
        await page.setViewportSize({ width, height: 1100 })
        await page.evaluate(
          ({ font: family, text: scale }) => {
            document.body.style.fontFamily = family
            document.documentElement.style.fontSize = scale
          },
          { font, text },
        )
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
        assert.equal(
          await aligned(output),
          true,
          `${font}, ${width}px, ${text}: controls align and leave room for the grip`,
        )
        const tools = await output.getByRole("group", { name: "Output Page controls", exact: true }).boundingBox()
        assert.ok(tools.x >= 0 && tools.x + tools.width <= width, `${font}, ${width}px, ${text}: all tools fit`)
        const frame = await output.locator(".inspection-heading").boundingBox()
        assert.ok(
          tools.x >= frame.x && tools.x + tools.width <= frame.x + frame.width,
          `${font}, ${width}px, ${text}: the page frame does not clip tools`,
        )
        const percentage = await output.getByLabel("Output page zoom", { exact: true }).boundingBox()
        assert.ok(
          percentage.x >= frame.x &&
            percentage.x + percentage.width <= frame.x + frame.width &&
            percentage.y >= frame.y &&
            percentage.y + percentage.height <= frame.y + frame.height,
          `${font}, ${width}px, ${text}: the percentage remains inside the page heading`,
        )
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Arrows enter Grid without selection and Page keys change thumbnail groups", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [density, width, theme, textSize] of [
      ["Normal", 2560, "light", "100%"],
      ["Compact", 2560, "dark", "100%"],
      ["Normal", 390, "light", "200%"],
      ["Compact", 390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 1440 },
        reducedMotion: width === 390 ? "reduce" : "no-preference",
        colorScheme: theme,
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        )
        const field = pane.getByLabel("Page selection", { exact: true })
        const batch = Number(await pane.locator(".grid-view").getAttribute("data-batch"))
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
        await page.keyboard.press("PageDown")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${batch + 1}`,
        )
        assert.equal(await field.inputValue(), "2", "Changing groups retains Selection")
        await page.keyboard.press("PageUp")
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
        if (name === "Input" && width === 2560) {
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
          `Select ${name} page 240`,
        )
        await page.keyboard.press("PageDown")
        assert.equal(await field.inputValue(), "2")
        assert.equal(await page.locator(".composition-totals strong").innerText(), "240 PDF pages")
        await field.fill("")
        await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } })
        await page.keyboard.press("ArrowLeft")
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 240`,
        )
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Page bounds the shared frame by fitted geometry and Grid fills complete rows", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const [width, height, rows, capacity, fittedHeight] of [
        [1920, 1080, 6, 36, 718.44],
        [2240, 1260, 6, 42, 757.84],
        [2560, 1440, 7, 56, 860],
        [3840, 2160, 7, 84, 1290],
      ]) {
        await page.setViewportSize({ width, height })
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
        )
        await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
        await page.waitForFunction(
          (batch) => document.querySelector(".selection-panel .grid-view")?.dataset.batch === String(batch),
          capacity,
        )
        await tab(output, "Page")
        await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
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
        assert.equal(geometry.rows, rows)
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
        assert.ok(Math.abs(geometry.image[1] - fittedHeight) < 1, "The frame cap preserves the width-fitted PDF size")
        if (width === 2560)
          assert.ok(Math.abs(geometry.frames[0] - 1056) < 1, "QHD reserves room for the enlarged Page")
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 })
    const viewport = output.getByRole("region", { name: "PDF viewport", exact: true })
    const fittedFrame = await output.locator(".page-view").boundingBox()
    await zoom(output, "Zoom in")
    assert.equal(
      (await output.locator(".page-view").boundingBox()).height,
      fittedFrame.height,
      "Page zoom keeps the shared frame height",
    )
    await zoom(output, "Fit page")
    await viewport.focus()
    await page.keyboard.press("End")
    await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
    await page.waitForFunction(() => {
      const sheet = document.querySelector(".page-view canvas")
      return sheet && sheet.clientWidth > sheet.clientHeight
    })
    const landscape = await output.locator(".page-view").boundingBox()
    assert.ok(landscape.height < fittedFrame.height, "A landscape Page needs less height than a portrait Page")
    await tab(input, "Page")
    await input.locator(".pdf-viewport[aria-busy=false]").waitFor()
    const heights = await page
      .locator(".page-view")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
    assert.equal(heights[0], heights[1], "Two Pages share the height needed by the taller fitted page")
    assert.ok(heights[0] > landscape.height)
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
    await page.waitForFunction(
      () => document.querySelector(".composition-output .page-view canvas")?.clientWidth === 261,
    )
    await output.locator(".pdf-viewport[aria-busy=false]").waitFor()
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
      "The cap includes the full heading at 200% text without shrinking the PDF",
    )
    await page.evaluate(() => (document.documentElement.style.fontSize = ""))
    await page.setViewportSize({ width: 1920, height: 1080 })
    await output.getByRole("button", { name: "Select all", exact: true }).click()
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor()
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
    await page.waitForFunction(() => document.querySelector(".selection-panel .grid-view")?.dataset.batch === "36")
    assert.equal(
      await input.locator(".grid-view").getAttribute("data-rows"),
      "6",
      "An empty Output Page leaves Input's fitted geometry in control",
    )
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Page fit preserves screen size across expanded desktop viewports", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    const session = await page.context().newCDPSession(page)
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    const fitted = async (locator) => {
      const [bounds, factor] = await Promise.all([locator.boundingBox(), page.evaluate(() => devicePixelRatio)])
      assert.ok(Math.abs(bounds.width * factor - 608.07) < 1, "Page keeps its fitted screen width")
      assert.ok(Math.abs(bounds.height * factor - 860) < 1, "Page keeps its fitted screen height")
    }
    for (const factor of [1, 0.8, 0.67]) {
      const viewport = { width: Math.round(2560 / factor), height: Math.round(1440 / factor) }
      await page.setViewportSize(viewport)
      await session.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: factor,
        mobile: false,
      })
      await page.emulateMedia({ colorScheme: factor === 0.8 ? "dark" : "light" })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&input=page`)
      await input.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(input))
      if (factor < 1)
        await page.waitForFunction(() => document.querySelectorAll(".composition-output .composition-card").length > 12)
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".composition-output .thumbnail")].every(
          (element) => element.getAttribute("aria-busy") === "false",
        ),
      )
      const thumbnail = await output.locator(".page-image canvas").first().boundingBox()
      assert.ok(
        Math.abs(thumbnail.height - (factor === 1 ? 144 : 168)) < 1,
        "Grid thumbnails follow their viewport range at each browser zoom",
      )
      await tab(output, "Page")
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(output))
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-output .grid-view")?.getAttribute("data-rows") === "7",
      )
      await input.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(input))
      const surround = await input.locator(".page-scroll").boundingBox()
      const sheet = await image(input).boundingBox()
      const margins = [sheet.y - surround.y, surround.y + surround.height - sheet.y - sheet.height]
      assert.ok(Math.abs(margins[0] - margins[1]) < 1, "Page stays centered at every browser zoom")
      if (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight))
        assert.ok(
          margins.every((margin) => margin * factor < 90),
          "Seven Compact rows retain balanced fitted margins when the workspace exceeds the viewport height",
        )
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await input.locator(".inspection-heading .page-grip").dispatchEvent("dragstart", { dataTransfer: transfer })
      const first = output.locator(".composition-card").first(),
        destination = await first.boundingBox()
      await first.dispatchEvent("dragover", {
        dataTransfer: transfer,
        clientX: destination.x + destination.width / 4,
        clientY: destination.y + destination.height / 2,
      })
      await output.locator(".drop-placeholder").waitFor()
      assert.equal(
        await output.locator("[data-preview-hidden]").count(),
        1,
        "The drag preview stays within seven Compact rows at every browser zoom",
      )
      await page.keyboard.press("Escape")
      await transfer.dispose()
      await tab(output, "Page")
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(output))
      await output.getByLabel("Page selection", { exact: true }).fill("1")
      await output.locator(".output-options > summary").click()
      await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
      await page.keyboard.press("Escape")
      await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Home")
      await output.locator(".blank-sheet").waitFor()
      await fitted(output.locator(".blank-sheet"))
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Grid and Page switches preserve selections, zoom, and the inspected page", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
        buffer: fixture(false, false, 0, false, false, {}, 17),
      })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    const pageFocused = () => page.evaluate(() => !!document.activeElement?.matches(".page-image, .page-scroll"))
    const ctrlClick = async (thumbnail) => {
      await thumbnail.scrollIntoViewIfNeeded()
      const box = await thumbnail.boundingBox()
      const focusedBefore = await thumbnail.evaluate((element) => element === document.activeElement)
      await page.keyboard.down("Control")
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      assert.equal(
        await thumbnail.evaluate((element) => element === document.activeElement),
        focusedBefore,
        "Ctrl-press preserves existing focus until the view switches",
      )
      await page.mouse.up()
      await page.keyboard.up("Control")
    }
    await prepared.fill("1-17")
    await prepared.press("Enter")
    await selected.fill("2,15")
    await prepared.fill("2,4")
    await input.getByRole("slider", { name: "Input thumbnail range", exact: true }).press("End")
    const inputImage = input.getByRole("button", { name: "Select Input page 16", exact: true })
    await ctrlClick(inputImage)
    await ready()
    assert.match(await pagePosition(input), /16\s*\/ 17/)
    assert.equal(await pageFocused(), false, "Mouse view switching leaves page focus to normal navigation")
    await zoom(input, "Zoom in")
    await ready()
    await image(input).click({ modifiers: ["Control"], position: { x: 100, y: 100 } })
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
    await ctrlClick(outputImage)
    await ready()
    assert.match(await pagePosition(output), /15\s*\/ 17/)
    assert.equal(await pageFocused(), false)
    await image(output).click({ modifiers: ["Control"] })
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
    await server.close()
  }
})

test("Grid selection keeps painted pages in place", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
        const field = pane.getByLabel("Page selection", { exact: true })
        await field.fill("")
        await page.waitForFunction(
          (selector) => {
            const panel = document.querySelector(selector)
            const canvases = [...panel.querySelectorAll(".composition-card canvas")]
            return (
              canvases.length === 7 &&
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
              return {
                x: rectangle.x - card.x,
                y: rectangle.y - card.y,
                width: rectangle.width,
                height: rectangle.height,
                pixels: canvas.toDataURL(),
              }
            }),
          )
        const footers = pane.locator(".composition-card > .input-footer, .composition-card > .occurrence-actions")
        const footerLines = async () => {
          assert.equal(await footers.count(), 7, `${name}: every card retains its footer`)
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
        await footerLines()
        await pane.evaluate((element) => {
          element.dataset.loading = "false"
          const observer = new MutationObserver((mutations) => {
            if (
              mutations.some((mutation) =>
                [...mutation.addedNodes].some(
                  (node) =>
                    node instanceof Element && (node.matches(".render-status") || node.querySelector(".render-status")),
                ),
              )
            )
              element.dataset.loading = "true"
          })
          observer.observe(element, { childList: true, subtree: true })
        })
        for (const number of [1, 7]) {
          await pane.getByRole("button", { name: `Select ${name} page ${number}`, exact: true }).click()
          await page.waitForFunction(
            () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
          )
          const after = await painted()
          await footerLines()
          for (const [index, actual] of after.entries()) {
            const { pixels, ...bounds } = actual
            const { pixels: original, ...expected } = before[index]
            assert.deepEqual(bounds, expected, `${name} page ${index + 1} keeps its position and size`)
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
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Unused and modified Grid keys preserve pointer controls and native shortcut priority", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    )
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
    const total = await output.locator(".composition-totals strong").innerText()
    await prepared.dispatchEvent("keydown", { key: "Enter", isComposing: true })
    assert.equal(
      await output.locator(".composition-totals strong").innerText(),
      total,
      "IME confirmation does not add prepared pages",
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Page shortcuts follow the mouse side and page counters open a stable inline entry",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
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
      await tab(output, "Page")
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
      await server.close()
    }
  },
)
