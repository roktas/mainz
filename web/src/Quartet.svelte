<!-- Summarizes a Style object and opens its Fill, Stroke, Width, and Visibility editors. -->
<script lang="ts">
  import type { Snippet } from "svelte"
  import { current, feedback } from "./styles.ts"
  import type { Entry, PaintDuo, Quartet } from "./styles.ts"
  import Icon from "./Icon.svelte"
  import type { Name } from "./Icon.svelte"
  let {
    quartet,
    entry,
    drafts,
    field,
    change,
  }: {
    quartet: Quartet
    entry: (id: string) => Entry
    drafts: Record<string, string>
    field: Snippet<[id: string, caption?: string, compact?: boolean]>
    change: (id: string, text: string) => void
  } = $props()
  const panelId = $props.id()
  const percent = new Intl.NumberFormat("en", { style: "percent", maximumFractionDigits: 1 })
  const number = new Intl.NumberFormat("en", { maximumSignificantDigits: 4 })
  type Setting = { key: keyof Quartet; label: string; icon: Name; slots: { label: string; id?: string }[] }
  type Summary =
    | { kind: "invalid" | "mixed" | "unassigned"; text: string }
    | { kind: "value"; text: string; value: string }
  const components: Setting[] = $derived([
    {
      key: "fill",
      label: "Fill",
      icon: "palette",
      slots: [
        { label: "Color", id: quartet.fill.color },
        { label: "Opacity", id: quartet.fill.opacity },
      ],
    },
    {
      key: "stroke",
      label: "Stroke",
      icon: "palette",
      slots: [
        { label: "Color", id: quartet.stroke.color },
        { label: "Opacity", id: quartet.stroke.opacity },
      ],
    },
    { key: "width", label: "Width", icon: "width", slots: [{ label: "Width", id: quartet.width }] },
    { key: "visibility", label: "Visibility", icon: "eye", slots: [{ label: "Visibility", id: quartet.visibility }] },
  ])
  let root: HTMLElement
  let active = $state<Setting["key"] | null>(null)
  const selected = $derived(components.find((part) => part.key === active))
  function toggleSetting(key: Setting["key"]) {
    active = active === key ? null : key
  }
  function summary(id: string): Summary {
    const initial = entry(id)
    const draft = Object.hasOwn(drafts, id) ? drafts[id] : undefined
    const text = current(initial, draft)
    if (draft !== undefined && feedback(initial, text)) return { kind: "invalid", text: "Invalid" }
    if (text === "")
      return initial.baseline.kind === "mixed" ? { kind: "mixed", text: "Mixed" } : { kind: "unassigned", text: "—" }
    const property = initial.parameter.binding.property
    let label = text
    if (property === "display") label = text === "inline" ? "Show" : "Hide"
    else if (property.endsWith("opacity")) label = percent.format(Number(text))
    else if (property === "stroke-width") label = `${number.format(Number(text))} mm`
    return { kind: "value", text: label, value: text }
  }
  function hint(id: string): string {
    const value = summary(id)
    const baseline = entry(id).baseline
    if (value.kind === "unassigned" && baseline.kind === "unrepresentable")
      return `Original style retained. ${baseline.reason}`
    if (value.kind === "mixed") return "Original styles retained. The objects use different values."
    return value.text
  }
  function closeEditors(target?: EventTarget | null) {
    if (active && (!target || !root.contains(target as Node))) {
      if (!target && root.querySelector(".quartet-panel")?.contains(document.activeElement))
        root.querySelector<HTMLButtonElement>('.quartet-trigger[aria-expanded="true"]')?.focus()
      active = null
    }
  }
</script>

<svelte:document onclick={(event) => closeEditors(event.target)} />
<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") closeEditors()
  }}
/>

{#snippet metric(label: string, id?: string)}
  {#if id}
    {@const value = summary(id)}
    <span
      class={[
        "quartet-value",
        {
          invalid: value.kind === "invalid",
          uncertain: value.kind === "unassigned" || value.kind === "mixed",
        },
      ]}
    >
      <span class="quartet-text" title={`${label}: ${hint(id)} · ${entry(id).parameter.schema.title ?? label}`}>
        <span aria-hidden="true" data-value={value.text}></span>
        <span>{value.text}</span>
      </span>
    </span>
  {:else}
    <span
      class="quartet-value unavailable"
      role="note"
      aria-label={`${label}: not applicable`}
      title={`N/A: This PDF has no ${label.toLowerCase()} parameter for this object.`}
    >
      <Icon name="ban" />
    </span>
  {/if}
{/snippet}

{#snippet paint(label: string, duo: PaintDuo)}
  {@const color = duo.color}
  {@const opacity = duo.opacity}
  {@const hue = color ? current(entry(color), Object.hasOwn(drafts, color) ? drafts[color] : undefined) : ""}
  {@const alpha = opacity ? current(entry(opacity), Object.hasOwn(drafts, opacity) ? drafts[opacity] : undefined) : ""}
  {@const known = color && /^#[0-9a-fA-F]{6}$/.test(hue) && !feedback(entry(color), hue)}
  {@const knownOpacity = opacity && alpha !== "" && !feedback(entry(opacity), alpha)}
  {@const colorHelp = color
    ? `${label} color: ${hint(color)}`
    : `N/A: This object has no ${label.toLowerCase()} color parameter.`}
  {@const opacityHelp = opacity
    ? `${label} opacity: ${hint(opacity)}`
    : `N/A: This object has no ${label.toLowerCase()} opacity parameter.`}
  {#if !color && !opacity}
    <span
      class="quartet-value unavailable"
      role="note"
      aria-label={`${label} Paint duo: not applicable`}
      title={`N/A: This PDF declares neither ${label.toLowerCase()} color nor ${label.toLowerCase()} opacity for this object.`}
    >
      <Icon name="ban" />
    </span>
  {:else}<span class="paint-duo" role="group" aria-label={`${label} Paint duo`}>
      <span class="paint-values">
        <span class="paint-line">
          <span class={["paint-swatch", { unknown: !known }]} role="img" aria-label={colorHelp} title={colorHelp}>
            {#if known}<span style:background={hue}></span>
            {:else}<Icon name="ban" />{/if}
          </span>
          {@render metric(`${label} color`, color)}
        </span>
        <span class="paint-line">
          <span
            class={["paint-opacity", { known: knownOpacity }]}
            role="img"
            aria-label={opacityHelp}
            title={opacityHelp}
          >
            {#if knownOpacity}
              <span style:block-size={`${Number(alpha) * 100}%`} aria-hidden="true"></span>
            {:else}<Icon name="ban" />{/if}
          </span>
          {@render metric(`${label} opacity`, opacity)}
        </span>
      </span>
    </span>
  {/if}
{/snippet}

{#snippet visibility(id: string)}
  {@const value = summary(id)}
  <label
    class={["quartet-switch", { invalid: value.kind === "invalid" }]}
    title="Object visibility, including its outlines and fill."
  >
    <input
      type="checkbox"
      checked={value.kind === "value" && value.value === "inline"}
      indeterminate={value.kind !== "value"}
      aria-label={`${entry(id).parameter.schema.title ?? "Visibility"} · Show/Hide object`}
      aria-invalid={value.kind === "invalid"}
      onchange={(event) => change(id, event.currentTarget.checked ? "inline" : "none")}
    />
    <span>{value.text}</span>
  </label>
{/snippet}

{#snippet editor(component: Setting)}
  <div class="quartet-panel">
    <section aria-label={`${component.label}${component.slots.length === 2 ? " Paint duo" : ""} editor`}>
      <h4>
        <Icon name={component.icon} />{component.label}{component.slots.length === 2 ? " Paint" : ""}
      </h4>
      <div class={{ "paint-controls": component.slots.length === 2 }}>
        {#each component.slots as slot (slot.label)}
          {#if slot.id}{@render field(slot.id, slot.label, true)}
          {:else}{@render metric(`${component.label} ${slot.label.toLowerCase()}`)}{/if}
        {/each}
      </div>
    </section>
  </div>
{/snippet}

{#snippet heading(part: Setting)}
  <span class="quartet-caption"><Icon name={part.icon} /><span>{part.label}</span></span>
{/snippet}

{#snippet component(part: Setting)}
  <span class="quartet-component">
    <span class="quartet-type">{@render heading(part)}</span>
    {#if part.key === "visibility" && part.slots[0].id}
      {@render visibility(part.slots[0].id)}
    {:else if part.slots.length === 2}
      {@render paint(part.label, part.key === "fill" ? quartet.fill : quartet.stroke)}
    {:else}
      {@render metric(part.label, part.slots[0].id)}
    {/if}
  </span>
{/snippet}

<section class="quartet" aria-label="Quartet" bind:this={root}>
  <div class="quartet-bar">
    <div class="quartet-fields">
      {#each components as part (part.key)}
        <div class="quartet-property">
          {#if part.slots.some((slot) => slot.id)}
            {#if part.key === "visibility"}
              <span class="quartet-component">
                <button
                  class="quartet-trigger quartet-type"
                  aria-label="Edit Visibility"
                  aria-expanded={selected?.key === part.key}
                  aria-controls={panelId}
                  onclick={() => toggleSetting(part.key)}>{@render heading(part)}</button
                >
                {@render visibility(part.slots[0].id!)}
              </span>
            {:else}
              <button
                class="quartet-trigger"
                aria-label={`Edit ${part.label}`}
                aria-expanded={selected?.key === part.key}
                aria-controls={panelId}
                onclick={() => toggleSetting(part.key)}>{@render component(part)}</button
              >
            {/if}
          {:else}{@render component(part)}{/if}
        </div>
      {/each}
      <div id={panelId} class="quartet-dock" hidden={!selected}>
        {#if selected}{@render editor(selected)}{/if}
      </div>
    </div>
  </div>
</section>
