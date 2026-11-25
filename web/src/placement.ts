// Computes Grid and List drop placement geometry, preview slots, and unified edge auto-scrolling.

import type { Page } from "./model.ts"

export type GridGeometry = {
  projection: string
  pages: number[]
  ends: Record<number, number>
  from: number
  count: number
  limit: number
  columns: number
  width: number
  height: number
  columnGap: number
  rowGap: number
}

export function buildMovePrefix(pages: readonly Page[], moving: ReadonlySet<string>) {
  const prefix = new Uint32Array(pages.length + 1)
  for (let index = 0; index < pages.length; index++)
    prefix[index + 1] = prefix[index] + Number(!moving.has(pages[index].id))
  return prefix
}

export function computeGridPreview(
  grid: GridGeometry,
  pages: readonly Page[],
  moving: ReadonlySet<string>,
  at: number,
) {
  const remaining = grid.pages.filter((index) => !moving.has(pages[index].id))
  const slot = remaining.filter((index) => index < at).length
  const positions = new Map<number, number>()
  const slots: number[] = []
  for (let position = 0; position < remaining.length; position++) {
    const index = remaining[position]
    const rendered = position + Number(position >= slot)
    positions.set(index, rendered)
    slots[rendered] = index
  }
  return { slot, positions, slots }
}

export function renumberedOutputPage(
  index: number,
  prefix: Uint32Array,
  pageId: string,
  moving: ReadonlySet<string>,
  destination: number,
  leading: number,
  quantity: number,
  padding: number,
) {
  const before = prefix[index]
  return moving.has(pageId)
    ? destination + index - before + 1
    : before + 1 + (before >= destination - leading ? quantity + padding + leading : 0)
}

export function gridDisplacement(grid: GridGeometry | undefined, position: number, original = 0) {
  if (!grid) return
  const { columns, width, height, columnGap, rowGap } = grid
  return `${((position % columns) - (original % columns)) * (width + columnGap)}px ${(Math.floor(position / columns) - Math.floor(original / columns)) * (height + rowGap)}px`
}

export class EdgeScroller {
  #frame: number | undefined
  #area: HTMLElement | undefined
  #point: { x: number; y: number } | undefined
  #clampToViewport = false
  #step: ((area: HTMLElement, point: { x: number; y: number }) => void) | undefined

  stop() {
    cancelAnimationFrame(this.#frame ?? 0)
    this.#frame = undefined
    this.#area = undefined
    this.#point = undefined
    this.#step = undefined
  }

  track(
    area: HTMLElement,
    point: { x: number; y: number },
    clampToViewport: boolean,
    active: () => boolean,
    onStep: (area: HTMLElement, point: { x: number; y: number }) => void,
  ) {
    if (this.#area !== area) this.stop()
    this.#area = area
    this.#point = point
    this.#clampToViewport = clampToViewport
    this.#step = onStep
    if (this.#frame !== undefined) return
    const scroll = () => {
      this.#frame = undefined
      const current = this.#area
      const cursor = this.#point
      if (!active() || !current?.isConnected || !cursor) return
      const bounds = current.getBoundingClientRect()
      const top = this.#clampToViewport ? Math.max(0, bounds.top) : bounds.top
      const bottom = this.#clampToViewport ? Math.min(innerHeight, bounds.bottom) : bounds.bottom
      const delta =
        cursor.y < top + 36 ? (cursor.y - top - 36) / 4 : cursor.y > bottom - 36 ? (cursor.y - bottom + 36) / 4 : 0
      if (!delta) return
      const before = current.scrollTop
      current.scrollBy({ top: delta, behavior: "instant" })
      if (current.scrollTop === before) return
      this.#step?.(current, cursor)
      this.#frame = requestAnimationFrame(scroll)
    }
    this.#frame = requestAnimationFrame(scroll)
  }
}

export function measureGrid(
  grid: HTMLOListElement,
  cached: GridGeometry | undefined,
  x: number,
  y: number,
):
  | {
      geometry: GridGeometry
      column: number
      slot: number
      horizontal: number
    }
  | undefined {
  const cards = grid.querySelectorAll<HTMLElement>(":scope > .composition-card:not(.removing)")
  const projection = grid.dataset.projection
  if (!cards.length || !projection) return
  const bounds = grid.getBoundingClientRect()
  const style = getComputedStyle(grid)
  const columns = style.gridTemplateColumns.split(" ")
  const width = parseFloat(columns[0])
  const height = parseFloat(style.gridAutoRows)
  const columnGap = parseFloat(style.getPropertyValue("--grid-column-gap")) || 0
  const rowGap = parseFloat(style.rowGap) || 0
  const paddingTop = parseFloat(style.paddingBlockStart) || 0
  if (!Number.isFinite(width) || width <= 0 || !Number.isFinite(height) || height <= 0) return
  const layout = {
    from: Number(grid.dataset.from ?? 0),
    count: cards.length,
    limit: cards.length + 1,
    columns: columns.length,
    width,
    height,
    columnGap,
    rowGap,
  }
  const { pages, ends } =
    cached?.projection === projection
      ? cached
      : (JSON.parse(projection) as { pages: number[]; ends: Record<number, number> })
  const horizontal = Math.max(0, x - bounds.left - layout.columnGap)
  const column = Math.max(0, Math.min(layout.columns - 1, Math.floor(horizontal / (layout.width + layout.columnGap))))
  const row = Math.max(0, Math.floor((y - bounds.top - paddingTop) / (layout.height + layout.rowGap)))
  const slot = row * layout.columns + column
  const geometry =
    cached &&
    cached.projection === projection &&
    Object.entries(layout).every(([property, dimension]) => cached[property as keyof typeof layout] === dimension)
      ? cached
      : { ...layout, projection, pages, ends }
  return { geometry, column, slot, horizontal }
}

function choiceBounds(list: HTMLElement, row: HTMLElement) {
  const choice = row.querySelector<HTMLElement>(".list-choice, .list-heading")
  if (!choice) return
  return {
    top: list.getBoundingClientRect().top - list.scrollTop + row.offsetTop + choice.offsetTop,
    height: choice.offsetHeight,
  }
}

export function rowAt(list: HTMLElement, y: number) {
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

export function rowPlacement(list: HTMLElement, row: HTMLElement, y: number) {
  const bounds = choiceBounds(list, row)
  if (!bounds) return
  const after = y >= bounds.top + bounds.height / 2 && (!row.matches(".list-section") || row.dataset.end !== undefined)
  return { index: Number(after ? (row.dataset.end ?? row.dataset.index) : row.dataset.index), after }
}
