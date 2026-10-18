// Checks Page zoom, the lens, copying, and Source identities.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { createServer, tab, pixel, fixture, pagePosition, image } from "./browser.js"

test("Page pinch zoom preserves its anchor and shares the button zoom range", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        const canvas = pane.locator(".page-scroll canvas")
        await canvas.scrollIntoViewIfNeeded()
        const before = await canvas.boundingBox()
        const raster = await canvas.evaluate((element) => element.width)
        const center = { x: before.x + before.width * 0.6, y: Math.min(height - 100, before.y + before.height * 0.55) }
        const anchor = { x: (center.x - before.x) / before.width, y: (center.y - before.y) / before.height }
        const points = (distance) => [
          { x: center.x - distance / 2, y: center.y, id: 1 },
          { x: center.x + distance / 2, y: center.y, id: 2 },
        ]
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(80) })
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(140) })
        const enlarged = await canvas.boundingBox()
        assert.ok(Math.abs(enlarged.width - before.width * 1.75) < 1)
        assert.equal(
          await canvas.evaluate((element) => element.width),
          raster,
          "The live gesture reuses the existing raster",
        )
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
        await page.waitForFunction(
          (label) =>
            [...document.querySelectorAll("output")].some(
              (element) => element.getAttribute("aria-label") === label && element.textContent === "175%",
            ),
          `${name} page zoom`,
        )
        await page.waitForFunction(
          (selector) => {
            const element = document.querySelector(`${selector} .page-scroll canvas`)
            return element && !element.style.transform && element.parentElement.getAttribute("aria-busy") === "false"
          },
          name === "Input" ? ".selection-panel" : ".composition-output",
        )
        const after = await canvas.boundingBox()
        assert.ok(
          Math.abs(after.x + after.width * anchor.x - center.x) < 2,
          "Pinch keeps the horizontal anchor under the fingers",
        )
        assert.ok(
          Math.abs(after.y + after.height * anchor.y - center.y) < 2,
          "Pinch keeps the vertical anchor under the fingers",
        )
        assert.equal(await page.evaluate(() => visualViewport.scale), 1)
        assert.equal(await selection.inputValue(), prepared)
        assert.equal(await page.locator(".composition-totals strong").innerText(), "6 PDF pages")
        await zoom(pane, "Zoom in")
        assert.equal(await pane.locator("output").textContent(), "200%")
        await zoom(pane, "Zoom out")
        assert.equal(await pane.locator("output").textContent(), "150%")
        await zoom(pane, "Fit page")
        assert.equal(await pane.locator("output").textContent(), "100%")
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
            [80, 480, "400%"],
            [400, 40, "50%"],
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
          assert.equal(await page.locator(".composition-totals strong").innerText(), "6 PDF pages")
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

test("The lens waits for a settled mouse and cancels pending openings", { timeout: 60000 }, async () => {
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
              !document.querySelector('.output-status[aria-hidden="false"]'),
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
    await server.close()
  }
})

test(
  "Grid and Page share edits while inspection, original appearance, and Sources stay independent",
  { timeout: 120000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
            !document.querySelector('.output-status[aria-hidden="false"]'),
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
      await open(fixture(true, false, 0, true, true))
      await select.fill("7,2,2")
      await tab(input, "Page")
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "1 PDF page")
      await tab(input, "Page")
      await select.fill("7,2,2")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await output.locator(".composition-totals strong").innerText(), "4 PDF pages")
      assert.equal(await select.inputValue(), "")
      await select.fill("7,2,2")
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
      await tab(output, "Page")
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
        await canvas.hover({ position: { x: bounds.width / 2, y: bounds.height * 0.485 } })
        const lens = page.locator('.lens[aria-busy="false"] canvas')
        await lens.waitFor()
        return lens.evaluate((el) => {
          const pixels = el.getContext("2d").getImageData(Math.floor(el.width / 2), 0, 1, el.height).data
          return Array.from({ length: el.height }, (_, y) => y).find((y) => pixels[y * 4 + 1] < 128)
        })
      }
      await tab(output, "Grid")
      await ready()
      const edge = await lensEdge(output.locator(".thumbnail canvas").nth(2))
      assert.ok(edge > 160 && edge < 240)
      await tab(output, "Page")
      await ready()
      const sideGap = () =>
        output.locator(".page-scroll").evaluate((el) => {
          const canvas = el.querySelector("canvas").getBoundingClientRect()
          return canvas.left - el.getBoundingClientRect().left + el.scrollLeft
        })
      const fittedGap = await sideGap()
      assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "Page lens uses the Grid thumbnail scale")
      await zoom(output, "Zoom in")
      await ready()
      assert.ok(Math.abs((await sideGap()) - fittedGap) < 1, "150% zoom retains the fitted side gap")
      assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "150% zoom retains the thumbnail lens scale")
      await zoom(output, "Zoom in")
      await ready()
      assert.ok(Math.abs((await sideGap()) - fittedGap) < 1, "200% zoom retains the fitted side gap")
      assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "200% zoom retains the thumbnail lens scale")
      const trailingGap = await output.locator(".page-scroll").evaluate((el) => {
        el.scrollLeft = el.scrollWidth - el.clientWidth
        return el.getBoundingClientRect().right - el.querySelector("canvas").getBoundingClientRect().right
      })
      assert.ok(Math.abs(trailingGap - fittedGap) < 1, "Zoom retains the trailing side gap")
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
      await open(fixture(true, false, 0, true, true))
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages")
      await zoom(input, "Fit page")
      await zoom(output, "Fit page")
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "8 PDF pages")
      assert.equal(await select.inputValue(), "")
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
      for (let position = 2; position < 7; position++)
        await input.getByRole("button", { name: "Next Input page", exact: true }).click()
      await ready()
      for (const theme of ["light", "dark"])
        for (const width of [320, 390, 768, 1440])
          for (const text of [100, 200]) {
            await page.setViewportSize({ width, height: 1000 })
            await page.evaluate(
              ({ theme: selectedTheme, text: scale }) => {
                document.documentElement.dataset.theme = selectedTheme
                document.documentElement.style.fontSize = `${scale}%`
              },
              { theme, text },
            )
            const views = page.locator(".mobile-workspace-tabs")
            for (const [name, pane] of [
              ["Output", output],
              ["Input", input],
            ]) {
              if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
              assert.equal(await pane.locator(".sequence-entry").isVisible(), true)
              assert.equal(
                await pane.getByRole("navigation", { name: `${name} page navigation`, exact: true }).isVisible(),
                true,
              )
              assert.equal(await pane.locator(".page-actions button").count(), name === "Input" ? 1 : 0)
              assert.equal(await aligned(pane), true, `${name} controls align: ${theme}, ${width}px, ${text}% text`)
              await page.waitForFunction(
                (element) => {
                  const area = element.getBoundingClientRect()
                  const sheet = element.querySelector("canvas").getBoundingClientRect()
                  const before = sheet.y - area.y,
                    after = area.bottom - sheet.bottom
                  return before >= 18 && Math.abs(before - after) < 1
                },
                await pane.locator(".pdf-viewport").elementHandle(),
              )
              assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                `${name}: ${theme}, ${width}px, ${text}% text`,
              )
            }
          }
      await page.setViewportSize({ width: 1440, height: 1100 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await readFile(await (await pending).path())
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await open(saved)
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(input, "Style")
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "10000 PDF pages")
      const beforeDrop = await pagePosition(output)
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "10000 PDF pages")
      assert.match(await page.locator(".error-banner").innerText(), /supports up to 10000/)
      assert.equal(await output.locator("[data-drop]").count(), 0)
      await page.setViewportSize({ width: 320, height: 900 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
      assert.equal(
        await output.locator(".inspection-heading").evaluate((element) => {
          const total = element.querySelector(".page-total").getBoundingClientRect()
          const tools = element.querySelector(".page-tools").getBoundingClientRect()
          return total.right <= tools.left || total.bottom <= tools.top
        }),
        true,
        "Large page totals leave the controls clear with enlarged text",
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
      await server.close()
    }
  },
)

test("Page image activation repeats current-page copies and preserves selections", { timeout: 60000 }, async () => {
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
      .setInputFiles({ name: "Pages.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByLabel("Page selection", { exact: true })
    const selected = output.getByLabel("Page selection", { exact: true })
    const options = input.getByLabel("Input page actions", { exact: true })
    const total = () => output.locator(".composition-totals strong").innerText()
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    const pageFocused = () => page.evaluate(() => !!document.activeElement?.matches(".page-image, .page-scroll"))
    await prepared.fill("4,2,2")
    await options.click()
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
    await input.getByLabel("Start each repeat on front", { exact: true }).check()
    await options.click()
    const thumbnail = input.getByRole("button", { name: "Select Input page 2", exact: true })
    await thumbnail.click()
    assert.equal(await prepared.inputValue(), "4", "A click toggles all repeated occurrences of the physical page")
    assert.equal(await pageFocused(), true, "Mouse selection permits immediate keyboard use")
    assert.equal(await total(), "0 PDF pages")
    await prepared.fill("4,2,2")
    await thumbnail.dblclick()
    assert.equal(await total(), "8 PDF pages", "Grid addition uses the exact prepared order, copies, and alignment")
    assert.equal(await prepared.inputValue(), "")
    assert.equal(await selected.inputValue(), "1-8")
    assert.equal(await pageFocused(), true)
    await ready()
    await tab(input, "Page")
    await ready()
    assert.match(await pagePosition(input), /2\s*\/ 7/)
    await image(input).click()
    assert.equal(await total(), "8 PDF pages", "A single Page click only focuses the image")
    await image(input).dblclick()
    assert.equal(await total(), "9 PDF pages", "Without a preparation, addition uses the current page")
    assert.equal(await pageFocused(), true)
    await prepared.fill("1,3")
    await image(input).dblclick()
    assert.equal(await total(), "10 PDF pages", "Page adds only the inspected page while preserving the preparation")
    assert.equal(await prepared.inputValue(), "1,3")
    assert.equal(await selected.inputValue(), "1-8")
    await input.getByRole("region", { name: "PDF viewport", exact: true }).dblclick({ position: { x: 2, y: 2 } })
    assert.equal(await total(), "10 PDF pages", "Viewport gutters do not add pages")
    await zoom(input, "Zoom in")
    await ready()
    await image(input).dblclick({ position: { x: 100, y: 100 } })
    assert.equal(await total(), "11 PDF pages", "Double-click works while the enlarged page supports panning")
    assert.equal(await pageFocused(), true)
    await ready()
    await tab(output, "Page")
    await selected.fill("1,3")
    await ready()
    await image(output).dblclick()
    assert.equal(await total(), "12 PDF pages", "A selection does not block copying the inspected page")
    await image(output).dblclick()
    assert.equal(await total(), "13 PDF pages", "A second double-click creates another copy")
    await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Space")
    assert.equal(await total(), "14 PDF pages", "Space uses the same current-page operation")
    assert.equal(await selected.inputValue(), "1, 6", "Inserted copies preserve the originally selected occurrences")
    assert.equal(
      await output.locator(".page-actions button").count(),
      0,
      "Selection temporarily removes individual Page actions",
    )
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    assert.equal(await total(), "16 PDF pages")
    assert.equal(await selected.inputValue(), "7-8", "The selection bar still selects the complete new group")
    assert.equal(
      await output
        .getByRole("button", { name: "Duplicate selected Output pages", exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
      "Group duplication retains focus in the selection actions",
    )
    assert.match(await pagePosition(output), /1\s*\/ 16/, "Page duplication retains the inspected occurrence")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    for (let index = 0; index < 16; index++)
      await output.getByRole("button", { name: "Next Output page", exact: true }).click()
    await output.locator(".blank-sheet span").dblclick()
    assert.equal(await total(), "18 PDF pages", "Blank images support the same duplication action")
    assert.equal(await selected.inputValue(), "")
    assert.equal(await pageFocused(), true)
    await output.getByRole("button", { name: "Select all", exact: true }).click()
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await output.getByRole("region", { name: "PDF viewport", exact: true }).dblclick()
    assert.equal(await total(), "0 PDF pages", "An empty viewport cannot add a page")
    await output.getByRole("region", { name: "PDF viewport", exact: true }).focus()
    await page.keyboard.press("v")
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      "An empty Page returns focus to its Grid tab",
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Repeated Page copies emphasize the image and status without changing focus or geometry",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
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
        let previous = [-1, -1],
          message
        for (const count of [7, 8]) {
          if (hasTouch) {
            await canvas.tap()
            await canvas.tap()
          } else await canvas.dblclick()
          assert.equal(await pane.locator(".composition-totals strong").innerText(), `${count} PDF pages`)
          assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), "")
          assert.equal(
            await pane.locator(".page-scroll").evaluate((element) => element === document.activeElement),
            true,
          )
          const after = await canvas.boundingBox()
          assert.equal(after.width, before.width)
          assert.equal(after.height, before.height)
          if (message) assert.equal(await status.textContent(), message, "Repeated reports have the same text")
          message = await status.textContent()
          const starts = await Promise.all(
            [canvas, status].map((locator) =>
              locator.evaluate(async (element) => {
                const animation = element.getAnimations()[0]
                if (!animation) return -1
                await animation.ready
                return animation.startTime ?? -1
              }),
            ),
          )
          if (reducedMotion === "reduce") assert.deepEqual(starts, [-1, -1])
          else {
            starts.forEach((start, index) =>
              assert.ok(start > previous[index], "Both effects restart on a repeated copy"),
            )
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
          previous = starts
          if (count === 7) await page.waitForTimeout(400)
        }
        await Promise.all(
          [canvas, status].map((locator) =>
            locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished))),
          ),
        )
        assert.equal(await canvas.evaluate((element) => getComputedStyle(element).filter), "none")
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
      await server.close()
    }
  },
)

test(
  "Large Sources reuse selected-page PDFs and keep original page identities in Page and Compare",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
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
            if (message.changes) {
              const record = { pages: message.changes.buffer?.pages, count: undefined }
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
          buffer: fixture(true, false, 0, false, false, {}, 51),
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
        await output.getByRole("button", { name: "Download", exact: true }).waitFor()
      }
      const change = async (value) => {
        await input.getByRole("tab", { name: "Style", exact: true }).click()
        await color().fill(value)
        await output.getByRole("button", { name: "Download", exact: true }).waitFor()
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
      assert.equal(await output.locator(".composition-totals strong").innerText(), "18 PDF pages")

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
      await server.close()
    }
  },
)
