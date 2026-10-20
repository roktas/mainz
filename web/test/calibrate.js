// Replays measured CSS viewports through a bounded joint-density renderer search.

import { chromium } from "playwright"
import { parseArgs } from "node:util"
import { mkdir, readFile, writeFile } from "node:fs/promises"
import { resolve, join, basename } from "node:path"
import { createHash } from "node:crypto"
import { collect } from "./measure.js"
import { search } from "./calibration.ts"

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:5173/?demo=grid" },
    input: { type: "string", default: "../.local/tmp/web/viewport/synthetic" },
    out: { type: "string", default: "../.local/tmp/web/viewport/search" },
    case: { type: "string" },
  },
})
const directory = resolve(values.out),
  input = resolve(values.input)
await mkdir(directory, { recursive: true })
const inventory = JSON.parse(await readFile(join(input, "inventory.json"), "utf8"))
const entries = inventory.samples.filter((entry) => !values.case || entry.id === values.case)
if (!entries.length) throw new Error("No matching measurements in the input inventory.")
const report = {
  schemaVersion: 1,
  startedAt: new Date().toISOString(),
  input: {
    revision: inventory.revision,
    collectorSha256: inventory.collectorSha256,
    sources: inventory.sources,
    fixture: inventory.fixture,
  },
  evidenceClass: "synthetic-css-viewport-replay",
  node: process.version,
  platform: process.platform,
  sources: Object.fromEntries(
    await Promise.all(
      [
        "./calibrate.js",
        "./calibration.ts",
        "./quality.ts",
        "./measure.js",
        "../src/geometry.ts",
        "../src/frame.css",
        "../src/main.css",
        "../src/grid.css",
        "../src/cards.css",
        "../src/Grid.svelte",
        "../src/App.svelte",
      ].map(async (file) => [
        file,
        createHash("sha256")
          .update(await readFile(new URL(file, import.meta.url)))
          .digest("hex"),
      ]),
    ),
  ),
  policy:
    "Up to 31 paired-density candidates, including measured extra-row/column fits. Chromium replay requires native review before iOS calibration.",
  cases: [],
}
const escape = (value) => String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;")
const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
report.browserVersion = browser.version()
try {
  for (const entry of entries) {
    const source = JSON.parse(await readFile(join(input, basename(entry.file)), "utf8"))
    const [width, height] = source.viewport.inner
    if (
      source.schemaVersion !== 1 ||
      ![width, height].every((value) => Number.isFinite(value) && value >= 240 && value <= 8192)
    )
      throw new Error(`Invalid geometry sample: ${entry.file}`)
    const id = basename(entry.file, ".json")
    const context = await browser.newContext({
      viewport: { width, height },
      hasTouch: source.environment.pointer === "coarse",
      isMobile: source.environment.pointer === "coarse",
      colorScheme: source.environment.colorScheme || "light",
      reducedMotion: "reduce",
    })
    try {
      const page = await context.newPage()
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:installation", "seen")
      })
      await page.goto(values.url)
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      )
      const override = await page.addStyleTag({ content: "/* Candidate geometry. */" })
      const searched = await search(
        () => page.evaluate(async () => (await import("/src/geometry.ts")).capture()),
        (css) => override.evaluate((element, content) => (element.textContent = content), css),
      )
      const { candidates } = searched
      const shortlist = searched.shortlist.map((name) => candidates.find((candidate) => candidate.name === name))
      for (const candidate of shortlist) {
        await override.evaluate((element, content) => (element.textContent = content), candidate.css)
        candidate.screenshots = []
        await collect(page, async (pane, density) => {
          const file = `${id}-${candidate.name}-${pane}-${density}.png`
          await page.screenshot({ path: join(directory, file) })
          candidate.screenshots.push(file)
          return file
        })
      }
      const result = {
        id,
        viewport: [width, height],
        source: source.environment,
        candidates,
        shortlist: shortlist.map((candidate) => candidate.name),
        decision: searched.decision,
        recommendation: searched.recommendation,
        visualApproval: "pending",
      }
      report.cases.push(result)
      await writeFile(join(directory, "search.json"), JSON.stringify(report, null, 2) + "\n")
      console.log(
        JSON.stringify({
          id,
          valid: candidates.filter((candidate) => !candidate.failures.length).length,
          candidates: candidates.length,
          shortlist: result.shortlist,
          decision: result.decision,
        }),
      )
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}
const rows = report.cases
  .map(
    (item) => `<section><h2>${escape(item.id)} · ${item.viewport.join(" × ")} CSS px</h2>
<p>${escape(item.decision)}. Visual approval: ${item.visualApproval}. Acquisition is a synthetic replay; original browser mode remains provenance.</p>
<table><thead><tr><th>Candidate</th><th>Hard gates</th><th>Silhouette</th><th>Image cost</th><th>Gap imbalance</th><th>Margin guide</th><th>Unused space</th><th>Capacity cost</th></tr></thead><tbody>${item.candidates
      .map(
        (candidate) =>
          `<tr><td>${candidate.name}</td><td>${candidate.failures.length ? escape([...new Set(candidate.failures.map((failure) => failure.rule))].join(", ")) : "Pass"}</td>${Object.values(
            candidate.metrics,
          )
            .map((value) => `<td>${value.toFixed(3)}</td>`)
            .join("")}</tr>`,
      )
      .join("")}</tbody></table>
<div class="comparisons">${item.candidates
      .filter((candidate) => candidate.screenshots)
      .map(
        (candidate) =>
          `<article><h3>${candidate.name}</h3>${candidate.screenshots.map((file) => `<a href="${file}"><img loading="lazy" src="${file}" alt="${escape(file)}"></a>`).join("")}</article>`,
      )
      .join("")}</div></section>`,
  )
  .join("\n")
await writeFile(
  join(directory, "index.html"),
  `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Mainz calibration review</title><style>body{font:16px system-ui;margin:24px;color:#222;background:#fafafa}table{border-collapse:collapse;width:100%;font-size:14px}td,th{border:1px solid #bbb;padding:8px;text-align:left}section{margin-block:48px}.comparisons{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,300px),1fr));gap:24px}img{max-inline-size:100%;block-size:auto;border:1px solid #ccc}article{min-inline-size:0}</style><h1>Mainz calibration review</h1><p>${escape(report.policy)} Images link to full-resolution captures. Lower metric costs are preferred; they never override a failed hard gate.</p>${rows}</html>`,
)
