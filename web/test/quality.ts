// Validates the current single-density Grid's measured card and scroll geometry.

import type { Geometry } from "../src/geometry.ts"

export function bounds(grid: Geometry["layout"]["input"][string]) {
  const failures: string[] = []
  const require = (condition: unknown, rule: string) => {
    if (!condition) failures.push(rule)
  }
  const [top, bottom, left, right] = grid.margins
  require(!grid.horizontalOverflow, "horizontal fit")
  require(grid.card.height + 1 >= Math.SQRT2 * grid.card.width &&
    grid.card.height <= (280 / 150) * grid.card.width + 1, "portrait card proportions")
  require(grid.image.height + 1 >= 128, "readable image height")
  require(Math.abs(top - bottom) < 1 && Math.abs(left - right) < 1, "centered images")
  require(Math.min(...grid.margins) >= 2, "clear image margins")
  require(left <= 2 * top + 1, "balanced image margins")
  require(Math.abs(grid.edges[0] - grid.edges[1]) < 1, "equal outside gaps")
  const columnGap = grid.gaps[0]
  if (columnGap !== null)
    require(grid.edges.every((edge) => Math.abs(edge - columnGap) < 1), "even column distribution")
  const gaps = [grid.edges[0], ...grid.gaps.filter((value): value is number => value !== null)]
  require(gaps.every((value) => value + 1 >= 8), "minimum card separation")
  require(gaps.every((value) => value + 1 >= 0.85 * top), "gap to image margin")
  return failures
}

export function quality(sample: Geometry) {
  const failures: { pane: string; rule: string }[] = []
  for (const pane of ["input", "output"] as const) {
    const grid = sample.layout[pane].normal
    if (!grid) {
      failures.push({ pane, rule: "complete capture" })
      continue
    }
    const require = (condition: unknown, rule: string) => {
      if (!condition) failures.push({ pane, rule })
    }
    require(grid.available.every((value, index) => value === sample.viewport.inner[index]), "stable viewport")
    require(grid.ready, "finished rendering")
    require(grid.matrix[0] > 0 && grid.matrix[1] > 0 && grid.matrix[2] > 0, "visible rows")
    require(grid.mounted >= grid.matrix[0] &&
      grid.mounted <= grid.matrix[0] * (grid.matrix[1] + 6), "bounded mounted rows")
    require(grid.total <= grid.matrix[2] || grid.scroll > 1, "scrollable sequence")
    require(grid.scrollTop >= 0 && grid.scrollTop <= grid.scroll + 1, "bounded scroll position")
    require(grid.cards.every(
      (card) =>
        card.left >= grid.grid.left - 1 &&
        card.right <= grid.grid.right + 1 &&
        Math.abs(card.width - grid.card.width) < 1 &&
        Math.abs(card.height - grid.card.height) < 1,
    ), "equal card geometry")
    for (const rule of bounds(grid)) failures.push({ pane, rule })
  }
  const input = sample.layout.input.normal,
    output = sample.layout.output.normal
  if (
    input &&
    output &&
    (Math.abs(input.card.width - output.card.width) >= 1 || Math.abs(input.card.height - output.card.height) >= 1)
  )
    failures.push({ pane: "paired", rule: "matching Input/Output cards" })
  return failures
}
