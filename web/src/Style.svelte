<!-- Shows the active Source's Style profiles, their guidance, and parameter groups. -->

<script lang="ts">
  import type { SvelteSet } from "svelte/reactivity"
  import { groups, matchingProfile, objects, resolve, visibleProfiles } from "./styles.ts"
  import { pageRanges } from "./pages.ts"
  import type { Entry } from "./styles.ts"
  import type { Source } from "./model.ts"
  import Control from "./Control.svelte"
  import Guidance from "./Guidance.svelte"
  import Icon from "./Icon.svelte"
  import Quartet from "./Quartet.svelte"
  import type { TourStep } from "./Tour.svelte"
  let {
    source,
    controls,
    counts,
    style,
    profile,
    perFile = $bindable(false),
    shared,
    reset,
    folded,
    toolbarOnly = false,
    tour,
  }: {
    source: Source
    controls: string[]
    counts: Map<number, number>
    style: (id: string, text: string) => void
    profile: (setId: string, profileId: string) => void
    perFile?: boolean
    shared: boolean
    reset: (id?: string) => void
    folded: SvelteSet<string>
    toolbarOnly?: boolean
    tour?: TourStep
  } = $props()
  const key = $props.id()
  const controlSet = $derived(new Set(controls))
  const definition = $derived(source.input.description)
  const groupObjects = $derived(toolbarOnly ? undefined : objects(definition))
  const profiles = $derived(toolbarOnly ? [] : visibleProfiles(definition, controls))
  const targetKeys = $derived.by(() => {
    if (toolbarOnly) return new Map<string, string>()
    const keys = new Map<string, string>()
    for (const [id, item] of Object.entries(definition.parameters))
      keys.set(id, JSON.stringify(item.parameter.binding.targets.toSorted()))
    return keys
  })
  const parameterScopes = $derived.by(() => {
    if (toolbarOnly) return new Map<string, string>()
    const scopes = new Map<string, string>()
    for (const [id, item] of Object.entries(definition.parameters))
      scopes.set(id, pageRanges(item.pages.toSorted((a, b) => a - b)))
    return scopes
  })
  const profileScopes = $derived.by(() => {
    const scopes = new Map<string, string>()
    for (const set of profiles) {
      const pages = new Set<number>()
      for (const id of set.parameters) for (const page of definition.parameters[id].pages) pages.add(page)
      scopes.set(set.id, pageRanges([...pages].toSorted((a, b) => a - b)))
    }
    return scopes
  })
  const sections = $derived(
    groups(definition)
      .map((group) => ({
        ...group,
        key: `${source.id}:${group.parameters[0]}`,
        parameters: group.parameters.filter((id) => controlSet.has(id)),
      }))
      .filter((group) => group.parameters.length),
  )
  const keys = $derived(sections.map((group) => group.key))
  const closed = $derived(keys.every((id) => folded.has(id)))
  const changed = $derived(Object.keys(source.overrides).length > 0 || Object.keys(source.drafts).length > 0)
  function entry(id: string): Entry {
    return resolve(definition.parameters[id], source.overrides, id)
  }
</script>

{#snippet field(id: string, caption?: string, compact = false)}
  {@const pages = definition.parameters[id].pages}
  {@const coverage = pages.reduce((total, page) => total + (counts.get(page) ?? 0), 0)}
  <Control
    {id}
    entry={entry(id)}
    draft={Object.hasOwn(source.drafts, id) ? source.drafts[id] : undefined}
    change={style}
    reset={(target) => reset(target)}
    {coverage}
    scope={parameterScopes.get(id) ?? ""}
    {caption}
    {compact}
  />
{/snippet}

{#snippet fields(ids: string[])}
  {@const items = groupObjects!(ids)}
  {#each items as object (object.parameters[0])}
    {#if object.quartet}
      {@const representative = object.quartet.visibility ?? object.parameters[0]}
      {@const schema = entry(representative).parameter.schema}
      {@const label = schema.title ?? representative}
      <div class="style-object" role="group" aria-label={label}>
        <h4>
          <span>
            {label}
            {#if schema.description}
              <span class="control-description">{schema.description}</span>
            {/if}
          </span>
          <Guidance title={label} details={schema.details} />
        </h4>
        <Quartet quartet={object.quartet} {entry} drafts={source.drafts} {field} change={style} />
      </div>
    {:else}
      {@render field(object.parameters[0])}
    {/if}
  {/each}
{/snippet}

{#if toolbarOnly}
  <div class="style-actions">
    {#if keys.length > 1}<button
        type="button"
        class="icon-button"
        aria-label={closed ? "Unfold all Style groups" : "Fold all Style groups"}
        title={closed ? "Unfold all groups" : "Fold all groups"}
        onclick={() => {
          const unfold = closed
          for (const id of keys) {
            if (unfold) folded.delete(id)
            else folded.add(id)
          }
        }}><Icon name={closed ? "expand" : "collapse"} /></button
      >{/if}
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
            (selected ? `Styles from ${selected.name}.` : "Custom styles. Choose a profile to apply its values.")}
          {@const pages = profileScopes.get(set.id) ?? ""}
          <div
            class="style-profile"
            data-tour-target={set === profiles[0] ? "style-profile" : undefined}
            data-tour-active={tour === "style-profile" && set === profiles[0]}
          >
            {#if set.description}<span hidden id={`${key}-set-${index}`}>{set.description}</span>{/if}
            <div class="entry profile-choice">
              {#if index === 0}<button
                  class="step"
                  disabled={!shared}
                  popovertarget={`${key}-profile-options`}
                  aria-label="Profile options"
                  title="Profile options"><Icon name="more" /></button
                >
                <div
                  id={`${key}-profile-options`}
                  class="profile-options"
                  popover="auto"
                  role="group"
                  aria-label="Profile options"
                >
                  <label><input type="checkbox" bind:checked={perFile} />Apply only to this file</label>
                  <p class="control-description">
                    When off, compatible profiles and edits apply across open files. Different values stay unchanged.
                  </p>
                  {#each profiles as group (group.id)}
                    {#if group.description}<p class="control-description">{group.name}: {group.description}</p>{/if}
                  {/each}
                </div>{/if}
              <div class="select">
                <select
                  aria-label={set.name}
                  value={selected?.id ?? ""}
                  title={`${set.name}.${set.description ? ` ${set.description}` : ""} Applies to Input pages: ${pages}.`}
                  aria-describedby={`${key}-profile-${index}${set.description ? ` ${key}-set-${index}` : ""}`}
                  onchange={(event) => profile(set.id, event.currentTarget.value)}
                >
                  {#if !selected}<option value="" disabled>Custom</option>{/if}
                  {#each set.profiles as choice (choice.id)}<option value={choice.id}>{choice.name}</option>{/each}
                </select>
                <Icon name="next" />
              </div>
              <Guidance title={set.name} details={set.details} />
            </div>
            <div class="profile-summary">
              <p id={`${key}-profile-${index}`} class="control-description">
                <span>{description}</span>
              </p>
              {#key selected}
                <Guidance title={selected?.name ?? set.name} details={selected?.details} />
              {/key}
            </div>
          </div>
        {/each}
        <div class="control-list">
          {#each sections as group (group.key)}
            {@const count = new Set(group.parameters.map((id) => targetKeys.get(id))).size}
            {@const countLabel = `${count} ${count === 1 ? "Style object" : "Style objects"}`}
            <details
              class="style-group"
              open={!folded.has(group.key)}
              ontoggle={(event) => {
                if (event.currentTarget.open) folded.delete(group.key)
                else folded.add(group.key)
              }}
            >
              <summary>
                <span>
                  <span>{group.title}</span>
                  {#if group.description}<span class="control-description">{group.description}</span>{/if}
                </span>
                <Guidance title={group.title} details={group.details} />
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
