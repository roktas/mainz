<!-- Coordinates pane views, page selections, Output edits, and transfers. -->

<script lang="ts">
  import Feedback from "./Feedback.svelte"
  import { onDestroy, tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { copyError, parseCopies, sizeOf, titleOf, uid } from "./model.ts"
  import type { Content, Expanded, Page, Part, Source } from "./model.ts"
  import { titlesOf } from "./outline.ts"
  import type { Section } from "./sections.ts"
  import Contents from "./Contents.svelte"
  import * as composition from "./composition.ts"
  import type { Edit, Output } from "./output.svelte.ts"
  import { pageRanges, parseSequence, toggleGroup, toggleSequence } from "./pages.ts"
  import { Interaction } from "./interaction.svelte.ts"
  import type { InputView } from "./interaction.svelte.ts"
  import type { Sequence } from "./pages.ts"
  import Pdf from "./Pdf.svelte"
  import { retainFocus } from "./drag.ts"
  import { Transfer } from "./transfer.svelte.ts"
  import type { Payload } from "./transfer.svelte.ts"
  import { animateAddition, animateMove, animateOrder, animateRemoval, Edits } from "./motion.ts"
  import Repetition from "./Repetition.svelte"
  import Selection from "./Selection.svelte"
  import Origin from "./Origin.svelte"
  import Grid from "./Grid.svelte"
  import type { Viewport as GridViewport } from "./Grid.svelte"
  import List from "./List.svelte"
  import type { Viewport } from "./List.svelte"
  import Row from "./Row.svelte"
  import Peek, { Peeks } from "./Peek.svelte"
  import PageView, { controlCapabilities, zoomLevels } from "./Page.svelte"
  import type { Inspection, Region, Controls } from "./Page.svelte"
  import type { Magnification } from "./Lens.svelte"
  import Counter from "./Counter.svelte"
  import Jump from "./Jump.svelte"
  import Icon from "./Icon.svelte"
  import type { TourStep } from "./Tour.svelte"
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
    input: Snippet<[heading: string, compact?: boolean]>
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
  let outputZoom = $state(100)
  let comparing = $state(false)
  const key = $props.id()
  const viewTabs = ["grid", "list", "page"] as const
  const viewLabels = { grid: "Grid", list: "List", page: "Page" }
  let compact = $state(false)
  let documentMenu = $state<HTMLDetailsElement>()
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
    if (documentMenu?.open) {
      documentMenu.open = false
      const launcher = documentMenu.querySelector("summary")!
      launcher.focus()
      return launcher
    }
  }
  function dismissDocument(event: MouseEvent | KeyboardEvent) {
    if (!documentMenu?.open) return
    if (event instanceof KeyboardEvent && event.key === "Escape") {
      closeDocument()
      event.preventDefault()
    } else if (event instanceof MouseEvent && !documentMenu.contains(event.target as Node)) documentMenu.open = false
  }
  const initialView: InputView = {
    grouped: true,
    tocTitles: false,
    tab: untrack(() => (initial.input === "grid" || initial.input === "list" ? "pages" : initial.input)),
    pagesMode: untrack(() => (initial.input === "list" ? "list" : "grid")),
    position: 0,
    zoom: 100,
    offset: 0,
    region: { x: 0, y: 0 },
  }
  let inputViews = $state.raw<Record<string, InputView>>({})
  const inputView = $derived((source && inputViews[source.id]) ?? initialView)
  const titleChoice = $derived(source ? titlesOf(source.input).choice : false)
  const inputPosition = $derived(inputView.position)
  let inputControls = $state<Controls>("all")
  let outputControls = $state<Controls>("all")
  let inputPage = $state<ReturnType<typeof PageView>>()
  let inputGrid = $state<ReturnType<typeof Grid>>()
  let outputGrid = $state<ReturnType<typeof Grid>>()
  let inputList = $state<ReturnType<typeof List>>()
  let outputList = $state<ReturnType<typeof List>>()
  let outputFolds = $state<ReadonlySet<string>>()
  const outputListViewport: Viewport = { scroll: 0 }
  const outputGridViewport: GridViewport = { scroll: 0 }
  const inputListViewports = new Map<string, Viewport>()
  const inputGridViewports = new Map<string, GridViewport>()
  $effect(() => {
    const retained = new Set(sources.map(({ id }) => id))
    for (const id of inputListViewports.keys()) if (!retained.has(id)) inputListViewports.delete(id)
    for (const id of inputGridViewports.keys()) if (!retained.has(id)) inputGridViewports.delete(id)
    const storedViews = untrack(() => inputViews)
    if (Object.keys(storedViews).some((id) => !retained.has(id)))
      inputViews = Object.fromEntries(Object.entries(storedViews).filter(([id]) => retained.has(id)))
  })
  function gridViewport(id: string) {
    let value = inputGridViewports.get(id)
    if (!value) {
      value = { scroll: 0 }
      inputGridViewports.set(id, value)
    }
    return value
  }
  function listViewport(id: string) {
    let value = inputListViewports.get(id)
    if (!value) {
      value = { scroll: 0 }
      inputListViewports.set(id, value)
    }
    return value
  }
  let outputGrouped = $state(true)
  let outputPage = $state<ReturnType<typeof PageView>>()
  let outputPageInitialized = $state(false)
  const tocTitlesRevision = $derived(sources.map((item) => !!inputViews[item.id]?.tocTitles).join(","))
  const outputListRevision = $derived({ pages: output.pages, grouped: outputGrouped, titles: tocTitlesRevision })
  let outputOffset = $state(0)
  let outputText = $state<string>()
  let repetitions = $state("2")
  let front = $state(false)
  let outputTab = $state<"pages" | "page">(untrack(() => (initial.output === "page" ? "page" : "pages")))
  let outputPagesMode = $state<"grid" | "list">(untrack(() => (initial.output === "list" ? "list" : "grid")))
  let outputRegion = $state<Region>({ x: 0, y: 0 })
  let view = $state<"input" | "output">("input")
  let touchTap: { pane: "Input" | "Output"; element: EventTarget | null; time: number; restore: () => void } | undefined
  let inputCounter: ReturnType<typeof Counter> | undefined
  let outputCounter: ReturnType<typeof Counter> | undefined
  let originOpen = $state<string>()
  const peeks = new Peeks()
  let inputMenu = $state<HTMLDetailsElement>(null!)
  let outputMenu = $state<HTMLDetailsElement>(null!)
  let outputTarget = $state<HTMLButtonElement>()
  let sourceAnchor: { source: string; page: number } | undefined
  let inputClick: { source: string; page: number; sequence: Sequence; anchor: typeof sourceAnchor } | undefined
  let highlight = $state<
    | { kind: "source"; source: string; first: number; last: number }
    | { kind: "output"; ids: ReadonlySet<string>; removing?: boolean }
  >()
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
  const arriving = feedback.arriving
  const removing = feedback.removing
  const removingPage = $derived(feedback.page.size > 0)
  const count = $derived(source?.input.pdf.numPages ?? 0)
  const catalog = $derived(Array.from({ length: count }, (_, page) => page))
  const hasStyles = $derived(!!source && Object.keys(source.input.description.parameters).length > 0)
  const activeTab = $derived(
    tour?.startsWith("style") && styleable
      ? "style"
      : tour === "input-page"
        ? "page"
        : tour === "input-list"
          ? "list"
          : tour === "input-grid"
            ? "grid"
            : inputView.tab === "style" && !styleable
              ? inputView.pagesMode
              : inputView.tab === "pages"
                ? inputView.pagesMode
                : inputView.tab,
  )
  const activeOutputTab = $derived(
    tour === "output-page"
      ? "page"
      : tour === "output-list"
        ? "list"
        : tour === "output-grid" || tour === "output-selection"
          ? "grid"
          : outputTab === "pages"
            ? outputPagesMode
            : outputTab,
  )
  const inputSectionView = $derived(activeTab === "list" ? inputList : activeTab === "grid" ? inputGrid : undefined)
  const outputSectionView = $derived(
    activeOutputTab === "list" ? outputList : activeOutputTab === "grid" ? outputGrid : undefined,
  )
  const activeView = $derived(
    !source || tour?.startsWith("output-") || tour === "download"
      ? "output"
      : tour === "input" || tour?.startsWith("input-") || tour?.startsWith("style")
        ? "input"
        : view,
  )
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
  const allInput = $derived(
    !parsed.error && parsed.pages.length === count && parsed.pages.every((page, index) => page === index),
  )
  const selectionError = $derived(parsed.error ?? copyError(draft.repeat))
  const inspected = $derived(output.pages[output.position])
  const inputInspection = $derived(
    source
      ? {
          kind: "pdf" as const,
          pdf: source.input.pdf,
          page: inputPosition,
          size: source.input.sizes[inputPosition],
        }
      : undefined,
  )
  let inputHeadingHeight = $state(0)
  let outputHeadingHeight = $state(0)
  const frameHeadingHeight = $derived(
    Math.max(
      activeTab === "page" && inputInspection ? inputHeadingHeight : 0,
      activeOutputTab === "page" && inspection ? outputHeadingHeight : 0,
    ),
  )
  const selectedIds = $derived(output.selection)
  const positions = $derived(output.selected.map((id) => output.positions.get(id)!))
  const chosen = $derived(positions.map((index) => output.pages[index]))
  const insertion = $derived(positions.length ? positions.at(-1)! + 1 : undefined)
  const outputSelection = $derived(parseSequence(outputText ?? "", output.pages.length))
  const outputSelectionError = $derived(outputText === undefined ? undefined : outputSelection.error)
  const outputPositions = $derived(composition.destinations(output.pages, source?.id))
  const adjacent = $derived(positions.every((position, i) => i === 0 || position === positions[i - 1] + 1))
  const repeatError = $derived(copyError(repetitions))
  const inputSelected = $derived(new Set(inputPages))
  const transfer = new Transfer({
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
      return activeView === "input"
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
      view = "output"
    },
  })
  const interaction = new Interaction({
    get key() {
      return key
    },
    get source() {
      return source
    },
    get activeTab() {
      return activeTab
    },
    get activeOutputTab() {
      return activeOutputTab
    },
    get activeView() {
      return activeView
    },
    get inputPosition() {
      return inputPosition
    },
    get output() {
      return output
    },
    get inputView() {
      return inputView
    },
    get outputPagesMode() {
      return outputPagesMode
    },
    revealGrid: (pane, index) => (pane === "Input" ? inputGrid : outputGrid)?.revealPage(index),
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
    get inputMenu() {
      return inputMenu
    },
    get outputMenu() {
      return outputMenu
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
    get outputSelectionError() {
      return outputSelectionError
    },
    get outputOffset() {
      return outputOffset
    },
    set outputOffset(value) {
      outputOffset = value
    },
    get pendingAddition() {
      return pendingAddition
    },
    get styleable() {
      return styleable
    },
    inputTab,
    setOutputTab,
    inspectInput,
    selectAll,
    zoomBy,
    setZoom,
    editPage,
    copyCurrent,
    clearInput,
    clearOutput,
    outputTargets,
    remove,
    order,
  })
  const listPreview = $derived(activeOutputTab === "list" && transfer.destination !== undefined)
  const skippedRows = $derived(
    listPreview && transfer.value?.kind === "output"
      ? new Set(transfer.value.ids.map((id) => output.positions.get(id)!))
      : undefined,
  )
  const retainedRow = $derived(
    transfer.value?.kind === "output" ? output.positions.get(transfer.value.ids[0]) : undefined,
  )
  $effect.pre(() => {
    if (activeOutputTab !== "list") return
    const destination = transfer.destination
    const list = document.getElementById(`${key}-output-panel`)?.querySelector<HTMLElement>(".page-list")
    if (!list) return
    const previous = feedback.move
    feedback.move = animateOrder(list, destination === undefined ? 240 : 180, destination === undefined)
    previous?.()
  })
  export function views() {
    return { input: activeTab, output: activeOutputTab }
  }
  function inspectInput(patch: Partial<InputView>, id = source?.id) {
    if (!id) return
    inputViews = { ...inputViews, [id]: { ...(inputViews[id] ?? initialView), ...patch } }
  }
  async function goTo(pane: "Input" | "Output", position: number, event: MouseEvent) {
    if (pane === "Input") inspectInput({ position, offset: position, alignment: undefined })
    else {
      output.position = position
      outputOffset = position
    }
    await tick()
    const list = pane === "Input" ? inputList : outputList
    const grid = pane === "Input" ? inputGrid : outputGrid
    await list?.revealPage(position)
    await grid?.revealPage(position)
    await interaction.reveal(pane, event, true)
  }
  function inputTab(mode: "grid" | "list" | "page" | "style", event?: MouseEvent | KeyboardEvent) {
    const previous = activeTab
    const changed = mode !== previous
    if (changed) interaction.rememberView("Input", previous)
    if (changed && activeTab === "list") inputList?.remember()
    cancelMotion()
    inspectInput({
      tab: mode === "grid" || mode === "list" ? "pages" : mode,
      ...(mode === "grid" || mode === "list" ? { pagesMode: mode } : {}),
      ...(mode === "grid" ? { offset: inputPosition } : {}),
    })
    if (changed && !((previous === "grid" || previous === "list") && (mode === "grid" || mode === "list")))
      void interaction.reveal("Input", event)
  }
  const outputBooks = $derived(
    new Set(output.pages.flatMap((page) => ("source" in page.content ? [page.content.source] : []))),
  )
  const outputFirsts = $derived.by(() => {
    const firsts = new Map<string, string>()
    for (const page of output.pages)
      if ("source" in page.content && !firsts.has(page.content.source)) firsts.set(page.content.source, page.id)
    return firsts
  })
  const outlineStarts = new WeakMap<object, Map<string, number>>()
  function displayName(origin: Source | undefined, page: number) {
    return origin ? titlesOf(origin.input).at(page, inputViews[origin.id]?.tocTitles).name : undefined
  }
  function inputName(page: number) {
    return displayName(source, page)
  }
  function pageName(content: Content) {
    return "source" in content ? displayName(provenance(content), content.page) : undefined
  }
  function inputHeadings(page: number) {
    return source ? titlesOf(source.input).at(page).headings : []
  }
  function outputHeadings(content: Content, index: number) {
    if (!("source" in content)) return []
    const document = provenance(content)?.input
    if (!document) return []
    const headings = titlesOf(document).at(content.page).headings
    let starts = outlineStarts.get(document)
    if (!starts) {
      starts = new Map((document.outline ?? []).map((entry) => [entry.keys.at(-1)!, entry.page]))
      outlineStarts.set(document, starts)
    }
    const path = outputBooks.size > 1 ? [titleOf(document)] : []
    const keys = outputBooks.size > 1 ? [content.source] : []
    const rootStart = outputBooks.size > 1 ? [outputFirsts.get(content.source) === output.pages[index].id] : []
    return headings.length
      ? headings.map((heading) => ({
          path: [...path, ...heading.path],
          keys: [...keys, ...heading.keys.map((node) => `${content.source}:${node}`)],
          starts: [...rootStart, ...heading.keys.map((node) => starts.get(node) === content.page)],
          synthetic: heading.synthetic,
        }))
      : path.length
        ? [{ path, keys, starts: rootStart }]
        : []
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
  function setOutputTab(mode: "grid" | "list" | "page", event?: MouseEvent | KeyboardEvent) {
    const previous = activeOutputTab
    const changed = mode !== previous
    if (changed) interaction.rememberView("Output", previous)
    if (changed && activeOutputTab === "list") outputList?.remember()
    cancelMotion()
    outputTab = mode === "grid" || mode === "list" ? "pages" : mode
    if (mode === "grid" || mode === "list") outputPagesMode = mode
    if (mode === "grid") outputOffset = output.position
    if (changed && !((previous === "grid" || previous === "list") && (mode === "grid" || mode === "list")))
      void interaction.reveal("Output", event)
  }

  function setZoom(pane: "Input" | "Output", zoom: number) {
    if (pane === "Input") inspectInput({ zoom, pageInitialized: true, alignment: undefined })
    else {
      outputZoom = zoom
      outputPageInitialized = true
    }
  }
  function zoomBy(pane: "Input" | "Output", offset: number) {
    const zoom = pane === "Input" ? inputView.zoom : outputZoom
    setZoom(
      pane,
      (offset > 0 ? zoomLevels.find((level) => level > zoom) : zoomLevels.findLast((level) => level < zoom)) ?? zoom,
    )
  }

  function editPage(pane: "Input" | "Output") {
    originOpen = undefined
    ;(pane === "Input" ? inputCounter : outputCounter)?.edit()
  }
  function showOriginal() {
    if (!inspected || !("source" in inspected.content)) return
    outputMenu.open = false
    const { source: id, page } = inspected.content
    inspectInput(
      {
        tab: "page",
        position: page,
        zoom: outputZoom,
        pageInitialized: true,
        region: { ...outputRegion },
        alignment: { ...outputRegion },
      },
      id,
    )
    activate(id)
    view = "input"
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
    inspectInput({ position: page })
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
      node.inert = true
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
    const panel = document.getElementById(`${key}-output-panel`)
    const image =
      activeOutputTab === "page"
        ? id === inspected?.id
          ? panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
          : undefined
        : document
            .getElementById(`${key}-${id}`)
            ?.querySelector<HTMLElement>(".page-image :is(canvas, .composition-blank), .list-choice")
    return image ?? panel?.querySelector<HTMLElement>(".sequence-entry")
  }
  function animateEdit(edit: Edit, origin?: HTMLElement | null) {
    cancelMotion()
    const expanded = edit.pages
    const added = expanded.filter((page) => edit.added.has(page.id))
    feedback.prepare(edit, activeOutputTab)
    const reordering =
      !added.length && !removing.size && expanded.some((page, index) => page.id !== output.pages[index]?.id)
    const panel = document.getElementById(`${key}-output-panel`)
    if (activeOutputTab === "list") {
      const list = panel?.querySelector<HTMLElement>(".page-list")
      if (list) feedback.move = animateOrder(list, 240, reordering)
    }
    if (added.length && !transfer.value) {
      const sheet = origin ?? additionOrigin("blank" in added[0].content ? undefined : chosen[0]?.id)
      if (sheet) {
        feedback.addition = animateAddition(
          sheet,
          sizeOf(added[0].content, sources),
          "blank" in added[0].content,
          added.length,
          () => {
            const button = outputTarget
            const image = panel?.querySelector<HTMLElement>(
              ".composition-card[data-adding] .page-image, .list-row[data-arriving]",
            )
            if (button?.offsetWidth && (origin?.closest(".selection-panel") || !image)) return button
            return image ?? document.getElementById(`${key}-output`)
          },
          () => {
            const id = inspected?.id
            const focused = document.activeElement
            const restore = id && pendingAddition.has(id) && focused?.matches(".composition-output .composition-grid")
            pendingAddition.clear()
            if (restore)
              void tick().then(() => {
                if (document.activeElement === focused && inspected?.id === id)
                  document
                    .getElementById(`${key}-${id}`)
                    ?.querySelector<HTMLElement>(".page-image")
                    ?.focus({ preventScroll: true })
              })
          },
        )
      }
      if (feedback.addition && activeOutputTab !== "list") for (const page of added) pendingAddition.add(page.id)
    }
    if (inspected && removing.has(inspected.id) && activeOutputTab === "page") {
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet) feedback.removal = animateRemoval(sheet, () => feedback.page.clear())
      if (feedback.removal) feedback.page.add(inspected.id)
    }
    if (reordering && inspected && activeOutputTab === "page") {
      const position = expanded.findIndex((page) => page.id === inspected.id)
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet && position !== output.position) feedback.move = animateMove(sheet, position - output.position)
    }
    if (reordering && activeOutputTab === "grid") {
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
      const focus = interaction.captureEditFocus(!!select)
      const edit = output.commit(
        next,
        { select, inspect: inspect ?? focus.inspect, focusSelection: focus.focusSelection },
        (candidate) => animateEdit(candidate, origin),
      )
      change(text)
      inputMenu?.removeAttribute("open")
      outputMenu?.removeAttribute("open")
      outputText = undefined
      if (select && output.anchor) outputOffset = output.positions.get(output.anchor)!
      if (select) highlightRange({ kind: "output", ids: new Set(edit.selected) })
      focus.restore(edit)
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
  function inputTargets(page: number) {
    return draft.pages.length ? undefined : [page]
  }
  function outputTargets(id?: string) {
    if (outputSelectionError) return []
    if (id !== undefined) return chosen.length ? [] : [id]
    return chosen.map((page) => page.id)
  }
  function add(at = insertion, pages?: readonly number[], selection: "new" | "keep" = "new") {
    if (!source) return
    if (pages === undefined && (selectionError || !parsed.pages.length)) return
    const copies = pages === undefined ? parseCopies(draft.repeat) : 1
    if (copies === undefined) return
    const inputBar = (document.activeElement as HTMLElement | null)?.closest(".selection-panel .sequence-entry")
    const next = composition.part(
      (pages ?? parsed.pages).map((number) => ({
        id: uid(),
        content: { source: source.id, page: number },
      })),
      copies,
      pages === undefined ? draft.front : false,
    )
    const quantity = next.pages.length * next.copies
    const label = `${quantity} ${quantity === 1 ? "page" : "pages"}`
    const updated = composition.insert(output.parts, output.pages, next, at)
    const panel = document.getElementById(`${key}-source-panel`)
    const first = (pages ?? parsed.pages)[0]
    const sheet =
      (activeTab === "page"
        ? first === inputPosition
          ? panel?.querySelector<HTMLElement>(".page-scroll canvas")
          : undefined
        : panel?.querySelector<HTMLElement>(
            `.page-image[data-page="${first}"] canvas, .list-choice[data-page="${first}"]`,
          )) ?? panel?.querySelector<HTMLElement>(".sequence-entry")
    const completed = commit(
      updated,
      at === undefined
        ? `Added ${label} to Output.`
        : at === 0
          ? `Inserted ${label} at the start of Output.`
          : `Inserted ${label} after Output page ${at}.`,
      selection === "new"
        ? (expanded) => expanded.filter((page) => page.part === next.id).map((page) => page.id)
        : undefined,
      sheet,
    )
    if (completed && pages === undefined) {
      clearInput()
      if (inputBar && !transfer.touching) interaction.focusAfterSelection("Input")
    }
    return completed
  }
  function selectOutput(id: string, range: boolean, anchor?: string) {
    outputText = undefined
    const next = output.toggle(id, range, anchor)
    const { index, ids, adding } = next
    if (activeOutputTab === "grid") output.position = index
    highlightRange(adding && range && ids.length > 1 ? { kind: "output", ids: new Set(ids) } : undefined)
  }
  function order(offset: number, ids = outputTargets()) {
    const next = composition.order(output.pages, ids, offset)
    if (!next) return
    if (
      replace(
        next.pages,
        `Moved ${next.count} ${next.count === 1 ? "page" : "pages"} ${offset < 0 ? "earlier" : "later"}.`,
      )
    ) {
      highlightRange({ kind: "output", ids: new Set(ids) })
      if (activeOutputTab === "grid") outputOffset = output.position
    }
  }
  function duplicate(ids = outputTargets(), selection: "new" | "keep" = "new") {
    const next = composition.duplicate(output.pages, ids)
    if (!next) return
    return replace(
      next.pages,
      `Copied ${next.ids.length} ${next.ids.length === 1 ? "page" : "pages"} after Output page ${next.at}.`,
      selection === "new" ? () => next.ids : undefined,
      additionOrigin(ids[0]),
    )
  }
  function copyCurrent(pane: "Input" | "Output") {
    if (pane === "Input") return add(undefined, [inputPosition], "keep")
    if (inspected && !outputSelectionError) return duplicate([inspected.id], "keep")
  }
  function remove(ids = outputTargets()) {
    const next = composition.remove(output.pages, ids)
    if (!next) return
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
    if (!chosen.length || !adjacent || repeatError || outputSelectionError) return
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
    if (value.kind === "source")
      return (
        value.source === source?.id &&
        !!add(
          at,
          value.choice.kind === "preparation"
            ? undefined
            : value.choice.kind === "pages"
              ? value.choice.pages
              : [value.choice.page],
        )
      )
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
      outputOffset = output.position
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
    const section = control.closest(".list-section, .grid-section-card")
    if (section) {
      if (value.kind === "source" && value.choice.kind === "pages") numbers(pageRanges(value.choice.pages))
      else if (value.kind === "output") {
        output.select(value.ids)
        outputText = undefined
      }
    }
    if (!section && value.kind === "source" && value.choice.kind === "page" && inputSelected.has(value.choice.page)) {
      if (activeTab === "grid") inspectInput({ position: value.choice.page })
      value = inputPayload()
    } else if (!section && value.kind === "output" && selectedIds.has(value.ids[0])) {
      if (outputSelectionError) {
        event.preventDefault()
        return
      }
      const id = value.ids[0]
      value = { kind: "output", ids: [id, ...chosen.filter((page) => page.id !== id).map((page) => page.id)] }
    }
    if (value.kind === "source" && value.choice.kind === "preparation" && (selectionError || !parsed.pages.length)) {
      event.preventDefault()
      return
    }
    originOpen = undefined
    cancelMotion()
    const quantity =
      value.kind === "output"
        ? value.ids.length
        : value.choice.kind === "pages"
          ? value.choice.pages.length
          : value.choice.kind === "preparation"
            ? parsed.pages.length * parseCopies(draft.repeat)!
            : 1
    const size =
      value.kind === "source"
        ? source?.input.sizes[
            value.choice.kind === "page"
              ? value.choice.page
              : value.choice.kind === "pages"
                ? value.choice.pages[0]
                : parsed.pages[0]
          ]
        : output.pages.find((page) => value.kind === "output" && value.ids.includes(page.id))?.content
    const preparation = value.kind === "source" && value.choice.kind === "preparation"
    const draggingPage = Number(
      control.closest(".list-row, .composition-card")?.querySelector<HTMLElement>("[data-page]")?.dataset.page,
    )
    transfer.begin(
      event,
      value,
      quantity,
      control,
      size && "width" in size ? size : size ? sizeOf(size, sources) : undefined,
      preparation && draft.front,
      preparation && draft.front ? (parsed.pages.length % 2) * parseCopies(draft.repeat)! : 0,
      preparation ? Math.max(0, parsed.pages.indexOf(draggingPage)) : 0,
    )
    if (value.kind === "source" && value.choice.kind === "page" && activeTab === "grid")
      inspectInput({ position: value.choice.page })
    if (value.kind === "output" && activeOutputTab === "grid")
      output.position = output.pages.findIndex((page) => page.id === value.ids[0])
  }

  function inputPayload(page?: number): Payload {
    return {
      kind: "source",
      source: source!.id,
      choice: page === undefined ? { kind: "preparation" } : { kind: "page", page },
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
    inputTab(activeTab)
    outputTab = activeOutputTab === "page" ? "page" : "pages"
    if (activeOutputTab !== "page") outputPagesMode = activeOutputTab
    view = activeView
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

{#snippet pageJump(pane: "Input" | "Output", page: number)}
  {@const view =
    pane === "Input"
      ? activeTab === "grid"
        ? inputGrid
        : inputList
      : activeOutputTab === "grid"
        ? outputGrid
        : outputList}
  {@const headings = pane === "Input" ? inputHeadings(page) : outputHeadings(output.pages[page].content, page)}
  {#if headings.length}
    {@render sectionJump(
      pane,
      headings.map((heading) => view?.paths(page, heading.keys) ?? []),
      `${key}-${pane}-page-${page}-jump`,
    )}
  {/if}
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
                void (
                  pane === "Input"
                    ? activeTab === "grid"
                      ? inputGrid
                      : inputList
                    : activeOutputTab === "grid"
                      ? outputGrid
                      : outputList
                )?.revealSection(node.id)
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
    ? { kind: "source", source: source!.id, choice: { kind: "pages", pages: Array.from({ length: section.end - section.start }, (_, index) => section.start + index) } }
    : { kind: "output", ids: output.pages.slice(section.start, section.end).map((page) => page.id) }}
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
)}
  {@const name = path.join(" › ")}
  {@const disclosureId = `${key}-${pane}-section-${id}-disclosure`}
  {@const dragging = transfer.control?.id === disclosureId}
  {@const indices = Array.from({ length: end - first }, (_, index) => first + index)}
  {@const selected = expanded
    ? pane === "Input"
      ? inputSelected.has(first)
      : selectedIds.has(output.pages[first].id)
    : selectedSection(pane, first, end)}
  {@const payload: Payload = pane === "Input" ? { kind: "source", source: source!.id, choice: { kind: "pages", pages: indices } } : { kind: "output", ids: indices.map((index) => output.pages[index].id) }}
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
  <div class="list-number">
    {#if pane === "Input"}{@render inputOrigin(first, `${key}-list-input-${first}`)}
    {:else}{@render outputOrigin(output.pages[first], first)}{/if}
  </div>
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
      else {
        output.position = first
        if (!expanded && !event.shiftKey) selectSection("Output", first, end)
        else selectOutput(output.pages[first].id, event.shiftKey)
      }
    }}
    ondblclick={(event) => {
      if (interaction.touchPointer || event.ctrlKey || event.metaKey) return
      if (pane === "Input") {
        restoreInput(first)
        inspectInput({ position: first })
      } else output.position = first
      void interaction.toggleView(pane, event)
    }}
    ><span class="list-current">{path.at(-1)}</span>
    {#if path.length > 1}<span class="list-parents" aria-hidden="true">
        {#each path.slice(0, -1).toReversed() as parent, depth (depth)}
          <span class="list-separator">‹</span><span class="list-ancestor">{parent}</span>
        {/each}
      </span>{/if}</button
  >
  <div class="list-actions">
    {#if pane === "Input"}
      {#if !draft.pages.length}{@render inputPageActions(first, end)}{/if}
      {@render inputPeek(first)}
    {:else}
      {@render occurrenceActions(output.pages[first], first, true, end)}
      {@render outputPeek(output.pages[first], first)}
    {/if}
  </div>
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
  onclick={dismissDocument}
  onkeydown={dismissDocument}
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
    if (inputMenu && !inputMenu.contains(event.target as Node)) inputMenu.open = false
    if (outputMenu && !outputMenu.contains(event.target as Node)) outputMenu.open = false
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
      if (menu) {
        outputMenu.open = false
        outputMenu.querySelector("summary")?.focus({ preventScroll: true })
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
  {@const zoom = pane === "Input" ? inputView.zoom : outputZoom}
  <button
    class={menu ? undefined : "tool"}
    aria-label="Zoom out"
    title="Zoom out"
    disabled={zoom <= zoomLevels[0]}
    onclick={() => zoomBy(pane, -1)}
    >{#if menu}<Icon name="remove" />Zoom out{:else}−{/if}</button
  >
  <button
    class={menu ? undefined : "tool"}
    aria-label="Zoom in"
    title="Zoom in"
    disabled={zoom >= zoomLevels.at(-1)!}
    onclick={() => zoomBy(pane, 1)}
    >{#if menu}<Icon name="add" />Zoom in{:else}+{/if}</button
  >
{/snippet}

{#snippet zoomReset(pane: "Input" | "Output", fitWidth: () => void, menu = false)}
  {@const zoom = pane === "Input" ? inputView.zoom : outputZoom}
  <button
    class={menu ? undefined : "tool page-fit"}
    aria-label={zoom === 100 ? "Fit width" : "Reset zoom"}
    title={zoom === 100 ? "Fit width" : "Reset zoom · 0 or Z"}
    onclick={() => (zoom === 100 ? fitWidth() : setZoom(pane, 100))}
  >
    {#if menu}<Icon name="fit" />{zoom === 100 ? "Fit width" : "Reset zoom"}
    {:else}
      {#if zoom !== 100}<span class="fit-level" aria-hidden="true">{zoom}%</span>{/if}
      <Icon name="fit" />
    {/if}
  </button>
{/snippet}

{#snippet pageTools(pane: "Input" | "Output", fitWidth: () => void)}
  {@const zoom = pane === "Input" ? inputView.zoom : outputZoom}
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

{#snippet inputPageHeading(fitWidth: () => void)}
  <span class="page-number"
    ><Counter
      pane="Input"
      label={source?.input.labels[inputPosition]}
      bind:this={inputCounter}
      bind:position={() => inputView.position, (position) => inspectInput({ position, alignment: undefined })}
      {count}
    />
    {#if inputName(inputPosition)}<p class="page-name">
        {inputName(inputPosition)}
      </p>{/if}
  </span>
  <button
    class="page-grip"
    aria-label={`Select or drag Input page ${inputView.position + 1} to Output`}
    aria-pressed={inputSelected.has(inputPosition)}
    title="Select or unselect this page."
    draggable="true"
    onmousedown={retainFocus}
    onclick={(event) => {
      toggle(inputPosition, event.shiftKey)
      interaction.focusPage(event.currentTarget)
    }}
    ondragstart={(event) => start(event, inputPayload(inputView.position))}
    onpointerdown={(event) => transfer.press(event, inputPayload(inputView.position))}
    ondragend={() => transfer.end()}><Icon name="reorder" /></button
  >
  {@render pageTools("Input", fitWidth)}
  {@render pageFace(inputView.position)}
{/snippet}

{#snippet inputPageActions(page: number = inputPosition, end = page + 1)}
  <button
    class="icon-button"
    aria-label={end > page + 1
      ? `Add Input section pages ${page + 1}–${end} to Output`
      : `Add Input page ${page + 1} to Output`}
    title={end > page + 1 ? "Add section to Output" : "Add one copy"}
    onclick={(event) => {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
      if (
        add(
          undefined,
          Array.from({ length: end - page }, (_, index) => page + index),
          "keep",
        )
      ) {
        inspectInput({ position: page })
        interaction.focusPage(event.currentTarget)
      }
    }}><Icon name="add" /></button
  >
{/snippet}

{#snippet inputOrigin(page: number, detail: string)}
  {#if source}<Origin
      id={detail}
      pane="Input"
      number={page + 1}
      identity={{ source, page, tocTitles: inputView.tocTitles, destinations: outputPositions.get(page) }}
      mode={activeTab === "list" ? "list" : "normal"}
      bind:opened={originOpen}
    >
      {#snippet navigation()}
        {#if inputView.grouped && inputHeadings(page).length}
          <div class="page-detail-navigation">{@render pageJump("Input", page)}</div>
        {/if}
      {/snippet}
    </Origin>{/if}
{/snippet}

{#snippet outputOrigin(page: Expanded, index: number)}
  {@const origin = provenance(page.content)}
  <Origin
    id={`${key}-output-menu-${page.id}`}
    pane="Output"
    number={transfer.number(index)}
    identity={origin && "page" in page.content
      ? { source: origin, page: page.content.page, tocTitles: inputViews[origin.id]?.tocTitles }
      : { blank: sizeOf(page.content, sources), padding: page.padding }}
    multiple={outputBooks.size > 1}
    mode={activeOutputTab === "list" ? "list" : "normal"}
    bind:opened={originOpen}
  >
    {#snippet navigation()}
      {#if outputGrouped && outputHeadings(page.content, index).length}
        <div class="page-detail-navigation">{@render pageJump("Output", index)}</div>
      {/if}
    {/snippet}
  </Origin>
{/snippet}

{#snippet inputPeek(page: number)}
  {#if source}
    {#key source.id}
      <Peek
        id={`${key}-peek-input-${page}`}
        pane="Input"
        number={page + 1}
        name={inputName(page)}
        size={source.input.sizes[page]}
        enabled={!transfer.value && !originOpen}
        owner={peeks}
        open={(event) => {
          inspectInput({ position: page })
          void interaction.toggleView("Input", event)
        }}
      >
        <Pdf pdf={source.input.pdf} {page} pageNumber={page + 1} thumbnail {error} />
      </Peek>
    {/key}
  {/if}
{/snippet}

{#snippet outputPeek(page: Expanded, index: number)}
  {@const origin = provenance(page.content)}
  <Peek
    id={`${key}-peek-output-${page.id}`}
    pane="Output"
    number={index + 1}
    name={pageName(page.content) ?? ("blank" in page.content ? (page.padding ? "Padding" : "Blank") : undefined)}
    size={sizeOf(page.content, sources)}
    enabled={!transfer.value && !originOpen}
    owner={peeks}
    open={(event) => {
      output.position = index
      void interaction.toggleView("Output", event)
    }}
  >
    {#if origin && "page" in page.content}
      <Pdf {...origin.preview.appearance(page.content.page)} pageNumber={page.content.page + 1} thumbnail {error} />
    {:else}<div class="composition-blank">
        <Icon name="blank" /><span>{page.padding ? "Padding" : "Blank"}</span>
      </div>{/if}
  </Peek>
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
          const name = event.currentTarget.value.trim()
          if (!name || /[/\\\u0000-\u001f\u007f-\u009f]/.test(name)) {
            error("Use a filename without slashes or control characters.")
            event.currentTarget.value = filename || suggestFilename()
            return
          }
          setFilename(/\.pdf$/i.test(name) ? name : `${name}.pdf`)
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

{#snippet outputGridHeading(
  page: Expanded,
  index: number,
  section: Section | undefined,
  folded: ReadonlySet<string>,
  fold: (key: string) => void,
)}
  {@render outputOrigin(page, index)}
  {#if section}
    {@render gridRibbon("Output", section, folded.has(section.key), fold)}
  {:else}<button
      class="page-grip"
      aria-label={`Select or drag Output page ${index + 1}`}
      aria-pressed={selectedIds.has(page.id)}
      title="Select or unselect this page."
      draggable="true"
      onmousedown={retainFocus}
      onclick={(event) => {
        if (event instanceof PointerEvent && event.pointerType === "touch") return
        selectOutput(page.id, event.shiftKey)
        interaction.focusPage(event.currentTarget)
      }}
      onpointerup={(event) => {
        if (event.pointerType !== "touch" || !event.isPrimary || transfer.touching) return
        transfer.suppressClick()
        selectOutput(page.id, event.shiftKey)
        interaction.focusPage(event.currentTarget)
      }}
      ondragstart={(event) => start(event, { kind: "output", ids: [page.id] })}
      onpointerdown={(event) => transfer.press(event, { kind: "output", ids: [page.id] })}
      ondragend={() => transfer.end()}
    >
      <Icon name="reorder" />
    </button>{/if}
  {@render pageFace(transfer.number(index) - 1)}
{/snippet}

{#snippet occurrenceActions(page: Expanded, index: number, controls: boolean, end = index + 1)}
  {@const ids = chosen.length || outputSelectionError ? [] : output.pages.slice(index, end).map((item) => item.id)}
  {@const group = end > index + 1}
  {#snippet move(offset: -1 | 1)}
    <button
      class="icon-button move"
      aria-label={`Move Output ${group ? `section pages ${index + 1}–${end}` : `page ${index + 1}`} ${offset < 0 ? "earlier" : "later"}`}
      title={`Move ${group ? "section" : "page"} ${offset < 0 ? "earlier" : "later"}`}
      disabled={!ids.length || (offset < 0 ? index === 0 : end === output.pages.length)}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        order(offset, ids)
      }}
      ><Icon
        name={activeOutputTab === "list" ? (offset < 0 ? "move-up" : "move-down") : offset < 0 ? "earlier" : "later"}
      /></button
    >
  {/snippet}
  {#snippet copies()}
    <button
      class="icon-button"
      aria-label={`Remove Output ${group ? `section pages ${index + 1}–${end}` : `page ${index + 1}`}`}
      title={group ? "Remove section" : "Remove this page"}
      disabled={!ids.length}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        remove(ids)
      }}><Icon name="remove" /></button
    ><button
      class="icon-button"
      aria-label={`Duplicate Output ${group ? `section pages ${index + 1}–${end}` : `page ${index + 1}`}`}
      title={group ? "Add one adjacent copy of section" : "Add one adjacent copy"}
      disabled={!ids.length}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        duplicate(ids, "keep")
      }}><Icon name="add" /></button
    >
  {/snippet}
  {#snippet pairs()}
    <div class="occurrence-moves" role="group" aria-label={`Move Output page ${index + 1}`}>
      {@render move(-1)}{@render move(1)}
    </div>
    <div class="occurrence-copies" role="group" aria-label={`Remove or duplicate Output page ${index + 1}`}>
      {@render copies()}
    </div>
  {/snippet}
  <div class="occurrence-actions">
    {#if controls && ids.length}
      {#if activeOutputTab === "grid"}<span class="card-inline-actions">{@render pairs()}</span>
      {:else}{@render pairs()}{/if}
    {/if}
  </div>
{/snippet}

{#snippet outputPageHeading(fitWidth: () => void)}
  <span class="page-number">
    <Counter
      label={inspected && "source" in inspected.content
        ? provenance(inspected.content)?.input.labels[inspected.content.page]
        : undefined}
      pane="Output"
      bind:this={outputCounter}
      bind:position={output.position}
      count={output.pages.length}
    />
    {#if inspected && pageName(inspected.content)}<p class="page-name">{pageName(inspected.content)}</p>{/if}
  </span>
  {@render pageTools("Output", fitWidth)}
  {@render pageFace(output.position)}
{/snippet}

{#snippet outputPageActions()}
  {#if inspected}
    {@render occurrenceActions(inspected, output.position, true)}
  {/if}
{/snippet}

{#snippet inputTools()}
  <details class="sequence-options input-options" bind:this={inputMenu}>
    <summary aria-label="Input page actions" title="Input page actions"><Icon name="more" /></summary>
    <div class="menu-options">
      {#if activeTab === "page" && !controlCapabilities[inputControls].zoom}
        {@render zoomControls("Input", true)}
        {#if !controlCapabilities[inputControls].fit}{@render zoomReset(
            "Input",
            () => inputPage?.fitWidth(),
            true,
          )}{/if}
      {/if}
      <Repetition
        pane="Input"
        bind:value={() => draft.repeat, (repeat) => set({ repeat })}
        bind:front={() => draft.front, (front) => set({ front })}
      />
    </div>
  </details>
{/snippet}

{#snippet outputMoves(inline = false)}
  {#if chosen.length || tour === "output-selection"}<button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages earlier"
      title={`Move selected pages earlier · Ctrl/⌘+${activeOutputTab === "list" ? "↑" : "←"}`}
      disabled={!chosen.length || !!outputSelectionError || positions[0] === 0}
      onclick={() => order(-1)}
      ><Icon name={activeOutputTab === "list" ? "move-up" : "earlier"} />{#if !inline}Earlier{/if}</button
    >
    <button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages later"
      title={`Move selected pages later · Ctrl/⌘+${activeOutputTab === "list" ? "↓" : "→"}`}
      disabled={!chosen.length || !!outputSelectionError || positions.at(-1) === output.pages.length - 1}
      onclick={() => order(1)}
      ><Icon name={activeOutputTab === "list" ? "move-down" : "later"} />{#if !inline}Later{/if}</button
    >{/if}
{/snippet}

{#snippet outputTools()}
  <details class="sequence-options output-options" bind:this={outputMenu}>
    <summary id={`${key}-output-actions`} aria-label="Output page actions" title="Output page actions"
      ><Icon name="more" /></summary
    >
    <div class="menu-options">
      <div class="selected-actions">
        {#if activeOutputTab === "page"}
          {#if !controlCapabilities[outputControls].comparison}{@render comparisonControls(true)}{/if}
          {#if !controlCapabilities[outputControls].zoom}
            {@render zoomControls("Output", true)}
            {#if !controlCapabilities[outputControls].fit}{@render zoomReset(
                "Output",
                () => outputPage?.fitWidth(),
                true,
              )}{/if}
          {/if}
        {/if}
        <div class="menu-moves">{@render outputMoves()}</div>
        {#if chosen.length}<button
            disabled={!!outputSelectionError}
            onclick={() => blank(positions[0])}
            title="Insert a blank before the first selected page">Before</button
          >{/if}
        <button
          disabled={!output.pages.length}
          onclick={() => blank(output.position + 1)}
          title="Insert a blank after the current Output page">After current page</button
        >
        <button
          disabled={!output.pages.length}
          onclick={() => blank(output.pages.length)}
          title="Insert a blank after the last Output page">After last page</button
        >
      </div>
      {#if chosen.length && adjacent}
        <Repetition pane="Output" bind:value={repetitions} bind:front />
        {#if Number(repetitions) !== 1 || front}<button
            disabled={!!repeatError || !!outputSelectionError}
            onclick={repeat}>Repeat</button
          >{/if}
      {:else if chosen.length}<p>Select consecutive pages to repeat a sequence.</p>{/if}
    </div>
  </details>
{/snippet}

<div
  class="composer"
  data-compact={compact || undefined}
  style:--page-heading-height={frameHeadingHeight ? `${frameHeadingHeight + 1}px` : undefined}
  data-view={activeView}
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
    {#if compact}
      {#if activeView === "input" && source}
        {@render input(`${key}-selection`, true)}
      {:else}
        <details class="document-menu" bind:this={documentMenu}>
          <summary aria-label="Output menu" title="Output menu"><Icon name="more" /></summary>
          <div class="document-actions">
            {@render outputName(true)}{@render viewAction(true)}{@render printAction(true)}{@render recipeAction(true)}
          </div>
        </details>
      {/if}
    {/if}
    <nav class="mobile-workspace-tabs" aria-label="Workspace view">
      <button
        id={`${key}-input-switch`}
        aria-label="Input"
        aria-describedby={`${key}-input-counts`}
        aria-pressed={activeView === "input" && !!source}
        disabled={!source}
        onclick={() => {
          cancelMotion()
          view = "input"
        }}
        ><span>Input</span><small id={`${key}-input-counts`} class="workspace-counts" {@attach summary}>
          <span class="composition-totals">{@render inputSummary()}</span>
          <span class="page-count">{count} {count === 1 ? "page" : "pages"}</span>
        </small></button
      >
      <button
        bind:this={outputTarget}
        id={`${key}-output-switch`}
        aria-label="Output"
        aria-describedby={`${key}-output-counts`}
        aria-pressed={activeView === "output"}
        data-drop={transfer.touching && transfer.value?.kind === "source" && activeView === "input" && transfer.inside
          ? true
          : undefined}
        onclick={() => {
          cancelMotion()
          view = "output"
        }}
        ><span>Output</span><small id={`${key}-output-counts`} class="workspace-counts" {@attach summary}>
          <span class="composition-totals">{@render outputSummary()}</span>
          <span class="page-count">{output.pages.length} {output.pages.length === 1 ? "page" : "pages"}</span>
        </small></button
      >
    </nav>
    {#if compact}
      {#if activeView === "input" && source}
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
    {#if source}<section
        class="selection-panel"
        data-warning={(transfer.warning &&
          transfer.touching &&
          transfer.value?.kind === "source" &&
          activeView === "input") ||
          undefined}
        aria-labelledby={`${key}-${compact ? "input-switch" : "selection"}`}
      >
        {#if !compact}
          <div class="section-heading input-heading" data-tour-target="input" data-tour-active={tour === "input"}>
            {@render input(`${key}-selection`)}
            <div class="input-preview-tools output-actions">
              <div class="input-state output-state" data-details={`${key}-input-summary`} {@attach summary}>
                <span class="composition-totals">{@render inputSummary()}</span>
                <button
                  class="icon-button"
                  popovertarget={`${key}-input-summary`}
                  aria-label="Input details"
                  title="Input details"><Icon name="info" /></button
                >
              </div>
              <button
                class="icon-button view-action"
                aria-label="View Input PDF"
                title="View Input PDF"
                onclick={viewInputPDF}><Icon name="eye" /></button
              >
            </div>
          </div>
          <div id={`${key}-input-summary`} class="output-details" popover="auto" role="note" aria-label="Input details">
            {@render inputSummary()}
          </div>
        {/if}

        <div class="editing-toolbar source-tabs" style:anchor-name="--input-pane">
          <div class="tabs" role="tablist" aria-label="Input workspace">
            {#each viewTabs as tab (tab)}<button
                id={`${key}-${tab}`}
                role="tab"
                aria-label={viewLabels[tab]}
                aria-keyshortcuts={`Alt+${viewTabs.indexOf(tab) + 1}`}
                aria-selected={activeTab === tab}
                aria-controls={`${key}-source-panel`}
                tabindex={activeTab === tab ? 0 : -1}
                onkeydown={(event) => interaction.tabKey(event)}
                onclick={() => inputTab(tab)}
                title={`${viewLabels[tab]} view`}
                data-tour-tab={`input-${tab}`}
                data-tour-active={tour === `input-${tab}`}><Icon name={tab} /><span>{viewLabels[tab]}</span></button
              >{/each}
            {#if hasStyles}<button
                id={`${key}-style`}
                role="tab"
                aria-label="Style"
                style:anchor-name="--style-tab"
                aria-selected={activeTab === "style"}
                aria-controls={`${key}-source-panel`}
                tabindex={activeTab === "style" ? 0 : -1}
                onkeydown={interaction.tabKey}
                onclick={() => inputTab("style")}
                disabled={!styleable}
                aria-describedby={!styleable ? `${key}-style-unavailable` : undefined}
                title={styleable
                  ? "Style"
                  : "Style unavailable. Add applicable pages from this Input to Output to use Style."}
                data-tour-tab="style"
                data-tour-active={tour === "style"}
                ><Icon name={styleable ? "style" : "style-off"} /><span>Style</span></button
              >{/if}
          </div>
          {#if hasStyles && (Object.keys(source.overrides).length || Object.keys(source.drafts).length)}<span
              class="edit-dot"
              aria-hidden="true"
            ></span>{/if}

          {#if inputSectionView && inputSectionView.sectionState() !== "none"}<button
              type="button"
              class="icon-button"
              aria-label={inputSectionView.sectionState() === "closed"
                ? "Unfold all Input sections"
                : "Fold all Input sections"}
              title={inputSectionView.sectionState() === "closed" ? "Unfold all sections" : "Fold all sections"}
              onclick={() => inputSectionView.toggleSections()}
              ><Icon name={inputSectionView.sectionState() === "closed" ? "expand" : "collapse"} /></button
            >{/if}
          {#if (activeTab === "list" || activeTab === "grid") && source.input.outline?.length}<button
              type="button"
              class="icon-button"
              aria-label="Section headings"
              aria-pressed={inputView.grouped}
              title={inputView.grouped ? "Hide section headings" : "Show section headings"}
              onclick={() => {
                inspectInput({ grouped: !inputView.grouped })
                void interaction.reveal("Input")
              }}><Icon name="sections" /></button
            >{/if}
          {#if activeTab === "style" && styling}{@render styling(true)}{/if}
          {#if source.input.outline?.length}<Contents
              outline={source.input.outline}
              source={source.id}
              position={inputPosition}
              {titleChoice}
              bind:tocTitles={() => inputView.tocTitles, (tocTitles) => inspectInput({ tocTitles })}
              navigate={async (position) => {
                inspectInput({ position, offset: position })
                if (activeTab === "list") await inputList?.revealPage(position)
                void interaction.reveal("Input", undefined, true)
              }}
            />{/if}
          {#if activeTab !== "style"}<Jump
              pane="Input"
              labels={source.input.labels}
              {count}
              position={inputPosition}
              navigate={(position, event) => void goTo("Input", position, event)}
            />{/if}
        </div>

        <div
          class="input-panel"
          id={`${key}-source-panel`}
          role="tabpanel"
          data-tour-target={activeTab === "style" ? "style" : `input-${activeTab}`}
          data-tour-active={tour === "style" || tour?.startsWith("input-")}
          aria-labelledby={`${key}-${activeTab}`}
        >
          {#if activeTab === "style" && styling}
            <div class="page-content">
              {@render styling()}
            </div>
          {:else}
            <Selection
              id={`${key}-input-selection`}
              pane="Input"
              value={draft.text}
              invalid={!!parsed.error}
              error={selectionError}
              change={numbers}
              submit={() => add()}
              menu={inputTools}
            >
              {#snippet actions()}
                {#if !allInput}<button
                    class="step"
                    aria-label="Select all"
                    title="Select all · Ctrl+A / ⌘A"
                    aria-keyshortcuts="Control+A Meta+A"
                    onclick={(event) => {
                      selectAll("Input")
                      interaction.focusAfterSelection("Input", event)
                    }}><Icon name="select" /></button
                  >{/if}
                {#if draft.text || draft.pages.length || draft.repeat !== "1" || draft.front}<button
                    class="reset"
                    aria-label="Clear page sequence"
                    title="Clear"
                    onclick={(event) => {
                      clearInput()
                      interaction.focusAfterSelection("Input", event)
                    }}><Icon name="close" /></button
                  >{/if}
                {#if draft.pages.length}<button
                    class="step transfer primary"
                    aria-label="Add to Output"
                    title={`Add to Output${insertion === undefined ? " at the end" : ` after page ${insertion}`}.`}
                    draggable="true"
                    disabled={!!selectionError}
                    ondragstart={(event) => start(event, inputPayload())}
                    onpointerdown={(event) => transfer.press(event, inputPayload())}
                    ondragend={() => transfer.end()}
                    onclick={() => add()}><Icon name="add" /></button
                  >{/if}
              {/snippet}
              {#snippet hint()}
                {#if draft.pages.length}<strong
                    >{draft.pages.length} {draft.pages.length === 1 ? "page" : "pages"} selected</strong
                  > ·
                {/if}
                {draft.pages.length
                  ? insertion === undefined
                    ? "Append to Output."
                    : `Add after Output ${insertion}.`
                  : "Select pages or type numbers."}
                {#if draft.repeat !== "1" || draft.front}
                  Repeat ×{draft.repeat}{draft.front ? " · Front aligned" : ""}.{/if}
                {#if hasStyles && !styleable}<span id={`${key}-style-unavailable`}
                    >Style needs applicable Output pages.</span
                  >{/if}
              {/snippet}
            </Selection>
            <div class="page-content">
              {#if transfer.warning && transfer.touching && transfer.value?.kind === "source" && activeView === "input"}
                <Feedback header kind="notice" text="Move to Output." />
              {/if}
              {#if activeTab === "page"}
                {#key source.id}<PageView
                    pane="Input"
                    bind:this={inputPage}
                    {count}
                    sheet={inputInspection}
                    name={inputName(inputPosition)}
                    bind:headingHeight={inputHeadingHeight}
                    bind:controls={inputControls}
                    initialize={!opening && !inputView.pageInitialized ? (zoom) => setZoom("Input", zoom) : undefined}
                    bind:position={
                      () => inputView.position, (position) => inspectInput({ position, alignment: undefined })
                    }
                    bind:zoom={() => inputView.zoom, (zoom) => setZoom("Input", zoom)}
                    bind:region={() => inputView.region, (region) => inspectInput({ region, alignment: undefined })}
                    alignment={inputView.alignment}
                    heading={inputPageHeading}
                    actions={!draft.pages.length ? inputPageActions : undefined}
                    grid={(event) => void interaction.toggleView("Input", event)}
                    selected={inputSelected.has(inputPosition)}
                    {error}
                    {magnification}
                  />{/key}
              {:else if activeTab === "list"}
                {#key source.id}
                  <List
                    viewport={listViewport(source.id)}
                    bind:this={inputList}
                    bind:folds={() => inputView.folds, (folds) => inspectInput({ folds })}
                    pane="Input"
                    active={() => interaction.shortcutPane() === "Input"}
                    labeled={source.input.labels.length > 0}
                    revision={`${inputView.grouped}:${inputView.tocTitles}`}
                    headings={inputView.grouped ? inputHeadings : undefined}
                    selected={(first, end) => selectedSection("Input", first, end)}
                    {count}
                    bind:position={() => inputPosition, (position) => inspectInput({ position })}
                    select={(page, range, anchor, sectionEnd) =>
                      sectionEnd === undefined ? toggle(page, range, anchor) : selectSection("Input", page, sectionEnd)}
                    edit={(action, page, end) =>
                      action === "add" &&
                      !!add(
                        undefined,
                        end === undefined
                          ? inputTargets(page)
                          : Array.from({ length: end - page }, (_, offset) => page + offset),
                      )}
                  >
                    {#snippet section(start, end, path, expanded, toggle, id)}
                      {@render sectionRow("Input", start, end, path, expanded, toggle, id)}
                    {/snippet}
                    {#snippet children(page, retained)}
                      <li
                        class="list-row"
                        data-retained={page === retained || undefined}
                        aria-setsize={count}
                        aria-posinset={page + 1}
                        data-returning={(interaction.returning?.kind === "source" &&
                          interaction.returning.source === source.id &&
                          interaction.returning.page === page) ||
                          undefined}
                        class:selected={inputSelected.has(page)}
                        data-dragging={(transfer.value?.kind === "source" &&
                          transfer.value.source === source.id &&
                          (transfer.value.choice.kind === "page"
                            ? transfer.value.choice.page === page
                            : transfer.value.choice.kind === "pages"
                              ? transfer.value.choice.pages.includes(page)
                              : inputSelected.has(page))) ||
                          undefined}
                      >
                        <Row
                          pane="Input"
                          number={page + 1}
                          index={page}
                          name={inputName(page)}
                          label={inputName(page) ?? `Page ${page + 1}`}
                          pdfLabel={source.input.labels[page]}
                          selected={inputSelected.has(page)}
                          touch={interaction.touchPointer}
                          {transfer}
                          payload={inputPayload(page)}
                          {start}
                          inspect={() => inspectInput({ position: page })}
                          toggle={(range) => toggle(page, range)}
                          select={(event) => {
                            if (!source) return
                            const id = source.id
                            const previous = draft
                            const anchor = sourceAnchor
                            selectInput(page, event)
                            return () => {
                              if (source?.id !== id) return
                              choose(id, previous)
                              sourceAnchor = anchor
                              highlightRange()
                            }
                          }}
                          open={(event) => void interaction.toggleView("Input", event)}
                        >
                          {#snippet origin()}{@render inputOrigin(page, `${key}-list-input-${page}`)}{/snippet}
                          {#snippet actions()}{@render inputPageActions(page)}{/snippet}
                          {#snippet preview()}{@render inputPeek(page)}{/snippet}
                        </Row>
                      </li>
                    {/snippet}
                  </List>{/key}
              {:else}
                <Grid
                  bind:this={inputGrid}
                  viewport={gridViewport(source.id)}
                  pane="Input"
                  active={() => interaction.shortcutPane() === "Input"}
                  {count}
                  headings={inputView.grouped && !transfer.value ? inputHeadings : undefined}
                  bind:folds={() => inputView.folds, (folds) => inspectInput({ folds })}
                  bind:position={() => inputView.position, (position) => inspectInput({ position })}
                  bind:offset={() => inputView.offset, (offset) => inspectInput({ offset })}
                  bind:keyboard={interaction.usingKeyboard}
                  selected={(position) => inputSelected.has(position)}
                  toggle={(page) => toggle(page, false)}
                  edit={(action, page, end) =>
                    action === "add" &&
                    !!add(
                      undefined,
                      page === undefined || draft.pages.length
                        ? undefined
                        : Array.from({ length: (end ?? page + 1) - page }, (_, offset) => page + offset),
                    )}
                >
                  {#snippet children(pages, headings, fold, folded)}
                    {#each pages as page, index (page)}
                      {@const section = headings.get(page)}
                      {@const first = index === 0}
                      {@const destinations = outputPositions.get(page) ?? []}
                      {@const detail = `${key}-input-${source.id}-${page}`}
                      <li
                        class={[
                          "composition-card",
                          {
                            selected:
                              section && folded.has(section.key)
                                ? selectedSection("Input", section.start, section.end)
                                : inputSelected.has(page),
                            "grid-section-card": !!section,
                            "grid-section-open": !!section && !folded.has(section.key),
                          },
                        ]}
                        data-returning={(interaction.returning?.kind === "source" &&
                          interaction.returning.source === source.id &&
                          interaction.returning.page === page) ||
                          undefined}
                        class:range-highlight={highlight?.kind === "source" &&
                          highlight.source === source.id &&
                          page >= highlight.first &&
                          page <= highlight.last}
                        data-tour-target={first ? "first-page" : undefined}
                        data-face={page % 2 === 0 ? "front" : "back"}
                        data-dragging={transfer.value?.kind === "source" &&
                        (transfer.value.choice.kind === "page"
                          ? transfer.value.choice.page === page
                          : inputSelected.has(page))
                          ? true
                          : undefined}
                      >
                        <div class="page-label">
                          {@render inputOrigin(page, detail)}
                          {#if section}
                            {@render gridRibbon("Input", section, folded.has(section.key), fold)}
                          {:else}<button
                              class="page-grip"
                              aria-label={`Select or drag Input page ${page + 1} to Output`}
                              aria-pressed={inputSelected.has(page)}
                              title="Select or unselect this page."
                              draggable="true"
                              onmousedown={retainFocus}
                              onclick={(event) => {
                                if (event instanceof PointerEvent && event.pointerType === "touch") return
                                toggle(page, event.shiftKey)
                                inspectInput({ position: page })
                                interaction.focusPage(event.currentTarget)
                              }}
                              onpointerup={(event) => {
                                if (event.pointerType !== "touch" || !event.isPrimary || transfer.touching) return
                                transfer.suppressClick()
                                toggle(page, event.shiftKey)
                                inspectInput({ position: page })
                                interaction.focusPage(event.currentTarget)
                              }}
                              ondragstart={(event) => start(event, inputPayload(page))}
                              onpointerdown={(event) => transfer.press(event, inputPayload(page))}
                              ondragend={() => transfer.end()}><Icon name="reorder" /></button
                            >{/if}
                          <button
                            class="icon-button grid-inspect"
                            type="button"
                            aria-label={`View Input page ${page + 1}`}
                            title="View page"
                            onclick={(event) => {
                              inspectInput({ position: page })
                              void interaction.toggleView("Input", event)
                            }}><Icon name="eye" /></button
                          >
                        </div>
                        <button
                          class="page-image"
                          data-page={page}
                          aria-label={section && folded.has(section.key)
                            ? `Select Input section ${section.path.join(" › ")}: pages ${section.start + 1}–${section.end}`
                            : `Select Input page ${page + 1}`}
                          aria-pressed={section && folded.has(section.key)
                            ? selectedSection("Input", section.start, section.end)
                            : inputSelected.has(page)}
                          aria-describedby={destinations.length ? detail : undefined}
                          title={section && folded.has(section.key)
                            ? "Select or unselect the entire folded section."
                            : "Select pages for Output."}
                          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Delete"
                          draggable="true"
                          onmousedown={retainFocus}
                          onclick={(event) =>
                            selectInput(page, event, section && folded.has(section.key) ? section.end : undefined)}
                          ondblclick={(event) => {
                            if (
                              interaction.touchPointer ||
                              event.ctrlKey ||
                              event.metaKey ||
                              !source ||
                              inputClick?.source !== source.id ||
                              inputClick.page !== page
                            )
                              return
                            restoreInput(page)
                            add(undefined, inputTargets(page))
                          }}
                          ondragstart={(event) => start(event, inputPayload(page))}
                          ondragend={() => transfer.end()}
                        >
                          <Pdf
                            pdf={source.input.pdf}
                            {page}
                            pageNumber={page + 1}
                            name={inputName(page)}
                            preview={source.input.description.pages[page]?.preview}
                            thumbnail
                            {magnification}
                            {error}
                          />
                        </button>
                        <div class="input-footer">
                          {#if source.input.labels[page] && source.input.labels[page] !== String(page + 1)}<span
                              class="grid-pdf-label"
                              title={`Page Label: ${source.input.labels[page]}`}>{source.input.labels[page]}</span
                            >{/if}
                          {#if !draft.pages.length}{@render inputPageActions(page, section?.end)}{/if}
                        </div>
                        {@render pageFace(page)}
                      </li>
                    {/each}
                  {/snippet}
                </Grid>
              {/if}
            </div>
          {/if}
        </div>
      </section>{/if}

    <section
      class="composition-output"
      data-preview={transfer.preview || (activeOutputTab === "list" && transfer.destination !== undefined)
        ? true
        : undefined}
      aria-labelledby={`${key}-${compact ? "output-switch" : "output"}`}
      data-drop={transfer.value && transfer.target.kind === "append" ? "end" : undefined}
      ondragover={(event) => transfer.over(event)}
      ondragleave={transfer.leaveOutput}
      ondrop={(event) => transfer.drop(event)}
    >
      {#if !compact}<div class="section-heading">
          <div>
            <h2 id={`${key}-output`} aria-label="Output">
              {@render outputName()}
            </h2>
          </div>
          <div class="output-state" data-details={`${key}-output-summary`} {@attach summary}>
            <span class="composition-totals">{@render outputSummary()}</span>
            <button
              class="icon-button"
              popovertarget={`${key}-output-summary`}
              aria-label="Output details"
              title="Output details"><Icon name="info" /></button
            >
          </div>
          <div class="output-actions" data-tour-target="download" data-tour-active={tour === "download"}>
            {@render recipeAction()}{@render printAction()}{@render viewAction()}{@render saveOutput()}
          </div>
          {#if downloadError}<span hidden id={`${key}-download-error`}>{downloadError}</span>{/if}
        </div>
        <div id={`${key}-output-summary`} class="output-details" popover="auto" role="note" aria-label="Output details">
          {@render outputSummary()}
        </div>{/if}
      <div class="editing-toolbar output-tabs">
        <div class="tabs" role="tablist" aria-label="Output workspace">
          {#each viewTabs as tab (tab)}<button
              id={`${key}-output-${tab}`}
              role="tab"
              aria-label={viewLabels[tab]}
              aria-keyshortcuts={`Alt+${viewTabs.indexOf(tab) + 1}`}
              aria-selected={activeOutputTab === tab}
              aria-controls={`${key}-output-panel`}
              tabindex={activeOutputTab === tab ? 0 : -1}
              onkeydown={(event) => interaction.tabKey(event, "Output")}
              onclick={() => setOutputTab(tab)}
              title={`${viewLabels[tab]} view`}
              data-tour-tab={`output-${tab}`}
              data-tour-active={tour === `output-${tab}` || (tab === "grid" && tour === "output-selection")}
              ><Icon name={tab} /><span>{viewLabels[tab]}</span></button
            >{/each}
        </div>
        {#if outputSectionView && outputSectionView.sectionState() !== "none"}<button
            type="button"
            class="icon-button"
            aria-label={outputSectionView.sectionState() === "closed"
              ? "Unfold all Output sections"
              : "Fold all Output sections"}
            title={outputSectionView.sectionState() === "closed" ? "Unfold all sections" : "Fold all sections"}
            onclick={() => outputSectionView.toggleSections()}
            ><Icon name={outputSectionView.sectionState() === "closed" ? "expand" : "collapse"} /></button
          >{/if}
        {#if (activeOutputTab === "list" || activeOutputTab === "grid") && output.pages.some((page, index) => outputHeadings(page.content, index).length)}<button
            type="button"
            class="icon-button"
            aria-label="Section headings"
            aria-pressed={outputGrouped}
            title={outputGrouped ? "Hide section headings" : "Show section headings"}
            onclick={() => {
              outputGrouped = !outputGrouped
              void interaction.reveal("Output")
            }}><Icon name="sections" /></button
          >{/if}
        <Jump
          pane="Output"
          count={output.pages.length}
          labels={output.pages.map((page) =>
            "source" in page.content ? (provenance(page.content)?.input.labels[page.content.page] ?? "") : "",
          )}
          position={output.position}
          navigate={(position, event) => void goTo("Output", position, event)}
        />
      </div>

      <div
        class="output-panel"
        data-tour-target={`output-${activeOutputTab}`}
        data-tour-active={tour?.startsWith("output-")}
        id={`${key}-output-panel`}
        role="tabpanel"
        aria-labelledby={`${key}-output-${activeOutputTab}`}
      >
        <Selection
          id={`${key}-output-selection`}
          pane="Output"
          value={outputText ?? pageRanges(positions)}
          invalid={!!outputSelectionError}
          error={outputSelectionError}
          disabled={!output.pages.length}
          change={outputNumbers}
          submit={() => remove()}
          hiddenHint={!!transfer.value}
          highlight={highlight?.kind === "output" ? (highlight.removing ? "remove" : "range") : undefined}
          tour={tour === "output-selection"}
        >
          {#snippet menu()}
            {#if output.pages.length || tour === "output-selection"}{@render outputTools()}{/if}
          {/snippet}
          {#snippet actions()}
            {#if output.pages.length && (positions.length < output.pages.length || outputSelectionError)}<button
                class="step"
                aria-label="Select all"
                title="Select all · Ctrl+A / ⌘A"
                aria-keyshortcuts="Control+A Meta+A"
                onclick={(event) => {
                  selectAll("Output")
                  interaction.focusAfterSelection("Output", event)
                }}><Icon name="select" /></button
              >{/if}
            {#if chosen.length || outputText}<button
                class="reset"
                aria-label="Clear Output selection"
                title="Clear selection to use page actions"
                onclick={(event) => {
                  clearOutput()
                  interaction.focusAfterSelection("Output", event)
                }}><Icon name="close" /></button
              >{/if}
            {#if chosen.length || tour === "output-selection"}
              <div class="output-selection" role="group" aria-label="Selected Output pages">
                <div class="inline-moves">{@render outputMoves(true)}</div>
                <button
                  class="step danger"
                  aria-label="Remove selected Output pages"
                  title="Remove selected pages · Delete"
                  disabled={!chosen.length || !!outputSelectionError}
                  onclick={() => remove()}><Icon name="remove" /></button
                ><button
                  class="step primary"
                  aria-label="Duplicate selected Output pages"
                  title="Add one copy of the selected pages."
                  disabled={!chosen.length || !!outputSelectionError}
                  onclick={() => duplicate()}><Icon name="add" /></button
                >
              </div>
            {/if}
          {/snippet}
          {#snippet hint()}
            {#if chosen.length}<strong>{chosen.length} {chosen.length === 1 ? "page" : "pages"} selected</strong> · Use the
              selection bar.{:else if activeOutputTab === "page"}Select in Grid or type numbers.{:else}Select pages or
              type numbers.{/if}
          {/snippet}
          {#snippet feedback()}
            {#if transfer.value}<span class="drag-status"
                ><strong
                  >{transfer.value.kind === "output"
                    ? transfer.value.ids.length === 1
                      ? "Move this page"
                      : `Move ${transfer.value.ids.length} pages`
                    : transfer.value.choice.kind === "preparation"
                      ? "Add sequence"
                      : transfer.value.choice.kind === "pages"
                        ? `Add ${transfer.value.choice.pages.length} pages`
                        : `Add Input page ${transfer.value.choice.page + 1}`}</strong
                >
                <span class="drop-description">
                  · {transfer.blocked
                    ? "Drop outside the selection."
                    : transfer.inside
                      ? `Release · ${transfer.label}`
                      : "Drag into Output"}</span
                >
              </span>{/if}
          {/snippet}
        </Selection>
        <div class="page-content">
          {#if activeOutputTab === "page"}
            <div
              class="inspection-target"
              data-adding={(inspected && pendingAddition.has(inspected.id)) || undefined}
              data-removing={removingPage || undefined}
              role="group"
              aria-label="Output page drop target"
              data-drop={!transfer.blocked && transfer.targetIndex === output.position
                ? transfer.targetAfter
                  ? "after"
                  : "before"
                : undefined}
              ondragover={(event) => transfer.over(event, output.position)}
              ondrop={transfer.drop}
            >
              <PageView
                bind:this={outputPage}
                count={output.pages.length}
                sheet={inspection}
                name={inspected ? pageName(inspected.content) : undefined}
                bind:headingHeight={outputHeadingHeight}
                bind:controls={outputControls}
                initialize={!opening && !outputPageInitialized ? (zoom) => setZoom("Output", zoom) : undefined}
                bind:position={output.position}
                bind:zoom={() => outputZoom, (zoom) => setZoom("Output", zoom)}
                bind:comparing
                bind:region={outputRegion}
                heading={inspected ? outputPageHeading : undefined}
                actions={inspected && !chosen.length ? outputPageActions : undefined}
                copyable={!outputSelectionError}
                grid={(event) => void interaction.toggleView("Output", event)}
                selected={!!inspected && selectedIds.has(inspected.id)}
                navigationOver={transfer.navigate}
                navigationLeave={transfer.leave}
                {error}
                {magnification}
              />
              {#if !transfer.blocked && transfer.targetIndex === output.position}
                <div class="page-drop-ghost" aria-hidden="true">
                  <canvas width="0" height="0" {@attach transfer.ghost}></canvas>
                </div>
              {/if}
            </div>
          {:else if activeOutputTab === "list" && output.pages.length}
            <List
              viewport={outputListViewport}
              bind:this={outputList}
              bind:folds={outputFolds}
              pane="Output"
              active={() => interaction.shortcutPane() === "Output"}
              count={output.pages.length}
              revision={outputListRevision}
              headings={outputGrouped ? (index) => outputHeadings(output.pages[index].content, index) : undefined}
              selected={(first, end) => selectedSection("Output", first, end)}
              identity={(index) => output.pages[index].id}
              skipped={skippedRows}
              retained={retainedRow}
              bind:position={output.position}
              select={(index, range, anchor, sectionEnd) =>
                sectionEnd === undefined
                  ? selectOutput(
                      output.pages[index].id,
                      range,
                      anchor === undefined ? undefined : output.pages[anchor].id,
                    )
                  : selectSection("Output", index, sectionEnd)}
              edit={(action, index, end) => {
                const ids = outputSelectionError
                  ? []
                  : chosen.length
                    ? outputTargets()
                    : output.pages.slice(index, end ?? index + 1).map((page) => page.id)
                return !!(action === "remove" ? remove(ids) : duplicate(ids))
              }}
            >
              {#snippet section(start, end, path, expanded, toggle, id)}
                {@render sectionRow("Output", start, end, path, expanded, toggle, id)}
              {/snippet}
              {#snippet children(index, retained)}
                {@const page = output.pages[index]}
                {@const dropHere =
                  !transfer.blocked &&
                  transfer.inside &&
                  (transfer.targetIndex === index ||
                    (transfer.target.kind === "append" && index === output.pages.length - 1))}
                {@const dropAfter = transfer.targetAfter || transfer.target.kind === "append"}
                <li
                  id={`${key}-${page.id}`}
                  class="list-row"
                  aria-setsize={output.pages.length}
                  aria-posinset={index + 1}
                  data-retained={index === retained || undefined}
                  data-returning={(interaction.returning?.kind === "output" && interaction.returning.id === page.id) ||
                    undefined}
                  class:range-highlight={highlight?.kind === "output" && highlight.ids.has(page.id)}
                  data-index={index}
                  class:selected={selectedIds.has(page.id)}
                  data-dragging={transfer.moving(page.id) || undefined}
                  data-drop={dropHere ? (dropAfter ? "after" : "before") : undefined}
                  data-arriving={arriving.has(page.id) || undefined}
                  style:--drop-height={`${transfer.stripHeight}px`}
                  onanimationend={(event) => {
                    if (event.target === event.currentTarget && event.animationName === "row-enter")
                      arriving.delete(page.id)
                  }}
                  out:removal|global
                  ondragover={(event) => transfer.over(event, index)}
                  ondrop={(event) => transfer.drop(event)}
                >
                  {#if dropHere}
                    {@render dropPreview(dropAfter)}
                  {/if}
                  <Row
                    pane="Output"
                    number={index + 1}
                    {index}
                    name={pageName(page.content)}
                    label={pageName(page.content) ??
                      ("blank" in page.content
                        ? page.padding
                          ? "Padding"
                          : "Blank"
                        : `Page ${page.content.page + 1}`)}
                    selected={selectedIds.has(page.id)}
                    touch={interaction.touchPointer}
                    {transfer}
                    payload={{ kind: "output", ids: [page.id] }}
                    {start}
                    inspect={() => (output.position = index)}
                    toggle={(range) => selectOutput(page.id, range)}
                    select={(event) => {
                      output.position = index
                      if (touchPage("Output", event)) return
                      if (event.ctrlKey || event.metaKey) {
                        void interaction.toggleView("Output", event)
                        return
                      }
                      const selected = output.selection
                      const anchor = output.anchor
                      const text = outputText
                      selectOutput(page.id, event.shiftKey)
                      return () => {
                        output.select([...selected], anchor)
                        outputText = text
                        highlightRange()
                      }
                    }}
                    open={(event) => void interaction.toggleView("Output", event)}
                  >
                    {#snippet origin()}{@render outputOrigin(page, index)}{/snippet}
                    {#snippet actions()}{@render occurrenceActions(page, index, true)}{/snippet}
                    {#snippet preview()}{@render outputPeek(page, index)}{/snippet}
                  </Row>
                </li>
              {/snippet}
            </List>
          {:else}
            {#if output.pages.length}
              <Grid
                bind:this={outputGrid}
                viewport={outputGridViewport}
                pane="Output"
                active={() => interaction.shortcutPane() === "Output"}
                count={output.pages.length}
                headings={outputGrouped && !transfer.value
                  ? (index) => outputHeadings(output.pages[index].content, index)
                  : undefined}
                identity={(index) => output.pages[index].id}
                bind:folds={outputFolds}
                bind:position={output.position}
                bind:offset={outputOffset}
                bind:keyboard={interaction.usingKeyboard}
                selected={(position) => selectedIds.has(output.pages[position]?.id)}
                toggle={(position) => selectOutput(output.pages[position].id, false)}
                edit={(action, index, end) => {
                  const ids =
                    index === undefined || chosen.length || outputSelectionError
                      ? outputTargets()
                      : output.pages.slice(index, end ?? index + 1).map((page) => page.id)
                  return !!(action === "remove" ? remove(ids) : duplicate(ids))
                }}
              >
                {#snippet children(pages, headings, fold, folded)}
                  {#each pages as index, offset (output.pages[index].id)}
                    {@const page = output.pages[index]}
                    {@const section = headings.get(index)}
                    {@const origin = provenance(page.content)}
                    {@const place = transfer.preview?.positions.get(index)}
                    <li
                      id={`${key}-${page.id}`}
                      data-adding={pendingAddition.has(page.id) || undefined}
                      inert={pendingAddition.has(page.id)}
                      class={[
                        "composition-card",
                        {
                          selected:
                            section && folded.has(section.key)
                              ? selectedSection("Output", section.start, section.end)
                              : selectedIds.has(page.id),
                          "grid-section-card": !!section,
                          "grid-section-open": !!section && !folded.has(section.key),
                        },
                      ]}
                      data-returning={(interaction.returning?.kind === "output" &&
                        interaction.returning.id === page.id) ||
                        undefined}
                      class:range-highlight={highlight?.kind === "output" && highlight.ids.has(page.id)}
                      out:removal|global
                      onoutroend={(event) => {
                        const grid = event.currentTarget.parentElement
                        // The row's reactive scope is already destroyed when its outro finishes.
                        const id = event.currentTarget.id.slice(key.length + 1)
                        if (grid && removing.has(id) && !feedback.move) feedback.move = animateOrder(grid, 350)
                      }}
                      data-face={transfer.number(index) % 2 === 1 ? "front" : "back"}
                      data-dragging={transfer.moving(page.id) || undefined}
                      data-preview-hidden={transfer.preview && (place === undefined || place >= transfer.grid!.limit)
                        ? true
                        : undefined}
                      style:translate={place === undefined ? undefined : transfer.displacement(place, offset)}
                      data-drop={!transfer.blocked && transfer.targetIndex === index
                        ? transfer.targetAfter
                          ? "after"
                          : "before"
                        : undefined}
                      ondragover={(event) => transfer.over(event, index)}
                      ondrop={(event) => transfer.drop(event)}
                    >
                      <div class="page-label">
                        {@render outputGridHeading(page, index, section, folded, fold)}
                        <button
                          class="icon-button grid-inspect"
                          type="button"
                          aria-label={`View Output page ${index + 1}`}
                          title="View page"
                          onclick={(event) => {
                            output.position = index
                            void interaction.toggleView("Output", event)
                          }}><Icon name="eye" /></button
                        >
                      </div>
                      <button
                        class="page-image"
                        data-page={index}
                        aria-label={section && folded.has(section.key)
                          ? `Select Output section ${section.path.join(" › ")}: pages ${section.start + 1}–${section.end}`
                          : `Select Output page ${index + 1}`}
                        aria-pressed={section && folded.has(section.key)
                          ? selectedSection("Output", section.start, section.end)
                          : selectedIds.has(page.id)}
                        title={section && folded.has(section.key)
                          ? "Select or unselect the entire folded section."
                          : "Select pages to edit Output."}
                        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Plus - Delete"
                        draggable="true"
                        onmousedown={retainFocus}
                        onclick={(event) => {
                          output.position = index
                          if (touchPage("Output", event)) return
                          if (event.ctrlKey || event.metaKey) {
                            void interaction.toggleView("Output", event)
                            return
                          }
                          if (event.detail <= 1) {
                            if (section && folded.has(section.key) && !event.shiftKey)
                              selectSection("Output", section.start, section.end)
                            else selectOutput(page.id, event.shiftKey)
                          }
                          if (event.detail) event.currentTarget.focus({ preventScroll: true })
                        }}
                        ondragstart={(event) => start(event, { kind: "output", ids: [page.id] })}
                        ondragend={() => transfer.end()}
                      >
                        {#if origin && "page" in page.content}<Pdf
                            {...origin.preview.appearance(page.content.page)}
                            pageNumber={page.content.page + 1}
                            name={pageName(page.content)}
                            thumbnail
                            {magnification}
                            {error}
                          />{:else}<div class="thumbnail">
                            <div
                              class="composition-blank"
                              style:--ratio={sizeOf(page.content, sources).width / sizeOf(page.content, sources).height}
                            >
                              <Icon name="blank" /><span>{page.padding ? "Padding" : "Blank"}</span>
                            </div>
                          </div>{/if}
                      </button>

                      {@render occurrenceActions(page, index, !chosen.length, section?.end)}
                    </li>
                  {/each}
                  {#if transfer.preview && transfer.grid && transfer.preview.slot < transfer.grid.limit}
                    <li
                      class="drop-placeholder"
                      aria-hidden="true"
                      style:inline-size={`${transfer.grid.width}px`}
                      style:block-size={`${transfer.grid.height}px`}
                      style:translate={transfer.displacement(transfer.preview.slot)}
                    >
                      <strong class="drop-number">{transfer.destination! + 1}</strong>
                      <canvas width="0" height="0" {@attach transfer.ghost}></canvas>
                    </li>
                  {/if}
                {/snippet}
              </Grid>
            {:else}<div class="composition-empty">
                {#if transfer.value && transfer.inside}<div class="drop-placeholder" aria-hidden="true">
                    <canvas width="0" height="0" {@attach transfer.ghost}></canvas>
                  </div>
                {:else}<Icon name="output" />
                  <h3>Your Output starts here.</h3>
                  <p>Add pages from Input.</p>{/if}
              </div>{/if}
          {/if}
        </div>
      </div>
    </section>
  </div>
</div>
