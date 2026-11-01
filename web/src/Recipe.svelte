<!-- Assigns logical Input IDs and saves portable Recipe JSON independently of PDF handoff. -->

<script lang="ts">
  import { onDestroy, tick } from "svelte"
  import { recipe, identities } from "./recipe.ts"
  import type { Recipe } from "./recipe.ts"
  import { downloadInputs, downloadName } from "./model.ts"
  import type { Source } from "./model.ts"
  import type { Output } from "./output.svelte.ts"
  import { dismiss } from "./dismiss.ts"
  import Icon from "./Icon.svelte"
  let { output, sources, info }: { output: Output; sources: readonly Source[]; info: (text: string) => void } = $props()
  const key = $props.id()
  let panel: HTMLDialogElement
  let captured = $state.raw<Recipe>()
  let inputs = $state.raw<{ id: string; name: string }[]>([])
  let ids = $state<Record<string, string>>({})
  let editing = $state<{ id: string; before: string }>()
  let filename = ""
  let failure = $state("")
  let url: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  const errors = $derived(identities(ids))
  function release() {
    clearTimeout(timer)
    if (url) URL.revokeObjectURL(url)
    url = undefined
  }
  export function show() {
    failure = ""
    editing = undefined
    try {
      captured = recipe(output.parts, sources)
      inputs = downloadInputs(output.parts, sources).map(({ id, name }) => ({ id, name }))
      ids = Object.fromEntries(inputs.map((input) => [input.id, ids[input.id] ?? input.name.replace(/\.pdf$/i, "")]))
      filename = (output.filename || downloadName(output.parts, sources)).replace(/\.pdf$/i, "") + ".json"
    } catch (reason) {
      captured = undefined
      failure = reason instanceof Error ? reason.message : "Could not prepare the recipe."
    }
    panel.showModal()
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
      if (bytes.length > 1024 * 1024) throw new Error("The recipe exceeds the 1 MiB limit. Reduce Output choices.")
      release()
      url = URL.createObjectURL(new Blob([bytes], { type: "application/json" }))
      const link = document.createElement("a")
      link.href = url
      link.download = filename
      link.click()
      timer = setTimeout(release, 30000)
      panel.close()
      info(`Exported recipe · ${filename}.`)
    } catch (reason) {
      failure = reason instanceof Error ? reason.message : "Could not export the recipe."
    }
  }
  onDestroy(release)
</script>

<dialog bind:this={panel} class="recipe-panel" aria-labelledby={`${key}-title`} closedby="any" {@attach dismiss}>
  <form onsubmit={save}>
    <div class="dialog-heading">
      <h2 id={`${key}-title`}>Export recipe</h2>
      <button type="button" class="icon-button" aria-label="Close recipe" title="Close" onclick={() => panel.close()}
        ><Icon name="close" /></button
      >
    </div>
    {#if captured}
      {#if Object.keys(captured.inputs).length}
        <table class="recipe-inputs" aria-label="Recipe Inputs">
          <colgroup><col /><col /><col /></colgroup>
          <thead><tr><th scope="col">Index</th><th scope="col">Path</th><th scope="col">ID</th></tr></thead>
          <tbody>
            {#each inputs as input, index (input.id)}
              {@const path = `${ids[input.id].trim().replace(/\.pdf$/i, "")}.pdf`}
              <tr>
                <td class="recipe-index">{index + 1}</td>
                <td class="recipe-path" title={path}>{path}</td>
                <td>
                  {#if editing?.id === input.id}
                    <input
                      aria-label={`ID ${index + 1}`}
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
                      class="recipe-id"
                      data-input={input.id}
                      aria-label={`Edit ID ${index + 1}`}
                      title={`Edit ID · ${input.name}`}
                      onclick={() => (editing = { id: input.id, before: ids[input.id] })}
                      >{ids[input.id] || "Set ID"}</button
                    >
                  {/if}
                  {#if errors[input.id]}<p id={`${key}-error-${index}`} class="error" role="alert">
                      {errors[input.id]}
                    </p>{/if}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      {:else}<p class="control-description">This recipe uses only blank pages and needs no Inputs.</p>{/if}
    {/if}
    {#if failure}<p class="error" role="alert">{failure}</p>{/if}
    <div class="recipe-actions">
      <button type="button" onclick={() => panel.close()}>Cancel</button>
      <button type="submit" class="primary" disabled={!captured || Object.keys(errors).length > 0}>Export</button>
    </div>
  </form>
</dialog>
