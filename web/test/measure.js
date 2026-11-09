// Collects current Grid geometry and groups viewport samples by rendered frame.

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
        ["input", "output"].map((pane) => {
          const frame = sample.layout[pane].normal.frame
          return [pane, [frame.width, frame.height].map((value) => Math.round(value * 1000) / 1000)]
        }),
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
  return pane.evaluate(async (element) => {
    const { stable } = await import("/src/geometry.ts")
    const sample = await stable()
    const name = element.matches(".selection-panel") ? "input" : "output"
    return sample.layout[name].normal
  })
}

export async function collect(page, screenshot) {
  const sample = await page.evaluate(async () => (await import("/src/geometry.ts")).capture())
  if (!screenshot) return sample
  const original = await page.evaluate(() => {
    const pane = (selector) => {
      const element = document.querySelector(selector)
      return element?.querySelector(".page-view") ? "page" : element?.querySelector(".page-list") ? "list" : "grid"
    }
    return {
      pane: document.querySelector(".composer")?.getAttribute("data-view"),
      input: pane(".selection-panel"),
      output: pane(".composition-output"),
    }
  })
  const focus = await page.evaluateHandle(() => document.activeElement)
  try {
    for (const name of ["Input", "Output"]) {
      await page.evaluate(async (pane) => (await import("/src/geometry.ts")).view(pane), name)
      const result = sample.layout[name.toLowerCase()].normal
      result.screenshot = await screenshot(name.toLowerCase(), "normal")
    }
  } finally {
    for (const name of ["Input", "Output"]) {
      const mode = original[name.toLowerCase()]
      const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output")
      if (mode === "page") await pane.getByRole("tab", { name: "Page", exact: true }).click()
      else if (mode === "list") await pane.getByRole("tab", { name: "List", exact: true }).click()
    }
    const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
    if (await views.isVisible())
      await views.getByRole("button", { name: original.pane === "output" ? "Output" : "Input", exact: true }).click()
    await focus.evaluate((element) => {
      if (element instanceof HTMLElement && element.isConnected) element.focus({ preventScroll: true })
    })
    await focus.dispose()
  }
  return sample
}
