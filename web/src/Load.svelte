<!-- Matches local PDFs to saved Recipe Inputs before installing an editable workspace. -->

<script module lang="ts">
  import type { Input } from "./model.ts"
  import { Opening } from "./pdf.ts"
  import type { InputCheck } from "./recipe.ts"
  export type Binding = { id: string; input: Input; opening: Opening; check: InputCheck; accepted: boolean }
</script>

<script lang="ts">
  import { onDestroy, tick } from "svelte"
  import { maxRecipeBytes } from "./recipe.ts"
  import type { Recipe } from "./recipe.ts"
  import { maxInputBytes } from "./model.ts"
  import { Download } from "./download.ts"
  import { fetchExample } from "./examples.ts"
  import { Processor } from "./processor.ts"
  import Guidance from "./Guidance.svelte"
  import Icon from "./Icon.svelte"
  import Logo, { parallax } from "./Logo.svelte"
  import Check from "./Check.svelte"
  import Feedback from "./Feedback.svelte"
  import type { Alignment } from "./Align.svelte"
  let {
    active = $bindable(false),
    status = $bindable(""),
    alignment = $bindable<Alignment | undefined>(),
    replay,
    open,
    cancel,
  }: {
    active?: boolean
    status?: string
    alignment?: Alignment
    replay: number
    open: (text: string, bindings: Binding[], force: boolean) => Promise<Recipe>
    cancel: () => void
  } = $props()
  const key = $props.id()
  let panel = $state<HTMLElement>(null!)
  let name = $state("")
  let text = ""
  let inputs = $state.raw<Recipe["inputs"]>()
  let selected = $state.raw(new Map<string, Binding>())
  let failures = $state.raw(new Map<string, { name: string; message: string }>())
  let reading: Opening | undefined
  let busy = $state(false)
  let opening = $state(false)
  let failure = $state("")
  let processor: Processor | undefined
  let example = $state.raw<{ recipe: string; inputs: Record<string, string> }>()
  let revision = 0
  const download = new Download()
  let request: AbortController | undefined
  const count = $derived(Object.keys(inputs ?? {}).length)
  const chosen = $derived(new Set([...selected.keys(), ...failures.keys()]).size)
  const review = $derived(
    [...selected.values()].filter((binding) => binding.check.state === "review" && !binding.accepted).length,
  )
  const blocked = $derived(
    new Set([
      ...failures.keys(),
      ...[...selected.values()].filter((binding) => binding.check.state === "error").map((binding) => binding.id),
    ]).size,
  )
  $effect(() => {
    status = !active
      ? ""
      : busy
        ? opening
          ? "Opening recipe…"
          : inputs
            ? "Reading PDF…"
            : "Reading recipe…"
        : inputs
          ? count
            ? `${chosen} of ${count} Inputs selected${blocked ? ` · ${blocked} blocked` : review ? ` · ${review} need review` : chosen === count ? " · Ready to apply recipe" : ` · ${count - chosen} remaining`}`
            : "No PDFs needed."
          : ""
  })
  function stop() {
    revision++
    processor?.dispose()
    processor = undefined
    reading?.dispose()
    reading = undefined
    for (const binding of selected.values()) binding.opening.dispose()
    selected = new Map()
    failures = new Map()
    alignment = undefined
    inputs = undefined
    text = ""
    example = undefined
    name = ""
    failure = ""
    if (opening) cancel()
    opening = false
    busy = false
    download.dispose()
    request?.abort()
    request = undefined
  }
  export async function show(
    file: File,
    preset?: { recipe: string; inputs: Record<string, string>; automatic?: boolean },
  ) {
    stop()
    const generation = ++revision
    name = file.name
    example = preset
    busy = true
    active = true
    await tick()
    if (generation !== revision) return
    if (document.documentElement.dataset.keyboard === "true")
      panel.querySelector<HTMLButtonElement>(".load-back")?.focus({ preventScroll: true })
    else panel.focus({ preventScroll: true })
    const worker = new Processor()
    processor = worker
    try {
      if (file.size > maxRecipeBytes) throw new Error("Choose a Recipe smaller than 16 MiB.")
      const record = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer())
      if (generation !== revision) return
      text = record
      const definitions = await worker.inspect(text, generation)
      if (generation === revision) inputs = definitions
    } catch (reason) {
      if (generation === revision) failure = diagnostic(reason)
    } finally {
      worker.dispose()
      if (generation === revision) {
        busy = false
        processor = undefined
      }
    }
    if (preset?.automatic && generation === revision && inputs) await samples()
  }
  function diagnostic(reason: unknown) {
    const record = (reason as { failure?: { record?: { message: string; location?: string } } })?.failure?.record
    return record
      ? `${record.message}${record.location ? ` (${record.location})` : ""}`
      : reason instanceof Error
        ? reason.message
        : "Could not open this Recipe. Choose its source PDFs and try again."
  }
  async function choose(id: string, file?: File) {
    if (!file || busy) return
    const generation = revision
    busy = true
    failure = ""
    const job = new Opening()
    reading = job
    try {
      const retained = [...selected.values()].reduce(
        (total, binding) => total + (binding.id === id ? 0 : binding.input.bytes.length),
        0,
      )
      if (retained + file.size > maxInputBytes)
        throw new Error("Recipe Inputs exceed the 128 MiB total limit. Choose smaller PDFs.")
      const input = await job.read(file, file.name, generation)
      if (generation !== revision) {
        job.dispose()
        return
      }
      const check = await job.check(text, id, generation)
      if (generation === revision) {
        failures = new Map(failures)
        failures.delete(id)
        selected.get(id)?.opening.dispose()
        selected = new Map(selected).set(id, { id, input, opening: job, check, accepted: false })
      } else job.dispose()
    } catch (reason) {
      job.dispose()
      if (generation === revision)
        failures = new Map(failures).set(id, { name: file.name, message: diagnostic(reason) })
    } finally {
      if (generation === revision) {
        busy = false
        reading = undefined
      }
    }
  }
  async function files(list: FileList) {
    if (busy) return
    const generation = revision
    const ids = Object.keys(inputs ?? {})
    const batch = Array.from(list)
      .map((file) => ({
        file,
        id: ids.find((id) => id.replace(/\.pdf$/i, "") === file.name.replace(/\.pdf$/i, "")),
      }))
      .toSorted((a, b) => Number(!!b.id) - Number(!!a.id))
    for (const { file, id } of batch) {
      if (generation !== revision) return
      const target = id ?? ids.find((candidate) => !selected.has(candidate))
      if (target) await choose(target, file)
    }
  }
  async function samples() {
    if (busy) return
    const generation = revision
    const controller = new AbortController()
    request = controller
    busy = true
    failure = ""
    try {
      for (const [id, url] of Object.entries(example?.inputs ?? {})) {
        const response = await fetchExample(url, controller.signal)
        const bytes = await response.arrayBuffer()
        if (generation !== revision) return
        busy = false
        await choose(id, new File([bytes], `${id}.pdf`, { type: "application/pdf" }))
        if (generation !== revision || failure) return
        busy = true
      }
    } catch (reason) {
      if (generation === revision) failure = diagnostic(reason)
    } finally {
      if (generation === revision) {
        busy = false
        request = undefined
      }
    }
  }
  async function start() {
    if (!inputs || busy || chosen !== count || blocked || review) return
    const generation = revision
    busy = true
    opening = true
    failure = ""
    try {
      const bindings = [...selected.values()]
      const filename = name
      const aligned = await open(
        text,
        bindings,
        bindings.some((binding) => binding.check.state === "review"),
      )
      if (generation !== revision) return
      const changed = bindings.some((binding) => binding.check.state !== "ready")
      opening = false
      busy = false
      stop()
      if (changed) alignment = { recipe: aligned, name: filename, inputs: bindings }
      active = false
      await tick()
      document
        .querySelector<HTMLElement>('.composer [role="tab"][aria-selected="true"]')
        ?.focus({ preventScroll: true })
    } catch (reason) {
      if (generation === revision) failure = diagnostic(reason)
    } finally {
      if (generation === revision) {
        busy = false
        opening = false
      }
    }
  }
  async function close() {
    stop()
    active = false
    await tick()
    document.querySelector<HTMLInputElement>(".landing-recipe input")?.focus({ preventScroll: true })
  }
  onDestroy(stop)
</script>

{#if active}<section bind:this={panel} class="load-panel" aria-labelledby={`${key}-title`} tabindex="-1">
    <div class="load-heading">
      <div class="load-location">
        <button type="button" class="load-back" aria-label="Back" title="Back" onclick={() => void close()}
          ><Icon name="previous" /></button
        >
        <span class="load-name" title={name}
          ><Icon name="json" /><span>{name}</span>
          {#if example}<a
              class="load-download"
              href={example.recipe}
              download="practice-session.json"
              aria-label="Download recipe JSON"
              title="Download recipe JSON"><Icon name="down" /></a
            >{/if}
        </span>
      </div>
      <div class="load-intro">
        <h1 id={`${key}-title`}>Choose your source PDFs</h1>
        <p>
          <span class="expanded">Choose the PDFs for these saved Inputs. Your page order and styles are ready.</span
          ><span class="compact">Choose PDFs to apply this recipe.</span>
        </p>
      </div>
      {#if inputs && count}<div class="load-choices">
          {#if example}<button type="button" disabled={busy} onclick={() => void samples()}>Sample PDFs</button>{/if}
          <label class="file-picker"
            >Choose PDFs<input
              type="file"
              accept="application/pdf,.pdf"
              multiple
              title="Choose PDFs"
              disabled={busy}
              onchange={(event) => {
                if (event.currentTarget.files) void files(event.currentTarget.files)
                event.currentTarget.value = ""
              }}
            /></label
          >
        </div>{/if}
      {#key replay}<div class="hero-mark load-mark" {@attach parallax}><Logo /></div>{/key}
    </div>
    {#if inputs}
      {#if count}
        <div class="binding-labels">
          <span>Saved Input</span><span>PDF on this device</span>
        </div>
        <div class="recipe-bindings">
          {#each Object.entries(inputs) as [id, input] (id)}
            {@const bound = selected.get(id)}
            {@const rejected = failures.get(id)}
            {@const title = input.title?.trim() || id}
            {@const state = rejected ? "error" : bound?.check.state}
            {@const matched = !!bound || !!rejected}
            <div class="binding-row" data-state={state}>
              <div class="binding-source">
                <div class="binding-cover">
                  {#if input.cover}<img src={input.cover} alt={`Saved cover · ${title}`} />{:else}<Icon
                      name="page"
                    />{/if}
                </div>
                <div class="binding-identity">
                  <div class="binding-heading">
                    <h2>
                      {#if input.xmp?.["dc:description"]?.trim()}<span class="expanded">{title}</span><span
                          class="compact"><Guidance {title} details={input.xmp["dc:description"]} label={title} /></span
                        >{:else}{title}{/if}
                    </h2>
                    <div class="binding-meta">
                      <code title={id}>{id}</code>
                      {#if input.xmp && Object.keys(input.xmp).length}
                        <Guidance {title} fields={input.xmp} />{/if}
                    </div>
                  </div>
                  <p class="binding-description">{input.xmp?.["dc:description"] || ""}</p>
                </div>
              </div>
              <div
                class="binding-target"
                class:bound={matched}
                role="group"
                aria-label={`PDF for ${title}`}
                ondragover={(event) => {
                  event.preventDefault()
                }}
                ondrop={(event) => {
                  event.preventDefault()
                  if (event.dataTransfer?.files[0]) void choose(id, event.dataTransfer.files[0])
                }}
              >
                {#if bound || rejected}<Check
                    {title}
                    filename={bound?.input.name ?? rejected?.name}
                    check={bound?.check}
                    failure={rejected?.message}
                    accepted={bound?.accepted ?? false}
                    disabled={busy}
                    accept={(accepted) => {
                      if (bound) selected = new Map(selected).set(id, { ...bound, accepted })
                    }}
                  />{/if}
                <div class="binding-pick">
                  <label class={matched ? "file-picker" : "file-picker primary binding-empty"}
                    ><Icon name={matched ? "input" : "add"} /><span>{matched ? "Change PDF" : "Choose a PDF"}</span>
                    <input
                      type="file"
                      accept="application/pdf,.pdf"
                      disabled={busy}
                      aria-label={`Choose PDF for ${title}`}
                      title={matched ? "Change PDF" : "Choose a PDF"}
                      onchange={(event) => {
                        void choose(id, event.currentTarget.files?.[0])
                        event.currentTarget.value = ""
                      }}
                    /></label
                  >
                  {#if !matched}<span class="control-description">or drop it here</span>{/if}
                  {#if bound}<button
                      type="button"
                      class="load-download"
                      onclick={() =>
                        download.save(
                          new Blob([bound.input.bytes.slice()], { type: "application/pdf" }),
                          bound.input.name,
                        )}
                      aria-label={`Download ${bound.input.name}`}
                      title="Download PDF"><Icon name="down" /></button
                    >{/if}
                </div>
              </div>
            </div>
          {/each}
        </div>
      {:else}<p class="control-description">This Recipe uses only blank pages and needs no PDFs.</p>{/if}
    {/if}
    <Feedback header {active} kind="error" text={failure} summary="Could not load recipe." />
    <div class="load-actions">
      <button type="button" onclick={() => void close()}>Cancel</button><button
        type="button"
        class="primary"
        disabled={!inputs || busy || chosen !== count || !!blocked || !!review}
        onclick={() => void start()}>Apply recipe</button
      >
    </div>
  </section>{/if}
