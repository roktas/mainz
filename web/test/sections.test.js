// Checks shared section folding, navigation, editing, and transfers.

import assert from "node:assert/strict"
import test from "node:test"
import { fixture, outputCount, setup, tab, selectPane } from "./browser.js"
import { engines, launch } from "./browsers.js"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { mkdir } from "node:fs/promises"

test("Section ribbons fold on touch release without selecting or transferring pages", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 820, height: 1180 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Sections.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false, count: 4, outline: [{ title: "Chapter", page: 0 }] }),
        })
      const input = page.locator(".selection-panel")
      await input.getByRole("button", { name: "Select all", exact: true }).click()
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      for (const name of ["Input", "Output"]) {
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const switcher = page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true })
        await selectPane(switcher, "tap")
        for (const view of ["List", "Grid"]) {
          await pane.getByRole("tab", { name: view, exact: true }).tap()
          const ribbon = pane.locator(view === "List" ? ".list-disclosure" : ".grid-ribbon").first()
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          const selection = await field.inputValue()
          const expanded = await ribbon.getAttribute("aria-expanded")
          await ribbon.tap()
          assert.notEqual(await ribbon.getAttribute("aria-expanded"), expanded, `${engine.name()} ${name} ${view}`)
          await ribbon.tap()
          assert.equal(await ribbon.getAttribute("aria-expanded"), expanded)
          assert.equal(await field.inputValue(), selection, "Folding preserves page selection")
          assert.equal(await page.locator(".composer[data-drag]").count(), 0)
          assert.equal(await outputCount(page).textContent(), "4 pages")
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Normal Grid centers physical numbers and bounds long section details with page labels",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const chapter = "Chapter 16. External filters, programs and commands " + "Long title ".repeat(6)
    const section = "16.6. Communications commands " + "Long section ".repeat(6)
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Labels.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 300,
              labels: Array.from({ length: 300 }, (_, page) => String(page - 5)),
              outline: [
                { title: chapter, page: 294 },
                { title: section, page: 294, parent: 0 },
              ],
            }),
          })
        const input = page.locator(".selection-panel")
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        await page
          .locator(".contents:popover-open")
          .getByRole("button", { name: `Unfold ${chapter}`, exact: true })
          .click()
        await page.locator(".contents:popover-open .destination").filter({ hasText: section }).click()
        const card = input.locator('.composition-card:has(.page-image[data-page="294"])')
        const details = card.getByLabel("Details for Input page 295", { exact: true })
        for (const width of [1440, 390]) {
          await page.setViewportSize({ width, height: 1000 })
          await details.scrollIntoViewIfNeeded()
          const position = await details.evaluate((button) => {
            const number = button.querySelector("strong").getBoundingClientRect()
            const target = button.getBoundingClientRect()
            const frame = button.closest(".composition-card").getBoundingClientRect()
            return {
              centered: Math.abs(number.x + number.width / 2 - target.x - target.width / 2) < 1,
              inset: number.left - frame.left,
            }
          })
          assert.ok(position.centered && position.inset >= 8, JSON.stringify(position))
          await details.press("Enter")
          const panel = card.locator(".page-origin-info")
          assert.equal(await panel.getByRole("row", { name: "Page Label 289", exact: true }).count(), 1)
          const bounds = await panel.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return {
              fits: box.left >= 0 && box.right <= innerWidth + 1,
              overflow: element.scrollWidth > element.clientWidth + 1,
            }
          })
          assert.ok(bounds.fits && !bounds.overflow, JSON.stringify(bounds))
          await details.press("Enter")
        }
        await tab(input, "List")
        await input.getByRole("button", { name: "Input contents", exact: true }).click()
        await page
          .locator(".contents:popover-open")
          .getByRole("button", { name: `Unfold ${chapter}`, exact: true })
          .click()
        await page.locator(".contents:popover-open .destination").filter({ hasText: section }).click()
        const heading = input.locator(".list-heading").first()
        const style = await heading.evaluate((button) => ({
          border: getComputedStyle(button).borderTopWidth,
          caps: getComputedStyle(button).fontVariantCaps,
          align: getComputedStyle(button).textAlign,
        }))
        assert.deepEqual(style, { border: "0px", caps: "all-small-caps", align: "start" })
        await page.goto(server.resolvedUrls.local[0])
        await page
          .locator('input[type="file"]')
          .first()
          .setInputFiles({
            name: "Unoutlined.pdf",
            mimeType: "application/pdf",
            buffer: fixture({ prepared: false, count: 1, labels: ["i"] }),
          })
        await input.getByLabel("Details for Input page 1", { exact: true }).click()
        await input.locator(".page-origin-info").getByRole("row", { name: "Page Label i", exact: true }).waitFor()
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Grid section ribbons fold pages without replacing heading thumbnails or List state",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 950 }, reducedMotion: "reduce" })
      await setup(page)
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
              { title: "First", page: 0 },
              { title: "First child", page: 1, parent: 0 },
              { title: "Second", page: 4 },
            ],
          }),
        })
      const input = page.locator(".selection-panel")
      await tab(input, "Grid")
      const first = input.locator('.composition-card:has(.page-image[data-page="0"])')
      const ribbon = first.getByRole("button", { name: "Fold Input section: First", exact: true })
      await ribbon.waitFor()
      assert.equal(await ribbon.locator("svg").count(), 2)
      assert.equal(await first.locator(".page-image canvas").count(), 1)
      assert.equal((await first.locator(".grid-ribbon").textContent()).trim(), "")
      const footer = await first
        .locator(".input-footer")
        .evaluate((element) => getComputedStyle(element).backgroundColor)
      const secondary = await first.evaluate((element) =>
        getComputedStyle(element).getPropertyValue("--secondary").trim(),
      )
      assert.ok(secondary)
      await ribbon.click()
      await input.locator('.page-image[data-page="1"]').waitFor({ state: "detached" })
      assert.deepEqual(
        await input.locator(".page-image").evaluateAll((buttons) => buttons.map((b) => Number(b.dataset.page))),
        [0, 4, 5],
      )
      assert.equal(await first.locator(".page-image canvas").count(), 1, "Fold retains the original first page image")
      assert.equal(
        await first.locator(".input-footer").evaluate((element) => getComputedStyle(element).backgroundColor),
        footer,
      )
      await tab(input, "List")
      assert.equal(
        await input
          .getByRole("button", { name: "Unfold Input section: First", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      )
      await input.getByRole("button", { name: "Unfold Input section: First", exact: true }).click()
      assert.equal(await input.locator(".list-section[data-emphasized]").count(), 1)
      assert.equal(
        await input.locator(".list-section[data-emphasized] .list-disclosure").getAttribute("aria-label"),
        "Fold Input section: First",
      )
      await tab(input, "Grid")
      await input.locator('.page-image[data-page="1"]').waitFor({ state: "visible" })
      await input.getByRole("button", { name: "Fold all Input sections", exact: true }).click()
      await input.locator('.page-image[data-page="1"]').waitFor({ state: "detached" })
      assert.deepEqual(
        await input.locator(".page-image").evaluateAll((buttons) => buttons.map((b) => Number(b.dataset.page))),
        [0, 4],
      )
      await input.getByRole("button", { name: "Unfold all Input sections", exact: true }).click()
      await input.locator('.page-image[data-page="5"]').waitFor({ state: "visible" })
      await input.getByLabel("Page selection", { exact: true }).fill("1-6")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      const output = page.locator(".composition-output")
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Fold Output section: First", exact: true }).click()
      await output.locator('.page-image[data-page="1"]').waitFor({ state: "detached" })
      assert.deepEqual(
        await output
          .locator(".page-image")
          .evaluateAll((buttons) => buttons.map((button) => Number(button.dataset.page))),
        [0, 4, 5],
      )
      assert.equal(await output.locator('.composition-card:has(.page-image[data-page="0"]) canvas').count(), 1)
      await tab(output, "List")
      assert.equal(
        await output
          .getByRole("button", { name: "Unfold Output section: First", exact: true })
          .getAttribute("aria-expanded"),
        "false",
      )
    } finally {
      await browser.close()
    }
  },
)

test("Grid unfolds coincident TOC headings without skipping intermediate pages", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1050 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(5000)
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
      name: "Coincident.pdf",
      mimeType: "application/pdf",
      buffer: fixture({
        prepared: false,
        count: 42,
        outline: [
          { title: "3. Navigation and Structure", page: 31 },
          { title: "3.1 Document Contents", page: 31, parent: 0 },
          { title: "3.1.1 Printed Contents", page: 31, parent: 1 },
          { title: "3.1.2 Linked Destinations", page: 34, parent: 1 },
          { title: "3.2 Outlines and Sections", page: 36, parent: 0 },
          { title: "3.2.1 Nested Headings", page: 36, parent: 4 },
          { title: "3.2.2 Section Boundaries", page: 38, parent: 4 },
          { title: "4. Processing and Validation", page: 40 },
        ],
      }),
    })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel")
    await tab(input, "Grid")
    const fold = input.getByRole("button", { name: "Fold all Input sections", exact: true })
    if (await fold.count()) await fold.click()
    await input.getByRole("button", { name: "Unfold Input section: 3. Navigation and Structure", exact: true }).click()
    const visible = await input
      .locator(".page-image")
      .evaluateAll((buttons) => buttons.map((button) => Number(button.dataset.page) + 1))
    for (const number of [32, 33, 34, 35, 37])
      assert.ok(visible.includes(number), `Page ${number} must appear after expanding section 3`)
    assert.ok(!visible.includes(36), "Later nested section 3.1.2 retains its own folded state")
    assert.ok(
      await input.getByRole("button", { name: /Unfold Input section: .*3\.1\.2/ }).count(),
      "The nested section remains independently expandable",
    )
  } finally {
    await browser.close()
  }
})

test("Grid and List section styling separates unfolded, selected, and focused states", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Sections.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          prepared: false,
          count: 8,
          metadata: Array.from({ length: 8 }, (_, i) => ({ name: `Original ${i + 1}` })),
          outline: [{ title: "First", page: 0 }],
        }),
      })
    const input = page.locator(".selection-panel")
    const card = input.locator(".grid-section-card").first()
    const ribbon = card.locator(".grid-ribbon")
    await ribbon.waitFor()
    const appearance = async () =>
      card.evaluate((element) => {
        const reference = document.createElement("span")
        document.body.append(reference)
        const color = (token) => {
          reference.style.color = `var(${token})`
          return getComputedStyle(reference).color
        }
        const frame = element.getBoundingClientRect()
        const icon = element.querySelector(".grid-ribbon .ribbon-symbol svg path").getBoundingClientRect()
        const result = {
          border: getComputedStyle(element).borderTopColor,
          thickness: getComputedStyle(element).borderTopWidth,
          ribbon: getComputedStyle(element.querySelector(".grid-ribbon")).color,
          footer: getComputedStyle(element.querySelector(".input-footer")).backgroundColor,
          iconTop: icon.top - frame.top,
          secondary: color("--secondary"),
          primary: color("--accent"),
          ribbonOpen: color("--edge"),
          surface: getComputedStyle(element).backgroundColor,
          thumbnail: getComputedStyle(element.querySelector(".thumbnail")).backgroundColor,
          focus: color("--keyboard-focus"),
        }
        reference.remove()
        return result
      })
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme })
      await page.mouse.move(900, 780)
      let state = await appearance()
      assert.equal(state.border, state.secondary, `${theme}: unfolded outline`)
      assert.equal(state.ribbon, state.ribbonOpen, `${theme}: unfolded ribbon`)
      assert.equal(state.thickness, "2px")
      assert.ok(state.iconTop >= -1 && state.iconTop <= 2, `${theme}: ribbon reaches card top`)
      assert.equal(state.footer, "rgba(0, 0, 0, 0)", `${theme}: neutral footer`)
      await ribbon.hover()
      assert.equal((await appearance()).ribbon, state.ribbonOpen, `${theme}: hover keeps unfolded ribbon gray`)
      const clearance = await card.evaluate(
        (element) => element.getBoundingClientRect().top - element.closest(".grid-view").getBoundingClientRect().top,
      )
      assert.ok(clearance >= 2, `${theme}: lifted Grid card clears the upper viewport edge`)

      const unfoldedSurface = state.surface
      const unfoldedThumbnail = state.thumbnail
      await ribbon.click()
      await page.mouse.move(900, 780)
      assert.equal(await ribbon.getAttribute("aria-expanded"), "false")
      state = await appearance()
      assert.equal(state.ribbon, state.secondary, `${theme}: folded ribbon`)
      assert.notEqual(state.surface, unfoldedSurface, `${theme}: opened card tint`)
      assert.notEqual(state.thumbnail, unfoldedThumbnail, `${theme}: opened thumbnail tint`)
      await ribbon.click()
      await page.mouse.move(900, 780)
      await card.locator(".page-image").click()
      await page.mouse.move(900, 780)
      state = await appearance()
      assert.equal(state.border, state.primary, `${theme}: selected outline`)
      await page.keyboard.press("Tab")
      await card.locator(".page-image").focus()
      assert.equal((await appearance()).border, state.focus, `${theme}: keyboard focus outline`)
      await page.keyboard.press("Escape")
      await card.locator(".page-image").click()
    }
    await tab(input, "List")
    const section = input.locator(".list-section").first()
    await section.locator(".list-disclosure").click()
    await section.locator(".list-disclosure").click()
    const colors = await section.evaluate((element) => {
      const reference = document.createElement("span")
      document.body.append(reference)
      reference.style.color = "var(--secondary)"
      const secondary = getComputedStyle(reference).color
      reference.style.color = "var(--edge)"
      const gray = getComputedStyle(reference).color
      reference.remove()
      return {
        border: getComputedStyle(element).outlineColor,
        width: getComputedStyle(element).outlineWidth,
        ribbon: getComputedStyle(element.querySelector(".list-disclosure")).color,
        secondary,
        gray,
      }
    })
    assert.equal(colors.border, colors.secondary, "Outline covers the entire open List row")
    assert.equal(colors.width, "2px")
    assert.equal(colors.ribbon, colors.gray, "Open List ribbon uses neutral gray")
    await section.locator(".list-disclosure").hover()
    assert.equal(
      await section.locator(".list-disclosure").evaluate((element) => getComputedStyle(element).color),
      colors.gray,
    )
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await section.locator(".list-disclosure").click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .list-row")].some((row) =>
        row.getAnimations().some((animation) => {
          if (animation.id !== "fold" || animation.effect.getTiming().duration < 750) return false
          return animation.effect.getKeyframes().at(-1)?.transform?.includes("scale(0.25)")
        }),
      ),
    )
    await section.locator('.list-disclosure[aria-expanded="false"]').waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .list-section")].some((row) =>
        row
          .getAnimations({ subtree: true })
          .some((animation) => animation.id === "section-heading" && animation.effect.getTiming().duration >= 600),
      ),
    )
    await section.locator(".list-disclosure").click()
    assert.equal(
      await section.evaluate((element) =>
        element.getAnimations().some((animation) => animation.id === "section-heading"),
      ),
      false,
      "List unfold does not pulse the heading",
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .list-row")].some((row) =>
        row.getAnimations().some((animation) => {
          const frames = animation.effect.getKeyframes()
          return (
            animation.id === "unfold" &&
            animation.effect.getTiming().duration === 750 &&
            frames[0]?.transform?.includes("scale(0.25)") &&
            frames.at(-1)?.transform?.includes("scale(1)")
          )
        }),
      ),
    )
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Fold Input section: First", exact: true }).click()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .composition-card")].some((card) =>
        card.getAnimations().some((animation) => {
          if (animation.id !== "fold" || animation.effect.getTiming().duration < 750) return false
          return animation.effect.getKeyframes().at(-1)?.transform?.includes("scale(0.25)")
        }),
      ),
    )
    await input.getByRole("button", { name: "Unfold Input section: First", exact: true }).waitFor()
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .composition-card.grid-section-card")].some((card) =>
        card
          .getAnimations({ subtree: true })
          .some((animation) => animation.id === "section-heading" && animation.effect.getTiming().duration >= 600),
      ),
    )
    await input.getByRole("button", { name: "Unfold Input section: First", exact: true }).click()
    assert.equal(
      await card.evaluate((element) =>
        element.getAnimations({ subtree: true }).some((animation) => animation.id === "section-heading"),
      ),
      false,
      "Grid unfold does not pulse the heading",
    )
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".selection-panel .composition-card")].some((card) =>
        card.getAnimations().some((animation) => {
          const frames = animation.effect.getKeyframes()
          return (
            animation.id === "unfold" &&
            animation.effect.getTiming().duration === 750 &&
            frames[0]?.transform?.includes("scale(0.25)") &&
            frames.at(-1)?.transform?.includes("scale(1)")
          )
        }),
      ),
    )
  } finally {
    await browser.close()
  }
})

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
        await setup(page)
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
    await setup(page)
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
        await setup(page)
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
    await setup(page)
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

test("Grid mouse selection continues in visible ranks after earlier pages fold", async () => {
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
    const input = page.locator(".selection-panel")
    await input.getByRole("button", { name: "Fold Input section: First", exact: true }).click()
    await input.locator('.page-image[data-page="6"]').click()
    await page.keyboard.press("Shift")
    assert.equal(
      await input.locator('.page-image[data-page="7"]').evaluate((element) => element === document.activeElement),
      true,
    )
    await page.keyboard.press("Shift+ArrowRight")
    assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "7-8")
  } finally {
    await browser.close()
  }
})

test("Coincident root ribbons reopen the complete page group in Grid and List", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
      name: "Coincident.pdf",
      mimeType: "application/pdf",
      buffer: fixture({
        prepared: false,
        count: 4,
        outline: [
          { title: "A", page: 0 },
          { title: "B", page: 0 },
        ],
      }),
    })
    const input = page.locator(".selection-panel")
    for (const view of ["Grid", "List"]) {
      await tab(input, view)
      const fold = input.getByRole("button", { name: "Fold all Input sections", exact: true })
      if (await fold.isVisible()) await fold.click()
      await input.getByRole("button", { name: "Unfold Input section: B", exact: true }).click()
      assert.equal(await input.locator(view === "Grid" ? ".composition-card" : ".list-row, .list-section").count(), 4)
    }
  } finally {
    await browser.close()
  }
})

test(
  "Output folds retain interactivity limits when an addition finishes before reversal",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "no-preference" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
        name: "Sections.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 6, outline: [{ title: "Chapter", page: 0 }] }),
      })
      await page.evaluate(() => {
        new MutationObserver(() => {
          for (const element of document.querySelectorAll(".addition-preview"))
            for (const animation of element.getAnimations()) {
              animation.pause()
              animation.currentTime = 0
            }
        }).observe(document.body, { childList: true })
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByLabel("Page selection", { exact: true }).fill("1-6")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      const flight = page.locator(".addition-preview")
      await flight.waitFor()
      const toggle = output.getByRole("button", { name: "Fold all Output sections", exact: true })
      await toggle.click()
      await page.waitForFunction(() => document.getAnimations().some((animation) => animation.id === "fold"))
      await page.evaluate(() => {
        for (const animation of document.getAnimations()) if (animation.id === "fold") animation.pause()
      })
      await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
      await flight.waitFor({ state: "detached" })
      const card = output.locator('.composition-card:has(.page-image[data-page="1"])')
      assert.equal(await card.evaluate((element) => !!element.closest("[inert]")), true)
      await toggle.click()
      assert.equal(await card.evaluate((element) => !!element.closest("[inert]")), false)
      await output.getByLabel("Page selection", { exact: true }).fill("")
      await card.locator(".page-image").press("Space")
      assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "2")
    } finally {
      await browser.close()
    }
  },
)

test("Grid and List drags respect closed coincident sections in scrolled windows", { timeout: 90000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  const minimalDropAfter = {
    Grid: { 12: false, 160: true },
    List: { 12: true, 160: false },
  }
  try {
    for (const view of ["Grid", "List"])
      for (const count of [12, 160])
        for (const after of [false, true]) {
          if (process.env.MAINZ_TEST_MODE === "minimal" && after !== minimalDropAfter[view][count]) continue
          const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
          page.setDefaultTimeout(10000)
          await setup(page)
          await page.goto(server.resolvedUrls.local[0])
          await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
            name: "Sections.pdf",
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count,
              metadata: Array.from({ length: count }, (_, index) => ({ name: `Original ${index + 1}` })),
              outline: [
                { title: "Coincident", page: 0 },
                ...Array.from({ length: count / 4 }, (_, index) => ({
                  title: `Group ${index + 1}`,
                  page: index * 4,
                })),
              ],
            }),
          })
          const input = page.locator(".selection-panel"),
            output = page.locator(".composition-output")
          await input.getByLabel("Page selection", { exact: true }).fill(`1-${count}`)
          await input.getByRole("button", { name: "Add to Output", exact: true }).click()
          await output.getByLabel("Page selection", { exact: true }).fill("")
          await tab(output, view)
          await output.getByRole("button", { name: "Fold all Output sections", exact: true }).click()
          const viewport = output.locator(view === "Grid" ? ".grid-view" : ".page-list")
          if (count > 12)
            await viewport.evaluate((element) => {
              element.scrollTop = element.scrollHeight
            })
          const items = output.locator(view === "Grid" ? ".composition-card" : ".list-section")
          if (count === 12) assert.equal(await items.count(), 3, "Coincident headings fold their complete shared range")
          await items
            .last()
            .locator(`${view === "Grid" ? ".page-image" : ".list-heading"}[data-page="${count - 4}"]`)
            .waitFor()
          const visible = await items.evaluateAll((elements) =>
            elements
              .filter((element) => {
                const box = element.getBoundingClientRect(),
                  viewport = element.closest(".grid-view, .page-list").getBoundingClientRect()
                return box.top >= viewport.top && box.bottom <= viewport.bottom
              })
              .map((element) => element.dataset.index),
          )
          const target = output.locator(
            `${view === "Grid" ? ".composition-card" : ".list-section"}[data-index="${visible[0]}"]`,
          )
          const first = Number(await target.getAttribute("data-index"))
          if (count > 12) assert.ok(first > 0, "The destination uses a scrolled virtual window")
          else {
            await target.locator(view === "Grid" ? ".page-image" : ".list-heading").click()
            assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "1-4")
            await output.getByLabel("Page selection", { exact: true }).fill("")
          }
          const mounted = await items.count()
          const source = items.last().locator(view === "Grid" ? ".grid-ribbon" : ".list-disclosure")
          const from = await source.boundingBox(),
            to = await (view === "Grid" ? target : target.locator(".list-heading")).boundingBox()
          const start = { x: from.x + from.width / 2, y: from.y + from.height / 2 }
          await page.mouse.move(start.x, start.y)
          await page.mouse.down()
          await page.mouse.move(start.x + 15, start.y, { steps: 3 })
          await page.locator(".composer[data-drag]").waitFor()
          if (view === "Grid") {
            assert.equal(await output.locator(".grid-ribbon").count(), mounted)
            assert.equal(await items.count(), mounted, "Dragging does not expand closed sections")
          } else assert.equal(await output.locator(".list-row").count(), 0, "Dragging retains folded List rows")
          const destination =
            view === "Grid"
              ? { x: to.x + to.width * (after ? 0.8 : 0.2), y: to.y + to.height / 2 }
              : { x: to.x + to.width / 2, y: to.y + to.height * (after ? 0.8 : 0.2) }
          const at = first + (after ? 4 : 0)
          await page.mouse.move(destination.x, destination.y, { steps: 8 })
          await page
            .locator(".drag-status")
            .filter({ hasText: new RegExp(`(?:After page ${at}|Before page ${at + 1})$`) })
            .waitFor()
          await page.mouse.move(destination.x, destination.y)
          await page.mouse.up()
          await output.getByRole("button", { name: "Section headings", exact: true }).click()
          await tab(output, "List")
          await output.getByRole("button", { name: "Go to page in Output", exact: true }).click()
          const number = output.getByRole("textbox", { name: "Output page number", exact: true })
          await number.fill(String(at + 1))
          await number.press("Enter")
          await output.locator(`.list-choice[data-page="${at}"]`).waitFor()
          assert.equal(await output.locator(`.list-choice[data-page="${at}"]`).textContent(), `Original ${count - 3}`)
          assert.equal(await outputCount(page).textContent(), `${count} pages`)
          await page.close()
        }
  } finally {
    await browser.close()
  }
})

test("Input section Enter and Plus use the preparation before their full range", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
      name: "Sections.pdf",
      mimeType: "application/pdf",
      buffer: fixture({
        prepared: false,
        count: 8,
        metadata: Array.from({ length: 8 }, (_, i) => ({ name: `Original ${i + 1}` })),
        outline: [
          { title: "First", page: 0 },
          { title: "Second", page: 4 },
        ],
      }),
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const selected = input.getByLabel("Page selection", { exact: true })
    let count = 0
    for (const [view, selector, key] of [
      ["Grid", '.page-image[data-page="0"]', "+"],
      ["List", '.list-heading[data-page="0"]', "Enter"],
    ]) {
      await tab(input, view)
      const focused = input.locator(selector)
      await selected.fill("20")
      await focused.press(key)
      assert.equal(await outputCount(page).textContent(), `${count} pages`)
      assert.equal(await selected.inputValue(), "20")
      await selected.fill("8,7,8")
      await input.locator(".sequence-options summary").click()
      await input.getByLabel("Repetitions", { exact: true }).fill("2")
      await input.getByLabel("Start each repeat on front", { exact: true }).check()
      await page.keyboard.press("Escape")
      await focused.press(key)
      assert.equal(await selected.inputValue(), "")
      count += 8
      assert.equal(await outputCount(page).textContent(), `${count} pages`)
      await focused.press(key)
      count += 4
      assert.equal(await outputCount(page).textContent(), `${count} pages`)
    }
    await output.getByRole("button", { name: "Section headings", exact: true }).click()
    await tab(output, "List")
    assert.deepEqual((await output.locator(".list-choice").allTextContents()).slice(0, 8), [
      "Original 8",
      "Original 7",
      "Original 8",
      "Blank",
      "Original 8",
      "Original 7",
      "Original 8",
      "Blank",
    ])
  } finally {
    await browser.close()
  }
})
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
      await setup(page)
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
          await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }))
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
        await setup(page)
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
        await output.getByRole("button", { name: "Fold all Output sections", exact: true }).waitFor()
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
      assert.equal(await output.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      await tab(output, "List")
      for (const [pane, name] of [
        [input, "Input"],
        [output, "Output"],
      ]) {
        await pane.getByRole("button", { name: `Fold all ${name} sections`, exact: true }).click()
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
          await selectPane(page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }))
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
            end: box.right - bounds(".page-destination > button svg")[1],
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

test("List section summaries reveal every same-page section across hierarchy levels", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
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

test("List section additions carry a strip from their heading row", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Sections.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ count: 4, outline: [{ title: "Chapter", page: 0 }] }),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel")
      await tab(input, "List")
      const disclosure = input.locator(".list-disclosure")
      if ((await disclosure.getAttribute("aria-expanded")) === "true") await disclosure.click()
      const output = page.locator(".composition-output")
      await tab(output, "List")
      await page.evaluate(() =>
        new MutationObserver(() =>
          document.querySelectorAll(".addition-preview").forEach((element) =>
            element.getAnimations().forEach((animation) => {
              animation.pause()
              animation.currentTime = 0
            }),
          ),
        ).observe(document.body, { childList: true }),
      )
      await input.locator(".list-section").hover()
      const origin = await input.locator(".list-section").boundingBox()
      await input.getByRole("button", { name: "Add Input section pages 1–4 to Output", exact: true }).click()
      const flight = page.locator(".addition-preview")
      await flight.waitFor()
      const start = await flight.boundingBox()
      assert.ok(Math.abs(start.x + start.width / 2 - origin.x - origin.width / 2) < 1)
      assert.ok(Math.abs(start.y + start.height / 2 - origin.y - origin.height / 2) < 1)
      assert.equal(await flight.getAttribute("data-strip"), "")
      assert.equal(await flight.locator(".drag-title").textContent(), "Chapter")
      assert.match(await flight.textContent(), /×4/)
      await flight.evaluate((element) => {
        const animation = element.getAnimations()[0]
        animation.currentTime = animation.effect.getTiming().duration - 1
      })
      const end = await flight.boundingBox(),
        destination = await output.locator(".list-section").boundingBox()
      assert.ok(Math.abs(end.x + end.width / 2 - destination.x - destination.width / 2) < 1)
      assert.ok(Math.abs(end.y + end.height / 2 - destination.y - destination.height / 2) < 1)
      await page.close()
    } finally {
      await browser.close()
    }
  }
})

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
        await setup(page)
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
        const row = await grip.evaluate((button) => button.closest(".list-row").getBoundingClientRect().toJSON())
        await grip.dispatchEvent("pointerdown", {
          pointerType: "touch",
          pointerId: 9,
          isPrimary: true,
          button: 0,
          clientX: point.x,
          clientY: point.y,
        })
        const strip = page.locator(".drag-image[data-strip]")
        await page.dispatchEvent("body", "pointermove", {
          pointerType: "touch",
          pointerId: 9,
          isPrimary: true,
          clientX: point.x + 120,
          clientY: point.y + 50,
        })
        await strip.waitFor()
        await page.waitForFunction(() => !!document.querySelector(".drag-image[data-strip]")?.style.translate)
        const end = await strip.boundingBox()
        assert.ok(end.width <= 320 && end.x - row.x > 90 && end.y - row.y > 25, JSON.stringify({ row, end }))
        await page.dispatchEvent("body", "pointercancel", { pointerType: "touch", pointerId: 9, isPrimary: true })
        assert.equal(await strip.count(), 0)
      } finally {
        await browser.close()
      }
    }
  },
)

test("Active section folds cancel on reversal, Input replacement, and view teardown", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    for (const view of ["Grid", "List"]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "no-preference" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      for (const name of ["B", "A"]) {
        await page
          .locator('input[type=file][aria-label="Open PDF"]')
          .first()
          .setInputFiles({
            name: `${name}.pdf`,
            mimeType: "application/pdf",
            buffer: fixture({
              prepared: false,
              count: 12,
              outline: [
                { title: `${name} first`, page: 0 },
                { title: `${name} second`, page: 6 },
              ],
            }),
          })
        await page.locator(`.input-picker > summary[aria-label="Select Input · ${name}.pdf"]`).waitFor()
      }
      const input = page.locator(".selection-panel")
      await tab(input, view)
      const reopen = input.getByRole("button", { name: "Unfold all Input sections", exact: true })
      if (await reopen.isVisible()) {
        await reopen.click()
        await page.waitForFunction(
          () => !document.getAnimations().some((animation) => ["fold", "unfold"].includes(animation.id)),
        )
      }
      const choice = input.locator(`${view === "Grid" ? ".page-image" : ".list-choice"}[data-page="1"]`)
      await choice.focus()
      const fold = input.getByRole("button", { name: "Fold Input section: A first", exact: true })
      await fold.dispatchEvent("click")
      assert.equal(await choice.evaluate((element) => !!element.closest("[inert]")), true)
      await page.keyboard.press("Space")
      assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "")
      await page.waitForFunction(
        () => !document.getAnimations().some((animation) => ["fold", "unfold"].includes(animation.id)),
      )
      await fold.dispatchEvent("click")
      await fold.dispatchEvent("click")
      await page.waitForFunction(
        () => !document.getAnimations().some((animation) => ["fold", "unfold"].includes(animation.id)),
      )
      assert.equal(await choice.evaluate((element) => !!element.closest("[inert]")), false)
      await choice.press("Space")
      assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "2")
      await fold.dispatchEvent("click")
      await page.locator(".input-picker > summary:visible").click()
      await page.locator(".input-choice-select").filter({ hasText: "B.pdf" }).click()
      await page.waitForFunction(
        () => !document.getAnimations().some((animation) => ["fold", "unfold"].includes(animation.id)),
      )
      assert.equal(await input.getByRole("button", { name: "Fold Input section: B first", exact: true }).count(), 1)
      assert.equal(await input.getByRole("button", { name: "Unfold Input section: B first", exact: true }).count(), 0)
      await input.getByRole("button", { name: "Fold Input section: B first", exact: true }).dispatchEvent("click")
      await tab(input, "Page")
      await page.waitForFunction(
        () => !document.getAnimations().some((animation) => ["fold", "unfold"].includes(animation.id)),
      )
      await tab(input, view)
      assert.equal(await input.getByRole("button", { name: "Fold Input section: B first", exact: true }).count(), 1)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test(
  "Section drag cancellation restores preparation, Output selection, and inspection",
  { timeout: 30000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
        name: "Cancel.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          prepared: false,
          count: 8,
          outline: [
            { title: "First", page: 0 },
            { title: "Second", page: 4 },
          ],
        }),
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByLabel("Page selection", { exact: true }).fill("1-8")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await input.getByLabel("Page selection", { exact: true }).fill("8")
      await output.getByLabel("Page selection", { exact: true }).fill("2")
      await output.getByRole("button", { name: "Fold all Output sections", exact: true }).click()
      for (const pane of [input, output]) {
        const grip = pane.locator(".grid-ribbon").last(),
          box = await grip.boundingBox()
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
        await page.mouse.down()
        await page.mouse.move(box.x + box.width / 2 + 15, box.y + box.height / 2, { steps: 3 })
        await page.locator(".composer[data-drag]").waitFor()
        await page.keyboard.press("Escape")
        await page.mouse.up()
        assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "8")
        assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "2")
        assert.equal(await outputCount(page).textContent(), "8 pages")
      }
      await tab(output, "Page")
      assert.match(await output.locator(".page-position").textContent(), /^1/)
    } finally {
      await browser.close()
    }
  },
)

test("Overflowing sections start open and retain explicit choices across Grid and List", async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
      name: "Overflow.pdf",
      mimeType: "application/pdf",
      buffer: fixture({
        prepared: false,
        count: 40,
        outline: Array.from({ length: 10 }, (_, index) => ({ title: `Group ${index}`, page: index * 4 })),
      }),
    })
    const input = page.locator(".selection-panel")
    for (const view of ["Grid", "List", "Grid"]) {
      await tab(input, view)
      assert.equal(
        await input
          .getByRole("button", { name: "Fold Input section: Group 0", exact: true })
          .getAttribute("aria-expanded"),
        "true",
      )
    }
    await input.getByRole("button", { name: "Fold Input section: Group 0", exact: true }).click()
    await tab(input, "List")
    assert.equal(
      await input
        .getByRole("button", { name: "Unfold Input section: Group 0", exact: true })
        .getAttribute("aria-expanded"),
      "false",
    )
  } finally {
    await browser.close()
  }
})

test(
  "Output section edits animate their strips and Delete retains one row focus contour",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "no-preference" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
        name: "Sections.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          prepared: false,
          count: 4,
          outline: Array.from({ length: 4 }, (_, page) => ({ title: `Section ${page + 1}`, page })),
        }),
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await tab(output, "List")
      await input.getByLabel("Page selection", { exact: true }).fill("1-4")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.locator(".addition-preview").waitFor({ state: "detached" })
      await output.getByLabel("Page selection", { exact: true }).fill("")
      const second = output.locator('.list-section[data-index="1"]')
      const id = await second.getAttribute("id")
      await second.getByRole("button", { name: "Move Output page 2 earlier", exact: true }).press("Enter")
      await page.waitForFunction(
        (id) =>
          document
            .getElementById(id)
            ?.getAnimations()
            .some((animation) =>
              animation.effect.getKeyframes().some((frame) => frame.translate && frame.translate !== "0 0"),
            ),
        id,
      )
      assert.equal(await output.locator('.list-section[data-index="0"]').getAttribute("id"), id)
      await output.locator('.list-heading[data-page="0"]').click()
      await page.keyboard.press("Delete")
      const outgoing = output.locator(".list-section.removing")
      await outgoing.waitFor()
      assert.equal(await outgoing.evaluate((element) => element.inert), true)
      await outgoing.waitFor({ state: "detached" })
      const focused = output.locator(".list-heading:focus")
      await focused.waitFor()
      const contour = await focused.evaluate((element) => ({
        inner: getComputedStyle(element).outlineColor,
        outer: getComputedStyle(element.closest("li")).outlineColor,
      }))
      assert.equal(contour.inner, "rgba(0, 0, 0, 0)")
      assert.notEqual(contour.outer, "rgba(0, 0, 0, 0)")
      assert.equal(await outputCount(page).textContent(), "3 pages")
    } finally {
      await browser.close()
    }
  },
)
