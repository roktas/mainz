// Checks Page frames, headings, and controls across viewports.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { createServer, tab, image, captureLayout, fixture } from "./browser.js"

test("Paired pane headings align actions, metadata, tabs, and selection fields", { timeout: 90000 }, async (t) => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser, page
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      const Original = Worker
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (window.holdStyles && message.changes) {
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
    for (const populated of [false, true]) {
      if (populated) {
        await input.getByLabel("Page selection", { exact: true }).fill("1-7")
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      }
      for (const text of ["100%", "200%"]) {
        await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
        for (const width of [960, 1024, 1080, 1133, 1150, 1151, 1152, 1153, 1280, 1440, 1920, 2560, 3840]) {
          await page.setViewportSize({ width, height: 1100 })
          if (!(await input.isVisible()) || !(await output.isVisible())) continue
          for (const density of ["Normal", "Compact"]) {
            await input.getByRole("button", { name: `${density} Input grid`, exact: true }).click()
            await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
            for (const colorScheme of ["light", "dark"]) {
              await page.emulateMedia({ colorScheme })
              t.diagnostic(`${width}px, ${text}, ${density}, ${colorScheme}, populated=${populated}`)
              const layout = await page.locator(".composition-panels").evaluate((panels) => {
                const box = (selector) => panels.querySelector(selector).getBoundingClientRect().toJSON()
                const titles = [".input-label", ".composition-output > .section-heading h2"].map((selector, index) => {
                  const node = panels.querySelector(selector)
                  const range = document.createRange()
                  range.selectNodeContents(index === 0 ? node : node.lastChild)
                  return range.getBoundingClientRect().toJSON()
                })
                return {
                  inputTitle: titles[0],
                  outputTitle: titles[1],
                  open: box(".input-heading .file-picker"),
                  download: box(".download-action"),
                  totals: box(".output-state"),
                  heading: box(".composition-output > .section-heading"),
                  inputTabs: box(".source-tabs"),
                  outputTabs: box(".output-tabs"),
                  inputField: box('.selection-panel input[aria-label="Page selection"]'),
                  outputField: box('.composition-output input[aria-label="Page selection"]'),
                  overflow: document.documentElement.scrollWidth > innerWidth,
                }
              })
              assert.ok(Math.abs(layout.open.y - layout.download.y) < 1, JSON.stringify(layout))
              assert.ok(Math.abs(layout.inputTitle.y - layout.outputTitle.y) < 1, JSON.stringify(layout))
              assert.ok(Math.abs(layout.open.height - layout.download.height) < 1)
              assert.ok(Math.abs(layout.inputTabs.y - layout.outputTabs.y) < 1)
              assert.ok(Math.abs(layout.inputField.y - layout.outputField.y) < 1)
              assert.ok(layout.totals.right <= layout.download.x && layout.totals.bottom <= layout.heading.bottom + 1)
              assert.equal(layout.overflow, false)
            }
          }
        }
      }
    }
    await page.setViewportSize({ width: 1080, height: 810 })
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "100%"
      window.holdStyles = true
    })
    const before = await output.locator(".download-action").boundingBox()
    await tab(input, "Style")
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.waitForFunction(() => !!window.finishStyles)
    await output.locator('.output-status[aria-hidden="false"]').waitFor()
    assert.deepEqual(
      await output.locator(".download-action").boundingBox(),
      before,
      "Updating keeps the Download area fixed",
    )
    const opening = await input.locator(".input-heading .file-picker").boundingBox()
    assert.ok(Math.abs(opening.y - before.y) < 1, "Open PDF stays aligned during Style processing")
    await page.evaluate(() => {
      window.holdStyles = false
      window.finishStyles()
    })
    await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'))
  } catch (error) {
    if (page) await captureLayout(page, "pane-headings")
    throw error
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Page headings and navigation follow fitted image edges", { timeout: 240000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser, page
  try {
    await server.listen()
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
        const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true })
        for (const key of ["Home", "End"]) {
          await viewport.focus()
          await page.keyboard.press(key)
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          await aligned(pane)
          const fitted = await image(pane).boundingBox()
          for (const action of [undefined, "Zoom out", "Fit page", "Zoom in", "Fit page"]) {
            if (action) await zoom(pane, action)
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            await pane.locator(".pdf-viewport[aria-busy=false]").waitFor()
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            )
            await aligned(pane)
            const geometry = await pane.locator(".page-view").evaluate((view) => {
              const box = (query) => view.querySelector(query).getBoundingClientRect()
              const grip = view.querySelector(".inspection-heading .page-grip")?.getBoundingClientRect()
              const fit = [...view.querySelector('button[aria-label="Fit page"]').children].find(
                (child) => getComputedStyle(child).display !== "none",
              )
              const items = [...view.querySelector(".page-zoom").children]
                .map((child) => child.getBoundingClientRect())
                .filter((rect) => rect.width > 1)
              return {
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
                targets: [...view.querySelectorAll(".page-tools button")].map((button) => {
                  const rect = button.getBoundingClientRect()
                  return rect.toJSON()
                }),
                zoom: view.querySelector(".page-zoom output").textContent,
                fit: fit.tagName === "svg" ? "icon" : fit.textContent,
              }
            })
            const label = `${name}, ${width}×${height}, ${colorScheme}, ${text}, ${key}, ${action ?? "Fit"}`
            assert.ok(
              geometry.starts.every((x) => Math.abs(x - fitted.x) < 1),
              `${label}: counter and Previous align with the image start (${geometry.starts}, expected ${fitted.x})`,
            )
            assert.ok(
              geometry.ends.every((x) => Math.abs(x - fitted.x - fitted.width) < 1),
              `${label}: Fit and Next align with the image end (${geometry.ends}, expected ${fitted.x + fitted.width})`,
            )
            if (geometry.grip !== undefined)
              assert.ok(Math.abs(geometry.grip - fitted.x - fitted.width / 2) < 1, `${label}: the grip stays centered`)
            const compact = width <= 640
            assert.equal(geometry.items, compact ? 3 : 4, `${label}: the zoom group uses the screen layout`)
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
              assert.ok(
                geometry.targets[0].left >= geometry.gripRight - 1 || geometry.toolTop >= geometry.gripBottom - 1,
                `${label}: tools wrap before covering the grip`,
              )
          }
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
    await server.close()
  }
})

test("Page controls retain space and alignment with wide fonts and enlarged mobile text", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
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
    await server.close()
  }
})

test("Page fit preserves screen size across expanded desktop viewports", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    const session = await page.context().newCDPSession(page)
    const input = page.locator(".selection-panel")
    const output = page.locator(".composition-output")
    const fitted = async (locator) => {
      const [bounds, factor] = await Promise.all([locator.boundingBox(), page.evaluate(() => devicePixelRatio)])
      assert.ok(Math.abs(bounds.width * factor - 608.07) < 1, "Page keeps its fitted screen width")
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
      await fitted(image(input))
      if (factor < 1)
        await page.waitForFunction(() => document.querySelectorAll(".composition-output .composition-card").length > 12)
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".composition-output .thumbnail")].every(
          (element) => element.getAttribute("aria-busy") === "false",
        ),
      )
      const thumbnail = await output.locator(".page-image canvas").first().boundingBox()
      assert.ok(
        Math.abs(thumbnail.height - (factor === 1 ? 180 : 144)) < 1,
        "Grid thumbnails follow their viewport range at each browser zoom",
      )
      await tab(output, "Page")
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor()
      await fitted(image(output))
      await tab(output, "Grid")
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      await page.waitForFunction(() =>
        document.querySelector('.composition-output[data-density="compact"] .composition-card'),
      )
      assert.ok(
        await output.locator(".grid-view").evaluate((element) => Number(element.dataset.rows) >= 7),
        "Compact capacity uses the expanded viewport without a fixed row cap",
      )
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
    await server.close()
  }
})
