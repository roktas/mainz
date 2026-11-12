<!-- Navigates a pane to one page without changing its selection. -->

<script lang="ts">
  import Icon from "./Icon.svelte"

  let {
    pane,
    count,
    position,
    labels = [],
    navigate,
  }: {
    pane: "Input" | "Output"
    count: number
    position: number
    labels?: readonly string[]
    navigate: (position: number, event: MouseEvent) => void
  } = $props()
  const id = $props.id()
  let panel: HTMLDivElement
  let field: HTMLInputElement
  let text = $state("")
  let invalid = $state(false)
  let logical = $state("")
  let labelInvalid = $state(false)
  const hasLabels = $derived(labels.some((label) => !!label))

  const firstLabel = $derived(labels.findIndex((label) => !!label))
  const lastLabel = $derived(labels.findLastIndex((label) => !!label))

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
        logical = labels[position] ?? ""
        labelInvalid = false
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
      <label for={`${id}-number`}>{hasLabels ? "Go to physical page" : "Go to page"}</label>
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
          onclick={(event) => arrive(0, event)}><Icon name="first" /><small>1</small></button
        >
        <div class={["entry", { invalid }]}>
          <input
            id={`${id}-number`}
            bind:this={field}
            bind:value={text}
            size="4"
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
          onclick={(event) => arrive(count - 1, event)}><Icon name="last" /><small>{count}</small></button
        >
      </div>
      <p id={`${id}-help`} class="control-description" hidden={!invalid}>Enter a page number from 1 to {count}.</p>
    </form>
    {#if hasLabels}
      <label class="logical-heading" for={`${id}-label`}>Go to logical page</label>
      <form onsubmit={(event) => event.preventDefault()}>
        <div class="page-destination-row">
          <button
            type="button"
            class="icon-button"
            aria-label={`First ${pane} logical page`}
            onclick={(event) => arrive(firstLabel, event)}
            ><Icon name="first" /><small>{labels[firstLabel]}</small></button
          >
          <div class={["entry", { invalid: labelInvalid }]}>
            <input
              id={`${id}-label`}
              aria-label={`${pane} page label`}
              size="4"
              bind:value={logical}
              aria-invalid={labelInvalid}
              oninput={() => (labelInvalid = false)}
            />
            <button
              type="submit"
              class="step"
              aria-label={`Go to ${pane} page label`}
              onclick={(event) => {
                const destination = labels.indexOf(logical.trim())
                if (destination < 0) labelInvalid = true
                else arrive(destination, event)
              }}><Icon name="goto" /></button
            >
          </div>
          <button
            type="button"
            class="icon-button"
            aria-label={`Last ${pane} logical page`}
            onclick={(event) => arrive(lastLabel, event)}><Icon name="last" /><small>{labels[lastLabel]}</small></button
          >
        </div>
        {#if labelInvalid}<p class="control-description" role="alert">Enter an existing page label.</p>{/if}
      </form>
    {/if}
  </div>
</span>
