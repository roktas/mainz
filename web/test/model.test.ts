import assert from "node:assert/strict"
import test from "node:test"
import { copyError, downloadInputs, downloadName, expand, job, move, positionAfterEdit } from "../src/model.ts"
import type { Part } from "../src/model.ts"
import { pageRanges, parseSequence, toggleSequence } from "../src/pages.ts"
import * as composition from "../src/composition.ts"
import {
  applyProfile,
  available,
  bufferPages,
  draftError,
  feedback,
  groups,
  matchingProfile,
  needsRender,
  objects,
  step,
  usage,
} from "../src/styles.ts"
import type { Description, Entry, ProfileSet } from "../src/styles.ts"

test("Profiles replace their complete scope and leave other styles independent", () => {
  const set: ProfileSet = {
    id: "print",
    name: "Style profile",
    parameters: ["fill", "width"],
    profiles: [
      { id: "generic", name: "Generic", overrides: {} },
      {
        id: "inkjet",
        name: "Inkjet",
        description: "Fine lines",
        overrides: { fill: "#A9A9A9", width: 0.04 },
      },
    ],
  }
  const state = {
    overrides: { fill: "#123456", other: 0.7 },
    drafts: { width: "invalid", other: "draft" },
  }
  assert.equal(matchingProfile(set, state.overrides, state.drafts), undefined)
  const inkjet = applyProfile(set, set.profiles[1], state)
  assert.deepEqual(inkjet, {
    overrides: { fill: "#A9A9A9", width: 0.04, other: 0.7 },
    drafts: { other: "draft" },
  })
  assert.equal(matchingProfile(set, inkjet.overrides, inkjet.drafts)?.id, "inkjet")
  const generic = applyProfile(set, set.profiles[0], inkjet)
  assert.deepEqual(generic, { overrides: { other: 0.7 }, drafts: { other: "draft" } })
  assert.equal(matchingProfile(set, generic.overrides, generic.drafts)?.id, "generic")
  assert.equal(state.overrides.fill, "#123456")
  assert.equal(state.drafts.width, "invalid")
})

const sources = [
  {
    id: "book",
    input: {
      id: "input",
      sizes: [
        { width: 210, height: 297 },
        { width: 148, height: 210 },
        { width: 210, height: 297 },
      ],
    },
    overrides: { color: "#777777" },
  },
  {
    id: "variant",
    input: { id: "input", sizes: [{ width: 210, height: 297 }] },
    overrides: { color: "#222222" },
  },
] satisfies Parameters<typeof job>[1]
function part(id: string, pages: number[], copies = 1, front = false): Part {
  return {
    id,
    copies,
    front,
    pages: pages.map((page, i) => ({ id: `${id}-${i}`, content: { source: "book", page } })),
  }
}
function sequence(parts: Part[]) {
  return expand(parts, sources).map((page) => ("blank" in page.content ? "Blank" : page.content.page + 1))
}
function positions(pages: readonly { id: string }[]) {
  return new Map(pages.map((page, index) => [page.id, index]))
}

test("Download names use the first contributing Input and local time to hundredths", () => {
  const inputs = [
    { id: "unused", input: { name: "Unused.pdf" } },
    { id: "book", input: { name: "ital-60-sample.PDF" } },
    { id: "variant", input: { name: "Other.pdf" } },
  ]
  const date = new Date(2026, 9, 6, 15, 30, 42, 789)
  const blank: Part = {
    id: "blank",
    copies: 1,
    front: false,
    pages: [{ id: "blank-page", content: { blank: { width: 210, height: 297 } } }],
  }
  const other: Part = {
    ...part("other", [0]),
    pages: [{ id: "other-page", content: { source: "variant", page: 0 } }],
  }
  const duplicate: Part = {
    ...part("duplicate", [0]),
    pages: [{ id: "copy-page", content: { source: "copy", page: 0 } }],
  }
  assert.equal(
    downloadName([blank, part("practice", [1]), other], inputs, date),
    "ital-60-sample_2026-1006-1530-4278.pdf",
  )
  assert.equal(downloadName([other, part("practice", [1])], inputs, date), "Other_2026-1006-1530-4278.pdf")
  assert.equal(
    downloadName([duplicate], [...inputs, { id: "copy", input: inputs[1].input }], date),
    "ital-60-sample_2026-1006-1530-4278.pdf",
  )
  assert.equal(downloadName([blank], inputs, new Date(2026, 0, 2, 3, 4, 5, 9)), "blank-pages_2026-0102-0304-0500.pdf")
})

test("Page entry retains exact order and repetitions with bounded expansion", () => {
  const selected = parseSequence("3-5,2,2,7", 7)
  assert.deepEqual(selected, { pages: [2, 3, 4, 1, 1, 6] })
  assert.equal(pageRanges(selected.pages), "3-5, 2, 2, 7")
  for (const text of ["0", "8", "5-3", "2,", "1.5"]) assert.ok(parseSequence(text, 7).error)
  assert.ok(parseSequence("1-10001", 10001).error)
  assert.deepEqual(parseSequence("", 7), { pages: [] })
})

test("Input range toggles retain authored order and repeated pages", () => {
  const pages = [2, 0, 0]
  assert.deepEqual(toggleSequence(pages, 1, 3), { pages: [2, 0, 0, 1, 3], first: 1, last: 3, adding: true })
  assert.deepEqual(toggleSequence([3, 1, 1, 0], 1, 3), { pages: [0], first: 1, last: 3, adding: false })
  assert.deepEqual(toggleSequence([0], 3, 1).pages, [0, 1, 2, 3])
  assert.deepEqual(toggleSequence([], 2).pages, [2])
  assert.deepEqual(pages, [2, 0, 0])
})

test("Output selections and destinations follow occurrence identity and physical order", () => {
  const pages = part("sequence", [0, 0, 2]).pages
  const ids = pages.map((page) => page.id)
  assert.deepEqual(composition.positions(pages, [ids[2], ids[0], ids[2], "missing"]), [0, 2])
  const selected = new Set([ids[2], ids[0]])
  assert.deepEqual(composition.select(pages, selected, ids[1], ids[2]), {
    selected: new Set([ids[2], ids[0], ids[1]]),
    ids: [ids[1], ids[2]],
    index: 1,
    adding: true,
  })
  assert.deepEqual(composition.select(pages, selected, ids[0], ids[2]), {
    selected: new Set(),
    ids,
    index: 0,
    adding: false,
  })
  assert.deepEqual(
    [...composition.destinations(pages, "book")],
    [
      [0, [0, 1]],
      [2, [2]],
    ],
  )
  assert.deepEqual([...composition.destinations(pages, "variant")], [])
  assert.deepEqual([...composition.destinations(pages)], [])
  assert.deepEqual(selected, new Set([ids[2], ids[0]]))
})

test("Duplex alignment includes leading and every trailing Blank with preceding dimensions", () => {
  assert.deepEqual(sequence([part("practice", [0, 1, 2], 2)]), [1, 2, 3, 1, 2, 3])
  const aligned = [part("prefix", [1]), part("practice", [0, 1, 2], 2, true)]
  assert.deepEqual(sequence(aligned), [2, "Blank", 1, 2, 3, "Blank", 1, 2, 3, "Blank"])
  assert.deepEqual(expand(aligned, sources)[1].content, { blank: { width: 148, height: 210 } })
  assert.deepEqual(expand(aligned, sources).at(-1)?.content, {
    blank: { width: 210, height: 297 },
  })
})

test("Occurrence ordering swaps adjacent positions without crossing boundaries", () => {
  assert.deepEqual(move(["a", "b", "c"], [0], 1), ["b", "a", "c"])
  assert.deepEqual(move(["a", "b", "c"], [2], -1), ["a", "c", "b"])
  assert.deepEqual(move(["a", "b"], [0], -1), ["a", "b"])
  assert.deepEqual(move(["a", "b"], [1], 1), ["a", "b"])
  const pages = ["a", "b", "c", "d", "e"]
  assert.deepEqual(move(pages, [1, 3], -1), ["b", "a", "d", "c", "e"])
  assert.deepEqual(move(pages, [1, 3], 1), ["a", "c", "b", "e", "d"])
  assert.deepEqual(move(pages, [1, 2], -1), ["b", "c", "a", "d", "e"])
  assert.deepEqual(move(pages, [1, 2], 1), ["a", "d", "b", "c", "e"])
  assert.deepEqual(move(pages, [0, 2], -1), pages)
  assert.deepEqual(move(pages, [1, 4], 1), pages)
  assert.deepEqual(pages, ["a", "b", "c", "d", "e"])
})

test("Occurrence identities survive materialization, insertion, reordering, and repetition", () => {
  const original = expand([part("prefix", [1]), part("practice", [0], 2, true)], sources)
  assert.equal(new Set(original.map((page) => page.id)).size, original.length)
  const materialized: Part = { id: "edited", copies: 1, front: false, pages: original }
  assert.deepEqual(
    expand([materialized], sources).map((page) => page.id),
    original.map((page) => page.id),
  )
  const reordered = { ...materialized, pages: move(materialized.pages, [2], -1) }
  assert.deepEqual(
    expand([reordered], sources).map((page) => page.id),
    move(
      original.map((page) => page.id),
      [2],
      -1,
    ),
  )
  const repeated = expand([{ ...reordered, copies: 2 }], sources)
  assert.equal(new Set(repeated.map((page) => page.id)).size, repeated.length)
  assert.deepEqual(
    expand([part("inserted", [2]), materialized], sources)
      .slice(1)
      .map((page) => page.id),
    original.map((page) => page.id),
  )
})

test("Job includes only used Sources, full explicit overrides, and zero-based references", () => {
  const recipe = job([part("practice", [1], 4)], sources)
  assert.deepEqual(recipe, {
    version: 1,
    sources: { book: { input: "input", overrides: { color: "#777777" } } },
    parts: [{ pages: [{ source: "book", page: 1 }], copies: 4, front: false }],
  })
  const blank: Part = {
    id: "blank",
    copies: 1,
    front: false,
    pages: [{ id: "page", content: { blank: { width: 148, height: 210 } } }],
  }
  assert.deepEqual(job([blank], sources).sources, {})
  for (const text of ["", "0", "-1", "1.5", "1001", "Infinity"]) assert.ok(copyError(text))
  assert.equal(copyError("4"), undefined)
  assert.throws(() => job([part("invalid", [0], 0)], sources), /whole number/)
})

test("Download preflight counts referenced Input identities and their aggregate bytes", () => {
  const inputs = Array.from({ length: 33 }, (_, index) => ({
    id: `source-${index}`,
    input: { id: `input-${index}`, bytes: { length: 1 } },
  }))
  const output: Part = {
    id: "output",
    copies: 1,
    front: false,
    pages: inputs.map(({ id }) => ({ id, content: { source: id, page: 0 } })),
  }
  const first32 = { ...output, pages: output.pages.slice(0, 32) }
  assert.equal(downloadInputs([first32], inputs).length, 32)
  assert.throws(() => downloadInputs([output], inputs), /up to 32 Inputs/)
  assert.equal(downloadInputs([{ ...output, pages: output.pages.slice(1) }], inputs).length, 32)
  assert.deepEqual(downloadInputs([], inputs), [])
  const variants = [{ ...inputs[0], id: "variant", overrides: { width: 0.4 } }, ...inputs]
  const pair = { ...output, pages: [output.pages[0], { id: "variant", content: { source: "variant", page: 0 } }] }
  assert.deepEqual(downloadInputs([pair], variants), [inputs[0].input])
  const styles = inputs.map((source) => ({ ...source, input: inputs[0].input }))
  assert.throws(() => downloadInputs([output], styles), /32 independent Input styles/)
  const boundary = [{ ...inputs[0], input: { id: "large", bytes: { length: 128 * 1024 * 1024 } } }, inputs[1]]
  assert.equal(downloadInputs([{ ...output, pages: [output.pages[0]] }], boundary).length, 1)
  assert.throws(() => downloadInputs([{ ...output, pages: output.pages.slice(0, 2) }], boundary), /128 MiB/)
})

test("Page inspection follows occurrence identity and surviving neighbors after edits", () => {
  const pages = expand([part("sequence", [0, 0, 2], 2, true)], sources)
  assert.equal(positionAfterEdit(pages, positions(move(pages, [1], 1)), 1), 2)
  assert.equal(positionAfterEdit(pages, positions(pages.filter((_, index) => index !== 1)), 1), 1)
  assert.equal(positionAfterEdit(pages, positions(pages.slice(0, -1)), pages.length - 1), pages.length - 2)
  assert.equal(positionAfterEdit(pages, positions([pages[0], pages[4]]), 1), 1)
  assert.equal(positionAfterEdit(pages, positions([]), 1), 0)
})

test("Available styles follow only applicable Output pages from the same Source", () => {
  const entry: Entry = {
    parameter: { binding: { property: "stroke-color", targets: [] }, schema: { type: "string" } },
    baseline: { kind: "mixed" },
    pages: [],
  }
  const source = {
    id: "book",
    input: {
      description: {
        version: 1,
        pageCount: 3,
        pages: { first: { index: 0 }, middle: { index: 1 }, last: { index: 2 } },
        parameters: {
          first: { ...entry, pages: ["first"] },
          last: { ...entry, pages: ["last"] },
        },
      } satisfies Description,
    },
  }
  assert.deepEqual(available(source, usage([])), [])
  assert.deepEqual(available(source, usage([part("ordinary", [1])])), [])
  assert.deepEqual(available(source, usage([part("used", [2])])), ["last"])
  const other: Part = {
    ...part("other", [2]),
    pages: [{ id: "other-page", content: { source: "variant", page: 2 } }],
  }
  assert.deepEqual(available(source, usage([other])), [])
})

test("Style coverage counts Source occurrences and copies without duplex padding or Blanks", () => {
  const parts = [part("repeated", [0, 0, 2], 3, true), part("last", [2], 2)]
  parts.push({ ...part("other", [0], 4), pages: [{ id: "foreign", content: { source: "variant", page: 0 } }] })
  parts.push({ ...part("blank", []), pages: [{ id: "blank", content: { blank: { width: 210, height: 297 } } }] })
  assert.deepEqual(
    [...usage(parts).get("book")!],
    [
      [0, 6],
      [2, 5],
    ],
  )
  assert.deepEqual([...usage(parts).get("variant")!], [[0, 4]])
  assert.deepEqual([...usage(parts.toReversed()).get("book")!].toSorted(), [
    [0, 6],
    [2, 5],
  ])
  assert.equal(usage([]).size, 0)
})

test("Preview processing follows changed Output parameters and retains deferred choices", () => {
  const entry: Entry = {
    parameter: { binding: { property: "stroke-color", targets: [] }, schema: { type: "string" } },
    baseline: { kind: "mixed" },
    pages: [],
  }
  const source = {
    id: "book",
    overrides: { first: "#111111", last: "#222222" },
    input: {
      description: {
        version: 1,
        pageCount: 3,
        pages: { first: { index: 0 }, last: { index: 2 } },
        parameters: {
          first: { ...entry, pages: ["first"] },
          last: { ...entry, pages: ["last"] },
        },
      } satisfies Description,
    },
  }
  const rendered = { overrides: { first: "#111111" } }
  assert.equal(needsRender(source, usage([]), rendered), false)
  assert.equal(needsRender(source, usage([part("ordinary", [1])]), rendered), false)
  assert.equal(needsRender(source, usage([part("ordinary", [1])]), { ...rendered, pages: [0] }), false)
  assert.equal(needsRender(source, usage([part("current", [0])]), rendered), false)
  assert.equal(needsRender(source, usage([part("deferred", [2], 2)]), rendered), true)
  assert.equal(needsRender(source, usage([part("current", [2])]), { overrides: source.overrides }), false)
  assert.equal(needsRender(source, usage([part("missing", [2])]), { overrides: source.overrides, pages: [0] }), true)
  assert.equal(needsRender(source, usage([part("covered", [2])]), { overrides: source.overrides, pages: [2] }), false)
  const other: Part = {
    ...part("other", [2]),
    pages: [{ id: "other-page", content: { source: "variant", page: 2 } }],
  }
  assert.equal(needsRender(source, usage([other]), rendered), false)
  const reset = { ...source, overrides: {} }
  assert.equal(needsRender(reset, usage([part("reset", [0])]), rendered), true)
  assert.equal(needsRender(reset, usage([part("unassigned", [2])]), rendered), false)
  assert.deepEqual(source.overrides, { first: "#111111", last: "#222222" })
})

test("Invalid style drafts block only their Source's eligible Output pages", () => {
  const entry: Entry = {
    parameter: { binding: { property: "stroke-color", targets: [] }, schema: { type: "string", title: "Ink" } },
    baseline: { kind: "mixed" },
    pages: ["last"],
  }
  const source = {
    id: "book",
    drafts: { ink: "invalid" },
    input: {
      name: "Book.pdf",
      description: {
        version: 1,
        pageCount: 3,
        pages: { last: { index: 2 } },
        parameters: { ink: entry },
      } satisfies Description,
    },
  }
  assert.equal(draftError(source, usage([])), undefined)
  assert.equal(draftError(source, usage([part("ordinary", [0])])), undefined)
  assert.equal(draftError(source, usage([part("used", [2], 2)])), "Book.pdf: fix Ink before Download.")
  assert.equal(draftError({ ...source, drafts: {} }, usage([part("used", [2])])), undefined)
  assert.equal(draftError({ ...source, id: "other" }, usage([part("used", [2])])), undefined)
  assert.equal(draftError({ ...source, drafts: { ink: "#123456" } }, usage([part("used", [2])])), undefined)
})

test("Small buffers apply only to large Sources with few distinct Output pages", () => {
  const source = { id: "book", input: { description: { pageCount: 32 } as Description } }
  assert.deepEqual(bufferPages(source, usage([part("few", [7, 0, 7], 100)])), [0, 7])
  assert.equal(bufferPages(source, usage([])), undefined)
  assert.equal(
    bufferPages({ ...source, input: { description: { pageCount: 31 } as Description } }, usage([part("few", [0])])),
    undefined,
  )
  assert.equal(
    bufferPages(
      source,
      usage([
        part(
          "many",
          Array.from({ length: 9 }, (_, index) => index),
        ),
      ]),
    ),
    undefined,
  )
  assert.deepEqual(
    bufferPages(
      source,
      usage([
        part(
          "quarter",
          Array.from({ length: 8 }, (_, index) => index),
        ),
      ]),
    ),
    [0, 1, 2, 3, 4, 5, 6, 7],
  )
})

test("Reference controls preserve color steps, width constraints, and exact opacity values", () => {
  const color: Entry = {
    parameter: { binding: { property: "stroke-color", targets: [] }, schema: { type: "string" } },
    baseline: { kind: "mixed" },
    pages: [],
  }
  assert.equal(step(color, "#777777", 1), "#7f7f7f")
  assert.equal(step(color, "#777777", -1), "#6f6f6f")
  const width: Entry = {
    ...color,
    parameter: {
      binding: { property: "stroke-width", targets: [] },
      schema: { type: "number", maximum: 1 },
    },
  }
  assert.equal(step(width, "1", 1), undefined)
  const opacity: Entry = {
    ...color,
    parameter: { binding: { property: "stroke-opacity", targets: [] }, schema: { type: "number" } },
  }
  assert.equal(feedback(opacity, "0.123456789"), undefined)
  assert.ok(feedback(opacity, "1.2"))
})

test("Parameter groups use Title Case and preserve authored array order", () => {
  const parameters = Object.fromEntries(
    ["later", "first", "tied", "z", "a"].map((id) => [
      id,
      {
        parameter: {
          schema: { type: "string" },
          binding: { property: "stroke-color", targets: [] },
        },
        baseline: { kind: "mixed" },
        pages: [],
      } satisfies Entry,
    ]),
  )
  const description: Description = {
    version: 1,
    pageCount: 1,
    pages: {},
    parameters,
    groups: [
      {
        title: "Main reference lines",
        description: "Adjust the main reference lines.",
        parameters: ["later", "first", "tied"],
      },
      { title: "Intermediate lines", parameters: ["z"] },
    ],
  }
  assert.deepEqual(
    groups(description).map((group) => group.title),
    ["Main Reference Lines", "Intermediate Lines", "Other Controls"],
  )
  assert.deepEqual(
    groups(description).map((group) => group.parameters),
    [["later", "first", "tied"], ["z"], ["a"]],
  )
  assert.equal(groups(description)[0].description, "Adjust the main reference lines.")
  assert.deepEqual(description.groups![0].parameters, ["later", "first", "tied"])
})

test("Quartets use complete Style objects at their first parameter's position", () => {
  const parameters: Record<string, Entry> = {
    show: {
      parameter: {
        schema: { type: "string" },
        binding: { property: "display", targets: ["a", "b"] },
      },
      baseline: { kind: "mixed" },
      pages: [],
    },
    shade: {
      parameter: {
        schema: { type: "string" },
        binding: { property: "fill-color", targets: ["b", "a"] },
      },
      baseline: { kind: "mixed" },
      pages: [],
    },
    alpha: {
      parameter: {
        schema: { type: "number" },
        binding: { property: "fill-opacity", targets: ["a", "b"] },
      },
      baseline: { kind: "uniform", value: 0 },
      pages: [],
    },
    weight: {
      parameter: {
        schema: { type: "number" },
        binding: { property: "stroke-width", targets: ["b", "a"] },
      },
      baseline: { kind: "uniform", value: 0.08 },
      pages: [],
    },
    separate: {
      parameter: { schema: { type: "string" }, binding: { property: "display", targets: ["a"] } },
      baseline: { kind: "uniform", value: "inline" },
      pages: [],
    },
  }
  const description: Description = { version: 1, pageCount: 1, pages: {}, parameters }
  const groupObjects = objects(description)
  const ids = ["shade", "alpha", "weight", "show", "separate"]
  assert.deepEqual(groupObjects(ids), [
    {
      parameters: ["shade", "alpha", "weight", "show"],
      quartet: {
        fill: { color: "shade", opacity: "alpha" },
        stroke: { color: undefined, opacity: undefined },
        width: "weight",
        visibility: "show",
      },
    },
    { parameters: ["separate"], quartet: undefined },
  ])
  assert.deepEqual(groupObjects(["shade", "alpha"]), [
    { parameters: ["shade"], quartet: undefined },
    { parameters: ["alpha"], quartet: undefined },
  ])
  assert.deepEqual(
    groupObjects(["separate", "weight", "shade", "show", "alpha"]).map((object) => object.parameters),
    [["separate"], ["weight", "shade", "show", "alpha"]],
  )
  assert.equal(parameters.alpha.baseline.kind, "uniform")
  assert.equal(Object.hasOwn(parameters.alpha.parameter, "value"), false)
  parameters.ink = {
    parameter: {
      schema: { type: "string" },
      binding: { property: "stroke-color", targets: ["a"] },
    },
    baseline: { kind: "uniform", value: "#000000" },
    pages: [],
  }
  description.groups = [{ title: "Drawing", parameters: [...ids, "ink"] }]
  assert.deepEqual(
    objects(description)(groups(description)[0].parameters).map((object) => object.parameters),
    [
      ["shade", "alpha", "weight", "show"],
      ["separate", "ink"],
    ],
  )
  assert.deepEqual(objects(description)(groups(description)[0].parameters)[1].quartet, {
    fill: { color: undefined, opacity: undefined },
    stroke: { color: "ink", opacity: undefined },
    width: undefined,
    visibility: "separate",
  })
  delete parameters.separate
  assert.deepEqual(objects(description)(["ink"]), [{ parameters: ["ink"], quartet: undefined }])
  delete parameters.show
  assert.deepEqual(objects(description)(["shade", "alpha", "weight"]), [
    {
      parameters: ["shade", "alpha", "weight"],
      quartet: {
        fill: { color: "shade", opacity: "alpha" },
        stroke: { color: undefined, opacity: undefined },
        width: "weight",
        visibility: undefined,
      },
    },
  ])
})
