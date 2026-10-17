<!-- Edits the inspected page number and returns focus to its viewport. -->
<script lang="ts">
  import { tick } from "svelte"

  let {
    pane,
    position = $bindable(0),
    count,
  }: {
    pane: "Input" | "Output"
    position?: number
    count: number
  } = $props()
  const id = $props.id()
  let editing = $state(false)
  let text = $state("")
  let invalid = $state(false)

  export function edit() {
    text = String(position + 1)
    invalid = false
    editing = true
  }
  function focus(element: HTMLInputElement) {
    element.focus({ preventScroll: true })
    element.select()
  }
  async function jump(event: KeyboardEvent) {
    if (
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      event.shiftKey ||
      !["Enter", "Escape"].includes(event.key)
    )
      return
    event.preventDefault()
    if (event.key === "Enter") {
      const value = text.trim(),
        number = Number(value)
      if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > count) {
        invalid = true
        return
      }
      position = number - 1
    }
    const viewport = (event.currentTarget as HTMLElement)
      .closest(".page-view")
      ?.querySelector<HTMLElement>(".page-scroll")
    editing = false
    await tick()
    viewport?.focus({ preventScroll: true })
  }
</script>

{#snippet value()}
  <strong class="page-position">
    <span class="page-current">
      <span aria-hidden={editing} style:visibility={editing ? "hidden" : undefined}>{position + 1}</span>
      {#if editing}
        <input
          class="page-jump"
          type="text"
          inputmode="numeric"
          aria-label={`Go to ${pane} page`}
          title=""
          aria-describedby={`${id}-help`}
          aria-invalid={invalid || undefined}
          size={String(count).length}
          style:--digits={String(count).length}
          bind:value={text}
          oninput={() => (invalid = false)}
          onkeydown={(event) => void jump(event)}
          onblur={() => (editing = false)}
          {@attach focus}
        />
        <span hidden id={`${id}-help`}>Enter a page number from 1 to {count}. Enter confirms. Escape cancels.</span>
      {/if}
    </span><span class="page-total">/ {count}</span>
  </strong>
{/snippet}

{#if editing}<span class="page-number-control">{@render value()}</span>
{:else}<button class="page-number-control" aria-label={`Go to ${pane} page`} title="" onclick={edit}
    >{@render value()}</button
  >{/if}
