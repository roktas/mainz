// Owns pane page selections, Output edits, edit motion, and transfer mediation.

import { tick } from "svelte"
import { copyError, parseCopies, sizeOf, uid } from "./model.ts"
import type { Content, Expanded, Page, Part, Source } from "./model.ts"
import { titlesOf } from "./outline.ts"
import type { InputViews, OutputView } from "./pane.svelte.ts"
import * as composition from "./composition.ts"
import type { Edit, Output } from "./output.svelte.ts"
import { pageRanges, parseSequence, toggleGroup, toggleSequence } from "./pages.ts"
import type { Sequence } from "./pages.ts"
import type { Interaction } from "./interaction.svelte.ts"
import type { Payload, Transfer } from "./transfer.svelte.ts"
import { animateAddition, animateMove, animateOrder, animateRemoval, Edits, inert } from "./motion.ts"
import type { Peeks } from "./Peek.svelte"

export type PaneName = "Input" | "Output"
export type OutputTarget = { kind: "focused" | "individual"; first: number; end?: number } | { kind: "current" }
export type OutputAction = "duplicate" | "remove" | "earlier" | "later"
export type InputChoice = Extract<Payload, { kind: "source" }>["choice"]
export type Highlight =
  | { kind: "source"; source: string; first: number; last: number }
  | { kind: "output"; ids: ReadonlySet<string>; removing?: boolean }

type EditFocus = {
  inspect?: string
  focusSelection: boolean
  restore: (edit: Edit) => void
}

type Host = {
  readonly key: string
  readonly source: Source | undefined
  readonly sources: readonly Source[]
  readonly output: Output
  readonly sequence: Sequence | undefined
  readonly inputViews: InputViews
  readonly outputView: OutputView
  readonly interaction: Interaction
  readonly transfer: Transfer
  readonly peeks: Peeks
  readonly outputTarget: HTMLButtonElement | undefined
  captureEditFocus: (selecting: boolean) => EditFocus | undefined
  choose: (id: string, sequence: Sequence) => void
  change: (text: string) => void
  error: (message: string) => void
  activate: (id: string) => void
}

const preparation = { kind: "preparation" } as const

export class Editing {
  comparing = $state(false)
  outputText = $state<string>()
  repetitions = $state("2")
  front = $state(false)
  originOpen = $state<string>()
  highlight = $state<Highlight>()
  readonly feedback: Edits

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
  readonly inspected = $derived.by(() => this.host.output.pages[this.host.output.position])
  readonly selectedIds = $derived.by(() => this.host.output.selection)
  readonly positions = $derived.by(() => this.host.output.selected.map((id) => this.host.output.positions.get(id)!))
  readonly chosen = $derived.by(() => this.positions.map((index) => this.host.output.pages[index]))
  readonly insertion = $derived.by(() => (this.positions.length ? this.positions.at(-1)! + 1 : undefined))
  readonly outputSelection = $derived.by(() => parseSequence(this.outputText ?? "", this.host.output.pages.length))
  readonly outputSelectionError = $derived.by(() =>
    this.outputText === undefined ? undefined : this.outputSelection.error,
  )
  readonly adjacent = $derived.by(() =>
    this.positions.every((position, i) => i === 0 || position === this.positions[i - 1] + 1),
  )
  readonly repeatError = $derived.by(() => copyError(this.repetitions))
  readonly inputSelected = $derived.by(() => new Set(this.draft.pages))

  constructor(private host: Host) {
    this.feedback = new Edits(host.key)
  }

  resetPointer = () => {
    this.#touchTap = undefined
  }

  resetSource = () => {
    if (this.#touchTap?.pane === "Input") this.#touchTap = undefined
    this.#inputClick = undefined
    this.host.transfer.cancelInput()
  }

  dispose = () => {
    this.host.transfer.end(true)
    clearTimeout(this.#highlightTimeout)
    this.cancelMotion()
  }

  provenance = (content: Content) =>
    "source" in content ? this.host.sources.find((item) => item.id === content.source) : undefined

  displayName = (origin: Source | undefined, page: number) =>
    origin ? titlesOf(origin.input).at(page, this.host.inputViews.titles(origin.id)).name : undefined

  pageName = (content: Content) =>
    "source" in content ? this.displayName(this.provenance(content), content.page) : undefined

  transferName = () => {
    const value = this.host.transfer.value
    if (!value) return ""
    if (value.kind === "source") {
      const page =
        value.choice.kind === "page"
          ? value.choice.page
          : value.choice.kind === "pages"
            ? value.choice.pages[0]
            : this.parsed.pages[0]
      return (
        this.displayName(
          this.host.sources.find((item) => item.id === value.source),
          page,
        ) ?? `Page ${page + 1}`
      )
    }
    const page = this.host.output.pages.find((item) => item.id === value.ids[0])
    return page
      ? (this.pageName(page.content) ??
          ("page" in page.content ? `Page ${page.content.page + 1}` : page.padding ? "Padding" : "Blank"))
      : ""
  }

  showOriginal = () => {
    const inspected = this.inspected
    if (!inspected || !("source" in inspected.content)) return
    if (this.host.outputView.menu) this.host.outputView.menu.open = false
    const { source: id, page } = inspected.content
    this.host.inputViews.set(
      {
        tab: "page",
        position: page,
        zoom: this.host.outputView.zoom,
        pageInitialized: true,
        region: { ...this.host.outputView.region },
        alignment: { ...this.host.outputView.region },
      },
      id,
    )
    this.host.activate(id)
    this.host.interaction.view = "input"
  }

  set = (patch: Partial<Sequence>) => {
    if (this.host.source) this.host.choose(this.host.source.id, { ...this.draft, ...patch })
  }

  numbers = (text: string) => {
    if (!this.host.source) return
    this.highlightRange()
    const next = parseSequence(text, this.count)
    this.set({ text, pages: next.error ? this.draft.pages : next.pages })
    this.#sourceAnchor = undefined
  }

  selectAll = (pane: PaneName) => {
    if (pane === "Input") {
      if (this.count) this.numbers(`1${this.count > 1 ? `-${this.count}` : ""}`)
    } else {
      this.host.output.select(this.host.output.pages.map((page) => page.id))
      this.outputText = undefined
    }
  }

  clearInput = () => {
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

  clearOutput = () => {
    this.highlightRange()
    this.host.output.select([])
    this.outputText = undefined
    this.#resetRepeat()
  }

  toggle = (page: number, range: boolean, origin?: number) => {
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

  selectedSection = (pane: PaneName, first: number, end: number) => {
    for (let index = first; index < end; index++)
      if (pane === "Input" ? this.inputSelected.has(index) : this.selectedIds.has(this.host.output.pages[index].id))
        return true
    return false
  }

  selectSection = (pane: PaneName, first: number, end: number) => {
    if (pane === "Input") {
      const source = this.host.source
      if (!source) return
      const pages = Array.from({ length: end - first }, (_, index) => first + index)
      this.numbers(pageRanges(toggleGroup(this.draft.pages, pages)))
      this.#sourceAnchor = { source: source.id, page: first }
    } else {
      const ids = this.host.output.pages.slice(first, end).map((page) => page.id)
      this.outputText = undefined
      this.host.output.select(toggleGroup([...this.selectedIds], ids), this.host.output.pages[first].id)
      this.highlightRange()
    }
  }

  selectInput = (page: number, event: MouseEvent, sectionEnd?: number) => {
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

  selectInputRow = (page: number, event: MouseEvent) => {
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

  restoreInput = (page: number) => {
    const source = this.host.source
    if (!source || this.#inputClick?.source !== source.id || this.#inputClick.page !== page) return
    this.host.choose(source.id, this.#inputClick.sequence)
    this.#sourceAnchor = this.#inputClick.anchor
    this.highlightRange()
    this.#inputClick = undefined
  }

  doubleClickInput = (page: number, event: MouseEvent) => {
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
      this.commandInput(this.focusedInput(page))
    }
  }

  removal = (node: HTMLElement) => {
    // A virtual row's reactive scope can be gone before its exit starts.
    const id = node.id.slice(this.host.key.length + 1)
    if (this.feedback.removing.has(id)) {
      inert(node)
      node.setAttribute("aria-hidden", "true")
      node.classList.add("removing")
    }
    return this.feedback.transition(node, id)
  }

  cancelMotion = () => {
    this.host.interaction.cancelReturn()
    this.host.peeks.dismiss()
    this.feedback.stop()
  }

  inputRange = (page: number, end?: number): InputChoice =>
    end === undefined
      ? { kind: "page", page }
      : { kind: "pages", pages: Array.from({ length: end - page }, (_, index) => page + index) }

  focusedInput = (page?: number, end?: number): InputChoice =>
    page === undefined || this.parsed.error || this.draft.pages.length ? preparation : this.inputRange(page, end)

  inputPayload = (page?: number, end?: number): Payload => ({
    kind: "source",
    source: this.host.source!.id,
    choice: page === undefined ? preparation : this.inputRange(page, end),
  })

  outputRange = (first: number, end = first + 1) => this.host.output.pages.slice(first, end).map((page) => page.id)

  outputTargets = (target?: OutputTarget): readonly string[] => {
    if (this.outputSelectionError) return []
    if (!target || (target.kind === "focused" && this.host.output.selected.length)) return this.host.output.selected
    if (target.kind === "current") return this.inspected ? [this.inspected.id] : []
    if (target.kind === "individual" && this.host.output.selected.length) return []
    return this.outputRange(target.first, target.end)
  }

  commandInput = (choice: InputChoice = preparation, at = this.insertion, select = true) => {
    const source = this.host.source
    const targets = this.#inputTargets(choice)
    if (!source || !targets) return false
    const { pages, copies, front: aligned } = targets
    const inputBar = (document.activeElement as HTMLElement | null)?.closest(".selection-panel .sequence-entry")
    const next = composition.part(
      pages.map((number) => ({
        id: uid(),
        content: { source: source.id, page: number },
      })),
      copies,
      aligned,
    )
    const quantity = next.pages.length * next.copies
    const label = `${quantity} ${quantity === 1 ? "page" : "pages"}`
    const updated = composition.insert(this.host.output.parts, this.host.output.pages, next, at)
    const panel = this.host.inputViews.panel
    const first = pages[0]
    const sheet =
      (this.host.inputViews.active === "page"
        ? first === this.host.inputViews.position
          ? panel?.querySelector<HTMLElement>(".page-scroll canvas")
          : undefined
        : panel?.querySelector<HTMLElement>(
            `.page-image[data-page="${first}"] canvas, :is(.list-choice, .list-heading)[data-page="${first}"]`,
          )) ?? panel?.querySelector<HTMLElement>(".sequence-entry")
    const completed = this.#commit(
      updated,
      at === undefined
        ? `Added ${label} to Output.`
        : at === 0
          ? `Inserted ${label} at the start of Output.`
          : `Inserted ${label} after Output page ${at}.`,
      select ? (expanded) => expanded.filter((page) => page.part === next.id).map((page) => page.id) : undefined,
      sheet,
    )
    if (completed && choice.kind === "preparation") {
      this.clearInput()
      if (inputBar && !this.host.transfer.touching) this.host.interaction.focusAfterSelection("Input")
    }
    return completed
  }

  selectOutput = (id: string, range: boolean, anchor?: string) => {
    this.outputText = undefined
    const next = this.host.output.toggle(id, range, anchor)
    const { index, ids, adding } = next
    if (this.host.outputView.active === "grid") this.host.output.position = index
    this.highlightRange(adding && range && ids.length > 1 ? { kind: "output", ids: new Set(ids) } : undefined)
  }

  commandOutput = (action: OutputAction, target?: OutputTarget) => {
    const ids = this.outputTargets(target)
    if (!ids.length) return false
    if (action === "duplicate") return this.#duplicate(ids, target?.kind !== "individual" && target?.kind !== "current")
    if (action === "remove") return this.#remove(ids)
    this.#order(action === "earlier" ? -1 : 1, ids)
    return true
  }

  activateOutput = (index: number, event: MouseEvent, end = index + 1) => {
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
    else this.selectOutput(this.host.output.pages[index].id, event.shiftKey)
    return () => {
      this.host.output.select([...selected], anchor)
      this.outputText = text
      this.highlightRange()
    }
  }

  copyCurrent = (pane: PaneName) => {
    if (pane === "Input") this.commandInput(this.inputRange(this.host.inputViews.position), undefined, false)
    else this.commandOutput("duplicate", { kind: "current" })
  }

  blank = (at: number) => {
    const next = composition.blank(this.host.output.pages, at, this.host.sources)
    if (!next) return
    this.#replace(
      next.pages,
      `Inserted a Blank at Output position ${at + 1}, using the adjacent page's dimensions.`,
      () => [next.id],
    )
  }

  repeat = () => {
    if (!this.outputTargets().length || !this.adjacent || this.repeatError) return
    const copies = parseCopies(this.repetitions)
    if (copies === undefined) return
    const first = this.positions[0],
      last = this.positions.at(-1)!
    const next = composition.part(this.chosen, copies, this.front)
    if (
      this.#commit(
        composition.insert(this.host.output.parts, this.host.output.pages, next, first, last + 1),
        `Repeated ${this.chosen.length} selected ${this.chosen.length === 1 ? "page" : "pages"} ${this.repetitions} times${this.front ? ", starting each repeat on the front" : ""}.`,
        (expanded) =>
          expanded
            .filter((page) => page.part === next.id && page.copy === next.copies - 1 && !page.padding)
            .map((page) => page.id),
      )
    )
      this.#resetRepeat()
  }

  drop = (value: Payload, at: number) => {
    if (value.kind === "source") return value.source === this.host.source?.id && this.commandInput(value.choice, at)
    if (this.host.transfer.blocked) return true
    const id = value.ids[0]
    const next = composition.transfer(this.host.output.pages, value.ids, at)
    const completed = this.#replace(
      next.pages,
      `Moved ${next.count} ${next.count === 1 ? "page" : "pages"} to Output position ${next.position + 1}.`,
      undefined,
      undefined,
      id,
    )
    if (completed) {
      this.host.outputView.offset = this.host.output.position
      this.highlightRange({ kind: "output", ids: new Set(value.ids) })
    }
    return completed
  }

  start = (event: DragEvent | PointerEvent, value: Payload, control = event.currentTarget as HTMLElement) => {
    if ("dataTransfer" in event && this.host.interaction.touchPointer) {
      event.preventDefault()
      return
    }
    if (value.kind === "source" && value.source !== this.host.source?.id) return
    const inputSnapshot = this.draft,
      inputId = this.host.source?.id,
      inputFrom = this.host.inputViews.position,
      anchor = this.#sourceAnchor
    const selection = this.host.output.selection,
      outputFrom = this.host.output.position,
      outputAnchor = this.host.output.anchor,
      text = this.outputText
    const restore = () => {
      if (inputId) {
        this.host.choose(inputId, inputSnapshot)
        this.host.inputViews.set({ position: inputFrom }, inputId)
        this.#sourceAnchor = anchor
      }
      this.host.output.select(selection, outputAnchor)
      this.host.output.position = outputFrom
      this.outputText = text
    }
    const section = control.closest(".list-section, .grid-section-card")
    if (section) {
      if (value.kind === "source" && value.choice.kind === "pages") this.numbers(pageRanges(value.choice.pages))
      else if (value.kind === "output") {
        this.host.output.select(value.ids)
        this.outputText = undefined
      }
    }
    if (
      !section &&
      value.kind === "source" &&
      value.choice.kind === "page" &&
      this.inputSelected.has(value.choice.page)
    ) {
      if (this.host.inputViews.active === "grid") this.host.inputViews.set({ position: value.choice.page })
      value = this.inputPayload()
    } else if (!section && value.kind === "output" && this.selectedIds.has(value.ids[0])) {
      const ids = this.outputTargets()
      if (!ids.length) {
        event.preventDefault()
        return
      }
      const id = value.ids[0]
      value = { kind: "output", ids: [id, ...ids.filter((selected) => selected !== id)] }
    }
    const targets = value.kind === "source" ? this.#inputTargets(value.choice) : undefined
    if (value.kind === "source" && !targets) {
      event.preventDefault()
      return
    }
    this.originOpen = undefined
    this.cancelMotion()
    const quantity = value.kind === "output" ? value.ids.length : targets!.pages.length * targets!.copies
    const size =
      value.kind === "source"
        ? this.host.source?.input.sizes[targets!.pages[0]]
        : this.host.output.pages.find((page) => value.kind === "output" && value.ids.includes(page.id))?.content
    const preparing = value.kind === "source" && value.choice.kind === "preparation"
    const draggingPage = Number(
      control.closest(".list-row, .composition-card")?.querySelector<HTMLElement>("[data-page]")?.dataset.page,
    )
    this.host.transfer.begin(
      event,
      value,
      quantity,
      control,
      size && "width" in size ? size : size ? sizeOf(size, this.host.sources) : undefined,
      targets?.front ?? false,
      targets?.front ? (targets.pages.length % 2) * targets.copies : 0,
      preparing ? Math.max(0, targets!.pages.indexOf(draggingPage)) : 0,
      restore,
    )
    if (value.kind === "source" && value.choice.kind === "page" && this.host.inputViews.active === "grid")
      this.host.inputViews.set({ position: value.choice.page })
    if (value.kind === "output" && this.host.outputView.active === "grid")
      this.host.output.position = this.host.output.pages.findIndex((page) => page.id === value.ids[0])
  }

  highlightRange = (next?: Highlight) => {
    clearTimeout(this.#highlightTimeout)
    this.highlight = next
    if (next) this.#highlightTimeout = setTimeout(() => (this.highlight = undefined), 700)
  }

  #resetRepeat() {
    this.repetitions = "2"
    this.front = false
  }

  #inputTargets(choice: InputChoice) {
    if (choice.kind === "preparation") {
      const copies = parseCopies(this.draft.repeat)
      if (this.selectionError || !this.parsed.pages.length || copies === undefined) return
      return { pages: this.parsed.pages, copies, front: this.draft.front }
    }
    return { pages: choice.kind === "page" ? [choice.page] : choice.pages, copies: 1, front: false }
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

  #additionOrigin(id?: string) {
    const panel = this.host.outputView.panel
    const image =
      this.host.outputView.active === "page"
        ? id === this.inspected?.id
          ? panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
          : undefined
        : document
            .getElementById(`${this.host.key}-${id}`)
            ?.querySelector<HTMLElement>(".page-image :is(canvas, .composition-blank), .list-choice")
    const position = id ? this.host.output.positions.get(id) : undefined
    return (
      image ??
      (this.host.outputView.active === "list" && position !== undefined
        ? panel?.querySelector<HTMLElement>(`.list-heading[data-page="${position}"]`)
        : undefined) ??
      panel?.querySelector<HTMLElement>(".sequence-entry")
    )
  }

  #animateEdit(edit: Edit, origin?: HTMLElement | null) {
    this.cancelMotion()
    const expanded = edit.pages
    const added = expanded.filter((page) => edit.added.has(page.id))
    const { pending: pendingAddition, removing } = this.feedback
    this.feedback.prepare(edit, this.host.outputView.active)
    const reordering =
      !added.length && !removing.size && expanded.some((page, index) => page.id !== this.host.output.pages[index]?.id)
    const panel = this.host.outputView.panel
    if (this.host.outputView.active === "list") {
      const list = panel?.querySelector<HTMLElement>(".page-list")
      if (list) this.feedback.move = animateOrder(list, 500, reordering)
    }
    if (added.length && !this.host.transfer.value) {
      const sheet = origin ?? this.#additionOrigin("blank" in added[0].content ? undefined : this.chosen[0]?.id)
      if (sheet) {
        const content = added[0].content
        const contributor =
          "source" in content ? this.host.sources.find((item) => item.id === content.source) : undefined
        const preview =
          contributor && "page" in content
            ? sheet.closest(".selection-panel")
              ? { pdf: contributor.input.pdf, page: content.page }
              : contributor.preview.appearance(content.page)
            : undefined
        this.feedback.addition = animateAddition(
          sheet,
          sizeOf(added[0].content, this.host.sources),
          "blank" in added[0].content,
          added.length,
          () => {
            const button = this.host.outputTarget
            const row = document.getElementById(`${this.host.key}-${added[0].id}`)
            const image = row?.matches(".list-row")
              ? row
              : panel?.querySelector<HTMLElement>(
                  `.composition-card[data-adding] .page-image, .inspection-target .page-scroll, .list-section[data-index="${this.host.output.positions.get(added[0].id)}"] .list-heading`,
                )
            if (button?.offsetWidth && (origin?.closest(".selection-panel") || !image)) return button
            return image ?? document.getElementById(`${this.host.key}-output`)
          },
          () => {
            const id = this.inspected?.id
            const focused = document.activeElement
            const restore =
              id &&
              pendingAddition.has(id) &&
              focused?.matches(".composition-output :is(.composition-grid, .page-list)")
            pendingAddition.clear()
            if (restore)
              void tick().then(() => {
                if (document.activeElement === focused && this.inspected?.id === id)
                  document
                    .getElementById(`${this.host.key}-${id}`)
                    ?.querySelector<HTMLElement>(".page-image, .list-choice, .list-heading")
                    ?.focus({ preventScroll: true })
              })
          },
          preview,
          this.host.outputView.active === "list" && !!panel?.offsetWidth,
        )
      }
      if (this.feedback.addition) for (const page of added) pendingAddition.add(page.id)
    }
    if (this.inspected && removing.has(this.inspected.id) && this.host.outputView.active === "page") {
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet) this.feedback.removal = animateRemoval(sheet, () => this.feedback.page.clear())
      if (this.feedback.removal) this.feedback.page.add(this.inspected.id)
    }
    if (reordering && this.inspected && this.host.outputView.active === "page") {
      const position = expanded.findIndex((page) => page.id === this.inspected!.id)
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet && position !== this.host.output.position)
        this.feedback.move = animateMove(sheet, position - this.host.output.position)
    }
    if (reordering && this.host.outputView.active === "grid") {
      const grid = panel?.querySelector<HTMLElement>(".composition-grid")
      if (grid) this.feedback.move = animateOrder(grid, undefined, true)
    }
  }

  #commit(
    next: readonly Part[],
    text: string,
    select?: (pages: readonly Expanded[]) => readonly string[],
    origin?: HTMLElement | null,
    inspect?: string,
  ) {
    try {
      const focus = this.host.captureEditFocus(!!select)
      const edit = this.host.output.commit(
        next,
        { select, inspect: inspect ?? focus?.inspect, focusSelection: focus?.focusSelection },
        (candidate) => this.#animateEdit(candidate, origin),
      )
      this.host.change(text)
      this.host.inputViews.menu?.removeAttribute("open")
      this.host.outputView.menu?.removeAttribute("open")
      this.outputText = undefined
      if (select && this.host.output.anchor)
        this.host.outputView.offset = this.host.output.positions.get(this.host.output.anchor)!
      if (select) this.highlightRange({ kind: "output", ids: new Set(edit.selected) })
      focus?.restore(edit)
      return true
    } catch (reason) {
      this.cancelMotion()
      this.host.error(`Output could not update. ${reason instanceof Error ? reason.message : "Try the action again."}`)
      return false
    }
  }

  #replace(
    pages: readonly Page[],
    text: string,
    select?: (pages: readonly Expanded[]) => readonly string[],
    origin?: HTMLElement | null,
    inspect?: string,
  ) {
    return this.#commit(composition.materialize(pages), text, select, origin, inspect)
  }

  #order(offset: number, ids: readonly string[]) {
    const next = composition.order(this.host.output.pages, ids, offset)
    if (!next) return
    if (
      this.#replace(
        next.pages,
        `Moved ${next.count} ${next.count === 1 ? "page" : "pages"} ${offset < 0 ? "earlier" : "later"}.`,
      )
    ) {
      this.highlightRange({ kind: "output", ids: new Set(ids) })
      if (this.host.outputView.active === "grid") this.host.outputView.offset = this.host.output.position
    }
  }

  #duplicate(ids: readonly string[], select: boolean) {
    const next = composition.duplicate(this.host.output.pages, ids)
    if (!next) return false
    return this.#replace(
      next.pages,
      `Copied ${next.ids.length} ${next.ids.length === 1 ? "page" : "pages"} after Output page ${next.at}.`,
      select ? () => next.ids : undefined,
      this.#additionOrigin(ids[0]),
    )
  }

  #remove(ids: readonly string[]) {
    const next = composition.remove(this.host.output.pages, ids)
    if (!next) return false
    this.highlightRange({ kind: "output", ids: new Set(ids), removing: true })
    const completed = this.#replace(
      next.pages,
      `Removed ${next.count} ${next.count === 1 ? "page" : "pages"} from Output.`,
    )
    if (!completed) this.highlightRange()
    return completed
  }
}
