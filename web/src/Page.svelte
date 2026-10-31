<!-- Displays inspected pages and owns navigation, zoom gestures, panning, and viewport focus. -->

<script module lang="ts">
  export const zoomLevels = [50, 100, 150, 200, 300, 400, 800, 1600, 3200]
  export type Controls = "all" | "zoom" | "fit" | "menu"
  export const controlCapabilities = {
    all: { comparison: true, zoom: true, fit: true },
    zoom: { comparison: false, zoom: true, fit: true },
    fit: { comparison: false, zoom: false, fit: true },
    menu: { comparison: false, zoom: false, fit: false },
  } as const
</script>

<script lang="ts">
  import { onDestroy, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import type { PDFDocumentProxy } from "pdfjs-dist"
  import type { Size } from "./model.ts"
  import type { Magnification } from "./Lens.svelte"
  import Icon from "./Icon.svelte"
  import Pdf from "./Pdf.svelte"
  import { fit } from "./fit.ts"
  export type Inspection = { size: Size } & (
    | { kind: "blank"; padding: boolean }
    | {
        kind: "pdf"
        pdf: PDFDocumentProxy
        page: number
        comparison?: { pdf: PDFDocumentProxy; page: number; enabled: boolean }
      }
  )
  export type Region = { x: number; y: number }
  let {
    pane = "Output",
    count,
    sheet,
    position = $bindable(0),
    comparing = $bindable(false),
    zoom = $bindable(100),
    error,
    magnification = 16,
    heading,
    headingHeight = $bindable(0),
    controls = $bindable<Controls>("all"),
    initialize,
    actions,
    copyable = true,
    grid,
    selected = false,
    region = $bindable({ x: 0, y: 0 }),
    alignment,
    navigationOver,
    navigationLeave,
  }: {
    pane?: "Input" | "Output"
    count: number
    sheet?: Inspection
    position?: number
    comparing?: boolean
    zoom?: number
    error: (message: string) => void
    magnification?: Magnification
    heading?: Snippet<[() => void]>
    headingHeight?: number
    controls?: Controls
    initialize?: (zoom: number) => void
    actions?: Snippet
    copyable?: boolean
    grid: (event: MouseEvent | KeyboardEvent) => void
    selected?: boolean
    region?: Region
    alignment?: Region
    navigationOver?: (event: DragEvent, offset: number) => void
    navigationLeave?: () => void
  } = $props()
  const index = $derived(Math.min(position, Math.max(0, count - 1)))
  const comparison = $derived(sheet?.kind === "pdf" ? sheet.comparison : undefined)
  const original = $derived(comparing && !!comparison?.enabled)
  const document = $derived(sheet?.kind === "pdf" ? (original ? comparison!.pdf : sheet.pdf) : undefined)
  const physicalPage = $derived(sheet?.kind === "pdf" ? (comparison?.page ?? sheet.page) : undefined)
  const renderedPage = $derived(sheet?.kind === "pdf" ? (original ? comparison!.page : sheet.page) : undefined)
  const level = $derived(zoom)
  let panning = $state(false)
  let thumbnailWidth = $state(0)
  let headingFrame: number
  let tap: { image: Element; sheet?: Inspection; index: number; time: number } | undefined
  type Gesture =
    | { kind: "idle" }
    | { kind: "swipe"; id: number; x: number; y: number; allowed: boolean; horizontal: boolean }
    | {
        kind: "pinch"
        distance: number
        zoom: number
        next: number
        x: number
        y: number
        clientX: number
        clientY: number
      }
    | {
        kind: "settling"
        x: number
        y: number
        clientX: number
        clientY: number
        pdf?: PDFDocumentProxy
        page?: number
        index: number
      }
  let gesture: Gesture = { kind: "idle" }
  let cancelZoom: (() => void) | undefined
  let imageViewport: HTMLDivElement
  function fitting(element: HTMLDivElement) {
    const image = element.querySelector<HTMLElement>("canvas, .blank-sheet")
    if (!image?.clientWidth || !element.firstElementChild) return
    const gutter = parseFloat(getComputedStyle(element.firstElementChild).paddingBlockStart)
    const available = Math.max(1, element.clientWidth - 2 * gutter)
    const width = (parseFloat(getComputedStyle(image).inlineSize) * 100) / level
    return {
      width,
      zoom: Math.min(zoomLevels.at(-1)!, Math.max(zoomLevels[0], Math.floor((100 * available) / width))),
    }
  }
  export function fitWidth() {
    cancelZoom?.()
    const fitted = fitting(imageViewport)
    if (fitted) zoom = fitted.zoom
  }
  function navigate(offset: number) {
    tap = undefined
    position = Math.max(0, Math.min(count - 1, index + offset))
  }
  function measureHeading(height: number) {
    cancelAnimationFrame(headingFrame)
    headingFrame = requestAnimationFrame(() => (headingHeight = height))
  }
  function fitControls(element: HTMLDivElement) {
    let frame: number
    let counter: HTMLElement | null = null
    const tools = element.querySelector<HTMLElement>(".page-tools")
    const group = tools?.querySelector<HTMLElement>(".page-zoom")
    const grip = element.querySelector<HTMLElement>(".page-grip")
    function schedule() {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const current = element.querySelector<HTMLElement>(".page-number-control")
        if (current !== counter) {
          if (counter) observer.unobserve(counter)
          counter = current
          if (counter) observer.observe(counter)
        }
        if (!element.clientWidth || !counter || !tools || !group) return
        const style = getComputedStyle(element)
        const width = element.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd)
        const gripWidth = grip?.getBoundingClientRect().width ?? 0
        const label = element.querySelector<HTMLElement>(".page-number > .page-context")
        const counterWidth = counter.getBoundingClientRect().width
        const numberWidth =
          counterWidth +
          (label
            ? Math.min(label.scrollWidth, parseFloat(getComputedStyle(label).maxInlineSize)) +
              parseFloat(getComputedStyle(label.parentElement!).columnGap)
            : 0)
        const leading = Math.max(numberWidth, gripWidth ? (width - gripWidth) / 2 : 0)
        const available = width - leading - gripWidth
        const zoomStyle = getComputedStyle(group)
        const cell = parseFloat(zoomStyle.gridAutoColumns)
        const zoomWidth = cell * Number(zoomStyle.getPropertyValue("--zoom-items"))
        const comparisonWidth = [...tools.children]
          .filter((child) => child.matches(".tool"))
          .reduce((sum, child) => sum + child.getBoundingClientRect().width, 0)
        controls =
          zoomWidth + comparisonWidth <= available + 1
            ? "all"
            : zoomWidth <= available + 1
              ? "zoom"
              : cell <= available + 1
                ? "fit"
                : "menu"
      })
    }
    const observer = new ResizeObserver(schedule)
    const content = new MutationObserver(schedule)
    content.observe(element, { childList: true, characterData: true, subtree: true })
    for (const target of [element, group]) if (target) observer.observe(target)
    return () => {
      observer.disconnect()
      content.disconnect()
      cancelAnimationFrame(frame)
    }
  }
  onDestroy(() => {
    cancelZoom?.()
    cancelAnimationFrame(headingFrame)
  })
  function measureThumbnail(element: HTMLSpanElement) {
    const ratio = sheet ? sheet.size.width / sheet.size.height : 1
    let frame: number
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        fit(element.parentElement!)
        const bounds = element.getBoundingClientRect()
        const style = getComputedStyle(element)
        const width = bounds.width - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd)
        const height = bounds.height - parseFloat(style.paddingBlockStart) - parseFloat(style.paddingBlockEnd)
        thumbnailWidth = Math.max(0, Math.min(width, height * ratio))
      })
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    observer.observe(element.closest(".page-content")!)
    window.addEventListener("resize", schedule)
    return () => {
      window.removeEventListener("resize", schedule)
      observer.disconnect()
      cancelAnimationFrame(frame)
    }
  }
  function scrollViewport(element: HTMLDivElement) {
    imageViewport = element
    const initializeZoom = initialize
    const inspected = index
    const pdf = document
    const page = renderedPage
    let offset = alignment ?? untrack(() => region)
    let frame: number
    const image = element.querySelector<HTMLElement>(document ? "canvas" : ".blank-sheet")
    const dimensions = () => [element.clientWidth, element.clientHeight, image?.clientWidth, image?.clientHeight]
    let extent = dimensions()
    function restore(): void {
      if (!element.clientWidth || !element.firstElementChild) return cancel()
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        if (
          gesture.kind === "pinch" ||
          gesture.kind === "settling" ||
          !image?.clientWidth ||
          !element.firstElementChild
        )
          return
        if (initializeZoom && sheet) {
          const fitted = fitting(element)
          const touch = getComputedStyle(element).getPropertyValue("--page-touch").trim() === "1"
          if (fitted) initializeZoom(fitted.width < 0.7 * element.clientWidth ? fitted.zoom : level)
          if (touch && !element.ownerDocument.activeElement?.matches(":focus-visible"))
            element.parentElement!.scrollIntoView({ block: "start", behavior: "instant" })
        }
      })
      if (gesture.kind === "pinch" || element.querySelector("canvas")?.clientWidth === 0) return
      const anchoring = gesture.kind === "settling" && !!image
      if (gesture.kind === "settling" && image) {
        image.style.removeProperty("transform")
        image.style.removeProperty("transform-origin")
        const bounds = image.getBoundingClientRect()
        element.scrollLeft += bounds.left + gesture.x * bounds.width - gesture.clientX
        element.scrollTop += bounds.top + gesture.y * bounds.height - gesture.clientY
        const anchored = image.getBoundingClientRect()
        window.scrollBy({
          top: anchored.top + gesture.y * anchored.height - gesture.clientY,
          behavior: "instant",
        })
        gesture = { kind: "idle" }
      } else {
        element.scrollLeft = offset.x * Math.max(0, element.scrollWidth - element.clientWidth)
        element.scrollTop = offset.y * Math.max(0, element.scrollHeight - element.clientHeight)
      }
      extent = dimensions()
      if (anchoring) remember()
    }
    const observer = new ResizeObserver(() => {
      if (!element.clientWidth) cancel()
      else if (gesture.kind === "settling") {
        cancelAnimationFrame(frame)
        frame = requestAnimationFrame(restore)
      } else restore()
    })
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    if (image) observer.observe(image)
    function remember() {
      if (
        gesture.kind === "pinch" ||
        gesture.kind === "settling" ||
        !element.clientWidth ||
        element.querySelector("canvas")?.width === 0
      )
        return
      // Ignore native scroll anchoring until the resized image has been restored.
      if (dimensions().some((value, axis) => value !== extent[axis])) return
      region = offset = {
        x: element.scrollLeft / Math.max(1, element.scrollWidth - element.clientWidth),
        y: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
      }
    }
    function begin(event: TouchEvent) {
      if (index !== inspected) return cancel()
      if (event.touches.length === 1 && gesture.kind !== "pinch" && gesture.kind !== "settling" && image?.clientWidth) {
        const finger = event.touches[0]
        gesture = {
          kind: "swipe",
          id: finger.identifier,
          x: finger.clientX,
          y: finger.clientY,
          allowed: element.scrollWidth - element.clientWidth <= 1 && count > 1,
          horizontal: false,
        }
        return
      }
      tap = undefined
      if (event.touches.length > 2) return cancel()
      if (event.touches.length !== 2 || !image || gesture.kind === "settling") return
      const [first, second] = event.touches
      const bounds = image.getBoundingClientRect()
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
      if (!bounds.width || !distance) return
      if (event.cancelable) event.preventDefault()
      const clientX = (first.clientX + second.clientX) / 2,
        clientY = (first.clientY + second.clientY) / 2
      gesture = {
        kind: "pinch",
        distance,
        zoom,
        next: zoom,
        x: (clientX - bounds.left) / bounds.width,
        y: (clientY - bounds.top) / bounds.height,
        clientX,
        clientY,
      }
      image.style.transformOrigin = `${gesture.x * 100}% ${gesture.y * 100}%`
    }
    function move(event: TouchEvent) {
      const active = gesture
      if (active.kind === "swipe") {
        const finger = Array.from(event.touches).find((touch) => touch.identifier === active.id)
        if (event.defaultPrevented || event.touches.length !== 1 || !finger) {
          gesture = { kind: "idle" }
          tap = undefined
          return
        }
        const x = Math.abs(finger.clientX - active.x),
          y = Math.abs(finger.clientY - active.y)
        if (Math.hypot(x, y) < 8) return
        tap = undefined
        if (!active.allowed || (!active.horizontal && x < 1.5 * y)) {
          gesture = { kind: "idle" }
          return
        }
        active.horizontal = true
        if (event.cancelable) event.preventDefault()
        return
      }
      if (active.kind !== "pinch" || !image) return
      if (event.touches.length !== 2) return cancel()
      if (event.cancelable) event.preventDefault()
      const [first, second] = event.touches
      const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
      active.next = Math.max(
        zoomLevels[0],
        Math.min(zoomLevels.at(-1)!, Math.round((active.zoom * distance) / active.distance)),
      )
      const clientX = (first.clientX + second.clientX) / 2,
        clientY = (first.clientY + second.clientY) / 2
      image.style.transform = `translate(${clientX - active.clientX}px, ${clientY - active.clientY}px) scale(${active.next / active.zoom})`
    }
    function finish(event: TouchEvent) {
      const active = gesture
      if (active.kind === "swipe") {
        gesture = { kind: "idle" }
        if (!active.horizontal || event.touches.length || event.defaultPrevented) return
        const finger = Array.from(event.changedTouches).find((touch) => touch.identifier === active.id)
        if (event.cancelable) event.preventDefault()
        if (finger && index === inspected) {
          const x = finger.clientX - active.x,
            y = finger.clientY - active.y
          if (Math.abs(x) >= 48 && Math.abs(x) >= 1.5 * Math.abs(y)) navigate(x < 0 ? 1 : -1)
        }
        return
      }
      if (active.kind !== "pinch" || event.touches.length >= 2) return
      if (event.cancelable) event.preventDefault()
      const bounds = image!.getBoundingClientRect()
      gesture = {
        kind: "settling",
        x: active.x,
        y: active.y,
        clientX: bounds.left + bounds.width * active.x,
        clientY: bounds.top + bounds.height * active.y,
        pdf,
        page,
        index: inspected,
      }
      zoom = active.next
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(restore)
    }
    function cancel() {
      tap = undefined
      const transforming = gesture.kind === "pinch" || gesture.kind === "settling"
      gesture = { kind: "idle" }
      image?.style.removeProperty("transform")
      image?.style.removeProperty("transform-origin")
      if (transforming) restore()
    }
    element.addEventListener("scroll", remember)
    element.addEventListener("touchstart", begin, { passive: false })
    element.addEventListener("touchmove", move, { passive: false })
    element.addEventListener("touchend", finish, { passive: false })
    element.addEventListener("touchcancel", cancel)
    window.addEventListener("blur", cancel)
    window.addEventListener("resize", cancel)
    element.ownerDocument.addEventListener("visibilitychange", cancel)
    if (gesture.kind === "settling" && (gesture.pdf !== pdf || gesture.page !== page || gesture.index !== inspected))
      cancel()
    cancelZoom = cancel
    return () => {
      element.removeEventListener("scroll", remember)
      element.removeEventListener("touchstart", begin)
      element.removeEventListener("touchmove", move)
      element.removeEventListener("touchend", finish)
      element.removeEventListener("touchcancel", cancel)
      window.removeEventListener("blur", cancel)
      window.removeEventListener("resize", cancel)
      element.ownerDocument.removeEventListener("visibilitychange", cancel)
      if (gesture.kind === "pinch" || gesture.kind === "swipe") cancel()
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
    let touch = false
    function focusTools(event: MouseEvent) {
      if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".page-tools button"))
        return
      // Pointer zoom keeps subsequent Page keys on the document; keyboard activation keeps native button focus.
      event.preventDefault()
      viewport.focus({ preventScroll: true })
    }
    function pointer(event: PointerEvent) {
      touch = event.pointerType === "touch" || event.pointerType === "pen"
      if (!touch) tap = undefined
    }
    function pageClick(event: MouseEvent) {
      const modified = event.ctrlKey || event.metaKey
      if ((event.type === "click" && !modified && !touch) || (event.type === "dblclick" && (modified || touch))) return
      // Panning captures pointer clicks on the viewport rather than the page.
      const image = viewport.ownerDocument
        .elementFromPoint(event.clientX, event.clientY)
        ?.closest("canvas, .blank-sheet")
      if (!image || !viewport.contains(image)) {
        tap = undefined
        return
      }
      if (touch && !modified) {
        const now = performance.now()
        const twice = tap?.image === image && tap.sheet === sheet && tap.index === index && now - tap.time < 350
        tap = twice ? undefined : { image, sheet, index, time: now }
        if (!twice) return
      }
      if (modified) grid(event)
      else {
        viewport.focus({ preventScroll: true })
        if (gesture.kind === "settling") return
        if (zoom > 100) zoom = 100
        else {
          const bounds = image.getBoundingClientRect()
          if (!bounds.width || !bounds.height) return
          gesture = {
            kind: "settling",
            x: (event.clientX - bounds.left) / bounds.width,
            y: (event.clientY - bounds.top) / bounds.height,
            clientX: event.clientX,
            clientY: event.clientY,
            pdf: document,
            page: renderedPage,
            index,
          }
          zoom = 200
        }
      }
    }
    element.addEventListener("mousedown", focusTools)
    viewport.addEventListener("pointerdown", pointer)
    viewport.addEventListener("click", pageClick)
    viewport.addEventListener("dblclick", pageClick)
    return () => {
      element.removeEventListener("mousedown", focusTools)
      viewport.removeEventListener("pointerdown", pointer)
      viewport.removeEventListener("click", pageClick)
      viewport.removeEventListener("dblclick", pageClick)
    }
  }
</script>

<section
  class={["page-view", { selected }]}
  style:--ratio={sheet ? sheet.size.width / sheet.size.height : undefined}
  data-controls={controls}
  data-face={index % 2 === 0 ? "front" : "back"}
  aria-label={`${pane} Page view`}
  {@attach interact}
>
  <div class="page-reference" aria-hidden="true"><span {@attach measureThumbnail}></span></div>
  {#if heading}<div
      class="page-label inspection-heading"
      bind:clientHeight={null, measureHeading}
      {@attach fitControls}
      title={index % 2 === 0 ? "Front side" : "Back side"}
    >
      {@render heading(fitWidth)}
    </div>{/if}
  <!-- Keyboard users need a focusable viewport for scrolling and page shortcuts. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class={["page-scroll", { enlarged: level > 100, panning }]}
    role="region"
    aria-label="PDF viewport"
    aria-keyshortcuts={sheet
      ? `ArrowLeft ArrowRight ArrowUp ArrowDown N P PageUp PageDown Home End G V Control+A Meta+A Escape${copyable ? " Space" : ""} Plus = - 0 Z`
      : "V Control+A Meta+A Escape"}
    tabindex="0"
    style:--zoom={level / 100}
    {@attach scrollViewport}
    {@attach panViewport}
  >
    {#if sheet?.kind === "pdf" && document}<Pdf
        pdf={document}
        page={renderedPage!}
        pageNumber={physicalPage! + 1}
        {zoom}
        {thumbnailWidth}
        {magnification}
        {error}
      />
    {:else if sheet?.kind === "blank"}<div class="pdf-viewport" style:--ratio={sheet.size.width / sheet.size.height}>
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
        onclick={() => navigate(-1)}
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
        onclick={() => navigate(1)}
        ondragover={(event) => navigationOver?.(event, 1)}
        ondragleave={navigationLeave}><Icon name="next" /></button
      >
    </nav>
  {/if}
</section>
