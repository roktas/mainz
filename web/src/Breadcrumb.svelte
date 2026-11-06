<!-- Shows compact section ancestry and reveals complete titles without changing page selection. -->

<script lang="ts">
  import Icon from "./Icon.svelte"

  let { path }: { path: readonly string[] } = $props()
  const id = $props.id()
</script>

<nav aria-label="Section path">
  {#each path as part, index}
    {#if index}<span class="separator" aria-hidden="true">›</span>{/if}
    <button class="crumb" popovertarget={`${id}-${index}`} aria-label={`Show full title: ${part}`}>{part}</button>
    <div id={`${id}-${index}`} class="crumb-details" popover="auto" role="region" aria-label="Full section title">
      <span>{part}</span>
      <button
        class="icon-button"
        popovertarget={`${id}-${index}`}
        popovertargetaction="hide"
        aria-label="Close section title"><Icon name="close" /></button
      >
    </div>
  {/each}
</nav>

<style>
  nav {
    display: flex;
    align-items: center;
    gap: 0.4em;
    min-inline-size: 0;
    overflow: clip;
  }
  .crumb {
    display: block;
    flex: 0 1 auto;
    min-inline-size: 0;
    min-block-size: 32px;
    max-inline-size: 100%;
    padding: 0.25em 0;
    border: 0;
    border-radius: 0;
    color: inherit;
    background: transparent;
    box-shadow: none;
    font: inherit;
    text-align: start;
    white-space: nowrap;
    overflow: clip;
    text-overflow: ellipsis;
  }
  .separator {
    flex: none;
    color: var(--muted);
    font-weight: 400;
  }
  .crumb:last-of-type {
    min-inline-size: min(12ch, 30%);
  }
  .crumb-details {
    position-area: block-end span-inline-start;
    position-try-fallbacks: flip-inline, flip-block;
    inline-size: max-content;
    max-inline-size: min(32rem, calc(100vi - 2 * var(--gutter)));
    max-block-size: calc(100% - 1rem);
    margin: 0.25rem 0;
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--ink);
    background: var(--surface);
    box-shadow: 0 4px 16px var(--shadow);
    overflow: auto;
    font-size: var(--body);
    font-weight: 400;
  }
  .crumb-details:popover-open {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 0.75rem;
  }
  .crumb-details > span {
    min-inline-size: 0;
    padding-block: 0.4rem;
    overflow-wrap: anywhere;
  }
  .crumb-details .icon-button {
    min-inline-size: 32px;
    min-block-size: 32px;
    inline-size: 32px;
    block-size: 32px;
    padding: 7px;
  }
  .crumb:active {
    color: var(--accent);
    filter: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .crumb:hover {
      color: var(--accent);
      background: transparent;
      box-shadow: none;
      text-decoration: underline;
      text-underline-offset: 0.2em;
    }
  }
  @media (pointer: coarse) {
    .crumb {
      min-block-size: 44px;
    }
    .crumb-details .icon-button {
      min-inline-size: 44px;
      min-block-size: 44px;
      inline-size: 44px;
      block-size: 44px;
    }
  }
</style>
