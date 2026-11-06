// Owns PDF.js loading, page inspection, document disposal, and bounded preview rasters.

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import { maxInputBytes, maxPages, titleError, uid } from "./model.ts"
import type { Input, Size } from "./model.ts"
import type { Description } from "./styles.ts"
import { Processor } from "./processor.ts"
import { readOutline } from "./outline.ts"

const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href
let renderer: Promise<typeof import("pdfjs-dist")> | undefined

type Raster = { canvas: HTMLCanvasElement; pages: Map<string, Raster>; key: string }
const rasters = new WeakMap<PDFDocumentProxy, Map<string, Raster>>()
const recent = new Set<Raster>()
const rasterLimit = 32 * 1024 * 1024 // Retained canvas pixels only; excludes active renders and PDF.js memory.
let rasterBytes = 0
const images = new WeakMap<
  PDFDocumentProxy,
  {
    bytes: Uint8Array
    description: Description
    pending: Map<string, Promise<HTMLCanvasElement | undefined>>
    unavailable: Set<string>
  }
>()
const imageProcessor = new Processor()
let imageWork = Promise.resolve()
let imageDocument: PDFDocumentProxy | undefined

export class Documents {
  #tasks = new Map<PDFDocumentProxy, PDFDocumentLoadingTask>()

  add(pdf: PDFDocumentProxy, task: PDFDocumentLoadingTask, preview?: { bytes: Uint8Array; description: Description }) {
    this.#tasks.set(pdf, task)
    if (preview?.description.pages.some((page) => page.preview))
      images.set(pdf, { ...preview, pending: new Map(), unavailable: new Set() })
  }
  retain(pdfs: PDFDocumentProxy[]) {
    const used = new Set(pdfs)
    for (const [pdf, task] of this.#tasks)
      if (!used.has(pdf)) {
        this.#tasks.delete(pdf)
        releaseRasters(pdf)
        void task.destroy()
      }
  }
  dispose() {
    this.retain([])
  }
}

export class Opening {
  #processor: Processor | undefined = new Processor()
  #task: PDFDocumentLoadingTask | undefined
  #input: Input | undefined
  #cancelled = false

  async read(
    file: File | Uint8Array,
    name: string,
    revision: number,
    geometry?: (input: Input) => void,
  ): Promise<Input> {
    if ((file instanceof File ? file.size : file.length) > maxInputBytes)
      throw new Error("Choose a PDF smaller than 128 MiB.")
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file
    if (this.#cancelled) throw new DOMException("Opening cancelled.", "AbortError")
    try {
      const [result, opened] = await Promise.all([
        this.#processor!.run(bytes, revision),
        (async () => {
          const task = await openPDF(bytes)
          if (this.#cancelled) {
            void task.destroy()
            return
          }
          this.#task = task
          const pdf = await task.promise
          const dimensions = await inspectPDF(pdf, () => this.#cancelled)
          if (!dimensions) return
          const input: Input = {
            id: uid(),
            name,
            bytes,
            pdf,
            ...dimensions,
            ...(await metadata(pdf, name)),
            description: {
              version: 1,
              pageCount: pdf.numPages,
              pages: Array.from({ length: pdf.numPages }, () => ({})),
              parameters: {},
            },
          }
          if (this.#cancelled) return
          geometry?.(input)
          return input
        })(),
      ])
      if (!opened || this.#cancelled) throw new DOMException("Opening cancelled.", "AbortError")
      return (this.#input = { ...opened, description: result.description, reference: result.reference })
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  check(recipe: string, id: string, revision: number) {
    return this.#processor!.check(recipe, id, this.#input!.bytes, revision)
  }

  attach(documents: Documents) {
    const input = this.#input!
    documents.add(input.pdf, this.#task!, { bytes: input.bytes, description: input.description })
    this.#task = undefined
    const processor = this.#processor!
    this.#processor = undefined
    return processor
  }

  dispose() {
    this.#cancelled = true
    this.#processor?.dispose()
    this.#processor = undefined
    void this.#task?.destroy()
    this.#task = undefined
  }
}

function discard(raster: Raster) {
  recent.delete(raster)
  raster.pages.delete(raster.key)
  rasterBytes -= raster.canvas.width * raster.canvas.height * 4
  raster.canvas.width = raster.canvas.height = 0
}

export function releaseRasters(pdf: PDFDocumentProxy) {
  images.delete(pdf)
  if (imageDocument === pdf) {
    imageProcessor.dispose()
    imageDocument = undefined
  }
  const pages = rasters.get(pdf)
  if (!pages) return
  for (const raster of pages.values()) discard(raster)
  rasters.delete(pdf)
}

export function cachedRaster(pdf: PDFDocumentProxy, page: number | string, scale?: number, sampling = scale) {
  const pages = rasters.get(pdf)
  let raster = scale === undefined ? undefined : pages?.get(`${page}:${scale}:${sampling}`)
  if (scale === undefined)
    for (const entry of pages?.values() ?? [])
      if (entry.key.startsWith(`${page}:`)) {
        raster = entry
        break
      }
  if (!raster) return
  recent.delete(raster)
  recent.add(raster)
  return raster.canvas
}

// Takes ownership on success; rejected canvases remain the caller's responsibility.
export function cacheRaster(
  pdf: PDFDocumentProxy,
  page: number | string,
  scale: number,
  canvas: HTMLCanvasElement,
  sampling = scale,
) {
  const bytes = canvas.width * canvas.height * 4
  const key = `${page}:${scale}:${sampling}`
  let pages = rasters.get(pdf)
  if (bytes > rasterLimit || pages?.has(key)) return false
  while (rasterBytes + bytes > rasterLimit) discard(recent.values().next().value!)
  if (!pages) rasters.set(pdf, (pages = new Map()))
  const raster = { canvas, pages, key }
  pages.set(key, raster)
  recent.add(raster)
  rasterBytes += bytes
  return true
}

export function thumbnail(pdf: PDFDocumentProxy, page: number): Promise<HTMLCanvasElement | undefined> {
  const source = images.get(pdf)
  const descriptor = source?.description.pages[page]?.preview
  if (!source || !descriptor) return Promise.resolve(undefined)
  const key = `preview:${descriptor.file}`
  if (source.unavailable.has(key)) return Promise.resolve(undefined)
  const cached = cachedRaster(pdf, key, 1)
  if (cached) return Promise.resolve(cached)
  const pending = source.pending.get(key)
  if (pending) return pending
  const work = imageWork.then(async () => {
    if (images.get(pdf) !== source) return
    imageDocument = pdf
    try {
      const bytes = await imageProcessor.preview(source.bytes, page)
      if (images.get(pdf) !== source || !bytes.byteLength) return
      let bitmap: ImageBitmap
      try {
        bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }))
      } catch {
        source.unavailable.add(key)
        return // A host decoder failure falls back to PDF rendering.
      }
      try {
        if (images.get(pdf) !== source) return
        const canvas = document.createElement("canvas")
        const scale = Math.min(1, 1024 / bitmap.width, 1024 / bitmap.height)
        canvas.width = Math.ceil(bitmap.width * scale)
        canvas.height = Math.ceil(bitmap.height * scale)
        const context = canvas.getContext("2d")!
        context.fillStyle = "white"
        context.fillRect(0, 0, canvas.width, canvas.height)
        context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
        cacheRaster(pdf, key, 1, canvas)
        return canvas
      } finally {
        bitmap.close()
      }
    } finally {
      source.pending.delete(key)
    }
  })
  source.pending.set(key, work)
  imageWork = work.then(
    () => {},
    () => {},
  )
  return work
}

export function loadRenderer() {
  return (renderer ??= import("pdfjs-dist")
    .then((module) => {
      module.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.mjs`
      return module
    })
    .catch((error) => {
      renderer = undefined
      throw error
    }))
}

export async function metadata(
  pdf: PDFDocumentProxy,
  name: string,
): Promise<Pick<Input, "title" | "coverPage" | "xmp">> {
  const details = await pdf.getMetadata().catch(() => ({ info: {}, metadata: undefined }))
  const { info, metadata: record } = details
  const xmp = new Map<string, string>()
  const encoder = new TextEncoder()
  for (const [key, value] of record ?? []) {
    if (xmp.size === 32) break
    const text = typeof value === "string" ? value.trim() : Array.isArray(value) ? value.join(", ").trim() : ""
    if (
      key &&
      key.isWellFormed() &&
      encoder.encode(key).length <= 128 &&
      text &&
      text.isWellFormed() &&
      encoder.encode(text).length <= 4096
    )
      xmp.set(key, text)
  }
  const author = (info as { Author?: string }).Author
  if (xmp.size < 32 && !xmp.has("dc:creator") && typeof author === "string" && author.trim() && !titleError(author))
    xmp.set("dc:creator", author.trim())
  const candidate = record?.get("dc:title")
  const title = [candidate, (info as { Title?: string }).Title, name, "Untitled"].find(
    (value): value is string => typeof value === "string" && !titleError(value),
  )!
  const coverPage = Number(record?.get("mainz:coverpage"))
  return {
    title: title.trim(),
    coverPage: Number.isSafeInteger(coverPage) && coverPage >= 1 && coverPage <= pdf.numPages ? coverPage : 1,
    ...(xmp.size ? { xmp: Object.fromEntries(xmp) } : {}),
  }
}

export async function cover(pdf: PDFDocumentProxy, page = 1): Promise<string> {
  const { AnnotationMode } = await loadRenderer()
  const canvas = document.createElement("canvas")
  const sheet = await pdf.getPage(page)
  try {
    const size = sheet.getViewport({ scale: 1 })
    let edge = 512
    while (true) {
      const viewport = sheet.getViewport({ scale: edge / Math.max(size.width, size.height) })
      canvas.width = Math.ceil(viewport.width)
      canvas.height = Math.ceil(viewport.height)
      await sheet.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE, background: "rgb(255, 255, 255)" })
        .promise
      const png = canvas.toDataURL("image/png")
      if (png.length <= 256 * 1024) return png
      if (edge <= 240) throw new Error("The cover preview exceeds its size limit.")
      edge = Math.max(240, Math.floor(edge * 0.8))
    }
  } finally {
    canvas.width = canvas.height = 0
    sheet.cleanup()
  }
}

export async function verifyPDF(pdf: PDFDocumentProxy) {
  const { AnnotationMode } = await loadRenderer()
  const canvas = document.createElement("canvas")
  const page = await pdf.getPage(1)
  try {
    const size = page.getViewport({ scale: 1 })
    const viewport = page.getViewport({ scale: Math.min(0.2, 2048 / size.width, 2048 / size.height) })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    // Offscreen inspection must also finish while a native PDF window has focus.
    await page.render({ canvas, viewport, intent: "print", annotationMode: AnnotationMode.DISABLE }).promise
  } finally {
    canvas.width = canvas.height = 0
    page.cleanup()
  }
}

export async function inspectPDF(pdf: PDFDocumentProxy, cancelled: () => boolean) {
  if (pdf.numPages > maxPages) throw new Error(`PDF Composer supports up to ${maxPages} pages.`)
  await verifyPDF(pdf)
  const sizes: Size[] = []
  for (let start = 0; start < pdf.numPages; start += 16) {
    if (cancelled()) return
    const batch = await Promise.all(
      Array.from({ length: Math.min(16, pdf.numPages - start) }, async (_, offset) => {
        const page = await pdf.getPage(start + offset + 1)
        try {
          const viewport = page.getViewport({ scale: 1 })
          return { width: (viewport.width * 25.4) / 72, height: (viewport.height * 25.4) / 72 }
        } finally {
          page.cleanup()
        }
      }),
    )
    if (cancelled()) return
    sizes.push(...batch)
  }
  const labels = (await pdf.getPageLabels()) ?? []
  const outline = cancelled() ? [] : await readOutline(pdf, cancelled)
  if (!cancelled()) return { sizes, labels, outline }
}

export async function openPDF(bytes: Uint8Array) {
  const { getDocument } = await loadRenderer()
  return getDocument({
    data: bytes.slice(),
    cMapUrl: `${assets}cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${assets}standard_fonts/`,
    iccUrl: `${assets}iccs/`,
    wasmUrl: `${assets}wasm/`,
    useWorkerFetch: true,
    enableXfa: false,
    stopAtErrors: true,
    maxImageSize: 16 * 1024 * 1024,
    canvasMaxAreaInBytes: 64 * 1024 * 1024,
  })
}
