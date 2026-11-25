// Checks List tree ownership, subtree ranges, and visible row order independently of rendering.

import assert from "node:assert/strict"
import test from "node:test"
import { sectionsOf, outputSections, gridSections, unfoldSamePage, Sections } from "../src/sections.ts"
import type { Outline } from "../src/outline.ts"

const heading = (
  path: string[],
  page: number,
  end: number,
  keys = path.map((_, depth) => path.slice(0, depth + 1).join("/")),
): Outline => ({ title: path.at(-1)!, path, keys, depth: path.length - 1, page, end })
const occurrences = (pages: number[], outline: Outline[]) =>
  outputSections(
    pages.map((page, index) => ({ id: String(index), content: { source: "source", page } })),
    { id: "source", input: { outline } },
  )

test("Section projections retain parent ranges and one visible item per physical page", () => {
  const tree = sectionsOf([
    heading(["Chapter 1", "Section 1.1"], 1, 2),
    heading(["Chapter 1", "Section 1.2"], 3, 3),
    heading(["Chapter 2", "Section 2.1"], 4, 4),
  ])
  assert.equal(tree.roots.length, 2)
  const [chapter, second] = tree.roots
  assert.deepEqual([chapter.start, chapter.end], [1, 4])
  assert.deepEqual(
    chapter.children.map((section) => [section.start, section.end]),
    [
      [1, 3],
      [3, 4],
    ],
  )
  assert.deepEqual(
    second.children.map((section) => section.path),
    [["Chapter 2", "Section 2.1"]],
  )
  assert.deepEqual(gridSections(tree, 6, new Set()).pages, [0, 1, 2, 3, 4, 5])
  assert.deepEqual(gridSections(tree, 6, new Set([chapter.key])).pages, [0, 1, 4, 5])
  assert.deepEqual(gridSections(tree, 6, new Set([chapter.children[0].key])).pages, [0, 1, 3, 4, 5])
})

test("Visible section rows retain duplicate occurrences and independent folds", () => {
  const tree = sectionsOf(
    [heading(["Chapter", "Section"], 0, 1), heading(["Chapter", "Section"], 3, 3)],
    (page) => `occurrence-${page}`,
  )
  assert.equal(tree.roots.length, 2)
  assert.equal(new Set([...tree.nodes.values()].map((section) => section.key)).size, 4)
  assert.deepEqual(gridSections(tree, 4, new Set([tree.roots[0].children[0].key])).pages, [0, 2, 3])
  assert.deepEqual(gridSections(sectionsOf(), 4, new Set()).pages, [0, 1, 2, 3])
})

test("Same-page and identically named TOC entries retain independent headers without duplicating pages", () => {
  const tree = sectionsOf([
    heading(["Chapter", "Repeated"], 0, 1, ["chapter", "first"]),
    heading(["Chapter", "Repeated"], 0, 0, ["chapter", "second"]),
    heading(["Epilogue"], 2, 2),
  ])
  assert.equal(tree.nodes.size, 4)
  const children = tree.roots[0].children
  assert.deepEqual(
    children.map((child) => [child.start, child.end]),
    [
      [0, 2],
      [0, 1],
    ],
  )
  assert.notEqual(children[0].key, children[1].key)
  assert.deepEqual(gridSections(tree, 3, new Set()).pages, [0, 1, 2])
  assert.deepEqual(gridSections(tree, 3, new Set([children[1].key])).pages, [0, 1, 2])
})

test("Reordering a section never promotes its former continuation into a new ribbon", () => {
  const outline = [heading(["A"], 0, 2), heading(["B"], 3, 4), heading(["C"], 5, 5)]
  const moved = [0, 1, 3, 4, 2, 5]
  const sections = occurrences(moved, outline)
  assert.deepEqual(
    [...gridSections(sections, moved.length, new Set()).headings].map(([index, section]) => [index, section.path[0]]),
    [
      [0, "A"],
      [2, "B"],
      [5, "C"],
    ],
  )
  assert.equal(gridSections(sections, moved.length, new Set()).headings.size, 3)
  assert.deepEqual(
    sections.roots.map((section) => [section.start, section.end]),
    [
      [0, 2],
      [2, 4],
      [5, 6],
    ],
  )
  const restored = occurrences([0, 1, 2, 3, 4, 5], outline)
  assert.deepEqual(
    restored.roots.map((section) => [section.start, section.end]),
    [
      [0, 3],
      [3, 5],
      [5, 6],
    ],
  )
})

test("Repeated real heading pages start independent groups with the same source TOC key", () => {
  const pages = [0, 1, 0, 1]
  const sections = occurrences(pages, [heading(["Book"], 0, 1)])
  assert.deepEqual(
    sections.roots.map((section) => [section.start, section.end]),
    [
      [0, 2],
      [2, 4],
    ],
  )
  assert.deepEqual([...gridSections(sections, pages.length, new Set()).headings.keys()], [0, 2])
  assert.notEqual(sections.roots[0].key, sections.roots[1].key)
})

test("Nested section anchors remain available after a parent continuation is detached", () => {
  const tree = occurrences(
    [0, 1, 2, 3],
    [heading(["Parent"], 0, 0), heading(["Parent", "Child"], 2, 3), heading(["Other"], 1, 1)],
  )
  assert.deepEqual([...gridSections(tree, 4, new Set()).headings.keys()], [0, 1, 2])
  assert.deepEqual(tree.roots.at(-1)?.path, ["Parent", "Child"])
  assert.equal(tree.roots.at(-1)?.end, 4)
})

test("Grid folds keep each section's starting page image and retain child choices", () => {
  const tree = sectionsOf([
    heading(["Chapter", "Part A"], 1, 2),
    heading(["Chapter", "Part B"], 3, 3),
    heading(["Next"], 4, 4),
  ])
  const [chapter, next] = tree.roots
  const child = chapter.children[0]
  const visible = gridSections(tree, 6, new Set([child.key]))
  assert.deepEqual(visible.pages, [0, 1, 3, 4, 5])
  assert.equal(visible.headings.get(1)?.key, chapter.key)
  assert.equal(visible.headings.get(3)?.key, chapter.children[1].key)
  assert.equal(visible.headings.get(4)?.key, next.key)
  assert.deepEqual(gridSections(tree, 6, new Set([chapter.key, child.key])).pages, [0, 1, 4, 5])
  assert.deepEqual(gridSections(tree, 6, new Set()).pages, [0, 1, 2, 3, 4, 5])
})

test("Grid offers one ribbon on coincident heading pages without cloning the image", () => {
  const tree = sectionsOf([heading(["Root"], 1, 1), heading(["Root", "Child"], 0, 0)])
  const visible = gridSections(tree, 2, new Set())
  assert.deepEqual(visible.pages, [0, 1])
  assert.equal(visible.headings.get(0)?.path[0], "Root")
  assert.equal(visible.headings.size, 1)
})

test("Grid unfolds same-page descendants without changing later child folds", () => {
  const tree = sectionsOf([
    heading(["Chapter", "Part A", "Topic A"], 0, 1),
    heading(["Chapter", "Part A", "Topic B"], 2, 2),
    heading(["Chapter", "Part B"], 3, 3),
    heading(["Next"], 4, 4),
  ])
  const chapter = tree.roots[0]
  const partA = chapter.children[0]
  const [topicA, topicB] = partA.children
  const partB = chapter.children[1]
  const folded = new Set([...tree.nodes.values()].map((section) => section.key))

  unfoldSamePage(tree, chapter, folded)

  assert.equal(folded.has(chapter.key), false)
  assert.equal(folded.has(partA.key), false)
  assert.equal(folded.has(topicA.key), false)
  assert.equal(folded.has(topicB.key), true)
  assert.equal(folded.has(partB.key), true)
  assert.deepEqual(gridSections(tree, 5, folded).pages, [0, 1, 2, 3, 4])
  assert.equal(folded.has(tree.roots[1].key), true)
})

test("Unfolding coincident root headings reveals their shared pages", () => {
  for (const titles of [
    ["A", "B"],
    ["B", "A"],
  ]) {
    const tree = sectionsOf([
      ...titles.map((title) => heading([title], 0, title === "A" ? 1 : 3)),
      heading(["A", "Child"], 1, 1),
    ])
    const first = tree.roots.find((entry) => entry.path[0] === "A")!
    const second = tree.roots.find((entry) => entry.path[0] === "B")!
    assert.equal(first.end, 2)
    assert.equal(second.end, 4)
    const folded = new Set([...tree.nodes.values()].map((entry) => entry.key))
    const visible = gridSections(tree, 4, folded)
    assert.deepEqual(visible.pages, [0])
    assert.equal(visible.headings.get(0)?.key, second.key)
    assert.equal(visible.ends.get(0), 4)
    assert.deepEqual(gridSections(tree, 4, new Set([first.key])).pages, [0, 2, 3])
    const policy = new Sections(tree, 4, new Set([second.key]))
    assert.deepEqual(policy.visible.pages, [0])
    assert.deepEqual([...policy.visible.headings.keys()], [0])
    assert.equal(policy.state(), "closed")
    unfoldSamePage(tree, visible.headings.get(0)!, folded)
    assert.deepEqual(gridSections(tree, 4, folded).pages, [0, 1, 2, 3])
  }
})
