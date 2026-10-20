// Checks shared geometry exports against desktop and touch fixture references.

import assert from "node:assert/strict"
import test from "node:test"
import { mkdir } from "node:fs/promises"
import { chromium } from "playwright"
import { createServer, fixture } from "./browser.js"
import { collect, environments } from "./measure.js"
import { geometry, csv } from "../src/geometry.ts"
import { quality } from "./quality.ts"

test("One geometry schema captures desktop and touch without changing Grid choices", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    const manifest = await fetch(`${server.resolvedUrls.local[0]}manifest.webmanifest?geometry`).then((response) =>
      response.json(),
    )
    assert.equal(manifest.start_url, "./?demo=grid&geometry")
    assert.equal(manifest.display, "standalone")
    const ordinary = await fetch(`${server.resolvedUrls.local[0]}manifest.webmanifest`).then((response) =>
      response.json(),
    )
    assert.equal(ordinary.start_url, "./")
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const records = []
    for (const [viewport, touch, normal, compact] of [
      [[1920, 982], false, [3, 2, 6], [6, 4, 24]],
      [[810, 1080], true, [5, 2, 10], [9, 4, 36]],
      [[667, 375], true, [4, 1, 4], [7, 1, 7]],
    ]) {
      const context = await browser.newContext({
        viewport: { width: viewport[0], height: viewport[1] },
        hasTouch: touch,
        isMobile: touch,
        reducedMotion: "reduce",
      })
      try {
        const page = await context.newPage()
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.route("**/grid.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
        )
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
        )
        const input = page.locator(".selection-panel")
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
        const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
        await selection.fill("2")
        await selection.focus()
        const before = await page.locator(".composer").getAttribute("data-view")
        const sample = await collect(page, async () => {
          await page.screenshot()
          return null
        })
        assert.equal(sample.schemaVersion, 1)
        assert.deepEqual(sample.viewport.inner, viewport)
        assert.equal(sample.provenance.evidenceClass, "unknown")
        for (const pane of ["input", "output"]) {
          assert.deepEqual(sample.layout[pane].normal.matrix, normal)
          assert.deepEqual(sample.layout[pane].compact.matrix, compact)
        }
        assert.deepEqual(quality(sample), [])
        const native = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
        for (const pane of ["input", "output"])
          for (const density of ["normal", "compact"])
            for (const field of ["matrix", "frame", "card", "image", "gaps"])
              assert.deepEqual(native.layout[pane][density][field], sample.layout[pane][density][field])
        records.push({ id: viewport.join("x"), sample: structuredClone(sample) })
        const partial = structuredClone(sample)
        partial.layout.output = {}
        assert.equal(quality(partial).filter((failure) => failure.rule === "complete capture").length, 2)
        assert.equal(await page.locator(".composer").getAttribute("data-view"), before)
        assert.equal(await input.getAttribute("data-density"), "compact")
        assert.equal(await selection.inputValue(), "2")
        assert.equal(await selection.evaluate((element) => element === document.activeElement), true)
        const measured = await page.evaluate(geometry)
        assert.deepEqual(await page.evaluate(geometry).then((value) => value.layout), measured.layout)
        assert.equal(csv(sample).trim().split("\r\n").length, 5)
        sample.environment.browserFamily = "=UNTRUSTED()"
        assert.ok(csv(sample).includes("'=UNTRUSTED()"))
        const margins = structuredClone(sample)
        const grid = margins.layout.input.normal
        grid.margins[2] = grid.margins[3] = 2 * grid.margins[0] + 2
        assert.ok(quality(margins).some((failure) => failure.rule === "balanced image margins"))
        sample.layout.input.normal.image.height = 1
        assert.ok(quality(sample).some((failure) => failure.rule === "readable image height"))
        if (viewport[1] > 900) {
          await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&geometry`)
          assert.ok((await page.locator('link[rel="manifest"]').getAttribute("href")).endsWith("?geometry"))
          await page.getByRole("button", { name: "Geometry", exact: true }).click()
          const dialog = page.getByRole("dialog", { name: "Grid geometry", exact: true })
          await dialog.getByText("Grid ready.", { exact: true }).waitFor()
          await dialog.getByText("Grid views", { exact: true }).click()
          await dialog.getByRole("button", { name: "Show Output Compact", exact: true }).click()
          await dialog.waitFor({ state: "hidden" })
          await page.waitForFunction(() => !document.querySelector("button[data-geometry]").disabled)
          assert.equal(await page.locator(".composition-output").getAttribute("data-density"), "compact")
          await page.getByRole("button", { name: "Geometry", exact: true }).click()
          await dialog.getByRole("button", { name: "Reload fixture", exact: true }).click()
          await page.waitForFunction(
            () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
          )
          await page.getByRole("button", { name: "Geometry", exact: true }).click()
          await dialog.getByLabel("Device or environment", { exact: true }).fill("Fixture test")
          await dialog.getByRole("button", { name: "Capture all views", exact: true }).click()
          await page.waitForFunction(() =>
            document.querySelector(".geometry-dialog [role=status]")?.textContent?.trim(),
          )
          assert.match(await dialog.getByRole("status").textContent(), /Captured Input and Output/)
          await dialog.getByRole("button", { name: "Export JSON", exact: true }).waitFor()
          for (const extension of ["JSON", "CSV"]) {
            const [download] = await Promise.all([
              page.waitForEvent("download"),
              dialog.getByRole("button", { name: `Export ${extension}`, exact: true }).click(),
            ])
            const chunks = []
            for await (const chunk of await download.createReadStream()) chunks.push(chunk)
            const exported = Buffer.concat(chunks).toString("utf8")
            if (extension === "JSON") {
              const data = JSON.parse(exported)
              assert.equal(data.environment.device, "Fixture test")
              assert.equal(data.environment.source, "unknown")
              assert.equal(Object.keys(data.layout.input).length + Object.keys(data.layout.output).length, 4)
              assert.deepEqual(quality(data), [])
            } else assert.equal(exported.trim().split("\r\n").length, 5)
          }
          await mkdir("../.local/tmp/web/viewport/probe", { recursive: true })
          await page.screenshot({ path: `../.local/tmp/web/viewport/probe/${viewport.join("x")}.png`, fullPage: true })
          const alignment = await dialog.evaluate((element) => {
            const title = element.querySelector("h2").getBoundingClientRect(),
              icon = element.querySelector("svg").getBoundingClientRect()
            return {
              offset: Math.abs(title.y + title.height / 2 - icon.y - icon.height / 2),
              fits: element.scrollWidth <= element.clientWidth,
            }
          })
          assert.ok(alignment.offset < 1 && alignment.fits)
          if (viewport[0] === 810) {
            await dialog.getByRole("button", { name: "Close geometry", exact: true }).click()
            const beforeSearch = await collect(page)
            await page.getByRole("button", { name: "Geometry", exact: true }).click()
            await dialog.getByRole("button", { name: "Search candidates", exact: true }).click()
            await page.waitForFunction(() =>
              document.querySelector(".geometry-dialog [role=status]")?.textContent?.includes("Searched "),
            )
            const [download] = await Promise.all([
              page.waitForEvent("download"),
              dialog.getByRole("button", { name: "Export JSON", exact: true }).click(),
            ])
            const chunks = []
            for await (const chunk of await download.createReadStream()) chunks.push(chunk)
            const report = JSON.parse(Buffer.concat(chunks).toString("utf8"))
            assert.ok(report.candidates.length >= 27 && report.candidates.length <= 31)
            assert.equal(report.candidates[0].name, "baseline")
            assert.deepEqual(report.baseline.viewport.inner, viewport)
            if (report.recommendation)
              assert.deepEqual(
                report.candidates.find((candidate) => candidate.name === report.recommendation).failures,
                [],
              )
            else assert.equal(report.decision, "no-improvement-in-bounded-search")
            assert.equal(report.visualApproval, "pending")
            await dialog.getByRole("button", { name: "Close geometry", exact: true }).click()
            const afterSearch = await collect(page)
            for (const pane of ["input", "output"])
              for (const density of ["normal", "compact"])
                assert.deepEqual(afterSearch.layout[pane][density].card, beforeSearch.layout[pane][density].card)
            if (await page.evaluate(() => document.fullscreenEnabled)) {
              await page.getByRole("button", { name: "Geometry", exact: true }).click()
              await dialog.getByRole("button", { name: "Enter browser fullscreen", exact: true }).click()
              await page.waitForFunction(() => !!document.fullscreenElement)
              assert.equal((await page.evaluate(geometry)).environment.presentationMode, "browser-fullscreen")
              await page.getByRole("button", { name: "Geometry", exact: true }).click()
              await dialog.getByRole("button", { name: "Exit browser fullscreen", exact: true }).click()
              await page.waitForFunction(() => !document.fullscreenElement)
              assert.equal((await page.evaluate(geometry)).environment.presentationMode, "browser-tabbed")
            }
          }
          if (viewport[0] > 1000) {
            for (const pane of [input, page.locator(".composition-output")]) {
              await dialog.getByRole("button", { name: "Close geometry", exact: true }).click()
              await pane.getByRole("tab", { name: "Page", exact: true }).click()
              await page.getByRole("button", { name: "Geometry", exact: true }).click()
              await dialog.getByRole("button", { name: "Capture all views", exact: true }).click()
              await dialog.waitFor()
              assert.match(await dialog.getByRole("status").textContent(), /Grid before capturing geometry/)
              assert.equal(await dialog.getByRole("button", { name: "Export JSON", exact: true }).count(), 0)
            }
          }
        }
      } finally {
        await context.close()
      }
    }
    assert.equal(environments(records).length, 3)
    const duplicate = structuredClone(records[0])
    duplicate.id = "another-model"
    const grouped = environments([...records, duplicate])
    assert.equal(grouped.length, 3)
    assert.equal(grouped[0].members.length, 2)
    duplicate.sample.viewport.safeArea.bottom = 34
    assert.equal(environments([...records, duplicate]).length, 4)
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Measured frames gain rows or columns while keeping balanced readable images", { timeout: 600000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    let page = await browser.newPage({
      viewport: { width: 744, height: 1047 },
      hasTouch: true,
      isMobile: true,
      reducedMotion: "reduce",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
    )
    // Replay the native safe-area budget and shared reference cards; this is regression evidence, not native acquisition.
    await page.addStyleTag({
      content: `
      .footnote { padding-block-end: calc(var(--gap) + 20px); }
      .composer :is(.selection-panel,.composition-output)[data-density="normal"] {
        --grid-width: 148px; --grid-height: 240px; --grid-gap: 11.9px; --thumbnail-padding: 14px;
      }
    `,
    })
    const measureSearch = () =>
      page.evaluate(async () => {
        const { capture } = await import("/src/geometry.ts")
        const { search } = await import("/test/calibration.ts")
        const style = document.createElement("style")
        document.head.append(style)
        try {
          return await search(capture, (css) => {
            style.textContent = css
          })
        } finally {
          style.remove()
        }
      })
    const report = await measureSearch()
    assert.deepEqual(report.baseline.layout.input.normal.matrix, [4, 1, 4])
    const candidate = report.candidates.find((item) => item.name === report.recommendation)
    assert.ok(candidate)
    assert.deepEqual(candidate.failures, [])
    for (const pane of ["input", "output"]) {
      const { normal, compact } = candidate.layout[pane]
      assert.deepEqual(normal.matrix, [4, 2, 8])
      assert.ok(normal.image.height >= 140)
      assert.ok(normal.margins[2] / normal.margins[0] <= 2.05)
      assert.ok(compact.matrix[2] >= report.baseline.layout[pane].compact.matrix[2])
    }
    await page.setViewportSize({ width: 744, height: 1233 })
    await page.addStyleTag({
      content: `
        .composer :is(.selection-panel,.composition-output)[data-density="normal"] { --grid-height: 264px; }
        .composer :is(.selection-panel,.composition-output)[data-density="compact"] {
          --grid-width: 80px; --grid-height: 135px; --thumbnail-padding: 7.5px;
        }
      `,
    })
    const multipleRows = await measureSearch()
    assert.ok(multipleRows.baseline.layout.input.compact.matrix[1] >= 3)
    const column = multipleRows.candidates.find((item) => item.name === "compact-column-fit")
    assert.ok(column, "The fit search includes extra columns in an existing multirow matrix")
    assert.deepEqual(column.failures, [])
    assert.ok(column.layout.input.compact.matrix[0] > multipleRows.baseline.layout.input.compact.matrix[0])
    await page.close()
    page = await browser.newPage({ viewport: { width: 3840, height: 2160 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
    )
    await page.addStyleTag({
      content: `
        .composer :is(.selection-panel,.composition-output) { --grid-row-factor: 1; }
        .composer :is(.selection-panel,.composition-output)[data-density="normal"] {
          --grid-width: 148px; --grid-height: 240px; --grid-gap: 11.9px; --thumbnail-padding: 14px;
        }
        .composer :is(.selection-panel,.composition-output)[data-density="compact"] {
          --grid-width: 74px; --grid-height: 125px; --grid-gap: 8px; --thumbnail-padding: 7.5px;
        }
      `,
    })
    const desktop = await measureSearch()
    const extra = desktop.candidates.find((item) => item.name === "normal-column-fit")
    assert.ok(extra, "The fit search uses balanced margins within the available column budget")
    assert.deepEqual(extra.failures, [])
    assert.ok(extra.layout.input.normal.matrix[0] > desktop.baseline.layout.input.normal.matrix[0])
    assert.deepEqual(extra.layout.input.normal.matrix, [7, 7, 49])
    assert.ok(extra.layout.input.normal.image.height >= 140)
  } finally {
    await browser?.close()
    await server.close()
  }
})
