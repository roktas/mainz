// Checks full-page List inspection, whole-row focus, edit feedback, and native/touch transfers.

import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, writeFile } from "node:fs/promises"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { outputCount, tab, fixture, gridPage } from "./browser.js"

test(
  "Folded sections select descendants and unfolded headings toggle only their pages",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      for (const view of ["Grid", "List"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(8000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Group-selection.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 6,
              outline: [
                { title: "First", page: 0 },
                { title: "Second", page: 3 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        const output = page.locator(".composition-output")
        await tab(input, view)
        for (const pane of ["Input", "Output"]) {
          const panel = pane === "Input" ? input : output
          if (pane === "Output") {
            await input.getByLabel("Page selection", { exact: true }).fill("1-6")
            await input.getByRole("button", { name: "Add to Output", exact: true }).click()
            await output.getByLabel("Page selection", { exact: true }).fill("")
            await tab(output, view)
          }
          const heading =
            view === "Grid"
              ? panel.locator('.composition-card:has(.page-image[data-page="0"]) .page-image')
              : panel.locator('.list-heading[data-page="0"]')
          const selected = panel.getByLabel("Page selection", { exact: true })
          const fold = panel.getByRole("button", { name: `Fold ${pane} section: First` })
          const unfold = panel.getByRole("button", { name: `Unfold ${pane} section: First` })
          if (await fold.isVisible()) await fold.click()
          await unfold.waitFor()
          assert.equal(await heading.getAttribute("aria-pressed"), "false")
          for (const modifier of ["Control", "Meta", "Alt", "Shift"]) {
            for (const key of ["Enter", "Space"]) {
              await heading.press(`${modifier}+${key}`)
              assert.equal(await heading.count(), 1, `${modifier}+${key} preserves the page view`)
              assert.equal(await selected.inputValue(), "", `${modifier}+${key} preserves section selection`)
            }
          }
          await heading.click()
          assert.equal(await selected.inputValue(), "1-3")
          await unfold.click()
          assert.equal(await heading.getAttribute("aria-pressed"), "true")
          for (const index of [1, 2]) {
            const child =
              view === "Grid"
                ? panel.locator(`.page-image[data-page="${index}"]`)
                : panel.locator(`:is(.list-choice, .list-heading)[data-page="${index}"]`)
            assert.equal(await child.getAttribute("aria-pressed"), "true")
          }
          await heading.click()
          assert.equal(await selected.inputValue(), "2-3")
          await fold.click()
          assert.equal(await heading.getAttribute("aria-pressed"), "true")
          await heading.click()
          assert.equal(await selected.inputValue(), "")
          await heading.press("Space")
          assert.equal(await selected.inputValue(), "1-3")
          await heading.press("Space")
          assert.equal(await selected.inputValue(), "")
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test("Grid and List share heading pages, details, and inline Output controls", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(8000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Sections.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          prepared: false,
          count: 6,
          outline: [
            { title: "Part One", page: 0 },
            { title: "Part Two", page: 3 },
          ],
        }),
      })
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    await tab(input, "List")
    assert.equal(await input.locator(".list-section").count(), 2)
    assert.deepEqual(
      await input.locator(".list-section .list-heading").evaluateAll((rows) => rows.map((row) => row.dataset.page)),
      ["0", "3"],
    )
    assert.equal(await input.locator(".list-row").count(), 4, "Headings replace, rather than duplicate, physical pages")
    await input.getByRole("button", { name: "Details for Input page 1", exact: true }).click()
    const details = page.locator(".card-menu-options:popover-open")
    assert.equal(await details.locator(".page-detail-navigation .section-path .path-step").count(), 1)
    await page.keyboard.press("Escape")
    await input.locator('.list-heading[data-page="0"]').click()
    assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1")
    await tab(input, "Grid")
    assert.equal(await input.locator(".composition-card").count(), 6)
    assert.equal(await input.getByRole("button", { name: "View Input page 1", exact: true }).count(), 1)
    await input.getByRole("button", { name: "View Input page 1", exact: true }).click()
    assert.equal(await input.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
    await tab(input, "Grid")
    await input.locator('.composition-card:has(.page-image[data-page="0"]) .page-origin > button').click()
    assert.equal(await input.locator(".page-origin-info:popover-open .section-path .path-step").count(), 1)
    await input.locator('.composition-card:has(.page-image[data-page="0"]) .page-origin > button').click()
    await input.getByLabel("Page selection", { exact: true }).fill("1-6")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await output.getByLabel("Page selection", { exact: true }).fill("")
    await tab(output, "List")
    assert.equal(await output.locator(".list-section").count(), 2)
    assert.equal(await output.locator(".list-row").count(), 4)
    const start = output.locator('.list-section[data-index="0"]')
    assert.equal(await start.locator(".occurrence-actions button").count(), 4)
    assert.deepEqual(
      await start
        .locator(".occurrence-actions button")
        .evaluateAll((items) => items.map((item) => item.getAttribute("aria-label"))),
      [
        "Move Output section pages 1–3 earlier",
        "Move Output section pages 1–3 later",
        "Remove Output section pages 1–3",
        "Duplicate Output section pages 1–3",
      ],
    )
    await output.getByRole("button", { name: "Details for Output page 1", exact: true }).click()
    assert.equal(await page.locator(".card-menu-options:popover-open .page-detail-navigation .section-path").count(), 1)
    await page.keyboard.press("Escape")
    await tab(output, "Grid")
    assert.equal(await output.getByRole("button", { name: "View Output page 1", exact: true }).count(), 1)
    await output.getByRole("button", { name: "View Output page 1", exact: true }).click()
    assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
  } finally {
    await browser.close()
  }
})

test(
  "Grid and List section edits preserve real ribbons, group boundaries, and selection-bar priority",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      for (const view of ["Grid", "List"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 940 }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Section-edits.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 6,
              outline: [
                { title: "First", page: 0 },
                { title: "Second", page: 3 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        const output = page.locator(".composition-output")
        await tab(input, view)
        const inputSection =
          view === "List"
            ? input.locator('.list-section:has(.list-heading[data-page="3"])')
            : input.locator('.composition-card:has(.page-image[data-page="3"])')
        await inputSection.hover()
        await inputSection.getByRole("button", { name: "Add Input section pages 4–6 to Output" }).click()
        assert.equal(await outputCount(page).textContent(), "3 pages")
        await input.getByLabel("Page selection", { exact: true }).fill("1-6")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await output.getByLabel("Page selection", { exact: true }).fill("")
        await tab(output, view)
        const before =
          view === "List"
            ? output.locator('.list-section:has(.list-heading[data-page="6"])')
            : output.locator('.composition-card:has(.page-image[data-page="6"])')
        await before.hover()
        await before.getByRole("button", { name: "Move Output section pages 7–9 earlier" }).click()
        assert.equal(await outputCount(page).textContent(), "9 pages")
        if (view === "List") {
          assert.equal(await output.locator('.list-section[data-index="8"]').count(), 0)
          assert.equal(await output.locator('.list-row[data-index="8"]').count(), 1)
        } else {
          assert.equal(
            await output.locator('.composition-card:has(.page-image[data-page="8"]) .grid-ribbon').count(),
            0,
          )
        }
        const selected = output.getByLabel("Page selection", { exact: true })
        await selected.fill("1")
        assert.equal(
          await output.locator(".occurrence-actions button").count(),
          0,
          "Selected pages use the selection bar",
        )
        await selected.fill("")
        await tab(output, view === "List" ? "Grid" : "List")
        await tab(output, view)
        const first =
          view === "List"
            ? output.locator('.list-section:has(.list-heading[data-page="0"])')
            : output.locator('.composition-card:has(.page-image[data-page="0"])')
        await first.hover()
        assert.equal(
          await first.getByRole("button", { name: "Move Output section pages 1–3 earlier" }).isDisabled(),
          true,
        )
        if (view === "List") {
          assert.equal(
            await first
              .getByRole("button", { name: "Move Output section pages 1–3 earlier" })
              .locator("path")
              .getAttribute("d"),
            "M12 19V5m-5 5 5-5 5 5",
          )
          assert.equal(
            await first
              .getByRole("button", { name: "Move Output section pages 1–3 later" })
              .locator("path")
              .getAttribute("d"),
            "M12 5v14m-5-5 5 5 5-5",
          )
        }
        await page.mouse.move(0, 0)
        const inlineActions =
          view === "List"
            ? first.locator(".list-actions > .occurrence-actions")
            : first.locator(".occurrence-actions .card-inline-actions button").first()
        assert.equal(
          await inlineActions.evaluate((item) => getComputedStyle(item).opacity),
          "0",
          "Editing actions hide when idle",
        )
        await first.hover()
        assert.equal(
          await inlineActions.evaluate((item) => getComputedStyle(item).opacity),
          "1",
          "Hover reveals editing actions",
        )
        assert.equal(await first.getByRole("button", { name: "Move Output section pages 1–3 later" }).count(), 1)
        await first.getByRole("button", { name: "Duplicate Output section pages 1–3" }).click()
        assert.equal(await outputCount(page).textContent(), "12 pages")
        await first.hover()
        await first.getByRole("button", { name: "Remove Output section pages 1–3" }).click()
        assert.equal(await outputCount(page).textContent(), "9 pages")
        const headingControl = view === "List" ? ".list-heading" : ".page-image"
        await first.locator(headingControl).focus()
        await page.keyboard.press("Enter")
        assert.equal(await outputCount(page).textContent(), "12 pages", "Heading keyboard action duplicates the group")
        await first.locator(headingControl).focus()
        await page.keyboard.press("-")
        assert.equal(await outputCount(page).textContent(), "9 pages", "Heading keyboard action removes the group")
        await inputSection.locator(headingControl).focus()
        await page.keyboard.press("Enter")
        assert.equal(await outputCount(page).textContent(), "12 pages", "Heading keyboard action adds the Input group")
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)

test("Touch Grid and List keep editing actions visible", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({
      viewport: { width: 390, height: 844 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Touch-groups.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 4, outline: [{ title: "Chapter", page: 0 }] }),
      })
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    await input.getByLabel("Page selection", { exact: true }).fill("1-4")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    const workspace = page.getByRole("navigation", { name: "Workspace view", exact: true })
    await workspace.getByRole("button", { name: "Output", exact: true }).click()
    await output.getByLabel("Page selection", { exact: true }).fill("")
    await workspace.getByRole("button", { name: "Input", exact: true }).click()
    for (const [pane, panel] of [
      ["Input", input],
      ["Output", output],
    ]) {
      if (pane === "Output") await workspace.getByRole("button", { name: "Output", exact: true }).click()
      await tab(panel, "List")
      const list = panel.locator(".list-section").first()
      const actions = list.locator(".list-actions > :not(.list-peek)").first()
      const eye = list.locator(".list-peek").first()
      assert.equal(await actions.evaluate((element) => getComputedStyle(element).opacity), "1")
      assert.equal(await eye.evaluate((element) => getComputedStyle(element).opacity), "1")
      await list.locator(".list-heading").focus()
      assert.equal(await actions.evaluate((element) => getComputedStyle(element).opacity), "1")
      await tab(panel, "Grid")
      const card = panel.locator(".composition-card").first()
      const edit =
        pane === "Input"
          ? card.locator(".input-footer button").first()
          : card.locator(".card-inline-actions button").last()
      const gridEye = card.locator(".grid-inspect")
      assert.equal(await edit.evaluate((element) => getComputedStyle(element).opacity), "1")
      assert.equal(await gridEye.evaluate((element) => getComputedStyle(element).opacity), "1")
      await card.locator(".page-image").focus()
      assert.equal(await edit.evaluate((element) => getComputedStyle(element).opacity), "1")
    }
  } finally {
    await browser.close()
  }
})

test("Section ribbons show four-dot press feedback and drag complete groups", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(8000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
  "Contents jumps to the exact page in Grid, Page, and List without changing selection",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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

test("List section paths put the current title first and open details independently of selection", async () => {
  const server = await serve()
  const path = [
    "Volume One: Document Composition",
    "Chapter One: Preparing Original Sources",
    "Section One: Page Ordering and Copies",
  ]
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Hierarchy.pdf",
          mimeType: "application/pdf",
          buffer: fixture({
            prepared: false,
            count: 8,
            outline: [
              { title: path[0], page: 0 },
              { title: path[1], page: 1, parent: 0 },
              { title: path[2], page: 2, parent: 1 },
              { title: "First example", page: 3, parent: 2 },
            ],
          }),
        })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await tab(input, "List")
      await input.getByRole("button", { name: "Select all", exact: true }).click()
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(output, "List")
      for (const [pane, name] of [
        [input, "Input"],
        [output, "Output"],
      ]) {
        const expand = pane.getByRole("button", { name: `Unfold all ${name} sections`, exact: true })
        if (await expand.isVisible()) await expand.click()
        const root = pane.locator('.list-section:has(.list-heading[data-page="0"])').first()
        await root.getByRole("button", { name: `Details for ${name} page 1`, exact: true }).click()
        assert.equal(await page.locator(".card-menu-options:popover-open .section-path .path-step").count(), 1)
        await page.keyboard.press("Escape")
        const selection = pane.getByLabel("Page selection", { exact: true })
        await selection.fill("1")
        const levels = await pane.locator(".list-section").evaluateAll((rows) =>
          rows.slice(0, 3).map((row) => ({
            surface: getComputedStyle(row).backgroundColor,
            edge: row.querySelector(".list-heading").getBoundingClientRect().left,
          })),
        )
        assert.equal(
          new Set(levels.map((level) => level.surface)).size,
          3,
          "Three nested levels have distinct surfaces",
        )
        assert.ok(
          levels.every((level) => Math.abs(level.edge - levels[0].edge) < 1),
          "Depth preserves shared columns",
        )
        const heading = pane.locator('.list-heading[data-page="2"]')
        const row = heading.locator("..")
        assert.equal(await row.locator(".list-current").textContent(), path[2])
        assert.deepEqual(await row.locator(".list-ancestor").allTextContents(), [path[1], path[0]])
        const details = row.getByRole("button", { name: `Details for ${name} page 3`, exact: true })
        await details.click()
        const panel = page.locator(".card-menu-options:popover-open .section-path")
        await panel.waitFor()
        assert.deepEqual(await panel.locator(".path-step > span:last-child").allTextContents(), path)
        assert.equal(await selection.inputValue(), "1", "Reading the path does not select pages")
        assert.equal(await outputCount(page).textContent(), "8 pages")
        await panel.getByRole("button", { name: `Go to section: ${path[0]}`, exact: true }).press("Enter")
        await panel.waitFor({ state: "hidden" })
        await page.waitForFunction(
          () =>
            document.activeElement?.classList.contains("list-heading") && document.activeElement?.dataset.page === "0",
        )
        assert.equal(await selection.inputValue(), "1", "Path navigation preserves selection")
        assert.equal(await outputCount(page).textContent(), "8 pages")
        await heading.click()
        assert.notEqual(await selection.inputValue(), "1", "Heading retains section selection")
        const selected = await selection.inputValue()
        await details.click()
        await page.keyboard.press("Escape")
        assert.equal(await selection.inputValue(), selected)
      }
      for (const [width, scheme, text] of [
        [1920, "light", "100%"],
        [1920, "dark", "100%"],
        [375, "light", "100%"],
        [375, "dark", "200%"],
      ]) {
        await page.setViewportSize({ width, height: width === 375 ? 667 : 1080 })
        await page.emulateMedia({ colorScheme: scheme })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        if (width === 375)
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }).click()
        const heading = input.locator('.list-heading[data-page="2"]')
        await heading.scrollIntoViewIfNeeded()
        const bounds = await heading.locator("..").evaluate((row) => {
          const current = row.querySelector(".list-current"),
            parents = row.querySelector(".list-parents"),
            details = row.querySelector(".list-peek button")
          return {
            fits:
              current.getBoundingClientRect().right <= parents.getBoundingClientRect().left &&
              parents.getBoundingClientRect().right <= details.getBoundingClientRect().left,
            caps: getComputedStyle(current).fontVariantCaps === getComputedStyle(parents).fontVariantCaps,
            size: getComputedStyle(current).fontSize === getComputedStyle(parents).fontSize,
          }
        })
        assert.ok(bounds.fits && bounds.caps && bounds.size, JSON.stringify(bounds))
        await heading.locator("..").getByRole("button", { name: "Details for Input page 3", exact: true }).click()
        const panel = page.locator(".card-menu-options:popover-open .section-path")
        const frame = await panel.boundingBox()
        assert.ok(frame.x >= 0 && frame.x + frame.width <= width + 1)
        await mkdir("../.local/tmp/web/layout/sections", { recursive: true })
        await panel.screenshot({
          path: `../.local/tmp/web/layout/sections/${engine.name()}-path-${width}-${scheme}.png`,
        })
        await page.keyboard.press("Escape")
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Section path navigation reveals offscreen ancestors in the current Output occurrence",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Repeated.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 65,
              outline: [
                { title: "First", page: 0 },
                { title: "Section", page: 1, parent: 0 },
                { title: "Topic", page: 50, parent: 1 },
                { title: "Other", page: 64 },
              ],
            }),
          })
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output")
        await tab(input, "List")
        await input.getByLabel("Page selection", { exact: true }).fill("1-65,1-65")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await tab(output, "List")
        await output.getByRole("button", { name: "Unfold all Output sections", exact: true }).click()
        await output.getByLabel("Page selection", { exact: true }).fill("130")
        await output.locator(".page-list").evaluate((list) => (list.scrollTop = list.scrollHeight))
        const topic = output.locator('.list-section[data-index="115"]')
        await topic.getByRole("button", { name: "Details for Output page 116", exact: true }).click()
        await page
          .locator(".card-menu-options:popover-open .section-path")
          .getByRole("button", { name: "Go to section: First › Section", exact: true })
          .click()
        await page.waitForFunction(
          () =>
            document.activeElement ===
            document.querySelector('.composition-output .list-section[data-index="66"] .list-heading'),
        )
        assert.equal(await page.locator(".card-menu-options:popover-open .section-path").count(), 0)
        assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "130")
        assert.equal(await outputCount(page).textContent(), "130 pages")
      } finally {
        await browser.close()
      }
    }
  },
)

test("Input List gives defined PDF page labels their own column before page names", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
        const markers = await output.locator(".list-row:has([data-provenance])").evaluateAll((rows) =>
          rows.map((row) => {
            const center = (selector) => {
              const box = row.querySelector(selector).getBoundingClientRect()
              return box.x + box.width / 2
            }
            return {
              actual: center("[data-provenance]"),
              expected: (center(".list-number") + center(".page-grip")) / 2,
            }
          }),
        )
        assert.ok(
          markers.every(({ actual, expected }) => Math.abs(actual - expected) < 1),
          "Source markers stay between the grip and number",
        )
      }
    } finally {
      await browser.close()
    }
  }
})

test("List section headings default to shown and toggle independently without changing pages", async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=toc`)
      await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      for (const pane of [input, output]) {
        const toggle = pane.getByRole("button", { name: "Section headings", exact: true })
        const selection = pane.getByLabel("Page selection", { exact: true })
        await selection.fill("1-2")
        assert.equal(await toggle.getAttribute("aria-pressed"), "true")
        assert.ok(await pane.locator(".list-section").count())
        const folds = await pane
          .locator(".list-disclosure")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-expanded")))
        const before = await toggle.boundingBox()
        await toggle.click()
        assert.equal(await toggle.getAttribute("aria-pressed"), "false")
        assert.equal(await pane.locator(".list-section").count(), 0)
        const after = await toggle.boundingBox()
        assert.ok(Math.abs(before.x - after.x) < 1 && Math.abs(before.y - after.y) < 1, "Section toggle stays in place")
        assert.ok(await pane.locator(':is(.list-choice, .list-heading)[data-page="0"]').isVisible())
        assert.ok(
          await pane.locator(':is(.list-choice, .list-heading)[data-page="2"]').isVisible(),
          "Collapsed pages become visible",
        )
        assert.equal(await selection.inputValue(), "1-2")
        assert.equal(await outputCount(page).textContent(), "9 pages")
        const other = pane === input ? output : input
        assert.equal(
          await other.getByRole("button", { name: "Section headings", exact: true }).getAttribute("aria-pressed"),
          "true",
        )
        await tab(pane, "Grid")
        await tab(pane, "List")
        assert.equal(await toggle.getAttribute("aria-pressed"), "false")
        await toggle.click()
        assert.deepEqual(
          await pane
            .locator(".list-disclosure")
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-expanded"))),
          folds,
        )
        assert.equal(await selection.inputValue(), "1-2")
      }
      for (const width of [375, 1440]) {
        await page.setViewportSize({ width, height: 1000 })
        if (width === 375)
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }).click()
        const controls = await input
          .locator(".source-tabs > .icon-button, .source-tabs > .page-destination > button")
          .evaluateAll((buttons) =>
            buttons.map((button) => {
              const box = button.getBoundingClientRect()
              return { x: box.x, right: box.right, width: box.width, height: box.height }
            }),
          )
        assert.equal(controls.length, 4)
        assert.ok(
          controls.every((box) => box.width >= 44 && box.height >= 44),
          "Keep full touch targets",
        )
        for (let index = 1; index < controls.length; index++) {
          const gap = controls[index].x - controls[index - 1].right
          assert.ok(width === 375 ? Math.abs(gap) < 1 : gap > 0, `${width}px: toolbar gap ${gap}`)
        }
        const edges = await input.locator(".source-tabs").evaluate((toolbar) => {
          const bounds = (selector) => {
            const svg = toolbar.querySelector(selector)
            const box = svg.getBBox()
            return [
              new DOMPoint(box.x, box.y).matrixTransform(svg.getScreenCTM()).x,
              new DOMPoint(box.x + box.width, box.y).matrixTransform(svg.getScreenCTM()).x,
            ]
          }
          const box = toolbar.getBoundingClientRect()
          const tab = toolbar.querySelector(".tabs > button:first-child").getBoundingClientRect()
          const icon = bounds(".tabs > button:first-child svg")
          return {
            start: icon[0] - box.left,
            end: box.right - bounds('[aria-label="Input contents"] svg')[1],
            tabTarget: tab.width >= 44,
          }
        })
        assert.ok(edges.tabTarget && Math.abs(edges.start) < 1 && Math.abs(edges.end) < 1, JSON.stringify(edges))
        assert.ok(
          await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
          "No horizontal overflow",
        )
      }
    } finally {
      await browser.close()
    }
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
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
          await page.locator(".drag-image[data-card]").waitFor()
          assert.equal(await page.locator(".drag-image .drag-count").innerText(), "×4")
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

test("List section summaries reveal every same-page section across hierarchy levels", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Shared-sections.pdf",
          mimeType: "application/pdf",
          buffer: fixture({
            prepared: false,
            count: 6,
            outline: [
              { title: "Introduction", page: 0 },
              { title: "Background", page: 0 },
              { title: "Model", page: 0 },
              { title: "Encoder", page: 1, parent: 2 },
              { title: "Attention", page: 1, parent: 2 },
              { title: "Scaled attention", page: 2, parent: 4 },
              { title: "Multi-head attention", page: 2, parent: 4 },
              { title: "Applications", page: 3, parent: 4 },
              { title: "Feed-forward networks", page: 3, parent: 2 },
              { title: "Embeddings", page: 3, parent: 2 },
              { title: "Encoding", page: 4, parent: 2 },
              { title: "Why attention", page: 4 },
              { title: "Conclusion", page: 5 },
            ],
          }),
        })
      const input = page.locator(".selection-panel")
      await input.locator(".input-current").filter({ hasText: "Shared-sections.pdf" }).waitFor({ state: "attached" })
      await page.locator('.composer[aria-busy="false"]').waitFor()
      await tab(input, "List")
      const unfold = input.getByRole("button", { name: "Unfold all Input sections", exact: true })
      if (await unfold.count()) await unfold.click()
      const row = input
        .locator(
          '.list-section:has(.list-heading[data-page="3"]), :is(.list-row, .list-section):has(:is(.list-choice, .list-heading)[data-page="3"])',
        )
        .first()
      await row.getByRole("button", { name: "Details for Input page 4", exact: true }).click()
      const panel = page.locator(".card-menu-options:popover-open .section-path")
      assert.deepEqual(
        await panel
          .locator("ol")
          .evaluateAll((paths) =>
            paths.map((path) =>
              [...path.querySelectorAll(".path-step")].map((button) =>
                [...button.children].map((cell) => cell.textContent),
              ),
            ),
          ),
        [
          [
            ["1", "1", "Model"],
            ["2", "2", "Attention"],
            ["3", "4", "Applications"],
          ],
          [
            ["1", "1", "Model"],
            ["2", "4", "Feed-forward networks"],
          ],
          [
            ["1", "1", "Model"],
            ["2", "4", "Embeddings"],
          ],
        ],
      )
      assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "")
      await panel.getByRole("button", { name: "Go to section: Model", exact: true }).first().click()
      await page.waitForFunction(
        () =>
          document.activeElement?.closest(".selection-panel") &&
          document.activeElement?.matches(
            '.list-heading[data-page="0"], :is(.list-choice, .list-heading)[data-page="0"]',
          ),
      )
      await input.getByRole("button", { name: "Section headings", exact: true }).click()
      assert.equal(await input.locator(".list-sections").count(), 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
    } finally {
      await browser.close()
    }
  }
})

test("Contents titles are a per-Input display preference with authored-name fallback", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
        await page.locator('.input-picker > summary[aria-label$="Contents.pdf"]').waitFor()
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

test("List strips stay flat and follow their original grab point", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const { page, input } = await lists(browser, server.resolvedUrls.local[0], { reducedMotion: "no-preference" })
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
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
        if (await switcher.isVisible()) await switcher.click()
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
      assert.ok((await rows.count()) < 50, "Auto-scroll keeps only the nearby row window mounted")
      await page.keyboard.press("Escape")
      await page.mouse.up()
      assert.equal(await selection.inputValue(), "1,3")
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
      assert.deepEqual(await rows.evaluateAll((elements) => elements.map((element) => element.id)), before)
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
  await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
          const number = pane.getByRole("button", { name: `Go to ${title} page`, exact: true })
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
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("")
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
      assert.equal(landing.delay, 240)
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
  await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
  "Contents reveals the current leaf or its collapsed ancestor without selecting pages",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
        const expand = input.getByRole("button", { name: "Unfold all Input sections", exact: true })
        await expand.click()
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

test("Input additions fly from Grid and List to visible Output in both pane layouts", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const width of [390, 1440])
        for (const outputView of ["Grid", "List"]) {
          const page = await browser.newPage({
            viewport: { width, height: 1000 },
            hasTouch: width === 390,
            reducedMotion: "no-preference",
          })
          page.setDefaultTimeout(10000)
          await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
          if (await switcher.isVisible()) await switcher.click()
          await tab(output, outputView)
          const back = page.getByRole("button", { name: "Input", exact: true })
          if (await back.isVisible()) await back.click()
          for (const view of ["Grid", "List"]) {
            await tab(input, view)
            await input.getByLabel("Page selection", { exact: true }).fill("1-2")
            await input.getByRole("button", { name: "Add to Output", exact: true }).click()
            const flight = page.locator(".addition-preview")
            await flight.waitFor()
            if (view === "List")
              assert.ok(
                await flight.evaluate((canvas) =>
                  canvas
                    .getContext("2d")
                    .getImageData(0, 0, canvas.width, canvas.height)
                    .data.some((value, index) => index % 4 === 3 && value > 0),
                ),
                "List flights retain their page title",
              )
            const box = await flight.boundingBox()
            assert.ok(box.width > 0 && box.y < 1000 && box.y + box.height > 0, JSON.stringify({ width, view, box }))
            assert.equal(await outputCount(page).innerText(), view === "Grid" ? "10 pages" : "12 pages")
            if (width === 390)
              assert.ok(
                await switcher.evaluate((button) => button.getAnimations().length > 0),
                "The visible Output button receives the flight",
              )
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
          await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
            if (await switcher.isVisible()) await switcher.click()
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
  "Touch List strips float horizontally and section path nodes share their title centers",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({
          viewport: { width: 810, height: 1080 },
          hasTouch: true,
          reducedMotion: "reduce",
        })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Paths.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 4,
              outline: [
                { title: "Chapter", page: 0 },
                { title: "A long section title that wraps when the panel narrows ".repeat(3), page: 1, parent: 0 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await tab(input, "List")
        const collapsed = input.getByRole("button", { name: /Unfold Input section/ })
        if (await collapsed.count())
          await input.getByRole("button", { name: "Unfold all Input sections", exact: true }).click()
        await input.getByRole("button", { name: "Details for Input page 2", exact: true }).click()
        const panel = input.locator(".card-menu-options:popover-open .section-path")
        for (const colorScheme of ["light", "dark"])
          for (const text of ["100%", "200%"]) {
            await page.emulateMedia({ colorScheme })
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
            const centers = await panel.locator(".path-step").evaluateAll((buttons) => {
              const center = (element) => {
                const box = element.getBoundingClientRect()
                return box.y + box.height / 2
              }
              return buttons.map((button) => [
                center(button.querySelector(".path-level")),
                center(button.lastElementChild),
                center(button.querySelector(".path-page")),
              ])
            })
            assert.ok(
              centers.every((values) => Math.max(...values) - Math.min(...values) < 1),
              JSON.stringify(centers),
            )
          }
        await page.keyboard.press("Escape")
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        const grip = input.getByRole("button", { name: "Select or drag Input page 3 to Output", exact: true })
        const box = await grip.boundingBox(),
          point = { x: box.x + box.width / 2, y: box.y + box.height / 2 }
        await grip.dispatchEvent("pointerdown", {
          pointerType: "touch",
          pointerId: 9,
          isPrimary: true,
          button: 0,
          clientX: point.x,
          clientY: point.y,
        })
        const strip = page.locator(".drag-image[data-strip]")
        const start = await strip.boundingBox()
        assert.ok(start.width <= 320)
        await page.dispatchEvent("body", "pointermove", {
          pointerType: "touch",
          pointerId: 9,
          isPrimary: true,
          clientX: point.x + 120,
          clientY: point.y + 50,
        })
        await page.waitForFunction(
          (x) => document.querySelector(".drag-image[data-strip]")?.getBoundingClientRect().x > x + 90,
          start.x,
        )
        const end = await strip.boundingBox()
        assert.ok(end.x - start.x > 90 && end.y - start.y > 25, JSON.stringify({ start, end }))
        await page.dispatchEvent("body", "pointercancel", { pointerType: "touch", pointerId: 9, isPrimary: true })
        assert.equal(await strip.count(), 0)
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
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
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
              labels: ["i", "ii", "1", "2", "3", "4"],
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
        await page.waitForFunction(
          () => document.querySelectorAll(".selection-panel .composition-card:not([inert])").length === 2,
        )
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
        await logical.fill("missing")
        await logical.press("Enter")
        assert.equal(await logical.getAttribute("aria-invalid"), "true")
        await logical.fill("ii")
        await logical.press("Enter")
        await tab(input, "Page")
        assert.match(await input.locator(".page-position").innerText(), /ii/)
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
        assert.ok(bounds.toc > bounds.goto)
      } finally {
        await page.close()
        await browser.close()
      }
    }
  },
)
