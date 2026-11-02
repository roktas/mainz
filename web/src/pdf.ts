// Owns PDF.js loading, page inspection, document disposal, and bounded preview rasters.

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import { maxPages } from "./model.ts"
import type { Size } from "./model.ts"
import type { Description } from "./styles.ts"
import { Processor } from "./processor.ts"

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

function discard(raster: Raster) {
  recent.delete(raster)
  raster.pages.delete(raster.key)
  rasterBytes -= raster.canvas.width * raster.canvas.height * 4
  raster.canvas.width = raster.canvas.height = 0
}

export function releaseRasters(pdf: PDFDocumentProxy) {
  images.delete(pdf)
  if (imageDocument === pdf) imageProcessor.cancel()
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
      imageDocument = undefined
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
  if (!cancelled()) return { sizes, labels }
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
