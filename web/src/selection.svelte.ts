// Owns Input and Output selection sequences, touch double-tap disambiguation, and range highlights.

import { copyError } from "./model.ts"
import type { Source } from "./model.ts"
import type { InputViews, OutputView } from "./pane.svelte.ts"
import type { Output } from "./output.svelte.ts"
import { pageRanges, parseSequence, toggleGroup, toggleSequence } from "./pages.ts"
import type { Sequence } from "./pages.ts"
import type { Interaction } from "./interaction.svelte.ts"

export type PaneName = "Input" | "Output"
export type Highlight =
  | { kind: "source"; source: string; first: number; last: number }
  | { kind: "output"; ids: ReadonlySet<string>; removing?: boolean }

type SelectionHost = {
  readonly source: Source | undefined
  readonly output: Output
  readonly sequence: Sequence | undefined
  readonly inputViews: InputViews
  readonly outputView: OutputView
  readonly interaction: Interaction
  choose: (id: string, sequence: Sequence) => void
  onDoubleClickInput: (page: number) => void
  resetRepeat: () => void
}

export class Selection {
  outputText = $state<string>()
  highlight = $state<Highlight>()

  #touchTap: { pane: PaneName; element: EventTarget | null; time: number; restore: () => void } | undefined
  #sourceAnchor: { source: string; page: number } | undefined
  #inputClick:
    | { source: string; page: number; sequence: Sequence; anchor: { source: string; page: number } | undefined }
    | undefined
  #highlightTimeout: ReturnType<typeof setTimeout> | undefined

  readonly count = $derived.by(() => this.host.source?.input.pdf.numPages ?? 0)
  readonly draft: Sequence = $derived.by(
    () =>
      this.host.sequence ?? {
        text: "",
        pages: [],
        repeat: "1",
        front: false,
      },
  )
  readonly parsed = $derived.by(() => parseSequence(this.draft.text, this.count))
  readonly invalid = $derived.by(() => !!this.parsed.error)
  readonly selectionError = $derived.by(() => this.parsed.error ?? copyError(this.draft.repeat))
  readonly outputSelection = $derived.by(() => parseSequence(this.outputText ?? "", this.host.output.pages.length))
  readonly outputSelectionError = $derived.by(() =>
    this.outputText === undefined ? undefined : this.outputSelection.error,
  )
  readonly inputSelected = $derived.by(() => new Set(this.draft.pages))

  constructor(private host: SelectionHost) {}

  resetPointer() {
    this.#touchTap = undefined
  }

  resetSource() {
    if (this.#touchTap?.pane === "Input") this.#touchTap = undefined
    this.#inputClick = undefined
  }

  dispose() {
    clearTimeout(this.#highlightTimeout)
  }

  snapshot() {
    const inputSnapshot = this.draft
    const inputId = this.host.source?.id
    const inputFrom = this.host.inputViews.position
    const anchor = this.#sourceAnchor
    const selection = this.host.output.selection
    const outputFrom = this.host.output.position
    const outputAnchor = this.host.output.anchor
    const text = this.outputText
    return () => {
      if (inputId) {
        this.host.choose(inputId, inputSnapshot)
        this.host.inputViews.set({ position: inputFrom }, inputId)
        this.#sourceAnchor = anchor
      }
      this.host.output.select(selection, outputAnchor)
      this.host.output.position = outputFrom
      this.outputText = text
    }
  }

  set(patch: Partial<Sequence>) {
    if (this.host.source) this.host.choose(this.host.source.id, { ...this.draft, ...patch })
  }

  numbers = (text: string) => {
    if (!this.host.source) return
    this.highlightRange()
    const next = parseSequence(text, this.count)
    this.set({ text, pages: next.error ? this.draft.pages : next.pages })
    this.#sourceAnchor = undefined
  }

  selectAll(pane: PaneName) {
    if (pane === "Input") {
      if (this.count) this.numbers(`1${this.count > 1 ? `-${this.count}` : ""}`)
    } else {
      this.host.output.select(this.host.output.pages.map((page) => page.id))
      this.outputText = undefined
    }
  }

  clearInput() {
    if (!this.host.source) return
    if (this.highlight?.kind === "source") this.highlightRange()
    this.set({ text: "", pages: [], repeat: "1", front: false })
    this.#sourceAnchor = undefined
  }

  outputNumbers = (text: string) => {
    this.highlightRange()
    this.outputText = text
    const next = this.outputSelection
    if (!next.error) {
      this.host.output.select(next.pages.map((index) => this.host.output.pages[index].id))
    }
  }

  clearOutput() {
    this.highlightRange()
    this.host.output.select([])
    this.outputText = undefined
    this.host.resetRepeat()
  }

  toggle(page: number, range: boolean, origin?: number) {
    const source = this.host.source
    if (!source) return
    const anchor = this.#sourceAnchor?.source === source.id ? this.#sourceAnchor.page : origin
    const { pages, first, last, adding } = toggleSequence(this.draft.pages, page, range ? anchor : undefined)
    this.numbers(pageRanges(pages))
    this.#sourceAnchor = { source: source.id, page }
    this.highlightRange(
      adding && range && first < last ? { kind: "source", source: source.id, first, last } : undefined,
    )
  }

  selectedSection(pane: PaneName, first: number, end: number) {
    const limit = Math.min(end, pane === "Input" ? this.count : this.host.output.pages.length)
    for (let index = Math.max(0, first); index < limit; index++)
      if (
        pane === "Input"
          ? this.inputSelected.has(index)
          : this.host.output.selection.has(this.host.output.pages[index].id)
      )
        return true
    return false
  }

  selectSection(pane: PaneName, first: number, end: number) {
    if (pane === "Input") {
      const source = this.host.source
      if (!source || end <= first) return
      const pages = Array.from({ length: end - first }, (_, index) => first + index)
      this.numbers(pageRanges(toggleGroup(this.draft.pages, pages)))
      this.#sourceAnchor = { source: source.id, page: first }
    } else {
      const slice = this.host.output.pages.slice(first, end)
      if (!slice.length) return
      const ids = slice.map((page) => page.id)
      this.outputText = undefined
      this.host.output.select(toggleGroup([...this.host.output.selection], ids), slice[0].id)
      this.highlightRange()
    }
  }

  selectInput(page: number, event: MouseEvent, sectionEnd?: number) {
    const source = this.host.source
    if (!source) return
    this.host.inputViews.set({ position: page })
    if (this.#touchPage("Input", event)) return
    if (event.ctrlKey || event.metaKey) {
      void this.host.interaction.toggleView("Input", event)
      return
    }
    if (event.detail > 1) return
    if (event.detail === 1)
      this.#inputClick = { source: source.id, page, sequence: this.draft, anchor: this.#sourceAnchor }
    if (sectionEnd !== undefined && !event.shiftKey) this.selectSection("Input", page, sectionEnd)
    else this.toggle(page, event.shiftKey)
    if (event.detail) (event.currentTarget as HTMLElement).focus({ preventScroll: true })
  }

  selectInputRow(page: number, event: MouseEvent) {
    const source = this.host.source
    if (!source) return
    const id = source.id,
      previous = this.draft,
      anchor = this.#sourceAnchor
    this.selectInput(page, event)
    return () => {
      if (this.host.source?.id !== id) return
      this.host.choose(id, previous)
      this.#sourceAnchor = anchor
      this.highlightRange()
    }
  }

  restoreInput(page: number) {
    const source = this.host.source
    if (!source || this.#inputClick?.source !== source.id || this.#inputClick.page !== page) return
    this.host.choose(source.id, this.#inputClick.sequence)
    this.#sourceAnchor = this.#inputClick.anchor
    this.highlightRange()
    this.#inputClick = undefined
  }

  doubleClickInput(page: number, event: MouseEvent) {
    const source = this.host.source
    if (
      !this.host.interaction.touchPointer &&
      !event.ctrlKey &&
      !event.metaKey &&
      source &&
      this.#inputClick?.source === source.id &&
      this.#inputClick.page === page
    ) {
      this.restoreInput(page)
      this.host.onDoubleClickInput(page)
    }
  }

  selectOutput(id: string, range: boolean, anchor?: string) {
    this.outputText = undefined
    const next = this.host.output.toggle(id, range, anchor)
    const { index, ids, adding } = next
    if (this.host.outputView.active === "grid") this.host.output.position = index
    this.highlightRange(adding && range && ids.length > 1 ? { kind: "output", ids: new Set(ids) } : undefined)
  }

  activateOutput(index: number, event: MouseEvent, end = index + 1) {
    const target = this.host.output.pages[index]
    if (!target) return
    this.host.output.position = index
    if (this.#touchPage("Output", event)) return
    if (event.ctrlKey || event.metaKey) {
      void this.host.interaction.toggleView("Output", event)
      return
    }
    if (event.detail > 1) return
    const selected = this.host.output.selection
    const anchor = this.host.output.anchor
    const text = this.outputText
    if (end > index + 1 && !event.shiftKey) this.selectSection("Output", index, end)
    else this.selectOutput(target.id, event.shiftKey)
    return () => {
      this.host.output.select([...selected], anchor)
      this.outputText = text
      this.highlightRange()
    }
  }

  highlightRange(next?: Highlight) {
    clearTimeout(this.#highlightTimeout)
    this.highlight = next
    if (next) this.#highlightTimeout = setTimeout(() => (this.highlight = undefined), 700)
  }

  #touchPage(pane: PaneName, event: MouseEvent) {
    if (!this.host.interaction.touchPointer || !event.detail || event.ctrlKey || event.metaKey || event.altKey) {
      this.#touchTap = undefined
      return false
    }
    const now = performance.now()
    if (this.#touchTap?.element === event.currentTarget && now - this.#touchTap.time < 350) {
      this.#touchTap.restore()
      this.#touchTap = undefined
      void this.host.interaction.toggleView(pane, event)
      return true
    }
    const prepared = this.draft,
      id = this.host.source?.id,
      anchor = this.#sourceAnchor
    const selection = this.host.output.selection,
      text = this.outputText,
      outputFrom = this.host.output.anchor
    this.#touchTap = {
      pane,
      element: event.currentTarget,
      time: now,
      restore: () => {
        if (pane === "Input" && id) {
          this.host.choose(id, prepared)
          this.#sourceAnchor = anchor
          this.#inputClick = undefined
        } else {
          this.host.output.select(selection, outputFrom)
          this.outputText = text
        }
        this.highlightRange()
      },
    }
    return false
  }
}
