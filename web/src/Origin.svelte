<!-- Presents page identity with card disclosures and anchored List or Compact menus. -->

<script lang="ts">
  import { flushSync } from "svelte"
  import type { Snippet } from "svelte"

  let {
    id,
    pane,
    number,
    label,
    name,
    mode,
    opened = $bindable(),
    details,
    children,
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    label?: string
    name?: string
    mode: "normal" | "compact" | "list"
    opened?: string
    details?: Snippet
    children: Snippet
  } = $props()
</script>

{#snippet identity()}
  <strong><span>{number}</span></strong>
  {#if label && label !== String(number)}<span class="page-context">{label}</span>{/if}
{/snippet}
{#snippet caption()}
  {#if name && opened !== id}<p class="page-name">{name}</p>{/if}
{/snippet}

{#if mode === "compact" || (mode === "list" && details)}
  <span class="page-origin">
    <button
      class={mode === "list" ? "icon-button" : "card-number"}
      popovertarget={id}
      aria-label={`Details for ${pane} page ${number}`}
    >
      {#if mode === "list"}{@render identity()}{:else}<strong>{number}</strong>{/if}
    </button>
    {@render caption()}
    <div
      {id}
      class="card-menu-options"
      data-preview={mode === "compact" || undefined}
      popover="auto"
      onbeforetoggle={(event) => {
        if (event.newState === "open")
          flushSync(() => {
            opened = id
          })
        else if (opened === id) opened = undefined
      }}
    >
      {#if opened === id}
        {#if name}<p class="detail-name">{name}</p>{/if}
        {#if mode === "compact"}
          <strong>{pane} · page {number}</strong>
          {@render children()}
        {:else if details}
          {@render details()}
        {/if}
      {/if}
    </div>
  </span>
{:else if details}
  <details class="page-origin" open={opened === id}>
    <summary
      aria-label={`Details for ${pane} page ${number}`}
      onclick={(event) => {
        event.preventDefault()
        flushSync(() => {
          opened = opened === id ? undefined : id
        })
      }}>{@render identity()}{@render caption()}</summary
    >
    <div {id} class="page-origin-info">
      {#if name}<p class="detail-name">{name}</p>{/if}{@render details()}
    </div>
  </details>
{:else}
  <span class="page-number">{@render identity()}{@render caption()}</span>
{/if}
