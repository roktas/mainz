<!-- Windows page rows and section disclosures, and owns List scrolling and keyboard navigation. -->

<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { shortcut, shortcutContext } from "./keyboard.ts"

  let {
    pane,
    count,
    revision,
    heading,
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
    count: number
    revision?: unknown
    heading?: (position: number) => readonly string[]
    identity?: (position: number) => string
    section?: Snippet<[start: number, end: number, path: readonly string[], expanded: boolean, toggle: () => void]>
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
  let scroll = $state(0)
  let dragged = $state<number>()
  let seeking = $state<number>()
  let settling = Promise.resolve()
  const rowHeight = 44
  let measured = $state.raw<{
    revision: unknown
    width: number
    sizes: ReadonlyMap<number, number>
  }>()
  let width = $state(0)
  const empty = new Set<string>()
  const collapsed = $derived(folds ?? empty)
  export function sectionState() {
    if (!sections.size) return "none"
    return [...sections.values()].some((entry) => !collapsed.has(entry.key)) ? "open" : "closed"
  }
  export function toggleSections() {
    folds = sectionState() === "closed" ? new Set() : new Set([...sections.values()].map((entry) => entry.key))
  }
  export function expand(index: number) {
    for (const [start, entry] of sections)
      if (start <= index && index < entry.end && collapsed.has(entry.key)) {
        const next = new Set(collapsed)
        next.delete(entry.key)
        folds = next
      }
  }
  const sections = $derived.by(() => {
    const result = new Map<number, { path: readonly string[]; key: string; end: number }>()
    let previous: readonly string[] = []
    let current: { path: readonly string[]; key: string; end: number } | undefined
    if (!heading) return result
    for (let index = 0; index < count; index++) {
      const path = heading(index)
      if (path.length === previous.length && path.every((part, depth) => part === previous[depth])) continue
      if (current) current.end = index
      current = path.length ? { path, key: identity?.(index) ?? String(index), end: count } : undefined
      if (current) result.set(index, current)
      previous = path
    }
    return result
  })
  const hidden = $derived.by(() => {
    const result = new Set<number>()
    for (const [start, entry] of sections)
      if (collapsed.has(entry.key)) for (let index = start; index < entry.end; index++) result.add(index)
    return result
  })
  const order = $derived.by(() => {
    const result: number[] = []
    // Negative entries place section headings before their first physical page.
    for (let index = 0; index < count; index++) {
      if (sections.has(index)) result.push(-index - 1)
      if (!hidden.has(index) && !skipped?.has(index)) result.push(index)
    }
    return result
  })
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
    seeking !== undefined
      ? Math.max(0, (offsets[(ranks.get(seeking) ?? 0) + 1] ?? 0) - viewport)
      : viewport
        ? scroll
        : (offsets[ranks.get(Math.max(0, position)) ?? 0] ?? 0),
  )
  const from = $derived(Math.max(0, Math.min(Math.max(0, order.length - 1), locate(start) - 8)))
  const to = $derived(Math.min(order.length, Math.max(from + 1, locate(start + viewport) + 9)))

  const retainedIndex = $derived(dragged !== undefined && dragged < 0 ? dragged : (retained ?? dragged))
  const pin = $derived(
    retainedIndex !== undefined &&
      retainedIndex < count &&
      (retainedIndex >= 0 || sections.has(-retainedIndex - 1)) &&
      !hidden.has(retainedIndex) &&
      !order.slice(from, to).includes(retainedIndex)
      ? retainedIndex
      : undefined,
  )
  const rows = $derived.by(() => {
    const window = order.slice(from, to)
    if (pin !== undefined) window.push(pin)
    return window.toSorted((a, b) => (a < 0 ? -a - 1.5 : a) - (b < 0 ? -b - 1.5 : b))
  })
  function scrolling(element: HTMLElement) {
    scroll = element.scrollTop
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
    element.addEventListener("keydown", keys)
    let disposed = false
    let frame = 0
    let following = false
    let followedRevision: unknown
    const measure = () => {
      if (disposed) return
      viewport = element.clientHeight
      width = element.clientWidth
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
      if (folds === undefined && sections.size && viewport && width)
        folds = new Set(
          element.scrollHeight > element.clientHeight + 1 ? [...sections.values()].map((entry) => entry.key) : [],
        )
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    })
    observer.observe(element)
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
        if (following && followedRevision === revision) expand(index)
        following = true
        followedRevision = revision
        const rank = ranks.get(index)
        if (rank === undefined) return
        seeking = index
        const top = offsets[rank]
        const bottom = offsets[rank + 1]
        if (top < element.scrollTop) element.scrollTop = top
        else if (bottom > element.scrollTop + element.clientHeight) element.scrollTop = bottom - element.clientHeight
        scroll = element.scrollTop
        settling = tick().then(async () => {
          if (disposed) return
          measure()
          await tick()
          if (!disposed && position === index) {
            element
              .querySelector<HTMLElement>(`[data-page="${position}"]`)
              ?.closest("li")
              ?.scrollIntoView({ block: "nearest" })
            scroll = element.scrollTop
            seeking = undefined
            await tick()
          }
        })
      })
    })
    return () => {
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
        "batchPrevious",
        "batchNext",
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
                  (action === "batchPrevious"
                    ? -stride
                    : action === "batchNext"
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

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<ul
  class="page-list"
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
  {#each rows as index (index < 0 ? `section:${identity?.(-index - 1) ?? -index - 1}` : (identity?.(index) ?? index))}
    {#if index < 0}
      {@const entry = sections.get(-index - 1)!}
      <li
        class="list-section"
        class:selected={collapsed.has(entry.key) && selected?.(-index - 1, entry.end)}
        data-selected={selected?.(-index - 1, entry.end) || undefined}
        data-section={-index - 1}
        data-index={-index - 1}
        data-end={collapsed.has(entry.key) ? entry.end - 1 : undefined}
        data-dragging={dragged === index || undefined}
        data-retained={index === pin || undefined}
      >
        {@render section?.(-index - 1, entry.end, entry.path, !collapsed.has(entry.key), () => {
          const next = new Set(collapsed)
          if (next.has(entry.key)) next.delete(entry.key)
          else next.add(entry.key)
          folds = next
        })}
      </li>
    {:else}{@render children(index, pin)}{/if}
  {/each}
  <li class="list-spacer" aria-hidden="true" style:block-size={`${offsets[order.length] - offsets[to]}px`}></li>
</ul>
