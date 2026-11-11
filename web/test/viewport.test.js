// Checks single-density Grid geometry capture and viewport evidence in Chromium.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { launch } from "./browsers.js"
import { serve } from "./server.ts"
import { fixture, tab } from "./browser.js"
import { geometry, csv } from "../src/geometry.ts"
import { bounds, quality } from "./quality.ts"

async function open(page, server, count = 240) {
  await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
  await page.route("**/grid.pdf", (route) =>
    route.fulfill({ contentType: "application/pdf", body: fixture({ count }) }),
  )
  await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&geometry`)
  await page.waitForFunction(
    (count) =>
      document.querySelector(".composition-output .composition-totals strong")?.textContent === `${count} pages`,
    count,
  )
}

test("Stable geometry reflects the current viewport without stale layout", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 }, reducedMotion: "reduce" })
    await open(page, server, 8)
    for (const [width, height] of [
      [1280, 800],
      [1366, 900],
    ]) {
      await page.setViewportSize({ width, height })
      const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).stable())
      const direct = await page.evaluate(geometry)
      assert.deepEqual(sample.layout, direct.layout)
      assert.deepEqual(sample.viewport, direct.viewport)
      assert.deepEqual(sample.viewport.inner, [width, height])
      for (const unit of ["svh", "dvh", "lvh"]) assert.equal(sample.viewport[unit], height)
    }
  } finally {
    await browser.close()
  }
})

test("Grid geometry refreshes CSS measurements without changing the fixed frame", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" })
    await open(page, server, 32)
    const original = await page.evaluate(async () => (await import("/src/geometry.ts")).stable())
    const before = original.layout.input.normal
    const override = await page.addStyleTag({ content: ".composer .selection-panel { --grid-height: 14rem; }" })
    const measured = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
    assert.equal(measured.layout.input.normal.card.height, 224)
    assert.deepEqual(measured.layout.input.normal.frame, before.frame)
    await override.evaluate((element) => element.remove())
    const restored = await page.evaluate(async () => (await import("/src/geometry.ts")).stable())
    assert.equal(restored.layout.input.normal.card.height, before.card.height)
  } finally {
    await browser.close()
  }
})

test("One Grid schema captures both panes at phone, tablet, and desktop sizes", { timeout: 180000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const manifest = await fetch(`${server.resolvedUrls.local[0]}manifest.webmanifest?geometry`).then((res) =>
      res.json(),
    )
    assert.equal(manifest.start_url, "./?demo=grid&geometry")
    for (const [width, height, touch] of [
      [390, 844, true],
      [810, 1080, true],
      [1440, 900, false],
    ]) {
      const context = await browser.newContext({
        viewport: { width, height },
        isMobile: touch,
        hasTouch: touch,
        reducedMotion: "reduce",
      })
      try {
        const page = await context.newPage()
        await open(page, server)
        const input = page.locator(".selection-panel")
        const output = page.locator(".composition-output")
        const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
        await selection.fill("2")
        await tab(input, "List")
        await selection.focus()
        const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
        assert.equal(sample.schemaVersion, 2)
        assert.deepEqual(sample.viewport.inner, [width, height])
        assert.equal(sample.provenance.evidenceClass, "unknown")
        assert.deepEqual(Object.keys(sample.layout.input), ["normal"])
        assert.deepEqual(Object.keys(sample.layout.output), ["normal"])
        assert.equal(sample.layout.input.normal.total, 240)
        assert.equal(sample.layout.output.normal.total, 240)
        assert.ok(sample.layout.input.normal.mounted < 40)
        assert.ok(sample.layout.output.normal.mounted < 40)
        assert.deepEqual(quality(sample), [])
        assert.equal(await input.locator(".page-list").isVisible(), true)
        assert.equal(await selection.inputValue(), "2")
        assert.equal(await selection.evaluate((element) => element === document.activeElement), true)
        assert.equal(csv(sample).trim().split("\r\n").length, 3)
        sample.environment.browserFamily = "=UNTRUSTED()"
        assert.ok(csv(sample).includes("'=UNTRUSTED()"))
        const altered = structuredClone(sample)
        altered.layout.output = {}
        assert.equal(quality(altered).filter((failure) => failure.rule === "complete capture").length, 1)
        const cramped = structuredClone(sample.layout.input.normal)
        cramped.edges = [6, 6]
        cramped.gaps = [6, 6]
        cramped.margins = [7, 7, 7, 7]
        assert.deepEqual(bounds(cramped), ["minimum card separation"])
        sample.layout.input.normal.image.height = 1
        assert.ok(quality(sample).some((failure) => failure.rule === "readable image height"))
        if (width === 1440) {
          await tab(output, "Page")
          await page.getByRole("button", { name: "Geometry", exact: true }).click()
          const dialog = page.getByRole("dialog", { name: "Grid geometry", exact: true })
          await dialog.getByRole("button", { name: "Capture", exact: true }).click()
          await dialog.getByRole("button", { name: "Save JSON", exact: true }).waitFor()
          const [download] = await Promise.all([
            page.waitForEvent("download"),
            dialog.getByRole("button", { name: "Save JSON", exact: true }).click(),
          ])
          const chunks = []
          for await (const chunk of await download.createReadStream()) chunks.push(chunk)
          const exported = JSON.parse(Buffer.concat(chunks).toString("utf8"))
          assert.deepEqual(Object.keys(exported.layout.output), ["normal"])
        }
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
})
