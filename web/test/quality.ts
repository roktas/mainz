// Evaluates the DESIGN portrait-fixture bounds before any candidate ranking.

import type { Geometry } from "../src/geometry.ts"

export function quality(sample: Geometry) {
  const failures: { pane: string; density: string; rule: string }[] = []
  for (const pane of ["input", "output"] as const) {
    for (const density of ["normal", "compact"])
      if (!sample.layout[pane][density]) failures.push({ pane, density, rule: "complete capture" })
    for (const [density, grid] of Object.entries(sample.layout[pane])) {
      const require = (condition: unknown, rule: string) => {
        if (!condition) failures.push({ pane, density, rule })
      }
      const [upper, lower, left, right] = grid.margins
      require(grid.available.every(
        (value, index) => value === sample.viewport.inner[index],
      ), "stable viewport across views")
      require(grid.ready, "finished rendering")
      require(grid.capacity.every((value, index) => value === grid.matrix[index]) &&
        grid.matrix[2] === grid.matrix[0] * grid.matrix[1], "complete matrix")
      require(grid.cards.every(
        (card) =>
          card.left >= grid.grid.left - 1 &&
          card.right <= grid.grid.right + 1 &&
          card.bottom <= grid.grid.bottom + 1 &&
          Math.abs(card.width - grid.card.width) < 1 &&
          Math.abs(card.height - grid.card.height) < 1,
      ), "unclipped equal cards")
      require(!grid.horizontalOverflow, "horizontal fit")
      require(grid.scroll <= 1 || grid.matrix[1] === 1, "minimum row scrolling")
      require(grid.card.height + 1 >= Math.SQRT2 * grid.card.width &&
        grid.card.height <= (280 / 150) * grid.card.width + 1, "portrait card proportions")
      require(grid.image.height + 1 >= (density === "compact" ? 69.5 : 128), "readable image height")
      require(Math.abs(upper - lower) < 1 && Math.abs(left - right) < 1, "centered images")
      require(Math.min(...grid.margins) >= 2, "clear image margins")
      require(left <= 2 * upper + 1, "balanced image margins")
      require(Math.abs(grid.edges[0] - grid.edges[1]) < 1, "equal outside gaps")
      const columnGap = grid.gaps[0]
      if (columnGap !== null)
        require(grid.edges.every((edge) => Math.abs(edge - columnGap) < 1), "even column distribution")
      const gaps = [grid.edges[0], ...grid.gaps.filter((gap) => gap !== null)]
      require(gaps.every((gap) => gap + 1 >= 8), "minimum card separation")
      require(gaps.every((gap) => gap + 1 >= 0.85 * upper), "gap to image margin")
      require(Math.min(...gaps) + 1 >= 0.85 * Math.max(...gaps), "balanced row and column gaps")
      require(grid.clearance !== null && grid.clearance >= 7, "pagination clears complete rows")
      require(grid.caption &&
        grid.slider &&
        grid.caption.top >= grid.slider.top + grid.slider.height / 2, "caption below slider")
      require(grid.caption &&
        grid.status !== null &&
        grid.caption.bottom <=
          grid.status + Math.max(0, grid.scroll - grid.scrollPosition[1]) + 1, "pagination above status bar")
    }
    const { normal, compact } = sample.layout[pane]
    if (normal && compact) {
      const ratio = normal.image.height / compact.image.height
      if (Math.min(ratio, 2) / Math.max(ratio, 2) < 0.85)
        failures.push({ pane, density: "paired", rule: "Normal/Compact image scale" })
      if (normal.scroll <= 1 && compact.scroll <= 1 && Math.abs(normal.frame.height - compact.frame.height) >= 1)
        failures.push({ pane, density: "paired", rule: "shared frame" })
    }
  }
  for (const density of ["normal", "compact"]) {
    const input = sample.layout.input[density],
      output = sample.layout.output[density]
    if (
      input &&
      output &&
      (Math.abs(input.card.width - output.card.width) >= 1 || Math.abs(input.card.height - output.card.height) >= 1)
    )
      failures.push({ pane: "paired", density, rule: "matching Input/Output cards" })
  }
  return failures
}
