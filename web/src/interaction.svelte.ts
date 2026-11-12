// Owns pane targeting, keyboard dispatch, view returns, and focus recovery.

import { onDestroy, onMount, tick } from "svelte"
import { shortcut, shortcutContext } from "./keyboard.ts"
import { flash } from "./motion.ts"
import type { Source } from "./model.ts"
import type { Output, Edit } from "./output.svelte.ts"
import type { Transfer } from "./transfer.svelte.ts"
import type { Peeks } from "./Peek.svelte"
import type { Sequence } from "./pages.ts"
import type { Region } from "./Page.svelte"

export type InputView = {
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

type Host = {
  key: string
  source: Source | undefined
  activeTab: "grid" | "list" | "page" | "style"
  activeOutputTab: "grid" | "list" | "page"
  activeView: "input" | "output"
  inputPosition: number
  output: Output
  inputView: InputView
  outputPagesMode: "grid" | "list"
  revealGrid: (pane: "Input" | "Output", index: number) => Promise<void> | undefined
  draft: Sequence
  count: number
  opening: boolean
  transfer: Transfer
  peeks: Peeks
  resetPointer: () => void
  inputMenu: HTMLDetailsElement
  outputMenu: HTMLDetailsElement
  originOpen: string | undefined
  outputText: string | undefined
  repetitions: string
  front: boolean
  outputSelectionError: string | undefined
  outputOffset: number
  pendingAddition: ReadonlySet<string>
  styleable: boolean
  inputTab: (tab: "grid" | "list" | "page" | "style", event?: MouseEvent | KeyboardEvent) => void
  setOutputTab: (tab: "grid" | "list" | "page", event?: MouseEvent | KeyboardEvent) => void
  inspectInput: (patch: Partial<InputView>) => void
  selectAll: (pane: "Input" | "Output") => void
  zoomBy: (pane: "Input" | "Output", offset: number) => void
  setZoom: (pane: "Input" | "Output", zoom: number) => void
  editPage: (pane: "Input" | "Output") => void
  copyCurrent: (pane: "Input" | "Output") => void
  clearInput: () => void
  clearOutput: () => void
  outputTargets: () => string[]
  remove: (ids: string[]) => void
  order: (offset: number, ids: string[]) => void
}

export class Interaction {
  usingKeyboard = $state(false)
  touchPointer = $state(false)
  pointerX: number | undefined
  returning = $state<{ kind: "source"; source: string; page: number } | { kind: "output"; id: string } | undefined>()
  returnTimeout: ReturnType<typeof setTimeout> | undefined
  constructor(private host: Host) {
    onMount(() => {
      const capture = (event: KeyboardEvent) => this.capture(event)
      const keydown = (event: KeyboardEvent) => this.keydown(event)
      window.addEventListener("keydown", capture, true)
      window.addEventListener("keydown", keydown)
      return () => {
        window.removeEventListener("keydown", capture, true)
        window.removeEventListener("keydown", keydown)
      }
    })
    onDestroy(() => this.cancelReturn())
  }
  cancelReturn() {
    clearTimeout(this.returnTimeout)
    this.returning = undefined
  }
  async reveal(pane: "Input" | "Output", event?: MouseEvent | KeyboardEvent, jump = false) {
    const tab = pane === "Input" ? this.host.activeTab : this.host.activeOutputTab
    const expectedSource = this.host.source?.id
    if (tab === "style") return
    await tick()
    if (tab === "list") await tick()
    if (
      tab !== (pane === "Input" ? this.host.activeTab : this.host.activeOutputTab) ||
      (pane === "Input" && expectedSource !== this.host.source?.id)
    )
      return
    const position = pane === "Input" ? this.host.inputPosition : this.host.output.position
    if (tab === "grid") await this.host.revealGrid(pane, position)
    const panel = document.getElementById(`${this.host.key}-${pane === "Input" ? "source" : "output"}-panel`),
      control =
        tab === "page"
          ? panel?.querySelector<HTMLElement>(".page-scroll")
          : panel?.querySelector<HTMLElement>(
              `${tab === "list" ? ":is(.list-choice, .list-heading)" : ".page-image"}[data-page="${position}"]`,
            )
    control?.scrollIntoView({ block: "nearest" })
    if (event) control?.focus({ preventScroll: true })
    if (jump && control) {
      const target = control.closest<HTMLElement>(".list-row, .list-section, .composition-card, .page-view")
      if (target) flash(target)
      return
    }
    if (!control || tab === "page" || event instanceof KeyboardEvent) return
    const target = control.closest<HTMLElement>(".list-row, .list-section, .composition-card")
    if (target) flash(target)
    clearTimeout(this.returnTimeout)
    this.returning =
      pane === "Input" && this.host.source
        ? { kind: "source", source: this.host.source.id, page: position }
        : this.host.output.pages[position]
          ? { kind: "output", id: this.host.output.pages[position].id }
          : undefined
    this.returnTimeout = setTimeout(() => (this.returning = undefined), 1200)
  }
  focusPage(control: HTMLElement) {
    const page = control
      .closest(".composition-card, .page-view")
      ?.querySelector<HTMLElement>(".page-image, .page-scroll")
    page?.focus({ preventScroll: true })
  }
  focusAfterSelection(pane: "Input" | "Output", event?: MouseEvent) {
    const control =
      this.touchPointer && event?.detail !== 0
        ? document
            .getElementById(`${this.host.key}-${pane === "Input" ? "source" : "output"}-panel`)
            ?.querySelector<HTMLElement>(".composition-grid, .page-list, .page-scroll")
        : document.getElementById(`${this.host.key}-${pane === "Input" ? "input" : "output"}-selection`)
    control?.focus({ preventScroll: true })
  }
  toggleView(pane: "Input" | "Output", event: MouseEvent | KeyboardEvent) {
    const previous = pane === "Input" ? this.host.activeTab : this.host.activeOutputTab
    const tab =
      previous === "page" ? (pane === "Input" ? this.host.inputView.pagesMode : this.host.outputPagesMode) : "page"
    if (pane === "Input") this.host.inputTab(tab, event)
    else this.host.setOutputTab(tab, event)
  }
  shortcutPane(page = false) {
    const inputAvailable =
      !!this.host.source &&
      (!page || this.host.activeTab === "page") &&
      !!document.getElementById(`${this.host.key}-source-panel`)?.clientWidth
    const outputAvailable =
      (!page || (!!this.host.output.pages.length && this.host.activeOutputTab === "page")) &&
      !!document.getElementById(`${this.host.key}-output-panel`)?.clientWidth
    const focused = document.activeElement
    const preferred =
      this.pointerX === undefined
        ? focused?.closest(".composition-output")
          ? "output"
          : focused?.closest(".selection-panel")
            ? "input"
            : this.host.activeView
        : this.pointerX < innerWidth / 2
          ? "input"
          : "output"
    if (preferred === "input" && inputAvailable) return "Input"
    if (preferred === "output" && outputAvailable) return "Output"
    return inputAvailable ? "Input" : outputAvailable ? "Output" : undefined
  }
  shortcuts(event: KeyboardEvent) {
    const preferred = this.shortcutPane()
    const context = shortcutContext(event, {
      pane: preferred,
      view: preferred === "Input" ? this.host.activeTab : this.host.activeOutputTab,
    })
    const action = shortcut(event, context, "workspace")
    if (!action) return false
    const all = action === "all"
    const pressed = event.key.toLowerCase()
    const focused = document.activeElement
    if ((action === "left" || action === "right") && !(this.usingKeyboard && focused?.closest(".composition-grid"))) {
      const pane = this.shortcutPane()
      const grid = document
        .getElementById(`${this.host.key}-${pane === "Input" ? "source" : "output"}-panel`)
        ?.querySelector<HTMLElement>(".composition-grid")
      const hasSelection = pane === "Input" ? !!this.host.draft.pages.length : !!this.host.output.selection.size
      if (grid && !hasSelection) {
        event.preventDefault()
        if (event.repeat) return true
        const images = grid.querySelectorAll<HTMLButtonElement>(".composition-card:not([inert]) > .page-image")
        const image = action === "left" ? images[images.length - 1] : images[0]
        if (!image) return true
        const position = Number(image.dataset.page)
        if (pane === "Input") this.host.inspectInput({ position })
        else this.host.output.position = position
        this.usingKeyboard = true
        image.focus()
        return true
      }
    }
    if (
      (focused?.closest(".grid-view") && ["pageup", "pagedown"].includes(pressed)) ||
      (["pageup", "pagedown"].includes(pressed) &&
        document
          .getElementById(`${this.host.key}-${this.shortcutPane() === "Input" ? "source" : "output"}-panel`)
          ?.querySelector(".grid-view")) ||
      (focused?.closest(".composition-grid") &&
        ["left", "right", "up", "down", "first", "last", "next", "previous", "copy"].includes(action)) ||
      (focused?.closest(".composition-grid") && ["zoomIn", "zoomOut"].includes(action)) ||
      (focused?.closest(".page-list") &&
        [
          "left",
          "right",
          "up",
          "down",
          "first",
          "last",
          "next",
          "previous",
          "copy",
          "zoomIn",
          "zoomOut",
          "resetZoom",
          "entry",
        ].includes(action))
    )
      return false
    event.preventDefault()
    const pane = this.shortcutPane(!all && action !== "view")
    if (!pane) return true
    const panel = document.getElementById(`${this.host.key}-${pane === "Input" ? "source" : "output"}-panel`)
    if (all) {
      if (!event.repeat) {
        this.host.selectAll(pane)
        void tick().then(() => {
          if (focused instanceof HTMLElement && !focused.isConnected)
            document
              .getElementById(`${this.host.key}-${pane === "Input" ? "input" : "output"}-selection`)
              ?.focus({ preventScroll: true })
        })
      }
      return true
    }
    if (action === "view") {
      if (!event.repeat) {
        this.usingKeyboard = true
        if (focused instanceof HTMLElement && focused.matches(".page-image") && panel?.contains(focused)) {
          const position = Number(focused.dataset.page)
          if (pane === "Input") this.host.inspectInput({ position })
          else this.host.output.position = position
        }
        void this.toggleView(pane, event)
      }
      return true
    }
    this.usingKeyboard = true
    const position = pane === "Input" ? this.host.inputPosition : this.host.output.position
    const total = pane === "Input" ? this.host.count : this.host.output.pages.length
    const viewport = panel?.querySelector<HTMLElement>(".page-scroll")
    const turn = ["left", "right"].includes(action) && !!viewport && viewport.scrollWidth - viewport.clientWidth <= 1
    if (turn || ["next", "previous", "first", "last"].includes(action)) {
      const next =
        action === "first"
          ? 0
          : action === "last"
            ? total - 1
            : Math.max(0, Math.min(total - 1, position + (["previous", "left"].includes(action) ? -1 : 1)))
      if (pane === "Input") this.host.inspectInput({ position: next, alignment: undefined })
      else this.host.output.position = next
    } else if (["left", "right", "up", "down"].includes(action)) {
      viewport?.scrollBy({
        left: action === "left" ? -40 : action === "right" ? 40 : 0,
        top: action === "up" ? -40 : action === "down" ? 40 : 0,
      })
    } else if (["zoomIn", "zoomOut"].includes(action)) this.host.zoomBy(pane, action === "zoomOut" ? -1 : 1)
    else if (action === "resetZoom") this.host.setZoom(pane, 100)
    else if (action === "entry") {
      if (!event.repeat) this.host.editPage(pane)
    } else if (!event.repeat) {
      this.host.copyCurrent(pane)
    }
    return true
  }
  captureEditFocus(selecting: boolean) {
    const focused = document.activeElement as HTMLElement | null
    const card = focused?.closest<HTMLElement>(".output-pages .composition-card, .composition-output .page-list > li")
    const grid = focused?.matches(".output-pages")
    const pageAction = focused?.closest(".composition-output .page-actions")
    const selectionAction = focused?.closest(".composition-output .sequence-entry") ?? grid
    const menu = focused?.closest<HTMLDetailsElement>(".sequence-options[open]")
    const index = this.host.output.pages.findIndex((page) => `${this.host.key}-${page.id}` === card?.id)
    const inspect = this.host.output.pages[index]?.id
    const focusSelection = selecting && !!(card || grid)
    return {
      inspect,
      focusSelection,
      restore: (edit: Edit) => {
        const expanded = edit.pages
        const selection = edit.selected
        const destination = card || focusSelection ? edit.position : undefined
        if (destination !== undefined) this.host.outputOffset = destination
        if (this.host.transfer.touching) return
        if (menu) menu.querySelector("summary")?.focus()
        else if (selectionAction)
          void tick().then(() => {
            if (this.touchPointer && expanded.length) {
              this.focusAfterSelection("Output")
              return
            }
            if (grid && selecting && destination !== undefined && destination >= 0) {
              ;(this.host.pendingAddition.has(selection.at(-1)!)
                ? focused
                : document
                    .getElementById(`${this.host.key}-${selection.at(-1)}`)
                    ?.querySelector<HTMLElement>(".page-image")
              )?.focus({ preventScroll: true })
              return
            }
            if (!selection.length || !focused?.isConnected || focused.matches(":disabled")) {
              if (expanded.length) this.focusAfterSelection("Output")
              else
                document
                  .getElementById(`${this.host.key}-output-${this.host.activeOutputTab}`)
                  ?.focus({ preventScroll: true })
            } else focused.focus({ preventScroll: true })
          })
        else if (card || pageAction)
          void tick().then(() => {
            if (
              !selecting &&
              focused?.matches(".page-image, .list-choice") &&
              focused?.isConnected &&
              !focused.matches(":disabled") &&
              (!card || expanded.some((page) => `${this.host.key}-${page.id}` === card.id))
            ) {
              focused.focus()
              return
            }
            const page = this.host.output.pages[destination ?? Math.min(index, this.host.output.pages.length - 1)]
            const neighbor = page && document.getElementById(`${this.host.key}-${page.id}`)
            const viewport =
              !card && this.host.output.pages.length
                ? document.getElementById(`${this.host.key}-output-panel`)?.querySelector<HTMLElement>(".page-scroll")
                : undefined
            ;(
              (page && this.host.pendingAddition.has(page.id)
                ? document
                    .getElementById(`${this.host.key}-output-panel`)
                    ?.querySelector<HTMLElement>(".composition-grid")
                : neighbor?.querySelector<HTMLButtonElement>(".page-image, .list-choice")) ??
              viewport ??
              document.getElementById(`${this.host.key}-output-${this.host.activeOutputTab}`)
            )?.focus({ preventScroll: !!pageAction || this.host.pendingAddition.size > 0 })
          })
      },
    }
  }
  tabKey = (event: KeyboardEvent, pane: "Input" | "Output" = "Input") => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const viewTabs = ["grid", "list", "page"] as const
    const tabs: ("grid" | "list" | "page" | "style")[] =
      pane === "Input" && this.host.styleable ? [...viewTabs, "style"] : [...viewTabs]
    const index = tabs.indexOf(pane === "Input" ? this.host.activeTab : this.host.activeOutputTab)
    const tab =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs.at(-1)!
          : tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
    if (pane === "Input") this.host.inputTab(tab)
    else if (tab !== "style") this.host.setOutputTab(tab)
    document.getElementById(`${this.host.key}-${pane === "Input" ? "" : "output-"}${tab}`)?.focus()
  }
  capture(event: KeyboardEvent) {
    this.host.resetPointer()
    this.touchPointer = false
    if (event.key === "Escape" && (this.host.transfer.value || this.host.transfer.pressing)) {
      this.host.transfer.end()
      event.preventDefault()
      event.stopPropagation()
      return
    }
    if (this.host.peeks.dismiss(event)) return
    if (
      event.target instanceof Element &&
      event.target.closest(".page-list") &&
      shortcut(event, shortcutContext(event, { pane: this.shortcutPane(), view: "list" }), "list")
    )
      return
    if (this.host.opening || (event.target instanceof Element && event.target.closest(".message-details"))) return
    if (event.key === "Escape" && event.target instanceof HTMLElement && event.target.closest(".page-jump")) return
    if (this.shortcuts(event)) return
    if (
      ["Tab", "Enter", " "].includes(event.key) &&
      (!event.shiftKey || event.key === "Tab") &&
      !event.isComposing &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    )
      this.usingKeyboard = true
    const context = shortcutContext(event, {
      overlay: !!document.querySelector(
        "dialog[open], [popover]:popover-open:not(.header-feedback), .input-picker[open], .document-menu[open], .lens, .quartet-panel, .control details:is([open], [data-hover-pending])",
      ),
    })
    if (shortcut(event, context, "escape") !== "clear") return
    const dismissing =
      !!this.host.transfer.value ||
      !!document.querySelector(".page-origin > :popover-open") ||
      this.host.inputMenu?.open ||
      this.host.outputMenu?.open
    this.host.transfer.end()
    this.host.originOpen = undefined
    if (this.host.inputMenu?.open) {
      this.host.inputMenu.open = false
      this.host.inputMenu.querySelector("summary")?.focus()
    }
    if (this.host.outputMenu?.open) {
      this.host.outputMenu.open = false
      this.host.outputMenu.querySelector("summary")?.focus()
    }
    if (dismissing) return
    const pane = this.shortcutPane()
    if (!pane) return
    const hasSelection =
      pane === "Input"
        ? !!this.host.draft.text ||
          !!this.host.draft.pages.length ||
          this.host.draft.repeat !== "1" ||
          this.host.draft.front
        : !!this.host.output.selection.size ||
          !!this.host.outputText ||
          this.host.repetitions !== "2" ||
          this.host.front
    const panel = document.getElementById(`${this.host.key}-${pane === "Input" ? "source" : "output"}-panel`)
    if (!hasSelection && !panel?.querySelector(".composition-grid")?.contains(document.activeElement)) return
    if (pane === "Input") this.host.clearInput()
    else this.host.clearOutput()
    event.preventDefault()
    document
      .getElementById(
        pane === "Output"
          ? `${this.host.key}-output-${this.host.activeOutputTab}`
          : `${this.host.key}-${this.host.activeTab}`,
      )
      ?.focus({ preventScroll: true })
  }
  keydown(event: KeyboardEvent) {
    if (this.host.opening) return
    const action = shortcut(event, shortcutContext(event, { view: this.host.activeOutputTab }), "output")
    if (!action) return
    const control = event.target
    if (
      !(control instanceof HTMLElement) ||
      (!control.closest(".composer") && control !== document.body) ||
      control.closest("details[open]")
    )
      return
    const row = control.closest(".composition-output .composition-card, .composition-output .list-row")
    const focusedId = row && this.host.output.pages.find((page) => `${this.host.key}-${page.id}` === row.id)?.id
    const ids =
      this.host.output.selection.size || action === "remove"
        ? this.host.outputTargets()
        : !this.host.outputSelectionError && focusedId
          ? [focusedId]
          : []
    if (!ids.length) return
    event.preventDefault()
    this.usingKeyboard = true
    if (action === "remove") {
      if (!event.repeat) this.host.remove(ids)
    } else this.host.order(action === "earlier" ? -1 : 1, ids)
  }
}
