<!-- Edits Output filename, document title, and cover page while preserving useful defaults. -->

<script lang="ts">
  import { titleError } from "./model.ts"
  import Icon from "./Icon.svelte"
  let {
    value = $bindable(""),
    title = $bindable(""),
    coverPage = $bindable(1),
    pages,
    suggest,
    suggestTitle,
    preview,
  }: {
    value?: string
    title?: string
    coverPage?: number
    pages: number
    suggest: () => string
    suggestTitle: () => string
    preview: (page: number) => Promise<string>
  } = $props()
  const key = $props.id()
  let panel: HTMLDivElement
  let draft = $state("")
  let suggested = ""
  let suggestedTitle = ""
  let titleDraft = $state("")
  let coverDraft = $state<number | undefined>(1)
  let picture = $state("")
  let revision = 0
  const identityError = $derived(
    titleError(titleDraft) ||
      (!Number.isSafeInteger(coverDraft) || coverDraft! < 1 || coverDraft! > pages
        ? `Choose a cover page from 1 to ${pages}.`
        : ""),
  )
  async function renderCover() {
    const generation = ++revision
    picture = ""
    if (identityError) return
    try {
      const png = await preview(coverDraft!)
      if (generation === revision) picture = png
    } catch {
      /* Cover inspection does not discard the editable file details. */
    }
  }
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
    suggestedTitle = suggestTitle()
    titleDraft = title || suggestedTitle
    coverDraft = coverPage
    void renderCover()
    panel.showPopover({ source })
  }
  function save(event: SubmitEvent) {
    event.preventDefault()
    if (error || identityError) return
    const text = draft.trim()
    value = text === suggested ? "" : /\.pdf$/i.test(text) ? text : `${text}.pdf`
    title = titleDraft.trim() === suggestedTitle ? "" : titleDraft.trim()
    coverPage = coverDraft!
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
    <label for={`${key}-document-title`}>Title</label>
    <div class="entry"><input id={`${key}-document-title`} type="text" bind:value={titleDraft} required /></div>
    <div class="file-cover">
      <div class="file-cover-image">
        {#if picture}<img src={picture} alt={`Cover · page ${coverDraft}`} />{/if}
      </div>
      <div class="file-cover-field">
        <label for={`${key}-cover`}>Cover page</label>
        <div class="entry">
          <input
            id={`${key}-cover`}
            type="number"
            min="1"
            max={pages}
            step="1"
            bind:value={coverDraft}
            onchange={() => void renderCover()}
            required
          />
        </div>
        <p class="control-description">The first page is the default cover.</p>
      </div>
    </div>
    {#if identityError}<p class="error" role="alert">{identityError}</p>{/if}
    <div class="filename-actions">
      <button
        type="button"
        onclick={() => {
          value = ""
          title = ""
          coverPage = 1
          panel.hidePopover()
        }}>Use default</button
      >
      <button type="submit" class="primary" disabled={!!error || !!identityError}>Save</button>
    </div>
  </form>
</div>
