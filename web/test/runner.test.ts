// Checks browser mode coverage and rejects empty or invalid selections.

import assert from "node:assert/strict"
import test from "node:test"
import { select } from "./run.ts"

test("Browser modes retain critical regressions and reserve calibration matrices for full checks", () => {
  const minimal = select("minimal")
  const standard = select("standard")
  const full = select("full")
  assert.ok(minimal.files.every((file) => standard.files.includes(file)))
  assert.ok(standard.files.every((file) => full.files.includes(file)))
  assert.equal(new Set(full.files).size, full.files.length)
  assert.equal(minimal.files.includes("test/assets.test.js"), false)
  assert.equal(standard.files.includes("test/assets.test.js"), true)
  assert.equal(full.files.includes("test/assets.test.js"), true)
  for (const group of ["alignment", "geometry", "viewport"]) {
    assert.equal(standard.files.includes(`test/${group}.test.js`), false)
    assert.equal(full.files.includes(`test/${group}.test.js`), true)
  }
  const skipped = new RegExp(standard.flags[0].slice("--test-skip-pattern=".length))
  assert.equal(skipped.test("Measured touch calibrations isolate viewport bounds and primary input"), true)
  assert.equal(skipped.test("Grid pagination bounds its marks and retains exact page navigation"), false)
  assert.equal(skipped.test("Normal card targets stay separate through phone pane and text transitions"), false)
  assert.equal(skipped.test("Partial Grid batches retain full-matrix card positions and dimensions"), false)
  assert.deepEqual(full.flags, [])
  assert.deepEqual(select("full", "viewport").files, ["test/viewport.test.js"])
  assert.deepEqual(select("standard", "grid").files, [
    "test/grid.test.js",
    "test/lens.test.js",
    "test/pdf.test.js",
    "test/processor.test.js",
  ])
  assert.deepEqual(select("standard", "composition").files, ["test/composition.test.js", "test/transfer.test.js"])
  assert.deepEqual(select("standard", "startup").files, [
    "test/assets.test.js",
    "test/install.test.js",
    "test/startup.test.js",
  ])
  assert.deepEqual(select("standard", "workspace").files, ["test/feedback.test.js", "test/workspace.test.js"])
  assert.throws(() => select("unknown"), /Unknown browser mode/)
  assert.throws(() => select("standard", "unknown"), /Unknown browser group/)
  assert.throws(() => select("standard", "viewport"), /No standard browser checks/)
})
