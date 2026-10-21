// Selects browser checks and keeps the eight CI groups complete and disjoint.

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const groups = {
  alignment: ["alignment"],
  grid: ["grid"],
  geometry: ["geometry"],
  composition: ["composition"],
  selection: ["selection"],
  startup: ["startup"],
  page: ["page"],
  workspace: ["workspace", "pdf", "lens", "transfer", "install"],
}
const files = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".test.js") && name !== "viewport.test.js")
  .toSorted()
assert.deepEqual(
  Object.values(groups)
    .flat()
    .map((name) => `${name}.test.js`)
    .toSorted(),
  files,
  "Assign each application browser file to exactly one CI group",
)

const fast = {
  pdf: [
    "Overlapping preview generations release their own pages and never paint stale results",
    "Input inspection bounds pending metadata and releases pages on completion, cancellation, and failure",
  ],
  startup: ["The first PDF previews before validation and commits only after success"],
  workspace: [
    "Opaque parameter IDs retain style edits, draft errors, and downloaded values",
    "Style and Download cancellation release preview workers and retain choices",
  ],
  selection: [
    "Touch Selection keeps the keyboard closed and image gestures preserve pages",
    "Page and Grid keyboard actions respect key priority and the visible page order",
  ],
  page: ["Page pinch zoom preserves its anchor and shares the button zoom range"],
  grid: ["Grid pagination bounds its marks and retains exact page navigation"],
  composition: ["Edited Padding retains its dimensions and page order in the downloaded PDF"],
}
for (const [file, names] of Object.entries(fast)) {
  assert.ok(files.includes(`${file}.test.js`))
  const source = readFileSync(new URL(`${file}.test.js`, import.meta.url), "utf8")
  for (const name of names) assert.ok(source.includes(JSON.stringify(name)), `Missing fast check: ${name}`)
}

const flags = process.argv.slice(2)
const suite = flags[0] && !flags[0].startsWith("-") ? flags.shift() : "full"
assert.ok(
  ["full", "fast", "viewport"].includes(suite) || Object.hasOwn(groups, suite),
  `Unknown browser group: ${suite}`,
)
const selected =
  suite === "fast"
    ? Object.keys(fast)
    : suite === "full"
      ? files.map((file) => file.slice(0, -8))
      : suite === "viewport"
        ? ["viewport"]
        : groups[suite]
if (suite === "fast")
  flags.unshift(
    `--test-name-pattern=^(${Object.values(fast)
      .flat()
      .map((name) => RegExp.escape(name))
      .join("|")})$`,
  )
const result = spawnSync(
  process.execPath,
  ["--test", "--test-concurrency=1", ...flags, ...selected.map((file) => `test/${file}.test.js`)],
  { cwd: fileURLToPath(new URL("../", import.meta.url)), stdio: "inherit" },
)
if (result.error) throw result.error
process.exit(result.status ?? 1)
