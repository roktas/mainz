<!-- Saves updated Recipe references as a copy or to an explicitly chosen local file. -->

<script module lang="ts">
  import type { Input } from "./model.ts"
  import type { Recipe } from "./recipe.ts"
  export type Alignment = { recipe: Recipe; name: string; inputs: readonly { id: string; input: Input }[] }
</script>

<script lang="ts">
  import { onDestroy } from "svelte"
  import { maxRecipeBytes } from "./recipe.ts"
  import { cover } from "./pdf.ts"
  import { Download } from "./download.ts"
  import { stampedName } from "./model.ts"
  import Feedback from "./Feedback.svelte"
  let {
    value = $bindable<Alignment | undefined>(),
    notify,
  }: {
    value?: Alignment
    notify: (text: string) => void
  } = $props()
  const key = $props.id()
  let draft = $state("")
  let busy = $state(false)
  let committing = $state(false)
  let failure = $state("")
  let revision = 0
  const download = new Download()
  const chooseFile = (
    window as Window & {
      showSaveFilePicker?: (options: {
        suggestedName: string
        types: { description: string; accept: Record<string, string[]> }[]
      }) => Promise<FileSystemFileHandle>
    }
  ).showSaveFilePicker?.bind(window)
  const error = $derived(
    !draft.trim()
      ? "Enter a filename."
      : // oxlint-disable-next-line no-control-regex -- Filenames cannot contain control characters.
        /[/\\\u0000-\u001f\u007f-\u009f]/.test(draft)
        ? "Use a filename without slashes or control characters."
        : "",
  )
  $effect(() => {
    draft = value ? `${stampedName(value.name.replace(/\.json$/i, ""), "recipe")}.json` : ""
    failure = ""
  })
  function cancel() {
    if (committing) return
    revision++
    busy = false
  }
  async function save(event: Event, overwrite = false) {
    event.preventDefault()
    if (!value || busy || (!overwrite && error) || (overwrite && !chooseFile)) return
    const captured = value
    const generation = ++revision
    const name = /\.json$/i.test(draft.trim()) ? draft.trim() : `${draft.trim()}.json`
    const control = event.currentTarget as HTMLElement
    control.closest<HTMLElement>("[popover]")?.hidePopover()
    busy = true
    failure = ""
    let destination: FileSystemFileHandle | undefined
    let stream: FileSystemWritableFileStream | undefined
    try {
      if (overwrite) {
        destination = await chooseFile!({
          suggestedName: captured.name,
          types: [{ description: "Recipe JSON", accept: { "application/json": [".json"] } }],
        })
        if (value !== captured || generation !== revision) return
      }
      const record = structuredClone(captured.recipe)
      for (const { id, input } of captured.inputs) {
        input.cover ??= await cover(input.pdf, input.coverPage).catch(() => undefined)
        if (value !== captured || generation !== revision) return
        Object.assign(record.inputs[id], {
          ...(input.title ? { title: input.title } : {}),
          ...(input.xmp && Object.keys(input.xmp).length ? { xmp: input.xmp } : {}),
          ...(input.cover ? { cover: input.cover } : {}),
        })
      }
      const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2) + "\n")
      if (bytes.length > maxRecipeBytes) throw new Error("The updated Recipe exceeds the 16 MiB limit.")
      const blob = new Blob([bytes], { type: "application/json" })
      if (destination) {
        stream = await destination.createWritable()
        if (value !== captured || generation !== revision) throw new DOMException("Export cancelled.", "AbortError")
        await stream.write(blob)
        if (value !== captured || generation !== revision) throw new DOMException("Export cancelled.", "AbortError")
        // Closing commits the replacement; cancellation must finish before this step.
        committing = true
        await stream.close()
        stream = undefined
        if (value !== captured || generation !== revision) return
      } else download.save(blob, name)
      value = undefined
      notify(overwrite ? "Recipe overwritten." : "Updated recipe exported.")
    } catch (reason) {
      await stream?.abort().catch(() => undefined)
      if (overwrite && !destination && reason instanceof DOMException && reason.name === "AbortError") return
      if (generation === revision)
        failure = reason instanceof Error ? reason.message : "Could not save the updated Recipe. Try again."
    } finally {
      if (generation === revision) {
        busy = false
        committing = false
      }
    }
  }
  onDestroy(() => {
    revision++
    value = undefined
    download.dispose()
  })
</script>

<Feedback
  header
  active={!!value}
  kind={busy ? "progress" : failure || error ? "error" : "notice"}
  text={busy
    ? "Preparing recipe…"
    : failure
      ? "Recipe export failed."
      : error
        ? "Check the filename."
        : "References updated."}
  details={failure || error || "References now match the selected PDFs. Save a recipe copy to reuse them."}
>
  {#snippet actions()}
    {#if busy}<button type="button" disabled={committing} onclick={cancel}>Cancel</button>
    {:else}
      <form id={`${key}-form`} onsubmit={save} novalidate>
        <div class={["entry", { invalid: !!error }]}>
          <input
            id={`${key}-name`}
            type="text"
            aria-label="Filename"
            title={draft}
            bind:value={draft}
            required
            spellcheck={false}
            autocomplete="off"
            aria-invalid={!!error}
            aria-describedby={`${key}-error`}
          />
        </div>
        <button type="submit" class="primary" disabled={!!error}>Save</button>
        <button type="button" aria-label="Dismiss Recipe update" title="Dismiss" onclick={() => (value = undefined)}
          >Dismiss</button
        >
        <button
          type="button"
          class="secondary"
          disabled={!chooseFile}
          title={chooseFile ? "Choose the recipe file to overwrite" : "Overwrite unavailable. Use Save."}
          onclick={(event) => void save(event, true)}>Overwrite</button
        >
        <span id={`${key}-error`} hidden>{error || failure}</span>
      </form>
    {/if}
  {/snippet}
</Feedback>
