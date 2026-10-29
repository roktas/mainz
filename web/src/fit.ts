// Fits Grid/Page cards within the measured frame and VIEW's readability and target limits.

export function fit(element: HTMLElement) {
  for (const name of ["width", "height", "row-gap"]) element.style.removeProperty(`--grid-${name}`)
  for (const name of ["height", "tool-size", "tools-height"]) element.style.removeProperty(`--card-${name}`)
  element.style.removeProperty("--grid-fit-columns")
  element.style.removeProperty("--thumbnail-padding")
  const style = getComputedStyle(element)
  const mode = style.getPropertyValue("--grid-fit").trim()
  if (mode !== "1" && mode !== "portrait") return
  // Preferred geometry must not depend on a previous density's distributed gap.
  if (mode === "1")
    element.closest<HTMLElement>(".selection-panel, .composition-output")!.style.removeProperty("--grid-column-gap")
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  // Fitting inputs use fixed px or rem values.
  const length = (name: string) => {
    const value = style.getPropertyValue(name).trim()
    return parseFloat(value) * (value.endsWith("rem") ? rem : 1)
  }
  if (mode === "portrait") {
    const bounds = element.getBoundingClientRect()
    const width = parseFloat(style.gridTemplateColumns)
    const preferred = parseFloat(style.gridAutoRows)
    if (!bounds.width || !bounds.height || !Number.isFinite(width + preferred)) return
    const columns = style.gridTemplateColumns.split(" ").length
    const columnGap = (bounds.width - columns * width) / (columns + 1)
    const gap = Math.max(length("--grid-min-row-gap"), parseFloat(style.columnGap))
    const factor = Number(style.getPropertyValue("--grid-row-factor").trim() || 1)
    const previousGap = Math.max(gap, factor * columnGap)
    const previous = Math.max(1, Math.floor((bounds.height + previousGap) / (preferred + previousGap)))
    const image = 8 * rem
    const padding = (width - 2 - image / Math.SQRT2) / 4
    if (padding < 2) return
    const tools = 3.75 * rem
    const minimum = Math.max(Math.SQRT2 * width, image + tools + 2 * padding)
    const rowGap = Math.max(gap, 0.85 * columnGap)
    const rows = Math.max(1, Math.floor((bounds.height + rowGap) / (minimum + rowGap)))
    if (rows <= previous) return
    const height = Math.max(minimum, Math.min(preferred, Math.floor((bounds.height - (rows - 1) * rowGap) / rows)))
    element.style.setProperty("--card-height", `${height}px`)
    element.style.setProperty("--card-tools-height", `${tools}px`)
    element.style.setProperty("--card-tool-size", `${Math.min(32, tools / 2 - 2)}px`)
    element.style.setProperty("--thumbnail-padding", `${padding}px`)
    element.style.setProperty("--grid-row-gap", `${rowGap}px`)
    return
  }
  const compact = !!element.closest('[data-density="compact"]')
  const preferredWidth = parseFloat(style.gridTemplateColumns)
  const preferredHeight = parseFloat(style.gridAutoRows)
  const gap = parseFloat(style.columnGap)
  const padding = Math.min(length("--thumbnail-padding"), rem * (compact ? 0.46875 : 0.875))
  const tools = length("--card-tools-height")
  const image = rem * (compact ? 4.34375 : 8)
  const maxImage = compact ? (8 * rem) / (2 * 0.85) : (4.34375 * rem * 2) / 0.85
  const minimumWidth = Math.min(
    preferredWidth,
    Math.max(
      parseFloat(getComputedStyle(element.firstElementChild!).minInlineSize),
      compact ? Math.max(74, 5 * parseFloat(style.fontSize)) : 8 * rem,
    ),
  )
  const bounds = element.getBoundingClientRect()
  if (!bounds.width || !Number.isFinite(preferredWidth + preferredHeight)) return
  const columns = Math.max(1, Math.floor((bounds.width - gap) / (minimumWidth + gap)))
  let width = Math.max(
    minimumWidth,
    Math.min(
      preferredWidth,
      (maxImage + tools + 2 * padding) / Math.SQRT2,
      maxImage / Math.SQRT2 + 4 * padding + 2,
      (bounds.width - gap) / columns - gap,
    ),
  )
  // Grid and Page share the same frame; reserve its pager and clear the first slider row.
  const available =
    element.closest<HTMLElement>(".page-content")!.getBoundingClientRect().height - length("--grid-pager-height") - 10
  const minimumHeight = (cardWidth: number) =>
    Math.max(Math.SQRT2 * cardWidth, Math.max(image, Math.SQRT2 * (cardWidth - 2 - 4 * padding)) + tools + 2 * padding)
  const rowCount = (cardWidth: number) => {
    const minimumGap = Math.max(gap, (0.85 * (bounds.width - columns * cardWidth)) / (columns + 1))
    return Math.max(1, Math.floor((available + minimumGap) / (minimumHeight(cardWidth) + minimumGap)))
  }
  // A slightly narrower card can retain a complete row at the readable image floor.
  const narrower = Math.max(
    minimumWidth,
    Math.min(width, (image + tools + 2 * padding) / Math.SQRT2, image / Math.SQRT2 + 2 + 4 * padding),
  )
  if (rowCount(narrower) > rowCount(width)) width = narrower
  const columnGap = (bounds.width - columns * width) / (columns + 1)
  const minimumGap = Math.max(gap, 0.85 * columnGap)
  const rows = rowCount(width)
  const idealGap = Math.max(gap, columnGap)
  const height = Math.max(
    minimumHeight(width),
    Math.min(
      preferredHeight,
      (280 / 150) * width,
      maxImage + tools + 2 * padding,
      (available + idealGap) / rows - idealGap,
    ),
  )
  const rowGap = Math.max(minimumGap, Math.min(idealGap, (available - rows * height) / Math.max(1, rows - 1)))
  element.style.setProperty("--grid-width", `${width}px`)
  element.style.setProperty("--grid-fit-columns", String(columns))
  element.style.setProperty("--grid-height", `${height}px`)
  element.style.setProperty("--grid-row-gap", `${rowGap}px`)
  element.style.setProperty("--thumbnail-padding", `${padding}px`)
}
