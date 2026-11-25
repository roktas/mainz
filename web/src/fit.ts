// Fits Grid/Page cards within the measured frame and GUI readability and target limits.

export type FitResult = {
  columns: number
  cardWidth: number
  cardHeight: number
  rowGap: number
  gridWidth: number
  styleWidth: string
  styleColumns: string
  stylePadding: string
}

function setProperty(element: HTMLElement, name: string, value: string) {
  if (element.style.getPropertyValue(name) !== value) element.style.setProperty(name, value)
}

function removeProperty(element: HTMLElement, name: string) {
  if (element.style.getPropertyValue(name)) element.style.removeProperty(name)
}

export function fit(element: HTMLElement): FitResult | undefined {
  for (const name of ["width", "height", "row-gap"]) removeProperty(element, `--grid-${name}`)
  for (const name of ["height", "tool-size", "tools-height"]) removeProperty(element, `--card-${name}`)
  removeProperty(element, "--grid-fit-columns")
  removeProperty(element, "--thumbnail-padding")
  const style = getComputedStyle(element)
  const mode = style.getPropertyValue("--grid-fit").trim()
  if (mode !== "1" && mode !== "portrait") return
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  // Fitting inputs use fixed px or rem values.
  const length = (name: string) => {
    const value = style.getPropertyValue(name).trim()
    return parseFloat(value) * (value.endsWith("rem") ? rem : 1)
  }
  if (mode === "portrait" && element.matches(".composition-grid")) return
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
    setProperty(element, "--card-height", `${height}px`)
    setProperty(element, "--card-tools-height", `${tools}px`)
    setProperty(element, "--card-tool-size", `${Math.min(32, tools / 2 - 2)}px`)
    setProperty(element, "--thumbnail-padding", `${padding}px`)
    setProperty(element, "--grid-row-gap", `${rowGap}px`)
    return
  }
  const preferredWidth = parseFloat(style.gridTemplateColumns)
  const preferredHeight = parseFloat(style.gridAutoRows)
  const gap = parseFloat(style.columnGap)
  const rowGap = parseFloat(style.rowGap) || 0
  const currentPadding = length("--thumbnail-padding")
  const padding = Math.min(currentPadding, rem * 0.875)
  const tools = length("--card-tools-height")
  const maxImage = (4.34375 * rem * 2) / 0.85
  if (!element.firstElementChild) return
  const minCardWidth = parseFloat(getComputedStyle(element.firstElementChild).minInlineSize) || 0
  const minimumWidth = Math.min(preferredWidth, Math.max(minCardWidth, 8 * rem))
  const bounds = element.getBoundingClientRect()
  if (!bounds.width || !Number.isFinite(preferredWidth + preferredHeight)) return
  const columns = Math.max(1, Math.floor((bounds.width - gap) / (minimumWidth + gap)))
  const width = Math.max(
    minimumWidth,
    Math.min(
      preferredWidth,
      (maxImage + tools + 2 * padding) / Math.SQRT2,
      maxImage / Math.SQRT2 + 4 * padding + 2,
      (bounds.width - gap) / columns - gap,
    ),
  )
  const styleWidth = `${width}px`
  const styleColumns = String(columns)
  const stylePadding = padding < currentPadding - 0.01 ? `${padding}px` : ""
  setProperty(element, "--grid-width", styleWidth)
  setProperty(element, "--grid-fit-columns", styleColumns)
  if (stylePadding) setProperty(element, "--thumbnail-padding", stylePadding)
  const innerWidth = bounds.width - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd)
  const gridMinWidth = length("--grid-min-width") || minCardWidth
  const cardWidth = Math.min(innerWidth, Math.max(width, gridMinWidth))
  return {
    columns,
    cardWidth,
    cardHeight: preferredHeight,
    rowGap,
    gridWidth: bounds.width,
    styleWidth,
    styleColumns,
    stylePadding,
  }
}
