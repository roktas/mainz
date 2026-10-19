// Shares browser fixtures, navigation, geometry assertions, and failure screenshots.

import assert from "node:assert/strict"
import { mkdir } from "node:fs/promises"
import { join, resolve as resolvePath } from "node:path"
import { createServer as createViteServer } from "vite"

const parameter = (property, schema) => ({
  binding: { property, targets: ["guides"] },
  schema,
})

const stream = (dictionary, data) =>
  `<< ${dictionary} /Length ${Buffer.byteLength(data)} >>\nstream\n${data}\nendstream`

export const pixel = (canvas, y) =>
  canvas.evaluate(
    (element, fraction) =>
      Array.from(
        element
          .getContext("2d")
          .getImageData(Math.floor(element.width / 2), Math.floor(element.height * fraction), 1, 1).data,
      ),
    y,
  )

export const tab = (pane, name) => pane.getByRole("tab", { name, exact: true }).click()

export const image = (pane) => pane.locator(".page-scroll canvas")

export const pagePosition = (pane) => pane.locator(".inspection-heading .page-position").innerText()

export async function gridPage(pane, number) {
  await pane
    .page()
    .evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const preview = pane.locator(`.composition-card:not([inert]) .page-image[data-page="${number - 1}"]`)
  if (!(await preview.count())) {
    const range = pane.getByRole("slider")
    const batch = Number(await pane.locator(".grid-view").getAttribute("data-batch"))
    await range.press("Home")
    for (let index = 0; index < Math.floor((number - 1) / batch); index++) await range.press("ArrowRight")
  }
  await preview.waitFor()
  return preview
}

export const hasCursor = (element = document.activeElement) => {
  const card = element.closest(".composition-card")
  if (!card) return false
  const style = getComputedStyle(card)
  return (
    style.borderTopWidth === "2px" &&
    style.borderTopColor === getComputedStyle(document.querySelector(".workspace-icon")).color
  )
}

export const createServer = (config) =>
  createViteServer({ cacheDir: resolvePath("../.local/tmp/web/cache"), ...config })

export async function captureLayout(page, name) {
  const directory = resolvePath("../.local/tmp/web/layout", name)
  await mkdir(directory, { recursive: true })
  const path = join(directory, "failure.png")
  await page.screenshot({ path, fullPage: true })
  return path
}

export function trackWorkers() {
  window.workers = []
  const Original = Worker
  window.Worker = class extends Original {
    constructor(url, options) {
      super(url, options)
      this.record = { url: String(url), terminated: false }
      window.workers.push(this.record)
    }
    terminate() {
      this.record.terminated = true
      super.terminate()
    }
  }
}

export function fixture(
  prepared = true,
  mixedDisplay = false,
  profileCount = 0,
  grouped = false,
  fillOnly = false,
  widthConstraints = {},
  count = prepared ? 7 : 1,
) {
  const pages = Object.fromEntries(Array.from({ length: count }, (_, index) => [`page${index}`, index]))
  const baseline = {
    paint: "S",
    width: "0.2",
    stroke: { operator: "G", operands: ["0.2"] },
    fill: { operator: "g", operands: ["0"] },
    strokeOpacity: "1",
    fillOpacity: "1",
    display: "inline",
    fillRule: "nonzero",
  }
  const regions = Object.fromEntries(
    Object.keys(pages).map((page, index) => [
      page,
      {
        page,
        marker: "Guides",
        records: [
          {
            path: [],
            marker: "Paint",
            baseline: mixedDisplay && index % 2 ? "hidden" : "guides",
            fill: "none",
          },
        ],
      },
    ]),
  )
  const manifest = {
    version: 1,
    pages,
    regions,
    baselines: {
      guides: baseline,
      ...(mixedDisplay ? { hidden: { ...baseline, display: "none" } } : {}),
    },
    targets: { guides: Object.keys(regions) },
    parameters: {
      "guides-display": parameter("display", {
        type: "string",
        title: "Show guides",
        enum: ["inline", "none"],
      }),
      "guides-stroke-color": parameter("stroke-color", { type: "string", title: "Guide color" }),
      "guides-stroke-width": parameter("stroke-width", {
        type: "number",
        title: "Guide width",
        exclusiveMinimum: 0,
        maximum: 2,
        ...widthConstraints,
      }),
      "guides-stroke-opacity": parameter("stroke-opacity", {
        type: "number",
        title: "Guide opacity",
        minimum: 0,
        maximum: 1,
      }),
    },
    groups: [
      {
        title: "Guides",
        parameters: ["guides-stroke-color", "guides-stroke-width", "guides-stroke-opacity", "guides-display"],
      },
    ],
  }
  if (fillOnly) {
    baseline.paint = "f"
    for (const region of Object.values(regions)) region.records[0].fill = "existing"
    manifest.parameters = {
      "guides-display": manifest.parameters["guides-display"],
      "guides-fill-color": parameter("fill-color", { type: "string", title: "Fill color" }),
      "guides-fill-opacity": parameter("fill-opacity", {
        type: "number",
        title: "Fill opacity",
        minimum: 0,
        maximum: 1,
      }),
    }
    manifest.groups[0].parameters = Object.keys(manifest.parameters)
  }
  if (!grouped) {
    manifest.groups[0].parameters = ["guides-stroke-color", "guides-stroke-width"]
    manifest.groups.push({
      title: "Guide visibility and opacity",
      parameters: ["guides-display", "guides-stroke-opacity"],
    })
  }
  if (profileCount)
    manifest.profileSets = [
      {
        id: "print",
        name: "Style profile",
        parameters: Object.keys(manifest.parameters),
        profiles: [
          { id: "generic", name: "Generic", overrides: {} },
          ...(profileCount > 1
            ? [
                {
                  id: "inkjet",
                  name: "Inkjet",
                  description: "Fine guides",
                  overrides: { "guides-stroke-width": 0.04 },
                },
              ]
            : []),
        ],
      },
    ]
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${prepared ? "/Names << /EmbeddedFiles << /Names [(mainz.json) 4 0 R] >> >>" : ""} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${count} /MediaBox [0 0 595.2756 841.8898] >>`,
    stream("/Type /EmbeddedFile /Subtype /application#2Fjson", JSON.stringify(manifest)),
    "<< /Type /Filespec /F (mainz.json) /UF (mainz.json) /EF << /F 3 0 R /UF 3 0 R >> >>",
  ]
  for (let index = 0; index < count; index++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Contents ${6 + index * 2} 0 R ${prepared && index === count - 1 ? "/MediaBox [0 0 841.8898 595.2756]" : ""} /Resources << /Properties << /Guides <<>> /Paint <<>> >> /ExtGState << /Alpha << /Type /ExtGState /CA ${mixedDisplay && index % 2 ? 0 : 1} /ca ${mixedDisplay && index % 2 ? 0 : 1} >> >> >> >>`,
    )
    objects.push(
      stream(
        "",
        `/Figure /Guides BDC /Figure /Paint BDC q 0.2 w 0.2 G 0 g /Alpha gs 20 ${100 + (index % 7) * 20} 400 300 re ${fillOnly ? "f" : "S"} Q EMC EMC`,
      ),
    )
  }
  let pdf = "%PDF-1.7\n"
  const offsets = [0]
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xref = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(pdf)
}

export async function checkGrips(pane, label) {
  const page = pane.page()
  const button = pane.locator(".composition-card").first().locator(".page-image")
  for (let state = 0; state < 2; state++) {
    await button.click()
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      const offsets = await pane.locator(".composition-card").evaluateAll((cards) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect()
          const header = card.querySelector(".page-label").getBoundingClientRect()
          const grip = card.querySelector(".page-grip svg").getBoundingClientRect()
          return [
            grip.left + grip.width / 2 - bounds.left - bounds.width / 2,
            grip.top + grip.height / 2 - header.top - header.height / 2,
          ]
        }),
      )
      assert.ok(
        offsets.every((axes) => axes.every((offset) => Math.abs(offset) < 1)),
        `${label}, ${colorScheme}`,
      )
    }
  }
}

export async function checkGeometry(group) {
  assert.deepEqual(await group.locator(".quartet-fields .quartet-caption > span").allTextContents(), [
    "Fill",
    "Stroke",
    "Width",
    "Visibility",
  ])
  const sizes = await group.locator(".quartet-fields .quartet-component").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect()
      return { width: box.width, height: box.height }
    }),
  )
  assert.ok(sizes.length >= 4)
  for (const size of sizes) {
    assert.ok(Math.abs(size.width - sizes[0].width) < 1, "Object components must have equal widths")
    assert.ok(Math.abs(size.height - sizes[0].height) < 1, "Object components must have equal heights")
    assert.ok(size.height >= 44)
  }
}

export async function checkStatus(page) {
  for (const bottom of [false, true]) {
    await page.evaluate((end) => window.scrollTo(0, end ? document.documentElement.scrollHeight : 0), bottom)
    const box = await page.locator(".footnote").boundingBox()
    assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1)
    assert.ok(Math.abs(box.y + box.height - page.viewportSize().height) < 1)
  }
  const footer = await page.locator(".footnote").boundingBox()
  const workspace = await page.locator(".composer").boundingBox()
  assert.ok(workspace.y + workspace.height <= footer.y, "Status must not cover the last workspace controls")
}
