<!-- Windows page rows and section disclosures, and owns List scrolling and keyboard navigation. -->

<script module lang="ts">
  type Measurements = { revision: unknown; width: number; sizes: ReadonlyMap<number, number> }
  export type Viewport = {
    scroll: number
    viewport?: number
    width?: number
    gutter?: string
    measured?: Measurements
    position?: number
    offset?: number
  }
  function setProperty(target: HTMLElement | null, name: string, value: string) {
    if (target && target.style.getPropertyValue(name) !== value) target.style.setProperty(name, value)
  }
  function measurableRow(row: Element): row is HTMLElement {
    if (!(row instanceof HTMLElement)) return false
    if (row.classList.contains("list-row"))
      return !row.classList.contains("removing") && row.dataset.drop === undefined && row.dataset.dragging === undefined
    if (row.classList.contains("list-section")) return !row.querySelector(":scope > .list-drop-preview")
    return false
  }
</script>

<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import type { TransitionConfig } from "svelte/transition"
  import { syncCollectionScroll } from "./viewport.ts"
  import { shortcut, shortcutContext } from "./keyboard.ts"
  import { gridSections, Sections } from "./sections.ts"
  import { flash, Folds } from "./motion.ts"

  let {
    pane,
    active,
    viewport: saved = { scroll: 0 },
    sections: policy,
    labeled = false,
    revision,
    identity,
    rowId,
    pending,
    removal = () => ({ duration: 0 }),
    section,
    selected,
    sectionDrop,
    dropHeight,
    onfold,
    skipped,
    retained,
    position = $bindable(0),
    select,
    edit,
    children,
  }: {
    pane: "Input" | "Output"
    active: () => boolean
    viewport?: Viewport
    sections: Sections
    labeled?: boolean
    revision?: unknown
    identity?: (position: number) => string
    rowId?: (position: number) => string
    pending?: ReadonlySet<string>
    removal?: (node: HTMLElement) => TransitionConfig
    section?: Snippet<
      [
        start: number,
        end: number,
        path: readonly string[],
        expanded: boolean,
        toggle: () => void,
        id: number,
        drop?: "before" | "after",
      ]
    >
    selected?: (first: number, end: number) => boolean
    sectionDrop?: (start: number, end: number, expanded: boolean) => "before" | "after" | undefined
    dropHeight?: number
    onfold: (folds: ReadonlySet<string>) => void
    skipped?: ReadonlySet<number>
    retained?: number
    position?: number
    select: (position: number, range: boolean, anchor?: number, sectionEnd?: number) => void
    edit: (action: "add" | "duplicate" | "remove", position: number, sectionEnd?: number) => boolean
    children: Snippet<[index: number, retained?: number]>
  } = $props()
  let viewport = $state(
    untrack(() => saved.viewport ?? (typeof innerHeight === "number" ? Math.min(innerHeight, 900) : 600)),
  )
  let scroll = $state(untrack(() => saved.scroll))
  let dragged = $state<number>()
  let seeking = $state<number>()
  let settling = Promise.resolve()
  let list: HTMLUListElement | undefined
  const rowHeight = 44
  let measured = $state.raw<Measurements | undefined>(untrack(() => saved.measured))
  let width = $state(untrack(() => saved.width ?? 0))
  const collapsed = $derived(policy.folded)
  let outlined = $state<string>()
  const sections = $derived(policy.tree)
  const count = $derived(policy.count)
  const transition = new Folds(
    () => sections,
    (next) => onfold(next),
  )
  $effect(() => {
    if (sections.nodes.size) return () => transition.cancel()
  })
  function changeFolds(next: Set<string>, highlighted?: string) {
    const previous = new Set(order)
    const remaining = new Set(
      visibleRows(gridSections(sections, count, next)).filter((index) => index < 0 || !skipped?.has(index)),
    )
    const nodes = [...sections.nodes.values()]
    const parent = (index: number, visible: ReadonlySet<number>) => {
      let ancestor =
        index < 0
          ? sections.nodes.get(-index - 1)
          : nodes.findLast((entry) => entry.start <= index && index < entry.end)
      while (ancestor && !visible.has(-ancestor.id - 1)) ancestor = ancestor.parent
      return ancestor
    }
    const sectionRow = (id: number) => list?.querySelector<HTMLElement>(`.list-section[data-section="${id}"]`) ?? null
    transition.cancel()

    const origins = new Map<number, DOMRectReadOnly>()
    for (const row of list?.querySelectorAll<HTMLElement>(":scope > .list-section") ?? []) {
      const id = Number(row.dataset.section)
      origins.set(id, row.getBoundingClientRect())
    }

    const departing = [
      ...(list?.querySelectorAll<HTMLElement>(":scope > .list-row, :scope > .list-section") ?? []),
    ].flatMap((row) => {
      const index = row.matches(".list-section")
        ? -Number(row.dataset.section) - 1
        : Number(row.querySelector<HTMLElement>("[data-page]")?.dataset.page)
      if (!Number.isFinite(index) || remaining.has(index)) return []
      const ancestor = parent(index, remaining)
      return [{ element: row, heading: ancestor ? sectionRow(ancestor.id) : null }]
    })
    transition.fold(
      list,
      next,
      departing,
      () =>
        [...(list?.querySelectorAll<HTMLElement>(":scope > .list-row, :scope > .list-section") ?? [])].flatMap(
          (row) => {
            const index = row.matches(".list-section")
              ? -Number(row.dataset.section) - 1
              : Number(row.querySelector<HTMLElement>("[data-page]")?.dataset.page)
            if (!Number.isFinite(index) || previous.has(index)) return []
            const ancestor = parent(index, previous)
            return [{ element: row, heading: ancestor ? (origins.get(ancestor.id) ?? null) : null }]
          },
        ),
      () => {
        outlined = highlighted && !next.has(highlighted) ? highlighted : undefined
      },
    )
  }
  export function toggleSections() {
    changeFolds((transition.pending ? new Sections(sections, count, transition.pending) : policy).toggle())
  }
  export function expand(index: number) {
    const current = transition.pending ?? collapsed
    const next = new Sections(sections, count, current).expand(index)
    if (next.size !== current.size) changeFolds(next)
  }
  export async function revealSection(id: number) {
    const target = sections.nodes.get(id)
    if (!target || !list) return
    const next = new Set(collapsed)
    for (let parent = target.parent; parent; parent = parent.parent) next.delete(parent.key)
    if (next.size !== collapsed.size) changeFolds(next)
    const visible = (next.size === collapsed.size ? policy.visible : gridSections(sections, count, next)).headings.get(
      target.start,
    )
    const heading = await seek(visible ? -visible.id - 1 : target.start, `[data-page="${target.start}"]`)
    heading?.focus({ preventScroll: true })
    const row = heading?.closest<HTMLElement>("li")
    if (row) flash(row)
  }
  export async function revealPage(index: number) {
    expand(index)
    await seek(index, `[data-page="${index}"]`)
  }
  async function seek(index: number, selector: string) {
    await tick()
    seeking = index
    await tick()
    const rank = ranks.get(index)
    let control: HTMLElement | undefined
    if (rank !== undefined && list) {
      list.scrollTop = offsets[rank]
      scroll = list.scrollTop
      await tick()
      if (!list) {
        seeking = undefined
        return
      }
      control = list.querySelector<HTMLElement>(selector) ?? undefined
      control?.scrollIntoView({ block: "nearest" })
      scroll = list.scrollTop
    }
    seeking = undefined
    return control
  }

  export function paths(page: number, ancestors: readonly string[]) {
    return policy.paths(page, ancestors)
  }
  function visibleRows(visible: Sections["visible"]) {
    return visible.pages.map((page) => {
      const heading = visible.headings.get(page)
      return heading ? -heading.id - 1 : page
    })
  }
  const sequence = $derived(visibleRows(policy.visible))
  const order = $derived(sequence.filter((index) => index < 0 || !skipped?.has(index)))
  const pages = $derived(order.map((index) => (index < 0 ? sections.nodes.get(-index - 1)!.start : index)))
  function rowRanks(rows: readonly number[]) {
    const result = new Map<number, number>()
    rows.forEach((index, rank) => {
      result.set(index, rank)
      if (index < 0) result.set(sections.nodes.get(-index - 1)!.start, rank)
    })
    return result
  }
  const sequenceRanks = $derived(rowRanks(sequence))
  const ranks = $derived(rowRanks(order))
  const offsets = $derived.by(() => {
    const sizes = measured?.revision === revision && measured?.width === width ? measured.sizes : undefined
    const result = new Float64Array(order.length + 1)
    for (let rank = 0; rank < order.length; rank++)
      result[rank + 1] = result[rank] + (sizes?.get(order[rank]) ?? rowHeight)
    return result
  })
  function locate(offset: number) {
    let first = 0,
      last = order.length
    while (first < last) {
      const middle = Math.floor((first + last) / 2)
      if (offsets[middle + 1] <= offset) first = middle + 1
      else last = middle
    }
    return first
  }
  const start = $derived(
    seeking !== undefined ? Math.max(0, (offsets[(ranks.get(seeking) ?? 0) + 1] ?? 0) - viewport) : scroll,
  )
  const from = $derived(Math.max(0, Math.min(Math.max(0, order.length - 1), locate(start) - 8)))
  const to = $derived(Math.min(order.length, Math.max(from + 1, locate(start + viewport) + 9)))

  const retainedIndex = $derived(dragged !== undefined && dragged < 0 ? dragged : (retained ?? dragged))
  const pin = $derived(
    retainedIndex !== undefined && sequenceRanks.has(retainedIndex) && !order.slice(from, to).includes(retainedIndex)
      ? retainedIndex
      : undefined,
  )
  const rows = $derived.by(() => {
    const window = order.slice(from, to)
    if (pin !== undefined) window.push(pin)
    return window.toSorted((a, b) => sequenceRanks.get(a)! - sequenceRanks.get(b)!)
  })
  export function remember() {
    if (!list) return
    const row = list.querySelector<HTMLElement>(`[data-page="${position}"]`)?.closest("li")
    saved.position = row ? position : undefined
    saved.offset = row ? row.getBoundingClientRect().top - list.getBoundingClientRect().top : undefined
  }
  function scrolling(element: HTMLElement) {
    syncCollectionScroll(element, ".list-row, .list-section", (top) => {
      scroll = top
    })
  }

  function reveal(element: HTMLElement) {
    list = element as HTMLUListElement
    const content = element.parentElement
    window.addEventListener("keydown", keys)
    let disposed = false
    let frame = 0
    let following = false
    let followedRevision: unknown
    const observed = new Set<Element>()
    const measure = (candidates?: Iterable<Element>) => {
      if (disposed) return
      let nextViewport = viewport
      let nextWidth = width
      let gutter: string | undefined
      if (!candidates) {
        nextViewport = element.clientHeight
        nextWidth = element.clientWidth
        gutter = `${element.offsetWidth - nextWidth}px`
      }
      const previous = measured?.revision === revision && measured?.width === nextWidth ? measured.sizes : undefined
      let sizes: Map<number, number> | undefined
      const targets = candidates ?? element.children
      for (const row of targets) {
        if (!measurableRow(row)) continue
        const index = row.classList.contains("list-section")
          ? -Number(row.dataset.section) - 1
          : Number(row.querySelector<HTMLElement>("[data-page]")?.dataset.page)
        const rowHeightNow = row.offsetHeight
        if (!Number.isFinite(index) || !rowHeightNow || (sizes ?? previous)?.get(index) === rowHeightNow) continue
        sizes ??= new Map(previous)
        sizes.set(index, rowHeightNow)
      }
      if (gutter !== undefined) {
        viewport = nextViewport
        width = nextWidth
        saved.gutter = gutter
        setProperty(element, "--list-gutter", gutter)
        setProperty(content, "--list-gutter", gutter)
      }
      if (sizes) measured = { revision, width: nextWidth, sizes }
    }
    let resizedContainer = false
    const resizedRows = new Set<Element>()
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === element) resizedContainer = true
        else resizedRows.add(entry.target)
      }
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const container = resizedContainer
        const targets = container ? undefined : [...resizedRows]
        resizedContainer = false
        resizedRows.clear()
        measure(targets)
      })
    })
    observer.observe(element)
    untrack(() => {
      if (saved.gutter) {
        setProperty(element, "--list-gutter", saved.gutter)
        setProperty(content, "--list-gutter", saved.gutter)
      } else if (element.clientHeight) {
        const nextWidth = element.clientWidth
        const gutter = `${element.offsetWidth - nextWidth}px`
        viewport = element.clientHeight
        width = nextWidth
        saved.gutter = gutter
        setProperty(element, "--list-gutter", gutter)
        setProperty(content, "--list-gutter", gutter)
      }
      if (scroll > 0) element.scrollTop = scroll
    })
    $effect(() => {
      void rows
      void tick().then(() => {
        if (disposed) return
        const current = new Set<Element>()
        for (const child of element.children)
          if (child.classList.contains("list-row") || child.classList.contains("list-section")) current.add(child)
        for (const row of observed) {
          if (!current.has(row)) {
            observer.unobserve(row)
            observed.delete(row)
          }
        }
        for (const row of current) {
          if (!observed.has(row)) {
            observer.observe(row)
            observed.add(row)
          }
        }
      })
    })
    $effect(() => {
      const index = position
      untrack(() => {
        const initial = !following
        const offset = initial && saved.position === index ? saved.offset : undefined
        if (following && followedRevision === revision && !ranks.has(index)) expand(index)
        following = true
        followedRevision = revision
        const rank = ranks.get(index)
        if (rank === undefined) return
        const top = offsets[rank]
        const bottom = offsets[rank + 1]
        const currentTop = initial ? scroll : element.scrollTop
        const currentHeight = viewport || element.clientHeight
        const outOfView = top < currentTop || bottom > currentTop + currentHeight
        seeking = outOfView ? index : undefined
        if (outOfView) {
          if (top < currentTop) element.scrollTop = top
          else element.scrollTop = bottom - currentHeight
          scroll = element.scrollTop
        } else {
          scroll = currentTop
        }
        if (!outOfView && offset === undefined) {
          settling = Promise.resolve()
          return
        }
        settling = tick().then(async () => {
          if (disposed) return
          if (outOfView) measure()
          await tick()
          if (!disposed && position === index) {
            const row = element.querySelector<HTMLElement>(`[data-page="${position}"]`)?.closest("li")
            if (row && offset !== undefined)
              element.scrollTop += row.getBoundingClientRect().top - element.getBoundingClientRect().top - offset
            row?.scrollIntoView({ block: "nearest" })
            scroll = element.scrollTop
            seeking = undefined
            await tick()
          }
        })
      })
    })
    return () => {
      // A detached list can already report a zero DOM scroll offset here.
      saved.scroll = untrack(() => scroll)
      saved.viewport = untrack(() => viewport)
      saved.width = untrack(() => width)
      saved.measured = untrack(() => measured)
      list = undefined
      if (content?.style.getPropertyValue("--list-gutter")) content.style.removeProperty("--list-gutter")
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      observed.clear()
      window.removeEventListener("keydown", keys)
    }
  }
  async function keys(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement)) return
    const local = list?.contains(event.target)
    if (
      !(local && event.target.matches(".list-choice, .list-heading, .page-list")) &&
      !(
        ["PageUp", "PageDown"].includes(event.key) &&
        active() &&
        !event.target.closest(".page-list, input, textarea, select, [contenteditable]")
      )
    )
      return
    const action = shortcut(event, shortcutContext(event, { pane, view: "list" }), "list")
    if (action === "suppress") {
      event.preventDefault()
      return
    }
    if (!action || !pages.length) return
    const element = list!
    const focused = event.target.dataset.page
    const index = Math.max(0, pages.indexOf(focused === undefined ? position : Number(focused)))
    position = pages[index]
    if (action === "add" || action === "duplicate" || action === "remove") {
      event.preventDefault()
      if (!event.repeat) {
        const row = order[index]
        const focusedSection =
          event.target.matches(".list-heading") && row < 0 ? sections.nodes.get(-row - 1) : undefined
        edit(action, position, focusedSection?.end)
      }
      return
    }
    if (
      ![
        "copy",
        "left",
        "right",
        "up",
        "down",
        "first",
        "last",
        "previous",
        "next",
        "viewportPrevious",
        "viewportNext",
      ].includes(action)
    )
      return
    event.preventDefault()
    if (action === "copy" && event.repeat) return
    if (action === "copy") {
      const row = order[index]
      const foldedSection = row < 0 ? sections.nodes.get(-row - 1) : undefined
      select(
        position,
        false,
        undefined,
        foldedSection && collapsed.has(foldedSection.key) ? foldedSection.end : undefined,
      )
    }
    const row = element.querySelector<HTMLElement>(`[data-page="${position}"]`)?.closest("li"),
      stepRows = Math.max(1, Math.floor(element.clientHeight / (row?.getBoundingClientRect().height || 44)))
    const next =
      action === "first"
        ? 0
        : action === "last"
          ? pages.length - 1
          : Math.max(
              0,
              Math.min(
                pages.length - 1,
                index +
                  (action === "viewportPrevious"
                    ? -stepRows
                    : action === "viewportNext"
                      ? stepRows
                      : ["left", "up", "previous"].includes(action)
                        ? -1
                        : 1),
              ),
            )
    const anchor = position
    position = pages[next]
    if (event.shiftKey && !["next", "previous"].includes(action)) select(position, true, anchor)
    const target = position
    await tick()
    await settling
    if (position === target) element.querySelector<HTMLElement>(`[data-page="${position}"]`)?.focus()
  }
</script>

<svelte:window ondragend={() => (dragged = undefined)} />

<ul
  class="page-list"
  class:labeled
  aria-label={`${pane} page list`}
  aria-keyshortcuts={`ArrowUp ArrowDown Home End PageUp PageDown N P Space Enter V Control+A Meta+A Shift+ArrowUp Shift+ArrowDown Plus${pane === "Output" ? " - Delete Control+ArrowUp Control+ArrowDown Meta+ArrowUp Meta+ArrowDown" : ""}`}
  tabindex="-1"
  onscroll={(event) => scrolling(event.currentTarget)}
  ondragstartcapture={(event) => {
    const row =
      event.target instanceof Element ? event.target.closest<HTMLElement>(".list-row, .list-section") : undefined
    const page = row?.matches(".list-section")
      ? -Number(row.dataset.section) - 1
      : Number(row?.querySelector<HTMLElement>("[data-page]")?.dataset.page)
    dragged = Number.isFinite(page) ? page : undefined
  }}
  {@attach reveal}
>
  <li class="list-spacer" aria-hidden="true" style:block-size={`${offsets[from]}px`}></li>
  {#each rows as index (index < 0 ? `section:${sections.nodes.get(-index - 1)!.key}` : (identity?.(index) ?? index))}
    {#if index < 0}
      {@const entry = sections.nodes.get(-index - 1)!}
      {@const expanded = !collapsed.has(entry.key)}
      {@const drop = sectionDrop?.(entry.start, entry.end, expanded)}
      <li
        id={rowId?.(entry.start)}
        data-adding={(identity && pending?.has(identity(entry.start))) || undefined}
        class="list-section"
        out:removal|global
        data-synthetic={entry.synthetic || undefined}
        title={entry.synthetic ? `Pages ${entry.start + 1}–${entry.end}` : undefined}
        aria-label={entry.synthetic ? `Pages ${entry.start + 1}–${entry.end}` : undefined}
        class:output-section={pane === "Output"}
        style:--section-depth={entry.path.length - 1}
        class:selected={collapsed.has(entry.key) && selected?.(entry.start, entry.end)}
        data-selected={selected?.(entry.start, entry.end) || undefined}
        data-section={-index - 1}
        data-emphasized={(outlined === entry.key && expanded) || undefined}
        data-index={entry.start}
        data-end={!expanded ? entry.end - 1 : undefined}
        data-section-end={entry.end}
        data-dragging={dragged === index || undefined}
        data-retained={index === pin || undefined}
        data-drop={drop}
        style:--drop-height={drop && dropHeight !== undefined ? `${dropHeight}px` : undefined}
      >
        {@render section?.(
          entry.start,
          entry.end,
          entry.path,
          expanded,
          () => {
            changeFolds(new Sections(sections, count, transition.pending ?? collapsed).fold(entry.key), entry.key)
          },
          entry.id,
          drop,
        )}
      </li>
    {:else}{@render children(index, pin)}{/if}
  {/each}
  <li class="list-spacer" aria-hidden="true" style:block-size={`${offsets[order.length] - offsets[to]}px`}></li>
</ul>
