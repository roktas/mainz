<!-- Edits Output filename, document title, and cover page while preserving useful defaults. -->

<script lang="ts">
  import { filename, filenameError, titleError } from "./model.ts"
  import Icon from "./Icon.svelte"
  import Feedback from "./Feedback.svelte"
  let {
    value = $bindable(""),
    title = $bindable(""),
    coverPage = $bindable(1),
    pages,
    suggest,
    suggestTitle,
    reset,
    preview,
  }: {
    value?: string
    title?: string
    coverPage?: number
    pages: number
    suggest: () => string
    suggestTitle: () => string
    reset: () => void
    preview: (page: number) => Promise<string>
  } = $props()
  const key = $props.id()
  let panel: HTMLDivElement
  let opened = $state(false)
  let draft = $state("")
  let suggested = ""
  let suggestedTitle = ""
  let titleDraft = $state("")
  let coverDraft = $state<number | undefined>(1)
  let picture = $state("")
  let revision = 0
  const titleIssue = $derived(titleError(titleDraft))
  const coverIssue = $derived(
    pages > 0 && (!Number.isSafeInteger(coverDraft) || coverDraft! < 1 || coverDraft! > pages)
      ? `Choose a cover page from 1 to ${pages}.`
      : "",
  )
  const identityError = $derived(titleIssue || coverIssue)
  async function renderCover() {
    const generation = ++revision
    picture = ""
    if (!pages || coverIssue) return
    try {
      const png = await preview(coverDraft!)
      if (generation === revision) picture = png
    } catch {
      /* Cover inspection does not discard the editable file details. */
    }
  }
  const error = $derived(filenameError(draft))
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
    value = text === suggested ? "" : filename(text, ".pdf")
    title = titleDraft.trim() === suggestedTitle ? "" : titleDraft.trim()
    if (pages > 0 && coverDraft !== undefined) coverPage = coverDraft
    panel.hidePopover()
  }
</script>

<div
  bind:this={panel}
  class="filename-panel"
  role="dialog"
  popover="auto"
  aria-labelledby={`${key}-title`}
  ontoggle={(event) => (opened = event.newState === "open")}
>
  <form onsubmit={save} novalidate>
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
    <Feedback header active={opened} kind="error" text={error} summary="Check the filename." id={`${key}-error`} />
    <label for={`${key}-document-title`}>Title</label>
    <div class={["entry", { invalid: !!titleIssue }]}>
      <input
        id={`${key}-document-title`}
        type="text"
        bind:value={titleDraft}
        required
        aria-invalid={!!titleIssue}
        aria-describedby={identityError ? `${key}-identity-error` : undefined}
      />
    </div>
    {#if pages > 0}
      <div class="file-cover">
        <div class="file-cover-image">
          {#if picture}<img src={picture} alt={`Cover · page ${coverDraft}`} />{/if}
        </div>
        <div class="file-cover-field">
          <label for={`${key}-cover`}>Cover page</label>
          <div class={["entry", { invalid: !!coverIssue }]}>
            <input
              id={`${key}-cover`}
              type="number"
              min="1"
              max={pages}
              step="1"
              bind:value={coverDraft}
              aria-invalid={!!coverIssue}
              aria-describedby={identityError ? `${key}-identity-error` : undefined}
              onchange={() => void renderCover()}
              required
            />
          </div>
          <p class="control-description">The first page is the default cover.</p>
        </div>
      </div>
    {/if}
    <Feedback
      header
      active={opened}
      kind="error"
      text={identityError}
      summary="Check title and cover."
      id={`${key}-identity-error`}
    />
    <div class="filename-actions">
      <button
        type="button"
        onclick={() => {
          reset()
          panel.hidePopover()
        }}>Use default</button
      >
      <button type="submit" class="primary" disabled={!!error || !!identityError}>Save</button>
    </div>
  </form>
</div>
