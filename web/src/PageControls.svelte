<!-- Renders Page view zoom and Output comparison controls in toolbars or menus. -->

<script lang="ts">
  import { zoomLevels } from "./Page.svelte"
  import type { PaneName } from "./editing.svelte.ts"
  import Icon from "./Icon.svelte"

  let {
    pane,
    zoom,
    menu = false,
    showZoom = true,
    showFit = true,
    showComparison = false,
    comparing,
    onCompare,
    onZoomBy,
    onResetZoom,
    onFitWidth,
  }: {
    pane: PaneName
    zoom: number
    menu?: boolean
    showZoom?: boolean
    showFit?: boolean
    showComparison?: boolean
    comparing?: boolean
    onCompare?: () => void
    onZoomBy: (offset: -1 | 1) => void
    onResetZoom: () => void
    onFitWidth: () => void
  } = $props()
</script>

{#snippet comparison()}
  <button
    class={["compare", { tool: !menu }]}
    aria-label="Compare page"
    aria-pressed={comparing}
    title="Compare page"
    onclick={onCompare}
    ><Icon name="compare" />{#if menu}Compare{/if}</button
  >
{/snippet}

{#snippet zoomSteps()}
  <button
    class={menu ? "zoom-step" : "tool zoom-step"}
    aria-label="Zoom out"
    title="Zoom out"
    disabled={zoom <= zoomLevels[0]}
    onclick={() => onZoomBy(-1)}
    >{#if menu}<Icon name="remove" />Zoom out{:else}−{/if}</button
  >
  <button
    class={menu ? "zoom-step" : "tool zoom-step"}
    aria-label="Zoom in"
    title="Zoom in"
    disabled={zoom >= zoomLevels.at(-1)!}
    onclick={() => onZoomBy(1)}
    >{#if menu}<Icon name="add" />Zoom in{:else}+{/if}</button
  >
{/snippet}

{#snippet zoomReset()}
  <button
    class={menu ? undefined : "tool page-fit"}
    data-reset={zoom !== 100 || undefined}
    aria-label={zoom === 100 ? "Fit width" : "Reset zoom"}
    title={zoom === 100 ? "Fit width" : "Reset zoom · 0 or Z"}
    onclick={() => (zoom === 100 ? onFitWidth() : onResetZoom())}
  >
    {#if menu}<Icon name="fit" />{zoom === 100 ? "Fit width" : "Reset zoom"}
    {:else}
      <span class="fit-level" aria-hidden="true">{zoom}%</span>
      <Icon name="fit" />
    {/if}
  </button>
{/snippet}

{#if menu}
  {#if showComparison}{@render comparison()}{/if}
  {#if showZoom}
    {@render zoomSteps()}
    {#if showFit}{@render zoomReset()}{/if}
  {/if}
{:else}
  <div class="page-tools" role="group" aria-label={`${pane} Page controls`}>
    {#if showComparison}{@render comparison()}{/if}
    <div class="page-zoom" style:--digits={String(zoom).length}>
      <output aria-label={`${pane} page zoom`}>{zoom}%</output>
      {@render zoomSteps()}
      {@render zoomReset()}
    </div>
  </div>
{/if}
