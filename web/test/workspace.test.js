// Checks workspace controls, styles, onboarding, and responsive behavior.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { checkWorkspace } from "./workspace.js"
import { createServer, tab, fixture, trackWorkers, checkStatus, checkGeometry } from "./browser.js"

test("Workspace tools wrap without moving the view tabs", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    for (const [width, text, colorScheme] of [
      [320, "100%", "light"],
      [375, "100%", "dark"],
      [430, "100%", "light"],
      [640, "100%", "dark"],
      [768, "100%", "light"],
      [1280, "100%", "dark"],
      [320, "200%", "dark"],
      [375, "200%", "light"],
    ]) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
      for (const [selector, name] of [
        [".selection-panel", "Input"],
        [".composition-output", "Output"],
      ]) {
        const pane = page.locator(selector)
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        if (name === "Input") {
          if (text === "100%")
            assert.ok(
              await pane.locator(".input-current").evaluate((element) => element.scrollWidth <= element.clientWidth),
              `${width}px: the demo filename fits the chooser`,
            )
          await pane.locator(".input-picker > summary").click()
          assert.ok(
            await pane.getByRole("button", { name: "Remove Input", exact: true }).evaluate((button) => {
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
        let reference
        for (const view of name === "Input" ? ["Page", "Grid", "Style"] : ["Page", "Grid"]) {
          await tab(pane, view)
          const bounds = await pane.locator(".tabs").evaluate((tabs) => {
            const origin = tabs.getBoundingClientRect()
            return [...tabs.children].map((element) => {
              const rect = element.getBoundingClientRect()
              return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height }
            })
          })
          reference ??= bounds
          const label = `${name} ${view}, ${width}px, ${text}`
          assert.deepEqual(bounds, reference, `${label}: adjacent tools preserve tab positions and sizes`)
          if (text === "100%")
            assert.ok(
              bounds.every((rect) => rect.y === 0),
              `${label}: tabs share one row`,
            )
          if (view === "Grid") {
            const tabs = await pane.locator(".tabs").boundingBox()
            const density = await pane.locator(".grid-density").boundingBox()
            assert.ok(
              density.y >= tabs.y + tabs.height || density.x >= tabs.x + tabs.width,
              `${label}: density controls do not cover tabs`,
            )
            assert.ok(density.x >= 0 && density.x + density.width <= width, `${label}: density controls fit`)
            if (text === "100%") assert.equal(density.y, tabs.y, `${label}: tabs and density controls share one row`)
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
                  return (
                    field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >=
                    canvas.measureText(innerWidth < 375 ? "2,4" : "2,4-6").width
                  )
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
    await server.close()
  }
})

test("Help follows the primary pointer and touch tours retain visible focus", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, reducedMotion: "reduce" })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
      const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      await welcome.getByRole("button", { name: "Take a tour", exact: true }).click()
      await page
        .getByRole("dialog", { name: "Product tour", exact: true })
        .getByRole("button", { name: "End tour", exact: true })
        .click()
      assert.equal(
        await page
          .getByRole("button", { name: hasTouch ? "Settings" : "Help", exact: true })
          .evaluate((button) => button === document.activeElement),
        true,
        "Ending the tour returns focus to a visible header control",
      )
      for (const width of [375, 1024]) {
        await page.setViewportSize({ width, height: 900 })
        assert.equal(await page.locator(".help-button").isVisible(), !hasTouch, `${width}px: Help follows pointer type`)
        assert.equal(await page.getByRole("button", { name: "Help", exact: true }).count(), hasTouch ? 0 : 1)
      }
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Download blocks only invalid styles used by Output, including after Input switching",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Styled.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const download = output.getByRole("button", { name: "Download", exact: true })
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
      await tab(input, "Style")
      const color = input.getByRole("textbox", { name: "Guide Color", exact: true })
      await color.fill("invalid")
      assert.equal(await download.isDisabled(), true)
      assert.match(await download.getAttribute("title"), /Styled\.pdf: fix Guide color before Download/)
      await input.locator("input[type=file]").setInputFiles({
        name: "Ordinary.pdf",
        mimeType: "application/pdf",
        buffer: fixture(false),
      })
      await input.locator(".input-current").filter({ hasText: "Ordinary.pdf" }).waitFor()
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await download.isDisabled(), true, "An inactive Input's relevant draft still blocks Download")
      const selection = output.getByRole("textbox", { name: "Page selection", exact: true })
      await selection.fill("1")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await download.isEnabled(), true, "Unused invalid styles do not block Download")
      const pending = page.waitForEvent("download")
      await download.click()
      assert.equal(await (await pending).failure(), null)
      await input.locator(".input-picker > summary").click()
      await input.locator(".input-list button[data-source]").first().click()
      await tab(input, "Grid")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
      assert.equal(await download.isDisabled(), true, "Adding an affected page restores the draft error")
      await tab(input, "Style")
      await color.fill("#123456")
      await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'))
      assert.equal(await download.isEnabled(), true)
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Shortcut help follows the visible views, preserves focus, and starts the tour", { timeout: 60000 }, async () => {
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
      .setInputFiles({ name: "Shortcuts.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
    await selection.fill("1,2")
    await selection.press("Enter")
    const help = page.getByRole("button", { name: "Help", exact: true })
    const helpDialog = page.getByRole("dialog", { name: "Help", exact: true })
    const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
    await selection.press("?")
    assert.equal(await helpDialog.isVisible(), false, "Typing a question mark keeps help closed")
    assert.equal(await selection.inputValue(), "?")
    await selection.fill("")
    for (const [inputMode, outputMode] of [
      ["Grid", "Grid"],
      ["Page", "Grid"],
      ["Grid", "Page"],
      ["Page", "Page"],
      ["Style", "Page"],
    ]) {
      await tab(input, inputMode)
      await tab(output, outputMode)
      await help.click()
      const keyboardTopic = helpDialog.getByRole("tab", { name: "Keyboard", exact: true })
      await keyboardTopic.press("Control+ArrowRight")
      assert.equal(await keyboardTopic.getAttribute("aria-selected"), "true", "Modified arrows retain the Help topic")
      assert.equal(await helpDialog.getByRole("heading", { name: `Input ${inputMode}`, exact: true }).isVisible(), true)
      assert.equal(
        await helpDialog.getByRole("heading", { name: `Output ${outputMode}`, exact: true }).isVisible(),
        true,
      )
      const inputHelp = helpDialog.getByRole("region", { name: `Input ${inputMode.toLowerCase()}`, exact: true })
      const outputHelp = helpDialog.getByRole("region", { name: `Output ${outputMode.toLowerCase()}`, exact: true })
      const shared = helpDialog.getByRole("region", { name: "Workspace shortcuts", exact: true })
      assert.ok(await shared.getByRole("heading", { name: "Workspace", exact: true }).isVisible())
      const hierarchy = await helpDialog.evaluate((element) => {
        const pane = element.querySelector(".shortcut-views section")
        const workspace = element.querySelector('[aria-label="Workspace shortcuts"]')
        return [
          pane.querySelector("h3").getBoundingClientRect().left,
          workspace.querySelector("h3").getBoundingClientRect().left,
          getComputedStyle(pane.querySelector("h3")).color,
          getComputedStyle(workspace.querySelector("h3")).color,
          getComputedStyle(element.querySelector('.shortcut-views section[aria-label^="Output"] h4')).color,
        ]
      })
      assert.ok(Math.abs(hierarchy[0] - hierarchy[1]) < 1, "Pane and Workspace headings share the outer alignment")
      assert.equal(hierarchy[2], hierarchy[3], "Top section headings share their secondary color")
      assert.notEqual(hierarchy[2], hierarchy[4], "Nested headings use a distinct text color")
      for (const [mode, pane] of [
        [inputMode, inputHelp],
        [outputMode, outputHelp],
      ])
        if (mode === "Grid") {
          assert.match(await pane.innerText(), /←\s+\/\s+→\s+Start navigation \(no selection\)/)
          assert.match(await pane.innerText(), /PgUp\s+\/\s+PgDn\s+Previous \/ next thumbnail group/)
        } else if (mode === "Page") {
          assert.match(await pane.innerText(), /0\s+or\s+Z\s+Fit page \(100%\)/)
          assert.match(await pane.innerText(), /PgUp\s+\/\s+PgDn\s+Show previous \/ next page/)
          assert.match(await pane.innerText(), /Home\s+\/\s+End\s+Show first \/ last page/)
          assert.match(await pane.innerText(), /G\s+Go to page/)
        }
      assert.deepEqual(await helpDialog.getByRole("heading", { level: 2 }).allTextContents(), ["Help"])
      if (inputMode !== "Style") {
        assert.equal(await inputHelp.getByRole("heading", { name: "Selection Field", exact: true }).isVisible(), true)
        const inputField = await inputHelp.getByRole("heading", { name: "Selection Field", exact: true }).boundingBox()
        const outputField = await outputHelp
          .getByRole("heading", { name: "Selection Field", exact: true })
          .boundingBox()
        assert.ok(
          Math.abs(inputField.y - outputField.y) < 1,
          "Selection Field headings share one row across visible views",
        )
        assert.match(
          await inputHelp.locator(".shortcut-list").last().innerText(),
          /Enter\s+Add prepared pages to Output/,
        )
      }
      assert.equal(await outputHelp.getByRole("heading", { name: "Selection Field", exact: true }).isVisible(), true)
      assert.match(
        await outputHelp.locator(".shortcut-list").last().innerText(),
        /Enter\s+Remove selected Output pages/,
      )
      assert.match(
        await inputHelp.innerText(),
        inputMode === "Style"
          ? /move between Style controls/
          : inputMode === "Grid"
            ? /Select or unselect page/
            : /Add the current page to Output/,
      )
      assert.match(await outputHelp.innerText(), outputMode === "Grid" ? /Remove page/ : /Zoom in \/ out/)
      if (inputMode === "Grid")
        assert.match(await inputHelp.innerText(), /Shift\s+\+\s+←\s+\/\s+→\s+Select \/ unselect pages/)
      if (outputMode === "Grid") {
        assert.match(await outputHelp.innerText(), /Shift\s+\+\s+←\s+\/\s+→\s+Select \/ unselect pages/)
        assert.match(await outputHelp.innerText(), /Del\s+\/\s+−\s+Remove page/)
      }
      assert.ok(
        await helpDialog
          .getByRole("tabpanel", { name: "Keyboard", exact: true })
          .locator(".shortcut-list dd")
          .evaluateAll((items) =>
            items.every(
              (item) =>
                Math.abs(item.getBoundingClientRect().height - parseFloat(getComputedStyle(item).lineHeight)) < 1,
            ),
          ),
        "Desktop shortcut descriptions fit one line",
      )
      const dimensions = await helpDialog.boundingBox()
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).click()
      assert.deepEqual(await helpDialog.boundingBox(), dimensions, "Help retains its largest tab's dimensions")
      const mouseHelp = helpDialog.getByRole("tabpanel", { name: "Mouse", exact: true })
      assert.equal(await mouseHelp.isVisible(), true)
      assert.match(await mouseHelp.innerText(), /Switch the current page between Grid and Page/)
      assert.match(await mouseHelp.innerText(), /Select or unselect a page/)
      assert.match(await mouseHelp.innerText(), /Click a Page counter\s+Enter a page number/)
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).press("Home")
      assert.equal(
        await helpDialog.getByRole("tab", { name: "Keyboard", exact: true }).getAttribute("aria-selected"),
        "true",
      )
      await page.keyboard.press("ArrowRight")
      assert.equal(
        await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).getAttribute("aria-selected"),
        "true",
      )
      assert.equal(await output.locator(".composition-totals strong").innerText(), "2 PDF pages")
      await page.keyboard.press("Escape")
      await helpDialog.waitFor({ state: "hidden" })
      assert.equal(await help.evaluate((item) => item === document.activeElement), true)
      await page.keyboard.press("?")
      await helpDialog.waitFor()
      for (const [mode, pane] of [
        [inputMode, inputHelp],
        [outputMode, outputHelp],
      ]) {
        assert.equal(await pane.isVisible(), true, "Both panes remain visible when Help reopens with ?")
        if (mode !== "Style") assert.equal(await pane.locator(".shortcut-list dd").first().isVisible(), true)
      }
      await page.keyboard.press("Escape")
    }
    await tab(input, "Grid")
    await tab(output, "Grid")
    for (const [width, height, theme, font] of [
      [2560, 1440, "dark", ""],
      [1920, 1080, "light", ""],
      [1440, 900, "dark", ""],
      [1440, 900, "light", "DejaVu Sans"],
      [1440, 900, "dark", "DejaVu Sans"],
      [1920, 900, "dark", "DejaVu Sans"],
      [2560, 900, "light", "DejaVu Sans"],
    ]) {
      await page.setViewportSize({ width, height })
      await page.evaluate(
        ({ theme: scheme, font: family }) => {
          document.documentElement.dataset.theme = scheme
          document.body.style.fontFamily = family
        },
        { theme, font },
      )
      await help.click()
      for (const topic of ["Keyboard", "Mouse"]) {
        await helpDialog.getByRole("tab", { name: topic, exact: true }).click()
        const dimensions = await helpDialog.evaluate((dialog) =>
          [dialog, ...dialog.querySelectorAll(".help-panels > [role=tabpanel]")].map((element) => ({
            name: element.className || element.getAttribute("aria-labelledby"),
            width: element.clientWidth,
            height: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          })),
        )
        assert.ok(
          dimensions.every((size) => size.scrollHeight <= size.height + 1 && size.scrollWidth <= size.width + 1),
          `${topic} Help fits ${width}×${height} with ${font || "the system font"} without scrolling: ${JSON.stringify(dimensions)}`,
        )
      }
      await page.keyboard.press("Escape")
    }
    await page.evaluate(() => document.body.style.removeProperty("font-family"))
    await page.setViewportSize({ width: 1440, height: 1100 })
    await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click()
    await page.keyboard.press("Space")
    await page.waitForFunction(() => document.activeElement?.matches(".page-image[aria-pressed=false]"))
    const helpCursor = await page.evaluate(() => document.activeElement.getAttribute("aria-label"))
    await page.keyboard.press("?")
    await helpDialog.waitFor()
    await page.keyboard.press("Escape")
    await page.waitForFunction((name) => document.activeElement?.getAttribute("aria-label") === name, helpCursor)
    await help.click()
    await helpDialog.getByRole("button", { name: "Start Tour", exact: true }).click()
    await tour.waitFor()
    assert.equal(await helpDialog.isVisible(), false)
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    assert.match(await tour.innerText(), /Select pages using images, grips, or the page field/)
    assert.match(await tour.innerText(), /Borders and the page field show the same selection/)
    assert.match(await tour.innerText(), /clears the preparation/)
    assert.match(await tour.innerText(), /Without a selection, a card’s \+ adds one copy/)
    await tour.getByRole("button", { name: "End tour", exact: true }).click()
    assert.equal(await help.evaluate((item) => item === document.activeElement), true)
    assert.equal(await selection.inputValue(), "")
    assert.equal(await output.locator(".composition-totals strong").innerText(), "2 PDF pages")
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Style requires applicable Output references and retains independent Source choices",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        window.styleRequests = 0
        const Original = window.Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (message.changes) window.styleRequests++
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const open = async (name, buffer) => {
        const count = await page.locator(".input-list button[data-source]").count()
        await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
        await page.locator(".input-current").filter({ hasText: name }).waitFor()
        await page.waitForFunction(
          (previous) => document.querySelectorAll(".input-list button[data-source]").length === previous + 1,
          count,
        )
      }
      const choose = async (index) => {
        await page.locator(".input-picker > summary").click()
        await page.locator(".input-list button[data-source]").nth(index).click()
      }
      const style = () => input.getByRole("tab", { name: "Style", exact: true }).click()
      const color = () =>
        input
          .locator("article.control")
          .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
          .locator("input[type=text]")
      const ready = () => output.getByRole("button", { name: "Download", exact: true }).waitFor()
      const add = async (selection) => {
        await input.getByRole("tab", { name: "Grid", exact: true }).click()
        await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(selection)
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await ready()
      }
      await open("Styled.pdf", fixture(true, false, 2))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await input.getByRole("tab", { name: "Page", exact: true }).click()
      await input.getByRole("button", { name: "Next Input page", exact: true }).click()
      assert.equal(await page.evaluate(() => window.styleRequests), 0)
      await add("2,3")
      await style()
      const authoredColor = await color().inputValue()
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
      await ready()
      await color().fill("#123456")
      await ready()
      await open("Styled.pdf", fixture(true, false, 2))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await add("2")
      await style()
      assert.equal(await color().inputValue(), authoredColor)
      await color().fill("#abcdef")
      await ready()
      await output.getByRole("tab", { name: "Page", exact: true }).click()
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      const requests = await page.evaluate(() => window.styleRequests)
      await open("Ordinary.pdf", fixture(false))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).count(), 0)
      await add("1")
      await choose(0)
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await add("2")
      await style()
      assert.equal(await color().inputValue(), "#123456")
      await choose(1)
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await add("2")
      await style()
      assert.equal(await color().inputValue(), "#abcdef")
      assert.equal(await page.evaluate(() => window.styleRequests), requests)
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const downloaded = await pending
      const bytes = await readFile(await downloaded.path())
      const colors = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        try {
          const result = await processor.run(Uint8Array.from(buffer), 1)
          return Object.values(result.description.parameters)
            .filter((entry) => entry.parameter.schema.title === "Guide color")
            .map((entry) => entry.parameter.value)
            .toSorted()
        } finally {
          processor.dispose()
        }
      }, Array.from(bytes))
      assert.deepEqual(colors, ["#123456", "#abcdef"])
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Style and Download cancellation release preview workers and retain choices", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.addInitScript(trackWorkers)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Preview.pdf",
        mimeType: "application/pdf",
        buffer: fixture(true, false, 2),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-3")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await tab(input, "Style")
    await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts")
      const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()))
      const pdf = await task.promise
      const prototype = Object.getPrototypeOf(await pdf.getPage(1))
      const render = prototype.render
      window.holdPDFRendering = true
      window.pdfContinuations = []
      prototype.render = function (...args) {
        const drawing = render.apply(this, args)
        drawing.onContinue = (proceed) => (window.holdPDFRendering ? window.pdfContinuations.push(proceed) : proceed())
        return drawing
      }
      await task.destroy()
    })
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    await page.waitForFunction(() => window.pdfContinuations.length > 0)
    await input.getByRole("button", { name: "Cancel style processing", exact: true }).click()
    await page.waitForFunction(
      () => window.workers.filter((worker) => worker.url.includes("pdf.worker")).at(-1).terminated,
    )
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages")
    assert.equal(await page.getByRole("button", { name: "Retry Input styles", exact: true }).count(), 1)
    await page.evaluate(() => {
      window.holdPDFRendering = false
      window.pdfContinuations = []
    })
    await page.getByRole("button", { name: "Retry Input styles", exact: true }).click()
    await output.getByRole("button", { name: "Download", exact: true }).waitFor()
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(), "0.04")
    assert.equal(await page.locator(".error-banner").count(), 0)
    await page.evaluate(() => (window.holdPDFRendering = true))
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("generic")
    await page.waitForFunction(() => window.pdfContinuations.length > 0)
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    await page.waitForFunction(
      () => window.workers.filter((worker) => worker.url.includes("pdf.worker")).at(-1).terminated,
    )
    assert.equal(await output.getByRole("button", { name: "Download", exact: true }).isEnabled(), true)
    assert.equal(await page.locator(".error-banner").count(), 0)
    await page.evaluate(() => (window.pdfContinuations = []))
    const downloads = []
    page.on("download", (download) => downloads.push(download))
    await page.evaluate(() => (window.holdPDFRendering = true))
    await output.getByRole("button", { name: "Download", exact: true }).click()
    await page.waitForFunction(() => window.pdfContinuations.length > 0)
    await page.getByRole("dialog", { name: "Download", exact: true }).press("Escape")
    await page.waitForFunction(
      () => window.workers.filter((worker) => worker.url.includes("pdf.worker")).at(-1).terminated,
    )
    assert.equal(await page.getByRole("dialog", { name: "Download", exact: true }).isVisible(), false)
    assert.equal(downloads.length, 0)
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages")
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
    await page.evaluate(() => {
      window.holdPDFRendering = false
      window.pdfContinuations = []
    })
    const saved = page.waitForEvent("download")
    await output.getByRole("button", { name: "Download", exact: true }).click()
    assert.equal(await (await saved).failure(), null)
    assert.equal(downloads.length, 1)
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Info reports actions, errors stay above the workspace, and newer feedback survives style processing",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Status.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, false, 2),
        })
      const status = page.locator(".footnote [role=status]")
      await page.locator(".input-current").filter({ hasText: "Status.pdf" }).waitFor({ timeout: 60000 })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      assert.equal(await status.textContent(), "Added 2 pages to Output.")
      await input.getByRole("tab", { name: "Style", exact: true }).click()
      const profile = input.getByRole("combobox", { name: "Style profile", exact: true })
      await profile.selectOption("inkjet")
      await status.filter({ hasText: "Applied Inkjet profile." }).waitFor()
      const width = input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true })
      assert.equal(await width.inputValue(), "0.04")
      await width.fill("0")
      const validation = page.locator(".error-banner")
      assert.match(await validation.textContent(), /Invalid value for Guide width\. Width must be greater than zero\./)
      assert.equal(await status.count(), 0)
      assert.equal(
        await validation.evaluate((element) => getComputedStyle(element).color),
        await input.locator(".style-status [role=status]").evaluate((element) => getComputedStyle(element).color),
      )
      assert.notEqual(
        await validation.evaluate((element) => getComputedStyle(element).color),
        await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
      )
      await input.getByRole("button", { name: "Reset Guide Width", exact: true }).click()
      await status.filter({ hasText: "Restored Guide width to the original style." }).waitFor()
      assert.equal(
        await status.evaluate((element) => getComputedStyle(element).color),
        await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
      )
      assert.equal(Number(await width.inputValue()), 0.2 * (25.4 / 72)) // The authored 0.2 pt width in mm.
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await output.getByRole("button", { name: "Select Output page 2", exact: true }).click()
      await output.getByLabel("Output page actions", { exact: true }).click()
      // Both actions occur before the debounced style processing starts.
      await page.evaluate(() => {
        const select = document.querySelector(".style-profile select")
        select.value = "inkjet"
        select.dispatchEvent(new Event("change", { bubbles: true }))
        document.querySelector('button[aria-label="Move selected pages earlier"]').click()
      })
      await output.getByRole("button", { name: "Download", exact: true }).waitFor()
      assert.equal(await width.inputValue(), "0.04")
      assert.equal(await status.textContent(), "Moved 1 page earlier.")
      await page.evaluate(() => {
        const select = document.querySelector(".style-profile select")
        select.value = "generic"
        select.dispatchEvent(new Event("change", { bubbles: true }))
      })
      await input.getByRole("button", { name: "Cancel style processing", exact: true }).click()
      assert.equal(await status.textContent(), "Cancelled style processing. Your choices are retained.")
      await page.setViewportSize({ width: 390, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await checkStatus(page)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await page.getByRole("button", { name: "Retry Input styles", exact: true }).click()
      await status.filter({ hasText: "Updated styles." }).waitFor()
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await pending
      assert.equal(await saved.failure(), null)
      assert.equal(await status.textContent(), `Downloaded 2 pages · ${saved.suggestedFilename()}.`)
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Broken.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("invalid PDF"),
        })
      await page.locator(".error-banner").filter({ hasText: "Could not open Broken.pdf." }).waitFor()
      assert.equal(await status.count(), 0)
      assert.match(await page.locator(".error-banner").textContent(), /PDF Composer cannot read this PDF/)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "2 PDF pages")
      assert.equal(await page.locator(".error-banner").count(), 1)
      // Preserve PDF byte offsets to isolate an unknown manifest field.
      const unknown = Buffer.from(fixture().toString().replace('"groups":', '"extra": '))
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Unknown.pdf",
        mimeType: "application/pdf",
        buffer: unknown,
      })
      await page.locator(".error-banner").filter({ hasText: "Could not open Unknown.pdf." }).waitFor()
      assert.equal(await status.count(), 0)
      const banner = page.locator(".error-banner")
      assert.match(await banner.textContent(), /style information.*invalid or incompatible/)
      assert.match(await banner.textContent(), /Your workspace is retained\. Choose a PDF to retry\./)
      assert.match(await banner.textContent(), /prepare it again with the current Mainz format/)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "2 PDF pages")
      for (const [viewportWidth, text, colorScheme] of [
        [1440, "100%", "light"],
        [320, "200%", "dark"],
        [390, "200%", "light"],
      ]) {
        await page.setViewportSize({ width: viewportWidth, height: 1000 })
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        assert.notEqual(
          await banner.evaluate((element) => getComputedStyle(element).color),
          await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
        )
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        const bounds = await banner.boundingBox(),
          workspace = await page.locator(".composer").boundingBox()
        assert.ok(bounds.y + bounds.height <= workspace.y, "Document errors stay above the workspace")
        await checkStatus(page)
      }
      await page.getByRole("button", { name: "Dismiss error", exact: true }).focus()
      await page.keyboard.press("Enter")
      assert.equal(await banner.count(), 0)
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Style selectors retain touch height and inset arrows across workspace widths", { timeout: 90000 }, async (t) => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo&paint`)
    const chooser = page.getByRole("combobox", { name: "Style profile", exact: true })
    await chooser.waitFor()
    for (const width of [320, 390, 744, 768, 810, 1024, 1080, 1133, 1440, 1920, 2560, 3840]) {
      await page.setViewportSize({ width, height: 1080 })
      for (const theme of ["light", "dark"])
        for (const scale of [100, 200]) {
          const label = `${width}px, ${theme}, ${scale}% text`
          t.diagnostic(label)
          await page.evaluate(
            (value) => {
              document.documentElement.dataset.theme = value.theme
              document.documentElement.style.fontSize = `${value.scale}%`
            },
            { theme, scale },
          )
          await chooser.evaluate((select) => select.scrollIntoView({ block: "center" }))
          const geometry = await chooser.evaluate((select) => {
            const field = select.getBoundingClientRect()
            const svg = select.nextElementSibling
            const path = svg.querySelector("path")
            const bounds = path.getBBox(),
              matrix = path.getScreenCTM()
            const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(
              matrix,
            )
            const icon = svg.getBoundingClientRect()
            const inset = parseFloat(getComputedStyle(svg).insetInlineEnd)
            return {
              height: field.height,
              x: center.x - (field.right - inset - icon.width / 2),
              y: center.y - (field.y + field.height / 2),
              inset: field.right - icon.right,
              target: document.elementFromPoint(center.x, center.y) === select,
              overflow: document.documentElement.scrollWidth > innerWidth,
            }
          })
          assert.ok(geometry.height >= 46, `${label}: full-height profile field`)
          assert.ok(Math.abs(geometry.x) < 1 && Math.abs(geometry.y) < 1, `${label}: visible arrow center`)
          assert.ok(geometry.inset >= 12, `${label}: inset arrow`)
          assert.equal(geometry.target, true, `${label}: the arrow retains the native select target`)
          assert.equal(geometry.overflow, false, `${label}: no horizontal overflow`)
          const output = page.locator(".composition-output .sequence-entry > .entry")
          if (await output.isVisible()) {
            const reference = await output.boundingBox(),
              field = await chooser.boundingBox()
            assert.ok(Math.abs(field.y - reference.y) < 1, `${label}: profile and Output field share a row`)
            assert.ok(
              Math.abs(field.height - reference.height) < 1,
              `${label}: profile and Output field share a height`,
            )
          }
        }
    }
    await page.setViewportSize({ width: 1440, height: 1080 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Enum styles.pdf",
        mimeType: "application/pdf",
        buffer: fixture(true, false, 2, false, false, { enum: [0.04, 0.2, 1] }),
      })
    const input = page.locator(".selection-panel")
    await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "Enum styles.pdf")
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    const choice = input.getByRole("combobox", { name: "Guide Width (mm)", exact: true })
    await choice.selectOption("1")
    assert.equal(await choice.inputValue(), "1", "The shared select preserves enum edits")
    assert.ok((await choice.boundingBox()).height >= 44, "Enum fields retain full touch height")
    assert.ok((await choice.locator("..").locator("svg").boundingBox()).width > 0, "Enum fields share the inset arrow")
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Settings steps lens magnification by two and keeps its value beside the controls",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      const settings = page.getByRole("dialog", { name: "Settings", exact: true })
      await page.getByRole("button", { name: "Settings", exact: true }).click()
      const value = settings.getByLabel("Lens magnification", { exact: true })
      const close = settings.getByRole("button", { name: "Close Settings", exact: true })
      assert.equal(
        await close.evaluate((button) => button.matches(":focus-visible")),
        false,
        "Pointer opening does not outline Close",
      )
      assert.equal(
        await settings.evaluate((dialog) => dialog.contains(document.activeElement)),
        true,
        "Focus stays in Settings",
      )
      const decrease = settings.getByRole("button", { name: "Decrease lens magnification", exact: true })
      const increase = settings.getByRole("button", { name: "Increase lens magnification", exact: true })
      assert.equal(await value.textContent(), "16×")
      for (const width of [320, 810, 1440])
        for (const theme of ["light", "dark"])
          for (const scale of [100, 200]) {
            const label = `${width}px, ${theme}, ${scale}% text`
            await page.setViewportSize({ width, height: 1080 })
            await page.evaluate(
              (appearance) => {
                document.documentElement.dataset.theme = appearance.theme
                document.documentElement.style.fontSize = `${appearance.scale}%`
              },
              { theme, scale },
            )
            for (const expected of [8, 4, 2]) {
              await decrease.press("Enter")
              assert.equal(await value.textContent(), `${expected}×`, label)
            }
            assert.equal(await decrease.isDisabled(), true, `${label}: lower boundary`)
            for (const expected of [4, 8, 16, 32, 64, 128]) {
              await increase.press(expected === 16 ? "Space" : "Enter")
              assert.equal(await value.textContent(), `${expected}×`, label)
            }
            assert.equal(await increase.isDisabled(), true, `${label}: upper boundary`)
            const boxes = await Promise.all([value.boundingBox(), decrease.boundingBox(), increase.boundingBox()])
            for (const box of boxes.slice(1)) {
              assert.ok(box.width >= 44 && box.height >= 44, `${label}: full touch target`)
              assert.ok(
                Math.abs(box.y + box.height / 2 - boxes[0].y - boxes[0].height / 2) < 1,
                `${label}: value center`,
              )
            }
            assert.ok(
              boxes[0].x + boxes[0].width <= boxes[1].x && boxes[1].x + boxes[1].width <= boxes[2].x,
              `${label}: separate controls`,
            )
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, label)
            for (const expected of [64, 32, 16]) {
              await decrease.click()
              assert.equal(await value.textContent(), `${expected}×`, label)
            }
          }
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "Settings", exact: true }).press("Enter")
      assert.equal(await value.textContent(), "16×", "Closing Settings retains lens magnification")
      assert.equal(
        await close.evaluate((button) => button === document.activeElement && button.matches(":focus-visible")),
        true,
        "Keyboard opening keeps visible Close focus",
      )
      await close.press("Tab")
      assert.equal(
        await decrease.evaluate((button) => button === document.activeElement && button.matches(":focus-visible")),
        true,
        "Keyboard navigation keeps visible control focus",
      )
      await page.keyboard.press("Escape")
      // Touch clicks can carry zero detail even after a pointer activation.
      const opener = page.getByRole("button", { name: "Settings", exact: true })
      await opener.dispatchEvent("pointerdown", { pointerType: "touch" })
      await opener.dispatchEvent("click", { detail: 0 })
      assert.equal(
        await close.evaluate((button) => button.matches(":focus-visible")),
        false,
        "Touch opening does not outline Close",
      )
      await page.keyboard.press("Escape")
      await page.setViewportSize({ width: 1440, height: 1080 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Lens.pdf",
          mimeType: "application/pdf",
          buffer: fixture(false),
        })
      await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "Lens.pdf")
      const rasters = []
      for (const [expected, steps] of [
        [2, -3],
        [128, 6],
      ]) {
        await page.getByRole("button", { name: "Settings", exact: true }).click()
        for (let index = 0; index < Math.abs(steps); index++) await (steps < 0 ? decrease : increase).click()
        assert.equal(await value.textContent(), `${expected}×`)
        await close.click()
        const canvas = page.locator(".selection-panel .thumbnail canvas").first()
        await page.locator('.selection-panel .thumbnail[aria-busy="false"]').first().waitFor()
        const bounds = await canvas.boundingBox()
        await canvas.hover({
          position: {
            x: (bounds.width * 20) / 595.2756,
            y: (bounds.height * (841.8898 - 250)) / 841.8898,
          },
        })
        const lens = page.getByRole("region", { name: `Magnified page 1 at ${expected}×`, exact: true })
        await lens.waitFor()
        await page.waitForFunction(() => document.querySelector(".lens")?.getAttribute("aria-busy") === "false")
        rasters.push(
          await lens
            .locator("canvas")
            .evaluate((raster) => ({ width: raster.width, height: raster.height, pixels: raster.toDataURL() })),
        )
        await page.mouse.move(0, 0)
        await lens.waitFor({ state: "detached" })
      }
      assert.ok(rasters[0].width > 0 && rasters[0].height > 0)
      assert.equal(rasters[0].width, rasters[1].width, "Magnification retains the bounded crop width")
      assert.equal(rasters[0].height, rasters[1].height, "Magnification retains the bounded crop height")
      assert.notEqual(rasters[0].pixels, rasters[1].pixels, "The endpoint values change the rendered crop")
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Quartets and profiles preserve PDF edits and open files without profiles", { timeout: 180000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    const sample = await readFile("test/fixtures/demo.pdf")
    const open = async (name, buffer) => {
      await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
      await page.waitForFunction((label) => document.querySelector(".input-current")?.textContent === label, name, {
        timeout: 60000,
      })
      await page.locator(".composer:not([inert])").waitFor()
    }
    await open("demo.pdf", sample)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const chooser = input.getByRole("combobox", { name: "Style profile", exact: true })
    assert.equal(await chooser.inputValue(), "generic")
    const profileBox = await chooser.boundingBox()
    const selectionBox = await output.locator(".sequence-entry > .entry").boundingBox()
    assert.ok(Math.abs(profileBox.y - selectionBox.y) < 1, `Profile ${profileBox.y}, Output ${selectionBox.y}`)
    assert.ok(Math.abs(profileBox.height - selectionBox.height) < 1)
    assert.ok(await input.locator(".quartet").count())
    assert.equal(await page.locator(".status-input").textContent(), "demo.pdf")
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.getByRole("button", { name: "Start Tour", exact: true }).click()
      const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "input",
      )
      for (const step of ["input-grid", "input-page", "style", "style-profile"]) {
        await tour.getByRole("button", { name: "Next", exact: true }).click()
        await page.waitForFunction(
          (key) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === key,
          step,
        )
      }
      const target = page.locator('[data-tour-target="style-profile"]')
      assert.match(await tour.locator(".tour-progress").textContent(), /\/ 8/)
      assert.equal(await target.isVisible(), true)
      assert.equal(await target.getAttribute("data-tour-active"), "true")
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await chooser.inputValue(), "generic")
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-grid",
      )
      await tour.getByRole("button", { name: "Back", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "style-profile",
      )
      assert.equal(await target.isVisible(), true)
      await page.keyboard.press("Escape")
      assert.equal(await chooser.inputValue(), "generic")
      assert.equal(await output.locator(".composition-card").count(), 2)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    assert.deepEqual(
      await input.locator(".style-group > summary > span:not(.count) > span:first-child").allTextContents(),
      ["Patterns", "Guides", "Watermark"],
    )
    assert.equal(
      await input.getByText("Reference shapes and lighter repeats for writing practice.", { exact: true }).isVisible(),
      true,
    )
    const pattern = input.getByRole("group", { name: "Pattern", exact: true })
    const patternSection = input
      .locator(".style-group")
      .filter({ has: page.locator("summary").getByText("Patterns", { exact: true }) })
    assert.equal(await patternSection.getByRole("img", { name: "1 Style object", exact: true }).textContent(), "1")
    assert.equal(
      await pattern
        .getByText("Reference shapes across a full sheet or the first row or column of a partial sheet.", {
          exact: true,
        })
        .isVisible(),
      true,
    )
    assert.equal(await pattern.getByRole("checkbox").count(), 1)
    assert.deepEqual(
      await pattern
        .getByRole("img", { name: "Fill color: #999999", exact: true })
        .locator("span")
        .evaluate((element) => ({
          color: getComputedStyle(element).backgroundColor,
          opacity: getComputedStyle(element).opacity,
        })),
      { color: "rgb(153, 153, 153)", opacity: "1" },
    )
    assert.match(await pattern.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/)
    await checkGeometry(pattern)
    const watermark = input.getByRole("group", { name: "Stamp", exact: true })
    await checkGeometry(watermark)
    for (const label of ["Stroke Paint duo", "Width"])
      assert.equal(await watermark.getByRole("note", { name: `${label}: not applicable`, exact: true }).count(), 1)
    await watermark.getByLabel("Edit Fill", { exact: true }).click()
    await watermark.getByRole("textbox", { name: "Stamp Fill Color", exact: true }).fill("#336699")
    await watermark.getByRole("spinbutton", { name: "Stamp Fill Opacity (ratio)", exact: true }).fill("0.6")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await chooser.inputValue(), "generic")
    assert.match(await watermark.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /60%/)
    await page.keyboard.press("Escape")
    const guides = input.getByRole("group", { name: "Minors", exact: true })
    assert.match(
      await guides.getByRole("note", { name: "Fill Paint duo: not applicable", exact: true }).getAttribute("title"),
      /neither fill color nor fill opacity/,
    )
    const reveal = async (title, label) => {
      const group = input.getByRole("group", { name: title, exact: true })
      const summary = group.getByLabel(`Edit ${label === "Color" || label === "Opacity" ? "Stroke" : label}`, {
        exact: true,
      })
      if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click()
      return group
    }
    const minor = input.getByRole("group", { name: "Minors", exact: true })
    const major = input.getByRole("group", { name: "Majors", exact: true })
    assert.equal(await input.getByRole("group", { name: "Slants", exact: true }).count(), 1)
    const guideSection = input
      .locator(".style-group")
      .filter({ has: page.locator("summary").getByText("Guides", { exact: true }) })
    await guideSection.locator(":scope > summary").click()
    assert.equal(await minor.isVisible(), false)
    const guideHelp = input.getByText("Reference lines for letter alignment.", {
      exact: true,
    })
    assert.equal(await guideHelp.isVisible(), true)
    await guideSection.locator(":scope > summary").press("Enter")
    assert.equal(await minor.isVisible(), true)
    assert.equal(await guideHelp.isVisible(), true)
    const labels = await guideSection.locator(".style-object > h4 > span:first-child").allTextContents()
    assert.deepEqual(labels, ["Slants", "Angles", "Minors", "Majors", "Halves"])
    const visibility = pattern.getByRole("checkbox")
    await visibility.uncheck()
    assert.equal(await visibility.isChecked(), false)
    assert.equal(await pattern.locator(".quartet-panel:visible").count(), 0)
    await visibility.check()
    assert.equal(await visibility.isChecked(), true)
    await reveal("Minors", "Width")
    const baselineWidth = await minor
      .getByRole("spinbutton", { name: "Minors Stroke Width (mm)", exact: true })
      .inputValue()
    assert.ok(Math.abs(Number(baselineWidth) - 0.08) < 1e-6)
    await chooser.selectOption("inkjet")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await pattern.getByRole("img", { name: "Fill color: #6B7F99", exact: true }).count(), 1)
    await reveal("Minors", "Width")
    const widthHelp = minor
      .locator(".quartet-panel")
      .getByText("Thickness of the outlines, in millimeters.", { exact: true })
    assert.equal(await widthHelp.isVisible(), true)
    const widthControl = minor.getByRole("spinbutton", {
      name: "Minors Stroke Width (mm)",
      exact: true,
    })
    assert.equal(
      (await widthControl.getAttribute("aria-describedby")).split(" ").includes(await widthHelp.getAttribute("id")),
      true,
    )
    await page.mouse.move(0, 0)
    assert.equal(await minor.locator(".quartet-panel:visible > section").count(), 1)
    assert.equal(
      await minor
        .locator(".quartet-component")
        .nth(2)
        .locator(".quartet-value")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgba(0, 0, 0, 0)",
    )
    assert.equal(
      await input.getByRole("spinbutton", { name: "Minors Stroke Width (mm)", exact: true }).inputValue(),
      "0.04",
    )
    assert.match(await input.locator(".style-profile").textContent(), /Finer guides and soft blue pattern fills/)
    const fillTrigger = pattern.getByLabel("Edit Fill", { exact: true })
    await fillTrigger.click()
    assert.equal(await minor.locator(".quartet-panel:visible").count(), 0)
    await pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true }).focus()
    await page.keyboard.press("Escape")
    assert.equal(await pattern.locator(".quartet-panel:visible").count(), 0)
    assert.equal(await fillTrigger.evaluate((element) => element === document.activeElement), true)
    await reveal("Minors", "Width")
    await checkStatus(page)
    const pending = page.waitForEvent("download", { timeout: 60000 })
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const download = await pending
    assert.equal(await download.failure(), null)
    const saved = await readFile(await download.path())
    await open("inkjet.pdf", saved)
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await output.getByRole("button", { name: "Remove Output page 2", exact: true }).click()
    await output.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
    await input.getByRole("tab", { name: "Grid", exact: true }).click()
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    assert.equal(await chooser.inputValue(), "inkjet")
    await reveal("Minors", "Width")
    const width = input.getByRole("spinbutton", {
      name: "Minors Stroke Width (mm)",
      exact: true,
    })
    await width.fill("0.05")
    assert.equal(await chooser.inputValue(), "")
    assert.match(await chooser.textContent(), /Custom/)
    await chooser.selectOption("generic")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await width.inputValue(), baselineWidth)
    await reveal("Minors", "Opacity")
    const strokePaint = minor.getByRole("region", {
      name: "Stroke Paint duo editor",
      exact: true,
    })
    assert.equal(await strokePaint.getByRole("textbox", { name: "Minors Stroke Color", exact: true }).count(), 1)
    assert.equal(
      await strokePaint.getByRole("spinbutton", { name: "Minors Stroke Opacity (ratio)", exact: true }).count(),
      1,
    )
    const minorOpacity = input.getByRole("spinbutton", {
      name: "Minors Stroke Opacity (ratio)",
      exact: true,
    })
    const majorOpacity = major.locator('.quartet-text[title^="Stroke opacity:"]')
    const originalMajorOpacity = await majorOpacity.textContent()
    await minorOpacity.fill("0.3")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await minorOpacity.inputValue(), "0.3")
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity)
    const minorVisibility = minor.getByRole("checkbox")
    await minorVisibility.uncheck()
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.match(await minor.locator('.quartet-text[title^="Stroke opacity:"]').textContent(), /30%/)
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity)
    const editedPending = page.waitForEvent("download", { timeout: 60000 })
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const edited = await editedPending
    assert.equal(await edited.failure(), null)
    await open("custom.pdf", await readFile(await edited.path()))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    await reveal("Minors", "Opacity")
    assert.equal(await minorOpacity.inputValue(), "0.3")
    assert.equal(await watermark.getByRole("img", { name: "Fill color: #336699", exact: true }).count(), 1)
    assert.match(await watermark.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /60%/)
    assert.equal(await minorVisibility.isChecked(), false)
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity)
    await minorVisibility.check()
    assert.match(await minor.locator('.quartet-text[title^="Stroke opacity:"]').textContent(), /30%/)
    await open("single.pdf", fixture(true, false, 1))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    assert.equal(await input.locator(".style-profile").count(), 0)
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).count(), 1)
    await open("no-profile.pdf", fixture())
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    assert.equal(await input.locator(".style-profile").count(), 0)
    assert.equal(await page.locator(".error-banner").count(), 0)
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).count(), 1)
    await open("fill-only.pdf", fixture(true, false, 0, true, true))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const filled = input.getByRole("group", { name: "Guides", exact: true })
    await checkGeometry(filled)
    for (const label of ["Stroke Paint duo", "Width"])
      assert.equal(await filled.getByRole("note", { name: `${label}: not applicable`, exact: true }).count(), 1)
    await filled.getByLabel("Edit Fill", { exact: true }).click()
    await filled.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#A9A9A9")
    await filled.getByRole("spinbutton", { name: "Fill Opacity (ratio)", exact: true }).fill("0.4")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.match(await filled.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/)
    await page.keyboard.press("Escape")
    await filled.getByRole("checkbox").uncheck()
    assert.match(await filled.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/)
    await filled.getByRole("checkbox").check()
    await open("mixed-paint.pdf", fixture(true, true, 0, true))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const mixed = input.getByRole("group", { name: "Guides", exact: true }).getByRole("checkbox")
    assert.equal(await mixed.evaluate((element) => element.indeterminate), true)
    await mixed.focus()
    await mixed.press("Space")
    assert.equal(await mixed.isChecked(), true)
    assert.equal(await mixed.evaluate((element) => element.indeterminate), false)
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await input.getByRole("button", { name: "Reset all styles", exact: true }).click()
    assert.equal(await mixed.evaluate((element) => element.indeterminate), true)
    await open("bounded-choices.pdf", fixture(true, false, 0, false, false, { enum: [0.02, 0.08], minimum: 0.05 }))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const choices = input.getByRole("combobox", { name: "Guide Width (mm)", exact: true })
    assert.equal(await choices.getByRole("option", { name: "0.02", exact: true }).isDisabled(), true)
    assert.equal(await choices.getByRole("option", { name: "0.08", exact: true }).isEnabled(), true)
    await choices.selectOption("0.08")
    await input.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
    assert.equal(await choices.inputValue(), "0.08")
    assert.equal(await page.locator(".error-banner").count(), 0)
    await page.close()
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Opaque parameter IDs retain style edits, draft errors, and downloaded values", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    let pdf = fixture(true, false, 2, true).toString()
    for (const [id, name] of [
      ["guides-stroke-color", "__proto__"],
      ["guides-stroke-width", "toString"],
      ["guides-stroke-opacity", "constructor"],
      ["guides-display", "hasOwnProperty"],
    ]) {
      // JSON whitespace keeps the PDF's stream length and xref offsets intact.
      pdf = pdf.replaceAll(JSON.stringify(id), JSON.stringify(name).padEnd(id.length + 2))
    }
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Opaque.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(pdf),
      })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
    await tab(input, "Style")
    assert.equal(await input.getByRole("button", { name: "Edit Stroke", exact: true }).count(), 1)
    assert.deepEqual(errors, [])
    await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
    const color = input.getByRole("textbox", { name: "Guide Color", exact: true })
    await color.fill("invalid")
    assert.equal(await color.getAttribute("aria-invalid"), "true")
    assert.match(await input.locator(".control .error").innerText(), /six hexadecimal digits/)
    assert.equal(await input.locator('.quartet-text[title^="Stroke color:"] > span:last-child').innerText(), "Invalid")
    assert.equal(await input.locator(".control .scope").first().textContent(), "Input pages: 1-7")
    await color.fill("#ff0000")
    await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'))
    assert.equal(await color.inputValue(), "#ff0000")
    assert.equal(await input.locator('.quartet-text[title^="Stroke color:"] > span:last-child').innerText(), "#ff0000")
    await input.getByRole("button", { name: "Edit Width", exact: true }).click()
    await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.4")
    await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'))
    const completed = page.waitForEvent("download")
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const downloaded = await completed
    await input.locator("input[type=file]").setInputFiles({
      name: downloaded.suggestedFilename(),
      mimeType: "application/pdf",
      buffer: await readFile(await downloaded.path()),
    })
    await input.locator(".input-current").filter({ hasText: downloaded.suggestedFilename() }).waitFor()
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#ff0000")
    await input.getByRole("button", { name: "Reset Guide Color", exact: true }).click()
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#333333")
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Page addition hint skips on any click", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "no-preference",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0] + "?demo=empty")
    const flight = page.locator(".page-flight:popover-open")
    const total = () => page.locator(".composition-totals strong").innerText()
    const pause = () => flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.pause()))
    await flight.waitFor()
    await pause()
    await page.locator(".header-note").click()
    assert.equal(await flight.count(), 0, "Clicking outside page controls immediately skips a paused animation")
    assert.equal(
      await page.getByRole("banner").getByRole("status").count(),
      0,
      "Skipping also dismisses the addition notice",
    )
    assert.equal(await total(), "0 PDF pages")
    await page.reload()
    await flight.waitFor()
    await pause()
    await page.getByRole("button", { name: "Settings", exact: true }).click()
    const settings = page.getByRole("dialog", { name: "Settings", exact: true })
    assert.equal(await settings.isVisible(), true, "The same click still opens Settings")
    assert.equal(await flight.count(), 0)
    await settings.getByRole("button", { name: "Close Settings", exact: true }).click()
    await page.setViewportSize({ width: 390, height: 900 })
    await page.reload()
    await flight.waitFor()
    await pause()
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Output", exact: true })
      .tap()
    assert.equal(await flight.count(), 0, "Touch activation also skips the animation immediately")
    assert.equal(await page.locator(".composition-output").isVisible(), true)
    assert.equal(await total(), "0 PDF pages")
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Onboarding reset is consumed once and preserves other preferences", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    const url = server.resolvedUrls.local[0]
    await page.goto(url)
    await page.evaluate(() => {
      localStorage.setItem("mainz:onboarding", "19")
      localStorage.setItem("mainz:theme", "dark")
    })
    const open = async () => {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "welcome.pdf", mimeType: "application/pdf", buffer: fixture() })
      await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "welcome.pdf", null, {
        timeout: 30000,
      })
    }
    await page.goto(`${url}?reset&keep=1#practice`)
    await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).waitFor()
    assert.equal(new URL(page.url()).search, "?keep=1")
    assert.equal(new URL(page.url()).hash, "#practice")
    assert.deepEqual(
      await page.evaluate(() => [localStorage.getItem("mainz:onboarding"), localStorage.getItem("mainz:theme")]),
      [null, "dark"],
    )
    await open()
    const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
    await welcome.waitFor()
    await welcome.getByRole("button", { name: "Skip", exact: true }).click()
    await page.reload()
    await open()
    assert.equal(await welcome.isVisible(), false)
    assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), "19")
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "PDF workspace preserves composition, styles, focus, and responsive controls",
  { timeout: 240000 },
  async (context) => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    let page
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      await page.addInitScript(() => {
        const Original = Worker
        window.Worker = class extends Original {
          #processor = false
          constructor(url, options) {
            super(url, options)
            if (String(url).includes("processor.worker")) {
              this.#processor = true
              const root = document.documentElement
              root.dataset.processors = String(Number(root.dataset.processors ?? 0) + 1)
              root.dataset.activeProcessors = String(Number(root.dataset.activeProcessors ?? 0) + 1)
            }
          }
          terminate() {
            if (this.#processor) {
              const root = document.documentElement
              root.dataset.activeProcessors = String(Number(root.dataset.activeProcessors) - 1)
              this.#processor = false
            }
            super.terminate()
          }
        }
      })
      await page.goto(server.resolvedUrls.local[0])
      await page.evaluate(() => localStorage.setItem("mainz:onboarding", "18"))
      await page.reload()
      const result = await checkWorkspace(page, fixture(), fixture(false))
      assert.equal(result.failed, 0)
      console.log(`${result.checks} browser checks passed.`)
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Mixed visibility.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, true),
        })
      await page.getByRole("button", { name: "Skip", exact: true }).click()
      assert.equal(await page.getByRole("dialog", { name: "Product tour", exact: true }).isVisible(), false)
      await page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7")
      await page.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.getByRole("tab", { name: "Style", exact: true }).click()
      const visibility = page.getByRole("article", { name: "Show Guides", exact: true })
      const show = visibility.getByRole("radio", { name: "Show", exact: true })
      const hide = visibility.getByRole("radio", { name: "Hide", exact: true })
      const reset = visibility.getByRole("button", { name: "Reset Show Guides", exact: true })
      assert.equal(await show.isChecked(), false)
      assert.equal(await hide.isChecked(), false)
      assert.match(await visibility.innerText(), /No single value/)
      assert.equal(await reset.isDisabled(), true)
      await hide.check()
      assert.equal(await hide.isChecked(), true)
      assert.equal(await show.isChecked(), false)
      await hide.press("ArrowLeft")
      assert.equal(await show.isChecked(), true)
      assert.equal(await hide.isChecked(), false)
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
      assert.equal(await page.locator(".error-banner").count(), 0)
      await reset.click()
      assert.equal(await show.isChecked(), false)
      assert.equal(await hide.isChecked(), false)
      assert.match(await visibility.innerText(), /No single value/)
      assert.equal(await reset.isDisabled(), true)
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
      assert.equal(await page.locator(".error-banner").count(), 0)
      console.log("Mixed visibility, Show/Hide, keyboard selection, and reset checks passed.")
      const blankOutput = page.locator(".composition-output")
      await blankOutput.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await page.locator(".selection-panel").getByRole("tab", { name: "Grid", exact: true }).click()
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await blankOutput.locator(".output-options > summary").click()
      await blankOutput.getByRole("button", { name: "Add blank page at end", exact: true }).click()
      await blankOutput.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await blankOutput.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
      await page.locator(".input-picker > summary").click()
      await page.locator(".input-picker").getByRole("button", { name: "Remove Input", exact: true }).click()
      await page.locator(".selection-panel").waitFor({ state: "hidden" })
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.getByRole("button", { name: "Start Tour", exact: true }).click()
      const blankTour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await blankTour.waitFor()
      for (const key of ["output-grid", "output-page", "download"]) {
        await page.waitForFunction(
          (value) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === value,
          key,
        )
        assert.equal(await page.locator(`[data-tour-target="${key}"]`).isVisible(), true)
        if (key !== "download") await blankTour.getByRole("button", { name: "Next", exact: true }).click()
      }
      assert.match(await blankTour.locator(".tour-progress").textContent(), /\/ 3/)
      await blankTour.getByRole("button", { name: "Finish", exact: true }).click()
      assert.equal(await blankOutput.locator(".composition-totals strong").textContent(), "1 PDF page")
      assert.equal(
        await blankOutput.locator(".composition-totals").getByText("1 duplex sheet", { exact: true }).isVisible(),
        true,
      )
      console.log("Blank-only Output has a tour without Input or Style steps.")
      page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      })
      await page.goto(server.resolvedUrls.local[0])
      const openHintInput = async () => {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "First action.pdf",
            mimeType: "application/pdf",
            buffer: fixture(false),
          })
        await page.locator(".input-current").waitFor()
      }
      await openHintInput()
      const instruction = "Select pages · Use + to add to Output."
      const status = page.locator(".footnote [role=status] span")
      const notice = page.getByRole("banner").getByRole("status")
      const instructionText = notice.locator("p")
      const flight = page.locator(".page-flight:popover-open")
      const hintWelcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      const hintTour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await hintWelcome.waitFor()
      const statusStyle = await status.evaluate((element) => ({
        font: getComputedStyle(element).fontSize,
        color: getComputedStyle(element).color,
        weight: getComputedStyle(element).fontWeight,
        background: getComputedStyle(element).backgroundColor,
      }))
      assert.equal(await notice.count(), 0)
      await hintWelcome.getByRole("button", { name: "Take a tour", exact: true }).click()
      await hintTour.waitFor()
      assert.equal(await notice.count(), 0)
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click()
      await flight.waitFor()
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector(".page-flight"), "::backdrop").opacity) > 0.9,
      )
      assert.equal(await flight.evaluate((element) => getComputedStyle(element).opacity), "0")
      assert.equal(await instructionText.textContent(), instruction)
      assert.equal(
        await page.getByRole("button", { name: "Select Input page 1", exact: true }).getAttribute("aria-pressed"),
        "true",
      )
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages")
      const origin = await page.locator('[data-tour-target="first-page"] .thumbnail canvas').boundingBox()
      const spotlight = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop")
        return [style.translate, style.insetInlineStart, style.insetBlockStart]
      })
      await page.waitForFunction(
        (left) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > left,
        origin.x + 8,
      )
      const fading = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop")
        return {
          position: [style.translate, style.insetInlineStart, style.insetBlockStart],
          opacity: Number(style.opacity),
        }
      })
      assert.deepEqual(fading.position, spotlight, "The spotlight stays over Input while the copy moves")
      assert.ok(
        fading.opacity > 0.25 && fading.opacity < 0.9,
        "The copy starts moving while the fading light is visible",
      )
      await page.waitForFunction(
        (right) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > right,
        origin.x + origin.width,
      )
      assert.equal(
        await instructionText.evaluate((element) => getComputedStyle(element).opacity),
        "1",
        "Notice text keeps its full contrast during display",
      )
      await flight.waitFor({ state: "hidden" })
      assert.equal(await instructionText.textContent(), instruction)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages")
      assert.ok(
        Number(await instructionText.evaluate((element) => getComputedStyle(element).fontWeight)) >
          Number(statusStyle.weight),
      )
      assert.ok(
        parseFloat(await instructionText.evaluate((element) => getComputedStyle(element).fontSize)) >
          parseFloat(statusStyle.font),
      )
      assert.equal(await notice.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)")
      const headerBounds = await page.getByRole("banner").boundingBox()
      const noticeBounds = await notice.boundingBox()
      assert.ok(
        Math.abs(noticeBounds.x + noticeBounds.width / 2 - headerBounds.x - headerBounds.width / 2) < 1,
        "The compact Notice is centered in the header",
      )
      assert.match(await status.textContent(), /Opened 1 page/)
      await page.waitForFunction(() => {
        const element = document.querySelector(".notice")
        return element && Number(getComputedStyle(element).opacity) < 0.9
      })
      await notice.waitFor({ state: "detached", timeout: 15000 })
      assert.match(await status.textContent(), /Opened 1 page/)
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.getByRole("button", { name: "Start Tour", exact: true }).click()
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click()
      assert.equal(await flight.isVisible(), false)
      await page.reload()
      await openHintInput()
      await flight.waitFor()
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await flight.waitFor({ state: "hidden" })
      assert.match(await status.textContent(), /Added 1 page to Output/)
      await notice.waitFor({ state: "detached" })
      assert.equal(await notice.count(), 0)
      assert.deepEqual(
        await status.evaluate((element) => ({
          font: getComputedStyle(element).fontSize,
          color: getComputedStyle(element).color,
          weight: getComputedStyle(element).fontWeight,
          background: getComputedStyle(element).backgroundColor,
        })),
        statusStyle,
      )
      await page.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await flight.isVisible(), false)
      assert.equal(await page.locator(".composition-empty").isVisible(), true)
      await page.reload()
      await openHintInput()
      await flight.waitFor()
      await page.emulateMedia({ reducedMotion: "reduce" })
      await flight.waitFor({ state: "hidden" })
      assert.equal(await instructionText.textContent(), instruction)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages")
      await page.reload()
      await openHintInput()
      await notice.filter({ hasText: instruction }).waitFor()
      assert.equal(await flight.isVisible(), false)
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      assert.match(await status.textContent(), /Added 1 page to Output/)
      await page.setViewportSize({ width: 390, height: 900 })
      await page.emulateMedia({ reducedMotion: "no-preference" })
      await page.reload()
      await openHintInput()
      await flight.waitFor()
      const bounds = await notice.boundingBox()
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391)
      assert(bounds.y >= 0 && bounds.y + bounds.height <= 901)
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await flight.waitFor({ state: "hidden" })
      assert.match(await status.textContent(), /Added 1 page to Output/)
      await page.setViewportSize({ width: 390, height: 650 })
      await page.reload()
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await openHintInput()
      assert.equal(await notice.count(), 0)
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).scrollIntoViewIfNeeded()
      await notice.filter({ hasText: instruction }).waitFor()
      const enlarged = await notice.boundingBox()
      assert(enlarged && enlarged.x >= 0 && enlarged.x + enlarged.width <= 391)
      assert(enlarged.y >= 0 && enlarged.y + enlarged.height <= 651)
      await page.getByRole("button", { name: "Dismiss notification", exact: true }).focus()
      await page.keyboard.press("Enter")
      await notice.waitFor({ state: "detached" })
      assert.equal(await notice.count(), 0)
      assert.match(await status.textContent(), /Opened 1 page/)
      console.log(
        "The first-page animation waits for onboarding/tour and visibility, leaves Output and Selection unchanged, uses an expiring header Notice, stops on addition, and respects reduced motion and enlarged mobile text.",
      )
    } catch (error) {
      if (page) context.diagnostic((await page.locator("[role=alert], .footnote").allTextContents()).join("\n"))
      throw error
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)
