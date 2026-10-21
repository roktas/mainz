// Owns PDF.js loading, page inspection, document disposal, and bounded preview rasters.

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import { maxPages } from "./model.ts"
import type { Size } from "./model.ts"

const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href
let renderer: Promise<typeof import("pdfjs-dist")> | undefined

type Raster = { canvas: HTMLCanvasElement; pages: Map<string, Raster>; key: string }
const rasters = new WeakMap<PDFDocumentProxy, Map<string, Raster>>()
const recent = new Set<Raster>()
const rasterLimit = 32 * 1024 * 1024
let rasterBytes = 0

export class Documents {
  #tasks = new Map<PDFDocumentProxy, PDFDocumentLoadingTask>()

  add(pdf: PDFDocumentProxy, task: PDFDocumentLoadingTask) {
    this.#tasks.set(pdf, task)
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
  const pages = rasters.get(pdf)
  if (!pages) return
  for (const raster of pages.values()) discard(raster)
  rasters.delete(pdf)
}

export function cachedRaster(pdf: PDFDocumentProxy, page: number, scale: number) {
  const raster = rasters.get(pdf)?.get(`${page}:${scale}`)
  if (!raster) return
  recent.delete(raster)
  recent.add(raster)
  return raster.canvas
}

// Takes ownership on success; rejected canvases remain the caller's responsibility.
export function cacheRaster(pdf: PDFDocumentProxy, page: number, scale: number, canvas: HTMLCanvasElement) {
  const bytes = canvas.width * canvas.height * 4
  const key = `${page}:${scale}`
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
    await page.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise
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
