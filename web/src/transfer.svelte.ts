// Owns workspace drag/touch sessions, drop previews, and gesture cleanup.

import { createDragImage } from "./drag.ts"
import type { Page, Size } from "./model.ts"

export type Payload = { kind: "source"; page?: number } | { kind: "output"; ids: string[] }

type Workspace = {
  key: string
  readonly pages: Page[]
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
  #session = $state<{ value: Payload; position: number; pointer: "native" | "touch" }>()
  #image: ReturnType<typeof createDragImage>
  #contact:
    | {
        id: number
        x: number
        y: number
        control: HTMLElement
        value: Payload
        distance?: number
        warning?: ReturnType<typeof setTimeout>
      }
    | undefined
  #point: PointerEvent | undefined
  #frame: number | undefined
  #consumeClick = false
  #dwell: ReturnType<typeof setTimeout> | undefined

  target = $state<{ index: number; after: boolean }>()
  inside = $state(false)
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
    const moving = new Set(value.kind === "output" ? value.ids : [])
    const at = this.target ? this.target.index + Number(this.target.after) : pages.length
    const before = pages.slice(0, from).filter((page) => !moving.has(page.id)).length
    const slot = pages.slice(0, at).filter((page) => !moving.has(page.id)).length - before
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

  get value() {
    return this.#session?.value
  }
  get touching() {
    return this.#session?.pointer === "touch"
  }
  get blocked() {
    const value = this.value
    return value?.kind === "output" && !!this.target && value.ids.includes(this.#workspace.pages[this.target.index]?.id)
  }
  get label() {
    return this.target
      ? `${this.target.after ? "After" : "Before"} page ${this.target.index + 1}`
      : "At the end of Output"
  }

  begin(event: DragEvent | PointerEvent, value: Payload, quantity: number, control: HTMLElement, size?: Size) {
    this.target = undefined
    this.inside = false
    this.#session = {
      value,
      position: this.#workspace.position,
      pointer: "dataTransfer" in event ? "native" : "touch",
    }
    this.#image?.image.remove()
    this.#image = createDragImage(control, quantity, size)
    if ("dataTransfer" in event && event.dataTransfer) {
      event.dataTransfer.setData("text/plain", "PDF Composer pages")
      event.dataTransfer.effectAllowed = value.kind === "source" ? "copy" : "move"
      if (this.#image) {
        const image = this.#image.image
        event.dataTransfer.setDragImage(image, image.width / 2, 12)
        // Keep the canvas visible until the browser captures its native drag image.
        requestAnimationFrame(() => (image.style.visibility = "hidden"))
      }
    }
  }

  end(completed = false) {
    this.leave()
    if (this.touching) this.#consumeClick = true
    cancelAnimationFrame(this.#frame ?? 0)
    this.#frame = undefined
    this.#point = undefined
    clearTimeout(this.#contact?.warning)
    this.warning = false
    this.#contact?.control.removeAttribute("data-press")
    this.#contact = undefined
    this.#image?.image.remove()
    this.#image = undefined
    if (!completed && this.#session) this.#workspace.position = this.#session.position
    this.#session = undefined
    this.target = undefined
    this.inside = false
    this.grid = undefined
  }
  cancelInput() {
    if (this.value?.kind === "source" || this.#contact?.value.kind === "source") this.end()
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
      this.target = { index: this.#workspace.position, after: offset > 0 }
    }, 450)
  }
  over = (event: DragEvent | PointerEvent, index?: number, element?: HTMLElement) => {
    const value = this.value
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    this.inside = true
    const transfer = "dataTransfer" in event ? event.dataTransfer : null
    if (transfer) transfer.dropEffect = value.kind === "source" ? "copy" : "move"
    const hit = element ?? (event.target instanceof Element ? event.target : null)
    const grid = hit?.closest<HTMLOListElement>(".output-pages")
    if (grid) {
      const cards = grid.querySelectorAll<HTMLElement>(":scope > .composition-card")
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
          if (this.target && (this.target.after ? fraction < 0.3 : fraction > 0.7))
            this.target = { ...this.target, after: !this.target.after }
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
          if (this.target?.index !== entry || this.target.after !== after) this.target = { index: entry, after }
        } else this.target = undefined
        if (this.blocked && transfer) transfer.dropEffect = "none"
        return
      }
    }
    if (index === undefined) this.target = undefined
    else {
      const bounds = (element ?? (event.currentTarget as HTMLElement)).getBoundingClientRect()
      const after = event.clientX >= bounds.left + bounds.width / 2
      if (this.target?.index !== index || this.target.after !== after) this.target = { index, after }
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
      this.target = undefined
      this.inside = false
    }
  }
  drop = (event: DragEvent | PointerEvent) => {
    const value = this.value
    if (!value) return
    event.preventDefault()
    event.stopPropagation()
    const at = this.target ? this.target.index + Number(this.target.after) : this.#workspace.pages.length
    const completed = this.#workspace.drop(value, at)
    this.end(completed)
    return completed
  }

  press(event: PointerEvent, value: Payload) {
    if (event.pointerType === "mouse" || !event.isPrimary || event.button !== 0) return
    this.#contact = {
      id: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      control: event.currentTarget as HTMLElement,
      value,
    }
    this.#contact.control.setAttribute("data-press", "")
  }
  #updateTouch = () => {
    this.#frame = undefined
    const value = this.value
    if (!this.touching || !this.#point || !value) return
    const event = this.#point
    const hit = document.elementFromPoint(event.clientX, event.clientY)
    const pane = hit?.closest<HTMLElement>(
      ".composition-output :is(.composition-grid, .composition-empty, .inspection-target)",
    )
    const button = this.#workspace.outputTarget
    if (button?.contains(hit ?? null) && this.#workspace.input) {
      this.leave()
      this.inside = true
      this.target =
        this.#workspace.insertion === undefined ? undefined : { index: this.#workspace.insertion - 1, after: true }
      this.grid = undefined
    } else if (pane) {
      const navigation = hit?.closest<HTMLButtonElement>(".composition-output .page-navigation button[data-step]")
      const card = hit?.closest<HTMLElement>(".composition-card")
      const page = hit?.closest<HTMLElement>(".inspection-target")
      if (navigation) this.navigate(event, Number(navigation.dataset.step), navigation)
      else {
        this.leave()
        const index = card
          ? this.#workspace.pages.findIndex((item) => `${this.#workspace.key}-${item.id}` === card.id)
          : page
            ? this.#workspace.position
            : undefined
        this.over(event, index, card ?? page ?? (hit as HTMLElement))
      }
    } else {
      this.leave()
      this.target = undefined
      this.inside = false
      this.grid = undefined
    }
    if (this.#contact) {
      const invalid =
        value.kind === "source" &&
        this.#workspace.input &&
        button?.offsetWidth &&
        hit?.closest(".selection-panel :is(.composition-grid, .page-view)")
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
    const image = this.#image?.image
    if (image)
      image.style.translate = `${Math.max(0, Math.min(innerWidth - image.width, event.clientX - image.width / 2))}px ${Math.max(0, event.clientY - image.height - 20)}px`
    const scroll =
      event.clientY < 56
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
    if (!this.#image) return
    canvas.width = this.#image.thumbnail.width
    canvas.height = this.#image.thumbnail.height
    canvas.getContext("2d")!.drawImage(this.#image.thumbnail, 0, 0)
  }
  displacement(position: number, original = 0) {
    if (!this.grid) return
    const { columns, width, height, columnGap, rowGap } = this.grid
    return `${((position % columns) - (original % columns)) * (width + columnGap)}px ${(Math.floor(position / columns) - Math.floor(original / columns)) * (height + rowGap)}px`
  }
}
