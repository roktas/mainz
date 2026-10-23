<!-- Presents a pane's selection field, action snippets, and local feedback. -->

<script lang="ts">
  import type { Snippet } from "svelte"

  let {
    id,
    pane,
    value,
    invalid = false,
    error,
    disabled = false,
    change,
    submit,
    menu,
    actions,
    hint,
    feedback,
    hiddenHint = false,
    highlight,
    tour = false,
  }: {
    id: string
    pane: "Input" | "Output"
    value: string
    invalid?: boolean
    error?: string
    disabled?: boolean
    change: (text: string) => void
    submit: () => void
    menu: Snippet
    actions: Snippet
    hint: Snippet
    feedback?: Snippet
    hiddenHint?: boolean
    highlight?: "range" | "remove"
    tour?: boolean
  } = $props()
</script>

<div
  class="sequence-entry"
  data-tour-target={pane === "Output" ? "output-selection" : undefined}
  data-tour-active={tour}
  class:range-highlight={!!highlight}
  class:removing={highlight === "remove"}
>
  <div class={["entry", { invalid }]}>
    {@render menu()}
    <input
      {id}
      {disabled}
      {value}
      aria-label="Page selection"
      inputmode="numeric"
      autocomplete="off"
      autocapitalize="off"
      spellcheck={false}
      placeholder={pane === "Input" ? "Example: 3-5,2,2,7" : "Example: 2,4-6"}
      title={pane === "Input"
        ? "Page numbers in order, including copies. Example: 3-5,2,2,7."
        : "Output page numbers and ranges. Repeated numbers select the same page once."}
      aria-invalid={invalid}
      aria-describedby={`${id}-hint`}
      oninput={(event) => change(event.currentTarget.value)}
      onkeydown={(event) => {
        if (
          event.key === "Enter" &&
          !event.isComposing &&
          !event.altKey &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.shiftKey
        ) {
          event.preventDefault()
          if (!event.repeat) submit()
        }
      }}
    />
    {@render actions()}
  </div>
  <p id={`${id}-hint`} class="sequence-help" role={error ? "alert" : pane === "Output" ? "status" : undefined}>
    <span aria-hidden={!!error || hiddenHint}>{@render hint()}</span>
    {#if error}<span class="error">{error}</span>{:else}{@render feedback?.()}{/if}
  </p>
</div>
