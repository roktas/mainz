// Checks Grid density, pagination, and viewport capacity.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer, fixture, captureLayout, checkGrips, tab, pagePosition } from "./browser.js"

test("Touch Grid matrices match phone and iPad references", { timeout: 120000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser, page
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const [width, height, input, output, compact] of [
        [320, 568, [1, 8, 8], [1, 12, 12], [2, 3, 6]],
        [375, 667, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [390, 844, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [393, 852, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [440, 956, [2, 4, 8], [2, 6, 12], [4, 4, 16]],
        [667, 375, [3, 3, 8], [3, 4, 12], [6, 6, 36]],
        [844, 390, [4, 2, 8], [4, 3, 12], [8, 7, 56]],
        [852, 393, [4, 2, 8], [4, 3, 12], [8, 7, 56]],
        [956, 440, [2, 2, 4], [2, 2, 4], [4, 4, 16]],
        [744, 1133, [4, 2, 8], [4, 3, 12], [7, 7, 49]],
        [1133, 744, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
        [768, 1024, [4, 2, 8], [4, 3, 12], [7, 7, 49]],
        [1024, 768, [3, 2, 6], [3, 2, 6], [5, 4, 20]],
        [810, 1080, [4, 2, 8], [4, 3, 12], [8, 7, 56]],
        [1080, 810, [3, 3, 9], [3, 3, 9], [5, 5, 25]],
        [1079, 810, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
        [1080, 809, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
        [1133, 810, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
        [1080, 900, [3, 2, 6], [3, 2, 6], [5, 5, 25]],
      ]) {
        await page.setViewportSize({ width, height })
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
        )
        for (const [name, normal] of [
          ["Input", input],
          ["Output", output],
        ]) {
          const tabs = page.locator(".mobile-workspace-tabs")
          if (await tabs.isVisible()) await tabs.getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          for (const [density, reference] of [
            ["Normal", normal],
            ["Compact", compact],
          ]) {
            await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            const geometry = await pane.locator(".composition-grid").evaluate((element) => {
              const cards = [...element.children].map((card) => card.getBoundingClientRect())
              const frame = element.getBoundingClientRect()
              return {
                matrix: [
                  new Set(cards.map((card) => card.left)).size,
                  new Set(cards.map((card) => card.top)).size,
                  cards.length,
                ],
                fits: cards.every((card) => card.left >= frame.left - 1 && card.right <= frame.right + 1),
                overflow: document.documentElement.scrollWidth > innerWidth,
              }
            })
            const label = `${name} ${density}, ${width}×${height}, ${colorScheme}`
            assert.deepEqual(
              geometry.matrix,
              reference,
              `${label}: Rendered columns, rows, and pages match the reference`,
            )
            assert.ok(geometry.fits, `${label}: Cards stay inside the pane`)
            assert.equal(geometry.overflow, false, `${label}: The workspace fits horizontally`)
            if (width === 1080 && height === 810) {
              await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
              const pagination = await pane.evaluate((element) => {
                const box = (selector) => element.querySelector(selector).getBoundingClientRect()
                const cards = [...element.querySelectorAll(".composition-card")]
                const slider = box(".batch-slider"),
                  caption = box(".batch-caption")
                return {
                  below: caption.top >= slider.top + slider.height / 2,
                  gap: slider.top - Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)),
                  bottom: Math.max(slider.bottom, caption.bottom),
                  status: document.querySelector(".footnote").getBoundingClientRect().top,
                  image: box(".thumbnail canvas").height,
                }
              })
              assert.equal(pagination.below, true, `${label}: Both densities keep the caption below the slider`)
              assert.ok(pagination.gap >= 8, `${label}: Pagination stays clear of the cards`)
              assert.ok(pagination.bottom <= pagination.status, `${label}: Pagination stays above the status bar`)
              if (density === "Normal") {
                assert.equal(pagination.image, 144, `${label}: Normal retains a larger preview than Compact`)
                await checkGrips(pane, label)
              }
            }
          }
        }
      }
    }
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "grid").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Normal Grid restores Full HD and QHD rows without changing neighboring layouts",
  { timeout: 120000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser, page
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      page = await browser.newPage({ reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
      )
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const [width, height, normal, compact] of [
          [1080, 810, [2, 2], [5, 5]],
          [1600, 900, [3, 2], [6, 6]],
          [1919, 1080, [3, 2], [6, 6]],
          [1920, 982, [3, 3], [6, 6]],
          [1920, 1080, [3, 3], [6, 6]],
          [2239, 1260, [3, 3], [7, 6]],
          [2240, 1260, [3, 3], [7, 6]],
          [2559, 1440, [4, 3], [8, 7]],
          [2560, 1280, [4, 3], [8, 6]],
          [2560, 1310, [4, 3], [8, 6]],
          [2560, 1440, [4, 3], [8, 7]],
          [2879, 1620, [4, 3], [9, 7]],
          [2880, 1620, [4, 3], [9, 7]],
          [3840, 1964, [6, 5], [12, 7]],
          [3840, 2160, [6, 5], [12, 7]],
        ]) {
          await page.setViewportSize({ width, height })
          await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
          await page.waitForFunction(
            () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
          )
          for (const name of ["Input", "Output"]) {
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            for (const [density, [columns, rows]] of [
              ["Normal", normal],
              ["Compact", compact],
            ]) {
              await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
              await page.evaluate(
                () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
              )
              await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
              const geometry = await pane.locator(".grid-view").evaluate((element) => {
                const bounds = (selector) => element.querySelector(selector).getBoundingClientRect().toJSON()
                const cards = [...element.querySelectorAll(".composition-card")]
                const positions = cards.map((card) => card.getBoundingClientRect())
                const controls = element.closest('[data-density="normal"]')
                  ? [
                      cards[0].querySelector(".input-footer button, .occurrence-actions button"),
                      cards[Number(element.dataset.columns)].querySelector(".page-grip"),
                    ].map((control) => {
                      const box = control.getBoundingClientRect(),
                        extra = getComputedStyle(control, "::after")
                      return {
                        top: box.top + (parseFloat(extra.top) || 0),
                        bottom: box.bottom - (parseFloat(extra.bottom) || 0),
                      }
                    })
                  : []
                return {
                  batch: Number(element.dataset.batch),
                  matrix: [
                    new Set(positions.map((box) => box.left)).size,
                    new Set(positions.map((box) => box.top)).size,
                  ],
                  card: bounds(".composition-card"),
                  image: bounds(".thumbnail canvas"),
                  thumbnail: bounds(".thumbnail"),
                  controls,
                  cardsBottom: Math.max(...positions.map((box) => box.bottom)),
                  slider: bounds(".batch-slider"),
                  caption: bounds(".batch-caption"),
                }
              })
              const label = `${name} ${density}, ${width}×${height}, ${colorScheme}`
              assert.deepEqual(geometry.matrix, [columns, rows], `${label}: Rendered cards match the reference matrix`)
              assert.equal(geometry.batch, columns * rows, `${label}: Complete rows keep their capacity`)
              const qhd = width >= 2560 && width < 2880
              if (density === "Normal" && qhd)
                assert.ok(
                  geometry.card.height >= 236 && geometry.card.height <= 280,
                  `${label}: QHD uses its calibrated height range`,
                )
              else
                assert.equal(
                  geometry.card.height,
                  density === "Compact" ? 125 : 268,
                  `${label}: Card height follows its desktop range`,
                )
              if (density === "Normal") {
                if (!qhd)
                  assert.equal(geometry.image.height, 168, `${label}: Portrait thumbnails retain their fitted size`)
                if (qhd) {
                  const margins = [
                    geometry.image.top - geometry.thumbnail.top,
                    geometry.thumbnail.bottom - geometry.image.bottom,
                  ]
                  assert.ok(
                    margins.every((margin) => margin >= 16),
                    `${label}: Images retain upper and lower margins`,
                  )
                  assert.ok(Math.abs(margins[0] - margins[1]) < 1, `${label}: Image margins stay equal`)
                }
                assert.ok(
                  geometry.controls.every((control) => control.bottom - control.top >= 44),
                  `${label}: Controls retain 44 px targets`,
                )
                assert.ok(
                  geometry.controls[0].bottom <= geometry.controls[1].top,
                  `${label}: Adjacent rows keep separate targets`,
                )
              }
              assert.ok(geometry.slider.top - geometry.cardsBottom >= 8, `${label}: Cards leave room for pagination`)
              assert.equal(
                geometry.caption.top >= geometry.slider.top + geometry.slider.height / 2,
                true,
                `${label}: Caption stays below the slider`,
              )
              await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
              assert.ok(
                await pane
                  .locator(".batch-caption")
                  .evaluate(
                    (element) =>
                      element.getBoundingClientRect().bottom <=
                      document.querySelector(".footnote").getBoundingClientRect().top,
                  ),
                `${label}: Caption stays above the status bar`,
              )
              if (width === 2560 && colorScheme === "dark") await checkGrips(pane, label)
            }
          }
        }
      }
    } catch (error) {
      const screenshot = page && (await captureLayout(page, "desktop").catch(() => undefined))
      if (screenshot) error.message += `\nScreenshot: ${screenshot}`
      throw error
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Grid scales desktop capacity, balances Page, and retains compact actions", { timeout: 180000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height })
      const capacity = width === 1920 ? 9 : 12
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      assert.equal(await input.locator(".composition-card").count(), capacity)
      assert.equal(await output.locator(".composition-card").count(), capacity)
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".thumbnail")].every((element) => element.getAttribute("aria-busy") === "false"),
      )
      assert.equal(await page.locator("main").evaluate((element) => element.clientWidth), width === 1920 ? 1232 : 1472)
      assert.equal(await input.locator(".batch-marks > span").count(), width === 1920 ? 27 : 20)
      const imageHeight = await input
        .locator(".page-image canvas")
        .first()
        .evaluate((element) => element.clientHeight)
      assert.equal(imageHeight, width === 1920 ? 168 : 180, "Normal thumbnails retain their fitted image height")
      assert.deepEqual(
        await output
          .locator(".composition-card")
          .first()
          .locator(".occurrence-actions button")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))),
        ["Remove Output page 1", "Duplicate Output page 1"],
      )
      const controls = await output
        .locator(".composition-card")
        .first()
        .locator(".occurrence-actions button")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
      for (let index = 1; index < controls.length; index++)
        assert.ok(controls[index].left - controls[index - 1].right >= 28, "Footer controls retain breathing room")
      await input.getByRole("button", { name: "Next Input thumbnails", exact: true }).click()
      await input.getByRole("button", { name: `Select Input page ${capacity + 1}`, exact: true }).waitFor()
      await tab(input, "Page")
      assert.match(await pagePosition(input), new RegExp(`^${capacity + 1}\\s*\\/ 240`))
      if (width === 2560) {
        await input.locator(".pdf-viewport[aria-busy=false]").waitFor()
        const margins = await input.locator(".page-scroll").evaluate((element) => {
          const frame = element.getBoundingClientRect()
          const canvas = element.querySelector("canvas").getBoundingClientRect()
          return [canvas.left - frame.left, frame.right - canvas.right]
        })
        assert.ok(
          margins.every((margin) => margin <= 72),
          "QHD Page side margins stay within 72 px",
        )
      }
      const frames = await page.locator(".page-content").evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect()
          return { width: box.width, height: box.height, top: box.y, bottom: box.bottom }
        }),
      )
      assert.deepEqual(frames[0], frames[1], "Grid and Page use equal pane widths and aligned top and bottom edges")
      await tab(input, "Grid")
      const first = input.getByRole("button", { name: `Select Input page ${capacity + 1}`, exact: true })
      await first.waitFor()
      await first.focus()
      await page.keyboard.press("End")
      await input.getByRole("button", { name: "Select Input page 240", exact: true }).waitFor()
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Select Input page 240"] .thumbnail')?.getAttribute("aria-busy") ===
          "false",
      )
      assert.ok(
        Math.abs(
          (await input
            .getByRole("button", { name: "Select Input page 240", exact: true })
            .locator("canvas")
            .evaluate((element) => element.getBoundingClientRect().width)) - (width === 1920 ? 170 : 149),
        ) < 1,
        "Landscape images fit the narrower Normal cards",
      )
      await page.keyboard.press("Home")
      await input.getByRole("button", { name: "Select Input page 1", exact: true }).waitFor()
    }
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).click()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 9)
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).waitFor()
    assert.equal(
      await input.locator(".composition-card").count(),
      9,
      "Resizing retains the inspected page in the new group",
    )
    const slider = input.getByRole("slider", { name: "Input thumbnail range", exact: true })
    await slider.focus()
    await page.keyboard.press("Home")
    for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight")
    await input.getByRole("button", { name: "Select Input page 28", exact: true }).waitFor()
    assert.equal((await input.locator(".batch-caption").innerText()).replace(/\s+/g, ""), "4/27·28–36/240")
    assert.ok(
      (await input.locator(".batch-total").allTextContents()).every((text) => /^\s\/\s/.test(text)),
      "Pagination leaves visible space on both sides of each slash",
    )
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      const normalNumber = output.locator(".composition-card .page-origin > summary").first()
      await normalNumber.hover()
      const hoverColor = await normalNumber.evaluate((element) => getComputedStyle(element).color)
      await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 36)
      const density = input.getByRole("group", { name: "Input grid density", exact: true })
      await input.getByRole("button", { name: "Select Input page 12", exact: true }).click()
      await density.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "9",
      )
      assert.equal(await input.getByRole("button", { name: "Select Input page 12", exact: true }).isVisible(), true)
      assert.equal(
        await output.locator(".composition-card").count(),
        36,
        "Input density leaves Output density independent",
      )
      await tab(input, "Page")
      assert.equal(await density.isVisible(), false, "Page hides Grid density controls")
      const frames = await page.locator(".page-content").evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect()
          return { width: box.width, height: box.height, top: box.y, bottom: box.bottom }
        }),
      )
      assert.deepEqual(frames[0], frames[1], "Mixed densities keep Grid and Page balanced")
      for (const mode of ["Normal", "Compact"]) {
        await output.getByRole("button", { name: `${mode} Output grid`, exact: true }).click()
        for (const [width, height, textSize] of [
          [960, 720, "100%"],
          [1280, 800, "100%"],
          [1920, 1080, "100%"],
          [2560, 1440, "100%"],
          [3840, 2160, "100%"],
          [3840, 2160, "200%"],
        ]) {
          await page.setViewportSize({ width, height })
          await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize)
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          const navigation = await page.evaluate(() => {
            const grid = document.querySelector(".page-batches")
            const footer = document.querySelector(".page-navigation")
            const centers = [grid, footer].map((element) =>
              [...element.querySelectorAll(":scope > button")].map((button) => {
                const box = button.getBoundingClientRect()
                return box.y + box.height / 2
              }),
            )
            const caption = grid.querySelector(".batch-caption").getBoundingClientRect()
            const track = grid.querySelector(".batch-slider").getBoundingClientRect()
            const cards = [...document.querySelectorAll(".composition-card")]
            return {
              arrows: centers[0].map((center, index) => center - centers[1][index]),
              captionBelow: caption.top >= track.top + track.height / 2,
              cardGap:
                Math.min(caption.top, track.top) -
                Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)),
              overflow: document.documentElement.scrollWidth > innerWidth,
            }
          })
          const label = `${mode} ${width}×${height}, ${textSize} text, ${theme}`
          assert.ok(
            navigation.arrows.every((delta) => Math.abs(delta) < 1),
            `${label}: Grid and Page arrows align`,
          )
          assert.equal(navigation.captionBelow, true, `${label}: Caption stays below the slider`)
          assert.ok(navigation.cardGap >= 8, `${label}: Pagination leaves room below the cards`)
          assert.equal(navigation.overflow, false, `${label}: The workspace fits horizontally`)
        }
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = ""))
      await page.setViewportSize({ width: 1920, height: 1080 })
      await tab(input, "Grid")
      assert.equal(
        await input.locator(".composition-card").count(),
        9,
        "Grid retains its density across Page inspection",
      )
      await density.getByRole("button", { name: "Compact Input grid", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "36",
      )
      await page.setViewportSize({ width: 2560, height: 1440 })
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "56",
      )
      assert.equal(await output.locator(".composition-card").count(), 56)
      await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
      const geometry = await output.locator(".composition-grid").evaluate((element) => {
        const cards = [...element.children].map((card) => card.getBoundingClientRect())
        const card = element.firstElementChild
        const heading = card.querySelector(".page-label").getBoundingClientRect()
        const frame = card.querySelector(".page-image .thumbnail").getBoundingClientRect()
        const canvas = card.querySelector(".page-image canvas").getBoundingClientRect()
        const panel = element.parentElement.getBoundingClientRect()
        return {
          columns: new Set(cards.map((box) => box.x)).size,
          rows: new Set(cards.map((box) => box.y)).size,
          card: [cards[0].width, cards[0].height],
          rowEdges: [cards[0].left - panel.left, panel.right - cards[7].right],
          heading: [heading.left - cards[0].left, heading.width, heading.height],
          numberSize: parseFloat(getComputedStyle(card.querySelector(".card-number")).fontSize),
          numberInset: card.querySelector(".card-number strong").getBoundingClientRect().left - cards[0].left,
          grip: card.querySelector(".page-grip svg").getBoundingClientRect().width,
          gripCenters: [...element.children].map((item) => {
            const bounds = item.getBoundingClientRect()
            const grip = item.querySelector(".page-grip svg").getBoundingClientRect()
            return Math.abs(grip.x + grip.width / 2 - bounds.x - bounds.width / 2)
          }),
          foldGap:
            element.children[1].querySelector(".page-fold").getBoundingClientRect().left -
            element.children[1].querySelector(".page-grip svg").getBoundingClientRect().right,
          targets: [...card.querySelectorAll(".page-label > .page-origin > button, .page-label > .page-grip")].map(
            (button) => [button.getBoundingClientRect().width, parseFloat(getComputedStyle(button, "::after").height)],
          ),
          nextTargetTop:
            element.children[8].querySelector(".card-number").getBoundingClientRect().top +
            parseFloat(getComputedStyle(element.children[8].querySelector(".card-number"), "::after").top) -
            cards[0].bottom,
          image: canvas.height,
          margins: [
            canvas.left - frame.left,
            frame.right - canvas.right,
            canvas.top - frame.top,
            frame.bottom - canvas.bottom,
          ],
        }
      })
      assert.deepEqual([geometry.columns, geometry.rows], [8, 7])
      assert.deepEqual(geometry.card, [76.25, 125])
      assert.deepEqual(geometry.rowEdges, [0, 0], "Compact rows fill the panel width")
      assert.deepEqual(geometry.heading, [0, 76.25, 26], "The header fills the card width")
      assert.equal(geometry.numberSize, 10.8, "Compact page numbers use a smaller text size")
      assert.equal(geometry.numberInset, 6, "Page numbers keep space from the card's left edge")
      assert.equal(geometry.grip, 15)
      assert.ok(
        geometry.gripCenters.every((offset) => offset < 0.5),
        "Every Compact grip is centered on its card",
      )
      assert.ok(geometry.foldGap >= 2, "The grip stays clear of the folded corner")
      assert.ok(geometry.targets.every(([width, height]) => width >= 24 && height === 44))
      assert.ok(geometry.nextTargetTop >= 0, "Heading targets do not overlap the previous row's cards")
      assert.equal(geometry.image, 82)
      assert.ok(
        geometry.margins.every((margin) => margin >= 7.5 && margin <= 8.2),
        "Enlarged images retain balanced inner margins",
      )
      const compactNumber = output.locator(".composition-card .card-number").first()
      await compactNumber.hover()
      assert.deepEqual(
        await compactNumber.evaluate((element) => {
          const style = getComputedStyle(element)
          return [style.color, style.backgroundColor, style.boxShadow]
        }),
        [hoverColor, "rgba(0, 0, 0, 0)", "none"],
        "Compact numbers use Normal's color-only hover",
      )
      for (const pane of [input, output]) {
        const first = pane.locator(".composition-card").first()
        await first.locator(".page-image").click()
        assert.equal(
          await first.evaluate((element) => {
            const card = element.getBoundingClientRect()
            const label = element.querySelector(".page-label")
            const heading = label.getBoundingClientRect()
            const divider = getComputedStyle(label, "::after")
            const stroke = parseFloat(getComputedStyle(element).borderInlineStartWidth)
            return (
              heading.left + parseFloat(divider.insetInlineStart) >= card.left + stroke &&
              heading.right - parseFloat(divider.insetInlineEnd) <= card.right - stroke
            )
          }),
          true,
          "The selected heading separator cannot cut through the selection contour",
        )
        await first.locator(".page-image").click()
      }
      assert.equal(await input.getByRole("slider", { name: "Input thumbnail range", exact: true }).isVisible(), true)
      const compactRange = input.getByRole("slider", { name: "Input thumbnail range", exact: true })
      await compactRange.press("End")
      for (const family of ["", "DejaVu Sans", "Liberation Sans"]) {
        await input.evaluate((pane, value) => (pane.style.fontFamily = value), family)
        const numberGaps = await input.locator(".composition-card").evaluateAll((cards) =>
          cards.map((card) => {
            const number = card.querySelector(".card-number strong").getBoundingClientRect()
            const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
            return grip.left - number.right
          }),
        )
        assert.ok(
          numberGaps.every((gap) => gap >= 2),
          `${family || "System font"}: three-digit numbers stay clear of the grips (${Math.min(...numberGaps)}px)`,
        )
      }
      await input.evaluate((pane) => pane.style.removeProperty("font-family"))
      await compactRange.press("Home")
      await page.setViewportSize({ width: 1920, height: 1080 })
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "36",
      )
      const opener = output.getByRole("button", {
        name: "Details for Output page 1",
        exact: true,
      })
      await opener.focus()
      await page.keyboard.press("Enter")
      const menu = page.locator(".card-menu-options:popover-open")
      await menu.waitFor()
      await page.keyboard.press("Escape")
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true)
      await opener.click()
      await menu.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "241 PDF pages",
      )
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await opener.click()
      await menu.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
    }
    const touch = await browser.newPage({
      viewport: { width: 1024, height: 1366 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await touch.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await touch.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    await touch.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    const touchInput = touch.locator(".selection-panel")
    await touchInput.getByRole("button", { name: "Compact Input grid", exact: true }).click()
    const touchTargets = await touchInput
      .locator(".composition-card")
      .first()
      .locator(".page-label > .page-origin > button, .page-label > .page-grip")
      .evaluateAll((buttons) =>
        buttons.map((button) => [
          button.getBoundingClientRect().width,
          parseFloat(getComputedStyle(button, "::after").height),
        ]),
      )
    assert.ok(
      touchTargets.every(([width, height]) => width >= 24 && height === 44),
      "Touch retains separate heading targets of at least 24 by 44 px",
    )
    async function checkFrameBottom() {
      await touch.evaluate(() => scrollTo({ top: document.documentElement.scrollHeight, behavior: "instant" }))
      const geometry = await touch.evaluate(() => ({
        bottom:
          document.querySelector(".footnote").getBoundingClientRect().top -
          parseFloat(getComputedStyle(document.querySelector("main")).paddingBottom),
        panes: [...document.querySelectorAll(".selection-panel, .composition-output")]
          .filter((element) => element.clientWidth)
          .map((element) => ({
            bottom: element.getBoundingClientRect().bottom,
            frame: element.querySelector(".grid-view, .page-view").getBoundingClientRect().bottom,
          })),
        overflow: document.documentElement.scrollWidth > innerWidth,
      }))
      assert.equal(geometry.overflow, false)
      if (geometry.panes.length === 2) {
        for (const pane of geometry.panes) {
          assert.ok(
            Math.abs(pane.frame - geometry.bottom) < 1,
            `Frames fill the space above the status bar: ${JSON.stringify(geometry)}`,
          )
          assert.ok(Math.abs(pane.bottom - pane.frame) < 1, "The pane divider reaches the frame's bottom")
        }
      }
    }
    for (const [width, height] of [
      [960, 1440],
      [1032, 1376],
    ]) {
      await touch.setViewportSize({ width, height })
      for (const size of ["100%", "200%"]) {
        await touch.evaluate((value) => (document.documentElement.style.fontSize = value), size)
        for (const density of ["Normal", "Compact"]) {
          for (const name of ["Input", "Output"]) {
            const views = touch.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = touch.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            await tab(pane, "Grid")
            await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
            await checkFrameBottom()
          }
          for (const name of ["Input", "Output"]) {
            const views = touch.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = touch.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            await tab(pane, "Page")
            await checkFrameBottom()
          }
        }
      }
    }
    await touch.close()
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Compact pagination retains readable four- and five-digit numbers", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Numbers.pdf",
        mimeType: "application/pdf",
        buffer: fixture(false),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
    for (const [copies, total, columns] of [
      [1, 1000, 8],
      [9, 10000, 8],
    ]) {
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(Array(copies).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
      await page.keyboard.press("Escape")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.waitForFunction(
        (batch) => document.querySelector(".composition-output .grid-view")?.dataset.batch === String(batch),
        columns * 7,
      )
      assert.equal(await output.locator(".composition-totals strong").textContent(), `${total} PDF pages`)
      assert.equal(await output.locator(".grid-view").getAttribute("data-columns"), String(columns))
      await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
      await output.getByRole("button", { name: `Select Output page ${total}`, exact: true }).waitFor()
      for (const family of ["DejaVu Sans", "Liberation Sans"]) {
        await output.evaluate((pane, value) => (pane.style.fontFamily = value), family)
        const spacing = await output.locator(".composition-card").evaluateAll((cards) =>
          cards.map((card) => {
            const number = card.querySelector(".card-number strong").getBoundingClientRect()
            const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
            const bounds = card.getBoundingClientRect()
            return {
              numberGap: grip.left - number.right,
              foldGap: bounds.right - 15 - grip.right,
              offset: grip.left + grip.width / 2 - bounds.left - bounds.width / 2,
              font: parseFloat(getComputedStyle(card.querySelector(".card-number")).fontSize),
            }
          }),
        )
        assert.ok(
          spacing.every(({ numberGap, foldGap, offset }) => numberGap >= 2 && foldGap >= 2 && Math.abs(offset) < 1),
          `${family}: ${total} pages keep numbers, grips, and folds apart`,
        )
        const last = spacing.at(-1)
        assert.ok(last.font < (total === 10000 ? 9 : 10.8), "Long page numbers shrink to fit")
      }
      await output.evaluate((pane) => pane.style.removeProperty("font-family"))
    }
    await page.setViewportSize({ width: 390, height: 900 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%"
      document.documentElement.dataset.theme = "dark"
    })
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Output", exact: true })
      .click()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    await server.close()
  }
})
