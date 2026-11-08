<!-- Windows page rows and section disclosures, and owns List scrolling and keyboard navigation. -->

<script module lang="ts">
  type Measurements = { revision: unknown; width: number; sizes: ReadonlyMap<number, number> }
  export type Viewport = { scroll: number; measured?: Measurements; position?: number; offset?: number }
</script>

<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { shortcut, shortcutContext } from "./keyboard.ts"
  import { sectionsOf, flattenSections } from "./sections.ts"
  import { flash } from "./motion.ts"
  import type { SectionPath } from "./outline.ts"

  let {
    pane,
    viewport: saved = { scroll: 0 },
    count,
    labeled = false,
    revision,
    headings,
    identity,
    section,
    selected,
    folds = $bindable(),
    skipped,
    retained,
    position = $bindable(0),
    select,
    edit,
    children,
  }: {
    pane: "Input" | "Output"
    viewport?: Viewport
    count: number
    labeled?: boolean
    revision?: unknown
    headings?: (position: number) => readonly SectionPath[]
    identity?: (position: number) => string
    section?: Snippet<
      [start: number, end: number, path: readonly string[], expanded: boolean, toggle: () => void, id: number]
    >
    selected?: (first: number, end: number) => boolean
    folds?: ReadonlySet<string>
    skipped?: ReadonlySet<number>
    retained?: number
    position?: number
    select: (position: number, range: boolean, anchor?: number) => void
    edit: (action: "add" | "duplicate" | "remove", position: number) => boolean
    children: Snippet<[index: number, retained?: number]>
  } = $props()
  let viewport = $state(0)
  let scroll = $state(untrack(() => saved.scroll))
  let dragged = $state<number>()
  let seeking = $state<number>()
  let settling = Promise.resolve()
  let list: HTMLUListElement | undefined
  const rowHeight = 44
  let measured = $state.raw<Measurements | undefined>(untrack(() => saved.measured))
  let width = $state(0)
  const empty = new Set<string>()
  const collapsed = $derived(folds ?? empty)
  export function sectionState() {
    if (!sections.nodes.size) return "none"
    return order.some((index) => index < 0 && !collapsed.has(sections.nodes.get(-index - 1)!.key)) ? "open" : "closed"
  }
  export function toggleSections() {
    folds = sectionState() === "closed" ? new Set() : new Set([...sections.nodes.values()].map((entry) => entry.key))
  }
  export function expand(index: number) {
    const next = new Set(collapsed)
    for (const entry of sections.nodes.values()) if (entry.start <= index && index < entry.end) next.delete(entry.key)
    if (next.size !== collapsed.size) folds = next
  }
  export async function revealSection(id: number) {
    const target = sections.nodes.get(id)
    if (!target || !list) return
    const next = new Set(collapsed)
    for (let parent = target.parent; parent; parent = parent.parent) next.delete(parent.key)
    if (next.size !== collapsed.size) folds = next
    const heading = await seek(-target.id - 1, `[data-section="${target.id}"] .list-heading`)
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

  export function trail(id: number) {
    const result = []
    for (let node = sections.nodes.get(id); node; node = node.parent) result.unshift(node)
    return result
  }
  export function paths(page: number, ancestors: readonly string[]) {
    return [...sections.nodes.values()].filter(
      (entry) => ancestors.includes(entry.node) && entry.start <= page && page < entry.end,
    )
  }
  const sections = $derived(sectionsOf(count, headings, identity))
  const sequence = $derived(flattenSections(sections.roots, count, collapsed))
  const order = $derived(sequence.filter((index) => index < 0 || !skipped?.has(index)))
  const sequenceRanks = $derived(new Map(sequence.map((index, rank) => [index, rank])))
  const pages = $derived(order.filter((index) => index >= 0))
  const ranks = $derived(new Map(order.map((index, rank) => [index, rank])))
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
    scroll = element.scrollTop
    remember()
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>(".list-row, .list-section")
        : undefined
    if (!focused || !element.contains(focused)) return
    const bounds = focused.getBoundingClientRect(),
      frame = element.getBoundingClientRect()
    if (bounds.bottom <= frame.top || bounds.top >= frame.bottom) element.focus({ preventScroll: true })
  }

  function reveal(element: HTMLElement) {
    list = element as HTMLUListElement
    const owner = element.closest<HTMLElement>(pane === "Input" ? ".selection-panel" : ".composition-output")
    element.addEventListener("keydown", keys)
    let disposed = false
    let frame = 0
    let following = false
    let followedRevision: unknown
    const measure = () => {
      if (disposed) return
      viewport = element.clientHeight
      width = element.clientWidth
      owner?.style.setProperty("--list-gutter", `${element.offsetWidth - element.clientWidth}px`)
      const previous = measured?.revision === revision && measured?.width === width ? measured.sizes : undefined
      const sizes = new Map(previous)
      let changed = false
      for (const row of element.querySelectorAll<HTMLElement>(
        ".list-row:not(.removing):not([data-drop]):not([data-dragging]), .list-section:not(:has(> .list-drop-preview))",
      )) {
        const index = row.matches(".list-section")
          ? -Number(row.dataset.section) - 1
          : Number(row.querySelector<HTMLElement>("[data-page]")?.dataset.page)
        if (!Number.isFinite(index) || !row.offsetHeight || sizes.get(index) === row.offsetHeight) continue
        sizes.set(index, row.offsetHeight)
        changed = true
      }
      if (changed) measured = { revision, width, sizes }
      if (folds === undefined && sections.nodes.size && viewport && width)
        folds = new Set(
          element.scrollHeight > element.clientHeight + 1 ? [...sections.nodes.values()].map((entry) => entry.key) : [],
        )
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    observer.observe(element)
    untrack(() => {
      measure()
      element.scrollTop = scroll
    })
    $effect(() => {
      void rows
      void tick().then(() => {
        if (disposed) return
        measure()
        observer.disconnect()
        observer.observe(element)
        for (const row of element.querySelectorAll(".list-row, .list-section")) observer.observe(row)
      })
    })
    $effect(() => {
      const index = position
      untrack(() => {
        const offset = !following && saved.position === index ? saved.offset : undefined
        if (following && followedRevision === revision) expand(index)
        following = true
        followedRevision = revision
        const rank = ranks.get(index)
        if (rank === undefined) return
        const top = offsets[rank]
        const bottom = offsets[rank + 1]
        seeking = top < element.scrollTop || bottom > element.scrollTop + element.clientHeight ? index : undefined
        if (top < element.scrollTop) element.scrollTop = top
        else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight
        scroll = element.scrollTop
        settling = tick().then(async () => {
          if (disposed) return
          measure()
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
      saved.measured = untrack(() => measured)
      list = undefined
      owner?.style.removeProperty("--list-gutter")
      disposed = true
      cancelAnimationFrame(frame)
      observer.disconnect()
      element.removeEventListener("keydown", keys)
    }
  }
  async function keys(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement)) return
    if (!event.target.matches(".list-choice, .page-list")) return
    const action = shortcut(event, shortcutContext(event, { pane, view: "list" }), "list")
    if (action === "suppress") {
      event.preventDefault()
      return
    }
    if (!action || !pages.length) return
    const element = event.currentTarget as HTMLElement
    const index = Math.max(0, pages.indexOf(position))
    position = pages[index]
    if (action === "add" || action === "duplicate" || action === "remove") {
      event.preventDefault()
      if (!event.repeat) edit(action, position)
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
    if (action === "copy") select(position, false)
    const row = element.querySelector<HTMLElement>(`[data-page="${position}"]`)?.closest("li"),
      stride = Math.max(1, Math.floor(element.clientHeight / (row?.getBoundingClientRect().height || 44)))
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
                    ? -stride
                    : action === "viewportNext"
                      ? stride
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
      <li
        class="list-section"
        style:--section-depth={entry.path.length - 1}
        class:selected={collapsed.has(entry.key) && selected?.(entry.start, entry.end)}
        data-selected={selected?.(entry.start, entry.end) || undefined}
        data-section={-index - 1}
        data-index={entry.start}
        data-end={collapsed.has(entry.key) ? entry.end - 1 : undefined}
        data-dragging={dragged === index || undefined}
        data-retained={index === pin || undefined}
      >
        {@render section?.(
          entry.start,
          entry.end,
          entry.path,
          !collapsed.has(entry.key),
          () => {
            const next = new Set(collapsed)
            if (next.has(entry.key)) next.delete(entry.key)
            else next.add(entry.key)
            folds = next
          },
          entry.id,
        )}
      </li>
    {:else}{@render children(index, pin)}{/if}
  {/each}
  <li class="list-spacer" aria-hidden="true" style:block-size={`${offsets[order.length] - offsets[to]}px`}></li>
</ul>
