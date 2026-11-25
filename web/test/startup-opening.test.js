// Checks file opening batches, preview isolation, demos, transitions, and workspace reset prompts.

import { setup, outputCount, trackWorkers, fixture, tab, pixel, gridPage } from "./browser.js"
import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { mkdir, mkdtemp, rm } from "node:fs/promises"
import { join, resolve as resolvePath } from "node:path"
import { build } from "vite"
import { chromium } from "playwright"

test(
  "Ordinary Inputs release validation workers while preview and Download stay available",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.addInitScript(trackWorkers)
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel")
      for (const name of ["First.pdf", "Second.pdf"]) {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name, mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
        await page.locator(".status-input").filter({ hasText: name }).waitFor({ state: "attached" })
        await page.locator(".composer:not([inert])").waitFor()
        assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).count(), 0)
        assert.equal(
          await page.evaluate(
            () =>
              window.workers.filter((worker) => worker.url.includes("processor.worker") && !worker.terminated).length,
          ),
          0,
          "Ordinary Inputs have no style processing to retain a WASM worker for",
        )
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await input.locator(".thumbnail[aria-busy=false] canvas").waitFor()
        assert.ok(await input.locator(".thumbnail canvas").evaluate((canvas) => canvas.width > 0))
      }
      assert.equal(await outputCount(page).textContent(), "2 pages")
      const pending = page.waitForEvent("download")
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
      assert.equal(await (await pending).failure(), null)
      await page.waitForFunction(() =>
        window.workers.filter((worker) => worker.url.includes("processor.worker")).every((worker) => worker.terminated),
      )
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Multi-file opening recovers from invalid PDFs and cancellation stops the remaining files",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      const bytes = fixture({ prepared: false })
      const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: bytes })
      await page.locator('input[type="file"]').first().setInputFiles(pdf("First.pdf"))
      const input = page.locator(".selection-panel")
      await page.locator(".status-input").filter({ hasText: "First.pdf" }).waitFor({ state: "attached" })
      await page
        .locator('.composer .file-picker input[type="file"][aria-label="Open PDF"]')
        .setInputFiles([
          { name: "Broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("Not a PDF") },
          pdf("Last.pdf"),
        ])
      await page.locator(".status-input").filter({ hasText: "Last.pdf" }).waitFor({ state: "attached" })
      await page.locator(".header-feedback .opening-progress").waitFor({ state: "detached" })
      assert.deepEqual(await input.locator(".input-list button[data-source] > span:first-child").allTextContents(), [
        "First.pdf",
        "Last.pdf",
      ])
      assert.equal(await page.getByRole("alert").innerText(), "1 file failed")
      await page.getByRole("alert").getByRole("button").click()
      assert.match(
        await page.getByRole("list", { name: "File errors", exact: true }).innerText(),
        /Could not open Broken\.pdf/,
      )
      await page.evaluate(() => {
        const read = File.prototype.arrayBuffer
        window.readFiles = []
        File.prototype.arrayBuffer = async function () {
          window.readFiles.push(this.name)
          if (this.name === "Cancelled.pdf") await new Promise((resolve) => (window.releaseRead = resolve))
          return read.call(this)
        }
      })
      await input
        .locator('.input-heading > .file-picker input[type="file"]')
        .setInputFiles([
          { name: "Another-broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("Not a PDF") },
          pdf("Cancelled.pdf"),
          pdf("Unopened.pdf"),
        ])
      await page.waitForFunction(() => !!window.releaseRead)
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await input.locator('.input-heading > .file-picker input[type="file"]').setInputFiles(pdf("Retry.pdf"))
      await page.locator(".status-input").filter({ hasText: "Retry.pdf" }).waitFor({ state: "attached" })
      await page.evaluate(() => window.releaseRead())
      await page.evaluate(() => new Promise(requestAnimationFrame))
      assert.deepEqual(await page.evaluate(() => window.readFiles), [
        "Another-broken.pdf",
        "Cancelled.pdf",
        "Retry.pdf",
      ])
      assert.equal(await input.locator(".input-list button[data-source]").count(), 3)
      assert.equal(await input.locator(".input-current").textContent(), "Retry.pdf")
      assert.equal(await page.getByRole("alert").count(), 0, "An abandoned batch cannot restore stale errors")
    } finally {
      await browser?.close()
    }
  },
)

test("Large failure batches announce a summary and retain every file error", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await setup(page)
    await page.addInitScript(() => {
      window.announcements = []
      new MutationObserver(() => {
        for (const element of document.querySelectorAll('[role="alert"]'))
          if (element.textContent) window.announcements.push(element.textContent)
      }).observe(document, { childList: true, characterData: true, subtree: true })
    })
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "Initial.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
    await page.locator(".status-input").filter({ hasText: "Initial.pdf" }).waitFor({ state: "attached" })
    const failed = Array.from({ length: 40 }, (_, index) => ({
      name: `${index}-${"long-publication-name-".repeat(6)}.${index < 2 ? "pdf" : "txt"}`,
      mimeType: "application/pdf",
      buffer: Buffer.from("Not a PDF"),
    }))
    await page
      .locator('.composer .file-picker input[type="file"][aria-label="Open PDF"]')
      .setInputFiles([
        ...failed,
        { name: "Ready.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) },
      ])
    await page.locator(".status-input").filter({ hasText: "Ready.pdf" }).waitFor({ state: "attached" })
    const announcement = page.getByRole("alert")
    await announcement.waitFor()
    assert.ok((await announcement.innerText()).length < 120, "Batch announcements must not include every diagnostic")
    assert.match(await announcement.innerText(), /40 files failed/)
    assert.ok(
      await page.evaluate(() => window.announcements.every((text) => text.length < 120)),
      "Per-file failures must not produce long intermediate announcements",
    )
    const errors = page.getByRole("list", { name: "File errors", exact: true })
    const disclosure = announcement.getByRole("button")
    for (const [width, text, colorScheme] of [
      [320, "100%", "light"],
      [320, "200%", "dark"],
      [390, "200%", "dark"],
      [768, "200%", "light"],
      [1440, "100%", "dark"],
    ]) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
      assert.equal(await errors.isVisible(), false)
      const alignment = await announcement.evaluate((element) => {
        const group = element.closest(".feedback").getBoundingClientRect()
        const header = document.querySelector(".header-inner").getBoundingClientRect()
        return Math.abs(group.x + group.width / 2 - header.x - header.width / 2)
      })
      assert.ok(alignment < 1, `${width}px: aligned batch message`)
      await disclosure.focus()
      await page.keyboard.press("Enter")
      await errors.waitFor()
      const panelBounds = await page.locator(".message-details:popover-open").evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.x >= 0 && box.right <= innerWidth + 1 && box.y >= 0 && box.bottom <= innerHeight + 1
      })
      assert.ok(
        panelBounds,
        `${width}px, ${text}: Error details fit the viewport outside the header: ${JSON.stringify(await page.locator(".message-details:popover-open").boundingBox())}`,
      )
      const messages = await errors.getByRole("listitem").allTextContents()
      assert.equal(messages.length, failed.length)
      for (const [index, file] of failed.entries()) assert.ok(messages[index].includes(file.name))
      assert.match(messages[0], /Could not open/)
      assert.match(messages[2], /Choose a PDF file/)
      const bounds = await errors.evaluate((element) => ({
        height: element.clientHeight,
        overflow: element.scrollHeight > element.clientHeight,
      }))
      assert.ok(bounds.height <= 360 && bounds.overflow, "Details must scroll within the viewport")
      await errors.focus()
      await page.keyboard.press("End")
      await page.waitForFunction(() => document.querySelector(".message-details ul")?.scrollTop > 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await disclosure.focus()
      await page.keyboard.press("Enter")
    }
    await announcement.getByRole("button").click()
    await page.getByRole("button", { name: "Dismiss error", exact: true }).click()
    assert.equal(await announcement.count(), 0)
    assert.equal(await disclosure.count(), 0)
    assert.equal(await page.locator(".input-current").textContent(), "Ready.pdf")
  } finally {
    await browser?.close()
  }
})

test("The first PDF previews before validation and commits only after success", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  const gates = []
  const release = () => {
    for (const proceed of gates.splice(0)) proceed()
  }
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await setup(page)
    await page.route("**/processor.mjs", async (route) => {
      await new Promise((resolve) => gates.push(resolve))
      await route.continue().catch(() => {})
    })
    await page.goto(server.resolvedUrls.local[0])
    // The preview is visible before validation, with the same Grid presentation after commit.
    const bytes = fixture({ count: 33 })
    const input = page.locator(".selection-panel")
    const open = async (name, buffer) => {
      await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer })
      await page.locator(".composer[inert]").waitFor()
      await page.waitForFunction(() => document.querySelector(".selection-panel .page-image canvas")?.width > 0)
      assert.equal(await page.locator(".drop-zone").count(), 0)
      assert.equal(await outputCount(page).textContent(), "0 pages")
      assert.equal(await page.locator(".composer").getAttribute("aria-busy"), "true")
      assert.equal(await page.locator(".header-feedback .opening-progress").isVisible(), true)
    }
    await open("Cancelled.pdf", bytes)
    await page
      .locator(".header-feedback .opening-progress")
      .getByRole("button", { name: "Opening PDF", exact: true })
      .click()
    for (const key of ["Control+a", "Enter", "+"]) await page.keyboard.press(key)
    assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0)
    assert.equal(await outputCount(page).textContent(), "0 pages")
    await page.setViewportSize({ width: 390, height: 1100 })
    await page.emulateMedia({ colorScheme: "dark" })
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.locator(".drop-zone").waitFor()
    release()
    assert.equal(await page.locator(".composer").count(), 0)
    await page.evaluate(() => document.documentElement.style.removeProperty("font-size"))
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.emulateMedia({ colorScheme: "light" })
    await open("Invalid.pdf", Buffer.from(bytes.toString().replace('"version":1', '"version":2')))
    release()
    await page.getByRole("alert").waitFor()
    await page.getByRole("alert").getByRole("button").click()
    assert.match(await page.getByRole("list", { name: "File errors", exact: true }).innerText(), /style format/)
    await page.locator(".drop-zone").waitFor()
    assert.equal(await page.locator(".composer").count(), 0)
    await open("Ready.pdf", bytes)
    release()
    await page.locator(".composer:not([inert])").waitFor()
    await input.getByRole("tab", { name: "Style", exact: true }).waitFor()
    assert.equal(await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
    assert.equal(await input.locator(".composition-card").first().isVisible(), true)
    assert.equal(await page.locator(".input-picker .count").innerText(), "1")
    assert.equal(
      await input.getByRole("button", { name: "Details for Input 1", exact: true, includeHidden: true }).count(),
      1,
    )
    assert.equal(await page.locator(".header-feedback .opening-progress").count(), 0)
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    assert.equal(await outputCount(page).textContent(), "1 page")
    assert.deepEqual(errors, [])
  } finally {
    release()
    await browser?.close()
  }
})

test("Development assets remain available after a production build", { timeout: 60000 }, async () => {
  const temporary = resolvePath("../.local/tmp/web")
  await mkdir(temporary, { recursive: true })
  const outDir = await mkdtemp(join(temporary, "asset-rebuild-"))
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    const url = server.resolvedUrls.local[0]
    await page.goto(`${url}?demo=single`)
    await page.locator(".input-current").waitFor({ state: "attached" })
    const previous = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = "production"
      await build({ build: { outDir, emptyOutDir: true }, logLevel: "warn" })
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
    const response = await fetch(`${url}processor.wasm`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type"), /^application\/wasm/)
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)],
      [0, 97, 115, 109],
      "The open development server keeps serving WASM, not the HTML fallback",
    )
    await page.reload()
    await page.locator(".input-current").waitFor({ state: "attached" })
    assert.equal(await page.locator(".status-input").textContent(), "dolor.pdf")
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "8 pages",
    )
  } finally {
    await browser?.close()
    await rm(outDir, { recursive: true, force: true })
  }
})

test("Demo composition follows the opened page count", async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    for (const query of ["=single", "=grid"]) {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.route("**/*.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 1 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo${query}`)
      await page.locator(".input-current").waitFor({ state: "attached" })
      await page
        .locator(".composition-output .composition-totals strong")
        .filter({ hasText: /^1 page$/ })
        .waitFor()
      assert.equal(await page.locator(".composition-output .page-image").count(), 1)
      assert.equal(await page.getByRole("alert").count(), 0)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test("Demo variants open the maintained Input with populated or empty Output", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [query, pages, selected] of [
      ["=single", 8, 4],
      ["=empty", 0, 0],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      })
      page.setDefaultTimeout(10000)
      await page.goto(`${server.resolvedUrls.local[0]}?demo${query}`)
      await page.locator(".input-current").waitFor({ state: "attached" })
      await page.waitForFunction(
        (count) =>
          document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")
            ?.textContent === `${count} pages`,
        pages,
      )
      const input = page.locator(".selection-panel")
      assert.equal(await page.locator(".status-input").textContent(), "dolor.pdf")
      assert.equal(await input.locator(".thumbnail").count(), 4)
      assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), selected)
      if (query === "=single") {
        const output = page.locator(".composition-output")
        const order = []
        for (let number = 1; number <= 8; number++) {
          const thumbnail = await gridPage(output, number)
          order.push(
            await thumbnail
              .locator('xpath=ancestor::*[contains(@class, "composition-card")][1]')
              .locator('.page-origin-info .page-details tr:has(th:text-is("Original page")) td')
              .textContent(),
          )
        }
        assert.deepEqual(order, [1, 2, 3, 4, 3, 4, 3, 4].map(String))
        await gridPage(output, 1)
        assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1-4")
        await input.getByRole("tab", { name: "Page", exact: true }).click()
        await input.locator(".page-scroll").press("End")
        assert.match(await input.locator(".page-position").textContent(), /4/)
        assert.equal(
          await input.locator(".page-view").evaluate((element) => element.classList.contains("selected")),
          true,
        )
        await input.locator(".page-scroll").press("Home")
        await tab(input, "Grid")
        await output.getByLabel("Page selection", { exact: true }).fill("1")
        for (const button of [
          input.getByRole("button", { name: "Add to Output", exact: true }),
          output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }),
        ])
          assert.equal(await button.locator("svg").evaluate((svg) => getComputedStyle(svg).strokeWidth), "3px")
      }
      const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      if (query === "=empty") {
        await welcome.getByRole("button", { name: "Close welcome", exact: true }).click()
        await page.locator(".page-flight:popover-open").waitFor()
        assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0)
        assert.equal(await outputCount(page).textContent(), "0 pages")
        assert.equal(await input.getByRole("button", { name: "Add to Output", exact: true }).count(), 0)
        const sequence = input.getByLabel("Page selection", { exact: true })
        await sequence.fill("1")
        await sequence.fill("1,")
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
          await page.waitForFunction(() => {
            const button = document.querySelector(".selection-panel .transfer")
            return getComputedStyle(button).borderRightColor === getComputedStyle(button.parentElement).borderRightColor
          })
          const borders = await input.locator(".transfer").evaluate((button) => {
            const style = getComputedStyle(button)
            const frame = getComputedStyle(button.parentElement)
            return {
              disabled: button.disabled,
              top: style.borderTop,
              right: style.borderRight,
              bottom: style.borderBottom,
              frame: frame.borderRight,
            }
          })
          assert.equal(borders.disabled, true)
          assert.equal(borders.top, borders.frame, `${theme}: the disabled arrow keeps the selection frame`)
          assert.equal(borders.right, borders.frame)
          assert.equal(borders.bottom, borders.frame)
        }
      } else assert.equal(await welcome.isVisible(), false)
      await tab(input, "Page")
      assert.equal(
        (await input.locator(".inspection-heading .page-number").innerText()).replace(/\s+/g, ""),
        "1/4",
        "The Page counter does not repeat an identical PDF label",
      )
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Unknown demo variants report an error and permit opening a local PDF", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await setup(page)
    for (const value of ["missing", "<unknown>"]) {
      await page.goto(`${server.resolvedUrls.local[0]}?demo=${encodeURIComponent(value)}`)
      const error = page.getByRole("alert")
      await error.waitFor()
      assert.ok((await error.innerText()).includes(`Unknown demo: ${value}. Choose a local PDF`))
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Local.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      assert.equal(await page.locator(".input-current").innerText(), "Local.pdf")
    }
  } finally {
    await browser?.close()
  }
})

test("A delayed demo cannot replace local pages or report obsolete failures", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const status of [200, 503]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await setup(page)
      const response = Promise.withResolvers()
      const request = Promise.withResolvers()
      const workspace = Promise.withResolvers()
      await page.route("**/dolor.pdf", async (route) => {
        request.resolve()
        await response.promise
        await route.fulfill({ status, contentType: "application/pdf", body: fixture() })
      })
      await page.route(/\/src\/Composer\.svelte(?:\?|$)/, async (route) => {
        await workspace.promise
        await route.continue()
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
      await request.promise
      const demoProgress = page.getByRole("status", { name: "Loading demo", exact: true })
      assert.ok((await demoProgress.boundingBox()).width > 1)
      assert.equal(await page.locator(".header-feedback .spinner").isVisible(), true)
      if (status === 200) {
        await page.getByRole("button", { name: "Cancel demo", exact: true }).click()
        await demoProgress.waitFor({ state: "detached" })
      }
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Local.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      const workspaceProgress = page.getByRole("status", { name: "Loading workspace", exact: true })
      await workspaceProgress.waitFor()
      assert.ok((await workspaceProgress.boundingBox()).width <= 1)
      const spinner = page.locator("main .spinner")
      assert.equal(await spinner.isVisible(), true)
      assert.equal(await spinner.evaluate((element) => getComputedStyle(element).animationName), "none")
      assert.equal(await demoProgress.count(), 0)
      workspace.resolve()
      await page.locator(".composer[aria-busy=false]").waitFor()
      assert.equal(await workspaceProgress.count(), 0)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-3")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      response.resolve()
      await page.waitForLoadState("networkidle")
      await page.locator(".header-feedback .opening-progress").waitFor({ state: "detached" })
      assert.equal(await input.locator(".input-current").textContent(), "Local.pdf")
      assert.equal(await input.locator(".input-heading .count").textContent(), "1")
      assert.equal(await outputCount(page).textContent(), "2 pages")
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1-2")
      assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Grid, List and Page transitions keep thumbnail bounds", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    const output = page.locator(".composition-output")
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    for (const mode of ["Grid", "List", "Page", "Grid"]) {
      await tab(output, mode)
      if (mode === "Grid") {
        const image = output.locator(".page-image .thumbnail").first()
        await image.waitFor()
        assert.equal(
          await image.evaluate((frame) => {
            const canvas = frame.querySelector("canvas")
            return !canvas || canvas.getBoundingClientRect().height <= frame.getBoundingClientRect().height + 1
          }),
          true,
        )
      } else if (mode === "Page") {
        await output.locator(".page-scroll").waitFor()
      } else {
        await output.locator(".page-list").waitFor()
      }
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})

test("Home asks once before discarding changes and cancellation retains the workspace", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "8 pages",
    )
    const preparation = page.locator(".selection-panel").getByLabel("Page selection", { exact: true })
    await preparation.fill("1")
    await preparation.press("Enter")
    const home = page.getByRole("link", { name: "PDF Composer home", exact: true })
    const started = await page.evaluate(() => performance.timeOrigin)
    const warnings = []
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    const confirmation = page.waitForEvent("dialog")
    await home.click()
    await confirmation
    assert.deepEqual(warnings, ["confirm"])
    assert.equal(await outputCount(page).textContent(), "9 pages")
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    const reloadWarning = page.waitForEvent("dialog")
    await page.evaluate(() => location.reload())
    await reloadWarning
    assert.deepEqual(warnings, ["confirm", "beforeunload"], "Reload retains its independent exit warning")
    assert.equal(await outputCount(page).textContent(), "9 pages")
    page.on("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.accept()
    })
    await home.click()
    await page.locator(".drop-zone").waitFor()
    assert.deepEqual(warnings, ["confirm", "beforeunload", "confirm"], "Each Home attempt asks exactly once")
    assert.equal(await page.evaluate(() => performance.timeOrigin), started)
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Reopened.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 2 }),
      })
    await page.locator('.composer[aria-busy="false"]').waitFor()
    assert.equal(await outputCount(page).textContent(), "0 pages", "Home releases the previous Output")
    await page.locator(".selection-panel").getByRole("button", { name: "Select Input page 1", exact: true }).click()
    await page.locator(".selection-panel").getByRole("button", { name: "Add to Output", exact: true }).click()
    assert.equal(await outputCount(page).textContent(), "1 page", "The loaded runtime can process another PDF")
  } finally {
    await browser?.close()
  }
})

test("Concurrent Source previews isolate resets and ignore obsolete worker replies", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await setup(page)
    await page.addInitScript(() => {
      window.pendingReplies = []
      const Original = Worker
      window.Worker = class extends Original {
        constructor(url, options) {
          super(url, options)
          this.processor = String(url).includes("processor.worker")
        }
        addEventListener(type, listener, options) {
          if (type !== "message" || !this.processor) return super.addEventListener(type, listener, options)
          super.addEventListener(
            type,
            (event) => {
              if (window.holdReplies) window.pendingReplies.push(() => listener.call(this, event))
              else listener.call(this, event)
            },
            options,
          )
        }
      }
    })
    await page.goto(server.resolvedUrls.local[0])
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const name of ["First.pdf", "Second.pdf"]) {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name,
          mimeType: "application/pdf",
          buffer: fixture({ grouped: true, fillOnly: true }),
        })
      await page.locator(".status-input").filter({ hasText: name }).waitFor({ state: "attached" })
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
    }
    const choose = async (index) => {
      await page.locator(".input-picker > summary").click()
      await input.locator(".input-list button[data-source]").nth(index).click()
      await tab(input, "Style")
      await input.getByRole("button", { name: "Edit Fill", exact: true }).click()
    }
    const color = input.getByRole("textbox", { name: "Fill Color", exact: true })
    await page.evaluate(() => (window.holdReplies = true))
    await choose(0)
    await color.fill("#ff0000")
    await page.waitForFunction(() => window.pendingReplies.length === 1)
    await choose(1)
    await color.fill("#00ff00")
    await page.waitForFunction(() => window.pendingReplies.length === 2)
    await choose(0)
    await input.getByRole("button", { name: "Reset Fill Color", exact: true }).click()
    assert.equal(await color.inputValue(), "#000000")
    assert.equal(
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).isDisabled(),
      true,
    )
    await page.evaluate(() => {
      window.holdReplies = false
      for (const reply of window.pendingReplies.splice(0).toReversed()) reply()
    })
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    assert.equal(await color.inputValue(), "#000000", "An obsolete reply cannot undo the first Source's reset")
    const canvases = output.locator(".composition-card .thumbnail canvas")
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll(".composition-output .composition-card .thumbnail canvas")]
      return (
        images.length === 2 &&
        images.every((canvas) => canvas.width > 0 && canvas.parentElement.getAttribute("aria-busy") === "false")
      )
    })
    assert.deepEqual(await pixel(canvases.nth(0), 0.7), [0, 0, 0, 255])
    assert.deepEqual(await pixel(canvases.nth(1), 0.7), [0, 255, 0, 255])
    await choose(1)
    assert.equal(await color.inputValue(), "#00ff00", "The second Source completes independently")
    await page.evaluate(() => (window.holdReplies = true))
    await color.fill("#0000ff")
    await page.waitForFunction(() => window.pendingReplies.length === 1)
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("2")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await page.locator(".input-picker > summary").click()
    await input.getByRole("button", { name: "Remove Input", exact: true }).click()
    assert.equal(await input.locator(".input-current").innerText(), "First.pdf")
    assert.equal(await outputCount(page).textContent(), "1 page")
    await page.evaluate(() => {
      window.holdReplies = false
      for (const reply of window.pendingReplies.splice(0)) reply()
    })
    await tab(input, "List")
    await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).press("Enter")
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll(".composition-output .composition-card .thumbnail canvas")]
      return images.length === 2 && images.every((canvas) => canvas.parentElement.getAttribute("aria-busy") === "false")
    })
    assert.equal(await outputCount(page).textContent(), "2 pages")
    assert.deepEqual(await pixel(canvases.nth(0), 0.7), [0, 0, 0, 255])
    assert.deepEqual(await pixel(canvases.nth(1), 0.7), [0, 0, 0, 255])
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
  }
})

test(
  "Opening cancellation during file reads or page labels cannot adopt an obsolete Input",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      for (const stage of ["read", "labels"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await setup(page)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
        await page.getByText("Demo workspace ready.", { exact: true }).waitFor()
        const original = await page.locator(".input-current").textContent()
        await page.evaluate(
          async ({ stage, bytes }) => {
            const suspend = async () => {
              document.documentElement.dataset.openPending = "true"
              await new Promise((resolve) => window.addEventListener("release-open", resolve, { once: true }))
              document.documentElement.dataset.openPending = "false"
            }
            if (stage === "read") {
              const read = File.prototype.arrayBuffer
              File.prototype.arrayBuffer = async function () {
                File.prototype.arrayBuffer = read
                await suspend()
                return read.call(this)
              }
            } else {
              const { openPDF } = await import("/src/pdf.ts")
              const task = await openPDF(Uint8Array.from(bytes)),
                pdf = await task.promise
              const prototype = Object.getPrototypeOf(pdf),
                labels = prototype.getPageLabels
              prototype.getPageLabels = async function () {
                prototype.getPageLabels = labels
                const value = await labels.call(this)
                await suspend()
                return value
              }
              await task.destroy()
            }
          },
          { stage, bytes: Array.from(fixture({ prepared: false })) },
        )
        const input = page.locator('.input-heading input[type=file][aria-label="Open PDF"]')
        await input.setInputFiles({
          name: "Cancelled.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
        await page.waitForFunction(() => document.documentElement.dataset.openPending === "true")
        await page.getByRole("button", { name: "Cancel", exact: true }).click()
        assert.equal(await page.locator(".input-current").textContent(), original)
        await input.setInputFiles({
          name: "Retry.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
        await page.locator(".status-input").filter({ hasText: "Retry.pdf" }).waitFor({ state: "attached" })
        await page.evaluate(() => window.dispatchEvent(new Event("release-open")))
        await page.waitForFunction(() => document.documentElement.dataset.openPending === "false")
        assert.equal(await page.locator(".input-current").textContent(), "Retry.pdf")
        assert.equal(await page.locator(".input-list button[data-source]").count(), 2)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)
