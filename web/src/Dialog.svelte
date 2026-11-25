<!-- Renders the shared modal dialog shell with backdrop dismissal and heading close control. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import type { HTMLDialogAttributes } from "svelte/elements"
  import { dismiss } from "./dismiss.ts"
  import Icon from "./Icon.svelte"

  let {
    dialog = $bindable(),
    title,
    closeLabel,
    closeTitle,
    labelledBy = true,
    formSubmit,
    children,
    ...rest
  }: {
    dialog?: HTMLDialogElement
    title: string
    closeLabel: string
    closeTitle?: string
    labelledBy?: boolean
    formSubmit?: (event: SubmitEvent) => void
    children: Snippet
  } & HTMLDialogAttributes = $props()

  const headingId = $props.id()
  const close = () => {
    dialog?.close()
  }
</script>

{#snippet body()}
  <div class="dialog-heading">
    <h2 id={labelledBy ? headingId : undefined}>{title}</h2>
    <button type="button" class="icon-button" aria-label={closeLabel} title={closeTitle} onclick={close}>
      <Icon name="close" />
    </button>
  </div>
  {@render children()}
{/snippet}

<dialog
  bind:this={dialog}
  aria-labelledby={labelledBy ? headingId : undefined}
  aria-label={labelledBy ? undefined : title}
  closedby="any"
  {@attach dismiss}
  {...rest}
>
  {#if formSubmit}
    <form onsubmit={formSubmit}>
      {@render body()}
    </form>
  {:else}
    {@render body()}
  {/if}
</dialog>
