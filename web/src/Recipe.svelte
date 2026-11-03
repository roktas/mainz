<!-- Assigns logical Input IDs and saves portable Recipe JSON independently of PDF handoff. -->

<script lang="ts">
  import { onDestroy, tick } from "svelte"
  import { recipe, identities, maxRecipeBytes } from "./recipe.ts"
  import type { Recipe } from "./recipe.ts"
  import { downloadInputs, downloadName } from "./model.ts"
  import type { Input, Source } from "./model.ts"
  import type { Output } from "./output.svelte.ts"
  import { dismiss } from "./dismiss.ts"
  import Icon from "./Icon.svelte"
  import { cover } from "./pdf.ts"
  import { Download } from "./download.ts"
  let { output, sources, info }: { output: Output; sources: readonly Source[]; info: (text: string) => void } = $props()
  const key = $props.id()
  let panel: HTMLDialogElement
  let captured = $state.raw<Recipe>()
  let inputs = $state.raw<Pick<Input, "id" | "name" | "title">[]>([])
  let ids = $state<Record<string, string>>({})
  let editing = $state<{ id: string; before: string }>()
  let filename = ""
  let failure = $state("")
  let preparing = $state(false)
  let revision = 0
  const download = new Download()
  const errors = $derived(identities(ids))
  export async function show() {
    const generation = ++revision
    failure = ""
    editing = undefined
    captured = undefined
    preparing = true
    panel.showModal()
    try {
      const contributors = downloadInputs(output.parts, sources)
      for (const input of contributors) {
        input.cover ??= await cover(input.pdf, input.coverPage).catch(() => undefined)
        if (generation !== revision || !panel.open) return
      }
      captured = recipe(output.parts, sources, output.metadata)
      inputs = contributors.map(({ id, name, title }) => ({ id, name, title }))
      ids = Object.fromEntries(inputs.map((input) => [input.id, ids[input.id] ?? input.name.replace(/\.pdf$/i, "")]))
      filename = (output.filename || downloadName(output.parts, sources)).replace(/\.pdf$/i, "") + ".json"
    } catch (reason) {
      if (generation === revision && panel.open) {
        captured = undefined
        failure = reason instanceof Error ? reason.message : "Could not prepare the recipe."
      }
    } finally {
      if (generation === revision) preparing = false
    }
  }
  function finish(restore = false, focus = false) {
    if (!editing) return
    const { id, before } = editing
    ids[id] = restore ? before : ids[id].trim().replace(/\.pdf$/i, "")
    editing = undefined
    if (focus)
      void tick().then(() =>
        panel.querySelector<HTMLButtonElement>(`[data-input="${CSS.escape(id)}"]`)?.focus({ preventScroll: true }),
      )
  }
  function save(event: SubmitEvent) {
    event.preventDefault()
    if (!captured || Object.keys(errors).length) return
    try {
      const record = {
        ...captured,
        inputs: Object.fromEntries(Object.entries(captured.inputs).map(([id, input]) => [ids[id].trim(), input])),
        sources: Object.fromEntries(
          Object.entries(captured.sources).map(([id, source]) => [id, { ...source, input: ids[source.input].trim() }]),
        ),
      }
      const bytes = new TextEncoder().encode(JSON.stringify(record, null, 2) + "\n")
      if (bytes.length > maxRecipeBytes) throw new Error("The recipe exceeds the 16 MiB limit. Reduce Output choices.")
      download.save(new Blob([bytes], { type: "application/json" }), filename)
      panel.close()
      info(`Exported recipe · ${filename}.`)
    } catch (reason) {
      failure = reason instanceof Error ? reason.message : "Could not export the recipe."
    }
  }
  onDestroy(() => {
    revision++
    download.dispose()
  })
</script>

<dialog bind:this={panel} class="recipe-panel" aria-labelledby={`${key}-title`} closedby="any" {@attach dismiss}>
  <form onsubmit={save}>
    <div class="dialog-heading">
      <h2 id={`${key}-title`}>Export recipe</h2>
      <button type="button" class="icon-button" aria-label="Close recipe" title="Close" onclick={() => panel.close()}
        ><Icon name="close" /></button
      >
    </div>
    {#if preparing}<p role="status">Preparing Input covers…</p>{/if}
    {#if captured}
      {#if Object.keys(captured.inputs).length}
        <!-- Keyboard focus makes horizontally scrolled columns reachable. -->
        <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
        <div class="recipe-table" role="region" aria-label="Recipe Input names and titles" tabindex="0">
          <table class="recipe-inputs" aria-label="Recipe Inputs">
            <colgroup><col /><col /><col /><col /></colgroup>
            <thead
              ><tr
                ><th scope="col">Name</th><th scope="col">Index</th><th scope="col">Path</th><th scope="col">Title</th
                ></tr
              ></thead
            >
            <tbody>
              {#each inputs as input, index (input.id)}
                {@const path = `${ids[input.id].trim().replace(/\.pdf$/i, "")}.pdf`}
                <tr>
                  <td>
                    {#if editing?.id === input.id}
                      <input
                        aria-label={`Name ${index + 1}`}
                        type="text"
                        bind:value={ids[input.id]}
                        spellcheck={false}
                        autocomplete="off"
                        aria-invalid={!!errors[input.id]}
                        aria-describedby={errors[input.id] ? `${key}-error-${index}` : undefined}
                        {@attach (element) => element.focus({ preventScroll: true })}
                        onblur={() => finish()}
                        onkeydown={(event) => {
                          if (event.key !== "Enter" && event.key !== "Escape") return
                          event.preventDefault()
                          event.stopPropagation()
                          finish(event.key === "Escape", true)
                        }}
                      />
                    {:else}
                      <button
                        type="button"
                        class="recipe-name"
                        data-input={input.id}
                        aria-label={`Edit Name ${index + 1}`}
                        title={`Edit Name · ${input.name}`}
                        onclick={() => (editing = { id: input.id, before: ids[input.id] })}
                        >{ids[input.id] || "Set name"}</button
                      >
                    {/if}
                    {#if errors[input.id]}<p id={`${key}-error-${index}`} class="error" role="alert">
                        {errors[input.id]}
                      </p>{/if}
                  </td>
                  <td class="recipe-index">{index + 1}</td>
                  <td class="recipe-path" title={path}>{path}</td>
                  <td class="recipe-title" title={input.title || input.name}>{input.title || input.name}</td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {:else}<p class="control-description">This recipe uses only blank pages and needs no Inputs.</p>{/if}
    {/if}
    {#if failure}<p class="error" role="alert">{failure}</p>{/if}
    <div class="recipe-actions">
      <button type="button" onclick={() => panel.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={!captured || Object.keys(errors).length > 0}>Export</button>
    </div>
  </form>
</dialog>
