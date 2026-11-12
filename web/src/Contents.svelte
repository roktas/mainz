<!-- Presents Input PDF contents and navigates without changing page selection. -->

<script module lang="ts">
  import type { Outline } from "./outline.ts"
  type Entry = Outline & { key: string }
  type Branch = Entry & { children: Branch[] }
</script>

<script lang="ts">
  import { tick } from "svelte"
  import { sectionsAt } from "./outline.ts"
  import Icon from "./Icon.svelte"

  let {
    outline,
    source,
    position,
    navigate,
    titleChoice = false,
    tocTitles = $bindable(false),
  }: {
    outline: readonly Outline[]
    source: string
    position: number
    navigate: (position: number) => void
    titleChoice?: boolean
    tocTitles?: boolean
  } = $props()
  const id = $props.id()
  let panel: HTMLDivElement
  let opened = $state(false)
  let collapsed = $state(new Set<string>())
  const items = $derived(outline.map((entry, index) => ({ ...entry, key: `${source}:${index}` })))
  const branches = $derived.by(() => {
    const roots: Branch[] = [],
      stack: Branch[] = []
    for (const item of items) {
      const branch = { ...item, children: [] }
      while (stack.length > item.depth) stack.pop()
      if (stack.length) stack.at(-1)!.children.push(branch)
      else roots.push(branch)
      stack.push(branch)
    }
    return roots
  })
  const current = $derived.by(() => {
    const leaf = sectionsAt(items, position)[0]
    if (!leaf) return
    const ancestors: Entry[] = []
    for (const item of items) {
      while (ancestors.length && ancestors.at(-1)!.depth >= item.depth) ancestors.pop()
      if (item === leaf) return ancestors.find((entry) => collapsed.has(entry.key))?.key ?? item.key
      ancestors.push(item)
    }
  })
  const parents = $derived(items.filter((item, index) => items[index + 1]?.depth > item.depth))
  const canUnfold = $derived(parents.some((item) => collapsed.has(item.key)))
  function jump(page: number) {
    panel.hidePopover()
    navigate(page)
  }
  $effect(() => {
    if (!opened || !current) return
    void tick().then(() => panel.querySelector('[aria-current="location"]')?.scrollIntoView({ block: "nearest" }))
  })
</script>

<button
  class="icon-button"
  aria-label="Input contents"
  aria-expanded={opened}
  title="Contents"
  popovertarget={id}
  disabled={!items.length}><Icon name="toc" /></button
>
<div
  {id}
  bind:this={panel}
  class="contents"
  popover="auto"
  aria-label="Input contents"
  onbeforetoggle={(event) => {
    opened = event.newState === "open"
    if (opened) collapsed = new Set(parents.map((item) => item.key))
  }}
>
  <header>
    <strong>Contents</strong>
    {#if parents.length}<button
        class="contents-toggle"
        onclick={() => {
          collapsed = canUnfold ? new Set() : new Set(parents.map((item) => item.key))
        }}>{canUnfold ? "Unfold all" : "Fold all"}</button
      >{/if}
    <button class="icon-button" aria-label="Close contents" popovertarget={id} popovertargetaction="hide"
      ><Icon name="close" /></button
    >
  </header>
  <nav aria-label="Input section navigation">
    {#if opened}{@render tree(branches)}{/if}
  </nav>
  {#if titleChoice}<footer><label><input type="checkbox" bind:checked={tocTitles} />Use TOC titles</label></footer>{/if}
</div>

{#snippet tree(nodes: Branch[])}
  <ul>
    {#each nodes as item (item.key)}
      <li>
        <div class="branch" class:parent={item.children.length > 0}>
          {#if item.children.length}<button
              class="disclosure icon-button"
              aria-label={`${collapsed.has(item.key) ? "Unfold" : "Fold"} ${item.title}`}
              aria-expanded={!collapsed.has(item.key)}
              onclick={() => {
                const next = new Set(collapsed)
                if (next.has(item.key)) next.delete(item.key)
                else next.add(item.key)
                collapsed = next
              }}><Icon name="next" /></button
            >{:else}<span></span>{/if}
          <button
            class="destination"
            class:current={item.page <= position && item.end >= position}
            aria-current={item.key === current ? "location" : undefined}
            onclick={() => jump(item.page)}
            ><span class:synthetic={item.synthetic}>{item.title}</span><span class="positions">{item.page + 1}</span
            ></button
          >
        </div>
        {#if item.children.length && !collapsed.has(item.key)}{@render tree(item.children)}{/if}
      </li>
    {/each}
  </ul>
{/snippet}

<style>
  .contents {
    --contents-close-size: 32px;
    --contents-disclosure-size: 28px;
    --contents-inset: clamp(20px, 3vi, 24px);
    container: contents / inline-size;
    position-area: block-end span-inline-start;
    position-try-fallbacks: flip-inline, flip-block;
    position-try-order: most-block-size;
    inline-size: 32rem;
    max-inline-size: min(anchor-size(--input-pane inline), calc(100vi - 2 * var(--gutter)));
    max-block-size: calc(100% - 1rem);
    margin: 0.5rem 0;
    padding: 0.25rem var(--contents-inset) var(--gap);
    border: 1px solid var(--border);
    border-radius: var(--radius);
    color: var(--ink);
    background: var(--surface);
    box-shadow: 0 4px 16px var(--shadow);
    overflow: clip;
    font-size: var(--body);
  }
  .contents:popover-open {
    display: grid;
    grid-template-rows: auto minmax(0, 1fr);
  }
  header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap);
    padding-block-end: 0.25rem;
    border-block-end: 1px solid var(--border);
    margin-block-end: 0.25rem;
  }
  header .icon-button {
    inline-size: var(--contents-close-size);
    min-inline-size: var(--contents-close-size);
    block-size: var(--contents-close-size);
    min-block-size: var(--contents-close-size);
    margin-inline-end: calc((var(--icon-size) / 2 - var(--contents-close-size)) / 2);
    padding: 7px;
  }
  header strong {
    margin-inline-end: auto;
  }
  .contents-toggle {
    min-inline-size: 0;
    min-block-size: 32px;
    padding: 0.25rem 0.5rem;
    border: 0;
    background: transparent;
    color: var(--muted);
    font-size: var(--small);
    font-weight: 400;
    box-shadow: none;
  }
  .contents-toggle:active {
    color: var(--accent);
    filter: none;
  }
  nav {
    min-inline-size: 0;
    min-block-size: 0;
    overflow: auto;
    overscroll-behavior: contain;
    margin-inline-end: calc(8px - var(--contents-inset));
    scrollbar-width: thin;
  }
  /* Keep the tree on the header's edges while the scrollbar uses the outer inset. */
  nav > ul {
    inline-size: 100cqi;
  }
  footer {
    margin-block-start: 0.25rem;
    border-block-start: 1px solid var(--border);
    padding-block-start: 0.25rem;
  }
  footer label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    min-block-size: 32px;
    font-size: var(--small);
  }
  ul {
    list-style: none;
    padding: 0;
    margin: 0;
  }
  ul ul {
    margin-inline-start: 0.75rem;
    padding-inline-start: 0.25rem;
    border-inline-start: 1px solid var(--border);
  }
  nav > ul > li + li {
    margin-block-start: 0.15rem;
  }
  ul > li + li:has(> .parent) {
    margin-block-start: 0.5rem;
  }
  .branch {
    display: grid;
    grid-template-columns: var(--contents-disclosure-size) minmax(0, 1fr);
    align-items: start;
  }
  .disclosure {
    inline-size: var(--contents-disclosure-size);
    min-inline-size: var(--contents-disclosure-size);
    min-block-size: 0;
    block-size: calc(1.5em + 0.75rem);
    padding: 0;
    display: grid;
    place-items: center;
    line-height: 1.5;
  }
  /* Align the visible chevron edge instead of its asymmetric viewBox center. */
  .disclosure :global(svg) {
    translate: calc(var(--icon-size) / 8 - var(--contents-disclosure-size) / 2) 0;
  }
  .disclosure[aria-expanded="true"] :global(svg) {
    rotate: 90deg;
    translate: calc(var(--icon-size) / 4 - var(--contents-disclosure-size) / 2) 0;
  }
  .destination {
    min-inline-size: 0;
    min-block-size: 28px;
    padding-block: 0.25rem;
    padding-inline: 0.5rem 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: start;
    gap: 1rem;
    border: 0;
    border-inline-start: 2px solid transparent;
    border-radius: 0;
    background: transparent;
    color: inherit;
    text-align: start;
    white-space: normal;
    font-weight: 400;
    box-shadow: none;
  }
  .parent .destination {
    min-block-size: 32px;
    padding-block: 0.375rem;
    font-weight: 600;
  }
  .destination > span:first-child {
    overflow-wrap: anywhere;
  }
  .destination.current {
    border-inline-start-color: var(--accent);
    color: var(--accent);
  }
  .synthetic {
    font-style: normal;
    transform: skewX(-12deg);
    font-variant-caps: all-small-caps;
    font-synthesis: small-caps;
  }
  .positions {
    color: var(--muted);
    font-variant-numeric: tabular-nums;
    font-size: var(--small);
    padding-block-start: 0.2em;
  }
  .destination:active {
    color: var(--accent);
    filter: none;
  }
  @media (hover: hover) and (pointer: fine) {
    .contents-toggle:hover {
      color: var(--accent);
      background: transparent;
      box-shadow: none;
    }
    .destination:hover {
      color: var(--accent);
      background: transparent;
      border-color: transparent;
      box-shadow: none;
    }
    .destination.current:hover {
      border-inline-start-color: var(--accent);
    }
  }
  @media (pointer: coarse) {
    .contents {
      --contents-close-size: 44px;
      --contents-disclosure-size: 44px;
    }
    ul > li + li:has(> .parent) {
      margin-block-start: 0.25rem;
    }
    .contents-toggle,
    footer label {
      min-block-size: 44px;
    }
  }
  @media (width <= 30rem) {
    .contents {
      --contents-disclosure-size: 24px;
    }
    ul ul {
      margin-inline-start: 0.5rem;
      padding-inline-start: 0.25rem;
    }
  }
  @container contents (width <= 16em) {
    header {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      gap: 0 var(--gap);
    }
    header strong {
      grid-area: 1 / 1;
    }
    header .icon-button {
      grid-area: 1 / 2;
    }
    .contents-toggle {
      grid-area: 2 / 1 / 3 / -1;
      justify-self: end;
      padding-inline-end: 0;
    }
  }
</style>
