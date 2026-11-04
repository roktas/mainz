<!-- Keeps Input results stable and exposes explicit review and approval from the header. -->

<script lang="ts">
  import { tick } from "svelte"
  import type { Diagnostic, InputCheck } from "./recipe.ts"
  import Icon from "./Icon.svelte"
  import Feedback from "./Feedback.svelte"
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
  let trigger: HTMLButtonElement
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

{#if state === "review" && !accepted}<Feedback header kind="notice">
    <p role="status">
      <button
        type="button"
        class="feedback-action"
        aria-label="Review PDF"
        onclick={() => {
          trigger.scrollIntoView({ block: "nearest", behavior: "instant" })
          const header = document.querySelector(".header-inner")?.getBoundingClientRect()
          const box = trigger.getBoundingClientRect()
          if (header && box.top < header.bottom) scrollBy({ top: box.top - header.bottom, behavior: "instant" })
          trigger.click()
        }}>Review PDF</button
      >
    </p>
  </Feedback>{:else}<Feedback
    header
    kind="error"
    summary="PDF cannot be used."
    text={state === "error"
      ? `${filename || title}: ${failure || check?.diagnostics.map((item) => item.message).join(" ") || result}`
      : undefined}
  />{/if}
<button
  bind:this={trigger}
  type="button"
  class="binding-result"
  popovertarget={`${key}-check`}
  aria-label={`Input result for ${title}`}
  aria-describedby={`${key}-result`}
  title={state === "review" ? "Review PDF" : `${result} · Details`}
>
  <span class="binding-file" title={filename}>{filename || "PDF unavailable"}</span>
  <span id={`${key}-result`} class="binding-status control-description"><span>{result}</span></span>
</button>
<div
  id={`${key}-check`}
  class="guidance binding-check"
  popover="auto"
  role="dialog"
  aria-label={state === "review" ? `Review ${filename || title}` : `${result} · ${title}`}
  tabindex="-1"
  ontoggle={(event) => {
    if (event.newState === "open") {
      event.currentTarget.querySelector<HTMLElement>(".binding-details")!.scrollTop = 0
      event.currentTarget.focus({ preventScroll: true })
    }
  }}
>
  <!-- Keyboard users need a focusable region for native scrolling. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div class="binding-details" role="region" aria-label="PDF check details" tabindex="0">
    <button
      class="icon-button"
      popovertarget={`${key}-check`}
      popovertargetaction="hide"
      aria-label={state === "review" ? "Close review" : "Close details"}
      title={state === "review" ? "Close review" : "Close details"}><Icon name="close" /></button
    >
    {#if state === "review"}<p>Approve this PDF to enable Apply recipe when all Inputs are ready.</p>{/if}
    {#snippet explanation(item: Diagnostic)}
      <p>{item.message}</p>
      {#if typeof item.expected === "number" && typeof item.actual === "number"}
        <p class="control-description">Saved: {item.expected} · Selected: {item.actual}</p>
      {/if}
    {/snippet}
    {#if failure}<p>{failure}</p>
    {:else if check && check.diagnostics.length > 1}
      <ul>
        {#each check.diagnostics as item, index (index)}
          <li>{@render explanation(item)}</li>
        {/each}
      </ul>
    {:else if check?.diagnostics[0]}{@render explanation(check.diagnostics[0])}
    {:else}<p>The selected PDF matches this Recipe's saved Input.</p>{/if}
  </div>
  {#if state === "review"}
    <button
      type="button"
      class="binding-accept primary"
      {disabled}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        accept(true)
        void tick().then(() => {
          const next =
            document.querySelector<HTMLButtonElement>('.header-feedback button[aria-label="Review PDF"]') ??
            document.querySelector<HTMLButtonElement>(".load-actions .primary:not(:disabled)") ??
            trigger
          next.focus({ preventScroll: true })
        })
      }}>Use anyway</button
    >
  {/if}
</div>
