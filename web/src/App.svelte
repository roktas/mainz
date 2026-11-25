<!-- Coordinates Input opening, workspace choices, and preview owners. -->

<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte"
  import { SvelteSet } from "svelte/reactivity"
  import { animateRemoval } from "./edits.ts"
  import { downloadInputs, downloadName, plan, sizeOf } from "./model.ts"
  import type { Source } from "./model.ts"
  import type { Inspection } from "./Page.svelte"
  import type { Magnification } from "./Lens.svelte"
  import {
    applicable,
    applyEdits,
    applyProfile,
    counterparts,
    current,
    draftError,
    editStyle,
    feedback,
    matchingProfile,
    propagate,
    resolve,
    resetStyles,
    peerProfiles,
    usage,
    visibleProfiles,
  } from "./styles.ts"
  import { cover } from "./pdf.ts"
  import { Inputs } from "./inputs.svelte.ts"
  import { schedulePreviews } from "./preview.svelte.ts"
  import Export from "./Export.svelte"
  import Print from "./Print.svelte"
  import Filename from "./Filename.svelte"
  import Recipe from "./Recipe.svelte"
  import Load from "./Load.svelte"
  import type { Alignment } from "./Align.svelte"
  import type { Snapshot } from "./Export.svelte"
  import Landing from "./Landing.svelte"
  import Examples from "./Examples.svelte"
  import Feedback, { provideFeedback } from "./Feedback.svelte"
  import type Header from "./Header.svelte"
  import Align from "./Align.svelte"
  import Offline from "./Offline.svelte"
  import Style from "./Style.svelte"
  import Sources from "./Sources.svelte"
  import type Composer from "./Composer.svelte"
  import type { TourStep } from "./Tour.svelte"
  import type { Sequence } from "./pages.ts"
  import { openExample, initialViews } from "./examples.ts"
  import FilePicker from "./FilePicker.svelte"
  import InputPicker from "./InputPicker.svelte"
  import Masthead from "./Masthead.svelte"

  let { home }: { home: () => Promise<void> } = $props()
  const query = new URLSearchParams(location.search)
  const initial = initialViews(query)
  const probe = import.meta.env.DEV && query.has("geometry")
  const demo = query.get("demo") ?? (probe ? "grid" : null)
  const inputPDFURLs = new Map<string, string>()
  let perFileProfiles = $state(false)
  const styleFolds = new SvelteSet<string>()
  let logoReplay = $state(0)
  let magnification = $state<Magnification>(16)
  let message = $state("")
  let notice = $state("")
  let messageRevision = $state(0)
  const firstAction = "Select pages · Use + to add to Output."
  let failure = $state.raw<string | string[]>("")
  let header = $state<ReturnType<typeof Header>>()
  let headerActive = $state(false)
  provideFeedback((item) => header?.report(item) ?? (() => {}))
  let updating = $state(false)
  let offlineStatus = $state("")
  let exportStatus = $state("")
  let tour = $state<TourStep>()
  let exporter = $state<ReturnType<typeof Export>>(null!)
  let printer: ReturnType<typeof Print>
  let filenameEditor: ReturnType<typeof Filename>
  let recorder: ReturnType<typeof Recipe>
  let loader: ReturnType<typeof Load>
  let matching = $state(false)
  let recipeStatus = $state("")
  let demoLoading = $state(false)
  let alignment = $state.raw<Alignment>()
  let composer = $state<ReturnType<typeof Composer>>(null!)
  let composerModule: Promise<typeof import("./Composer.svelte")> | undefined
  let examples: ReturnType<typeof Examples>
  let inputMenu = $state<HTMLDetailsElement>()
  let exampleApproved = false
  function preloadComposer() {
    return (composerModule ??= import("./Composer.svelte").catch((reason) => {
      composerModule = undefined
      throw reason
    }))
  }
  const inputs = new Inputs({
    updating: () => updating,
    clear() {
      demoLoading = false
      failure = ""
      notify("")
    },
    info,
    complete(text, revision, source) {
      if (revision === messageRevision) info(text, source)
    },
    error,
  })
  const output = inputs.output
  const parts = $derived(output.parts)
  const sources = $derived(inputs.sources)
  const activeId = $derived(inputs.activeId)
  const active = $derived(inputs.active)
  const loading = $derived(inputs.loading)
  const footerStatus = $derived(matching ? recipeStatus : message)
  const unsaved = $derived(output.modified || sources.some((source) => source.modified))
  const landing = $derived(!active && !parts.length && !matching)
  const sourceId = $derived(active?.id)
  const description = $derived(active?.input.description)
  const counts = $derived(usage(parts))
  const outputSources = $derived(sources.filter((source) => counts.has(source.id)))
  const controls = $derived(description && sourceId ? applicable(description, counts.get(sourceId)?.keys() ?? []) : [])
  const styleable = $derived(controls.length > 0)
  const profiles = $derived(visibleProfiles(description, controls))
  const hasProfiles = $derived(profiles.length > 0)
  const shareable = $derived.by(() => {
    if (!active || sources.length < 2) return false
    const ids = [...new Set([...controls, ...Object.keys(active.overrides)])]
    return sources.some((source) => {
      if (source.id === active.id) return false
      return (
        profiles.some((set) =>
          set.profiles.some((profile) => peerProfiles(set, profile.name, source.input.description).length),
        ) || counterparts(active, source, ids).pairs.length > 0
      )
    })
  })
  const outputProcessing = $derived(outputSources.some((source) => source.preview.status === "pending"))
  const processingSource = $derived(
    active?.preview.status === "pending" ? active : sources.find((source) => source.preview.status === "pending"),
  )
  const failedSources = $derived(sources.filter((source) => source.preview.status === "error"))
  const downloadError = $derived.by(() => {
    try {
      downloadInputs(parts, sources)
      return outputSources.map((source) => draftError(source, counts)).find(Boolean)
    } catch (reason) {
      return reason instanceof Error ? reason.message : "Invalid Download inputs."
    }
  })
  const inspection: Inspection | undefined = $derived.by(() => {
    const page = output.pages[output.position]
    if (!page) return
    const content = page.content
    const source = "source" in content ? sources.find((item) => item.id === content.source) : undefined
    const eligible = source && "page" in content ? applicable(source.input.description, [content.page]) : []
    const size = sizeOf(page.content, sources)
    if (!source || !("page" in content)) return { kind: "blank", size, padding: page.padding }
    return {
      kind: "pdf",
      ...source.preview.appearance(content.page),
      comparison: {
        pdf: source.input.pdf,
        page: content.page,
        enabled:
          source.preview.status === "ready" &&
          !eligible.some(
            (id) =>
              Object.hasOwn(source.drafts, id) && feedback(source.input.description.parameters[id], source.drafts[id]),
          ) &&
          eligible.some((id) => {
            const entry = source.input.description.parameters[id]
            return current(resolve(entry, source.overrides, id)).toLowerCase() !== current(entry).toLowerCase()
          }),
      },
      size,
    }
  })

  function info(text: string, source?: Pick<Source, "id" | "input">) {
    message = text.charAt(0).toUpperCase() + text.slice(1)
    if (text && source && source.id !== activeId) message += ` (${source.input.name})`
    return ++messageRevision
  }
  function notify(text: string, details?: string) {
    header?.notify(text, details)
  }
  function error(text: string | string[]) {
    failure = text
    info("")
    notify("")
  }
  function composition(text = "Output updated. Input selections and styles are retained.") {
    failure = ""
    for (const source of sources) source.preview.reconcile(source, counts)
    if (notice === firstAction) notify("")
    info(text)
  }
  function choose(id: string, sequence: Sequence) {
    inputs.choose(id, sequence)
  }
  async function openRecipe(file: File) {
    if (loading || updating) return
    inputs.cancel()
    demoLoading = false
    void preloadComposer()
    await loader.show(file)
  }
  async function landingFiles(list: FileList | File[]) {
    if (list.length !== 1) {
      error("Choose one PDF or Recipe to start.")
      return
    }
    const file = list[0]
    if (file.name.toLowerCase().endsWith(".json")) await openRecipe(file)
    else {
      void preloadComposer()
      await inputs.files(list)
    }
  }
  function cancelOpen() {
    inputs.cancel()
    demoLoading = false
    info("Opening cancelled. Your workspace is retained.")
  }
  function openFiles(list: FileList) {
    void preloadComposer()
    void inputs.files(list)
    if (inputMenu?.open) inputMenu.open = false
  }
  function viewInputPDF() {
    if (!active) return
    let url = inputPDFURLs.get(active.id)
    if (!url) {
      url = URL.createObjectURL(new Blob([active.input.bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }))
      inputPDFURLs.set(active.id, url)
    }
    const viewer = window.open(url, "_blank")
    if (viewer) viewer.opener = null
    else error("Allow pop-ups to view the Input PDF.")
  }
  function closeInputMenu() {
    if (!inputMenu) return
    inputMenu.open = false
    inputMenu.querySelector("summary")?.focus()
  }
  function removeSource(close: () => void) {
    if (!active) return
    const { id, input } = active
    if (parts.some((part) => part.pages.some(({ content }) => "source" in content && content.source === id))) {
      error("Remove this Input's pages from Output before removing it.")
      return
    }
    for (const sheet of document.querySelectorAll<HTMLElement>(
      ".selection-panel .page-image canvas, .selection-panel .page-scroll canvas",
    ))
      animateRemoval(sheet, () => {})
    const inputURL = inputPDFURLs.get(id)
    if (inputURL) URL.revokeObjectURL(inputURL)
    inputPDFURLs.delete(id)
    close()
    inputs.remove(active)
    if (!active)
      void tick().then(() => document.querySelector<HTMLInputElement>("#workspace input[type=file]")?.focus())
    info(`Removed Input · ${input.name}. Existing Blanks retain their dimensions.`)
  }
  function changeStyle(id: string, text: string) {
    if (!active) return
    const entry = active.input.description.parameters[id]
    const { state, error: invalid } = editStyle(entry, id, text, active)
    choices(
      { ...active, ...state },
      invalid ? undefined : `Updated ${entry.parameter.schema.title ?? id}.`,
      invalid ? [] : [id],
    )
    const title = entry.parameter.schema.title ?? id
    if (invalid) error(`Invalid value for ${title}. ${invalid}`)
    else {
      failure = ""
    }
  }
  function resetStyle(id?: string) {
    if (!active) return
    failure = ""
    choices(
      { ...active, ...resetStyles(active, id) },
      id
        ? `Restored ${active.input.description.parameters[id].parameter.schema.title ?? id} to the original style.`
        : "Restored all original styles.",
      id ? [id] : [...new Set([...Object.keys(active.overrides), ...Object.keys(active.drafts)])],
    )
  }
  function changeProfile(setId: string, profileId: string) {
    if (!active) return
    const set = active.input.description.profileSets?.find((item) => item.id === setId)
    const profile = set?.profiles.find((item) => item.id === profileId)
    if (!set || !profile) return
    failure = ""
    const affected: Source[] = []
    inputs.sources = sources.map((source) => {
      if (perFileProfiles && source.id !== active.id) return source
      let next = source
      const matches =
        source.id === active.id ? [{ set, profile }] : peerProfiles(set, profile.name, source.input.description)
      for (const { set: candidate, profile: choice } of matches) {
        const alreadyMatches = matchingProfile(candidate, next.overrides, next.drafts)?.id === choice.id
        if (alreadyMatches && next.profiles?.[candidate.id] === choice.id) continue
        next = { ...next, ...applyProfile(candidate, choice, next), modified: next.modified || !alreadyMatches }
      }
      if (next !== source) affected.push(next)
      return next
    })
    schedulePreviews(affected, counts, active.id)
    info(`Applied ${profile.name} profile${affected.length > 1 ? ` to ${affected.length} files` : ""}.`)
  }
  function choices(source: Source, text?: string, ids: string[] = []) {
    const original = active!
    let skipped = 0
    const affected: Source[] = []
    inputs.sources = sources.map((target) => {
      if (target.id === source.id) {
        const next = { ...source, modified: true }
        if (text) affected.push(next)
        return next
      }
      if (perFileProfiles || !ids.length) return target
      const result = propagate(original, source, target, ids)
      skipped += result.skipped
      if (!result.edits.length) return target
      const next = {
        ...target,
        ...applyEdits(target, result.overrides, result.edits),
        modified: target.modified || result.changed,
      }
      affected.push(next)
      return next
    })
    schedulePreviews(affected, counts, original.id)
    if (text)
      info(
        `${text}${skipped ? ` Kept ${skipped} incompatible or different parameter${skipped === 1 ? "" : "s"}.` : ""}`,
      )
  }
  function schedule(id: string) {
    const source = sources.find((item) => item.id === id)
    if (source) source.preview.schedule(source, counts)
  }
  function exportSnapshot(): Snapshot {
    if (downloadError) throw new Error(downloadError)
    const selection = output.parts,
      contributors = sources,
      request = plan(selection, contributors)
    request.metadata = output.metadata
    const capturedName = output.filename
    const capturedTitle = output.title
    const capturedCover = output.cover
    const pages = output.pages
    const first = pages[0]?.content
    const contributor =
      first && "source" in first ? contributors.find((source) => source.id === first.source) : undefined
    const prepared =
      contributor && pages.every(({ content }) => "source" in content && content.source === contributor.id)
        ? contributor.preview.download(
            contributor,
            pages.flatMap(({ content }) => ("page" in content ? [content.page] : [])),
            request.metadata,
          )
        : undefined
    return {
      plan: request,
      prepared,
      inputs: downloadInputs(selection, contributors),
      expected: output.pages.length,
      name: () => capturedName || downloadName(selection, contributors),
      complete: () => {
        output.acknowledge(selection, capturedTitle, capturedCover)
        inputs.sources = sources.map((source) => {
          const captured = contributors.find((item) => item.id === source.id)
          return request.sources[source.id] &&
            captured?.overrides === source.overrides &&
            captured.drafts === source.drafts &&
            !Object.keys(source.drafts).length
            ? { ...source, modified: false }
            : source
        })
      },
    }
  }
  async function coverPreview(page: number) {
    const content = output.pages[page - 1]?.content
    if (!content) throw new Error("Choose an Output page.")
    if ("blank" in content)
      return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC"
    const source = sources.find((item) => item.id === content.source)!
    const appearance = source.preview.appearance(content.page)
    return cover(appearance.pdf, appearance.page + 1)
  }
  function example(event: MouseEvent) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (unsaved && !confirm("Open an example? Input style changes and Output choices have not been downloaded.")) {
      event.preventDefault()
      return
    }
    exampleApproved = true
  }
  function dismiss(event: MouseEvent | KeyboardEvent) {
    if (inputMenu?.open) {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        closeInputMenu()
      } else if (event instanceof MouseEvent && !inputMenu.contains(event.target as Node)) inputMenu.open = false
    }
  }
  onMount(() => {
    const url = new URL(location.href)
    if (url.searchParams.has("reset")) {
      try {
        localStorage.removeItem("mainz:onboarding")
      } catch {
        /* Help shows the welcome when storage is unavailable. */
      }
      url.searchParams.delete("reset")
      history.replaceState(history.state, "", url)
    }
    if (demo === null) return
    if (demo === "") {
      examples.show()
      return
    }
    demoLoading = true
    void preloadComposer()
    void openExample(demo, {
      get revision() {
        return inputs.revision
      },
      get disposed() {
        return inputs.disposed
      },
      output,
      open: (bytes, name) => inputs.open(bytes, name),
      choose,
      recipe: (file, preset) => loader.show(file, preset),
      profile: changeProfile,
      compose: (request, bytes) => inputs.composeDemo(request, bytes),
      info,
      error,
    })
      .then((id) => {
        if (id && !inputs.disposed) inputs.activeId = id
      })
      .finally(() => (demoLoading = false))
  })
  onDestroy(() => {
    for (const url of inputPDFURLs.values()) URL.revokeObjectURL(url)
    inputs.dispose()
  })
</script>

{#snippet sourceStyling(toolbarOnly = false)}
  {#if active}{#key active.id}<Style
        source={active}
        {controls}
        counts={counts.get(active.id) ?? new Map()}
        {toolbarOnly}
        folded={styleFolds}
        {tour}
        style={changeStyle}
        profile={changeProfile}
        bind:perFile={perFileProfiles}
        shared={shareable}
        reset={resetStyle}
      />{/key}{/if}
{/snippet}

{#snippet openPDF(label = "Open PDF")}
  <FilePicker {label} disabled={loading || updating} onFiles={openFiles} />
{/snippet}

{#snippet inputTools(heading: string)}
  <InputPicker
    bind:menu={inputMenu}
    {heading}
    {active}
    {sources}
    {activeId}
    provisional={!!inputs.provisional}
    disabled={loading || updating}
    onSelect={(id) => (inputs.activeId = id)}
    onView={viewInputPDF}
    onRemove={removeSource}
    onClose={closeInputMenu}
    onFiles={openFiles}
  />
{/snippet}

{#snippet inputChoices(close: () => void, compact = false)}
  <Sources
    {sources}
    {activeId}
    {compact}
    {close}
    onSelect={(id) => (inputs.activeId = id)}
    onView={viewInputPDF}
    onRemove={removeSource}
  />
{/snippet}

<svelte:document
  onclick={dismiss}
  onkeydown={dismiss}
  onpointerdowncapture={(event) => {
    document.documentElement.dataset.keyboard = "false"
    document.documentElement.dataset.pointer = event.pointerType
  }}
  onkeydowncapture={() => (document.documentElement.dataset.keyboard = "true")}
/>
<svelte:window
  onbeforeunload={(event) => {
    const approved = exampleApproved
    exampleApproved = false
    if (unsaved && !approved) event.preventDefault()
  }}
/>
<Masthead
  bind:header
  bind:headerActive
  bind:notice
  bind:failure
  bind:magnification
  bind:logoReplay
  {loading}
  openingStatus={inputs.status}
  openingSummary={inputs.summary}
  {offlineStatus}
  {exportStatus}
  {processingSource}
  {failedSources}
  {downloadError}
  {demoLoading}
  {landing}
  {unsaved}
  hasInput={!!active && !!composer}
  hasOutput={!!output.pages.length}
  workspace={!!active || !!parts.length}
  {styleable}
  {hasProfiles}
  onboarding={(demo === null || demo === "empty") && !loading}
  views={() => composer?.views() ?? { input: "grid", output: "grid" }}
  {firstAction}
  {notify}
  {cancelOpen}
  cancelExport={() => exporter.cancel()}
  cancelStyle={() => processingSource?.preview.cancel()}
  retry={schedule}
  {home}
  showExamples={() => examples.show()}
  onTourChange={(step) => {
    tour = step
  }}
  onHint={(show) => {
    if (show) notify(firstAction, "Select pages in Input, then choose + or drag them into Output to build your PDF.")
    else if (notice === firstAction) notify("")
  }}
/>
<main id="workspace">
  {#if landing}
    <Landing {loading} {updating} replay={logoReplay} open={landingFiles} recipe={(file) => void openRecipe(file)} />
  {/if}
  <Load
    bind:this={loader}
    bind:active={matching}
    bind:status={recipeStatus}
    bind:alignment
    replay={logoReplay}
    open={(text, bindings, force) => inputs.replay(text, bindings, force)}
    cancel={cancelOpen}
  />
  {#if !active && parts.length && !matching}<div class="empty-input">{@render inputTools("")}</div>{/if}
  {#if active || parts.length}
    {#await preloadComposer()}
      <Feedback kind="progress" class="workspace-progress" text="Loading workspace…" visualOnly />
    {:then module}<module.default
        bind:this={composer}
        {initial}
        source={active}
        {styleable}
        opening={!!inputs.provisional}
        {sources}
        {output}
        sequence={active ? inputs.sequences[active.id] : undefined}
        {choose}
        change={composition}
        download={() => void exporter.start()}
        sharing={exporter?.sharing ?? false}
        print={() => void exporter.start("Print")}
        viewPDF={() => void exporter.start("View")}
        {viewInputPDF}
        recipe={() => recorder.show()}
        filename={output.filename}
        suggestFilename={() => downloadName(parts, sources)}
        setFilename={(name) => (output.filename = name)}
        rename={(source) => filenameEditor.show(source)}
        {error}
        styling={sourceStyling}
        input={inputTools}
        {inputChoices}
        {openPDF}
        {inspection}
        activate={(id) => (inputs.activeId = id)}
        {outputProcessing}
        {downloadError}
        {magnification}
        {tour}
      />
    {:catch}
      <p role="alert">The workspace could not load. <button onclick={() => location.reload()}>Reload</button></p>
    {/await}
  {/if}
</main>
<footer class="footnote">
  {#if active}<span class="status-input" title={active.input.name}>{active.input.name}</span>{/if}
  <div class="status-messages">
    {#if !loading && !processingSource && footerStatus}<p role="status" aria-atomic="true">
        {#key messageRevision}<span class="status-message">{footerStatus}</span>{/key}
      </p>{/if}
    <Offline
      busy={sources.length > 0 || parts.length > 0 || loading || matching || demoLoading}
      bind:updating
      bind:status={offlineStatus}
      {notify}
      {error}
    />
  </div>
  <time
    datetime={import.meta.env.BUILD_TIME}
    aria-label={`Build ${import.meta.env.BUILD_ID}`}
    title={`Build ID: Europe/Istanbul · Built ${import.meta.env.BUILD_TIME} (UTC)${import.meta.env.BUILD_REVISION ? ` · Git ${import.meta.env.BUILD_REVISION}` : ""}`}
    >{import.meta.env.BUILD_ID}</time
  >
</footer>

<Export
  bind:this={exporter}
  bind:progress={exportStatus}
  prepare={exportSnapshot}
  blocked={outputProcessing || !!downloadError}
  {info}
  print={(pdf, viewer) => printer.show(pdf, viewer)}
/>
<Print bind:this={printer} {info} />
<Filename
  bind:this={filenameEditor}
  bind:value={output.filename}
  bind:title={output.title}
  bind:coverPage={output.coverPage}
  pages={output.pages.length}
  suggest={() => downloadName(parts, sources)}
  suggestTitle={() => output.defaultTitle}
  reset={() => {
    output.filename = ""
    output.title = ""
    output.cover = undefined
  }}
  preview={coverPreview}
/>
<Recipe bind:this={recorder} {output} {sources} {info} />
<Align bind:value={alignment} {notify} />

<Examples bind:this={examples} navigate={example} workspace={!!active || parts.length > 0} />

{#if probe && demo === "grid" && active}
  {#await import("./Geometry.svelte") then module}<module.default />{/await}
{/if}
