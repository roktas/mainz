// Checks browser mode coverage and rejects empty or invalid selections.

import assert from "node:assert/strict"
import test from "node:test"
import { readdirSync, readFileSync } from "node:fs"
import { matrix, select } from "./run.ts"

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
  assert.throws(() => select("unknown"), /Unknown browser mode/)
  assert.throws(() => select("standard", "unknown"), /Unknown browser group/)
  assert.throws(() => select("standard", "viewport"), /No standard browser checks/)
})

test("CI assigns every browser file once and installs its browser dependencies", () => {
  const files = readdirSync(new URL(".", import.meta.url))
    .filter((file) => file.endsWith(".test.js"))
    .map((file) => "test/" + file)
    .toSorted()
  for (const mode of ["standard", "full"]) {
    const groups = matrix(mode).include
    const selected = groups.flatMap(({ suite }) => select(mode, suite).files).toSorted()
    assert.deepEqual(selected, mode === "full" ? files : select(mode).files, mode)
    for (const { suite, webkit, fullChromium } of groups) {
      for (const file of select(mode, suite).files) {
        const content = readFileSync(new URL("../" + file, import.meta.url), "utf8")
        if (/import\s*\{[^}]*\b(?:engines|webkit)\b[^}]*\}/.test(content)) assert.ok(webkit, suite + " installs WebKit")
        if (content.includes('channel: "chromium"')) assert.ok(fullChromium, suite + " installs the native PDF viewer")
      }
    }
  }
})
