// Checks List windowing, section folding, keyboard navigation, and Page/Grid returns.

import { setup, selectPane, outputCount, tab, fixture, gridPage } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { lists, blankList } from "./lists.js"

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
      if (process.env.MAINZ_CAPTURE_SCREENSHOTS) {
        await mkdir("../.local/var/performance/list", { recursive: true })
        await writeFile("../.local/var/performance/list/metrics.json", JSON.stringify(observations, null, 2) + "\n")
      }
    } finally {
      await browser.close()
    }
  },
)

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
        if (process.env.MAINZ_CAPTURE_SCREENSHOTS) {
          await mkdir("../.local/tmp/web/layout/list-input", { recursive: true })
          await list.screenshot({ path: `../.local/tmp/web/layout/list-input/input-${width}-${colorScheme}.png` })
        }
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
