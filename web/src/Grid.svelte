<!-- Windows scrollable Grid rows and owns keyboard navigation and viewport geometry. -->

<script module lang="ts">
  type CachedFit = {
    key: string
    viewportKey: string
    gutter: string
    columnGap: string
    styleWidth: string
    styleColumns: string
    stylePadding: string
  }
  export type Viewport = {
    scroll: number
    columns?: number
    rows?: number
    height?: number
    gap?: number
    stride?: number
    fit?: CachedFit
  }
  function setProperty(target: HTMLElement | null, name: string, value: string) {
    if (!target) return
    if (value) {
      if (target.style.getPropertyValue(name) !== value) target.style.setProperty(name, value)
    } else if (target.style.getPropertyValue(name)) target.style.removeProperty(name)
  }
</script>

<script lang="ts">
  import { flushSync, tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { syncCollectionScroll } from "./viewport.ts"
  import { fields, shortcut, shortcutContext } from "./keyboard.ts"
  import { fit } from "./fit.ts"
  import { flash, Folds } from "./motion.ts"
  import { gridSections, Sections } from "./sections.ts"
  import type { Section } from "./sections.ts"

  let {
    pane,
    active,
    viewport: saved = { scroll: 0 },
    sections: policy,
    projecting = false,
    onfold,
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
    sections: Sections
    projecting?: boolean
    onfold: (folds: ReadonlySet<string>) => void
    position?: number
    offset?: number
    keyboard?: boolean
    selected: (position: number) => boolean
    toggle: (position: number) => void
    edit: (action: "add" | "duplicate" | "remove", position?: number, sectionEnd?: number) => boolean
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
  let rows = $state(untrack(() => saved.rows ?? 2))
  let height = $state(untrack(() => saved.height ?? 240))
  let gap = $state(untrack(() => saved.gap ?? 12))
  let scroll = $state(untrack(() => saved.scroll))
  let list: HTMLElement | undefined
  const folded = $derived(policy.folded)
  const tree = $derived(policy.tree)
  const count = $derived(policy.count)
  const sections = $derived(policy.visible)
  const pages = $derived(sections.pages)
  const ranks = $derived(new Map(pages.map((page, rank) => [page, rank])))
  const transition = new Folds(
    () => tree,
    (next) => onfold(next),
  )
  $effect(() => {
    if (tree.nodes.size) return () => transition.cancel()
  })
  function changeFolds(next: Set<string>) {
    const previous = new Set(pages)
    const nextSections = gridSections(tree, count, next)
    const remaining = new Set(nextSections.pages)
    const headings = [...nextSections.headings.values()]
    transition.cancel()

    const origins = [...sections.headings.values()].map((section) => {
      const heading = list
        ?.querySelector<HTMLElement>(`.page-image[data-page="${section.start}"]`)
        ?.closest<HTMLElement>(".composition-card")
      return { section, heading, bounds: heading?.getBoundingClientRect() ?? null }
    })

    const departing = [...(list?.querySelectorAll<HTMLElement>(".composition-card") ?? [])].flatMap((card) => {
      const page = Number(card.querySelector<HTMLElement>(".page-image[data-page]")?.dataset.page)
      if (!Number.isFinite(page) || remaining.has(page)) return []
      const section = headings.findLast((entry) => entry.start <= page && page < entry.end)
      const heading = section
        ? (list
            ?.querySelector<HTMLElement>(`.page-image[data-page="${section.start}"]`)
            ?.closest<HTMLElement>(".composition-card") ?? null)
        : null
      return [{ element: card, heading }]
    })
    transition.fold(list, next, departing, () =>
      [...(list?.querySelectorAll<HTMLElement>(".composition-card") ?? [])].flatMap((element) => {
        const page = Number(element.querySelector<HTMLElement>(".page-image[data-page]")?.dataset.page)
        if (!Number.isFinite(page) || previous.has(page)) return []
        const origin = origins.findLast(({ section, bounds }) => bounds && section.start <= page && page < section.end)
        return [{ element, heading: origin?.bounds ?? null }]
      }),
    )
  }
  export function toggleSections() {
    changeFolds((transition.pending ? new Sections(tree, count, transition.pending) : policy).toggle())
  }
  function fold(key: string) {
    changeFolds(new Sections(tree, count, transition.pending ?? folded).fold(key))
  }
  function expand(index: number) {
    const current = transition.pending ?? folded
    const next = new Sections(tree, count, current).expand(index)
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
    const target =
      top < list.scrollTop
        ? top
        : bottom > list.scrollTop + list.clientHeight
          ? bottom - list.clientHeight
          : list.scrollTop
    // Commit virtual padding before scrolling; WebKit clamps during DOM replacement.
    flushSync(() => {
      scroll = target
      saved.scroll = target
    })
    list.scrollTop = scroll
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
  export function paths(page: number, ancestors: readonly string[]) {
    return policy.paths(page, ancestors)
  }
  export async function revealSection(id: number) {
    const section = tree.nodes.get(id)
    if (!section) return
    await revealPage(section.start)
    const image = list?.querySelector<HTMLElement>(`.page-image[data-page="${section.start}"]`)
    image?.focus({ preventScroll: true })
    const card = image?.closest<HTMLElement>(".composition-card")
    if (card) flash(card)
  }
  function scrolling(element: HTMLElement) {
    syncCollectionScroll(
      element,
      ".composition-card",
      (top) => {
        scroll = top
        saved.scroll = top
      },
      () => element.querySelector<HTMLElement>(".composition-grid"),
    )
  }

  function measure(element: HTMLDivElement) {
    const grid = element.querySelector<HTMLElement>(".composition-grid")!
    list = element
    const content = element.parentElement
    const owner = element.closest<HTMLElement>(".selection-panel, .composition-output")!
    let frame = 0
    let disposed = false
    let forced = false
    let hasMeasured = false
    let measuredKey = ""
    let previousColumns = untrack(() => saved.columns ?? columns)
    let previousStride = untrack(() => saved.stride ?? stride)
    let lastViewport = untrack(() => saved)
    const resize = (force = false) => {
      if (disposed || !grid.isConnected || !grid.querySelector(".composition-card")) return
      const currentScroll = element.scrollTop
      const offsetWidth = element.offsetWidth
      const clientWidth = element.clientWidth
      const clientHeight = element.clientHeight
      if (!clientHeight) return
      const fontSize = getComputedStyle(document.documentElement).fontSize
      const viewportKey = `${innerWidth}:${innerHeight}:${devicePixelRatio}`
      const key = `${offsetWidth}:${clientWidth}:${clientHeight}:${viewportKey}:${fontSize}`
      if (!force && hasMeasured && measuredKey === key) return
      // Preserve the visible page when a responsive layout changes columns.
      const anchor = Math.floor(currentScroll / previousStride) * previousColumns
      const gutter = `${offsetWidth - clientWidth}px`
      let nextColumns: number
      let nextHeight: number
      let nextGap: number
      let nextRows: number
      let columnGap: string
      let styleWidth: string
      let styleColumns: string
      let stylePadding: string
      if (!force && saved.fit?.key === key && saved.columns && saved.rows && saved.height && saved.gap !== undefined) {
        setProperty(element, "--grid-gutter", saved.fit.gutter)
        setProperty(content, "--grid-gutter", saved.fit.gutter)
        setProperty(grid, "--grid-width", saved.fit.styleWidth)
        setProperty(grid, "--grid-fit-columns", saved.fit.styleColumns)
        setProperty(grid, "--thumbnail-padding", saved.fit.stylePadding)
        setProperty(owner, "--grid-column-gap", saved.fit.columnGap)
        nextColumns = saved.columns
        nextHeight = saved.height
        nextGap = saved.gap
        nextRows = saved.rows
        columnGap = saved.fit.columnGap
        styleWidth = saved.fit.styleWidth
        styleColumns = saved.fit.styleColumns
        stylePadding = saved.fit.stylePadding
      } else {
        // Expand into the gutter before measuring responsive columns.
        setProperty(element, "--grid-gutter", gutter)
        setProperty(content, "--grid-gutter", gutter)
        const fitted = fit(grid)
        let cardWidth: number
        let gridWidth: number
        if (fitted) {
          nextColumns = fitted.columns
          nextHeight = fitted.cardHeight
          nextGap = fitted.rowGap
          cardWidth = fitted.cardWidth
          gridWidth = fitted.gridWidth
          styleWidth = fitted.styleWidth
          styleColumns = fitted.styleColumns
          stylePadding = fitted.stylePadding
        } else {
          const style = getComputedStyle(grid)
          nextColumns = Math.max(1, style.gridTemplateColumns.split(" ").length)
          nextHeight = parseFloat(style.gridAutoRows)
          nextGap = parseFloat(style.rowGap) || 0
          cardWidth = parseFloat(style.gridTemplateColumns)
          gridWidth = grid.getBoundingClientRect().width
          styleWidth = grid.style.getPropertyValue("--grid-width")
          styleColumns = grid.style.getPropertyValue("--grid-fit-columns")
          stylePadding = grid.style.getPropertyValue("--thumbnail-padding")
        }
        if (!nextHeight) return
        nextRows = Math.max(1, Math.ceil(clientHeight / (nextHeight + nextGap)))
        const outset = (gridWidth - nextColumns * cardWidth) / (nextColumns + 1)
        columnGap = `${Math.max(0, outset)}px`
        setProperty(owner, "--grid-column-gap", columnGap)
      }
      columns = nextColumns
      height = nextHeight
      gap = nextGap
      rows = nextRows
      const nextStride = nextHeight + nextGap
      const changed = nextColumns !== previousColumns || nextStride !== previousStride
      const nextScroll = changed ? Math.floor(anchor / nextColumns) * nextStride : currentScroll
      previousColumns = nextColumns
      previousStride = nextStride
      hasMeasured = true
      measuredKey = key
      scroll = nextScroll
      saved.scroll = nextScroll
      saved.columns = nextColumns
      saved.rows = nextRows
      saved.height = nextHeight
      saved.gap = nextGap
      saved.stride = nextStride
      saved.fit = { key, viewportKey, gutter, columnGap, styleWidth, styleColumns, stylePadding }
      if (changed)
        void tick().then(() => {
          if (disposed) return
          // Apply the anchor after Svelte updates the virtual spacer heights.
          element.scrollTop = nextScroll
          scroll = element.scrollTop
          saved.scroll = scroll
        })
    }
    const schedule = (force = false) => {
      if (force) forced = true
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const nextForce = forced
        forced = false
        resize(nextForce)
      })
    }
    const onResize = () => schedule(true)
    const observer = new ResizeObserver(() => schedule(false))
    observer.observe(element)
    window.addEventListener("resize", onResize)
    untrack(() => {
      const viewportKey = `${innerWidth}:${innerHeight}:${devicePixelRatio}`
      if (saved.fit) {
        setProperty(element, "--grid-gutter", saved.fit.gutter)
        setProperty(content, "--grid-gutter", saved.fit.gutter)
        setProperty(grid, "--grid-width", saved.fit.styleWidth)
        setProperty(grid, "--grid-fit-columns", saved.fit.styleColumns)
        setProperty(grid, "--thumbnail-padding", saved.fit.stylePadding)
        setProperty(owner, "--grid-column-gap", saved.fit.columnGap)
      }
      if (scroll > 0) element.scrollTop = scroll
      if (
        saved.fit?.viewportKey === viewportKey &&
        saved.columns &&
        saved.rows &&
        saved.height &&
        saved.gap !== undefined
      ) {
        hasMeasured = true
        measuredKey = saved.fit.key
      } else {
        resize()
      }
    })
    // Re-measure after the first page mounts and after the document size changes.
    $effect(() => {
      if (pages.length && !hasMeasured) schedule(false)
    })
    // External Go-to-page and view-return requests retain the old anchor binding.
    let lastOffset = untrack(() => offset)
    $effect(() => {
      const viewport = saved
      if (viewport === lastViewport) return
      lastViewport = viewport
      untrack(() => {
        scroll = viewport.scroll
        lastOffset = offset
        previousColumns = viewport.columns ?? columns
        previousStride = viewport.stride ?? stride
        if (element.scrollTop !== viewport.scroll) element.scrollTop = viewport.scroll
        schedule(false)
      })
    })
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
      window.removeEventListener("resize", onResize)
      observer.disconnect()
      if (content?.style.getPropertyValue("--grid-gutter")) content.style.removeProperty("--grid-gutter")
    }
  }

  function gridKeys(element: HTMLElement) {
    const view = element.parentElement!
    element.tabIndex = -1
    element.setAttribute(
      "aria-keyshortcuts",
      `ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight PageUp PageDown Home End N P V Control+A Meta+A Space Enter Plus${pane === "Output" ? " - Delete Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight" : ""}`,
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
      if (event.detail) pointerSelection = selected(page) ? rankOf(page) : undefined
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
      const paging = ["pageup", "pagedown", "home", "end"].includes(key)
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
        const page =
          event.target instanceof HTMLElement && event.target.matches(".page-image")
            ? Number(event.target.dataset.page)
            : undefined
        if (edit(action, page, page === undefined ? undefined : sections.headings.get(page)?.end)) keyboard = true
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
        event.target === element || !(event.target instanceof Node && view.contains(event.target))
          ? boundary
            ? boundary < 0
              ? 0
              : pages.length
            : rankOf(position)
          : rankOf(index)
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
      const stepColumns = columns
      const step =
        action === "left" || action === "previous"
          ? -1
          : action === "right" || action === "next"
            ? 1
            : action === "up"
              ? -stepColumns
              : stepColumns
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
    start={pane === "Output" ? (pages[from] ?? 0) + 1 : undefined}
    data-from={from}
    data-projection={pane === "Output" && projecting
      ? JSON.stringify({ pages: pages.slice(from, to), ends: Object.fromEntries(sections.ends) })
      : undefined}
    style:padding-block-start={`${firstRow * stride}px`}
    style:padding-block-end={`${bottomRows * stride}px`}
    {@attach gridKeys}
  >
    {@render children(pages.slice(from, to), sections.headings, fold, folded)}
  </svelte:element>
</div>
