// Checks full-page List inspection, whole-row focus, edit feedback, and native/touch transfers.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { tab, fixture } from "./browser.js"

test("List strips stay flat and follow their original grab point", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await chromium.launch()
  try {
    const { page, input } = await lists(browser, server.resolvedUrls.local[0], { reducedMotion: "no-preference" })
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    await selection.fill("")
    const grip = input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }),
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

test("List neighbors move around a stationary insertion slot", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await chromium.launch()
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
      browser = await chromium.launch()
    try {
      for (const view of ["Normal", "Compact", "List"]) {
        const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], {
          hasTouch: true,
          viewport: { width: 1920, height: 1200 },
        })
        if (view !== "List") {
          await tab(output, "Grid")
          await output.getByRole("button", { name: `${view} Output grid`, exact: true }).click()
        }
        const rows = output.locator(view !== "List" ? ".composition-card" : ".list-row"),
          selection = output.getByRole("textbox", { name: "Page selection", exact: true }),
          original = await rows.evaluateAll((elements) => elements.map((element) => element.id)),
          session = await page.context().newCDPSession(page)
        const numbers = () =>
          (view === "List" ? rows.locator(":scope:not([data-dragging])") : rows)
            .locator(".page-origin > button strong, .page-origin > summary strong")
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
  "List action pairs stay quiet until hover or focus and touch keeps a visible menu",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const { page, input, output } = await lists(browser, server.resolvedUrls.local[0])
        await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
        const source = input.locator(".list-row").nth(1),
          add = source.getByRole("button", { name: "Add Input page 2 to Output", exact: true })
        await page.mouse.move(0, 0)
        assert.equal(
          await source.locator(".list-inline-actions").evaluate((element) => getComputedStyle(element).opacity),
          "0",
        )
        await source.hover()
        assert.equal(
          await source.locator(".list-inline-actions").evaluate((element) => getComputedStyle(element).opacity),
          "1",
        )
        await add.hover()
        assert.deepEqual(
          await add.evaluate((element) => {
            const s = getComputedStyle(element)
            return [s.backgroundColor, s.boxShadow]
          }),
          ["rgba(0, 0, 0, 0)", "none"],
        )
        await page.mouse.move(0, 0)
        await add.focus()
        assert.equal(
          await source.locator(".list-inline-actions").evaluate((element) => getComputedStyle(element).opacity),
          "1",
        )
        await page.keyboard.press("Enter")
        assert.equal(await output.locator(".list-row").count(), 9)
        await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
        const rows = output.locator(".list-row"),
          row = rows.nth(1),
          toolbar = row.locator(".list-inline-actions")
        await page.mouse.move(0, 0)
        assert.equal(await toolbar.evaluate((element) => getComputedStyle(element).opacity), "0")
        assert.equal(await row.locator(".list-peek").evaluate((element) => getComputedStyle(element).opacity), "1")
        await row.hover()
        assert.equal(await toolbar.evaluate((element) => getComputedStyle(element).opacity), "1")
        const up = row.getByRole("button", { name: "Move Output page 2 earlier", exact: true }),
          down = row.getByRole("button", { name: "Move Output page 2 later", exact: true }),
          remove = row.getByRole("button", { name: "Remove Output page 2", exact: true }),
          duplicate = row.getByRole("button", { name: "Duplicate Output page 2", exact: true }),
          a = await up.boundingBox(),
          b = await down.boundingBox(),
          c = await remove.boundingBox(),
          d = await duplicate.boundingBox()
        assert.equal(b.x - a.x - a.width, 0)
        assert.equal(d.x - c.x - c.width, 0)
        assert.equal(c.x - b.x - b.width, 6)
        assert.equal(a.height, 32)
        await duplicate.hover()
        assert.deepEqual(
          await duplicate.evaluate((element) => {
            const style = getComputedStyle(element)
            return [style.backgroundColor, style.boxShadow]
          }),
          ["rgba(0, 0, 0, 0)", "none"],
        )
        await page.mouse.move(0, 0)
        await up.focus()
        assert.equal(await toolbar.evaluate((element) => getComputedStyle(element).opacity), "1")
        const id = await row.getAttribute("id")
        await page.keyboard.press("Enter")
        assert.equal(await rows.first().getAttribute("id"), id)
        await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("3")
        assert.equal(
          await output.getByRole("button", { name: "Unselect Output page 3", exact: true }).isVisible(),
          true,
        )
        await page.close()
        const touch = await lists(browser, server.resolvedUrls.local[0], {
          hasTouch: true,
          viewport: { width: 1200, height: 1100 },
        })
        await touch.input.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
        assert.equal(
          await touch.input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).isVisible(),
          true,
        )
        const menu = touch.output.getByRole("button", { name: "Actions for Output page 2", exact: true })
        assert.equal(await menu.isVisible(), true)
        await menu.click()
        const panel = touch.output.locator(".list-row-menu:popover-open")
        assert.equal(await panel.getByRole("button").count(), 4)
        for (const button of await panel.getByRole("button").all()) {
          const box = await button.boundingBox()
          assert.equal(box.width, 44)
          assert.equal(box.height, 44)
        }
        await touch.page.close()
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Normal Grid footer actions follow hover and focus while touch actions stay visible",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        for (const touch of [false, true]) {
          const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], { hasTouch: touch })
          await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
          await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
          for (const [pane, name] of [
            [input, "Input"],
            [output, "Output"],
          ]) {
            await tab(pane, "Grid")
            await pane.getByRole("button", { name: `Normal ${name} grid`, exact: true }).click()
            await pane.getByRole("textbox", { name: "Page selection", exact: true }).focus()
            await page.mouse.move(0, 0)
            const card = pane.locator(".composition-card").nth(1),
              buttons = card.locator(":scope > .input-footer button, :scope > .occurrence-actions button")
            const active =
              touch && name === "Output"
                ? card.getByRole("button", { name: /^Actions for Output page/ })
                : buttons.first()
            assert.equal(await active.evaluate((element) => getComputedStyle(element).opacity), touch ? "1" : "0")
            if (touch) assert.equal(await active.isVisible(), true)
            if (!touch) {
              await card.hover()
              assert.equal(await buttons.first().evaluate((element) => getComputedStyle(element).opacity), "1")
              await buttons.first().hover()
              assert.deepEqual(
                await buttons.first().evaluate((element) => {
                  const s = getComputedStyle(element)
                  return [s.backgroundColor, s.boxShadow]
                }),
                ["rgba(0, 0, 0, 0)", "none"],
              )
              await page.mouse.move(0, 0)
              await buttons.first().focus()
              assert.equal(await buttons.first().evaluate((element) => getComputedStyle(element).opacity), "1")
            }
          }
          if (touch) {
            await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).tap()
            assert.match(await output.locator(".composition-totals").innerText(), /9 pages/)
            await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
            const current = output.locator(".composition-card").first()
            await current.getByRole("button", { name: /^Actions for Output page/ }).tap()
            await current
              .locator(".occurrence-menu:popover-open")
              .getByRole("button", { name: /^Remove Output page/ })
              .tap()
            assert.match(await output.locator(".composition-totals").innerText(), /8 pages/)
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
  "Grid and List individual plus actions keep selection unchanged and share paired controls",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        for (const mode of ["List", "Grid"]) {
          const { page, input, output } = await lists(browser, server.resolvedUrls.local[0])
          if (mode === "Grid") {
            await tab(input, "Grid")
            await tab(output, "Grid")
          }
          const prepared = input.getByRole("textbox", { name: "Page selection", exact: true }),
            selection = output.getByRole("textbox", { name: "Page selection", exact: true })
          await prepared.fill("")
          await selection.fill("")
          await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).click()
          assert.equal(await selection.inputValue(), "")
          const rows = output.locator(mode === "List" ? ".list-row" : ".composition-card"),
            id = await rows.nth(1).getAttribute("id"),
            copy = output.getByRole("button", { name: "Duplicate Output page 2", exact: true })
          await copy.click()
          await copy.press("Enter")
          assert.equal(await selection.inputValue(), "")
          assert.match(await output.locator(".composition-totals").innerText(), /11 pages/)
          const row = rows.nth(1),
            pairs = row.locator(mode === "List" ? ".list-inline-actions" : ".card-inline-actions"),
            buttons = pairs.getByRole("button")
          const boxes = await buttons.evaluateAll((elements) =>
            elements.map((element) => {
              const b = element.getBoundingClientRect()
              return { x: b.x, y: b.y, width: b.width, height: b.height }
            }),
          )
          assert.equal(boxes.length, 4)
          assert.ok(boxes.every((box) => box.width === 32 && box.height === 32))
          assert.equal(boxes[1].x - boxes[0].x - boxes[0].width, 0)
          assert.equal(boxes[2].x - boxes[1].x - boxes[1].width, 6)
          assert.equal(boxes[3].x - boxes[2].x - boxes[2].width, 0)
          const bounds = await row.boundingBox()
          assert.ok(boxes[0].x >= bounds.x && boxes[3].x + boxes[3].width <= bounds.x + bounds.width)
          assert.ok(boxes.every((box) => Math.abs(box.y - boxes[0].y) < 1))
          assert.equal(
            await pairs
              .locator("svg")
              .evaluateAll((elements) => elements.every((element) => element.getBoundingClientRect().width === 16)),
            true,
          )
          await row.getByRole("button", { name: "Move Output page 2 later", exact: true }).click()
          assert.equal(await rows.nth(2).getAttribute("id"), id)
          await selection.fill("1")
          await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).click()
          assert.equal(await selection.inputValue(), "1")
          assert.equal(await prepared.inputValue(), "")
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "View returns reveal the inspected page across panes, Grid densities, tabs, and keyboard gestures",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1100 },
          reducedMotion: engine === chromium ? "no-preference" : "reduce",
        })
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.route("**/grid.pdf", (route) =>
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
          await pane.getByRole("button", { name: `View ${name} page 47`, exact: true }).click()
          await pane.getByRole("button", { name: `Next ${name} page`, exact: true }).click()
          const listTab = pane.getByRole("tab", { name: "List", exact: true })
          await listTab.click()
          const row = pane.locator('.list-choice[data-page="47"]'),
            item = row.locator("..")
          await item.locator(":scope[data-returning]").waitFor()
          assert.equal(await listTab.evaluate((element) => element === document.activeElement), true)
          const bounds = await item.boundingBox(),
            area = await pane.locator(".page-list").boundingBox()
          assert.ok(bounds.y >= area.y - 1 && bounds.y + bounds.height <= area.y + area.height + 1)
          assert.equal(await selection.inputValue(), "1,3")
          assert.equal(await page.locator(".page-peek:popover-open").count(), 0)
          assert.match(await item.evaluate((element) => getComputedStyle(element).boxShadow), /inset/)
          if (engine === webkit) assert.equal(await item.evaluate((element) => element.getAnimations().length), 0)
          await item.locator(":scope[data-returning]").waitFor({ state: "detached" })
          await row.focus()
          await page.keyboard.press("v")
          await pane.getByRole("button", { name: `Previous ${name} page`, exact: true }).click()
          await pane.locator(".page-scroll").focus()
          await page.keyboard.press("v")
          let current = 46
          const choice = pane.locator(`.list-choice[data-page="${current}"]`)
          assert.equal(await choice.evaluate((element) => element === document.activeElement), true)
          assert.equal(await pane.locator("[data-returning]").count(), 0)
          assert.equal(await selection.inputValue(), "1,3")
          await tab(pane, "Grid")
          for (const density of ["Normal", "Compact"]) {
            await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
            let card = pane.locator(`.page-image[data-page="${current}"]`)
            await card.click({ modifiers: ["Control"] })
            assert.equal(await selection.inputValue(), "1,3")
            await pane.getByRole("button", { name: `Next ${name} page`, exact: true }).click()
            current++
            const gridTab = pane.getByRole("tab", { name: "Grid", exact: true })
            await gridTab.click()
            card = pane.locator(`.page-image[data-page="${current}"]`)
            await card.locator("..").locator(":scope[data-returning]").waitFor()
            assert.equal(await gridTab.evaluate((element) => element === document.activeElement), true)
            assert.equal(await pane.getAttribute("data-density"), density.toLowerCase())
            await card.click({ modifiers: ["Meta"] })
            await pane.locator(".page-scroll").focus()
            await page.keyboard.press("v")
            assert.equal(await card.evaluate((element) => element === document.activeElement), true)
            assert.equal(await pane.locator("[data-returning]").count(), 0)
            assert.equal(await selection.inputValue(), "1,3")
          }
          await listTab.click()
          await pane
            .locator(`.list-choice[data-page="${current}"]`)
            .locator("..")
            .locator(":scope[data-returning]")
            .waitFor()
          assert.equal(await listTab.evaluate((element) => element === document.activeElement), true)
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
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const { page, input, output } = await lists(browser, server.resolvedUrls.local[0])
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true }),
          selection = output.getByRole("textbox", { name: "Page selection", exact: true }),
          rows = output.locator(".list-row")
        await preparation.fill("")
        await input.locator('.list-choice[data-page="0"]').focus()
        await page.keyboard.press("ArrowDown")
        await page.keyboard.press("Shift+ArrowDown")
        assert.equal(await preparation.inputValue(), "2-3")
        await page.keyboard.press("Shift+P")
        assert.equal(await preparation.inputValue(), "2-3", "N/P retain Grid navigation without extending selection")
        await page.keyboard.press("Enter")
        assert.equal(await rows.count(), 10)
        assert.equal(await preparation.inputValue(), "")
        await input.locator('.list-choice[data-page="1"]').dispatchEvent("keydown", { key: "Enter", repeat: true })
        assert.equal(await rows.count(), 10)
        await page.keyboard.press("Shift+=")
        assert.equal(await rows.count(), 11)
        await selection.fill("")
        const before = await rows.evaluateAll((elements) => elements.map((element) => element.id))
        await output.locator('.list-choice[data-page="0"]').focus()
        await page.keyboard.press("Control+ArrowDown")
        assert.equal(await rows.nth(1).getAttribute("id"), before[0])
        await page.keyboard.press("Meta+ArrowUp")
        assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), before)
        await page.keyboard.press("Enter")
        assert.equal(await rows.count(), 12)
        await page.keyboard.press("-")
        assert.equal(await rows.count(), 11)
        await selection.fill("")
        await output.locator('.list-choice[data-page="0"]').focus()
        await page.keyboard.press("Shift+=")
        assert.equal(await rows.count(), 12)
        await page.keyboard.press("Delete")
        assert.equal(await rows.count(), 11)
        await output.locator('.list-choice[data-page="0"]').focus()
        await page.keyboard.press("PageDown")
        assert.equal(
          await output
            .locator('.list-choice[data-page="10"]')
            .evaluate((element) => element === document.activeElement),
          true,
        )
        await page.keyboard.press("Home")
        assert.equal(
          await output.locator('.list-choice[data-page="0"]').evaluate((element) => element === document.activeElement),
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
      browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
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
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), before)
      await page.keyboard.press("Escape")
      await page.mouse.up()
      assert.equal(await selection.inputValue(), "1,3")
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), before)
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
      browser = await chromium.launch()
    try {
      const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], {
        hasTouch: true,
        isMobile: true,
      })
      await page.setViewportSize({ width: 390, height: 1000 })
      const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
      await views.getByRole("button", { name: "Input", exact: true }).tap()
      const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("1,3")
      const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
      await grip.scrollIntoViewIfNeeded()
      const from = await grip.boundingBox(),
        to = await views.getByRole("button", { name: "Output", exact: true }).boundingBox(),
        session = await page.context().newCDPSession(page),
        point = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
      await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ ...point, id: 1 }] })
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
      await views.getByRole("button", { name: "Input", exact: true }).tap()
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
  await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
  await page.goto(`${url}?demo`)
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
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        const name = "ITAL-" + "LONG-SHEET-CODE-".repeat(12)
        await page.route("**/grid.pdf", (route) =>
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
          for (const density of ["Normal", "Compact"]) {
            const title = pane === input ? "Input" : "Output"
            await pane.getByRole("button", { name: `${density} ${title} grid`, exact: true }).click()
            const row = pane.locator(".composition-card").nth(1),
              number = row.locator(".page-origin > button, .page-origin > summary")
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
                  !!card.querySelector(".card-menu-options:popover-open, .page-origin[open]")
                )
              }),
              true,
            )
            const details = row.locator(".card-menu-options:popover-open, .page-origin[open] .page-origin-info")
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
            if (await row.locator(".page-origin[open]").count()) await number.click()
          }
          await tab(pane, "List")
          const title = pane === input ? "Input" : "Output"
          await pane.getByRole("button", { name: `Details for ${title} page 2`, exact: true }).click()
          const details = pane.locator(".card-menu-options:popover-open")
          assert.equal(await details.getByRole("button").count(), 0)
          await page.keyboard.press("Escape")
          await pane.getByRole("button", { name: `View ${title} page 2`, exact: true }).click()
          const number = pane.getByRole("button", { name: `Go to ${title} page`, exact: true })
          await page.mouse.move(0, 0)
          const caption = pane.locator(".inspection-heading .page-name")
          assert.equal(await caption.isVisible(), false)
          await number.hover()
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
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
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
        const row = pane.locator('.list-choice[data-page="1"]')
        assert.equal(await row.evaluate((element) => element === document.activeElement), true)
        await page.keyboard.press("v")
        await pane.getByRole("button", { name: `Next ${name} page`, exact: true }).click()
        await pane.locator(".page-scroll").focus()
        await page.keyboard.press("v")
        assert.equal(
          await pane.locator('.list-choice[data-page="2"]').evaluate((element) => element === document.activeElement),
          true,
        )
        assert.equal(await selection.inputValue(), "1,4")
        await pane.locator('.list-choice[data-page="1"]').dblclick()
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
              .locator('.list-choice[data-page="2"]')
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
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      await output.getByRole("button", { name: "Actions for Output page 2", exact: true }).click()
      await output.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).click()
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
      browser = await chromium.launch()
    try {
      const { page, input, output } = await lists(browser, server.resolvedUrls.local[0], {
        reducedMotion: "no-preference",
      })
      const inputSelection = input.getByRole("textbox", { name: "Page selection", exact: true }),
        outputSelection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await inputSelection.fill("")
      await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).click()
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
      await output.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).click()
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), [
        before[1],
        before[0],
        ...before.slice(2),
      ])
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".page-list > li")].some((element) => element.getAnimations().length),
      )
      await output.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
      assert.equal(await rows.count(), 8)
      const outgoing = output.locator(".list-row.removing")
      await outgoing.waitFor()
      assert.equal(await outgoing.evaluate((element) => element.inert), true)
      await outgoing.waitFor({ state: "detached" })
      await page.emulateMedia({ reducedMotion: "reduce" })
      await input.getByRole("button", { name: "Add Input page 3 to Output", exact: true }).click()
      assert.equal(await rows.count(), 9)
      assert.equal(
        await rows.evaluateAll((elements) => elements.some((element) => element.getAnimations().length)),
        false,
      )
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
      browser = await chromium.launch()
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
          const settled = await target.locator(".list-choice").boundingBox(),
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
          ["Cover", "Cover", "ITAL-CROS-79A4-WXGF", "ITAL-GUID-79A4-WXGX"],
        )
        assert.equal(await preparation.inputValue(), "")
        await move(output.getByRole("button", { name: "Select or drag Output page 1", exact: true }), rows.nth(3), true)
        const moved = await rows.evaluateAll((elements) => elements.map((element) => element.id))
        assert.equal(moved[3], ids[0])
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
