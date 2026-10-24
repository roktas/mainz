// Checks Output edits, page transfers, and edit feedback.

import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { readFile } from "node:fs/promises"
import { chromium } from "playwright"
import { zoom } from "./workspace.js"
import { tab, fixture, image, pagePosition } from "./browser.js"

const standard = process.env.MAINZ_TEST_MODE === "standard"

test("Output Page removes the current occurrence, including Blank and the final page", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await tab(output, "Page")
    const actions = output.locator(".page-actions")
    assert.deepEqual(
      await actions
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
      ["Remove Output page 1", "Duplicate Output page 1"],
    )
    await actions.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
    assert.equal(await output.locator(".composition-totals strong").textContent(), "5 pages")
    assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "")
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
    assert.equal(await actions.getByRole("button").count(), 0, "Selection hides individual actions")
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await output.getByRole("button", { name: "Next Output page", exact: true }).focus()
    await page.keyboard.press("End")
    await output.locator(".blank-sheet").waitFor()
    await actions.getByRole("button", { name: "Remove Output page 6", exact: true }).click()
    assert.equal(await output.locator(".composition-totals strong").textContent(), "5 pages")
    await output.getByRole("button", { name: "Select all", exact: true }).click()
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await actions.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
    await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor()
    assert.equal(
      await output
        .getByRole("tab", { name: "Page", exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    )
  } finally {
    await browser?.close()
  }
})

test(
  "Input changes cancel their pending gestures and transfers while Output stays independent",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.pauseOpening && message.bytes && !message.changes) {
              window.resumeOpening = () => super.postMessage(message, ...rest)
              return
            }
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const open = async (name) => {
        await page.evaluate(() => {
          window.pauseOpening = true
          window.resumeOpening = undefined
        })
        await input.locator("input[type=file]").setInputFiles({ name, mimeType: "application/pdf", buffer: fixture() })
        await page.waitForFunction(() => !!window.resumeOpening)
      }
      await output.locator(".composition-totals strong").filter({ hasText: "6 pages" }).waitFor()
      await output.getByRole("button", { name: "Select Output page 1", exact: true }).click()
      await open("Second.pdf")
      const transfer = await page.evaluateHandle(() => new DataTransfer())
      await input.getByRole("button", { name: "Select Input page 1", exact: true }).dispatchEvent("dragstart", {
        dataTransfer: transfer,
      })
      await page.locator('.composer[data-drag="source"]').waitFor()
      await page.keyboard.press("Delete")
      assert.equal(await output.locator(".composition-totals strong").textContent(), "6 pages")
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1")
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Second.pdf" }).waitFor()
      await page.waitForFunction(() => !document.querySelector(".composer[data-drag]"))
      assert.equal(await page.locator(".drag-image").count(), 0)
      await output.dispatchEvent("drop", { dataTransfer: transfer })
      assert.equal(await output.locator(".composition-totals strong").textContent(), "6 pages")
      await input.locator(".input-picker > summary").click()
      await input.locator(".input-list button[data-source]").first().click()
      assert.equal(await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "3-5,2,2,7")
      await open("Third.pdf")
      const contact = { pointerType: "touch", pointerId: 7, isPrimary: true, button: 0, clientX: 100, clientY: 500 }
      await input
        .getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
        .dispatchEvent("pointerdown", contact)
      assert.equal(await input.locator("[data-press]").count(), 1)
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Third.pdf" }).waitFor()
      assert.equal(await input.locator("[data-press]").count(), 0, "Input switching also releases a pending touch grip")
      await output.dispatchEvent("pointermove", { ...contact, clientX: 1000 })
      await output.dispatchEvent("pointerup", { ...contact, clientX: 1000 })
      assert.equal(await page.locator(".composer").getAttribute("data-drag"), null)
      assert.equal(await output.locator(".composition-totals strong").textContent(), "6 pages")
      await open("Fourth.pdf")
      await page.evaluate(() => {
        const time = performance.now()
        performance.now = () => time
      })
      const thumbnail = input.getByRole("button", { name: "Select Input page 1", exact: true })
      await thumbnail.dispatchEvent("pointerdown", contact)
      await thumbnail.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Fourth.pdf" }).waitFor()
      await thumbnail.dispatchEvent("pointerdown", contact)
      await thumbnail.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => delete performance.now)
      assert.equal(await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(
        await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(),
        "1",
        "The first tap in a new Input starts a new gesture",
      )
      await open("Fifth.pdf")
      await thumbnail.dispatchEvent("pointerdown", { pointerType: "mouse", isPrimary: true, button: 0 })
      await thumbnail.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Fifth.pdf" }).waitFor()
      await thumbnail.dispatchEvent("click", { detail: 2 })
      await thumbnail.dispatchEvent("dblclick", { detail: 2 })
      assert.equal(
        await output.locator(".composition-totals strong").textContent(),
        "6 pages",
        "A double-click cannot start in one Input and add pages from another",
      )
      await thumbnail.dblclick()
      assert.equal(
        await output.locator(".composition-totals strong").textContent(),
        "7 pages",
        "A complete double-click still adds the current page",
      )
      await open("Sixth.pdf")
      await page.evaluate(() => {
        const time = performance.now()
        performance.now = () => time
      })
      const outputImage = output.getByRole("button", { name: "Select Output page 1", exact: true })
      await outputImage.dispatchEvent("pointerdown", contact)
      await outputImage.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => window.resumeOpening())
      await input.locator(".input-current").filter({ hasText: "Sixth.pdf" }).waitFor()
      await outputImage.dispatchEvent("pointerdown", contact)
      await outputImage.dispatchEvent("click", { detail: 1 })
      await page.evaluate(() => delete performance.now)
      assert.equal(
        await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"),
        "true",
        "Output's double-tap continues independently of Input changes",
      )
      assert.equal(await output.locator(".composition-totals strong").textContent(), "7 pages")
    } finally {
      await browser?.close()
    }
  },
)

test("Grid navigation retains physical page positions during additions", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, density, colorScheme] of [
      [1440, 1100, "Normal", "light"],
      [1440, 1100, "Compact", "dark"],
      [390, 844, "Normal", "dark"],
      [390, 844, "Compact", "light"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, colorScheme, reducedMotion: "no-preference" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composition-totals strong").waitFor({ state: "attached" })
      const output = page.locator(".composition-output")
      const workspace = page.locator(".mobile-workspace-tabs > button:last-child")
      if (await workspace.isVisible()) await workspace.click()
      await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
      await output.locator(".thumbnail[aria-busy=false]").first().waitFor()
      await page.evaluate(() => {
        new MutationObserver(() => {
          document.querySelectorAll(".addition-preview").forEach((element) => {
            element.getAnimations().forEach((animation) => {
              animation.pause()
              animation.currentTime = 0
            })
          })
        }).observe(document.body, { childList: true })
      })
      const selection = output.getByLabel("Page selection", { exact: true })
      const grid = output.locator(".composition-grid")
      await selection.fill("1")
      await grid.press("Enter")
      await page.locator(".addition-preview").waitFor()
      await grid.press("Home")
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 1")
      await page.keyboard.press("ArrowRight")
      assert.equal(
        await grid.evaluate((element) => element === document.activeElement),
        true,
        `${width} ${density}: Grid retains focus while its cursor visits a hidden new page`,
      )
      for (const [key, number] of [
        ["ArrowRight", 3],
        ["ArrowRight", 4],
        ["ArrowLeft", 3],
      ]) {
        await page.keyboard.press(key)
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select Output page ${number}`,
        )
      }
      await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
      await page.keyboard.press("Shift+ArrowRight")
      assert.equal(await selection.inputValue(), "2-4", `${width} ${density}: Shift follows the clicked physical page`)
      await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 5")
      if (await page.locator(".addition-preview").count())
        await page.locator(".addition-preview").evaluate((element) => {
          element.getAnimations().forEach((animation) => animation.finish())
        })
      assert.equal(await selection.inputValue(), "2-4")
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Input additions reach Output without delaying edits or taking focus", { timeout: 90000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, hasTouch, colorScheme] of [
      [1920, 1080, false, "light"],
      [1920, 1080, false, "dark"],
      [1440, 1100, false, "light"],
      [1024, 768, true, "dark"],
      [810, 1080, true, "light"],
      [744, 1133, true, "dark"],
      [440, 956, true, "light"],
      [320, 568, true, "dark"],
    ].filter(([viewportWidth]) => !standard || [1440, 320].includes(viewportWidth))) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch,
        isMobile: hasTouch,
        colorScheme,
        reducedMotion: "no-preference",
      })
      const cpu = !standard && width === 810 ? 4 : 1
      await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu })
      t.diagnostic(`${width} × ${height}, ${colorScheme}, ${cpu}× CPU slowdown`)
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "6 pages")
      // Freeze the moving preview before its first paint so geometry checks do not depend on machine speed.
      await page.evaluate(() => {
        new MutationObserver(() => {
          document
            .querySelectorAll(".addition-preview, .mobile-workspace-tabs > button:last-child")
            .forEach((element) => {
              element.getAnimations().forEach((animation) => {
                animation.pause()
                animation.currentTime = 0
              })
            })
        }).observe(document.body, { childList: true })
      })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output"),
        prepared = input.getByLabel("Page selection", { exact: true }),
        flight = page.locator(".addition-preview")
      const total = async () => Number.parseInt(await output.locator(".composition-totals strong").textContent(), 10)
      const finish = async () => {
        await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
        await flight.waitFor({ state: "detached" })
        assert.equal(
          await page
            .locator(".mobile-workspace-tabs > button:last-child")
            .evaluate((button) =>
              button.getAnimations().some((animation) => animation.effect.getTiming().duration === 1200),
            ),
          false,
          "Arrival or cancellation clears the Output glow",
        )
      }
      let count = 6
      const densities = [
        ["Normal", "Normal"],
        ["Compact", "Compact"],
      ]
      if (width === 1440) densities.push(["Normal", "Compact"], ["Compact", "Normal"])
      if (width === 1920)
        densities.push(["Normal", "Normal", 12], ["Normal", "Normal", 13], ["Compact", "Compact", "batch"])
      for (const [density, outputDensity, quantity = 2] of densities) {
        await input.getByRole("button", { name: `${density} Input grid`, exact: true }).click()
        if (width >= 1024)
          await output.getByRole("button", { name: `${outputDensity} Output grid`, exact: true }).click()
        const added =
          quantity === "batch" ? Number(await output.locator(".grid-view").getAttribute("data-batch")) + 1 : quantity
        await prepared.fill(Array.from({ length: added }, (_, index) => (index % 7) + 1).join(","))
        await input.locator(".thumbnail[aria-busy=false]").first().waitFor()
        if (density === "Compact") await prepared.press("Enter")
        else await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        count += added
        await flight.waitFor()
        assert.equal(await total(), count, "The complete group is added while the preview is paused")
        assert.equal(await prepared.inputValue(), "")
        assert.equal(await flight.getAttribute("data-copies"), String(Math.min(added, 3)))
        assert.equal(await flight.getAttribute("aria-hidden"), "true")
        assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
        assert.equal(await flight.evaluate((element) => getComputedStyle(element).pointerEvents), "none")
        const pending = output.locator(".composition-card[data-adding]")
        assert.ok(await pending.count())
        assert.equal(
          await pending.evaluateAll((elements) =>
            elements.every((element) => element.inert && getComputedStyle(element).visibility === "hidden"),
          ),
          true,
          "New cards wait for the moving preview",
        )
        const focused = await page.evaluate(() => document.activeElement?.outerHTML)
        const source = await input.locator('.page-image[data-page="0"] canvas').boundingBox()
        const start = await flight.boundingBox()
        const sourceX = (Math.max(0, source.x) + Math.min(width, source.x + source.width)) / 2,
          sourceY = (Math.max(0, source.y) + Math.min(height, source.y + source.height)) / 2
        assert.ok(Math.abs(start.x + start.width / 2 - sourceX) < 1, `${width} ${density}: Input x`)
        assert.ok(Math.abs(start.y + start.height / 2 - sourceY) < 1, `${width} ${density}: Input y`)
        const button = page.locator(".mobile-workspace-tabs > button:last-child")
        const destination = (await button.isVisible())
          ? button
          : output.locator(".composition-card.selected .page-image").first()
        if (!(await button.isVisible()))
          await page.waitForFunction(
            () =>
              document
                .querySelector(".composition-output .composition-card.selected .thumbnail")
                ?.getAttribute("aria-busy") === "false",
          )
        const end = await destination.evaluate((element) => {
          const bounds = element.querySelector("canvas")?.getBoundingClientRect()
          const rectangle = bounds?.width && bounds.height ? bounds : element.getBoundingClientRect()
          return { x: rectangle.x, y: rectangle.y, width: rectangle.width, height: rectangle.height }
        })
        await flight.evaluate((element) => {
          const animation = element.getAnimations()[0]
          animation.currentTime = animation.effect.getTiming().duration / 2
        })
        const middle = await flight.boundingBox()
        if (await button.isVisible()) {
          const glow = await button.evaluate((element) => {
            const animation = element.getAnimations().find((item) => item.effect.getTiming().duration === 1200)
            if (!animation) return null
            animation.currentTime = 600
            return { duration: animation.effect.getTiming().duration, shadow: getComputedStyle(element).boxShadow }
          })
          assert.equal(glow?.duration, 1200, `${width} ${density}: Output glows during the complete flight`)
          assert.notEqual(glow.shadow, "none", `${width} ${density}: Output has a visible mid-flight glow`)
        }
        const dx = end.x + end.width / 2 - sourceX,
          dy = end.y + end.height / 2 - sourceY
        const bend =
          Math.abs(dx * (middle.y + middle.height / 2 - sourceY) - dy * (middle.x + middle.width / 2 - sourceX)) /
          Math.hypot(dx, dy)
        assert.ok(bend > 8, `${width} ${density}: the preview follows a curve`)
        await flight.evaluate((element) => {
          const animation = element.getAnimations()[0]
          animation.currentTime = animation.effect.getTiming().duration - 1
        })
        const landed = await flight.boundingBox()
        assert.ok(Math.abs(landed.x + landed.width / 2 - end.x - end.width / 2) < 1, `${width} ${density}: Output x`)
        assert.ok(Math.abs(landed.y + landed.height / 2 - end.y - end.height / 2) < 1, `${width} ${density}: Output y`)
        assert.ok(
          await flight.evaluate((element) => Number(getComputedStyle(element).opacity) > 0.9),
          "The preview stays visible until arrival",
        )
        if (!(await button.isVisible())) {
          const canvas = await destination.locator("canvas").evaluate((element) => {
            const bounds = element.getBoundingClientRect()
            return { width: bounds.width, height: bounds.height }
          })
          assert.ok(Math.abs(landed.width - canvas.width) < 1, `${density} to ${outputDensity}: image width`)
          assert.ok(Math.abs(landed.height - canvas.height) < 1, `${density} to ${outputDensity}: image height`)
        }
        assert.equal(await page.evaluate(() => document.activeElement?.outerHTML), focused)
        assert.equal(await page.locator(".composer").getAttribute("data-view"), "input")
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await finish()
        assert.equal(await pending.count(), 0, "Arrival reveals the complete group")
        assert.equal(
          await output
            .locator(".composition-card.selected")
            .first()
            .evaluate((element) => getComputedStyle(element).visibility),
          "visible",
        )
      }
      if (width === 1440) {
        await input.getByRole("button", { name: "Details for Input page 1", exact: true }).click()
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
        count++
        await flight.waitFor()
        assert.equal(await total(), count)
        assert.equal(await flight.getAttribute("data-copies"), "1")
        await page.setViewportSize({ width: width + 1, height })
        await flight.waitFor({ state: "detached" })
        assert.equal(await output.locator("[data-adding]").count(), 0, "Resize reveals the completed addition")
        assert.equal(await total(), count)
        await page.setViewportSize({ width, height })
        await tab(output, "Page")
        await prepared.fill("1")
        await prepared.press("Enter")
        count++
        await flight.waitFor()
        const heading = await output.locator("h2").boundingBox()
        await flight.evaluate((element) => {
          const animation = element.getAnimations()[0]
          animation.currentTime = animation.effect.getTiming().duration - 1
        })
        const landed = await flight.boundingBox()
        assert.ok(Math.abs(landed.x + landed.width / 2 - heading.x - heading.width / 2) < 1)
        assert.ok(Math.abs(landed.y + landed.height / 2 - heading.y - heading.height / 2) < 1)
        assert.equal(await total(), count, "An undisplayed insertion uses the Output heading")
        await finish()
        await output.getByRole("button", { name: "Select all", exact: true }).click()
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        count = 0
      }
      await tab(input, "Page")
      await zoom(input, "Fit page")
      await input.locator('.pdf-viewport[aria-busy="false"]').waitFor()
      for (let index = 0; index < 3; index++) await zoom(input, "Zoom in")
      await input.locator('.pdf-viewport[aria-busy="false"]').waitFor()
      await image(input).scrollIntoViewIfNeeded()
      const copy = async () => {
        if (hasTouch) {
          // Separate native double-tap gestures; four rapid taps need not produce two double-clicks.
          await page.waitForTimeout(400)
          await image(input).tap()
          await image(input).tap()
        } else await image(input).dblclick()
      }
      await copy()
      count++
      await flight.waitFor()
      assert.equal(await total(), count)
      assert.equal(await flight.getAttribute("data-copies"), "1")
      const visible = await input.locator(".page-scroll").boundingBox(),
        enlarged = await image(input).boundingBox(),
        origin = await flight.boundingBox()
      const x =
          (Math.max(0, visible.x, enlarged.x) +
            Math.min(width, visible.x + visible.width, enlarged.x + enlarged.width)) /
          2,
        y =
          (Math.max(0, visible.y, enlarged.y) +
            Math.min(height, visible.y + visible.height, enlarged.y + enlarged.height)) /
          2
      assert.ok(Math.abs(origin.x + origin.width / 2 - x) < 1, "Enlarged Page starts inside its visible viewport on x")
      assert.ok(Math.abs(origin.y + origin.height / 2 - y) < 1, "Enlarged Page starts inside its visible viewport on y")
      if (width === 1440) {
        assert.equal(await output.locator(".inspection-target").getAttribute("data-adding"), "true")
        assert.equal(
          await output.locator(".inspection-target").evaluate((element) => getComputedStyle(element).visibility),
          "hidden",
          "A new Page image also waits for arrival",
        )
      }
      await copy()
      count++
      await flight.waitFor()
      assert.equal(await total(), count, "Another addition does not wait for the paused preview")
      assert.equal(await flight.count(), 1, "Repeated additions replace the previous preview")
      await page.emulateMedia({ reducedMotion: "reduce" })
      await flight.waitFor({ state: "detached" })
      assert.equal(await output.locator("[data-adding]").count(), 0)
      await copy()
      count++
      assert.equal(await total(), count)
      assert.equal(await flight.count(), 0, "Reduced motion skips the preview and still adds the page")
      if (width === 1440) {
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await copy()
        await flight.waitFor()
        page.once("dialog", (dialog) => dialog.accept())
        await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
        await page.locator(".drop-zone").waitFor()
        assert.equal(await flight.count(), 0, "Leaving the workspace removes the paused preview")
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Addition previews use their target image or the action area", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, touch] of [
      [1440, 1100, false],
      [390, 844, true],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: touch,
        isMobile: touch,
        reducedMotion: "no-preference",
      })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        document.addEventListener("DOMContentLoaded", () =>
          new MutationObserver(() => {
            document.querySelectorAll(".addition-preview").forEach((element) =>
              element.getAnimations().forEach((animation) => {
                animation.pause()
                animation.currentTime = 0
              }),
            )
          }).observe(document.body, { childList: true }),
        )
      })
      for (const density of ["Normal", "Compact"]) {
        for (const action of ["card", "selection", "keyboard"]) {
          await page.goto(`${server.resolvedUrls.local[0]}?demo`)
          await page.waitForFunction(
            () => document.querySelector(".composition-totals strong")?.textContent === "6 pages",
          )
          const output = page.locator(".composition-output")
          const workspace = page.locator(".mobile-workspace-tabs > button:last-child")
          if (await workspace.isVisible()) await workspace.click()
          await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
          const source = output.locator('.page-image[data-page="1"] canvas')
          await page.waitForFunction(() =>
            [...document.querySelectorAll(".composition-output .thumbnail")].every(
              (element) => element.getAttribute("aria-busy") === "false",
            ),
          )
          if (action === "card" && density === "Compact")
            await output.getByRole("button", { name: "Details for Output page 2", exact: true }).click()
          if (action !== "card") await output.getByLabel("Page selection", { exact: true }).fill("2")
          const control =
            action === "card"
              ? output.getByRole("button", { name: "Duplicate Output page 2", exact: true })
              : action === "selection"
                ? output.getByRole("button", { name: "Duplicate selected Output pages", exact: true })
                : output.locator(".composition-grid")
          await control.scrollIntoViewIfNeeded()
          const start = await source.evaluate((element) => {
            const box = element.getBoundingClientRect()
            return [
              (Math.max(0, box.left) + Math.min(innerWidth, box.right)) / 2,
              (Math.max(0, box.top) + Math.min(innerHeight, box.bottom)) / 2,
            ]
          })
          const snapshot = await source.evaluateHandle(
            (element, event) => {
              const copy = document.createElement("canvas")
              // Capture before the action handler, after any selection-triggered redraw.
              document.addEventListener(
                event,
                () => {
                  copy.width = element.width
                  copy.height = element.height
                  copy.getContext("2d").drawImage(element, 0, 0)
                },
                { capture: true, once: true },
              )
              return copy
            },
            action === "keyboard" ? "keydown" : "click",
          )
          if (action === "keyboard") await control.press("Enter")
          else await control.click()
          const flight = page.locator(".addition-preview")
          await flight.waitFor()
          const result = await page.evaluate(
            ({ preview, sheet }) => {
              const box = preview.getBoundingClientRect()
              const expected = document.createElement("canvas")
              expected.width = preview.width
              expected.height = preview.height
              expected.getContext("2d").drawImage(sheet, 0, 0, expected.width, expected.height)
              const actual = preview.getContext("2d").getImageData(0, 0, preview.width, preview.height).data
              const pixels = expected.getContext("2d").getImageData(0, 0, expected.width, expected.height).data
              return {
                center: [box.left + box.width / 2, box.top + box.height / 2],
                sameImage: actual.every((value, index) => value === pixels[index]),
              }
            },
            { preview: await flight.elementHandle(), sheet: snapshot },
          )
          const label = `${width}, ${density}, ${action}`
          assert.ok(
            result.center.every((value, index) => Math.abs(value - start[index]) < 1),
            `${label}: animation starts at the targeted image ${JSON.stringify({ start, result })}`,
          )
          assert.equal(result.sameImage, true, `${label}: animation uses the targeted page's pixels`)
          await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
          await snapshot.dispose()
        }
      }
      for (const action of ["input", "copy", "repeat"]) {
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "6 pages",
        )
        const pane = page.locator(action === "input" ? ".selection-panel" : ".composition-output")
        const workspace = page.locator(`.mobile-workspace-tabs > button:${action === "input" ? "first" : "last"}-child`)
        if (await workspace.isVisible()) await workspace.click()
        await tab(pane, "Page")
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor()
        await pane.getByLabel("Page selection", { exact: true }).fill("2")
        if (action === "repeat") {
          await pane.getByLabel("Output page actions", { exact: true }).click()
          await pane.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("2")
        }
        const control = pane.getByRole("button", {
          name:
            action === "input"
              ? "Add to Output"
              : action === "copy"
                ? "Duplicate selected Output pages"
                : "Repeat selected pages",
          exact: true,
        })
        await control.scrollIntoViewIfNeeded()
        const bar = await pane.locator(".sequence-entry").boundingBox()
        await control.click()
        const flight = page.locator(".addition-preview")
        await flight.waitFor()
        const bounds = await flight.boundingBox()
        assert.ok(
          Math.abs(bounds.x + bounds.width / 2 - bar.x - bar.width / 2) < 1,
          `${width}, ${action}: an unavailable target uses the action area`,
        )
        assert.equal(
          await flight.evaluate((canvas) => canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3]),
          0,
          "The preview does not copy another inspected page",
        )
        await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
      }
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test(
  "Output additions, removals, and moves animate across page actions and shortcuts",
  { timeout: 120000 },
  async (t) => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const [width, height, hasTouch, colorScheme, cpu] of [
        [1440, 1100, false, "light", 4],
        [1024, 768, true, "dark", 1],
        [810, 1080, true, "dark", 1],
        [390, 844, true, "light", 4],
      ].filter(([viewportWidth]) => !standard || [1440, 390].includes(viewportWidth))) {
        const page = await browser.newPage({
          viewport: { width, height },
          hasTouch,
          isMobile: hasTouch,
          colorScheme,
          reducedMotion: "no-preference",
        })
        const rate = standard ? 1 : cpu
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate })
        t.diagnostic(`${width} × ${height}, ${colorScheme}, ${rate}× CPU slowdown`)
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "6 pages",
        )
        await page.evaluate(() => {
          new MutationObserver(() => {
            document.querySelectorAll(".addition-preview, .removal-preview").forEach((element) => {
              element.getAnimations().forEach((animation) => {
                animation.pause()
                animation.currentTime = 0
              })
            })
          }).observe(document.body, { childList: true })
        })
        const output = page.locator(".composition-output")
        const workspace = page.locator(".mobile-workspace-tabs > button:last-child")
        if (await workspace.isVisible()) await workspace.click()
        const selection = output.getByLabel("Page selection", { exact: true })
        const total = async () => Number.parseInt(await output.locator(".composition-totals strong").textContent(), 10)
        const finish = async (flight) => {
          await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
          await page.waitForFunction(() => !document.querySelector(".addition-preview, .removal-preview"))
        }
        const addition = async (action, quantity = 1, blank = false) => {
          const before = await total()
          await action()
          const flight = page.locator(".addition-preview")
          await flight.waitFor()
          await flight.evaluate(async (element) => {
            await element.getAnimations()[0].ready
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          })
          assert.equal(await flight.count(), 1, "Focus recovery does not cancel addition feedback")
          assert.equal(await total(), before + quantity, "Additions update the document before arrival")
          assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
          assert.equal(await output.locator(".composition-card[data-adding]").count(), quantity)
          if (blank)
            assert.equal(
              await flight.evaluate((canvas) => canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3]),
              0,
              "A Blank preview does not copy its neighbor's PDF image",
            )
          await finish(flight)
          assert.equal(await output.locator("[data-adding]").count(), 0)
        }
        const removal = async (action, quantity = 1) => {
          const before = await total()
          await output.locator(".composition-card").evaluateAll((cards) => {
            for (const card of cards)
              card.addEventListener(
                "outrostart",
                () =>
                  queueMicrotask(() => {
                    for (const animation of card.getAnimations()) {
                      animation.pause()
                      animation.currentTime = 0
                    }
                  }),
                { once: true },
              )
          })
          await action()
          assert.equal(await total(), before - quantity, "Removal updates the document without waiting")
          const outgoing = output.locator(".composition-card.removing")
          await page.waitForFunction(
            (expected) => document.querySelectorAll(".composition-card.removing").length === expected,
            quantity,
          )
          assert.equal(
            await outgoing.evaluateAll((cards) =>
              cards.every(
                (card) =>
                  card.inert &&
                  card.getAttribute("aria-hidden") === "true" &&
                  card.getAnimations().some((a) => a.effect.getTiming().duration === 1200),
              ),
            ),
            true,
          )
          await outgoing.evaluateAll((cards) =>
            cards.forEach((card) =>
              card.getAnimations().forEach((animation) => {
                animation.currentTime = 600
              }),
            ),
          )
          assert.equal(
            await outgoing.evaluateAll((cards) =>
              cards.every((card) => {
                const style = getComputedStyle(card)
                return (
                  Number(style.opacity) > 0.3 &&
                  Number(style.opacity) < 0.7 &&
                  new DOMMatrixReadOnly(style.transform).a < 1
                )
              }),
            ),
            true,
            "Removed cards fade and shrink over 1200 ms",
          )
          const positions = await output.locator(".composition-card:not(.removing)").evaluateAll((cards) =>
            cards.map((card) => {
              const { x, y } = card.getBoundingClientRect()
              const grid = card.parentElement.getBoundingClientRect()
              return { id: card.id, x: x - grid.x, y: y - grid.y }
            }),
          )
          await outgoing.evaluateAll((cards) =>
            cards.forEach((card) => card.getAnimations().forEach((animation) => animation.finish())),
          )
          await page.waitForFunction(() => !document.querySelector(".composition-card.removing"))
          await page.waitForFunction(() => {
            const animations = document
              .querySelector(".composition-output .composition-grid")
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.effect.getTiming().duration === 800 && animation.effect.getTiming().iterations === 1,
              )
            if (!animations.length) return false
            for (const animation of animations) {
              animation.pause()
              animation.currentTime = 400
            }
            return true
          })
          const reflow = await output.locator(".composition-grid").evaluate((grid) =>
            grid
              .getAnimations({ subtree: true })
              .filter(
                (animation) =>
                  animation.effect.getTiming().duration === 800 && animation.effect.getTiming().iterations === 1,
              )
              .map((animation) => {
                const card = animation.effect.target
                const middle = card.getBoundingClientRect()
                const frame = grid.getBoundingClientRect()
                animation.finish()
                const end = card.getBoundingClientRect()
                return {
                  id: card.id,
                  middle: { x: middle.x - frame.x, y: middle.y - frame.y },
                  end: { x: end.x - frame.x, y: end.y - frame.y },
                }
              }),
          )
          assert.ok(reflow.length, `${width}: remaining cards slide after the exit`)
          for (const { id, middle, end } of reflow) {
            const start = positions.find((position) => position.id === id)
            assert.ok(start, `${width}: reflow retains the remaining occurrence`)
            assert.ok(Math.hypot(middle.x - end.x, middle.y - end.y) > 1, `${width}: reflow has not snapped to its end`)
            assert.ok(Math.abs(2 * middle.x - start.x - end.x) < 1, `${width}: reflow x midpoint`)
            assert.ok(Math.abs(2 * middle.y - start.y - end.y) < 1, `${width}: reflow y midpoint`)
          }
        }
        // Keep the moving pair inside the smallest Normal batch.
        await selection.fill("1")
        if (
          !(await output
            .locator(".inline-moves")
            .getByRole("button", { name: "Move selected pages later", exact: true })
            .isVisible())
        )
          await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".output-pages")
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.effect.getTiming().duration === 1200),
        )
        if (width === 1440) {
          const elapsed = await output.locator(".composition-grid").evaluate(async (grid) => {
            const moving = grid
              .getAnimations({ subtree: true })
              .find((animation) => animation.effect.getTiming().duration === 1200)
            const started = performance.now(),
              current = Number(moving.currentTime)
            await moving.finished
            return current + performance.now() - started
          })
          assert.ok(elapsed >= 1100 && elapsed < 4000, `The first move lasts 1200 ms: ${elapsed}`)
        } else
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((animation) => animation.finish()))
        await output.locator(".composition-grid").press("Control+ArrowLeft")
        await page.waitForFunction(() =>
          document
            .querySelector(".output-pages")
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.effect.getTiming().duration === 1200),
        )
        await output
          .locator(".composition-grid")
          .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((animation) => animation.finish()))
        for (const density of ["Normal", "Compact"]) {
          t.diagnostic(`${width}: ${density} edit feedback`)
          await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
          const clear = output.getByRole("button", { name: "Clear Output selection", exact: true })
          if (await clear.isVisible()) await clear.click()
          const details = async () => {
            if (density === "Compact")
              await output.getByRole("button", { name: "Details for Output page 1", exact: true }).click()
          }
          const allActions = width === 1440 && density === "Normal"
          await details()
          await addition(() => output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click())
          if (allActions) {
            await selection.fill("1-2")
            await addition(
              () => output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click(),
              2,
            )
            await selection.fill("1")
            await addition(() => output.locator(".composition-grid").press("Enter"))
            assert.equal(
              await output
                .locator(".composition-card.selected .page-image")
                .evaluate((element) => element === document.activeElement),
              true,
              "Keyboard duplication focuses the copy after arrival",
            )
            await selection.fill("1")
            await output.getByLabel("Output page actions", { exact: true }).click()
            await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("2")
            await addition(() => output.getByRole("button", { name: "Repeat selected pages", exact: true }).click())
            for (const label of ["Blank before first selected page", "Add blank page at end"]) {
              await output.getByLabel("Output page actions", { exact: true }).click()
              await addition(() => output.getByRole("button", { name: label, exact: true }).click(), 1, true)
            }
          }
          await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
          await output.locator(".page-image").first().press("Home")
          await page.mouse.move(1, 1)
          await details()
          await removal(() => output.getByRole("button", { name: "Remove Output page 1", exact: true }).click())
          if (allActions) {
            for (const action of [
              () => output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click(),
              () => selection.press("Enter"),
              () => output.locator(".composition-grid").press("Delete"),
              () => output.locator(".composition-grid").press("-"),
            ]) {
              await selection.fill("1")
              await removal(action)
            }
          }
          await selection.fill("2-3")
          for (const direction of ["earlier", "later"]) {
            assert.equal(
              await output
                .locator(".inline-moves")
                .getByRole("button", {
                  name: `Move selected pages ${direction}`,
                  exact: true,
                })
                .isVisible(),
              width !== 390,
              `${width}: movement follows available pane width`,
            )
          }
          await selection.fill("1")
          const before = await output.locator(".composition-card").evaluateAll((cards) => cards.map((card) => card.id))
          await output.getByLabel("Output page actions", { exact: true }).click()
          await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
          await page.waitForFunction(() =>
            document
              .querySelector(".output-pages")
              ?.getAnimations({ subtree: true })
              .some((a) => a.effect.getTiming().duration === 1200),
          )
          const after = await output.locator(".composition-card").evaluateAll((cards) => cards.map((card) => card.id))
          assert.deepEqual(
            after.slice(0, 2),
            [before[1], before[0]],
            "Moves retain occurrence identity and print order",
          )
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((a) => a.finish()))
          await output.locator(".composition-grid").press("Control+ArrowLeft")
          await page.waitForFunction(() =>
            document
              .querySelector(".output-pages")
              ?.getAnimations({ subtree: true })
              .some((a) => a.effect.getTiming().duration === 1200),
          )
          await page.emulateMedia({ reducedMotion: "reduce" })
          await page.waitForFunction(
            () =>
              document
                .querySelector(".output-pages")
                ?.getAnimations({ subtree: true })
                .every((animation) => animation.playState !== "running"),
            undefined,
            { timeout: 500 },
          )
          await page.emulateMedia({ reducedMotion: "no-preference" })
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((a) => a.finish()))
        }
        await selection.fill("1")
        await output.locator(".composition-grid").press("Enter")
        await page.locator(".addition-preview").waitFor()
        assert.equal(
          await output.locator(".composition-grid").evaluate((element) => element === document.activeElement),
          true,
          "Keyboard focus stays in Grid while a new copy is hidden",
        )
        await output.locator(".composition-grid").press("Home")
        const first = output.getByRole("button", { name: "Select Output page 1", exact: true })
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 1")
        await finish(page.locator(".addition-preview"))
        assert.equal(
          await first.evaluate((element) => element === document.activeElement),
          true,
          "Arrival preserves navigation during the preview",
        )
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        await tab(output, "Page")
        await output.locator('.pdf-viewport[aria-busy="false"], .blank-sheet').waitFor()
        const copy = async () => {
          const sheet = output.locator(".page-scroll canvas, .blank-sheet")
          if (hasTouch) {
            await page.waitForTimeout(400)
            await sheet.tap()
            await sheet.tap()
          } else await sheet.dblclick()
        }
        let count = await total()
        for (const action of [copy, () => output.locator(".page-scroll").press("Space")]) {
          await action()
          assert.equal(await total(), ++count, `${width}: ${action.toString()}`)
          await page.locator(".addition-preview").waitFor()
          await finish(page.locator(".addition-preview"))
          assert.equal(await selection.inputValue(), "", "Page copies preserve the Output selection")
        }
        await output.getByRole("button", { name: /Remove Output page/, exact: false }).click()
        const flight = page.locator(".removal-preview")
        await flight.waitFor()
        assert.equal(await total(), --count)
        assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
        assert.equal(await output.locator(".inspection-target").getAttribute("data-removing"), "true")
        await finish(flight)
        assert.equal(await output.locator("[data-removing]").count(), 0)
        await selection.fill("1")
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".composition-output .page-scroll")
            ?.getAnimations({ subtree: true })
            .some((a) => a.effect.getTiming().duration === 1200),
        )
        await page.emulateMedia({ reducedMotion: "reduce" })
        await selection.fill("1")
        await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
        assert.equal(await total(), ++count)
        assert.equal(await page.locator(".addition-preview, .removal-preview").count(), 0)
        await selection.press("Enter")
        assert.equal(await total(), --count)
        assert.equal(await page.locator(".removal-preview").count(), 0)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await selection.fill(`1-${count}`)
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        assert.equal(await total(), 0)
        if (await workspace.isVisible()) await page.locator(".mobile-workspace-tabs > button:first-child").click()
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.locator(".selection-panel .thumbnail[aria-busy=false]").first().waitFor()
        await page.locator(".input-picker > summary").click()
        await page.getByRole("button", { name: "Remove Input", exact: true }).click()
        await page.locator(".removal-preview").first().waitFor()
        assert.equal(await page.locator(".selection-panel").count(), 0)
        assert.equal(
          await page
            .locator(".removal-preview")
            .evaluateAll((elements) =>
              elements.every(
                (element) =>
                  element.getAttribute("aria-hidden") === "true" &&
                  getComputedStyle(element).pointerEvents === "none" &&
                  element.getAnimations()[0].effect.getTiming().duration === 1200,
              ),
            ),
          true,
        )
        await page
          .locator(".removal-preview")
          .evaluateAll((elements) =>
            elements.forEach((element) => element.getAnimations().forEach((animation) => animation.finish())),
          )
        await page.waitForFunction(() => !document.querySelector(".removal-preview"))
        await page.close()
      }
    } finally {
      await browser?.close()
    }
  },
)

test("Bulk page actions consume preparations and preserve selected occurrences", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Bulk.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByRole("textbox", { name: "Page selection", exact: true })
    const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
    const inputOptions = input.getByLabel("Input page actions", { exact: true })
    const outputOptions = output.getByLabel("Output page actions", { exact: true })
    const inputRepeat = input.getByRole("textbox", { name: "Repetitions", exact: true })
    const outputRepeat = output.getByRole("textbox", { name: "Repeat selected sequence", exact: true })
    const inputFront = input.getByLabel("Start each repeat on front", { exact: true })
    const outputFront = output.getByLabel("Start each repeat on front", { exact: true })
    const order = () => output.locator(".page-origin-info .page-context").allTextContents()
    const total = () => output.locator(".composition-totals strong").textContent()
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click()
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input
      .getByRole("button", { name: "Select or drag Input page 4 to Output", exact: true })
      .click({ modifiers: ["Shift"] })
    assert.equal(await prepared.inputValue(), "4", "Addition consumes the preparation and resets its anchor")
    await input.getByRole("button", { name: "Select Input page 7", exact: true }).dblclick()
    assert.equal(await prepared.inputValue(), "")
    await input
      .getByRole("button", { name: "Select or drag Input page 6 to Output", exact: true })
      .click({ modifiers: ["Shift"] })
    assert.equal(await prepared.inputValue(), "6", "Double-click consumption resets the range anchor")
    await selected.fill("1-2")
    await selected.press("Enter")
    await prepared.fill("2,4")
    await inputOptions.click()
    await inputRepeat.fill("2")
    await inputFront.check()
    await prepared.press("Enter")
    assert.deepEqual(await order(), ["p. 2", "p. 4", "p. 2", "p. 4"])
    assert.equal(await selected.inputValue(), "1-4")
    assert.equal(await prepared.inputValue(), "")
    await inputOptions.click()
    assert.equal(await inputRepeat.inputValue(), "1")
    assert.equal(await inputFront.isChecked(), false)
    await inputRepeat.fill("2")
    await prepared.fill("1,3,1")
    await input
      .getByRole("button", { name: "Select or drag Input page 6 to Output", exact: true })
      .dragTo(output.locator(".section-heading"))
    assert.equal(await prepared.inputValue(), "1,3,1")
    assert.equal(await selected.inputValue(), "5")
    await input
      .getByRole("button", { name: "Select or drag Input page 7 to Output", exact: true })
      .dragTo(output.locator(".section-heading"))
    assert.equal(await total(), "6 pages")
    assert.equal(await prepared.inputValue(), "1,3,1")
    const data = await page.evaluateHandle(() => new DataTransfer())
    const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
    await grip.dispatchEvent("dragstart", { dataTransfer: data })
    await page.keyboard.press("Escape")
    assert.equal(await prepared.inputValue(), "1,3,1")
    assert.equal(await total(), "6 pages")
    await grip.dragTo(output.getByRole("button", { name: "Select Output page 2", exact: true }), {
      targetPosition: { x: 5, y: 40 },
    })
    assert.deepEqual(await order(), [
      "p. 2",
      "p. 1",
      "p. 3",
      "p. 1",
      "p. 1",
      "p. 3",
      "p. 1",
      "p. 4",
      "p. 2",
      "p. 4",
      "p. 6",
      "p. 7",
    ])
    assert.equal(await selected.inputValue(), "2-7")
    assert.equal(await prepared.inputValue(), "")
    await prepared.fill("1-7,1-4")
    await inputOptions.click()
    await inputRepeat.fill("1000")
    await inputFront.check()
    await prepared.press("Enter")
    assert.equal(await total(), "12 pages")
    assert.equal(await prepared.inputValue(), "1-7,1-4")
    assert.equal(await inputRepeat.inputValue(), "1000")
    assert.equal(await inputFront.isChecked(), true)
    await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
    await inputOptions.click()
    assert.equal(await inputRepeat.inputValue(), "1")
    assert.equal(await inputFront.isChecked(), false)
    await selected.fill("1-12")
    await selected.press("Enter")
    assert.equal(await total(), "0 pages")
    await prepared.fill("1-5")
    await prepared.press("Enter")
    await selected.fill("2,2,4")
    assert.equal(await output.locator(".composition-card.selected").count(), 2)
    await outputOptions.click()
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 0)
    await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).press("Enter")
    assert.equal(await selected.evaluate((element) => element === document.activeElement), true)
    assert.deepEqual(await order(), ["p. 2", "p. 1", "p. 4", "p. 3", "p. 5"])
    assert.equal(await selected.inputValue(), "1, 3")
    await outputOptions.click()
    assert.equal(
      await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).isDisabled(),
      true,
    )
    await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
    assert.deepEqual(await order(), ["p. 1", "p. 2", "p. 3", "p. 4", "p. 5"])
    assert.equal(await selected.inputValue(), "2, 4")
    await ready()
    await output
      .getByRole("button", { name: "Select or drag Output page 4", exact: true })
      .dragTo(output.locator(".section-heading"))
    assert.deepEqual(await order(), ["p. 1", "p. 3", "p. 5", "p. 2", "p. 4"])
    assert.equal(await selected.inputValue(), "4-5")
    await tab(output, "Page")
    assert.match(await pagePosition(output), /5\s*\/ 5/)
    await tab(output, "Grid")
    const moved = output.getByRole("button", { name: "Select or drag Output page 4", exact: true })
    await moved.dispatchEvent("dragstart", { dataTransfer: data })
    await output.locator(".composition-card").nth(4).dispatchEvent("dragover", { dataTransfer: data })
    await output.locator(".composition-card").nth(4).dispatchEvent("drop", { dataTransfer: data })
    assert.deepEqual(await order(), ["p. 1", "p. 3", "p. 5", "p. 2", "p. 4"])
    assert.equal(await selected.inputValue(), "4-5")
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    assert.equal(await selected.inputValue(), "6-7")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    assert.equal(await selected.inputValue(), "", "Group removal clears its targets")
    assert.equal(await selected.evaluate((element) => element === document.activeElement), true)
    await output.getByRole("button", { name: "Remove Output page 4", exact: true }).click()
    assert.equal(await selected.inputValue(), "")
    await selected.fill("2-3")
    await outputOptions.click()
    await outputRepeat.fill("3")
    await outputFront.check()
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click()
    assert.equal(await total(), "9 pages")
    assert.equal(await selected.inputValue(), "7-8")
    await outputOptions.click()
    assert.equal(await outputRepeat.inputValue(), "2")
    assert.equal(await outputFront.isChecked(), false)
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click()
    assert.equal(await total(), "11 pages")
    assert.equal(await selected.inputValue(), "9-10")
    await selected.fill("99")
    assert.equal(await selected.getAttribute("aria-invalid"), "true")
    assert.equal(
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).isDisabled(),
      true,
    )
    await selected.press("Enter")
    assert.equal(await total(), "11 pages")
    await selected.fill("9-11")
    await outputOptions.click()
    await outputRepeat.fill("4")
    await output.getByRole("button", { name: "Reset Output repetitions", exact: true }).click()
    assert.equal(await outputRepeat.inputValue(), "2")
    await outputRepeat.fill("3")
    await outputFront.check()
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    assert.equal(await selected.inputValue(), "")
    await selected.fill("9-11")
    await outputOptions.click()
    assert.equal(await outputRepeat.inputValue(), "2")
    assert.equal(await outputFront.isChecked(), false)
    await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
    assert.equal(await selected.inputValue(), "9")
    await outputOptions.click()
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
    assert.equal(await selected.inputValue(), "13")
    await selected.fill("1-13")
    await selected.press("Enter")
    assert.equal(await total(), "0 pages")
    assert.equal(await selected.inputValue(), "")
    await prepared.fill("3,1,3")
    await inputOptions.click()
    await inputRepeat.fill("2")
    await inputFront.check()
    await page.keyboard.press("Escape")
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Bulk.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    await page.waitForFunction(() => document.querySelector(".input-heading .count")?.textContent === "2")
    assert.equal(await prepared.inputValue(), "", "Reopening a PDF starts an independent preparation")
    await inputOptions.click()
    assert.equal(await inputRepeat.inputValue(), "1")
    assert.equal(await inputFront.isChecked(), false)
    await page.keyboard.press("Escape")
    await prepared.fill("1,2")
    await page.locator(".input-picker > summary").click()
    await page.locator(".input-list button[data-source]").first().click()
    assert.equal(await prepared.inputValue(), "3,1,3", "Reopened PDFs keep independent ordered preparations")
    assert.equal(await input.locator(".composition-card.selected").count(), 2)
    assert.equal(await total(), "0 pages")
    await data.dispose()
  } finally {
    await browser?.close()
  }
})

test("Edited Padding retains its dimensions and page order in the downloaded PDF", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    const original = fixture()
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Padding.pdf",
      mimeType: "application/pdf",
      buffer: original,
    })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    const prepared = input.getByRole("textbox", { name: "Page selection", exact: true })
    const selected = output.getByRole("textbox", { name: "Page selection", exact: true })
    const options = output.getByLabel("Output page actions", { exact: true })
    await prepared.fill("7")
    await prepared.press("Enter")
    await prepared.fill("1-3")
    await input.getByLabel("Input page actions", { exact: true }).click()
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
    await input.getByLabel("Start each repeat on front", { exact: true }).check()
    await prepared.press("Enter")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "10 pages")
    assert.equal((await output.locator(".output-state").innerText()).trim(), "10 pages, 5 sheets")
    await selected.fill("2")
    await options.click()
    await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
    assert.equal(await selected.inputValue(), "3")
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
    assert.equal(await selected.inputValue(), "4")
    await selected.fill("3")
    await selected.press("Enter")
    await selected.fill("1")
    await options.click()
    await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
    assert.equal(await selected.inputValue(), "1")
    assert.deepEqual(await output.locator(".page-origin-info .page-context").allTextContents(), [
      "297.0 × 210.0 mm",
      "p. 7",
      "p. 1",
      "297.0 × 210.0 mm",
      "p. 2",
      "p. 3",
      "210.0 × 297.0 mm",
      "p. 1",
      "p. 2",
      "p. 3",
      "210.0 × 297.0 mm",
    ])
    const saved = page.waitForEvent("download")
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const download = await saved
    assert.equal(await download.failure(), null)
    const result = await page.evaluate(
      async ({ inputBytes, downloaded }) => {
        const { openPDF, loadRenderer } = await import("/src/pdf.ts")
        const { AnnotationMode } = await loadRenderer()
        const tasks = await Promise.all([openPDF(Uint8Array.from(inputBytes)), openPDF(Uint8Array.from(downloaded))])
        try {
          const [sourceDocument, resultDocument] = await Promise.all(tasks.map((task) => task.promise))
          const expected = ["landscape", 7, 1, "landscape", 2, 3, "portrait", 1, 2, 3, "portrait"]
          const failures = []
          for (const [index, source] of expected.entries()) {
            const actual = await resultDocument.getPage(index + 1)
            const size = actual.getViewport({ scale: 1 })
            const reference = await sourceDocument.getPage(
              typeof source === "number" ? source : source === "landscape" ? 7 : 1,
            )
            const dimensions = reference.getViewport({ scale: 1 })
            if (Math.abs(size.width - dimensions.width) > 0.01 || Math.abs(size.height - dimensions.height) > 0.01)
              failures.push(`Page ${index + 1}: dimensions differ from ${source}`)
            const render = async (sheet) => {
              const canvas = document.createElement("canvas")
              const viewport = sheet.getViewport({ scale: 0.25 })
              canvas.width = Math.ceil(viewport.width)
              canvas.height = Math.ceil(viewport.height)
              await sheet.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise
              return canvas.getContext("2d").getImageData(0, 0, canvas.width, canvas.height).data
            }
            const pixels = await render(actual)
            const expectedPixels = typeof source === "number" ? await render(reference) : undefined
            if (
              expectedPixels
                ? pixels.length !== expectedPixels.length || pixels.some((value, i) => value !== expectedPixels[i])
                : pixels.some((value) => value !== 255)
            )
              failures.push(`Page ${index + 1}: appearance differs from ${source}`)
            actual.cleanup()
            reference.cleanup()
          }
          return { count: resultDocument.numPages, failures }
        } finally {
          await Promise.all(tasks.map((task) => task.destroy()))
        }
      },
      { inputBytes: Array.from(original), downloaded: Array.from(await readFile(await download.path())) },
    )
    assert.deepEqual(result, { count: 11, failures: [] })
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
  }
})

test("Grid boundary duplication focuses the final new Output occurrence", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const output = page.locator(".composition-output")
    await output.getByLabel("Page selection", { exact: true }).fill("2,6")
    await output.getByRole("button", { name: "Select Output page 6", exact: true }).press("ArrowRight")
    await page.waitForFunction(() => document.activeElement?.matches(".output-pages"))
    await page.keyboard.press("Enter")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "8 pages")
    assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "7-8")
    assert.equal(
      await output
        .getByRole("button", { name: "Select Output page 8", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await page.keyboard.press("v")
    assert.match(await pagePosition(output), /8\s*\/ 8/)
    assert.equal(
      await page.locator(".selection-panel").getByLabel("Page selection", { exact: true }).inputValue(),
      "3-5,2,2,7",
    )
  } finally {
    await browser?.close()
  }
})
