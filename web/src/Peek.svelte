<!-- Offers a full-page hover preview and an explicit action to inspect the page. -->

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { Snippet } from "svelte"
  import Icon from "./Icon.svelte"
  import type { Size } from "./model.ts"

  let {
    id,
    pane,
    number,
    name,
    size,
    enabled = true,
    opened = $bindable(),
    open,
    children,
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    name?: string
    size: Size
    enabled?: boolean
    opened?: string
    open: (event: MouseEvent | KeyboardEvent) => void
    children: Snippet
  } = $props()
  let pending: ReturnType<typeof setTimeout> | undefined
  function close() {
    clearTimeout(pending)
    if (opened === id) opened = undefined
  }
  function show() {
    clearTimeout(pending)
    if (enabled)
      pending = setTimeout(() => {
        if (enabled) opened = id
      }, 220)
  }
  function reveal(element: HTMLElement) {
    element.showPopover()
    const events = new AbortController()
    document.addEventListener("scroll", close, { capture: true, signal: events.signal })
    window.addEventListener("resize", close, { signal: events.signal })
    return () => {
      events.abort()
      if (element.isConnected && element.matches(":popover-open")) element.hidePopover()
    }
  }
  onDestroy(close)
</script>

<span class="list-peek">
  <button
    class="icon-button"
    aria-label={`View ${pane} page ${number}`}
    aria-describedby={opened === id ? id : undefined}
    onpointerenter={(event) => {
      if (event.pointerType === "mouse" && matchMedia("(hover: hover) and (pointer: fine)").matches) show()
    }}
    onpointerleave={close}
    onfocus={(event) => {
      if (event.currentTarget.matches(":focus-visible")) show()
    }}
    onblur={close}
    onclick={(event) => {
      close()
      open(event)
    }}><Icon name="eye" /></button
  >
  {#if opened === id && enabled}
    <div
      {id}
      class="page-peek"
      role="tooltip"
      popover="manual"
      style:--ratio={size.width / size.height}
      {@attach reveal}
    >
      <div class="peek-image">{@render children()}</div>
      {#if name}<p>{name}</p>{/if}
    </div>
  {/if}
</span>
