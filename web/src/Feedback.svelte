<!-- Routes scoped messages to the header and presents summaries, details, and recovery actions. -->

<script module lang="ts">
  import { createContext } from "svelte"
  import type { Snippet } from "svelte"

  export type Report = {
    kind: "notice" | "progress" | "error"
    text?: string
    details?: string | string[]
    actions?: Snippet
    children?: Snippet
  }
  export const [useFeedback, provideFeedback] = createContext<(report: Report) => () => void>()
</script>

<script lang="ts">
  import { onDestroy, tick, untrack } from "svelte"
  import Icon from "./Icon.svelte"

  let {
    kind,
    text,
    summary,
    details,
    actions,
    children,
    class: className,
    header = false,
    active = true,
    id,
    menu = true,
  }: {
    kind: "notice" | "progress" | "error"
    text?: string
    summary?: string
    details?: string | string[]
    actions?: Snippet
    children?: Snippet
    class?: string
    header?: boolean
    active?: boolean
    id?: string
    menu?: boolean
  } = $props()
  const key = $props.id()
  const label = $derived((summary || text)?.replace(/(?<!\.)\.$/, ""))
  const explanation = $derived(details || (summary && summary !== text ? text : undefined))
  const expandable = $derived(!!explanation || (menu && kind !== "progress" && !!actions))
  const publish = useFeedback()
  $effect(() => {
    const report = { kind, text: label, details: explanation, actions, children }
    // Registration updates the header owner without tracking its report list.
    if (header && active && (text || children)) return untrack(() => publish(report))
  })
  let focused = false
  onDestroy(() => {
    if (focused)
      void tick().then(() => {
        const modal = document.querySelector<HTMLDialogElement>("dialog:modal")
        const target =
          modal?.querySelector<HTMLElement>("input:not(:disabled), button:not(:disabled)") ??
          document.querySelector<HTMLButtonElement>(".header-feedback button, .header-actions .help-button")
        target?.focus({ preventScroll: true })
      })
  })
</script>

{#if header}
  {#if id}<span {id} hidden>{text}</span>{/if}
{:else}<div
    class={["feedback", className]}
    data-kind={kind}
    onfocusin={() => (focused = true)}
    onfocusout={(event) => {
      const element = event.currentTarget
      // Removing a focused control blurs it before Svelte runs teardown.
      queueMicrotask(() => (focused = element.contains(document.activeElement)))
    }}
  >
    {#if kind === "progress"}<span class="spinner" aria-hidden="true"></span>{/if}
    <div class="feedback-message">
      {#if label}<p role={kind === "error" ? "alert" : "status"} aria-atomic="true" title={label}>
          {#if expandable}<button type="button" class="feedback-action" popovertarget={`${key}-details`}>{label}</button
            >{:else}{label}{/if}
        </p>{/if}
      {@render children?.()}
    </div>
    {#if actions && (!menu || kind === "progress")}<div class="feedback-actions">
        {@render actions()}
      </div>{/if}
    {#if expandable}<div
        id={`${key}-details`}
        class="message-details"
        popover="auto"
        aria-label={explanation ? "Message details" : "Message actions"}
      >
        <button
          type="button"
          class="icon-button"
          popovertarget={`${key}-details`}
          popovertargetaction="hide"
          aria-label="Close message details"
          title="Close"><Icon name="close" /></button
        >
        {#if Array.isArray(explanation)}
          <!-- Keyboard users need a focusable list for native scrolling. -->
          <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
          <ul tabindex="0" aria-label="File errors">
            {#each explanation as item, index (index)}<li>{item}</li>{/each}
          </ul>{:else if explanation}<p>{explanation}</p>{/if}
        {#if menu && kind !== "progress" && actions}<div class="feedback-actions">{@render actions()}</div>{/if}
      </div>{/if}
  </div>
{/if}
