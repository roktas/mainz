// Selects minimal, standard, and full browser checks with explicit CI groups.

/// <reference lib="es2025.regexp" />

import assert from "node:assert/strict"
import { readdirSync, readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

const groups: Record<string, string[]> = {
  alignment: ["alignment"],
  grid: ["grid"],
  geometry: ["geometry"],
  composition: ["composition"],
  selection: ["selection"],
  startup: ["startup"],
  page: ["page"],
  workspace: ["workspace", "pdf", "lens", "transfer", "install"],
  viewport: ["viewport"],
}
const files = readdirSync(new URL(".", import.meta.url))
  .filter((name) => name.endsWith(".test.js"))
  .toSorted()
assert.deepEqual(
  Object.values(groups)
    .flat()
    .map((name) => `${name}.test.js`)
    .toSorted(),
  files,
  "Assign each browser file to exactly one CI group",
)

const minimal = {
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
const matrices = {
  grid: [
    "Measured touch frames retain complete readable matrices",
    "Measured touch calibrations isolate viewport bounds and primary input",
    "Touch Grid uses complete rows within the available viewport",
    "Grid matrices match desktop viewports and bounded calibrations",
    "Calibrations stay isolated across viewport bounds and input capabilities",
    "Grid scales desktop capacity, balances Page, and retains compact actions",
    "Compact pagination retains readable four- and five-digit numbers",
  ],
}
for (const [file, names] of [...Object.entries(minimal), ...Object.entries(matrices)]) {
  assert.ok(files.includes(`${file}.test.js`))
  const source = readFileSync(new URL(`${file}.test.js`, import.meta.url), "utf8")
  for (const name of names) assert.ok(source.includes(JSON.stringify(name)), `Missing browser check: ${name}`)
}

const modes = ["minimal", "standard", "full"]
const pattern = (names: string[]) => `^(${names.map((name) => RegExp.escape(name)).join("|")})$`

export function select(mode: string, group?: string) {
  assert.ok(modes.includes(mode), `Unknown browser mode: ${mode}`)
  assert.ok(!group || Object.hasOwn(groups, group), `Unknown browser group: ${group}`)
  let selected = mode === "minimal" ? Object.keys(minimal) : files.map((file) => file.slice(0, -8))
  if (mode === "standard") selected = selected.filter((file) => !["alignment", "geometry", "viewport"].includes(file))
  if (group) selected = selected.filter((file) => groups[group].includes(file))
  assert.ok(selected.length, `No ${mode} browser checks in group: ${group}`)
  const flags = []
  if (mode === "minimal") flags.push(`--test-name-pattern=${pattern(Object.values(minimal).flat())}`)
  if (mode === "standard") flags.push(`--test-skip-pattern=${pattern(Object.values(matrices).flat())}`)
  return { files: selected.map((file) => `test/${file}.test.js`), flags }
}

if (import.meta.main) {
  const flags = process.argv.slice(2)
  const mode = modes.includes(flags[0]) ? flags.shift()! : "standard"
  const group = flags[0] && !flags[0].startsWith("-") ? flags.shift() : undefined
  const selected = select(mode, group)
  const result = spawnSync(
    process.execPath,
    ["--test", "--test-concurrency=1", ...selected.flags, ...flags, ...selected.files],
    {
      cwd: fileURLToPath(new URL("../", import.meta.url)),
      env: { ...process.env, MAINZ_TEST_MODE: mode },
      stdio: "inherit",
    },
  )
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
