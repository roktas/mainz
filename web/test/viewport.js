// Collects synthetic or real native-window samples through one geometry and quality pipeline.

import { chromium } from "playwright"
import { parseArgs } from "node:util"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { resolve, join } from "node:path"
import { platform, release } from "node:os"
import inventory from "./viewports.json" with { type: "json" }
import { collect } from "./measure.js"
import { csv } from "../src/geometry.ts"
import { quality } from "./quality.ts"

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5173/?demo=grid" },
    out: { type: "string", default: "../.local/tmp/web/viewport/synthetic" },
    native: { type: "boolean", default: false },
    case: { type: "string" },
    channel: { type: "string" },
    environment: { type: "string" },
  },
})
const directory = resolve(values.out)
await mkdir(directory, { recursive: true })
const environment = values.environment ? JSON.parse(await readFile(values.environment, "utf8")) : {}
const revision = execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const manifest = {
  schemaVersion: 1,
  revision,
  node: process.version,
  platform: platform(),
  release: release(),
  collectorSha256: digest(await readFile(new URL("../src/geometry.ts", import.meta.url))),
  sources: Object.fromEntries(
    await Promise.all(
      [
        "../src/geometry.ts",
        "./measure.js",
        "./quality.ts",
        "./viewport.js",
        "./viewports.json",
        "../src/Grid.svelte",
        "../src/frame.css",
        "../src/main.css",
        "../src/grid.css",
        "../src/cards.css",
        "../src/App.svelte",
      ].map(async (file) => [file, digest(await readFile(new URL(file, import.meta.url)))]),
    ),
  ),
  desktopReferences: inventory.desktops,
  workingTreeDiffSha256: digest(execFileSync("git", ["diff", "HEAD"])),
  fixture: {
    path: ".local/tmp/web/grid/sample.pdf",
    sha256: digest(await readFile("../.local/tmp/web/grid/sample.pdf")),
  },
  startedAt: new Date().toISOString(),
  coverage: inventory.coverage.map((row) => ({ ...row, samples: [] })),
  samples: [],
}
await writeFile(join(directory, "inventory.json"), JSON.stringify(manifest, null, 2) + "\n")
const selected = inventory.cases.filter((item) => !values.case || values.case.split(",").includes(item.id))
if (!values.native && !selected.length) throw new Error(`Unknown viewport case: ${values.case}`)
let browser,
  native,
  root,
  installed = false
const manifestId = new URL("./", values.url).href
try {
  if (values.native) {
    native = await chromium.launchPersistentContext(join(directory, "profile"), {
      channel: values.channel || "chrome",
      headless: false,
      viewport: null,
      reducedMotion: "reduce",
    })
    browser = native.browser()
    root = await browser.newBrowserCDPSession()
  } else browser = await chromium.launch({ channel: values.channel || undefined })
  const cases = values.native
    ? ["normal", "maximized", "fullscreen", "standalone"]
        .map((windowMode) => ({ id: windowMode, windowMode }))
        .filter((item) => !values.case || values.case === item.id)
    : selected
  if (!cases.length) throw new Error(`Unknown viewport case: ${values.case}`)
  for (const item of cases) {
    for (const colorScheme of ["light", "dark"]) {
      const context =
        native ||
        (await browser.newContext({
          viewport: { width: item.viewport[0], height: item.viewport[1] },
          hasTouch: item.pointer === "coarse",
          isMobile: item.pointer === "coarse",
          reducedMotion: "reduce",
        }))
      let page
      if (item.windowMode === "standalone") {
        if (!installed) {
          await root.send("PWA.install", { manifestId, installUrlOrBundleUrl: values.url })
          await root.send("PWA.changeAppUserSettings", { manifestId, displayMode: "standalone" })
          installed = true
        }
        ;[page] = await Promise.all([
          context.waitForEvent("page"),
          root.send("PWA.launch", { manifestId, url: values.url }),
        ])
      } else page = await context.newPage()
      try {
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.emulateMedia({ colorScheme })
        let windowBounds = null
        if (values.native) {
          const cdp = await context.newCDPSession(page)
          const { windowId } = await cdp.send("Browser.getWindowForTarget")
          if (item.windowMode !== "standalone")
            await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: item.windowMode } })
          for (let attempt = 0; attempt < 50; attempt++) {
            windowBounds = (await cdp.send("Browser.getWindowBounds", { windowId })).bounds
            if (item.windowMode === "standalone" || windowBounds.windowState === item.windowMode) break
            await new Promise((done) => setTimeout(done, 100))
          }
          if (item.windowMode !== "standalone" && windowBounds.windowState !== item.windowMode)
            throw new Error(`Native window did not enter ${item.windowMode}`)
        }
        await page.goto(values.url)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
        )
        const id = `${item.id}-${colorScheme}`
        const sample = await collect(page, async (pane, density) => {
          const filename = `${id}-${pane}-${density}.png`
          await page.screenshot({ path: join(directory, filename) })
          return filename
        })
        Object.assign(sample.environment, {
          source: values.native ? environment.source || "unknown" : "synthetic",
          device: environment.device || null,
          display: environment.display || null,
          browser: values.channel || "Chromium",
          browserVersion: browser.version(),
          os: platform(),
          osVersion:
            platform() === "darwin"
              ? execFileSync("sw_vers", ["-productVersion"], { encoding: "utf8" }).trim()
              : release(),
          windowMode: item.windowMode || "forced-content-viewport",
          requestedViewport: item.viewport || null,
          colorScheme,
          windowBounds,
        })
        Object.assign(sample.provenance, {
          evidenceClass: values.native ? "desktop-native-window" : "synthetic-css-viewport",
          revision,
          reference: item.viewport ? item.id : null,
          referenceEvidence: item.referenceEvidence || null,
          desktopReferences: item.desktopReferences || [],
          collectorSha256: manifest.collectorSha256,
        })
        const failures = quality(sample)
        if (item.windowMode === "standalone" && sample.environment.presentationMode !== "standalone-pwa")
          failures.push({ rule: "installed PWA mode" })
        if (item.matrices)
          for (const pane of ["input", "output"])
            for (const density of ["normal", "compact"]) {
              if (JSON.stringify(sample.layout[pane][density].matrix) !== JSON.stringify(item.matrices[density]))
                failures.push({
                  pane,
                  density,
                  rule: "reference matrix",
                  expected: item.matrices[density],
                  actual: sample.layout[pane][density].matrix,
                })
            }
        await writeFile(join(directory, `${id}.json`), JSON.stringify(sample, null, 2) + "\n")
        await writeFile(join(directory, `${id}.csv`), csv(sample))
        manifest.samples.push({
          id,
          file: `${id}.json`,
          viewport: sample.viewport.inner,
          evidenceClass: sample.provenance.evidenceClass,
          failures,
        })
        const shell =
          sample.environment.presentationMode === "standalone-pwa"
            ? "installed-web-app"
            : sample.environment.browserFamily
        const coverage = manifest.coverage.find(
          (row) =>
            row.uiShell === shell &&
            row.presentationMode === sample.environment.presentationMode &&
            row.orientation === sample.environment.orientation,
        )
        if (coverage) {
          coverage.status = values.native ? "measured" : coverage.status === "measured" ? "measured" : "synthetic-only"
          coverage.samples.push({
            id,
            source: sample.environment.source,
            evidenceClass: sample.provenance.evidenceClass,
          })
        }
        await writeFile(join(directory, "inventory.json"), JSON.stringify(manifest, null, 2) + "\n")
        console.log(JSON.stringify(manifest.samples.at(-1)))
      } finally {
        await page.close()
        if (!native) await context.close()
      }
    }
  }
  manifest.completedAt = new Date().toISOString()
  await writeFile(join(directory, "inventory.json"), JSON.stringify(manifest, null, 2) + "\n")
} finally {
  try {
    if (installed) await root.send("PWA.uninstall", { manifestId })
  } finally {
    await (native || browser)?.close()
  }
}
