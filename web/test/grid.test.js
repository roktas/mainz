// Checks Grid density, pagination, and viewport capacity; alignment.test.js owns theme and selection combinations.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer, fixture, captureLayout, tab, pagePosition } from "./browser.js"
import { measure } from "./measure.js"
import inventory from "./viewports.json" with { type: "json" }
import { quality } from "./quality.ts"

const dimensions = (sample) =>
  ["input", "output"].flatMap((pane) =>
    ["normal", "compact"].map((density) => {
      const grid = sample.layout[pane][density]
      return [grid.capacity, grid.card.width, grid.card.height, grid.image.height, grid.gaps]
    }),
  )

test("Grid keeps feasible matrices across nearby desktop calibration boundaries", { timeout: 420000 }, async (t) => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 80) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "80 PDF pages",
    )
    const capture = () =>
      page.evaluate(async () => {
        const probe = await import("/src/geometry.ts")
        let result
        for (const compact of [false, true]) {
          for (const pane of ["Input", "Output"])
            document.querySelector(`button[aria-label="${compact ? "Compact" : "Normal"} ${pane} grid"]`).click()
          const current = await probe.stable()
          result ??= { ...current, layout: { ...current.layout, input: {}, output: {} } }
          const density = compact ? "compact" : "normal"
          for (const pane of ["input", "output"]) result.layout[pane][density] = current.layout[pane][density]
        }
        return result
      })
    let initial
    for (const [width, height, minimumNormal, minimumCompact] of [
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2560 + delta, 1440, 16, 64]),
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2560, 1420 + delta, 16, 56]),
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2200 + delta, 1298, 12, 36]),
    ]) {
      await page.setViewportSize({ width, height })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        const label = `${width}×${height}, ${colorScheme}`
        await t.test(label, async () => {
          const sample = await capture()
          initial ??= dimensions(sample)
          assert.deepEqual(quality(sample), [], label)
          for (const pane of ["input", "output"]) {
            assert.ok(
              sample.layout[pane].normal.capacity[2] >= minimumNormal,
              `${label}: Normal retains its feasible matrix`,
            )
            assert.ok(
              sample.layout[pane].compact.capacity[2] >= minimumCompact,
              `${label}: Compact retains its feasible matrix`,
            )
          }
        })
      }
    }
    await page.setViewportSize({ width: 2557, height: 1440 })
    await page.emulateMedia({ colorScheme: "light" })
    assert.deepEqual(
      dimensions(await capture()),
      initial,
      "Equal geometry does not depend on resize or density history",
    )
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Grid retains feasible matrices across fractional desktop pane widths", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 80) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "80 PDF pages",
    )
    for (const width of [1461.75, 1462, 1462.25]) {
      await page.locator("main").evaluate((element, size) => (element.style.inlineSize = `${size}px`), width)
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
        assert.deepEqual(quality(sample), [], `${width}px, ${colorScheme}`)
        for (const pane of ["input", "output"]) {
          assert.deepEqual(sample.layout[pane].normal.capacity, [4, 4, 16])
          assert.deepEqual(sample.layout[pane].compact.capacity, [8, 8, 64])
        }
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Touch portrait Normal Grid fits readable cards across nearby phone dimensions", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 440, height: 956 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    )
    await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
    const output = page.locator(".composition-output")
    await output.getByLabel("Page selection", { exact: true }).fill("1-6")
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "12 PDF pages",
    )
    await output.getByLabel("Page selection", { exact: true }).fill("7-12")
    for (const [width, height] of [
      [412, 924],
      [411, 924],
      [413, 924],
      [427, 952],
      [426, 952],
      [428, 952],
      [440, 956],
      [439, 956],
      [441, 956],
      [440, 955],
      [440, 957],
    ]) {
      await page.setViewportSize({ width, height })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        await output.getByRole("button", { name: "Normal Output grid", exact: true }).click()
        const normal = await checkGrid(output, `${width}×${height}, ${colorScheme}, Normal`)
        assert.deepEqual(normal.matrix, [3, 2, 6])
        assert.ok(normal.image.height <= 141)
        await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
        const compact = await checkGrid(output, `${width}×${height}, ${colorScheme}, Compact`)
        assert.ok(Math.abs(compact.gaps[1] - 0.8 * compact.gaps[0]) < 1)
        checkDensityRatio(normal.image.height, compact.image.height, `${width}×${height}`)
        assert.ok(Math.abs(normal.frame.height - compact.frame.height) < 1)
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Phone Compact gaps keep the narrow-screen allowance below tablet widths", { timeout: 120000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 440, height: 956 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
    )
    for (const width of [440, 599, 600, 601, 744]) {
      await page.setViewportSize({ width, height: 1133 })
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      assert.deepEqual(quality(sample), [], `${width}px`)
      for (const pane of ["input", "output"]) {
        const compact = sample.layout[pane].compact
        assert.equal(compact.authored.rowFactor, width < 600 ? 0.8 : 0.9)
        if (width === 440) {
          assert.ok(compact.gaps[1] < 0.85 * compact.gaps[0])
          compact.gaps[1] = 0.75 * compact.gaps[0]
        }
      }
      if (width === 440) assert.ok(quality(sample).some((failure) => failure.rule === "balanced row and column gaps"))
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Measured touch frames retain complete readable matrices", { timeout: 120000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 360, height: 672 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    for (const [width, height, bottom, normal, compact] of [
      [360, 672, 24, [2, 1, 2], [3, 1, 3]],
      [392, 764, 24, [2, 1, 2], [4, 2, 8]],
      [750, 1080, 32, [4, 2, 8], [8, 4, 32]],
      [750, 1144, 0, [4, 2, 8], [8, 5, 40]],
      [1006, 481, 33, [3, 1, 3], [5, 1, 5]],
      [800, 1160, 32, [5, 2, 10], [9, 5, 45]],
      [876, 1280, 32, [5, 3, 15], [10, 6, 60]],
      [1400, 756, 32, [3, 1, 3], [6, 2, 12]],
    ]) {
      await page.setViewportSize({ width, height })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      // Replay Android's measured bottom budget without claiming native acquisition.
      await page
        .locator(".footnote")
        .evaluate((element, inset) => (element.style.paddingBlockEnd = `calc(var(--gap) + ${inset}px)`), bottom)
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
      assert.deepEqual(quality(sample), [], `${width}×${height}`)
      for (const pane of ["input", "output"]) {
        assert.deepEqual(sample.layout[pane].normal.matrix, normal, `${pane} Normal, ${width}×${height}`)
        assert.deepEqual(sample.layout[pane].compact.matrix, compact, `${pane} Compact, ${width}×${height}`)
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Measured touch calibrations isolate viewport bounds and primary input", { timeout: 180000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  const bands = [
    { width: [1000, 1080], height: [450, 650], normal: [134, 232, 10] },
    { width: [860, 900], height: [1280, 1320], normal: [134, 217, 10.5] },
    { width: [1380, 1450], height: [740, 800], compact: [74, 110, 6] },
  ]
  try {
    await server.listen()
    for (const mode of ["touch", "mouse", "hybrid"]) {
      browser = await chromium.launch({
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        args:
          mode === "hybrid"
            ? ["--blink-settings=primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=2"]
            : [],
      })
      const page = await browser.newPage({
        hasTouch: mode === "touch",
        isMobile: mode === "touch",
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 60) }),
      )
      for (const band of bands) {
        const [left, right] = band.width,
          [bottom, top] = band.height
        const middleWidth = Math.floor((left + right) / 2),
          middleHeight = Math.floor((bottom + top) / 2)
        const points =
          mode === "touch"
            ? [
                [left, middleHeight, true],
                [right - 1, middleHeight, true],
                [left - 1, middleHeight, false],
                [right, middleHeight, false],
                [middleWidth, bottom, true],
                [middleWidth, top - 1, true],
                [middleWidth, bottom - 1, false],
                [middleWidth, top, false],
              ]
            : [[middleWidth, middleHeight, false]]
        for (const [width, height, active] of points) {
          await page.setViewportSize({ width, height })
          await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
          await page.waitForFunction(
            () => document.querySelector(".composition-totals strong")?.textContent === "60 PDF pages",
          )
          const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
          assert.equal(sample.environment.pointer, mode === "touch" ? "coarse" : "fine")
          if (mode === "hybrid") assert.equal(sample.environment.media["(any-pointer: coarse)"], true)
          for (const density of ["normal", "compact"]) {
            if (!band[density]) continue
            const [cardWidth, cardHeight, padding] = active
              ? band[density]
              : density === "normal"
                ? mode === "touch" && height > width
                  ? [134, 226, 8]
                  : [148, 240, 14]
                : mode !== "touch" && left === 1380
                  ? [null, 121, 6.4]
                  : [null, 125, 7.5]
            for (const pane of ["input", "output"]) {
              const grid = sample.layout[pane][density],
                label = `${mode}, ${width}×${height}, ${pane} ${density}`
              if (cardWidth !== null) assert.ok(Math.abs(grid.card.width - cardWidth) < 1, `${label}: card width`)
              assert.ok(Math.abs(grid.card.height - cardHeight) < 1, `${label}: card height`)
              assert.ok(Math.abs(grid.margins[0] - padding) < 1, `${label}: image padding`)
            }
          }
        }
      }
      await browser.close()
      browser = undefined
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Touch portrait pagination uses available height above the safe area", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    // Match a standalone tablet's bottom inset without treating its screen as the usable viewport.
    await page.locator(".footnote").evaluate((element) => (element.style.paddingBlockEnd = "calc(var(--gap) + 20px)"))
    for (const [width, height] of [
      [810, 1048],
      [820, 1094],
      [834, 1080],
    ]) {
      await page.setViewportSize({ width, height })
      for (const name of ["Input", "Output"]) {
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        for (const density of ["Normal", "Compact"]) {
          await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
          const geometry = await measure(pane)
          assert.deepEqual(geometry.capacity.slice(0, 2), density === "Compact" ? [9, 4] : [5, 2])
          assert.ok(Math.abs(geometry.image.height - (density === "Compact" ? 69.5 : 144)) < 1)
          assert.ok(geometry.clearance >= 8 && geometry.scroll <= 1)
          const gap = geometry.status - geometry.caption.bottom
          assert.ok(gap >= 8 && gap <= 32, `${name}, ${width}, ${density}: caption clearance ${gap}`)
        }
      }
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

function checkDensityRatio(normal, compact, label) {
  const ratio = normal / compact
  assert.ok(
    Math.min(ratio, 2) / Math.max(ratio, 2) >= 0.85,
    `${label}: Normal to Compact image scale stays near 2 (${ratio.toFixed(2)})`,
  )
}

async function checkGrid(pane, label) {
  await pane
    .page()
    .evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
  await pane.page().evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
  const geometry = await measure(pane)
  const [upper, lower, left, right] = geometry.margins
  assert.equal(geometry.horizontalOverflow, false, `${label}: The workspace fits horizontally`)
  assert.ok(
    geometry.card.height + 1 >= Math.SQRT2 * geometry.card.width &&
      geometry.card.height <= (280 / 150) * geometry.card.width + 1,
    `${label}: Full card proportions stay within the accepted portrait references`,
  )
  const minimum = (await pane.getAttribute("data-density")) === "compact" ? 69.5 : 128
  assert.ok(geometry.image.height + 1 >= minimum, `${label}: The portrait image retains its readable reference size`)
  assert.ok(Math.abs(upper - lower) < 1 && Math.abs(left - right) < 1, `${label}: Images stay centered`)
  assert.ok(Math.min(...geometry.margins) >= 2, `${label}: Images keep clear margins`)
  assert.ok(left <= 2 * upper + 1, `${label}: Side margins stay balanced`)
  const gaps = [geometry.edges[0], ...geometry.gaps.filter((gap) => gap !== null)]
  assert.ok(Math.abs(geometry.edges[0] - geometry.edges[1]) < 1, `${label}: Outside column spaces match`)
  if (geometry.gaps[0] !== null)
    assert.ok(
      geometry.edges.every((edge) => Math.abs(edge - geometry.gaps[0]) < 1),
      `${label}: Columns and outside edges share the available width evenly`,
    )
  assert.ok(
    gaps.every((gap) => gap + 1 >= 0.85 * upper),
    `${label}: Card gaps respect the image margin`,
  )
  const gapRatio = await pane.evaluate((element) =>
    element.dataset.density === "compact" &&
    matchMedia("(hover: none) and (pointer: coarse) and (orientation: portrait) and (width < 600px)").matches
      ? 0.8
      : 0.85,
  )
  assert.ok(
    Math.min(...gaps) + 1 >= gapRatio * Math.max(...gaps),
    `${label}: Horizontal and vertical gaps stay approximately equal`,
  )
  assert.ok(geometry.slider.top - geometry.cardsBottom >= 7, `${label}: Pagination stays clear of complete card rows`)
  assert.ok(
    geometry.caption.top >= geometry.slider.top + geometry.slider.height / 2,
    `${label}: The caption stays below the slider`,
  )
  assert.ok(geometry.caption.bottom <= geometry.status + 1, `${label}: Pagination stays above the status bar`)
  return geometry
}

test("Touch Grid uses complete rows within the available viewport", { timeout: 150000 }, async () => {
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
    const colorScheme = "light"
    await page.emulateMedia({ colorScheme })
    for (const {
      viewport: [width, height],
      matrices: { normal, compact },
    } of inventory.cases.filter((item) => item.pointer === "coarse")) {
      await page.setViewportSize({ width, height })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      for (const name of ["Input", "Output"]) {
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        let normalFrame, normalImage
        for (const [density, reference] of [
          ["Normal", normal],
          ["Compact", compact],
        ]) {
          await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
          const label = `${name} ${density}, ${width}×${height}, ${colorScheme}`
          const geometry = await checkGrid(pane, label)
          if (density === "Normal") normalImage = geometry.image.height
          else checkDensityRatio(normalImage, geometry.image.height, label)
          assert.deepEqual(geometry.matrix, reference, `${label}: Complete rows match the viewport reference`)
          if (geometry.scroll > 1)
            assert.equal(geometry.matrix[1], 1, `${label}: Short viewports scroll only for the minimum complete row`)
          if (width === 810 && height === 1080) {
            assert.ok(geometry.scroll <= 1, `${label}: iPad portrait pagination needs no scrolling`)
            if (density === "Normal") normalFrame = geometry.frame
            else
              assert.ok(Math.abs(normalFrame.height - geometry.frame.height) < 1, `${label}: Densities share one frame`)
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

test("Grid matrices match desktop viewports and bounded calibrations", { timeout: 600000 }, async () => {
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
    const colorScheme = "light"
    await page.emulateMedia({ colorScheme })
    for (const {
      viewport: [width, height],
      matrices: { normal, compact },
    } of inventory.cases.filter((item) => item.pointer === "fine" && item.matrices)) {
      await page.setViewportSize({ width, height })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      for (const name of ["Input", "Output"]) {
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        let normalGrid
        for (const [density, reference] of [
          ["Normal", normal],
          ["Compact", compact],
        ]) {
          await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
          const label = `${name} ${density}, ${width}×${height}, ${colorScheme}`
          const geometry = await checkGrid(pane, label)
          if (density === "Normal") normalGrid = geometry
          else checkDensityRatio(normalGrid.image.height, geometry.image.height, label)
          assert.deepEqual(geometry.matrix, reference, `${label}: Complete rows match the viewport reference`)
          assert.ok(
            geometry.scroll <= 1 || geometry.matrix[1] === 1,
            `${label}: Pagination fits unless the minimum complete row requires scrolling`,
          )
          if (width === 1920 && height === 961) {
            assert.ok(geometry.clearance >= 14, `${label}: The measured FHD viewport retains spare row space`)
            assert.ok(
              Math.abs(geometry.margins[0] - (density === "Normal" ? 14 : 6.4)) < 0.1,
              `${label}: Scaling preserves the image padding`,
            )
          }
          if (density === "Compact" && normalGrid.scroll <= 1 && geometry.scroll <= 1)
            assert.ok(
              Math.abs(normalGrid.frame.height - geometry.frame.height) < 1,
              `${label}: Densities share one frame when neither minimum row requires scrolling`,
            )
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
})

test("Grid fitting respects viewport bounds and input capabilities", { timeout: 900000 }, async (t) => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    for (const mode of ["mouse", "hybrid", "touch"]) {
      browser = await chromium.launch({
        channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
        args:
          mode === "hybrid"
            ? ["--blink-settings=primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=2"]
            : [],
      })
      const page = await browser.newPage({
        hasTouch: mode === "touch",
        isMobile: mode === "touch",
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      // Complete columns and repeated gaps suffice here; the reference test checks full viewport capacity.
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 60) }),
      )
      const cases =
        mode === "mouse"
          ? [
              [1280, 699, "default"],
              [1280, 700, "desktop-compact"],
              [1800, 949, "desktop-compact"],
              [1800, 950, "fhd"],
              [1920, 961, "fhd"],
              [1999, 999, "fhd"],
              [1799, 961, "desktop-compact"],
              [2000, 961, "desktop-compact"],
              [1920, 1000, "desktop-compact"],
              [1920, 1199, "desktop-compact"],
              [1920, 1200, "default"],
              [1279, 982, "default"],
              [2140, 982, "default"],
              [2200, 1099, "default"],
              [2200, 1100, "desktop-medium"],
              [2240, 1260, "desktop-medium"],
              [2399, 1349, "desktop-medium"],
              [2199, 1260, "default"],
              [2400, 1260, "desktop-medium"],
              [2240, 1350, "desktop-medium"],
              [2559, 1419, "desktop-medium"],
              [2240, 1420, "default"],
              [2960, 1499, "default"],
              [2960, 1500, "desktop-large"],
              [3008, 1692, "desktop-large"],
              [3199, 1749, "desktop-large"],
              [2959, 1692, "default"],
              [3200, 1692, "default"],
              [3008, 1750, "default"],
              [3840, 1899, "default"],
              [3840, 1900, "uhd"],
              [3840, 1922, "uhd"],
              [3840, 2049, "uhd"],
              [3840, 2050, "uhd-tall"],
              [3840, 2160, "uhd-tall"],
              [4159, 2249, "uhd-tall"],
              [3840, 2250, "default"],
              [3839, 1922, "default"],
              [4160, 1922, "default"],
              [2560, 1279, "default"],
              [2560, 1280, "qhd"],
              [2560, 1314, "qhd"],
              [2560, 1315, "qhd-window"],
              [2560, 1318, "qhd-window"],
              [2560, 1323, "qhd-window"],
              [2879, 1349, "qhd-window"],
              [2560, 1350, "qhd-window"],
              [2560, 1419, "qhd-window"],
              [2879, 1419, "qhd-window"],
              [2560, 1420, "qhd-full"],
              [2560, 1440, "qhd-full"],
              [2879, 1420, "qhd-full"],
              [2560, 1799, "qhd-full"],
              [2560, 1800, "default"],
              [2559, 1310, "desktop-medium"],
              [2880, 1310, "default"],
              [1080, 810, "default"],
              [810, 1080, "default"],
              [1024, 1334, "default"],
              [1366, 1024, "desktop-compact"],
              [1365, 865, "desktop-compact"],
              [1537, 1001, "desktop-compact"],
            ]
          : mode === "hybrid"
            ? [
                [1920, 961, "fhd"],
                [3840, 1922, "uhd"],
                [2560, 1310, "qhd"],
                [2560, 1318, "qhd-window"],
                [1080, 810, "default"],
                [810, 1080, "default"],
                [1024, 1334, "default"],
                [1366, 1024, "desktop-compact"],
                [2222, 1111, "desktop-medium"],
              ]
            : [
                [1920, 961, "default"],
                [3840, 1922, "default"],
                [2560, 1310, "default"],
                [666, 375, "default"],
                [667, 250, "phone"],
                [812, 311, "phone"],
                [896, 414, "phone"],
                [900, 499, "phone"],
                [999, 499, "default"],
                [1000, 414, "default"],
                [812, 249, "default"],
                [812, 500, "default"],
                [1080, 810, "landscape"],
                [1079, 810, "default"],
                [1080, 700, "landscape"],
                [1080, 724, "landscape"],
                [1080, 699, "default"],
                [1133, 810, "default"],
                [1080, 900, "default"],
                [1180, 730, "wide"],
                [1194, 802, "wide"],
                [1219, 899, "wide"],
                [1179, 730, "default"],
                [1220, 730, "default"],
                [1180, 729, "default"],
                [1180, 900, "default"],
                [1000, 1200, "large"],
                [1024, 1280, "large"],
                [1000, 1300, "large"],
                [1023, 1334, "large"],
                [1024, 1299, "large"],
                [1024, 1300, "large-tall"],
                [1049, 1399, "large-tall"],
                [999, 1200, "default"],
                [1050, 1200, "default"],
                [1050, 1334, "default"],
                [1024, 1199, "default"],
                [1024, 1400, "default"],
                [1360, 980, "large-landscape"],
                [1366, 1024, "large-landscape"],
                [1379, 1059, "large-landscape"],
                [1359, 1024, "default"],
                [1380, 1024, "default"],
                [1366, 979, "default"],
                [1366, 1060, "default"],
                [810, 1080, "portrait"],
                [805, 980, "portrait"],
                [804, 980, "default"],
                [805, 979, "default"],
                [834, 1219, "portrait"],
                [835, 1080, "default"],
                [810, 1220, "default"],
                [820, 1080, "portrait"],
                [829, 1119, "portrait"],
                [805, 1048, "portrait"],
                [834, 1119, "portrait"],
                [819, 1094, "portrait"],
                [830, 1094, "portrait"],
                [820, 1079, "portrait"],
                [820, 1047, "portrait"],
                [820, 1120, "portrait"],
                [740, 1047, "small"],
                [744, 1047, "small"],
                [749, 1089, "small"],
                [739, 1047, "default"],
                [750, 1047, "default"],
                [744, 1046, "default"],
                [744, 1090, "default"],
                [740, 1100, "tall"],
                [744, 1133, "tall"],
                [749, 1159, "tall"],
                [739, 1100, "default"],
                [750, 1100, "default"],
                [744, 1099, "default"],
                [744, 1160, "default"],
                [527, 917, "default"],
                [917, 527, "default"],
              ]
      for (const [width, height, calibration] of cases) {
        await t.test(`${mode}, ${width}×${height}`, async () => {
          await page.setViewportSize({ width, height })
          await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
          await page.waitForFunction(
            () => document.querySelector(".composition-totals strong")?.textContent === "60 PDF pages",
          )
          if (mode === "hybrid")
            assert.deepEqual(
              await page.evaluate(() => [
                matchMedia("(pointer: fine)").matches,
                matchMedia("(any-pointer: coarse)").matches,
                matchMedia("(hover: hover)").matches,
              ]),
              [true, true, true],
            )
          const pane = page.locator(".selection-panel")
          const touchPortrait = mode === "touch" && height > width
          let normalFrame, normalImage
          for (const density of ["Normal", "Compact"]) {
            await pane.getByRole("button", { name: `${density} Input grid`, exact: true }).click()
            const label = `${mode}, ${width}×${height}, ${density}`
            const geometry = await checkGrid(pane, label)
            if (density === "Normal") {
              normalImage = geometry.image.height
              normalFrame = geometry.scroll <= 1 ? geometry.frame : undefined
            } else {
              checkDensityRatio(normalImage, geometry.image.height, label)
              if (normalFrame)
                assert.ok(
                  Math.abs(normalFrame.height - geometry.frame.height) < 1,
                  `${label}: Density does not change the available height`,
                )
            }
            if (mode === "touch") {
              const normal =
                {
                  phone: [134, 142, 232, 10],
                  portrait: [142, 142, 231, 9.5],
                  large: [142, 142, 231, 9.5],
                  "large-tall": [142, 142, 231, 9.5],
                  small: [137, 137, 226, 9],
                  landscape: [136, 136, 234, 11],
                  "large-landscape": [152, 152, 236, 12],
                }[calibration] ?? (touchPortrait ? [134, 134, 226, 8] : [148, 148, 240, 14])
              const compact = {
                landscape: [74.57, 116.5, 116.5],
                wide: [79, 119, 119],
                "large-tall": [81, 114, 115],
                "large-landscape": [83, 120.625, 120.625],
                tall: [77.7, 109.5, 111],
              }[calibration] ?? [74, ...(touchPortrait ? [109.5, 111] : [125, 125])]
              if (density === "Normal") {
                assert.ok(geometry.card.width >= normal[0] - 0.02 && geometry.card.width <= normal[1] + 0.02, label)
                assert.equal(geometry.card.height, normal[2], `${label}: Touch height stays scoped`)
                assert.ok(Math.abs(geometry.margins[0] - normal[3]) < 1, `${label}: Touch padding stays scoped`)
              } else {
                assert.ok(Math.abs(geometry.card.width - compact[0]) < 0.02, `${label}: Touch width stays scoped`)
                assert.ok(
                  geometry.card.height >= compact[1] && geometry.card.height <= compact[2],
                  `${label}: Touch height stays scoped`,
                )
              }
            }
            if (geometry.scroll > 1)
              assert.equal(geometry.matrix[1], 1, `${label}: Only a minimum row requires document scrolling`)
            if (width === 2560 && height === 1310)
              assert.deepEqual(
                geometry.matrix,
                density === "Normal" ? [4, 3, 12] : [8, 6, 48],
                `${label}: Shared rules approach the calibrated matrix`,
              )
          }
        })
      }
      if (mode === "mouse") {
        await page.setViewportSize({ width: 2560, height: 1310 })
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "60 PDF pages",
        )
        await page.locator("main").evaluate((element) => (element.style.inlineSize = "1462px"))
        const pane = page.locator(".selection-panel")
        for (const density of ["Normal", "Compact"]) {
          await pane.getByRole("button", { name: `${density} Input grid`, exact: true }).click()
          const geometry = await checkGrid(pane, `QHD narrow pane, ${density}`)
          assert.deepEqual(geometry.matrix, density === "Normal" ? [4, 3, 12] : [8, 6, 48])
        }
      }
      await browser.close()
      browser = undefined
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Partial Grid batches retain full-matrix card positions and dimensions", { timeout: 180000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, hasTouch] of [
      [1537, 1001, false],
      [3840, 1922, false],
      [360, 672, true],
      [392, 764, true],
      [750, 1144, true],
      [1006, 481, true],
      [876, 1280, true],
      [1400, 756, true],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 239) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "239 PDF pages",
      )
      for (const name of ["Input", "Output"]) {
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
        const slots = () =>
          pane.locator(".composition-card:not([inert])").evaluateAll((cards) =>
            cards.map((card) => {
              const bounds = card.getBoundingClientRect()
              return [bounds.x, bounds.y, bounds.width, bounds.height]
            }),
          )
        for (const density of ["Normal", "Compact"]) {
          const label = `${name} ${density}, ${width}×${height}`
          await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
          const range = pane.getByRole("slider", { name: `${name} thumbnail range`, exact: true })
          await range.press("Home")
          await pane.getByRole("button", { name: `Select ${name} page 1`, exact: true }).waitFor()
          const reference = await checkGrid(pane, label)
          const full = await slots()
          await range.press("End")
          await pane.getByRole("button", { name: `Select ${name} page 239`, exact: true }).waitFor()
          await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
          const partial = await slots()
          assert.equal(partial.length, 239 % reference.matrix[2], `${label}: The final batch is partial`)
          for (const [index, bounds] of partial.entries())
            assert.ok(
              bounds.every((value, axis) => Math.abs(value - full[index][axis]) < 1),
              `${label}: Sparse cards keep their full-matrix slot ${index}`,
            )
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})

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
      const capacity = width === 1920 ? 6 : 16
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      assert.equal(await input.locator(".composition-card").count(), capacity)
      assert.equal(await output.locator(".composition-card").count(), capacity)
      await measure(input)
      await measure(output)
      assert.equal(await page.locator("main").evaluate((element) => element.clientWidth), width === 1920 ? 1232 : 1472)
      assert.equal(await input.locator(".batch-marks > span").count(), width === 1920 ? 40 : 15)
      const imageHeight = await input
        .locator(".page-image canvas")
        .first()
        .evaluate((element) => element.clientHeight)
      assert.equal(imageHeight, width === 1920 ? 144 : 133, "Normal thumbnails retain their fitted image height")
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
            .evaluate((element) => element.getBoundingClientRect().width)) - (width === 1920 ? 142 : 144),
        ) < 1,
        "Landscape images fit the narrower Normal cards",
      )
      await page.keyboard.press("Home")
      await input.getByRole("button", { name: "Select Input page 1", exact: true }).waitFor()
    }
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).click()
    await page.setViewportSize({ width: 1920, height: 1080 })
    await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 6)
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).waitFor()
    assert.equal(
      await input.locator(".composition-card").count(),
      6,
      "Resizing retains the inspected page in the new group",
    )
    const slider = input.getByRole("slider", { name: "Input thumbnail range", exact: true })
    await slider.focus()
    await page.keyboard.press("Home")
    for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight")
    await input.getByRole("button", { name: "Select Input page 19", exact: true }).waitFor()
    assert.equal((await input.locator(".batch-caption").innerText()).replace(/\s+/g, ""), "4/40·19–24/240")
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
      await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 24)
      const density = input.getByRole("group", { name: "Input grid density", exact: true })
      await input.getByRole("button", { name: "Select Input page 12", exact: true }).click()
      await density.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "6",
      )
      assert.equal(await input.getByRole("button", { name: "Select Input page 12", exact: true }).isVisible(), true)
      assert.equal(
        await output.locator(".composition-card").count(),
        24,
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
        6,
        "Grid retains its density across Page inspection",
      )
      await density.getByRole("button", { name: "Compact Input grid", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "24",
      )
      await page.setViewportSize({ width: 2560, height: 1440 })
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "64",
      )
      assert.equal(await output.locator(".composition-card").count(), 64)
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
      assert.deepEqual([geometry.columns, geometry.rows], [8, 8])
      assert.deepEqual(geometry.card, [75, 112.5])
      assert.ok(
        Math.abs(geometry.rowEdges[0] - geometry.rowEdges[1]) < 1,
        "Compact columns share outside space equally",
      )
      assert.deepEqual(geometry.heading, [0, 75, 26], "The header fills the card width")
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
      assert.ok(geometry.image >= 69 && geometry.image <= 70)
      assert.ok(
        geometry.margins.every((margin) => margin >= 7.5 && margin <= 15),
        "Compact images retain balanced inner margins",
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
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "24",
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

test("Grid pagination bounds its marks and retains exact page navigation", { timeout: 60000 }, async () => {
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
      .setInputFiles({
        name: "A long input filename for pagination.pdf",
        mimeType: "application/pdf",
        buffer: fixture(false),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const [repeated, copies, total] of [
      [1, 1, 1],
      [1, 63, 64],
      [1, 936, 1000],
      [9, 1000, 10000],
    ]) {
      await input.getByLabel("Page selection", { exact: true }).fill(Array(repeated).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill(String(copies))
      await page.keyboard.press("Escape")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      for (const density of ["Normal", "Compact"]) {
        await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        const batch = Number(await output.locator(".grid-view").getAttribute("data-batch"))
        const batches = Math.ceil(total / batch)
        const slider = output.getByRole("slider", { name: "Output thumbnail range", exact: true })
        if (total === 1 && density === "Normal") continue
        assert.equal(await output.locator(".batch-marks > span").count(), Math.min(batches, 64))
        assert.equal(await slider.getAttribute("max"), String(batches - 1))
        if (batches > 1) {
          await slider.press("End")
          assert.equal(await slider.inputValue(), String(batches - 1))
          assert.equal(
            await slider.getAttribute("aria-valuetext"),
            `Grid page ${batches} of ${batches}, pages ${(batches - 1) * batch + 1}–${total} of ${total}`,
          )
          await output.getByRole("button", { name: `Select Output page ${total}`, exact: true }).waitFor()
          await slider.press("Home")
          assert.equal(await slider.inputValue(), "0")
        } else assert.equal(await slider.isDisabled(), true)
      }
    }
    for (const width of [320, 390, 768]) {
      await page.setViewportSize({ width, height: 1100 })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        for (const density of ["Normal", "Compact"]) {
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = name === "Input" ? input : output
            await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
            assert.ok((await pane.locator(".batch-marks > span").count()) <= 64)
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          }
        }
      }
    }
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
