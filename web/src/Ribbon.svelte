<!-- Renders the Grid section fold and drag handle button. -->

<script lang="ts">
  import type { Section } from "./sections.ts"
  import type { Payload, Transfer } from "./transfer.svelte.ts"
  import type { PaneName } from "./editing.svelte.ts"
  import { retainFocus } from "./drag.ts"
  import Icon from "./Icon.svelte"

  let {
    key,
    pane,
    section,
    folded,
    payload,
    transfer,
    start,
    fold,
  }: {
    key: string
    pane: PaneName
    section: Section
    folded: boolean
    payload: Payload
    transfer: Transfer
    start: (event: DragEvent | PointerEvent, payload: Payload) => void
    fold: (key: string) => void
  } = $props()
</script>

<button
  id={`${key}-${pane}-grid-section-${section.id}`}
  class="page-grip grid-ribbon icon-button"
  type="button"
  draggable="true"
  aria-label={`${folded ? "Unfold" : "Fold"} ${pane} section: ${section.path.join(" › ")}`}
  aria-expanded={!folded}
  title={`${folded ? "Unfold" : "Fold"} section. Drag to ${pane === "Input" ? "add to Output" : "move"}.`}
  onmousedown={retainFocus}
  ondragstart={(event) => start(event, payload)}
  onpointerdown={(event) => transfer.press(event, payload)}
  ondragend={() => transfer.end()}
  onclick={() => fold(section.key)}
  ><span class="ribbon-symbol"><Icon name="ribbon-vertical" /></span><span class="ribbon-dots"
    ><Icon name="grip-four" /></span
  ></button
>
