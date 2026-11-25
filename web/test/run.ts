// Selects browser checks and declares the requirements for each CI group.

/// <reference lib="es2025.regexp" />

import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"

type Group = {
  files: string[]
  full?: boolean
  webkit?: boolean
  fullChromium?: boolean
  recipeCases?: boolean
}
const groups: Record<string, Group> = {
  alignment: { files: ["alignment"], full: true, webkit: true },
  grid: { files: ["grid"], webkit: true },
  sections: { files: ["sections"], webkit: true },
  style: { files: ["style"], webkit: true },
  layout: { files: ["layout"], webkit: true },
  list: { files: ["list", "list-navigation", "list-transfers"], webkit: true },
  preview: { files: ["pdf", "lens", "processor"], webkit: true },
  geometry: { files: ["geometry"], full: true, webkit: true },
  composition: { files: ["composition", "transfer"], webkit: true },
  selection: { files: ["selection", "selection-keyboard"] },
  startup: {
    files: ["startup", "startup-opening", "startup-offline", "install", "assets", "screencasts"],
    webkit: true,
  },
  page: { files: ["page", "page-navigation"], webkit: true },
  workspace: {
    files: ["workspace", "workspace-downloads", "workspace-contents", "checks"],
    webkit: true,
    recipeCases: true,
  },
  feedback: { files: ["feedback"], webkit: true, recipeCases: true },
  export: { files: ["export", "export-recipe"], webkit: true, fullChromium: true },
  viewport: { files: ["viewport"], full: true },
}

const minimal: Record<string, string[]> = {
  "export-recipe": ["Recipe export preserves profile edits and duplicate file bindings through WASM replay"],
  processor: [
    "Processor failures remain recoverable in Chromium and WebKit",
    "Processor workers pin their module and recover from failed document cleanup",
    "Processors bound idle runtimes and reuse immutable page buffers across retries",
    "Style updates combine resets with overrides and preserve their immutable Input",
    "Composition reuse preserves bytes, Provenance, and exact Input bindings",
  ],
  pdf: [
    "Overlapping preview generations release their own pages and never paint stale results",
    "Thumbnails retain fine guides without reusing Page rasters or changing Page pixels",
    "Thumbnail allocation stays within its pixel limit and releases failed renders",
    "Input inspection bounds pending metadata and releases pages on completion, cancellation, and failure",
  ],
  "startup-opening": ["The first PDF previews before validation and commits only after success"],
  "startup-offline": ["Startup import and mount failures offer reload in development and production"],
  style: [
    "Opacity percentages preserve precision, invalid entry, reset, and saved values",
    "Opaque parameter IDs retain style edits, draft errors, and downloaded values",
    "Style group folds survive removal of their first applicable parameter",
    "Style and Download cancellation release preview workers and retain choices",
  ],
  "workspace-downloads": ["Download reuses completed full-document styles and invalidates changed Output"],
  selection: ["Touch Selection keeps the keyboard closed and image gestures preserve pages"],
  "selection-keyboard": ["Page and Grid keyboard actions respect key priority and the visible page order"],
  page: [
    "Page pinch zoom preserves its anchor and shares the button zoom range",
    "Page cancellation clears a pending pinch before the next render",
  ],
  sections: [
    "Grid and List drags respect closed coincident sections in scrolled windows",
    "Input section Enter and Plus use the preparation before their full range",
    "Section drag cancellation restores preparation, Output selection, and inspection",
    "Overflowing sections start open and retain explicit choices across Grid and List",
    "Grid section ribbons fold pages without replacing heading thumbnails or List state",
  ],
  grid: ["Grid scroll windows keep 300 pages reachable with stable card geometry"],
  composition: ["Edited Padding retains its dimensions and page order in the downloaded PDF"],
}
const matrices = {
  layout: [
    "Grid layout stays within bounds at responsive widths",
    "Touch Grid keeps full pages reachable across orientations",
  ],
}
for (const [file, names] of [...Object.entries(minimal), ...Object.entries(matrices)]) {
  const source = readFileSync(new URL(`${file}.test.js`, import.meta.url), "utf8")
  for (const name of names) assert.ok(source.includes(JSON.stringify(name)), `Missing browser check: ${name}`)
}

const modes = ["minimal", "standard", "full"]
const pattern = (names: string[]) => `^(${names.map((name) => RegExp.escape(name)).join("|")})$`

export function select(mode: string, group?: string, args: string[] = []) {
  assert.ok(modes.includes(mode), `Unknown browser mode: ${mode}`)
  assert.ok(!group || Object.hasOwn(groups, group), `Unknown browser group: ${group}`)
  let files = Object.entries(groups)
    .filter(([suite, config]) => (!group || suite === group) && (mode === "full" || !config.full))
    .flatMap(([, config]) => config.files)
    .filter((file) => mode !== "minimal" || Object.hasOwn(minimal, file))
  assert.ok(files.length, `No ${mode} browser checks in group: ${group}`)
  const flags: string[] = []
  if (mode === "minimal") {
    const option = "--test-name-pattern"
    const filters: RegExp[] = []
    for (let i = 0; i < args.length; i++) {
      const arg = args[i]
      if (arg === option || arg.startsWith(option + "=")) {
        const value = arg === option ? args[++i] : arg.slice(option.length + 1)
        assert.ok(value !== undefined, `${option} requires a pattern`)
        const literal = /^\/(.*)\/([a-z]*)$/.exec(value)
        filters.push(new RegExp(literal?.[1] ?? value, literal?.[2]))
      } else flags.push(arg)
    }
    const names = files
      .flatMap((file) => minimal[file])
      .filter((name) => !filters.length || filters.some((re) => name.search(re) >= 0))
    assert.ok(names.length, "No minimal browser checks match the name filter")
    files = files.filter((file) => minimal[file].some((name) => names.includes(name)))
    flags.unshift(`${option}=${pattern(names)}`)
  } else flags.push(...args)
  if (mode === "standard") flags.unshift(`--test-skip-pattern=${pattern(Object.values(matrices).flat())}`)
  return { files: files.map((file) => `test/${file}.test.js`).toSorted(), flags }
}

export function matrix(mode: string) {
  assert.ok(mode === "standard" || mode === "full", `Unknown CI browser mode: ${mode}`)
  return {
    include: Object.entries(groups).flatMap(([suite, { full, webkit, fullChromium, recipeCases }]) =>
      mode === "standard" && full
        ? []
        : [{ suite, mode, webkit: !!webkit, fullChromium: !!fullChromium, recipeCases: !!recipeCases }],
    ),
  }
}

if (import.meta.main && process.argv[2] === "--matrix") {
  console.log(`matrix=${JSON.stringify(matrix(process.argv[3]))}`)
} else if (import.meta.main) {
  const flags = process.argv.slice(2)
  const mode = modes.includes(flags[0]) ? flags.shift()! : "standard"
  const group = flags[0] && !flags[0].startsWith("-") ? flags.shift() : undefined
  const selected = select(mode, group, flags)
  const result = spawnSync(process.execPath, ["--test", "--test-concurrency=1", ...selected.flags, ...selected.files], {
    cwd: fileURLToPath(new URL("../", import.meta.url)),
    env: { ...process.env, MAINZ_TEST_MODE: mode },
    stdio: "inherit",
  })
  if (result.error) throw result.error
  process.exit(result.status ?? 1)
}
