<!-- Renders PDF preview rasters and supplies each image's hover lens. -->

<script module lang="ts">
  function scaleFor(size: { width: number; height: number }, requested: number) {
    const limit = 16 * 1024 * 1024
    let scale = Math.min(requested, Math.sqrt(limit / size.width / size.height))
    const width = Math.ceil(size.width * scale),
      height = Math.ceil(size.height * scale)
    if (width * height > limit)
      scale = (Math.floor(limit / Math.min(width, height)) - 0.5) / Math.max(size.width, size.height)
    return scale
  }
  let measurements: (() => void)[] = []
  function measure<T>(read: () => T): Promise<T> {
    return new Promise((resolve, reject) => {
      measurements.push(() => {
        try {
          resolve(read())
        } catch (reason) {
          reject(reason)
        }
      })
      if (measurements.length === 1)
        requestAnimationFrame(() => {
          const batch = measurements
          measurements = []
          // Finish geometry reads before resolving promises that paint canvases.
          for (const pending of batch) pending()
        })
    })
  }
  let initialPaints: (() => void)[] = []
  const rasterSizes = new WeakMap<HTMLCanvasElement, { width: string; height: string }>()
  function paintBatched(paint: () => void) {
    initialPaints.push(paint)
    if (initialPaints.length === 1)
      requestAnimationFrame(() => {
        const batch = initialPaints
        initialPaints = []
        for (const run of batch) run()
      })
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from "svelte"
  import { acquireRaster, cachedRaster, thumbnail as suppliedThumbnail } from "./pdf.ts"
  import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"
  import type { Size } from "./model.ts"
  import type { Description } from "./styles.ts"
  import Lens from "./Lens.svelte"
  import type { Magnification } from "./Lens.svelte"
  let {
    pdf,
    page,
    pageNumber,
    name,
    thumbnail = false,
    preview,
    size: knownSize,
    zoom = 100,
    thumbnailWidth = 0,
    magnification = 16,
    error,
  }: {
    pdf: PDFDocumentProxy
    page: number
    pageNumber?: number
    name?: string
    thumbnail?: boolean
    preview?: Description["pages"][number]["preview"]
    size?: Size
    zoom?: number
    thumbnailWidth?: number
    magnification?: Magnification
    error: (message: string) => void
  } = $props()
  let canvas = $state<HTMLCanvasElement>()
  let rendering = $state(true)
  let painted = $state(false)
  let failure = $state("")
  let lensScale = $state(1)
  let previous: { pdf: PDFDocumentProxy; page: number } | undefined

  function render(target: HTMLCanvasElement) {
    const document = pdf,
      number = page,
      small = thumbnail,
      descriptor = preview,
      presetSize = knownSize,
      previewKey = small && descriptor ? `preview:${descriptor.file}` : undefined
    const parent = target.parentElement!
    const retained = previous?.pdf === document && previous.page === number && target.width > 0
    painted = retained
    rendering = true
    let disposed = false
    let generation = 0
    let completed: { fit: number; scale: number } | undefined
    let drawn: HTMLCanvasElement | undefined
    let releaseActive: (() => void) | undefined
    let lastZoom = untrack(() => zoom)
    let lastReference = untrack(() => thumbnailWidth)
    if (!retained) {
      const raster = small
        ? ((previewKey ? cachedRaster(document, previewKey, 1) : undefined) ?? cachedRaster(document, number))
        : undefined
      if (raster) {
        painted = true
        const remembered = rasterSizes.get(raster)
        target.width = raster.width
        target.height = raster.height
        target.style.inlineSize = remembered?.width ?? "auto"
        target.style.blockSize = remembered?.height ?? "auto"
        paintBatched(() => {
          if (disposed || drawn) return
          target.getContext("2d")!.drawImage(raster, 0, 0)
          drawn = raster
          previous = { pdf: document, page: number }
        })
      } else {
        target.width = 0
        target.height = 0
        target.style.removeProperty("inline-size")
        target.style.removeProperty("block-size")
      }
    }
    async function draw() {
      const level = zoom
      const reference = thumbnailWidth
      if (!small && !reference) return
      const current = ++generation
      releaseActive?.()
      releaseActive = undefined
      let sheet: PDFPageProxy | undefined
      let acquired: { promise: Promise<HTMLCanvasElement | undefined>; release: () => void } | undefined
      try {
        let size = presetSize
        if (!size) {
          sheet = await document.getPage(number + 1)
          if (disposed || current !== generation) return
          const viewport = sheet.getViewport({ scale: 1 })
          size = { width: viewport.width, height: viewport.height }
        }
        if (!small) parent.style.setProperty("--ratio", String(size.width / size.height))
        const bounds = await measure(() => {
          // A pane can become hidden while PDF.js loads; wait for its next visible resize.
          if (!parent.clientWidth) return
          if (!small) return { width: target.getBoundingClientRect().width, height: Infinity }
          const style = getComputedStyle(parent)
          const availableWidth = Math.max(
            1,
            parent.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd),
          )
          const availableHeight = Math.max(
            1,
            parent.clientHeight - parseFloat(style.paddingBlockStart) - parseFloat(style.paddingBlockEnd),
          )
          return { width: availableWidth, height: availableHeight }
        })
        if (!bounds || disposed || current !== generation) return
        const { width, height } = bounds
        const fit = Math.min(width / size.width, height / size.height) * (small ? level / 100 : 1)
        lensScale = (small ? Math.min(width / size.width, height / size.height) : reference / size.width) / fit
        const scale = scaleFor(size, fit * Math.min(devicePixelRatio, 2))
        // Existing high-density rasters need no extra sampling or temporary canvas.
        const sampling = small ? scaleFor(size, Math.max(scale, fit * Math.min(devicePixelRatio, 1) * 2)) : scale
        if (small) {
          const nextW = `${size.width * fit}px`
          const nextH = `${size.height * fit}px`
          if (target.style.inlineSize !== nextW) target.style.inlineSize = nextW
          if (target.style.blockSize !== nextH) target.style.blockSize = nextH
        }
        if (completed?.fit === fit && completed.scale === scale) return
        completed = undefined
        rendering = true
        failure = ""
        if (small && descriptor) {
          const image = await suppliedThumbnail(document, number)
          if (disposed || current !== generation) return
          if (image?.width) {
            const targetWidth = Math.ceil(size.width * scale)
            const targetHeight = Math.ceil(size.height * scale)
            target.width = targetWidth
            target.height = targetHeight
            const context = target.getContext("2d")!
            const imageScale = Math.min(targetWidth / image.width, targetHeight / image.height)
            const imageWidth = image.width * imageScale,
              imageHeight = image.height * imageScale
            context.fillStyle = "white"
            context.fillRect(0, 0, targetWidth, targetHeight)
            context.drawImage(
              image,
              (targetWidth - imageWidth) / 2,
              (targetHeight - imageHeight) / 2,
              imageWidth,
              imageHeight,
            )
            drawn = undefined
            completed = { fit, scale }
            previous = { pdf: document, page: number }
            painted = true
            return
          }
        }
        const paint = (raster: HTMLCanvasElement) => {
          if (disposed || current !== generation) return
          if (small) rasterSizes.set(raster, { width: `${size.width * fit}px`, height: `${size.height * fit}px` })
          if (drawn !== raster || target.width !== raster.width || target.height !== raster.height) {
            target.width = raster.width
            target.height = raster.height
            target.getContext("2d")!.drawImage(raster, 0, 0)
            drawn = raster
          }
          completed = { fit, scale }
          previous = { pdf: document, page: number }
          painted = true
          rendering = false
        }
        const raster = cachedRaster(document, number, scale, sampling)
        if (raster) {
          paint(raster)
        } else {
          const handed = sheet
          sheet = undefined
          acquired = acquireRaster(document, number, scale, sampling, size, parent.ownerDocument, handed, paint)
          releaseActive = acquired.release
          await acquired.promise
        }
      } catch (reason) {
        if (disposed || current !== generation) return
        failure = reason instanceof Error ? reason.message : "PDF rendering failed."
        error(`Page ${pageNumber ?? number + 1}: ${failure}`)
      } finally {
        if (acquired) {
          if (releaseActive === acquired.release) releaseActive = undefined
          acquired.release()
        }
        sheet?.cleanup()
        if (!disposed && current === generation) rendering = false
      }
    }
    let frame = 0
    const schedule = () => {
      if (small) {
        void draw()
        return
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => void draw())
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(parent)
    const viewport = parent.closest<HTMLElement>(".page-scroll")
    if (viewport) observer.observe(viewport)
    $effect(() => {
      const nextZoom = zoom
      const nextReference = thumbnailWidth
      if (nextZoom === lastZoom && nextReference === lastReference) return
      const zoomChanged = nextZoom !== lastZoom
      lastZoom = nextZoom
      lastReference = nextReference
      if (!small && (zoomChanged || !completed)) rendering = true
      schedule()
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      releaseActive?.()
      releaseActive = undefined
    }
  }
  onDestroy(() => {
    if (canvas) canvas.width = canvas.height = 0
  })
</script>

<div
  class={thumbnail ? "thumbnail" : "pdf-viewport"}
  aria-busy={rendering}
  data-error={!!failure || undefined}
  title={failure || undefined}
>
  <!-- Prevent inherited button tooltips from covering the hover lens. -->
  <canvas
    bind:this={canvas}
    {@attach render}
    width="0"
    height="0"
    aria-label={`PDF page ${pageNumber ?? page + 1}${failure ? ": could not render" : ""}`}
    title=""
  ></canvas>
  {#if !failure && rendering && !painted}<span class="spinner render-status" aria-hidden="true"></span>{/if}
</div>
<Lens {pdf} page={page + 1} {pageNumber} {name} {canvas} {rendering} {magnification} ratio={lensScale} />
