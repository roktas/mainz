// Checks browser mode coverage and rejects empty or invalid selections.

import assert from "node:assert/strict"
import test from "node:test"
import { readFileSync } from "node:fs"
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
  assert.equal(skipped.test("Touch Grid keeps full pages reachable across orientations"), true)
  assert.equal(skipped.test("Grid scroll windows keep 300 pages reachable with stable card geometry"), false)
  assert.equal(skipped.test("Normal card targets stay separate through phone pane and text transitions"), false)
  assert.deepEqual(full.flags, [])
  assert.deepEqual(select("full", "viewport").files, ["test/viewport.test.js"])
  assert.deepEqual(select("standard", "grid").files, ["test/grid.test.js"])
  assert.deepEqual(select("standard", "list").files, ["test/list.test.js"])
  assert.deepEqual(select("standard", "preview").files, [
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
  assert.deepEqual(select("standard", "workspace").files, ["test/checks.test.js", "test/workspace.test.js"])
  assert.deepEqual(select("standard", "feedback").files, ["test/feedback.test.js"])
  assert.deepEqual(select("standard", "export").files, ["test/export.test.js"])
  assert.throws(() => select("unknown"), /Unknown browser mode/)
  assert.throws(() => select("standard", "unknown"), /Unknown browser group/)
  assert.throws(() => select("standard", "viewport"), /No standard browser checks/)
})

test("CI matrices cover each browser file once and install its browser dependencies", () => {
  const workflow = readFileSync(new URL("../../.github/workflows/build.yml", import.meta.url), "utf8")
  const matrices = workflow.match(/&& '(\[[^']+\])'\s*\|\| '(\[[^']+\])'/)
  assert.ok(matrices, "Full and standard CI matrices are declared")
  const webkit = workflow.match(/contains\(fromJSON\('(\[[^']+\])'\), matrix.suite\)/)
  assert.ok(webkit, "WebKit groups are declared")
  const installed = JSON.parse(webkit[1]) as string[]
  for (const [mode, index, count] of [
    ["full", 1, 13],
    ["standard", 2, 10],
  ] as const) {
    const groups = JSON.parse(matrices[index]) as string[]
    assert.equal(groups.length, count)
    const files = groups.flatMap((group) => select(mode, group).files)
    assert.deepEqual(files.toSorted(), select(mode).files.toSorted(), `${mode}: each file runs exactly once`)
    for (const group of groups) {
      const usesWebkit = select(mode, group).files.some((file) =>
        /import\s*\{[^}]*\b(?:engines|webkit)\b[^}]*\}/.test(
          readFileSync(new URL(`../${file}`, import.meta.url), "utf8"),
        ),
      )
      if (usesWebkit) assert.ok(installed.includes(group), `${group}: WebKit is installed`)
    }
  }
  assert.match(workflow, /Install Chromium for native PDF printing\s+if: matrix.suite == 'export'/)
  assert.match(workflow, /Download Recipe cases\s+if: matrix.suite == 'workspace' \|\| matrix.suite == 'feedback'/)
})
