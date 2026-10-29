<!-- Shows the active Source's applicable Style profiles and parameter groups. -->

<script lang="ts">
  import { feedback, groups, matchingProfile, objects, resolve } from "./styles.ts"
  import { pageRanges } from "./pages.ts"
  import type { Entry } from "./styles.ts"
  import type { Source } from "./model.ts"
  import Control from "./Control.svelte"
  import Icon from "./Icon.svelte"
  import Quartet from "./Quartet.svelte"
  import type { TourStep } from "./Tour.svelte"
  let {
    source,
    controls,
    counts,
    style,
    profile,
    reset,
    toolbarOnly = false,
    tour,
  }: {
    source: Source
    controls: string[]
    counts: Map<number, number>
    style: (id: string, text: string) => void
    profile: (setId: string, profileId: string) => void
    reset: (id?: string) => void
    toolbarOnly?: boolean
    tour?: TourStep
  } = $props()
  const key = $props.id()
  const definition = $derived(source.input.description)
  const groupObjects = $derived(objects(definition))
  const profiles = $derived(
    (definition.profileSets ?? []).filter(
      (set) => set.profiles.length > 1 && set.parameters.some((id) => controls.includes(id)),
    ),
  )
  const sections = $derived(
    groups(definition)
      .map((group) => ({
        ...group,
        parameters: group.parameters.filter((id) => controls.includes(id)),
      }))
      .filter((group) => group.parameters.length),
  )
  const changed = $derived(Object.keys(source.overrides).length > 0 || Object.keys(source.drafts).length > 0)
  const status = $derived(
    source.preview.status === "error"
      ? "Styles need retry"
      : Object.entries(source.drafts).some(([id, text]) => feedback(definition.parameters[id], text))
        ? "Invalid style draft"
        : "",
  )
  function entry(id: string): Entry {
    return resolve(definition.parameters[id], source.overrides, id)
  }
</script>

{#snippet field(id: string, caption?: string, compact = false)}
  {@const pages = definition.parameters[id].pages.map((page) => definition.pages[page].index)}
  {@const coverage = pages.reduce((total, page) => total + (counts.get(page) ?? 0), 0)}
  <Control
    {id}
    entry={entry(id)}
    draft={Object.hasOwn(source.drafts, id) ? source.drafts[id] : undefined}
    change={style}
    reset={(id) => reset(id)}
    {coverage}
    scope={pageRanges(pages.toSorted((a, b) => a - b))}
    {caption}
    {compact}
  />
{/snippet}

{#snippet fields(ids: string[])}
  {@const items = groupObjects(ids)}
  {#each items as object (object.parameters[0])}
    {#if object.quartet}
      {@const representative = object.quartet.visibility ?? object.parameters[0]}
      {@const schema = entry(representative).parameter.schema}
      {@const label = schema.title ?? representative}
      <div class="style-object" role="group" aria-label={label}>
        <h4>
          <span>{label}</span>
          {#if schema.description}
            <span class="control-description">
              {schema.description}
            </span>
          {/if}
        </h4>
        <Quartet quartet={object.quartet} {entry} drafts={source.drafts} {field} change={style} />
      </div>
    {:else}
      {@render field(object.parameters[0])}
    {/if}
  {/each}
{/snippet}

{#if toolbarOnly}
  <div class="style-status">
    {#if status}<span class="danger" role="status" title={status}>{status}</span>{/if}
    {#if changed}
      <button
        class="icon-button danger"
        onclick={(event) => {
          if (document.activeElement === event.currentTarget)
            event.currentTarget
              .closest(".selection-panel")
              ?.querySelector<HTMLButtonElement>('.source-tabs [role="tab"][aria-selected="true"]')
              ?.focus({ preventScroll: true })
          reset()
        }}
        aria-label="Reset all styles"
        title="Reset Input styles"><Icon name="reset" /></button
      >
    {/if}
  </div>
{:else}
  <div class="workspace-content">
    <div class="source-layout">
      <div class="source-tools">
        {#each profiles as set, index (set.id)}
          {@const selected = matchingProfile(set, source.overrides, source.drafts)}
          {@const description =
            selected?.description ||
            (selected
              ? set.description || `Styles from ${selected.name}.`
              : "Custom styles. Choose a profile to apply its values.")}
          {@const pages = pageRanges(
            [...new Set(set.parameters.flatMap((id) => definition.parameters[id].pages))]
              .map((page) => definition.pages[page].index)
              .toSorted((a, b) => a - b),
          )}
          <div
            class="style-profile"
            data-tour-target={set === profiles[0] ? "style-profile" : undefined}
            data-tour-active={tour === "style-profile" && set === profiles[0]}
          >
            <div class="select">
              <select
                aria-label={set.name}
                value={selected?.id ?? ""}
                title={`${set.name}. Applies to Input pages: ${pages}.`}
                aria-describedby={`${key}-profile-${index}`}
                onchange={(event) => profile(set.id, event.currentTarget.value)}
              >
                {#if !selected}<option value="" disabled>Custom</option>{/if}
                {#each set.profiles as choice (choice.id)}<option value={choice.id}>{choice.name}</option>{/each}
              </select>
              <Icon name="next" />
            </div>
            <p id={`${key}-profile-${index}`} class="control-description">
              {description}
            </p>
          </div>
        {/each}
        <div class="control-list">
          {#each sections as group (group.parameters[0])}
            {@const count = new Set(
              group.parameters.map((id) =>
                JSON.stringify(definition.parameters[id].parameter.binding.targets.toSorted()),
              ),
            ).size}
            {@const countLabel = `${count} ${count === 1 ? "Style object" : "Style objects"}`}
            <details class="style-group" open>
              <summary>
                <span>
                  <span>{group.title}</span>
                  {#if group.description}<span class="control-description">{group.description}</span>{/if}
                </span>
                <span class="count" role="img" aria-label={countLabel} title={countLabel}>{count}</span>
                <Icon name="next" />
              </summary>
              <fieldset aria-label={group.title}>{@render fields(group.parameters)}</fieldset>
            </details>
          {/each}
        </div>
      </div>
    </div>
  </div>
{/if}
