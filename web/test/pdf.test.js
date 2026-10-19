// Checks preview raster ownership and eviction in the browser canvas implementation.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer, fixture, tab } from "./browser.js"

test("Document ownership releases tasks and rasters once, including validation failures", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { Documents, cacheRaster, cachedRaster, verifyPDF } = await import("/src/pdf.ts")
      const documents = new Documents(),
        opened = {},
        styled = {}
      const released = []
      documents.add(opened, { destroy: async () => released.push("opened") })
      documents.add(styled, { destroy: async () => released.push("styled") })
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 32
      cacheRaster(opened, 0, 1, canvas)
      cacheRaster(styled, 0, 1, canvas)
      const original = cachedRaster(opened, 0, 1),
        preview = cachedRaster(styled, 0, 1)
      documents.retain([opened, styled, opened])
      const shared = released.length === 0 && original.width === 32 && preview.width === 32
      documents.retain([opened])
      documents.retain([opened])
      const comparison = original.width === 32 && preview.width === 0
      documents.dispose()
      documents.dispose()
      let cleaned = 0,
        failure
      try {
        await verifyPDF({
          getPage: async () => ({
            getViewport: () => {
              throw new Error("Invalid viewport")
            },
            cleanup: () => cleaned++,
          }),
        })
      } catch (error) {
        failure = error.message
      }
      return { shared, comparison, released, cleared: original.width === 0, cleaned, failure }
    })
    assert.deepEqual(result, {
      shared: true,
      comparison: true,
      released: ["styled", "opened"],
      cleared: true,
      cleaned: 1,
      failure: "Invalid viewport",
    })
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Releasing PDF rasters clears only that document and preserves the shared cache budget", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    const result = await page.evaluate(async () => {
      const { cacheRaster, cachedRaster, releaseRasters } = await import("/src/pdf.ts")
      const first = {},
        second = {}
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 512
      canvas.getContext("2d").fillRect(0, 0, 512, 512)
      cacheRaster(first, 1, 1, canvas)
      cacheRaster(first, 2, 1, canvas)
      cacheRaster(second, 1, 1, canvas)
      const closed = [cachedRaster(first, 1, 1), cachedRaster(first, 2, 1)]
      const retained = cachedRaster(second, 1, 1)
      releaseRasters(first)
      releaseRasters(first)
      const removed = [cachedRaster(first, 1, 1), cachedRaster(first, 2, 1)].every((entry) => !entry)
      const cleared = closed.every((entry) => entry.width === 0 && entry.height === 0)
      const shared = cachedRaster(second, 1, 1) === retained && retained.width === 512
      for (let number = 2; number <= 32; number++) cacheRaster(second, number, 1, canvas)
      const full = Array.from({ length: 32 }, (_, index) => !!cachedRaster(second, index + 1, 1)).every(Boolean)
      cacheRaster(second, 33, 1, canvas)
      const evicted = !cachedRaster(second, 1, 1) && retained.width === 0
      const latest = cachedRaster(second, 33, 1)
      releaseRasters(second)
      cacheRaster(first, 1, 1, canvas)
      const reopened = cachedRaster(first, 1, 1).width === 512
      releaseRasters(first)
      return { removed, cleared, shared, full, evicted, released: latest.width === 0, reopened }
    })
    assert.deepEqual(result, {
      removed: true,
      cleared: true,
      shared: true,
      full: true,
      evicted: true,
      released: true,
      reopened: true,
    })
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Source replacement retains opened rasters for comparison and releases them on removal", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts")
      const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()))
      const prototype = Object.getPrototypeOf(await task.promise)
      const getPage = prototype.getPage
      window.previewPDFs = new Set()
      prototype.getPage = function (...args) {
        window.previewPDFs.add(this)
        return getPage.apply(this, args)
      }
      await task.destroy()
    })
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Prepared.pdf", mimeType: "application/pdf", buffer: fixture() })
    const input = page.locator(".selection-panel")
    await input.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
    await page.evaluate(async () => {
      const { cacheRaster, cachedRaster } = await import("/src/pdf.ts")
      const pdf = [...window.previewPDFs][0]
      const canvas = document.createElement("canvas")
      canvas.width = canvas.height = 32
      cacheRaster(pdf, 9999, 1, canvas)
      window.openedRaster = cachedRaster(pdf, 9999, 1)
    })
    await input.getByLabel("Page selection", { exact: true }).fill("1,1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.waitForFunction(
      () => window.previewPDFs.size >= 2 && !document.querySelector('.output-status[aria-hidden="false"]'),
    )
    assert.equal(
      await page.evaluate(() => window.openedRaster.width),
      32,
      "Completed styles keep the opened PDF for comparison",
    )
    const output = page.locator(".composition-output")
    await output.getByLabel("Page selection", { exact: true }).fill("1-2")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await input.locator(".input-picker > summary").click()
    await input.getByRole("button", { name: "Remove Input", exact: true }).click()
    await page.waitForFunction(() => window.openedRaster.width === 0)
    assert.equal(await page.locator(".composer").count(), 0)
  } finally {
    await browser?.close()
    await server.close()
  }
})
