<!-- Renders the active Input switcher menu and file-open trigger. -->

<script lang="ts">
  import { titleOf } from "./model.ts"
  import type { Source } from "./model.ts"
  import FilePicker from "./FilePicker.svelte"
  import Icon from "./Icon.svelte"
  import Provenance from "./Provenance.svelte"
  import Sources from "./Sources.svelte"

  let {
    menu = $bindable(),
    heading,
    active,
    sources,
    activeId,
    provisional = false,
    disabled = false,
    onSelect,
    onView,
    onRemove,
    onClose,
    onFiles,
  }: {
    menu?: HTMLDetailsElement
    heading: string
    active?: Source
    sources: readonly Source[]
    activeId?: string
    provisional?: boolean
    disabled?: boolean
    onSelect: (id: string) => void
    onView: () => void
    onRemove: (close: () => void) => void
    onClose: () => void
    onFiles: (files: FileList) => void
  } = $props()
</script>

{#if active}<details class="input-picker" bind:this={menu}>
    <summary aria-label={`Select Input · ${active.input.name}`}>
      <h2 id={heading}>
        <Icon name="input" /><span class="input-label">Input</span><span class="count"
          >{sources.length + Number(provisional)}</span
        >{#if sources.length > 1}<Provenance number={active.number} title={titleOf(active.input)} />{/if}<span
          class="input-current"
          title={active.input.title || active.input.name}>{active.input.title || active.input.name}</span
        >
        <span class="input-chevron"><Icon name="next" /></span>
      </h2>
    </summary>
    <div class="input-list" role="group" aria-label="Inputs">
      <Sources {sources} {activeId} close={onClose} {onSelect} {onView} {onRemove} />
    </div>
  </details>{/if}
<FilePicker {disabled} {onFiles} />
