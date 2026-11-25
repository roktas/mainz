// Routes workspace shortcuts and coordinates pane changes.

import { onDestroy, onMount, tick } from "svelte"
import {
  collectionHandlesKey,
  cycleTabKey,
  overlayOpen,
  requestedViewTab,
  shortcut,
  shortcutContext,
  stepPageIndex,
} from "./keyboard.ts"
import type { Source } from "./model.ts"
import type { Output } from "./output.svelte.ts"
import type { Transfer } from "./transfer.svelte.ts"
import type { Peeks } from "./Peek.svelte"
import type { Sequence } from "./pages.ts"

import { viewTabs } from "./pane.svelte.ts"
import type { InputTab, InputViews, OutputView, Tab } from "./pane.svelte.ts"
import { zoomLevels } from "./Page.svelte"
import type { TourStep } from "./Tour.svelte"

type Host = {
  input: InputViews
  outputView: OutputView
  tour?: TourStep
  cancelMotion: () => void
  key: string
  source: Source | undefined
  output: Output
  draft: Sequence
  count: number
  opening: boolean
  transfer: Transfer
  peeks: Peeks
  resetPointer: () => void
  originOpen: string | undefined
  outputText: string | undefined
  repetitions: string
  front: boolean
  selectAll: (pane: "Input" | "Output") => void
  copyCurrent: (pane: "Input" | "Output") => void
  clearInput: () => void
  clearOutput: () => void
  editOutput: (action: "remove" | "earlier" | "later", control?: HTMLElement) => boolean
}

export class Interaction {
  view = $state<"input" | "output">("input")
  activeView = $derived.by(() =>
    !this.host.source || this.host.tour?.startsWith("output-") || this.host.tour === "download"
      ? "output"
      : this.host.tour === "input" || this.host.tour?.startsWith("input-") || this.host.tour?.startsWith("style")
        ? "input"
        : this.view,
  )
  private pane(pane: "Input" | "Output") {
    return pane === "Input" ? this.host.input : this.host.outputView
  }
  inputTab(mode: InputTab, event?: MouseEvent | KeyboardEvent) {
    const view = this.host.input
    const previous = view.active
    this.leaving(view, mode)
    view.tab(mode)
    this.entering("Input", previous, mode, event)
  }
  setOutputTab(mode: Tab, event?: MouseEvent | KeyboardEvent) {
    const view = this.host.outputView
    const previous = view.active
    this.leaving(view, mode)
    view.tab(mode)
    this.entering("Output", previous, mode, event)
  }
  private leaving(view: InputViews | OutputView, mode: InputTab) {
    if (mode !== view.active && view.active === "list") view.list?.remember()
    this.host.cancelMotion()
  }
  private entering(pane: "Input" | "Output", previous: InputTab, mode: InputTab, event?: MouseEvent | KeyboardEvent) {
    if (previous === mode) return
    this.rememberView(pane, previous)
    if (!((previous === "grid" || previous === "list") && (mode === "grid" || mode === "list")))
      void this.reveal(pane, event)
  }
  setZoom(pane: "Input" | "Output", zoom: number) {
    this.pane(pane).setZoom(zoom)
  }
  zoomBy(pane: "Input" | "Output", offset: number) {
    const zoom = pane === "Input" ? this.host.input.current.zoom : this.host.outputView.zoom
    this.setZoom(
      pane,
      (offset > 0 ? zoomLevels.find((level) => level > zoom) : zoomLevels.findLast((level) => level < zoom)) ?? zoom,
    )
  }

  usingKeyboard = $state(false)
  touchPointer = $state(false)
  lastShortcutPane: "Input" | "Output" | undefined
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
  private async reveal(pane: "Input" | "Output", event?: MouseEvent | KeyboardEvent) {
    const position = await this.pane(pane).reveal(event)
    if (position === undefined) return
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
    this.pane(pane).focusSelection(this.touchPointer && event?.detail !== 0)
  }
  toggleView(pane: "Input" | "Output", event: MouseEvent | KeyboardEvent) {
    const previous = pane === "Input" ? this.host.input.active : this.host.outputView.active
    const tab =
      previous === "page"
        ? pane === "Input"
          ? this.host.input.current.pagesMode
          : this.host.outputView.pagesMode
        : "page"
    if (pane === "Input") this.inputTab(tab, event)
    else this.setOutputTab(tab, event)
  }
  rememberView(pane: "Input" | "Output", tab: "grid" | "list" | "page" | "style") {
    if (pane === "Input") this.host.input.previous = tab
    else if (tab !== "style") this.host.outputView.previous = tab
  }
  shortcutPane(page = false) {
    const inputAvailable =
      !!this.host.source && (!page || this.host.input.active === "page") && !!this.host.input.panel?.clientWidth
    const outputAvailable =
      (!page || (!!this.host.output.pages.length && this.host.outputView.active === "page")) &&
      !!this.host.outputView.panel?.clientWidth
    const focused = document.activeElement
    const preferred =
      this.pointerX === undefined
        ? focused?.closest(".composition-output")
          ? "output"
          : focused?.closest(".selection-panel")
            ? "input"
            : (this.lastShortcutPane?.toLowerCase() ?? this.activeView)
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
      view:
        preferred === "Input"
          ? this.host.input.active
          : preferred === "Output"
            ? this.host.outputView.active
            : undefined,
    })
    const action = shortcut(event, context, "workspace")
    if (!action) return false
    if (["gridView", "listView", "pageView", "previousView"].includes(action)) {
      if (!preferred) return false
      const tab = requestedViewTab(
        action,
        preferred === "Input" ? this.host.input.previous : this.host.outputView.previous,
      )
      if (!tab || (preferred === "Input" && tab === "style" && !this.host.input.hasStyle)) return false
      event.preventDefault()
      this.lastShortcutPane = preferred
      if (tab === (preferred === "Input" ? this.host.input.active : this.host.outputView.active)) return true
      if (preferred === "Input") this.inputTab(tab)
      else if (tab !== "style") this.setOutputTab(tab)
      if (document.activeElement instanceof HTMLElement) document.activeElement.blur()
      return true
    }
    const all = action === "all"
    const pressed = event.key.toLowerCase()
    const focused = document.activeElement
    if ((action === "left" || action === "right") && !(this.usingKeyboard && focused?.closest(".composition-grid"))) {
      if (preferred) {
        const grid = document
          .getElementById(`${this.host.key}-${preferred === "Input" ? "source" : "output"}-panel`)
          ?.querySelector<HTMLElement>(".composition-grid")
        const hasSelection = preferred === "Input" ? !!this.host.draft.pages.length : !!this.host.output.selection.size
        if (grid && !hasSelection) {
          event.preventDefault()
          if (event.repeat) return true
          const images = grid.querySelectorAll<HTMLButtonElement>(".composition-card:not([inert]) > .page-image")
          const image = action === "left" ? images[images.length - 1] : images[0]
          if (!image) return true
          const position = Number(image.dataset.page)
          if (preferred === "Input") this.host.input.set({ position })
          else this.host.output.position = position
          this.usingKeyboard = true
          image.focus()
          return true
        }
      }
    }
    const preferredPanel = preferred
      ? document.getElementById(`${this.host.key}-${preferred === "Input" ? "source" : "output"}-panel`)
      : undefined
    if (collectionHandlesKey(action, pressed, focused, preferredPanel)) return false
    event.preventDefault()
    const pane = this.shortcutPane(!all && action !== "view")
    if (!pane) return true
    const panel = this.pane(pane).panel
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
          if (pane === "Input") this.host.input.set({ position })
          else this.host.output.position = position
        }
        void this.toggleView(pane, event)
      }
      return true
    }
    this.usingKeyboard = true
    const position = pane === "Input" ? this.host.input.current.position : this.host.output.position
    const total = pane === "Input" ? this.host.count : this.host.output.pages.length
    const viewport = panel?.querySelector<HTMLElement>(".page-scroll")
    const turn = ["left", "right"].includes(action) && !!viewport && viewport.scrollWidth - viewport.clientWidth <= 1
    if (turn || ["next", "previous", "first", "last"].includes(action)) {
      const next = stepPageIndex(action, position, total)
      if (pane === "Input") this.host.input.set({ position: next, alignment: undefined })
      else this.host.output.position = next
      if (focused?.matches(".page-counter, .counter-label > button"))
        void tick().then(() => {
          if (!focused.isConnected && document.activeElement === document.body) viewport?.focus({ preventScroll: true })
        })
    } else if (["left", "right", "up", "down"].includes(action)) {
      viewport?.scrollBy({
        left: action === "left" ? -40 : action === "right" ? 40 : 0,
        top: action === "up" ? -40 : action === "down" ? 40 : 0,
      })
    } else if (["zoomIn", "zoomOut"].includes(action)) this.zoomBy(pane, action === "zoomOut" ? -1 : 1)
    else if (action === "resetZoom") this.setZoom(pane, 100)
    else if (action === "entry") {
      if (!event.repeat)
        panel
          ?.closest(".selection-panel, .composition-output")
          ?.querySelector<HTMLButtonElement>(".page-destination > button")
          ?.click()
    } else if (!event.repeat) {
      this.host.copyCurrent(pane)
    }
    return true
  }
  tabKey = (event: KeyboardEvent, pane: "Input" | "Output" = "Input") => {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    const tabs: ("grid" | "list" | "page" | "style")[] =
      pane === "Input" && this.host.input.hasStyle ? [...viewTabs, "style"] : [...viewTabs]
    const tab = cycleTabKey(event.key, tabs, pane === "Input" ? this.host.input.active : this.host.outputView.active)
    if (!tab) return
    event.preventDefault()
    if (pane === "Input") this.inputTab(tab)
    else if (tab !== "style") this.setOutputTab(tab)
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
    const context = shortcutContext(event, { overlay: overlayOpen("escape") })
    if (shortcut(event, context, "escape") !== "clear") return
    const dismissing = this.host.input.menu?.open || this.host.outputView.menu?.open
    this.host.originOpen = undefined
    if (this.host.input.menu?.open) {
      this.host.input.menu.open = false
      this.host.input.menu.querySelector("summary")?.focus()
    }
    if (this.host.outputView.menu?.open) {
      this.host.outputView.menu.open = false
      this.host.outputView.menu.querySelector("summary")?.focus()
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
    const panel = this.pane(pane).panel
    if (!hasSelection && !panel?.querySelector(".composition-grid, .page-scroll")?.contains(document.activeElement))
      return
    if (pane === "Input") this.host.clearInput()
    else this.host.clearOutput()
    event.preventDefault()
    document
      .getElementById(
        pane === "Output"
          ? `${this.host.key}-output-${this.host.outputView.active}`
          : `${this.host.key}-${this.host.input.active}`,
      )
      ?.focus({ preventScroll: true })
  }
  keydown(event: KeyboardEvent) {
    if (this.host.opening) return
    const action = shortcut(event, shortcutContext(event, { view: this.host.outputView.active }), "output")
    if (!action) return
    const control = event.target
    if (
      !(control instanceof HTMLElement) ||
      (!control.closest(".composer") && control !== document.body) ||
      control.closest("details[open]")
    )
      return
    if (action !== "remove" && action !== "earlier" && action !== "later") return
    if (action === "remove" && event.repeat) return
    if (!this.host.editOutput(action, action === "remove" ? undefined : control)) return
    event.preventDefault()
    this.usingKeyboard = true
  }
}
