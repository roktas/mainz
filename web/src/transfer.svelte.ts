// Owns workspace drag/touch sessions, drop previews, and gesture cleanup.

import { createDragImage } from "./drag.ts"
import type { Page, Size } from "./model.ts"

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
  value: Payload
  inspected: string | undefined
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

export class Transfer {
  #workspace: Workspace
  #interaction = $state.raw<Interaction>({ kind: "idle" })
  #target = $state.raw<Target>({ kind: "outside" })
  #point: PointerEvent | undefined
  #frame: number | undefined
  #consumeClick = false
  #dwell: ReturnType<typeof setTimeout> | undefined
  #scrollFrame: number | undefined
  #scrollArea: HTMLElement | undefined
  #scrollPoint: { x: number; y: number } | undefined
  #nativeMove: ((event: DragEvent) => void) | undefined
  #grab: { x: number; y: number } | undefined
  #pressed: ReturnType<typeof createDragImage>
  #pressEvents: AbortController | undefined
  #moving = $derived(new Set(this.value?.kind === "output" ? this.value.ids : []))
  #prefix = $derived.by(() => {
    const pages = this.#workspace.pages
    const moving = this.#moving
    const prefix = new Uint32Array(pages.length + 1)
    for (let index = 0; index < pages.length; index++)
      prefix[index + 1] = prefix[index] + Number(!moving.has(pages[index].id))
    return prefix
  })

  warning = $state(false)
  grid = $state<{
    from: number
    count: number
    limit: number
    columns: number
    width: number
    height: number
    columnGap: number
    rowGap: number
  }>()
  preview = $derived.by(() => {
    const value = this.value
    if (!value || !this.inside || this.blocked || !this.grid) return
    const { from, count } = this.grid
    const pages = this.#workspace.pages
    const moving = this.#moving
    const at = this.#at
    if (at === undefined) return
    const slot = this.#prefix[Math.min(at, pages.length)] - this.#prefix[Math.min(from, pages.length)]
    const remaining = pages
      .slice(from, from + count)
      .flatMap((page, index) => (moving.has(page.id) ? [] : [from + index]))
    if (slot < 0 || slot > remaining.length) return
    const positions = new Map(remaining.map((index, position) => [index, position + Number(position >= slot)]))
    return { slot, positions }
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
    const before = this.#prefix[index]
    return this.#moving.has(this.#workspace.pages[index].id)
      ? destination + index - before + 1
      : before + 1 + (before >= destination - this.#leading ? this.quantity + this.#active!.padding + this.#leading : 0)
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
    const label = number === undefined ? active.image.original : String(number + 1)
    if (active.image.number.textContent !== label) active.image.number.textContent = label
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
  ) {
    const contact = this.#contact
    if (!("dataTransfer" in event) && !contact) return
    this.#clearPress()
    this.#target = { kind: "outside" }
    this.#active?.image?.image.remove()
    const image = createDragImage(control, quantity, size)
    this.#interaction = {
      kind: "active",
      value,
      inspected: this.#workspace.inspected,
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
        const empty = document.createElement("canvas")
        empty.width = empty.height = 1
        empty.style.cssText = "position:fixed;inset:0;pointer-events:none"
        const paint = empty.getContext("2d")!
        paint.fillStyle = "rgba(0,0,0,0.01)"
        paint.fillRect(0, 0, 1, 1)
        document.body.append(empty)
        event.dataTransfer.setDragImage(empty, 0, 0)
        requestAnimationFrame(() => empty.remove())
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
    active?.image?.image.remove()
    this.#grab = undefined
    if (!completed && active) this.#workspace.inspected = active.inspected
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
    cancelAnimationFrame(this.#scrollFrame ?? 0)
    this.#scrollFrame = undefined
    this.#scrollArea = undefined
    this.#scrollPoint = undefined
  }
  #scrollList(area: HTMLElement, event: DragEvent | PointerEvent) {
    this.#scrollArea = area
    this.#scrollPoint = { x: event.clientX, y: event.clientY }
    if (this.#scrollFrame !== undefined) return
    const scroll = () => {
      this.#scrollFrame = undefined
      const list = this.#scrollArea,
        point = this.#scrollPoint
      if (!this.value || !list?.isConnected || !point) return
      const bounds = list.getBoundingClientRect(),
        top = Math.max(0, bounds.top),
        bottom = Math.min(innerHeight, bounds.bottom)
      const delta =
        point.y < top + 36 ? (point.y - top - 36) / 4 : point.y > bottom - 36 ? (point.y - bottom + 36) / 4 : 0
      if (!delta) return
      const before = list.scrollTop
      list.scrollBy({ top: delta, behavior: "instant" })
      if (list.scrollTop === before) return
      const row = this.#rowAt(list, point.y)
      if (row) this.#placeRow(list, row, point.y)
      this.#scrollFrame = requestAnimationFrame(scroll)
    }
    this.#scrollFrame = requestAnimationFrame(scroll)
  }
  #choiceBounds(list: HTMLElement, row: HTMLElement) {
    const choice = row.querySelector<HTMLElement>(".list-choice, .list-heading")!
    return {
      top: list.getBoundingClientRect().top - list.scrollTop + row.offsetTop + choice.offsetTop,
      height: choice.offsetHeight,
    }
  }
  #placeRow(list: HTMLElement, row: HTMLElement, y: number) {
    const bounds = this.#choiceBounds(list, row)
    const after =
      y >= bounds.top + bounds.height / 2 && (!row.matches(".list-section") || row.dataset.end !== undefined)
    this.#place(Number(after ? (row.dataset.end ?? row.dataset.index) : row.dataset.index), after)
  }
  #rowAt(list: HTMLElement, y: number) {
    const local = y - list.getBoundingClientRect().top + list.scrollTop
    const rows = list.querySelectorAll<HTMLElement>(
      ":scope > :is(.list-row, .list-section):not(.removing):not([data-dragging])",
    )
    let first = 0,
      last = rows.length
    while (first < last) {
      const middle = Math.floor((first + last) / 2)
      if (rows[middle].offsetTop + rows[middle].offsetHeight < local) first = middle + 1
      else last = middle
    }
    return rows[first]
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
        const row = this.#rowAt(list, event.clientY)
        if (row) this.#placeRow(list, row, event.clientY)
        else this.#place()
      }
      this.#scrollList(list, event)
      if (this.#active?.image?.image.hasAttribute("data-strip")) this.#placeImage(event.clientX, event.clientY)
      if (this.blocked && transfer) transfer.dropEffect = "none"
      return
    }
    this.#stopScroll()
    const grid = hit?.closest<HTMLOListElement>(".output-pages")
    if (grid) {
      const cards = grid.querySelectorAll<HTMLElement>(":scope > .composition-card:not(.removing)")
      const bounds = grid.getBoundingClientRect()
      if (cards.length && event.clientX >= bounds.left && event.clientY >= bounds.top) {
        const style = getComputedStyle(grid)
        const columns = style.gridTemplateColumns.split(" ")
        const layout = {
          from: Number(grid.getAttribute("start") ?? 1) - 1,
          count: cards.length,
          limit: Number(grid.parentElement!.dataset.batch),
          columns: columns.length,
          width: parseFloat(columns[0]),
          height: parseFloat(style.gridAutoRows),
          columnGap: parseFloat(style.getPropertyValue("--grid-column-gap")),
          rowGap: parseFloat(style.rowGap),
        }
        const x = Math.max(0, event.clientX - bounds.left - layout.columnGap)
        const column = Math.min(layout.columns - 1, Math.floor(x / (layout.width + layout.columnGap)))
        const row = Math.floor((event.clientY - bounds.top) / (layout.height + layout.rowGap))
        const slot = row * layout.columns + column
        if (this.preview && slot === this.preview.slot) {
          // Keep the open slot steady until the pointer clearly crosses its center.
          const fraction = (x - column * (layout.width + layout.columnGap)) / layout.width
          if (this.#target.kind === "page" && (this.#target.after ? fraction < 0.3 : fraction > 0.7))
            this.#target = { ...this.#target, after: !this.#target.after }
          this.#numberImage()
          return
        }
        const entry = this.preview
          ? [...this.preview.positions].find(([, position]) => position === slot)?.[0]
          : layout.from + slot
        if (
          !this.grid ||
          Object.entries(layout).some(
            ([property, dimension]) => this.grid![property as keyof typeof layout] !== dimension,
          )
        )
          this.grid = layout
        if (entry !== undefined && entry < layout.from + layout.count) {
          const after = x - column * (layout.width + layout.columnGap) >= layout.width / 2
          this.#place(entry, after)
        } else this.#place()
        if (this.blocked && transfer) transfer.dropEffect = "none"
        return
      }
    }
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
    if (event.pointerType === "mouse" && !control.closest(".list-row")) return
    this.end()
    if (event.pointerType !== "mouse") {
      const contact = { id: event.pointerId, x: event.clientX, y: event.clientY, control, value }
      this.#interaction = { kind: "pending", contact }
      control.setAttribute("data-press", "")
    }
    if (control.closest(".list-row")) {
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
      if (Math.hypot(event.clientX - this.#contact.x, event.clientY - this.#contact.y) < 6) return
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
    } else this.end()
  }
  cancelTouch = () => {
    if (this.#contact) this.end()
  }
  #placeImage(x: number, y: number) {
    const drag = this.#active?.image ?? this.#pressed
    if (!drag) return
    const image = drag.image
    this.#numberImage()
    if (!image.hasAttribute("data-strip")) {
      image.style.translate = `${Math.max(4, Math.min(innerWidth - drag.width - 4, x - drag.width / 2))}px ${Math.max(4, Math.min(innerHeight - drag.height - 4, y - 12))}px`
      return
    }
    this.#grab ??= { x: x - drag.origin!.x, y: y - drag.origin!.y }
    const left = Math.max(4, Math.min(x - this.#grab.x, innerWidth - drag.width - 4))
    const top = Math.max(4, Math.min(y - this.#grab.y, innerHeight - drag.height - 4))
    image.style.translate = `${left}px ${top}px`
  }

  #clearPress() {
    this.#pressEvents?.abort()
    this.#pressEvents = undefined
    this.#pressed?.image.remove()
    this.#pressed = undefined
  }
  #stopTouchClick = (event: TouchEvent) => {
    if (!this.#consumeClick) return
    if (event.cancelable) event.preventDefault()
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
    if (!this.grid) return
    const { columns, width, height, columnGap, rowGap } = this.grid
    return `${((position % columns) - (original % columns)) * (width + columnGap)}px ${(Math.floor(position / columns) - Math.floor(original / columns)) * (height + rowGap)}px`
  }
}
