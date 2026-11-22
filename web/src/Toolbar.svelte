<!-- Renders the shared pane view tabs, section toggles, and page jump bar. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import { viewLabels, viewTabs } from "./pane.svelte.ts"
  import type { InputTab, Tab } from "./pane.svelte.ts"
  import type { PaneName } from "./editing.svelte.ts"
  import type { TourStep } from "./Tour.svelte"
  import Icon from "./Icon.svelte"
  import Jump from "./Jump.svelte"

  let {
    key,
    pane,
    active,
    panelId,
    className,
    anchorName,
    tour,
    sectionState,
    hasSections,
    grouped,
    showJump = true,
    count,
    position,
    labels,
    onTab,
    onTabKey,
    onToggleSections,
    onToggleGrouped,
    onJump,
    extraTab,
    extraTools,
  }: {
    key: string
    pane: PaneName
    active: InputTab
    panelId: string
    className: string
    anchorName?: string
    tour?: TourStep
    sectionState: "none" | "open" | "closed" | "mixed"
    hasSections: boolean
    grouped: boolean
    showJump?: boolean
    count: number
    position: number
    labels: readonly string[]
    onTab: (tab: Tab) => void
    onTabKey: (event: KeyboardEvent) => void
    onToggleSections: () => void
    onToggleGrouped: () => void
    onJump: (position: number, event: MouseEvent) => void
    extraTab?: Snippet
    extraTools?: Snippet
  } = $props()

  const prefix = $derived(pane === "Input" ? "input" : "output")
  const tabId = (tab: Tab) => `${key}-${pane === "Input" ? tab : `output-${tab}`}`
</script>

<div class={["editing-toolbar", className]} style:anchor-name={anchorName}>
  <div class="tabs" role="tablist" aria-label={`${pane} workspace`}>
    {#each viewTabs as tab (tab)}<button
        id={tabId(tab)}
        role="tab"
        aria-label={viewLabels[tab]}
        aria-keyshortcuts={`Alt+${viewTabs.indexOf(tab) + 1}`}
        aria-selected={active === tab}
        aria-controls={panelId}
        tabindex={active === tab ? 0 : -1}
        onkeydown={onTabKey}
        onclick={() => onTab(tab)}
        title={`${viewLabels[tab]} view`}
        data-tour-tab={`${prefix}-${tab}`}
        data-tour-active={tour === `${prefix}-${tab}` ||
          (pane === "Output" && tab === "grid" && tour === "output-selection")}
        ><Icon name={tab} /><span>{viewLabels[tab]}</span></button
      >{/each}
    {@render extraTab?.()}
  </div>

  {#if sectionState !== "none"}<button
      type="button"
      class="icon-button"
      aria-label={sectionState === "closed" ? `Unfold all ${pane} sections` : `Fold all ${pane} sections`}
      title={sectionState === "closed" ? "Unfold all sections" : "Fold all sections"}
      onclick={onToggleSections}><Icon name={sectionState === "closed" ? "expand" : "collapse"} /></button
    >{/if}
  {#if (active === "list" || active === "grid") && hasSections}<button
      type="button"
      class="icon-button"
      aria-label="Section headings"
      aria-pressed={grouped}
      title={grouped ? "Hide section headings" : "Show section headings"}
      onclick={onToggleGrouped}><Icon name="sections" /></button
    >{/if}
  {@render extraTools?.()}
  {#if showJump}<Jump {pane} {count} {labels} {position} navigate={onJump} />{/if}
</div>
