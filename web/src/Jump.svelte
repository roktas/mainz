<!-- Navigates a pane to one page without changing its selection. -->

<script lang="ts">
  import Icon from "./Icon.svelte"

  let {
    pane,
    count,
    position,
    navigate,
  }: {
    pane: "Input" | "Output"
    count: number
    position: number
    navigate: (position: number, event: MouseEvent) => void
  } = $props()
  const id = $props.id()
  let panel: HTMLDivElement
  let field: HTMLInputElement
  let text = $state("")
  let invalid = $state(false)

  function arrive(destination: number, event: MouseEvent) {
    panel.hidePopover()
    navigate(destination, event)
  }
  function jump(event: MouseEvent) {
    const value = text.trim(),
      number = Number(value)
    if (!/^\d+$/.test(value) || !Number.isSafeInteger(number) || number < 1 || number > count) {
      invalid = true
      field.focus({ preventScroll: true })
      return
    }
    arrive(number - 1, event)
  }
</script>

<span class="page-destination">
  <button
    type="button"
    class="icon-button"
    popovertarget={id}
    aria-label={`Go to page in ${pane}`}
    title="Go to page"
    disabled={!count}><Icon name="goto" /></button
  >
  <div
    {id}
    bind:this={panel}
    class="page-destination-panel"
    popover="auto"
    role="dialog"
    aria-label={`Go to page in ${pane}`}
    onbeforetoggle={(event) => {
      if (event.newState === "open") {
        text = String(position + 1)
        invalid = false
      }
    }}
    ontoggle={(event) => {
      if (event.newState === "open") {
        field.focus({ preventScroll: true })
        field.select()
      }
    }}
  >
    <div class="page-destination-heading">
      <label for={`${id}-number`}>Go to page</label>
      <button
        type="button"
        class="icon-button"
        aria-label="Close page navigation"
        popovertarget={id}
        popovertargetaction="hide"><Icon name="close" /></button
      >
    </div>
    <form onsubmit={(event) => event.preventDefault()}>
      <div class="page-destination-row">
        <button
          type="button"
          class="icon-button"
          aria-label={`First ${pane} page`}
          title="First page"
          onclick={(event) => arrive(0, event)}><Icon name="first" /></button
        >
        <div class={["entry", { invalid }]}>
          <input
            id={`${id}-number`}
            bind:this={field}
            bind:value={text}
            inputmode="numeric"
            autocomplete="off"
            spellcheck={false}
            aria-label={`${pane} page number`}
            aria-invalid={invalid}
            aria-describedby={`${id}-help`}
            oninput={() => (invalid = false)}
          />
          <button type="submit" class="step" aria-label={`Go to ${pane} page number`} title="Go" onclick={jump}
            ><Icon name="goto" /></button
          >
        </div>
        <button
          type="button"
          class="icon-button"
          aria-label={`Last ${pane} page`}
          title="Last page"
          onclick={(event) => arrive(count - 1, event)}><Icon name="last" /></button
        >
      </div>
      <p id={`${id}-help`} class="control-description">
        {invalid ? `Enter a page number from 1 to ${count}.` : `1–${count}`}
      </p>
    </form>
  </div>
</span>
