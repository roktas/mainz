#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { dirname, join, resolve } from "node:path"
import { pathToFileURL } from "node:url"

const [modulePath, input, nativeDescription, output] = process.argv.slice(2)
const { default: createModule } = await import(pathToFileURL(resolve(modulePath)))
const module = await createModule()
const pdf = new Uint8Array(await readFile(input))
function buffer(bytes, operation) {
  const pointer = module._malloc(bytes.length || 1)
  assert.ok(pointer)
  try {
    module.HEAPU8.set(bytes, pointer)
    return operation(pointer, bytes.length)
  } finally {
    module._free(pointer)
  }
}
function result() {
  const bytes = module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size())
  assert.equal(module._mainz_status(), 0, new TextDecoder().decode(bytes))
  return bytes
}
let handle = buffer(pdf, (p, n) => module._mainz_read(p, n))
assert.ok(handle)
module._mainz_describe(handle)
const description = JSON.parse(new TextDecoder().decode(result()))
assert.deepEqual(description, JSON.parse(await readFile(nativeDescription, "utf8")))
const request = new TextEncoder().encode(
  JSON.stringify({
    width: 0.2,
    color: "#123456",
    opacity: 0.65,
    "guide-display": "inline",
    "guide-fill": 0.4,
    "guide-color": "#FF0000",
    "fill-opacity": 0.2,
    "fill-color": "#00FF00",
  }),
)
buffer(request, (p, n) => module._mainz_apply(handle, p, n))
const editedBytes = result()
await writeFile(output, editedBytes)
module._mainz_close(handle)
result()
const editedHandle = buffer(editedBytes, (p, n) => module._mainz_read(p, n))
assert.ok(editedHandle > handle)
module._mainz_describe(editedHandle)
const editedDescription = JSON.parse(new TextDecoder().decode(result()))
assert.equal(editedDescription.parameters.color.parameter.value, "#123456")
assert.equal(editedDescription.parameters.opacity.parameter.value, 0.65)
module._mainz_close(editedHandle)
handle = buffer(pdf, (p, n) => module._mainz_read(p, n))
result()
buffer(new TextEncoder().encode("[]"), (p, n) => module._mainz_reset(handle, p, n, 1))
assert.deepEqual(result(), pdf)
buffer(new TextEncoder().encode('["color","width"]'), (p, n) => module._mainz_reset(handle, p, n, 1))
assert.deepEqual(result(), pdf)
// apply() and reset() leave the validated Input immutable across repeated operations.
buffer(request, (p, n) => module._mainz_apply(handle, p, n))
assert.deepEqual(result(), new Uint8Array(await readFile(output)))
buffer(new TextEncoder().encode('["opacity","opacity"]'), (p, n) => module._mainz_reset(handle, p, n, 1))
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "invalid-request",
)
for (const [name, pages] of [
  ["pristine", [0]],
  ["ordinary", [1]],
  ["reverse", [1, 0]],
]) {
  buffer(new TextEncoder().encode(JSON.stringify(pages)), (p, n) => module._mainz_extract(handle, p, n))
  await writeFile(join(dirname(output), `wasm-extracted-${name}.pdf`), result())
}
buffer(new TextEncoder().encode("[0,1]"), (p, n) => module._mainz_extract(handle, p, n))
assert.deepEqual(result(), pdf)
buffer(new TextEncoder().encode("[0,0]"), (p, n) => module._mainz_extract(handle, p, n))
assert.equal(module._mainz_status(), 1)
const selectionError = JSON.parse(
  new TextDecoder().decode(module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size())),
)
assert.equal(selectionError.code, "invalid-request")
assert.equal(selectionError.location, "/1")
buffer(new TextEncoder().encode('{"opacity":2}'), (p, n) => module._mainz_apply(handle, p, n))
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "invalid-request",
)
module._mainz_close(handle)
assert.equal(module._mainz_status(), 0)
module._mainz_describe(handle)
assert.equal(module._mainz_status(), 2)
const second = buffer(pdf, (p, n) => module._mainz_read(p, n))
assert.ok(second > handle)
buffer(request, (p, n) => module._mainz_apply(second, p, n))
assert.deepEqual(result(), editedBytes)
module._mainz_close(second)
// An earlier Input can reopen after a changed result without sharing its selected styles.
const originalAgain = buffer(pdf, (p, n) => module._mainz_read(p, n))
assert.ok(originalAgain > second)
module._mainz_describe(originalAgain)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), description)
module._mainz_close(originalAgain)
const corruptInput = pdf.slice()
corruptInput[0] = 0
assert.equal(
  buffer(corruptInput, (p, n) => module._mainz_read(p, n)),
  0,
)
assert.equal(module._mainz_status(), 1)
// A same-sized mutation must never reuse the validated result's description.
const tampered = editedBytes.slice()
tampered[0] = 0
assert.equal(
  buffer(tampered, (p, n) => module._mainz_read(p, n)),
  0,
)
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "pdf-syntax",
)
const reopened = buffer(editedBytes, (p, n) => module._mainz_read(p, n))
assert.ok(reopened > second)
module._mainz_describe(reopened)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), editedDescription)
module._mainz_close(reopened)
const sharedPdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "shared.pdf")))
const sharedHandle = buffer(sharedPdf, (p, n) => module._mainz_read(p, n))
assert.ok(sharedHandle)
buffer(new TextEncoder().encode('{"color":"#123456"}'), (p, n) => module._mainz_apply(sharedHandle, p, n))
await writeFile(join(dirname(output), "wasm-shared-edited.pdf"), result())
module._mainz_close(sharedHandle)
const densePdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "dense-manifest.pdf")))
const denseHandle = buffer(densePdf, (p, n) => module._mainz_read(p, n))
assert.ok(denseHandle)
buffer(new TextEncoder().encode('{"opacity":0.65}'), (p, n) => module._mainz_apply(denseHandle, p, n))
const denseEdited = result()
module._mainz_close(denseHandle)
const denseReopened = buffer(denseEdited, (p, n) => module._mainz_read(p, n))
assert.ok(denseReopened)
module._mainz_describe(denseReopened)
const denseDescription = JSON.parse(new TextDecoder().decode(result()))
assert.equal(denseDescription.groups.length, 17_000)
assert.equal(denseDescription.parameters.opacity.parameter.value, 0.65)
module._mainz_close(denseReopened)
const precisePdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "precise-baselines.pdf")))
const preciseHandle = buffer(precisePdf, (p, n) => module._mainz_read(p, n))
assert.ok(preciseHandle)
module._mainz_describe(preciseHandle)
const preciseDescription = JSON.parse(new TextDecoder().decode(result()))
assert.deepEqual(preciseDescription.parameters.opacity.baseline, { kind: "uniform", value: 0.123456789 })
assert.equal(preciseDescription.parameters["guide-width"].baseline.kind, "uniform")
assert.ok(preciseDescription.parameters["guide-width"].baseline.value > 0)
module._mainz_close(preciseHandle)
const opaquePdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "opaque-identities.pdf")))
const opaqueOpacity = 'opacity"\\雪/~'
const opaqueHandle = buffer(opaquePdf, (p, n) => module._mainz_read(p, n))
assert.ok(opaqueHandle)
buffer(new TextEncoder().encode(JSON.stringify({ [opaqueOpacity]: 0.65 })), (p, n) =>
  module._mainz_apply(opaqueHandle, p, n),
)
const opaqueEdited = result()
module._mainz_close(opaqueHandle)
const opaqueReopened = buffer(opaqueEdited, (p, n) => module._mainz_read(p, n))
assert.ok(opaqueReopened)
module._mainz_describe(opaqueReopened)
const opaqueDescription = JSON.parse(new TextDecoder().decode(result()))
assert.equal(opaqueDescription.parameters[opaqueOpacity].parameter.value, 0.65)
module._mainz_close(opaqueReopened)
for (const name of [
  "different-alpha.pdf",
  "scope-alpha.pdf",
  "ineligible-targets.pdf",
  "duplicate-fill-spelling.pdf",
]) {
  const invalid = new Uint8Array(await readFile(join(dirname(nativeDescription), name)))
  assert.equal(
    buffer(invalid, (p, n) => module._mainz_read(p, n)),
    0,
  )
  assert.equal(module._mainz_status(), 1)
  assert.equal(
    JSON.parse(
      new TextDecoder().decode(
        module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
      ),
    ).code,
    "invalid-contract",
  )
}
const expandedLimit = new Uint8Array(await readFile(join(dirname(nativeDescription), "expanded-limit.pdf")))
assert.equal(
  buffer(expandedLimit, (p, n) => module._mainz_read(p, n)),
  0,
)
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "limit-exceeded",
)
const expandedText = new Uint8Array(await readFile(join(dirname(nativeDescription), "expanded-text-limit.pdf")))
assert.equal(
  buffer(expandedText, (p, n) => module._mainz_read(p, n)),
  0,
)
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "limit-exceeded",
)
const labelsPdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "extraction-pages.pdf")))
const labelsHandle = buffer(labelsPdf, (p, n) => module._mainz_read(p, n))
assert.ok(labelsHandle)
module._mainz_describe(labelsHandle)
assert.equal(JSON.parse(new TextDecoder().decode(result())).pages.practice.label, "Practice-i")
module._mainz_close(labelsHandle)
const ordinary = new Uint8Array(await readFile(join(dirname(nativeDescription), "ordinary.pdf")))
const plain = buffer(ordinary, (p, n) => module._mainz_read(p, n))
assert.ok(plain)
module._mainz_describe(plain)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), {
  version: 1,
  pageCount: 2,
  pages: {},
  parameters: {},
})
buffer(new TextEncoder().encode("[1,0]"), (p, n) => module._mainz_extract(plain, p, n))
await writeFile(join(dirname(output), "wasm-ordinary-reverse.pdf"), result())
buffer(new TextEncoder().encode("{}"), (p, n) => module._mainz_apply(plain, p, n))
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "missing-contract",
)
module._mainz_close(plain)
const job = new Uint8Array(await readFile(join(dirname(output), "job.json")))
for (const invalid of ["", "bad\nID", "bad\u007fID", "bad\u0085ID", "bad\u009fID"]) {
  buffer(new TextEncoder().encode(invalid), (ip, size) => buffer(pdf, (p, n) => module._mainz_input(ip, size, p, n)))
  assert.equal(module._mainz_status(), 1)
  assert.equal(
    JSON.parse(
      new TextDecoder().decode(
        module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
      ),
    ).code,
    "invalid-request",
  )
}
buffer(new Uint8Array([0xff]), (ip, size) => buffer(pdf, (p, n) => module._mainz_input(ip, size, p, n)))
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "invalid-request",
)
buffer(new TextEncoder().encode("Türkçe"), (ip, size) => buffer(pdf, (p, n) => module._mainz_input(ip, size, p, n)))
result()
module._mainz_clear_inputs()
result()
const id = new TextEncoder().encode("input")
buffer(id, (ip, size) => buffer(pdf, (p, n) => module._mainz_input(ip, size, p, n)))
result()
buffer(job, (p, n) => module._mainz_compose(p, n))
const composedBytes = result()
await writeFile(join(dirname(output), "wasm-composed.pdf"), composedBytes)
const report = new TextDecoder().decode(
  module.HEAPU8.slice(module._mainz_report(), module._mainz_report() + module._mainz_report_size()),
)
assert.deepEqual(
  JSON.parse(report),
  JSON.parse(await readFile(join(dirname(output), "composition-report.json"), "utf8")),
)
// The worker clears registered Inputs before opening the independent composed result.
module._mainz_clear_inputs()
result()
const composedHandle = buffer(composedBytes, (p, n) => module._mainz_read(p, n))
assert.ok(composedHandle)
module._mainz_describe(composedHandle)
const composedDescription = JSON.parse(await readFile(join(dirname(output), "composition-description.json"), "utf8"))
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), composedDescription)
buffer(new Uint8Array(), (p, n) => module._mainz_reset(composedHandle, p, n, 0))
await writeFile(join(dirname(output), "wasm-composed-reset.pdf"), result())
module._mainz_close(composedHandle)
result()
buffer(id, (ip, size) => buffer(pdf, (p, n) => module._mainz_input(ip, size, p, n)))
result()
buffer(new TextEncoder().encode('{"version":2,"sources":{},"parts":[]}'), (p, n) => module._mainz_compose(p, n))
assert.equal(module._mainz_status(), 1)
assert.equal(module._mainz_report_size(), 0)
// Failed jobs retain registered Inputs; clearing them releases the binding.
buffer(job, (p, n) => module._mainz_compose(p, n))
result()
module._mainz_clear_inputs()
result()
const corruptComposition = composedBytes.slice()
corruptComposition[0] = 0
assert.equal(
  buffer(corruptComposition, (p, n) => module._mainz_read(p, n)),
  0,
)
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "pdf-syntax",
)
const recoveredComposition = buffer(composedBytes, (p, n) => module._mainz_read(p, n))
assert.ok(recoveredComposition)
module._mainz_describe(recoveredComposition)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), composedDescription)
module._mainz_close(recoveredComposition)
result()
buffer(job, (p, n) => module._mainz_compose(p, n))
assert.equal(module._mainz_status(), 1)
const blanksJob = new TextEncoder().encode(
  JSON.stringify({
    version: 1,
    sources: {},
    parts: [{ pages: [{ blank: { width: 210, height: 297 } }], copies: 3, front: true }],
  }),
)
buffer(blanksJob, (p, n) => module._mainz_compose(p, n))
const blankBytes = result()
module._mainz_clear_inputs()
result()
const blankHandle = buffer(blankBytes, (p, n) => module._mainz_read(p, n))
assert.ok(blankHandle)
module._mainz_describe(blankHandle)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), {
  version: 1,
  pageCount: 6,
  pages: {},
  parameters: {},
})
buffer(new TextEncoder().encode("{}"), (p, n) => module._mainz_apply(blankHandle, p, n))
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "missing-contract",
)
module._mainz_close(blankHandle)
result()
for (const [file, overrides] of [
  ["empty-moves.pdf", { "guide-fill": 0.6 }],
  ["profiles.pdf", { width: 0.15, "guide-color": "#A9A9A9", "guide-fill": 0.4 }],
]) {
  const bytes = new Uint8Array(await readFile(join(dirname(nativeDescription), file)))
  const document = buffer(bytes, (p, n) => module._mainz_read(p, n))
  assert.ok(document)
  module._mainz_describe(document)
  const original = JSON.parse(new TextDecoder().decode(result()))
  if (file === "profiles.pdf") {
    assert.deepEqual(
      original,
      JSON.parse(await readFile(join(dirname(nativeDescription), "profiles-description.json"), "utf8")),
    )
  }
  buffer(new TextEncoder().encode(JSON.stringify(overrides)), (p, n) => module._mainz_apply(document, p, n))
  const changed = result()
  module._mainz_close(document)
  const changedDocument = buffer(changed, (p, n) => module._mainz_read(p, n))
  assert.ok(changedDocument)
  module._mainz_describe(changedDocument)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result())).profileSets, original.profileSets)
  module._mainz_close(changedDocument)
}
console.log(
  JSON.stringify({ wasm: true, description: true, extraction: true, profiles: true, emptyReset: true, lifetime: true }),
)
