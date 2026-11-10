<!-- Owns List page selection, drag handles, and inline page actions. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import { retainFocus } from "./drag.ts"
  import type { Transfer, Payload } from "./transfer.svelte.ts"
  import Icon from "./Icon.svelte"

  let {
    pane,
    number,
    index,
    name,
    label,
    pdfLabel,
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
    name?: string
    label: string
    pdfLabel?: string
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
  function focus() {
    choice.focus({ preventScroll: true })
  }
</script>

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
<div class="list-number">{@render origin()}</div>
{#if pdfLabel && pdfLabel !== String(index + 1)}<span
    class="list-pdf-label"
    aria-label={`Page Label: ${pdfLabel}`}
    title={pdfLabel}>{pdfLabel}</span
  >{/if}
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
</div>
<div class="list-actions">
  {#if pane === "Output"}
    {@render actions()}
  {:else if selected}
    {@render unselect()}
  {:else}
    <span class="list-inline-actions">{@render actions()}</span>
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
