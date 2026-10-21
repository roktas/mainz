// Searches joint-density card geometry in the caller's actual renderer.

import type { Geometry } from "../src/geometry.ts"
import { quality } from "./quality.ts"

export function candidateCss(baseline: Geometry, width: number, height: number, spacing: number) {
  return ["normal", "compact"]
    .map((density) => {
      const geometry = baseline.layout.input[density].authored
      return `.composer :is(.selection-panel,.composition-output)[data-density="${density}"] {
      --grid-width: ${(geometry.width * width).toFixed(3)}px;
      --grid-height: ${(geometry.height * height).toFixed(3)}px;
      --grid-gap: ${Math.max(8, geometry.gap + spacing).toFixed(3)}px;
      --thumbnail-padding: ${Math.max(2, geometry.padding + spacing).toFixed(3)}px;
    }`
    })
    .join("\n")
}

function fit(baseline: Geometry, density: "normal" | "compact", axis: "row" | "column") {
  const grid = baseline.layout.input[density]
  const columns = grid.matrix[0] + Number(axis === "column")
  const rows = grid.matrix[1] + Number(axis === "row")
  const controls = grid.card.height - grid.image.height - 2 * grid.margins[0]
  const border = grid.card.width - grid.thumbnail.width
  const minimumWidth = density === "compact" ? 74 : 134
  let best: { capacity: number; css: string } | undefined
  for (const image of [grid.image.height, density === "compact" ? 69.5 : 128])
    for (let padding = Math.floor(2 * grid.margins[0]) / 2; padding >= 2; padding -= 0.5) {
      const paper = (image * grid.image.width) / grid.image.height
      // Fit the column budget within the balanced-margin range before checking its distributed row gap.
      const width = Math.min(
        border + paper + 4 * padding,
        (grid.grid.width - (columns + 1) * Math.max(8, 0.85 * padding) - 1) / columns,
      )
      const height = controls + image + 2 * padding
      const minimumGap = Math.max(8, 0.85 * padding)
      const fittedColumns = Math.floor((grid.grid.width - minimumGap) / (width + minimumGap))
      const gap = (grid.grid.width - fittedColumns * width) / (fittedColumns + 1)
      const rowGap = Math.max(gap * grid.authored.rowFactor, minimumGap)
      const fittedRows = Math.floor((grid.grid.height + rowGap - 1) / (height + rowGap))
      if (
        width < minimumWidth ||
        width < border + paper + 2 * padding ||
        fittedColumns < columns ||
        gap < minimumGap ||
        fittedRows < rows ||
        fittedColumns * fittedRows <= (best?.capacity ?? 0)
      )
        continue
      best = {
        capacity: fittedColumns * fittedRows,
        css: `.composer :is(.selection-panel,.composition-output)[data-density="${density}"] {
      --grid-width: ${width.toFixed(3)}px;
      --grid-height: ${height.toFixed(3)}px;
      --grid-gap: ${Math.max(8, 0.85 * padding).toFixed(3)}px;
      --thumbnail-padding: ${padding.toFixed(3)}px;
    }`,
      }
    }
  return best?.css ?? null
}

export async function search(read: () => Promise<Geometry>, apply: (css: string) => Promise<unknown> | void) {
  const baseline = await read()
  if (
    ["input", "output"].some((pane) =>
      ["normal", "compact"].some((density) => !baseline.layout[pane as "input" | "output"][density]),
    )
  )
    throw new Error("Candidate search requires all four Grid views.")
  const plans = []
  for (const width of [1, 0.95, 1.05])
    for (const height of [1, 0.95, 1.05])
      for (const spacing of [0, -6, 2]) {
        const name = width === 1 && height === 1 && spacing === 0 ? "baseline" : `${width}-${height}-${spacing}`
        const css = name === "baseline" ? "" : candidateCss(baseline, width, height, spacing)
        plans.push({ name, css })
      }
  for (const density of ["normal", "compact"] as const)
    for (const axis of ["row", "column"] as const) {
      const css = fit(baseline, density, axis)
      if (css) plans.push({ name: `${density}-${axis}-fit`, css })
    }
  const candidates = []
  try {
    for (const { name, css } of plans) {
      await apply(css)
      const sample = name === "baseline" ? baseline : await read()
      const failures = quality(sample)
      for (const pane of ["input", "output"] as const)
        for (const density of ["normal", "compact"]) {
          const original = baseline.layout[pane][density],
            grid = sample.layout[pane][density]
          if (original.scroll <= 1 && grid.scroll <= 1 && Math.abs(original.frame.height - grid.frame.height) >= 1)
            failures.push({ pane, density, rule: "unchanged frame budget" })
        }
      const grids = [sample.layout.input.normal, sample.layout.input.compact]
      const metrics = {
        silhouette: grids.reduce((sum, grid) => sum + Math.abs(grid.card.height / grid.card.width - Math.SQRT2), 0),
        image: -grids.reduce((sum, grid, index) => sum + grid.image.height / (index ? 69.5 : 128), 0),
        spacing: grids.reduce((sum, grid) => {
          const gaps = [grid.edges[0], ...grid.gaps.filter((gap): gap is number => gap !== null)]
          return sum + (Math.max(...gaps) - Math.min(...gaps)) / Math.max(...gaps)
        }, 0),
        margins: grids.reduce((sum, grid) => sum + Math.max(0, grid.margins[2] / grid.margins[0] - 2), 0),
        unused: grids.reduce((sum, grid) => sum + (grid.grid.bottom - grid.cardsBottom) / grid.frame.height, 0),
        capacity: -grids.reduce((sum, grid) => sum + grid.matrix[2], 0),
      }
      candidates.push({ name, css, failures, metrics, layout: sample.layout })
    }
  } finally {
    await apply("")
  }
  const valid = candidates.filter((candidate) => !candidate.failures.length)
  const frontier = valid.filter(
    (candidate) =>
      !valid.some((other) => {
        const keys = Object.keys(candidate.metrics) as (keyof typeof candidate.metrics)[]
        return (
          keys.every((key) => other.metrics[key] <= candidate.metrics[key]) &&
          keys.some((key) => other.metrics[key] < candidate.metrics[key])
        )
      }),
  )
  const original = candidates[0]
  const improvements = valid
    .filter((candidate) => {
      const noLoss = ["normal", "compact"].every(
        (density) => candidate.layout.input[density].matrix[2] >= baseline.layout.input[density].matrix[2],
      )
      return (
        candidate.metrics.margins <= original.metrics.margins + 0.05 &&
        ((noLoss &&
          (candidate.metrics.capacity < original.metrics.capacity ||
            (candidate.metrics.unused < original.metrics.unused - 0.04 &&
              candidate.metrics.image <= original.metrics.image * 0.98))) ||
          original.failures.length > 0)
      )
    })
    .toSorted(
      (a, b) =>
        a.metrics.capacity - b.metrics.capacity ||
        a.metrics.unused - b.metrics.unused ||
        a.metrics.silhouette - b.metrics.silhouette ||
        a.name.localeCompare(b.name),
    )
  const recommendation = improvements[0]?.name ?? null
  const shortlist = [...new Set(["baseline", ...improvements.slice(0, 2).map((candidate) => candidate.name)])]
  return {
    schemaVersion: 1,
    baseline,
    candidates,
    frontier: frontier.map((candidate) => candidate.name),
    shortlist,
    recommendation,
    decision: recommendation
      ? "native-review-required"
      : original.failures.length
        ? "no-valid-candidate"
        : "no-improvement-in-bounded-search",
    visualApproval: "pending",
  }
}

export type Calibration = Awaited<ReturnType<typeof search>>
