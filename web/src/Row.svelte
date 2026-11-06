<!-- Owns List row controls, click gestures, and lazily opened contextual actions. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import { retainFocus } from "./drag.ts"
  import type { Transfer, Payload } from "./transfer.svelte.ts"
  import Icon from "./Icon.svelte"

  let {
    pane,
    number,
    index,
    id,
    name,
    label,
    sections = 0,
    selected,
    touch,
    transfer,
    payload,
    start,
    inspect,
    toggle,
    select,
    open,
    origin,
    actions,
    preview,
  }: {
    pane: "Input" | "Output"
    number: number
    index: number
    id: string
    name?: string
    label: string
    sections?: number
    selected: boolean
    touch: boolean
    transfer: Transfer
    payload: Payload
    start: (event: DragEvent | PointerEvent, payload: Payload) => void
    inspect: () => void
    toggle: (range: boolean) => void
    select: (event: MouseEvent) => (() => void) | undefined
    open: (event: MouseEvent) => void
    origin: Snippet
    actions: Snippet
    preview: Snippet
  } = $props()
  let choice: HTMLButtonElement
  let restore: (() => void) | undefined
  let menu = $state(false)
  function focus() {
    choice.focus({ preventScroll: true })
  }
</script>

<div class="list-number">{@render origin()}</div>
<button
  class="page-grip icon-button"
  aria-label={`Select or drag ${pane} page ${number}${pane === "Input" ? " to Output" : ""}`}
  aria-pressed={selected}
  title={pane === "Input" ? "Drag to Output" : "Drag to move"}
  draggable="true"
  onmousedown={retainFocus}
  onclick={(event) => {
    inspect()
    toggle(event.shiftKey)
    focus()
  }}
  ondragstart={(event) => start(event, payload)}
  onpointerdown={(event) => transfer.press(event, payload)}
  ondragend={() => transfer.end()}><Icon name="reorder" /></button
>
<div class="list-label">
  <button
    bind:this={choice}
    class="list-choice"
    data-page={index}
    aria-label={`Select ${pane} page ${number}${name ? `: ${name}` : ""}`}
    title="Select or unselect this page. Shift-click selects a range."
    aria-pressed={selected}
    onfocus={inspect}
    draggable="true"
    onmousedown={retainFocus}
    onpointerdown={(event) => {
      if (event.pointerType === "mouse") transfer.press(event, payload)
    }}
    ondragstart={(event) => start(event, payload)}
    ondragend={() => transfer.end()}
    onclick={(event) => {
      if (event.detail <= 1) restore = select(event)
      if (event.detail) focus()
    }}
    ondblclick={(event) => {
      if (touch || event.ctrlKey || event.metaKey) return
      restore?.()
      restore = undefined
      open(event)
    }}>{label}</button
  >
  {#if sections > 1}<button
      class="list-sections"
      popovertarget={id}
      aria-label={`Show all ${sections} sections on Input page ${number}`}
      title="Show all sections on this page">{sections} sections</button
    >{/if}
</div>
<div class="list-actions">
  {#if selected}
    {#if pane === "Output"}<div class="occurrence-actions">{@render unselect()}</div>{:else}{@render unselect()}{/if}
  {:else}
    <span class="list-inline-actions">{@render actions()}</span>
    {#if pane === "Output"}
      <button
        class="icon-button list-menu"
        popovertarget={`${id}-actions`}
        aria-label={`Actions for Output page ${number}`}><Icon name="more" /></button
      >
      <div
        id={`${id}-actions`}
        class="card-menu-options list-row-menu"
        popover="auto"
        onbeforetoggle={(event) => (menu = event.newState === "open")}
      >
        {#if menu}{@render actions()}{/if}
      </div>
    {/if}
  {/if}
  {@render preview()}
</div>

{#snippet unselect()}
  <button
    class="icon-button"
    aria-label={`Unselect ${pane} page ${number}`}
    aria-pressed="true"
    title="Unselect this page"
    onclick={() => {
      toggle(false)
      focus()
    }}><Icon name="select" /></button
  >
{/snippet}
