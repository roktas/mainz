// Shares Page zoom actions and frame-alignment assertions across browser suites.

export async function zoom(pane, action) {
  await pane.locator(".inspection-heading").scrollIntoViewIfNeeded()
  const control = pane.locator(".page-zoom").getByRole("button", { name: action, exact: true })
  if (action === "Reset zoom") {
    if ((await pane.locator(".page-view").getAttribute("data-controls")) === "menu")
      return pane.locator(".page-scroll").press("0")
    const reset = pane.locator(".page-fit")
    await reset.hover()
    return reset.press("0")
  }
  const menu = pane.locator(".sequence-options")
  const summary = pane.locator(
    ':scope:has(.page-view:is([data-controls="fit"], [data-controls="menu"])) .sequence-options > summary',
  )
  await control.or(summary).click()
  if (await menu.evaluate((element) => element.open)) {
    await menu.getByRole("button", { name: action, exact: true }).click()
    await menu.locator("summary").click()
  }
}

export async function aligned(pane) {
  const owner = await pane.elementHandle()
  const result = await pane.page().waitForFunction((panel) => {
    const element = panel.querySelector(".page-view")
    if (!element) return false
    const image = element.querySelector("canvas, .blank-sheet")?.getBoundingClientRect()
    if (!image?.width || element.querySelector('.pdf-viewport[aria-busy="true"]')) return false
    const heading = element.querySelector(".inspection-heading")
    const navigation = element.querySelector(".page-navigation")
    const handle = heading.querySelector(".page-grip")
    const fit = [...heading.querySelector("button.page-fit").children].find((child) =>
      child.checkVisibility({ visibilityProperty: true }),
    )
    const current = heading.querySelector(".page-current").getBoundingClientRect()
    const previous = navigation.querySelector('[data-step="-1"] svg').getBoundingClientRect()
    const next = navigation.querySelector('[data-step="1"] svg').getBoundingClientRect()
    const frame = heading.getBoundingClientRect()
    const grip = handle?.checkVisibility() ? handle.getBoundingClientRect() : undefined
    const actions = navigation.querySelector(".page-actions")?.getBoundingClientRect()
    const leading = grip ?? heading.querySelector(".page-number-control").getBoundingClientRect()
    const footer = navigation.getBoundingClientRect()
    const padding = getComputedStyle(navigation)
    const previousCenter = (footer.left + parseFloat(padding.paddingInlineStart) + actions.left) / 2
    const nextCenter = (actions.right + footer.right - parseFloat(padding.paddingInlineEnd)) / 2
    const tools = [...heading.querySelectorAll(".page-tools button")]
      .filter((el) => el.checkVisibility() && getComputedStyle(el).visibility !== "hidden")
      .map((el) => el.getBoundingClientRect())
    const edges =
      Math.abs(current.left - frame.left - 32) < 1 &&
      Math.abs(previous.left + previous.width / 2 - previousCenter) < 1 &&
      Math.abs(next.left + next.width / 2 - nextCenter) < 1 &&
      (!fit || Math.abs(fit.getBoundingClientRect().right - frame.right + 32) < 1)
    const centered = [heading, navigation].every((row) => {
      const bounds = row.getBoundingClientRect()
      return [...row.querySelectorAll(".page-position, button svg, button .fit-level, .page-zoom > output")]
        .filter((content) => content.checkVisibility() && getComputedStyle(content).visibility !== "hidden")
        .map((content) => content.getBoundingClientRect())
        .filter((content) => content.width > 1)
        .every((content) => Math.abs(content.y + content.height / 2 - bounds.y - bounds.height / 2) < 1)
    })
    return (
      edges &&
      centered &&
      (!grip ||
        (Math.abs(grip.x + grip.width / 2 - frame.x - frame.width / 2) < 1 &&
          Math.abs(grip.x + grip.width / 2 - actions.x - actions.width / 2) < 1)) &&
      (!tools.length || tools[0].left >= leading.right - 1) &&
      tools.every((tool) => Math.abs(tool.y + tool.height / 2 - tools[0].y - tools[0].height / 2) < 1)
    )
  }, owner)
  return result.jsonValue()
}
