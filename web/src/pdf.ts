// Owns PDF.js loading, page inspection, document disposal, and bounded preview rasters.

import type { PDFDocumentLoadingTask, PDFDocumentProxy, PDFPageProxy, RenderTask } from "pdfjs-dist"
import { maxInputBytes, maxPages, titleError, uid } from "./model.ts"
import type { Input, Size } from "./model.ts"
import type { InputCheck } from "./recipe.ts"
import type { Description } from "./styles.ts"
import { Processor } from "./processor.ts"
import { frameOutline, readOutline } from "./outline.ts"

const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href
let renderer: Promise<typeof import("pdfjs-dist")> | undefined
let loadedRenderer: typeof import("pdfjs-dist") | undefined

type Raster = { canvas: HTMLCanvasElement; pages: Map<string, Raster>; key: string }
type PendingRaster = {
  promise: Promise<HTMLCanvasElement>
  consumers: Set<(raster: HTMLCanvasElement) => void>
  cancel: () => void
  release: (consumer: (raster: HTMLCanvasElement) => void) => void
}
const rasters = new WeakMap<PDFDocumentProxy, Map<string, Raster>>()
const pendingRasters = new WeakMap<PDFDocumentProxy, Map<string, PendingRaster>>()
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
const imageDocs = new Set<PDFDocumentProxy>()
const imageProcessor = new Processor()
let imageWork = Promise.resolve()

export class Documents {
  #tasks = new Map<PDFDocumentProxy, PDFDocumentLoadingTask>()

  add(pdf: PDFDocumentProxy, task: PDFDocumentLoadingTask, preview?: { bytes: Uint8Array; description: Description }) {
    this.#tasks.set(pdf, task)
    if (preview?.description.pages.some((page) => page.preview)) {
      images.set(pdf, { ...preview, pending: new Map(), unavailable: new Set() })
      imageDocs.add(pdf)
    }
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
  assessment: InputCheck | undefined
  #processor: Processor | undefined = new Processor()
  #task: PDFDocumentLoadingTask | undefined
  #pdf: PDFDocumentProxy | undefined
  #input: Input | undefined
  #cancelled = false

  async read(
    file: File | Uint8Array,
    name: string,
    revision: number,
    geometry?: (input: Input) => void,
    binding?: { recipe: string; input: string },
  ): Promise<Input> {
    if ((file instanceof File ? file.size : file.length) > maxInputBytes)
      throw new Error("Choose a PDF smaller than 128 MiB.")
    const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file
    if (this.#cancelled) throw new DOMException("Opening cancelled.", "AbortError")
    try {
      const [result, opened] = await Promise.all([
        this.#processor!.open(bytes, revision, binding),
        (async () => {
          const task = await openPDF(bytes)
          if (this.#cancelled) {
            void task.destroy()
            return
          }
          this.#task = task
          const pdf = await task.promise
          if (this.#cancelled) {
            releaseRasters(pdf)
            return
          }
          this.#pdf = pdf
          const [dimensions, info] = await Promise.all([inspectPDF(pdf, () => this.#cancelled), metadata(pdf, name)])
          if (!dimensions) return
          const input: Input = {
            id: uid(),
            name,
            bytes,
            pdf,
            ...dimensions,
            ...info,
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
      this.assessment = result.check
      return (this.#input = {
        ...opened,
        description: result.description,
        reference: result.reference,
        outline: frameOutline(opened.outline ?? [], result.description.pages),
      })
    } catch (error) {
      this.dispose()
      throw error
    }
  }

  attach(documents: Documents) {
    const input = this.#input,
      task = this.#task,
      processor = this.#processor
    if (!input || !task || !processor) throw new Error("The PDF is unavailable. Choose it again.")
    documents.add(input.pdf, task, { bytes: input.bytes, description: input.description })
    this.#input = undefined
    this.#pdf = undefined
    this.#task = undefined
    this.#processor = undefined
    return processor
  }

  dispose() {
    this.#cancelled = true
    if (this.#pdf) {
      releaseRasters(this.#pdf)
      this.#pdf = undefined
    }
    this.#input = undefined
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
  if (imageDocs.delete(pdf) && imageDocs.size === 0) imageProcessor.dispose()
  const pending = pendingRasters.get(pdf)
  if (pending) {
    for (const entry of pending.values()) entry.cancel()
    pendingRasters.delete(pdf)
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

export function acquireRaster(
  pdf: PDFDocumentProxy,
  page: number,
  scale: number,
  sampling: number,
  size: Size,
  ownerDocument: Document,
  initialSheet?: PDFPageProxy,
  onReady?: (raster: HTMLCanvasElement) => void,
): { promise: Promise<HTMLCanvasElement>; release: () => void } {
  const key = `${page}:${scale}:${sampling}`
  const consumer = onReady ?? (() => {})
  let pending = pendingRasters.get(pdf)
  let entry = pending?.get(key)
  if (entry) {
    entry.consumers.add(consumer)
    if (initialSheet) initialSheet.cleanup()
  } else {
    if (!pending) pendingRasters.set(pdf, (pending = new Map()))
    const map = pending
    const consumers = new Set<(raster: HTMLCanvasElement) => void>([consumer])
    let cancelled = false
    let active: RenderTask | undefined
    let sheet: PDFPageProxy | undefined = initialSheet
    let sample: HTMLCanvasElement | undefined
    let transient: HTMLCanvasElement | undefined
    let finished = false
    const cleanupTransient = () => {
      if (transient) {
        transient.width = transient.height = 0
        transient = undefined
      }
    }
    const work = (async () => {
      try {
        const { AnnotationMode } = cachedRenderer() ?? (await loadRenderer())
        if (cancelled) throw new DOMException("Render cancelled.", "AbortError")
        sheet ??= await pdf.getPage(page + 1)
        if (cancelled) throw new DOMException("Render cancelled.", "AbortError")
        const viewport = sheet.getViewport({ scale: sampling })
        let raster = ownerDocument.createElement("canvas")
        transient = raster
        raster.width = Math.ceil(viewport.width)
        raster.height = Math.ceil(viewport.height)
        const task = sheet.render({ canvas: raster, viewport, annotationMode: AnnotationMode.DISABLE })
        active = task
        await task.promise
        if (cancelled) throw new DOMException("Render cancelled.", "AbortError")
        if (sampling > scale) {
          sample = raster
          raster = ownerDocument.createElement("canvas")
          transient = raster
          raster.width = Math.ceil(size.width * scale)
          raster.height = Math.ceil(size.height * scale)
          const context = raster.getContext("2d")!
          context.imageSmoothingEnabled = true
          context.imageSmoothingQuality = "high"
          context.drawImage(sample, 0, 0, raster.width, raster.height)
        }
        if (cacheRaster(pdf, page, scale, raster, sampling)) transient = undefined
        for (const notify of consumers) notify(raster)
        return raster
      } finally {
        finished = true
        if (sample) {
          sample.width = sample.height = 0
          sample = undefined
        }
        active = undefined
        sheet?.cleanup()
        sheet = undefined
        if (map.get(key) === entry) map.delete(key)
        if (cancelled || consumers.size === 0) cleanupTransient()
      }
    })()
    work.catch(() => {})
    entry = {
      promise: work,
      consumers,
      cancel() {
        cancelled = true
        active?.cancel()
        if (finished) cleanupTransient()
      },
      release(item) {
        consumers.delete(item)
        if (consumers.size === 0) {
          if (!finished) entry!.cancel()
          else cleanupTransient()
        }
      },
    }
    map.set(key, entry)
  }
  const shared = entry
  let released = false
  const release = () => {
    if (released) return
    released = true
    shared.release(consumer)
  }
  return { promise: shared.promise, release }
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
  const extract = imageWork.then(async () => {
    if (images.get(pdf) !== source) return
    try {
      return await imageProcessor.preview(source.bytes, page)
    } catch {
      if (images.get(pdf) === source) source.unavailable.add(key)
    }
  })
  imageWork = extract.then(
    () => {},
    () => {},
  )
  const work = extract.then(async (bytes) => {
    try {
      if (images.get(pdf) !== source || !bytes?.byteLength) return
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
  return work
}

export function cachedRenderer() {
  return loadedRenderer
}

export function loadRenderer() {
  return (renderer ??= import("pdfjs-dist")
    .then((module) => {
      module.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.mjs`
      loadedRenderer = module
      return module
    })
    .catch((error) => {
      renderer = undefined
      loadedRenderer = undefined
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

export async function renderCoverCanvas(
  pdf: PDFDocumentProxy,
  page = 1,
  edge = 512,
  canvas = document.createElement("canvas"),
): Promise<HTMLCanvasElement> {
  const { AnnotationMode } = await loadRenderer()
  const sheet = await pdf.getPage(page)
  try {
    const size = sheet.getViewport({ scale: 1 })
    const viewport = sheet.getViewport({ scale: edge / Math.max(size.width, size.height) })
    canvas.width = Math.ceil(viewport.width)
    canvas.height = Math.ceil(viewport.height)
    await sheet.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE, background: "rgb(255, 255, 255)" })
      .promise
    return canvas
  } finally {
    sheet.cleanup()
  }
}

export async function cover(pdf: PDFDocumentProxy, page = 1): Promise<string> {
  const canvas = document.createElement("canvas")
  try {
    let edge = 512
    while (true) {
      await renderCoverCanvas(pdf, page, edge, canvas)
      const png = canvas.toDataURL("image/png")
      if (png.length <= 256 * 1024) return png
      if (edge <= 240) throw new Error("The cover preview exceeds its size limit.")
      edge = Math.max(240, Math.floor(edge * 0.8))
    }
  } finally {
    canvas.width = canvas.height = 0
  }
}

export async function verifyPDF(pdf: PDFDocumentProxy): Promise<Size> {
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
    return { width: (size.width * 25.4) / 72, height: (size.height * 25.4) / 72 }
  } finally {
    canvas.width = canvas.height = 0
    page.cleanup()
  }
}

export async function inspectPDF(pdf: PDFDocumentProxy, cancelled: () => boolean) {
  if (pdf.numPages > maxPages) throw new Error(`PDF Composer supports up to ${maxPages} pages.`)
  const first = await verifyPDF(pdf)
  if (cancelled()) return
  const sizes: Size[] = [first]
  for (let start = 1; start < pdf.numPages; start += 16) {
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
  const [rawLabels, outline] = await Promise.all([pdf.getPageLabels(), readOutline(pdf, cancelled)])
  const labels = rawLabels ?? []
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
