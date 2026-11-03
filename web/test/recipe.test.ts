import assert from "node:assert/strict"
import test from "node:test"
import { recipe, identities } from "../src/recipe.ts"
import type { Part, Source } from "../src/model.ts"
import type { Description, Entry } from "../src/styles.ts"
import { applyEdits, applyProfile, editStyle, resetStyles } from "../src/styles.ts"

function source(): Source {
  const width: Entry = {
    parameter: {
      family: "fixture",
      key: "guides.width",
      schema: { type: "number" },
      binding: { property: "stroke-width", targets: ["guides"] },
    },
    baseline: { kind: "uniform", value: 0.2 },
    pages: [0],
  }
  const description: Description = {
    version: 1,
    publication: { id: "fixture/book", version: "1.2.3" },
    pageCount: 1,
    pages: [{}],
    parameters: {
      width,
      opacity: {
        ...width,
        parameter: {
          ...width.parameter,
          key: "guides.opacity",
          binding: { property: "stroke-opacity", targets: ["guides"] },
        },
      },
    },
    profileSets: [
      {
        id: "print",
        family: "fixture",
        name: "Print",
        parameters: ["width", "opacity"],
        profiles: [
          { id: "original", name: "Original", overrides: {} },
          { id: "fine", name: "Fine", overrides: { width: 0.04, opacity: 0.5 } },
        ],
      },
    ],
  }
  return {
    id: "source",
    input: {
      id: "book",
      name: "book.pdf",
      bytes: new Uint8Array([1, 2]),
      sha256: "a".repeat(64),
      sizes: [{ width: 210, height: 297 }],
      labels: ["1"],
      description,
      pdf: null!,
    },
    overrides: {},
    drafts: {},
    modified: false,
    preview: null!,
  }
}
const parts: Part[] = [
  {
    id: "part",
    copies: 2,
    front: true,
    pages: [
      { id: "page", content: { source: "source", page: 0 } },
      { id: "blank", content: { blank: { width: 80, height: 100 } } },
    ],
  },
]

test("Recipe retains explicit profile intent, equal-valued manual edits, and baseline resets", () => {
  const original = source()
  original.profiles = { print: "fine" }
  original.overrides = { width: 0.04 }
  original.edits = ["width", "opacity"]
  const saved = recipe(parts, [original])
  assert.deepEqual(saved.sources.source, {
    input: "book",
    profiles: [{ family: "fixture", name: "Fine" }],
    overrides: [
      { family: "fixture", key: "guides.width", value: 0.04 },
      { family: "fixture", key: "guides.opacity", value: null },
    ],
  })
  assert.deepEqual(saved.inputs.book, {
    sha256: "a".repeat(64),
    publication: { id: "fixture/book", version: "1.2.3" },
  })
  assert.deepEqual(saved.parts, [
    { pages: [{ source: "source", page: 0 }, { blank: { width: 80, height: 100 } }], copies: 2, front: true },
  ])
  assert.deepEqual(original.overrides, { width: 0.04 })
})

test("Style transitions preserve explicit Recipe intent through drafts, resets, and profiles", () => {
  let original = source()
  const set = original.input.description.profileSets![0]
  original = { ...original, ...applyProfile(set, set.profiles[1], original) }
  assert.deepEqual(recipe(parts, [original]).sources.source, {
    input: "book",
    profiles: [{ family: "fixture", name: "Fine" }],
    overrides: [],
  })
  const rejected = editStyle(original.input.description.parameters.width, "width", "invalid", original)
  assert.ok(rejected.error)
  assert.deepEqual(rejected.state.edits, [])
  assert.deepEqual(rejected.state.overrides, { width: 0.04, opacity: 0.5 })
  const accepted = editStyle(original.input.description.parameters.width, "width", "0.04", original)
  assert.equal(accepted.error, undefined)
  original = { ...original, ...accepted.state }
  assert.deepEqual(recipe(parts, [original]).sources.source.overrides, [
    { family: "fixture", key: "guides.width", value: 0.04 },
  ])
  const invalid = editStyle(original.input.description.parameters.width, "width", "invalid", original)
  assert.ok(invalid.error)
  assert.deepEqual(invalid.state.overrides, original.overrides)
  assert.deepEqual(invalid.state.edits, ["width"])
  assert.deepEqual(invalid.state.drafts, { width: "invalid" })
  original = { ...original, ...resetStyles(invalid.state, "width") }
  assert.deepEqual(original.drafts, {})
  assert.deepEqual(recipe(parts, [original]).sources.source, {
    input: "book",
    profiles: [{ family: "fixture", name: "Fine" }],
    overrides: [{ family: "fixture", key: "guides.width", value: null }],
  })
  original = { ...original, ...applyEdits(original, { width: 0.06, opacity: 0.5 }, ["width"]) }
  assert.deepEqual(original.edits, ["width"])
  original = { ...original, ...applyProfile(set, set.profiles[1], original) }
  assert.deepEqual(original.edits, [])
  assert.deepEqual(recipe(parts, [original]).sources.source.overrides, [])
  original = { ...original, ...resetStyles(original) }
  assert.deepEqual(recipe(parts, [original]).sources.source, { input: "book", profiles: [], overrides: [] })
  assert.deepEqual(original.drafts, {})
})

test("Recipe never infers profiles or all-pages intent from concrete values", () => {
  const original = source()
  original.overrides = { width: 0.04, opacity: 0.5 }
  const saved = recipe(parts, [original, { ...source(), id: "unused" }])
  assert.deepEqual(Object.keys(saved.sources), ["source"])
  assert.deepEqual(saved.sources.source.profiles, [])
  assert.deepEqual(saved.sources.source.overrides, [
    { family: "fixture", key: "guides.width", value: 0.04 },
    { family: "fixture", key: "guides.opacity", value: 0.5 },
  ])
  assert.deepEqual(saved.parts[0].pages[0], { source: "source", page: 0 })
  assert.equal(Object.hasOwn(saved.inputs.book, "pageCount"), false)
  const blanks = recipe([{ ...parts[0], pages: [parts[0].pages[1]] }], [original])
  assert.deepEqual(blanks.inputs, {})
  assert.deepEqual(blanks.sources, {})
})

test("Recipe uses exact local selectors when semantic targets repeat", () => {
  const original = source()
  const description = original.input.description
  description.parameters.repeated = description.parameters.width
  description.profileSets!.push({
    ...description.profileSets![0],
    id: "other",
    parameters: ["repeated"],
    profiles: [
      { id: "original", name: "Original", overrides: {} },
      { id: "fine", name: "Fine", overrides: { repeated: 0.04 } },
    ],
  })
  original.profiles = { print: "fine" }
  original.overrides = { width: 0.06, opacity: 0.5 }
  original.edits = ["width"]
  const saved = recipe(parts, [original])
  assert.deepEqual(saved.sources.source.profiles, [{ set: "print", id: "fine" }])
  assert.deepEqual(saved.sources.source.overrides, [{ id: "width", value: 0.06 }])
})

test("Recipe Input IDs are unique labels independent of file locations", () => {
  assert.equal(Object.keys(identities({ first: "book", second: "book" })).length, 2)
  assert.deepEqual(identities({ first: "book", second: "other" }), {})
  assert.deepEqual(identities({ first: "Book", second: "book" }), {})
  assert.deepEqual(identities({ first: "arbitrary/id: label" }), {})
  for (const id of ["", " ", "a\u0000b", "a".repeat(4097), "\ud800"]) assert.ok(identities({ book: id }).book)
})
