<!-- Presents page identity and source details in Normal disclosures and Compact preview menus. -->

<script lang="ts">
  import type { Snippet } from "svelte"

  let {
    id,
    pane,
    number,
    label,
    compact,
    opened = $bindable(),
    details,
    children,
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    label?: string
    compact: boolean
    opened?: string
    details?: Snippet
    children: Snippet
  } = $props()
</script>

{#snippet identity()}
  <strong><span>{number}</span></strong>
  {#if label && label !== String(number)}<span class="page-context">{label}</span>{/if}
{/snippet}

{#if compact}
  <span class="page-origin">
    <button class="card-number" popovertarget={id} aria-label={`Details for ${pane} page ${number}`}>
      <strong>{number}</strong>
    </button>
    <div
      {id}
      class="card-menu-options"
      popover="auto"
      onbeforetoggle={(event) => {
        if (event.newState === "open") opened = id
        else if (opened === id) opened = undefined
      }}
    >
      {#if opened === id}
        <strong>{pane} · page {number}</strong>
        {@render children()}
      {/if}
    </div>
  </span>
{:else if details}
  <details class="page-origin" open={opened === id}>
    <summary
      aria-label={`Details for ${pane} page ${number}`}
      onclick={(event) => {
        event.preventDefault()
        opened = opened === id ? undefined : id
      }}>{@render identity()}</summary
    >
    <div {id} class="page-origin-info">{@render details()}</div>
  </details>
{:else}
  <span class="page-number">{@render identity()}</span>
{/if}
