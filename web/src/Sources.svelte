<!-- Renders open Input choices, document metadata details, and active Input actions. -->

<script lang="ts">
  import { titleOf } from "./model.ts"
  import type { Input, Source } from "./model.ts"
  import Guidance from "./Guidance.svelte"
  import Icon from "./Icon.svelte"
  import Provenance from "./Provenance.svelte"

  let {
    sources,
    activeId,
    compact = false,
    close,
    onSelect,
    onView,
    onRemove,
  }: {
    sources: readonly Source[]
    activeId?: string
    compact?: boolean
    close: () => void
    onSelect: (id: string) => void
    onView: () => void
    onRemove: (close: () => void) => void
  } = $props()

  const key = $props.id()

  function inputDetails(input: Input) {
    if (!input.xmp && (!input.title || input.title === input.name)) return undefined
    return { Filename: input.name, ...(input.title ? { "dc:title": input.title } : {}), ...input.xmp }
  }
</script>

{#each sources as source (source.id)}
  {@const details = inputDetails(source.input)}
  <div class="input-choice" data-active={source.id === activeId || undefined}>
    <Guidance
      label={String(source.number)}
      ariaLabel={`Details for Input ${source.number}`}
      title={source.input.title || source.input.name}
      fields={details && Object.keys(details).length ? details : { Filename: source.input.name }}
    />
    <button
      class="input-choice-select"
      aria-pressed={source.id === activeId}
      data-source={source.id}
      onclick={() => {
        onSelect(source.id)
        close()
      }}
      ><span
        >{#if sources.length > 1}<Provenance
            id={`${key}-source-${source.id}`}
            number={source.number}
            title={titleOf(source.input)}
          />{/if}<span>{source.input.name}</span></span
      >{#if source.input.title && source.input.title !== source.input.name}<span
          class="input-choice-title"
          title={source.input.title}>{source.input.title}</span
        >{/if}{#if source.id === activeId}<span aria-hidden="true">✓</span>{/if}</button
    >
  </div>
{/each}
{#if compact}<hr />
  <div class="file-actions">
    <button
      class="icon-button view-action"
      aria-label="View PDF"
      onclick={() => {
        close()
        onView()
      }}><Icon name="eye" /><span>View PDF</span></button
    >
  </div>{/if}
<div class="input-list-actions">
  <button class="danger" aria-label="Remove Input" title="Remove Input" onclick={() => onRemove(close)}
    ><Icon name="trash" /><span>Remove Input</span></button
  >
</div>
