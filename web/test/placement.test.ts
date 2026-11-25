// Checks pure Grid drop-preview slot math, renumbering, and pane key-navigation helpers.

import assert from "node:assert/strict"
import test from "node:test"
import { cycleTabKey, requestedViewTab, stepPageIndex } from "../src/keyboard.ts"
import type { Page } from "../src/model.ts"
import { buildMovePrefix, computeGridPreview, gridDisplacement, renumberedOutputPage } from "../src/placement.ts"
import type { GridGeometry } from "../src/placement.ts"

const outputPage = (id: string, page: number): Page => ({ id, content: { source: "a", page } })

test("Grid preview placement shifts remaining pages around moving items", () => {
  const pages = [outputPage("p0", 0), outputPage("p1", 1), outputPage("p2", 2), outputPage("p3", 3)]
  const moving = new Set(["p1"])
  const prefix = buildMovePrefix(pages, moving)
  assert.deepEqual([...prefix], [0, 1, 1, 2, 3])
  const grid: GridGeometry = {
    projection: "{}",
    pages: [0, 1, 2, 3],
    ends: {},
    from: 0,
    count: 4,
    limit: 5,
    columns: 2,
    width: 100,
    height: 140,
    columnGap: 10,
    rowGap: 12,
  }
  const preview = computeGridPreview(grid, pages, moving, 3)
  assert.equal(preview.slot, 2)
  assert.deepEqual(
    [...preview.positions.entries()],
    [
      [0, 0],
      [2, 1],
      [3, 3],
    ],
  )
  assert.equal(renumberedOutputPage(0, prefix, "p0", moving, 2, 0, 1, 0), 1)
  assert.equal(renumberedOutputPage(1, prefix, "p1", moving, 2, 0, 1, 0), 3)
  assert.equal(renumberedOutputPage(2, prefix, "p2", moving, 2, 0, 1, 0), 2)
  assert.equal(renumberedOutputPage(3, prefix, "p3", moving, 2, 0, 1, 0), 4)
  assert.equal(gridDisplacement(grid, 3, 1), "0px 152px")
})

test("Workspace view-tab and page stepping helpers map bounds and wrap around", () => {
  assert.equal(requestedViewTab("gridView", "page"), "grid")
  assert.equal(requestedViewTab("previousView", "style"), "style")
  assert.equal(stepPageIndex("first", 4, 10), 0)
  assert.equal(stepPageIndex("last", 4, 10), 9)
  assert.equal(stepPageIndex("previous", 0, 10), 0)
  assert.equal(stepPageIndex("next", 9, 10), 9)
  assert.equal(cycleTabKey("ArrowRight", ["grid", "list", "page"], "page"), "grid")
  assert.equal(cycleTabKey("ArrowLeft", ["grid", "list", "page"], "grid"), "page")
  assert.equal(cycleTabKey("End", ["grid", "list", "page", "style"], "grid"), "style")
})
