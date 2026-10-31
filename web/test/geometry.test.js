// Checks Page frames, headings, and controls across viewports.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { tab, image, captureLayout, fixture } from "./browser.js"
import { measure } from "./measure.js"

test("Pane headers, tabs, and selections stay on single aligned rows", { timeout: 180000 }, async (t) => {
  const server = await serve()
  let browser, page
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true, isMobile: true })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      const Original = Worker
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (window.holdStyles && (message.changes || message.job)) {
            window.finishStyles = () => super.postMessage(message, ...rest)
            return
          }
          super.postMessage(message, ...rest)
        }
      }
    })
    await page.goto(server.resolvedUrls.local[0])
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Prepared pages with a very long descriptive input filename.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    await page.locator(".input-current").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const show = async (name) => {
      if (await page.locator(".mobile-workspace-tabs").isVisible())
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click()
    }
    const rows = async (pane) => {
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      const layout = await pane.evaluate((element) => {
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes the page callback.
        const rect = (node) => node.getBoundingClientRect().toJSON()
        const bands = [
          [".section-heading", ":scope > :not(.download-error)"],
          [".editing-toolbar", '[role="tab"], .grid-density > button, .style-status > button'],
          [".sequence-entry > .entry", "input, button, summary"],
        ]
        return bands.flatMap(([selector, controls]) => {
          const band = element.querySelector(selector)
          if (!band?.checkVisibility()) return []
          return [
            {
              selector,
              bounds: rect(band),
              controls: [...band.querySelectorAll(controls)]
                .filter((node) => node.checkVisibility())
                .flatMap((node) => (node.matches(".output-actions") ? [...node.children] : [node]))
                .map((node) => ({
                  bounds: rect(node),
                  target: node.matches("button, input, summary"),
                  overflow: !node.matches("input") && node.scrollWidth > node.clientWidth + 1,
                  icon: (() => {
                    if (!node.matches("button, summary, .file-picker") || node.innerText.trim()) return null
                    const path = node.querySelector("svg path")
                    if (!path) return null
                    const box = path.getBBox()
                    const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
                      path.getScreenCTM(),
                    )
                    return { x: center.x, y: center.y }
                  })(),
                })),
            },
          ]
        })
      })
      for (const { selector, bounds, controls } of layout) {
        const diagnostic = JSON.stringify({ selector, bounds, controls })
        const center = controls[0].bounds.y + controls[0].bounds.height / 2
        for (const control of controls) {
          const box = control.bounds
          assert.ok(Math.abs(box.y + box.height / 2 - center) < 1, diagnostic)
          assert.ok(box.left >= bounds.left - 1 && box.right <= bounds.right + 1, diagnostic)
          assert.equal(control.overflow, false, diagnostic)
          if (control.target) assert.ok(box.width >= 44 && box.height >= 44, diagnostic)
          if (control.icon) {
            assert.ok(Math.abs(control.icon.x - box.x - box.width / 2) < 1, diagnostic)
            assert.ok(Math.abs(control.icon.y - box.y - box.height / 2) < 1, diagnostic)
          }
        }
        for (let index = 1; index < controls.length; index++)
          assert.ok(controls[index].bounds.left >= controls[index - 1].bounds.right - 1, diagnostic)
        if (selector === ".editing-toolbar")
          assert.ok(
            bounds.bottom - 1 - Math.max(...controls.map(({ bounds: control }) => control.bottom)) >= 8,
            diagnostic,
          )
      }
      if (await page.locator(".mobile-workspace-tabs").isVisible()) {
        const columns = await page
          .locator(".mobile-workspace-tabs > button")
          .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()))
        const controls = layout[0].controls
        const isOutput = await pane.evaluate((element) => element.classList.contains("composition-output"))
        const peers = isOutput ? [controls.at(-1)] : controls
        for (const [index, control] of peers.entries()) {
          const column = columns[isOutput ? 1 : index]
          assert.ok(Math.abs(control.bounds.x - column.x) < 1, "Stacked control rows share column edges")
          assert.ok(Math.abs(control.bounds.width - column.width) < 1, "Stacked widgets have equal widths")
        }
        if (isOutput) {
          const [summary, print, download] = controls.map((control) => control.bounds)
          assert.ok(Math.abs(summary.x - columns[0].x) < 1, "Output summary starts in the first column")
          assert.ok(
            summary.right <= print.left && print.right < download.left,
            "Print fits between summary and Download",
          )
        }
      }
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false)
      return layout.map(({ bounds }) => bounds)
    }
    for (const populated of [false, true]) {
      if (populated) {
        await page.setViewportSize({ width: 951, height: 589 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await show("Input")
        await input.getByLabel("Page selection", { exact: true }).fill("1-7")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await input.getByLabel("Page selection", { exact: true }).fill("1-2")
        await output.getByLabel("Page selection", { exact: true }).fill("2-3")
      }
      for (const text of ["100%", "200%"]) {
        await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
        for (const [width, height] of [
          [320, 568],
          [390, 844],
          [393, 852],
          [669, 871],
          [768, 1048],
          [928, 589],
          [929, 589],
          [951, 589],
        ]) {
          await page.setViewportSize({ width, height })
          const paired = []
          for (const [name, pane] of [
            ["Input", input],
            ["Output", output],
          ]) {
            await show(name)
            for (const density of ["Normal", "Compact"]) {
              await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
              for (const colorScheme of ["light", "dark"]) {
                await page.emulateMedia({ colorScheme })
                t.diagnostic(`${width}px, ${text}, ${name}, ${density}, ${colorScheme}, populated=${populated}`)
                await rows(pane)
              }
            }
            const before = await rows(pane)
            await tab(pane, "Page")
            const after = await rows(pane)
            assert.ok(Math.abs(before[1].height - after[1].height) < 1, "View changes retain the toolbar height")
            if (name === "Input" && populated) {
              await tab(pane, "Style")
              await rows(pane)
            }
            await tab(pane, "Grid")
            paired.push(await rows(pane))
          }
          if (!(await page.locator(".mobile-workspace-tabs").isVisible())) {
            for (let index = 0; index < 3; index++)
              assert.ok(Math.abs(paired[0][index].y - paired[1][index].y) < 1, "Paired control rows stay aligned")
          }
        }
      }
    }
    await page.setViewportSize({ width: 951, height: 589 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "100%"
      window.holdStyles = true
    })
    const before = await output.locator(".output-actions").boundingBox()
    await tab(input, "Style")
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.waitForFunction(() => !!window.finishStyles)
    await page.locator(".header-feedback .style-progress").waitFor()
    const updating = await output.locator(".output-actions").boundingBox()
    assert.ok(
      Math.abs(updating.x - before.x) < 1 && Math.abs(updating.width - before.width) < 1,
      "Updating keeps the Download area fixed",
    )
    const opening = await input.locator(".input-heading .file-picker").boundingBox()
    assert.ok(Math.abs(opening.y - before.y) < 1, "Open PDF stays aligned during Style processing")
    await page.evaluate(() => {
      window.holdStyles = false
      window.finishStyles()
    })
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    await rows(input)
    await rows(output)
    await page.setViewportSize({ width: 320, height: 568 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
    await show("Input")
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("invalid")
    await rows(input)
    await input.getByRole("button", { name: "Reset all styles", exact: true }).click()
    await rows(input)
    await page.setViewportSize({ width: 951, height: 589 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await tab(input, "Grid")
    await input.getByRole("tab", { name: "Grid", exact: true }).focus()
    await page.keyboard.press("ArrowRight")
    assert.equal(await input.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
    await rows(input)
    await page.keyboard.press("ArrowLeft")
    await rows(input)
    await input
      .getByLabel("Select Input · Prepared pages with a very long descriptive input filename.pdf")
      .press("Enter")
    assert.equal(await input.getByRole("group", { name: "Inputs", exact: true }).isVisible(), true)
    await page.keyboard.press("Escape")
    await output.getByLabel("Page selection", { exact: true }).fill("1-7")
    await output.getByLabel("Page selection", { exact: true }).press("Enter")
    await input.getByLabel("Page selection", { exact: true }).fill("1,1,1,1,1,1,1,1,1,1")
    await input.getByLabel("Input page actions", { exact: true }).click()
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000")
    await page.keyboard.press("Escape")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "10000 pages",
    )
    for (const width of [320, 390]) {
      await page.setViewportSize({ width, height: 844 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await show("Output")
      const details = output.getByRole("button", { name: "Output details", exact: true })
      await details.click()
      assert.equal((await output.locator(".output-details").innerText()).trim(), "10000 pages, 5000 sheets")
      await page.keyboard.press("Escape")
      await rows(output)
    }
    await page.setViewportSize({ width: 951, height: 589 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await output.getByRole("button", { name: "Output details", exact: true }).waitFor({ state: "hidden" })
    assert.equal(await output.locator(".composition-totals").innerText(), "10000 pages, 5000 sheets")
    await rows(output)
    assert.deepEqual(errors, [])
  } catch (error) {
    if (page) await captureLayout(page, "pane-headings")
    throw error
  } finally {
    await browser?.close()
  }
})

test("Page headings and navigation share stable frame edges and centerlines", { timeout: 420000 }, async () => {
  const server = await serve()
  let browser, page
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    for (const [width, height, colorScheme, text] of [
      [1280, 900, "light", "100%"],
      [1920, 720, "dark", "100%"],
      [375, 667, "light", "100%"],
      [320, 568, "dark", "100%"],
      [390, 844, "dark", "200%"],
      [640, 960, "light", "100%"],
      [641, 960, "dark", "100%"],
      [768, 1024, "light", "100%"],
      ...["light", "dark"].flatMap((theme) =>
        [
          [360, 672],
          [392, 764],
          [439, 956],
          [440, 956],
          [441, 956],
          [750, 1144],
          [1006, 481],
          [876, 1280],
          [1400, 756],
          [667, 375],
          [844, 390],
          [956, 440],
          [744, 1133],
          [1133, 744],
          [810, 1080],
          [1080, 810],
        ].flatMap(([viewportWidth, viewportHeight]) =>
          ["100%", "200%"].map((textSize) => [viewportWidth, viewportHeight, theme, textSize]),
        ),
      ),
    ]) {
      await page.setViewportSize({ width, height })
      await page.emulateMedia({ colorScheme })
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
      for (const [selector, name] of [
        [".selection-panel", "Input"],
        [".composition-output", "Output"],
      ]) {
        const pane = page.locator(selector)
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
        await tab(pane, "Page")
        await zoom(pane, "Reset zoom")
        const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
        for (const key of ["Home", "End"]) {
          await viewport.focus()
          await page.keyboard.press(key)
          await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
          await aligned(pane)
          const actions = [1280, 375, 390].includes(width)
            ? [undefined, "Zoom out", "Reset zoom", "Zoom in", "3200%"]
            : [undefined, "Zoom in"]
          for (const action of actions) {
            if (action === "3200%") {
              while ((await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent()) !== action)
                await zoom(pane, "Zoom in")
              assert.equal(await pane.getByRole("button", { name: "Zoom in", exact: true }).first().isEnabled(), false)
            } else if (action) await zoom(pane, action)
            await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
            await aligned(pane)
            const geometry = await pane.locator(".page-view").evaluate((view) => {
              const box = (query) => view.querySelector(query).getBoundingClientRect()
              const handle = view.querySelector(".inspection-heading .page-grip")
              const grip = handle?.checkVisibility() ? handle.getBoundingClientRect() : undefined
              const fit = [...view.querySelector("button.page-fit").children].find(
                (child) => getComputedStyle(child).display !== "none",
              )
              const items = [...view.querySelector(".page-zoom").children]
                .filter((child) => child.checkVisibility() && getComputedStyle(child).visibility !== "hidden")
                .map((child) => child.getBoundingClientRect())
                .filter((rect) => rect.width > 1)
              return {
                overflow: document.documentElement.scrollWidth > innerWidth,
                controls: view.getAttribute("data-controls"),
                starts: [box(".page-current").left, box(".page-navigation > button:first-child svg").left],
                ends: [fit.getBoundingClientRect().right, box(".page-navigation > button:last-child svg").right],
                grip: grip && grip.x + grip.width / 2,
                gripTop: grip?.top,
                gripRight: grip?.right,
                gripBottom: grip?.bottom,
                toolTop: box(".page-tools").top,
                items: items.length,
                centers: items.map((rect) => rect.x + rect.width / 2),
                rows: items.map((rect) => rect.y + rect.height / 2),
                heading: box(".inspection-heading").toJSON(),
                targets: [...view.querySelectorAll(".page-tools button")]
                  .filter((button) => button.checkVisibility() && getComputedStyle(button).visibility !== "hidden")
                  .map((button) => {
                    const rect = button.getBoundingClientRect()
                    return rect.toJSON()
                  }),
                zoom: view.querySelector(".page-zoom output").textContent,
                fit: fit.tagName === "svg" ? "icon" : fit.textContent,
              }
            })
            const label = `${name}, ${width}×${height}, ${colorScheme}, ${text}, ${key}, ${action ?? "Fit"}`
            assert.ok(
              geometry.starts.every((x) => Math.abs(x - geometry.heading.left - 32) < 1),
              `${label}: counter and Previous share the frame's start inset`,
            )
            assert.ok(
              geometry.ends.every((x) => Math.abs(x - geometry.heading.right + 32) < 1),
              `${label}: Fit and Next share the frame's end inset`,
            )
            if (geometry.grip !== undefined)
              assert.ok(
                Math.abs(geometry.grip - geometry.heading.x - geometry.heading.width / 2) < 1,
                `${label}: the grip stays centered`,
              )
            assert.equal(geometry.overflow, false, `${label}: controls fit the viewport`)
            const compact = width <= 640 || geometry.controls === "fit"
            assert.equal(
              geometry.items,
              geometry.controls === "fit" ? 1 : compact ? 3 : 4,
              `${label}: the zoom group uses the available row`,
            )
            const spacing = geometry.centers.slice(1).map((center, index) => center - geometry.centers[index])
            assert.ok(
              spacing.every((gap) => Math.abs(gap - spacing[0]) < 1),
              `${label}: zoom items are evenly spaced`,
            )
            assert.ok(
              geometry.rows.every((center) => Math.abs(center - geometry.rows[0]) < 1),
              `${label}: zoom items stay on one row`,
            )
            assert.ok(
              geometry.targets.every((target) => target.width >= 44 && target.height >= 44),
              `${label}: touch targets keep their size`,
            )
            assert.ok(
              geometry.targets.every(
                (target) =>
                  target.left >= geometry.heading.left - 1 &&
                  target.right <= geometry.heading.right + 1 &&
                  target.top >= geometry.heading.top - 1 &&
                  target.bottom <= geometry.heading.bottom + 1,
              ),
              `${label}: Page controls stay inside their heading`,
            )
            assert.ok(
              geometry.targets.every(
                (target, index, targets) => index === 0 || target.left >= targets[index - 1].right - 1,
              ),
              `${label}: Page controls retain separate targets`,
            )
            assert.equal(
              geometry.fit,
              compact && geometry.zoom !== "100%" ? geometry.zoom : "icon",
              `${label}: Fit shows an icon or the current zoom`,
            )
            if (geometry.grip !== undefined)
              assert.ok(geometry.targets[0].left >= geometry.gripRight - 1, `${label}: tools stay beside the grip`)
          }
          await zoom(pane, "Reset zoom")
        }
      }
    }
    assert.deepEqual(errors, [], "Page layout and resizing have no browser errors")
  } catch (error) {
    const screenshot = page && (await captureLayout(page, "page").catch(() => undefined))
    if (screenshot) error.message += `\nScreenshot: ${screenshot}`
    throw error
  } finally {
    await browser?.close()
  }
})

test("Page controls retain space and alignment with wide fonts and enlarged mobile text", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const output = page.locator(".composition-output")
    await tab(output, "Page")
    for (const font of ["DejaVu Sans", "ui-sans-serif"]) {
      for (const [width, text] of [
        [1440, "100%"],
        [320, "200%"],
        [375, "200%"],
      ]) {
        await page.setViewportSize({ width, height: 1100 })
        await page.evaluate(
          ({ font: family, text: scale }) => {
            document.body.style.fontFamily = family
            document.documentElement.style.fontSize = scale
          },
          { font, text },
        )
        const views = page.locator(".mobile-workspace-tabs")
        if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click()
        assert.equal(
          await aligned(output),
          true,
          `${font}, ${width}px, ${text}: controls align and leave room for the grip`,
        )
        const tools = await output.getByRole("group", { name: "Output Page controls", exact: true }).boundingBox()
        assert.ok(tools.x >= 0 && tools.x + tools.width <= width, `${font}, ${width}px, ${text}: all tools fit`)
        const frame = await output.locator(".inspection-heading").boundingBox()
        assert.ok(
          tools.x >= frame.x && tools.x + tools.width <= frame.x + frame.width,
          `${font}, ${width}px, ${text}: the page frame does not clip tools`,
        )
        const percentage = await output.getByLabel("Output page zoom", { exact: true }).boundingBox()
        assert.ok(
          percentage.x >= frame.x &&
            percentage.x + percentage.width <= frame.x + frame.width &&
            percentage.y >= frame.y &&
            percentage.y + percentage.height <= frame.y + frame.height,
          `${font}, ${width}px, ${text}: the percentage remains inside the page heading`,
        )
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
    }
  } finally {
    await browser?.close()
  }
})

test(
  "Page starts readable with balanced gutters on touch and desktop and preserves explicit zoom choices",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const errors = []
      for (const [width, height, touch, enlarged] of [
        [375, 667, true, true],
        [393, 852, true, true],
        [440, 956, true, true],
        [744, 1133, true, true],
        [810, 1048, true, true],
        [1080, 778, true, true],
        [1024, 768, true, true],
        [1133, 744, true, true],
        [393, 852, false, true],
        [1280, 720, false, true],
        [1440, 900, false, true],
        [1920, 1080, false, true],
        [1920, 1440, false, false],
      ]) {
        const page = await browser.newPage({
          viewport: { width, height },
          hasTouch: touch,
          isMobile: touch,
          reducedMotion: "reduce",
        })
        page.on("pageerror", (error) => errors.push(error.message))
        await page.addInitScript(() => {
          localStorage.setItem("mainz:onboarding", "19")
          localStorage.setItem("mainz:installation", "seen")
        })
        await page.goto(`${server.resolvedUrls.local[0]}?demo&input=page`)
        for (const name of ["Input", "Output"]) {
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
          const views = page.locator(".mobile-workspace-tabs")
          const workspace = views.getByRole("button", { name, exact: true })
          if ((await views.isVisible()) && (await workspace.getAttribute("aria-pressed")) !== "true")
            await workspace.click()
          if ((await pane.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected")) !== "true")
            await tab(pane, "Page")
          if (enlarged)
            await page.waitForFunction(
              (paneName) =>
                Number(document.querySelector(`[aria-label="${paneName} page zoom"]`)?.textContent.replace("%", "")) >
                100,
              name,
            )
          await aligned(pane)
          const initial = await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent()
          assert.equal(
            Number(initial.replace("%", "")) > 100,
            enlarged,
            `${name}, ${width}: Page starts enlarged when Fit leaves a narrow image`,
          )
          if (name === "Input")
            assert.equal(
              await pane.locator(".inspection-heading .page-grip").isVisible(),
              !touch,
              `${width}: Page grip follows the layout scope`,
            )
          if (enlarged) {
            if (touch || width >= 1280)
              assert.notEqual(
                await pane.locator(".page-view").getAttribute("data-controls"),
                "fit",
                `${name}, ${width}: zoom controls fit inline`,
              )
            if (!touch && width >= 1280)
              assert.equal(
                await pane.locator(".page-view").getAttribute("data-controls"),
                "all",
                `${name}, ${width}: smaller desktop headings retain the percentage and zoom buttons`,
              )
            if (touch) {
              const frame = await pane.locator(".page-view").boundingBox()
              const status = await page.locator(".footnote").boundingBox()
              assert.ok(
                frame.y >= 0 && frame.y + frame.height <= status.y + 1,
                `${name}, ${width}: touch entry exposes the frame and navigation above status`,
              )
            }
            const gutter = touch ? 32 : Math.max(12, Math.min(16, 9.6 + width * 0.004)) * 1.5
            const geometry = await pane.locator(".page-scroll").evaluate((viewport) => {
              const bounds = viewport.getBoundingClientRect()
              const sheet = viewport.querySelector("canvas").getBoundingClientRect()
              const top = sheet.top - bounds.top
              const start = bounds.left + viewport.clientLeft
              const left = sheet.left - start
              const right = start + viewport.clientWidth - sheet.right
              return {
                top,
                left,
                right,
                overflow: viewport.scrollHeight - viewport.clientHeight,
                extraWidth: viewport.scrollWidth - viewport.clientWidth,
              }
            })
            assert.ok(
              Math.abs(geometry.top - gutter) < 1,
              `${name}, ${width}: initial top gutter ${JSON.stringify(geometry)}`,
            )
            assert.ok(
              geometry.left >= gutter - 1 && Math.abs(geometry.left - geometry.right) < 1,
              `${name}, ${width}: balanced side gutters ${JSON.stringify(geometry)}`,
            )
            assert.ok(
              geometry.extraWidth <= 1 && geometry.overflow > 0,
              `${name}, ${width}: initial zoom scrolls vertically`,
            )
            if (width === 375 && name === "Input") {
              const bounds = await pane.locator(".page-scroll").boundingBox()
              const before = await page.evaluate(() => scrollY)
              const session = await page.context().newCDPSession(page)
              const x = bounds.x + bounds.width / 2
              const y = bounds.y + 60
              await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] })
              for (let step = 1; step <= 8; step++) {
                await session.send("Input.dispatchTouchEvent", {
                  type: "touchMove",
                  touchPoints: [{ x, y: y + step * 30 }],
                })
                await page.evaluate(() => new Promise(requestAnimationFrame))
              }
              await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] })
              await page.waitForFunction((start) => scrollY < start - 40, before)
              await session.detach()
              await pane.locator(".page-view").evaluate((element) => element.scrollIntoView({ behavior: "instant" }))
            }
            const bottom = await pane.locator(".page-scroll").evaluate((viewport) => {
              viewport.scrollTop = viewport.scrollHeight
              return (
                viewport.getBoundingClientRect().top +
                viewport.clientTop +
                viewport.clientHeight -
                viewport.querySelector("canvas").getBoundingClientRect().bottom
              )
            })
            assert.ok(Math.abs(bottom - gutter) < 2, `${name}, ${width}: trailing gutter ${bottom}`)
            await zoom(pane, "Reset zoom")
            await aligned(pane)
            assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent(), "100%")
            const fit = await pane.locator(".page-scroll").evaluate((viewport) => ({
              width: viewport.scrollWidth - viewport.clientWidth,
              height: viewport.scrollHeight - viewport.clientHeight,
            }))
            assert.ok(
              fit.width <= 1 && fit.height <= 1,
              `${name}, ${width}: Reset fits the complete page ${JSON.stringify(fit)}`,
            )
            await tab(pane, "Grid")
            await tab(pane, "Page")
            await aligned(pane)
            assert.equal(
              await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent(),
              "100%",
              "Returning does not repeat automatic zoom",
            )
            await zoom(pane, "Zoom in")
            await tab(pane, "Grid")
            await tab(pane, "Page")
            await aligned(pane)
            assert.equal(
              await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent(),
              "150%",
              "Returning preserves manual zoom",
            )
            if (width === 810 || width === 1080) {
              await page.setViewportSize(width === 810 ? { width: 1080, height: 778 } : { width: 810, height: 1048 })
              if (await views.isVisible()) await workspace.click()
              await aligned(pane)
              assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent(), "150%")
              await zoom(pane, "Reset zoom")
              await page.setViewportSize({ width, height })
              if (await views.isVisible()) await workspace.click()
              await aligned(pane)
              assert.equal(
                await pane.getByLabel(`${name} page zoom`, { exact: true }).textContent(),
                "100%",
                "Rotation across the pane breakpoint preserves explicit zoom and Fit",
              )
            }
            if (touch && width === 393 && name === "Output") {
              await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
              await aligned(pane)
              await pane.getByLabel("Output page actions", { exact: true }).click()
              assert.equal(await pane.getByRole("button", { name: "Compare page", exact: true }).isVisible(), true)
              await pane.getByRole("button", { name: "Show original page", exact: true }).click()
              assert.equal(await pane.locator(".sequence-options").evaluate((menu) => menu.open), false)
              assert.equal(await page.locator(".selection-panel").isVisible(), true)
              assert.equal(await page.getByLabel("Input page zoom", { exact: true }).textContent(), "150%")
            }
          }
        }
        await page.close()
      }
      const keyboard = await browser.newPage({ viewport: { width: 375, height: 549 }, hasTouch: true, isMobile: true })
      await keyboard.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await keyboard.goto(`${server.resolvedUrls.local[0]}?demo`)
      await keyboard.locator(".composer:not([inert])").waitFor()
      const input = keyboard.locator(".selection-panel")
      await input.getByRole("tab", { name: "Grid", exact: true }).focus()
      await keyboard.keyboard.press("ArrowRight")
      await aligned(input)
      const focused = await input.getByRole("tab", { name: "Page", exact: true }).evaluate((element) => ({
        visible: element.matches(":focus-visible"),
        top: element.getBoundingClientRect().top,
        active: element === document.activeElement,
      }))
      assert.ok(focused.active && focused.visible && focused.top >= 0, "Keyboard entry keeps the focused tab visible")
      await keyboard.close()
      assert.deepEqual(errors, [], "Page loading and layout changes have no browser errors")
    } finally {
      await browser?.close()
    }
  },
)

test("Page fit preserves screen size across expanded desktop viewports", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture({ count: 240 }) }),
    )
    const session = await page.context().newCDPSession(page)
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    const fitted = async (locator) => {
      const [bounds, factor] = await Promise.all([locator.boundingBox(), page.evaluate(() => devicePixelRatio)])
      assert.ok(
        Math.abs(bounds.width * factor - 608.07) < 1,
        `Page keeps its fitted screen width ${JSON.stringify({ bounds, factor })}`,
      )
      assert.ok(Math.abs(bounds.height * factor - 860) < 1, "Page keeps its fitted screen height")
    }
    for (const factor of [1, 0.8, 0.67]) {
      const viewport = { width: Math.round(2560 / factor), height: Math.round(1440 / factor) }
      await page.setViewportSize(viewport)
      await session.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: factor,
        mobile: false,
      })
      await page.emulateMedia({ colorScheme: factor === 0.8 ? "dark" : "light" })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&input=page`)
      await input.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await zoom(input, "Reset zoom")
      await fitted(image(input))
      if (factor < 1)
        await page.waitForFunction(() => document.querySelectorAll(".composition-output .composition-card").length > 12)
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".composition-output .thumbnail")].every(
          (element) => element.getAttribute("aria-busy") === "false",
        ),
      )
      await tab(output, "Page")
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await zoom(output, "Reset zoom")
      await fitted(image(output))
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      const compact = await measure(output)
      assert.ok(compact.matrix[1] >= 7, "Compact capacity uses the expanded viewport without a fixed row cap")
      await input.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(input))
      const surround = await input.locator(".page-scroll").boundingBox()
      const sheet = await image(input).boundingBox()
      const margins = [sheet.y - surround.y, surround.y + surround.height - sheet.y - sheet.height]
      assert.ok(Math.abs(margins[0] - margins[1]) < 1, "Page stays centered at every browser zoom")
      if (await page.evaluate(() => document.documentElement.scrollHeight > innerHeight))
        assert.ok(
          margins.every((margin) => margin * factor < 90),
          "Page retains balanced fitted margins when the workspace exceeds the viewport height",
        )
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await input.locator(".inspection-heading .page-grip").dispatchEvent("dragstart", { dataTransfer: transfer })
      const first = output.locator(".composition-card").first(),
        destination = await first.boundingBox()
      await first.dispatchEvent("dragover", {
        dataTransfer: transfer,
        clientX: destination.x + destination.width / 4,
        clientY: destination.y + destination.height / 2,
      })
      await output.locator(".drop-placeholder").waitFor()
      assert.equal(
        await output.locator("[data-preview-hidden]").count(),
        1,
        "The drag preview stays within the visible Compact batch at every browser zoom",
      )
      await page.keyboard.press("Escape")
      await transfer.dispose()
      await tab(output, "Page")
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(output))
      await output.getByLabel("Page selection", { exact: true }).fill("1")
      await output.locator(".output-options > summary").click()
      await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
      await page.keyboard.press("Escape")
      await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Home")
      await output.locator(".blank-sheet").waitFor()
      await fitted(output.locator(".blank-sheet"))
    }
  } finally {
    await browser?.close()
  }
})
