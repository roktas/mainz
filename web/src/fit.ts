// Fits Grid/Page cards within the measured frame and VIEW's readability and target limits.

export function fit(element: HTMLElement) {
  for (const name of ["width", "height", "row-gap"]) element.style.removeProperty(`--grid-${name}`)
  for (const name of ["height", "tool-size", "tools-height"]) element.style.removeProperty(`--card-${name}`)
  element.style.removeProperty("--grid-fit-columns")
  element.style.removeProperty("--thumbnail-padding")
  const style = getComputedStyle(element)
  const mode = style.getPropertyValue("--grid-fit").trim()
  if (mode !== "1" && mode !== "portrait") return
  // Preferred geometry must not depend on a previous distributed gap.
  if (mode === "1")
    element.closest<HTMLElement>(".selection-panel, .composition-output")!.style.removeProperty("--grid-column-gap")
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
    element.style.setProperty("--card-height", `${height}px`)
    element.style.setProperty("--card-tools-height", `${tools}px`)
    element.style.setProperty("--card-tool-size", `${Math.min(32, tools / 2 - 2)}px`)
    element.style.setProperty("--thumbnail-padding", `${padding}px`)
    element.style.setProperty("--grid-row-gap", `${rowGap}px`)
    return
  }
  const preferredWidth = parseFloat(style.gridTemplateColumns)
  const preferredHeight = parseFloat(style.gridAutoRows)
  const gap = parseFloat(style.columnGap)
  const padding = Math.min(length("--thumbnail-padding"), rem * 0.875)
  const tools = length("--card-tools-height")
  const maxImage = (4.34375 * rem * 2) / 0.85
  const minimumWidth = Math.min(
    preferredWidth,
    Math.max(parseFloat(getComputedStyle(element.firstElementChild!).minInlineSize), 8 * rem),
  )
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
  element.style.setProperty("--grid-width", `${width}px`)
  element.style.setProperty("--grid-fit-columns", String(columns))
  element.style.setProperty("--thumbnail-padding", `${padding}px`)
}
