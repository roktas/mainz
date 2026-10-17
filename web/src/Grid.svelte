<!-- Batches thumbnails and connects mouse selection with keyboard navigation. -->
<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import Icon from "./Icon.svelte"
  import { blocked, fields } from "./keyboard.ts"

  let {
    pane,
    active,
    compact = false,
    count,
    position = $bindable(0),
    offset = $bindable(0),
    keyboard = $bindable(false),
    selected,
    toggle,
    edit,
    initialize,
    children,
  }: {
    pane: "Input" | "Output"
    active: () => boolean
    compact?: boolean
    count: number
    position?: number
    offset?: number
    keyboard?: boolean
    selected: (position: number) => boolean
    toggle: (position: number) => void
    edit: (key: "Enter" | "+" | "-") => boolean
    initialize?: (capacity: number) => void
    children: Snippet<[start: number, end: number]>
  } = $props()
  let columns = $state(1)
  let rows = $state(1)
  let adaptive = $state(false)
  const batch = $derived(adaptive ? columns * rows : pane === "Input" ? 8 : 12)
  const start = $derived(
    Math.min(Math.floor(offset / batch) * batch, Math.max(0, Math.floor((count - 1) / batch) * batch)),
  )
  const batches = $derived(Math.max(1, Math.ceil(count / batch)))
  const current = $derived(Math.floor(start / batch))
  const marks = $derived(Array.from({ length: batches }, (_, mark) => mark))

  function measure(element: HTMLDivElement) {
    const notify = initialize
    const total = count
    const grid = element.querySelector<HTMLElement>(".composition-grid")!
    // Density changes the cards without resizing the shared frame.
    const navigation = compact || total > batch ? element.querySelector<HTMLElement>(".page-batches") : null
    let frame: number
    let disposed = false
    function resize() {
      // Outgoing cards retain the Grid while Svelte pauses its effects for the fade.
      if (disposed || !grid.querySelector(".composition-card:not([inert])")) return
      const previous = batch
      const anchor = position >= start && position < start + batch ? position : offset
      if (!element.clientWidth) {
        adaptive = false
        if (batch !== previous) offset = anchor
        if (grid.clientWidth) notify?.(batch)
        return
      }
      // The viewport budget is fixed in CSS; rendered cards cannot resize it.
      const style = getComputedStyle(grid)
      const height = parseFloat(style.gridAutoRows) || parseFloat(style.gridTemplateRows)
      const gap = parseFloat(style.rowGap) || 0
      const footer = parseFloat(getComputedStyle(element).gridTemplateRows.split(" ").at(-1) ?? "84") || 84
      if (!height) return
      columns = Math.max(1, style.gridTemplateColumns.split(" ").length)
      const capacity = Math.max(1, Math.floor((element.clientHeight - footer + gap) / (height + gap)))
      rows = compact ? Math.min(7, capacity) : capacity
      adaptive = true
      if (batch !== previous) offset = anchor
      notify?.(batch)
    }
    const scheduleResize = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(resize)
    }
    const observer = new ResizeObserver(scheduleResize)
    observer.observe(element)
    if (navigation) observer.observe(navigation)
    // Viewport queries can change columns without resizing the fitted frame.
    window.addEventListener("resize", scheduleResize)
    untrack(resize)
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      window.removeEventListener("resize", scheduleResize)
      observer.disconnect()
    }
  }

  function move(next: number) {
    offset = Math.max(0, Math.min(next, (batches - 1) * batch))
    position = offset
  }

  function gridKeys(element: HTMLElement) {
    const view = element.parentElement!
    element.tabIndex = -1
    element.setAttribute(
      "aria-keyshortcuts",
      `ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight PageUp PageDown Home End N P V Control+A Meta+A Space Enter${pane === "Output" ? " Plus - Delete Control+ArrowLeft Control+ArrowRight" : ""}`,
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
      if (!element.isConnected || !count) {
        advancing = false
        return
      }
      boundary = next < 0 ? -1 : next >= count ? 1 : 0
      position = Math.max(0, Math.min(next, count - 1))
      offset = Math.floor(position / batch) * batch
      await tick()
      if (element.isConnected) {
        if (boundary) {
          element.dataset.cursorBoundary = String(boundary)
          element.focus({ preventScroll: true })
        } else {
          delete element.dataset.cursorBoundary
          element.querySelector<HTMLButtonElement>(`.page-image[data-page="${position}"]`)?.focus()
        }
      }
      advancing = false
    }
    function images() {
      return [...element.querySelectorAll<HTMLButtonElement>("button.page-image")].filter(
        (button) => !button.closest("[inert]"),
      )
    }
    async function click(event: MouseEvent) {
      if (event.ctrlKey || event.metaKey || !(event.target instanceof Element)) return
      const control = event.target.closest<HTMLButtonElement>("button.page-image, button.page-grip")
      const image = control?.closest(".composition-card")?.querySelector<HTMLButtonElement>(".page-image")
      if (!image || !element.contains(image)) return
      const index = images().indexOf(image)
      if (index < 0) return
      boundary = 0
      delete element.dataset.cursorBoundary
      const clicked = start + index
      await tick()
      if (event.detail) pointerSelection = selected(clicked) ? clicked : undefined
      else {
        keyboard = true
        reset()
        void advance(clicked + 1)
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
      const extending = event.shiftKey && ["arrowleft", "arrowright"].includes(key)
      if (
        (key === " " || key === "enter") &&
        (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || blocked()) &&
        event.target instanceof Element &&
        event.target.matches(".page-image, .page-grip")
      ) {
        event.preventDefault()
        return
      }
      if (
        event.defaultPrevented ||
        event.isComposing ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        blocked() ||
        (event.shiftKey && !extending && !["shift", "n", "p", "+"].includes(key))
      )
        return
      if (
        (event.key === "Enter" || event.key === "+" || event.key === "-") &&
        (event.target === element || (event.target instanceof Element && event.target.matches(".page-image")))
      ) {
        event.preventDefault()
        if (event.repeat) return
        reset()
        if (edit(event.key)) keyboard = true
        return
      }
      if (key === " " && event.target === element) {
        event.preventDefault()
        return
      }
      if (paging) {
        event.preventDefault()
        const next = start + (key === "pageup" ? -batch : batch)
        if (next < 0 || next >= count) return
        keyboard = true
        reset()
        void advance(next)
        return
      }
      if (!["shift", "arrowleft", "arrowright", "arrowup", "arrowdown", "home", "end", "n", "p"].includes(key)) return
      const buttons = images()
      const index = buttons.indexOf(event.target as HTMLButtonElement)
      let cursor =
        event.target === element ? (boundary ? (boundary < 0 ? 0 : count) : position) : index < 0 ? -1 : start + index
      if (cursor < 0) return
      if (key === "shift") {
        if (pointerSelection === cursor) {
          keyboard = true
          reset()
          void advance(cursor + 1)
        }
        return
      }
      if (key === "home" || key === "end") {
        event.preventDefault()
        keyboard = true
        reset()
        void advance(key === "home" ? 0 : count - 1)
        return
      }
      const rowColumns = buttons.filter(
        (button) =>
          button.closest<HTMLElement>(".composition-card")!.offsetTop ===
          buttons[0].closest<HTMLElement>(".composition-card")!.offsetTop,
      ).length
      const step =
        key === "arrowleft" || key === "p"
          ? -1
          : key === "arrowright" || key === "n"
            ? 1
            : key === "arrowup"
              ? -rowColumns
              : rowColumns
      event.preventDefault()
      keyboard = true
      if (extending) {
        if (pointerSelection === cursor) cursor++
        reset()
        const page = step < 0 ? cursor - 1 : cursor
        if (page < 0 || page >= count) return
        toggle(page)
        void advance(step > 0 ? page + 1 : page === 0 ? -1 : page)
      } else {
        reset()
        if (boundary) {
          if (Math.sign(step) !== boundary) void advance(boundary < 0 ? 0 : count - 1)
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
  data-columns={adaptive ? columns : undefined}
  data-rows={adaptive ? rows : undefined}
  data-batch={batch}
  {@attach measure}
>
  <svelte:element
    this={pane === "Input" ? "ul" : "ol"}
    class={["composition-grid", pane === "Input" ? "source-catalog" : "output-pages"]}
    aria-label={pane === "Input" ? "Input pages" : "Output page order"}
    start={pane === "Output" ? start + 1 : undefined}
    {@attach gridKeys}
  >
    {@render children(start, Math.min(start + batch, count))}
  </svelte:element>
  {#if compact || count > batch}
    <nav class="page-batches" aria-label={`${pane} thumbnail pages`}>
      <button
        class="icon-button"
        aria-label={`Previous ${pane} thumbnails`}
        disabled={start === 0}
        onclick={() => move(start - batch)}><Icon name="previous" /></button
      >
      <span class="batch-slider">
        <input
          type="range"
          aria-label={`${pane} thumbnail range`}
          aria-valuetext={`Grid page ${current + 1} of ${batches}, pages ${start + 1}–${Math.min(start + batch, count)} of ${count}`}
          min="0"
          max={batches - 1}
          step="1"
          value={current}
          disabled={batches === 1}
          oninput={(event) => move(Number(event.currentTarget.value) * batch)}
        />
        <span class="batch-marks" aria-hidden="true">
          {#each marks as mark (mark)}
            <span
              class:current={mark === current}
              class:passed={mark < current}
              style:--position={batches === 1 ? 0 : mark / (batches - 1)}
            ></span>
          {/each}
        </span>
      </span>
      <button
        class="icon-button"
        aria-label={`Next ${pane} thumbnails`}
        disabled={start + batch >= count}
        onclick={() => move(start + batch)}><Icon name="next" /></button
      >
      <span class="batch-caption">
        <span class="batch-counter"
          ><strong>{current + 1}</strong><span class="batch-total">&nbsp;/&nbsp;{batches}</span></span
        >
        <span class="batch-range"
          ><span class="batch-separator" aria-hidden="true">·</span><strong
            >{start + 1}–{Math.min(start + batch, count)}</strong
          ><span class="batch-total">&nbsp;/&nbsp;{count}</span></span
        >
      </span>
    </nav>
  {/if}
</div>
