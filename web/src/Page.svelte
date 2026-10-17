<!-- Displays the inspected page and preserves viewport position and panning. -->
<script module lang="ts">
  export const zoomLevels = [50, 100, 150, 200, 300, 400]
</script>

<script lang="ts">
  import { onDestroy, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import type { PDFDocumentProxy } from "pdfjs-dist"
  import type { Size } from "./model.ts"
  import Icon from "./Icon.svelte"
  import Pdf from "./Pdf.svelte"
  export type Inspection = {
    size: Size
    page?: number
    pdf?: PDFDocumentProxy
    original?: PDFDocumentProxy
    originalPage?: number
    padding?: boolean
    comparable?: boolean
  }
  export type Region = { x: number; y: number }
  let {
    pane = "Output",
    compact = false,
    count,
    sheet,
    position = $bindable(0),
    comparing = $bindable(false),
    zoom = $bindable(100),
    error,
    magnification = 16,
    heading,
    headingHeight = $bindable(0),
    actions,
    add,
    grid,
    selected = false,
    region = $bindable({ x: 0, y: 0 }),
    alignment,
    navigationOver,
    navigationLeave,
  }: {
    pane?: "Input" | "Output"
    compact?: boolean
    count: number
    sheet?: Inspection
    position?: number
    comparing?: boolean
    zoom?: number
    error: (message: string) => void
    magnification?: 8 | 16 | 32
    heading?: Snippet
    headingHeight?: number
    actions?: Snippet
    add?: () => boolean | undefined
    grid: (event: MouseEvent | KeyboardEvent) => void
    selected?: boolean
    region?: Region
    alignment?: Region
    navigationOver?: (event: DragEvent, offset: number) => void
    navigationLeave?: () => void
  } = $props()
  const index = $derived(Math.min(position, Math.max(0, count - 1)))
  const canCompare = $derived(!!sheet?.comparable)
  const original = $derived(comparing && canCompare)
  const document = $derived(original ? sheet?.original : sheet?.pdf)
  const level = $derived(zoom)
  let panning = $state(false)
  let thumbnailWidth = $state(0)
  let headingFrame: number
  let copyFlash: Animation | undefined
  let pinchAnchor: { x: number; y: number; clientX: number; clientY: number; width: number; zoom: number } | undefined
  function measureHeading(height: number) {
    cancelAnimationFrame(headingFrame)
    headingFrame = requestAnimationFrame(() => (headingHeight = height))
  }
  onDestroy(() => {
    cancelAnimationFrame(headingFrame)
    copyFlash?.cancel()
  })
  function measureThumbnail(element: HTMLSpanElement) {
    const dense = compact
    let frame: number
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        // Match the thumbnail's border and horizontal image inset.
        thumbnailWidth = Math.max(0, element.clientWidth - (dense ? 17 : 6))
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }
  function scrollViewport(element: HTMLDivElement) {
    let offset = alignment ?? untrack(() => region)
    let frame: number
    const image = element.querySelector<HTMLElement>("canvas, .blank-sheet")
    let pinch:
      | {
          distance: number
          zoom: number
          next: number
          x: number
          y: number
          clientX: number
          clientY: number
          width: number
        }
      | undefined
    function restore() {
      if (pinch || !element.clientWidth || element.querySelector("canvas")?.clientWidth === 0) return
      if (pinchAnchor && image) {
        if (Math.abs(image.offsetWidth - (pinchAnchor.width * level) / pinchAnchor.zoom) > 2) return
        image.style.removeProperty("transform")
        image.style.removeProperty("transform-origin")
        const bounds = image.getBoundingClientRect()
        element.scrollLeft += bounds.left + pinchAnchor.x * bounds.width - pinchAnchor.clientX
        element.scrollTop += bounds.top + pinchAnchor.y * bounds.height - pinchAnchor.clientY
        const anchored = image.getBoundingClientRect()
        window.scrollBy({
          top: anchored.top + pinchAnchor.y * anchored.height - pinchAnchor.clientY,
          behavior: "instant",
        })
        pinchAnchor = undefined
        remember()
      } else {
        element.scrollLeft = offset.x * Math.max(0, element.scrollWidth - element.clientWidth)
        element.scrollTop = offset.y * Math.max(0, element.scrollHeight - element.clientHeight)
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (image?.clientWidth)
          element.parentElement!.style.setProperty(
            "--fit-width",
            `${(image.getBoundingClientRect().width * 100) / level}px`,
          )
      })
    }
    const observer = new ResizeObserver(() => {
      if (pinchAnchor) {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(restore)
      } else restore()
    })
    observer.observe(element)
    if (sheet && element.firstElementChild) observer.observe(element.firstElementChild)
    if (image) observer.observe(image)
    function remember() {
      if (pinch || pinchAnchor || !element.clientWidth || element.querySelector("canvas")?.width === 0) return
      region = offset = {
        x: element.scrollLeft / Math.max(1, element.scrollWidth - element.clientWidth),
        y: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
      }
    }
    function begin(event: TouchEvent) {
      if (event.touches.length > 2) return cancel()
      if (event.touches.length !== 2 || !image || pinchAnchor) return
      const [first, second] = event.touches
      const bounds = image.getBoundingClientRect()
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
      if (!bounds.width || !distance) return
      if (event.cancelable) event.preventDefault()
      const clientX = (first.clientX + second.clientX) / 2,
        clientY = (first.clientY + second.clientY) / 2
      pinch = {
        distance,
        zoom,
        next: zoom,
        x: (clientX - bounds.left) / bounds.width,
        y: (clientY - bounds.top) / bounds.height,
        clientX,
        clientY,
        width: bounds.width,
      }
      image.style.transformOrigin = `${pinch.x * 100}% ${pinch.y * 100}%`
    }
    function move(event: TouchEvent) {
      if (!pinch || !image) return
      if (event.touches.length !== 2) return cancel()
      if (event.cancelable) event.preventDefault()
      const [first, second] = event.touches
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
      pinch.next = Math.max(
        zoomLevels[0],
        Math.min(zoomLevels.at(-1)!, Math.round((pinch.zoom * distance) / pinch.distance)),
      )
      const clientX = (first.clientX + second.clientX) / 2,
        clientY = (first.clientY + second.clientY) / 2
      image.style.transform = `translate(${clientX - pinch.clientX}px, ${clientY - pinch.clientY}px) scale(${pinch.next / pinch.zoom})`
    }
    function finish(event: TouchEvent) {
      if (!pinch || event.touches.length >= 2) return
      if (event.cancelable) event.preventDefault()
      const next = pinch.next
      const bounds = image!.getBoundingClientRect()
      pinchAnchor = {
        x: pinch.x,
        y: pinch.y,
        clientX: bounds.left + bounds.width * pinch.x,
        clientY: bounds.top + bounds.height * pinch.y,
        width: pinch.width,
        zoom: pinch.zoom,
      }
      pinch = undefined
      zoom = next
      restore()
    }
    function cancel() {
      if (!pinch) return
      pinch = undefined
      image?.style.removeProperty("transform")
      image?.style.removeProperty("transform-origin")
      restore()
    }
    element.addEventListener("scroll", remember)
    element.addEventListener("touchstart", begin, { passive: false })
    element.addEventListener("touchmove", move, { passive: false })
    element.addEventListener("touchend", finish, { passive: false })
    element.addEventListener("touchcancel", cancel)
    window.addEventListener("blur", cancel)
    return () => {
      element.removeEventListener("scroll", remember)
      element.removeEventListener("touchstart", begin)
      element.removeEventListener("touchmove", move)
      element.removeEventListener("touchend", finish)
      element.removeEventListener("touchcancel", cancel)
      window.removeEventListener("blur", cancel)
      cancel()
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }
  function panViewport(element: HTMLDivElement) {
    if (level <= 100) return
    let stop: (() => void) | undefined
    function pan(event: PointerEvent) {
      if (event.pointerType !== "mouse" || event.button !== 0) return
      if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return
      stop?.()
      const startX = event.clientX,
        startY = event.clientY,
        left = element.scrollLeft,
        top = element.scrollTop
      element.setPointerCapture(event.pointerId)
      panning = true
      const move = (next: PointerEvent) => {
        if (next.pointerId !== event.pointerId) return
        if (!element.hasPointerCapture(event.pointerId)) {
          finish()
          return
        }
        element.scrollLeft = left + startX - next.clientX
        element.scrollTop = top + startY - next.clientY
      }
      const finish = () => {
        element.removeEventListener("pointermove", move)
        element.removeEventListener("pointerup", finish)
        element.removeEventListener("pointercancel", finish)
        element.removeEventListener("lostpointercapture", finish)
        if (element.hasPointerCapture(event.pointerId)) element.releasePointerCapture(event.pointerId)
        panning = false
        stop = undefined
      }
      stop = finish
      element.addEventListener("pointermove", move)
      element.addEventListener("pointerup", finish)
      element.addEventListener("pointercancel", finish)
      element.addEventListener("lostpointercapture", finish)
    }
    element.addEventListener("pointerdown", pan)
    return () => {
      stop?.()
      element.removeEventListener("pointerdown", pan)
    }
  }
  function interact(element: HTMLElement) {
    const viewport = element.querySelector<HTMLDivElement>(".page-scroll")!
    viewport.addEventListener("click", pageClick)
    viewport.addEventListener("dblclick", pageClick)
    return () => {
      viewport.removeEventListener("click", pageClick)
      viewport.removeEventListener("dblclick", pageClick)
    }
  }
  function pageClick(event: MouseEvent) {
    const modified = event.ctrlKey || event.metaKey
    if ((event.type === "click" && !modified) || (event.type === "dblclick" && modified)) return
    const viewport = event.currentTarget as HTMLDivElement
    // Panning captures pointer clicks on the viewport rather than the page.
    const image = viewport.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest("canvas, .blank-sheet")
    if (!image || !viewport.contains(image)) return
    if (modified) grid(event)
    else {
      viewport.focus({ preventScroll: true })
      if (add?.() && matchMedia("(prefers-reduced-motion: no-preference)").matches) {
        copyFlash?.cancel()
        copyFlash = image.animate(
          [
            { filter: "brightness(1.12)", boxShadow: "0 0 20px var(--accent)" },
            { filter: "none", boxShadow: getComputedStyle(image).boxShadow },
          ],
          { duration: 700, easing: "ease-out" },
        )
      }
    }
  }
</script>

<section
  class={["page-view", { selected }]}
  data-face={index % 2 === 0 ? "front" : "back"}
  aria-label={`${pane} Page view`}
  {@attach interact}
>
  <div class="page-reference" aria-hidden="true"><span {@attach measureThumbnail}></span></div>
  {#if heading}<div
      class="page-label inspection-heading"
      bind:clientHeight={null, measureHeading}
      title={index % 2 === 0 ? "Front side" : "Back side"}
    >
      {@render heading()}
    </div>{/if}
  <!-- Keyboard users need a focusable viewport for scrolling and page shortcuts. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class={["page-scroll", { enlarged: level > 100, panning }]}
    role="region"
    aria-label="PDF viewport"
    aria-keyshortcuts={sheet
      ? `ArrowLeft ArrowRight ArrowUp ArrowDown N P PageUp PageDown Home End G V Control+A Meta+A Escape${add ? " Space" : ""} Plus = - 0 Z`
      : "V Control+A Meta+A Escape"}
    tabindex="0"
    style:--zoom={level / 100}
    {@attach scrollViewport}
    {@attach panViewport}
  >
    {#if sheet && document && sheet.page !== undefined}<Pdf
        pdf={document}
        page={original ? (sheet.originalPage ?? sheet.page) : sheet.page}
        pageNumber={(sheet.originalPage ?? sheet.page) + 1}
        {zoom}
        {compact}
        {thumbnailWidth}
        {magnification}
        {error}
      />
    {:else if sheet}<div class="pdf-viewport" style:--ratio={sheet.size.width / sheet.size.height}>
        <div class="blank-sheet" style:--ratio={sheet.size.width / sheet.size.height}>
          <Icon name="blank" /><span>{sheet.padding ? "Padding" : "Blank"}</span>
        </div>
      </div>
    {:else}<div class="empty">
        <Icon name="output" />
        <h3>Your Output starts here.</h3>
        <p>Add selected pages to Output.</p>
      </div>{/if}
  </div>
  {#if sheet}
    <nav class="page-navigation" aria-label={`${pane} page navigation`}>
      <button
        class="icon-button"
        data-step="-1"
        aria-label={`Previous ${pane} page`}
        title={`Previous ${pane} page`}
        disabled={index === 0}
        onclick={() => (position = index - 1)}
        ondragover={(event) => navigationOver?.(event, -1)}
        ondragleave={navigationLeave}><Icon name="previous" /></button
      >
      <div class="page-actions">
        {#if actions}{@render actions()}{/if}
      </div>
      <button
        class="icon-button"
        data-step="1"
        aria-label={`Next ${pane} page`}
        title={`Next ${pane} page`}
        disabled={index === count - 1}
        onclick={() => (position = index + 1)}
        ondragover={(event) => navigationOver?.(event, 1)}
        ondragleave={navigationLeave}><Icon name="next" /></button
      >
    </nav>
  {/if}
</section>
