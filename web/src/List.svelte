<!-- Windows page rows and owns List scrolling and keyboard navigation. -->

<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { shortcut, shortcutContext } from "./keyboard.ts"

  let {
    pane,
    count,
    pages,
    revision,
    skipped,
    retained,
    position = $bindable(0),
    select,
    edit,
    children,
  }: {
    pane: "Input" | "Output"
    count: number
    pages?: readonly number[]
    revision?: unknown
    skipped?: ReadonlySet<number>
    retained?: number
    position?: number
    select: (position: number, range: boolean, anchor?: number) => void
    edit: (action: "add" | "duplicate" | "remove", position: number) => boolean
    children: Snippet<[indices: readonly number[], retained?: number]>
  } = $props()
  const cursor = $derived(pages ? pages.indexOf(position) : position)
  let viewport = $state(0)
  let scroll = $state(0)
  let dragged = $state<number>()
  let seeking = $state<number>()
  let settling = Promise.resolve()
  const rowHeight = 44
  let measured = $state.raw<{
    revision: unknown
    pages: typeof pages
    width: number
    sizes: ReadonlyMap<number, number>
  }>()
  let width = $state(0)
  const indexes = $derived(new Map(pages?.map((page, index) => [page, index])))
  const order = $derived(Array.from({ length: count }, (_, index) => index).filter((index) => !skipped?.has(index)))
  const ranks = $derived(new Map(order.map((index, rank) => [index, rank])))
  const offsets = $derived.by(() => {
    const sizes =
      measured?.revision === revision && measured?.pages === pages && measured?.width === width
        ? measured.sizes
        : undefined
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
        : (offsets[ranks.get(Math.max(0, cursor)) ?? 0] ?? 0),
  )
  const from = $derived(Math.max(0, Math.min(Math.max(0, order.length - 1), locate(start) - 8)))
  const to = $derived(Math.min(order.length, Math.max(from + 1, locate(start + viewport) + 9)))

  const retainedIndex = $derived(retained ?? dragged)
  const pin = $derived(
    retainedIndex !== undefined && retainedIndex < count && !order.slice(from, to).includes(retainedIndex)
      ? retainedIndex
      : undefined,
  )
  const rows = $derived.by(() => {
    const window = order.slice(from, to)
    if (pin !== undefined) window.push(pin)
    return window.toSorted((a, b) => a - b)
  })
  function scrolling(element: HTMLElement) {
    scroll = element.scrollTop
    const focused =
      document.activeElement instanceof HTMLElement
        ? document.activeElement.closest<HTMLElement>(".list-row")
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
    const measure = () => {
      if (disposed) return
      viewport = element.clientHeight
      width = element.clientWidth
      const previous =
        measured?.revision === revision && measured?.pages === pages && measured?.width === width
          ? measured.sizes
          : undefined
      const sizes = new Map(previous)
      let changed = false
      for (const row of element.querySelectorAll<HTMLElement>(
        ".list-row:not(.removing):not([data-drop]):not([data-dragging])",
      )) {
        const page = Number(row.querySelector<HTMLElement>("[data-page]")?.dataset.page)
        const index = pages ? indexes.get(page) : page
        if (index === undefined || !row.offsetHeight || sizes.get(index) === row.offsetHeight) continue
        sizes.set(index, row.offsetHeight)
        changed = true
      }
      if (changed) measured = { revision, pages, width, sizes }
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
        for (const row of element.querySelectorAll(".list-row")) observer.observe(row)
      })
    })
    $effect(() => {
      const index = cursor
      untrack(() => {
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
          if (!disposed && cursor === index) {
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
    if (!action || !count) return
    const element = event.currentTarget as HTMLElement
    const index = Math.max(0, cursor)
    position = pages?.[index] ?? index
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
          ? count - 1
          : Math.max(
              0,
              Math.min(
                count - 1,
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
    position = pages?.[next] ?? next
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
    const row = event.target instanceof Element ? event.target.closest(".list-row") : undefined
    const page = Number(row?.querySelector<HTMLElement>("[data-page]")?.dataset.page)
    dragged = pages ? indexes.get(page) : Number.isFinite(page) ? page : undefined
  }}
  {@attach reveal}
>
  <li class="list-spacer" aria-hidden="true" style:block-size={`${offsets[from]}px`}></li>
  {@render children(rows, pin)}
  <li class="list-spacer" aria-hidden="true" style:block-size={`${offsets[order.length] - offsets[to]}px`}></li>
</ul>
