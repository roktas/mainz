<!-- Edits the workspace's Output filename while preserving its dynamic default. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  let { value = $bindable(""), suggest }: { value?: string; suggest: () => string } = $props()
  const key = $props.id()
  let panel: HTMLDivElement
  let draft = $state("")
  let suggested = ""
  const error = $derived(
    !draft.trim()
      ? "Enter a filename."
      : // oxlint-disable-next-line no-control-regex -- Filenames cannot contain control characters.
        /[/\\\u0000-\u001f\u007f-\u009f]/.test(draft)
        ? "Use a filename without slashes or control characters."
        : "",
  )
  export function show(source: HTMLElement) {
    suggested = suggest()
    draft = value || suggested
    panel.showPopover({ source })
  }
  function save(event: SubmitEvent) {
    event.preventDefault()
    if (error) return
    const text = draft.trim()
    value = text === suggested ? "" : /\.pdf$/i.test(text) ? text : `${text}.pdf`
    panel.hidePopover()
  }
</script>

<div bind:this={panel} class="filename-panel" popover="auto" aria-labelledby={`${key}-title`}>
  <form onsubmit={save}>
    <div class="dialog-heading">
      <h3 id={`${key}-title`}>Output filename</h3>
      <button
        type="button"
        class="icon-button"
        aria-label="Close filename"
        title="Close"
        onclick={() => panel.hidePopover()}><Icon name="close" /></button
      >
    </div>
    <label for={`${key}-input`}>Filename</label>
    <div class={["entry", { invalid: !!error }]}>
      <input
        id={`${key}-input`}
        type="text"
        bind:value={draft}
        required
        spellcheck={false}
        autocomplete="off"
        aria-invalid={!!error}
        aria-describedby={error ? `${key}-error` : undefined}
      />
    </div>
    {#if error}<p id={`${key}-error`} class="error" role="alert">{error}</p>{/if}
    <div class="filename-actions">
      <button
        type="button"
        onclick={() => {
          value = ""
          panel.hidePopover()
        }}>Use default</button
      >
      <button type="submit" class="primary" disabled={!!error}>Save</button>
    </div>
  </form>
</div>
