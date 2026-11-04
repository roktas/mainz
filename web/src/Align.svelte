<!-- Saves an explicitly accepted reference Recipe without reconstructing its processing intent. -->

<script module lang="ts">
  import type { Input } from "./model.ts"
  import type { Recipe } from "./recipe.ts"
  export type Alignment = { recipe: Recipe; name: string; inputs: readonly { id: string; input: Input }[] }
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte"
  import { maxRecipeBytes } from "./recipe.ts"
  import { cover } from "./pdf.ts"
  import { Download } from "./download.ts"
  let { value = $bindable<Alignment | undefined>() }: { value?: Alignment } = $props()
  let busy = $state(false)
  let failure = $state("")
  const download = new Download()
  async function save() {
    if (!value || busy) return
    const captured = value
    busy = true
    failure = ""
    try {
      const record = structuredClone(captured.recipe)
      for (const { id, input } of captured.inputs) {
        input.cover ??= await cover(input.pdf, input.coverPage).catch(() => undefined)
        if (value !== captured) return
        Object.assign(record.inputs[id], {
          ...(input.title ? { title: input.title } : {}),
          ...(input.xmp && Object.keys(input.xmp).length ? { xmp: input.xmp } : {}),
          ...(input.cover ? { cover: input.cover } : {}),
        })
      }
      const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2) + "\n")
      if (bytes.length > maxRecipeBytes) throw new Error("The updated Recipe exceeds the 16 MiB limit.")
      download.save(
        new Blob([bytes], { type: "application/json" }),
        captured.name.replace(/\.json$/i, "") + "-aligned.json",
      )
      value = undefined
      await tick()
      document
        .querySelector<HTMLElement>('.composer [role="tab"][aria-selected="true"]')
        ?.focus({ preventScroll: true })
    } catch (reason) {
      failure = reason instanceof Error ? reason.message : "Could not save the updated Recipe. Try again."
    } finally {
      busy = false
    }
  }
  onDestroy(() => {
    value = undefined
    download.dispose()
  })
</script>

{#if value}<section class="recipe-alignment" aria-label="Updated Recipe">
    <p role="status">Updated Input references are ready. Save a separate Recipe to use them next time.</p>
    <button disabled={busy} onclick={() => void save()}>{busy ? "Preparing recipe…" : "Save updated recipe"}</button>
    {#if failure}<p class="error" role="alert">{failure}</p>{/if}
  </section>{/if}
