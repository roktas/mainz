// Owns pane views, their retained settings, and navigation within their DOM.

import { tick, untrack } from "svelte"
import type Grid from "./Grid.svelte"
import type { Viewport as GridViewport } from "./Grid.svelte"
import type List from "./List.svelte"
import type { Viewport as ListViewport } from "./List.svelte"
import type Page from "./Page.svelte"
import type { Controls, Region } from "./Page.svelte"
import type { Source } from "./model.ts"
import type { Output } from "./output.svelte.ts"
import type { TourStep } from "./Tour.svelte"
import { flash } from "./motion.ts"

export const viewTabs = ["grid", "list", "page"] as const
export const viewLabels = { grid: "Grid", list: "List", page: "Page" }
export type Tab = (typeof viewTabs)[number]
export type InputTab = Tab | "style"

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
    const control = this.panel?.querySelector<HTMLElement>(
      tab === "page"
        ? ".page-scroll"
        : `${tab === "list" ? ":is(.list-choice, .list-heading)" : ".page-image"}[data-page="${position}"]`,
    )
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
  previous?: InputTab
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
  get position() {
    return this.current.position
  }
  get hasStyle() {
    return this.styleable()
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
}
