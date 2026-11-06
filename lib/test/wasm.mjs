#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
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
function patch(handle, pointer, size) {
  buffer(new TextEncoder().encode("[]"), (rp, rn) => module._mainz_style(handle, pointer, size, rp, rn))
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
buffer(request, (p, n) => patch(handle, p, n))
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
const styleHandle = buffer(editedBytes, (p, n) => module._mainz_read(p, n))
assert.ok(styleHandle)
const style = (apply, reset) =>
  buffer(new TextEncoder().encode(JSON.stringify(apply)), (p, n) =>
    buffer(new TextEncoder().encode(JSON.stringify(reset)), (rp, rn) => module._mainz_style(styleHandle, p, n, rp, rn)),
  )
style({ color: "#ABCDEF", opacity: 0.5 }, ["width", "color"])
const styledBytes = result()
await writeFile(join(dirname(output), "wasm-styled.pdf"), styledBytes)
// Applying the existing value wins over its reset and preserves exact bytes.
style({ color: "#123456" }, ["color"])
assert.deepEqual(result(), editedBytes)
for (const [apply, reset] of [
  [{ color: "#ABCDEF" }, ["width", "width"]],
  [{ color: "#ABCDEF" }, ["unknown"]],
  [{ opacity: 2 }, ["color"]],
  [{}, {}],
  [[], []],
]) {
  style(apply, reset)
  assert.equal(module._mainz_status(), 1)
  const error = JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  )
  assert.equal(error.code, "invalid-request")
}
module._mainz_describe(styleHandle)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), editedDescription)
module._mainz_close(styleHandle)
handle = buffer(pdf, (p, n) => module._mainz_read(p, n))
result()
buffer(new TextEncoder().encode("[]"), (p, n) => module._mainz_reset(handle, p, n, 1))
assert.deepEqual(result(), pdf)
buffer(new TextEncoder().encode('["color","width"]'), (p, n) => module._mainz_reset(handle, p, n, 1))
assert.deepEqual(result(), pdf)
// apply() and reset() leave the validated Input immutable across repeated operations.
buffer(request, (p, n) => patch(handle, p, n))
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
buffer(new TextEncoder().encode('{"opacity":2}'), (p, n) => patch(handle, p, n))
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
buffer(request, (p, n) => patch(second, p, n))
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
buffer(new TextEncoder().encode('{"color":"#123456"}'), (p, n) => patch(sharedHandle, p, n))
const sharedEdited = result()
await writeFile(join(dirname(output), "wasm-shared-edited.pdf"), sharedEdited)
module._mainz_close(sharedHandle)
// Reopened results keep each occurrence's style and resources independent.
const sharedChanged = buffer(sharedEdited, (p, n) => module._mainz_read(p, n))
assert.ok(sharedChanged)
buffer(new TextEncoder().encode('{"other-opacity":0.4}'), (p, n) => patch(sharedChanged, p, n))
const sharedChangedBytes = result()
module._mainz_close(sharedChanged)
const sharedReset = buffer(sharedChangedBytes, (p, n) => module._mainz_read(p, n))
assert.ok(sharedReset)
module._mainz_describe(sharedReset)
const sharedDescription = JSON.parse(new TextDecoder().decode(result()))
assert.equal(sharedDescription.parameters.color.parameter.value, "#123456")
assert.equal(sharedDescription.parameters["other-opacity"].parameter.value, 0.4)
buffer(new TextEncoder().encode('["color"]'), (p, n) => module._mainz_reset(sharedReset, p, n, 1))
await writeFile(join(dirname(output), "wasm-shared-chained.pdf"), result())
module._mainz_close(sharedReset)
const densePdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "dense-manifest.pdf")))
const denseHandle = buffer(densePdf, (p, n) => module._mainz_read(p, n))
assert.ok(denseHandle)
buffer(new TextEncoder().encode('{"opacity":0.65}'), (p, n) => patch(denseHandle, p, n))
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
buffer(new TextEncoder().encode(JSON.stringify({ [opaqueOpacity]: 0.65 })), (p, n) => patch(opaqueHandle, p, n))
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
  "invalid-resources.pdf",
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
assert.equal(JSON.parse(new TextDecoder().decode(result())).pages[0].label, "Practice-i")
module._mainz_close(labelsHandle)
const ordinary = new Uint8Array(await readFile(join(dirname(nativeDescription), "ordinary.pdf")))
const plain = buffer(ordinary, (p, n) => module._mainz_read(p, n))
assert.ok(plain)
module._mainz_describe(plain)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), {
  version: 1,
  pageCount: 2,
  pages: [{}, {}],
  parameters: {},
})
buffer(new TextEncoder().encode("[1,0]"), (p, n) => module._mainz_extract(plain, p, n))
await writeFile(join(dirname(output), "wasm-ordinary-reverse.pdf"), result())
buffer(new TextEncoder().encode("{}"), (p, n) => patch(plain, p, n))
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
const previewPdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "preview.pdf")))
const previewHandle = buffer(previewPdf, (p, n) => module._mainz_read(p, n))
assert.ok(previewHandle)
module._mainz_describe(previewHandle)
const previewDescription = JSON.parse(new TextDecoder().decode(result()))
assert.deepEqual(previewDescription.pages[0].preview, { file: "page.png", width: 1, height: 1 })
module._mainz_preview(previewHandle, 0)
const previewBytes = result()
assert.equal(
  Buffer.from(previewBytes).toString("base64"),
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGNgYGAAAAAEAAH2FzhVAAAAAElFTkSuQmCC",
)
module._mainz_preview(previewHandle, 1)
assert.deepEqual(result(), previewBytes)
for (const page of [-1, 0.5, NaN, Infinity, 2]) {
  module._mainz_preview(previewHandle, page)
  assert.equal(module._mainz_status(), 1)
}
module._mainz_preview(previewHandle, 0)
assert.deepEqual(result(), previewBytes)
buffer(new TextEncoder().encode('{"opacity":0.4}'), (p, n) => patch(previewHandle, p, n))
const changedPreviewBytes = result()
module._mainz_close(previewHandle)
const previewChanged = buffer(changedPreviewBytes, (p, n) => module._mainz_read(p, n))
result()
assert.ok(previewChanged)
module._mainz_preview(previewChanged, 0)
assert.equal(result().length, 0)
module._mainz_preview(previewChanged, 1)
assert.deepEqual(result(), previewBytes)
module._mainz_close(previewChanged)
const scopedPreviewPdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "preview-scope.pdf")))
const scopedPreviewHandle = buffer(scopedPreviewPdf, (p, n) => module._mainz_read(p, n))
assert.ok(scopedPreviewHandle)
buffer(new TextEncoder().encode('{"opacity":0.4}'), (p, n) => patch(scopedPreviewHandle, p, n))
const scopedPreviewBytes = result()
module._mainz_close(scopedPreviewHandle)
const scopedPreviewChanged = buffer(scopedPreviewBytes, (p, n) => module._mainz_read(p, n))
result()
assert.ok(scopedPreviewChanged)
module._mainz_preview(scopedPreviewChanged, 0)
assert.equal(result().length, 0)
module._mainz_preview(scopedPreviewChanged, 1)
assert.deepEqual(result(), previewBytes)
module._mainz_close(scopedPreviewChanged)
const densePreviewPdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "preview-dense-changed.pdf")))
const densePreviewHandle = buffer(densePreviewPdf, (p, n) => module._mainz_read(p, n))
assert.ok(densePreviewHandle)
buffer(new TextEncoder().encode("[0]"), (p, n) => module._mainz_extract(densePreviewHandle, p, n))
const densePreviewExtracted = result()
await writeFile(join(dirname(output), "wasm-preview-dense-extracted.pdf"), densePreviewExtracted)
module._mainz_close(densePreviewHandle)
const densePreviewChanged = buffer(densePreviewExtracted, (p, n) => module._mainz_read(p, n))
assert.ok(densePreviewChanged)
module._mainz_preview(densePreviewChanged, 0)
assert.equal(result().length, 0)
module._mainz_close(densePreviewChanged)
const fanoutPdf = new Uint8Array(await readFile(join(dirname(nativeDescription), "preview-fanout-changed.pdf")))
const fanoutOriginal = fanoutPdf.slice()
const fanoutHandle = buffer(fanoutPdf, (p, n) => module._mainz_read(p, n))
assert.ok(fanoutHandle)
module._mainz_describe(fanoutHandle)
const fanoutDescription = JSON.parse(new TextDecoder().decode(result()))
buffer(new TextEncoder().encode("[0]"), (p, n) => module._mainz_extract(fanoutHandle, p, n))
assert.equal(module._mainz_status(), 1)
assert.equal(
  JSON.parse(
    new TextDecoder().decode(
      module.HEAPU8.slice(module._mainz_result(), module._mainz_result() + module._mainz_size()),
    ),
  ).code,
  "limit-exceeded",
)
assert.deepEqual(fanoutPdf, fanoutOriginal)
module._mainz_describe(fanoutHandle)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), fanoutDescription)
buffer(new TextEncoder().encode("[0,1]"), (p, n) => module._mainz_extract(fanoutHandle, p, n))
assert.deepEqual(result(), fanoutOriginal)
module._mainz_close(fanoutHandle)
result()

const plan = new Uint8Array(await readFile(join(dirname(output), "plan.json")))
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
buffer(plan, (p, n) => module._mainz_compose(p, n))
const composedBytes = result()
await writeFile(join(dirname(output), "wasm-composed.pdf"), composedBytes)
const provenance = new TextDecoder().decode(
  module.HEAPU8.slice(module._mainz_provenance(), module._mainz_provenance() + module._mainz_provenance_size()),
)
assert.deepEqual(
  JSON.parse(provenance),
  JSON.parse(await readFile(join(dirname(output), "composition-provenance.json"), "utf8")),
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
assert.equal(module._mainz_provenance_size(), 0)
// Failed jobs retain registered Inputs; clearing them releases the binding.
buffer(plan, (p, n) => module._mainz_compose(p, n))
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
buffer(plan, (p, n) => module._mainz_compose(p, n))
assert.equal(module._mainz_status(), 1)
const blanksPlan = new TextEncoder().encode(
  JSON.stringify({
    version: 1,
    sources: {},
    parts: [{ pages: [{ blank: { width: 210, height: 297 } }], copies: 3, front: true }],
  }),
)
buffer(blanksPlan, (p, n) => module._mainz_compose(p, n))
const blankBytes = result()
module._mainz_clear_inputs()
result()
const blankHandle = buffer(blankBytes, (p, n) => module._mainz_read(p, n))
assert.ok(blankHandle)
module._mainz_describe(blankHandle)
assert.deepEqual(JSON.parse(new TextDecoder().decode(result())), {
  version: 1,
  pageCount: 6,
  pages: Array.from({ length: 6 }, (_, index) => ({ label: String(index + 1) })),
  parameters: {},
})
buffer(new TextEncoder().encode("{}"), (p, n) => patch(blankHandle, p, n))
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
  ["fixed-visibility.pdf", { width: 0.2, "guide-fill": 0.4, "fill-color": "#00FF00" }],
]) {
  const bytes = new Uint8Array(await readFile(join(dirname(nativeDescription), file)))
  const document = buffer(bytes, (p, n) => module._mainz_read(p, n))
  assert.ok(document)
  module._mainz_describe(document)
  const original = JSON.parse(new TextDecoder().decode(result()))
  if (file === "fixed-visibility.pdf") {
    assert.deepEqual(
      original,
      JSON.parse(await readFile(join(dirname(nativeDescription), "fixed-visibility-description.json"), "utf8")),
    )
  }
  if (file === "profiles.pdf") {
    assert.deepEqual(
      original,
      JSON.parse(await readFile(join(dirname(nativeDescription), "profiles-description.json"), "utf8")),
    )
  }
  buffer(new TextEncoder().encode(JSON.stringify(overrides)), (p, n) => patch(document, p, n))
  const changed = result()
  if (file === "fixed-visibility.pdf")
    await writeFile(join(dirname(output), "wasm-fixed-visibility-edited.pdf"), changed)
  module._mainz_close(document)
  const changedDocument = buffer(changed, (p, n) => module._mainz_read(p, n))
  assert.ok(changedDocument)
  module._mainz_describe(changedDocument)
  assert.deepEqual(JSON.parse(new TextDecoder().decode(result())).profileSets, original.profileSets)
  module._mainz_close(changedDocument)
}
for (const name of ["fill-only", "fill-mixed"]) {
  const bytes = new Uint8Array(await readFile(join(dirname(nativeDescription), `${name}.pdf`)))
  const document = buffer(bytes, (p, n) => module._mainz_read(p, n))
  assert.ok(document)
  buffer(id, (ip, size) => buffer(bytes, (p, n) => module._mainz_input(ip, size, p, n)))
  result()
  for (const index of [0, 1]) {
    buffer(new TextEncoder().encode(JSON.stringify([index])), (p, n) => module._mainz_extract(document, p, n))
    await writeFile(join(dirname(output), `wasm-${name}-extracted-${index}.pdf`), result())
    const selection = new TextEncoder().encode(
      JSON.stringify({
        version: 1,
        sources: { original: { input: "input", overrides: {} } },
        parts: [{ pages: [{ source: "original", page: index }] }],
      }),
    )
    buffer(selection, (p, n) => module._mainz_compose(p, n))
    await writeFile(join(dirname(output), `wasm-${name}-composed-${index}.pdf`), result())
  }
  module._mainz_close(document)
  result()
  module._mainz_clear_inputs()
  result()
}
console.log(
  JSON.stringify({ wasm: true, description: true, extraction: true, profiles: true, emptyReset: true, lifetime: true }),
)

// Shared Input instances use one byte budget, including Recipe resolution.
const large = new Uint8Array(await readFile(join(dirname(nativeDescription), "large-input.pdf")))
const largePlan = {
  version: 1,
  sources: { a: { input: "book", overrides: {} }, b: { input: "book", overrides: {} } },
  parts: [
    {
      pages: [
        { source: "a", page: 0 },
        { source: "b", page: 1 },
      ],
    },
  ],
}
module._mainz_clear_inputs()
result()
buffer(new TextEncoder().encode("book"), (id, length) => buffer(large, (p, n) => module._mainz_input(id, length, p, n)))
result()
const largeRecipe = {
  ...largePlan,
  inputs: { book: { sha256: createHash("sha256").update(large).digest("hex") } },
  sources: { a: { input: "book" }, b: { input: "book" } },
}
buffer(new TextEncoder().encode(JSON.stringify(largeRecipe)), (p, n) => module._mainz_resolve_recipe(p, n, 0))
const resolution = JSON.parse(new TextDecoder().decode(result()))
assert.deepEqual(resolution.plan.sources, largePlan.sources)
buffer(new TextEncoder().encode(JSON.stringify(resolution.plan)), (p, n) => module._mainz_compose(p, n))
await writeFile(join(dirname(output), "wasm-large-shared.pdf"), result())
buffer(new TextEncoder().encode("other"), (id, length) =>
  buffer(large, (p, n) => module._mainz_input(id, length, p, n)),
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
module._mainz_clear_inputs()
result()

const largePreview = new Uint8Array(await readFile(join(dirname(nativeDescription), "large-preview.pdf")))
const largePreviewHandle = buffer(largePreview, (p, n) => module._mainz_read(p, n))
result()
assert.ok(largePreviewHandle)
module._mainz_preview(largePreviewHandle, 0)
assert.deepEqual(result(), new Uint8Array(await readFile(join(dirname(nativeDescription), "large-preview.png"))))
module._mainz_close(largePreviewHandle)
result()
