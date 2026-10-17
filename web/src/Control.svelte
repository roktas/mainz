<!-- Edits one Style parameter with its baseline, constraints, and reset. -->

<script lang="ts">
  import { current, feedback, step } from "./styles.ts"
  import type { Entry } from "./styles.ts"
  import Icon from "./Icon.svelte"
  let {
    id,
    entry,
    draft,
    change,
    reset,
    coverage,
    scope,
    caption,
    compact = false,
  }: {
    id: string
    entry: Entry
    draft?: string
    change: (id: string, text: string) => void
    reset: (id: string) => void
    coverage?: number
    scope: string
    caption?: string
    compact?: boolean
  } = $props()
  const key = $props.id()
  let hovering = $state(false)
  let pinned = $state(false)
  let details = $state<HTMLDetailsElement>(null!)
  const schema = $derived(entry.parameter.schema)
  const title = $derived(
    (schema.title ?? id.replaceAll("-", " ")).replace(
      /(^|[^\p{L}\p{N}])(\p{L})/gu,
      (_, prefix, letter) => prefix + letter.toUpperCase(),
    ),
  )
  const property = $derived(entry.parameter.binding.property)
  const text = $derived(current(entry, draft))
  const error = $derived(draft !== undefined ? feedback(entry, text) : undefined)
  const override = $derived(draft !== undefined || Object.hasOwn(entry.parameter, "value"))
  const unit = $derived(property === "stroke-width" ? "mm" : property.endsWith("opacity") ? "ratio" : "")
  const color = $derived(property.endsWith("color") && !schema.enum)
  const width = $derived(property === "stroke-width" && !schema.enum)
  const swatch = $derived(color && /^#[0-9a-fA-F]{6}$/.test(text))
  const opacity = $derived(
    property.endsWith("opacity") &&
      !schema.enum &&
      text !== "" &&
      !error &&
      schema.exclusiveMinimum === undefined &&
      schema.exclusiveMaximum === undefined,
  )
  const decrease = $derived(color || width ? step(entry, text, -1) : undefined)
  const increase = $derived(color || width ? step(entry, text, 1) : undefined)
  const describedBy = $derived(
    [
      schema.description ? `${key}-description` : "",
      `${key}-choice`,
      `${key}-state`,
      `${key}-scope`,
      schema.type === "number" ? `${key}-constraints` : "",
      `${key}-error`,
    ]
      .filter(Boolean)
      .join(" "),
  )
</script>

<svelte:window
  onkeydown={(event) => {
    if (event.key === "Escape") {
      pinned = false
      hovering = false
    }
  }}
/>
<svelte:document
  onpointerdown={(event) => {
    if (!details?.contains(event.target as Node)) pinned = false
  }}
/>

{#snippet information()}
  <details
    class="details compact"
    bind:this={details}
    open={hovering || pinned}
    onpointerenter={(event) => {
      if (event.pointerType === "mouse") hovering = true
    }}
    onpointerleave={() => (hovering = false)}
  >
    <summary
      aria-label={`Details for ${title}`}
      title={`Details for ${title}`}
      onclick={(event) => {
        event.preventDefault()
        pinned = !pinned
        hovering = false
      }}><Icon name="info" /></summary
    >
    <div>
      <code class="parameter-id">{id}</code>
      <p id={`${key}-state`}>
        {#if entry.baseline.kind === "uniform"}Baseline: {entry.baseline.value}{unit ? ` ${unit}` : ""}
        {:else if entry.baseline.kind === "mixed"}Mixed baseline · no single original value.
        {:else}Unrepresentable baseline: {entry.baseline.reason}{/if}
      </p>
      <p id={`${key}-scope`} class="scope">Input pages: {scope}</p>
      {#if coverage !== undefined}<p>{coverage} eligible Output pages</p>{/if}
      {#if schema.type === "number"}<p id={`${key}-constraints`} class="constraints">
          {schema.minimum !== undefined ? `Minimum: ${schema.minimum}. ` : ""}
          {schema.exclusiveMinimum !== undefined ? `Greater than ${schema.exclusiveMinimum}. ` : ""}
          {schema.maximum !== undefined ? `Maximum: ${schema.maximum}. ` : ""}
          {schema.exclusiveMaximum !== undefined ? `Less than ${schema.exclusiveMaximum}. ` : ""}Fractional values are
          allowed.
        </p>{/if}
    </div>
  </details>
{/snippet}

<article class={["control", { compact }]} aria-labelledby={`${key}-title`}>
  <div class="control-label">
    <div>
      {#if property === "display"}<span id={`${key}-title`} aria-label={title}>{caption ?? title}</span>
      {:else}<label id={`${key}-title`} for={`${key}-input`} aria-label={`${title}${unit ? ` (${unit})` : ""}`}
          >{caption ?? title}{unit ? ` (${unit})` : ""}</label
        >{/if}
      {#if schema.description}<span id={`${key}-description`} class="control-description">
          {schema.description}
        </span>{/if}
    </div>
    {@render information()}
  </div>
  <p id={`${key}-choice`} class={["state", { override }]}>
    <strong>{override ? "Explicit override" : "Original state"}</strong>
    {#if property === "display" && text === ""}<span> · No single value</span>{/if}
  </p>
  <div class={["entry", { invalid: !!error }]}>
    {#if color}
      <div class="picker" title={`Choose ${title}`}>
        <span
          class={["swatch", { unassigned: !swatch }]}
          style:background={swatch ? text : undefined}
          aria-hidden="true"
        ></span>
        <input
          type="color"
          aria-label={`Choose ${title}`}
          aria-describedby={describedBy}
          value={swatch ? text : "#000000"}
          oninput={(event) => change(id, event.currentTarget.value)}
        />
      </div>
    {/if}
    {#if property === "display"}
      <div
        class="visibility"
        role="radiogroup"
        aria-labelledby={`${key}-title`}
        aria-describedby={describedBy}
        aria-invalid={!!error}
      >
        {#each ["inline", "none"] as value (value)}
          <label>
            <input
              id={value === "inline" ? `${key}-input` : `${key}-hide`}
              type="radio"
              name={`${key}-display`}
              {value}
              checked={text === value}
              onchange={() => change(id, value)}
            />
            <Icon name={value === "inline" ? "eye" : "eye-off"} />
            {value === "inline" ? "Show" : "Hide"}
          </label>
        {/each}
      </div>
    {:else if schema.enum}
      <select
        id={`${key}-input`}
        value={text}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        onchange={(event) => change(id, event.currentTarget.value)}
      >
        {#if text === ""}<option value="" disabled>Choose a value · {entry.baseline.kind} baseline</option>{/if}
        {#each schema.enum as option (option)}<option
            value={String(option)}
            disabled={!!feedback(entry, String(option))}>{option}</option
          >{/each}
      </select>
    {:else if schema.type === "number"}
      {#if opacity}
        <input
          class="slider"
          type="range"
          aria-label={`Adjust ${title}`}
          min={Math.max(0, schema.minimum ?? 0)}
          max={Math.min(1, schema.maximum ?? 1)}
          step="any"
          value={Number(text)}
          aria-describedby={describedBy}
          oninput={(event) => change(id, event.currentTarget.value)}
        />
      {/if}
      <input
        id={`${key}-input`}
        class={{ exact: opacity }}
        type="number"
        step="any"
        value={text}
        min={schema.minimum}
        max={schema.maximum}
        placeholder={entry.baseline.kind === "uniform" ? undefined : "No single value"}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        oninput={(event) => change(id, event.currentTarget.value)}
      />
    {:else}
      <input
        id={`${key}-input`}
        type="text"
        value={text}
        spellcheck={false}
        autocomplete="off"
        placeholder={entry.baseline.kind === "uniform" ? undefined : "No single value"}
        aria-describedby={describedBy}
        aria-invalid={!!error}
        oninput={(event) => change(id, event.currentTarget.value)}
      />
    {/if}
    {#if color || width}
      <button
        type="button"
        class="step"
        aria-label={color ? `Darken ${title}` : `Decrease ${title}`}
        disabled={decrease === undefined}
        onclick={() => change(id, decrease!)}>−</button
      >
      <button
        type="button"
        class="step"
        aria-label={color ? `Lighten ${title}` : `Increase ${title}`}
        disabled={increase === undefined}
        onclick={() => change(id, increase!)}>+</button
      >
    {/if}
    <button
      type="button"
      class="reset"
      aria-label={`Reset ${title}`}
      title={`Reset ${title}`}
      disabled={!override}
      onclick={() => reset(id)}><span aria-hidden="true">↺</span></button
    >
  </div>

  <p id={`${key}-error`} class={{ error: !!error }} role={error ? "alert" : undefined}>
    {error ?? ""}
  </p>
</article>
