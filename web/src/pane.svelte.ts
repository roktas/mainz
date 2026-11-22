// Owns pane views, their retained settings, and navigation within their DOM.

import { tick, untrack } from "svelte"
import type Grid from "./Grid.svelte"
import type { Viewport as GridViewport } from "./Grid.svelte"
import type List from "./List.svelte"
import type { Viewport as ListViewport } from "./List.svelte"
import type Page from "./Page.svelte"
import type { Controls, Region } from "./Page.svelte"
import type { Source } from "./model.ts"
import type { Edit, Output } from "./output.svelte.ts"
import type { TourStep } from "./Tour.svelte"
import { flash } from "./motion.ts"

export const viewTabs = ["grid", "list", "page"] as const
export const viewLabels = { grid: "Grid", list: "List", page: "Page" }
export type Tab = (typeof viewTabs)[number]
export type InputTab = Tab | "style"

export function observeSummary(element: HTMLElement) {
  const counts = element.querySelector<HTMLElement>(".composition-totals")!
  let frame = 0
  const observer = new ResizeObserver(() => {
    cancelAnimationFrame(frame)
    frame = requestAnimationFrame(() => {
      const overflow = counts.scrollWidth > element.clientWidth + 1
      element.toggleAttribute("data-overflow", overflow)
      if (!overflow) document.getElementById(element.dataset.details ?? "")?.hidePopover()
    })
  })
  observer.observe(element)
  observer.observe(counts)
  return () => {
    cancelAnimationFrame(frame)
    observer.disconnect()
  }
}

abstract class Pane {
  panel = $state<HTMLElement>()
  grid = $state<ReturnType<typeof Grid>>()
  list = $state<ReturnType<typeof List>>()
  page = $state<ReturnType<typeof Page>>()
  menu = $state<HTMLDetailsElement>()
  headingHeight = $state(0)
  controls = $state<Controls>("all")
  abstract get active(): InputTab
  abstract get position(): number

  get sectionView() {
    return this.active === "grid" ? this.grid : this.active === "list" ? this.list : undefined
  }
  protected get owner(): string | undefined {
    return undefined
  }
  protected abstract jumpTo(position: number): void
  async goTo(position: number, event: MouseEvent) {
    this.jumpTo(position)
    await tick()
    await this.sectionView?.revealPage(position)
    await this.reveal(event, true)
  }
  async reveal(event?: MouseEvent | KeyboardEvent, jump = false): Promise<number | undefined> {
    const tab = this.active,
      owner = this.owner
    if (tab === "style") return
    await tick()
    if (tab === "list") await tick()
    if (tab !== this.active || owner !== this.owner) return
    const position = this.position
    if (tab === "grid") await this.grid?.revealPage(position)
    if (tab !== this.active || owner !== this.owner || position !== this.position) return
    const selector =
      tab === "page"
        ? ".page-scroll"
        : `${tab === "list" ? ":is(.list-choice, .list-heading)" : ".page-image"}[data-page="${position}"]`
    let control = this.panel?.querySelector<HTMLElement>(selector)
    if (tab === "list" && !control) {
      await this.list?.revealPage(position)
      if (tab !== this.active || owner !== this.owner || position !== this.position) return
      control = this.panel?.querySelector<HTMLElement>(selector)
    }
    control?.scrollIntoView({ block: "nearest" })
    if (event) control?.focus({ preventScroll: true })
    if (control && (jump || (tab !== "page" && !(event instanceof KeyboardEvent)))) {
      const target = control.closest<HTMLElement>(".list-row, .list-section, .composition-card, .page-view")
      if (target) flash(target)
      if (!jump) return position
    }
  }
  focusSelection(touch = false) {
    this.panel
      ?.querySelector<HTMLElement>(
        touch ? ".composition-grid, .page-list, .page-scroll" : ".sequence-entry > .entry > input",
      )
      ?.focus({ preventScroll: true })
  }
}

type Settings = {
  grouped: boolean
  folds?: ReadonlySet<string>
  tocTitles: boolean
  tab: "pages" | "page" | "style"
  pagesMode: "grid" | "list"
  previous?: InputTab
  position: number
  zoom: number
  pageInitialized?: boolean
  offset: number
  region: Region
  alignment?: Region
}

export class InputViews extends Pane {
  #initial: Settings
  #settings = $state.raw<Record<string, Settings>>({})
  #grids = new Map<string, GridViewport>()
  #lists = new Map<string, ListViewport>()
  current = $derived.by(() => this.#settings[this.owner ?? ""] ?? this.#initial)
  constructor(
    initial: InputTab,
    private source: () => Source | undefined,
    sources: () => readonly Source[],
    private tour: () => TourStep | undefined,
    private styleable: () => boolean,
  ) {
    super()
    this.#initial = {
      grouped: true,
      tocTitles: false,
      tab: initial === "grid" || initial === "list" ? "pages" : initial,
      pagesMode: initial === "list" ? "list" : "grid",
      position: 0,
      zoom: 100,
      offset: 0,
      region: { x: 0, y: 0 },
    }
    $effect(() => {
      const retained = new Set(sources().map(({ id }) => id))
      if (this.owner) retained.add(this.owner)
      const stored = untrack(() => this.#settings)
      if (Object.keys(stored).some((id) => !retained.has(id)))
        this.#settings = Object.fromEntries(Object.entries(stored).filter(([id]) => retained.has(id)))
      for (const id of this.#grids.keys()) if (!retained.has(id)) this.#grids.delete(id)
      for (const id of this.#lists.keys()) if (!retained.has(id)) this.#lists.delete(id)
    })
  }
  protected get owner() {
    return this.source()?.id
  }
  protected jumpTo(position: number) {
    this.set({ position, offset: position, alignment: undefined })
  }
  get position() {
    return this.current.position
  }
  get hasStyle() {
    return this.styleable()
  }
  get previous(): InputTab | undefined {
    return this.current.previous
  }
  set previous(value: InputTab | undefined) {
    this.set({ previous: value })
  }
  get active(): InputTab {
    const step = this.tour()
    if (step?.startsWith("style") && this.styleable()) return "style"
    if (step === "input-page") return "page"
    if (step === "input-list") return "list"
    if (step === "input-grid") return "grid"
    const { tab, pagesMode } = this.current
    return tab === "pages" || (tab === "style" && !this.styleable()) ? pagesMode : tab
  }
  titles(id: string) {
    return this.#settings[id]?.tocTitles ?? false
  }
  set(patch: Partial<Settings>, id = this.owner) {
    if (!id) return
    this.#settings = { ...this.#settings, [id]: { ...(this.#settings[id] ?? this.#initial), ...patch } }
  }
  tab(mode: InputTab) {
    const pages = mode === "grid" || mode === "list"
    this.set({
      tab: pages ? "pages" : mode,
      ...(pages ? { pagesMode: mode } : {}),
      ...(mode === "grid" ? { offset: this.position } : {}),
    })
  }
  setZoom(zoom: number) {
    this.set({ zoom, pageInitialized: true, alignment: undefined })
  }
  gridViewport(id: string) {
    if (!this.#grids.has(id)) this.#grids.set(id, { scroll: 0 })
    return this.#grids.get(id)!
  }
  listViewport(id: string) {
    if (!this.#lists.has(id)) this.#lists.set(id, { scroll: 0 })
    return this.#lists.get(id)!
  }
}

export class OutputView extends Pane {
  zoom = $state(100)
  grouped = $state(true)
  folds = $state<ReadonlySet<string>>()
  pageInitialized = $state(false)
  offset = $state(0)
  #tab = $state<"pages" | "page">("pages")
  pagesMode = $state<"grid" | "list">("grid")
  region = $state<Region>({ x: 0, y: 0 })
  readonly gridViewport: GridViewport = { scroll: 0 }
  readonly listViewport: ListViewport = { scroll: 0 }
  previous?: Tab
  constructor(
    initial: Tab,
    private output: Output,
    private tour: () => TourStep | undefined,
  ) {
    super()
    this.tab(initial)
  }
  get position() {
    return this.output.position
  }
  protected jumpTo(position: number) {
    this.output.position = position
    this.offset = position
  }
  get active(): Tab {
    const step = this.tour()
    if (step === "output-page") return "page"
    if (step === "output-list") return "list"
    if (step === "output-grid" || step === "output-selection") return "grid"
    return this.#tab === "pages" ? this.pagesMode : this.#tab
  }
  tab(mode: Tab) {
    this.#tab = mode === "page" ? "page" : "pages"
    if (mode !== "page") this.pagesMode = mode
    if (mode === "grid") this.offset = this.position
  }
  setZoom(zoom: number) {
    this.zoom = zoom
    this.pageInitialized = true
  }
  captureEditFocus(
    key: string,
    selecting: boolean,
    touchPointer: () => boolean,
    touching: () => boolean,
    pendingAddition: ReadonlySet<string>,
  ) {
    const focused = document.activeElement as HTMLElement | null
    const card = focused?.closest<HTMLElement>(".output-pages .composition-card, .composition-output .page-list > li")
    const grid = focused?.matches(".output-pages")
    const pageAction = focused?.closest(".composition-output .page-actions")
    const selectionAction = focused?.closest(".composition-output .sequence-entry") ?? grid
    const menu = focused?.closest<HTMLDetailsElement>(".sequence-options[open]")
    const index = card ? Number(card.dataset.index) : -1
    const inspect = this.output.pages[index]?.id
    const focusSelection = selecting && !!(card || grid)
    return {
      inspect,
      focusSelection,
      restore: (edit: Edit) => {
        const expanded = edit.pages
        const selection = edit.selected
        const destination = card || focusSelection ? edit.position : undefined
        if (destination !== undefined) this.offset = destination
        if (touching()) return
        if (menu) menu.querySelector("summary")?.focus()
        else if (selectionAction)
          void tick().then(() => {
            if (touchPointer() && expanded.length) {
              this.focusSelection(touchPointer())
              return
            }
            if (grid && selecting && destination !== undefined && destination >= 0) {
              ;(pendingAddition.has(selection.at(-1)!)
                ? focused
                : document.getElementById(`${key}-${selection.at(-1)}`)?.querySelector<HTMLElement>(".page-image")
              )?.focus({ preventScroll: true })
              return
            }
            if (!selection.length || !focused?.isConnected || focused.matches(":disabled")) {
              if (expanded.length) this.focusSelection(touchPointer())
              else document.getElementById(`${key}-output-${this.active}`)?.focus({ preventScroll: true })
            } else focused.focus({ preventScroll: true })
          })
        else if (card || pageAction)
          void tick().then(() => {
            if (
              !selecting &&
              focused?.matches(".page-image, .list-choice, .list-heading") &&
              focused?.isConnected &&
              !focused.matches(":disabled") &&
              (!card || expanded.some((page) => `${key}-${page.id}` === card.id))
            ) {
              focused.focus()
              return
            }
            const page = this.output.pages[destination ?? Math.min(index, this.output.pages.length - 1)]
            const neighbor =
              page &&
              (document.getElementById(`${key}-${page.id}`) ??
                this.panel?.querySelector<HTMLElement>(`.list-section[data-index="${destination}"]`))
            const viewport =
              !card && this.output.pages.length ? this.panel?.querySelector<HTMLElement>(".page-scroll") : undefined
            ;(
              (page && pendingAddition.has(page.id)
                ? this.panel?.querySelector<HTMLElement>(".composition-grid, .page-list")
                : neighbor?.querySelector<HTMLButtonElement>(".page-image, .list-choice, .list-heading")) ??
              viewport ??
              document.getElementById(`${key}-output-${this.active}`)
            )?.focus({ preventScroll: !!pageAction || pendingAddition.size > 0 })
          })
      },
    }
  }
}
