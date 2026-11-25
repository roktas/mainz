// Owns Output composition commands, edit orchestration, and transfer mediation.

import { copyError, parseCopies, sizeOf, uid } from "./model.ts"
import type { Content, Expanded, Page, Part, Source } from "./model.ts"
import { titlesOf } from "./outline.ts"
import type { InputViews, OutputView } from "./pane.svelte.ts"
import * as composition from "./composition.ts"
import type { Edit, Output } from "./output.svelte.ts"
import { pageRanges } from "./pages.ts"
import type { Sequence } from "./pages.ts"
import type { Interaction } from "./interaction.svelte.ts"
import type { Payload, Transfer } from "./transfer.svelte.ts"
import { additionOrigin, Edits } from "./edits.ts"
import type { Peeks } from "./Peek.svelte"
import { Selection } from "./selection.svelte.ts"
import type { PaneName } from "./selection.svelte.ts"

export type { PaneName }
export type OutputTarget = { kind: "focused" | "individual"; first: number; end?: number } | { kind: "current" }
export type OutputAction = "duplicate" | "remove" | "earlier" | "later"
type InputChoice = Extract<Payload, { kind: "source" }>["choice"]

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
  repetitions = $state("2")
  front = $state(false)
  originOpen = $state<string>()
  readonly feedback: Edits
  readonly selection: Selection

  readonly inspected = $derived.by(() => this.host.output.pages[this.host.output.position])
  readonly selectedIds = $derived.by(() => this.host.output.selection)
  readonly positions = $derived.by(() => this.host.output.selected.map((id) => this.host.output.positions.get(id)!))
  readonly chosen = $derived.by(() => this.positions.map((index) => this.host.output.pages[index]))
  readonly insertion = $derived.by(() => (this.positions.length ? this.positions.at(-1)! + 1 : undefined))
  readonly adjacent = $derived.by(() =>
    this.positions.every((position, i) => i === 0 || position === this.positions[i - 1] + 1),
  )
  readonly repeatError = $derived.by(() => copyError(this.repetitions))

  constructor(private host: Host) {
    this.feedback = new Edits(host.key)
    this.selection = new Selection({
      get source() {
        return host.source
      },
      get output() {
        return host.output
      },
      get sequence() {
        return host.sequence
      },
      get inputViews() {
        return host.inputViews
      },
      get outputView() {
        return host.outputView
      },
      get interaction() {
        return host.interaction
      },
      choose: host.choose,
      onDoubleClickInput: (page) => this.commandInput(this.focusedInput(page)),
      resetRepeat: () => this.#resetRepeat(),
    })
  }

  resetSource = () => {
    this.selection.resetSource()
    this.host.transfer.cancelInput()
  }

  dispose = () => {
    this.host.transfer.end(true)
    this.selection.dispose()
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
            : this.selection.parsed.pages[0]
      if (page === undefined) return ""
      return (
        this.displayName(
          this.host.sources.find((item) => item.id === value.source),
          page,
        ) ?? `Page ${page + 1}`
      )
    }
    const index = this.host.output.positions.get(value.ids[0])
    const page = index === undefined ? undefined : this.host.output.pages[index]
    return page
      ? (this.pageName(page.content) ??
          ("page" in page.content ? `Page ${page.content.page + 1}` : page.padding ? "Padding" : "Blank"))
      : ""
  }

  showOriginal = () => {
    const inspected = this.inspected
    if (!inspected || !("source" in inspected.content)) return
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
    page === undefined || this.selection.parsed.error || this.selection.draft.pages.length
      ? preparation
      : this.inputRange(page, end)

  inputPayload = (page?: number, end?: number): Payload => ({
    kind: "source",
    source: this.host.source!.id,
    choice: page === undefined ? preparation : this.inputRange(page, end),
  })

  outputRange = (first: number, end = first + 1) => this.host.output.pages.slice(first, end).map((page) => page.id)

  outputTargets = (target?: OutputTarget): readonly string[] => {
    if (this.selection.outputSelectionError) return []
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
      this.selection.clearInput()
      if (inputBar && !this.host.transfer.touching) this.host.interaction.focusAfterSelection("Input")
    }
    return completed
  }

  commandOutput = (action: OutputAction, target?: OutputTarget) => {
    const ids = this.outputTargets(target)
    if (!ids.length) return false
    if (action === "duplicate") return this.#duplicate(ids, target?.kind !== "individual" && target?.kind !== "current")
    if (action === "remove") return this.#remove(ids)
    this.#order(action === "earlier" ? -1 : 1, ids)
    return true
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
      this.selection.highlightRange({ kind: "output", ids: new Set(value.ids) })
    }
    return completed
  }

  start = (event: DragEvent | PointerEvent, value: Payload, control = event.currentTarget as HTMLElement) => {
    if ("dataTransfer" in event && this.host.interaction.touchPointer) {
      event.preventDefault()
      return
    }
    if (value.kind === "source" && value.source !== this.host.source?.id) return
    const restore = this.selection.snapshot()
    const section = control.closest(".list-section, .grid-section-card")
    if (section) {
      if (value.kind === "source" && value.choice.kind === "pages")
        this.selection.numbers(pageRanges(value.choice.pages))
      else if (value.kind === "output") {
        this.host.output.select(value.ids)
        this.selection.outputText = undefined
      }
    }
    if (
      !section &&
      value.kind === "source" &&
      value.choice.kind === "page" &&
      this.selection.inputSelected.has(value.choice.page)
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
    const outputPageIndex = value.kind === "output" ? this.host.output.positions.get(value.ids[0]) : undefined
    const size =
      value.kind === "source"
        ? this.host.source?.input.sizes[targets!.pages[0]]
        : outputPageIndex === undefined
          ? undefined
          : this.host.output.pages[outputPageIndex].content
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
      this.host.output.position = this.host.output.positions.get(value.ids[0]) ?? -1
  }

  #resetRepeat() {
    this.repetitions = "2"
    this.front = false
  }

  #inputTargets(choice: InputChoice) {
    if (choice.kind === "preparation") {
      const copies = parseCopies(this.selection.draft.repeat)
      if (this.selection.selectionError || !this.selection.parsed.pages.length || copies === undefined) return
      return { pages: this.selection.parsed.pages, copies, front: this.selection.draft.front }
    }
    return { pages: choice.kind === "page" ? [choice.page] : choice.pages, copies: 1, front: false }
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
        (candidate) => {
          this.cancelMotion()
          this.feedback.animate(
            candidate,
            {
              sources: this.host.sources,
              previousPages: this.host.output.pages,
              inspectedId: () => this.inspected?.id,
              inspectedPosition: this.host.output.position,
              chosenFirstId: this.chosen[0]?.id,
              outputPosition: (id) => this.host.output.positions.get(id),
              outputPanel: this.host.outputView.panel,
              outputTab: this.host.outputView.active,
              outputTarget: () => this.host.outputTarget,
              transferActive: !!this.host.transfer.value,
            },
            origin,
          )
        },
      )
      this.host.change(text)
      this.host.inputViews.menu?.removeAttribute("open")
      this.host.outputView.menu?.removeAttribute("open")
      this.selection.outputText = undefined
      if (select && this.host.output.anchor)
        this.host.outputView.offset = this.host.output.positions.get(this.host.output.anchor)!
      if (select) this.selection.highlightRange({ kind: "output", ids: new Set(edit.selected) })
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
      this.selection.highlightRange({ kind: "output", ids: new Set(ids) })
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
      additionOrigin(
        this.host.key,
        this.host.outputView.panel,
        this.host.outputView.active,
        this.inspected?.id,
        this.host.output.positions.get(ids[0]),
        ids[0],
      ),
    )
  }

  #remove(ids: readonly string[]) {
    const next = composition.remove(this.host.output.pages, ids)
    if (!next) return false
    this.selection.highlightRange({ kind: "output", ids: new Set(ids), removing: true })
    const completed = this.#replace(
      next.pages,
      `Removed ${next.count} ${next.count === 1 ? "page" : "pages"} from Output.`,
    )
    if (!completed) this.selection.highlightRange()
    return completed
  }
}
