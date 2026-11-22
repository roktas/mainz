<!-- Renders page and sheet totals with an overflow details popover. -->

<script lang="ts">
  import { observeSummary } from "./pane.svelte.ts"
  import type { PaneName } from "./editing.svelte.ts"
  import Icon from "./Icon.svelte"

  let {
    id,
    pane,
    pages,
    className,
  }: {
    id: string
    pane: PaneName
    pages: number
    className?: string
  } = $props()

  const sheets = $derived(Math.ceil(pages / 2))
</script>

{#snippet totals()}
  <strong>{pages} {pages === 1 ? "page" : "pages"}</strong>, {sheets}
  {sheets === 1 ? "sheet" : "sheets"}
{/snippet}

<div class={[className, "output-state"]} data-details={id} {@attach observeSummary}>
  <span class="composition-totals">{@render totals()}</span>
  <button class="icon-button" popovertarget={id} aria-label={`${pane} details`} title={`${pane} details`}
    ><Icon name="info" /></button
  >
</div>
<div {id} class="output-details" popover="auto" role="note" aria-label={`${pane} details`}>
  {@render totals()}
</div>
