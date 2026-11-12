<!-- Adds direct scroll destinations beside overflowing application panels. -->

<script lang="ts">
  import { onMount } from "svelte"
  import Icon from "./Icon.svelte"

  type Area = {
    element: HTMLElement
    name: string
    x: number
    track: number
    y: number
    height: number
    start: boolean
    end: boolean
  }
  let areas = $state<Area[]>([])

  function jump(area: Area, end: boolean) {
    area.element.scrollTo({
      top: end ? area.element.scrollHeight - area.element.clientHeight : 0,
      behavior: "instant",
    })
  }
  function present(element: HTMLElement, owner: HTMLElement) {
    owner.append(element)
    element.showPopover()
    // Viewport pan and touch gestures must not capture scroll-control activation.
    const stop = (event: Event) => {
      if (event.type === "pointerdown") event.preventDefault()
      event.stopPropagation()
    }
    const events = ["pointerdown", "touchstart", "touchend", "dblclick"]
    for (const name of events) element.addEventListener(name, stop)
    return () => {
      for (const name of events) element.removeEventListener(name, stop)
      element.remove()
    }
  }
  onMount(() => {
    const candidates = new Set<HTMLElement>()
    let frame = 0
    const root = document.scrollingElement as HTMLElement
    const app = document.getElementById("app")!
    function collect(parent: Element) {
      for (const element of [parent, ...parent.querySelectorAll("div, section, aside, nav, ul, ol, p, dialog")]) {
        if (!(element instanceof HTMLElement) || element.closest(".scroll-controls, .page-scroll")) continue
        if (element === root || /^(auto|scroll)$/.test(getComputedStyle(element).overflowY)) {
          if (!candidates.has(element)) {
            candidates.add(element)
            resize.observe(element)
          }
        }
      }
    }
    function update() {
      frame = 0
      const modal = [...document.querySelectorAll("dialog:modal")].at(-1)
      const next: Area[] = []
      for (const element of candidates) {
        if (!element.isConnected) {
          candidates.delete(element)
          resize.unobserve(element)
          continue
        }
        if (
          !element.checkVisibility({ visibilityProperty: true }) ||
          element.closest("[inert]") ||
          (modal && !modal.contains(element))
        )
          continue
        const maximum = element.scrollHeight - element.clientHeight
        if (maximum <= 1 || (element === root && /^(hidden|clip)$/.test(getComputedStyle(root).overflowY))) continue
        const box =
          element === root ? { top: 0, bottom: innerHeight, right: innerWidth } : element.getBoundingClientRect()
        let top = Math.max(0, box.top),
          bottom = Math.min(innerHeight, box.bottom)
        for (let parent = element.parentElement; parent && parent !== root; parent = parent.parentElement) {
          if (element.matches(":popover-open, :modal")) break
          if (/^(auto|scroll|hidden|clip)$/.test(getComputedStyle(parent).overflowY)) {
            const bounds = parent.getBoundingClientRect()
            top = Math.max(top, bounds.top)
            bottom = Math.min(bottom, bounds.bottom)
          }
          if (parent.matches(":popover-open, :modal")) break
        }
        if (bottom - top < 88 || box.right < 24 || box.right > innerWidth + 1) continue
        const pane = element.closest(".selection-panel")
          ? "Input"
          : element.closest(".composition-output")
            ? "Output"
            : ""
        const view = element.matches(".grid-view") ? "Grid" : element.matches(".page-list") ? "List" : ""
        const name = view
          ? `${pane} ${view}`
          : element === root
            ? "Document"
            : element.getAttribute("aria-label") ||
              element.closest("[aria-label]")?.getAttribute("aria-label") ||
              "Panel"
        const style = getComputedStyle(element)
        const scrollbar =
          element.offsetWidth -
          element.clientWidth -
          parseFloat(style.borderInlineStartWidth) -
          parseFloat(style.borderInlineEndWidth)
        next.push({
          element,
          name,
          x: element === root ? innerWidth - 24 : box.right - 8,
          track: box.right - parseFloat(style.borderInlineEndWidth) - Math.max(6, scrollbar) / 2,
          y: top,
          height: bottom - top,
          start: element.scrollTop <= 1,
          end: maximum - element.scrollTop <= 1,
        })
      }
      if (
        next.length !== areas.length ||
        next.some((area, index) =>
          Object.entries(area).some(([key, value]) => areas[index]?.[key as keyof Area] !== value),
        )
      )
        areas = next
    }
    function schedule() {
      if (!frame) frame = requestAnimationFrame(update)
    }
    const resize = new ResizeObserver(schedule)
    const mutations = new MutationObserver((records) => {
      let changed = false
      for (const record of records) {
        if (record.target instanceof Element && record.target.closest(".scroll-controls")) continue
        changed = true
        for (const node of record.addedNodes) if (node instanceof Element) collect(node)
      }
      if (changed) schedule()
    })
    const resized = () => {
      collect(app)
      schedule()
    }
    collect(root)
    mutations.observe(app, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["open", "hidden", "class", "style", "aria-hidden", "data-view"],
    })
    document.addEventListener("scroll", schedule, true)
    document.addEventListener("toggle", schedule, true)
    window.addEventListener("resize", resized)
    schedule()
    return () => {
      cancelAnimationFrame(frame)
      resize.disconnect()
      mutations.disconnect()
      document.removeEventListener("scroll", schedule, true)
      document.removeEventListener("toggle", schedule, true)
      window.removeEventListener("resize", resized)
    }
  })
</script>

{#each areas as area (area.element)}
  {@const owner = area.element}
  <div
    class="scroll-controls"
    popover="manual"
    role="group"
    aria-label={`${area.name} scroll controls`}
    style:inset-inline-start={`${area.x}px`}
    style:inset-block-start={`${area.y}px`}
    style:block-size={`${area.height}px`}
    style:--track-center={`${area.track - area.x}px`}
    style:--start-offset={`${Math.max(-24, -area.y)}px`}
    style:--end-offset={`${Math.max(-24, area.y + area.height - innerHeight)}px`}
    {@attach (element) =>
      present(element, owner === document.scrollingElement ? document.getElementById("app")! : owner)}
  >
    <button
      type="button"
      aria-label={`Scroll ${area.name} to start`}
      disabled={area.start}
      onclick={() => jump(area, false)}><Icon name="first" /></button
    >
    <button type="button" aria-label={`Scroll ${area.name} to end`} disabled={area.end} onclick={() => jump(area, true)}
      ><Icon name="last" /></button
    >
  </div>
{/each}

<style>
  .scroll-controls {
    position: fixed;
    inset: auto;
    inline-size: 24px;
    max-block-size: none;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: var(--muted);
    pointer-events: none;
    overflow: visible;
  }
  .scroll-controls:popover-open {
    display: block;
  }
  .scroll-controls > button {
    position: absolute;
    inset-inline: 0;
    inline-size: 24px;
    min-inline-size: 24px;
    block-size: 44px;
    min-block-size: 44px;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    pointer-events: auto;
  }
  button:first-child {
    inset-block-start: var(--start-offset);
  }
  button:last-child {
    inset-block-end: var(--end-offset);
  }
  button :global(svg) {
    position: absolute;
    inset-inline-start: calc(var(--track-center) - 8px);
    inline-size: 16px;
    block-size: 16px;
    stroke-width: 1.8;
    rotate: 90deg;
  }
  button:first-child,
  button:last-child {
    color: var(--accent);
  }
  button:first-child :global(svg) {
    inset-block-start: 2px;
  }
  button:last-child :global(svg) {
    inset-block-end: 2px;
  }
  button:disabled {
    opacity: 0.65;
    pointer-events: none;
  }
  button:focus-visible {
    outline: 2px solid var(--secondary);
    outline-offset: -2px;
  }
  .scroll-controls > button:active:not(:disabled) {
    background: transparent;
    box-shadow: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .scroll-controls > button:hover:not(:disabled) {
      background: transparent;
      box-shadow: none;
      color: var(--accent);
    }
  }
</style>
