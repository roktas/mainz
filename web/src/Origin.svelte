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
  import Pdf from "./Pdf.svelte"
  import Icon from "./Icon.svelte"
  import { titleOf } from "./model.ts"
  import { titlesOf } from "./outline.ts"
  import { pageRanges } from "./pages.ts"
  import type { Magnification } from "./Lens.svelte"

  let {
    id,
    pane,
    number,
    identity,
    multiple = false,
    mode,
    opened = $bindable(),
    magnification = 16,
    error,
    actions,
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    identity: Identity
    multiple?: boolean
    mode: "normal" | "compact" | "list"
    opened?: string
    magnification?: Magnification
    error: (message: string) => void
    actions?: Snippet
  } = $props()
  const origin = $derived("source" in identity ? identity.source : undefined)
  const page = $derived("page" in identity ? identity.page : 0)
  const title = $derived(origin && titlesOf(origin.input).at(page, "tocTitles" in identity && identity.tocTitles))
  const name = $derived(title?.name)
  const paths = $derived(pane === "Input" ? title?.paths : undefined)
  const label = $derived(pane === "Input" ? origin?.input.labels[page] : undefined)
  const source = $derived(
    pane === "Output" && mode === "list" && multiple && origin
      ? { number: origin.number, title: titleOf(origin.input) }
      : undefined,
  )
  const destinations = $derived("destinations" in identity ? (identity.destinations ?? []) : [])
  const details = $derived(pane === "Output" || destinations.length > 0 || !!title?.sectionCount)
  const appearance = $derived(
    origin &&
      (pane === "Input"
        ? { pdf: origin.input.pdf, page, preview: origin.input.description.pages[page]?.preview }
        : origin.preview.appearance(page)),
  )
  onDestroy(() => {
    if (opened === id) opened = undefined
  })
</script>

{#snippet numberLabel()}
  <strong><span>{number}</span></strong>
  {#if source}<Provenance id={`${id}-source`} number={source.number} title={source.title} />{/if}
  {#if label && label !== String(number)}<span class="page-context">{label}</span>{/if}
{/snippet}
{#snippet copyNote()}
  <span class="page-context"
    >Output · <strong>{destinations.length}×</strong>{#if destinations.length}{" → "}{pageRanges(
        destinations,
      )}{/if}</span
  >
{/snippet}
{#snippet detailBody()}
  {#if pane === "Input"}
    {#each title?.context ?? [] as path}<span class="page-context">{path.join(" › ")}</span>{/each}
    {@render copyNote()}
  {:else if origin}
    {#if multiple}<strong>{titleOf(origin.input)}</strong>{/if}
    <span class="page-context">{origin.input.name} · p. {page + 1}</span>
    {#if origin.input.labels[page] && origin.input.labels[page] !== String(page + 1)}<span class="page-context"
        >PDF label: {origin.input.labels[page]}</span
      >{/if}
  {:else if "blank" in identity}
    <strong>{identity.padding ? "Padding" : "Blank"}</strong>
    <span class="page-context">{identity.blank.width.toFixed(1)} × {identity.blank.height.toFixed(1)} mm</span>
  {/if}
{/snippet}
{#snippet compactBody()}
  <div class="card-preview">
    {#if appearance}<Pdf {...appearance} pageNumber={page + 1} {name} thumbnail {magnification} {error} />
    {:else if "blank" in identity}<div
        class="composition-blank"
        style:--ratio={identity.blank.width / identity.blank.height}
      >
        <Icon name="blank" /><span>{identity.padding ? "Padding" : "Blank"}</span>
      </div>{/if}
  </div>
  <p class="page-context">
    {origin?.input.name ?? ("blank" in identity && identity.padding ? "Padding" : "Blank")}{#if origin}
      · {pane === "Input" ? `${page % 2 ? "Back" : "Front"} side` : `original page ${page + 1}`}{/if}
  </p>
  {#if pane === "Input" && destinations.length}{@render copyNote()}{/if}
  {#if actions}{#if pane === "Input"}<div class="occurrence-actions input-menu-action">
        {@render actions()}
      </div>{:else}{@render actions()}{/if}{/if}
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

{#if mode === "compact" || (mode === "list" && details)}
  <span class="page-origin">
    <button
      class={mode === "list" ? "icon-button" : "card-number"}
      popovertarget={id}
      aria-label={`Details for ${pane} page ${number}`}
      aria-describedby={source ? `${id}-source` : undefined}
    >
      {#if mode === "list"}{@render numberLabel()}{:else}<strong>{number}</strong>{/if}
    </button>
    {@render caption()}
    <div
      {id}
      class="card-menu-options"
      data-preview={mode === "compact" || undefined}
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
        {#if mode === "compact"}
          <strong>{pane} · page {number}</strong>
          {@render compactBody()}
        {:else if details}
          {@render detailBody()}
        {/if}
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
