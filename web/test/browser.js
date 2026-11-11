// Shares browser fixtures, navigation, geometry assertions, and failure screenshots.

import assert from "node:assert/strict"
import { mkdir, writeFile } from "node:fs/promises"
import { join, resolve as resolvePath } from "node:path"
import { measure } from "./measure.js"
export { createServer } from "vite"

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

export async function tab(pane, name) {
  await pane.getByRole("tab", { name, exact: true }).click()
}

export const image = (pane) => pane.locator(".page-scroll canvas")

export const pagePosition = (pane) => pane.locator(".inspection-heading .page-position").innerText()

export async function gridPage(pane, number) {
  const preview = pane.locator(`.composition-card:not([inert]) .page-image[data-page="${number - 1}"]`)
  if (!(await preview.count())) {
    const name = await pane.evaluate((element) => (element.matches(".selection-panel") ? "Input" : "Output"))
    await pane.getByRole("button", { name: `Go to page in ${name}`, exact: true }).click()
    const field = pane.getByRole("textbox", { name: `${name} page number`, exact: true })
    await field.fill(String(number))
    await field.press("Enter")
  }
  await preview.waitFor()
  return preview
}

export const hasCursor = (element = document.activeElement) => {
  const card = element.closest(".composition-card")
  if (!card) return false
  const style = getComputedStyle(card)
  const theme = document.documentElement.getAttribute("data-theme")
  const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches)
  return style.borderTopWidth === "2px" && style.borderTopColor === (dark ? "oklch(1 0 none)" : "oklch(0 0 none)")
}

export async function captureLayout(page, name, details) {
  const directory = resolvePath("../.local/tmp/web/layout", name)
  await mkdir(directory, { recursive: true })
  const path = join(directory, "failure.png")
  await page.screenshot({ path, fullPage: true })
  if (details)
    await writeFile(
      join(directory, "details.json"),
      JSON.stringify({ viewport: page.viewportSize(), ...details }, null, 2),
    )
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

export function fixture({
  prepared = true,
  mixedDisplay = false,
  profileCount = 0,
  grouped = false,
  fillOnly = false,
  widthConstraints = {},
  count = prepared ? 7 : 1,
  profileSets,
  family,
  annotations,
  metadata,
  preview,
  outline,
  labels,
} = {}) {
  const pages = Array.from({ length: count }, (_, index) => metadata?.[index] ?? {})
  const previews = Array.isArray(preview) ? preview : preview ? [preview] : []
  const contract = prepared || !!preview || pages.some((page) => Object.keys(page).length > 0)
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
    pages.map((_, index) => [
      `page${index}`,
      {
        page: index,
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
  if (profileSets) manifest.profileSets = profileSets
  if (family) {
    for (const [id, definition] of Object.entries(manifest.parameters)) Object.assign(definition, { family, key: id })
    for (const set of manifest.profileSets ?? []) set.family = family
  }
  if (annotations) {
    Object.assign(manifest.groups[0], annotations.group)
    for (const [id, presentation] of Object.entries(annotations.parameters ?? {}))
      Object.assign(manifest.parameters[id].schema, presentation)
  }
  if (!prepared) {
    for (const key of ["regions", "baselines", "targets", "parameters"]) manifest[key] = {}
    delete manifest.groups
    delete manifest.profileSets
  }
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${
      contract
        ? `/Names << /EmbeddedFiles << /Names [(mainz.json) 4 0 R${previews
            .map((_, index) => ` (preview${index || ""}.png) ${6 + count * 2 + index * 2} 0 R`)
            .toSorted()
            .join("")}] >> >>`
        : ""
    } >>`,
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
  previews.forEach((bytes, index) => {
    const name = `preview${index || ""}.png`
    const payload = 5 + count * 2 + index * 2
    objects.push(
      stream("/Type /EmbeddedFile /Subtype /image#2Fpng /Filter /ASCIIHexDecode", bytes.toString("hex") + ">"),
      `<< /Type /Filespec /F (${name}) /UF (${name}) /EF << /F ${payload} 0 R /UF ${payload} 0 R >> >>`,
    )
  })
  if (outline?.length) {
    const root = objects.length + 1
    const children = (parent) => outline.flatMap((entry, index) => (entry.parent === parent ? [index] : []))
    const links = (indexes) =>
      indexes.length ? `/First ${root + 1 + indexes[0]} 0 R /Last ${root + 1 + indexes.at(-1)} 0 R` : ""
    objects[0] = objects[0].replace("/Type /Catalog", `/Type /Catalog /Outlines ${root} 0 R`)
    objects.push(`<< /Type /Outlines ${links(children(undefined))} >>`)
    outline.forEach((entry, index) => {
      const siblings = children(entry.parent),
        position = siblings.indexOf(index)
      const title = entry.title.replaceAll(/([\\()])/g, "\\$1")
      objects.push(
        `<< /Title (${title}) /Parent ${entry.parent === undefined ? root : root + 1 + entry.parent} 0 R
        /Dest [${5 + entry.page * 2} 0 R /Fit] ${links(children(index))}
        ${position > 0 ? `/Prev ${root + siblings[position - 1] + 1} 0 R` : ""}
        ${position < siblings.length - 1 ? `/Next ${root + siblings[position + 1] + 1} 0 R` : ""} >>`,
      )
    })
  }
  const offsets = [0]
  if (labels)
    objects[0] = objects[0].replace(
      "/Type /Catalog",
      `/Type /Catalog /PageLabels << /Nums [${labels.map((label, index) => `${index} << /P (${label.replaceAll(/([\\()])/g, "\\$1")}) >>`).join(" ")}] >>`,
    )
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
    await button.dispatchEvent("click")
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
        `${label}, ${colorScheme}: grip offsets ${JSON.stringify(offsets)}`,
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
    if (bottom) await page.locator(".footnote").scrollIntoViewIfNeeded()
    else await page.evaluate(() => window.scrollTo(0, 0))
    const box = await page.locator(".footnote").boundingBox()
    const workspace = await page.locator(".composer").boundingBox()
    if (workspace)
      assert.ok(workspace.y + workspace.height <= box.y + 1, "Status must not cover the last workspace controls")
    if (bottom || !workspace) {
      assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1)
      assert.ok(Math.abs(box.y + box.height - page.viewportSize().height) < 1)
    }
  }
}

export async function checkGridScroll(pane, label) {
  await measure(pane)
  const bounds = await pane.locator(".grid-view").evaluate((element) => {
    const frame = element.getBoundingClientRect()
    const grid = element.querySelector(".composition-grid").getBoundingClientRect()
    const page = element.querySelector(".composition-card").getBoundingClientRect()
    return {
      frame: frame.toJSON(),
      grid: grid.toJSON(),
      page: page.toJSON(),
      overflow: element.scrollHeight - element.clientHeight,
      horizontal: element.scrollWidth - element.clientWidth,
      width: document.documentElement.clientWidth,
    }
  })
  try {
    assert.ok(bounds.frame.height > 0 && bounds.frame.width > 0, `${label}: Grid frame is measurable`)
    assert.ok(bounds.page.width > 0 && bounds.page.height > 0, `${label}: cards remain measurable`)
    assert.ok(bounds.horizontal <= 1, `${label}: Grid has no horizontal overflow`)
    assert.ok(bounds.frame.left >= -1 && bounds.frame.right <= bounds.width + 1, `${label}: frame fits viewport`)
    assert.ok(bounds.page.left >= bounds.frame.left - 1, `${label}: cards remain inside the scroll frame`)
    assert.ok(bounds.page.right <= bounds.frame.right + 1, `${label}: cards clear the scrollbar`)
  } catch (error) {
    const screenshot = await captureLayout(pane.page(), "grid-scroll", { label, bounds })
    error.message += `\nLayout: ${label}\nBounds: ${JSON.stringify(bounds)}\nScreenshot: ${screenshot}`
    throw error
  }
}
