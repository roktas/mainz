<!-- Renders Output selection controls, sequence repetition tools, and batch edit actions. -->

<script lang="ts">
  import type { Output } from "./output.svelte.ts"
  import type { OutputView } from "./pane.svelte.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { TourStep } from "./Tour.svelte"
  import { pageRanges } from "./pages.ts"
  import { controlCapabilities } from "./Page.svelte"
  import Icon from "./Icon.svelte"
  import PageControls from "./PageControls.svelte"
  import Repetition from "./Repetition.svelte"
  import Selection from "./Selection.svelte"

  let {
    key,
    output,
    view,
    editing,
    interaction,
    transfer,
    tour,
    showComparison,
    comparing,
    onCompare,
  }: {
    key: string
    output: Output
    view: OutputView
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    tour?: TourStep
    showComparison: boolean
    comparing?: boolean
    onCompare: (menu?: boolean) => void
  } = $props()

  const chosen = $derived(output.selected)
</script>

{#snippet outputMoves(inline = false)}
  {#if chosen.length || tour === "output-selection"}<button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages earlier"
      title={`Move selected pages earlier · Ctrl/⌘+${view.active === "list" ? "↑" : "←"}`}
      disabled={!chosen.length || !!editing.selection.outputSelectionError || editing.positions[0] === 0}
      onclick={() => editing.commandOutput("earlier")}
      ><Icon name={view.active === "list" ? "move-up" : "earlier"} />{#if !inline}Earlier{/if}</button
    >
    <button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages later"
      title={`Move selected pages later · Ctrl/⌘+${view.active === "list" ? "↓" : "→"}`}
      disabled={!chosen.length ||
        !!editing.selection.outputSelectionError ||
        editing.positions.at(-1) === output.pages.length - 1}
      onclick={() => editing.commandOutput("later")}
      ><Icon name={view.active === "list" ? "move-down" : "later"} />{#if !inline}Later{/if}</button
    >{/if}
{/snippet}

{#snippet outputTools()}
  <details class="sequence-options output-options" bind:this={view.menu}>
    <summary id={`${key}-output-actions`} aria-label="Output page actions" title="Output page actions"
      ><Icon name="more" /></summary
    >
    <div class="menu-options">
      <div class="selected-actions">
        {#if view.active === "page"}
          <PageControls
            pane="Output"
            menu
            zoom={view.zoom}
            showComparison={showComparison && !controlCapabilities[view.controls].comparison}
            showZoom={!controlCapabilities[view.controls].zoom}
            showFit={!controlCapabilities[view.controls].fit}
            {comparing}
            onCompare={() => onCompare(true)}
            onZoomBy={(offset) => interaction.zoomBy("Output", offset)}
            onResetZoom={() => interaction.setZoom("Output", 100)}
            onFitWidth={() => view.page?.fitWidth()}
          />
        {/if}
        <div class="menu-moves">{@render outputMoves()}</div>
        {#if chosen.length}<button
            disabled={!!editing.selection.outputSelectionError}
            onclick={() => editing.blank(editing.positions[0])}
            title="Insert a blank before the first selected page">Before</button
          >{/if}
        <button
          disabled={!output.pages.length}
          onclick={() => editing.blank(output.position + 1)}
          title="Insert a blank page after the current Output page"><Icon name="blank-after" />Blank after this</button
        >
        <button
          disabled={!output.pages.length}
          onclick={() => editing.blank(output.pages.length)}
          title="Insert a blank page after the last Output page"><Icon name="blank-last" />Blank after last</button
        >
      </div>
      {#if chosen.length && editing.adjacent}
        <Repetition pane="Output" bind:value={editing.repetitions} bind:front={editing.front} />
        {#if Number(editing.repetitions) !== 1 || editing.front}<button
            disabled={!!editing.repeatError || !!editing.selection.outputSelectionError}
            onclick={editing.repeat}>Repeat</button
          >{/if}
      {:else if chosen.length}<p>Select consecutive pages to repeat a sequence.</p>{/if}
    </div>
  </details>
{/snippet}

<Selection
  id={`${key}-output-selection`}
  pane="Output"
  value={editing.selection.outputText ?? pageRanges(editing.positions)}
  invalid={!!editing.selection.outputSelectionError}
  error={editing.selection.outputSelectionError}
  disabled={!output.pages.length}
  change={editing.selection.outputNumbers}
  submit={() => editing.commandOutput("remove")}
  hiddenHint={!!transfer.value}
  highlight={editing.selection.highlight?.kind === "output"
    ? editing.selection.highlight.removing
      ? "remove"
      : "range"
    : undefined}
  tour={tour === "output-selection"}
>
  {#snippet menu()}
    {#if output.pages.length || tour === "output-selection"}{@render outputTools()}{/if}
  {/snippet}
  {#snippet actions()}
    {#if output.pages.length && (editing.positions.length < output.pages.length || editing.selection.outputSelectionError)}<button
        class="step"
        aria-label="Select all"
        title="Select all · Ctrl+A / ⌘A"
        aria-keyshortcuts="Control+A Meta+A"
        onclick={(event) => {
          editing.selection.selectAll("Output")
          interaction.focusAfterSelection("Output", event)
        }}><Icon name="select" /></button
      >{/if}
    {#if chosen.length || editing.selection.outputText}<button
        class="reset"
        aria-label="Clear Output selection"
        title="Clear selection to use page actions"
        onclick={(event) => {
          editing.selection.clearOutput()
          interaction.focusAfterSelection("Output", event)
        }}><Icon name="close" /></button
      >{/if}
    {#if chosen.length || tour === "output-selection"}
      <div class="output-selection" role="group" aria-label="Selected Output pages">
        <div class="inline-moves">{@render outputMoves(true)}</div>
        <button
          class="step danger"
          aria-label="Remove selected Output pages"
          title="Remove selected pages · Delete"
          disabled={!chosen.length || !!editing.selection.outputSelectionError}
          onclick={() => editing.commandOutput("remove")}><Icon name="remove" /></button
        ><button
          class="step primary"
          aria-label="Duplicate selected Output pages"
          title="Add one copy of the selected pages."
          disabled={!chosen.length || !!editing.selection.outputSelectionError}
          onclick={() => editing.commandOutput("duplicate")}><Icon name="add" /></button
        >
      </div>
    {/if}
  {/snippet}
  {#snippet hint()}
    {#if chosen.length}<strong>{chosen.length} {chosen.length === 1 ? "page" : "pages"} selected</strong> · Use the selection
      bar.{:else if view.active === "page"}Select in Grid or type numbers.{:else}Select pages or type numbers.{/if}
  {/snippet}
  {#snippet feedback()}
    {#if transfer.value}<span class="drag-status"
        ><strong
          >{transfer.value.kind === "output"
            ? transfer.value.ids.length === 1
              ? "Move this page"
              : `Move ${transfer.value.ids.length} pages`
            : transfer.value.choice.kind === "preparation"
              ? "Add sequence"
              : transfer.value.choice.kind === "pages"
                ? `Add ${transfer.value.choice.pages.length} pages`
                : `Add Input page ${transfer.value.choice.page + 1}`}</strong
        >
        <span class="drop-description visually-hidden">
          · {transfer.blocked
            ? "Drop outside the selection."
            : transfer.inside
              ? `Release · ${transfer.label}`
              : "Drag into Output"}</span
        >
      </span>{/if}
  {/snippet}
</Selection>
