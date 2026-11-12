// Checks header feedback geometry, cancellation, and compact Download recovery.

import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, readFile } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, devices } from "playwright"
import { serve } from "./server.ts"
import { fixture, outputAction } from "./browser.js"

test("Landing and workspace share desktop edges", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const mode of ["mouse", "hybrid"]) {
    const browser = await launch(chromium, {
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      args:
        mode === "hybrid"
          ? ["--blink-settings=primaryPointerType=4,availablePointerTypes=6,primaryHoverType=2,availableHoverTypes=2"]
          : [],
    })
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      const cases =
        mode === "hybrid"
          ? [[1920, 1232]]
          : [
              [1440, 1232],
              [1920, 1232],
              [2560, 1472],
              [3840, 2208],
            ]
      for (const [width, expected] of cases) {
        for (const text of ["100%", "200%"]) {
          for (const colorScheme of ["light", "dark"]) {
            await page.setViewportSize({ width, height: 1080 })
            await page.emulateMedia({ colorScheme })
            await page.goto(server.resolvedUrls.local[0])
            assert.equal(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches), mode === "hybrid")
            await page.evaluate(async (value) => {
              document.documentElement.style.fontSize = value
              await document.fonts.ready
            }, text)
            const landing = await page.locator(".drop-zone").boundingBox()
            const header = await page.locator(".masthead").boundingBox()
            assert.ok(Math.abs(header.width - expected) < 1, JSON.stringify({ width, text, header }))
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            if (text === "100%" && [1920, 2560].includes(width)) {
              const directory = resolve("../.local/var/web/feedback")
              await mkdir(directory, { recursive: true })
              await page.screenshot({ path: resolve(directory, `landing-${width}-${colorScheme}.png`), fullPage: true })
            }
            await page
              .locator("input[type=file]")
              .first()
              .setInputFiles({ name: "Shared frame.pdf", mimeType: "application/pdf", buffer: fixture() })
            await page.locator(".composer[aria-busy=false]").waitFor()
            const workspace = await page.locator(".composer").boundingBox()
            const openedHeader = await page.locator(".masthead").boundingBox()
            assert.ok(
              Math.abs(landing.x - workspace.x) < 1 && Math.abs(landing.width - workspace.width) < 1,
              JSON.stringify({ width, text, landing, workspace }),
            )
            assert.ok(
              Math.abs(header.x - openedHeader.x) < 1 && Math.abs(header.width - openedHeader.width) < 1,
              JSON.stringify({ width, text, header, openedHeader }),
            )
          }
        }
      }
    } finally {
      await browser.close()
    }
  }
})

async function bounds(page, feedback) {
  const result = await feedback.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const header = document.querySelector(".header-inner").getBoundingClientRect()
    const message = element.querySelector(".feedback-message").getBoundingClientRect()
    const actions = element.querySelector(":scope > .feedback-actions")?.getBoundingClientRect()
    const spinner = element.querySelector(":scope > .spinner")?.getBoundingClientRect()
    const controls = Array.from(document.querySelectorAll(".header-inner > .brand, .header-actions"), (control) =>
      getComputedStyle(control).visibility === "hidden" ? undefined : control.getBoundingClientRect().toJSON(),
    ).filter(Boolean)
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      rect: rect.toJSON(),
      header: header.toJSON(),
      message: message.toJSON(),
      actions: actions?.toJSON(),
      spinner: spinner?.toJSON(),
      controls,
    }
  })
  assert.equal(result.overflow, false, JSON.stringify(result))
  assert.ok(result.rect.left >= 0 && result.rect.right <= result.width, JSON.stringify(result))
  assert.ok(
    Math.abs(result.rect.x + result.rect.width / 2 - result.header.x - result.header.width / 2) < 1,
    JSON.stringify(result),
  )
  if (result.spinner)
    assert.ok(
      Math.abs(result.spinner.y + result.spinner.height / 2 - result.message.y - result.message.height / 2) < 1,
      JSON.stringify(result),
    )
  if (result.actions) {
    if (result.spinner) assert.ok(result.message.left - result.spinner.right <= 24, JSON.stringify(result))
    assert.ok(result.actions.left - result.message.right <= 24, JSON.stringify(result))
    assert.ok(
      result.message.right <= result.actions.left + 1 || result.message.bottom <= result.actions.top + 1,
      JSON.stringify(result),
    )
  }
  if (await feedback.evaluate((element) => !!element.closest(".header-feedback")))
    for (const control of result.controls)
      assert.ok(
        result.rect.right <= control.left + 1 ||
          result.rect.left >= control.right - 1 ||
          result.rect.top >= control.bottom - 1 ||
          result.rect.bottom <= control.top + 1,
        JSON.stringify(result),
      )
  return result
}

const frames = (page) =>
  page.evaluate(() => new Promise((finish) => requestAnimationFrame(() => requestAnimationFrame(finish))))

test("Header messages fit representative Apple touch layouts", { timeout: 90000 }, async () => {
  const server = await serve()
  const inventory = JSON.parse(await readFile(new URL("./viewports.json", import.meta.url), "utf8"))
  const directory = resolve("../.local/tmp/web/layout/feedback")
  await mkdir(directory, { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const [device, reference, landscape] of [
        ["iPhone SE (3rd gen)", "375x667-coarse", true],
        ["iPhone 16", "393x852-coarse", false],
        ["iPad Mini", "744x1133-coarse", true],
        ["iPad (gen 7)", "810x1080-coarse", false],
      ]) {
        const entry = inventory.cases.find((value) => value.id === reference)
        const [width, height] = entry.viewport
        const page = await browser.newPage({ ...devices[device], viewport: { width, height }, reducedMotion: "reduce" })
        page.setDefaultTimeout(10000)
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        await page.addInitScript(() => {
          localStorage.setItem("mainz:onboarding", "19")
          localStorage.setItem("mainz:installation", "seen")
        })
        const fit = async (popup) => {
          const geometry = await popup.evaluate((element) => ({
            box: element.getBoundingClientRect().toJSON(),
            width: innerWidth,
            height: innerHeight,
            overflow: element.scrollWidth > element.clientWidth + 1,
          }))
          assert.ok(
            !geometry.overflow &&
              geometry.box.x >= -1 &&
              geometry.box.right <= geometry.width + 1 &&
              geometry.box.y >= -1 &&
              geometry.box.bottom <= geometry.height + 1,
            JSON.stringify({ engine: engine.name(), reference, geometry }),
          )
        }
        await page.goto(`${server.resolvedUrls.local[0]}?demo=recipe-review`)
        const feedback = page.locator(".header-feedback > .feedback")
        await feedback.waitFor()
        assert.equal(await feedback.count(), 1)
        await bounds(page, feedback)
        const review = page.locator(".binding-check:popover-open")
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          await feedback.getByRole("button", { name: "Review PDF", exact: true }).tap()
          await fit(review)
          await frames(page)
          await page.screenshot({ path: resolve(directory, `${engine.name()}-${reference}-review-${text}.png`) })
          const box = await review.boundingBox()
          const header = await page.locator(".header-inner").boundingBox()
          assert.ok(box.y >= header.y + header.height - 1, JSON.stringify({ reference, text, box, header }))
          if (text === "100%") await page.keyboard.press("Escape")
        }
        if (reference === "375x667-coarse") {
          const reasons = review.getByRole("region", { name: "PDF check details", exact: true })
          await reasons.focus()
          await page.keyboard.press("PageDown")
          await page.waitForFunction(
            () => document.querySelector(".binding-check:popover-open .binding-details").scrollTop > 0,
          )
        }
        const approval = review.getByRole("button", { name: "Use anyway", exact: true })
        const target = await approval.boundingBox()
        const panel = await review.boundingBox()
        assert.ok(target.y >= panel.y && target.y + target.height <= panel.y + panel.height)
        await approval.tap()
        await page.getByRole("button", { name: "Apply recipe", exact: true }).tap()
        await feedback.getByRole("button", { name: "References updated", exact: true }).waitFor()
        const cases = [
          [width, height, "100%", "light"],
          [width, height, "200%", "dark"],
        ]
        if (landscape) cases.push([height, width, "200%", "light"])
        for (const [w, h, text, colorScheme] of cases) {
          await page.setViewportSize({ width: w, height: h })
          await page.emulateMedia({ colorScheme })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          await feedback.getByRole("button", { name: "References updated", exact: true }).tap()
          const popup = page.locator(".message-details:popover-open")
          await bounds(page, feedback)
          await fit(popup)
          const boxes = await popup
            .locator("form > :is(button, .entry)")
            .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
          assert.equal(boxes.length, 4)
          assert.ok(
            boxes.every(
              (box) => Math.abs(box.width - boxes[0].width) < 1 && Math.abs(box.height - boxes[0].height) < 1,
            ),
            JSON.stringify(boxes),
          )
          const filename = popup.getByRole("textbox", { name: "Filename", exact: true })
          const before = await page.evaluate(() => ({
            scroll: [scrollX, scrollY],
            top: document.querySelector(".composer").getBoundingClientRect().y + scrollY,
          }))
          await filename.fill("bad/name.json")
          await feedback.getByRole("alert").waitFor()
          await bounds(page, feedback)
          await fit(popup)
          await popup.getByRole("button", { name: "Save", exact: true }).scrollIntoViewIfNeeded()
          assert.ok(await popup.getByRole("button", { name: "Save", exact: true }).isDisabled())
          assert.deepEqual(
            await page.evaluate(() => ({
              scroll: [scrollX, scrollY],
              top: document.querySelector(".composer").getBoundingClientRect().y + scrollY,
            })),
            before,
          )
          await filename.fill("References.json")
          await page.screenshot({ path: resolve(directory, `${engine.name()}-${reference}-${w}x${h}-${text}.png`) })
          await page.keyboard.press("Escape")
          assert.equal(await feedback.count(), 1)
        }
        if (landscape) {
          await page.setViewportSize({ width, height })
          await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
          const output = page.getByRole("button", { name: "Output", exact: true })
          if (await output.isVisible()) await output.tap()
          await (await outputAction(page, "Export recipe")).tap()
          const recipe = page.getByRole("dialog", { name: "Export recipe", exact: true })
          await recipe.getByRole("button", { name: "Edit Name 1", exact: true }).tap()
          const name = recipe.getByRole("textbox", { name: "Name 1", exact: true })
          const before = await name.boundingBox()
          await name.fill("")
          await feedback.getByRole("alert").waitFor()
          await bounds(page, feedback)
          assert.ok(
            await feedback.evaluate((element) => element.closest("dialog") === document.querySelector("dialog:modal")),
          )
          assert.deepEqual(await name.boundingBox(), before)
          await feedback.getByRole("button", { name: "Check Input names", exact: true }).tap()
          await fit(page.locator(".message-details:popover-open"))
          await page.screenshot({ path: resolve(directory, `${engine.name()}-${reference}-modal.png`) })
          await page.keyboard.press("Escape")
          await recipe.getByRole("button", { name: "Close recipe", exact: true }).tap()
        }
        assert.deepEqual(errors, [])
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Field errors share concise header feedback without moving fields or footer status",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1100, height: 900 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
        await page.locator(".composer[aria-busy=false]").waitFor()
        const status = page.locator(".footnote [role=status]")
        const original = await status.textContent()
        const input = page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true })
        const feedback = page.locator('.header-feedback .feedback[data-kind="error"]')
        const errors = []
        page.on("pageerror", (error) => errors.push(error.message))
        for (const [width, text, colorScheme] of [
          [1100, "100%", "dark"],
          [390, "100%", "light"],
          [320, "200%", "dark"],
        ]) {
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ colorScheme })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          )
          const before = await input.boundingBox()
          await input.fill("999")
          await feedback.getByRole("alert").waitFor()
          assert.equal(await input.getAttribute("aria-invalid"), "true")
          assert.equal(await feedback.getByRole("alert").textContent(), "Check Input selection")
          const after = await input.boundingBox()
          assert.ok(
            Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1,
            `${engine.name()}, ${width}px, ${text}: ${JSON.stringify({ before, after })}`,
          )
          assert.equal(await status.textContent(), original, "A warning does not replace workspace status")
          await bounds(page, feedback)
          await input.fill("1")
          await feedback.waitFor({ state: "hidden" })
        }
        await page.setViewportSize({ width: 1100, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await (await outputAction(page, "Export recipe")).click()
        const panel = page.getByRole("dialog", { name: "Export recipe", exact: true })
        await panel.getByRole("button", { name: "Edit Name 1", exact: true }).click()
        const name = panel.getByRole("textbox", { name: "Name 1", exact: true })
        const before = await name.boundingBox()
        await name.fill("")
        await feedback.getByRole("alert").waitFor()
        assert.equal(await feedback.getByRole("alert").textContent(), "Check Input names")
        assert.ok(
          await feedback.evaluate((element) => element.closest("dialog") === document.querySelector("dialog:modal")),
        )
        const after = await name.boundingBox()
        assert.ok(Math.abs(before.y - after.y) < 1 && Math.abs(before.height - after.height) < 1)
        await feedback.getByRole("alert").getByRole("button").click()
        assert.match(await page.locator(".message-details:popover-open").innerText(), /name/i)
        await page.keyboard.press("Escape")
        assert.ok(await panel.isVisible(), "Escape closes message details before the Recipe dialog")
        await panel.getByRole("button", { name: "Close recipe", exact: true }).click()
        await feedback.waitFor({ state: "hidden" })
        assert.equal(await status.textContent(), original)
        assert.deepEqual(errors, [])
      } finally {
        await browser.close()
      }
    }
  },
)

test("Touch dialog focus stays quiet and keyboard focus stays visible", { timeout: 30000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        reducedMotion: "reduce",
      })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.holdExport && message.plan) return
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      await page.getByRole("button", { name: "Output", exact: true }).tap()
      await page.evaluate(() => (window.holdExport = true))
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).tap()
      const dialog = page.getByRole("dialog", { name: "Download", exact: true })
      const cancel = dialog.getByRole("button", { name: "Cancel", exact: true })
      await cancel.waitFor()
      assert.equal(
        await cancel.evaluate((button) => {
          const style = getComputedStyle(button)
          return (
            style.outlineStyle === "none" || style.outlineWidth === "0px" || style.outlineColor === "rgba(0, 0, 0, 0)"
          )
        }),
        true,
      )
      await page.keyboard.press("Tab")
      await cancel.focus()
      assert.equal(
        await cancel.evaluate((button) => {
          const style = getComputedStyle(button)
          return (
            style.outlineStyle !== "none" && style.outlineWidth !== "0px" && style.outlineColor !== "rgba(0, 0, 0, 0)"
          )
        }),
        true,
      )
      await cancel.tap()
      assert.equal(await dialog.isVisible(), false)
    } finally {
      await browser.close()
    }
  }
})

test("Header progress preserves workspace bounds and scroll at narrow widths", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ hasTouch: true, reducedMotion: "reduce" })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.holdStyles && (message.changes || message.plan)) return
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(server.resolvedUrls.local[0] + "?demo=single")
      await page.locator(".composer[aria-busy=false]").waitFor()
      const geometry = () =>
        page.evaluate(() => ({
          scroll: [scrollX, scrollY],
          boxes: [".header-inner", "main", ".composer"].map((selector) => {
            const box = document.querySelector(selector).getBoundingClientRect()
            return selector === ".header-inner" ? { y: box.y, height: box.height } : { y: box.y }
          }),
        }))
      for (const width of [320, 390, 810, 1024])
        for (const text of ["100%", "200%"]) {
          await page.setViewportSize({ width, height: 900 })
          await page.emulateMedia({ colorScheme: text === "100%" ? "dark" : "light" })
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const input = page.getByRole("button", { name: "Input", exact: true })
          if (await input.isVisible()) await input.click()
          await page.locator(".selection-panel").getByRole("tab", { name: "Style", exact: true }).click()
          const profile = page.getByRole("combobox", { name: "Style profile", exact: true })
          await profile.scrollIntoViewIfNeeded()
          await page.evaluate(() => (window.holdStyles = true))
          const before = await geometry()
          const current = await profile.inputValue()
          const choices = await profile
            .locator("option:not([disabled])")
            .evaluateAll((options) => options.map((option) => option.value))
          await profile.selectOption(choices.find((value) => value !== current))
          const cancel = page.getByRole("button", { name: "Cancel style processing", exact: true })
          await cancel.waitFor()
          assert.deepEqual(await geometry(), before, JSON.stringify({ engine: engine.name(), width, text }))
          assert.ok(await cancel.isEnabled())
          await cancel.click()
          await page.evaluate(() => (window.holdStyles = false))
          await page.locator(".header-feedback").getByRole("alert").getByRole("button").click()
          const retry = page.getByRole("button", { name: "Retry Input styles", exact: true })
          await retry.click()
          await cancel.waitFor({ state: "hidden" })
        }
    } finally {
      await browser.close()
    }
  }
})

async function matrix(page, feedback, name, settle = () => frames(page)) {
  const directory = resolve("../.local/var/web/feedback")
  await mkdir(directory, { recursive: true })
  for (const width of [320, 390, 768, 839, 936, 951, 1024, 1100, 1440]) {
    for (const text of ["100%", "200%"]) {
      for (const colorScheme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        await settle()
        await bounds(page, feedback)
        if ((await feedback.getAttribute("data-kind")) !== "error") {
          const treatment = await feedback.evaluate((element) => {
            const style = getComputedStyle(element.querySelector("p"))
            const canvas = document.createElement("canvas")
            canvas.width = canvas.height = 1
            const context = canvas.getContext("2d")
            context.fillStyle = style.color
            context.fillRect(0, 0, 1, 1)
            return { weight: style.fontWeight, pixel: Array.from(context.getImageData(0, 0, 1, 1).data) }
          })
          assert.equal(treatment.weight, "700")
          assert.deepEqual(treatment.pixel, colorScheme === "dark" ? [255, 255, 255, 255] : [0, 0, 0, 255])
        }
        if ([320, 1440].includes(width) && text === "100%")
          await page.screenshot({ path: resolve(directory, `${name}-${width}-${colorScheme}.png`), fullPage: true })
      }
    }
  }
}

test(
  "Header notices and PDF opening retain usable actions at narrow and enlarged widths",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine, {
        channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL || undefined : undefined,
      })
      try {
        const page = await browser.newPage({ userAgent: "iPhone Safari", reducedMotion: "reduce" })
        await page.addInitScript(() => {
          localStorage.setItem("mainz:onboarding", "19")
          const read = File.prototype.arrayBuffer
          File.prototype.arrayBuffer = function () {
            return new Promise((finish) => {
              window.releaseOpening = () => finish(read.call(this))
            })
          }
        })
        await page.clock.install()
        await page.clock.pauseAt(new Date())
        await page.goto(server.resolvedUrls.local[0])
        await page.getByRole("button", { name: "Use browser", exact: true }).click()
        const notice = page.locator(".header-feedback .notice")
        await notice.waitFor()
        await matrix(page, notice, "notice", () => page.clock.runFor(50))
        await notice.getByRole("status").getByRole("button").click()
        await notice.getByRole("button", { name: "Dismiss notification", exact: true }).focus()
        await notice.getByRole("button", { name: "Dismiss notification", exact: true }).click()
        await page.locator(".header-actions .help-button:focus").waitFor()
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name:
              "A very long publication filename with many sections and an unbroken-" + "segment".repeat(12) + ".pdf",
            mimeType: "application/pdf",
            buffer: fixture(),
          })
        const progress = page.locator('.header-feedback .feedback[data-kind="progress"]')
        await progress.waitFor()
        await matrix(page, progress, "opening", () => page.clock.runFor(50))
        assert.equal(
          await progress.locator(".feedback-message > p").getAttribute("title"),
          await progress
            .locator(".feedback-message > p")
            .textContent()
            .then((value) => value.trim()),
        )
        await progress.getByRole("button", { name: "Cancel", exact: true }).click()
        await page.evaluate(() => window.releaseOpening())
        assert.equal(await page.locator(".drop-zone").isVisible(), true)
        assert.match(await page.locator(".footnote").textContent(), /Opening cancelled/)
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Source recovery retains readable messages and reachable Retry with enlarged phone text",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    await mkdir(resolve("../.local/var/web/feedback"), { recursive: true })
    for (const engine of engines) {
      const browser = await launch(engine, {
        channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL || undefined : undefined,
      })
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
        await page.addInitScript(() => {
          localStorage.setItem("mainz:onboarding", "19")
          const Original = Worker
          window.Worker = class extends Original {
            postMessage(message, ...rest) {
              if (window.holdStyles && (message.changes || message.plan)) return
              super.postMessage(message, ...rest)
            }
          }
        })
        await page.goto(server.resolvedUrls.local[0] + "?demo=single")
        await page.locator(".composer[aria-busy=false]").waitFor()
        await page.locator(".selection-panel").getByRole("tab", { name: "Style", exact: true }).click()
        await page.evaluate(() => (window.holdStyles = true))
        await page.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
        await page.getByRole("button", { name: "Cancel style processing", exact: true }).click()
        const error = page.locator('.header-feedback .feedback[data-kind="error"]')
        await error.getByRole("alert").waitFor()
        for (const width of [320, 390]) {
          for (const colorScheme of ["light", "dark"]) {
            await page.setViewportSize({ width, height: 568 })
            await page.emulateMedia({ colorScheme })
            await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
            const message = await error.locator(".feedback-message").boundingBox()
            assert.ok(message.width > 0)
            await bounds(page, error)
            const text = error.getByRole("alert")
            assert.equal(await text.getAttribute("title"), (await text.innerText()).trim())
            assert.equal(await text.innerText(), "Style update failed")
            await error.getByRole("alert").getByRole("button").click()
            assert.match(await page.locator(".message-details:popover-open").innerText(), /cancelled/)
            const retry = error.getByRole("button", { name: "Retry Input styles", exact: true })
            await retry.scrollIntoViewIfNeeded()
            const target = await retry.boundingBox()
            assert.ok(
              target.width >= 44 && target.height >= 44 && target.y >= 0 && target.y + target.height <= 568,
              JSON.stringify({
                engine: engine.name(),
                width,
                target,
                header: await page.locator(".header-inner").boundingBox(),
              }),
            )
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            await page.screenshot({
              path: resolve(`../.local/var/web/feedback/recovery-${engine.name()}-${width}-${colorScheme}.png`),
            })
            await page.keyboard.press("Escape")
          }
        }
        await page.evaluate(() => (window.holdStyles = false))
        await error.getByRole("alert").getByRole("button").click()
        await error.getByRole("button", { name: "Retry Input styles", exact: true }).click()
        await error.waitFor({ state: "detached" })
        await page.locator(".header-feedback .style-progress").waitFor({ state: "detached" })
        assert.equal(await page.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Download feedback stays at the header and retains modal cancellation and Retry",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    for (const engine of engines) {
      const browser = await launch(engine, {
        channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL || undefined : undefined,
      })
      try {
        const page = await browser.newPage({ reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0] + "?demo=single")
        await page.locator(".composer[aria-busy=false]").waitFor()
        let release
        const held = new Promise((finish) => (release = finish))
        await page.route("**/processor.mjs", async (route) => {
          await held
          await route.continue().catch(() => {})
        })
        const download = page.locator(".composer").getByRole("button", { name: "Download", exact: true })
        await download.click()
        const dialog = page.getByRole("dialog", { name: "Download", exact: true })
        await dialog.getByText("Preparing PDF…", { exact: true }).waitFor()
        assert.equal(await dialog.evaluate((element) => element.matches(":modal")), true)
        await matrix(page, dialog.locator(".feedback"), "download")
        assert.ok((await dialog.boundingBox()).y < 80)
        await page.keyboard.press("Escape")
        release()
        await page.unroute("**/processor.mjs")
        assert.equal(await dialog.isVisible(), false)
        await page.setViewportSize({ width: 1440, height: 900 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        await frames(page)
        await page.route("**/processor.mjs", (route) => route.abort("failed"))
        await download.click()
        await dialog.getByRole("alert").waitFor()
        await page.setViewportSize({ width: 320, height: 900 })
        await frames(page)
        await bounds(page, dialog.locator(".feedback"))
        assert.equal(await dialog.getByRole("button", { name: "Retry", exact: true }).isVisible(), true)
        await dialog.getByRole("button", { name: "Cancel", exact: true }).click()
        assert.equal(await dialog.isVisible(), false)
      } finally {
        await browser.close()
      }
    }
  },
)
