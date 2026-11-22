<!-- Renders a List section row with fold, drag, selection, and inline actions. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import type { Payload, Transfer } from "./transfer.svelte.ts"
  import type { PaneName } from "./editing.svelte.ts"
  import { retainFocus } from "./drag.ts"
  import Icon from "./Icon.svelte"

  let {
    key,
    pane,
    first,
    end,
    path,
    labels = path,
    expanded,
    selected,
    pdfLabel,
    id,
    payload,
    transfer,
    touch,
    start,
    toggle,
    select,
    open,
    origin,
    actions,
    dropPreview,
  }: {
    key: string
    pane: PaneName
    first: number
    end: number
    path: readonly string[]
    labels?: readonly string[]
    expanded: boolean
    selected: boolean
    pdfLabel?: string
    id: number
    payload: Payload
    transfer: Transfer
    touch: boolean
    start: (event: DragEvent | PointerEvent, payload: Payload) => void
    toggle: () => void
    select: (event: MouseEvent) => (() => void) | undefined
    open: (event: MouseEvent) => void
    origin: Snippet
    actions: Snippet
    dropPreview?: Snippet<[after: boolean]>
  } = $props()

  let restore: (() => void) | undefined
  const name = $derived(path.join(" › "))
  const disclosureId = $derived(`${key}-${pane}-section-${id}-disclosure`)
  const dragging = $derived(transfer.control?.id === disclosureId)
</script>

{#if dropPreview && pane === "Output" && !expanded && transfer.inside && !transfer.blocked && ((transfer.targetIndex === first && !transfer.targetAfter) || (transfer.targetIndex === end - 1 && transfer.targetAfter))}
  {@render dropPreview(transfer.targetAfter)}
{/if}
<button
  id={disclosureId}
  type="button"
  class="list-disclosure page-grip icon-button"
  class:dragging
  aria-label={`${expanded ? "Fold" : "Unfold"} ${pane} section: ${name}`}
  aria-expanded={expanded}
  title={`${expanded ? "Fold" : "Unfold"} section. Drag to ${pane === "Input" ? "add to Output" : "move"}.`}
  draggable="true"
  onmousedown={retainFocus}
  ondragstart={(event) => start(event, payload)}
  onpointerdown={(event) => transfer.press(event, payload)}
  ondragend={() => transfer.end()}
  onclick={toggle}
  ><span class="ribbon-symbol"><Icon name="ribbon" /></span><span class="ribbon-dots"><Icon name="grip-four" /></span
  ></button
>
<div class="list-number">{@render origin()}</div>
{#if pane === "Input" && pdfLabel && pdfLabel !== String(first + 1)}<span
    class="list-pdf-label"
    aria-label={`Page Label: ${pdfLabel}`}
    title={pdfLabel}>{pdfLabel}</span
  >{/if}
<button
  type="button"
  class="list-heading"
  data-page={first}
  aria-label={expanded
    ? `Select ${pane} page ${first + 1}: ${name}`
    : `Select ${pane} section ${name}: pages ${first + 1}–${end}`}
  aria-pressed={selected}
  title={expanded
    ? "Select or unselect this page. Shift-click selects a range."
    : "Select or unselect this section. Shift-click selects a range."}
  onclick={(event) => {
    if (event.detail <= 1) restore = select(event)
  }}
  ondblclick={(event) => {
    if (touch || event.ctrlKey || event.metaKey) return
    restore?.()
    restore = undefined
    open(event)
  }}
  ><span class="list-current">{labels.at(-1)}</span>
  {#if labels.length > 1}<span class="list-parents" aria-hidden="true">
      {#each labels.slice(0, -1).toReversed() as parent, depth (depth)}
        <span class="list-separator">‹</span><span class="list-ancestor">{parent}</span>
      {/each}
    </span>{/if}</button
>
<div class="list-actions">{@render actions()}</div>
