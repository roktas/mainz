<!-- Presents page titles, provenance, copy mappings, and previews in page-detail disclosures. -->

<script module lang="ts">
  import type { Source, Size } from "./model.ts"
  type Identity =
    | { source: Source; page: number; tocTitles?: boolean; destinations?: readonly number[] }
    | { blank: Size; padding: boolean }
</script>

<script lang="ts">
  import { flushSync, onDestroy } from "svelte"
  import type { Snippet } from "svelte"
  import Provenance from "./Provenance.svelte"
  import Breadcrumb from "./Breadcrumb.svelte"
  import { titleOf } from "./model.ts"
  import { titlesOf } from "./outline.ts"
  import { pageRanges } from "./pages.ts"

  let {
    id,
    pane,
    number,
    identity,
    multiple = false,
    mode,
    opened = $bindable(),
    actions,
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    identity: Identity
    multiple?: boolean
    mode: "normal" | "list"
    opened?: string
    actions?: Snippet
  } = $props()
  const origin = $derived("source" in identity ? identity.source : undefined)
  const page = $derived("page" in identity ? identity.page : 0)
  const title = $derived(origin && titlesOf(origin.input).at(page, "tocTitles" in identity && identity.tocTitles))
  const name = $derived(title?.name)
  const paths = $derived(pane === "Input" ? title?.paths : undefined)
  const label = $derived(origin?.input.labels[page])
  const source = $derived(
    pane === "Output" && mode === "list" && multiple && origin
      ? { number: origin.number, title: titleOf(origin.input) }
      : undefined,
  )
  const destinations = $derived("destinations" in identity ? (identity.destinations ?? []) : [])
  const details = $derived(
    pane === "Output" || destinations.length > 0 || !!title?.headings.length || (!!label && label !== String(page + 1)),
  )
  onDestroy(() => {
    if (opened === id) opened = undefined
  })
</script>

{#snippet numberLabel()}
  <strong><span>{number}</span></strong>
  {#if source}<Provenance id={`${id}-source`} number={source.number} title={source.title} />{/if}
{/snippet}
{#snippet pageDetails()}
  <table class="page-details">
    <tbody>
      {#if origin}
        {#if pane === "Output"}<tr><th scope="row">Input</th><td>{origin.input.name}</td></tr>{/if}
        <tr><th scope="row">{pane === "Input" ? "Page" : "Original page"}</th><td>{page + 1}</td></tr>
        {#if label && label !== String(page + 1)}<tr><th scope="row">Page Label</th><td>{label}</td></tr>{/if}
        {#if pane === "Input"}<tr
            ><th scope="row">Output</th><td
              >{destinations.length}×{#if destinations.length}{" → "}{pageRanges(destinations)}{/if}</td
            ></tr
          >{/if}
      {:else if "blank" in identity}<tr
          ><th scope="row">Size</th><td>{identity.blank.width.toFixed(1)} × {identity.blank.height.toFixed(1)} mm</td
          ></tr
        >{/if}
    </tbody>
  </table>
{/snippet}
{#snippet detailBody()}
  {#if pane === "Input"}
    {#each title?.context ?? [] as path}<span class="page-context">{path.join(" › ")}</span>{/each}
  {:else if origin}
    {#if multiple}<strong>{titleOf(origin.input)}</strong>{/if}
  {:else if "blank" in identity}<strong>{identity.padding ? "Padding" : "Blank"}</strong>{/if}
  {@render pageDetails()}
{/snippet}
{#snippet caption()}
  {#if mode !== "list" && name && opened !== id}<p class="page-name">{name}</p>{/if}
{/snippet}
{#snippet detailHeading()}
  {#if paths?.length}<div class="detail-name" role="group" aria-label="Displayed section">
      <Breadcrumb path={paths[0]} />
    </div>
    {#if paths.length > 1}<div class="related-sections" role="group" aria-label="Other sections on this page">
        {#each paths.slice(1) as path}<Breadcrumb {path} />{/each}
      </div>{/if}
  {:else if name}<p class="detail-name">{name}</p>{/if}
{/snippet}

{#if mode === "list" && details}
  <span class="page-origin">
    <button
      class="icon-button"
      popovertarget={id}
      aria-label={`Details for ${pane} page ${number}`}
      aria-describedby={source ? `${id}-source` : undefined}
    >
      {@render numberLabel()}
    </button>
    {@render caption()}
    <div
      {id}
      class="card-menu-options"
      popover="auto"
      onbeforetoggle={(event) => {
        if (event.newState === "open")
          flushSync(() => {
            opened = id
          })
        else if (opened === id) opened = undefined
      }}
    >
      {#if opened === id}
        {@render detailHeading()}
        {@render detailBody()}
      {/if}
    </div>
  </span>
{:else if details}
  <details class="page-origin" open={opened === id}>
    <summary
      aria-label={`Details for ${pane} page ${number}`}
      onclick={(event) => {
        event.preventDefault()
        flushSync(() => {
          opened = opened === id ? undefined : id
        })
      }}>{@render numberLabel()}{@render caption()}</summary
    >
    <div {id} class="page-origin-info">
      {@render detailHeading()}{@render detailBody()}
    </div>
  </details>
{:else}
  <span class="page-number">{@render numberLabel()}{@render caption()}</span>
{/if}

<style>
  .related-sections {
    color: var(--muted);
    font-weight: 400;
  }
</style>
