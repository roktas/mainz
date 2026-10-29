// Checks header feedback geometry, cancellation, and compact Download recovery.

import assert from "node:assert/strict"
import test from "node:test"
import { mkdir } from "node:fs/promises"
import { resolve } from "node:path"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { fixture } from "./browser.js"

test("Landing and workspace share desktop edges", { timeout: 120000 }, async () => {
  const server = await serve()
  for (const mode of ["mouse", "hybrid"]) {
    const browser = await chromium.launch({
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
    const actions = element.querySelector(".feedback-actions")?.getBoundingClientRect()
    const icon = element.querySelector(":scope > svg, :scope > .spinner").getBoundingClientRect()
    const controls = Array.from(document.querySelectorAll(".header-inner > .brand, .header-actions"), (control) =>
      control.getBoundingClientRect().toJSON(),
    )
    return {
      width: innerWidth,
      overflow: document.documentElement.scrollWidth > innerWidth,
      rect: rect.toJSON(),
      header: header.toJSON(),
      message: message.toJSON(),
      actions: actions?.toJSON(),
      icon: icon.toJSON(),
      controls,
    }
  })
  assert.equal(result.overflow, false, JSON.stringify(result))
  assert.ok(result.rect.left >= 0 && result.rect.right <= result.width, JSON.stringify(result))
  assert.ok(
    Math.abs(result.rect.x + result.rect.width / 2 - result.header.x - result.header.width / 2) < 1,
    JSON.stringify(result),
  )
  assert.ok(
    Math.abs(result.icon.y + result.icon.height / 2 - result.message.y - result.message.height / 2) < 1,
    JSON.stringify(result),
  )
  if (result.actions)
    assert.ok(
      result.message.right <= result.actions.left + 1 || result.message.bottom <= result.actions.top + 1,
      JSON.stringify(result),
    )
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
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({
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
        await page.getByRole("button", { name: "Continue in browser", exact: true }).click()
        const notice = page.locator(".header-feedback .notice")
        await notice.waitFor()
        await matrix(page, notice, "notice", () => page.clock.runFor(50))
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
          await progress.locator("p").getAttribute("title"),
          await progress
            .locator("p")
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
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({
        channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL || undefined : undefined,
      })
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
        await page.addInitScript(() => {
          localStorage.setItem("mainz:onboarding", "19")
          const Original = Worker
          window.Worker = class extends Original {
            postMessage(message, ...rest) {
              if (window.holdStyles && (message.changes || message.job)) return
              super.postMessage(message, ...rest)
            }
          }
        })
        await page.goto(server.resolvedUrls.local[0] + "?demo")
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
            const actions = await error.locator(".feedback-actions").boundingBox()
            assert.ok(message.width >= 160, JSON.stringify({ width, message, actions }))
            assert.ok(actions.y >= message.y + message.height - 1, JSON.stringify({ width, message, actions }))
            assert.ok((await error.boundingBox()).height < 650, "Recovery needs bounded reading and scrolling")
            const retry = error.getByRole("button", { name: "Retry Input styles", exact: true })
            await retry.scrollIntoViewIfNeeded()
            const target = await retry.boundingBox()
            assert.ok(target.width >= 44 && target.height >= 44 && target.y >= 0 && target.y + target.height <= 568)
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            await page.screenshot({
              path: resolve(`../.local/var/web/feedback/recovery-${engine.name()}-${width}-${colorScheme}.png`),
            })
          }
        }
        await page.evaluate(() => (window.holdStyles = false))
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
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch({
        channel: engine === chromium ? process.env.PLAYWRIGHT_CHANNEL || undefined : undefined,
      })
      try {
        const page = await browser.newPage({ reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(server.resolvedUrls.local[0] + "?demo")
        await page.locator(".composer[aria-busy=false]").waitFor()
        let release
        const held = new Promise((finish) => (release = finish))
        await page.route("**/processor.mjs", async (route) => {
          await held
          await route.continue().catch(() => {})
        })
        const download = page.locator(".composition-output").getByRole("button", { name: "Download", exact: true })
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
