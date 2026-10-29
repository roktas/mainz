<!-- Coordinates Input opening, Source choices, and the Output and preview owners. -->

<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte"
  import { animateRemoval } from "./motion.ts"
  import type { PDFDocumentLoadingTask } from "pdfjs-dist"
  import { downloadInputs, downloadName, job, sizeOf, uid } from "./model.ts"
  import type { Input, Source } from "./model.ts"
  import type { Inspection } from "./Page.svelte"
  import type { Magnification } from "./Lens.svelte"
  import { applicable, applyProfile, current, draftError, feedback, resolve, usage } from "./styles.ts"
  import { Documents, inspectPDF, openPDF } from "./pdf.ts"
  import { Processor } from "./processor.ts"
  import gridJob from "../test/fixtures/grid-job.json"
  import { Output } from "./output.svelte.ts"
  import { Preview } from "./preview.svelte.ts"
  import Download from "./Download.svelte"
  import type { Snapshot } from "./Download.svelte"
  import Landing from "./Landing.svelte"
  import Settings from "./Settings.svelte"
  import Examples from "./Examples.svelte"
  import Theme from "./Theme.svelte"
  import Logo from "./Logo.svelte"
  import Icon from "./Icon.svelte"
  import Feedback from "./Feedback.svelte"
  import Offline from "./Offline.svelte"
  import Style from "./Style.svelte"
  import Composer from "./Composer.svelte"
  import Help from "./Help.svelte"
  import type { TourStep } from "./Tour.svelte"
  import type { Sequence } from "./pages.ts"

  const query = new URLSearchParams(location.search)
  const probe = import.meta.env.DEV && query.has("geometry")
  const demo = query.get("demo") ?? (probe ? "grid" : null)
  let sources = $state.raw<Source[]>([])
  const output = new Output(() => sources)
  const parts = $derived(output.parts)
  let sequences = $state.raw<Record<string, Sequence>>({})
  let activeId = $state("")
  let logoReplay = $state(0)
  let magnification = $state<Magnification>(16)
  let message = $state("")
  let notice = $state("")
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let messageRevision = $state(0)
  const firstAction = "Select pages · Use + to add to Output."
  let failure = $state.raw<string | string[]>("")
  let loading = $state(false)
  let updating = $state(false)
  let openingStatus = $state("")
  let offlineStatus = $state("")
  let tour = $state<TourStep>()
  let downloader = $state<ReturnType<typeof Download>>(null!)
  let composer = $state<ReturnType<typeof Composer>>(null!)
  let examples = $state<ReturnType<typeof Examples>>(null!)
  let inputMenu = $state<HTMLDetailsElement>(null!)
  const unsaved = $derived(output.modified || sources.some((source) => source.modified))
  let homeApproved = false
  let logoClicks = 0
  let logoTimer: ReturnType<typeof setTimeout> | undefined
  let outputZoom = $state(100)
  let comparing = $state(false)
  const documents = new Documents()
  let openingProcessor: Processor | undefined
  let openingTask: PDFDocumentLoadingTask | undefined
  let openingSource = $state.raw<Source>()
  let openRevision = 0
  let disposed = false
  const active = $derived(sources.find((source) => source.id === activeId) ?? openingSource)
  const sourceId = $derived(active?.id)
  const description = $derived(active?.input.description)
  const counts = $derived(usage(parts))
  const outputSources = $derived(sources.filter((source) => counts.has(source.id)))
  const controls = $derived(description && sourceId ? applicable(description, counts.get(sourceId)?.keys() ?? []) : [])
  const styleable = $derived(controls.length > 0)
  const hasProfiles = $derived(
    (active?.input.description.profileSets ?? []).some(
      (set) => set.profiles.length > 1 && set.parameters.some((id) => controls.includes(id)),
    ),
  )
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
    if (source && source.id !== activeId) message += ` (${source.input.name})`
    return ++messageRevision
  }
  function notify(text: string) {
    clearTimeout(noticeTimer)
    notice = text
    if (text) noticeTimer = setTimeout(() => (notice = ""), 10000)
  }
  function error(text: string | string[]) {
    failure = text
    info("")
    notify("")
  }
  function update(source: Source) {
    sources = sources.map((item) => (item.id === source.id ? source : item))
  }
  async function releaseUnused() {
    await tick()
    documents.retain(sources.flatMap((source) => [source.preview.displayed.pdf, source.input.pdf]))
  }
  function composition(text = "Output updated. Input selections and styles are retained.") {
    failure = ""
    for (const source of sources) source.preview.reconcile(source, counts)
    if (notice === firstAction) notify("")
    info(text)
  }
  function previewFor(id: string, input: Input, overrides: Source["overrides"], processor?: Processor) {
    const identity = { id, input }
    return new Preview(
      input,
      overrides,
      {
        documents,
        info: (text) => info(text, identity),
        complete: (text, revision) => {
          if (revision === messageRevision) info(text, identity)
        },
        release: () => void releaseUnused(),
      },
      processor,
    )
  }
  function choose(id: string, sequence: Sequence) {
    sequences = { ...sequences, [id]: sequence }
  }
  async function open(file: Uint8Array | File, name: string, report: (text: string) => void = error) {
    if (loading || updating) return
    if ((file instanceof File ? file.size : file.length) > 128 * 1024 * 1024) {
      report("Choose a PDF smaller than 128 MiB.")
      return
    }
    const revision = ++openRevision
    loading = true
    failure = ""
    notify("")
    openingStatus = `Opening ${name}…`
    info(openingStatus)
    const processor = new Processor()
    openingProcessor = processor
    let loadingTask: PDFDocumentLoadingTask | undefined
    let committed = false
    let abandoned = false
    let preview: Source | undefined
    try {
      const bytes = file instanceof File ? new Uint8Array(await file.arrayBuffer()) : file
      if (disposed || revision !== openRevision) return
      const [result, opened] = await Promise.all([
        processor.run(bytes, revision),
        (async () => {
          loadingTask = await openPDF(bytes)
          if (abandoned || disposed || revision !== openRevision) {
            void loadingTask.destroy()
            return
          }
          openingTask = loadingTask
          const pdf = await loadingTask.promise
          const geometry = await inspectPDF(pdf, () => abandoned || disposed || revision !== openRevision)
          if (!geometry) return
          const { sizes, labels } = geometry
          const input: Input = {
            id: uid(),
            name,
            bytes,
            pdf,
            sizes,
            labels,
            description: { version: 1, pageCount: pdf.numPages, pages: {}, parameters: {} },
          }
          const id = uid()
          preview = {
            id,
            input,
            preview: previewFor(id, input, {}),
            overrides: {},
            drafts: {},
            modified: false,
          }
          if (!sources.length && !parts.length) openingSource = preview
          return preview
        })(),
      ])
      if (disposed || revision !== openRevision || !opened) return
      const pdf = opened.input.pdf
      const input: Input = { ...opened.input, description: result.description }
      const overrides = Object.fromEntries(
        Object.entries(result.description.parameters)
          .filter(([, entry]) => Object.hasOwn(entry.parameter, "value"))
          .map(([id, entry]) => [id, entry.parameter.value!]),
      )
      const editable = Object.keys(input.description.parameters).length > 0
      opened.preview.dispose()
      const source: Source = {
        ...opened,
        input,
        overrides,
        preview: previewFor(opened.id, input, overrides, editable ? processor : undefined),
      }
      documents.add(pdf, loadingTask!)
      choose(source.id, {
        text: pdf.numPages === 1 ? "1" : "",
        pages: pdf.numPages === 1 ? [0] : [],
        repeat: "1",
        front: false,
      })
      sources = [...sources, source]
      activeId = source.id
      openingSource = undefined
      if (!editable) processor.dispose()
      committed = true
      info(`Opened ${pdf.numPages} ${pdf.numPages === 1 ? "page" : "pages"}.`)
      return source
    } catch (reason) {
      if (!disposed && revision === openRevision) {
        report(
          `Could not open ${name}. ${reason instanceof Error ? reason.message : "Try another PDF."} Your workspace is retained. Choose a PDF to retry.`,
        )
      }
    } finally {
      abandoned = true
      if (openingSource?.id === preview?.id) openingSource = undefined
      if (!committed) {
        processor.dispose()
        void loadingTask?.destroy()
      }
      if (revision === openRevision) {
        loading = false
        openingProcessor = undefined
        openingTask = undefined
      }
    }
  }
  async function files(list: FileList | File[]) {
    if (loading || updating || disposed) return
    const failed: string[] = []
    for (const file of Array.from(list)) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        failed.push(`Could not open ${file.name}. Choose a PDF file.`)
        continue
      }
      if (file.size > 128 * 1024 * 1024) {
        failed.push(`Could not open ${file.name}. Choose a PDF smaller than 128 MiB.`)
        continue
      }
      const revision = openRevision + 1
      try {
        await open(file, file.name, (text) => failed.push(text))
      } catch (reason) {
        failed.push(`Could not read ${file.name}. ${reason instanceof Error ? reason.message : "File reading failed."}`)
      }
      if (disposed || updating || openRevision !== revision) return
    }
    if (!disposed && failed.length) error(failed)
  }
  function cancelOpen() {
    openRevision++
    openingSource = undefined
    openingProcessor?.dispose()
    openingProcessor = undefined
    void openingTask?.destroy()
    openingTask = undefined
    loading = false
    info("Opening cancelled. Your workspace is retained.")
  }
  function removeSource() {
    if (!active) return
    const blocking = parts.filter((part) =>
      part.pages.some((page) => "source" in page.content && page.content.source === active.id),
    )
    if (blocking.length) {
      error("Remove this Input's pages from Output before removing it.")
      return
    }
    for (const sheet of document.querySelectorAll<HTMLElement>(
      ".selection-panel .page-image canvas, .selection-panel .page-scroll canvas",
    ))
      animateRemoval(sheet, () => {})
    const id = active.id
    const name = active.input.name
    active.preview.dispose()
    const nextSequences = { ...sequences }
    delete nextSequences[id]
    sequences = nextSequences
    sources = sources.filter((source) => source.id !== id)
    activeId = sources[0]?.id ?? ""
    inputMenu.open = false
    void tick().then(() => {
      if (active) inputMenu.querySelector("summary")?.focus()
      else document.querySelector<HTMLInputElement>("#workspace input[type=file]")?.focus()
    })
    info(`Removed Input · ${name}. Existing Blanks retain their dimensions.`)
    void releaseUnused()
  }
  function changeStyle(id: string, text: string) {
    if (!active) return
    const entry = active.input.description.parameters[id]
    const invalid = feedback(entry, text)
    const drafts = { ...active.drafts, [id]: text },
      overrides = invalid
        ? active.overrides
        : { ...active.overrides, [id]: entry.parameter.schema.type === "number" ? Number(text) : text }
    if (!invalid) delete drafts[id]
    choices({ ...active, drafts, overrides }, invalid ? undefined : `Updated ${entry.parameter.schema.title ?? id}.`)
    const title = entry.parameter.schema.title ?? id
    if (invalid) error(`Invalid value for ${title}. ${invalid}`)
    else {
      failure = ""
    }
  }
  function resetStyle(id?: string) {
    if (!active) return
    failure = ""
    const overrides = { ...active.overrides },
      drafts = { ...active.drafts }
    if (id) {
      delete overrides[id]
      delete drafts[id]
    }
    choices(
      { ...active, overrides: id ? overrides : {}, drafts: id ? drafts : {} },
      id
        ? `Restored ${active.input.description.parameters[id].parameter.schema.title ?? id} to the original style.`
        : "Restored all original styles.",
    )
  }
  function changeProfile(setId: string, profileId: string) {
    if (!active) return
    const set = active.input.description.profileSets?.find((item) => item.id === setId)
    const profile = set?.profiles.find((item) => item.id === profileId)
    if (!set || !profile) return
    failure = ""
    choices({ ...active, ...applyProfile(set, profile, active) }, `Applied ${profile.name} profile.`)
  }
  function choices(source: Source, text?: string) {
    const next = { ...source, modified: true }
    update(next)
    if (text) next.preview.schedule(next, counts, text)
  }
  function schedule(id: string) {
    const source = sources.find((item) => item.id === id)
    if (source) source.preview.schedule(source, counts)
  }
  function downloadSnapshot(): Snapshot {
    if (downloadError) throw new Error(downloadError)
    const selection = output.parts,
      contributors = sources,
      recipe = job(selection, contributors)
    const pages = output.pages
    const first = pages[0]?.content
    const contributor =
      first && "source" in first ? contributors.find((source) => source.id === first.source) : undefined
    const prepared =
      contributor && pages.every(({ content }) => "source" in content && content.source === contributor.id)
        ? contributor.preview.download(
            contributor,
            pages.flatMap(({ content }) => ("page" in content ? [content.page] : [])),
          )
        : undefined
    return {
      recipe,
      prepared,
      inputs: downloadInputs(selection, contributors),
      expected: output.pages.length,
      name: () => downloadName(selection, contributors),
      complete: () => {
        output.acknowledge(selection)
        sources = sources.map((source) => {
          const captured = contributors.find((item) => item.id === source.id)
          return recipe.sources[source.id] &&
            captured?.overrides === source.overrides &&
            captured.drafts === source.drafts &&
            !Object.keys(source.drafts).length
            ? { ...source, modified: false }
            : source
        })
      },
    }
  }
  function logo(event: MouseEvent) {
    const landing = event.currentTarget instanceof HTMLButtonElement
    if (!landing && (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey)) return
    event.preventDefault()
    clearTimeout(logoTimer)
    logoClicks = Math.max(logoClicks + 1, event.detail)
    if (logoClicks >= 3) {
      logoClicks = 0
      examples.show()
      return
    }
    if (landing) logoReplay++
    logoTimer = setTimeout(() => {
      logoClicks = 0
      if (landing) return
      if (unsaved && !confirm("Return home? Input style changes and Output choices have not been downloaded.")) return
      homeApproved = true
      location.assign(import.meta.env.BASE_URL)
    }, 400)
  }
  function example(event: MouseEvent) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (unsaved && !confirm("Open an example? Input style changes and Output choices have not been downloaded.")) {
      event.preventDefault()
      return
    }
    homeApproved = true
  }
  function dismiss(event: MouseEvent | KeyboardEvent) {
    if (inputMenu?.open) {
      if (event instanceof KeyboardEvent && event.key === "Escape") {
        inputMenu.open = false
        inputMenu.querySelector("summary")?.focus()
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
    void (async () => {
      let revision = openRevision
      try {
        const gridDemo = demo === "grid"
        if (demo !== "" && demo !== "empty" && !gridDemo) throw new Error(`Unknown demo: ${demo}. Choose a local PDF.`)
        const filename = gridDemo ? "grid.pdf" : "demo.pdf"
        const asset = gridDemo && import.meta.env.DEV ? filename : "demo.pdf"
        const response = await fetch(`${import.meta.env.BASE_URL}${asset}`)
        let bytes = new Uint8Array(await response.arrayBuffer())
        if (disposed || revision !== openRevision) return
        if (!response.ok) throw new Error("The demo PDF is unavailable. Choose a local PDF.")
        if (gridDemo && !import.meta.env.DEV) {
          const processor = new Processor()
          revision = ++openRevision
          openingProcessor = processor
          loading = true
          openingStatus = "Preparing Grid demo…"
          info(openingStatus)
          try {
            const result = await processor.compose({ ...gridJob, version: 1 }, [{ id: "fixture", bytes }], revision)
            bytes = new Uint8Array(result.bytes)
          } finally {
            processor.dispose()
            if (revision === openRevision) {
              openingProcessor = undefined
              loading = false
            }
          }
          if (disposed || revision !== openRevision) return
        }
        const source = await open(bytes, filename)
        revision = openRevision
        if (!source) return
        if (gridDemo) {
          output.commit([
            {
              id: uid(),
              copies: 1,
              front: false,
              pages: Array.from({ length: source.input.pdf.numPages }, (_, page) => ({
                id: uid(),
                content: { source: source.id, page },
              })),
            },
          ])
          output.acknowledge(output.parts)
          info(`Grid workspace · ${source.input.pdf.numPages} pages.`)
          return
        }
        info("Demo workspace ready.")
        if (demo === "empty") return
        const pages = Array.from({ length: source.input.pdf.numPages }, (_, page) => page)
        choose(source.id, { text: `1-${pages.length}`, pages, repeat: "1", front: false })
        output.commit([
          {
            id: uid(),
            copies: 1,
            front: false,
            pages: [...pages, ...pages.slice(2), ...pages.slice(2)].map((page) => ({
              id: uid(),
              content: { source: source.id, page },
            })),
          },
        ])
        output.acknowledge(output.parts)
        if (import.meta.env.DEV && url.searchParams.has("paint")) {
          const set = source.input.description.profileSets?.find((item) =>
            item.profiles.some((profile) => profile.id === "inkjet"),
          )
          if (set) changeProfile(set.id, "inkjet")
        }
      } catch (reason) {
        if (!disposed && revision === openRevision)
          error(reason instanceof Error ? reason.message : "Demo could not open.")
      }
    })()
  })
  onDestroy(() => {
    disposed = true
    clearTimeout(logoTimer)
    clearTimeout(noticeTimer)
    openingProcessor?.dispose()
    void openingTask?.destroy()
    for (const source of sources) source.preview.dispose()
    documents.dispose()
  })
</script>

{#snippet sourceStyling(toolbarOnly = false)}
  {#if active}{#key active.id}<Style
        source={active}
        {controls}
        counts={counts.get(active.id) ?? new Map()}
        {toolbarOnly}
        {tour}
        style={changeStyle}
        profile={changeProfile}
        reset={resetStyle}
      />{/key}{/if}
{/snippet}

{#snippet inputTools(heading: string)}
  <details class="input-picker" bind:this={inputMenu}>
    <summary aria-label={`Select Input · ${active?.input.name}`}>
      <h2 id={heading}>
        <Icon name="input" /><span class="input-label">Input</span><span class="count"
          >{sources.length + Number(!!openingSource)}</span
        ><span class="input-current" title={active?.input.name}>{active?.input.name}</span><span class="input-chevron"
          ><Icon name="next" /></span
        >
      </h2>
    </summary>
    <div class="input-list" role="group" aria-label="Inputs">
      {#each sources as source, index (source.id)}<button
          aria-pressed={source.id === activeId}
          data-source={source.id}
          onclick={() => {
            activeId = source.id
            inputMenu.open = false
            inputMenu.querySelector("summary")?.focus()
          }}
          ><span class="source-tag">{index + 1}</span><span>{source.input.name}</span>{#if source.id === activeId}<span
              aria-hidden="true">✓</span
            >{/if}</button
        >{/each}
      <button class="danger" onclick={removeSource}><Icon name="trash" />Remove Input</button>
    </div>
  </details>
  <label class="file-picker" title="Open PDF"
    ><Icon name="add" /><span>Open PDF</span><input
      type="file"
      aria-label="Open PDF"
      accept="application/pdf,.pdf"
      multiple
      disabled={loading || updating}
      onchange={(event) => {
        if (event.currentTarget.files) void files(event.currentTarget.files)
        event.currentTarget.value = ""
      }}
    /></label
  >
{/snippet}

<svelte:document onclick={dismiss} onkeydown={dismiss} />
<svelte:window
  onbeforeunload={(event) => {
    const approved = homeApproved
    homeApproved = false
    if (unsaved && !approved) event.preventDefault()
  }}
/>
<header class="masthead">
  <div class="header-inner">
    {#if !active && !parts.length}<button
        type="button"
        class="brand icon-button"
        aria-label="Replay logo animation"
        title="Replay logo animation"
        onclick={logo}><Logo /></button
      >{:else}<a class="brand" href={import.meta.env.BASE_URL} aria-label="PDF Composer home" onclick={logo}><Logo /></a
      >{/if}
    {#if loading || processingSource || offlineStatus || failure || failedSources.length || (notice && notice !== firstAction)}
      <div class="header-feedback">
        {#if loading}<Feedback kind="progress" class="opening-progress" text={openingStatus}>
            {#snippet actions()}<button onclick={cancelOpen}>Cancel</button>{/snippet}
          </Feedback>{:else if processingSource}<Feedback
            kind="progress"
            class="style-progress"
            text={`Updating styles · ${processingSource.input.name}`}
          >
            {#snippet actions()}<button
                aria-label="Cancel style processing"
                onclick={() => processingSource?.preview.cancel()}>Cancel</button
              >{/snippet}
          </Feedback>{/if}
        {#if offlineStatus}<Feedback kind="progress" class="offline-progress" text={offlineStatus} />{/if}
        {#if notice && notice !== firstAction}<Feedback kind="notice" class="notice" text={notice}>
            {#snippet actions()}<button class="icon-button" aria-label="Dismiss notification" onclick={() => notify("")}
                ><Icon name="close" /></button
              >{/snippet}
          </Feedback>{/if}
        {#if failure}<Feedback kind="error" text={Array.isArray(failure) ? undefined : failure}>
            {#snippet actions()}<button class="icon-button" aria-label="Dismiss error" onclick={() => (failure = "")}
                ><Icon name="close" /></button
              >{/snippet}
            {#if Array.isArray(failure)}<details class="file-errors">
                <summary>
                  <span role="alert"
                    >{failure.length} {failure.length === 1 ? "file could" : "files could"} not be opened.</span
                  >
                  <span><Icon name="next" /><span>Review file errors</span></span>
                </summary>
                <!-- Keyboard users need a focusable list for native scrolling. -->
                <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                <ul tabindex="0" aria-label="File errors">
                  {#each failure as message, index (index)}<li>{message}</li>{/each}
                </ul>
              </details>{/if}
          </Feedback>{/if}
        {#each failedSources as source (source.id)}<Feedback
            kind="error"
            text={`${source.input.name}: ${source.preview.error} The last completed preview is shown.`}
          >
            {#snippet actions()}<button onclick={() => schedule(source.id)}>Retry Input styles</button>{/snippet}
          </Feedback>{/each}
      </div>
    {/if}
    <div class="header-actions">
      <span class="header-note" title="Processed on your device. No uploads."><Icon name="lock" />On your device</span
      ><Help
        hasInput={!!active}
        hasOutput={!!output.pages.length}
        {styleable}
        {hasProfiles}
        views={() => composer?.views() ?? { input: "grid", output: "grid" }}
        onboarding={(demo === null || demo === "empty") && !loading}
        dismissed={() => notify("If you change your mind, open Help → App for installation help.")}
        change={(step) => {
          tour = step
        }}
        hint={(show) => {
          if (show) notify(firstAction)
          else if (notice === firstAction) notify("")
        }}
      />{#if active}<Settings bind:magnification />{/if}<Theme />
    </div>
  </div>
</header>
<main id="workspace">
  {#if !active}
    <Landing {loading} {updating} replay={logoReplay} open={files} />
  {/if}
  {#if active || parts.length}<Composer
      bind:this={composer}
      source={active}
      {styleable}
      opening={!!openingSource}
      {sources}
      {output}
      sequence={active ? sequences[active.id] : undefined}
      {choose}
      change={composition}
      download={() => void downloader.start()}
      {error}
      styling={sourceStyling}
      input={inputTools}
      {inspection}
      bind:outputZoom
      bind:comparing
      activate={(id) => (activeId = id)}
      {outputProcessing}
      {downloadError}
      {magnification}
      {tour}
    />{/if}
</main>
<footer class="footnote">
  {#if active}<span class="status-input" title={active.input.name}>{active.input.name}</span>{/if}
  <div class="status-messages">
    {#if !loading && !processingSource && (message || notice === firstAction)}<p role="status" aria-atomic="true">
        {#key notice === firstAction ? firstAction : messageRevision}<span class="status-message"
            >{notice === firstAction ? notice : message}</span
          >{/key}
      </p>{/if}
    <Offline
      busy={sources.length > 0 || parts.length > 0 || loading}
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

<Download bind:this={downloader} prepare={downloadSnapshot} blocked={outputProcessing || !!downloadError} {info} />

<Examples bind:this={examples} navigate={example} workspace={!!active || parts.length > 0} />

{#if probe && demo === "grid"}
  {#await import("./Geometry.svelte") then module}<module.default />{/await}
{/if}
