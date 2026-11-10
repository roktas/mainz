import assert from "node:assert/strict"
import test from "node:test"
import {
  titleOf,
  titleError,
  copyError,
  downloadInputs,
  downloadName,
  stampedName,
  expand,
  plan,
  move,
  positionAfterEdit,
} from "../src/model.ts"
import type { Part } from "../src/model.ts"
import { pageRanges, parseSequence, toggleGroup, toggleSequence } from "../src/pages.ts"
import * as composition from "../src/composition.ts"
import {
  applyProfile,
  counterparts,
  propagate,
  sharedProfiles,
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

function styleState(
  parameters: Record<string, Entry>,
  overrides: Record<string, number> = {},
  drafts: Record<string, string> = {},
) {
  return {
    input: { description: { version: 1 as const, pageCount: 1, pages: [{}], parameters } },
    overrides,
    drafts,
  }
}

test("Semantic edits preserve divergent values, drafts, ranges, and independent bindings", () => {
  const entry: Entry = {
    parameter: {
      family: "megic",
      key: "guides.width",
      schema: { type: "number" },
      binding: { targets: ["guides"], property: "stroke-width" },
    },
    baseline: { kind: "uniform", value: 0.2 },
    pages: [0],
  }
  const source = styleState({ "ital-foo-bar": entry })
  const target = styleState(
    {
      renamed: entry,
      repeated: {
        ...entry,
        parameter: { ...entry.parameter, binding: { ...entry.parameter.binding, targets: ["other"] } },
      },
      different: entry,
      draft: entry,
      limited: { ...entry, parameter: { ...entry.parameter, schema: { type: "number", maximum: 0.21 } } },
      mixed: { ...entry, baseline: { kind: "mixed" } },
      foreign: { ...entry, parameter: { ...entry.parameter, family: "another" } },
      local: { ...entry, parameter: { schema: entry.parameter.schema, binding: entry.parameter.binding } },
    },
    { different: 0.3 },
    { draft: "invalid" },
  )
  assert.deepEqual(counterparts(source, target, ["ital-foo-bar"]).pairs, [
    ["ital-foo-bar", "renamed"],
    ["ital-foo-bar", "repeated"],
    ["ital-foo-bar", "limited"],
  ])
  const result = propagate(source, { overrides: { "ital-foo-bar": 0.25 }, drafts: {} }, target, ["ital-foo-bar"])
  assert.deepEqual(result, {
    overrides: { different: 0.3, renamed: 0.25, repeated: 0.25 },
    changed: true,
    skipped: 4,
    edits: ["renamed", "repeated"],
  })
  assert.deepEqual(target.overrides, { different: 0.3 })
  assert.deepEqual(target.drafts, { draft: "invalid" })
  const color: Entry = {
    parameter: {
      family: "megic",
      key: "guides.color",
      schema: { type: "string" },
      binding: { targets: ["guides"], property: "stroke-color" },
    },
    baseline: { kind: "uniform", value: "#ABCDEF" },
    pages: [0],
  }
  const colors = propagate(
    styleState({ ink: color }),
    { overrides: { ink: "#112233" }, drafts: {} },
    styleState({ renamed: { ...color, baseline: { kind: "uniform", value: "#abcdef" } } }),
    ["ink"],
  )
  assert.equal(
    colors.overrides.renamed,
    "#112233",
    "Color comparison uses components instead of hexadecimal letter case",
  )
  assert.equal(
    propagate(
      { ...source, drafts: { "ital-foo-bar": "invalid" } },
      { overrides: { "ital-foo-bar": 0.25 }, drafts: {} },
      target,
      ["ital-foo-bar"],
    ).overrides.renamed,
    0.25,
    "Completing a valid edit uses the stored pre-draft value",
  )
  const reset = propagate(
    styleState(source.input.description.parameters, { "ital-foo-bar": 0.25 }),
    { overrides: {}, drafts: {} },
    styleState({ renamed: { ...entry, baseline: { kind: "uniform", value: 0.4 } } }, { renamed: 0.25 }),
    ["ital-foo-bar"],
  )
  assert.deepEqual(reset.overrides, {}, "Reset removes each destination override instead of copying a baseline")
  assert.equal(
    propagate({ ...source, drafts: { "ital-foo-bar": "invalid" } }, { overrides: {}, drafts: {} }, target, [
      "ital-foo-bar",
    ]).changed,
    false,
  )
})

test("Semantic propagation retains opaque local IDs", () => {
  const entry: Entry = {
    parameter: {
      family: "megic",
      key: "width",
      schema: { type: "number" },
      binding: { targets: ["guides"], property: "stroke-width" },
    },
    baseline: { kind: "uniform", value: 0.2 },
    pages: [0],
  }
  const opaque = propagate(
    styleState({ original: entry }),
    { overrides: { original: 0.25 }, drafts: {} },
    styleState(Object.fromEntries([["__proto__", entry]])),
    ["original"],
  )
  assert.equal(Object.hasOwn(opaque.overrides, "__proto__"), true)
  assert.equal(opaque.overrides["__proto__"], 0.25)
})

test("Profile matching requires explicit equal families and names", () => {
  const set: ProfileSet = {
    id: "first",
    family: "megic",
    name: "Choices",
    parameters: ["width"],
    profiles: [{ id: "local", name: "Fine", overrides: {} }],
  }
  assert.equal(sharedProfiles(set, { ...set, id: "second", name: "Different label" }, "Fine"), true)
  assert.equal(sharedProfiles(set, { ...set, family: "other" }, "Fine"), false)
  assert.equal(sharedProfiles({ ...set, family: undefined }, set, "Fine"), false)
  assert.equal(sharedProfiles(set, set, "Other"), false)
})

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
        details: "Uses less ink.\n\nCheck fine lines on your printer.",
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
    profiles: { print: "inkjet" },
    edits: [],
  })
  assert.equal(matchingProfile(set, inkjet.overrides, inkjet.drafts)?.id, "inkjet")
  const generic = applyProfile(set, set.profiles[0], inkjet)
  assert.deepEqual(generic, {
    overrides: { other: 0.7 },
    drafts: { other: "draft" },
    profiles: { print: "generic" },
    edits: [],
  })
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
] satisfies Parameters<typeof plan>[1]
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

test("Download names replace trailing timestamps and preserve the rest of the Input name", () => {
  const date = new Date(2026, 9, 6, 15, 30, 42, 789)
  for (const [name, expected] of [
    ["Practice_2026-1005-0900-1234.pdf", "Practice_2026-1006-1530-4278.pdf"],
    ["Practice_2026-1004-0800-0000_2026-1005-0900-1234.PDF", "Practice_2026-1006-1530-4278.pdf"],
    ["Practice_2026-1005-0900-1234_notes.pdf", "Practice_2026-1005-0900-1234_notes_2026-1006-1530-4278.pdf"],
    ["Practice_2026-1005.pdf", "Practice_2026-1005_2026-1006-1530-4278.pdf"],
    ["Practice_2026-1005-0900.pdf", "Practice_2026-1005-0900_2026-1006-1530-4278.pdf"],
    ["_2026-1005-0900-1234.pdf", "blank-pages_2026-1006-1530-4278.pdf"],
  ]) {
    assert.equal(downloadName([part("practice", [0])], [{ id: "book", input: { name } }], date), expected, name)
  }
})

test("Recipe copies use the shared local timestamp and replace previous filename stamps", () => {
  const date = new Date(2026, 10, 4, 21, 23, 45, 678)
  assert.equal(stampedName("review", "recipe", date), "review_2026-1104-2123-4567")
  assert.equal(
    stampedName("review_2026-1103-1011-1200_2026-1104-1230-0010", "recipe", date),
    "review_2026-1104-2123-4567",
  )
  assert.equal(stampedName("", "recipe", date), "recipe_2026-1104-2123-4567")
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

test("Folded section selection toggles complete groups without changing selections outside them", () => {
  assert.deepEqual(toggleGroup([4, 0, 0], [0, 1, 2]), [4])
  assert.deepEqual(toggleGroup([4], [0, 1, 2]), [4, 0, 1, 2])
  assert.deepEqual(toggleGroup([4, 1, 2], [0, 1, 2]), [4])
  assert.deepEqual(toggleGroup(["other", "child"], ["head", "child"]), ["other"])
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

test("A section moves as one contiguous occurrence group in either direction", () => {
  const pages = ["a0", "a1", "b0", "b1", "b2", "c0"].map((id) => ({ id, content: { source: "book", page: 0 } }))
  const earlier = composition.order(pages, ["b0", "b1", "b2"], -1)
  assert.deepEqual(
    earlier?.pages.map((page) => page.id),
    ["a0", "b0", "b1", "b2", "a1", "c0"],
  )
  const later = composition.order(earlier!.pages, ["b0", "b1", "b2"], 1)
  assert.deepEqual(
    later?.pages.map((page) => page.id),
    pages.map((page) => page.id),
  )
  assert.equal(composition.order(pages, ["a0", "a1"], -1), undefined)
  assert.equal(composition.order(pages, ["c0"], 1), undefined)
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

test("Plan includes only used Sources, full explicit overrides, and zero-based references", () => {
  const request = plan([part("practice", [1], 4)], sources)
  assert.deepEqual(request, {
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
  assert.deepEqual(plan([blank], sources).sources, {})
  for (const text of ["", "0", "-1", "1.5", "1001", "Infinity"]) assert.ok(copyError(text))
  assert.equal(copyError("4"), undefined)
  assert.throws(() => plan([part("invalid", [0], 0)], sources), /whole number/)
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
        pages: [{}, {}, {}],
        parameters: {
          first: { ...entry, pages: [0] },
          last: { ...entry, pages: [2] },
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
        pages: [{}, {}, {}],
        parameters: {
          first: { ...entry, pages: [0] },
          last: { ...entry, pages: [2] },
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
    pages: [2],
  }
  const source = {
    id: "book",
    drafts: { ink: "invalid" },
    input: {
      name: "Book.pdf",
      description: {
        version: 1,
        pageCount: 3,
        pages: [{}, {}, {}],
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
    pages: [{}],
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
  const description: Description = { version: 1, pageCount: 1, pages: [{}], parameters }
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

test("Output titles fit UTF-8 limits and XML text before saving", () => {
  assert.equal(titleOf({ name: ".pdf" }), ".pdf")
  for (const title of ["Ink & <Paper>", "Çalışma", "Pages\nfor practice", "界".repeat(1365)])
    assert.equal(titleError(title), "")
  for (const title of ["", " ", "bad\u0001title", "bad\ufffftitle", "bad\ud800title", "界".repeat(1366)])
    assert.ok(titleError(title))
})
