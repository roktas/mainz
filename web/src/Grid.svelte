<!-- Windows scrollable Grid rows and owns keyboard navigation and viewport geometry. -->

<script module lang="ts">
  export type Viewport = { scroll: number; columns?: number; stride?: number }
</script>

<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { fields, shortcut, shortcutContext } from "./keyboard.ts"
  import { fit } from "./fit.ts"
  import { fadeFold, glowUnfold } from "./motion.ts"
  import { gridSections, sectionsOf } from "./sections.ts"
  import type { Section } from "./sections.ts"
  import type { SectionPath } from "./outline.ts"

  let {
    pane,
    active,
    viewport: saved = { scroll: 0 },
    count,
    headings,
    identity,
    folds = $bindable(),
    position = $bindable(0),
    offset = $bindable(0),
    keyboard = $bindable(false),
    selected,
    toggle,
    edit,
    children,
  }: {
    pane: "Input" | "Output"
    active: () => boolean
    viewport?: Viewport
    count: number
    headings?: (position: number) => readonly SectionPath[]
    identity?: (position: number) => string
    folds?: ReadonlySet<string>
    position?: number
    offset?: number
    keyboard?: boolean
    selected: (position: number) => boolean
    toggle: (position: number) => void
    edit: (action: "add" | "duplicate" | "remove") => boolean
    children: Snippet<
      [
        pages: readonly number[],
        headings: ReadonlyMap<number, Section>,
        fold: (key: string) => void,
        folded: ReadonlySet<string>,
      ]
    >
  } = $props()
  let columns = $state(untrack(() => saved.columns ?? 1))
  let rows = $state(2)
  let height = $state(240)
  let gap = $state(12)
  let scroll = $state(untrack(() => saved.scroll))
  let list: HTMLElement | undefined
  const empty = new Set<string>()
  const folded = $derived(folds ?? empty)
  const tree = $derived(sectionsOf(count, headings, identity))
  const sections = $derived(gridSections(tree, count, folded))
  const pages = $derived(sections.pages)
  const ranks = $derived(new Map(pages.map((page, rank) => [page, rank])))
  export function sectionState() {
    if (!tree.nodes.size) return "none"
    return [...sections.headings.values()].some((entry) => !folded.has(entry.key)) ? "open" : "closed"
  }
  let foldEpoch = 0
  let pendingFolds: Set<string> | undefined
  function changeFolds(next: Set<string>) {
    const epoch = ++foldEpoch
    pendingFolds = next
    const previous = new Set(pages)
    const remaining = new Set(gridSections(tree, count, next).pages)
    for (const animation of list?.getAnimations({ subtree: true }) ?? [])
      if (animation.id === "fold") animation.cancel()
    const departing = [...(list?.querySelectorAll<HTMLElement>(".composition-card") ?? [])].filter((card) => {
      const page = card.querySelector<HTMLElement>(".page-image[data-page]")
      return page && !remaining.has(Number(page.dataset.page))
    })
    const apply = () => {
      if (epoch !== foldEpoch) return
      pendingFolds = undefined
      folds = next
      void tick().then(() => {
        if (epoch !== foldEpoch || !list) return
        for (const page of pages) {
          if (previous.has(page)) continue
          glowUnfold(
            list
              .querySelector<HTMLElement>(`.page-image[data-page="${page}"]`)
              ?.closest<HTMLElement>(".composition-card") ?? null,
          )
        }
      })
    }
    const fade = fadeFold(departing)
    if (fade) void fade.then(apply)
    else apply()
  }
  export function toggleSections() {
    const current = pendingFolds ?? folded
    changeFolds(
      [...tree.nodes.values()].some((entry) => !current.has(entry.key))
        ? new Set([...tree.nodes.values()].map((entry) => entry.key))
        : new Set(),
    )
  }
  function fold(key: string) {
    const next = new Set(pendingFolds ?? folded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    changeFolds(next)
  }
  function expand(index: number) {
    const current = pendingFolds ?? folded
    const next = new Set(current)
    for (const entry of tree.nodes.values()) if (entry.start <= index && index < entry.end) next.delete(entry.key)
    if (next.size !== current.size) changeFolds(next)
  }
  function rankOf(index: number) {
    if (index < 0) return -1
    return (
      ranks.get(index) ??
      Math.max(
        0,
        pages.findLastIndex((page) => page <= index),
      )
    )
  }
  const stride = $derived(height + gap)
  const totalRows = $derived(Math.ceil(pages.length / columns))
  const firstRow = $derived(Math.max(0, Math.min(totalRows - 1, Math.floor(scroll / stride) - 2)))
  const from = $derived(firstRow * columns)
  const to = $derived(Math.min(pages.length, (firstRow + rows + 4) * columns))
  const bottomRows = $derived(Math.max(0, totalRows - Math.ceil(to / columns)))

  function revealIndex(index: number) {
    if (!list || !pages.length) return
    const top = Math.floor(rankOf(index) / columns) * stride
    const bottom = top + height
    if (top < list.scrollTop) list.scrollTop = top
    else if (bottom > list.scrollTop + list.clientHeight) list.scrollTop = bottom - list.clientHeight
    scroll = list.scrollTop
    saved.scroll = scroll
  }
  export async function revealPage(index: number) {
    expand(index)
    await tick()
    revealIndex(index)
    await tick()
    list?.querySelector<HTMLElement>(`.page-image[data-page="${index}"]`)?.scrollIntoView({ block: "nearest" })
    if (list) {
      scroll = list.scrollTop
      saved.scroll = scroll
    }
  }
  function scrolling(element: HTMLElement) {
    scroll = element.scrollTop
    saved.scroll = scroll
    const focused = document.activeElement?.closest<HTMLElement>(".composition-card")
    if (!focused || !element.contains(focused)) return
    const bounds = focused.getBoundingClientRect(),
      frame = element.getBoundingClientRect()
    if (bounds.bottom <= frame.top || bounds.top >= frame.bottom) element.focus({ preventScroll: true })
  }

  function measure(element: HTMLDivElement) {
    const grid = element.querySelector<HTMLElement>(".composition-grid")!
    list = element
    const owner = element.closest<HTMLElement>(".selection-panel, .composition-output")!
    let frame = 0
    let disposed = false
    let previousColumns = untrack(() => saved.columns ?? columns)
    let previousStride = untrack(() => saved.stride ?? stride)
    let lastViewport = untrack(() => saved)
    const resize = () => {
      if (disposed || !grid.isConnected || !grid.querySelector(".composition-card")) return
      // Preserve the visible page when a responsive layout changes columns.
      const anchor = Math.floor(element.scrollTop / previousStride) * previousColumns
      // Expand into the gutter before measuring responsive columns.
      owner.style.setProperty("--grid-gutter", `${element.offsetWidth - element.clientWidth}px`)
      fit(grid)
      const style = getComputedStyle(grid)
      const nextColumns = Math.max(1, style.gridTemplateColumns.split(" ").length)
      const nextHeight = parseFloat(style.gridAutoRows)
      const nextGap = parseFloat(style.rowGap) || 0
      if (!nextHeight || !element.clientHeight) return
      columns = nextColumns
      height = nextHeight
      gap = nextGap
      rows = Math.max(1, Math.ceil(element.clientHeight / (nextHeight + nextGap)))
      const bounds = grid.getBoundingClientRect()
      const outset = (bounds.width - nextColumns * parseFloat(style.gridTemplateColumns)) / (nextColumns + 1)
      owner.style.setProperty("--grid-column-gap", `${Math.max(0, outset)}px`)
      const nextStride = nextHeight + nextGap
      const changed = nextColumns !== previousColumns || nextStride !== previousStride
      const nextScroll = changed ? Math.floor(anchor / nextColumns) * nextStride : element.scrollTop
      previousColumns = nextColumns
      previousStride = nextStride
      scroll = nextScroll
      saved.scroll = nextScroll
      saved.columns = nextColumns
      saved.stride = nextStride
      if (changed)
        void tick().then(() => {
          if (disposed) return
          // Apply the anchor after Svelte updates the virtual spacer heights.
          element.scrollTop = nextScroll
          scroll = element.scrollTop
          saved.scroll = scroll
        })
    }
    const schedule = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(resize)
    }
    const observer = new ResizeObserver(schedule)
    observer.observe(element)
    window.addEventListener("resize", schedule)
    untrack(() => {
      element.scrollTop = scroll
      resize()
    })
    // Re-measure after the first page mounts and after the document size changes.
    $effect(() => {
      if (pages.length) schedule()
    })
    $effect(() => {
      const viewport = saved
      if (viewport === lastViewport) return
      lastViewport = viewport
      untrack(() => {
        scroll = viewport.scroll
        element.scrollTop = viewport.scroll
        schedule()
      })
    })
    // External Go-to-page and view-return requests retain the old anchor binding.
    let lastOffset = untrack(() => offset)
    $effect(() => {
      const requested = offset
      if (requested === lastOffset) return
      lastOffset = requested
      untrack(() => void revealPage(requested))
    })
    return () => {
      disposed = true
      list = undefined
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      observer.disconnect()
      owner.style.removeProperty("--grid-gutter")
    }
  }

  function gridKeys(element: HTMLElement) {
    const view = element.parentElement!
    element.tabIndex = -1
    element.setAttribute(
      "aria-keyshortcuts",
      `ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight PageUp PageDown Home End N P V Control+A Meta+A Space Enter${pane === "Output" ? " Plus - Delete Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight" : ""}`,
    )
    let advancing = false
    let boundary = 0
    let pointerSelection: number | undefined
    function reset() {
      pointerSelection = undefined
    }
    function leave(event: FocusEvent) {
      if (!advancing && !element.contains(event.relatedTarget as Node | null)) reset()
    }
    async function advance(next: number) {
      advancing = true
      await tick()
      if (!element.isConnected || !pages.length) {
        advancing = false
        return
      }
      boundary = next < 0 ? -1 : next >= pages.length ? 1 : 0
      const index = pages[Math.max(0, Math.min(next, pages.length - 1))]
      position = index
      revealIndex(index)
      await tick()
      if (element.isConnected) {
        if (boundary) {
          element.dataset.cursorBoundary = String(boundary)
          element.focus({ preventScroll: true })
        } else {
          delete element.dataset.cursorBoundary
          const image = element.querySelector<HTMLButtonElement>(`.page-image[data-page="${position}"]`)
          if (image?.closest("[inert]")) element.focus({ preventScroll: true })
          else image?.focus()
        }
      }
      advancing = false
    }
    async function click(event: MouseEvent) {
      if (event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return
      const control = event.target.closest<HTMLButtonElement>("button.page-image, button.page-grip:not(.grid-ribbon)")
      const image = control?.closest(".composition-card")?.querySelector<HTMLButtonElement>(".page-image")
      if (!image || !element.contains(image) || image.closest("[inert]")) return
      boundary = 0
      delete element.dataset.cursorBoundary
      const page = Number(image.dataset.page)
      await tick()
      if (event.detail) pointerSelection = selected(page) ? page : undefined
      else {
        keyboard = true
        reset()
        void advance(rankOf(page) + 1)
      }
    }
    function focus(event: FocusEvent) {
      if (advancing || !(event.target instanceof HTMLButtonElement) || !event.target.matches(".page-image")) return
      boundary = 0
      delete element.dataset.cursorBoundary
      reset()
    }
    function navigate(event: KeyboardEvent) {
      const key = event.key.toLowerCase()
      const paging = key === "pageup" || key === "pagedown"
      if (
        !(event.target instanceof Node && view.contains(event.target)) &&
        (!paging || !active() || (event.target instanceof Element && event.target.closest(`.grid-view, ${fields}`)))
      )
        return
      const context = shortcutContext(event, { pane, view: "grid" })
      const action = shortcut(event, context, "grid")
      if (action === "suppress") {
        event.preventDefault()
        return
      }
      if (!action) return
      const extending = event.shiftKey && (action === "left" || action === "right")
      if (
        (action === "add" || action === "duplicate" || action === "remove") &&
        (event.target === element || (event.target instanceof Element && event.target.matches(".page-image")))
      ) {
        event.preventDefault()
        if (context.repeat) return
        reset()
        if (edit(action)) keyboard = true
        return
      }
      if (action === "copy" && event.target === element) {
        event.preventDefault()
        return
      }
      if (action === "viewportPrevious" || action === "viewportNext") {
        event.preventDefault()
        const next = rankOf(position) + (action === "viewportPrevious" ? -columns * rows : columns * rows)
        if (next < 0 || next >= pages.length) return
        keyboard = true
        reset()
        void advance(next)
        return
      }
      if (!["extend", "left", "right", "up", "down", "first", "last", "next", "previous"].includes(action)) return
      const index =
        event.target instanceof HTMLButtonElement && event.target.matches(".page-image")
          ? Number(event.target.dataset.page)
          : -1
      let cursor =
        event.target === element ? (boundary ? (boundary < 0 ? 0 : pages.length) : rankOf(position)) : rankOf(index)
      if (cursor < 0) return
      if (action === "extend") {
        if (pointerSelection === cursor) {
          keyboard = true
          reset()
          void advance(cursor + 1)
        }
        return
      }
      if (action === "first" || action === "last") {
        event.preventDefault()
        keyboard = true
        reset()
        void advance(action === "first" ? 0 : pages.length - 1)
        return
      }
      // A key can arrive before the resize observer measures the new column count.
      const stride = columns
      const step =
        action === "left" || action === "previous"
          ? -1
          : action === "right" || action === "next"
            ? 1
            : action === "up"
              ? -stride
              : stride
      event.preventDefault()
      keyboard = true
      if (extending) {
        if (pointerSelection === cursor) cursor++
        reset()
        const page = step < 0 ? cursor - 1 : cursor
        if (page < 0 || page >= pages.length) return
        toggle(pages[page])
        void advance(step > 0 ? page + 1 : page === 0 ? -1 : page)
      } else {
        reset()
        if (boundary) {
          if (Math.sign(step) !== boundary) void advance(boundary < 0 ? 0 : pages.length - 1)
        } else void advance(cursor + step)
      }
    }
    window.addEventListener("keydown", navigate)
    element.addEventListener("pointerdown", reset)
    element.addEventListener("focusout", leave)
    element.addEventListener("focusin", focus)
    document.addEventListener("click", click)
    element.addEventListener("dblclick", reset)
    return () => {
      window.removeEventListener("keydown", navigate)
      element.removeEventListener("pointerdown", reset)
      element.removeEventListener("focusout", leave)
      element.removeEventListener("focusin", focus)
      document.removeEventListener("click", click)
      element.removeEventListener("dblclick", reset)
    }
  }
</script>

<div
  class="grid-view"
  data-columns={columns}
  data-rows={rows}
  onscroll={(event) => scrolling(event.currentTarget)}
  {@attach measure}
>
  <svelte:element
    this={pane === "Input" ? "ul" : "ol"}
    class={["composition-grid", pane === "Input" ? "source-catalog" : "output-pages"]}
    aria-label={pane === "Input" ? "Input pages" : "Output page order"}
    aria-setsize={count}
    start={pane === "Output" ? (pages[from] ?? 0) + 1 : undefined}
    data-from={from}
    style:padding-block-start={`${firstRow * stride}px`}
    style:padding-block-end={`${bottomRows * stride}px`}
    {@attach gridKeys}
  >
    {@render children(pages.slice(from, to), sections.headings, fold, folded)}
  </svelte:element>
</div>
