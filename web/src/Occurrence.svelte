<!-- Renders move, remove, and duplicate actions for an Output page or section occurrence. -->

<script lang="ts">
  import type { Expanded } from "./model.ts"
  import type { OutputAction, OutputTarget } from "./editing.svelte.ts"
  import type { Tab } from "./pane.svelte.ts"
  import Icon from "./Icon.svelte"

  let {
    key,
    page,
    index,
    end = index + 1,
    total,
    active,
    narrow,
    controls,
    enabled,
    onEdit,
  }: {
    key: string
    page: Expanded
    index: number
    end?: number
    total: number
    active: Tab
    narrow: boolean
    controls: boolean
    enabled: boolean
    onEdit: (action: OutputAction, target: OutputTarget) => void
  } = $props()

  const target = $derived<OutputTarget>({ kind: "individual", first: index, end })
  const group = $derived(end > index + 1)
  const targetLabel = $derived(group ? `Output section pages ${index + 1}–${end}` : `Output page ${index + 1}`)
  const menuId = $derived(`${key}-${page.id}-actions`)
</script>

{#snippet move(offset: -1 | 1, menu = false)}
  <button
    class="icon-button move"
    aria-label={`Move ${targetLabel} ${offset < 0 ? "earlier" : "later"}`}
    title={`Move ${group ? "section" : "page"} ${offset < 0 ? "earlier" : "later"}`}
    disabled={!enabled || (offset < 0 ? index === 0 : end === total)}
    onclick={(event) => {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
      onEdit(offset < 0 ? "earlier" : "later", target)
    }}
    ><Icon
      name={active === "list" ? (offset < 0 ? "move-up" : "move-down") : offset < 0 ? "earlier" : "later"}
    />{#if menu}<span>{offset < 0 ? "Move earlier" : "Move later"}</span>{/if}</button
  >
{/snippet}

{#snippet copies(menu = false)}
  <button
    class="icon-button"
    aria-label={`Remove ${targetLabel}`}
    title={group ? "Remove section" : "Remove this page"}
    disabled={!enabled}
    onclick={(event) => {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
      onEdit("remove", target)
    }}
    ><Icon name="remove" />{#if menu}<span>Remove</span>{/if}</button
  ><button
    class="icon-button"
    aria-label={`Duplicate ${targetLabel}`}
    title={group ? "Add one adjacent copy of section" : "Add one adjacent copy"}
    disabled={!enabled}
    onclick={(event) => {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
      onEdit("duplicate", target)
    }}
    ><Icon name="add" />{#if menu}<span>Duplicate</span>{/if}</button
  >
{/snippet}

{#snippet pairs()}
  <div class="occurrence-moves" role="group" aria-label={`Move ${targetLabel}`}>
    {@render move(-1)}{@render move(1)}
  </div>
  <div class="occurrence-copies" role="group" aria-label={`Remove or duplicate ${targetLabel}`}>
    {@render copies()}
  </div>
{/snippet}

<div class="occurrence-actions">
  {#if controls && enabled}
    {#if active === "list" && narrow}
      <button
        class="list-edit-trigger icon-button"
        aria-label={`Actions for ${targetLabel}`}
        title="Page actions"
        popovertarget={menuId}><Icon name="more" /></button
      >
      <div id={menuId} class="list-edit-options" role="group" popover="auto" aria-label={`Actions for ${targetLabel}`}>
        {@render move(-1, true)}{@render move(1, true)}{@render copies(true)}
      </div>
    {:else if active === "grid"}<span class="card-inline-actions">{@render pairs()}</span>
    {:else}{@render pairs()}{/if}
  {/if}
</div>
