// Checks Input chooser metadata, Contents outline navigation, and compact workspace menus.

import { setup, selectPane, outputCount, tab, fixture, inputChooser, paneButton } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"

test("Input chooser file details stay within single-pane layouts", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        reducedMotion: "reduce",
      })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
      await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
      const trigger = page.getByRole("button", { name: "Details for Input 1", exact: true })
      for (const width of [390, 810])
        for (const colorScheme of ["light", "dark"]) {
          await page.setViewportSize({ width, height: 1080 })
          await page.emulateMedia({ colorScheme })
          await inputChooser(page).click()
          await trigger.tap()
          const panel = page.locator(".input-choice > .guidance:popover-open")
          const box = await panel.boundingBox()
          assert.ok(box.x >= 0 && box.x + box.width <= width + 1 && box.y + box.height <= 1080 + 1, JSON.stringify(box))
          await panel
            .locator("td")
            .first()
            .evaluate((element) => (element.textContent = "A long metadata value ".repeat(300)))
          const expanded = await panel.boundingBox()
          assert.ok(expanded.y + expanded.height <= 1080, JSON.stringify(expanded))
          assert.ok(
            await panel.evaluate((element) => element.scrollHeight > element.clientHeight),
            "Long details scroll inside the panel",
          )
          await panel.getByRole("button", { name: "Close details", exact: true }).click()
          await inputChooser(page).click()
        }
    } finally {
      await browser.close()
    }
  }
})

test("Lorem keeps Cover floating and shares its virtual edge group through Contents and Output", async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel")
      await tab(input, "List")
      const placeholder = input.locator(".list-section[data-synthetic] .list-current").filter({ hasText: "…" })
      await placeholder.waitFor()
      assert.equal(await placeholder.evaluate((el) => getComputedStyle(el).fontStyle), "normal")
      const slant = await placeholder.evaluate((el) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform)
        return { x: matrix.a, y: matrix.d, slant: matrix.c, tilt: matrix.b }
      })
      assert.ok(
        slant.slant < 0 && slant.x === 1 && slant.y === 1 && slant.tilt === 0,
        "Virtual headings slant without scaling or tilting their glyph baseline",
      )
      assert.equal(await placeholder.evaluate((el) => getComputedStyle(el).fontVariantCaps), "all-small-caps")
      const heights = await input.locator(".list-current").evaluateAll((labels) =>
        labels.map((label) => {
          const range = document.createRange()
          range.selectNodeContents(label)
          return range.getBoundingClientRect().height
        }),
      )
      assert.ok(
        heights.every((height) => Math.abs(height - heights[0]) < 1),
        "Virtual headings retain ordinary section text height",
      )
      assert.equal(await input.getByRole("button", { name: "Select Input page 1: Cover", exact: true }).count(), 1)
      await input.getByRole("button", { name: "Input contents", exact: true }).click()
      const contents = input.locator(".contents:popover-open")
      const destination = contents.locator(".destination").filter({ hasText: "…" })
      assert.equal(await destination.locator(".positions").textContent(), "2")
      assert.equal(await destination.locator(".synthetic").count(), 1)
      await destination.click()
      await input.getByLabel("Page selection", { exact: true }).fill("1-4")
      await input.getByLabel("Page selection", { exact: true }).press("Enter")
      const output = page.locator(".composition-output")
      await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }))
      await tab(output, "List")
      await output.locator(".list-section[data-synthetic] .list-current").filter({ hasText: "…" }).waitFor()
      await page.close()
    } finally {
      await browser.close()
    }
  }
})

test(
  "Contents jumps to the exact page in Grid, Page, and List without changing selection",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Jump.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 100,
              outline: [
                { title: "Start", page: 0 },
                { title: "End", page: 99 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await input.getByLabel("Page selection", { exact: true }).fill("2,4")
        for (const view of ["Grid", "Page", "List"]) {
          await tab(input, view)
          const toc = input.getByRole("button", { name: "Input contents", exact: true })
          await toc.click()
          assert.equal(await toc.getAttribute("aria-expanded"), "true")
          await page.waitForFunction(
            () =>
              getComputedStyle(document.querySelector('.source-tabs > button[aria-label="Input contents"]')).color ===
              getComputedStyle(document.querySelector('.source-tabs [aria-selected="true"]')).color,
          )
          assert.equal(
            await toc.evaluate((button) => getComputedStyle(button).color),
            await input
              .getByRole("tab", { name: view, exact: true })
              .evaluate((button) => getComputedStyle(button).color),
          )
          await page
            .locator(".contents:popover-open")
            .getByRole("button", { name: view === "Page" ? /^Start\s+1$/ : /^End\s+100$/ })
            .click()
          if (view === "Grid") await input.locator('.page-image[data-page="99"]').waitFor({ state: "visible" })
          else if (view === "Page")
            assert.match(await input.locator(".inspection-heading .page-position").innerText(), /^1\s*\//)
          else await input.locator(':is(.list-choice, .list-heading)[data-page="99"]').waitFor({ state: "visible" })
          const selector =
            view === "Page"
              ? ".selection-panel .page-view"
              : view === "Grid"
                ? '.selection-panel .composition-card:has(.page-image[data-page="99"])'
                : '.selection-panel :is(.list-row, .list-section):has(:is(.list-choice, .list-heading)[data-page="99"])'
          await page.waitForFunction(
            (selector) =>
              document
                .querySelector(selector)
                ?.getAnimations({ subtree: true })
                .some((animation) => animation.id === "jump"),
            selector,
          )
          if (view === "Grid")
            assert.notEqual(
              await page.locator(selector).evaluate((element) => getComputedStyle(element, "::after").clipPath),
              "none",
            )
          assert.equal(
            await input.getByRole("tab", { name: view, exact: true }).getAttribute("aria-selected"),
            "true",
            "Contents preserves the active view",
          )
          if (view !== "List") {
            const strength = await page.locator(selector).evaluate((element) => {
              const animation = element.getAnimations({ subtree: true }).find((animation) => animation.id === "jump")
              return (
                animation?.effect?.getTiming().duration === 3000 &&
                animation.effect.pseudoElement === "::after" &&
                animation.effect.getKeyframes().some((frame) => Number(frame.opacity) >= 0.4) &&
                getComputedStyle(element).opacity === "1"
              )
            })
            assert.ok(strength, "An overlay highlights the entire card without dimming it")
          }
          await page.locator(selector).evaluate((element) =>
            Promise.all(
              element
                .getAnimations({ subtree: true })
                .filter((animation) => animation.id === "jump")
                .map((animation) => animation.finished),
            ),
          )
          assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "2,4")
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test("Contents titles are a per-Input display preference with authored-name fallback", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      for (const complete of [true, false]) {
        const name = complete ? "Complete.pdf" : "Partial.pdf"
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name,
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 4,
              metadata: [
                { name: "Cover" },
                { name: "Authored name" },
                complete ? { name: "Third page" } : {},
                complete ? { name: "Last page" } : {},
              ],
              outline: [
                { title: "Chapter", page: 1 },
                { title: "Section", page: 1, parent: 0 },
              ],
            }),
          })
        await input.locator(".input-current").filter({ hasText: name }).waitFor({ state: "attached" })
        await page.locator('.composer[aria-busy="false"]').waitFor()
        await tab(input, "List")
        await input.getByLabel("Page selection", { exact: true }).fill("1-4")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await tab(output, "List")
        assert.equal(
          await input.locator(':is(.list-choice, .list-heading)[data-page="2"]').innerText(),
          complete ? "Third page" : "Section",
        )
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        const preference = page.getByRole("checkbox", { name: "Use TOC titles", exact: true })
        assert.equal(await preference.isChecked(), false)
        await preference.check()
        await page.keyboard.press("Escape")
        assert.equal(await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').innerText(), "Cover")
        assert.equal(await input.locator(':is(.list-choice, .list-heading)[data-page="1"]').innerText(), "Chapter")
        assert.equal(await input.locator(':is(.list-choice, .list-heading)[data-page="2"]').innerText(), "Section")
        assert.equal(await output.locator(`.list-choice[data-page="${complete ? 2 : 6}"]`).innerText(), "Section")
        await input.getByRole("button", { name: "Details for Input page 2", exact: true }).click()
        assert.equal(await input.locator("[popover]:popover-open .detail-name").innerText(), "Section")
        await page.keyboard.press("Escape")
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        await preference.uncheck()
        await page.keyboard.press("Escape")
        assert.equal(
          await input.locator(':is(.list-choice, .list-heading)[data-page="2"]').innerText(),
          complete ? "Third page" : "Section",
        )
        assert.equal(
          await input.locator(':is(.list-choice, .list-heading)[data-page="2"]').innerText(),
          complete ? "Third page" : "Section",
        )
        await input.getByRole("button", { name: "Details for Input page 2", exact: true }).click()
        assert.equal(await input.locator("[popover]:popover-open .detail-name").innerText(), "Authored name")
        await page.keyboard.press("Escape")
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Contents unfolds virtual ranges into named page destinations without changing selection",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        for (const [width, colorScheme, text] of [
          [390, "light", 100],
          [390, "dark", 200],
          [1440, "light", 200],
          [1440, "dark", 100],
        ]) {
          const page = await browser.newPage({
            viewport: { width, height: 1100 },
            colorScheme,
            hasTouch: width === 390,
            reducedMotion: "reduce",
          })
          page.setDefaultTimeout(10000)
          await setup(page)
          await page.goto(server.resolvedUrls.local[0])
          await page.evaluate((text) => (document.documentElement.style.fontSize = `${text}%`), text)
          await page
            .locator("input[type=file]")
            .first()
            .setInputFiles({
              name: "Virtual pages.pdf",
              mimeType: "application/pdf",
              buffer: fixture({
                count: 7,
                metadata: [{ name: "Cover" }, { name: "Editorial" }, {}, {}, {}, {}, { name: "Back" }],
                outline: [
                  { title: "Chapter", page: 3 },
                  { title: "Detail", page: 4, parent: 0 },
                ],
              }),
            })
          await page.locator(".composer[aria-busy=false]").waitFor()
          const input = page.locator(".selection-panel"),
            contents = input.locator(".contents:popover-open")
          await tab(input, "List")
          await input.getByLabel("Page selection", { exact: true }).fill("5")
          const open = () => input.getByRole("button", { name: "Input contents", exact: true }).click()
          await open()
          const roots = contents.locator("nav > ul > li > .branch > .destination")
          assert.deepEqual(await roots.locator("span:first-child").allTextContents(), ["Cover", "…", "Chapter", "Back"])
          const group = contents.locator("li:has(> .branch > .destination > .synthetic)")
          const leaves = group.locator(":scope > ul > li > .branch > .destination")
          const unfold = group.getByRole("button", { name: "Unfold …", exact: true })
          assert.equal(await unfold.getAttribute("aria-expanded"), "false")
          assert.equal(await leaves.count(), 0)
          await unfold.press("Enter")
          assert.deepEqual(await leaves.locator("span:first-child").allTextContents(), ["Editorial", "…"])
          assert.deepEqual(await leaves.locator(".positions").allTextContents(), ["2", "3"])
          await contents.getByLabel("Use TOC titles", { exact: true }).check()
          assert.deepEqual(await leaves.locator("span:first-child").allTextContents(), ["…", "…"])
          await contents.getByLabel("Use TOC titles", { exact: true }).uncheck()
          await leaves.last().press("Enter")
          await contents.waitFor({ state: "hidden" })
          assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "5")
          assert.equal(await outputCount(page).textContent(), "0 pages")
          await open()
          assert.equal(await contents.locator('[aria-current="location"] .positions').innerText(), "2")
          await group.getByRole("button", { name: "Unfold …", exact: true }).click()
          assert.equal(await contents.locator('[aria-current="location"] .positions').innerText(), "3")
          assert.equal(await contents.locator('[aria-current="location"]').count(), 1)
          await contents.getByRole("button", { name: "Unfold all", exact: true }).click()
          assert.equal(await leaves.count(), 2)
          await contents.getByRole("button", { name: "Fold all", exact: true }).click()
          assert.equal(await leaves.count(), 0)
          await roots.last().click()
          await open()
          assert.equal(await contents.locator('[aria-current="location"] > span:first-child').innerText(), "Back")
          assert.equal(await contents.locator('[aria-current="location"] .positions').innerText(), "7")
          assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "5")
          await page.keyboard.press("Escape")
          await page
            .locator('.composer input[type=file][aria-label="Open PDF"]')
            .first()
            .setInputFiles({
              name: "Bookmarked edges.pdf",
              mimeType: "application/pdf",
              buffer: fixture({
                count: 7,
                metadata: [{ name: "Cover" }, {}, {}, {}, {}, {}, { name: "Back" }],
                outline: [
                  { title: "Authored front", page: 0 },
                  { title: "Authored back", page: 6 },
                ],
              }),
            })
          await page.locator(".status-input").filter({ hasText: "Bookmarked edges.pdf" }).waitFor({ state: "attached" })
          await page.locator(".composer[aria-busy=false]").waitFor()
          await open()
          assert.deepEqual(await roots.locator("span:first-child").allTextContents(), [
            "Authored front",
            "Authored back",
          ])
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Contents reveals the current leaf or its collapsed ancestor without selecting pages",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "Chapters.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 100,
              outline: [
                { title: "Book", page: 0 },
                ...Array.from({ length: 100 }, (_, page) => ({ title: `Chapter ${page + 1}`, page, parent: 0 })),
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await tab(input, "List")
        await input.getByRole("button", { name: "Fold all Input sections", exact: true }).waitFor()
        await input.locator(':is(.list-choice, .list-heading)[data-page="0"]').focus()
        await page.keyboard.press("End")
        const contents = page.locator(".contents:popover-open")
        const open = () => input.getByRole("button", { name: "Input contents", exact: true }).click()
        await open()
        const current = contents.locator('[aria-current="location"]')
        assert.equal(await current.count(), 1)
        assert.match(await current.innerText(), /^Book/)
        await contents.getByRole("button", { name: "Unfold Book", exact: true }).click()
        assert.match(await current.innerText(), /Chapter 100/)
        await page.waitForFunction(() => {
          const entry = document.querySelector('.contents:popover-open [aria-current="location"]')
          if (!entry) return false
          const box = entry.getBoundingClientRect(),
            nav = entry.closest("nav").getBoundingClientRect()
          return box.top >= nav.top - 1 && box.bottom <= nav.bottom + 1
        })
        await contents.getByRole("button", { name: "Fold Book", exact: true }).click()
        await page.keyboard.press("Escape")
        await open()
        assert.match(await current.innerText(), /^Book/)
        await page.keyboard.press("Escape")
        assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "")
        await tab(input, "Page")
        assert.match(await input.locator(".inspection-heading .page-position").innerText(), /100/)
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Compact workspace opens each active pane's document menu and gives both panes equal space while retaining desktop controls",
  { timeout: 90000 },
  async () => {
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
        await page.addInitScript(() => {
          window.open = (url) => {
            window.inputPDFURL = url
            return { opener: null }
          }
        })
        await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
        await page.locator(".composer[data-compact]").waitFor()
        const inputButton = paneButton(page, "Input")
        const outputButton = paneButton(page, "Output")
        const panel = page.locator(".document-menu")
        for (const width of [320, 375, 390, 430, 768, 810]) {
          await page.setViewportSize({ width, height: width === 810 ? 1080 : 900 })
          for (const scale of [100, 200]) {
            await page.emulateMedia({ colorScheme: scale === 100 ? "light" : "dark" })
            await page.evaluate(
              ({ textSize, fontFamily }) => {
                const style = document.documentElement.style
                style.fontSize = textSize
                style.fontFamily = fontFamily
              },
              { textSize: `${scale}%`, fontFamily: width === 320 && scale === 200 ? '"DejaVu Sans", sans-serif' : "" },
            )
            let primary
            for (const [button, peer] of [
              [inputButton, outputButton],
              [outputButton, inputButton],
            ]) {
              const label = `${engine.name()}, ${width}, ${scale}% ${await button.getAttribute("aria-label")}`
              if ((await button.getAttribute("aria-pressed")) === "false") await button.tap()
              assert.equal(await panel.isVisible(), false, label)
              const active = await button.boundingBox()
              const inactive = await peer.boundingBox()
              assert.deepEqual(
                { width: active.width, height: active.height },
                { width: inactive.width, height: inactive.height },
                label,
              )
              assert.ok(active.width >= 44 && active.height >= 44, label)
              const action = await page.locator(".workspace-bar > :is(.file-picker, .output-actions)").boundingBox()
              assert.ok(action.width >= 44 && action.height >= 44, label)
              if (primary) assert.deepEqual(action, primary, label)
              primary = action
              const icon = button.locator("svg")
              assert.equal(await peer.locator("svg").count(), 0, label)
              const glyph = await icon.evaluate((svg) => {
                const path = svg.querySelector("path")
                const box = path.getBBox()
                const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
                  path.getScreenCTM(),
                )
                const text = document.createRange()
                text.selectNodeContents(svg.previousElementSibling)
                const title = text.getBoundingClientRect()
                const halfWidth = (box.height * svg.getBoundingClientRect().width) / 48
                return {
                  aligned: Math.abs(center.y - title.y - title.height / 2) < 1,
                  gap: center.x - halfWidth - title.right,
                  right: center.x + halfWidth + 1,
                  width: svg.getBoundingClientRect().width,
                }
              })
              assert.ok(
                glyph.aligned && glyph.gap >= 6 && glyph.right <= active.x + active.width,
                JSON.stringify({ label, glyph }),
              )
              if (width <= 375) assert.ok(glyph.width < 16, label)
              if (width >= 768) assert.ok(glyph.width >= 18, label)
              await button.tap()
              const menu = await panel.boundingBox()
              assert.ok(menu.y > active.y + active.height && menu.x >= 0 && menu.x + menu.width <= width, label)
              const divider = await panel.getByRole("separator").boundingBox()
              const view = await panel.getByRole("button", { name: "View PDF", exact: true }).boundingBox()
              assert.ok(divider.height === 1 && divider.width === view.width && divider.y < view.y, label)
              const rows = await panel
                .locator(":scope > *")
                .evaluateAll((children) => children.map((child) => child.getBoundingClientRect().toJSON()))
              if (width === 810 && scale === 100)
                assert.ok(
                  rows.every((row) => row.height <= 70),
                  JSON.stringify({ label, rows }),
                )
              assert.ok(Math.abs(menu.y + menu.height - rows.at(-1).bottom) <= 10, label)
              await page.keyboard.press("Escape")
              await panel.waitFor({ state: "hidden" })
              if (width === 810 && scale === 100) {
                const name = await button.getAttribute("aria-label")
                const go = page.getByRole("button", { name: `Go to page in ${name}`, exact: true })
                await page.evaluate(() => {
                  document.addEventListener(
                    "click",
                    () => {
                      const field = document.activeElement
                      window.pageNumberReady =
                        field instanceof HTMLInputElement &&
                        field.inputMode === "numeric" &&
                        /^\d+$/.test(field.value) &&
                        field.selectionStart === 0 &&
                        field.selectionEnd === field.value.length
                    },
                    { once: true },
                  )
                })
                await go.tap()
                assert.equal(await page.evaluate(() => window.pageNumberReady), true, label)
                await page.keyboard.press("Escape")
              }
            }
          }
        }
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.waitForFunction(() => !document.querySelector(".composer").hasAttribute("data-compact"))
        assert.ok(await page.locator(".input-heading > .file-picker").isVisible())
        assert.ok(await page.locator(".input-heading .view-action").isVisible())
        assert.ok(await page.locator(".composition-output .print-action").isVisible())
        assert.ok(await page.locator(".composition-output .view-action").isVisible())
        assert.ok(await page.locator(".input-current").isVisible())
        await page.setViewportSize({ width: 375, height: 667 })
        await page.locator(".composer[data-compact]").waitFor()
        await inputButton.tap()
        await inputButton.focus()
        await page.keyboard.press("Enter")
        await page.locator(".input-list").getByRole("button", { name: "View PDF", exact: true }).click()
        assert.equal(
          await page.evaluate(async () =>
            new TextDecoder().decode((await (await fetch(window.inputPDFURL)).arrayBuffer()).slice(0, 4)),
          ),
          "%PDF",
        )
        const chooser = page.waitForEvent("filechooser")
        await page.locator(".workspace-bar > .file-picker").click()
        await (
          await chooser
        ).setFiles({ name: "additional.pdf", mimeType: "application/pdf", buffer: fixture({ count: 2 }) })
        await page.waitForFunction(
          () => document.querySelector(".workspace-counts .page-count")?.textContent === "2 pages",
        )
        await inputButton.tap()
        await panel.waitFor()
        await outputButton.tap()
        assert.equal(await panel.isVisible(), false)
        const output = page.locator(".composition-output")
        await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("1")
        const menu = outputButton
        await menu.focus()
        await page.keyboard.press("Enter")
        await page.keyboard.press("Delete")
        await page.keyboard.press("Escape")
        assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1")
        assert.equal(await menu.evaluate((element) => document.activeElement === element), true)
        assert.equal(await panel.isVisible(), false)
        await page.keyboard.press("Enter")
        await page.getByRole("button", { name: "Set Output filename", exact: true }).click()
        await page.getByRole("textbox", { name: "Filename", exact: true }).focus()
        await page.keyboard.press("Escape")
        assert.equal(await menu.evaluate((element) => document.activeElement === element), true)
        await page.setViewportSize({ width: 430, height: 260 })
        await menu.press("Enter")
        await panel.waitFor()
        const bounds = await panel.evaluate((element) => ({
          bottom: element.getBoundingClientRect().bottom,
          viewport: innerHeight,
          scrolls: element.scrollHeight > element.clientHeight,
        }))
        assert.ok(bounds.bottom <= bounds.viewport && bounds.scrolls, JSON.stringify(bounds))
        await panel.getByRole("button", { name: "Export recipe", exact: true }).scrollIntoViewIfNeeded()
        await page.keyboard.press("Escape")
        assert.equal(await menu.evaluate((element) => document.activeElement === element), true)
        await page.keyboard.press("Enter")
        await page.getByRole("button", { name: "Export recipe", exact: true }).click()
        await page
          .getByRole("dialog", { name: "Export recipe", exact: true })
          .getByRole("button", { name: "Cancel", exact: true })
          .focus()
        await page.keyboard.press("Escape")
        assert.equal(await menu.evaluate((element) => document.activeElement === element), true)
      } finally {
        await browser.close()
      }
    }
  },
)

test("Input chooser number badges expose details and aligned file actions", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 900 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".composer[data-compact]").waitFor()
    for (const width of [390, 800, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme })
        await inputChooser(page).click()
        const measures = await page.locator(".input-list").evaluate((list) => {
          const badge = list.querySelector(".input-choice .guidance-label")
          const name = list.querySelector(".input-choice-select")
          const view = list.querySelector(".file-actions button")
          const remove = list.querySelector(".input-list-actions > .danger")
          const a = view?.getBoundingClientRect(),
            b = remove.getBoundingClientRect()
          return {
            badgeColor: getComputedStyle(badge).color,
            nameColor: getComputedStyle(name).color,
            nameGap: name.getBoundingClientRect().left - badge.getBoundingClientRect().right,
            badgeSelected: name.getAttribute("aria-pressed") === "true",
            aligned:
              !!a && Math.abs(a.x - b.x) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1,
          }
        })
        assert.equal(measures.badgeSelected, true)
        assert.equal(measures.nameColor, scheme === "light" ? "rgb(0, 0, 0)" : "rgb(255, 255, 255)")
        assert.equal(measures.badgeColor, scheme === "light" ? "rgb(255, 255, 255)" : "rgb(0, 0, 0)")
        assert.ok(measures.nameGap >= 10)
        if (width !== 1440) assert.ok(measures.aligned, `${width}: View and Remove share row dimensions`)
        await page.getByRole("button", { name: "Details for Input 1" }).click()
        await page.locator(".guidance:popover-open").getByRole("button", { name: "Close details" }).click()
        await inputChooser(page).click()
      }
    }
  } finally {
    await browser.close()
  }
})

test(
  "Multi-Input chooser badges Provenance and outside Tour clicks restore opener focus",
  { timeout: 45000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel")
      await page.locator(".input-picker > summary h2").click()
      assert.equal(await input.locator(".input-list .input-choice-select [data-provenance]").count(), 0)
      await page.keyboard.press("Escape")

      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc-multiple`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      await page.locator(".input-picker .count", { hasText: "2" }).waitFor()
      for (const scheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme: scheme })
        await page.locator(".input-picker > summary h2").click()
        await input.locator(".input-list").waitFor()
        assert.ok((await input.locator(".input-list .input-choice-select [data-provenance]").count()) >= 2)
        const gaps = await input.locator(".input-list .input-choice-select").evaluateAll((buttons) =>
          buttons.map((button) => {
            const dot = button.querySelector("[data-provenance] i").getBoundingClientRect()
            const name = button.querySelector(":scope > span:first-child > span:last-child").getBoundingClientRect()
            return name.left - dot.right
          }),
        )
        assert.ok(
          gaps.every((gap) => gap >= 4),
          `${scheme}: expected dot gap >= 4px, got ${JSON.stringify(gaps)}`,
        )
        const secondChoice = input.locator(".input-list .input-choice").nth(1)
        const rest = await secondChoice.evaluate((row) => ({
          border: getComputedStyle(row).borderTopColor,
          background: getComputedStyle(row).backgroundColor,
        }))
        await secondChoice.locator("> .input-choice-select").hover()
        const hovered = await secondChoice.evaluate((row) => {
          const select = row.querySelector(":scope > .input-choice-select")
          return {
            selectShadow: getComputedStyle(select).boxShadow,
            border: getComputedStyle(row).borderTopColor,
            background: getComputedStyle(row).backgroundColor,
            shadow: getComputedStyle(row).boxShadow,
          }
        })
        assert.equal(hovered.selectShadow, "none")
        assert.notEqual(hovered.border, rest.border)
        assert.notEqual(hovered.background, rest.background)
        assert.notEqual(hovered.shadow, "none")
        await page.keyboard.press("Escape")
      }
      const glowAlpha = async (scheme) => {
        await page.emulateMedia({ colorScheme: scheme })
        const iconButton = input.getByRole("button", { name: "View Input PDF", exact: true })
        await iconButton.hover()
        const filter = await iconButton.locator("svg").evaluate((svg) => getComputedStyle(svg).filter)
        const matches = [...filter.matchAll(/(?:rgba\([^)]*,\s*([\d.]+)|\/\s*([\d.]+))\)/g)]
          .map((match) => Number(match[1] ?? match[2]))
          .filter(Number.isFinite)
        assert.ok(matches.length >= 1, `${scheme}: expected drop-shadow alpha in ${filter}`)
        return Math.max(...matches)
      }
      const lightAlpha = await glowAlpha("light")
      const darkAlpha = await glowAlpha("dark")
      assert.ok(lightAlpha < darkAlpha, `Expected softer light glow (${lightAlpha}) than dark (${darkAlpha})`)

      const help = page.getByRole("button", { name: "Help", exact: true })
      await help.click()
      const helpDialog = page.getByRole("dialog", { name: "Help", exact: true })
      await helpDialog.getByRole("button", { name: "Start Tour", exact: true }).click()
      const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await tour.waitFor()
      await page.locator(".header-note").click()
      await tour.waitFor({ state: "hidden" })
      assert.equal(await help.evaluate((element) => element === document.activeElement), true)
    } finally {
      await browser.close()
    }
  },
)
