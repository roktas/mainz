// Checks responsive workspace layout, text bounds, and control alignment.

import assert from "node:assert/strict"
import test from "node:test"
import {
  captureLayout,
  checkGridScroll,
  checkStatus,
  fixture,
  outputCount,
  setup,
  tab,
  inputChooser,
  selectPane,
} from "./browser.js"
import { engines, launch } from "./browsers.js"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { measure } from "./measure.js"
import { quality } from "./quality.ts"

test("Normal card targets stay separate through phone pane and text transitions", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser, page, label
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    for (const width of [320, 390, 412, 440]) {
      await page.setViewportSize({ width, height: width === 440 ? 956 : 924 })
      for (const text of ["100%", "200%"]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        for (const name of ["Input", "Output"]) {
          await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await measure(pane)
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          for (const selected of [false, true]) {
            await field.fill(selected ? "1" : "")
            label = `${width}px, ${text}, ${name}, selected=${selected}`
            const card = pane.locator(".composition-card").first()
            await card.scrollIntoViewIfNeeded()
            await card.locator(".page-image").focus()
            const targets = await card.evaluate((element) =>
              [
                ...element.querySelectorAll(
                  ":scope > .page-label .page-origin > button, :scope > .page-label .page-grip, :scope > .occurrence-actions button",
                ),
              ]
                .filter((button) => button.getClientRects().length && getComputedStyle(button).visibility !== "hidden")
                .map((button) => {
                  const rect = button.getBoundingClientRect(),
                    after = getComputedStyle(button, "::after")
                  const left = rect.left + parseFloat(after.left),
                    right = rect.right - parseFloat(after.right)
                  const top = rect.top + parseFloat(after.top),
                    bottom = rect.bottom - parseFloat(after.bottom)
                  const points = [left + 1, (left + right) / 2, right - 1].flatMap((x) =>
                    [top + 1, (top + bottom) / 2, bottom - 1].map((y) => ({
                      x,
                      y,
                      hits: document.elementFromPoint(x, y)?.closest("button, summary") === button,
                    })),
                  )
                  return { label: button.getAttribute("aria-label"), left, right, top, bottom, points }
                }),
            )
            assert.ok(targets.length >= 2, label)
            for (const target of targets) {
              assert.ok(
                target.right - target.left >= (/^(Remove|Duplicate|Move)/.test(target.label) ? 32 : 44) &&
                  target.bottom - target.top >= 44,
                `${label}: ${JSON.stringify(target)}`,
              )
              assert.ok(
                target.points.every(({ hits }) => hits),
                `${label}: ${JSON.stringify(target)}`,
              )
            }
            const number = targets[0]
            for (const point of number.points.filter((_, index) => index % 3 === 1)) {
              await page.touchscreen.tap(point.x, point.y)
              assert.equal(await card.locator(".page-origin-info:popover-open").count(), 1, label)
              assert.equal(await field.inputValue(), selected ? "1" : "", label)
              await page.touchscreen.tap(point.x, point.y)
            }
            const grip = targets[1]
            await page.touchscreen.tap((grip.left + grip.right) / 2, (grip.top + grip.bottom) / 2)
            assert.equal(await field.inputValue(), selected ? "" : "1", label)
          }
          await checkGridScroll(pane, label)
        }
      }
    }
  } catch (error) {
    if (page) await captureLayout(page, "normal-targets", { label, error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

test("Normal card targets route footer and grip taps across consecutive rows", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser, page, label, targets
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    for (const width of [440, 768, 772, 774, 778, 780]) {
      for (const text of ["100%", "200%"]) {
        await page.setViewportSize({ width, height: text === "100%" ? (width === 440 ? 956 : 1100) : 2200 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        await page.emulateMedia({ colorScheme: text === "100%" ? "light" : "dark" })
        for (const name of ["Input", "Output"]) {
          await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }))
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          await pane.locator(".grid-view").evaluate((element) => (element.scrollTop = 0))
          const grid = await measure(pane)
          assert.ok(grid.matrix[1] >= 2, `${width}px, ${text}, ${name}: two complete rows`)
          const lower = grid.matrix[0] + 1
          for (const selected of [false, true]) {
            const selection = selected ? `1,${lower}` : ""
            const actions = selected || name === "Input" ? [] : ["Remove", "Duplicate"]
            for (const action of [...actions, "Select or drag"]) {
              label = `${width}px, ${text}, ${name}, selected=${selected}, ${action}`
              await field.fill(selection)
              await measure(pane)
              await pane
                .locator(".composition-card")
                .nth(lower - 1)
                .scrollIntoViewIfNeeded()
              await pane.locator(".composition-card").first().locator(".page-image").focus()
              targets = await pane.evaluate((element, column) => {
                const cards = element.querySelectorAll(".composition-card")
                return [
                  ...cards[0].querySelectorAll(":scope > .occurrence-actions button"),
                  cards[column].querySelector(".page-grip"),
                ]
                  .filter(
                    (button) => button.getClientRects().length && getComputedStyle(button).visibility !== "hidden",
                  )
                  .map((button) => {
                    const rect = button.getBoundingClientRect(),
                      after = getComputedStyle(button, "::after")
                    const left = rect.left + parseFloat(after.left),
                      right = rect.right - parseFloat(after.right)
                    const top = rect.top + parseFloat(after.top),
                      bottom = rect.bottom - parseFloat(after.bottom)
                    const y = button.classList.contains("page-grip") ? top + 1 : bottom - 1
                    return {
                      label: button.getAttribute("aria-label"),
                      left,
                      right,
                      top,
                      bottom,
                      points: [left + 1, (left + right) / 2, right - 1].map((x) => ({
                        x,
                        y,
                        hits: document.elementFromPoint(x, y)?.closest("button, summary") === button,
                      })),
                    }
                  })
              }, grid.matrix[0])
              for (const target of targets) {
                assert.ok(
                  target.right - target.left >= (/^(Remove|Duplicate|Move)/.test(target.label) ? 32 : 44) &&
                    target.bottom - target.top >= 44,
                  label,
                )
                assert.ok(
                  target.points.every(({ hits }) => hits),
                  `${label}: ${JSON.stringify(target)}`,
                )
                if (target !== targets.at(-1)) assert.ok(target.bottom <= targets.at(-1).top, label)
              }
              const target = targets.find((entry) => entry.label.startsWith(action))
              assert.ok(target, label)
              const before = parseInt(await outputCount(page).textContent())
              await page.touchscreen.tap(target.points[1].x, target.points[1].y)
              if (action === "Select or drag") {
                assert.equal(await field.inputValue(), selected ? "1" : String(lower), label)
                assert.equal(parseInt(await outputCount(page).textContent()), before, label)
              } else {
                const expected = before + (action === "Remove" ? -1 : 1)
                await page.waitForFunction(
                  (count) =>
                    document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
                      ?.textContent === `${count} pages`,
                  expected,
                )
                if (name === "Input") assert.equal(await field.inputValue(), selection, label)
              }
            }
          }
        }
      }
    }
  } catch (error) {
    if (page) await captureLayout(page, "normal-row-targets", { label, targets, error: error.message })
    throw error
  } finally {
    await browser?.close()
  }
})

test("Workspace scrolling keeps Grid and Page controls clear of status", { timeout: 120000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 62 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "62 pages",
    )
    for (const [width, height, scale, bottom] of [
      [390, 699, 100, 0],
      [375, 667, 100, 0],
      [390, 797, 100, 34],
      [320, 568, 200, 0],
      [844, 390, 100, 0],
      [1080, 724, 200, 0],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(
        (appearance) => {
          document.documentElement.style.fontSize = `${appearance.scale}%`
          document.querySelector(".footnote").style.paddingBlockEnd = `calc(var(--gap) + ${appearance.bottom}px)`
        },
        { scale, bottom },
      )
      const colorScheme = "light"
      await t.test(`${width}×${height}, ${scale}%, ${colorScheme}`, async () => {
        await page.emulateMedia({ colorScheme })
        for (const name of ["Input", "Output"]) {
          const views = page.locator(".mobile-workspace-tabs")
          await selectPane(views.getByRole("button", { name, exact: true }))
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, "Grid")
          await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill("56-62")
          const grid = await measure(pane)
          assert.ok(grid.scroll > 0, `${name}: Grid has a vertical scroll range`)
          assert.equal(grid.horizontalOverflow, false, `${name}: Grid has no horizontal overflow`)
          await checkStatus(page)
          const viewport = pane.locator(".grid-view")
          await viewport.evaluate((element) => (element.scrollTop = element.scrollHeight))
          await viewport.locator('.page-image[data-page="61"]').waitFor()
          const end = await viewport.evaluate((element) => ({
            top: element.scrollTop,
            max: element.scrollHeight - element.clientHeight,
            gap:
              element.getBoundingClientRect().bottom -
              [...element.querySelectorAll(".composition-card")].at(-1).getBoundingClientRect().bottom,
          }))
          assert.ok(end.top >= end.max - 2, `${name}: Grid reaches the last page`)
          assert.ok(end.gap >= 11 && end.gap <= 13, `${name}: the last row retains its bottom inset`)
          await tab(pane, "Page")
          await pane.locator(".page-scroll canvas").waitFor()
          await checkStatus(page)
          const navigation = await pane.locator(".page-navigation").boundingBox()
          const status = await page.locator(".footnote").boundingBox()
          assert.ok(navigation.y + navigation.height <= status.y + 1, `${name}: status clears Page controls`)
        }
      })
    }
  } finally {
    await browser?.close()
  }
})

test("Grid layout stays within bounds at responsive widths", { timeout: 120000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&geometry`)
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "80 pages",
    )
    for (const [width, height] of [
      [390, 844],
      [768, 1024],
      [1440, 900],
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      const label = `${width}×${height}`
      assert.deepEqual(
        quality(sample),
        [],
        `${label}: ${JSON.stringify({ input: sample.layout.input.normal?.margins, output: sample.layout.output.normal?.margins })}`,
      )
      for (const pane of ["input", "output"]) {
        const grid = sample.layout[pane].normal
        assert.ok(grid.card.width >= 136 && grid.card.width <= 152, `${pane}: readable card width at ${label}`)
        assert.ok(grid.total > grid.mounted, `${pane}: bounded virtual window at ${label}`)
        assert.ok(grid.scroll > 0, `${pane}: scrollable page sequence at ${label}`)
      }
    }
  } finally {
    await browser.close()
  }
})

test("Touch Grid keeps full pages reachable across orientations", { timeout: 120000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await setup(page)
    await page.route("**/magna.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&geometry`)
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "80 pages",
    )
    for (const [width, height] of [
      [390, 844],
      [844, 390],
      [768, 1024],
      [1024, 768],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      const label = `${width}×${height}`
      assert.deepEqual(
        quality(sample),
        [],
        `${label}: ${JSON.stringify({ input: sample.layout.input.normal?.margins, output: sample.layout.output.normal?.margins })}`,
      )
      for (const pane of ["input", "output"]) {
        const grid = sample.layout[pane].normal
        assert.ok(grid.scroll > 1, `${pane}: vertical scrolling at ${label}`)
        assert.ok(grid.mounted < grid.total, `${pane}: virtual rows at ${label}`)
        assert.ok(grid.card.width >= 136, `${pane}: readable cards at ${label}`)
      }
    }
  } finally {
    await browser.close()
  }
})

test("Page labels and details retain aligned controls across themes and views", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Labels.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false, count: 4, labels: ["i", "2", "iii", "4"] }),
        })
      const input = page.locator(".selection-panel")
      for (const width of [320, 390, 768, 1440])
        for (const colorScheme of ["light", "dark"])
          for (const text of ["100%", "200%"]) {
            await page.setViewportSize({ width, height: 1100 })
            await page.emulateMedia({ colorScheme })
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
            await tab(input, "Grid")
            const card = input.locator(".composition-card").first()
            const label = card.locator(".grid-pdf-label")
            assert.equal(await label.textContent(), "i")
            assert.equal(
              await input.locator('.composition-card:has(.page-image[data-page="1"]) .grid-pdf-label').count(),
              0,
            )
            const position = await label.evaluate((element) => {
              const box = element.getBoundingClientRect(),
                frame = element.closest(".composition-card").getBoundingClientRect()
              return { inset: box.x - frame.x, bottom: frame.bottom - box.bottom }
            })
            assert.ok(
              position.inset >= 8 && position.inset <= 10 && Math.abs(position.bottom) <= 2,
              JSON.stringify(position),
            )
            const inset = await input
              .getByLabel("Details for Input page 1", { exact: true })
              .evaluate(
                (button) =>
                  button.querySelector("strong").getBoundingClientRect().left -
                  button.closest(".composition-card").getBoundingClientRect().left,
              )
            assert.ok(inset >= 8, String(inset))
            await input.getByLabel("Details for Input page 1", { exact: true }).click()
            const control = input.getByRole("button", { name: "Add Input page 1 to Output", exact: true })
            const alignment = await control.evaluate((button) => {
              const box = button.getBoundingClientRect(),
                frame = button.closest(".composition-card").getBoundingClientRect(),
                icon = button.querySelector("svg").getBoundingClientRect()
              return {
                contained: box.left >= frame.left && box.right <= frame.right,
                iconCenter: Math.abs(icon.y + icon.height / 2 - box.y - box.height / 2),
                size: box.width,
              }
            })
            assert.ok(
              alignment.contained && alignment.iconCenter < 1 && alignment.size >= 24,
              JSON.stringify(alignment),
            )
            await page.keyboard.press("Escape")
            for (const view of ["Grid", "List", "Page"]) {
              await tab(input, view)
              if (process.env.MAINZ_CAPTURE_SCREENSHOTS && [390, 1440].includes(width) && text === "100%")
                await captureLayout(page, `${engine.name()}-${width}-${colorScheme}-${view}`)
              const separators = await page.evaluate(() => {
                const edges = (selector) => {
                  const element = document.querySelector(selector),
                    box = element.getBoundingClientRect(),
                    style = getComputedStyle(element),
                    outset = parseFloat(style.borderImageOutset.split(" ")[1]) || 0
                  return [box.left - outset, box.right + outset]
                }
                return {
                  header: edges(".header-inner"),
                  tabs: edges(".source-tabs"),
                  footer: edges(".footnote"),
                  compact: !!document.querySelector(".composer[data-compact]"),
                  field: edges(".selection-panel .sequence-entry > .entry"),
                }
              })
              assert.ok(
                separators.compact
                  ? Math.abs(separators.field[0] - separators.tabs[0]) < 1
                  : Math.abs(separators.header[0] - separators.tabs[0]) < 1 &&
                      Math.abs(separators.footer[0] - separators.tabs[0]) < 1,
                JSON.stringify({ width, text, view, separators }),
              )
              assert.ok(Math.abs(separators.header[1] - separators.footer[1]) < 1, JSON.stringify(separators))
            }
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          }
    } finally {
      await browser.close()
    }
  }
})

test("Workspace tools stay on one row without moving the view tabs", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const [width, text, colorScheme, font = ""] of [
      [320, "100%", "light"],
      [320, "100%", "light", "DejaVu Sans, sans-serif"],
      [375, "100%", "dark"],
      [430, "100%", "light"],
      [640, "100%", "dark"],
      [768, "100%", "light"],
      [810, "100%", "dark"],
      [1280, "100%", "dark"],
      [320, "200%", "dark"],
      [375, "200%", "light"],
    ]) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await page.evaluate(
        ({ size, family }) => {
          document.documentElement.style.fontSize = size
          document.body.style.fontFamily = family
        },
        { size: text, family: font },
      )
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      for (const [selector, name] of [
        [".selection-panel", "Input"],
        [".composition-output", "Output"],
      ]) {
        const pane = page.locator(selector)
        const views = page.locator(".mobile-workspace-tabs")
        await selectPane(views.getByRole("button", { name, exact: true }))
        if (name === "Input") {
          if (text === "100%" && !(await views.isVisible()))
            assert.ok(
              await pane.locator(".input-current").evaluate((element) => element.scrollWidth <= element.clientWidth),
              `${width}px: the demo filename fits the chooser`,
            )
          await inputChooser(page).click()
          assert.ok(
            await page.getByRole("button", { name: "Remove Input", exact: true }).evaluate((button) => {
              const rect = button.getBoundingClientRect()
              return (
                rect.width >= 44 &&
                rect.height >= 44 &&
                rect.x >= 0 &&
                rect.right <= innerWidth &&
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") ===
                  button
              )
            }),
            `${width}px, ${text}: Input removal fits above the workspace`,
          )
          await page.keyboard.press("Escape")
        }
        if (name === "Output") await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill("2")
        let reference, preparation, contentStart
        for (const view of name === "Input" ? ["Page", "Grid", "List", "Style"] : ["Page", "Grid", "List"]) {
          await tab(pane, view)
          const bounds = await pane.locator(".tabs").evaluate((tabs) => {
            const origin = tabs.getBoundingClientRect()
            return [...tabs.children].map((element) => {
              const rect = element.getBoundingClientRect()
              return {
                x: rect.x - origin.x + tabs.scrollLeft,
                y: rect.y - origin.y,
                width: rect.width,
                height: rect.height,
              }
            })
          })
          reference ??= bounds
          const label = `${name} ${view}, ${width}px, ${text}`
          const start = await pane.evaluate((panel, view) => {
            const field = panel.querySelector(view === "Style" ? ".profile-choice" : ".sequence-entry > .entry")
            const content = panel
              .querySelector(
                view === "Style"
                  ? ".style-profile"
                  : view === "Page"
                    ? ".page-view"
                    : view === "Grid"
                      ? ".composition-card"
                      : ".page-list > li:not(.list-spacer)",
              )
              .getBoundingClientRect()
            const hint = panel.querySelector(view === "Style" ? ".profile-summary > p" : ".sequence-help")
            return (
              (view === "Style" ? content.bottom - 1 : content.top) -
              field.getBoundingClientRect().bottom -
              hint.getBoundingClientRect().height
            )
          }, view)
          contentStart ??= start
          assert.ok(
            Math.abs(start - contentStart) < 1,
            `${label}: shared content spacing after the hint ${start}, ${contentStart}`,
          )
          if (name === "Input" && ["Grid", "Style"].includes(view)) {
            const profile = view === "Style"
            const layout = await pane.evaluate((panel, profile) => {
              const bar = panel
                .querySelector(profile ? ".profile-choice" : ".sequence-entry > .entry")
                .getBoundingClientRect()
              const hint = panel.querySelector(profile ? ".profile-summary > p > span" : ".sequence-help > span")
              const range = document.createRange()
              range.selectNodeContents(hint)
              const text = range.getBoundingClientRect()
              const style = getComputedStyle(hint)
              return {
                gap: bar.top - panel.querySelector(".editing-toolbar").getBoundingClientRect().bottom,
                height: bar.height,
                left: text.left - bar.left,
                hintGap: text.top - bar.bottom,
                font: style.fontSize,
                line: style.lineHeight,
                color: style.color,
              }
            }, profile)
            if (!profile) preparation = layout
            else {
              assert.equal(layout.font, preparation.font, `${label}: profile hint uses selection hint text size`)
              assert.equal(layout.line, preparation.line)
              assert.equal(layout.color, preparation.color)
              for (const key of ["gap", "height", "left", "hintGap"])
                assert.ok(
                  Math.abs(layout[key] - preparation[key]) < 1,
                  `${label}: ${key} ${JSON.stringify({ layout, preparation })}`,
                )
              await pane.getByRole("combobox", { name: "Style profile", exact: true }).selectOption({ label: "Filled" })
              const marker = pane.getByRole("tab", { name: "Style", exact: true })
              assert.equal(await marker.getAttribute("data-modified"), "true")
              const line = await marker.evaluate((button) => {
                const style = getComputedStyle(button, "::after")
                return {
                  width: parseFloat(style.width),
                  stroke: style.borderBottomWidth,
                  bottom: parseFloat(style.bottom),
                }
              })
              assert.ok(line.width > 0 && line.stroke === "2px" && line.bottom >= 4, JSON.stringify(line))
            }
          }
          assert.deepEqual(bounds, reference, `${label}: adjacent tools preserve tab positions and sizes`)
          assert.ok(
            bounds.every((rect) => rect.y === 0),
            `${label}: tabs share one row`,
          )
          if (view === "Grid") {
            const tabs = await pane.getByRole("tab", { name: "Grid", exact: true }).boundingBox()
            assert.ok(tabs.x >= 0 && tabs.x + tabs.width <= width, `${label}: Grid tab fits`)
            assert.equal(bounds.filter((rect) => rect.width > 0).length, name === "Input" ? 4 : 3)
          }
          if (text === "100%" && view !== "Style")
            assert.ok(
              await pane
                .locator(".sequence-help > span")
                .first()
                .evaluate((hint) => {
                  const range = document.createRange()
                  range.selectNodeContents(hint)
                  return range.getBoundingClientRect().height <= parseFloat(getComputedStyle(hint).lineHeight) + 1
                }),
              `${label}: routine selection help fits one line`,
            )
          if (view !== "Style") {
            const bar = await pane.locator(".sequence-entry > .entry").boundingBox()
            const addition = await pane
              .getByRole("button", {
                name: name === "Input" ? "Add to Output" : "Duplicate selected Output pages",
                exact: true,
              })
              .boundingBox()
            assert.ok(
              Math.abs(addition.x + addition.width - bar.x - bar.width) < 1,
              `${label}: addition ends at the bar edge`,
            )
            assert.ok(
              await pane.locator(".sequence-entry .step:visible").evaluateAll((buttons) =>
                buttons.every((button) => {
                  const rect = button.getBoundingClientRect()
                  return rect.width >= 44 && rect.height >= 44
                }),
              ),
              `${label}: both panes retain full-size action targets`,
            )
            if (text === "100%")
              assert.ok(
                await pane.getByRole("textbox", { name: "Page selection", exact: true }).evaluate((field) => {
                  const style = getComputedStyle(field)
                  const canvas = document.createElement("canvas").getContext("2d")
                  canvas.font = style.font
                  const available =
                    field.getBoundingClientRect().width -
                    parseFloat(style.paddingLeft) -
                    parseFloat(style.paddingRight) -
                    parseFloat(style.borderLeftWidth) -
                    parseFloat(style.borderRightWidth)
                  const required = canvas.measureText(innerWidth < 375 ? "2,4" : "2,4-6").width
                  return available >= required
                }),
                `${label}: the selection field fits a short page sequence`,
              )
          }
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            `${label}: no overflow`,
          )
        }
        if (name === "Output") {
          for (const [direction, number] of [
            ["earlier", "1"],
            ["later", "2"],
          ]) {
            const menu = pane.getByLabel("Output page actions", { exact: true })
            await menu.click()
            const movement = pane.getByRole("button", { name: `Move selected pages ${direction}`, exact: true })
            const inMenu = await movement.evaluate((button) => !!button.closest(".menu-options"))
            await movement.scrollIntoViewIfNeeded()
            assert.ok(
              await movement.evaluate((button) => {
                const rect = button.getBoundingClientRect()
                return (
                  rect.width >= 44 &&
                  rect.height >= 44 &&
                  rect.x >= 0 &&
                  rect.right <= innerWidth &&
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") ===
                    button
                )
              }),
              `${width}px, ${text}: movement remains reachable in the Output menu`,
            )
            await movement.click()
            assert.equal(await pane.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), number)
            assert.equal(await menu.evaluate((summary) => summary.parentElement.open), false)
            if (inMenu) assert.equal(await menu.evaluate((summary) => summary === document.activeElement), true)
          }
        }
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Help fits its content and keeps its navigation above scrolling panels", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine, { channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL : undefined })
    try {
      for (const hasTouch of [false, true]) {
        const page = await browser.newPage({ hasTouch, isMobile: hasTouch, reducedMotion: "reduce" })
        await setup(page)
        for (const query of ["", "?demo=single"]) {
          await page.goto(`${server.resolvedUrls.local[0]}${query}`)
          if (query) await page.locator(".composer[aria-busy=false]").waitFor()
          for (const [width, height, text] of [
            [810, 1048, "100%"],
            [1080, 778, "100%"],
            [768, 1024, "200%"],
            [390, 844, "100%"],
            [320, 568, "200%"],
          ]) {
            await page.setViewportSize({ width, height })
            const colorScheme = text === "200%" ? "dark" : "light"
            await page.emulateMedia({ colorScheme })
            await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
            await page.getByRole("button", { name: "Help", exact: true }).click()
            const help = page.getByRole("dialog", { name: "Help", exact: true })
            const bounds = await help.evaluate((dialog) => {
              const box = dialog.getBoundingClientRect()
              const panels = dialog.querySelector(".help-panels")
              const content = panels
                ? [...panels.querySelectorAll(":scope > [role=tabpanel] > .help-body")]
                : [dialog.querySelector(".help-screencasts")]
              const frame = (panels ?? content[0]).getBoundingClientRect()
              const navigation = dialog.querySelector(".help-navigation")?.getBoundingClientRect()
              const title = dialog.querySelector("h2").getBoundingClientRect()
              const close = dialog.querySelector(".dialog-heading button svg").getBoundingClientRect()
              const copy = document.createRange()
              copy.selectNodeContents(dialog.querySelector(".help-screencasts p"))
              return {
                fits: box.x >= 0 && box.y >= 0 && box.right <= innerWidth && box.bottom <= innerHeight,
                spare: frame.height - Math.max(...content.map((body) => body.getBoundingClientRect().height)),
                gap: parseFloat(getComputedStyle(dialog).paddingBlockStart),
                spareInline: box.right - copy.getBoundingClientRect().right,
                navigation: !panels || (!!navigation && navigation.bottom <= frame.top),
                panel: frame.height,
                heading: Math.abs(title.y + title.height / 2 - close.y - close.height / 2) < 1,
                overflow: dialog.scrollWidth > dialog.clientWidth,
              }
            })
            const label = `${engine.name()} ${hasTouch ? "touch" : "mouse"} ${query || "landing"} ${width}×${height} ${text} ${colorScheme}`
            assert.ok(
              bounds.fits && bounds.navigation && bounds.heading && bounds.panel > 0 && !bounds.overflow,
              `${label}: ${JSON.stringify(bounds)}`,
            )
            assert.ok(bounds.spare <= bounds.gap + 2, `${label}: Help has no empty vertical stretch`)
            if (!query && width >= 810 && text === "100%")
              assert.ok(bounds.spareInline <= bounds.gap + 2, `${label}: landing Help hugs its text`)
            const dimensions = await help.boundingBox()
            for (const topic of await help.getByRole("tab").all()) {
              await topic.click()
              assert.deepEqual(await help.boundingBox(), dimensions, `${label}: Topics retain their dimensions`)
              const panel = help.getByRole("tabpanel")
              await panel.focus()
              await panel.press("End")
              await page.waitForFunction(() => {
                const element = document.querySelector('.help-panels > [role="tabpanel"][aria-hidden="false"]')
                return element.scrollTop + element.clientHeight >= element.scrollHeight - 1
              })
            }
            await help.getByRole("button", { name: "Close help", exact: true }).click()
          }
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Contents keeps compact rows and fixed width across disclosure states", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const hasTouch of [false, true]) {
        const page = await browser.newPage({
          viewport: { width: hasTouch ? 768 : 1440, height: 1024 },
          hasTouch,
          reducedMotion: "reduce",
        })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Contents.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 4,
              outline: [
                { title: "Chapter", page: 0 },
                { title: "First section", page: 0, parent: 0 },
                { title: "Second section", page: 2, parent: 0 },
                { title: "Final chapter", page: 3 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await page.locator(".status-input").filter({ hasText: "Contents.pdf" }).waitFor({ state: "attached" })
        await page.locator('.composer[aria-busy="false"]').waitFor()
        await tab(input, "List")
        for (const width of [1440, 768, 375, 320]) {
          await page.setViewportSize({ width, height: width <= 480 ? 667 : 1024 })
          for (const font of ["100%", "200%"]) {
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), font)
            assert.equal(await page.locator(".contents .destination").count(), 0)
            await input.getByRole("button", { name: "Input contents", exact: true }).click()
            const panel = page.locator(".contents:popover-open")
            assert.equal(await panel.getByRole("checkbox", { name: "Use TOC titles", exact: true }).count(), 0)
            const expanded = await panel.boundingBox()
            assert.ok(
              expanded.y >= 0 && expanded.y + expanded.height <= page.viewportSize().height + 1,
              JSON.stringify({ width, font, hasTouch, expanded }),
            )
            const rows = await panel
              .locator(".destination")
              .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
            if (font === "100%") assert.ok(rows[0] <= 33 && rows[1] <= 29, JSON.stringify({ hasTouch, width, rows }))
            for (const state of ["Unfold all", "Fold all"]) {
              const toggle = panel.getByRole("button", { name: state, exact: true })
              const target = await toggle.evaluate((element) => {
                const box = element.getBoundingClientRect(),
                  frame = element.closest(".contents").getBoundingClientRect()
                return {
                  usable: element.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)),
                  button: box.toJSON(),
                  panel: frame.toJSON(),
                }
              })
              assert.ok(target.usable, JSON.stringify({ engine: engine.name(), width, font, hasTouch, state, target }))
              await toggle.click()
              const box = await panel.boundingBox()
              assert.ok(Math.abs(box.width - expanded.width) < 1)
              const edges = await panel.evaluate((element) => {
                const heading = element.querySelector("header strong").getBoundingClientRect().x
                return [...element.querySelectorAll("nav > ul > li > .branch > .disclosure svg path")].map(
                  (path) => path.getBoundingClientRect().x - heading,
                )
              })
              assert.ok(
                edges.every((edge) => Math.abs(edge) < 1),
                JSON.stringify({ width, hasTouch, edges }),
              )
            }
            if (font === "100%")
              assert.equal(
                await panel.locator("nav").evaluate((element) => element.scrollHeight > element.clientHeight + 1),
                false,
              )
            assert.equal(
              await panel.locator("nav").evaluate((element) => element.scrollWidth > element.clientWidth + 1),
              false,
            )
            {
              const margins = await panel.evaluate((element) => {
                const outer = element.getBoundingClientRect(),
                  title = element.querySelector("header strong").getBoundingClientRect()
                const close = element.querySelector("header .icon-button svg path").getBoundingClientRect()
                const header = element.querySelector("header").getBoundingClientRect()
                const positions = [...element.querySelectorAll(".positions")].map(
                  (position) => position.getBoundingClientRect().right,
                )
                return [
                  title.left - outer.left,
                  outer.right - close.right,
                  header.left - outer.left,
                  outer.right - header.right,
                  ...positions.map((right) => outer.right - right),
                ]
              })
              assert.ok(
                margins.every((margin) => Math.abs(margin - margins[0]) < 1),
                JSON.stringify(margins),
              )
            }
            await page.keyboard.press("Escape")
            assert.equal(await page.locator(".contents .destination").count(), 0)
          }
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Narrow workspace counts stay centered without shrinking text", { timeout: 90000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 375, height: 667 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
        name: "Long.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 1000 }),
      })
      await page.locator(".composer[data-compact]").waitFor()
      await page
        .locator(".selection-panel")
        .getByRole("textbox", { name: "Page selection", exact: true })
        .fill(Array(10).fill("1-1000").join(","))
      await page.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.waitForFunction(
        () =>
          document.querySelector(".mobile-workspace-tabs button:last-child .page-count")?.textContent === "10000 pages",
      )
      for (const width of [320, 375, 390, 744, 768, 820]) {
        await page.setViewportSize({ width, height: 900 })
        for (const size of [100, 200]) {
          await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
          await page.emulateMedia({ colorScheme: size === 100 ? "dark" : "light" })
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          const counts = await page.locator(".workspace-counts").evaluateAll((elements) =>
            elements.map((element) => {
              const full = element.querySelector(".composition-totals")
              const short = element.hasAttribute("data-overflow")
              const visible = element.querySelector(short ? ".page-count" : ".composition-totals")
              const range = document.createRange()
              range.selectNodeContents(visible)
              const text = range.getBoundingClientRect()
              const button = element.closest("button").getBoundingClientRect()
              range.selectNodeContents(full)
              return {
                value: visible.textContent.replace(/\s+/g, " ").trim(),
                short,
                font: parseFloat(getComputedStyle(visible).fontSize),
                centered: Math.abs((text.left + text.right - button.left - button.right) / 2) < 1,
                fits: visible.scrollWidth <= visible.clientWidth + 1,
                fullFits: range.getBoundingClientRect().width <= full.clientWidth + 1,
                full: full.textContent.replace(/\s+/g, " ").trim(),
              }
            }),
          )
          const label = `${engine.name()}, ${width}, ${size}%: ${JSON.stringify(counts)}`
          assert.deepEqual(
            counts.map((value) => value.full),
            ["1000 pages, 500 sheets", "10000 pages, 5000 sheets"],
          )
          assert.ok(
            counts.every((value) => value.centered && value.fits && value.font >= (11 * size) / 100),
            label,
          )
          assert.deepEqual(
            counts.map((count) => count.value),
            counts.map((count) => (count.fullFits ? count.full : count.full.split(",")[0])),
            label,
          )
          if (width === 320 && size === 200)
            assert.ok(
              counts.every((count) => count.short),
              label,
            )
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label)
        }
      }
    } finally {
      await browser.close()
    }
  }
})
