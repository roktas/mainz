<!-- Renders the responsive workspace bar, pane switchers, and compact document menu. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import type { Source } from "./model.ts"
  import { observeSummary } from "./pane.svelte.ts"
  import type { Output } from "./output.svelte.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { TourStep } from "./Tour.svelte"
  import Icon from "./Icon.svelte"

  let {
    key,
    compact,
    source,
    output,
    editing,
    interaction,
    transfer,
    tour,
    downloadError,
    inputTarget = $bindable(),
    outputTarget = $bindable(),
    documentMenu = $bindable(),
    onSwitch,
    closeDocument,
    inputChoices,
    openPDF,
    outputName,
    viewAction,
    printAction,
    recipeAction,
    saveOutput,
  }: {
    key: string
    compact: boolean
    source?: Source
    output: Output
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    tour?: TourStep
    downloadError?: string
    inputTarget?: HTMLButtonElement
    outputTarget?: HTMLButtonElement
    documentMenu?: HTMLDivElement
    onSwitch: (view: "input" | "output", event: MouseEvent & { currentTarget: HTMLButtonElement }) => void
    closeDocument: () => void
    inputChoices: Snippet<[close: () => void, compact: boolean]>
    openPDF: Snippet
    outputName: Snippet<[menu?: boolean]>
    viewAction: Snippet<[menu?: boolean]>
    printAction: Snippet<[menu?: boolean]>
    recipeAction: Snippet<[menu?: boolean]>
    saveOutput: Snippet
  } = $props()
</script>

{#snippet totals(pages: number)}
  {@const sheets = Math.ceil(pages / 2)}
  <strong>{pages} {pages === 1 ? "page" : "pages"}</strong>, {sheets}
  {sheets === 1 ? "sheet" : "sheets"}
{/snippet}

<div class="workspace-bar">
  <nav class="mobile-workspace-tabs" aria-label="Workspace view">
    <button
      bind:this={inputTarget}
      id={`${key}-input-switch`}
      aria-label="Input"
      aria-describedby={`${key}-input-counts`}
      aria-pressed={interaction.activeView === "input" && !!source}
      popovertarget={compact && interaction.activeView === "input" ? `${key}-document-menu` : undefined}
      data-tour-target={compact ? "input" : undefined}
      data-tour-active={(compact && tour === "input") || undefined}
      disabled={!source}
      onclick={(event) => onSwitch("input", event)}
      ><span class="workspace-label">
        <span>Input</span>{#if interaction.activeView === "input"}<Icon name="next" />{/if}
      </span><small id={`${key}-input-counts`} class="workspace-counts" {@attach observeSummary}>
        <span class="composition-totals">{@render totals(editing.selection.count)}</span>
        <span class="page-count">{editing.selection.count} {editing.selection.count === 1 ? "page" : "pages"}</span>
      </small></button
    >
    <button
      bind:this={outputTarget}
      id={`${key}-output-switch`}
      aria-label="Output"
      aria-describedby={`${key}-output-counts`}
      aria-pressed={interaction.activeView === "output"}
      popovertarget={compact && interaction.activeView === "output" ? `${key}-document-menu` : undefined}
      data-drop={transfer.touching &&
      transfer.value?.kind === "source" &&
      interaction.activeView === "input" &&
      transfer.inside
        ? true
        : undefined}
      onclick={(event) => onSwitch("output", event)}
      ><span class="workspace-label">
        <span>Output</span>{#if interaction.activeView === "output"}<Icon name="next" />{/if}
      </span><small id={`${key}-output-counts`} class="workspace-counts" {@attach observeSummary}>
        <span class="composition-totals">{@render totals(output.pages.length)}</span>
        <span class="page-count">{output.pages.length} {output.pages.length === 1 ? "page" : "pages"}</span>
      </small></button
    >
  </nav>
  {#if compact}
    {#key interaction.activeView}
      <div
        id={`${key}-document-menu`}
        bind:this={documentMenu}
        class={["document-menu", interaction.activeView === "input" ? "input-list" : "document-actions"]}
        popover="auto"
        role="group"
        aria-label={interaction.activeView === "input" ? "Inputs" : "Output actions"}
      >
        {#if interaction.activeView === "input"}
          {@render inputChoices(closeDocument, true)}
        {:else}
          {@render outputName(true)}
          <hr />
          {@render viewAction(true)}{@render printAction(true)}{@render recipeAction(true)}
        {/if}
      </div>
    {/key}
    {#if interaction.activeView === "input" && source}
      {@render openPDF()}
    {:else}
      <div class="output-actions" data-tour-target="download" data-tour-active={tour === "download"}>
        {@render saveOutput()}
      </div>
    {/if}
  {/if}
</div>
