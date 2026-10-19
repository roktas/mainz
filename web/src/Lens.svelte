<!-- Owns lens magnification levels and bounded PDF crops for mouse and touch. -->

<script module lang="ts">
  export const magnificationLevels = [2, 4, 8, 16, 32, 64, 128] as const
  export type Magnification = (typeof magnificationLevels)[number]
</script>

<script lang="ts">
  import { loadRenderer } from "./pdf.ts"
  import type { PDFDocumentProxy } from "pdfjs-dist"
  let {
    pdf,
    page,
    canvas,
    rendering,
    magnification = 16,
    ratio = 1,
  }: {
    pdf?: PDFDocumentProxy
    page: number
    canvas?: HTMLCanvasElement
    rendering: boolean
    magnification?: Magnification
    ratio?: number
  } = $props()
  let point = $state<{ x: number; y: number; left: number; top: number }>()
  let refining = $state(false)
  let opening: ReturnType<typeof setTimeout> | undefined
  let finger: { id: number; x: number; y: number } | undefined
  let holding = false
  function dismiss() {
    clearTimeout(opening)
    opening = undefined
    point = undefined
    finger = undefined
    holding = false
  }
  function touchStart(event: TouchEvent) {
    dismiss()
    if (event.touches.length !== 1) return
    const touch = event.touches[0]
    finger = { id: touch.identifier, x: touch.clientX, y: touch.clientY }
    opening = setTimeout(() => {
      opening = undefined
      if (!finger) return
      holding = true
      show(finger.x, finger.y, true)
    }, 280)
  }
  function touchMove(event: TouchEvent) {
    if (!finger) return
    const touch = Array.from(event.touches).find((contact) => contact.identifier === finger!.id)
    if (!touch || event.touches.length !== 1) return dismiss()
    if (!holding) {
      if (Math.hypot(touch.clientX - finger.x, touch.clientY - finger.y) > 8) dismiss()
      return
    }
    if (event.cancelable) event.preventDefault()
    show(touch.clientX, touch.clientY, true)
  }
  function touchEnd(event: TouchEvent) {
    if (holding && event.type === "touchend") {
      if (event.cancelable) event.preventDefault()
      event.stopPropagation()
    }
    dismiss()
  }
  function leave(event: PointerEvent) {
    if (event.pointerType === "mouse") dismiss()
  }
  function float(element: HTMLElement) {
    document.getElementById("app")!.append(element)
    return () => element.remove()
  }
  function observe() {
    const target = canvas
    if (!target || !pdf || page < 1 || rendering) {
      dismiss()
      return
    }
    dismiss()
    target.addEventListener("pointermove", inspect)
    target.addEventListener("pointerleave", leave)
    target.addEventListener("pointerdown", dismiss)
    target.addEventListener("wheel", dismiss)
    target.addEventListener("touchstart", touchStart, { passive: true })
    target.addEventListener("touchmove", touchMove, { passive: false })
    target.addEventListener("touchend", touchEnd, { passive: false })
    target.addEventListener("touchcancel", touchEnd)
    document.addEventListener("scroll", dismiss, true)
    return () => {
      target.removeEventListener("pointermove", inspect)
      target.removeEventListener("pointerleave", leave)
      target.removeEventListener("pointerdown", dismiss)
      target.removeEventListener("wheel", dismiss)
      target.removeEventListener("touchstart", touchStart)
      target.removeEventListener("touchmove", touchMove)
      target.removeEventListener("touchend", touchEnd)
      target.removeEventListener("touchcancel", touchEnd)
      document.removeEventListener("scroll", dismiss, true)
      dismiss()
    }
  }
  function refine(target: HTMLCanvasElement) {
    const source = pdf,
      number = page,
      image = canvas,
      scale = magnification * ratio
    if (!source || !image || rendering) return
    const density = Math.min(devicePixelRatio, 2),
      bounds = target.getBoundingClientRect(),
      original = image.getBoundingClientRect()
    const width = Math.ceil(bounds.width * density),
      height = Math.ceil(bounds.height * density)
    if (target.width !== width) target.width = width
    if (target.height !== height) target.height = height
    const context = target.getContext("2d")!
    const areaWidth = ((bounds.width / scale) * image.width) / original.width
    const areaHeight = ((bounds.height / scale) * image.height) / original.height
    const raster = document.createElement("canvas")
    raster.width = width
    raster.height = height
    let disposed = false
    let position: typeof point
    let running = false
    let frame: number | undefined
    let sheet: Awaited<ReturnType<PDFDocumentProxy["getPage"]>> | undefined
    let task: ReturnType<Awaited<ReturnType<PDFDocumentProxy["getPage"]>>["render"]> | undefined
    function releasePage() {
      sheet?.cleanup()
      sheet = undefined
    }
    async function draw() {
      frame = undefined
      const at = position
      if (!at || disposed) return
      running = true
      try {
        // Keep decoded PDF operators while the lens is open instead of rebuilding each crop.
        sheet ??= await source!.getPage(number)
        if (disposed) return
        const { AnnotationMode } = await loadRenderer()
        if (disposed) return
        const size = sheet.getViewport({ scale: 1 })
        const viewport = sheet.getViewport({
          scale: (original.width / size.width) * scale * density,
        })
        task = sheet.render({
          canvas: raster,
          viewport,
          annotationMode: AnnotationMode.DISABLE,
          transform: [1, 0, 0, 1, width / 2 - at.x * viewport.width, height / 2 - at.y * viewport.height],
        })
        await task.promise
        if (!disposed && at === position) context.drawImage(raster, 0, 0)
      } catch {
        releasePage()
        /* Keep the displayed image if the optional detail render fails. */
      } finally {
        task = undefined
        running = false
        if (disposed) {
          releasePage()
          raster.width = raster.height = 0
        } else if (at !== position) frame = requestAnimationFrame(() => void draw())
        else refining = false
      }
    }
    $effect(() => {
      position = point
      if (!position) return
      context.fillStyle = "#ffffff"
      context.fillRect(0, 0, width, height)
      context.drawImage(
        image,
        position.x * image.width - areaWidth / 2,
        position.y * image.height - areaHeight / 2,
        areaWidth,
        areaHeight,
        0,
        0,
        width,
        height,
      )
      refining = true
      // Finish active PDF work, then refine the latest position without a settling delay.
      if (!running && frame === undefined) frame = requestAnimationFrame(() => void draw())
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame ?? 0)
      task?.cancel()
      if (!running) {
        releasePage()
        raster.width = raster.height = 0
      }
    }
  }
  function inspect(event: PointerEvent) {
    if (
      event.pointerType !== "mouse" ||
      event.buttons ||
      rendering ||
      !canvas ||
      !pdf ||
      !matchMedia("(hover: hover) and (pointer: fine)").matches
    )
      return
    if (point) return show(event.clientX, event.clientY)
    clearTimeout(opening)
    opening = setTimeout(() => {
      opening = undefined
      show(event.clientX, event.clientY)
    }, 180)
  }
  function show(x: number, y: number, touch = false) {
    if (!canvas || !pdf || rendering) return
    const bounds = canvas.getBoundingClientRect(),
      width = Math.min(320, innerWidth - 24)
    point = {
      x: Math.max(0, Math.min(1, (x - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (y - bounds.top) / bounds.height)),
      left: touch
        ? Math.max(12, Math.min(x - width / 2, innerWidth - width - 12))
        : bounds.right + width + 28 <= innerWidth
          ? bounds.right + 16
          : Math.max(12, bounds.left - width - 16),
      top: Math.max(
        12,
        Math.min(touch ? (y - width - 32 >= 12 ? y - width - 32 : y + 32) : bounds.top, innerHeight - width - 12),
      ),
    }
  }
</script>

<svelte:window
  onpointerdown={(event) => {
    if (finger && !event.isPrimary) dismiss()
  }}
  onblur={dismiss}
  onkeydown={(event) => {
    if (event.key === "Escape" && (point || opening !== undefined)) dismiss()
  }}
  onresize={dismiss}
/>
<span hidden {@attach observe}></span>

{#if point}
  <div
    class="lens"
    role="region"
    aria-label={`Magnified page ${page} at ${magnification}×`}
    aria-busy={refining}
    style:inset-inline-start={`${point.left}px`}
    style:inset-block-start={`${point.top}px`}
    {@attach float}
  >
    <canvas {@attach refine} width="0" height="0"></canvas>
  </div>
{/if}
