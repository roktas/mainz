// Checks Grid/List/Page switching, keyboard navigation, focus contours, and large-source inspection.

import {
  setup,
  selectPane,
  outputCount,
  fixture,
  hasCursor,
  tab,
  gridPage,
  pagePosition,
  image,
  pixel,
  captureLayout,
} from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { readFile } from "node:fs/promises"
import { measure } from "./measure.js"
import { chromium } from "playwright"
import { aligned, zoom } from "./workspace.js"

test("Grid and List paging and view shortcuts preserve selection", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "60 pages",
    )
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const name of ["Input", "Output"]) {
        const tabs = page.locator(".mobile-workspace-tabs")
        await selectPane(tabs.getByRole("button", { name, exact: true }))
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        await tab(pane, "Grid")
        const grid = pane.locator(".grid-view")
        const dimensions = await grid.evaluate((element) => ({
          columns: Number(element.dataset.columns),
          rows: Number(element.dataset.rows),
        }))
        const first = grid.locator('.page-image[data-page="0"]')
        await first.focus()
        await page.keyboard.press("PageDown")
        const expected = Math.min(59, dimensions.columns * dimensions.rows)
        await grid.locator(`.page-image[data-page="${expected}"]`).waitFor()
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), String(expected))
        await page.keyboard.press("PageUp")
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "0")
        await page.keyboard.press("End")
        await grid.locator('.page-image[data-page="59"]').waitFor()
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "59")
        await page.keyboard.press("Home")
        await grid.locator('.page-image[data-page="0"]').waitFor()
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "0")
        assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), "")
        await page.evaluate(() => document.activeElement?.blur())
        await page.keyboard.press("End")
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "59")
        await page.evaluate(() => document.activeElement?.blur())
        await page.keyboard.press("Home")
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "0")

        await page.keyboard.press("Alt+2")
        const list = pane.locator(".page-list")
        await list.waitFor()
        assert.equal(await pane.locator(":focus-visible").count(), 0)
        await pane.getByRole("tab", { name: "List", exact: true }).focus()
        await page.keyboard.press("PageDown")
        assert.ok(Number(await page.evaluate(() => document.activeElement?.getAttribute("data-page"))) > 0)
        await pane.getByRole("tab", { name: "List", exact: true }).focus()
        await page.keyboard.press("PageUp")
        assert.equal(await page.evaluate(() => document.activeElement?.getAttribute("data-page")), "0")
        await page.keyboard.press("Alt+3")
        await pane.locator(".page-scroll").waitFor()
        assert.equal(await pane.locator(":focus-visible").count(), 0)
        await page.keyboard.press("Alt+V")
        await list.waitFor()
        await page.keyboard.press("Alt+V")
        await pane.locator(".page-scroll").waitFor()
        await page.keyboard.press("Alt+1")
        await grid.waitFor()
        assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), "")
      }
    }
  } finally {
    await browser.close()
  }
})

test(
  "Grid and Page share edits while inspection, original appearance, and Sources stay independent",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, {
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
      await setup(page)
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
      await tab(input, "List")
      await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
      await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).press("Space")
      assert.equal(await select.inputValue(), "")
      assert.equal(await outputCount(page).textContent(), "1 page")
      await tab(input, "Page")
      await select.fill("7,2,2")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await outputCount(page).textContent(), "4 pages")
      assert.equal(await select.inputValue(), "")
      await select.fill("7,2,2")
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
      await tab(output, "Page")
      await zoom(output, "Reset zoom")
      assert.match(await pagePosition(output), /3\s*\/ 4/)
      const compare = output.getByRole("button", { name: "Compare page", exact: true })
      assert.equal(await compare.isVisible(), false)
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
      assert.equal(await compare.isVisible(), true)
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
        const feedback = await page.locator(".drag-image[data-card]").evaluate((preview) => {
          const canvas = preview.querySelector("canvas"),
            paint = canvas.getContext("2d"),
            width = parseFloat(canvas.style.inlineSize),
            height = parseFloat(canvas.style.blockSize),
            density = canvas.width / width
          const sample = (x, y) =>
            Array.from(paint.getImageData(Math.floor(x * density), Math.floor(y * density), 1, 1).data)
          return {
            width,
            height,
            density,
            rendered: preview.isConnected && getComputedStyle(preview).visibility === "visible",
            color: sample(width / 2, height * 0.7),
            lowerLeft: sample(0, height - 3)[3],
            lowerRight: sample(width - 3, height - 3)[3],
            edges: [2, 8, 14].map((y) => {
              for (let x = Math.floor(width) - 1; x >= 0; x--) if (sample(x, y)[3]) return x
            }),
          }
        })
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
        assert.ok(feedback.density >= 2)
        assert.deepEqual(await feedbackData.evaluate((data) => [data.image.width, data.image.height, data.pointer]), [
          1,
          1,
          [0, 0],
        ])
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
        await tab(output, "Page")
        await zoom(output, "Reset zoom")
        await tab(output, "Grid")
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
        await ready()
      }
      await tab(output, "Grid")
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
      await compare.click()
      await ready()
      assert.equal(await page.locator(".input-current").innerText(), "Filled.pdf")
      assert.match(await pagePosition(input), /2\s*\/ 7/)
      assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "200%")
      assert.equal(await select.inputValue(), "7,2,2")
      assert.equal(await pagePosition(output), outputPosition)
      assert.equal(await compare.getAttribute("aria-pressed"), null)
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
      assert.equal(await outputCount(page).textContent(), "5 pages")
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
      assert.equal(await outputCount(page).textContent(), "8 pages")
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
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
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
      await page.setViewportSize({ width: 810, height: 1100 })
      const outputSwitch = page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true })
      await selectPane(outputSwitch)
      assert.equal(await input.isVisible(), false)
      await color(image(output), 0.7, [0, 0, 0, 255])
      await compare.click()
      assert.equal(await compare.getAttribute("aria-pressed"), "true")
      await ready()
      await color(image(output), 0.7, [255, 0, 0, 255])
      await lensColor(output, [255, 0, 0, 255])
      await compare.click()
      assert.equal(await compare.getAttribute("aria-pressed"), "false")
      await ready()
      await color(image(output), 0.7, [0, 0, 0, 255])
      await page.setViewportSize({ width: 320, height: 700 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      const actions = output.getByLabel("Output page actions", { exact: true })
      await actions.click()
      const menu = output.locator(".sequence-options")
      await menu.getByRole("button", { name: "Compare page", exact: true }).press("Enter")
      assert.equal(await menu.evaluate((element) => element.open), false)
      assert.equal(await actions.evaluate((element) => element === document.activeElement), true)
      await page.evaluate(() => (document.documentElement.style.fontSize = ""))
      await page.setViewportSize({ width: 1440, height: 1100 })
      await input.waitFor()
      await ready()
      assert.equal(await compare.getAttribute("aria-pressed"), null)
      await color(image(output), 0.7, [0, 0, 0, 255])
      // Crossing the single-pane em breakpoint via text size alone updates Compare mode and resets it on return.
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await selectPane(outputSwitch)
      await page.waitForFunction(
        () => document.querySelector(".composition-output .compare")?.getAttribute("aria-pressed") === "false",
      )
      await compare.click()
      assert.equal(await compare.getAttribute("aria-pressed"), "true")
      await ready()
      await color(image(output), 0.7, [255, 0, 0, 255])
      await page.evaluate(() => (document.documentElement.style.fontSize = ""))
      await input.waitFor()
      await page.waitForFunction(
        () => document.querySelector(".composition-output .compare")?.getAttribute("aria-pressed") === null,
      )
      await ready()
      await color(image(output), 0.7, [0, 0, 0, 255])
      await output.getByLabel("Output page actions", { exact: true }).click()
      await output.getByRole("button", { name: "Before", exact: true }).click()
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
      assert.equal(await outputCount(page).textContent(), "10000 pages")
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
      assert.equal(await outputCount(page).textContent(), "10000 pages")
      assert.match(
        await page.locator(".header-feedback .feedback[data-kind=error]").innerText(),
        /supports up to 10000/,
      )
      assert.equal(await output.locator("[data-drop]").count(), 0)
      await page.setViewportSize({ width: 320, height: 900 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
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
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }))
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
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

test("Page width fitting and horizontal keys preserve composition and focus", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine, { ignoreDefaultArgs: ["--hide-scrollbars"] })
    try {
      for (const touch of [false, true]) {
        const page = await browser.newPage({
          viewport: touch ? { width: 810, height: 1080 } : { width: 1440, height: 900 },
          hasTouch: touch,
          isMobile: touch,
          reducedMotion: "reduce",
        })
        await setup(page)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
        for (const name of ["Input", "Output"]) {
          const views = page.locator(".mobile-workspace-tabs")
          await selectPane(views.getByRole("button", { name, exact: true }))
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
          assert.equal(await outputCount(page).textContent(), "8 pages")
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
  for (const engine of engines) {
    const browser = await launch(engine)
    let page, label
    try {
      page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
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
                probe.style.color = "var(--keyboard-focus)"
                const focus = getComputedStyle(probe).color
                probe.remove()
                return {
                  focused: document.activeElement === element,
                  outline: style.outlineColor,
                  frame: border.borderColor,
                  focus,
                  bounds: frame.getBoundingClientRect().toJSON(),
                }
              })
            const pointer = await inspect()
            assert.equal(pointer.focused, true, label)
            assert.equal(pointer.outline, "rgba(0, 0, 0, 0)", `${label}: no internal clipped outline`)
            assert.notEqual(pointer.frame, pointer.focus, `${label}: pointer zoom does not show keyboard focus`)
            await page.keyboard.press("0")
            await page.keyboard.press("Home")
            await page.keyboard.press("ArrowRight")
            assert.match(await pagePosition(pane), /2\s*\//, label)
            await page.keyboard.press("ArrowLeft")
            const keyboard = await inspect()
            assert.equal(keyboard.focused, true, label)
            assert.equal(keyboard.frame, keyboard.focus, `${label}: the complete frame owns keyboard focus`)
            assert.equal(keyboard.outline, "rgba(0, 0, 0, 0)", label)
            assert.deepEqual(keyboard.bounds, pointer.bounds, `${label}: focus does not change frame geometry`)
            await increase.click()
            assert.notEqual((await inspect()).frame, keyboard.focus, `${label}: pointer input clears the contour`)
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
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
          colorScheme: "dark",
          reducedMotion: "reduce",
        })
        await setup(page)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
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

test("Grid and Page switches preserve selections, zoom, and the inspected page", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await setup(page)
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
    const inputImage = await gridPage(input, 16)
    await modifiedClick(inputImage)
    await ready()
    assert.match(await pagePosition(input), /16\s*\/ 17/)
    assert.equal(await pageFocused(), true, "Content view switching focuses the inspected page")
    await zoom(input, "Zoom in")
    await ready()
    await image(input).click({ modifiers: ["ControlOrMeta"], position: { x: 100, y: 100 } })
    assert.equal(await inputImage.isVisible(), true, "Grid returns to the inspected thumbnail")
    assert.equal(await pageFocused(), true)
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
    assert.equal(await pageFocused(), true)
    await image(output).click({ modifiers: ["ControlOrMeta"] })
    assert.equal(await outputImage.isVisible(), true)
    assert.equal(await pageFocused(), true)
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, theme, textSize] of [
      [2560, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      await page.addInitScript((choice) => {
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
          await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const field = pane.getByLabel("Page selection", { exact: true })
        await field.fill("")
        await pane.locator(".grid-view").evaluate((element) => (element.scrollTop = 0))
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
                    node instanceof Element && (node.matches(".render-status") || node.querySelector(".render-status")),
                ),
              )
            )
              element.dataset.loading = "true"
          })
          observer.observe(element, { childList: true, subtree: true })
        })
        for (const number of [1]) {
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
  }
})

test("Unused and modified Grid keys preserve pointer controls and native shortcut priority", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "8 pages",
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
        if (name === "Output")
          assert.equal(
            await pane.getByRole("button", { name: "Duplicate Output page 1", exact: true }).isVisible(),
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
    await page.waitForFunction(() => !document.querySelector('.composer [aria-busy="true"]'))
    const currentZoom = await output.getByLabel("Output page zoom", { exact: true }).innerText()
    for (const key of ["+", "=", "-"]) {
      await page.keyboard.press(key)
      assert.equal(
        await output.getByLabel("Output page zoom", { exact: true }).innerText(),
        currentZoom,
        "Input Grid zoom keys do not change a Page in the other pane",
      )
    }
    await prepared.fill("1")
    const total = await outputCount(page).textContent()
    await prepared.dispatchEvent("keydown", { key: "Enter", isComposing: true })
    assert.equal(await outputCount(page).textContent(), total, "IME confirmation does not add prepared pages")
  } finally {
    await browser?.close()
  }
})

test(
  "Page shortcuts follow the mouse side and Go to page retains the counter geometry",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await setup(page)
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
        const field = pane.getByRole("textbox", { name: `${name} page number`, exact: true })
        await page.waitForFunction(
          (element) =>
            element === document.activeElement &&
            element.value === "1" &&
            element.selectionStart === 0 &&
            element.selectionEnd === element.value.length,
          await field.elementHandle(),
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
        await pane.getByRole("button", { name: `Go to page in ${name}`, exact: true }).click()
        await field.waitFor()
        assert.deepEqual([await counter(), await total()], before, "Opening Go to page keeps the counter in place")
        await field.fill("3")
        await field.press("Enter")
        assert.match(await pagePosition(pane), /3\s*\/ 7/)
        await pane.locator(".page-scroll:focus").waitFor()
        assert.equal(await prepared.inputValue(), "2,4")
        assert.equal(await selected.inputValue(), "3,5")
      }
      await output.getByRole("button", { name: "Details for Output page 3", exact: true }).press("n")
      const nextCounter = output.getByRole("button", { name: "Details for Output page 4", exact: true })
      assert.equal(await nextCounter.evaluate((element) => element === document.activeElement), true)
      await tab(input, "List")
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
      await tab(input, "Grid")
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
      for (const key of ["Shift+Equal", "-", "0", "z", "g"]) await page.keyboard.press(key)
      assert.equal(
        await page.evaluate(() => document.activeElement === document.body && scrollY === 0),
        true,
        "No Page means no focus or scroll changes",
      )
      assert.equal(await page.locator(".page-destination-panel:popover-open").count(), 0)
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
        await tab(pane, "Page")
        await pane.getByRole("button", { name: `Go to page in ${name}`, exact: true }).scrollIntoViewIfNeeded()
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
        await pane.getByRole("button", { name: `Go to page in ${name}`, exact: true }).click()
        const field = pane.getByRole("textbox", { name: `${name} page number`, exact: true })
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
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await setup(page)
      await page.addInitScript(() => {
        window.styleResults = []
        const Original = window.Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (message.changes || message.plan) {
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
      await page.locator(".input-current").filter({ hasText: "Large.pdf" }).waitFor({ state: "attached" })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const color = () =>
        input
          .locator("article.control")
          .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
          .locator("input[type=text]")
      const add = async (selection) => {
        await tab(input, "Grid")
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
          await output.locator(".page-origin-info:popover-open").innerText(),
          new RegExp(`Large\\.pdf\\s+Original page\\s+${original}`),
        )
        await details.click()
      }
      await output.getByRole("tab", { name: "Page", exact: true }).click()
      await output.locator('.page-scroll canvas[aria-label="PDF page 47"]').waitFor()
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor()
      const styled = await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL())
      const compare = output.getByRole("button", { name: "Compare page", exact: true })
      await compare.click()
      await input.locator('.page-scroll canvas[aria-label="PDF page 47"]').waitFor()
      await input.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor()
      assert.match(await pagePosition(input), /47\s*\/ 51/)
      assert.equal(await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "")
      assert.equal(await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL()), styled)
      await tab(input, "Grid")
      assert.equal(await input.getByRole("button", { name: "Select Input page 47", exact: true }).isVisible(), true)
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
      assert.equal(await outputCount(page).textContent(), "18 pages")

      const sample = await readFile("test/fixtures/dolor.pdf")
      const retained = await page.evaluate(async (bytes) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        const original = Uint8Array.from(bytes)
        const changes = { overrides: {}, reset: [], buffer: { input: "ordinary-page", pages: [0] } }
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
