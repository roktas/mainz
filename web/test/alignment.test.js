// Checks shared frames, centered grips, and Page thumbnails across distinct card calibrations.

import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { fixture, checkGrips, checkGridScroll, tab, gridPage, captureLayout } from "./browser.js"
import { measure } from "./measure.js"

test("View tabs align selected surfaces and visible icon edges with pane controls", { timeout: 180000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const touch of [false, true]) {
        const page = await browser.newPage({ hasTouch: touch, isMobile: touch, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo&paint`)
        await page.locator(".composer[aria-busy=false]").waitFor()
        for (const width of [320, 375, 744, 940, 1440, 3840]) {
          await page.setViewportSize({ width, height: 1100 })
          for (const scale of [100, 200]) {
            await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), scale)
            await page.emulateMedia({ colorScheme: scale === 100 ? "dark" : "light" })
            for (const name of ["Input", "Output"]) {
              const switcher = page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true })
              if (await switcher.isVisible()) await switcher.click()
              const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
              let reference
              for (const view of name === "Input" ? ["Grid", "List", "Page", "Style"] : ["Grid", "List", "Page"]) {
                await tab(pane, view)
                const geometry = await pane.evaluate((section) => {
                  const toolbar = section.querySelector(".editing-toolbar")
                  const current = toolbar.querySelector('[role="tab"][aria-selected="true"]')
                  const first = toolbar.querySelector(".tabs > button:first-child")
                  const field = section.querySelector(".sequence-entry > .entry, .profile-choice")
                  const ink = (node) => {
                    const path = node.querySelector("path"),
                      box = path.getBBox(),
                      matrix = path.getScreenCTM()
                    return {
                      left: new DOMPoint(box.x, box.y).matrixTransform(matrix).x,
                      right: new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix).x,
                    }
                  }
                  const button = current.getBoundingClientRect(),
                    bounds = field.getBoundingClientRect()
                  const style = getComputedStyle(current, "::before"),
                    surface = button.left + parseFloat(style.left)
                  const compact = !!section.closest(".composer[data-compact]")
                  const iconOnly = getComputedStyle(current.querySelector("span")).display === "none"
                  const last = toolbar.querySelector(".page-destination > button, .style-actions > button")
                  return {
                    width: parseFloat(style.width),
                    tint: style.backgroundColor,
                    radius: parseFloat(style.borderRadius),
                    gap: parseFloat(getComputedStyle(first.parentElement).columnGap),
                    compact,
                    iconOnly,
                    centered:
                      Math.abs((ink(current).left + ink(current).right) / 2 - surface - parseFloat(style.width) / 2) <
                      1,
                    first: ink(first).left - bounds.left,
                    end: last ? ink(last).right - bounds.right : 0,
                    buttons: [...toolbar.querySelectorAll(".tabs > button")].map(
                      (el) => el.getBoundingClientRect().width,
                    ),
                  }
                })
                const label = `${engine.name()}, ${touch ? "touch" : "mouse"}, ${width}, ${scale}%, ${name}, ${view}: ${JSON.stringify(geometry)}`
                reference ??= geometry.width
                assert.ok(Math.abs(reference - geometry.width) < 1, label)
                assert.ok(geometry.radius >= 6 && !["transparent", "rgba(0, 0, 0, 0)"].includes(geometry.tint), label)
                if (geometry.compact && geometry.iconOnly) assert.ok(geometry.centered, label)
                if (geometry.compact && !geometry.iconOnly) assert.ok(geometry.gap >= 6, label)
                assert.ok(Math.abs(geometry.first) < 1 && Math.abs(geometry.end) < 1, label)
                assert.ok(
                  geometry.buttons.every((value) => Math.abs(value - geometry.buttons[0]) < 1 && value >= 44),
                  label,
                )
                assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), label)
                if (width === 375 && scale === 100 && view === "Grid") {
                  await page.keyboard.press("Tab")
                  const selected = pane.getByRole("tab", { name: view, exact: true })
                  await selected.focus()
                  assert.ok(
                    await selected.evaluate((el) => {
                      const focus = getComputedStyle(el, "::before")
                      return (
                        el.matches(":focus-visible") &&
                        focus.outlineStyle === "solid" &&
                        parseFloat(focus.outlineWidth) >= 2
                      )
                    }),
                    label,
                  )
                }
              }
            }
          }
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Style scrolling preserves its companion Grid geometry and Page frame", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await tab(input, "Grid")
    for (let copy = 0; copy < 6; copy++) {
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1-4")
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
          await tab(input, "Grid")
          await tab(output, "Grid")
          const before = await measure(output)
          await tab(input, "Style")
          const after = await measure(output)
          const label = `${width}×${height}, ${text}, ${colorScheme}`
          assert.deepEqual(after.matrix, before.matrix, `${label}: Style preserves visible Grid geometry`)
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
          assert.deepEqual((await measure(output)).frame, before.frame, `${label}: Form scrolling leaves Output fixed`)
          assert.equal(await page.evaluate(() => scrollY), 0, `${label}: Only Style fields scroll`)
          const contentBottom = await output
            .locator(".page-content")
            .evaluate((element) => element.getBoundingClientRect().bottom)
          assert.ok(after.frame.bottom <= contentBottom + 1, `${label}: Grid fits inside the Output content frame`)
          assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "19-24")

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
  } catch (error) {
    if (page) await captureLayout(page, "style-companion")
    throw error
  } finally {
    await browser?.close()
  }
})

for (const hasTouch of [false, true])
  test(
    `Grid grips and Page thumbnail references stay aligned for ${hasTouch ? "touch" : "mouse"}`,
    { timeout: 600000 },
    async (t) => {
      const server = await serve()
      let browser, page, label
      try {
        browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
        page = await browser.newPage({ hasTouch, isMobile: hasTouch, reducedMotion: "reduce" })
        page.setDefaultTimeout(45000)
        // Grid scroll boundaries belong to grid.test.js; alignment checks representative columns.
        await page.route("**/grid.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture({ count: 32 }) }),
        )
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () =>
            document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
              ?.textContent === "32 pages",
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
              label = `${hasTouch ? "Touch" : "Mouse"} ${name}, ${width}×${height}, ${text} text`
              await checkGrips(pane, `${name}, ${width}×${height}, ${text} text`)
              if (await views.isVisible()) await checkGridScroll(pane, label)
              const grid = await pane.locator(".composition-grid").evaluate((element) => ({
                columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
                width: element.firstElementChild.getBoundingClientRect().width,
              }))
              await pane.getByRole("tab", { name: "Page", exact: true }).dispatchEvent("click")
              const reference = await pane.locator(".page-reference").evaluate((element) => ({
                columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
                width: element.firstElementChild.getBoundingClientRect().width,
              }))
              assert.equal(reference.columns, grid.columns, "Page retains Grid's column count")
              assert.ok(
                Math.abs(reference.width - grid.width) <= 1,
                `Page and Grid thumbnail widths differ: ${JSON.stringify({ reference, grid })}`,
              )
              await tab(pane, "Grid")
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            }
          }
          await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        }
        await page.close()
      } catch (error) {
        if (page) await captureLayout(page, "alignment", { label, error: error.message })
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
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
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
  let browser, page, label
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const hasTouch of [true, false]) {
      page = await browser.newPage({
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
          buffer: fixture({ prepared: false }),
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
        () =>
          document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
            ?.textContent === "10000 pages",
      )
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name: "Output", exact: true })
        .click()
      for (const [width, height] of hasTouch
        ? [
            [360, 672],
            [744, 1047],
          ]
        : [
            [1280, 700],
            [2560, 1440],
          ]) {
        await page.setViewportSize({ width, height })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          label = `${hasTouch ? "Touch" : "Mouse"} Output, ${width}×${height}, ${text}, five digits`
          await measure(output)
          await checkGrips(output, `${width}×${height}, ${text}, five digits`)
          const thumbnail = await gridPage(output, 10000)
          const gap = await thumbnail.evaluate((button) => {
            const card = button.closest(".composition-card")
            const number = card.querySelector(".page-origin > :is(summary,.card-number) strong").getBoundingClientRect()
            const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
            return grip.left - number.right
          })
          assert.ok(gap >= 2, `${width}×${height}, ${text}: five digits keep clear of the grip (${gap}px)`)
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        }
      }
      await page.close()
    }
  } catch (error) {
    if (page) await captureLayout(page, "alignment-five-digits", { label, error: error.message })
    error.message += `\nLayout: ${label}`
    throw error
  } finally {
    await browser?.close()
  }
})
