// Checks List previews, native and touch transfers, drops, and edit animations.

import { setup, selectPane, outputCount, tab, fixture } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { serve } from "./server.ts"
import { lists, blankList } from "./lists.js"

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
  "Output List shows drop indicators on expanded section headings and trailing folded sections",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
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
        await output.getByLabel("Page selection", { exact: true }).fill("")
        const unfoldAll = output.getByRole("button", { name: "Unfold all Output sections", exact: true })
        if (await unfoldAll.isVisible()) await unfoldAll.click()
        const second = output.locator('.list-section:has(.list-heading[data-page="6"])')
        await second.waitFor()
        const grip = output.getByRole("button", { name: "Select or drag Output page 2", exact: true })
        const movedId = await grip.locator("..").getAttribute("id")
        const gripBox = await grip.boundingBox()
        await page.mouse.move(gripBox.x + gripBox.width / 2, gripBox.y + gripBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(gripBox.x + gripBox.width + 12, gripBox.y + gripBox.height / 2, { steps: 3 })
        await page.locator('.composer[data-drag="output"]').waitFor()
        const headingBox = await second.locator(".list-heading").boundingBox()
        const headingTargetX = headingBox.x + headingBox.width / 2
        const headingTargetY = headingBox.y + headingBox.height * 0.85
        await page.mouse.move(headingTargetX, headingTargetY, { steps: 1 })
        await page.mouse.move(headingTargetX, headingTargetY)
        await second.locator(':scope[data-drop="before"] > .list-drop-preview[data-drop="before"]').waitFor()
        await page.keyboard.press("Escape")
        await page.waitForFunction(() => !document.querySelector(".composer[data-drag]"))
        await page.mouse.up()
        await output.getByRole("button", { name: "Fold Output section: Second", exact: true }).click()
        const listBox = await output.locator(".page-list").boundingBox()
        const retryBox = await grip.boundingBox()
        await page.mouse.move(retryBox.x + retryBox.width / 2, retryBox.y + retryBox.height / 2)
        await page.mouse.down()
        await page.mouse.move(retryBox.x + retryBox.width + 12, retryBox.y + retryBox.height / 2, { steps: 3 })
        await page.locator('.composer[data-drag="output"]').waitFor()
        const foldedBox = await second.boundingBox()
        const appendX = foldedBox.x + foldedBox.width / 2
        const appendY = Math.min(foldedBox.y + foldedBox.height + 24, listBox.y + listBox.height - 8)
        await page.mouse.move(appendX, appendY, { steps: 1 })
        await page.mouse.move(appendX, appendY)
        await second.locator(':scope[data-drop="after"] > .list-drop-preview[data-drop="after"]').waitFor()
        await page.mouse.up()
        await page.waitForFunction(() => !document.querySelector(".composer[data-drag]"))
        assert.equal(await outputCount(page).textContent(), "12 pages")
        const lastRow = output.locator(".page-list > :is(.list-row, .list-section)").last()
        assert.equal(await lastRow.getAttribute("id"), movedId)
        assert.equal(await lastRow.locator(".list-choice").getAttribute("data-page"), "11")
      } finally {
        await browser.close()
      }
    }
  },
)
