// Fits desktop Grid/Page cards within the measured frame and DESIGN's readability limits.

export function fit(element: HTMLElement) {
  for (const name of ["width", "height", "row-gap"]) element.style.removeProperty(`--grid-${name}`)
  element.style.removeProperty("--grid-fit-columns")
  element.style.removeProperty("--thumbnail-padding")
  const style = getComputedStyle(element)
  if (style.getPropertyValue("--grid-fit").trim() !== "1") return
  // Preferred geometry must not depend on a previous density's distributed gap.
  element.closest<HTMLElement>(".selection-panel, .composition-output")!.style.removeProperty("--grid-column-gap")
  const rem = parseFloat(getComputedStyle(document.documentElement).fontSize)
  // Fine-pointer calibrations express these two inputs in fixed px or rem.
  const length = (name: string) => {
    const value = style.getPropertyValue(name).trim()
    return parseFloat(value) * (value.endsWith("rem") ? rem : 1)
  }
  const compact = !!element.closest('[data-density="compact"]')
  const preferredWidth = parseFloat(style.gridTemplateColumns)
  const preferredHeight = parseFloat(style.gridAutoRows)
  const gap = parseFloat(style.columnGap)
  const padding = Math.min(length("--thumbnail-padding"), rem * (compact ? 0.46875 : 0.875))
  const tools = length("--card-tools-height")
  const image = rem * (compact ? 4.34375 : 8)
  const maxImage = compact ? (8 * rem) / (2 * 0.85) : (4.34375 * rem * 2) / 0.85
  const minimumWidth = Math.min(preferredWidth, compact ? Math.max(74, 5 * parseFloat(style.fontSize)) : 8 * rem)
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
  const columnGap = (bounds.width - columns * width) / (columns + 1)
  const minimumGap = Math.max(gap, 0.85 * columnGap)
  const minimumHeight = Math.max(
    Math.SQRT2 * width,
    Math.max(image, Math.SQRT2 * (width - 2 - 4 * padding)) + tools + 2 * padding,
  )
  // Grid and Page share the same frame; reserve its pager and clear the first slider row.
  const available =
    element.closest<HTMLElement>(".page-content")!.getBoundingClientRect().height - length("--grid-pager-height") - 10
  const rows = Math.max(1, Math.floor((available + minimumGap) / (minimumHeight + minimumGap)))
  const idealGap = Math.max(gap, columnGap)
  const height = Math.max(
    minimumHeight,
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
