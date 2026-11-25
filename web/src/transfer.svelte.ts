// Owns workspace drag/touch sessions, drop previews, and gesture cleanup.

import { attachNativeDragCanvas, createDragImage, discardDragImage, placeDragImage, updateDragNumber } from "./drag.ts"
import type { DragImage } from "./drag.ts"
import type { Page, Size } from "./model.ts"
import {
  buildMovePrefix,
  computeGridPreview,
  EdgeScroller,
  gridDisplacement,
  measureGrid,
  renumberedOutputPage,
  rowAt,
  rowPlacement,
} from "./placement.ts"
import type { GridGeometry } from "./placement.ts"

export type Payload =
  | {
      kind: "source"
      source: string
      choice: { kind: "preparation" } | { kind: "page"; page: number } | { kind: "pages"; pages: readonly number[] }
    }
  | { kind: "output"; ids: readonly string[] }

type Contact = {
  id: number
  x: number
  y: number
  control: HTMLElement
  value: Payload
  distance?: number
  warning?: ReturnType<typeof setTimeout>
}
type Session = {
  kind: "active"
  control: HTMLElement
  value: Payload
  inspected: string | undefined
  restore: () => void
  quantity: number
  front: boolean
  padding: number
  offset: number
  image: ReturnType<typeof createDragImage>
} & ({ pointer: "native" } | { pointer: "touch"; contact: Contact })
type Interaction = { kind: "idle" } | { kind: "pending"; contact: Contact } | Session
type Target = { kind: "outside" } | { kind: "append" } | { kind: "page"; id: string; after: boolean }

type Workspace = {
  readonly pages: readonly Page[]
  readonly positions: ReadonlyMap<string, number>
  inspected: string | undefined
  position: number
  readonly input: boolean
  readonly insertion?: number
  readonly outputTarget?: HTMLButtonElement
  start: (event: PointerEvent, value: Payload, control: HTMLElement) => void
  drop: (value: Payload, at: number) => boolean
  reveal: () => void
}

const touchDragThreshold = 10

export class Transfer {
  #workspace: Workspace
  #interaction = $state.raw<Interaction>({ kind: "idle" })
  #target = $state.raw<Target>({ kind: "outside" })
  #point: PointerEvent | undefined
  #frame: number | undefined
  #consumeClick = false
  #dwell: ReturnType<typeof setTimeout> | undefined
  #scroller = new EdgeScroller()
  #nativeMove: ((event: DragEvent) => void) | undefined
  #grab: { x: number; y: number } | undefined
  #pressed: DragImage | undefined
  #pressEvents: AbortController | undefined
  #moving = $derived(new Set(this.value?.kind === "output" ? this.value.ids : []))
  #prefix = $derived.by(() => buildMovePrefix(this.#workspace.pages, this.#moving))

  warning = $state(false)
  grid = $state<GridGeometry>()
  preview = $derived.by(() => {
    const value = this.value
    if (!value || !this.inside || this.blocked || !this.grid) return
    const at = this.#at
    if (at === undefined) return
    return computeGridPreview(this.grid, this.#workspace.pages, this.#moving, at)
  })

  constructor(workspace: Workspace) {
    this.#workspace = workspace
  }

  get #active() {
    return this.#interaction.kind === "active" ? this.#interaction : undefined
  }
  get #contact() {
    const interaction = this.#interaction
    return interaction.kind === "pending" || (interaction.kind === "active" && interaction.pointer === "touch")
      ? interaction.contact
      : undefined
  }
  get value() {
    return this.#active?.value
  }
  get control() {
    return this.#active?.control
  }
  get touching() {
    return this.#active?.pointer === "touch"
  }
  get quantity() {
    return this.#active?.quantity ?? 1
  }
  get destination() {
    const at = this.#at
    if (!this.value || !this.inside || this.blocked || at === undefined) return
    return this.#prefix[Math.min(at, this.#workspace.pages.length)] + this.#leading
  }
  get #leading() {
    return this.#active?.front ? (this.#at ?? 0) % 2 : 0
  }
  moving(id: string) {
    return this.#moving.has(id)
  }
  number(index: number) {
    const destination = this.destination
    if (destination === undefined) return index + 1
    return renumberedOutputPage(
      index,
      this.#prefix,
      this.#workspace.pages[index].id,
      this.#moving,
      destination,
      this.#leading,
      this.quantity,
      this.#active!.padding,
    )
  }
  #numberImage() {
    const active = this.#active
    if (!active?.image) return
    const index = active.value.kind === "output" ? this.#workspace.positions.get(active.value.ids[0]) : undefined
    const number =
      index === undefined
        ? this.destination === undefined
          ? undefined
          : this.destination + active.offset
        : this.number(index) - 1
    updateDragNumber(active.image, number === undefined ? active.image.original : String(number + 1))
  }
  get stripHeight() {
    return this.#active?.image?.image.hasAttribute("data-strip") ? this.#active.image.height : 44
  }
  get pressing() {
    return !!this.#pressed || this.#interaction.kind === "pending"
  }
  get target(): Readonly<Target> {
    return this.#target
  }
  get targetIndex() {
    return this.#target.kind === "page" ? this.#workspace.positions.get(this.#target.id) : undefined
  }
  get targetAfter() {
    return this.#target.kind === "page" && this.#target.after
  }
  get inside() {
    return this.#target.kind !== "outside"
  }
  get #at() {
    const target = this.#target
    if (target.kind === "append") return this.#workspace.pages.length
    const index = this.targetIndex
    if (index !== undefined) return index + Number(this.targetAfter)
  }
  get blocked() {
    const value = this.value
    return value?.kind === "output" && this.#target.kind === "page" && this.#moving.has(this.#target.id)
  }
  get label() {
    const index = this.targetIndex
    return index !== undefined ? `${this.targetAfter ? "After" : "Before"} page ${index + 1}` : "At the end of Output"
  }
  #place(index?: number, after = false) {
    if (index === undefined) {
      if (this.#target.kind !== "append") this.#target = { kind: "append" }
      this.#numberImage()
      return
    }
    const page = this.#workspace.pages[index]
    if (!page) {
      this.#target = { kind: "outside" }
      return
    }
    if (this.#target.kind !== "page" || this.#target.id !== page.id || this.#target.after !== after)
      this.#target = { kind: "page", id: page.id, after }
    this.#numberImage()
  }

  begin(
    event: DragEvent | PointerEvent,
    value: Payload,
    quantity: number,
    control: HTMLElement,
    size?: Size,
    front = false,
    padding = 0,
    offset = 0,
    restore = () => {},
  ) {
    const contact = this.#contact
    if (!("dataTransfer" in event) && !contact) return
    this.#clearPress()
    this.#target = { kind: "outside" }
    discardDragImage(this.#active?.image)
    const image = createDragImage(control, quantity, size, !("dataTransfer" in event))
    this.#interaction = {
      kind: "active",
      control,
      value,
      inspected: this.#workspace.inspected,
      restore,
      quantity,
      front,
      padding,
      offset,
      image,
      ...("dataTransfer" in event ? { pointer: "native" } : { pointer: "touch", contact: contact! }),
    }
    if ("dataTransfer" in event && event.dataTransfer) {
      event.dataTransfer.setData("text/plain", "PDF Composer pages")
      event.dataTransfer.effectAllowed = value.kind === "source" ? "copy" : "move"
      if (image) {
        attachNativeDragCanvas(event.dataTransfer)
        this.#nativeMove = (next) => this.#placeImage(next.clientX, next.clientY)
        document.addEventListener("dragover", this.#nativeMove, true)
        this.#placeImage(event.clientX, event.clientY)
      }
    }
  }

  end(completed = false) {
    const pressed = !!this.#pressed
    this.#clearPress()
    if (this.#nativeMove) document.removeEventListener("dragover", this.#nativeMove, true)
    this.#nativeMove = undefined
    const active = this.#active
    const contact = this.#contact
    this.leave()
    this.#stopScroll()
    if (this.touching || pressed) this.#consumeClick = true
    cancelAnimationFrame(this.#frame ?? 0)
    this.#frame = undefined
    this.#point = undefined
    clearTimeout(contact?.warning)
    this.warning = false
    contact?.control.removeAttribute("data-press")
    discardDragImage(active?.image)
    this.#grab = undefined
    if (!completed && active) {
      this.#workspace.inspected = active.inspected
      active.restore()
    }
    this.#interaction = { kind: "idle" }
    this.#target = { kind: "outside" }
    this.grid = undefined
  }
  cancelInput() {
    this.#clearPress()
    if (this.value?.kind === "source" || this.#contact?.value.kind === "source") this.end()
  }
  blur = () => {
    // Native dragging can move window focus into the platform's drag session.
    if (this.#active?.pointer !== "native") this.end()
  }
  pointer(event: PointerEvent) {
    this.#consumeClick = false
    if (this.#contact && event.pointerId !== this.#contact.id) this.end()
  }
  tap(event: PointerEvent, action: () => void) {
    if (
      event.pointerType === "mouse" ||
      !event.isPrimary ||
      this.#interaction.kind !== "pending" ||
      this.#interaction.contact.id !== event.pointerId ||
      this.#interaction.contact.control !== event.currentTarget
    )
      return false
    const { contact } = this.#interaction
    const control = event.currentTarget as HTMLButtonElement
    const moved = Math.hypot(event.clientX - contact.x, event.clientY - contact.y) >= touchDragThreshold
    this.end()
    if (control.disabled) return false
    this.#consumeClick = true
    if (moved) return false
    action()
    return true
  }
  click = (event: MouseEvent) => {
    if (!this.#consumeClick || !event.detail) return
    event.preventDefault()
    event.stopImmediatePropagation()
    this.#consumeClick = false
  }
  leave = () => {
    clearTimeout(this.#dwell)
    this.#dwell = undefined
  }
  navigate = (event: DragEvent | PointerEvent, offset: number, element?: HTMLElement) => {
    if (!this.value) return
    this.over(event, this.#workspace.position, element)
    if (this.#dwell !== undefined) return
    this.#dwell = setTimeout(() => {
      this.#dwell = undefined
      this.#workspace.position = Math.max(
        0,
        Math.min(this.#workspace.pages.length - 1, this.#workspace.position + offset),
      )
      this.#place(this.#workspace.position, offset > 0)
    }, 450)
  }
  #stopScroll() {
    this.#scroller.stop()
  }
  #scrollList(area: HTMLElement, event: DragEvent | PointerEvent) {
    this.#scroller.track(
      area,
      { x: event.clientX, y: event.clientY },
      true,
      () => !!this.value,
      (list, point) => {
        const row = rowAt(list, point.y)
        if (row) this.#placeRow(list, row, point.y)
      },
    )
  }
  #scrollGrid(area: HTMLElement, event: DragEvent | PointerEvent) {
    this.#scroller.track(
      area,
      { x: event.clientX, y: event.clientY },
      false,
      () => !!this.value,
      (viewport, point) => {
        const grid = viewport.querySelector<HTMLOListElement>(".output-pages")
        if (grid) this.#placeGrid(grid, point.x, point.y)
      },
    )
  }
  #placeGrid(grid: HTMLOListElement, x: number, y: number) {
    const measured = measureGrid(grid, this.grid, x, y)
    if (!measured) return
    const { geometry, column, slot, horizontal } = measured
    if (this.grid !== geometry) this.grid = geometry
    const { pages, ends, width, columnGap } = geometry
    if (this.preview && slot === this.preview.slot) {
      const fraction = (horizontal - column * (width + columnGap)) / width
      if (this.#target.kind === "page" && (this.#target.after ? fraction < 0.3 : fraction > 0.7)) {
        const start = this.#target.after
          ? pages.find((index) => (ends[index] ?? index + 1) - 1 === this.targetIndex)
          : this.targetIndex
        if (start !== undefined)
          this.#place(this.#target.after ? start : (ends[start] ?? start + 1) - 1, !this.#target.after)
      }
      this.#numberImage()
      return
    }
    const entry = this.preview ? this.preview.slots[slot] : pages[slot]
    if (entry !== undefined) {
      const after = horizontal - column * (width + columnGap) >= width / 2
      this.#place(after ? (ends[entry] ?? entry + 1) - 1 : entry, after)
    } else {
      const last = pages.at(-1)
      if (last !== undefined) this.#place((ends[last] ?? last + 1) - 1, true)
      else this.#place()
    }
  }
  #placeRow(list: HTMLElement, row: HTMLElement, y: number) {
    const placed = rowPlacement(list, row, y)
    if (placed) this.#place(placed.index, placed.after)
  }
  over = (event: DragEvent | PointerEvent, index?: number, element?: HTMLElement) => {
    const value = this.value
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    const transfer = "dataTransfer" in event ? event.dataTransfer : null
    if (transfer) transfer.dropEffect = value.kind === "source" ? "copy" : "move"
    const hit = element ?? (event.target instanceof Element ? event.target : null)
    const list = hit?.closest<HTMLElement>(".composition-output .page-list")
    if (list) {
      this.grid = undefined
      const slot = list.querySelector<HTMLElement>(".list-drop-preview")
      const top =
        slot && list.getBoundingClientRect().top - list.scrollTop + slot.parentElement!.offsetTop + slot.offsetTop
      // Keep an open insertion slot stable while its neighbors are moving.
      if (!slot || event.clientY < top! || event.clientY > top! + slot.offsetHeight) {
        const row = rowAt(list, event.clientY)
        if (row) this.#placeRow(list, row, event.clientY)
        else this.#place()
      }
      this.#scrollList(list, event)
      if (this.#active?.image?.image.hasAttribute("data-strip")) this.#placeImage(event.clientX, event.clientY)
      if (this.blocked && transfer) transfer.dropEffect = "none"
      return
    }
    const grid = hit?.closest<HTMLOListElement>(".output-pages")
    if (grid) {
      this.#scrollGrid(grid.parentElement!, event)
      this.#placeGrid(grid, event.clientX, event.clientY)
      if (this.blocked && transfer) transfer.dropEffect = "none"
      return
    }
    this.#stopScroll()
    if (index === undefined) this.#place()
    else {
      const bounds = (element ?? (event.currentTarget as HTMLElement)).getBoundingClientRect()
      const after = event.clientX >= bounds.left + bounds.width / 2
      this.#place(index, after)
    }
    if (this.blocked && transfer) transfer.dropEffect = "none"
  }
  leaveOutput = (event: DragEvent) => {
    const pane = event.currentTarget as HTMLElement
    if (event.relatedTarget instanceof Node && pane.contains(event.relatedTarget)) return
    const bounds = pane.getBoundingClientRect()
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      this.leave()
      this.#stopScroll()
      this.#target = { kind: "outside" }
      this.#numberImage()
    }
  }
  drop = (event: DragEvent | PointerEvent) => {
    const value = this.value
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    const at = this.#at
    const completed = at !== undefined && this.#workspace.drop(value, at)
    this.end(completed)
    return completed
  }

  press(event: PointerEvent, value: Payload) {
    if (!event.isPrimary || event.button !== 0) return
    const control = event.currentTarget as HTMLElement
    if (event.pointerType === "mouse" && !control.closest(".list-row, .list-section")) return
    this.end()
    if (event.pointerType !== "mouse") {
      const contact = { id: event.pointerId, x: event.clientX, y: event.clientY, control, value }
      this.#interaction = { kind: "pending", contact }
      control.setAttribute("data-press", "")
    } else {
      this.#pressed = createDragImage(control, 1)
      this.#placeImage(event.clientX, event.clientY)
      this.#pressEvents = new AbortController()
      for (const name of ["pointerup", "pointercancel", "blur"])
        window.addEventListener(name, () => this.#clearPress(), { once: true, signal: this.#pressEvents.signal })
    }
  }
  #updateTouch = () => {
    this.#frame = undefined
    const value = this.value
    if (!this.touching || !this.#point || !value) return
    const event = this.#point
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const pane = hit?.closest<HTMLElement>(
      ".composition-output :is(.composition-grid, .page-list, .composition-empty, .inspection-target)",
    )
    const button = this.#workspace.outputTarget
    if (button?.contains(hit ?? null) && this.#workspace.input) {
      this.leave()
      this.#stopScroll()
      const insertion = this.#workspace.insertion
      this.#place(insertion === undefined ? undefined : Math.max(0, insertion - 1), insertion !== 0)
      this.grid = undefined
    } else if (pane) {
      const navigation = hit?.closest<HTMLButtonElement>(".composition-output .page-navigation button[data-step]")
      const card = hit?.closest<HTMLElement>(".composition-card, .list-row")
      const page = hit?.closest<HTMLElement>(".inspection-target")
      if (navigation) this.navigate(event, Number(navigation.dataset.step), navigation)
      else {
        this.leave()
        const index = page ? this.#workspace.position : undefined
        this.over(event, index, card ?? page ?? (hit as HTMLElement))
      }
    } else {
      this.leave()
      this.#stopScroll()
      this.#target = { kind: "outside" }
      this.grid = undefined
    }
    if (this.#contact) {
      const invalid =
        value.kind === "source" &&
        this.#workspace.input &&
        button?.offsetWidth &&
        hit?.closest(".selection-panel :is(.composition-grid, .page-list, .page-view)")
      if (invalid) {
        const bounds = button.getBoundingClientRect()
        const distance = Math.hypot(
          event.clientX - bounds.left - bounds.width / 2,
          event.clientY - bounds.top - bounds.height / 2,
        )
        if (this.#contact.distance === undefined || distance < this.#contact.distance - 4) {
          clearTimeout(this.#contact.warning)
          this.#contact.warning = undefined
          this.warning = false
          this.#contact.distance = distance
        } else if (distance > this.#contact.distance + 4) this.#contact.distance = distance
        if (this.#contact.warning === undefined && !this.warning)
          this.#contact.warning = setTimeout(() => {
            this.warning = true
          }, 650)
      } else {
        clearTimeout(this.#contact.warning)
        this.#contact.warning = undefined
        this.#contact.distance = undefined
        this.warning = false
      }
    }
    this.#placeImage(event.clientX, event.clientY)
    const scroll = hit?.closest(".page-list")
      ? 0
      : event.clientY < 56
        ? (event.clientY - 56) / 4
        : event.clientY > innerHeight - 56
          ? (event.clientY - innerHeight + 56) / 4
          : 0
    if (scroll) {
      const previous = scrollY
      window.scrollBy({ top: scroll, behavior: "instant" })
      if (scrollY !== previous) this.#frame = requestAnimationFrame(this.#updateTouch)
    }
  }
  moveTouch = (event: PointerEvent) => {
    if (!this.#contact || event.pointerId !== this.#contact.id) return
    if (!this.touching) {
      if (Math.hypot(event.clientX - this.#contact.x, event.clientY - this.#contact.y) < touchDragThreshold) return
      this.#workspace.start(event, this.#contact.value, this.#contact.control)
      if (!this.value) {
        this.end()
        return
      }
      if (document.activeElement instanceof HTMLInputElement) document.activeElement.blur()
    }
    event.preventDefault()
    this.#point = event
    if (this.#frame === undefined) this.#frame = requestAnimationFrame(this.#updateTouch)
  }
  finishTouch = (event: PointerEvent) => {
    if (!this.#contact || event.pointerId !== this.#contact.id) return
    if (this.touching) {
      this.#consumeClick = true
      cancelAnimationFrame(this.#frame ?? 0)
      this.#point = event
      this.#updateTouch()
      if (this.inside) {
        const reveal = this.value?.kind === "source" && this.#workspace.input
        if (this.drop(event) && reveal) this.#workspace.reveal()
      } else this.end()
    } else {
      this.end()
    }
  }
  cancelTouch = () => {
    if (this.#contact) this.end()
  }
  #placeImage(x: number, y: number) {
    const drag = this.#active?.image ?? this.#pressed
    if (!drag) return
    this.#numberImage()
    const contact = this.#contact
    this.#grab = placeDragImage(drag, x, y, this.#grab, contact)
  }

  #clearPress() {
    this.#pressEvents?.abort()
    this.#pressEvents = undefined
    discardDragImage(this.#pressed)
    this.#pressed = undefined
  }
  #stopTouchClick = (event: TouchEvent) => {
    if (!this.#consumeClick || !event.cancelable) return
    event.preventDefault()
    this.#consumeClick = false
  }
  track = () => {
    // The source grip can disappear when a narrow workspace switches panes.
    window.addEventListener("touchend", this.#stopTouchClick, { passive: false })
    return () => {
      window.removeEventListener("touchend", this.#stopTouchClick)
      this.end()
    }
  }
  ghost = (canvas: HTMLCanvasElement) => {
    const image = this.#active?.image
    if (!image) return
    canvas.width = image.thumbnail.width
    canvas.height = image.thumbnail.height
    canvas.getContext("2d")!.drawImage(image.thumbnail, 0, 0)
  }
  displacement(position: number, original = 0) {
    return gridDisplacement(this.grid, position, original)
  }
}
