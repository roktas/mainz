#!/usr/bin/env node
// Checks the existing web Job serializer against native Recipe execution and the shared WASM interpreter.

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { job } from "../../web/src/model.ts"
import { recipe as record } from "../../web/src/recipe.ts"

const [cli, modulePath, input, directory] = process.argv.slice(2).map((value) => resolve(value))
const invoke = (...args) => JSON.parse(execFileSync(cli, args, { encoding: "utf8" }))
const save = async (name, value) => {
  const path = join(directory, name)
  await writeFile(path, JSON.stringify(value))
  return path
}
const original = new Uint8Array(await readFile(input))
const description = invoke("describe", input)
const sizes = Array.from({ length: description.pageCount }, () => ({ width: 210, height: 297 }))
const sources = [
  { id: "original", input: { id: "book", sizes }, overrides: {} },
  { id: "fine", input: { id: "book", sizes }, overrides: { width: 0.2, color: "#112233" } },
  { id: "other", input: { id: "second", sizes }, overrides: { width: 0.15 } },
]
const parts = [
  {
    id: "sequence",
    copies: 2,
    front: true,
    pages: [
      { id: "a", content: { source: "fine", page: 0 } },
      { id: "b", content: { source: "original", page: 1 } },
      { id: "c", content: { source: "other", page: 0 } },
      { id: "d", content: { blank: { width: 80, height: 100 } } },
    ],
  },
]
const direct = job(parts, sources)
const recipe = record(
  parts,
  sources.map((source) => ({
    ...source,
    input: {
      ...source.input,
      name: basename(input),
      bytes: original,
      sha256: createHash("sha256").update(original).digest("hex"),
      description,
    },
  })),
)
const recordPath = await save("recipe-web.json", recipe)
const jobPath = await save("recipe-direct.json", direct)
const bindings = await save("recipe-inputs.json", { book: input, second: input })
const native = join(directory, "recipe-native.pdf")
const expected = join(directory, "recipe-direct.pdf")
const report = invoke("run", recordPath, "--inputs", bindings, "--output", native)
assert.deepEqual(invoke("compose", jobPath, "--inputs", bindings, "--output", expected), report)
assert.deepEqual(await readFile(native), await readFile(expected))

const { default: createModule } = await import(pathToFileURL(modulePath))
const module = await createModule()
const encoder = new TextEncoder()
const decoder = new TextDecoder()
function buffer(bytes, action) {
  const pointer = module._malloc(bytes.length || 1)
  assert.ok(pointer)
  try {
    module.HEAPU8.set(bytes, pointer)
    return action(pointer, bytes.length)
  } finally {
    module._free(pointer)
  }
}
const json = (value, action) => buffer(encoder.encode(JSON.stringify(value)), action)
function result(status = 0) {
  const bytes = module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size())
  assert.equal(module._mainz_status(), status, decoder.decode(bytes))
  return bytes
}
const value = (status = 0) => JSON.parse(decoder.decode(result(status)))
function register(id, bytes) {
  buffer(encoder.encode(id), (p, n) => buffer(bytes, (bp, bn) => module._mainz_input(p, n, bp, bn)))
  result()
}
const handle = buffer(original, (p, n) => module._mainz_read(p, n))
result()
module._mainz_fingerprint(handle)
assert.equal(decoder.decode(result()), createHash("sha256").update(original).digest("hex"))
json(recipe, (p, n) => module._mainz_recipe_inputs(p, n))
assert.deepEqual(value(), recipe.inputs)
register("book", original)
register("second", original)
json(recipe, (p, n) => module._mainz_resolve_recipe(p, n))
const resolved = value()
assert.deepEqual(resolved, { job: direct, warnings: [] })
json(resolved.job, (p, n) => module._mainz_compose(p, n))
await writeFile(join(directory, "recipe-wasm.pdf"), result())
assert.deepEqual(
  JSON.parse(
    decoder.decode(module.HEAPU8.slice(module._mainz_report(), module._mainz_report() + module._mainz_report_size())),
  ),
  report,
)
const invalid = structuredClone(recipe)
invalid.parts[0].pages[0].page = 999
json(invalid, (p, n) => module._mainz_resolve_recipe(p, n))
const error = value(1)
assert.equal(error.code, "invalid-request")
assert.equal(error.location, "/parts/0/pages/0")
module._mainz_describe(handle)
assert.deepEqual(value(), description, "Recipe operations retain the active styling document")
json(recipe, (p, n) => module._mainz_resolve_recipe(p, n))
assert.deepEqual(value(), resolved, "Failure leaves registered Inputs available for recovery")
module._mainz_clear_inputs()
result()

// Announced compatibility suppresses byte warnings, but never actual page or style errors.
const svg = join(directory, "recipe-publication.svg")
await writeFile(
  svg,
  '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><g id="Ink" fill="none" stroke="black"><rect x="20" y="20" width="40" height="40"/></g></svg>',
)
const declaration = {
  publication: { id: "fixture/book", version: "1.10.0" },
  targets: { ink: { selectors: ["#Ink"] } },
  parameters: {
    width: {
      family: "fixture",
      key: "guide.width",
      schema: { type: "number", maximum: 2 },
      binding: { targets: ["ink"], property: "stroke-width" },
    },
  },
}
const published = join(directory, "recipe-publication.pdf")
invoke("produce", svg, "--declaration", await save("recipe-publication.json", declaration), "--output", published)
const forward = {
  version: 1,
  inputs: {
    book: { sha256: "0".repeat(64), publication: { id: "fixture/book", version: "1.9.9" } },
  },
  sources: { source: { input: "book", overrides: [{ family: "fixture", key: "guide.width", value: 0.2 }] } },
  parts: [{ pages: [{ source: "source", pages: "all" }] }],
}
register("book", new Uint8Array(await readFile(published)))
json(forward, (p, n) => module._mainz_resolve_recipe(p, n))
const fast = value()
assert.deepEqual(fast.warnings, [])
json(fast.job, (p, n) => module._mainz_compose(p, n))
await writeFile(join(directory, "recipe-forward-wasm.pdf"), result())
invoke(
  "run",
  await save("recipe-forward.json", forward),
  "--inputs",
  await save("recipe-forward-inputs.json", { book: published }),
  "--output",
  join(directory, "recipe-forward-native.pdf"),
)
for (const candidate of [
  { ...forward, inputs: { book: { ...forward.inputs.book, pageCount: 2 } } },
  { ...forward, sources: { source: { input: "book", overrides: [{ id: "width", value: 3 }] } } },
]) {
  json(candidate, (p, n) => module._mainz_resolve_recipe(p, n))
  assert.equal(value(1).code, "invalid-request")
}
const incompatible = structuredClone(forward)
incompatible.inputs.book.publication.id = "other/book"
json(incompatible, (p, n) => module._mainz_resolve_recipe(p, n))
assert.equal(value().warnings[0].code, "input-incompatible")
module._mainz_clear_inputs()
result()
module._mainz_close(handle)
result()
console.log(JSON.stringify({ pages: report.pages.length, independentSources: sources.length, fastForward: true }))
