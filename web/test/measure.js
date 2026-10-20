// Acquires shared geometry samples and groups their measured viewport and frame environments.

import { geometry } from "../src/geometry.ts"

export function environments(records) {
  const groups = new Map()
  for (const { sample, ...record } of records) {
    const bounds = {
      viewport: sample.viewport.inner,
      safeArea: sample.viewport.safeArea,
      pointer: sample.environment.pointer,
      hover: sample.environment.hover,
      paneMode: sample.layout.paneMode,
      frames: Object.fromEntries(
        ["input", "output"].map((pane) => [
          pane,
          Object.fromEntries(
            ["normal", "compact"].map((density) => {
              const frame = sample.layout[pane][density].frame
              return [density, [frame.width, frame.height].map((value) => Math.round(value * 1000) / 1000)]
            }),
          ),
        ]),
      ),
    }
    const key = JSON.stringify(bounds)
    if (!groups.has(key)) groups.set(key, { geometry: bounds, members: [] })
    groups.get(key).members.push({
      ...record,
      device: sample.environment.device,
      presentationMode: sample.environment.presentationMode,
      orientation: sample.environment.orientation,
      evidenceClass: sample.provenance.evidenceClass,
    })
  }
  return [...groups.values()]
}

export async function measure(pane) {
  await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor()
  let previous,
    matches = 0,
    result
  await pane.page().waitForFunction(() => !document.querySelector(".thumbnail[aria-busy=true]"))
  for (let attempt = 0; attempt < 120; attempt++) {
    await pane.page().evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)))
    const sample = await pane.page().evaluate(geometry)
    const name = await pane.evaluate((element) => (element.matches(".selection-panel") ? "input" : "output"))
    const density = (await pane.getAttribute("data-density")) || "normal"
    result = sample.layout[name][density]
    const signature = JSON.stringify(result)
    matches = signature === previous ? matches + 1 : 0
    previous = signature
    if (result?.ready && matches >= 3) return result
  }
  throw new Error("Grid geometry did not stabilize before the capture deadline.")
}

export async function collect(page, capture) {
  const sample = await page.evaluate(geometry)
  sample.layout.input = {}
  sample.layout.output = {}
  const views = page.locator(".mobile-workspace-tabs")
  const previous = {
    pane: await page.locator(".composer").getAttribute("data-view"),
    input: (await page.locator(".selection-panel").getAttribute("data-density")) || "normal",
    output: (await page.locator(".composition-output").getAttribute("data-density")) || "normal",
    scroll: await page.evaluate(() => [scrollX, scrollY]),
  }
  const focus = await page.evaluateHandle(() => document.activeElement)
  try {
    for (const name of ["Input", "Output"]) {
      if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
      const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
      for (const density of ["Normal", "Compact"]) {
        await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
        const grid = await measure(pane)
        if (!Object.keys(sample.layout.input).length) sample.viewport = (await page.evaluate(geometry)).viewport
        grid.capturedAt = new Date().toISOString()
        if (capture) grid.screenshot = await capture(name.toLowerCase(), density.toLowerCase())
        const current = await page.evaluate(geometry)
        if (
          current.environment.pointer !== sample.environment.pointer ||
          current.environment.hover !== sample.environment.hover
        )
          throw new Error("Capture changed the browser's pointer or hover capabilities.")
        sample.layout[name.toLowerCase()][density.toLowerCase()] = grid
      }
    }
    return sample
  } finally {
    for (const name of ["Input", "Output"]) {
      if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click()
      const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
      const density = previous[name.toLowerCase()] === "compact" ? "Compact" : "Normal"
      await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click()
    }
    if (await views.isVisible())
      await views.getByRole("button", { name: previous.pane === "output" ? "Output" : "Input", exact: true }).click()
    for (const selector of [".selection-panel", ".composition-output"]) {
      const pane = page.locator(selector)
      if (await pane.isVisible()) await measure(pane)
    }
    await focus.evaluate((element) => {
      if (element instanceof HTMLElement && element.isConnected) element.focus({ preventScroll: true })
    })
    await focus.dispose()
    await page.evaluate(([x, y]) => scrollTo(x, y), previous.scroll)
  }
}
