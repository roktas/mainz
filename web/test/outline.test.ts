// Checks section ranges, incomplete navigation targets, and display-title precedence.

import assert from "node:assert/strict"
import test from "node:test"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { frameOutline, readOutline, sectionsAt, titlesOf } from "../src/outline.ts"
import type { Outline } from "../src/outline.ts"

type Node = NonNullable<Awaited<ReturnType<PDFDocumentProxy["getOutline"]>>>[number]
const node = (title: string, page: number | null, items: Node[] = []): Node => ({
  title,
  dest: page === null ? null : [page],
  items,
  bold: false,
  italic: false,
  color: new Uint8ClampedArray(3),
  url: null,
  unsafeUrl: undefined,
  newWindow: undefined,
  count: undefined,
})
const pdf = (nodes: Node[], numPages = 20) => ({
  numPages,
  getOutline: async () => nodes,
  getDestination: async () => null,
  getPageIndex: async () => {
    throw new Error("Unknown page reference.")
  },
})

test("Untargeted TOC containers retain child ancestry without extending the previous chapter", async () => {
  for (const target of [null, 99]) {
    const outline = await readOutline(
      pdf([node("Earlier chapter", 0), node("New part", target, [node("New chapter", 10)])]),
    )
    assert.deepEqual(
      sectionsAt(outline, 9).map((entry) => entry.path),
      [["Earlier chapter"]],
    )
    assert.deepEqual(
      sectionsAt(outline, 10).map((entry) => entry.path),
      [["New part", "New chapter"]],
    )
    assert.deepEqual(
      outline.map((entry) => entry.depth),
      [0, 0],
    )
  }
})

test("An unusable heading does not discard its navigable children", async () => {
  for (const heading of [" ", "x".repeat(4097)]) {
    const outline = await readOutline(pdf([node("Earlier", 0), node(heading, 10, [node("Child", 10)])]))
    assert.deepEqual(
      sectionsAt(outline, 10).map((entry) => entry.path),
      [["Child"]],
    )
  }
})

test("Same-page sections retain sibling paths and omit their actual ancestors", async () => {
  const outline = await readOutline(
    pdf(
      [
        node("Model", 0, [
          node("Attention", 0, [node("Applications", 0)]),
          node("Feed-forward", 0),
          node("Encoding", 2),
        ]),
        node("Conclusion", 3),
      ],
      4,
    ),
  )
  assert.deepEqual(
    sectionsAt(outline, 0).map((entry) => entry.path),
    [
      ["Model", "Attention", "Applications"],
      ["Model", "Feed-forward"],
    ],
  )
  assert.deepEqual(
    sectionsAt(outline, 1).map((entry) => entry.path),
    [["Model", "Feed-forward"]],
  )
  assert.deepEqual(
    sectionsAt(outline, 2).map((entry) => entry.path),
    [["Model", "Encoding"]],
  )
  assert.deepEqual(
    sectionsAt(outline, 3).map((entry) => entry.path),
    [["Conclusion"]],
  )
})

test("Page titles preserve authored names by default and use TOC only as a display preference", async () => {
  const outline = await readOutline(pdf([node("Chapter", 1, [node("Section", 1)])], 4))
  const input = {
    outline,
    description: {
      version: 1 as const,
      pageCount: 4,
      pages: [{ name: "Cover" }, { name: "Authored" }, {}, { name: "Section" }],
      parameters: {},
    },
  }
  const titles = titlesOf(input)
  assert.equal(titles.choice, true)
  assert.equal(titles.at(0, true).name, "Cover")
  assert.equal(titles.at(1).name, "Authored")
  assert.equal(titles.at(1).paths, undefined)
  assert.deepEqual(titles.at(1).context, [["Chapter", "Section"]])
  assert.equal(titles.at(1, true).name, "Section")
  assert.deepEqual(titles.at(1, true).paths, [["Chapter", "Section"]])
  assert.equal(titles.at(2).name, "Section")
  assert.deepEqual(titles.at(3).context, [["Chapter"]])
  const flat = titlesOf({ ...input, outline: undefined })
  assert.equal(flat.at(1).name, "Authored")
  assert.deepEqual(flat.at(1).headings, [])
  assert.equal(
    titlesOf({ ...input, description: { ...input.description, pages: [{}, { name: "Section" }, {}, {}] } }).choice,
    false,
  )
})

test("Cancellation discards optional TOC work before reading navigation targets", async () => {
  let cancelled = false
  const document = {
    ...pdf([]),
    getOutline: async () => {
      cancelled = true
      return [node("Section", 0)]
    },
  }
  assert.deepEqual(await readOutline(document, () => cancelled), [])
})

test("Every defined TOC heading remains a header independently of its page names", async () => {
  const outline = await readOutline(
    pdf(
      [
        node("Preface", 0),
        node("Chapter 1", 1, [node("Section 1.1", 1, [node("Page X", 2), node("Page Y", 3)])]),
        node("Epilogue", 4),
      ],
      5,
    ),
  )
  const titles = titlesOf({
    outline,
    description: { version: 1, pageCount: 5, pages: Array.from({ length: 5 }, () => ({})), parameters: {} },
  })
  assert.deepEqual(
    Array.from({ length: 5 }, (_, page) => [
      titles.at(page).name,
      titles.at(page).headings.map((heading) => heading.path),
    ]),
    [
      ["Preface", [["Preface"]]],
      ["Section 1.1", [["Chapter 1", "Section 1.1"]]],
      ["Page X", [["Chapter 1", "Section 1.1", "Page X"]]],
      ["Page Y", [["Chapter 1", "Section 1.1", "Page Y"]]],
      ["Epilogue", [["Epilogue"]]],
    ],
  )
})

test("Indexed titles resolve the full supported page count", () => {
  const outline: Outline[] = Array.from({ length: 10000 }, (_, page) => ({
    title: `Section ${page + 1}`,
    path: [`Section ${page + 1}`],
    keys: [String(page)],
    depth: 0,
    page,
    end: page,
  }))
  const titles = titlesOf({
    outline,
    description: { version: 1, pageCount: 10000, pages: Array.from({ length: 10000 }, () => ({})), parameters: {} },
  })
  assert.equal(titles.choice, false)
  assert.equal(titles.at(0).name, "Section 1")
  assert.equal(titles.at(9999).name, "Section 10000")
})

test("Non-monotonic bookmarks retain every overlapping section and the final page title", () => {
  const outline: Outline[] = Array.from({ length: 1000 }, (_, index) => [
    { title: `A${index}`, path: [`A${index}`], keys: [`A${index}`], depth: 0, page: index, end: 999 + index },
    { title: `B${index}`, path: [`B${index}`], keys: [`B${index}`], depth: 0, page: 1000 + index, end: 1000 + index },
  ]).flat()
  const titles = titlesOf({
    outline,
    description: { version: 1, pageCount: 2000, pages: Array.from({ length: 2000 }, () => ({})), parameters: {} },
  })
  assert.equal(titles.at(999).name, "A0")
  assert.equal(titles.at(999).headings.length, 1000)
  assert.equal(titles.at(1999).name, "B999")
})

test("Repeated named and indirect targets resolve once per numeric identity", async () => {
  let destinations = 0,
    pages = 0
  const outline = await readOutline({
    ...pdf([]),
    getOutline: async () => [
      { ...node("Named", null), dest: "chapter" },
      { ...node("Repeated name", null), dest: "chapter" },
      { ...node("Same page", null), dest: [{ num: 7, gen: 0 }] },
      { ...node("Different generation", null), dest: [{ num: 7, gen: 1 }] },
    ],
    getDestination: async () => {
      destinations++
      return [{ num: 7, gen: 0 }]
    },
    getPageIndex: async (reference) => {
      pages++
      return reference.gen === 0 ? 2 : 4
    },
  })
  assert.deepEqual(
    outline.map(({ title, page }) => [title, page]),
    [
      ["Named", 2],
      ["Repeated name", 2],
      ["Same page", 2],
      ["Different generation", 4],
    ],
  )
  assert.equal(destinations, 1)
  assert.equal(pages, 2)
})

test("Outline traversal bounds nodes and depth and cancels awaited targets", async () => {
  assert.equal((await readOutline(pdf(Array.from({ length: 10001 }, () => node("Section", 0))))).length, 10000)
  let branch = node("Leaf", 0)
  for (let depth = 0; depth < 70; depth++) branch = node(`Level ${depth}`, 0, [branch])
  assert.equal((await readOutline(pdf([branch]))).length, 64)
  for (const stage of ["destination", "page"]) {
    let cancelled = false
    const outline = await readOutline(
      {
        ...pdf([{ ...node("Section", null), dest: "chapter" }]),
        getDestination: async () => {
          cancelled = stage === "destination"
          return [{ num: 7, gen: 0 }]
        },
        getPageIndex: async () => {
          cancelled = true
          return 0
        },
      },
      () => cancelled,
    )
    assert.deepEqual(outline, [])
  }
})

test("Virtual edge sections preserve covers, genuine headings, and internal gaps", () => {
  const chapter: Outline = { title: "Prelude", path: ["Prelude"], keys: ["1"], depth: 0, page: 3, end: 5 }
  const pages: { name?: string }[] = Array.from({ length: 9 }, () => ({}))
  for (const first of ["Cover", " FRONT ", "first"])
    for (const last of ["cover", " Back ", "LAST"]) {
      const result = frameOutline([chapter], [{ name: first }, ...pages.slice(1, -1), { name: last }])
      assert.deepEqual(
        result.map(({ title, page, end, synthetic }) => [title, page, end, !!synthetic]),
        [
          ["Prelude", 1, 2, true],
          ["Prelude", 3, 5, false],
          ["Postlude", 6, 7, true],
        ],
      )
      assert.notEqual(result[0].keys[0], result[1].keys[0])
      assert.deepEqual(sectionsAt(result, 0), [])
      assert.deepEqual(sectionsAt(result, 8), [])
    }
  const result = frameOutline([chapter], pages)
  assert.deepEqual([result[0].page, result.at(-1)!.end], [0, 8])
  assert.deepEqual(frameOutline([], pages), [])
  assert.deepEqual(frameOutline([{ ...chapter, page: 0, end: 8 }], pages), [{ ...chapter, page: 0, end: 8 }])
  const withGap = frameOutline(
    [
      { ...chapter, page: 1, end: 2 },
      { ...chapter, keys: ["2"], page: 5, end: 8 },
    ],
    pages,
  )
  assert.deepEqual(sectionsAt(withGap, 3), [])
  assert.equal(frameOutline([chapter], [{ name: "Cover story" }, ...pages.slice(1)])[0].page, 0)
})

test("Inferred last sections retain their full coverage without inventing a Postlude", async () => {
  const original = await readOutline(pdf([node("Chapter", 3)], 8))
  const outline = frameOutline(
    original,
    Array.from({ length: 8 }, () => ({})),
  )
  assert.deepEqual(
    outline.map((entry) => entry.title),
    ["Prelude", "Chapter"],
  )
  assert.equal(outline.at(-1)!.end, 7)
})
