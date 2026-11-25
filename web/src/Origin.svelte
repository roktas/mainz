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
  import Guidance from "./Guidance.svelte"
  import Provenance from "./Provenance.svelte"
  import { titleOf } from "./model.ts"
  import { titlesOf } from "./outline.ts"
  import { pageRanges } from "./pages.ts"

  let {
    id,
    pane,
    number,
    count,
    identity,
    multiple = false,
    mode,
    navigation,
    opened = $bindable(),
  }: {
    id: string
    pane: "Input" | "Output"
    number: number
    count?: number
    identity: Identity
    multiple?: boolean
    mode: "normal" | "list"
    navigation?: Snippet
    opened?: string
  } = $props()
  const origin = $derived("source" in identity ? identity.source : undefined)
  const page = $derived("page" in identity ? identity.page : 0)
  const title = $derived(origin && titlesOf(origin.input).at(page, "tocTitles" in identity && identity.tocTitles))
  const name = $derived(title?.name)
  const label = $derived.by(() => {
    const value = origin?.input.labels[page]
    return value === String(page + 1) && (pane === "Input" || count === undefined) ? undefined : value
  })
  const labelHelp = "The source PDF supplies this label. The counter shows the page's position in this pane."
  const source = $derived(
    pane === "Output" && mode === "list" && multiple && origin
      ? { number: origin.number, title: titleOf(origin.input) }
      : undefined,
  )
  const destinations = $derived("destinations" in identity ? (identity.destinations ?? []) : [])
  const details = $derived(
    pane === "Output" ||
      destinations.length > 0 ||
      !!title?.headings.length ||
      !!label ||
      (count !== undefined && !!name),
  )
  onDestroy(() => {
    if (opened === id) opened = undefined
  })
</script>

{#snippet numberLabel()}
  {#if count !== undefined}<strong class="page-position">
      <span class="page-current">{number}</span><span class="page-total">/ {count}</span>
    </strong>
  {:else}
    <strong><span>{number}</span></strong>
    {#if source}<Provenance id={`${id}-source`} number={source.number} title={source.title} />{/if}
  {/if}
{/snippet}
{#snippet pageDetails()}
  <table class="page-details">
    <tbody>
      {#if origin}
        {#if pane === "Output"}<tr><th scope="row">Input</th><td>{origin.input.name}</td></tr>{/if}
        <tr><th scope="row">{pane === "Input" ? "Page" : "Original page"}</th><td>{page + 1}</td></tr>
        {#if label}<tr><th scope="row">Page Label</th><td>{label}</td></tr>{/if}
        {#if pane === "Input"}<tr
            ><th scope="row">Output</th><td
              >{`${destinations.length}×${destinations.length ? ` → ${pageRanges(destinations)}` : ""}`}</td
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
    {#each title?.context ?? [] as path (path)}<span class="page-context">{path.join(" › ")}</span>{/each}
  {:else if origin}
    {#if multiple}<strong>{titleOf(origin.input)}</strong>{/if}
  {:else if "blank" in identity}<strong>{identity.padding ? "Padding" : "Blank"}</strong>{/if}
  {@render pageDetails()}
  {#if navigation}{@render navigation()}{/if}
{/snippet}
{#snippet caption()}
  {#if mode !== "list" && name && opened !== id}<p class="page-name">{name}</p>{/if}
{/snippet}
{#snippet detailHeading()}
  {#if name}<p class="detail-name">{name}</p>{/if}
{/snippet}

{#snippet disclosure()}
  {#if details}
    <span class="page-origin">
      <button
        class={count === undefined ? "icon-button" : "page-counter"}
        popovertarget={id}
        aria-label={`Details for ${pane} page ${number}`}
        aria-describedby={source ? `${id}-source` : count === undefined ? undefined : `${id}-counter`}
      >
        {@render numberLabel()}
      </button>
      {#if count !== undefined}<span hidden id={`${id}-counter`}>{number} of {count}</span>{/if}
      {@render caption()}
      <div
        {id}
        class={mode === "list" ? "card-menu-options" : "page-origin-info"}
        popover="auto"
        onbeforetoggle={(event) => {
          if (event.newState === "open")
            flushSync(() => {
              opened = id
            })
          else if (opened === id) opened = undefined
        }}
      >
        {#if mode !== "list" || opened === id}
          {@render detailHeading()}
          {@render detailBody()}
        {/if}
      </div>
    </span>
  {:else}
    <span class="page-number">{@render numberLabel()}{@render caption()}</span>
  {/if}
{/snippet}

{#if count === undefined}
  {@render disclosure()}
{:else}
  <span class="page-number-control">
    {@render disclosure()}
    {#if label}<span class="counter-label">
        <Guidance
          title={`Page label · ${label}`}
          {label}
          details={labelHelp}
          tooltip={`Page label · ${label}\n${labelHelp}`}
          ariaLabel={`Page label: ${label}`}
        />
      </span>{/if}
  </span>
{/if}
