// Checks native and touch transfer cancellation, large Output ordering, and workspace lifecycle boundaries.

import { setup, selectPane } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { outputCount, fixture, tab } from "./browser.js"

test("Native page drags survive platform focus changes and cards respond on press", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    for (const [width, height] of [
      [1920, 960],
      [2560, 1321],
    ]) {
      for (const mode of ["Grid"]) {
        const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "no-preference" })
        await setup(page)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await tab(input, mode)
        const source = input.locator(".page-image").first()
        const card = input.locator(".composition-card").first()
        const selected = input.getByLabel("Page selection", { exact: true })
        const selection = await selected.inputValue()
        const from = await source.boundingBox(),
          to = await output.locator(".composition-empty").boundingBox()
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
        await page.mouse.down()
        await card.evaluate((element) =>
          Promise.allSettled(element.getAnimations().map((animation) => animation.finished)),
        )
        assert.deepEqual(
          await card.evaluate((element) => {
            const style = getComputedStyle(element)
            return [style.rotate, style.scale, style.opacity]
          }),
          ["-2deg", "0.98", "0.6"],
        )
        assert.equal(await selected.inputValue(), selection, "Pressing does not change selection")
        assert.equal(await outputCount(page).textContent(), "0 pages")
        await page.mouse.move(from.x + from.width / 2 + 15, from.y + from.height / 2, { steps: 3 })
        await page.locator('.composer[data-drag="source"]').waitFor()
        await page.evaluate(() => window.dispatchEvent(new Event("blur")))
        assert.equal(
          await page.locator('.composer[data-drag="source"]').count(),
          1,
          "Platform blur preserves native dragging",
        )
        await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
        await output.locator(".drop-placeholder").waitFor()
        await page.mouse.up()
        await output
          .locator(".composition-totals strong")
          .filter({ hasText: /^1 page$/ })
          .waitFor()
        assert.equal(await page.locator(".composer[data-drag], .drag-image, [data-press]").count(), 0)
        await page.close()
      }
    }
  } finally {
    await browser.close()
  }
})

test("Touch grip press previews the card without editing and cancellation clears it", async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    for (const reducedMotion of ["no-preference", "reduce"]) {
      const page = await browser.newPage({
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: true,
        reducedMotion,
      })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
      const input = page.locator(".selection-panel")
      const card = input.locator(".composition-card").first(),
        grip = card.locator(".page-grip")
      const selection = await input.getByLabel("Page selection", { exact: true }).inputValue()
      await grip.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0 })
      await card.evaluate((element) =>
        Promise.allSettled(element.getAnimations().map((animation) => animation.finished)),
      )
      assert.deepEqual(
        await card.evaluate((element) => {
          const style = getComputedStyle(element)
          return [style.rotate, style.scale, style.opacity]
        }),
        reducedMotion === "reduce" ? ["none", "none", "0.6"] : ["-2deg", "0.98", "0.6"],
      )
      assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), selection)
      assert.equal(await page.locator(".composer[data-drag]").count(), 0, "Pressing alone does not start a transfer")
      await page.evaluate(() => window.dispatchEvent(new Event("blur")))
      assert.equal(await input.locator("[data-press]").count(), 0, "Touch blur still cancels a pending press")
      await card.evaluate((element) =>
        Promise.allSettled(element.getAnimations().map((animation) => animation.finished)),
      )
      assert.equal(await card.evaluate((element) => getComputedStyle(element).opacity), "1")
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test(
  "Large Output transfers preserve offscreen selections across cancellation and drop",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const method of ["native", "touch"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "Large.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ prepared: false, count: 10 }),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await input.getByLabel("Page selection", { exact: true }).fill("1-10")
        await input.getByLabel("Input page actions", { exact: true }).click()
        await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        const viewport = output.locator(".grid-view")
        await viewport.evaluate((element) => {
          const style = getComputedStyle(element.querySelector(".composition-grid"))
          element.scrollTop =
            element.scrollHeight -
            element.clientHeight -
            2 * (parseFloat(style.gridAutoRows) + parseFloat(style.rowGap))
        })
        await page.waitForFunction(
          () => Number(document.querySelector(".composition-output .composition-grid")?.dataset.from) > 9000,
        )
        const positions = await output.locator(".output-pages").evaluate((grid) => {
          const frame = grid.parentElement.getBoundingClientRect()
          return [...grid.querySelectorAll(".composition-card")]
            .filter((card) => {
              const bounds = card.getBoundingClientRect()
              return bounds.top >= frame.top && bounds.bottom <= frame.bottom
            })
            .map((card) => Number(card.querySelector(".page-image").dataset.page) + 1)
        })
        const from = positions[0],
          to = positions.at(-1)
        assert.ok(from > 9000 && to > from + 1)
        const selection = output.getByLabel("Page selection", { exact: true })
        await selection.fill(`1,${from}`)
        const original = await selection.inputValue()
        for (const cancelled of [true, false]) {
          const result = await output.locator(".output-pages").evaluate(
            async (grid, { pointer, cancel, from }) => {
              const source = grid
                  .querySelector(`.page-image[data-page="${from - 1}"]`)
                  ?.closest(".composition-card")
                  ?.querySelector(".page-grip"),
                box = source.getBoundingClientRect()
              const data = new DataTransfer(),
                contact = { pointerId: 7, pointerType: "touch", isPrimary: true, button: 0, buttons: 1 }
              const start = {
                bubbles: true,
                cancelable: true,
                clientX: box.x + box.width / 2,
                clientY: box.y + box.height / 2,
              }
              if (pointer === "native")
                source.dispatchEvent(new DragEvent("dragstart", { ...start, dataTransfer: data }))
              else source.dispatchEvent(new PointerEvent("pointerdown", { ...start, ...contact }))
              const over = async (bounds) => {
                const point = {
                  bubbles: true,
                  cancelable: true,
                  clientX: bounds.x + bounds.width / 4,
                  clientY: bounds.y + bounds.height / 2,
                }
                if (pointer === "native")
                  grid.dispatchEvent(new DragEvent("dragover", { ...point, dataTransfer: data }))
                else window.dispatchEvent(new PointerEvent("pointermove", { ...point, ...contact }))
                await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
                return point
              }
              const frame = grid.parentElement.getBoundingClientRect()
              const visible = [...grid.querySelectorAll(".composition-card")].filter((card) => {
                const bounds = card.getBoundingClientRect()
                return bounds.top >= frame.top && bounds.bottom <= frame.bottom
              })
              await over(visible[0].getBoundingClientRect())
              const blocked = !grid.querySelector(".drop-placeholder")
              const point = await over(visible.at(-1).getBoundingClientRect())
              const preview = !!grid.querySelector(".drop-placeholder")
              if (cancel) window.dispatchEvent(new Event("resize"))
              else if (pointer === "native") grid.dispatchEvent(new DragEvent("drop", { ...point, dataTransfer: data }))
              else window.dispatchEvent(new PointerEvent("pointerup", { ...point, ...contact }))
              return { blocked, preview }
            },
            { pointer: method, cancel: cancelled, from },
          )
          assert.deepEqual(result, { blocked: true, preview: true }, method)
          await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          assert.equal(await selection.inputValue(), cancelled ? original : `${to - 2}-${to - 1}`, method)
          assert.equal(await outputCount(page).textContent(), "10000 pages")
        }
        await page.close()
      }
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Interrupted transfers release their previews and leave subsequent actions usable",
  { timeout: 60000 },
  async (t) => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await outputCount(page).filter({ hasText: "8 pages" }).waitFor()
      await input.getByLabel("Page selection", { exact: true }).fill("")
      for (const pointer of ["native", "touch"]) {
        for (const interruption of [
          pointer === "native" ? "hidden" : "blur",
          "resize",
          "pointercancel",
          "secondary",
          "home",
        ]) {
          if (pointer === "native" && ["pointercancel", "secondary"].includes(interruption)) continue
          t.diagnostic(`${pointer}: ${interruption}`)
          let dataTransfer
          const contact = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, clientX: 200, clientY: 500 }
          if (pointer === "native") {
            dataTransfer = await page.evaluateHandle(() => new DataTransfer())
            await input
              .getByRole("button", { name: "Select Input page 1", exact: true })
              .dispatchEvent("dragstart", { dataTransfer })
          } else {
            await input
              .getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
              .dispatchEvent("pointerdown", contact)
            await page.locator("body").dispatchEvent("pointermove", { ...contact, clientX: 220 })
          }
          await page.locator('.composer[data-drag="source"]').waitFor()
          if (interruption === "hidden")
            await page.evaluate(() => {
              Object.defineProperty(document, "hidden", { configurable: true, value: true })
              document.dispatchEvent(new Event("visibilitychange"))
              delete document.hidden
            })
          else if (interruption === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")))
          else if (interruption === "resize") {
            await page.setViewportSize({ width: 1430, height: 990 })
            await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          } else if (interruption === "pointercancel")
            await page.locator("body").dispatchEvent("pointercancel", contact)
          else if (interruption === "secondary")
            await page.locator("body").dispatchEvent("pointerdown", { ...contact, pointerId: 8, isPrimary: false })
          else {
            await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
            await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          }
          assert.equal(
            await page.locator(".composer[data-drag]").count(),
            0,
            `${pointer}: ${interruption} ends the session`,
          )
          assert.equal(await page.locator(".drag-image, [data-press]").count(), 0)
          if (interruption === "home") {
            await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
            await outputCount(page).filter({ hasText: "8 pages" }).waitFor()
            await input.getByLabel("Page selection", { exact: true }).fill("")
          } else {
            if (dataTransfer) await output.dispatchEvent("drop", { dataTransfer })
            else await output.dispatchEvent("pointerup", contact)
            assert.equal(await outputCount(page).textContent(), "8 pages")
            await input.getByRole("button", { name: "Select Input page 1", exact: true }).click()
            assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1")
            await input.getByLabel("Page selection", { exact: true }).fill("")
          }
          await page.setViewportSize({ width: 1440, height: 1000 })
          // Finish resize cancellation before starting the next independent gesture.
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
        }
      }
    } finally {
      await browser?.close()
    }
  },
)

test("Section ribbons show four-dot press feedback and drag complete groups", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(8000)
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Group.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          prepared: false,
          count: 5,
          outline: [
            { title: "First", page: 0 },
            { title: "Second", page: 3 },
          ],
        }),
      })
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    await tab(input, "List")
    const ribbon = input.getByRole("button", { name: "Fold Input section: First", exact: true })
    await ribbon.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 99, isPrimary: true, button: 0 })
    assert.equal(await ribbon.getAttribute("data-press"), "")
    assert.match(await ribbon.locator(".ribbon-dots").evaluate((element) => getComputedStyle(element).display), /flex/)
    await page.evaluate(() => window.dispatchEvent(new Event("blur")))
    assert.equal(await ribbon.getAttribute("data-press"), null)
    const from = await ribbon.boundingBox()
    const to = await output.locator(".composition-empty").boundingBox()
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
    await page.mouse.down()
    await page.mouse.move(from.x + from.width / 2 + 20, from.y + from.height / 2 + 20, { steps: 5 })
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
    await page.mouse.up()
    assert.equal(await outputCount(page).textContent(), "3 pages")
    await tab(input, "Grid")
    const gridRibbon = input.getByRole("button", { name: "Fold Input section: First", exact: true })
    assert.equal(await gridRibbon.getAttribute("draggable"), "true")
    await gridRibbon.dispatchEvent("pointerdown", { pointerType: "touch", pointerId: 100, isPrimary: true, button: 0 })
    assert.match(
      await gridRibbon.locator(".ribbon-dots").evaluate((element) => getComputedStyle(element).display),
      /flex/,
    )
    await page.evaluate(() => window.dispatchEvent(new Event("blur")))
  } finally {
    await browser.close()
  }
})

test(
  "Section disclosures fold on click and drag complete blocks with a temporary grip through mouse and touch",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      for (const touch of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: 1440, height: 1000 },
          hasTouch: touch,
          reducedMotion: "reduce",
        })
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Blocks.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 8,
              outline: [
                { title: "First group", page: 0 },
                { title: "First chapter", page: 0, parent: 0 },
                { title: "Second group", page: 4 },
                { title: "Second chapter", page: 4, parent: 2 },
              ],
            }),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        const disclosure = (pane, name) =>
          pane.locator(".list-heading").filter({ hasText: name }).first().locator("..").locator(".list-disclosure")
        await tab(input, "List")
        await tab(output, "List")
        const selection = input.getByLabel("Page selection", { exact: true })
        await selection.fill("8")
        const session = touch ? await page.context().newCDPSession(page) : undefined
        const move = async (x, y, first = false) => {
          if (touch)
            await session.send("Input.dispatchTouchEvent", {
              type: first ? "touchStart" : "touchMove",
              touchPoints: [{ x, y, id: 1 }],
            })
          else {
            await page.mouse.move(x, y, { steps: first ? 1 : 4 })
            if (first) await page.mouse.down()
          }
        }
        const begin = async (control) => {
          await control.scrollIntoViewIfNeeded()
          const box = await control.boundingBox()
          await move(box.x + box.width / 2, box.y + box.height / 2, true)
          await move(box.x + box.width / 2 + 14, box.y + box.height / 2)
          await page.locator(".composer[data-drag]").waitFor()
          await page.locator(".drag-image[data-strip]").waitFor()
          assert.equal(await page.locator(".drag-image > span:last-child").innerText(), "×4")
          assert.equal(
            await control.locator(".ribbon-dots svg").getAttribute("fill"),
            "none",
            "Dragging shows the temporary grip",
          )
        }
        const finish = async (target, fraction = 0.5) => {
          const box = await target.boundingBox()
          await move(box.x + box.width / 2, box.y + box.height * fraction)
          await move(box.x + box.width / 2, box.y + box.height * fraction)
          await page.locator(".composition-output[data-drop], .composition-output [data-drop]").first().waitFor()
          if (await output.locator(".page-list").count())
            assert.equal(await output.locator(".list-drop-preview").count(), 1)
          if (touch) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
          else await page.mouse.up()
          await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          assert.equal(await page.locator(".list-disclosure.dragging").count(), 0, "Dropping restores disclosure icons")
        }
        const drag = disclosure(input, "First group")
        assert.equal(await input.locator(".list-disclosure").first().getAttribute("aria-expanded"), "true")
        await begin(drag)
        if (!touch) {
          await page.keyboard.press("Escape")
          await page.mouse.up()
          await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
          assert.equal(await drag.getAttribute("aria-expanded"), "true", "Cancelling does not fold the section")
          assert.equal(await drag.locator(".ribbon-symbol svg").getAttribute("fill"), "currentColor")
          await begin(drag)
        }
        assert.equal(await selection.inputValue(), "1-4")
        await finish(output.locator(".composition-empty"))
        assert.equal(await drag.getAttribute("aria-expanded"), "true", "Dropping does not fold the section")
        assert.equal(await outputCount(page).textContent(), "4 pages")
        await selection.fill("")
        await input.getByRole("button", { name: "Add Input section pages 5–8 to Output", exact: true }).press("Enter")
        await output.getByLabel("Page selection", { exact: true }).fill("")
        const original = await output
          .locator(".page-list > :is(.list-row, .list-section)")
          .evaluateAll((rows) => rows.map((row) => row.id))
        await begin(disclosure(input, "Second group"))
        const openHeading = await output
          .locator(".list-heading")
          .filter({ hasText: "First group" })
          .first()
          .boundingBox()
        await move(openHeading.x + openHeading.width / 2, openHeading.y + openHeading.height * 0.8)
        await page.locator(".drop-description").filter({ hasText: "Release" }).waitFor()
        assert.match(
          await page.locator(".drop-description").innerText(),
          /Before page 1/,
          "An unfolded heading keeps its leading drop boundary independently of its keyboard action range",
        )
        await page.keyboard.press("Escape")
        if (touch) await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
        else await page.mouse.up()
        await page.locator(".composer[data-drag]").waitFor({ state: "hidden" })
        await output.getByRole("button", { name: "Fold all Output sections", exact: true }).click()
        await begin(disclosure(output, "Second group"))
        const target = output.locator(".list-heading").filter({ hasText: "First group" }).first()
        await finish(target, 0.2)
        assert.equal(await outputCount(page).textContent(), "8 pages")
        await output.getByRole("button", { name: "Unfold all Output sections", exact: true }).click()
        const moved = await output
          .locator(".page-list > :is(.list-row, .list-section)")
          .evaluateAll((rows) => rows.map((row) => row.id))
        assert.deepEqual(moved, [...original.slice(4), ...original.slice(0, 4)])
        await output.getByRole("button", { name: "Fold all Output sections", exact: true }).click()
        await begin(disclosure(output, "Second group"))
        await finish(target, 0.8)
        await output.getByRole("button", { name: "Unfold all Output sections", exact: true }).click()
        assert.deepEqual(
          await output
            .locator(".page-list > :is(.list-row, .list-section)")
            .evaluateAll((rows) => rows.map((row) => row.id)),
          original,
        )
        await begin(disclosure(output, "Second group"))
        await finish(output.locator(':is(.list-choice, .list-heading)[data-page="1"]'), 0.8)
        assert.deepEqual(
          await output
            .locator(".page-list > :is(.list-row, .list-section)")
            .evaluateAll((rows) => rows.map((row) => row.id)),
          [...original.slice(0, 2), ...original.slice(4), ...original.slice(2, 4)],
        )
        assert.deepEqual(await output.locator(".list-current").allTextContents(), ["First group", "Second group"])
        assert.deepEqual(errors, [], "Moving a block into another section keeps every row valid")
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test("Input additions fly from Grid and List to visible Output in both pane layouts", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const width of [390, 1440])
        for (const outputView of ["Grid", "List", "Page"]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
            hasTouch: width === 390,
            reducedMotion: "no-preference",
          })
          page.setDefaultTimeout(10000)
          await setup(page)
          await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
          await page.locator(".composer[aria-busy=false]").waitFor()
          await page.evaluate(() => {
            new MutationObserver(() =>
              document.querySelectorAll(".addition-preview").forEach((element) =>
                element.getAnimations().forEach((animation) => {
                  animation.pause()
                  animation.currentTime = 0
                }),
              ),
            ).observe(document.body, { childList: true })
          })
          const input = page.locator(".selection-panel"),
            output = page.locator(".composition-output")
          const switcher = page.getByRole("button", { name: "Output", exact: true })
          await selectPane(switcher)
          await tab(output, outputView)
          const back = page.getByRole("button", { name: "Input", exact: true })
          if (await back.isVisible()) await back.click()
          for (const view of ["Grid", "List"]) {
            await tab(input, view)
            await input.getByLabel("Page selection", { exact: true }).fill("1-2")
            await input.getByRole("button", { name: "Add to Output", exact: true }).click()
            const flight = page.locator(".addition-preview")
            await flight.waitFor()
            if (width === 1440 && outputView === "List") {
              assert.equal(await flight.getAttribute("data-strip"), "")
              assert.ok(await flight.locator(".drag-title").textContent())
              assert.match(await flight.textContent(), /×2/)
            } else if (view === "List")
              assert.ok(
                await flight.evaluate((canvas) =>
                  canvas
                    .getContext("2d")
                    .getImageData(0, 0, canvas.width, canvas.height)
                    .data.some((value, index, pixels) => index % 4 === 0 && value !== pixels[index + 1]),
                ),
                "List origins carry rendered pages to Grid, Page, or the compact Output button",
              )
            const box = await flight.boundingBox()
            assert.ok(box.width > 0 && box.y < 1000 && box.y + box.height > 0, JSON.stringify({ width, view, box }))
            assert.equal(await outputCount(page).innerText(), view === "Grid" ? "10 pages" : "12 pages")
            if (width === 390)
              assert.ok(
                await switcher.evaluate((button) => button.getAnimations().length > 0),
                "The visible Output button receives the flight",
              )
            if (width === 1440 && outputView === "Page") {
              await flight.evaluate((element) => {
                const animation = element.getAnimations()[0]
                animation.currentTime = animation.effect.getTiming().duration - 1
              })
              const landed = await flight.boundingBox()
              const destination = await output.locator(".page-scroll").boundingBox()
              assert.ok(
                Math.abs(landed.x + landed.width / 2 - destination.x - destination.width / 2) < 1 &&
                  Math.abs(landed.y + landed.height / 2 - destination.y - destination.height / 2) < 1,
                "The copy lands in the Output page viewport",
              )
            }
            await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
            await flight.waitFor({ state: "detached" })
          }
          await page.emulateMedia({ reducedMotion: "reduce" })
          await input.getByLabel("Page selection", { exact: true }).fill("1")
          await input.getByRole("button", { name: "Add to Output", exact: true }).click()
          assert.equal(await page.locator(".addition-preview").count(), 0)
          await page.close()
        }
    } finally {
      await browser.close()
    }
  }
})
