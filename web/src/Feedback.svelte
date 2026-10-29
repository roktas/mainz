<!-- Presents application notifications, progress, and recovery actions in the header. -->

<script lang="ts">
  import { onDestroy, tick } from "svelte"
  import type { Snippet } from "svelte"
  import Icon from "./Icon.svelte"

  let {
    kind,
    text,
    actions,
    children,
    class: className,
  }: {
    kind: "notice" | "progress" | "error"
    text?: string
    actions?: Snippet
    children?: Snippet
    class?: string
  } = $props()
  let focused = false
  onDestroy(() => {
    if (focused)
      void tick().then(() =>
        document.querySelector<HTMLButtonElement>(".header-actions .help-button")?.focus({ preventScroll: true }),
      )
  })
</script>

<div
  class={["feedback", className]}
  data-kind={kind}
  onfocusin={() => (focused = true)}
  onfocusout={(event) => {
    const element = event.currentTarget
    // Removing a focused control blurs it before Svelte runs teardown.
    queueMicrotask(() => (focused = element.contains(document.activeElement)))
  }}
>
  {#if kind === "progress"}<span class="spinner" aria-hidden="true"></span>{:else}<Icon name="info" />{/if}
  <div class="feedback-message">
    {#if text}<p
        role={kind === "error" ? "alert" : "status"}
        aria-atomic="true"
        title={kind === "progress" ? text : undefined}
      >
        {text}
      </p>{/if}
    {@render children?.()}
  </div>
  {#if actions}<div class="feedback-actions">{@render actions()}</div>{/if}
</div>
