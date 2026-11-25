// Owns imperative Page viewport gestures, zoom fitting, panning, and header control layout.

import { flushSync, untrack } from "svelte"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { fit } from "./fit.ts"
import type { Controls, Inspection, Region } from "./Page.svelte"

export const zoomLevels = [50, 100, 150, 200, 300, 400, 800, 1600, 3200]

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

type Tap = { image: Element; sheet?: Inspection; index: number; time: number }

export type ViewportState = {
  gesture: Gesture
  tap?: Tap
  cancelZoom?: () => void
  imageViewport?: HTMLDivElement
}

export function fitting(element: HTMLDivElement, level: number) {
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

export function fitControls(element: HTMLDivElement, onControls: (next: Controls) => void) {
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
      const numberWidth = counter.getBoundingClientRect().width
      const leading = Math.max(numberWidth, gripWidth ? (width - gripWidth) / 2 : 0)
      const available = width - leading - gripWidth
      const zoomStyle = getComputedStyle(group)
      const cell = parseFloat(zoomStyle.gridAutoColumns)
      const zoomWidth = cell * Number(zoomStyle.getPropertyValue("--zoom-items"))
      const comparisonWidth = [...tools.children]
        .filter((child) => child.matches(".tool"))
        .reduce(
          (sum, child) =>
            sum + child.getBoundingClientRect().width + parseFloat(getComputedStyle(child).marginInlineEnd),
          0,
        )
      onControls(
        zoomWidth + comparisonWidth <= available + 1
          ? "all"
          : zoomWidth <= available + 1
            ? "zoom"
            : cell <= available + 1
              ? "fit"
              : "menu",
      )
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

export function measureThumbnail(element: HTMLSpanElement, ratio: number, onWidth: (width: number) => void) {
  let frame: number
  const schedule = () => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      fit(element.parentElement!)
      const bounds = element.getBoundingClientRect()
      const style = getComputedStyle(element)
      const width = bounds.width - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd)
      const height = bounds.height - parseFloat(style.paddingBlockStart) - parseFloat(style.paddingBlockEnd)
      onWidth(Math.max(0, Math.min(width, height * ratio)))
    })
  }
  const observer = new ResizeObserver(schedule)
  observer.observe(element)
  const content = element.closest(".page-content")
  if (content) observer.observe(content)
  window.addEventListener("resize", schedule)
  return () => {
    window.removeEventListener("resize", schedule)
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}

type ScrollOptions = {
  state: ViewportState
  initialize?: (zoom: number) => void
  index: number
  kind?: Inspection["kind"]
  pdf?: PDFDocumentProxy
  page?: number
  alignment?: Region
  getIndex: () => number
  getCount: () => number
  getSheet: () => Inspection | undefined
  getZoom: () => number
  setZoom: (zoom: number) => void
  getRegion: () => Region
  setRegion: (region: Region) => void
  navigate: (offset: number) => void
}

export function scrollViewport(element: HTMLDivElement, options: ScrollOptions) {
  const { state, initialize: initializeZoom, index: inspected, kind, pdf, page, alignment } = options
  void kind
  state.imageViewport = element
  let offset = alignment ?? untrack(options.getRegion)
  let frame: number
  let disposed = false
  const image = element.querySelector<HTMLElement>(pdf ? "canvas" : ".blank-sheet")
  const dimensions = () => [element.clientWidth, element.clientHeight, image?.clientWidth, image?.clientHeight]
  let extent = dimensions()
  function restore(): void {
    if (disposed) return
    if (!element.clientWidth || !element.firstElementChild) return cancel()
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      if (
        disposed ||
        state.gesture.kind === "pinch" ||
        state.gesture.kind === "settling" ||
        !image?.clientWidth ||
        !element.firstElementChild
      )
        return
      if (initializeZoom && options.getSheet()) {
        const level = options.getZoom()
        const fitted = fitting(element, level)
        const touch = getComputedStyle(element).getPropertyValue("--page-touch").trim() === "1"
        if (fitted) initializeZoom(fitted.width < 0.7 * element.clientWidth ? fitted.zoom : level)
        if (touch && !element.ownerDocument.activeElement?.matches(":focus-visible"))
          element.parentElement!.scrollIntoView({ block: "start", behavior: "instant" })
      }
    })
    if (state.gesture.kind === "pinch" || element.querySelector("canvas")?.clientWidth === 0) return
    const anchoring = state.gesture.kind === "settling" && !!image
    if (state.gesture.kind === "settling" && image) {
      image.style.removeProperty("transform")
      image.style.removeProperty("transform-origin")
      const bounds = image.getBoundingClientRect()
      element.scrollLeft += bounds.left + state.gesture.x * bounds.width - state.gesture.clientX
      element.scrollTop += bounds.top + state.gesture.y * bounds.height - state.gesture.clientY
      const anchored = image.getBoundingClientRect()
      window.scrollBy({
        top: anchored.top + state.gesture.y * anchored.height - state.gesture.clientY,
        behavior: "instant",
      })
      state.gesture = { kind: "idle" }
    } else {
      element.scrollLeft = offset.x * Math.max(0, element.scrollWidth - element.clientWidth)
      element.scrollTop = offset.y * Math.max(0, element.scrollHeight - element.clientHeight)
    }
    extent = dimensions()
    if (anchoring) remember()
  }
  const observer = new ResizeObserver(() => {
    if (!element.clientWidth) cancel()
    else if (state.gesture.kind === "settling") {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(restore)
    } else restore()
  })
  observer.observe(element)
  if (element.firstElementChild) observer.observe(element.firstElementChild)
  if (image) observer.observe(image)
  function remember() {
    if (
      state.gesture.kind === "pinch" ||
      state.gesture.kind === "settling" ||
      !element.clientWidth ||
      element.querySelector("canvas")?.width === 0
    )
      return
    // Ignore native scroll anchoring until the resized image has been restored.
    if (dimensions().some((value, axis) => value !== extent[axis])) return
    offset = {
      x: element.scrollLeft / Math.max(1, element.scrollWidth - element.clientWidth),
      y: element.scrollTop / Math.max(1, element.scrollHeight - element.clientHeight),
    }
    options.setRegion(offset)
  }
  function begin(event: TouchEvent) {
    if (options.getIndex() !== inspected) return cancel()
    if (
      event.touches.length === 1 &&
      state.gesture.kind !== "pinch" &&
      state.gesture.kind !== "settling" &&
      image?.clientWidth
    ) {
      const finger = event.touches[0]
      state.gesture = {
        kind: "swipe",
        id: finger.identifier,
        x: finger.clientX,
        y: finger.clientY,
        allowed: element.scrollWidth - element.clientWidth <= 1 && options.getCount() > 1,
        horizontal: false,
      }
      return
    }
    state.tap = undefined
    if (event.touches.length > 2) return cancel()
    if (event.touches.length !== 2 || !image || state.gesture.kind === "settling") return
    const [first, second] = event.touches
    const bounds = image.getBoundingClientRect()
    const distance = Math.hypot(second.clientX - first.clientX, second.clientY - first.clientY)
    if (!bounds.width || !bounds.height || !distance) return
    if (event.cancelable) event.preventDefault()
    const clientX = (first.clientX + second.clientX) / 2,
      clientY = (first.clientY + second.clientY) / 2
    const zoom = options.getZoom()
    state.gesture = {
      kind: "pinch",
      distance,
      zoom,
      next: zoom,
      x: (clientX - bounds.left) / bounds.width,
      y: (clientY - bounds.top) / bounds.height,
      clientX,
      clientY,
    }
    image.style.transformOrigin = `${state.gesture.x * 100}% ${state.gesture.y * 100}%`
  }
  function move(event: TouchEvent) {
    const active = state.gesture
    if (active.kind === "swipe") {
      const finger = Array.from(event.touches).find((touch) => touch.identifier === active.id)
      if (event.defaultPrevented || event.touches.length !== 1 || !finger) {
        state.gesture = { kind: "idle" }
        state.tap = undefined
        return
      }
      const x = Math.abs(finger.clientX - active.x),
        y = Math.abs(finger.clientY - active.y)
      if (Math.hypot(x, y) < 10) return
      state.tap = undefined
      if (!active.allowed || (!active.horizontal && x < 1.5 * y)) {
        state.gesture = { kind: "idle" }
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
    const active = state.gesture
    if (active.kind === "swipe") {
      state.gesture = { kind: "idle" }
      if (!active.horizontal || event.touches.length || event.defaultPrevented) return
      const finger = Array.from(event.changedTouches).find((touch) => touch.identifier === active.id)
      if (event.cancelable) event.preventDefault()
      if (finger && options.getIndex() === inspected) {
        const x = finger.clientX - active.x,
          y = finger.clientY - active.y
        if (Math.abs(x) >= 48 && Math.abs(x) >= 1.5 * Math.abs(y)) options.navigate(x < 0 ? 1 : -1)
      }
      return
    }
    if (active.kind !== "pinch" || event.touches.length >= 2) return
    if (event.cancelable) event.preventDefault()
    const bounds = image!.getBoundingClientRect()
    state.gesture = {
      kind: "settling",
      x: active.x,
      y: active.y,
      clientX: bounds.left + bounds.width * active.x,
      clientY: bounds.top + bounds.height * active.y,
      pdf,
      page,
      index: inspected,
    }
    options.setZoom(active.next)
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(restore)
  }
  function cancel() {
    state.tap = undefined
    const transforming = state.gesture.kind === "pinch" || state.gesture.kind === "settling"
    state.gesture = { kind: "idle" }
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
  if (
    state.gesture.kind === "settling" &&
    (state.gesture.pdf !== pdf || state.gesture.page !== page || state.gesture.index !== inspected)
  )
    cancel()
  state.cancelZoom = cancel
  return () => {
    disposed = true
    if (state.imageViewport === element) state.imageViewport = undefined
    queueMicrotask(() => {
      if (state.cancelZoom === cancel) state.cancelZoom = undefined
    })
    element.removeEventListener("scroll", remember)
    element.removeEventListener("touchstart", begin)
    element.removeEventListener("touchmove", move)
    element.removeEventListener("touchend", finish)
    element.removeEventListener("touchcancel", cancel)
    window.removeEventListener("blur", cancel)
    window.removeEventListener("resize", cancel)
    element.ownerDocument.removeEventListener("visibilitychange", cancel)
    if (state.gesture.kind === "pinch" || state.gesture.kind === "swipe") cancel()
    observer.disconnect()
    cancelAnimationFrame(frame)
  }
}

export function panViewport(element: HTMLDivElement, getLevel: () => number, onPanning: (panning: boolean) => void) {
  let stop: (() => void) | undefined
  function pan(event: PointerEvent) {
    if (getLevel() <= 100 || event.pointerType !== "mouse" || event.button !== 0) return
    if (element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight) return
    stop?.()
    const startX = event.clientX,
      startY = event.clientY,
      left = element.scrollLeft,
      top = element.scrollTop
    element.setPointerCapture(event.pointerId)
    onPanning(true)
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
      onPanning(false)
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

type InteractOptions = {
  state: ViewportState
  getSheet: () => Inspection | undefined
  getIndex: () => number
  getZoom: () => number
  setZoom: (zoom: number) => void
  getDocument: () => PDFDocumentProxy | undefined
  getRenderedPage: () => number | undefined
  grid: (event: MouseEvent | KeyboardEvent) => void
}

export function interactViewport(element: HTMLElement, options: InteractOptions) {
  const { state } = options
  const viewport = element.querySelector<HTMLDivElement>(".page-scroll")!
  let touch = false
  function focusTools(event: MouseEvent) {
    if (event.button !== 0 || !(event.target instanceof Element) || !event.target.closest(".page-tools button")) return
    // Pointer zoom keeps subsequent Page keys on the document; keyboard activation keeps native button focus.
    event.preventDefault()
    viewport.focus({ preventScroll: true })
  }
  function pointer(event: PointerEvent) {
    touch = event.pointerType === "touch" || event.pointerType === "pen"
    if (!touch) state.tap = undefined
  }
  function pageClick(event: MouseEvent) {
    const modified = event.ctrlKey || event.metaKey
    if ((event.type === "click" && !modified && !touch) || (event.type === "dblclick" && (modified || touch))) return
    // Panning captures pointer clicks on the viewport rather than the page.
    const image = viewport.ownerDocument.elementFromPoint(event.clientX, event.clientY)?.closest("canvas, .blank-sheet")
    if (!image || !viewport.contains(image)) {
      state.tap = undefined
      return
    }
    const sheet = options.getSheet()
    const index = options.getIndex()
    if (touch && !modified) {
      const now = performance.now()
      const twice =
        state.tap?.image === image &&
        state.tap.sheet === sheet &&
        state.tap.index === index &&
        now - state.tap.time < 350
      state.tap = twice ? undefined : { image, sheet, index, time: now }
      if (!twice) return
    }
    if (modified) options.grid(event)
    else {
      viewport.focus({ preventScroll: true })
      if (state.gesture.kind === "settling") return
      if (options.getZoom() > 100) options.setZoom(100)
      else {
        const bounds = image.getBoundingClientRect()
        if (!bounds.width || !bounds.height) return
        state.gesture = {
          kind: "settling",
          x: (event.clientX - bounds.left) / bounds.width,
          y: (event.clientY - bounds.top) / bounds.height,
          clientX: event.clientX,
          clientY: event.clientY,
          pdf: options.getDocument(),
          page: options.getRenderedPage(),
          index,
        }
        options.setZoom(200)
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

export function syncCollectionScroll(
  element: HTMLElement,
  itemSelector: string,
  applyScroll: (top: number) => void,
  fallbackTarget?: () => HTMLElement | null | undefined,
) {
  const focused =
    document.activeElement instanceof HTMLElement ? document.activeElement.closest<HTMLElement>(itemSelector) : null
  const owned = !!focused && element.contains(focused)
  const top = element.scrollTop
  flushSync(() => {
    applyScroll(top)
  })
  element.scrollTop = top
  if (!owned || !focused) return
  if (!element.contains(focused)) {
    ;(fallbackTarget?.() ?? element).focus({ preventScroll: true })
    return
  }
  const bounds = focused.getBoundingClientRect(),
    frame = element.getBoundingClientRect()
  if (bounds.bottom <= frame.top || bounds.top >= frame.bottom) element.focus({ preventScroll: true })
}
