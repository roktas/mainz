<!-- Shows an Input result without changing its row geometry; a popover owns explanations and review acceptance. -->

<script lang="ts">
  import type { Diagnostic, InputCheck } from "./recipe.ts"
  import Icon from "./Icon.svelte"
  let {
    title,
    filename,
    check,
    failure,
    accepted,
    disabled,
    accept,
  }: {
    title: string
    filename?: string
    check?: InputCheck
    failure?: string
    accepted: boolean
    disabled: boolean
    accept: (value: boolean) => void
  } = $props()
  const key = $props.id()
  const state = $derived(failure ? "error" : check?.state)
  const result = $derived(
    state === "error"
      ? "Cannot apply"
      : state === "review"
        ? accepted
          ? "Review accepted"
          : "Review required"
        : state === "update"
          ? "Update available"
          : "Ready",
  )
</script>

<button
  type="button"
  class="binding-result"
  popovertarget={`${key}-check`}
  aria-label={`Input result for ${title}`}
  aria-describedby={`${key}-result`}
  title={`${result} · Details`}
>
  <span class="binding-file" title={filename}>{filename || "PDF unavailable"}</span>
  <span id={`${key}-result`} class="binding-status control-description"
    ><span>{result}</span><Icon name={state === "error" ? "ban" : state === "review" ? "warning" : "check"} /></span
  >
</button>
<div
  id={`${key}-check`}
  class="guidance binding-check"
  popover="auto"
  role="dialog"
  aria-label={`${result} · ${title}`}
  tabindex="-1"
  ontoggle={(event) => {
    if (event.newState === "open") {
      event.currentTarget.scrollTop = 0
      event.currentTarget.focus({ preventScroll: true })
    }
  }}
>
  <button
    class="icon-button"
    popovertarget={`${key}-check`}
    popovertargetaction="hide"
    aria-label="Close details"
    title="Close details"><Icon name="close" /></button
  >
  {#snippet explanation(item: Diagnostic)}
    <p>{item.message}</p>
    {#if typeof item.expected === "number" && typeof item.actual === "number"}
      <p class="control-description">Saved: {item.expected} · Selected: {item.actual}</p>
    {/if}
  {/snippet}
  {#if failure}<p role="alert">{failure}</p>
  {:else if check && check.diagnostics.length > 1}
    <ul>
      {#each check.diagnostics as item, index (index)}
        <li>{@render explanation(item)}</li>
      {/each}
    </ul>
  {:else if check?.diagnostics[0]}{@render explanation(check.diagnostics[0])}
  {:else}<p>The selected PDF matches this Recipe's saved Input.</p>{/if}
  {#if state === "review"}
    <label class="binding-accept"
      ><input
        type="checkbox"
        {disabled}
        checked={accepted}
        onchange={(event) => accept(event.currentTarget.checked)}
      />Use this PDF anyway</label
    >
  {/if}
</div>
