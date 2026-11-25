<!-- Renders a Grid card selection and drag handle for mouse and touch. -->

<script lang="ts">
  import type { Payload, Transfer } from "./transfer.svelte.ts"
  import type { PaneName } from "./editing.svelte.ts"
  import { retainFocus } from "./drag.ts"
  import Icon from "./Icon.svelte"

  let {
    pane,
    number,
    selected,
    payload,
    transfer,
    start,
    onToggle,
  }: {
    pane: PaneName
    number: number
    selected: boolean
    payload: Payload
    transfer: Transfer
    start: (event: DragEvent | PointerEvent, payload: Payload) => void
    onToggle: (shiftKey: boolean, control: HTMLElement) => void
  } = $props()
</script>

<button
  class="page-grip"
  aria-label={`Select or drag ${pane} page ${number}${pane === "Input" ? " to Output" : ""}`}
  aria-pressed={selected}
  title="Select or unselect this page."
  draggable="true"
  onmousedown={retainFocus}
  onclick={(event) => onToggle(event.shiftKey, event.currentTarget)}
  onpointerup={(event) => {
    const control = event.currentTarget
    const shiftKey = event.shiftKey
    transfer.tap(event, () => onToggle(shiftKey, control))
  }}
  ondragstart={(event) => start(event, payload)}
  onpointerdown={(event) => transfer.press(event, payload)}
  ondragend={() => transfer.end()}><Icon name="reorder" /></button
>
