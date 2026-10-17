// Opens PDFs through PDF.js and owns the bounded memory cache of preview rasters.

import type { PDFDocumentProxy } from "pdfjs-dist";

const assets = new URL(`${import.meta.env.BASE_URL}pdfjs/`, location.href).href;
let renderer: Promise<typeof import("pdfjs-dist")> | undefined;

type Raster = { canvas: HTMLCanvasElement; pages: Map<string, Raster>; key: string };
const rasters = new WeakMap<PDFDocumentProxy, Map<string, Raster>>();
const recent = new Set<Raster>();
const rasterLimit = 32 * 1024 * 1024;
let rasterBytes = 0;

export function cachedRaster(pdf: PDFDocumentProxy, page: number, scale: number) {
  const raster = rasters.get(pdf)?.get(`${page}:${scale}`);
  if (!raster) return;
  recent.delete(raster);
  recent.add(raster);
  return raster.canvas;
}

export function cacheRaster(pdf: PDFDocumentProxy, page: number, scale: number, source: HTMLCanvasElement) {
  const bytes = source.width * source.height * 4;
  const key = `${page}:${scale}`;
  let pages = rasters.get(pdf);
  if (bytes > rasterLimit || pages?.has(key)) return;
  while (rasterBytes + bytes > rasterLimit) {
    const oldest = recent.values().next().value!;
    recent.delete(oldest);
    oldest.pages.delete(oldest.key);
    rasterBytes -= oldest.canvas.width * oldest.canvas.height * 4;
    oldest.canvas.width = oldest.canvas.height = 0;
  }
  if (!pages) rasters.set(pdf, (pages = new Map()));
  // Component disposal clears its canvas; retain an independent, memory-only copy.
  const canvas = source.ownerDocument.createElement("canvas");
  canvas.width = source.width;
  canvas.height = source.height;
  canvas.getContext("2d")!.drawImage(source, 0, 0);
  const raster = { canvas, pages, key };
  pages.set(key, raster);
  recent.add(raster);
  rasterBytes += bytes;
}

export function loadRenderer() {
  return (renderer ??= import("pdfjs-dist")
    .then((module) => {
      module.GlobalWorkerOptions.workerSrc = `${assets}pdf.worker.mjs`;
      return module;
    })
    .catch((error) => {
      renderer = undefined;
      throw error;
    }));
}

export async function openPDF(bytes: Uint8Array) {
  const { getDocument } = await loadRenderer();
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
  });
}
