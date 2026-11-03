<!-- Presents optional information through an icon or text trigger and a shared dismissible panel. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  let { title, details, label }: { title: string; details?: string; label?: string } = $props()
  const key = $props.id()
</script>

{#if details?.trim()}
  <button
    class={label ? "guidance-label" : "icon-button guidance-trigger"}
    popovertarget={`${key}-details`}
    aria-label={label || `Details for ${title}`}
    title={`Details for ${title}`}
    >{#if label}{label}{:else}<Icon name="info" />{/if}</button
  >
  <!-- Text clicks must not activate an enclosing disclosure; Close keeps its native action. -->
  <!-- svelte-ignore a11y_no_noninteractive_element_interactions, a11y_click_events_have_key_events -->
  <span
    role="region"
    id={`${key}-details`}
    class="guidance"
    popover="auto"
    tabindex="-1"
    aria-labelledby={`${key}-title`}
    onclick={(event) => {
      if (!(event.target as Element).closest("button")) event.preventDefault()
    }}
    ontoggle={(event) => {
      if (event.newState === "open") {
        event.currentTarget.scrollTop = 0
        event.currentTarget.focus({ preventScroll: true })
      }
    }}
  >
    <span class="guidance-heading">
      <span id={`${key}-title`} role="heading" aria-level="3">{title}</span>
      <button
        class="icon-button"
        popovertarget={`${key}-details`}
        popovertargetaction="hide"
        aria-label="Close details"
        title="Close details"><Icon name="close" /></button
      >
    </span>
    <span class="guidance-text">{details}</span>
  </span>
{/if}
