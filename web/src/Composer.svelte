<!-- Coordinates pane views, page selections, Output edits, and transfers. -->

<script lang="ts">
  import { onDestroy, tick } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import { scale } from "svelte/transition"
  import { quadIn } from "svelte/easing"
  import type { Snippet } from "svelte"
  import { copyError, parseCopies, sizeOf, uid } from "./model.ts"
  import type { Content, Expanded, Page, Part, Source } from "./model.ts"
  import * as composition from "./composition.ts"
  import type { Edit, Output } from "./output.svelte.ts"
  import { pageRanges, parseSequence, toggleSequence } from "./pages.ts"
  import { shortcut, shortcutContext } from "./keyboard.ts"
  import type { Sequence } from "./pages.ts"
  import Pdf from "./Pdf.svelte"
  import { retainFocus } from "./drag.ts"
  import { Transfer } from "./transfer.svelte.ts"
  import type { Payload } from "./transfer.svelte.ts"
  import { animateAddition, animateMove, animateOrder, animateRemoval, removalDuration } from "./motion.ts"
  import Repetition from "./Repetition.svelte"
  import Selection from "./Selection.svelte"
  import Origin from "./Origin.svelte"
  import Grid from "./Grid.svelte"
  import PageView, { controlCapabilities, zoomLevels } from "./Page.svelte"
  import type { Inspection, Region, Controls } from "./Page.svelte"
  import type { Magnification } from "./Lens.svelte"
  import Counter from "./Counter.svelte"
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
    error,
    styling,
    input,
    inspection,
    outputZoom = $bindable(100),
    comparing = $bindable(false),
    activate,
    outputProcessing = false,
    downloadError,
    opening = false,
    magnification = 16,
    tour,
  }: {
    source?: Source
    styleable: boolean
    sources: readonly Source[]
    output: Output
    sequence?: Sequence
    choose: (id: string, sequence: Sequence) => void
    change: (text: string) => void
    download: () => void
    error: (message: string) => void
    styling?: Snippet<[toolbarOnly?: boolean]>
    input: Snippet<[heading: string]>
    inspection?: Inspection
    outputZoom?: number
    comparing?: boolean
    activate: (id: string) => void
    outputProcessing?: boolean
    downloadError?: string
    opening?: boolean
    magnification?: Magnification
    tour?: TourStep
  } = $props()
  const key = $props.id()
  function summary(element: HTMLDivElement) {
    const counts = element.querySelector<HTMLElement>(".composition-totals")!
    let frame: number
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const overflow = counts.scrollWidth > element.clientWidth + 1
        element.toggleAttribute("data-overflow", overflow)
        if (!overflow) document.getElementById(`${key}-output-summary`)?.hidePopover()
      })
    })
    observer.observe(element)
    observer.observe(counts)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }
  const motion = new MediaQuery("(prefers-reduced-motion: no-preference)")
  $effect(() => {
    if (motion.current) return
    document
      .getElementById(`${key}-output-panel`)
      ?.querySelectorAll(".composition-card")
      .forEach((card) => {
        for (const animation of card.getAnimations()) animation.finish()
      })
  })
  type InputView = {
    tab: "grid" | "page" | "style"
    density?: "normal" | "compact"
    position: number
    zoom: number
    pageInitialized?: boolean
    offset: number
    region: Region
    alignment?: Region
  }
  const initialView: InputView = {
    tab:
      import.meta.env.DEV &&
      new URLSearchParams(location.search).has("demo") &&
      new URLSearchParams(location.search).has("paint")
        ? "style"
        : import.meta.env.DEV && new URLSearchParams(location.search).get("input") === "page"
          ? "page"
          : "grid",
    position: 0,
    zoom: 100,
    offset: 0,
    region: { x: 0, y: 0 },
  }
  let inputViews = $state.raw<Record<string, InputView>>({})
  const inputView = $derived((source && inputViews[source.id]) ?? initialView)
  const inputPosition = $derived(inputView.position)
  const inputCompact = $derived(inputView.density === "compact")
  let inputControls = $state<Controls>("all")
  let outputControls = $state<Controls>("all")
  let inputPage = $state<ReturnType<typeof PageView>>()
  let outputPage = $state<ReturnType<typeof PageView>>()
  let outputPageInitialized = $state(false)
  let outputDensity = $state<"normal" | "compact">("normal")
  const outputCompact = $derived(outputDensity === "compact")
  let outputOffset = $state(0)
  let outputText = $state<string>()
  let repetitions = $state("2")
  let front = $state(false)
  let outputTab = $state<"grid" | "page">(
    import.meta.env.DEV && new URLSearchParams(location.search).get("output") === "page" ? "page" : "grid",
  )
  let outputRegion = $state<Region>({ x: 0, y: 0 })
  let view = $state<"input" | "output">("input")
  let usingKeyboard = $state(false)
  let touchPointer = $state(false)
  let touchTap: { pane: "Input" | "Output"; element: EventTarget | null; time: number; restore: () => void } | undefined
  let pointerX: number | undefined
  let inputCounter: ReturnType<typeof Counter> | undefined
  let outputCounter: ReturnType<typeof Counter> | undefined
  let originOpen = $state<string>()
  let inputMenu = $state<HTMLDetailsElement>(null!)
  let outputMenu = $state<HTMLDetailsElement>(null!)
  let outputTarget = $state<HTMLButtonElement>()
  let sourceAnchor: { source: string; page: number } | undefined
  let inputClick: { source: string; page: number; sequence: Sequence; anchor: typeof sourceAnchor } | undefined
  let highlight = $state<
    | { kind: "source"; source: string; first: number; last: number }
    | { kind: "output"; ids: readonly string[]; removing?: boolean }
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
  let cancelAddition: (() => void) | undefined
  let pendingAddition = $state.raw(new Set<string>())
  let removing = $state.raw(new Set<string>())
  let removalTransitions = new WeakMap<Element, ReturnType<typeof scale>>()
  let cancelRemoval: (() => void) | undefined
  let cancelMove: (() => void) | undefined
  let removingPage = $state(false)
  const count = $derived(source?.input.pdf.numPages ?? 0)
  const hasStyles = $derived(!!source && Object.keys(source.input.description.parameters).length > 0)
  const activeTab = $derived(
    tour?.startsWith("style") && styleable
      ? "style"
      : tour === "input-page"
        ? "page"
        : tour === "input-grid" || tour === "input-density"
          ? "grid"
          : inputView.tab === "style" && !styleable
            ? "grid"
            : inputView.tab,
  )
  const activeOutputTab = $derived(
    tour === "output-page"
      ? "page"
      : tour === "output-grid" || tour === "output-density" || tour === "output-selection"
        ? "grid"
        : outputTab,
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
  export function views() {
    return { input: activeTab, output: activeOutputTab }
  }
  function inspectInput(patch: Partial<InputView>, id = source?.id) {
    if (!id) return
    inputViews = { ...inputViews, [id]: { ...(inputViews[id] ?? initialView), ...patch } }
  }
  function density(pane: "Input" | "Output", value: "normal" | "compact") {
    originOpen = undefined
    cancelMotion()
    if (pane === "Input") inspectInput({ density: value })
    else outputDensity = value
  }
  function initializeDensity(capacity: number) {
    if (inputView.density === undefined) inspectInput({ density: count > 2 * capacity ? "compact" : "normal" })
  }
  function inputTab(tab: InputView["tab"]) {
    inspectInput({
      tab,
      ...(tab === "grid" ? { offset: inputView.position } : {}),
    })
  }
  function setOutputTab(tab: typeof outputTab) {
    cancelMotion()
    outputTab = tab
    if (tab === "grid") outputOffset = output.position
  }
  function focusPage(control: HTMLElement) {
    const page = control
      .closest(".composition-card, .page-view")
      ?.querySelector<HTMLElement>(".page-image, .page-scroll")
    page?.focus({ preventScroll: true })
  }
  function focusAfterSelection(pane: "Input" | "Output", event?: MouseEvent) {
    const control =
      touchPointer && event?.detail !== 0
        ? document
            .getElementById(`${key}-${pane === "Input" ? "source" : "output"}-panel`)
            ?.querySelector<HTMLElement>(".composition-grid, .page-scroll")
        : document.getElementById(`${key}-${pane === "Input" ? "input" : "output"}-selection`)
    control?.focus({ preventScroll: true })
  }
  async function toggleView(pane: "Input" | "Output", event: MouseEvent | KeyboardEvent) {
    const keyboard = event instanceof KeyboardEvent || event.detail === 0
    const tab = (pane === "Input" ? activeTab : activeOutputTab) === "page" ? "grid" : "page"
    const position = pane === "Input" ? inputPosition : output.position
    if (pane === "Input") inputTab(tab)
    else setOutputTab(tab)
    await tick()
    const panel = document.getElementById(`${key}-${pane === "Input" ? "source" : "output"}-panel`)
    const control =
      tab === "page"
        ? panel?.querySelector<HTMLElement>(".page-scroll")
        : panel?.querySelector<HTMLElement>(`.page-image[data-page="${position}"]`)
    control?.scrollIntoView({ block: "nearest" })
    if (keyboard)
      (control ?? document.getElementById(`${key}-${pane === "Output" ? "output-" : ""}${tab}`))?.focus({
        preventScroll: true,
      })
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
  function shortcutPane(page = false) {
    const inputAvailable =
      !!source && (!page || activeTab === "page") && !!document.getElementById(`${key}-source-panel`)?.clientWidth
    const outputAvailable =
      (!page || (!!inspected && activeOutputTab === "page")) &&
      !!document.getElementById(`${key}-output-panel`)?.clientWidth
    const focused = document.activeElement
    const preferred =
      pointerX === undefined
        ? focused?.closest(".composition-output")
          ? "output"
          : focused?.closest(".selection-panel")
            ? "input"
            : activeView
        : pointerX < innerWidth / 2
          ? "input"
          : "output"
    if (preferred === "input" && inputAvailable) return "Input"
    if (preferred === "output" && outputAvailable) return "Output"
    return inputAvailable ? "Input" : outputAvailable ? "Output" : undefined
  }
  function shortcuts(event: KeyboardEvent) {
    const preferred = shortcutPane()
    const context = shortcutContext(event, {
      pane: preferred,
      view: preferred === "Input" ? activeTab : activeOutputTab,
    })
    const action = shortcut(event, context, "workspace")
    if (!action) return false
    const all = action === "all"
    const pressed = event.key.toLowerCase()
    const focused = document.activeElement
    if ((action === "left" || action === "right") && !(usingKeyboard && focused?.closest(".composition-grid"))) {
      const pane = shortcutPane()
      const grid = document
        .getElementById(`${key}-${pane === "Input" ? "source" : "output"}-panel`)
        ?.querySelector<HTMLElement>(".composition-grid")
      const hasSelection = pane === "Input" ? !!draft.pages.length : !!chosen.length
      if (grid && !hasSelection) {
        event.preventDefault()
        if (event.repeat) return true
        const images = grid.querySelectorAll<HTMLButtonElement>(".composition-card:not([inert]) > .page-image")
        const image = action === "left" ? images[images.length - 1] : images[0]
        if (!image) return true
        const position = Number(image.dataset.page)
        if (pane === "Input") inspectInput({ position })
        else output.position = position
        usingKeyboard = true
        image.focus()
        return true
      }
    }
    if (
      (focused?.closest(".grid-view") && ["pageup", "pagedown"].includes(pressed)) ||
      (["pageup", "pagedown"].includes(pressed) &&
        document
          .getElementById(`${key}-${shortcutPane() === "Input" ? "source" : "output"}-panel`)
          ?.querySelector(".grid-view")) ||
      (focused?.closest(".composition-grid") &&
        ["left", "right", "up", "down", "first", "last", "next", "previous", "copy"].includes(action)) ||
      (focused?.closest(".composition-grid") && ["zoomIn", "zoomOut"].includes(action))
    )
      return false
    event.preventDefault()
    const pane = shortcutPane(!all && action !== "view")
    if (!pane) return true
    const panel = document.getElementById(`${key}-${pane === "Input" ? "source" : "output"}-panel`)
    if (all) {
      if (!event.repeat) {
        selectAll(pane)
        void tick().then(() => {
          if (focused instanceof HTMLElement && !focused.isConnected)
            document
              .getElementById(`${key}-${pane === "Input" ? "input" : "output"}-selection`)
              ?.focus({ preventScroll: true })
        })
      }
      return true
    }
    if (action === "view") {
      if (!event.repeat) {
        usingKeyboard = true
        if (focused instanceof HTMLElement && focused.matches(".page-image") && panel?.contains(focused)) {
          const position = Number(focused.dataset.page)
          if (pane === "Input") inspectInput({ position })
          else output.position = position
        }
        void toggleView(pane, event)
      }
      return true
    }
    usingKeyboard = true
    const position = pane === "Input" ? inputPosition : output.position
    const total = pane === "Input" ? count : output.pages.length
    const viewport = panel?.querySelector<HTMLElement>(".page-scroll")
    const turn = ["left", "right"].includes(action) && !!viewport && viewport.scrollWidth - viewport.clientWidth <= 1
    if (turn || ["next", "previous", "first", "last"].includes(action)) {
      const next =
        action === "first"
          ? 0
          : action === "last"
            ? total - 1
            : Math.max(0, Math.min(total - 1, position + (["previous", "left"].includes(action) ? -1 : 1)))
      if (pane === "Input") inspectInput({ position: next, alignment: undefined })
      else output.position = next
    } else if (["left", "right", "up", "down"].includes(action)) {
      viewport?.scrollBy({
        left: action === "left" ? -40 : action === "right" ? 40 : 0,
        top: action === "up" ? -40 : action === "down" ? 40 : 0,
      })
    } else if (["zoomIn", "zoomOut"].includes(action)) zoomBy(pane, action === "zoomOut" ? -1 : 1)
    else if (action === "resetZoom") setZoom(pane, 100)
    else if (action === "entry") {
      if (!event.repeat) editPage(pane)
    } else if (!event.repeat) {
      copyCurrent(pane)
    }
    return true
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
    if (!touchPointer || !event.detail || event.ctrlKey || event.metaKey || event.altKey) {
      touchTap = undefined
      return false
    }
    const now = performance.now()
    if (touchTap?.element === event.currentTarget && now - touchTap.time < 350) {
      touchTap.restore()
      touchTap = undefined
      void toggleView(pane, event)
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
  function toggle(page: number, range: boolean) {
    if (!source) return
    const anchor = sourceAnchor?.source === source.id ? sourceAnchor.page : undefined
    const { pages, first, last, adding } = toggleSequence(draft.pages, page, range ? anchor : undefined)
    numbers(pageRanges(pages))
    sourceAnchor = { source: source.id, page }
    highlightRange(adding && range && first < last ? { kind: "source", source: source.id, first, last } : undefined)
  }
  function selectInput(page: number, event: MouseEvent) {
    if (!source) return
    inspectInput({ position: page })
    if (touchPage("Input", event)) return
    if (event.ctrlKey || event.metaKey) {
      void toggleView("Input", event)
      return
    }
    if (event.detail > 1) return
    if (event.detail === 1) inputClick = { source: source.id, page, sequence: draft, anchor: sourceAnchor }
    toggle(page, event.shiftKey)
    if (event.detail) (event.currentTarget as HTMLElement).focus({ preventScroll: true })
  }
  function removal(node: Element, id: string) {
    if (!motion.current || !removing.has(id)) return { duration: 0 }
    return removalTransitions.get(node) ?? { duration: 0 }
  }
  function cancelMotion() {
    removing = new Set()
    cancelAddition?.()
    cancelAddition = undefined
    cancelRemoval?.()
    cancelRemoval = undefined
    cancelMove?.()
    cancelMove = undefined
    // Outgoing cards must leave before another edit or transfer uses the Grid's slots.
    for (const card of document
      .getElementById(`${key}-output-panel`)
      ?.querySelectorAll<HTMLElement>(".composition-card.removing") ?? []) {
      for (const animation of card.getAnimations()) animation.finish()
      card.style.display = "none"
    }
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
            ?.querySelector<HTMLElement>(".page-image :is(canvas, .composition-blank)")
    return image ?? panel?.querySelector<HTMLElement>(".sequence-entry")
  }
  function animateEdit(edit: Edit, origin?: HTMLElement | null) {
    cancelMotion()
    const expanded = edit.pages
    const added = expanded.filter((page) => edit.added.has(page.id))
    removing = new Set(edit.removed)
    const reordering =
      !added.length && !removing.size && expanded.some((page, index) => page.id !== output.pages[index]?.id)
    const panel = document.getElementById(`${key}-output-panel`)
    removalTransitions = new WeakMap()
    // Read outgoing styles together before Svelte starts changing individual cards.
    if (motion.current)
      for (const id of edit.removed) {
        const card = document.getElementById(`${key}-${id}`)
        if (card) removalTransitions.set(card, scale(card, { duration: removalDuration, start: 0.86, easing: quadIn }))
      }
    if (added.length && !transfer.value) {
      const sheet = origin ?? additionOrigin("blank" in added[0].content ? undefined : chosen[0]?.id)
      if (sheet) {
        cancelAddition = animateAddition(
          sheet,
          sizeOf(added[0].content, sources),
          "blank" in added[0].content,
          added.length,
          () => {
            const button = outputTarget
            const image = panel?.querySelector<HTMLElement>(".composition-card[data-adding] .page-image")
            if (button?.offsetWidth && (origin?.closest(".selection-panel") || !image)) return button
            return image ?? document.getElementById(`${key}-output`)
          },
          () => {
            const id = inspected?.id
            const focused = document.activeElement
            const restore = id && pendingAddition.has(id) && focused?.matches(".composition-output .composition-grid")
            pendingAddition = new Set()
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
      pendingAddition = cancelAddition ? new Set(added.map((page) => page.id)) : new Set()
    }
    if (inspected && removing.has(inspected.id) && activeOutputTab === "page") {
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet) cancelRemoval = animateRemoval(sheet, () => (removingPage = false))
      removingPage = !!cancelRemoval
    }
    if (reordering && inspected && activeOutputTab === "page") {
      const position = expanded.findIndex((page) => page.id === inspected.id)
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet && position !== output.position) cancelMove = animateMove(sheet, position - output.position)
    }
    if (reordering && activeOutputTab === "grid") {
      const grid = panel?.querySelector<HTMLElement>(".composition-grid")
      if (grid) cancelMove = animateOrder(grid)
    }
  }
  function captureEditFocus(selecting: boolean) {
    const focused = document.activeElement as HTMLElement | null
    const card = focused?.closest<HTMLElement>(".output-pages .composition-card")
    const grid = focused?.matches(".output-pages")
    const pageAction = focused?.closest(".composition-output .page-actions")
    const selectionAction = focused?.closest(".composition-output .sequence-entry") ?? grid
    const menu = focused?.closest<HTMLDetailsElement>(".sequence-options[open]")
    const index = output.pages.findIndex((page) => `${key}-${page.id}` === card?.id)
    const inspect = output.pages[index]?.id
    const focusSelection = selecting && !!(card || grid)
    return {
      inspect,
      focusSelection,
      restore(edit: Edit) {
        const expanded = edit.pages
        const selection = edit.selected
        const destination = card || focusSelection ? edit.position : undefined
        if (destination !== undefined) outputOffset = destination
        if (transfer.touching) return
        if (menu) menu.querySelector("summary")?.focus()
        else if (selectionAction)
          void tick().then(() => {
            if (touchPointer && expanded.length) {
              focusAfterSelection("Output")
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
              if (expanded.length) focusAfterSelection("Output")
              else document.getElementById(`${key}-output-${activeOutputTab}`)?.focus({ preventScroll: true })
            } else focused.focus({ preventScroll: true })
          })
        else if (card || pageAction)
          void tick().then(() => {
            if (
              !selecting &&
              focused?.classList.contains("page-image") &&
              focused?.isConnected &&
              !focused.matches(":disabled") &&
              (!card || expanded.some((page) => `${key}-${page.id}` === card.id))
            ) {
              focused.focus()
              return
            }
            const page = output.pages[destination ?? Math.min(index, output.pages.length - 1)]
            const neighbor = page && document.getElementById(`${key}-${page.id}`)
            const viewport =
              !card && output.pages.length
                ? document.getElementById(`${key}-output-panel`)?.querySelector<HTMLElement>(".page-scroll")
                : undefined
            ;(
              (page && pendingAddition.has(page.id)
                ? document.getElementById(`${key}-output-panel`)?.querySelector<HTMLElement>(".composition-grid")
                : neighbor?.querySelector<HTMLButtonElement>(".page-image")) ??
              viewport ??
              document.getElementById(`${key}-output-${activeOutputTab}`)
            )?.focus({ preventScroll: !!pageAction || pendingAddition.size > 0 })
          })
      },
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
      const focus = captureEditFocus(!!select)
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
      if (select) highlightRange({ kind: "output", ids: [...edit.selected] })
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
        : panel?.querySelector<HTMLElement>(`.page-image[data-page="${first}"] canvas`)) ??
      panel?.querySelector<HTMLElement>(".sequence-entry")
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
      if (inputBar && !transfer.touching) focusAfterSelection("Input")
    }
    return completed
  }
  function selectOutput(id: string, range: boolean) {
    outputText = undefined
    const next = output.toggle(id, range)
    const { index, ids, adding } = next
    if (activeOutputTab === "grid") output.position = index
    highlightRange(adding && range && ids.length > 1 ? { kind: "output", ids } : undefined)
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
      highlightRange({ kind: "output", ids })
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
    highlightRange({ kind: "output", ids, removing: true })
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
        value.source === source?.id && !!add(at, value.choice.kind === "preparation" ? undefined : [value.choice.page])
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
      highlightRange({ kind: "output", ids: value.ids })
    }
    return completed
  }
  function start(event: DragEvent | PointerEvent, value: Payload, control = event.currentTarget as HTMLElement) {
    if ("dataTransfer" in event && touchPointer) {
      event.preventDefault()
      return
    }
    if (value.kind === "source" && value.source !== source?.id) return
    if (value.kind === "source" && value.choice.kind === "page" && inputSelected.has(value.choice.page)) {
      if (activeTab === "grid") inspectInput({ position: value.choice.page })
      value = inputPayload()
    } else if (value.kind === "output" && selectedIds.has(value.ids[0])) {
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
        : value.choice.kind === "preparation"
          ? parsed.pages.length * parseCopies(draft.repeat)!
          : 1
    transfer.begin(event, value, quantity, control, source?.input.sizes[parsed.pages[0]])
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
    outputTab = activeOutputTab
    view = activeView
    document.querySelector<HTMLElement>(".help-tour:popover-open")?.hidePopover()
  }
  function tabKey(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    const tabs: InputView["tab"][] = styleable ? ["grid", "page", "style"] : ["grid", "page"]
    const index = tabs.indexOf(activeTab)
    const tab =
      event.key === "Home"
        ? tabs[0]
        : event.key === "End"
          ? tabs.at(-1)!
          : tabs[(index + (event.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
    inputTab(tab)
    document.getElementById(`${key}-${tab}`)?.focus()
  }
  function outputKey(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    setOutputTab(event.key === "Home" ? "grid" : event.key === "End" ? "page" : outputTab === "grid" ? "page" : "grid")
    document.getElementById(`${key}-output-${outputTab}`)?.focus()
  }
</script>

<svelte:window
  onpointermove={transfer.moveTouch}
  onpointerup={transfer.finishTouch}
  onpointercancel={transfer.cancelTouch}
  onblur={transfer.blur}
  onresize={() => transfer.end()}
  onclickcapture={transfer.click}
  ondragend={() => transfer.end()}
  onkeydowncapture={(event) => {
    touchTap = undefined
    touchPointer = false
    if (opening || (event.target instanceof Element && event.target.closest(".file-errors"))) return
    if (event.key === "Escape" && event.target instanceof HTMLElement && event.target.closest(".page-jump")) return
    if (shortcuts(event)) return
    if (
      ["Tab", "Enter", " "].includes(event.key) &&
      (!event.shiftKey || event.key === "Tab") &&
      !event.isComposing &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey
    )
      usingKeyboard = true
    const context = shortcutContext(event, {
      overlay: !!document.querySelector(
        "dialog[open], [popover]:popover-open, .input-picker[open], .lens, .quartet-panel, .control details[open]",
      ),
    })
    if (shortcut(event, context, "escape") !== "clear") return
    const dismissing =
      !!transfer.value || !!document.querySelector(".page-origin[open]") || inputMenu?.open || outputMenu?.open
    transfer.end()
    originOpen = undefined
    if (inputMenu?.open) {
      inputMenu.open = false
      inputMenu.querySelector("summary")?.focus()
    }
    if (outputMenu?.open) {
      outputMenu.open = false
      outputMenu.querySelector("summary")?.focus()
    }
    if (dismissing) return
    const pane = shortcutPane()
    if (!pane) return
    const hasSelection =
      pane === "Input"
        ? !!draft.text || !!draft.pages.length || draft.repeat !== "1" || draft.front
        : !!chosen.length || !!outputText || repetitions !== "2" || front
    const panel = document.getElementById(`${key}-${pane === "Input" ? "source" : "output"}-panel`)
    if (!hasSelection && !panel?.querySelector(".composition-grid")?.contains(document.activeElement)) return
    if (pane === "Input") clearInput()
    else clearOutput()
    event.preventDefault()
    document
      .getElementById(pane === "Output" ? `${key}-output-${activeOutputTab}` : `${key}-${activeTab}`)
      ?.focus({ preventScroll: true })
  }}
  onkeydown={(event) => {
    if (opening) return
    const action = shortcut(event, shortcutContext(event), "output")
    if (!action) return
    const control = event.target
    if (
      !(control instanceof HTMLElement) ||
      (!control.closest(".composer") && control !== document.body) ||
      control.closest("details[open]")
    )
      return
    const ids = outputTargets()
    if (!ids.length) return
    event.preventDefault()
    usingKeyboard = true
    if (action === "remove") {
      if (!event.repeat) remove(ids)
    } else order(action === "earlier" ? -1 : 1, ids)
  }}
/>
<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) transfer.end()
  }}
  onfocusin={interact}
  onpointermove={(event) => {
    if (event.pointerType === "mouse") {
      pointerX = event.clientX
      if (event.movementX || event.movementY) usingKeyboard = false
    }
  }}
  onpointerdown={(event) => {
    transfer.pointer(event)
    touchPointer = event.pointerType === "touch" || event.pointerType === "pen"
    if (!(event.target as Element).closest(".page-image")) touchTap = undefined
    if (event.pointerType === "mouse") pointerX = event.clientX
    usingKeyboard = false
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
    ><Icon name="compare" />{#if menu}Compare page{/if}</button
  >
  <button
    class={menu ? undefined : "tool"}
    aria-label="Show original page"
    title="Show original page"
    disabled={inspection?.kind !== "pdf" || !inspection.comparison}
    onclick={showOriginal}
    ><Icon name="original" />{#if menu}Show original page{/if}</button
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
    {#if menu}<Icon name="fit" />{zoom === 100 ? "Fit width" : `Reset zoom · ${zoom}%`}
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
      bind:this={inputCounter}
      bind:position={() => inputView.position, (position) => inspectInput({ position, alignment: undefined })}
      {count}
    />
    {#if source?.input.labels[inputPosition] && source.input.labels[inputPosition] !== String(inputPosition + 1)}<span
        class="page-context"
        title={source.input.labels[inputPosition]}>{source.input.labels[inputPosition]}</span
      >{/if}
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
      focusPage(event.currentTarget)
    }}
    ondragstart={(event) => start(event, inputPayload(inputView.position))}
    onpointerdown={(event) => transfer.press(event, inputPayload(inputView.position))}
    ondragend={() => transfer.end()}><Icon name="reorder" /></button
  >
  {@render pageTools("Input", fitWidth)}
  {@render pageFace(inputView.position)}
{/snippet}

{#snippet inputPageActions(page: number = inputPosition)}
  <button
    class="icon-button"
    aria-label={`Add Input page ${page + 1} to Output`}
    title="Add one copy"
    onclick={(event) => {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
      if (add(undefined, [page])) {
        inspectInput({ position: page })
        focusPage(event.currentTarget)
      }
    }}><Icon name="add" /></button
  >
{/snippet}

{#snippet inputOrigin(page: number, detail: string)}
  {#if source}
    {@const destinations = outputPositions.get(page) ?? []}
    {#snippet details()}
      <strong>Copies in Output: {destinations.length}</strong>
      <span class="page-context">Output pages: {pageRanges(destinations)}</span>
    {/snippet}
    <Origin
      id={detail}
      pane="Input"
      number={page + 1}
      label={source.input.labels[page]}
      compact={inputCompact}
      bind:opened={originOpen}
      details={destinations.length ? details : undefined}
    >
      {#snippet children()}
        <div class="card-preview">
          <Pdf pdf={source.input.pdf} {page} pageNumber={page + 1} thumbnail {magnification} {error} />
        </div>
        <p class="page-context">{source.input.name} · {page % 2 ? "Back" : "Front"} side</p>
        {#if destinations.length}<p class="page-context">
            Copies in Output: {destinations.length} · pages {pageRanges(destinations)}
          </p>{/if}
        {#if !draft.pages.length}<div class="occurrence-actions input-menu-action">
            {@render inputPageActions(page)}
          </div>{/if}
      {/snippet}
    </Origin>
  {/if}
{/snippet}

{#snippet outputOrigin(page: Expanded, index: number)}
  {@const origin = provenance(page.content)}
  <Origin
    id={`${key}-output-menu-${page.id}`}
    pane="Output"
    number={index + 1}
    compact={outputCompact}
    bind:opened={originOpen}
  >
    {#snippet details()}
      <strong>{origin?.input.name ?? (page.padding ? "Padding" : "Blank")}</strong>
      <span class="page-context"
        >{"page" in page.content
          ? `p. ${page.content.page + 1}`
          : `${sizeOf(page.content, sources).width.toFixed(1)} × ${sizeOf(page.content, sources).height.toFixed(1)} mm`}</span
      >
    {/snippet}
    {#snippet children()}
      <div class="card-preview">
        {#if origin && "page" in page.content}<Pdf
            {...origin.preview.appearance(page.content.page)}
            pageNumber={page.content.page + 1}
            thumbnail
            {magnification}
            {error}
          />
        {:else}<div
            class="composition-blank"
            style:--ratio={sizeOf(page.content, sources).width / sizeOf(page.content, sources).height}
          >
            <Icon name="blank" /><span>{page.padding ? "Padding" : "Blank"}</span>
          </div>{/if}
      </div>
      <p class="page-context">
        {origin?.input.name ?? (page.padding ? "Padding" : "Blank")}{#if "page" in page.content}
          · original page {page.content.page + 1}{/if}
      </p>
      {@render occurrenceActions(page, index, !chosen.length)}
    {/snippet}
  </Origin>
{/snippet}

{#snippet gridDensity(pane: "Input" | "Output", compact: boolean)}
  <div
    class="grid-density"
    role="group"
    aria-label={`${pane} grid density`}
    data-tour-target={pane === "Input" ? "input-density" : "output-density"}
    data-tour-active={tour === (pane === "Input" ? "input-density" : "output-density")}
  >
    <button
      class="icon-button"
      aria-label={`Normal ${pane} grid`}
      aria-pressed={!compact}
      title="Normal grid"
      onclick={() => density(pane, "normal")}><Icon name="normal" /></button
    >
    <button
      class="icon-button"
      aria-label={`Compact ${pane} grid`}
      aria-pressed={compact}
      title="Compact grid"
      onclick={() => density(pane, "compact")}><Icon name="compact" /></button
    >
  </div>
{/snippet}

{#snippet outputSummary()}
  <strong>{output.pages.length} {output.pages.length === 1 ? "page" : "pages"}</strong>, {Math.ceil(
    output.pages.length / 2,
  )}
  {Math.ceil(output.pages.length / 2) === 1 ? "sheet" : "sheets"}
{/snippet}

{#snippet outputGridHeading(page: Expanded, index: number)}
  {@render outputOrigin(page, index)}
  <button
    class="page-grip"
    aria-label={`Select or drag Output page ${index + 1}`}
    aria-pressed={selectedIds.has(page.id)}
    title="Select or unselect this page."
    draggable="true"
    onmousedown={retainFocus}
    onclick={(event) => {
      selectOutput(page.id, event.shiftKey)
      focusPage(event.currentTarget)
    }}
    ondragstart={(event) => start(event, { kind: "output", ids: [page.id] })}
    onpointerdown={(event) => transfer.press(event, { kind: "output", ids: [page.id] })}
    ondragend={() => transfer.end()}
  >
    <Icon name="reorder" />
  </button>
  {@render pageFace(index)}
{/snippet}

{#snippet occurrenceActions(page: Expanded, index: number, controls: boolean)}
  {@const ids = outputTargets(page.id)}
  <div class="occurrence-actions">
    {#if controls}
      {#if outputCompact}<button
          class="icon-button move"
          aria-label={`Move Output page ${index + 1} earlier`}
          title="Move page earlier"
          disabled={!ids.length || index === 0}
          onclick={(event) => {
            event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
            order(-1, ids)
          }}><Icon name="earlier" /></button
        >{/if}<button
        class="icon-button"
        aria-label={`Remove Output page ${index + 1}`}
        title="Remove this page"
        disabled={!ids.length}
        onclick={(event) => {
          event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
          remove(ids)
        }}><Icon name="remove" /></button
      ><button
        class="icon-button"
        aria-label={`Duplicate Output page ${index + 1}`}
        title="Add one adjacent copy"
        disabled={!ids.length}
        onclick={(event) => {
          event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
          duplicate(ids)
        }}><Icon name="add" /></button
      >{#if outputCompact}<button
          class="icon-button move"
          aria-label={`Move Output page ${index + 1} later`}
          title="Move page later"
          disabled={!ids.length || index === output.pages.length - 1}
          onclick={(event) => {
            event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
            order(1, ids)
          }}><Icon name="later" /></button
        >{/if}
    {/if}
  </div>
{/snippet}

{#snippet outputPageHeading(fitWidth: () => void)}
  {@const origin = inspected ? provenance(inspected.content) : undefined}
  {@const label = inspected && "page" in inspected.content ? origin?.input.labels[inspected.content.page] : undefined}
  <span class="page-number">
    <Counter pane="Output" bind:this={outputCounter} bind:position={output.position} count={output.pages.length} />
    {#if label && label !== String(output.position + 1)}<span class="page-context" title={label}>{label}</span>{/if}
  </span>
  {@render pageTools("Output", fitWidth)}
  {@render pageFace(output.position)}
{/snippet}

{#snippet outputPageActions()}
  {#if inspected}
    <button
      class="icon-button"
      aria-label={`Remove Output page ${output.position + 1}`}
      title="Remove this page"
      disabled={!!outputSelectionError}
      onclick={() => remove(outputTargets(inspected.id))}><Icon name="remove" /></button
    >
    <button
      class="icon-button"
      aria-label={`Duplicate Output page ${output.position + 1}`}
      title="Add one adjacent copy"
      disabled={!!outputSelectionError}
      onclick={() => duplicate(outputTargets(inspected.id))}><Icon name="add" /></button
    >
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
      title="Move selected pages earlier · Ctrl+←"
      disabled={!chosen.length || !!outputSelectionError || positions[0] === 0}
      onclick={() => order(-1)}
      ><Icon name="earlier" />{#if !inline}Move selected pages earlier{/if}</button
    >
    <button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages later"
      title="Move selected pages later · Ctrl+→"
      disabled={!chosen.length || !!outputSelectionError || positions.at(-1) === output.pages.length - 1}
      onclick={() => order(1)}
      ><Icon name="later" />{#if !inline}Move selected pages later{/if}</button
    >{/if}
{/snippet}

{#snippet outputTools()}
  <details class="sequence-options output-options" bind:this={outputMenu}>
    <summary id={`${key}-output-actions`} aria-label="Output page actions" title="Output page actions"
      ><Icon name="more" /></summary
    >
    <div class="menu-options">
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
      <div class="selected-actions">
        <div class="menu-moves">{@render outputMoves()}</div>
        {#if chosen.length}<button disabled={!!outputSelectionError} onclick={() => blank(positions[0])}
            ><Icon name="blank" />Blank before first selected page</button
          >{/if}
        <button disabled={!output.pages.length} onclick={() => blank(output.pages.length)}
          ><Icon name="blank" />Add blank page at end</button
        >
      </div>
      {#if chosen.length && adjacent}
        <Repetition pane="Output" bind:value={repetitions} bind:front />
        {#if Number(repetitions) !== 1 || front}<button
            disabled={!!repeatError || !!outputSelectionError}
            onclick={repeat}>Repeat selected pages</button
          >{/if}
      {:else if chosen.length}<p>Select consecutive pages to repeat a sequence.</p>{/if}
    </div>
  </details>
{/snippet}

<div
  class="composer"
  style:--page-heading-height={frameHeadingHeight ? `${frameHeadingHeight + 1}px` : undefined}
  data-view={activeView}
  data-drag={transfer.value?.kind}
  data-touch={touchPointer || undefined}
  data-touch-drag={transfer.touching || undefined}
  data-keyboard={usingKeyboard}
  inert={opening}
  aria-busy={opening}
  {@attach transfer.track}
>
  <nav class="mobile-workspace-tabs" aria-label="Workspace view">
    <button
      aria-pressed={activeView === "input" && !!source}
      disabled={!source}
      onclick={() => {
        cancelMotion()
        view = "input"
      }}><Icon name="input" />Input</button
    >
    <button
      bind:this={outputTarget}
      aria-pressed={activeView === "output"}
      data-drop={transfer.touching && transfer.value?.kind === "source" && activeView === "input" && transfer.inside
        ? true
        : undefined}
      onclick={() => {
        cancelMotion()
        view = "output"
      }}><Icon name="output" />Output</button
    >
  </nav>
  <div class="composition-panels">
    {#if source}<section
        class="selection-panel"
        style:--grid-digits={String(count).length}
        data-density={inputView.density}
        aria-labelledby={`${key}-selection`}
      >
        <div class="section-heading input-heading" data-tour-target="input" data-tour-active={tour === "input"}>
          {@render input(`${key}-selection`)}
        </div>

        <div class="editing-toolbar source-tabs">
          <div class="tabs" role="tablist" aria-label="Input workspace">
            <button
              id={`${key}-grid`}
              role="tab"
              aria-label="Grid"
              aria-selected={activeTab === "grid"}
              aria-controls={`${key}-source-panel`}
              tabindex={activeTab === "grid" ? 0 : -1}
              onkeydown={tabKey}
              onclick={() => inputTab("grid")}
              title="Grid view"
              data-tour-tab="input-grid"
              data-tour-active={tour === "input-grid"}><Icon name="grid" /><span>Grid</span></button
            >
            <button
              id={`${key}-page`}
              role="tab"
              aria-label="Page"
              aria-selected={activeTab === "page"}
              aria-controls={`${key}-source-panel`}
              tabindex={activeTab === "page" ? 0 : -1}
              onkeydown={tabKey}
              onclick={() => inputTab("page")}
              title="Page view"
              data-tour-tab="input-page"
              data-tour-active={tour === "input-page"}><Icon name="page" /><span>Page</span></button
            >
            {#if hasStyles}<button
                id={`${key}-style`}
                role="tab"
                aria-label="Style"
                aria-selected={activeTab === "style"}
                aria-controls={`${key}-source-panel`}
                tabindex={activeTab === "style" ? 0 : -1}
                onkeydown={tabKey}
                onclick={() => inputTab("style")}
                disabled={!styleable}
                aria-describedby={!styleable ? `${key}-style-unavailable` : undefined}
                title={styleable
                  ? "Style"
                  : "Style unavailable. Add applicable pages from this Input to Output to use Style."}
                data-tour-tab="style"
                data-tour-active={tour === "style"}
                ><Icon name={styleable ? "style" : "style-off"} /><span>Style</span
                >{#if Object.keys(source.overrides).length || Object.keys(source.drafts).length}<span class="edit-dot"
                  ></span>{/if}</button
              >{/if}
          </div>
          {#if activeTab === "grid"}{@render gridDensity("Input", inputCompact)}{/if}
          {#if activeTab === "style" && styling}{@render styling(true)}{/if}
        </div>

        <div
          class="input-panel"
          id={`${key}-source-panel`}
          role="tabpanel"
          data-tour-target={activeTab === "style" ? "style" : activeTab === "page" ? "input-page" : "input-grid"}
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
                      focusAfterSelection("Input", event)
                    }}><Icon name="select" /></button
                  >{/if}
                {#if draft.text || draft.pages.length || draft.repeat !== "1" || draft.front}<button
                    class="reset"
                    aria-label="Clear page sequence"
                    title="Clear"
                    onclick={(event) => {
                      clearInput()
                      focusAfterSelection("Input", event)
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
                <div class="input-drop-hint" role="status"><Icon name="ban" />Move to Output.</div>
              {/if}
              {#if activeTab === "page"}
                {#key source.id}<PageView
                    pane="Input"
                    bind:this={inputPage}
                    {count}
                    sheet={inputInspection}
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
                    grid={(event) => void toggleView("Input", event)}
                    selected={inputSelected.has(inputPosition)}
                    {error}
                    {magnification}
                  />{/key}
              {:else}
                <Grid
                  pane="Input"
                  active={() => shortcutPane() === "Input"}
                  compact={inputCompact}
                  {count}
                  initialize={!opening && inputView.density === undefined ? initializeDensity : undefined}
                  bind:position={() => inputView.position, (position) => inspectInput({ position })}
                  bind:offset={() => inputView.offset, (offset) => inspectInput({ offset })}
                  bind:keyboard={usingKeyboard}
                  selected={(position) => inputSelected.has(position)}
                  toggle={(page) => toggle(page, false)}
                  edit={(action) => action === "add" && !!add()}
                >
                  {#snippet children(from, to)}
                    {#each Array.from({ length: to - from }, (_, index) => from + index) as page (page)}
                      {@const first = page === from}
                      {@const destinations = outputPositions.get(page) ?? []}
                      {@const detail = `${key}-input-${source.id}-${page}`}
                      <li
                        class={["composition-card", { selected: inputSelected.has(page) }]}
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
                          <button
                            class="page-grip"
                            aria-label={`Select or drag Input page ${page + 1} to Output`}
                            aria-pressed={inputSelected.has(page)}
                            title="Select or unselect this page."
                            draggable="true"
                            onmousedown={retainFocus}
                            onclick={(event) => {
                              toggle(page, event.shiftKey)
                              inspectInput({ position: page })
                              focusPage(event.currentTarget)
                            }}
                            ondragstart={(event) => start(event, inputPayload(page))}
                            onpointerdown={(event) => transfer.press(event, inputPayload(page))}
                            ondragend={() => transfer.end()}><Icon name="reorder" /></button
                          >
                        </div>
                        <button
                          class="page-image"
                          data-page={page}
                          aria-label={`Select Input page ${page + 1}`}
                          aria-pressed={inputSelected.has(page)}
                          aria-describedby={!inputCompact && destinations.length ? detail : undefined}
                          title="Select pages for Output."
                          aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Space Enter Delete"
                          draggable="true"
                          onmousedown={retainFocus}
                          onclick={(event) => selectInput(page, event)}
                          ondblclick={(event) => {
                            if (
                              touchPointer ||
                              event.ctrlKey ||
                              event.metaKey ||
                              !source ||
                              inputClick?.source !== source.id ||
                              inputClick.page !== page
                            )
                              return
                            choose(source.id, inputClick.sequence)
                            sourceAnchor = inputClick.anchor
                            highlightRange()
                            inputClick = undefined
                            add(undefined, inputTargets(page))
                          }}
                          ondragstart={(event) => start(event, inputPayload(page))}
                          ondragend={() => transfer.end()}
                        >
                          <Pdf pdf={source.input.pdf} {page} pageNumber={page + 1} thumbnail {magnification} {error} />
                        </button>
                        <div class="input-footer">
                          {#if !draft.pages.length}{@render inputPageActions(page)}{/if}
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
      style:--grid-digits={String(output.pages.length).length}
      data-density={outputDensity}
      data-preview={transfer.preview ? true : undefined}
      aria-labelledby={`${key}-output`}
      data-drop={transfer.value && transfer.target.kind === "append" ? "end" : undefined}
      ondragover={(event) => transfer.over(event)}
      ondragleave={transfer.leaveOutput}
      ondrop={(event) => transfer.drop(event)}
    >
      <div class="section-heading">
        <div>
          <h2 id={`${key}-output`}><Icon name="output" />Output</h2>
        </div>
        <div class="output-state" {@attach summary}>
          <span class="composition-totals">{@render outputSummary()}</span>
          <button
            class="icon-button"
            popovertarget={`${key}-output-summary`}
            aria-label="Output details"
            title="Output details"><Icon name="info" /></button
          >
        </div>
        <div class="download-action" data-tour-target="download" data-tour-active={tour === "download"}>
          <button
            class="primary"
            aria-label="Download"
            disabled={!output.pages.length || outputProcessing || !!downloadError}
            title={downloadError ?? "Download"}
            aria-describedby={downloadError ? `${key}-download-error` : undefined}
            onclick={download}><Icon name="down" /><span>Download</span></button
          >
        </div>
        {#if downloadError}<p id={`${key}-download-error`} class="download-error error" role="alert">
            {downloadError}
          </p>{/if}
      </div>
      <div id={`${key}-output-summary`} class="output-details" popover="auto" role="note" aria-label="Output details">
        {@render outputSummary()}
      </div>
      <div class="editing-toolbar output-tabs">
        <div class="tabs" role="tablist" aria-label="Output workspace">
          <button
            id={`${key}-output-grid`}
            role="tab"
            aria-label="Grid"
            aria-selected={activeOutputTab === "grid"}
            aria-controls={`${key}-output-panel`}
            tabindex={activeOutputTab === "grid" ? 0 : -1}
            onkeydown={outputKey}
            onclick={() => setOutputTab("grid")}
            title="Grid view"
            data-tour-tab="output-grid"
            data-tour-active={tour === "output-grid"}><Icon name="grid" /><span>Grid</span></button
          >
          <button
            id={`${key}-output-page`}
            role="tab"
            aria-label="Page"
            aria-selected={activeOutputTab === "page"}
            aria-controls={`${key}-output-panel`}
            tabindex={activeOutputTab === "page" ? 0 : -1}
            onkeydown={outputKey}
            onclick={() => setOutputTab("page")}
            title="Page view"
            data-tour-tab="output-page"
            data-tour-active={tour === "output-page"}><Icon name="page" /><span>Page</span></button
          >
        </div>
        {#if activeOutputTab === "grid"}{@render gridDensity("Output", outputCompact)}{/if}
      </div>

      <div
        class="output-panel"
        data-tour-target={activeOutputTab === "page" ? "output-page" : "output-grid"}
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
                  focusAfterSelection("Output", event)
                }}><Icon name="select" /></button
              >{/if}
            {#if chosen.length || outputText}<button
                class="reset"
                aria-label="Clear Output selection"
                title="Clear selection to use page actions"
                onclick={(event) => {
                  clearOutput()
                  focusAfterSelection("Output", event)
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
                grid={(event) => void toggleView("Output", event)}
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
          {:else}
            {#if output.pages.length}
              <Grid
                pane="Output"
                active={() => shortcutPane() === "Output"}
                compact={outputCompact}
                count={output.pages.length}
                bind:position={output.position}
                bind:offset={outputOffset}
                bind:keyboard={usingKeyboard}
                selected={(position) => selectedIds.has(output.pages[position]?.id)}
                toggle={(position) => selectOutput(output.pages[position].id, false)}
                edit={(action) => !!(action === "remove" ? remove() : duplicate())}
              >
                {#snippet children(from, to)}
                  {#each output.pages.slice(from, to) as page, offset (page.id)}
                    {@const index = from + offset}
                    {@const origin = provenance(page.content)}
                    {@const place = transfer.preview?.positions.get(index)}
                    <li
                      id={`${key}-${page.id}`}
                      data-adding={pendingAddition.has(page.id) || undefined}
                      inert={pendingAddition.has(page.id)}
                      class={["composition-card", { selected: selectedIds.has(page.id) }]}
                      class:range-highlight={highlight?.kind === "output" && highlight.ids.includes(page.id)}
                      out:removal|global={page.id}
                      onoutrostart={(event) => {
                        if (removing.has(page.id)) {
                          event.currentTarget.inert = true
                          event.currentTarget.setAttribute("aria-hidden", "true")
                          event.currentTarget.classList.add("removing")
                        }
                      }}
                      onoutroend={(event) => {
                        const grid = event.currentTarget.parentElement
                        if (grid && removing.has(page.id) && !cancelMove) cancelMove = animateOrder(grid, 350)
                      }}
                      data-face={index % 2 === 0 ? "front" : "back"}
                      data-dragging={transfer.value?.kind === "output" && transfer.value.ids.includes(page.id)
                        ? true
                        : undefined}
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
                      <div class="page-label">{@render outputGridHeading(page, index)}</div>
                      <button
                        class="page-image"
                        data-page={index}
                        aria-label={`Select Output page ${index + 1}`}
                        aria-pressed={selectedIds.has(page.id)}
                        title="Select pages to edit Output."
                        aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Space Enter Plus - Delete"
                        draggable="true"
                        onmousedown={retainFocus}
                        onclick={(event) => {
                          output.position = index
                          if (touchPage("Output", event)) return
                          if (event.ctrlKey || event.metaKey) {
                            void toggleView("Output", event)
                            return
                          }
                          if (event.detail <= 1) selectOutput(page.id, event.shiftKey)
                          if (event.detail) event.currentTarget.focus({ preventScroll: true })
                        }}
                        ondragstart={(event) => start(event, { kind: "output", ids: [page.id] })}
                        ondragend={() => transfer.end()}
                      >
                        {#if origin && "page" in page.content}<Pdf
                            {...origin.preview.appearance(page.content.page)}
                            pageNumber={page.content.page + 1}
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

                      {@render occurrenceActions(page, index, !chosen.length)}
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
