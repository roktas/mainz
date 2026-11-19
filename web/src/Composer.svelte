<!-- Coordinates pane views, page selections, Output edits, and transfers. -->

<script module lang="ts">
  import type { Snippet } from "svelte"
  import type { Section } from "./sections.ts"
  type Pane = "Input" | "Output"
  export type Highlight =
    | { kind: "source"; source: string; first: number; last: number }
    | { kind: "output"; ids: ReadonlySet<string>; removing?: boolean }
  export type PaneSnippets = {
    summary: (element: HTMLElement) => () => void
    counts: Snippet
    pageFace: Snippet<[index: number]>
    pageTools: Snippet<[pane: Pane, fitWidth: () => void]>
    zoomControls: Snippet<[pane: Pane, menu?: boolean]>
    zoomReset: Snippet<[pane: Pane, fitWidth: () => void, menu?: boolean]>
    gridRibbon: Snippet<[pane: Pane, section: Section, folded: boolean, fold: (key: string) => void]>
    sectionRow: Snippet<
      [
        pane: Pane,
        first: number,
        end: number,
        path: readonly string[],
        expanded: boolean,
        toggle: () => void,
        id: number,
        origin: Snippet,
        actions: Snippet,
        labels?: readonly string[],
      ]
    >
    sectionJump: Snippet<[pane: Pane, paths: readonly (readonly Section[])[], id: string]>
  }
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte"
  import {
    filename as normalizeFilename,
    filenameError,
    copyError,
    parseCopies,
    sizeOf,
    titleOf,
    uid,
  } from "./model.ts"
  import type { Content, Expanded, Page, Part, Source } from "./model.ts"
  import { titlesOf } from "./outline.ts"
  import { InputViews, OutputView } from "./pane.svelte.ts"
  import * as composition from "./composition.ts"
  import type { Edit, Output } from "./output.svelte.ts"
  import { pageRanges, parseSequence, toggleGroup, toggleSequence } from "./pages.ts"
  import { Interaction } from "./interaction.svelte.ts"
  import type { Sequence } from "./pages.ts"
  import { retainFocus } from "./drag.ts"
  import { Transfer } from "./transfer.svelte.ts"
  import type { Payload } from "./transfer.svelte.ts"
  import { animateAddition, animateMove, animateOrder, animateRemoval, Edits, inert } from "./motion.ts"
  import { Peeks } from "./Peek.svelte"
  import { zoomLevels } from "./Page.svelte"
  import type { Inspection } from "./Page.svelte"
  import InputPane from "./InputPane.svelte"
  import OutputPane from "./OutputPane.svelte"
  import type { OutputAction, OutputTarget } from "./OutputPane.svelte"
  import type { Magnification } from "./Lens.svelte"
  import Icon from "./Icon.svelte"
  import type { TourStep } from "./Tour.svelte"
  type InputChoice = Extract<Payload, { kind: "source" }>["choice"]
  let {
    source,
    styleable,
    sources,
    output,
    sequence,
    choose,
    change,
    download,
    sharing,
    print,
    viewPDF,
    viewInputPDF,
    recipe,
    filename,
    suggestFilename,
    setFilename,
    rename,
    error,
    styling,
    input,
    inputChoices,
    openPDF,
    inspection,
    activate,
    outputProcessing = false,
    downloadError,
    opening = false,
    magnification = 16,
    tour,
    initial = { input: "grid", output: "grid" },
  }: {
    source?: Source
    styleable: boolean
    sources: readonly Source[]
    output: Output
    sequence?: Sequence
    choose: (id: string, sequence: Sequence) => void
    change: (text: string) => void
    download: () => void
    sharing: boolean
    print: () => void
    viewPDF: () => void
    viewInputPDF: () => void
    recipe: () => void
    filename?: string
    suggestFilename: () => string
    setFilename: (name: string) => void
    rename: (source: HTMLElement) => void
    error: (message: string) => void
    styling?: Snippet<[toolbarOnly?: boolean]>
    input: Snippet<[heading: string]>
    inputChoices: Snippet<[close: () => void, compact: boolean]>
    openPDF: Snippet
    inspection?: Inspection
    activate: (id: string) => void
    outputProcessing?: boolean
    downloadError?: string
    opening?: boolean
    magnification?: Magnification
    tour?: TourStep
    initial?: { input: "grid" | "list" | "page" | "style"; output: "grid" | "list" | "page" }
  } = $props()
  let comparing = $state(false)
  const key = $props.id()
  let compact = $state(false)
  let documentMenu = $state<HTMLDivElement>()
  let inputTarget: HTMLButtonElement
  function layout(element: HTMLDivElement) {
    const switcher = element.querySelector<HTMLElement>(".mobile-workspace-tabs")!
    let frame = 0
    const update = () => {
      compact = getComputedStyle(switcher).display !== "none"
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    })
    observer.observe(element)
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }
  function summary(element: HTMLElement) {
    const counts = element.querySelector<HTMLElement>(".composition-totals")!
    let frame: number
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
  function closeDocument() {
    if (documentMenu?.matches(":popover-open")) {
      const launcher = interaction.activeView === "input" ? inputTarget : outputTarget
      documentMenu.hidePopover()
      launcher?.focus({ preventScroll: true })
      return launcher
    }
  }
  function switchPane(view: "input" | "output", event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    if (interaction.activeView === view) {
      event.currentTarget.focus({ preventScroll: true })
      return
    }
    event.preventDefault()
    cancelMotion()
    interaction.view = view
  }
  const inputViews = new InputViews(
    untrack(() => initial.input),
    () => source,
    () => sources,
    () => tour,
    () => styleable,
  )
  const outputView = new OutputView(
    untrack(() => initial.output),
    untrack(() => output),
    () => tour,
  )
  let outputPane = $state<ReturnType<typeof OutputPane>>()
  const inputPosition = $derived(inputViews.position)
  let outputText = $state<string>()
  let repetitions = $state("2")
  let front = $state(false)
  let touchTap: { pane: "Input" | "Output"; element: EventTarget | null; time: number; restore: () => void } | undefined
  let originOpen = $state<string>()
  const peeks = new Peeks()
  let outputTarget = $state<HTMLButtonElement>()
  let sourceAnchor: { source: string; page: number } | undefined
  let inputClick: { source: string; page: number; sequence: Sequence; anchor: typeof sourceAnchor } | undefined
  let highlight = $state<Highlight>()
  let highlightTimeout: ReturnType<typeof setTimeout> | undefined
  const sourceId = $derived(source?.id)
  $effect(() => {
    if (!sourceId) return
    return () => {
      if (touchTap?.pane === "Input") touchTap = undefined
      inputClick = undefined
      transfer.cancelInput()
    }
  })
  const feedback = new Edits(key)
  const pendingAddition = feedback.pending
  const removing = feedback.removing
  const count = $derived(source?.input.pdf.numPages ?? 0)
  const draft = $derived(
    sequence ?? {
      text: "",
      pages: [],
      repeat: "1",
      front: false,
    },
  )
  const inputText = $derived(draft.text)
  const inputPages = $derived(draft.pages)
  const parsed = $derived(parseSequence(inputText, count))
  const selectionError = $derived(parsed.error ?? copyError(draft.repeat))
  const inspected = $derived(output.pages[output.position])
  const frameHeadingHeight = $derived(
    Math.max(
      inputViews.active === "page" && source ? inputViews.headingHeight : 0,
      outputView.active === "page" && inspection ? outputView.headingHeight : 0,
    ),
  )
  const selectedIds = $derived(output.selection)
  const positions = $derived(output.selected.map((id) => output.positions.get(id)!))
  const chosen = $derived(positions.map((index) => output.pages[index]))
  const insertion = $derived(positions.length ? positions.at(-1)! + 1 : undefined)
  const outputSelection = $derived(parseSequence(outputText ?? "", output.pages.length))
  const outputSelectionError = $derived(outputText === undefined ? undefined : outputSelection.error)
  const adjacent = $derived(positions.every((position, i) => i === 0 || position === positions[i - 1] + 1))
  const repeatError = $derived(copyError(repetitions))
  const inputSelected = $derived(new Set(inputPages))
  const transfer: Transfer = new Transfer({
    get pages() {
      return output.pages
    },
    get positions() {
      return output.positions
    },
    get inspected() {
      return output.inspected
    },
    set inspected(id) {
      output.inspected = id
    },
    get position() {
      return output.position
    },
    set position(value) {
      output.position = value
    },
    get input() {
      return interaction.activeView === "input"
    },
    get insertion() {
      return insertion
    },
    get outputTarget() {
      return outputTarget
    },
    start(event, value, control) {
      start(event, value, control)
      if (transfer.touching) touchTap = undefined
    },
    drop,
    reveal() {
      interaction.view = "output"
    },
  })
  const interaction: Interaction = new Interaction({
    input: inputViews,
    outputView,
    get tour() {
      return tour
    },
    cancelMotion,
    get key() {
      return key
    },
    get source() {
      return source
    },
    get output() {
      return output
    },
    get draft() {
      return draft
    },
    get count() {
      return count
    },
    get opening() {
      return opening
    },
    get transfer() {
      return transfer
    },
    get peeks() {
      return peeks
    },
    resetPointer() {
      touchTap = undefined
    },
    get originOpen() {
      return originOpen
    },
    set originOpen(value) {
      originOpen = value
    },
    get outputText() {
      return outputText
    },
    get repetitions() {
      return repetitions
    },
    get front() {
      return front
    },
    selectAll,
    copyCurrent,
    clearInput,
    clearOutput,
    editOutput(action, control) {
      const target = control && outputPane?.focusedRange(control)
      return commandOutput(action, target ? { kind: "focused", ...target } : undefined)
    },
  })
  export function views() {
    return { input: inputViews.active, output: outputView.active }
  }
  function displayName(origin: Source | undefined, page: number) {
    return origin ? titlesOf(origin.input).at(page, inputViews.titles(origin.id)).name : undefined
  }
  function pageName(content: Content) {
    return "source" in content ? displayName(provenance(content), content.page) : undefined
  }
  function transferName() {
    const value = transfer.value
    if (!value) return ""
    if (value.kind === "source") {
      const page =
        value.choice.kind === "page"
          ? value.choice.page
          : value.choice.kind === "pages"
            ? value.choice.pages[0]
            : parsed.pages[0]
      return (
        displayName(
          sources.find((item) => item.id === value.source),
          page,
        ) ?? `Page ${page + 1}`
      )
    }
    const page = output.pages.find((item) => item.id === value.ids[0])
    return page
      ? (pageName(page.content) ??
          ("page" in page.content ? `Page ${page.content.page + 1}` : page.padding ? "Padding" : "Blank"))
      : ""
  }
  function showOriginal() {
    if (!inspected || !("source" in inspected.content)) return
    if (outputView.menu) outputView.menu.open = false
    const { source: id, page } = inspected.content
    inputViews.set(
      {
        tab: "page",
        position: page,
        zoom: outputView.zoom,
        pageInitialized: true,
        region: { ...outputView.region },
        alignment: { ...outputView.region },
      },
      id,
    )
    activate(id)
    interaction.view = "input"
  }
  function set(patch: Partial<Sequence>) {
    if (source) choose(source.id, { ...draft, ...patch })
  }
  function numbers(text: string) {
    if (!source) return
    highlightRange()
    const next = parseSequence(text, count)
    set({ text, pages: next.error ? draft.pages : next.pages })
    sourceAnchor = undefined
  }
  function touchPage(pane: "Input" | "Output", event: MouseEvent) {
    if (!interaction.touchPointer || !event.detail || event.ctrlKey || event.metaKey || event.altKey) {
      touchTap = undefined
      return false
    }
    const now = performance.now()
    if (touchTap?.element === event.currentTarget && now - touchTap.time < 350) {
      touchTap.restore()
      touchTap = undefined
      void interaction.toggleView(pane, event)
      return true
    }
    const preparation = draft,
      id = source?.id,
      anchor = sourceAnchor
    const selection = output.selection,
      text = outputText,
      outputFrom = output.anchor
    touchTap = {
      pane,
      element: event.currentTarget,
      time: now,
      restore: () => {
        if (pane === "Input" && id) {
          choose(id, preparation)
          sourceAnchor = anchor
          inputClick = undefined
        } else {
          output.select(selection, outputFrom)
          outputText = text
        }
        highlightRange()
      },
    }
    return false
  }
  function selectAll(pane: "Input" | "Output") {
    if (pane === "Input") {
      if (count) numbers(`1${count > 1 ? `-${count}` : ""}`)
    } else {
      output.select(output.pages.map((page) => page.id))
      outputText = undefined
    }
  }
  function clearInput() {
    if (!source) return
    if (highlight?.kind === "source") highlightRange()
    set({ text: "", pages: [], repeat: "1", front: false })
    sourceAnchor = undefined
  }
  function outputNumbers(text: string) {
    highlightRange()
    outputText = text
    const next = outputSelection
    if (!next.error) {
      output.select(next.pages.map((index) => output.pages[index].id))
    }
  }
  function resetRepeat() {
    repetitions = "2"
    front = false
  }
  function clearOutput() {
    highlightRange()
    output.select([])
    outputText = undefined
    resetRepeat()
  }
  function highlightRange(next?: NonNullable<typeof highlight>) {
    clearTimeout(highlightTimeout)
    highlight = next
    if (next) highlightTimeout = setTimeout(() => (highlight = undefined), 700)
  }
  function toggle(page: number, range: boolean, origin?: number) {
    if (!source) return
    const anchor = sourceAnchor?.source === source.id ? sourceAnchor.page : origin
    const { pages, first, last, adding } = toggleSequence(draft.pages, page, range ? anchor : undefined)
    numbers(pageRanges(pages))
    sourceAnchor = { source: source.id, page }
    highlightRange(adding && range && first < last ? { kind: "source", source: source.id, first, last } : undefined)
  }
  function selectedSection(pane: "Input" | "Output", first: number, end: number) {
    for (let index = first; index < end; index++)
      if (pane === "Input" ? inputSelected.has(index) : selectedIds.has(output.pages[index].id)) return true
    return false
  }
  function selectSection(pane: "Input" | "Output", first: number, end: number) {
    if (pane === "Input") {
      if (!source) return
      const pages = Array.from({ length: end - first }, (_, index) => first + index)
      numbers(pageRanges(toggleGroup(draft.pages, pages)))
      sourceAnchor = { source: source.id, page: first }
    } else {
      const ids = output.pages.slice(first, end).map((page) => page.id)
      outputText = undefined
      output.select(toggleGroup([...selectedIds], ids), output.pages[first].id)
      highlightRange()
    }
  }
  function selectInput(page: number, event: MouseEvent, sectionEnd?: number) {
    if (!source) return
    inputViews.set({ position: page })
    if (touchPage("Input", event)) return
    if (event.ctrlKey || event.metaKey) {
      void interaction.toggleView("Input", event)
      return
    }
    if (event.detail > 1) return
    if (event.detail === 1) inputClick = { source: source.id, page, sequence: draft, anchor: sourceAnchor }
    if (sectionEnd !== undefined && !event.shiftKey) selectSection("Input", page, sectionEnd)
    else toggle(page, event.shiftKey)
    if (event.detail) (event.currentTarget as HTMLElement).focus({ preventScroll: true })
  }
  function restoreInput(page: number) {
    if (!source || inputClick?.source !== source.id || inputClick.page !== page) return
    choose(source.id, inputClick.sequence)
    sourceAnchor = inputClick.anchor
    highlightRange()
    inputClick = undefined
  }
  function removal(node: HTMLElement) {
    // A virtual row's reactive scope can be gone before its exit starts.
    const id = node.id.slice(key.length + 1)
    if (removing.has(id)) {
      inert(node)
      node.setAttribute("aria-hidden", "true")
      node.classList.add("removing")
    }
    return feedback.transition(node, id)
  }
  function cancelMotion() {
    interaction.cancelReturn()
    peeks.dismiss()
    feedback.stop()
  }
  function additionOrigin(id?: string) {
    const panel = outputView.panel
    const image =
      outputView.active === "page"
        ? id === inspected?.id
          ? panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
          : undefined
        : document
            .getElementById(`${key}-${id}`)
            ?.querySelector<HTMLElement>(".page-image :is(canvas, .composition-blank), .list-choice")
    const position = id ? output.positions.get(id) : undefined
    return (
      image ??
      (outputView.active === "list" && position !== undefined
        ? panel?.querySelector<HTMLElement>(`.list-heading[data-page="${position}"]`)
        : undefined) ??
      panel?.querySelector<HTMLElement>(".sequence-entry")
    )
  }
  function animateEdit(edit: Edit, origin?: HTMLElement | null) {
    cancelMotion()
    const expanded = edit.pages
    const added = expanded.filter((page) => edit.added.has(page.id))
    feedback.prepare(edit, outputView.active)
    const reordering =
      !added.length && !removing.size && expanded.some((page, index) => page.id !== output.pages[index]?.id)
    const panel = outputView.panel
    if (outputView.active === "list") {
      const list = panel?.querySelector<HTMLElement>(".page-list")
      if (list) feedback.move = animateOrder(list, 500, reordering)
    }
    if (added.length && !transfer.value) {
      const sheet = origin ?? additionOrigin("blank" in added[0].content ? undefined : chosen[0]?.id)
      if (sheet) {
        const content = added[0].content
        const contributor = "source" in content ? sources.find((item) => item.id === content.source) : undefined
        const preview =
          contributor && "page" in content
            ? sheet.closest(".selection-panel")
              ? { pdf: contributor.input.pdf, page: content.page }
              : contributor.preview.appearance(content.page)
            : undefined
        feedback.addition = animateAddition(
          sheet,
          sizeOf(added[0].content, sources),
          "blank" in added[0].content,
          added.length,
          () => {
            const button = outputTarget
            const row = document.getElementById(`${key}-${added[0].id}`)
            const image = row?.matches(".list-row")
              ? row
              : panel?.querySelector<HTMLElement>(
                  `.composition-card[data-adding] .page-image, .inspection-target .page-scroll, .list-section[data-index="${output.positions.get(added[0].id)}"] .list-heading`,
                )
            if (button?.offsetWidth && (origin?.closest(".selection-panel") || !image)) return button
            return image ?? document.getElementById(`${key}-output`)
          },
          () => {
            const id = inspected?.id
            const focused = document.activeElement
            const restore =
              id &&
              pendingAddition.has(id) &&
              focused?.matches(".composition-output :is(.composition-grid, .page-list)")
            pendingAddition.clear()
            if (restore)
              void tick().then(() => {
                if (document.activeElement === focused && inspected?.id === id)
                  document
                    .getElementById(`${key}-${id}`)
                    ?.querySelector<HTMLElement>(".page-image, .list-choice, .list-heading")
                    ?.focus({ preventScroll: true })
              })
          },
          preview,
          outputView.active === "list" && !!panel?.offsetWidth,
        )
      }
      if (feedback.addition) for (const page of added) pendingAddition.add(page.id)
    }
    if (inspected && removing.has(inspected.id) && outputView.active === "page") {
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet) feedback.removal = animateRemoval(sheet, () => feedback.page.clear())
      if (feedback.removal) feedback.page.add(inspected.id)
    }
    if (reordering && inspected && outputView.active === "page") {
      const position = expanded.findIndex((page) => page.id === inspected.id)
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet && position !== output.position) feedback.move = animateMove(sheet, position - output.position)
    }
    if (reordering && outputView.active === "grid") {
      const grid = panel?.querySelector<HTMLElement>(".composition-grid")
      if (grid) feedback.move = animateOrder(grid, undefined, true)
    }
  }

  function commit(
    next: readonly Part[],
    text: string,
    select?: (pages: readonly Expanded[]) => readonly string[],
    origin?: HTMLElement | null,
    inspect?: string,
  ) {
    try {
      const focus = outputPane?.captureEditFocus(!!select)
      const edit = output.commit(
        next,
        { select, inspect: inspect ?? focus?.inspect, focusSelection: focus?.focusSelection },
        (candidate) => animateEdit(candidate, origin),
      )
      change(text)
      inputViews.menu?.removeAttribute("open")
      outputView.menu?.removeAttribute("open")
      outputText = undefined
      if (select && output.anchor) outputView.offset = output.positions.get(output.anchor)!
      if (select) highlightRange({ kind: "output", ids: new Set(edit.selected) })
      focus?.restore(edit)
      return true
    } catch (reason) {
      cancelMotion()
      error(`Output could not update. ${reason instanceof Error ? reason.message : "Try the action again."}`)
      return false
    }
  }
  function replace(
    pages: readonly Page[],
    text: string,
    select?: (pages: readonly Expanded[]) => readonly string[],
    origin?: HTMLElement | null,
    inspect?: string,
  ) {
    return commit(composition.materialize(pages), text, select, origin, inspect)
  }
  const preparation = { kind: "preparation" } as const
  function inputRange(page: number, end?: number): InputChoice {
    return end === undefined
      ? { kind: "page", page }
      : { kind: "pages", pages: Array.from({ length: end - page }, (_, index) => page + index) }
  }
  function focusedInput(page?: number, end?: number): InputChoice {
    return page === undefined || parsed.error || draft.pages.length ? preparation : inputRange(page, end)
  }
  function inputTargets(choice: InputChoice) {
    if (choice.kind === "preparation") {
      const copies = parseCopies(draft.repeat)
      if (selectionError || !parsed.pages.length || copies === undefined) return
      return { pages: parsed.pages, copies, front: draft.front }
    }
    return { pages: choice.kind === "page" ? [choice.page] : choice.pages, copies: 1, front: false }
  }
  function commandInput(choice: InputChoice = preparation, at = insertion, select = true) {
    const targets = inputTargets(choice)
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
    const updated = composition.insert(output.parts, output.pages, next, at)
    const panel = inputViews.panel
    const first = pages[0]
    const sheet =
      (inputViews.active === "page"
        ? first === inputPosition
          ? panel?.querySelector<HTMLElement>(".page-scroll canvas")
          : undefined
        : panel?.querySelector<HTMLElement>(
            `.page-image[data-page="${first}"] canvas, :is(.list-choice, .list-heading)[data-page="${first}"]`,
          )) ?? panel?.querySelector<HTMLElement>(".sequence-entry")
    const completed = commit(
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
      clearInput()
      if (inputBar && !transfer.touching) interaction.focusAfterSelection("Input")
    }
    return completed
  }
  function selectOutput(id: string, range: boolean, anchor?: string) {
    outputText = undefined
    const next = output.toggle(id, range, anchor)
    const { index, ids, adding } = next
    if (outputView.active === "grid") output.position = index
    highlightRange(adding && range && ids.length > 1 ? { kind: "output", ids: new Set(ids) } : undefined)
  }
  function outputRange(first: number, end = first + 1) {
    return output.pages.slice(first, end).map((page) => page.id)
  }
  function outputTargets(target?: OutputTarget): readonly string[] {
    if (outputSelectionError) return []
    if (!target || (target.kind === "focused" && output.selected.length)) return output.selected
    if (target.kind === "current") return inspected ? [inspected.id] : []
    if (target.kind === "individual" && output.selected.length) return []
    return outputRange(target.first, target.end)
  }
  function commandOutput(action: OutputAction, target?: OutputTarget) {
    const ids = outputTargets(target)
    if (!ids.length) return false
    if (action === "duplicate") return duplicate(ids, target?.kind !== "individual" && target?.kind !== "current")
    if (action === "remove") return remove(ids)
    order(action === "earlier" ? -1 : 1, ids)
    return true
  }
  let restoreOutput: (() => void) | undefined
  function activateOutput(index: number, event: MouseEvent, end = index + 1) {
    output.position = index
    if (touchPage("Output", event)) return
    if (event.ctrlKey || event.metaKey) {
      void interaction.toggleView("Output", event)
      return
    }
    if (event.detail > 1) return
    const selected = output.selection
    const anchor = output.anchor
    const text = outputText
    if (end > index + 1 && !event.shiftKey) selectSection("Output", index, end)
    else selectOutput(output.pages[index].id, event.shiftKey)
    return () => {
      output.select([...selected], anchor)
      outputText = text
      highlightRange()
    }
  }
  function order(offset: number, ids: readonly string[]) {
    const next = composition.order(output.pages, ids, offset)
    if (!next) return
    if (
      replace(
        next.pages,
        `Moved ${next.count} ${next.count === 1 ? "page" : "pages"} ${offset < 0 ? "earlier" : "later"}.`,
      )
    ) {
      highlightRange({ kind: "output", ids: new Set(ids) })
      if (outputView.active === "grid") outputView.offset = output.position
    }
  }
  function duplicate(ids: readonly string[], select: boolean) {
    const next = composition.duplicate(output.pages, ids)
    if (!next) return false
    return replace(
      next.pages,
      `Copied ${next.ids.length} ${next.ids.length === 1 ? "page" : "pages"} after Output page ${next.at}.`,
      select ? () => next.ids : undefined,
      additionOrigin(ids[0]),
    )
  }
  function copyCurrent(pane: "Input" | "Output") {
    if (pane === "Input") commandInput(inputRange(inputPosition), undefined, false)
    else commandOutput("duplicate", { kind: "current" })
  }
  function remove(ids: readonly string[]) {
    const next = composition.remove(output.pages, ids)
    if (!next) return false
    highlightRange({ kind: "output", ids: new Set(ids), removing: true })
    const completed = replace(next.pages, `Removed ${next.count} ${next.count === 1 ? "page" : "pages"} from Output.`)
    if (!completed) highlightRange()
    return completed
  }
  function blank(at: number) {
    const next = composition.blank(output.pages, at, sources)
    if (!next) return
    replace(next.pages, `Inserted a Blank at Output position ${at + 1}, using the adjacent page's dimensions.`, () => [
      next.id,
    ])
  }
  function repeat() {
    if (!outputTargets().length || !adjacent || repeatError) return
    const copies = parseCopies(repetitions)
    if (copies === undefined) return
    const first = positions[0],
      last = positions.at(-1)!
    const next = composition.part(chosen, copies, front)
    if (
      commit(
        composition.insert(output.parts, output.pages, next, first, last + 1),
        `Repeated ${chosen.length} selected ${chosen.length === 1 ? "page" : "pages"} ${repetitions} times${front ? ", starting each repeat on the front" : ""}.`,
        (expanded) =>
          expanded
            .filter((page) => page.part === next.id && page.copy === next.copies - 1 && !page.padding)
            .map((page) => page.id),
      )
    )
      resetRepeat()
  }
  function drop(value: Payload, at: number) {
    if (value.kind === "source") return value.source === source?.id && commandInput(value.choice, at)
    if (transfer.blocked) return true
    const id = value.ids[0]
    const next = composition.transfer(output.pages, value.ids, at)
    const completed = replace(
      next.pages,
      `Moved ${next.count} ${next.count === 1 ? "page" : "pages"} to Output position ${next.position + 1}.`,
      undefined,
      undefined,
      id,
    )
    if (completed) {
      outputView.offset = output.position
      highlightRange({ kind: "output", ids: new Set(value.ids) })
    }
    return completed
  }
  function start(event: DragEvent | PointerEvent, value: Payload, control = event.currentTarget as HTMLElement) {
    if ("dataTransfer" in event && interaction.touchPointer) {
      event.preventDefault()
      return
    }
    if (value.kind === "source" && value.source !== source?.id) return
    const inputSnapshot = draft,
      inputId = source?.id,
      inputFrom = inputPosition,
      anchor = sourceAnchor
    const selection = output.selection,
      outputFrom = output.position,
      outputAnchor = output.anchor,
      text = outputText
    const restore = () => {
      if (inputId) {
        choose(inputId, inputSnapshot)
        inputViews.set({ position: inputFrom }, inputId)
        sourceAnchor = anchor
      }
      output.select(selection, outputAnchor)
      output.position = outputFrom
      outputText = text
    }
    const section = control.closest(".list-section, .grid-section-card")
    if (section) {
      if (value.kind === "source" && value.choice.kind === "pages") numbers(pageRanges(value.choice.pages))
      else if (value.kind === "output") {
        output.select(value.ids)
        outputText = undefined
      }
    }
    if (!section && value.kind === "source" && value.choice.kind === "page" && inputSelected.has(value.choice.page)) {
      if (inputViews.active === "grid") inputViews.set({ position: value.choice.page })
      value = inputPayload()
    } else if (!section && value.kind === "output" && selectedIds.has(value.ids[0])) {
      const ids = outputTargets()
      if (!ids.length) {
        event.preventDefault()
        return
      }
      const id = value.ids[0]
      value = { kind: "output", ids: [id, ...ids.filter((selected) => selected !== id)] }
    }
    const targets = value.kind === "source" ? inputTargets(value.choice) : undefined
    if (value.kind === "source" && !targets) {
      event.preventDefault()
      return
    }
    originOpen = undefined
    cancelMotion()
    const quantity = value.kind === "output" ? value.ids.length : targets!.pages.length * targets!.copies
    const size =
      value.kind === "source"
        ? source?.input.sizes[targets!.pages[0]]
        : output.pages.find((page) => value.kind === "output" && value.ids.includes(page.id))?.content
    const preparing = value.kind === "source" && value.choice.kind === "preparation"
    const draggingPage = Number(
      control.closest(".list-row, .composition-card")?.querySelector<HTMLElement>("[data-page]")?.dataset.page,
    )
    transfer.begin(
      event,
      value,
      quantity,
      control,
      size && "width" in size ? size : size ? sizeOf(size, sources) : undefined,
      targets?.front ?? false,
      targets?.front ? (targets.pages.length % 2) * targets.copies : 0,
      preparing ? Math.max(0, targets!.pages.indexOf(draggingPage)) : 0,
      restore,
    )
    if (value.kind === "source" && value.choice.kind === "page" && inputViews.active === "grid")
      inputViews.set({ position: value.choice.page })
    if (value.kind === "output" && outputView.active === "grid")
      output.position = output.pages.findIndex((page) => page.id === value.ids[0])
  }

  function inputPayload(page?: number): Payload {
    return {
      kind: "source",
      source: source!.id,
      choice: page === undefined ? preparation : inputRange(page),
    }
  }

  function provenance(content: Content) {
    return "source" in content ? sources.find((item) => item.id === content.source) : undefined
  }
  onDestroy(() => {
    transfer.end(true)
    clearTimeout(highlightTimeout)
    cancelMotion()
  })
  function interact(event: Event) {
    if (
      !tour ||
      !(event.target instanceof Element) ||
      !event.target.closest(".composer :is(button, input, select, summary, label, .page-scroll)")
    )
      return
    interaction.inputTab(inputViews.active)
    outputView.tab(outputView.active)
    interaction.view = interaction.activeView
    document.querySelector<HTMLElement>(".help-tour:popover-open")?.hidePopover()
  }
</script>

{#snippet dropPreview(after: boolean)}
  <div
    class="list-drop-preview"
    data-drop={after ? "after" : "before"}
    aria-hidden="true"
    style:--drop-height={`${transfer.stripHeight}px`}
  >
    <strong class="drop-number">{transfer.destination! + 1}</strong>
    <span class="drop-name">{transferName()}</span>{#if transfer.quantity > 1}<span>×{transfer.quantity}</span>{/if}
  </div>
{/snippet}

{#snippet sectionJump(pane: "Input" | "Output", paths: readonly (readonly Section[])[], id: string)}
  <div {id} class="section-path" role="group" aria-labelledby={`${id}-title`}>
    <header><h3 id={`${id}-title`}>Jump to section</h3></header>
    {#each paths as path, index (index)}
      <ol>
        {#each path as node, depth (node.id)}
          {@const content = pane === "Output" ? output.pages[node.start]?.content : undefined}
          {@const physical = content && "source" in content ? content.page + 1 : node.start + 1}
          <li aria-current={depth === path.length - 1 ? "step" : undefined}>
            <button
              type="button"
              class="path-step"
              aria-label={`Go to section: ${node.path.join(" › ")}`}
              onclick={(event) => {
                event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
                originOpen = undefined
                void (pane === "Input" ? inputViews : outputView).sectionView?.revealSection(node.id)
              }}
              ><span class="path-level" aria-hidden="true">{depth + 1}</span><span
                class="path-page"
                aria-label={`Physical page ${physical}`}>{physical}</span
              ><span class:synthetic={node.synthetic}>{node.path.at(-1)}</span></button
            >
          </li>
        {/each}
      </ol>
    {/each}
  </div>
{/snippet}

{#snippet gridRibbon(pane: "Input" | "Output", section: Section, folded: boolean, fold: (key: string) => void)}
  {@const disclosureId = `${key}-${pane}-grid-section-${section.id}`}
  {@const payload: Payload = pane === "Input"
    ? { kind: "source", source: source!.id, choice: inputRange(section.start, section.end) }
    : { kind: "output", ids: outputRange(section.start, section.end) }}
  <button
    id={disclosureId}
    class="page-grip grid-ribbon icon-button"
    type="button"
    draggable="true"
    aria-label={`${folded ? "Unfold" : "Fold"} ${pane} section: ${section.path.join(" › ")}`}
    aria-expanded={!folded}
    title={`${folded ? "Unfold" : "Fold"} section. Drag to ${pane === "Input" ? "add to Output" : "move"}.`}
    onmousedown={retainFocus}
    ondragstart={(event) => start(event, payload)}
    onpointerdown={(event) => transfer.press(event, payload)}
    ondragend={() => transfer.end()}
    onclick={() => fold(section.key)}
    ><span class="ribbon-symbol"><Icon name="ribbon-vertical" /></span><span class="ribbon-dots"
      ><Icon name="grip-four" /></span
    ></button
  >
{/snippet}

{#snippet sectionRow(
  pane: "Input" | "Output",
  first: number,
  end: number,
  path: readonly string[],
  expanded: boolean,
  toggle: () => void,
  id: number,
  origin: Snippet,
  actions: Snippet,
  labels: readonly string[] = path,
)}
  {@const name = path.join(" › ")}
  {@const disclosureId = `${key}-${pane}-section-${id}-disclosure`}
  {@const dragging = transfer.control?.id === disclosureId}
  {@const selected = expanded
    ? pane === "Input"
      ? inputSelected.has(first)
      : selectedIds.has(output.pages[first].id)
    : selectedSection(pane, first, end)}
  {@const payload: Payload = pane === "Input" ? { kind: "source", source: source!.id, choice: inputRange(first, end) } : { kind: "output", ids: outputRange(first, end) }}
  {#if pane === "Output" && !expanded && transfer.inside && !transfer.blocked && ((transfer.targetIndex === first && !transfer.targetAfter) || (transfer.targetIndex === end - 1 && transfer.targetAfter))}
    {@render dropPreview(transfer.targetAfter)}
  {/if}
  <button
    id={disclosureId}
    type="button"
    class="list-disclosure page-grip icon-button"
    class:dragging
    aria-label={`${expanded ? "Fold" : "Unfold"} ${pane} section: ${name}`}
    aria-expanded={expanded}
    title={`${expanded ? "Fold" : "Unfold"} section. Drag to ${pane === "Input" ? "add to Output" : "move"}.`}
    draggable="true"
    onmousedown={retainFocus}
    ondragstart={(event) => start(event, payload)}
    onpointerdown={(event) => transfer.press(event, payload)}
    ondragend={() => transfer.end()}
    onclick={toggle}
    ><span class="ribbon-symbol"><Icon name="ribbon" /></span><span class="ribbon-dots"><Icon name="grip-four" /></span
    ></button
  >
  <div class="list-number">{@render origin()}</div>
  {#if pane === "Input" && source?.input.labels[first] && source.input.labels[first] !== String(first + 1)}<span
      class="list-pdf-label"
      aria-label={`Page Label: ${source.input.labels[first]}`}
      title={source.input.labels[first]}>{source.input.labels[first]}</span
    >{/if}
  <button
    type="button"
    class="list-heading"
    data-page={first}
    aria-label={expanded
      ? `Select ${pane} page ${first + 1}: ${name}`
      : `Select ${pane} section ${name}: pages ${first + 1}–${end}`}
    aria-pressed={selected}
    title={expanded
      ? "Select or unselect this page. Shift-click selects a range."
      : "Select or unselect this section. Shift-click selects a range."}
    onclick={(event) => {
      if (pane === "Input") selectInput(first, event, expanded ? undefined : end)
      else if (event.detail <= 1) restoreOutput = activateOutput(first, event, expanded ? first + 1 : end)
    }}
    ondblclick={(event) => {
      if (interaction.touchPointer || event.ctrlKey || event.metaKey) return
      if (pane === "Input") {
        restoreInput(first)
        inputViews.set({ position: first })
      } else {
        restoreOutput?.()
        restoreOutput = undefined
        output.position = first
      }
      void interaction.toggleView(pane, event)
    }}
    ><span class="list-current">{labels.at(-1)}</span>
    {#if labels.length > 1}<span class="list-parents" aria-hidden="true">
        {#each labels.slice(0, -1).toReversed() as parent, depth (depth)}
          <span class="list-separator">‹</span><span class="list-ancestor">{parent}</span>
        {/each}
      </span>{/if}</button
  >
  <div class="list-actions">{@render actions()}</div>
{/snippet}

<svelte:window
  onpointermove={transfer.moveTouch}
  onpointerup={transfer.finishTouch}
  onpointercancel={transfer.cancelTouch}
  onblur={transfer.blur}
  onresize={() => transfer.end()}
  onclickcapture={transfer.click}
  ondragend={() => transfer.end()}
/>
<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) transfer.end()
  }}
  onfocusin={interact}
  onpointermove={(event) => {
    if (event.pointerType === "mouse") {
      interaction.pointerX = event.clientX
      if (event.movementX || event.movementY) interaction.usingKeyboard = false
    }
  }}
  onpointerdown={(event) => {
    transfer.pointer(event)
    interaction.touchPointer = event.pointerType === "touch" || event.pointerType === "pen"
    if (!(event.target as Element).closest(".page-image")) touchTap = undefined
    if (event.pointerType === "mouse") interaction.pointerX = event.clientX
    interaction.usingKeyboard = false
    interact(event)
    if (!(event.target as Element).closest(".page-origin")) originOpen = undefined
    if (inputViews.menu && !inputViews.menu.contains(event.target as Node)) inputViews.menu.open = false
    if (outputView.menu && !outputView.menu.contains(event.target as Node)) outputView.menu.open = false
  }}
/>

{#snippet comparisonControls(menu = false)}
  <button
    class={menu ? undefined : "tool compare"}
    aria-label="Compare page"
    aria-pressed={comparing && inspection?.kind === "pdf" && !!inspection.comparison?.enabled}
    disabled={inspection?.kind !== "pdf" || !inspection.comparison?.enabled}
    title="Compare page"
    onclick={() => {
      comparing = !comparing
      if (menu && outputView.menu) {
        outputView.menu.open = false
        outputView.menu.querySelector("summary")?.focus({ preventScroll: true })
      }
    }}
    ><Icon name="compare" />{#if menu}Compare{/if}</button
  >
  <button
    class={menu ? undefined : "tool"}
    aria-label="Show original page"
    title="Show original page"
    disabled={inspection?.kind !== "pdf" || !inspection.comparison}
    onclick={showOriginal}
    ><Icon name="original" />{#if menu}Original{/if}</button
  >
{/snippet}

{#snippet zoomControls(pane: "Input" | "Output", menu = false)}
  {@const zoom = pane === "Input" ? inputViews.current.zoom : outputView.zoom}
  <button
    class={menu ? "zoom-step" : "tool zoom-step"}
    aria-label="Zoom out"
    title="Zoom out"
    disabled={zoom <= zoomLevels[0]}
    onclick={() => interaction.zoomBy(pane, -1)}
    >{#if menu}<Icon name="remove" />Zoom out{:else}−{/if}</button
  >
  <button
    class={menu ? "zoom-step" : "tool zoom-step"}
    aria-label="Zoom in"
    title="Zoom in"
    disabled={zoom >= zoomLevels.at(-1)!}
    onclick={() => interaction.zoomBy(pane, 1)}
    >{#if menu}<Icon name="add" />Zoom in{:else}+{/if}</button
  >
{/snippet}

{#snippet zoomReset(pane: "Input" | "Output", fitWidth: () => void, menu = false)}
  {@const zoom = pane === "Input" ? inputViews.current.zoom : outputView.zoom}
  <button
    class={menu ? undefined : "tool page-fit"}
    data-reset={zoom !== 100 || undefined}
    aria-label={zoom === 100 ? "Fit width" : "Reset zoom"}
    title={zoom === 100 ? "Fit width" : "Reset zoom · 0 or Z"}
    onclick={() => (zoom === 100 ? fitWidth() : interaction.setZoom(pane, 100))}
  >
    {#if menu}<Icon name="fit" />{zoom === 100 ? "Fit width" : "Reset zoom"}
    {:else}
      <span class="fit-level" aria-hidden="true">{zoom}%</span>
      <Icon name="fit" />
    {/if}
  </button>
{/snippet}

{#snippet pageTools(pane: "Input" | "Output", fitWidth: () => void)}
  {@const zoom = pane === "Input" ? inputViews.current.zoom : outputView.zoom}
  <div class="page-tools" role="group" aria-label={`${pane} Page controls`}>
    {#if pane === "Output"}{@render comparisonControls()}{/if}
    <div class="page-zoom" style:--digits={String(zoom).length}>
      <output aria-label={`${pane} page zoom`}>{zoom}%</output>
      {@render zoomControls(pane)}
      {@render zoomReset(pane, fitWidth)}
    </div>
  </div>
{/snippet}

{#snippet pageFace(index: number)}
  {@const front = index % 2 === 0}
  <span
    class="page-face"
    role="img"
    aria-label={front ? "Front side" : "Back side"}
    title={front ? "Front side" : "Back side"}
  >
    {#if !front}<svg class="page-fold" viewBox="0 0 24 24" aria-hidden="true">
        <path
          class="fold-fill"
          d="M0 1Q0 0 1 1L23 23Q24 24 23 24H6A6 6 0 0 1 0 18Z"
          vector-effect="non-scaling-stroke"
        />
        <path class="fold-edge" d="M0 0V18A6 6 0 0 0 6 24H24" vector-effect="non-scaling-stroke" />
      </svg>{/if}
  </span>
{/snippet}

{#snippet inputSummary()}
  {@const pages = source?.input.pdf.numPages ?? 0}
  <strong>{pages} {pages === 1 ? "page" : "pages"}</strong>, {Math.ceil(pages / 2)}
  {Math.ceil(pages / 2) === 1 ? "sheet" : "sheets"}
{/snippet}

{#snippet outputName(menu = false)}
  {#if menu}
    <div class="entry output-filename">
      <input
        aria-label="Output filename"
        value={filename || suggestFilename()}
        onchange={(event) => {
          const name = event.currentTarget.value
          const failure = filenameError(name)
          if (failure) {
            error(failure)
            event.currentTarget.value = filename || suggestFilename()
            return
          }
          setFilename(normalizeFilename(name, ".pdf"))
        }}
      />
      <button
        class="icon-button"
        aria-haspopup="dialog"
        aria-label="Set Output filename"
        title="Output details"
        onclick={(event) => rename(closeDocument() ?? event.currentTarget)}><Icon name="next" /></button
      >
    </div>
  {:else}
    <button
      class="output-name"
      aria-label="Set Output filename"
      aria-haspopup="dialog"
      title={filename ? `Output filename · ${filename}` : "Set Output filename"}
      onclick={(event) => rename(closeDocument() ?? event.currentTarget)}
      ><Icon name="output" /><span>Output</span><Icon name="next" /></button
    >
  {/if}
{/snippet}

{#snippet recipeAction(menu = false)}
  <button
    class="icon-button recipe-action"
    aria-label="Export recipe"
    title={downloadError ?? "Export recipe"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    onclick={() => {
      closeDocument()
      recipe()
    }}
    ><Icon name="json" />{#if menu}<span>Export recipe</span>{/if}</button
  >
{/snippet}

{#snippet printAction(menu = false)}
  <button
    class="icon-button print-action"
    aria-label="Print PDF"
    title={downloadError ?? "Print Output PDF"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    onclick={() => {
      closeDocument()
      print()
    }}
    ><Icon name="print" />{#if menu}<span>Print PDF</span>{/if}</button
  >
{/snippet}

{#snippet viewAction(menu = false)}
  <button
    class="icon-button view-action"
    aria-label="View PDF"
    title={downloadError ?? "View Output PDF"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    onclick={() => {
      closeDocument()
      viewPDF()
    }}
    ><Icon name="eye" />{#if menu}<span>View PDF</span>{/if}</button
  >
{/snippet}

{#snippet saveOutput()}
  <button
    class={{ primary: true, "share-action": sharing }}
    aria-label={sharing ? "Share" : "Download"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    title={downloadError ?? (sharing ? "Share" : "Download")}
    aria-describedby={downloadError ? `${key}-download-error` : undefined}
    onclick={download}><Icon name={sharing ? "share" : "down"} /><span>{sharing ? "Share" : "Download"}</span></button
  >
{/snippet}

{#snippet outputSummary()}
  <strong>{output.pages.length} {output.pages.length === 1 ? "page" : "pages"}</strong>, {Math.ceil(
    output.pages.length / 2,
  )}
  {Math.ceil(output.pages.length / 2) === 1 ? "sheet" : "sheets"}
{/snippet}

<div
  class="composer"
  data-compact={compact || undefined}
  style:--page-heading-height={frameHeadingHeight ? `${frameHeadingHeight + 1}px` : undefined}
  data-view={interaction.activeView}
  data-drag={transfer.value?.kind}
  data-touch={interaction.touchPointer || undefined}
  data-touch-drag={transfer.touching || undefined}
  data-keyboard={interaction.usingKeyboard}
  inert={opening}
  aria-busy={opening}
  {@attach transfer.track}
  {@attach layout}
>
  <div class="workspace-bar">
    <nav class="mobile-workspace-tabs" aria-label="Workspace view">
      <button
        bind:this={inputTarget}
        id={`${key}-input-switch`}
        aria-label="Input"
        aria-describedby={`${key}-input-counts`}
        aria-pressed={interaction.activeView === "input" && !!source}
        popovertarget={compact && interaction.activeView === "input" ? `${key}-document-menu` : undefined}
        data-tour-target={compact ? "input" : undefined}
        data-tour-active={(compact && tour === "input") || undefined}
        disabled={!source}
        onclick={(event) => switchPane("input", event)}
        ><span class="workspace-label">
          <span>Input</span>{#if interaction.activeView === "input"}<Icon name="next" />{/if}
        </span><small id={`${key}-input-counts`} class="workspace-counts" {@attach summary}>
          <span class="composition-totals">{@render inputSummary()}</span>
          <span class="page-count">{count} {count === 1 ? "page" : "pages"}</span>
        </small></button
      >
      <button
        bind:this={outputTarget}
        id={`${key}-output-switch`}
        aria-label="Output"
        aria-describedby={`${key}-output-counts`}
        aria-pressed={interaction.activeView === "output"}
        popovertarget={compact && interaction.activeView === "output" ? `${key}-document-menu` : undefined}
        data-drop={transfer.touching &&
        transfer.value?.kind === "source" &&
        interaction.activeView === "input" &&
        transfer.inside
          ? true
          : undefined}
        onclick={(event) => switchPane("output", event)}
        ><span class="workspace-label">
          <span>Output</span>{#if interaction.activeView === "output"}<Icon name="next" />{/if}
        </span><small id={`${key}-output-counts`} class="workspace-counts" {@attach summary}>
          <span class="composition-totals">{@render outputSummary()}</span>
          <span class="page-count">{output.pages.length} {output.pages.length === 1 ? "page" : "pages"}</span>
        </small></button
      >
    </nav>
    {#if compact}
      {#key interaction.activeView}
        <div
          id={`${key}-document-menu`}
          bind:this={documentMenu}
          class={["document-menu", interaction.activeView === "input" ? "input-list" : "document-actions"]}
          popover="auto"
          role="group"
          aria-label={interaction.activeView === "input" ? "Inputs" : "Output actions"}
        >
          {#if interaction.activeView === "input"}
            {@render inputChoices(closeDocument, true)}
          {:else}
            {@render outputName(true)}
            <hr />
            {@render viewAction(true)}{@render printAction(true)}{@render recipeAction(true)}
          {/if}
        </div>
      {/key}
      {#if interaction.activeView === "input" && source}
        {@render openPDF()}
      {:else}
        <div class="output-actions" data-tour-target="download" data-tour-active={tour === "download"}>
          {@render saveOutput()}
        </div>
      {/if}
    {/if}
  </div>
  {#if compact && downloadError}<span hidden id={`${key}-download-error`}>{downloadError}</span>{/if}
  <div class="composition-panels">
    <InputPane
      {key}
      {compact}
      {source}
      {styleable}
      {styling}
      {input}
      {viewInputPDF}
      view={inputViews}
      {draft}
      invalid={!!parsed.error}
      {selectionError}
      selected={inputSelected}
      {output}
      {insertion}
      {interaction}
      {transfer}
      {start}
      {tour}
      {opening}
      {magnification}
      {error}
      {peeks}
      {highlight}
      bind:originOpen
      actions={{
        numbers,
        set,
        clear: clearInput,
        all: () => selectAll("Input"),
        selectedSection: (first, end) => selectedSection("Input", first, end),
        toggle,
        select: selectInput,
        section: (first, end) => selectSection("Input", first, end),
        add: () => commandInput(),
        focused: (page, end) => commandInput(focusedInput(page, end)),
        individual: (page, end) => commandInput(inputRange(page, end), undefined, false),
        payload: inputPayload,
        selectRow(page, event) {
          if (!source) return
          const id = source.id,
            previous = draft,
            anchor = sourceAnchor
          selectInput(page, event)
          return () => {
            if (source?.id !== id) return
            choose(id, previous)
            sourceAnchor = anchor
            highlightRange()
          }
        },
        doubleClick(page, event) {
          if (
            !interaction.touchPointer &&
            !event.ctrlKey &&
            !event.metaKey &&
            source &&
            inputClick?.source === source.id &&
            inputClick.page === page
          ) {
            restoreInput(page)
            commandInput(focusedInput(page))
          }
        },
      }}
      snippets={{
        summary,
        counts: inputSummary,
        pageFace,
        pageTools,
        zoomControls,
        zoomReset,
        gridRibbon,
        sectionRow,
        sectionJump,
      }}
    />

    <OutputPane
      bind:this={outputPane}
      {key}
      {compact}
      {output}
      {sources}
      view={outputView}
      inputs={inputViews}
      {inspection}
      bind:opened={originOpen}
      bind:comparing
      {outputText}
      {outputSelectionError}
      {positions}
      {adjacent}
      bind:repetitions
      bind:front
      {repeatError}
      {interaction}
      {transfer}
      {start}
      {tour}
      {opening}
      {magnification}
      {error}
      {peeks}
      {highlight}
      {feedback}
      {removal}
      {pageName}
      {downloadError}
      {outputName}
      {comparisonControls}
      {dropPreview}
      actions={{
        numbers: outputNumbers,
        all: () => selectAll("Output"),
        selectedSection: (first, end) => selectedSection("Output", first, end),
        clear: clearOutput,
        select: selectOutput,
        activate: activateOutput,
        section: (first, end) => selectSection("Output", first, end),
        targets: outputTargets,
        edit: commandOutput,
        blank,
        repeat,
      }}
      snippets={{
        summary,
        counts: outputSummary,
        pageFace,
        pageTools,
        zoomControls,
        zoomReset,
        gridRibbon,
        sectionRow,
        sectionJump,
      }}
    >
      {#snippet documentActions()}
        {@render recipeAction()}{@render printAction()}{@render viewAction()}{@render saveOutput()}
      {/snippet}
    </OutputPane>
  </div>
</div>
