// Checks Grid density, pagination, and viewport capacity; alignment.test.js owns theme and selection combinations.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium, webkit } from "playwright"
import { fixture, captureLayout, tab, checkStatus, checkPagination } from "./browser.js"
import { measure } from "./measure.js"
import inventory from "./viewports.json" with { type: "json" }
import { bounds as gridBounds, quality } from "./quality.ts"

test("Normal card targets stay separate through phone pane and text transitions", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser, page, label
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    for (const width of [320, 390, 412, 440]) {
      await page.setViewportSize({ width, height: width === 440 ? 956 : 924 })
      for (const text of ["100%", "200%"]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        for (const name of ["Input", "Output"]) {
          await page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
            .click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await pane.getByRole("button", { name: `Normal ${name} grid`, exact: true }).click()
          await measure(pane)
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          for (const selected of [false, true]) {
            await field.fill(selected ? "1" : "")
            label = `${width}px, ${text}, ${name}, selected=${selected}`
            const card = pane.locator(".composition-card").first()
            await card.scrollIntoViewIfNeeded()
            const targets = await card.evaluate((element) =>
              [
                ...element.querySelectorAll(
                  ":scope > .page-label summary, :scope > .page-label .page-grip, :scope > .input-footer button, :scope > .occurrence-actions button",
                ),
              ].map((button) => {
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
                target.right - target.left >= 44 && target.bottom - target.top >= 44,
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
              assert.equal(await card.locator(".page-origin[open]").count(), 1, label)
              assert.equal(await field.inputValue(), selected ? "1" : "", label)
              await page.touchscreen.tap(point.x, point.y)
            }
            const grip = targets[1]
            await page.touchscreen.tap((grip.left + grip.right) / 2, (grip.top + grip.bottom) / 2)
            assert.equal(await field.inputValue(), selected ? "" : "1", label)
          }
          await checkPagination(pane, label)
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

const dimensions = (sample) =>
  ["input", "output"].flatMap((pane) =>
    ["normal", "compact"].map((density) => {
      const grid = sample.layout[pane][density]
      return [grid.capacity, grid.card.width, grid.card.height, grid.image.height, grid.gaps]
    }),
  )

test("Normal card targets route footer and grip taps across consecutive rows", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser, page, label, targets
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    for (const width of [440, 768, 772, 774, 778, 780]) {
      for (const text of ["100%", "200%"]) {
        await page.setViewportSize({ width, height: text === "100%" ? (width === 440 ? 956 : 1100) : 2200 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        await page.emulateMedia({ colorScheme: text === "100%" ? "light" : "dark" })
        for (const name of ["Input", "Output"]) {
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await pane.getByRole("button", { name: `Normal ${name} grid`, exact: true }).click()
          const field = pane.getByRole("textbox", { name: "Page selection", exact: true })
          await field.fill("")
          await pane.getByRole("slider").press("Home")
          const grid = await measure(pane)
          assert.ok(grid.matrix[1] >= 2, `${width}px, ${text}, ${name}: two complete rows`)
          const lower = grid.matrix[0] + 1
          for (const selected of [false, true]) {
            const selection = selected ? `1,${lower}` : ""
            const actions = selected ? [] : name === "Input" ? ["Add"] : ["Remove", "Duplicate"]
            for (const action of [...actions, "Select or drag"]) {
              label = `${width}px, ${text}, ${name}, selected=${selected}, ${action}`
              await field.fill(selection)
              await measure(pane)
              await pane
                .locator(".composition-card")
                .nth(lower - 1)
                .scrollIntoViewIfNeeded()
              targets = await pane.evaluate((element, column) => {
                const cards = element.querySelectorAll(".composition-card")
                return [
                  ...cards[0].querySelectorAll(":scope > .input-footer button, :scope > .occurrence-actions button"),
                  cards[column].querySelector(".page-grip"),
                ].map((button) => {
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
                assert.ok(target.right - target.left >= 44 && target.bottom - target.top >= 44, label)
                assert.ok(
                  target.points.every(({ hits }) => hits),
                  `${label}: ${JSON.stringify(target)}`,
                )
                if (target !== targets.at(-1)) assert.ok(target.bottom <= targets.at(-1).top, label)
              }
              const target = targets.find((entry) => entry.label.startsWith(action))
              assert.ok(target, label)
              const before = parseInt(await page.locator(".composition-totals strong").textContent())
              await page.touchscreen.tap(target.points[1].x, target.points[1].y)
              if (action === "Select or drag") {
                assert.equal(await field.inputValue(), selected ? "1" : String(lower), label)
                assert.equal(parseInt(await page.locator(".composition-totals strong").textContent()), before, label)
              } else {
                const expected = before + (action === "Remove" ? -1 : 1)
                await page.waitForFunction(
                  (count) => document.querySelector(".composition-totals strong")?.textContent === `${count} pages`,
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

const capture = (page) =>
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

const standard = process.env.MAINZ_TEST_MODE === "standard"

test("Workspace scrolling keeps Grid and Page controls clear of status", { timeout: 120000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 62 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "62 pages")
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
          if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          await tab(pane, "Grid")
          await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill("56-62")
          for (const density of ["Normal", "Compact"]) {
            await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
            const grid = await measure(pane)
            assert.ok(grid.caption.bottom <= grid.status + 1, `${name} ${density}: status clears pagination`)
            await checkStatus(page)
            const slider = pane.getByRole("slider")
            await slider.focus()
            await slider.press("End")
            assert.equal(await slider.inputValue(), await slider.getAttribute("max"))
          }
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

test("Grid keeps feasible matrices across nearby desktop calibration boundaries", { timeout: 420000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "80 pages")
    let initial
    for (const [width, height, minimumNormal, minimumCompact] of [
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2560 + delta, 1440, 16, 64]),
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2560, 1420 + delta, delta < 0 ? 12 : 16, 56]),
      ...[-3, -2, -1, 0, 1, 2, 3].map((delta) => [2200 + delta, 1298, 9, 36]),
    ]) {
      await page.setViewportSize({ width, height })
      const colorScheme = "light"

      await page.emulateMedia({ colorScheme })
      const label = `${width}×${height}, ${colorScheme}`
      await t.test(label, async () => {
        const sample = await capture(page)
        initial ??= dimensions(sample)
        assert.deepEqual(quality(sample), [], label)
        for (const pane of ["input", "output"]) {
          assert.ok(
            sample.layout[pane].normal.capacity[2] >= minimumNormal,
            `${pane}, ${label}: Normal retains its feasible matrix (${sample.layout[pane].normal.capacity})`,
          )
          assert.ok(
            sample.layout[pane].compact.capacity[2] >= minimumCompact,
            `${pane}, ${label}: Compact retains its feasible matrix (${sample.layout[pane].compact.capacity})`,
          )
        }
      })
    }
    await page.setViewportSize({ width: 2557, height: 1440 })
    await page.emulateMedia({ colorScheme: "light" })
    assert.deepEqual(
      dimensions(await capture(page)),
      initial,
      "Equal geometry does not depend on resize or density history",
    )
  } finally {
    await browser?.close()
  }
})

test("Grid retains feasible matrices across fractional desktop pane widths", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 80 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "80 pages")
    for (const width of [1461.75, 1462, 1462.25]) {
      await page.locator("main").evaluate((element, size) => (element.style.inlineSize = `${size}px`), width)
      const colorScheme = "light"

      await page.emulateMedia({ colorScheme })
      const sample = await capture(page)
      assert.deepEqual(quality(sample), [], `${width}px, ${colorScheme}`)
      for (const pane of ["input", "output"]) {
        assert.deepEqual(sample.layout[pane].normal.capacity, [4, 4, 16])
        assert.deepEqual(sample.layout[pane].compact.capacity, [8, 8, 64])
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Touch portrait Normal Grid fits readable cards across nearby phone dimensions", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({
        viewport: { width: 440, height: 956 },
        hasTouch: true,
        isMobile: true,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click()
      const output = page.locator(".composition-output")
      await output.getByLabel("Page selection", { exact: true }).fill("19-32")
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
          const rows = width >= 426 ? 2 : 1
          assert.deepEqual(normal.matrix, [2, rows, 2 * rows], `${engine.name()}, ${width}×${height}, ${colorScheme}`)
          await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
          const compact = await checkGrid(output, `${width}×${height}, ${colorScheme}, Compact`)
          assert.ok(Math.abs(compact.gaps[1] - 0.8 * compact.gaps[0]) < 1)
          checkDensityRatio(normal.image.height, compact.image.height, `${width}×${height}`)
          assert.ok(Math.abs(normal.frame.height - compact.frame.height) < 1)
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test("Phone Compact gaps keep the narrow-screen allowance below tablet widths", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 440, height: 956 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
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
  }
})

test("Measured touch frames retain complete readable matrices", { timeout: 120000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 360, height: 672 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
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
  }
})

test("Measured touch calibrations isolate viewport bounds and primary input", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser
  const bands = [
    { width: [1000, 1080], height: [450, 650], normal: [136, 232, 10] },
    { width: [860, 900], height: [1280, 1320], normal: [136, 219.109375, 10.5] },
    { width: [1380, 1450], height: [740, 800], compact: [74, 110, 6] },
  ]
  try {
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
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "60 pages")
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
          const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
          assert.equal(sample.environment.pointer, mode === "touch" ? "coarse" : "fine")
          if (mode === "hybrid") assert.equal(sample.environment.media["(any-pointer: coarse)"], true)
          for (const density of ["normal", "compact"]) {
            if (!band[density]) continue
            const [cardWidth, cardHeight, padding] = active
              ? band[density]
              : density === "normal"
                ? mode === "touch" && height > width
                  ? [136, 228.25, 8]
                  : [148, 240, 14]
                : mode !== "touch" && left === 1380
                  ? [null, 121, 6.4]
                  : [null, 125, 7.5]
            for (const pane of ["input", "output"]) {
              const grid = sample.layout[pane][density],
                label = `${mode}, ${width}×${height}, ${pane} ${density}`
              // Desktop fitting changes rendered cards; input isolation concerns the preferred calibration.
              const actual =
                mode === "touch"
                  ? [grid.card.width, grid.card.height, grid.margins[0]]
                  : ["--grid-width", "--grid-height", "--thumbnail-padding"].map((name) => {
                      const value = grid.variables[name]
                      return parseFloat(value) * (value.endsWith("rem") ? 16 : 1)
                    })
              if (cardWidth !== null) assert.ok(Math.abs(actual[0] - cardWidth) < 1, `${label}: card width`)
              assert.ok(Math.abs(actual[1] - cardHeight) < 1, `${label}: card height`)
              assert.ok(Math.abs(actual[2] - padding) < 1, `${label}: image padding`)
            }
          }
        }
      }
      await browser.close()
      browser = undefined
    }
  } finally {
    await browser?.close()
  }
})

test("Touch portrait pagination uses available height above the safe area", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
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
  const gapRatio = await pane.evaluate((element) =>
    element.dataset.density === "compact" &&
    matchMedia("(hover: none) and (pointer: coarse) and (orientation: portrait) and (width < 600px)").matches
      ? 0.8
      : 0.85,
  )
  assert.deepEqual(gridBounds(geometry, await pane.getAttribute("data-density"), gapRatio), [], label)
  return geometry
}

test("Touch Grid uses complete rows within the available viewport", { timeout: 150000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    const colorScheme = "light"
    await page.emulateMedia({ colorScheme })
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    for (const {
      viewport: [width, height],
      matrices: { normal, compact },
    } of inventory.cases.filter((item) => item.pointer === "coarse")) {
      await page.setViewportSize({ width, height })
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
  }
})

test("Desktop Grid retains measured capacity within readable bounds", { timeout: 600000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    const colorScheme = "light"
    await page.emulateMedia({ colorScheme })
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "240 pages")
    for (const {
      viewport: [width, height],
      matrices: { normal, compact },
    } of inventory.cases.filter((item) => item.pointer === "fine" && item.matrices)) {
      await page.setViewportSize({ width, height })
      const sample = await capture(page)
      const label = `${width}×${height}, ${colorScheme}`
      assert.deepEqual(quality(sample), [], label)
      for (const name of ["input", "output"])
        for (const [density, reference] of [
          ["normal", normal],
          ["compact", compact],
        ]) {
          const grid = sample.layout[name][density]
          assert.ok(
            grid.matrix.slice(0, 2).every((count, axis) => count >= reference[axis]),
            `${name} ${density}, ${label}: retains at least ${reference[0]}×${reference[1]} complete cards; actual ${grid.matrix}`,
          )
          if (width === 1920 && height === 961)
            assert.ok(
              Math.abs(grid.margins[0] - (density === "normal" ? 14 : 6.4)) < 0.1,
              `${name} ${density}, ${label}: scaling preserves image padding`,
            )
        }
    }
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "desktop").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
  }
})

test("Grid fitting respects viewport bounds and input capabilities", { timeout: 900000 }, async (t) => {
  const server = await serve()
  let browser
  try {
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
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 60 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "60 pages")
      const cases =
        mode === "mouse"
          ? [
              [1280, 699],
              [1280, 700],
              [1800, 949],
              [1800, 950],
              [1920, 961],
              [1999, 999],
              [1799, 961],
              [2000, 961],
              [1920, 1000],
              [1920, 1199],
              [1920, 1200],
              [1279, 982],
              [2140, 982],
              [2200, 1099],
              [2200, 1100],
              [2240, 1260],
              [2399, 1349],
              [2199, 1260],
              [2400, 1260],
              [2240, 1350],
              [2559, 1419],
              [2240, 1420],
              [2960, 1499],
              [2960, 1500],
              [3008, 1692],
              [3199, 1749],
              [2959, 1692],
              [3200, 1692],
              [3008, 1750],
              [3840, 1899],
              [3840, 1900],
              [3840, 1922],
              [3840, 2049],
              [3840, 2050],
              [3840, 2160],
              [4159, 2249],
              [3840, 2250],
              [3839, 1922],
              [4160, 1922],
              [2560, 1279],
              [2560, 1280],
              [2560, 1314],
              [2560, 1315],
              [2560, 1318],
              [2560, 1323],
              [2879, 1349],
              [2560, 1350],
              [2560, 1419],
              [2879, 1419],
              [2560, 1420],
              [2560, 1440],
              [2879, 1420],
              [2560, 1799],
              [2560, 1800],
              [2559, 1310],
              [2880, 1310],
              [1080, 810],
              [810, 1080],
              [1024, 1334],
              [1366, 1024],
              [1365, 865],
              [1537, 1001],
            ]
          : mode === "hybrid"
            ? [
                [1920, 961],
                [3840, 1922],
                [2560, 1310],
                [2560, 1318],
                [1080, 810],
                [810, 1080],
                [1024, 1334],
                [1366, 1024],
                [2222, 1111],
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
      // The desktop reference sweep already checks both panes at these exact mouse viewports.
      for (const [width, height, calibration] of cases.filter(
        ([w, h]) =>
          mode !== "mouse" ||
          !inventory.cases.some((item) => item.pointer === "fine" && item.viewport[0] === w && item.viewport[1] === h),
      )) {
        await t.test(`${mode}, ${width}×${height}`, async () => {
          await page.setViewportSize({ width, height })
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
                  phone: [136, 142, 232, 10],
                  portrait: [142, 142, 231, 9.5],
                  large: [142, 142, 231, 9.5],
                  "large-tall": [142, 142, 231, 9.5],
                  small: [137, 137, 226, 9],
                  landscape: [136, 136, 234, 11],
                  "large-landscape": [152, 152, 236, 12],
                }[calibration] ?? (touchPortrait ? [136, 136, 228.25, 8] : [148, 148, 240, 14])
              const compact = {
                landscape: [74.57, 116.5, 116.5],
                wide: [79, 119, 119],
                "large-tall": [81, 114, 115],
                "large-landscape": [83, 120.625, 120.625],
                tall: [77.7, 109.5, 111],
              }[calibration] ?? [74, ...(touchPortrait ? [109.5, 111] : [125, 125])]
              if (density === "Normal") {
                assert.ok(geometry.card.width >= normal[0] - 0.02 && geometry.card.width <= normal[1] + 0.02, label)
                assert.ok(Math.abs(geometry.card.height - normal[2]) < 0.02, `${label}: Touch height stays scoped`)
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
  }
})

test("Partial Grid batches retain full-matrix card positions and dimensions", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser
  try {
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
    ].filter(([viewportWidth]) => !standard || [1537, 392].includes(viewportWidth))) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 239 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "239 pages",
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
  }
})

test("Grid density switches paint complete batches without intermediate overflow", { timeout: 90000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  let page, label
  try {
    for (const touch of [false, true]) {
      page = await browser.newPage({ hasTouch: touch, isMobile: touch })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 128 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      for (const viewportWidth of touch ? [320, 390, 768] : [1440, 1920]) {
        await page.setViewportSize({ width: viewportWidth, height: 1080 })
        for (const enlarged of [false, true]) {
          await page.emulateMedia({
            colorScheme: enlarged ? "dark" : "light",
            reducedMotion: enlarged ? "reduce" : "no-preference",
          })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), enlarged ? "200%" : "100%")
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs")
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
            await pane.getByRole("button", { name: `Normal ${name} grid`, exact: true }).click()
            await measure(pane)
            await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill(enlarged ? "1" : "")
            for (const [turn, density] of ["Compact", "Normal", "Compact", "Normal"].entries()) {
              label = `${viewportWidth}px, ${enlarged ? "200%, dark, reduced motion" : "100%, light"}, ${name}, ${density}`
              const control = pane.getByRole("button", { name: `${density} ${name} grid`, exact: true })
              await control.focus()
              const painted = await pane.evaluate(async (element, accessibleName) => {
                const button = element.querySelector(`button[aria-label="${accessibleName}"]`)
                button.click()
                const frames = []
                let spinners = 0
                for (let frame = 0; frame < 6; frame++) {
                  await new Promise(requestAnimationFrame)
                  spinners = Math.max(spinners, element.querySelectorAll(".render-status").length)
                  const grid = element.querySelector(".composition-grid").getBoundingClientRect()
                  const cards = [...element.querySelectorAll(".composition-card")].map((card) => {
                    const { x, y, width, height, bottom } = card.getBoundingClientRect()
                    return { x, y, width, height, bottom }
                  })
                  frames.push({
                    cards,
                    bottom: grid.bottom,
                    pageHeight: document.documentElement.scrollHeight,
                    scroll: scrollY,
                    focused: document.activeElement === button,
                  })
                }
                return { frames, spinners }
              }, `${density} ${name} grid`)
              for (const frame of painted.frames) {
                assert.ok(
                  frame.cards.every((card) => card.bottom <= frame.bottom + 1),
                  `${label}: complete rows`,
                )
                assert.deepEqual(frame, painted.frames.at(-1), `${label}: final geometry from the first frame`)
                assert.ok(frame.focused, `${label}: density control retains focus`)
              }
              if (turn >= 2) assert.equal(painted.spinners, 0, `${label}: cached pages never show loading placeholders`)
              await page.waitForFunction(() => !document.querySelector('.thumbnail[aria-busy="true"]'))
            }
          }
        }
      }
      await page.close()
    }
  } catch (error) {
    if (page && !page.isClosed()) await captureLayout(page, "density", { label, error: error.message })
    throw error
  } finally {
    await browser.close()
  }
})

test("Grid initializes density from the completed preparation", { timeout: 30000 }, async () => {
  const server = await serve()
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      for (const [count, density] of [
        [4, "normal"],
        [8, "normal"],
        [9, "compact"],
      ]) {
        const page = await browser.newPage({
          viewport: { width: 440, height: 956 },
          hasTouch: true,
          isMobile: true,
          deviceScaleFactor: 3,
          reducedMotion: "reduce",
        })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.route("**/demo.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture({ count }) }),
        )
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.waitForFunction(
          (expected) =>
            document.querySelector('.selection-panel input[aria-label="Page selection"]')?.value === `1-${expected}`,
          count,
        )
        const input = page.locator(".selection-panel")
        await measure(input)
        assert.equal(await input.getAttribute("data-density"), density, `${engine.name()}, ${count} pages`)
        if (density === "normal") assert.equal((await measure(input)).capacity[2], 4)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Grid density retains inspection and compact page commands", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
    await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).click()
    await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).waitFor()
    assert.equal(await output.locator(".composition-card").count(), 24, "Each pane retains its own density")
    await page.setViewportSize({ width: 2560, height: 1440 })
    await measure(input)
    await page.setViewportSize({ width: 1920, height: 1080 })
    await measure(input)
    assert.equal(await input.getByRole("button", { name: "Select Input page 12", exact: true }).isVisible(), true)
    const slider = input.getByRole("slider")
    await slider.press("Home")
    for (let step = 0; step < 3; step++) await slider.press("ArrowRight")
    assert.equal((await input.locator(".batch-caption").innerText()).replace(/\s+/g, ""), "4/40·19–24/240")
    await tab(input, "Page")
    assert.equal(await input.getByRole("group", { name: "Input grid density", exact: true }).isVisible(), false)
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      await output.getByRole("button", { name: "Normal Output grid", exact: true }).click()
      const normalNumber = output.locator(".composition-card .page-origin > summary").first()
      await normalNumber.hover()
      const hoverColor = await normalNumber.evaluate((element) => getComputedStyle(element).color)
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      const number = output.locator(".composition-card .card-number").first()
      await number.hover()
      assert.deepEqual(
        await number.evaluate((element) => {
          const style = getComputedStyle(element)
          return [style.color, style.backgroundColor, style.boxShadow]
        }),
        [hoverColor, "rgba(0, 0, 0, 0)", "none"],
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
          "The heading separator stays inside the selected card's border",
        )
        await first.locator(".page-image").click()
      }
      const opener = output.getByRole("button", { name: "Details for Output page 1", exact: true })
      await opener.focus()
      await opener.press("Enter")
      const menu = page.locator(".card-menu-options:popover-open")
      await menu.waitFor()
      await page.keyboard.press("Escape")
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true)
      await opener.click()
      await menu.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "241 pages",
      )
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await opener.click()
      await menu.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 pages",
      )
    }
  } finally {
    await browser.close()
  }
})

test("Grid pagination bounds its marks and retains exact page navigation", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
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
        buffer: fixture({ prepared: false }),
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
  }
})

test("Compact pagination retains readable four- and five-digit numbers", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({
        viewport: { width: 1920, height: 1080 },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
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
          buffer: fixture({ prepared: false }),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      for (const [copies, total] of [
        [1, 1000],
        [9, 10000],
      ]) {
        await input
          .getByRole("textbox", { name: "Page selection", exact: true })
          .fill(Array(copies).fill("1").join(","))
        await input.getByLabel("Input page actions", { exact: true }).click()
        await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
        await page.keyboard.press("Escape")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await measure(output)
        assert.equal(await output.locator(".composition-totals strong").textContent(), `${total} pages`)
        assert.ok(
          Number(await output.locator(".grid-view").getAttribute("data-columns")) < 8,
          "Long numbers reserve wider cells",
        )
        await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
        await output.getByRole("button", { name: `Select Output page ${total}`, exact: true }).waitFor()
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
          if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
          await measure(output)
          await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            for (const family of ["DejaVu Sans", "Liberation Sans"]) {
              await output.evaluate((pane, value) => (pane.style.fontFamily = value), family)
              for (const number of [total - 1, total])
                await output.getByRole("button", { name: `Select Output page ${number}`, exact: true }).waitFor()
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
                spacing.every(
                  ({ numberGap, foldGap, offset }) => numberGap >= 2 && foldGap >= 2 && Math.abs(offset) < 1,
                ),
                `${family}: ${total} pages keep numbers, grips, and folds apart`,
              )
              const focusClearance = await output
                .getByRole("slider", { name: "Output thumbnail range", exact: true })
                .evaluate((slider) => {
                  const style = getComputedStyle(slider)
                  const outlineBottom =
                    slider.getBoundingClientRect().bottom +
                    parseFloat(style.outlineOffset) +
                    parseFloat(style.outlineWidth)
                  return (
                    slider.closest(".page-batches").querySelector(".batch-caption").getBoundingClientRect().top -
                    outlineBottom
                  )
                })
              assert.ok(focusClearance >= -0.5, "Keyboard pagination focus stays clear of its caption")
              const last = spacing.at(-1)
              assert.ok(
                last.font >= (text === "200%" ? 22 : 11),
                "Long page numbers retain the 0.6875rem readability floor",
              )
            }
          }
        }
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await measure(output)
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
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})
