// Checks List row layout, source markers, columns, and text enlargement sizing.

import { captureLayout, setup, selectPane, paneButton, outputCount, tab, fixture } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"
import { serve } from "./server.ts"
import { lists } from "./lists.js"

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
        if (process.env.MAINZ_CAPTURE_SCREENSHOTS)
          await page.screenshot({
            path: `../.local/tmp/web/layout/source-blocks/markers-${engine.name()}-${width}.png`,
          })
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
