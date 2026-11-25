<!-- Renders Input page-range selection, page tools, and transfer actions. -->

<script lang="ts">
  import type { InputViews } from "./pane.svelte.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import { controlCapabilities } from "./Page.svelte"
  import Icon from "./Icon.svelte"
  import PageControls from "./PageControls.svelte"
  import Repetition from "./Repetition.svelte"
  import Selection from "./Selection.svelte"

  let {
    key,
    view,
    editing,
    interaction,
    transfer,
    hasStyles,
    styleable,
  }: {
    key: string
    view: InputViews
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    hasStyles: boolean
    styleable: boolean
  } = $props()

  const count = $derived(editing.selection.count)
  const draft = $derived(editing.selection.draft)
  const allInput = $derived(
    !editing.selection.invalid && draft.pages.length === count && draft.pages.every((page, index) => page === index),
  )
</script>

{#snippet inputTools()}
  <details class="sequence-options input-options" bind:this={view.menu}>
    <summary aria-label="Input page actions" title="Input page actions"><Icon name="more" /></summary>
    <div class="menu-options">
      {#if view.active === "page" && !controlCapabilities[view.controls].zoom}
        <PageControls
          pane="Input"
          menu
          zoom={view.current.zoom}
          showFit={!controlCapabilities[view.controls].fit}
          onZoomBy={(offset) => interaction.zoomBy("Input", offset)}
          onResetZoom={() => interaction.setZoom("Input", 100)}
          onFitWidth={() => view.page?.fitWidth()}
        />
      {/if}
      <Repetition
        pane="Input"
        bind:value={() => draft.repeat, (repeat) => editing.selection.set({ repeat })}
        bind:front={() => draft.front, (front) => editing.selection.set({ front })}
      />
    </div>
  </details>
{/snippet}

<Selection
  id={`${key}-input-selection`}
  pane="Input"
  value={draft.text}
  invalid={editing.selection.invalid}
  error={editing.selection.selectionError}
  change={editing.selection.numbers}
  submit={() => editing.commandInput()}
  menu={inputTools}
>
  {#snippet actions()}
    {#if !allInput}<button
        class="step"
        aria-label="Select all"
        title="Select all · Ctrl+A / ⌘A"
        aria-keyshortcuts="Control+A Meta+A"
        onclick={(event) => {
          editing.selection.selectAll("Input")
          interaction.focusAfterSelection("Input", event)
        }}><Icon name="select" /></button
      >{/if}
    {#if draft.text || draft.pages.length || draft.repeat !== "1" || draft.front}<button
        class="reset"
        aria-label="Clear page sequence"
        title="Clear"
        onclick={(event) => {
          editing.selection.clearInput()
          interaction.focusAfterSelection("Input", event)
        }}><Icon name="close" /></button
      >{/if}
    {#if draft.pages.length}<button
        class="step transfer primary"
        aria-label="Add to Output"
        title={`Add to Output${editing.insertion === undefined ? " at the end" : ` after page ${editing.insertion}`}.`}
        draggable="true"
        disabled={!!editing.selection.selectionError}
        ondragstart={(event) => editing.start(event, editing.inputPayload())}
        onpointerdown={(event) => transfer.press(event, editing.inputPayload())}
        onpointerup={(event) => transfer.tap(event, () => editing.commandInput())}
        ondragend={() => transfer.end()}
        onclick={() => editing.commandInput()}><Icon name="add" /></button
      >{/if}
  {/snippet}
  {#snippet hint()}
    {#if draft.pages.length}<strong>{draft.pages.length} {draft.pages.length === 1 ? "page" : "pages"} selected</strong> ·
    {/if}
    {draft.pages.length
      ? editing.insertion === undefined
        ? "Append to Output."
        : `Add after Output ${editing.insertion}.`
      : "Select pages or type numbers."}
    {#if draft.repeat !== "1" || draft.front}
      Repeat ×{draft.repeat}{draft.front ? " · Front aligned" : ""}.{/if}
    {#if hasStyles && !styleable}<span id={`${key}-style-unavailable`}>Style needs applicable Output pages.</span>{/if}
  {/snippet}
</Selection>
