<!-- Renders a fitted PDF page and supplies its hover lens. -->
<script module lang="ts">
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
</script>

<script lang="ts">
  import { onDestroy } from "svelte"
  import { cachedRaster, cacheRaster, loadRenderer } from "./pdf.ts"
  import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist"
  import Lens from "./Lens.svelte"
  let {
    pdf,
    page,
    pageNumber,
    thumbnail = false,
    compact = false,
    zoom = 100,
    thumbnailWidth = 0,
    magnification = 16,
    error,
  }: {
    pdf: PDFDocumentProxy
    page: number
    pageNumber?: number
    thumbnail?: boolean
    compact?: boolean
    zoom?: number
    thumbnailWidth?: number
    magnification?: 8 | 16 | 32
    error: (message: string) => void
  } = $props()
  let canvas = $state<HTMLCanvasElement>()
  let rendering = $state(true)
  let painted = $state(false)
  let failure = $state("")
  let lensScale = $state(1)
  let previous: { pdf: PDFDocumentProxy; page: number } | undefined
  const renderedPDF = $derived(pdf)
  const renderedPage = $derived(page)
  const renderedThumbnail = $derived(thumbnail)
  const renderedCompact = $derived(compact)
  const renderedZoom = $derived(zoom)
  const renderedThumbnailWidth = $derived(thumbnailWidth)

  function render(target: HTMLCanvasElement) {
    const document = renderedPDF,
      number = renderedPage,
      small = renderedThumbnail,
      dense = renderedCompact,
      level = renderedZoom,
      reference = renderedThumbnailWidth
    const parent = target.parentElement!
    const retained = previous?.pdf === document && previous.page === number && target.width > 0
    painted = retained
    if (!retained) target.width = target.height = 0
    rendering = parent.clientWidth > 0
    let disposed = false
    let frame: number
    let generation = 0
    let completed: { fit: number; scale: number } | undefined
    let sheet: PDFPageProxy | undefined
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined
    async function draw() {
      if (!parent.clientWidth || (!small && !reference)) return
      const current = ++generation
      task?.cancel()
      try {
        const { AnnotationMode } = await loadRenderer()
        if (disposed || current !== generation) return
        sheet = await document.getPage(number + 1)
        if (disposed || current !== generation) {
          sheet.cleanup()
          return
        }
        const size = sheet.getViewport({ scale: 1 })
        if (!small) parent.style.setProperty("--ratio", String(size.width / size.height))
        const { width, height } = await measure(() => {
          const style = getComputedStyle(parent)
          const availableWidth = Math.max(
            1,
            parent.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd),
          )
          const region = small ? parent : parent.closest<HTMLElement>(".page-scroll")
          // Page insets already constrain the fitted height through the page ratio.
          const availableHeight =
            region && (small || getComputedStyle(region).containerType === "size")
              ? Math.max(
                  1,
                  region.clientHeight - parseFloat(style.paddingBlockStart) - parseFloat(style.paddingBlockEnd),
                )
              : small
                ? 168
                : Infinity
          return { width: availableWidth, height: availableHeight }
        })
        if (disposed || current !== generation) return
        const fit = (Math.min(width / size.width, height / size.height) * level) / 100
        const referenceHeight = dense ? 82 : 168
        lensScale =
          Math.min((small ? width : reference) / size.width, (small ? height : referenceHeight) / size.height) / fit
        const scale = Math.min(
          fit * Math.min(devicePixelRatio, 2),
          Math.sqrt((16 * 1024 * 1024) / (size.width * size.height)),
        )
        const viewport = sheet.getViewport({ scale })
        target.style.inlineSize = `${size.width * fit}px`
        target.style.blockSize = `${size.height * fit}px`
        if (completed?.fit === fit && completed.scale === scale) return
        completed = undefined
        rendering = true
        failure = ""
        let raster = cachedRaster(document, number, scale)
        if (!raster) {
          raster = parent.ownerDocument.createElement("canvas")
          raster.width = Math.ceil(viewport.width)
          raster.height = Math.ceil(viewport.height)
          task = sheet.render({ canvas: raster, viewport, annotationMode: AnnotationMode.DISABLE })
          await task.promise
          if (disposed || current !== generation) return
          cacheRaster(document, number, scale, raster)
        }
        target.width = raster.width
        target.height = raster.height
        target.getContext("2d")!.drawImage(raster, 0, 0)
        completed = { fit, scale }
        previous = { pdf: document, page: number }
        painted = true
      } catch (reason) {
        if (disposed || current !== generation) return
        failure = reason instanceof Error ? reason.message : "PDF rendering failed."
        error(`Page ${pageNumber ?? number + 1}: ${failure}`)
      } finally {
        if (!disposed && current === generation) rendering = false
      }
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => void draw())
    })
    observer.observe(parent)
    const viewport = parent.closest<HTMLElement>(".page-scroll")
    if (viewport) observer.observe(viewport)
    return () => {
      disposed = true
      observer.disconnect()
      cancelAnimationFrame(frame)
      task?.cancel()
      sheet?.cleanup()
    }
  }
  onDestroy(() => {
    if (canvas) canvas.width = canvas.height = 0
  })
</script>

<div class={thumbnail ? "thumbnail" : "pdf-viewport"} aria-busy={rendering}>
  <!-- Prevent inherited button tooltips from covering the hover lens. -->
  <canvas
    bind:this={canvas}
    {@attach render}
    width="0"
    height="0"
    aria-label={`PDF page ${pageNumber ?? page + 1}`}
    title=""
  ></canvas>
  {#if failure}<p class="error" role="alert">{failure}</p>{:else if rendering && !painted}<span
      class="render-status"
      aria-hidden="true"
    ></span>{/if}
</div>
<Lens {pdf} page={page + 1} {canvas} {rendering} {magnification} ratio={lensScale} />
