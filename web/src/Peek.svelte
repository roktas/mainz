<!-- Offers a full-page hover preview and an explicit action to inspect the page. -->

<script module lang="ts">
  export class Peeks {
    #close?: () => void
    show(close: () => void) {
      this.dismiss()
      this.#close = close
    }
    dismiss(event?: KeyboardEvent) {
      if (event && event.key !== "Escape") return false
      const active = !!this.#close
      this.#close?.()
      this.#close = undefined
      if (active && event?.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        return true
      }
      return false
    }
    release(close: () => void) {
      if (this.#close === close) this.#close = undefined
    }
  }
</script>

<script lang="ts">
  import { onDestroy, untrack } from "svelte"
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
    owner,
    open,
    children,
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    name?: string
    size: Size
    enabled?: boolean
    owner: Peeks
    open: (event: MouseEvent | KeyboardEvent) => void
    children: Snippet
  } = $props()
  const registry = untrack(() => owner)
  let pending: ReturnType<typeof setTimeout> | undefined
  let opened = $state(false)
  let events: AbortController | undefined
  function close() {
    clearTimeout(pending)
    pending = undefined
    opened = false
    events?.abort()
    registry.release(close)
  }
  function show() {
    close()
    if (enabled) {
      registry.show(close)
      events = new AbortController()
      document.addEventListener("scroll", close, { capture: true, signal: events.signal })
      window.addEventListener("resize", close, { signal: events.signal })
      pending = setTimeout(() => {
        pending = undefined
        if (enabled) opened = true
      }, 220)
    }
  }
  $effect(() => {
    if (!enabled) close()
  })
  function reveal(element: HTMLElement) {
    element.showPopover()
    return () => {
      if (element.isConnected && element.matches(":popover-open")) element.hidePopover()
    }
  }
  onDestroy(close)
</script>

<span class="list-peek">
  <button
    class="icon-button"
    aria-label={`View ${pane} page ${number}`}
    aria-describedby={opened ? id : undefined}
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
  {#if opened && enabled}
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
