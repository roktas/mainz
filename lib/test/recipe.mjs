#!/usr/bin/env node
// Checks the existing web Plan serializer against native Recipe execution and the shared WASM interpreter.

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { readFile, writeFile } from "node:fs/promises"
import { basename, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"
import { plan } from "../../web/src/model.ts"
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
const direct = plan(parts, sources)
direct.metadata = { title: "Recipe & <Pages>\rPractice", coverPage: 2 }
const recipe = record(
  parts,
  sources.map((source) => ({
    ...source,
    input: {
      ...source.input,
      name: basename(input),
      bytes: original,
      reference: { sha256: createHash("sha256").update(original).digest("hex"), pageCount: description.pageCount },
      description,
    },
  })),
  direct.metadata,
)
const recordPath = await save("recipe-web.json", recipe)
const planPath = await save("recipe-direct.json", direct)
const bindings = await save("recipe-inputs.json", { book: input, second: input })
const native = join(directory, "recipe-native.pdf")
const expected = join(directory, "recipe-direct.pdf")
const provenance = invoke("apply", recordPath, "--inputs", bindings, "--output", native)
assert.deepEqual(invoke("compose", planPath, "--inputs", bindings, "--output", expected), provenance)
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
json(recipe, (p, n) => module._mainz_resolve_recipe(p, n, 0))
const resolved = value()
assert.deepEqual(resolved.plan, direct)
assert.equal(resolved.checks.state, "ready")
assert.deepEqual(resolved.intent, {
  fine: { profiles: {}, edits: ["color", "width"] },
  original: { profiles: {}, edits: [] },
  other: { profiles: {}, edits: ["width"] },
})
json(resolved.plan, (p, n) => module._mainz_compose(p, n))
await writeFile(join(directory, "recipe-wasm.pdf"), result())
assert.deepEqual(
  JSON.parse(
    decoder.decode(
      module.HEAPU8.slice(module._mainz_provenance(), module._mainz_provenance() + module._mainz_provenance_size()),
    ),
  ),
  provenance,
)
const invalid = structuredClone(recipe)
invalid.parts[0].pages[0].page = 999
json(invalid, (p, n) => module._mainz_resolve_recipe(p, n, 0))
const error = value(1)
assert.equal(error.code, "invalid-request")
assert.equal(error.location, "/parts/0/pages/0")
module._mainz_describe(handle)
assert.deepEqual(value(), description, "Recipe operations retain the active styling document")
json(recipe, (p, n) => module._mainz_resolve_recipe(p, n, 0))
assert.deepEqual(value(), resolved, "Failure leaves registered Inputs available for recovery")
module._mainz_clear_inputs()
result()

// Shared fixtures exercise the same policy through native and WASM entrypoints.
const fixtures = join(directory, "recipe-checks")
execFileSync(resolve("lib/test/fixtures/build.rb"), [cli, fixtures], { encoding: "utf8" })
const cases = JSON.parse(await readFile(join(fixtures, "cases.json"), "utf8"))
for (const entry of cases) {
  const candidate = JSON.parse(await readFile(join(fixtures, `${entry.id}.json`), "utf8"))
  const bytes = new Uint8Array(await readFile(join(fixtures, entry.pdf)))
  module._mainz_clear_inputs()
  result()
  register("book", bytes)
  for (const force of [false, true]) {
    const expectedStatus = entry.state === "error" || (entry.state === "review" && !force) ? 1 : 0
    json(candidate, (p, n) => module._mainz_resolve_recipe(p, n, Number(force)))
    const checked = value(expectedStatus)
    let native
    try {
      native = execFileSync(
        cli,
        ["resolve", join(fixtures, `${entry.id}.json`), "--inputs", "-", "--jsonl", ...(force ? ["--force"] : [])],
        {
          input: JSON.stringify({ book: join(fixtures, entry.pdf) }),
          encoding: "utf8",
          stdio: ["pipe", "pipe", "pipe"],
        },
      )
    } catch (error) {
      assert.equal(error.status, expectedStatus)
      native = error.stdout
    }
    assert.equal(checked.checks?.state ?? checked.details?.state, entry.state)
    const events = native
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line))
    if (expectedStatus) assert.equal(events.at(-1).code, checked.code)
    else {
      assert.deepEqual(events.at(-1).result, checked.plan)
      const aligned = structuredClone(checked.aligned)
      assert.deepEqual(aligned.parts, candidate.parts)
      assert.deepEqual(aligned.sources, candidate.sources)
      assert.equal(aligned.inputs.book.sha256, createHash("sha256").update(bytes).digest("hex"))
      if (force) {
        json(checked.plan, (p, n) => module._mainz_compose(p, n))
        await writeFile(join(directory, `recipe-${entry.id}-wasm.pdf`), result())
        execFileSync(
          cli,
          [
            "apply",
            join(fixtures, `${entry.id}.json`),
            "--inputs",
            "-",
            "--force",
            "--output",
            join(directory, `recipe-${entry.id}-native.pdf`),
          ],
          {
            input: JSON.stringify({ book: join(fixtures, entry.pdf) }),
            stdio: ["pipe", "pipe", "pipe"],
          },
        )
      }
    }
  }
  if (entry.id === "ready") {
    const reset = structuredClone(candidate)
    reset.sources.source.overrides = [{ family: "checks", key: "opacity", value: null, all: true }]
    json(reset, (p, n) => module._mainz_resolve_recipe(p, n, 0))
    const resolved = value()
    assert.deepEqual(resolved.plan.sources.source.overrides, {})
    assert.deepEqual(Object.values(resolved.intent.source.profiles), ["fine", "fine", "fine"])
    assert.equal(resolved.intent.source.edits.length, 3)
    assert.deepEqual(resolved.aligned.sources, reset.sources)
  }
}
module._mainz_clear_inputs()
result()
module._mainz_close(handle)
result()
console.log(
  JSON.stringify({ pages: provenance.pages.length, independentSources: sources.length, checks: cases.length }),
)
