// Checks shared frames, centered grips, and Page thumbnails across distinct card calibrations.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { fixture, checkGrips, tab, captureLayout } from "./browser.js"
import { measure } from "./measure.js"

test("Style retains a Compact companion frame on short touch landscapes", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
    )
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const [width, height] of [
      [1006, 481],
      [1006, 544],
      [1200, 630],
      [1200, 694],
      [1280, 680],
      [1187, 622],
      [1187, 686],
    ]) {
      await page.setViewportSize({ width, height })
      await tab(input, "Grid")
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      await page.evaluate(() => scrollTo(0, 0))
      const before = await measure(output)
      await tab(input, "Style")
      await page.evaluate(() => scrollTo(0, 0))
      const after = await measure(output)
      assert.deepEqual(after.frame, before.frame, `${width}×${height}: Style retains the shared frame`)
      assert.deepEqual(after.capacity, before.capacity)
      assert.equal(after.horizontalOverflow, false)
    }
  } finally {
    await browser?.close()
  }
})

test("Style scrolling preserves its companion Grid capacity and Page frame", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await tab(input, "Grid")
    for (let copy = 0; copy < 3; copy++) {
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    }
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("19-24")
    for (const [width, height] of [
      [1920, 961],
      [2560, 1318],
      [3840, 2040],
    ]) {
      await page.setViewportSize({ width, height })
      for (const text of ["100%", "200%"]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        if (!(await input.isVisible()) || !(await output.isVisible())) continue
        for (const colorScheme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme })
          for (const density of ["Normal", "Compact"]) {
            await tab(input, "Grid")
            await tab(output, "Grid")
            await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
            const before = await measure(output)
            await tab(input, "Style")
            const after = await measure(output)
            const label = `${width}×${height}, ${text}, ${colorScheme}, ${density}`
            assert.deepEqual(after.capacity, before.capacity, `${label}: Style preserves complete row capacity`)
            assert.deepEqual(after.frame, before.frame, `${label}: Style preserves the Output frame`)
            const panel = input.locator(".control-list")
            const profile = input.locator(".style-profile").first()
            const profileBefore = await profile.boundingBox()
            assert.ok(profileBefore, `${label}: The profile selector stays visible`)
            await input.locator(".workspace-content").getByRole("button").last().focus()
            const scrolled = await panel.evaluate((element) => {
              const frame = element.getBoundingClientRect()
              const field = document.activeElement.getBoundingClientRect()
              const content = element.querySelector(".style-group").getBoundingClientRect()
              const tabs = element.closest(".selection-panel").querySelector(".source-tabs").getBoundingClientRect()
              const divider = document.querySelector(".composition-output").getBoundingClientRect().left
              return {
                overflow: element.scrollHeight - element.clientHeight,
                offset: element.scrollTop,
                visible: field.top >= frame.top && field.bottom <= frame.bottom,
                gap: frame.left + element.clientLeft + element.clientWidth - content.right,
                fits: element.scrollWidth <= element.clientWidth,
                outside:
                  frame.left + element.clientLeft + element.clientWidth >= tabs.right && frame.right <= divider - 8,
              }
            })
            assert.ok(scrolled.visible && (scrolled.overflow <= 1 || scrolled.offset > 0), label)
            assert.ok(
              scrolled.fits && scrolled.gap >= 8 && scrolled.outside,
              `${label}: Style fields clear their scrollbar in the pane gutter`,
            )
            assert.deepEqual(
              await profile.boundingBox(),
              profileBefore,
              `${label}: The profile stays fixed above the fields`,
            )
            const tabs = await input.locator(".source-tabs").boundingBox()
            const fields = await panel.boundingBox()
            assert.ok(
              Math.abs(profileBefore.x + profileBefore.width - tabs.x - tabs.width) < 1,
              `${label}: The profile retains the full pane width`,
            )
            assert.ok(
              fields.y >= profileBefore.y + profileBefore.height,
              `${label}: Scrolling starts below the profile separator`,
            )
            assert.deepEqual(
              (await measure(output)).frame,
              before.frame,
              `${label}: Form scrolling leaves Output fixed`,
            )
            assert.equal(await page.evaluate(() => scrollY), 0, `${label}: Only Style fields scroll`)
            assert.ok(
              (after.caption?.bottom ?? after.frame.bottom) <= after.status + 1,
              `${label}: Output clears the status bar`,
            )
            assert.equal(
              await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(),
              "19-24",
            )

            await tab(output, "Page")
            const styledPage = await output.locator(".page-view").boundingBox()
            await tab(input, "Grid")
            assert.deepEqual(
              await output.locator(".page-view").boundingBox(),
              styledPage,
              `${label}: Page shares the frame`,
            )
          }
        }
      }
    }
  } catch (error) {
    if (page) await captureLayout(page, "style-companion")
    throw error
  } finally {
    await browser?.close()
  }
})

async function checkPagination(pane) {
  const bounds = await pane.evaluate((element) => {
    const rect = (selector) => {
      const { left, right, top, bottom } = element.querySelector(selector).getBoundingClientRect()
      return { left, right, top, bottom }
    }
    return {
      grid: rect(".composition-grid"),
      pager: rect(".page-batches"),
      slider: rect('.page-batches input[type="range"]'),
      previous: rect(".page-batches > button:first-child"),
      next: rect(".page-batches > button:last-of-type"),
      previousIcon: rect(".page-batches > button:first-child svg"),
      nextIcon: rect(".page-batches > button:last-of-type svg"),
      caption: rect(".batch-caption"),
      viewport: document.documentElement.clientWidth,
    }
  })
  assert.ok(
    Math.abs((bounds.previousIcon.left + bounds.previousIcon.right) / 2 - bounds.grid.left) < 1,
    "Previous aligns with the content's left edge",
  )
  assert.ok(
    Math.abs((bounds.nextIcon.left + bounds.nextIcon.right) / 2 - bounds.grid.right) < 1,
    "Next aligns with the content's right edge",
  )
  for (const button of [bounds.previous, bounds.next]) {
    assert.ok(Math.abs(button.top - bounds.slider.top) < 1, "Arrows share the slider's row")
    assert.ok(button.right - button.left >= 40 && button.bottom - button.top >= 44, "Arrow targets stay usable")
    assert.ok(button.left >= 0 && button.right <= bounds.viewport, "Arrow targets stay inside the viewport")
  }
  for (const icon of [bounds.previousIcon, bounds.nextIcon])
    assert.ok(
      Math.abs((icon.top + icon.bottom - bounds.slider.top - bounds.slider.bottom) / 2) < 1,
      "Arrows stay on the slider's centerline",
    )
  assert.ok(
    bounds.previous.right <= bounds.slider.left && bounds.slider.right <= bounds.next.left,
    "Targets stay separate",
  )
  assert.ok(Math.abs(bounds.slider.top - bounds.pager.top) < 1, "The slider starts the pagination row")
  assert.ok(Math.abs(bounds.caption.top + 3 - bounds.slider.bottom) < 1, "The caption stays close below the slider")
  if (pane.page().viewportSize().width <= 480) {
    await pane.page().evaluate(() => scrollTo(0, document.documentElement.scrollHeight))
    const gap = await pane.evaluate(
      (element) =>
        document.querySelector(".footnote").getBoundingClientRect().top -
        element.querySelector(".page-batches").getBoundingClientRect().bottom,
    )
    assert.ok(gap >= -1, "Grid pagination stays clear of the status bar")
  }
}

for (const hasTouch of [false, true])
  test(
    `Grid grips and Page thumbnail references stay aligned for ${hasTouch ? "touch" : "mouse"}`,
    { timeout: 600000 },
    async (t) => {
      const server = await serve()
      let browser, label
      try {
        browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
        const page = await browser.newPage({ hasTouch, isMobile: hasTouch, reducedMotion: "reduce" })
        page.setDefaultTimeout(45000)
        // Capacity and calibration boundaries belong to grid.test.js; alignment needs only a few complete columns.
        await page.route("**/grid.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 32) }),
        )
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "32 PDF pages",
        )
        for (const [width, height] of hasTouch
          ? [
              [320, 568],
              [360, 672],
              [392, 764],
              [402, 900],
              [412, 924],
              [427, 952],
              [440, 956],
              [960, 1440],
              [390, 844],
              [667, 250],
              [744, 1047],
              [744, 1133],
              [768, 1024],
              [810, 1080],
              [820, 1080],
              [1024, 768],
              [1080, 810],
              [1180, 730],
              [1000, 1200],
              [1024, 1300],
              [1360, 980],
              [1133, 744],
              [750, 1144],
              [1006, 481],
              [876, 1280],
              [1400, 756],
            ]
          : [
              [390, 844],
              [810, 1080],
              [1440, 1100],
              [1920, 961],
              [2560, 1310],
              [2560, 1318],
              [2560, 1417],
              [2560, 1440],
              [2200, 1100],
              [2960, 1500],
              [3840, 1900],
              [3840, 2050],
            ]) {
          t.diagnostic(`${hasTouch ? "Touch" : "Mouse"} ${width}×${height}`)
          await page.setViewportSize({ width, height })
          for (const text of ["100%", "200%"]) {
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
            for (const name of ["Input", "Output"]) {
              const views = page.locator(".mobile-workspace-tabs")
              if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
              const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
              for (const density of ["Normal", "Compact"]) {
                label = `${hasTouch ? "Touch" : "Mouse"} ${name} ${density}, ${width}×${height}, ${text} text`
                await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).dispatchEvent("click")
                await checkGrips(pane, `${name} ${density}, ${width}×${height}, ${text} text`)
                if (await views.isVisible()) await checkPagination(pane)
                const grid = await pane.locator(".composition-grid").evaluate((element) => ({
                  columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
                  width: element.firstElementChild.getBoundingClientRect().width,
                }))
                await pane.getByRole("tab", { name: "Page", exact: true }).dispatchEvent("click")
                const reference = await pane.locator(".page-reference").evaluate((element) => ({
                  columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
                  width: element.firstElementChild.getBoundingClientRect().width,
                }))
                assert.deepEqual(reference, grid, "Page retains Grid's columns and thumbnail width")
                await pane.getByRole("tab", { name: "Grid", exact: true }).dispatchEvent("click")
                assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
              }
            }
          }
          await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        }
        await page.close()
      } catch (error) {
        error.message += `\nLayout: ${label}`
        throw error
      } finally {
        await browser?.close()
      }
    },
  )

test("App header uses available width before wrapping its actions", { timeout: 45000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const width of [785, 810, 820, 834, 900, 1024]) {
        await page.setViewportSize({ width, height: 1094 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const bounds = await page.locator(".header-inner").evaluate((header) => {
            const brand = header.querySelector(".brand").getBoundingClientRect()
            const actions = [...header.querySelector(".header-actions").children]
              .map((element) => element.getBoundingClientRect())
              .filter((rect) => rect.width && rect.height)
            return {
              brand: brand.right,
              actions: actions.map((rect) => ({ left: rect.left, y: rect.y + rect.height / 2 })),
              overflow: document.documentElement.scrollWidth > innerWidth,
            }
          })
          assert.equal(bounds.overflow, false)
          assert.ok(bounds.actions.every((rect) => rect.left > bounds.brand))
          assert.ok(
            bounds.actions.every((rect) => Math.abs(rect.y - bounds.actions[0].y) < 1),
            `${width}px, ${text}, ${colorScheme}: Header actions share one row`,
          )
        }
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Calibrations keep five-digit numbers clear of centered grips", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [true, false]) {
      const page = await browser.newPage({
        viewport: { width: 744, height: 1047 },
        hasTouch,
        isMobile: hasTouch,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Prepared pages with a very long descriptive input filename.pdf",
          mimeType: "application/pdf",
          buffer: fixture(false),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(Array(10).fill("1").join(","))
      await input.getByLabel("Input page actions", { exact: true }).click()
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
      await page.keyboard.press("Escape")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "10000 PDF pages",
      )
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      for (const [width, height] of hasTouch
        ? [
            [360, 672],
            [392, 764],
            [360, 800],
            [402, 900],
            [412, 924],
            [427, 952],
            [440, 956],
            [960, 1440],
            [750, 1144],
            [1006, 481],
            [876, 1280],
            [1400, 756],
            [667, 250],
            [740, 1047],
            [740, 1100],
            [805, 980],
            [820, 1080],
            [1080, 700],
            [1180, 730],
            [1000, 1200],
            [1024, 1300],
            [1360, 980],
          ]
        : [
            [1280, 700],
            [1920, 961],
            [2200, 1100],
            [2960, 1500],
            [2560, 1310],
            [2560, 1318],
            [2560, 1440],
            [2559, 1419],
            [2879, 1420],
            [2560, 1799],
            [3840, 1900],
            [3840, 2050],
          ]) {
        await page.setViewportSize({ width, height })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          for (const density of ["Normal", "Compact"]) {
            await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
            await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End")
            await output.getByRole("button", { name: "Select Output page 10000", exact: true }).waitFor()
            await checkGrips(output, `${width}×${height}, ${text}, ${density}, five digits`)
            const gap = await output
              .locator(".composition-card")
              .last()
              .evaluate((card) => {
                const number = card
                  .querySelector(".page-origin > :is(summary,.card-number) strong")
                  .getBoundingClientRect()
                const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
                return grip.left - number.right
              })
            assert.ok(
              gap >= 2,
              `${width}×${height}, ${text}, ${density}: five digits keep clear of the grip (${gap}px)`,
            )
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
          }
        }
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})
