import { captureLayout } from "./browser.js"
// Checks full-page List inspection, whole-row focus, edit feedback, and native/touch transfers.

import { setup, selectPane, paneButton } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { outputCount, tab, fixture, gridPage } from "./browser.js"

async function markerOffsets(panel) {
  return panel.locator(".page-list [data-provenance] i").evaluateAll((dots) =>
    dots.map((dot) => {
      const row = dot.closest("li")
      const number = row.querySelector(".list-number strong > span")
      const digits = number.getBoundingClientRect()
      const title = row.querySelector(".list-current, .list-choice")
      const range = document.createRange()
      range.setStart(title.firstChild, 0)
      range.setEnd(title.firstChild, 1)
      const label = range.getBoundingClientRect()
      const box = dot.getBoundingClientRect()
      const control = row.querySelector(".page-origin > button").getBoundingClientRect()
      const ribbon = row.querySelector(".list-disclosure svg path")?.getBoundingClientRect()
      return {
        number: number.textContent,
        x: box.x + box.width / 2 - (digits.right + label.left) / 2,
        y: box.y + box.height / 2 - control.y - control.height / 2,
        gap: box.left - digits.right,
        ribbonGap: ribbon ? digits.left - ribbon.right : null,
        underline: getComputedStyle(row.querySelector(".page-origin > button"), "::after").borderBlockEndStyle,
      }
    }),
  )
}

test("Output source markers center between page numbers and titles", { timeout: 120000 }, async () => {
  const server = await serve()
  await mkdir("../.local/tmp/web/layout/source-blocks", { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc-multiple`)
      const output = page.locator(".composition-output")
      await tab(output, "List")
      await output.locator("[data-provenance] i").first().waitFor()
      for (const width of [320, 390, 768, 1440]) {
        await page.setViewportSize({ width, height: 1100 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const switcher = page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name: "Output", exact: true })
          await selectPane(switcher)
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            for (const folded of [true, false]) {
              const toggle = output.getByRole("button", {
                name: `${folded ? "Fold" : "Unfold"} all Output sections`,
                exact: true,
              })
              if (await toggle.isVisible()) await toggle.click()
              for (const selection of ["", "1"]) {
                await output.getByLabel("Page selection", { exact: true }).fill(selection)
                const offsets = await markerOffsets(output)
                assert.ok(offsets.length >= 3)
                assert.ok(
                  offsets.every(
                    ({ x, y, gap, underline }) =>
                      Math.abs(x) < 1 && Math.abs(y) < 1 && gap >= 4 && underline === "dotted",
                  ),
                  `${engine.name()}, ${width}px, ${text}, ${colorScheme}, folded=${folded}, selection=${selection}: ${JSON.stringify(offsets)}`,
                )
              }
            }
          }
        }
        await page.screenshot({ path: `../.local/tmp/web/layout/source-blocks/markers-${engine.name()}-${width}.png` })
      }
      let count = Number.parseInt(await outputCount(page).textContent(), 10)
      for (const copies of [10, 10, 9, 101]) {
        const selection = output.getByLabel("Page selection", { exact: true })
        await selection.fill(copies === 101 ? "1" : `1-${count}`)
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill(String(copies))
        await output.getByRole("button", { name: "Repeat", exact: true }).click()
        count = copies === 101 ? count + 100 : count * copies
        assert.equal(await outputCount(page).textContent(), `${count} pages`)
        await selection.fill("")
        const unfold = output.getByRole("button", { name: "Unfold all Output sections", exact: true })
        if (await unfold.isVisible()) await unfold.click()
        await output.locator(".page-list").press("End")
        await output.getByRole("button", { name: `Details for Output page ${count}`, exact: true }).waitFor()
        const offsets = await markerOffsets(output)
        assert.equal(offsets.at(-1).number, String(count))
        assert.ok(
          offsets.every(({ x, y }) => Math.abs(x) < 1 && Math.abs(y) < 1),
          JSON.stringify(offsets),
        )
      }
      assert.equal(count, 10000)
      await page.close()

      const tablet = await browser.newPage({
        viewport: { width: 820, height: 1024 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await setup(tablet)
      await tablet.goto(`${server.resolvedUrls.local[0]}?demo=toc-multiple`)
      const switcher = paneButton(tablet, "Output")
      await switcher.waitFor()
      await selectPane(switcher, "tap")
      const tabletOutput = tablet.locator(".composition-output")
      await tab(tabletOutput, "List")
      await tabletOutput.locator(".list-section:has([data-provenance])").first().waitFor()
      const offsets = (await markerOffsets(tabletOutput)).filter(({ ribbonGap }) => ribbonGap !== null)
      assert.ok(offsets.length > 0)
      assert.ok(
        offsets.every(({ ribbonGap, x, gap }) => ribbonGap <= 31 && Math.abs(x) < 1 && gap >= 8),
        `${engine.name()}: tablet ribbons and markers keep balanced gaps ${JSON.stringify(offsets)}`,
      )
    } finally {
      await browser.close()
    }
  }
})

test("Input List gives defined PDF page labels their own column before page names", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const long = "Appendix-".repeat(20)
      for (const labels of [["title", "i", "1", long], ["1", "2", "3", "4"], undefined]) {
        const name = labels ? `Labels-${labels[0]}.pdf` : "No-labels.pdf"
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name,
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 4,
              labels,
              metadata: [{ name: "Cover" }, { name: "First page" }, { name: "Second page" }, { name: "Appendix" }],
              outline: [
                { title: "Preface", page: 0 },
                { title: "Chapter", page: 1 },
                { title: "Section", page: 1, parent: 1 },
              ],
            }),
          })
        await input.locator(".input-current").filter({ hasText: name }).waitFor({ state: "attached" })
        await tab(input, "List")
        assert.deepEqual(
          await input.locator(".page-list > li .list-pdf-label").allTextContents(),
          labels?.filter((label, index) => label !== String(index + 1)) ?? [],
        )
        assert.deepEqual(await input.locator(".page-list > li .list-number strong").allTextContents(), [
          "1",
          "2",
          "3",
          "4",
        ])
        assert.deepEqual(await input.locator(".list-section .list-number strong").allTextContents(), ["1", "2"])
        assert.deepEqual(
          await input.locator(".list-section .list-pdf-label").allTextContents(),
          labels && labels[0] !== "1" ? [labels[0], labels[1]] : [],
        )
        for (const [width, scheme, text] of [
          [1920, "light", "100%"],
          [375, "dark", "100%"],
          [375, "light", "200%"],
        ]) {
          await page.setViewportSize({ width, height: 1080 })
          await page.emulateMedia({ colorScheme: scheme })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          await input.getByLabel("Page selection", { exact: true }).fill("3")
          const bounds = await input.locator(".page-list").evaluate((list) => {
            const rect = (element) => {
              const box = element.getBoundingClientRect()
              return { left: box.left, right: box.right, width: box.width }
            }
            const rows = [...list.querySelectorAll(".list-row")].map((row) => ({
              number: rect(row.querySelector(".list-number")),
              grip: rect(row.querySelector(".page-grip")),
              label: row.querySelector(".list-pdf-label") ? rect(row.querySelector(".list-pdf-label")) : undefined,
              name: rect(row.querySelector(".list-choice")),
            }))
            return {
              rows,
              heading: rect(list.querySelector(".list-heading")),
              overflow: list.scrollWidth > list.clientWidth,
            }
          })
          assert.ok(!bounds.overflow, `${width}px ${text}: no List overflow`)
          for (const row of bounds.rows) {
            assert.ok(row.grip.right <= row.number.left + 1)
            if (width === 1920)
              assert.ok(row.grip.width <= 32.1 && row.number.width <= 32.1, "Compact identity columns")
            if (labels && row.label) {
              assert.ok(row.number.right <= row.label.left + 1 && row.label.right <= row.name.left + 1)
              assert.ok(Math.abs(row.label.width - bounds.rows[0].label.width) < 1)
            } else if (!labels) assert.ok(Math.abs(row.number.right - row.name.left) < 1, "No empty label column")
            assert.ok(Math.abs(row.name.left - bounds.heading.left) < 1, "Headers retain the name column")
          }
          if (labels && labels[1] !== "2") {
            const cell = input
              .locator(".page-list > :is(.list-row, .list-section)")
              .getByLabel(`Page Label: ${labels[2]}`, { exact: true })
            const colors = await cell.evaluate((element) => ({
              label: getComputedStyle(element).color,
              row: getComputedStyle(element.closest("li")).color,
            }))
            assert.equal(colors.label, colors.row, "Selected labels stay readable")
            assert.equal(await input.locator(".list-pdf-label").last().getAttribute("title"), labels[3])
          }
        }
        await page.setViewportSize({ width: 1920, height: 1080 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await tab(output, "List")
        assert.equal(await output.locator(".list-pdf-label").count(), 0, "Output retains occurrence numbers")
        const dots = output.locator(".provenance i")
        const colors = await dots.evaluateAll((elements) =>
          elements.map((element) => getComputedStyle(element).backgroundColor),
        )
        await output.getByLabel("Page selection", { exact: true }).fill("1")
        assert.deepEqual(
          await dots.evaluateAll((elements) => elements.map((element) => getComputedStyle(element).backgroundColor)),
          colors,
        )
        assert.ok(
          await dots.evaluateAll((elements) =>
            elements.every(
              (element) =>
                getComputedStyle(element).outlineStyle === "none" &&
                getComputedStyle(element.closest("button")).filter === "none",
            ),
          ),
        )
        const markers = await markerOffsets(output)
        assert.ok(
          markers.every(({ x, y }) => Math.abs(x) < 1 && Math.abs(y) < 1),
          `Source markers center between the number and title on both axes: ${JSON.stringify(markers)}`,
        )
      }
    } finally {
      await browser.close()
    }
  }
})

test("List strips stay flat and follow their original grab point", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const { page, input } = await lists(browser, server.resolvedUrls.local[0], { reducedMotion: "no-preference" })
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    await selection.fill("1")
    assert.equal(
      await input.locator('.list-row:has(.list-choice[data-page="1"]) button[aria-label^="Add Input"]').count(),
      0,
      "Unselected Input rows hide individual add buttons while a selection is active",
    )
    assert.equal(
      await input.locator(".page-list > .scroll-controls").count(),
      0,
      "Scroll controls stay outside list containers",
    )
    await selection.fill("")
    const grip = input.locator('.list-row:has(.list-choice[data-page="1"]) .page-grip'),
      bounds = await grip.boundingBox(),
      row = await grip.locator("..").boundingBox()
    const point = { x: Math.floor(bounds.x + bounds.width / 2), y: Math.floor(bounds.y + bounds.height / 2) }
    await page.mouse.move(point.x, point.y)
    await page.mouse.down()
    const strip = page.locator(".drag-image[data-strip]")
    assert.equal(await strip.locator(".drag-title").innerText(), "ITAL-GUID-79A4-WXGX")
    assert.equal(await strip.locator(".drag-number").innerText(), "2")
    const font = await grip
      .locator("..")
      .locator(".list-choice")
      .evaluate((element) => {
        const style = getComputedStyle(element)
        return [style.fontSize, style.fontWeight, style.lineHeight]
      })
    assert.deepEqual(
      await strip.evaluate((element) => {
        const style = getComputedStyle(element)
        return [style.fontSize, style.fontWeight, style.lineHeight]
      }),
      font,
    )
    assert.equal(await strip.evaluate((element) => element.tagName), "DIV")
    assert.equal(await strip.evaluate((element) => element.offsetHeight), row.height)
    const box = await strip.boundingBox()
    assert.ok(Math.abs(box.x - row.x) < 1)
    assert.ok(Math.abs(box.y - row.y) < 1)
    const number = await strip.locator(".drag-number").boundingBox()
    const originalNumber = await grip.locator("..").locator(".list-number").boundingBox()
    assert.ok(Math.abs(number.x + number.width / 2 - originalNumber.x - originalNumber.width / 2) < 1)
    assert.equal(await strip.evaluate((element) => getComputedStyle(element).rotate), "none")
    assert.equal(await page.locator(".composer[data-drag]").count(), 0)
    assert.equal(await selection.inputValue(), "")
    await page.mouse.move(point.x + 12, point.y, { steps: 3 })
    await page.locator(".composer[data-drag]").waitFor()
    for (const offset of [60, 120, 90]) {
      const pointerY = point.y + offset
      await page.mouse.move(point.x + 12, pointerY, { steps: 3 })
      // Native dragover needs another move at the final point.
      await page.mouse.move(point.x + 12, pointerY)
      await page.waitForFunction(
        (expected) => Math.abs(document.querySelector(".drag-image").getBoundingClientRect().y - expected) < 1,
        row.y + offset,
      )
      const moved = await strip.boundingBox()
      assert.ok(
        Math.abs(moved.y - row.y - offset) < 1,
        "The strip follows vertical motion without snapping to hovered rows",
      )
    }
    await page.keyboard.press("Escape")
    assert.equal(await strip.count(), 0)
    await page.mouse.up()
  } finally {
    await browser.close()
  }
})

test("List aligns plain and actionable page numbers in shared columns", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const { page, input, output } = await lists(browser, server.resolvedUrls.local[0])
      await output.getByLabel("Page selection", { exact: true }).fill("1")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      for (const width of [1440, 768, 390, 320]) {
        await page.setViewportSize({ width, height: 1100 })
        const switcher = page
          .getByRole("navigation", { name: "Workspace view", exact: true })
          .getByRole("button", { name: "Input", exact: true })
        await selectPane(switcher)
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            for (const selected of [false, true]) {
              await input.getByLabel("Page selection", { exact: true }).fill(selected ? "1-4" : "")
              const rows = await input.locator(".list-row").evaluateAll((elements) =>
                elements.map((row) => {
                  const number = row.querySelector(".list-number strong > span"),
                    cell = row.querySelector(".list-number").getBoundingClientRect(),
                    frame = row.getBoundingClientRect(),
                    range = document.createRange()
                  range.selectNodeContents(number)
                  const glyph = range.getBoundingClientRect()
                  range.selectNodeContents(row.querySelector(".list-choice"))
                  const name = range.getBoundingClientRect()
                  const icon = row.querySelector(".page-grip svg"),
                    ink = icon.getBBox()
                  const center = new DOMPoint(ink.x + ink.width / 2, ink.y + ink.height / 2).matrixTransform(
                    icon.getScreenCTM(),
                  )
                  return {
                    font: getComputedStyle(number).fontSize,
                    x: glyph.x + glyph.width / 2 - cell.x - cell.width / 2,
                    y: glyph.y + glyph.height / 2 - frame.y - frame.height / 2,
                    name: name.x,
                    grip: center.y - frame.y - frame.height / 2,
                  }
                }),
              )
              const label = JSON.stringify({ width, text, colorScheme, selected, rows })
              assert.equal(new Set(rows.map((row) => row.font)).size, 1, label)
              assert.ok(
                rows.every(
                  (row) =>
                    Math.abs(row.x) < 1 &&
                    Math.abs(row.y - rows[0].y) < 1 &&
                    Math.abs(row.grip) < 1 &&
                    Math.abs(row.name - rows[0].name) < 1,
                ),
                label,
              )
            }
          }
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test("List neighbors move around a stationary insertion slot", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const { page, output } = await lists(browser, server.resolvedUrls.local[0], {
      hasTouch: true,
      reducedMotion: "no-preference",
    })
    const rows = output.locator(".list-row"),
      original = await rows.evaluateAll((elements) => elements.map((element) => element.id)),
      from = await rows.nth(1).locator(".page-grip").boundingBox(),
      to = await rows.nth(4).locator(".list-choice").boundingBox(),
      session = await page.context().newCDPSession(page),
      point = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] })
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ ...point, x: point.x + 12, id: 1 }],
    })
    await page.locator('.composer[data-drag="output"]').waitFor()
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height * 0.85, id: 1 }],
    })
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".composition-output .list-row")].some(
        (row) =>
          row.querySelector(".list-drop-preview") &&
          row.getAnimations().some((animation) => animation.playState === "running"),
      ),
    )
    const slot = output.locator(".list-drop-preview"),
      target = await slot.locator("..").getAttribute("id"),
      positions = await slot.evaluate(async (element) => {
        const samples = []
        for (let frame = 0; frame < 3; frame++) {
          await new Promise(requestAnimationFrame)
          samples.push(element.getBoundingClientRect().top)
        }
        return samples
      })
    assert.ok(Math.max(...positions) - Math.min(...positions) < 1, "The open slot stays still while its row moves")
    const bounds = await slot.boundingBox()
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2, id: 1 }],
    })
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.equal(await slot.locator("..").getAttribute("id"), target)
    assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), original)
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
    assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), [
      original[0],
      ...original.slice(2, 5),
      original[1],
      ...original.slice(5),
    ])
    assert.equal(await page.locator(".drag-image, .list-drop-preview").count(), 0)
    await session.detach()
  } finally {
    await browser.close()
  }
})

test(
  "Grid and List preview destination numbers without changing pages or rerendering PDF images",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      for (const view of ["Grid", "List"]) {
        const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], {
          hasTouch: true,
          viewport: { width: 1920, height: 1200 },
        })
        if (view !== "List") {
          await tab(output, "Grid")
        }
        const rows = output.locator(view !== "List" ? ".composition-card" : ".list-row"),
          selection = output.getByRole("textbox", { name: "Page selection", exact: true }),
          original = await rows.evaluateAll((elements) => elements.map((element) => element.id)),
          session = await page.context().newCDPSession(page)
        const numbers = () =>
          (view === "List" ? rows.locator(":scope:not([data-dragging])") : rows)
            .locator(".page-origin > button strong")
            .allTextContents()
        const drag = async (index, target, after) => {
          const grip = rows.nth(index).locator(".page-grip"),
            from = await grip.boundingBox(),
            point = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] })
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ ...point, x: point.x + 12, id: 1 }],
          })
          await page.locator('.composer[data-drag="output"]').waitFor()
          const destination = rows.nth(target)
          // Follow the visible row as its insertion slot opens.
          for (let step = 0; step < 2; step++) {
            const to = await destination.locator(view !== "List" ? ".page-image" : ".list-choice").boundingBox()
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [
                {
                  x: to.x + to.width * (view !== "List" ? (after ? 0.85 : 0.15) : 0.5),
                  y: to.y + to.height * (view === "List" ? (after ? 0.85 : 0.15) : 0.5),
                  id: 1,
                },
              ],
            })
            await page.evaluate(() => new Promise(requestAnimationFrame))
          }
          await destination.locator(`:scope[data-drop="${after ? "after" : "before"}"]`).waitFor()
        }
        await selection.fill("")
        if (view !== "List") {
          await rows.first().locator('.thumbnail[aria-busy="false"]').waitFor()
          await page.evaluate(() => {
            window.dragRaster = document.querySelector(".composition-output .page-image canvas")
            window.dragPixels = window.dragRaster.toDataURL()
          })
        }
        await drag(0, 3, true)
        assert.deepEqual(
          await numbers(),
          view === "List"
            ? ["1", "2", "3", "5", "6", "7", "8"]
            : ["4", "1", "2", "3", "5", "6", "7", "8"].slice(0, original.length),
        )
        assert.equal(await rows.first().evaluate((element) => getComputedStyle(element).opacity), "0")
        assert.equal(await page.locator(".drag-image .drag-number").innerText(), "4")
        await page.emulateMedia({ reducedMotion: "no-preference" })
        const rotation = await page.locator(".drag-image").evaluate((element) => getComputedStyle(element).rotate)
        if (view === "List") assert.equal(rotation, "none")
        else assert.notEqual(rotation, "none")
        await page.emulateMedia({ reducedMotion: "reduce" })
        assert.equal(await page.locator(".drag-image").evaluate((element) => getComputedStyle(element).rotate), "none")
        assert.equal(await output.locator(".drop-number").innerText(), "4")
        if (view !== "List")
          assert.equal(
            await rows.evaluateAll((elements) =>
              elements.every((element) => {
                const number = Number(element.querySelector(".page-origin strong").textContent)
                return (
                  element.dataset.face === (number % 2 ? "front" : "back") &&
                  !!element.querySelector(".page-fold") === (number % 2 === 0)
                )
              }),
            ),
            true,
          )
        assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), original)
        if (view !== "List") {
          assert.equal(
            await page.evaluate(
              () =>
                window.dragRaster === document.querySelector(".composition-output .page-image canvas") &&
                window.dragRaster.toDataURL() === window.dragPixels,
            ),
            true,
          )
          const image = await page.locator(".drag-image").boundingBox(),
            target = await rows.nth(3).locator(".page-image").boundingBox()
          assert.ok(
            Math.abs(image.y - (target.y + target.height / 2) + 12) < 10,
            "The moving card remains attached to its grip point",
          )
        } else {
          const ghost = output.locator(".list-drop-preview"),
            choice = rows.nth(3).locator(".list-choice")
          assert.deepEqual(
            await ghost.evaluate((element) => {
              const s = getComputedStyle(element)
              return [s.fontSize, s.fontWeight, s.lineHeight]
            }),
            await choice.evaluate((element) => {
              const s = getComputedStyle(element)
              return [s.fontSize, s.fontWeight, s.lineHeight]
            }),
          )
          assert.equal(
            await ghost.evaluate((element) => element.offsetHeight),
            await page.locator(".drag-image").evaluate((element) => element.offsetHeight),
          )
          const name = await ghost.locator(".drop-name").boundingBox(),
            number = await ghost.locator(".drop-number").boundingBox(),
            label = await choice.boundingBox(),
            cell = await rows.nth(3).locator(".list-number").boundingBox()
          assert.ok(Math.abs(name.x - label.x) < 1)
          assert.ok(Math.abs(number.x + number.width / 2 - cell.x - cell.width / 2) < 1)
        }
        await page.keyboard.press("Escape")
        await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] })
        assert.deepEqual(await numbers(), ["1", "2", "3", "4", "5", "6", "7", "8"].slice(0, original.length))
        await selection.fill("2,4")
        await drag(3, 0, false)
        assert.deepEqual(
          await numbers(),
          view === "List"
            ? ["3", "4", "5", "6", "7", "8"]
            : ["3", "1", "4", "2", "5", "6", "7", "8"].slice(0, original.length),
        )
        assert.equal(await page.locator(".drag-image .drag-number").innerText(), "2")
        assert.equal(await output.locator(".drop-number").innerText(), "1")
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
        assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), [
          original[1],
          original[3],
          original[0],
          original[2],
          ...original.slice(4),
        ])
        assert.deepEqual(await numbers(), ["1", "2", "3", "4", "5", "6", "7", "8"].slice(0, original.length))
        assert.equal(await page.locator(".drag-image, .list-drop-preview, .drop-placeholder").count(), 0)
        if (view === "List") {
          await input.getByLabel("Page selection", { exact: true }).fill("1")
          await input.getByLabel("Input page actions", { exact: true }).click()
          await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
          await input.getByLabel("Start each repeat on front", { exact: true }).check()
          await page.keyboard.press("Escape")
          const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }),
            from = await grip.boundingBox(),
            to = await rows.nth(1).locator(".list-choice").boundingBox(),
            point = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] })
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ ...point, x: point.x + 12, id: 1 }],
          })
          await page.locator('.composer[data-drag="source"]').waitFor()
          await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{ x: to.x + to.width / 2, y: to.y + 4, id: 1 }],
          })
          await rows.nth(1).locator(':scope[data-drop="before"]').waitFor()
          assert.deepEqual(await numbers(), ["1", "7", "8", "9", "10", "11", "12", "13"])
          assert.equal(
            await output.locator(".drop-number").innerText(),
            "3",
            "Front alignment reserves leading and repeated Padding",
          )
          assert.equal(await page.locator(".drag-image .drag-number").innerText(), "3")
          await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
          assert.equal(await rows.count(), 13)
          assert.deepEqual(await numbers(), ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12", "13"])
        }
        await session.detach()
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test(
  "Pages view returns reveal the inspected page across panes and keyboard gestures",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1100 },
          reducedMotion: engine === chromium ? "no-preference" : "reduce",
        })
        page.setDefaultTimeout(10000)
        await setup(page)
        await page.route("**/magna.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
        )
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.locator('.composer[aria-busy="false"]').waitFor()
        for (const [pane, name] of [
          [page.locator(".selection-panel"), "Input"],
          [page.locator(".composition-output"), "Output"],
        ]) {
          await tab(pane, "List")
          const selection = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await selection.fill("1,3")
          await pane.locator(".page-list").focus()
          await page.keyboard.press("End")
          for (let index = 0; index < 13; index++) await page.keyboard.press("ArrowUp")
          await pane.getByRole("button", { name: `View ${name} page 47`, exact: true }).click()
          await pane.getByRole("button", { name: `Next ${name} page`, exact: true }).click()
          const listTab = pane.getByRole("tab", { name: "List", exact: true })
          await listTab.click()
          const row = pane.locator(':is(.list-choice, .list-heading)[data-page="47"]'),
            item = row.locator("xpath=ancestor::li[1]")
          await item.locator(":scope[data-returning]").waitFor()
          assert.equal(await listTab.evaluate((element) => element === document.activeElement), true)
          const bounds = await item.boundingBox(),
            area = await pane.locator(".page-list").boundingBox()
          assert.ok(
            bounds.y >= area.y - 1 && bounds.y + bounds.height <= area.y + area.height + 1,
            JSON.stringify({ bounds, area }),
          )
          assert.equal(await selection.inputValue(), "1,3")
          assert.equal(await page.locator(".page-peek:popover-open").count(), 0)
          assert.equal(
            await item.evaluate((element) => {
              const reference = document.createElement("span")
              reference.style.background = "var(--return-surface)"
              element.append(reference)
              const highlighted =
                getComputedStyle(element).backgroundColor !== getComputedStyle(reference).backgroundColor
              reference.remove()
              return highlighted
            }),
            true,
          )
          if (engine === webkit) assert.equal(await item.evaluate((element) => element.getAnimations().length), 0)
          else {
            await page.waitForFunction(() => document.querySelector("[data-returning]")?.getAnimations().length > 0)
            assert.equal(await item.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
            assert.equal(
              await item.evaluate((element) => {
                element.getAnimations()[0].finish()
                const animation = element.getAnimations()[0]
                return (
                  animation.effect.getComputedTiming().progress === 1 &&
                  animation.effect.getTiming().fill === "forwards"
                )
              }),
              true,
            )
          }
          await item.locator(":scope[data-returning]").waitFor({ state: "detached" })
          await row.focus()
          await page.keyboard.press("v")
          await pane.getByRole("button", { name: `Previous ${name} page`, exact: true }).click()
          await pane.locator(".page-scroll").focus()
          await page.keyboard.press("v")
          let current = 46
          const choice = pane.locator(`:is(.list-choice, .list-heading)[data-page="${current}"]`)
          assert.equal(await choice.evaluate((element) => element === document.activeElement), true)
          assert.equal(await pane.locator("[data-returning]").count(), 0)
          assert.equal(await selection.inputValue(), "1,3")
          const rememberedScroll = await pane.locator(".page-list").evaluate((element) => element.scrollTop)
          await tab(pane, "Grid")
          let card = await gridPage(pane, current + 1)
          await card.click({ modifiers: ["Control"] })
          assert.equal(await selection.inputValue(), "1,3")
          await pane.getByRole("button", { name: `Next ${name} page`, exact: true }).click()
          current++
          const gridTab = pane.getByRole("tab", { name: "Grid", exact: true })
          await gridTab.click()
          card = pane.locator(`.page-image[data-page="${current}"]`)
          await card.locator("..").locator(":scope[data-returning]").waitFor()
          assert.equal(await gridTab.evaluate((element) => element === document.activeElement), true)
          assert.equal(
            await card
              .locator('xpath=ancestor::*[contains(@class, "composition-card")][1]')
              .evaluate((element) => Math.round(element.getBoundingClientRect().width)),
            148,
          )
          await card.click({ modifiers: ["Meta"] })
          await pane.locator(".page-scroll").focus()
          await page.keyboard.press("v")
          assert.equal(await card.evaluate((element) => element === document.activeElement), true)
          assert.equal(await pane.locator("[data-returning]").count(), 0)
          assert.equal(await selection.inputValue(), "1,3")
          await tab(pane, "List")
          await pane.locator(".page-list").waitFor()
          assert.ok(
            Math.abs((await pane.locator(".page-list").evaluate((element) => element.scrollTop)) - rememberedScroll) <
              2,
            `${name} List restores its own scroll position after Grid`,
          )
          assert.equal(
            await pane
              .getByRole("tab", { name: "List", exact: true })
              .evaluate((element) => element === document.activeElement),
            true,
          )
          assert.equal(await selection.inputValue(), "1,3")
        }
        await page.close()
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "List keys share Grid edits and modified arrows move the focused Output occurrence",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const { page, input, output } = await lists(browser, server.resolvedUrls.local[0])
        const warnings = []
        page.on("console", (message) => {
          if (message.type() === "warning") warnings.push(message.text())
        })
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true }),
          selection = output.getByRole("textbox", { name: "Page selection", exact: true }),
          rows = output.locator(".list-row")
        await preparation.fill("")
        await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Shift+ArrowDown")
        assert.equal(await preparation.inputValue(), "2-3")
        await page.keyboard.press("Shift+P")
        assert.equal(await preparation.inputValue(), "2-3", "N/P retain Grid navigation without extending selection")
        await page.keyboard.press("Enter")
        assert.equal(await rows.count(), 10)
        assert.equal(await preparation.inputValue(), "")
        await input
          .locator(':is(.list-choice, .list-heading)[data-page="1"]')
          .dispatchEvent("keydown", { key: "Enter", repeat: true })
        assert.equal(await rows.count(), 10)
        await page.keyboard.press("Shift+=")
        assert.equal(await rows.count(), 11)
        await selection.fill("")
        const before = await rows.evaluateAll((elements) => elements.map((element) => element.id))
        await output.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
        await page.keyboard.press("Control+ArrowDown")
        assert.equal(await rows.nth(1).getAttribute("id"), before[0])
        await page.keyboard.press("Meta+ArrowUp")
        assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), before)
        await page.keyboard.press("Enter")
        assert.equal(await rows.count(), 12)
        await page.keyboard.press("-")
        assert.equal(await rows.count(), 11)
        await selection.fill("")
        await output.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
        await page.keyboard.press("Shift+=")
        assert.equal(await rows.count(), 12)
        await page.keyboard.press("Delete")
        assert.equal(await rows.count(), 11)
        await output.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
        await page.keyboard.press("PageDown")
        assert.equal(
          await output
            .locator(':is(.list-choice, .list-heading)[data-page="10"]')
            .evaluate((element) => element === document.activeElement),
          true,
        )
        await page.keyboard.press("Home")
        assert.equal(
          await output
            .locator(':is(.list-choice, .list-heading)[data-page="0"]')
            .evaluate((element) => element === document.activeElement),
          true,
        )
        await selection.fill("3")
        const untouched = await rows.evaluateAll((elements) => elements.map((element) => element.id))
        await page.keyboard.press("Control+ArrowUp")
        assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), untouched)
        await selection.fill("")
        await tab(output, "Grid")
        const cards = output.locator(".composition-card"),
          first = await cards.first().getAttribute("id")
        await output.locator('.page-image[data-page="0"]').focus()
        await page.keyboard.press("Meta+ArrowRight")
        assert.equal(await cards.nth(1).getAttribute("id"), first)
        await page.keyboard.press("Control+ArrowLeft")
        assert.equal(await cards.first().getAttribute("id"), first)
        assert.deepEqual(warnings, [], "Removed row scopes do not leave stale transition reads")
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "List transfers cancel cleanly and scroll long Output without committing a preview",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.route("**/magna.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.locator('.composer[aria-busy="false"]').waitFor()
      const output = page.locator(".composition-output")
      await tab(output, "List")
      const list = output.locator(".page-list"),
        rows = list.locator(".list-row"),
        selection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("1,3")
      const before = await rows.evaluateAll((elements) => elements.map((element) => element.id))
      const source = output.getByRole("button", { name: "Select or drag Output page 1", exact: true }),
        from = await source.boundingBox(),
        area = await list.boundingBox()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width + 12, from.y + from.height / 2, { steps: 3 })
      await page.locator('.composer[data-drag="output"]').waitFor()
      await page.mouse.move(area.x + area.width / 2, area.y + area.height - 8, { steps: 5 })
      await page.waitForFunction(() => document.querySelector(".composition-output .page-list").scrollTop > 100)
      assert.ok((await rows.count()) < 50, "Auto-scroll keeps only the nearby row window mounted")
      await page.keyboard.press("Escape")
      await page.mouse.up()
      assert.equal(await selection.inputValue(), "1,3")
      assert.equal(await outputCount(page).textContent(), "60 pages")
      await page.waitForFunction(() => {
        const value = document.querySelector(".composition-output .page-list").scrollTop
        if (window.stoppedListScroll === value) return true
        window.stoppedListScroll = value
        return false
      })
      const stopped = await list.evaluate((element) => element.scrollTop)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      assert.equal(await list.evaluate((element) => element.scrollTop), stopped)
      assert.equal(await page.locator(".drag-image, .composer[data-drag], .list-row[data-drop]").count(), 0)
      await list.evaluate((element) => (element.scrollTop = 0))
      await rows.first().locator('[data-page="0"]').waitFor()
      assert.deepEqual(
        await rows.evaluateAll(
          (elements, count) => elements.slice(0, count).map((element) => element.id),
          before.length,
        ),
        before,
      )
    } finally {
      await browser.close()
    }
  },
)

test(
  "Touch List preparations drop on the narrow Output tab without selecting or losing pages",
  { timeout: 30000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], {
        hasTouch: true,
        isMobile: true,
      })
      await page.setViewportSize({ width: 390, height: 1000 })
      const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
      await selectPane(views.getByRole("button", { name: "Input", exact: true }), "tap")
      const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("1,3")
      const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
      await grip.scrollIntoViewIfNeeded()
      const from = await grip.boundingBox(),
        to = await views.getByRole("button", { name: "Output", exact: true }).boundingBox(),
        session = await page.context().newCDPSession(page),
        point = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] })
      assert.equal(await page.locator(".drag-image[data-strip]").count(), 0, "A grip press waits for movement")
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ ...point, x: point.x + 12, id: 1 }],
      })
      await page.locator('.composer[data-drag="source"]').waitFor()
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2, id: 1 }],
      })
      await views.getByRole("button", { name: "Output", exact: true }).locator(":scope[data-drop]").waitFor()
      assert.equal(await selection.inputValue(), "1,3")
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
      await page.locator('.composer[data-view="output"]').waitFor()
      assert.equal(await output.locator(".list-row").count(), 10)
      await page.locator(".composer[data-drag]").waitFor({ state: "detached" })
      await views.getByRole("button", { name: "Input", exact: true }).click()
      await input.waitFor({ state: "visible" })
      assert.equal(await selection.inputValue(), "")
      assert.equal(await page.locator(".drag-image, .composer[data-drag]").count(), 0)
      await session.detach()
    } finally {
      await browser.close()
    }
  },
)

async function lists(browser, url, options = {}) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce", ...options })
  page.setDefaultTimeout(10000)
  await setup(page)
  await page.goto(`${url}?demo=single`)
  await page.locator('.composer[aria-busy="false"]').waitFor()
  const input = page.locator(".selection-panel"),
    output = page.locator(".composition-output")
  await tab(input, "List")
  await tab(output, "List")
  return { page, input, output }
}

test(
  "Page numbers merge declared names into details and unnamed pages reserve no caption",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        await setup(page)
        const name = "ITAL-" + "LONG-SHEET-CODE-".repeat(12)
        await page.route("**/magna.pdf", (route) =>
          route.fulfill({
            contentType: "application/pdf",
            body: fixture({ count: 4, metadata: [{ name: "Cover" }, { name }, {}, {}] }),
          }),
        )
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.locator('.composer[aria-busy="false"]').waitFor()
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        for (const pane of [input, output]) {
          {
            const row = pane.locator(".composition-card").nth(1),
              number = row.locator(".page-origin > button")
            await number.hover()
            const caption = row.locator(".page-name")
            await caption.waitFor()
            assert.equal(await caption.innerText(), name)
            assert.equal(
              await number.evaluate((element) => {
                element.click()
                const card = element.closest(".composition-card")
                return (
                  !card.querySelector(".page-name") &&
                  !!card.querySelector(".detail-name") &&
                  !!card.querySelector(".card-menu-options:popover-open, .page-origin-info:popover-open")
                )
              }),
              true,
            )
            const details = row.locator(".card-menu-options:popover-open, .page-origin-info:popover-open")
            await details.waitFor()
            assert.equal(await row.locator(".page-name").count(), 0)
            assert.equal(await details.locator(".detail-name").innerText(), name)
            const panel = await details.boundingBox(),
              trigger = await number.boundingBox()
            assert.ok(
              Math.min(Math.abs(panel.y - trigger.y - trigger.height), Math.abs(trigger.y - panel.y - panel.height)) <
                12,
            )
            await page.keyboard.press("Escape")
            if (await row.locator(".page-origin-info:popover-open").count()) await number.click()
          }
          await tab(pane, "List")
          const title = pane === input ? "Input" : "Output"
          await pane.getByRole("button", { name: `Details for ${title} page 2`, exact: true }).click()
          const details = pane.locator(".card-menu-options:popover-open")
          assert.equal(await details.getByRole("button").count(), 0)
          await page.keyboard.press("Escape")
          await pane.getByRole("button", { name: `View ${title} page 2`, exact: true }).click()
          const number = pane.locator(".inspection-heading .page-number-control")
          await page.mouse.move(0, 0)
          const caption = pane.locator(".inspection-heading .page-name")
          assert.equal(await caption.isVisible(), false)
          await number.hover()
          await caption.waitFor({ state: "visible" })
          assert.equal(await caption.innerText(), name)
          const before = await pane.locator(".page-scroll").boundingBox()
          await page.mouse.move(0, 0)
          assert.deepEqual(await pane.locator(".page-scroll").boundingBox(), before)
          await pane.getByRole("button", { name: `Next ${title} page`, exact: true }).click()
          await number.hover()
          assert.equal(await pane.locator(".page-name").count(), 0)
          await pane.locator(".page-scroll").focus()
          await page.keyboard.press("v")
          const view = pane.getByRole("button", { name: `View ${title} page 3`, exact: true })
          await view.hover()
          const peek = page.getByRole("tooltip")
          await peek.waitFor()
          assert.equal(await peek.locator("p").count(), 0)
          await page.keyboard.press("Escape")
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test("List previews whole pages and returns to its row without changing selection", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const { page, input, output } = await lists(browser, server.resolvedUrls.local[0])
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      for (const [pane, name, count] of [
        [input, "Input", 4],
        [output, "Output", 8],
      ]) {
        const selection = pane.getByRole("textbox", { name: "Page selection", exact: true })
        await selection.fill("1,4")
        const view = pane.getByRole("button", { name: `View ${name} page 2`, exact: true })
        await view.hover()
        const preview = page.getByRole("tooltip")
        await preview.locator('.thumbnail[aria-busy="false"]').waitFor()
        assert.equal(await preview.locator("p").innerText(), "ITAL-GUID-79A4-WXGX")
        const image = await preview.locator("canvas").boundingBox(),
          box = await preview.boundingBox()
        assert.ok(image.width > 240 && image.height > 340)
        assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= 1440 && box.y + box.height <= 1100)
        assert.equal(await selection.inputValue(), "1,4")
        await page.keyboard.press("Escape")
        await preview.waitFor({ state: "detached" })
        await view.click()
        assert.match(await pane.locator(".page-position").innerText(), new RegExp(`2\\s*/\\s*${count}`))
        assert.equal(await selection.inputValue(), "1,4")
        const frame = await pane.locator(".page-view").boundingBox(),
          actions = await pane.locator(".page-actions").boundingBox()
        assert.ok(Math.abs(actions.x + actions.width / 2 - frame.x - frame.width / 2) < 1)
        await pane.locator(".page-scroll").focus()
        await page.keyboard.press("v")
        const row = pane.locator(':is(.list-choice, .list-heading)[data-page="1"]')
        assert.equal(await row.evaluate((element) => element === document.activeElement), true)
        await page.keyboard.press("v")
        await pane.getByRole("button", { name: `Next ${name} page`, exact: true }).click()
        await pane.locator(".page-scroll").focus()
        await page.keyboard.press("v")
        assert.equal(
          await pane
            .locator(':is(.list-choice, .list-heading)[data-page="2"]')
            .evaluate((element) => element === document.activeElement),
          true,
        )
        assert.equal(await selection.inputValue(), "1,4")
        await pane.locator(':is(.list-choice, .list-heading)[data-page="1"]').dblclick()
        assert.equal(await selection.inputValue(), "1,4")
        await pane.locator(".page-scroll").focus()
        await page.keyboard.press("v")
        for (const colorScheme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme })
          await selection.fill("2")
          await row.focus()
          await page.keyboard.press("Shift")
          const focus = await row.evaluate((element) => {
            const item = element.closest("li"),
              style = getComputedStyle(item)
            return {
              outlined: style.outlineStyle === "solid" && style.outlineWidth === "1px",
              offset: style.outlineOffset,
              inner: getComputedStyle(element).outlineColor,
            }
          })
          assert.deepEqual(focus, { outlined: true, offset: "-1px", inner: "rgba(0, 0, 0, 0)" })
          await page.keyboard.press("Space")
          assert.equal(await row.getAttribute("aria-pressed"), "false")
          assert.equal(
            await pane
              .locator(':is(.list-choice, .list-heading)[data-page="2"]')
              .evaluate(
                (element) =>
                  element === document.activeElement &&
                  getComputedStyle(element.closest("li")).outlineStyle === "solid",
              ),
            true,
          )
        }
      }
      await page.setViewportSize({ width: 320, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
      await output.getByRole("button", { name: "Actions for Output page 2", exact: true }).press("Enter")
      await output.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).press("Enter")
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
    } finally {
      await browser.close()
    }
  }
})

test(
  "List additions, removals, and moves animate immediate edits and respect reduced motion",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], {
        reducedMotion: "no-preference",
      })
      const inputSelection = input.getByRole("textbox", { name: "Page selection", exact: true }),
        outputSelection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await inputSelection.fill("")
      await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).press("Enter")
      const rows = output.locator(".list-row:not(.removing)")
      assert.equal(await rows.count(), 9)
      await page.waitForFunction(() => document.querySelector(".list-row[data-arriving]")?.getAnimations().length > 0)
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.evaluate(() => new Promise(requestAnimationFrame))
      assert.equal(
        await output.locator(".list-row[data-arriving]").count(),
        0,
        "Disabling motion clears the interrupted entrance",
      )
      await page.emulateMedia({ reducedMotion: "no-preference" })
      assert.equal(
        await rows.evaluateAll((elements) => elements.some((element) => element.getAnimations().length)),
        false,
        "Restoring motion does not replay a completed edit",
      )
      await output.locator(".list-row[data-arriving]").waitFor({ state: "detached" })
      await outputSelection.fill("")
      const before = await rows.evaluateAll((elements) => elements.map((element) => element.id))
      await output.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).press("Enter")
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), [
        before[1],
        before[0],
        ...before.slice(2),
      ])
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".page-list > li")].some((element) => element.getAnimations().length),
      )
      const moved = rows.first()
      await page.waitForFunction(() =>
        document
          .querySelector(".composition-output .list-row")
          ?.getAnimations()
          .some(
            (animation) =>
              animation.effect.getKeyframes().some((frame) => frame.boxShadow?.includes("inset")) &&
              animation.currentTime >= animation.effect.getTiming().delay,
          ),
      )
      const landing = await moved.evaluate((element) => {
        const glow = element
          .getAnimations()
          .find((animation) => animation.effect.getKeyframes().some((frame) => frame.boxShadow?.includes("inset")))
        return { ...glow.effect.getTiming(), shadow: getComputedStyle(element).boxShadow }
      })
      assert.equal(landing.delay, 500)
      assert.equal(landing.duration, 1200)
      assert.match(landing.shadow, /inset/, "The moved row glows after reaching its position")
      await output.getByRole("button", { name: "Remove Output page 1", exact: true }).press("Enter")
      assert.equal(await rows.count(), 8)
      const outgoing = output.locator(".list-row.removing")
      await outgoing.waitFor()
      assert.equal(await outgoing.evaluate((element) => element.inert), true)
      await outgoing.waitFor({ state: "detached" })
      await page.emulateMedia({ reducedMotion: "reduce" })
      await input.getByRole("button", { name: "Add Input page 3 to Output", exact: true }).press("Enter")
      assert.equal(await rows.count(), 9)
      assert.equal(
        await rows.evaluateAll((elements) => elements.some((element) => element.getAnimations().length)),
        false,
      )
      await tab(output, "Grid")
      await page.emulateMedia({ reducedMotion: "no-preference" })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        const control = output.getByRole("button", { name: "Move Output page 2 earlier", exact: true })
        const id = await control.evaluate((element) => element.closest(".composition-card").id)
        await control.press("Enter")
        await page.waitForFunction(
          (value) =>
            document
              .getElementById(value)
              ?.getAnimations()
              .some(
                (animation) =>
                  animation.effect.getTiming().duration === 1200 &&
                  animation.effect.getKeyframes().some((frame) => frame.boxShadow?.includes("inset")) &&
                  animation.currentTime >= animation.effect.getTiming().delay,
              ),
          id,
        )
      }
    } finally {
      await browser.close()
    }
  },
)

test(
  "List native and touch drags copy preparations and move occurrences at vertical slots",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      for (const touch of [false, true]) {
        const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], { hasTouch: touch })
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true })
        await preparation.fill("1,3")
        const rows = output.locator(".list-row"),
          ids = await rows.evaluateAll((elements) => elements.map((element) => element.id))
        const session = touch ? await page.context().newCDPSession(page) : undefined
        const move = async (source, target, after) => {
          const from = await source.boundingBox(),
            to = await target.boundingBox(),
            point = { x: from.x + from.width / 2, y: from.y + from.height / 2 },
            end = { x: to.x + to.width / 2, y: to.y + to.height * (after ? 0.8 : 0.2) }
          if (touch) {
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] })
            await session.send("Input.dispatchTouchEvent", {
              type: "touchMove",
              touchPoints: [{ ...point, x: point.x + 12, id: 1 }],
            })
          } else {
            await page.mouse.move(point.x, point.y)
            await page.mouse.down()
            await page.mouse.move(point.x + 12, point.y, { steps: 3 })
          }
          await page.locator(".composer[data-drag]").waitFor()
          const strip = await page
            .locator(".drag-image[data-strip]")
            .evaluate((element) => ({ width: element.offsetWidth, height: element.offsetHeight }))
          assert.ok(strip.width > strip.height * 3)
          assert.equal(strip.height, Math.ceil((await source.locator("..").boundingBox()).height))
          if (touch)
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...end, id: 1 }] })
          else await page.mouse.move(end.x, end.y, { steps: 8 })
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".page-list > li")].every((row) =>
              row.getAnimations().every((animation) => animation.playState === "finished"),
            ),
          )
          const settled = await target.locator(".list-choice").evaluate((choice) => {
              const row = choice.closest(".list-row"),
                list = row.closest(".page-list")
              const bounds = choice.getBoundingClientRect()
              // Drop hit testing uses layout coordinates while neighboring rows animate.
              return {
                x: bounds.x,
                width: bounds.width,
                y: list.getBoundingClientRect().top - list.scrollTop + row.offsetTop + choice.offsetTop,
                height: choice.offsetHeight,
              }
            }),
            landing = { x: settled.x + settled.width / 2, y: settled.y + settled.height * (after ? 0.8 : 0.2) }
          if (touch)
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...landing, id: 1 }] })
          else await page.mouse.move(landing.x, landing.y)
          await target.locator(`:scope[data-drop=${after ? "after" : "before"}]`).waitFor()
          if (await input.locator("[data-dragging]").count()) {
            assert.deepEqual(await rows.locator(".list-number strong").allTextContents(), [
              "1",
              "4",
              "5",
              "6",
              "7",
              "8",
              "9",
              "10",
            ])
            assert.equal(await page.locator(".drag-image .drag-number").innerText(), "2")
            assert.equal(await output.locator(".drop-number").innerText(), "2")
            assert.equal(await page.locator(".drag-image").count(), 1)
            assert.equal(await output.locator(".list-drop-preview").count(), 1)
          }
          if (touch) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
          else await page.mouse.up()
        }
        await move(
          input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }),
          rows.nth(1),
          false,
        )
        assert.equal(await rows.count(), 10)
        assert.deepEqual(
          await rows
            .locator(".list-choice")
            .allTextContents()
            .then((names) => names.slice(0, 4).map((name) => name.trim())),
          ["COVER", "COVER", "ITAL-CROS-79A4-WXGF", "ITAL-GUID-79A4-WXGX"],
        )
        assert.equal(await preparation.inputValue(), "")
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await move(output.getByRole("button", { name: "Select or drag Output page 1", exact: true }), rows.nth(3), true)
        const moved = await rows.evaluateAll((elements) => elements.map((element) => element.id))
        assert.equal(moved[3], ids[0])
        await page.waitForFunction(
          (id) =>
            document
              .getElementById(id)
              ?.getAnimations()
              .some(
                (animation) =>
                  animation.effect.getKeyframes().some((frame) => frame.boxShadow?.includes("inset")) &&
                  animation.currentTime >= animation.effect.getTiming().delay,
              ),
          ids[0],
        )
        assert.equal(await rows.count(), 10)
        assert.equal(await page.locator(".composer[data-drag], .drag-image, .list-row[data-drop]").count(), 0)
        await session?.detach()
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

async function blankList(browser, url, count, reducedMotion = "reduce") {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion })
  page.setDefaultTimeout(10000)
  await setup(page)
  await page.goto(url)
  await page.locator('.landing-recipe input[type="file"]').setInputFiles({
    name: "Blank pages.json",
    mimeType: "application/json",
    buffer: Buffer.from(
      JSON.stringify({
        version: 1,
        inputs: {},
        sources: {},
        parts: [
          { pages: Array.from({ length: count / 1000 }, () => ({ blank: { width: 80, height: 100 } })), copies: 1000 },
        ],
      }),
    ),
  })
  await page.getByRole("button", { name: "Apply recipe", exact: true }).click()
  await page.locator('.composer[aria-busy="false"]').waitFor()
  return { page, output: page.locator(".composition-output") }
}

test(
  "List windows 1,000 and 10,000 occurrences through scrolling, ranges, Page returns, and deletion",
  { timeout: 90000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium),
      observations = []
    try {
      for (const count of [1000, 10000]) {
        const { page, output } = await blankList(browser, server.resolvedUrls.local[0], count)
        const session = await page.context().newCDPSession(page)
        await session.send("Performance.enable")
        await session.send("Emulation.setCPUThrottlingRate", { rate: 4 })
        await page.evaluate(() => {
          window.listTasks = []
          window.listDelays = []
          window.listObserver = new PerformanceObserver((entries) =>
            window.listTasks.push(...entries.getEntries().map((entry) => entry.duration)),
          )
          window.listObserver.observe({ type: "longtask" })
          let previous = performance.now()
          window.listClock = setInterval(() => {
            const now = performance.now()
            window.listDelays.push(now - previous - 16)
            previous = now
          }, 16)
          window.listStarted = performance.now()
        })
        const before = await session.send("Performance.getMetrics")
        await tab(output, "List")
        const list = output.locator(".page-list"),
          rows = list.locator(".list-row")
        await rows.first().waitFor()
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const after = await session.send("Performance.getMetrics")
        const timing = await page.evaluate(() => {
          clearInterval(window.listClock)
          window.listObserver.disconnect()
          return {
            elapsed: performance.now() - window.listStarted,
            longestTask: Math.max(0, ...window.listTasks),
            eventLoopDelay: Math.max(0, ...window.listDelays),
          }
        })
        const layouts =
          after.metrics.find((metric) => metric.name === "LayoutCount").value -
          before.metrics.find((metric) => metric.name === "LayoutCount").value
        observations.push({ count, cpuThrottle: 4, mountedRows: await rows.count(), layouts, ...timing })
        assert.ok((await rows.count()) < 80, "Only the viewport and its margin mount")
        assert.ok(layouts < 30, "Entering List performs bounded layout work")
        assert.ok(timing.longestTask < 1500 && timing.eventLoopDelay < 1500, JSON.stringify(timing))
        await session.send("Emulation.setCPUThrottlingRate", { rate: 1 })
        await list.focus()
        await page.keyboard.press("End")
        await output.locator(`:is(.list-choice, .list-heading)[data-page="${count - 1}"]`).waitFor()
        assert.ok((await rows.count()) < 80)
        await page.keyboard.press("Shift+Home")
        assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), `1-${count}`)
        await page.keyboard.press("Escape")
        await list.focus()
        await page.keyboard.press("End")
        await output.getByRole("button", { name: `View Output page ${count}`, exact: true }).click()
        await output.locator(".page-scroll").focus()
        await page.keyboard.press("v")
        assert.equal(
          await output
            .locator(`:is(.list-choice, .list-heading)[data-page="${count - 1}"]`)
            .evaluate((element) => element === document.activeElement),
          true,
        )
        await page.keyboard.press("Delete")
        assert.equal(await outputCount(page).textContent(), `${count} pages`)
        await page.keyboard.press("-")
        await output.locator(`:is(.list-choice, .list-heading)[data-page="${count - 2}"]`).waitFor()
        assert.equal(await outputCount(page).textContent(), `${count - 1} pages`)
        assert.equal(
          await output
            .locator(`:is(.list-choice, .list-heading)[data-page="${count - 2}"]`)
            .evaluate((element) => element === document.activeElement),
          true,
        )
        await list.evaluate((element) => (element.scrollTop = 0))
        await output.locator(':is(.list-choice, .list-heading)[data-page="0"]').waitFor()
        assert.equal(
          await list.evaluate((element) => element === document.activeElement),
          true,
          "Wheel-style scrolling retains the List keyboard owner",
        )
        await list.evaluate((element) => (element.scrollTop = element.scrollHeight))
        await output.locator(`:is(.list-choice, .list-heading)[data-page="${count - 2}"]`).waitFor()
        assert.ok((await rows.count()) < 80)
        await session.detach()
        await page.close()
      }
      await mkdir("../.local/var/performance/xray", { recursive: true })
      await writeFile("../.local/var/performance/xray/list.json", JSON.stringify(observations, null, 2) + "\n")
    } finally {
      await browser.close()
    }
  },
)

test(
  "Bulk List feedback clears complete batches and permits immediate edits and motion interruption",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const { page, output } = await blankList(browser, server.resolvedUrls.local[0], 1000, "no-preference")
      await tab(output, "List")
      const selection = output.getByLabel("Page selection", { exact: true })
      await selection.fill("1-1000")
      await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
      assert.equal(await outputCount(page).textContent(), "2000 pages")
      await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
      assert.equal(await outputCount(page).textContent(), "3000 pages")
      await page.emulateMedia({ reducedMotion: "reduce" })
      await page.waitForFunction(() => !document.querySelector(".list-row[data-arriving]"))
      await page.emulateMedia({ reducedMotion: "no-preference" })
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await outputCount(page).textContent(), "2000 pages")
      await selection.fill("1-1000")
      await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
      await page.waitForFunction(() => !document.querySelector(".list-row[data-arriving]"))
      await output.locator(".page-list").evaluate((element) => (element.scrollTop = 0))
      await output.locator(':is(.list-choice, .list-heading)[data-page="0"]').waitFor()
      assert.equal(await output.locator(".list-row[data-arriving]").count(), 0)
      assert.ok((await output.locator(".list-row").count()) < 80)
    } finally {
      await browser.close()
    }
  },
)

test("Escape and scrolling cancel pending List previews without changing selection", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const { page, output } = await lists(browser, server.resolvedUrls.local[0])
    const selection = output.getByLabel("Page selection", { exact: true })
    await selection.fill("1,3")
    await page.clock.install()
    const view = output.getByRole("button", { name: "View Output page 2", exact: true })
    await view.hover()
    await page.keyboard.press("Escape")
    await page.clock.runFor(250)
    assert.equal(await page.locator(".page-peek").count(), 0)
    assert.equal(await selection.inputValue(), "1,3")
    await page.mouse.move(0, 0)
    await view.hover()
    await output.locator(".page-list").dispatchEvent("scroll")
    await page.clock.runFor(250)
    assert.equal(await page.locator(".page-peek").count(), 0)
    assert.equal(await selection.inputValue(), "1,3")
    await page.mouse.move(0, 0)
    await view.hover()
    const dataTransfer = await page.evaluateHandle(() => new DataTransfer())
    await output
      .getByRole("button", { name: "Select or drag Output page 2", exact: true })
      .dispatchEvent("dragstart", { dataTransfer })
    await page.clock.runFor(250)
    assert.equal(await page.locator(".page-peek").count(), 0)
    assert.equal(await selection.inputValue(), "1,3")
    await page.keyboard.press("Escape")
    await dataTransfer.dispose()
  } finally {
    await browser.close()
  }
})

test(
  "Input List windows wrapped page names and keeps the inspected row visible after resizing",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Named pages.pdf",
          mimeType: "application/pdf",
          buffer: fixture({
            prepared: false,
            count: 1000,
            metadata: Array.from({ length: 1000 }, (_, index) => ({
              name:
                index % 2
                  ? `Page ${index + 1}`
                  : `Page ${index + 1}: ` + "A long authored page name with several wrapped lines. ".repeat(4),
            })),
          }),
        })
      await page.locator('.composer[aria-busy="false"]').waitFor()
      const input = page.locator(".selection-panel")
      await tab(input, "List")
      const list = input.locator(".page-list")
      await input.getByLabel("Page selection", { exact: true }).fill("")
      await list.focus()
      await page.keyboard.press("End")
      await input.locator(':is(.list-choice, .list-heading)[data-page="999"]').waitFor()
      await page.keyboard.press("Shift+Home")
      assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1-1000")
      assert.ok((await input.locator(".list-row").count()) < 80)
      const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
      const from = await grip.boundingBox()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(from.x + from.width + 12, from.y + from.height / 2, { steps: 3 })
      await page.locator('.composer[data-drag="source"]').waitFor()
      await list.evaluate((element) => (element.scrollTop = 500 * 45))
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".selection-panel .list-choice")].some((row) => Number(row.dataset.page) > 100),
      )
      assert.equal(await grip.count(), 1, "The Input drag source survives scrolling out of its window")
      await page.keyboard.press("Escape")
      await page.mouse.up()
      assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1-1000")
      for (const [width, textSize, colorScheme] of [
        [1440, "100%", "light"],
        [1440, "100%", "dark"],
        [390, "200%", "light"],
        [390, "200%", "dark"],
      ]) {
        await page.setViewportSize({ width, height: 1100 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), textSize)
        await page.emulateMedia({ colorScheme })
        await list.focus()
        await page.keyboard.press("End")
        await page.keyboard.press("Home")
        await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').waitFor()
        const rows = await input.locator(".list-row").evaluateAll((elements) =>
          elements.slice(0, 4).map((row) => {
            const bounds = row.getBoundingClientRect(),
              icon = row.querySelector(".page-grip svg"),
              glyph = icon.getBBox()
            const center = new DOMPoint(glyph.x + glyph.width / 2, glyph.y + glyph.height / 2).matrixTransform(
              icon.getScreenCTM(),
            )
            return { y: bounds.y, height: bounds.height, iconOffset: center.y - bounds.y - bounds.height / 2 }
          }),
        )
        assert.ok(
          rows.every((row) => Math.abs(row.iconOffset) < 1),
          JSON.stringify(rows),
        )
        if (width === 1440) assert.ok(rows[0].height > rows[1].height, "Wide names retain their wrapping")
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await mkdir("../.local/tmp/web/xray", { recursive: true })
        await list.screenshot({ path: `../.local/tmp/web/xray/input-${width}-${colorScheme}.png` })
      }
    } finally {
      await browser.close()
    }
  },
)

test(
  "Input List switching reveals the inspected row when equal page counts keep the same cursor",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        const input = page.locator(".selection-panel")
        for (const name of ["Wrapped.pdf", "Short.pdf"]) {
          await page
            .locator('input[type="file"]')
            .first()
            .setInputFiles({
              name,
              mimeType: "application/pdf",
              buffer: fixture({
                prepared: false,
                count: 1000,
                metadata: Array.from({ length: 1000 }, () => ({
                  name: name === "Wrapped.pdf" ? "A wrapped page name with many words. ".repeat(8) : "Short name",
                })),
              }),
            })
          await input.locator(".input-current").filter({ hasText: name }).waitFor({ state: "attached" })
          await page.locator('.composer[aria-busy="false"]').waitFor()
          await tab(input, "List")
          await input.getByLabel("Page selection", { exact: true }).fill("2,4")
        }
        const list = input.locator(".page-list")
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        await list.evaluate((element) => (element.scrollTop = 22000))
        await page.waitForFunction(
          () => Number(document.querySelector(".selection-panel .list-choice")?.dataset.page) > 100,
        )
        for (const name of ["Wrapped.pdf", "Short.pdf"]) {
          await page.locator(".input-picker > summary").click()
          await input.locator(".input-choice button").filter({ hasText: name }).click()
          const first = input.locator(':is(.list-choice, .list-heading)[data-page="0"]')
          await first.waitFor()
          const row = await first.boundingBox(),
            area = await list.boundingBox()
          assert.ok(row.y >= area.y - 1 && row.y + row.height <= area.y + area.height + 1)
          assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "2,4")
          assert.equal(
            await page.locator(".input-picker > summary").evaluate((element) => element === document.activeElement),
            true,
          )
          assert.ok((await input.locator(".list-row").count()) < 80)
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test("Unmounted List details release preview ownership without clearing selection", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const { page, output } = await blankList(browser, server.resolvedUrls.local[0], 1000)
      await tab(output, "List")
      const selection = output.getByLabel("Page selection", { exact: true })
      await selection.fill("1,3")
      await output.getByRole("button", { name: "Details for Output page 1", exact: true }).click()
      await output.locator(".page-origin [popover]:popover-open").waitFor()
      const list = output.locator(".page-list")
      await list.evaluate((element) => (element.scrollTop = 22000))
      await output
        .getByRole("button", { name: "Details for Output page 1", exact: true })
        .waitFor({ state: "detached" })
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const visible = await page.waitForFunction(() => {
        const list = document.querySelector(".composition-output .page-list")
        const frame = list.getBoundingClientRect()
        return [...list.querySelectorAll(".list-choice")].find((row) => {
          const bounds = row.getBoundingClientRect()
          return bounds.top >= frame.top && bounds.bottom <= frame.bottom
        })?.dataset.page
      })
      const index = Number(await visible.jsonValue())
      await visible.dispose()
      await output.getByRole("button", { name: `View Output page ${index + 1}`, exact: true }).hover()
      await page.locator(".page-peek:popover-open").waitFor()
      await page.keyboard.press("Escape")
      assert.equal(await page.locator(".page-peek").count(), 0)
      assert.equal(await selection.inputValue(), "1,3")
    } finally {
      await browser.close()
    }
  }
})

test(
  "Large List drags retain their source across windows and drop at physical occurrence positions",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const { page, output } = await blankList(browser, server.resolvedUrls.local[0], 10000)
      await tab(output, "List")
      await output.getByLabel("Page selection", { exact: true }).fill("1-1000")
      const list = output.locator(".page-list"),
        grip = output.getByRole("button", { name: "Select or drag Output page 1", exact: true })
      const original = await grip.locator("..").getAttribute("id"),
        box = await grip.boundingBox(),
        area = await list.boundingBox()
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
      await page.mouse.down()
      await page.mouse.move(box.x + box.width + 12, box.y + box.height / 2, { steps: 3 })
      await page.locator('.composer[data-drag="output"]').waitFor()
      await list.evaluate((element) => (element.scrollTop = 5000 * 45))
      await page.mouse.move(area.x + area.width / 2, area.y + area.height - 8, { steps: 3 })
      await page.waitForFunction(
        () => document.querySelector(".composition-output .page-list").scrollTop > 5000 * 45 + 200,
      )
      assert.equal(await page.locator(`[id="${original}"]`).count(), 1, "Native drag source remains mounted")
      assert.ok(
        (await list.locator(".list-row").count()) < 80,
        "Skipped selected rows do not expand the mounted window",
      )
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2, { steps: 3 })
      await page.mouse.move(area.x + area.width / 2, area.y + area.height / 2)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const destination = await list.evaluate((element) => {
        const frame = element.getBoundingClientRect()
        const row = [...element.querySelectorAll(".list-row:not([data-dragging])")].find((item) => {
          const bounds = item.getBoundingClientRect()
          return bounds.y > frame.y + frame.height * 0.4 && bounds.bottom < frame.bottom
        })
        const bounds = row.querySelector(".list-choice").getBoundingClientRect()
        return {
          id: row.id,
          index: Number(row.dataset.index),
          x: bounds.x + bounds.width / 2,
          y: bounds.y + bounds.height * 0.85,
        }
      })
      await page.mouse.move(destination.x, destination.y, { steps: 5 })
      await page.mouse.move(destination.x, destination.y)
      await page.locator(`[id="${destination.id}"][data-drop="after"]`).waitFor()
      await page.mouse.up()
      await page.waitForFunction((id) => !document.getElementById(id)?.hasAttribute("data-dragging"), original)
      const moved = page.locator(`[id="${original}"]`)
      assert.equal(await moved.getAttribute("data-index"), String(destination.index - 999))
      assert.equal(await moved.getAttribute("aria-posinset"), String(destination.index - 998))
      assert.equal(await moved.getAttribute("aria-setsize"), "10000")
      assert.equal(await outputCount(page).textContent(), "10000 pages")
      assert.ok((await list.locator(".list-row").count()) < 80)
    } finally {
      await browser.close()
    }
  },
)

test(
  "List keeps a page at its previous viewport position after Page and Grid returns",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        for (const width of [810, 1440]) {
          const page = await browser.newPage({
            viewport: { width, height: 1080 },
            hasTouch: width === 810,
            reducedMotion: "reduce",
          })
          page.setDefaultTimeout(10000)
          await setup(page)
          await page.goto(server.resolvedUrls.local[0])
          await page
            .locator('input[type="file"]')
            .first()
            .setInputFiles({
              name: "Return.pdf",
              mimeType: "application/pdf",
              buffer: fixture({ prepared: false, count: 300 }),
            })
          const input = page.locator(".selection-panel"),
            output = page.locator(".composition-output")
          await input.getByLabel("Page selection", { exact: true }).fill("1-300")
          await input.getByRole("button", { name: "Add to Output", exact: true }).click()
          for (const [pane, name] of [
            [input, "Input"],
            [output, "Output"],
          ]) {
            const switcher = page
              .getByRole("navigation", { name: "Workspace view", exact: true })
              .getByRole("button", { name, exact: true })
            await selectPane(switcher)
            await tab(pane, "List")
            const field = pane.getByLabel("Page selection", { exact: true })
            await field.fill("209")
            await pane.getByRole("button", { name: `Go to page in ${name}`, exact: true }).click()
            await pane.getByRole("textbox", { name: `${name} page number`, exact: true }).fill("209")
            await pane.getByRole("textbox", { name: `${name} page number`, exact: true }).press("Enter")
            const row = pane.locator(
              ':is(.list-row, .list-section):has(:is(.list-choice, .list-heading)[data-page="208"])',
            )
            await row.waitFor()
            await row.evaluate((element) => {
              const list = element.closest(".page-list")
              list.scrollTop +=
                element.getBoundingClientRect().top - list.getBoundingClientRect().top - list.clientHeight / 3
            })
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            const before = await row.evaluate(
              (element) =>
                element.getBoundingClientRect().top - element.closest(".page-list").getBoundingClientRect().top,
            )
            for (const view of ["Page", "Grid"]) {
              if (view === "Page") await row.getByRole("button", { name: `View ${name} page 209`, exact: true }).click()
              else await tab(pane, view)
              await tab(pane, "List")
              await row.waitFor()
              await page.evaluate(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
              )
              const after = await row.evaluate(
                (element) =>
                  element.getBoundingClientRect().top - element.closest(".page-list").getBoundingClientRect().top,
              )
              assert.ok(
                Math.abs(after - before) < 1,
                JSON.stringify({ engine: engine.name(), width, name, view, before, after }),
              )
              assert.equal(await field.inputValue(), "209")
            }
          }
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Tablet page navigation retains folds, highlights returns, and resolves logical labels",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      const page = await browser.newPage({ viewport: { width: 810, height: 1080 }, hasTouch: true })
      page.setDefaultTimeout(8000)
      try {
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Navigation.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 6,
              labels: ["i", " Annex ", "1", "2", "3", "4"],
              outline: [
                { title: "First", page: 0 },
                { title: "Second", page: 3 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await input.locator(".grid-inspect").first().waitFor()
        const fold = input.getByRole("button", { name: "Fold all Input sections", exact: true })
        if (await fold.count()) await fold.click()
        await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 2)
        await input.locator(".grid-inspect").first().click()
        await tab(input, "Grid")
        assert.equal(await input.locator(".composition-card:not([inert])").count(), 2)
        assert.ok(
          await input
            .locator(".composition-card")
            .first()
            .evaluate((e) => e.getAnimations({ subtree: true }).some((a) => a.id === "jump")),
        )
        await input.locator(".page-origin > button").first().click()
        const detail = input.locator(".page-origin-info").first()
        assert.ok(await detail.evaluate((e) => e.getBoundingClientRect().height < 400))
        await detail.getByRole("button", { name: "Go to section: First", exact: true }).click()
        assert.ok(
          await input
            .locator(".composition-card")
            .first()
            .evaluate((e) => e.getAnimations({ subtree: true }).some((a) => a.id === "jump")),
        )
        await input.getByRole("button", { name: "Go to page in Input", exact: true }).click()
        const physical = input.getByRole("textbox", { name: "Input page number", exact: true })
        assert.ok(await physical.evaluate((e) => e.getBoundingClientRect().width < 80))
        const logical = input.getByRole("textbox", { name: "Input page label", exact: true })
        const navigation = await input.locator(".page-destination-panel:popover-open").evaluate((panel) => {
          const physical = getComputedStyle(panel.querySelector(".page-destination-heading label")),
            logical = getComputedStyle(panel.querySelector(".logical-heading")),
            number = getComputedStyle(panel.querySelector("input")),
            caption = getComputedStyle(panel.querySelector("small"))
          return {
            headings: [physical.fontSize, logical.fontSize],
            divider: logical.borderBlockStartWidth,
            colors: [number.color, caption.color],
            ink: getComputedStyle(panel).color,
          }
        })
        assert.equal(navigation.headings[0], navigation.headings[1])
        assert.equal(navigation.divider, "1px")
        assert.equal(navigation.colors[0], navigation.colors[1])
        assert.notEqual(navigation.colors[0], navigation.ink)
        for (const size of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), size)
          const alignment = await input.locator(".page-destination-panel:popover-open").evaluate((panel) => {
            const rows = [...panel.querySelectorAll(".page-destination-row")]
            return {
              rows: rows.map((row) => {
                const go = row.querySelector(".step svg").getBoundingClientRect()
                return [...row.querySelectorAll(":scope > button")].map((button) => {
                  const icon = button.querySelector("svg").getBoundingClientRect()
                  const label = button.querySelector("small").getBoundingClientRect()
                  return {
                    offset: Math.abs(icon.y + icon.height / 2 - go.y - go.height / 2),
                    gap: label.y - icon.bottom,
                  }
                })
              }),
              gap:
                panel.querySelector(".logical-heading").getBoundingClientRect().y -
                rows[0].getBoundingClientRect().bottom,
            }
          })
          for (const buttons of alignment.rows)
            for (const button of buttons) {
              assert.ok(button.offset < 1, `${engine.name()}: navigation icon centers differ by ${button.offset}px`)
              assert.ok(button.gap >= 0, "Page labels stay below navigation icons")
            }
          assert.ok(alignment.gap >= 12, "Physical and logical navigation have a clear gap")
        }
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await logical.fill("missing")
        await logical.press("Enter")
        assert.equal(await logical.getAttribute("aria-invalid"), "true")
        await logical.fill(" Annex ")
        await logical.press("Enter")
        await tab(input, "Page")
        assert.equal((await input.locator(".page-current").textContent()).trim(), "2")
        assert.equal(await input.locator(".counter-label > button").innerText(), "Annex")
        const controls = input.locator(".page-navigation")
        assert.equal(await controls.getByRole("button", { name: /Add Input page/ }).count(), 1)
        await tab(input, "List")
        assert.ok(
          await input
            .locator("li")
            .evaluateAll((rows) => rows.some((e) => e.getAnimations().some((a) => a.id === "jump"))),
        )
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        const bounds = await input.locator(".editing-toolbar").evaluate((e) => {
          const goto = e.querySelector(".page-destination").getBoundingClientRect()
          const toc = e.querySelector('[aria-label="Input contents"]').getBoundingClientRect()
          return { goto: goto.x, toc: toc.x }
        })
        assert.ok(bounds.goto > bounds.toc)
        await page.keyboard.press("Escape")
        const preparation = input.getByLabel("Page selection", { exact: true })
        await preparation.fill("2")
        await preparation.press("Enter")
        const output = page.locator(".composition-output")
        const switcher = page.getByRole("navigation", { name: "Workspace view", exact: true })
        await selectPane(switcher.getByRole("button", { name: "Output", exact: true }))
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Blank after last", exact: true }).click()
        await output.getByRole("button", { name: "Go to page in Output", exact: true }).click()
        const outputLabel = output.getByRole("textbox", { name: "Output page label", exact: true })
        await outputLabel.fill("")
        await outputLabel.press("Enter")
        assert.equal(await outputLabel.getAttribute("aria-invalid"), "true")
        await outputLabel.fill(" Annex ")
        await outputLabel.press("Enter")
        await tab(output, "Page")
        assert.equal((await output.locator(".page-current").textContent()).trim(), "1")
      } finally {
        await page.close()
        await browser.close()
      }
    }
  },
)

test("Compact List columns preserve title space independently of Page action spacing", async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      const widths =
        process.env.MAINZ_TEST_MODE === "full" ? [320, 375, 393, 428, 480, 481, 744] : [320, 428, 480, 481, 744]
      for (const width of widths) {
        await page.setViewportSize({ width, height: 1000 })
        await page.emulateMedia({ colorScheme: width % 2 ? "dark" : "light" })
        await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
        await tab(output, "List")
        const geometry = await output
          .locator(".list-section")
          .first()
          .evaluate((row) => {
            const title = row.querySelector(".list-heading").getBoundingClientRect()
            const actions = row.querySelector(".list-actions").getBoundingClientRect()
            const buttons = [...row.querySelectorAll(".list-actions button")]
              .filter((el) => el.checkVisibility())
              .map((el) => el.getBoundingClientRect())
            return {
              title: title.width,
              separate: title.right <= actions.left + 1,
              buttons: buttons.map(({ width, height }) => ({ width, height })),
              overlap: buttons.some((box, i) => i > 0 && box.left < buttons[i - 1].right - 1),
            }
          })
        assert.ok(geometry.separate && !geometry.overlap, JSON.stringify({ width, geometry }))
        assert.ok(
          geometry.buttons.every((box) => box.height >= 44),
          JSON.stringify(geometry),
        )
        if (width <= 428)
          assert.ok(
            geometry.buttons.every((box) => box.width === 32),
            JSON.stringify(geometry),
          )
        assert.equal(
          await output
            .locator(".list-edit-trigger")
            .first()
            .isVisible()
            .catch(() => false),
          width <= 480,
        )
        if (width >= 393) assert.ok(geometry.title >= 100, JSON.stringify({ width, geometry }))
        if (width === 393) {
          const trigger = output.locator(".list-edit-trigger").first()
          await trigger.press("Enter")
          const menu = output.locator(".list-edit-options:popover-open")
          assert.equal(await menu.getByRole("button").count(), 4)
          assert.equal(await menu.getByRole("button", { name: /earlier$/ }).isDisabled(), true)
          await page.keyboard.press("Escape")
          await menu.waitFor({ state: "hidden" })
          assert.equal(await trigger.evaluate((el) => el === document.activeElement), true)
          await trigger.click()
          const before = await outputCount(page).textContent()
          await menu.getByRole("button", { name: /^Duplicate Output/ }).click()
          assert.notEqual(
            await outputCount(page).textContent(),
            before,
            "The menu duplicates the same section as inline controls",
          )
          assert.equal(await output.locator(".list-edit-options:popover-open").count(), 0)
          const selection = output.getByLabel("Page selection", { exact: true })
          await selection.fill("2")
          const selected = await output
            .locator(".list-section")
            .first()
            .evaluate((row) => ({
              title: row.querySelector(".list-heading").getBoundingClientRect().width,
              actions: row.querySelector(".list-actions").getBoundingClientRect().width,
            }))
          assert.ok(selected.title >= geometry.title + 28, JSON.stringify({ geometry, selected }))
          assert.equal(selected.actions, 32, "Selection leaves only the Page inspection slot")
          await selection.fill("")
          const restored = await output.locator(".list-section").first().locator(".list-heading").boundingBox()
          assert.ok(
            Math.abs(restored.width - geometry.title) < 1,
            "Clearing Selection restores individual action space",
          )
        }
        if (width === 428) {
          await tab(output, "Page")
          assert.equal(
            await output
              .locator(".page-navigation .occurrence-actions button")
              .first()
              .evaluate((el) => el.getBoundingClientRect().width),
            44,
          )
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Output headings preserve activation snapshots and move their complete focused range",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
        name: "Sections.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          prepared: false,
          count: 12,
          outline: [
            { title: "First", page: 0 },
            { title: "Second", page: 6 },
          ],
        }),
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByLabel("Page selection", { exact: true }).fill("1-12")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(output, "List")
      const selection = output.getByLabel("Page selection", { exact: true })
      await selection.fill("8")
      const open = output.getByRole("button", { name: "Unfold all Output sections", exact: true })
      if (await open.isVisible()) await open.click()
      await output.locator('.list-heading[data-page="6"]').click({ modifiers: ["Control"] })
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await selection.inputValue(), "8")
      await tab(output, "List")
      await output.getByRole("button", { name: "Fold Output section: Second", exact: true }).click()
      await output.locator('.list-heading[data-page="6"]').dblclick()
      assert.equal(await selection.inputValue(), "8")
      await tab(output, "List")
      await selection.fill("")
      await output.locator('.list-heading[data-page="6"]').focus()
      await page.keyboard.press("Control+ArrowUp")
      const heading = output.locator('.list-heading[data-page="5"]')
      await heading.waitFor()
      assert.equal(await heading.locator(".list-current").textContent(), "Second")
      assert.equal(await heading.evaluate((element) => element === document.activeElement), true)
      await page.keyboard.press("Control+ArrowDown")
      assert.equal(
        await output.locator('.list-heading[data-page="6"]').evaluate((element) => element === document.activeElement),
        true,
      )
      await output.getByRole("button", { name: "Unfold Output section: Second", exact: true }).click()
      const rows = output.locator(".page-list > :is(.list-row, .list-section)")
      const original = await rows.evaluateAll((elements) => elements.map((element) => element.id))
      await output.locator('.list-heading[data-page="6"]').focus()
      await page.keyboard.press("Control+ArrowUp")
      assert.deepEqual(
        await rows.evaluateAll((elements) => elements.map((element) => element.id)),
        [...original.slice(0, 5), ...original.slice(6), original[5]],
        "An unfolded heading moves every occurrence in its section",
      )
      await page.keyboard.press("Control+ArrowDown")
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), original)
    } finally {
      await browser.close()
    }
  },
)

test("List keyboard ranges and inspection preserve their pane, selection, and focus", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const inputSelection = input.getByRole("textbox", { name: "Page selection", exact: true }),
        outputSelection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await tab(input, "List")
      await tab(output, "Page")
      await inputSelection.fill("")
      await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
      await page.keyboard.press("Shift+N")
      const navigation = {
        output: (await output.locator(".page-position").innerText()).replace(/\s/g, ""),
        input: await input.locator(".list-choice:focus").getAttribute("data-page"),
      }
      await inputSelection.fill("")
      await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
      await page.keyboard.press("Shift+ArrowDown")
      const inputRange = await inputSelection.inputValue()
      await tab(output, "List")
      await outputSelection.fill("")
      await output.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
      await page.keyboard.press("Shift+ArrowDown")
      const outputRange = await outputSelection.inputValue()
      await inputSelection.fill("1,4")
      await input.locator(':is(.list-choice, .list-heading)[data-page="1"]').dblclick()
      const inspected = {
        selection: await inputSelection.inputValue(),
        page: (await input.locator(".page-position").innerText()).replace(/\s/g, ""),
      }
      await tab(input, "List")
      const focus = []
      for (const [pane, selection] of [
        [input, inputSelection],
        [output, outputSelection],
      ]) {
        await selection.fill("1,2")
        await pane.locator(':is(.list-choice, .list-heading)[data-page="0"]').press("Space")
        focus.push(
          await pane
            .locator(':is(.list-choice, .list-heading)[data-page="1"]')
            .evaluate((element) => element === document.activeElement),
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

test("List details stay anchored and row highlights remain flat", { timeout: 90000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    let page
    try {
      page = await browser.newPage({ reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
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
            await selectPane(switcher)
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
                    contrast: [element, row.querySelector(".page-origin > button")].every(
                      (control) => getComputedStyle(control).color === foreground,
                    ),
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
              name === "Input" ? /Output\s+1× → 1/ : /dolor\.pdf\s+Original page\s+1/,
            )
            await page.keyboard.press("Escape")
            assert.equal(await details.count(), 0)
            assert.equal(await number.evaluate((element) => element === document.activeElement), true)
            await choice.focus()
            await page.keyboard.press("ArrowDown")
            assert.equal(
              await pane
                .locator(':is(.list-choice, .list-heading)[data-page="1"]')
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

test("List bounds long sequences and restores the surviving Output row", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
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
    await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
    await page.keyboard.press("End")
    assert.equal(
      await input
        .locator(':is(.list-choice, .list-heading)[data-page="239"]')
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await tab(input, "Grid")
    await tab(output, "List")
    await output.getByRole("button", { name: "Remove Output page 1", exact: true }).press("Enter")
    await page.waitForFunction(() =>
      document.activeElement?.matches('.composition-output :is(.list-choice, .list-heading)[data-page="0"]'),
    )
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
    await setup(page)
    const names = [
      "ITAL-ARCH-60A4-WXGF",
      "ITAL-ARCH-60A4-WXGF",
      "UNBROKEN".repeat(8),
      "MONO-SCUH-05A4-GXGC",
      "Details",
      "Reference",
    ]
    await page.route("**/magna.pdf", (route) =>
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
          await selectPane(switcher)
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
              if (selected) {
                if (name === "Output")
                  assert.ok(row.width > widths[index], `${label}: selection releases editing slots to the name`)
                else assert.ok(Math.abs(row.width - widths[index]) < 1, `${label}: Input actions retain their slots`)
              }
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

test("Landscape Lists keep native scrolling reachable through folding and rotation", async (t) => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 852, height: 393 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      page.setDefaultTimeout(5000)
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      for (const [width, height] of [
        [852, 393],
        [667, 375],
        [1133, 744],
      ]) {
        await page.setViewportSize({ width, height })
        for (const name of ["Input", "Output"]) {
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          const switcher = page.locator(".mobile-workspace-tabs")
          await selectPane(switcher.getByRole("button", { name, exact: true }))
          await tab(pane, "List")
          const viewport = pane.locator(".page-list")
          for (const folded of [true, false]) {
            const toggle = pane.getByRole("button", {
              name: `${folded ? "Fold" : "Unfold"} all ${name} sections`,
              exact: true,
            })
            if (await toggle.count()) await toggle.click()
            const geometry = await viewport.evaluate((el) => ({
              rect: el.getBoundingClientRect().toJSON(),
              height: el.clientHeight,
              extent: el.scrollHeight,
              footer: document.querySelector(".footnote").getBoundingClientRect().top,
              documentHeight: document.documentElement.scrollHeight,
              screen: innerHeight,
            }))
            const diagnostic = JSON.stringify({ engine: engine.name(), width, name, folded, geometry })
            t.diagnostic(`${engine.name()}, ${width}×${height}, ${name}, folded=${folded}`)
            assert.ok(geometry.documentHeight <= geometry.screen + 1 || geometry.height === 62, diagnostic)
            assert.ok(
              geometry.rect.bottom <= Math.min(geometry.footer, geometry.screen) && geometry.height >= 62,
              diagnostic,
            )
            if (geometry.extent > geometry.height + 1) {
              const box = await viewport.boundingBox()
              const scroll = async (delta) => {
                if (engine === chromium) await page.mouse.wheel(0, delta)
                // Playwright mobile WebKit exposes scrolling through the native DOM API, not wheel input.
                else await viewport.evaluate((el, amount) => el.scrollBy(0, amount), delta)
              }
              await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
              await scroll(10000)
              // The final virtualized rows acquire their actual heights when mounted.
              await page.waitForFunction(
                ({ el, count }) =>
                  [...el.querySelectorAll(".list-row, .list-section")].some(
                    (row) =>
                      Number(row.dataset.end ?? row.querySelector("[data-page]")?.dataset.page ?? row.dataset.index) ===
                      count - 1,
                  ),
                { el: await viewport.elementHandle(), count: name === "Input" ? 42 : 9 },
              )
              await page.evaluate(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
              )
              await scroll(1000)
              await page.waitForFunction(
                ({ el, count }) => {
                  const last = [...el.querySelectorAll(".list-row, .list-section")].at(-1)
                  if (!last) return false
                  const end = last.dataset.end ?? last.querySelector("[data-page]")?.dataset.page ?? last.dataset.index
                  return (
                    Number(end) === count - 1 &&
                    last.getBoundingClientRect().bottom <= el.getBoundingClientRect().bottom + 1
                  )
                },
                { el: await viewport.elementHandle(), count: name === "Input" ? 42 : 9 },
              )
              assert.equal(
                await page.evaluate(() => window.scrollY),
                0,
                "Native List scrolling does not move the document",
              )
              const last = viewport.locator(".list-row, .list-section").last()
              const bounds = await last.boundingBox()
              assert.ok(bounds.y + bounds.height <= box.y + box.height + 1, diagnostic)
              await scroll(-10000)
              await page.waitForFunction((el) => el.scrollTop <= 1, await viewport.elementHandle())
            }
          }
        }
      }
      await page.setViewportSize({ width: 393, height: 852 })
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      assert.equal(await page.getByRole("group", { name: "Document scroll controls", exact: true }).count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollHeight <= innerHeight + 1), true)
    } finally {
      await browser.close()
    }
  }
})
