// Collects native Simulator Safari/PWA geometry for representative screen groups.

import { parseArgs } from "node:util"
import { homedir } from "node:os"
import { execFileSync, spawn } from "node:child_process"
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises"
import { openSync, closeSync } from "node:fs"
import { resolve, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createHash } from "node:crypto"
import inventory from "./viewports.json" with { type: "json" }
import { csv } from "../src/geometry.ts"
import { quality } from "./quality.ts"
import { environments } from "./measure.js"

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5173/?demo=grid&geometry" },
    out: { type: "string", default: "../.local/tmp/web/viewport/sweep" },
    case: { type: "string" },
    mode: { type: "string" },
    orientation: { type: "string" },
    search: { type: "boolean", default: false },
  },
})
if (process.platform !== "darwin") throw new Error("Run the Simulator collector on the Mac test host.")
if (values.mode && !["browser-tabbed", "standalone-pwa"].includes(values.mode))
  throw new Error("Select browser-tabbed or standalone-pwa, or omit --mode for the full sweep.")
if (values.orientation && !["portrait", "landscape"].includes(values.orientation))
  throw new Error("Select portrait or landscape, or omit --orientation for both.")
const directory = resolve(values.out)
const project = fileURLToPath(new URL("./simulator/Probe.xcodeproj", import.meta.url))
const derived = join(homedir(), "Library/Developer/Xcode/DerivedData/Mainz")
await mkdir(directory, { recursive: true })
const command = (name, args) => execFileSync(name, args, { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 }).trim()
const simctl = (...args) => command("xcrun", ["simctl", ...args])
const catalog = JSON.parse(simctl("list", "-j", "devicetypes", "runtimes", "devices"))
const groups = inventory.simulators.groups.filter((group) => !values.case || values.case.split(",").includes(group.id))
if (!groups.length) throw new Error("No matching simulator groups.")
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const fixtureUrl = new URL("grid.pdf", values.url)
const fixtureResponse = await fetch(fixtureUrl)
if (!fixtureResponse.ok) throw new Error("The maintained Grid fixture is unavailable.")
const fixtureBytes = new Uint8Array(await fixtureResponse.arrayBuffer())
const manifest = {
  schemaVersion: 1,
  revision: command("git", ["rev-parse", "HEAD"]),
  startedAt: new Date().toISOString(),
  evidenceClass: "ios-simulator-ui",
  fixture: { url: fixtureUrl.href, sha256: hash(fixtureBytes), bytes: fixtureBytes.length },
  tools: { node: process.version, xcode: command("xcodebuild", ["-version"]), macos: command("sw_vers", []) },
  sources: Object.fromEntries(
    await Promise.all(
      [
        "./simulator.js",
        "./simulator/Probe.swift",
        "./calibration.ts",
        "./quality.ts",
        "../src/Geometry.svelte",
        "../src/geometry.ts",
        "../src/App.svelte",
        "../src/Grid.svelte",
        "../src/frame.css",
        "../src/grid.css",
        "../src/cards.css",
        "../src/main.css",
        "./viewports.json",
      ].map(async (file) => [file, hash(await readFile(new URL(file, import.meta.url)))]),
    ),
  ),
  groups,
  samples: [],
  failures: [],
  coverage: [],
}
const save = () => writeFile(join(directory, "inventory.json"), JSON.stringify(manifest, null, 2) + "\n")
await save()
async function xcode(action, device, name, test) {
  const start = performance.now()
  const log = openSync(join(directory, name + ".log"), "w")
  const args = [
    action,
    "-project",
    project,
    "-scheme",
    "Probe",
    "-destination",
    "platform=iOS Simulator,id=" + device,
    "-derivedDataPath",
    derived,
    "-parallel-testing-enabled",
    "NO",
  ]
  if (test) args.push("-only-testing:Probe/Probe/" + test, "-resultBundlePath", join(directory, name + ".xcresult"))
  try {
    await new Promise((done, reject) => {
      const child = spawn("xcodebuild", args, {
        stdio: ["ignore", log, log],
        timeout: test === "testInstall" ? 120000 : values.search ? 180000 : 150000,
        killSignal: "SIGKILL",
      })
      child.on("error", reject)
      child.on("close", (code) => (code === 0 ? done() : reject(new Error("Xcode " + name + " failed: " + code))))
    })
  } finally {
    closeSync(log)
  }
  if (test) {
    const result = JSON.parse(
      command("xcrun", [
        "xcresulttool",
        "get",
        "test-results",
        "summary",
        "--path",
        join(directory, name + ".xcresult"),
        "--compact",
      ]),
    )
    if (
      result.totalTestCount !== 1 ||
      result.passedTests !== 1 ||
      result.failedTests !== 0 ||
      result.devicesAndConfigurations[0]?.device.deviceId !== device
    )
      throw new Error("Native test did not pass on the requested simulator.")
  }
  return (performance.now() - start) / 1000
}
let built = false
for (const [group, screen] of groups.flatMap((item) => item.screens.map((display) => [item, display]))) {
  const reference = group.id + (screen.display === "primary" ? "" : "-" + screen.display)
  let device
  try {
    if (screen.display !== "primary")
      throw new Error("Native app placement on the alternate integrated display is unavailable in this collector.")
    const type = catalog.devicetypes.find((item) => item.name === group.representative)
    const runtime = catalog.runtimes.find(
      (item) =>
        item.isAvailable &&
        item.version === group.runtime &&
        item.supportedDeviceTypes?.some((supported) => supported.identifier === type?.identifier),
    )
    if (!type || !runtime) throw new Error("Representative is incompatible with installed runtimes.")
    const name = "Mainz grid " + group.id
    const current = JSON.parse(simctl("list", "-j", "devices")).devices[runtime.identifier] || []
    const existing = current.find((item) => item.name === name)
    device = existing?.udid || simctl("create", name, type.identifier, runtime.identifier)
    if (existing?.state !== "Booted") simctl("boot", device)
    simctl("bootstatus", device, "-b")
    simctl("ui", device, "appearance", "light")
    simctl("launch", device, "com.apple.mobilesafari")
    simctl("openurl", device, values.url)
    if (!built) {
      await xcode("build-for-testing", device, "build")
      built = true
    }
    let installed = false
    const scenarios = [
      ["browser-tabbed", "portrait", "testSafariPortrait"],
      ["browser-tabbed", "landscape", "testSafariLandscape"],
      ["standalone-pwa", "portrait", "testStandalonePortrait"],
      ["standalone-pwa", "landscape", "testStandaloneLandscape"],
    ]
    for (const [mode, orientation, method] of scenarios) {
      if (values.mode && values.mode !== mode) continue
      if (values.orientation && values.orientation !== orientation) continue
      const id = reference + "-" + mode + "-" + orientation
      try {
        if (mode.startsWith("browser-")) simctl("openurl", device, values.url)
        if (mode === "standalone-pwa" && !installed) {
          simctl("openurl", device, values.url)
          await xcode("test-without-building", device, reference + "-install", "testInstall")
          installed = true
        }
        if (mode === "standalone-pwa" && !installed) throw new Error("Standalone installation did not complete.")
        const startedAt = Date.now()
        const seconds = await xcode(
          "test-without-building",
          device,
          id,
          values.search ? method.replace("test", "testSearch") : method,
        )
        const exported = JSON.parse(simctl("pbpaste", device))
        const sample = values.search ? exported.baseline : exported
        if (
          sample.schemaVersion !== 1 ||
          sample.environment.presentationMode !== mode ||
          sample.environment.orientation !== orientation ||
          sample.viewport.visualScale !== 1 ||
          !Number.isFinite(Date.parse(sample.provenance.measuredAt)) ||
          Date.parse(sample.provenance.measuredAt) < startedAt
        ) {
          await writeFile(join(directory, id + "-observed.json"), JSON.stringify(exported, null, 2) + "\n")
          throw new Error(
            `Native state mismatch: expected ${mode}/${orientation}; observed ${sample.environment.presentationMode}/${sample.environment.orientation}, ${sample.viewport.inner}, scale ${sample.viewport.visualScale}.`,
          )
        }
        if (group.screens.length > 1) {
          const expected = screen.profilePoints.toSorted((a, b) => a - b)
          if (JSON.stringify(sample.viewport.screenCss.toSorted((a, b) => a - b)) !== JSON.stringify(expected)) {
            await writeFile(join(directory, id + "-observed.json"), JSON.stringify(exported, null, 2) + "\n")
            throw new Error("The native page is not on the requested integrated display.")
          }
        }
        if (mode === "browser-tabbed" && (orientation === "portrait" || values.orientation === "landscape")) {
          if (sample.environment.fullscreenAvailable === true)
            scenarios.push(
              ["browser-fullscreen", "portrait", "testFullscreenPortrait"],
              ["browser-fullscreen", "landscape", "testFullscreenLandscape"],
            )
          else
            manifest.coverage.push({
              group: group.id,
              display: screen.display,
              presentationMode: "browser-fullscreen",
              status: "unavailable",
              reason: "Fullscreen API is not available in the native page.",
            })
        }
        Object.assign(sample.environment, {
          source: "simulator",
          device: group.representative,
          os: group.family === "iPad" ? "iPadOS" : "iOS",
          osVersion: runtime.version,
          colorScheme: "light",
          simulatorDisplay: screen,
          toolbarState: mode === "browser-tabbed" ? "unknown" : "not-applicable",
        })
        Object.assign(sample.provenance, {
          evidenceClass: "ios-simulator-ui",
          revision: manifest.revision,
          collectorSha256: manifest.sources["../src/geometry.ts"],
          nativeUiScreenshot: id + ".png",
          notes:
            "Fixture reloaded after native rotation. Named native baseline/candidate screenshots are retained in " +
            id +
            ".xcresult",
        })
        simctl("io", device, "screenshot", "--display=" + screen.display, join(directory, id + ".png"))
        const screenshots = {}
        {
          const images = join(directory, id + "-images")
          command("xcrun", [
            "xcresulttool",
            "export",
            "attachments",
            "--path",
            join(directory, id + ".xcresult"),
            "--output-path",
            images,
            "--filter",
            "*.png",
          ])
          const attachments = JSON.parse(await readFile(join(images, "manifest.json"), "utf8"))
          for (const attachment of attachments.flatMap((item) => item.attachments)) {
            const match = attachment.suggestedHumanReadableName.match(
              /^(baseline|candidate)-(Input|Output)-(Normal|Compact)_/,
            )
            if (!match) continue
            const key = match.slice(1).join("-").toLowerCase()
            const file = id + "-" + key + ".png"
            await copyFile(join(images, attachment.exportedFileName), join(directory, file))
            if (group.screens.length > 1) {
              const png = await readFile(join(directory, file))
              const dimensions = [png.readUInt32BE(16), png.readUInt32BE(20)].toSorted((a, b) => a - b)
              const expected = sample.viewport.screenCss
                .map((value) => value * sample.viewport.dpr)
                .toSorted((a, b) => a - b)
              if (!dimensions.every((value, axis) => value === expected[axis]))
                throw new Error("The native view screenshot does not match the requested display.")
            }
            screenshots[key] = file
          }
        }
        for (const prefix of values.search && exported.recommendation ? ["baseline", "candidate"] : ["baseline"])
          for (const pane of ["input", "output"])
            for (const density of ["normal", "compact"])
              if (!screenshots[`${prefix}-${pane}-${density}`])
                throw new Error("A required native Grid screenshot is missing.")
        await writeFile(join(directory, id + ".json"), JSON.stringify(sample, null, 2) + "\n")
        await writeFile(join(directory, id + ".csv"), csv(sample))
        if (values.search)
          await writeFile(join(directory, id + "-search.json"), JSON.stringify(exported, null, 2) + "\n")
        const entry = {
          id,
          file: id + ".json",
          group: group.id,
          display: screen.display,
          viewport: sample.viewport.inner,
          safeArea: sample.viewport.safeArea,
          seconds,
          evidenceClass: "ios-simulator-ui",
          failures: quality(sample),
          screenshots,
          search: values.search
            ? {
                file: id + "-search.json",
                candidates: exported.candidates.length,
                recommendation: exported.recommendation,
                decision: exported.decision,
              }
            : null,
        }
        manifest.samples.push(entry)
        console.log(JSON.stringify(entry))
      } catch (error) {
        manifest.failures.push({ id, reason: error.message })
        console.error(JSON.stringify(manifest.failures.at(-1)))
      }
      await save()
    }
  } catch (error) {
    manifest.failures.push({ group: group.id, display: screen.display, reason: error.message })
    await save()
  } finally {
    if (device) simctl("shutdown", device)
  }
}
manifest.completedAt = new Date().toISOString()
await save()
const records = await Promise.all(
  manifest.samples.map(async (entry) => ({
    ...entry,
    representedProfiles: groups.find((group) => group.id === entry.group).models,
    sample: JSON.parse(await readFile(join(directory, entry.file), "utf8")),
  })),
)
await writeFile(
  join(directory, "catalog.json"),
  JSON.stringify(
    {
      schemaVersion: 1,
      revision: manifest.revision,
      sources: manifest.sources,
      fixture: manifest.fixture,
      tools: manifest.tools,
      completedAt: manifest.completedAt,
      environments: environments(records),
      failures: manifest.failures,
    },
    null,
    2,
  ) + "\n",
)
console.log(JSON.stringify({ samples: manifest.samples.length, failures: manifest.failures.length, out: directory }))
if (manifest.failures.length || manifest.samples.some((sample) => sample.failures.length)) process.exitCode = 1
