// Checks List tree ownership, subtree ranges, and visible row order independently of rendering.

import assert from "node:assert/strict"
import test from "node:test"
import { sectionsOf, flattenSections, gridSections, unfoldSamePage } from "../src/sections.ts"

const heading = (path: string[]) =>
  path.length ? [{ path, keys: path.map((_, depth) => JSON.stringify(path.slice(0, depth + 1))) }] : []

test("Section trees retain every parent and flatten headers before their pages without indenting", () => {
  const paths = [
    [],
    ["Chapter 1", "Section 1.1"],
    ["Chapter 1", "Section 1.1"],
    ["Chapter 1", "Section 1.2"],
    ["Chapter 2", "Section 2.1"],
    [],
  ]
  const tree = sectionsOf(paths.length, (page) => heading(paths[page]))
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
  assert.deepEqual(flattenSections(tree.roots, paths.length, new Set()), [0, -1, -2, 1, 2, -3, 3, -4, -5, 4, 5])
  assert.deepEqual(flattenSections(tree.roots, paths.length, new Set([chapter.key])), [0, -1, -4, -5, 4, 5])
  assert.deepEqual(
    flattenSections(tree.roots, paths.length, new Set([chapter.children[0].key])),
    [0, -1, -2, -3, 3, -4, -5, 4, 5],
  )
})

test("Visible section rows retain duplicate occurrences and independent folds", () => {
  const paths = [["Chapter", "Section"], ["Chapter", "Section"], [], ["Chapter", "Section"]]
  const tree = sectionsOf(
    paths.length,
    (page) => heading(paths[page]),
    (page) => `occurrence-${page}`,
  )
  assert.equal(tree.roots.length, 2)
  assert.equal(new Set([...tree.nodes.values()].map((section) => section.key)).size, 4)
  assert.deepEqual(
    flattenSections(tree.roots, paths.length, new Set([tree.roots[0].children[0].key])),
    [-1, -2, 2, -3, -4, 3],
  )
  assert.deepEqual(flattenSections(sectionsOf(paths.length).roots, paths.length, new Set()), [0, 1, 2, 3])
})

test("Same-page and identically named TOC entries retain independent headers without duplicating pages", () => {
  const first = { path: ["Chapter", "Repeated"], keys: ["chapter", "first"] }
  const second = { path: ["Chapter", "Repeated"], keys: ["chapter", "second"] }
  const epilogue = { path: ["Epilogue"], keys: ["epilogue"] }
  const paths = [[first, second], [first], [epilogue]]
  const tree = sectionsOf(paths.length, (page) => paths[page])
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
  assert.deepEqual(flattenSections(tree.roots, paths.length, new Set()), [-1, -2, 0, 1, -3, -4, 2])
  assert.deepEqual(flattenSections(tree.roots, paths.length, new Set([children[1].key])), [-1, -2, 0, 1, -3, -4, 2])
})

test("Reordering a section never promotes its former continuation into a new ribbon", () => {
  const source = [
    { id: "a0", path: "A", beginning: true },
    { id: "a1", path: "A", beginning: false },
    { id: "a2", path: "A", beginning: false },
    { id: "b0", path: "B", beginning: true },
    { id: "b1", path: "B", beginning: false },
    { id: "c0", path: "C", beginning: true },
  ]
  const grouped = (pages: typeof source) =>
    sectionsOf(
      pages.length,
      (index) => [{ path: [pages[index].path], keys: [pages[index].path], starts: [pages[index].beginning] }],
      (index) => pages[index].id,
    )
  const moved = [source[0], source[1], source[3], source[4], source[2], source[5]]
  const sections = grouped(moved)
  assert.deepEqual(
    [...gridSections(sections, moved.length, new Set()).headings].map(([index, section]) => [index, section.path[0]]),
    [
      [0, "A"],
      [2, "B"],
      [5, "C"],
    ],
  )
  assert.equal(flattenSections(sections.roots, moved.length, new Set()).filter((index) => index < 0).length, 3)
  assert.deepEqual(
    sections.roots.map((section) => [section.start, section.end]),
    [
      [0, 2],
      [2, 4],
      [5, 6],
    ],
  )
  const restored = grouped(source)
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
  const pages = [
    { id: "b0", start: true },
    { id: "b1", start: false },
    { id: "copy-b0", start: true },
    { id: "copy-b1", start: false },
  ]
  const sections = sectionsOf(
    pages.length,
    (index) => [{ path: ["Book"], keys: ["book"], starts: [pages[index].start] }],
    (index) => pages[index].id,
  )
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
  const pages = [
    { path: ["Parent"], keys: ["p"], starts: [true] },
    { path: ["Other"], keys: ["o"], starts: [true] },
    { path: ["Parent", "Child"], keys: ["p", "c"], starts: [false, true] },
    { path: ["Parent", "Child"], keys: ["p", "c"], starts: [false, false] },
  ]
  const tree = sectionsOf(pages.length, (index) => [pages[index]])
  assert.deepEqual([...gridSections(tree, pages.length, new Set()).headings.keys()], [0, 1, 2])
  assert.deepEqual(tree.roots.at(-1)?.path, ["Parent", "Child"])
  assert.equal(tree.roots.at(-1)?.end, 4)
})

test("Grid folds keep each section's starting page image and retain child choices", () => {
  const paths = [[], ["Chapter", "Part A"], ["Chapter", "Part A"], ["Chapter", "Part B"], ["Next"], []]
  const tree = sectionsOf(paths.length, (page) => heading(paths[page]))
  const [chapter, next] = tree.roots
  const child = chapter.children[0]
  const visible = gridSections(tree, paths.length, new Set([child.key]))
  assert.deepEqual(visible.pages, [0, 1, 3, 4, 5])
  assert.equal(visible.headings.get(1)?.key, chapter.key)
  assert.equal(visible.headings.get(3)?.key, chapter.children[1].key)
  assert.equal(visible.headings.get(4)?.key, next.key)
  assert.deepEqual(gridSections(tree, paths.length, new Set([chapter.key, child.key])).pages, [0, 1, 4, 5])
  assert.deepEqual(gridSections(tree, paths.length, new Set()).pages, [0, 1, 2, 3, 4, 5])
})

test("Grid offers one ribbon on coincident heading pages without cloning the image", () => {
  const roots = [[{ path: ["Root", "Child"], keys: ["root", "child"] }], [{ path: ["Root"], keys: ["root"] }]]
  const tree = sectionsOf(2, (page) => roots[page])
  const visible = gridSections(tree, 2, new Set())
  assert.deepEqual(visible.pages, [0, 1])
  assert.equal(visible.headings.get(0)?.path[0], "Root")
  assert.equal(visible.headings.size, 1)
})

test("Grid unfolds same-page descendants without changing later child folds", () => {
  const paths = [
    ["Chapter", "Part A", "Topic A"],
    ["Chapter", "Part A", "Topic A"],
    ["Chapter", "Part A", "Topic B"],
    ["Chapter", "Part B"],
    ["Next"],
  ]
  const tree = sectionsOf(paths.length, (page) => heading(paths[page]))
  const chapter = tree.roots[0]
  const partA = chapter.children[0]
  const [topicA, topicB] = partA.children
  const partB = chapter.children[1]
  const folded = new Set([...tree.nodes.values()].map((section) => section.key))

  unfoldSamePage(chapter, folded)

  assert.equal(folded.has(chapter.key), false)
  assert.equal(folded.has(partA.key), false)
  assert.equal(folded.has(topicA.key), false)
  assert.equal(folded.has(topicB.key), true)
  assert.equal(folded.has(partB.key), true)
  assert.deepEqual(gridSections(tree, paths.length, folded).pages, [0, 1, 2, 3, 4])
  assert.equal(folded.has(tree.roots[1].key), true)
})
