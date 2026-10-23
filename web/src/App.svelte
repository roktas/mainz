<!-- Owns PDF lifetimes, Source styles, Output state, and unsaved choices. -->

<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte"
  import { animateRemoval } from "./motion.ts"
  import { fade } from "svelte/transition"
  import type { PDFDocumentLoadingTask } from "pdfjs-dist"
  import { appearance, downloadInputs, downloadName, expand, job, positionAfterEdit, sizeOf, uid } from "./model.ts"
  import type { Input, Job, Part, Source } from "./model.ts"
  import type { Inspection } from "./Page.svelte"
  import type { Magnification } from "./Lens.svelte"
  import {
    applicable,
    applyProfile,
    available,
    bufferPages,
    current,
    draftError,
    feedback,
    needsRender,
    resolve,
    usage,
  } from "./styles.ts"
  import type { Render, Scalar } from "./styles.ts"
  import { Documents, inspectPDF, openPDF, verifyPDF } from "./pdf.ts"
  import { Processor } from "./processor.ts"
  import Download from "./Download.svelte"
  import type { Snapshot } from "./Download.svelte"
  import Landing from "./Landing.svelte"
  import Settings from "./Settings.svelte"
  import Theme from "./Theme.svelte"
  import Logo from "./Logo.svelte"
  import Icon from "./Icon.svelte"
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
  let parts = $state.raw<Part[]>([])
  let sequences = $state.raw<Record<string, Sequence>>({})
  let activeId = $state("")
  let logoReplay = $state(0)
  let magnification = $state<Magnification>(16)
  let message = $state("")
  let notice = $state("")
  let noticeDismissed = $state(false)
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  let messageRevision = $state(0)
  const firstAction = "Select pages · Use + to add to Output."
  let failure = $state.raw<string | string[]>("")
  let loading = $state(false)
  let updating = $state(false)
  let openingStatus = $state("")
  let tour = $state<TourStep>()
  let downloader = $state<ReturnType<typeof Download>>(null!)
  let composer = $state<ReturnType<typeof Composer>>(null!)
  let inputMenu = $state<HTMLDetailsElement>(null!)
  let outputChanged = $state(false)
  let modifiedSources = $state.raw<string[]>([])
  const unsaved = $derived(outputChanged || modifiedSources.length > 0)
  let homeApproved = false
  let outputPosition = $state(0)
  let outputZoom = $state(100)
  let comparing = $state(false)
  type Preview = {
    processor?: Processor
    timer?: ReturnType<typeof setTimeout>
    rendered: Render
    request?: Render
    task?: PDFDocumentLoadingTask
  }
  const previews = new Map<string, Preview>()
  const documents = new Documents()
  let openingProcessor: Processor | undefined
  let openingTask: PDFDocumentLoadingTask | undefined
  let openingSource = $state.raw<Source>()
  let openRevision = 0
  let disposed = false
  const active = $derived(sources.find((source) => source.id === activeId) ?? openingSource)
  const counts = $derived(usage(parts))
  const output = $derived.by(() => {
    try {
      return { pages: expand(parts, sources), error: "" }
    } catch (reason) {
      return { pages: [], error: reason instanceof Error ? reason.message : "Invalid Output." }
    }
  })
  const outputSources = $derived(sources.filter((source) => counts.has(source.id)))
  const controls = $derived(active ? available(active, counts) : [])
  const styleable = $derived(controls.length > 0)
  const hasProfiles = $derived(
    (active?.input.description.profileSets ?? []).some(
      (set) => set.profiles.length > 1 && set.parameters.some((id) => controls.includes(id)),
    ),
  )
  const outputProcessing = $derived(outputSources.some((source) => source.status === "pending"))
  const downloadError = $derived.by(() => {
    try {
      downloadInputs(parts, sources)
      return outputSources.map((source) => draftError(source, counts)).find(Boolean)
    } catch (reason) {
      return reason instanceof Error ? reason.message : "Invalid Download inputs."
    }
  })
  const inspection: Inspection | undefined = $derived.by(() => {
    const page = output.pages[Math.min(outputPosition, Math.max(0, output.pages.length - 1))]
    if (!page) return
    const content = page.content
    const source = "source" in content ? sources.find((item) => item.id === content.source) : undefined
    const eligible = source && "page" in content ? applicable(source.input.description, [content.page]) : []
    return {
      ...(source && "page" in content ? appearance(source, content.page) : {}),
      original: source?.input.pdf,
      originalPage: "page" in content ? content.page : undefined,
      comparable:
        !!source &&
        source.status === "ready" &&
        !eligible.some(
          (id) =>
            Object.hasOwn(source.drafts, id) && feedback(source.input.description.parameters[id], source.drafts[id]),
        ) &&
        eligible.some((id) => {
          const entry = source.input.description.parameters[id]
          return current(resolve(entry, source.overrides, id)).toLowerCase() !== current(entry).toLowerCase()
        }),
      size: sizeOf(page.content, sources),
      padding: page.padding,
    }
  })

  function info(text: string, source?: Source) {
    message = text.charAt(0).toUpperCase() + text.slice(1)
    if (source && source.id !== activeId) message += ` (${source.input.name})`
    return ++messageRevision
  }
  function notify(text: string) {
    clearTimeout(noticeTimer)
    noticeDismissed = !text
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
    documents.retain(sources.flatMap((source) => [source.pdf, source.input.pdf]))
  }
  function composition(next: Part[], text = "Output updated. Input selections and styles are retained.") {
    const previous = counts
    outputPosition = positionAfterEdit(output.pages, expand(next, sources), outputPosition)
    parts = next
    const nextCounts = counts
    outputChanged = true
    failure = ""
    for (const source of sources) {
      const preview = previews.get(source.id)!
      if (
        source.status === "pending" ||
        (needsRender(source, nextCounts, preview.rendered) && !needsRender(source, previous, preview.rendered))
      )
        schedule(source.id)
    }
    if (notice === firstAction) notify("")
    info(text)
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
          preview = {
            id: uid(),
            input,
            pdf,
            overrides: {},
            drafts: {},
            status: "ready",
            revision: 0,
          }
          if (!sources.length && !parts.length) openingSource = preview
          return preview
        })(),
      ])
      if (disposed || revision !== openRevision || !opened) return
      const { pdf } = opened
      const input: Input = { ...opened.input, description: result.description }
      const overrides = Object.fromEntries(
        Object.entries(result.description.parameters)
          .filter(([, entry]) => Object.hasOwn(entry.parameter, "value"))
          .map(([id, entry]) => [id, entry.parameter.value!]),
      )
      const source: Source = {
        ...opened,
        input,
        overrides,
      }
      documents.add(pdf, loadingTask!)
      const editable = Object.keys(input.description.parameters).length > 0
      previews.set(source.id, { rendered: { overrides }, processor: editable ? processor : undefined })
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
    cancelRender(id)
    previews.get(id)?.processor?.dispose()
    previews.delete(id)
    const nextSequences = { ...sequences }
    delete nextSequences[id]
    sequences = nextSequences
    sources = sources.filter((source) => source.id !== id)
    modifiedSources = modifiedSources.filter((source) => source !== id)
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
    update({ ...active, drafts, overrides })
    if (!modifiedSources.includes(active.id)) modifiedSources = [...modifiedSources, active.id]
    const title = entry.parameter.schema.title ?? id
    if (invalid) error(`Invalid value for ${title}. ${invalid}`)
    else {
      failure = ""
      schedule(active.id, `Updated ${title}.`)
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
    update({ ...active, overrides: id ? overrides : {}, drafts: id ? drafts : {} })
    if (!modifiedSources.includes(active.id)) modifiedSources = [...modifiedSources, active.id]
    schedule(
      active.id,
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
    update({ ...active, ...applyProfile(set, profile, active) })
    if (!modifiedSources.includes(active.id)) modifiedSources = [...modifiedSources, active.id]
    schedule(active.id, `Applied ${profile.name} profile.`)
  }
  function cancelRender(id: string) {
    const preview = previews.get(id)
    if (!preview) return
    clearTimeout(preview.timer)
    preview.timer = undefined
    preview.processor?.cancel()
    preview.request = undefined
    void preview.task?.destroy()
    preview.task = undefined
  }
  function schedule(id: string, text?: string) {
    const source = sources.find((item) => item.id === id)
    if (!source) return
    const preview = previews.get(id)!
    const needed = needsRender(source, counts, preview.rendered)
    const requested = preview.request
    if (needed && requested && !needsRender(source, counts, requested)) {
      if (text) info(text, source)
      return
    }
    cancelRender(id)
    const revision = source.revision + 1
    if (!needed) {
      if (source.status !== "ready") update({ ...source, status: "ready", error: undefined, revision })
      if (text) info(text, source)
      return
    }
    preview.request = { overrides: { ...source.overrides }, pages: bufferPages(source, counts) }
    update({ ...source, status: "pending", error: undefined, revision })
    const statusRevision = info("Updating styles…", source)
    preview.timer = setTimeout(() => {
      preview.timer = undefined
      void renderSource(id, revision, text ?? "Updated styles.", statusRevision)
    }, 200)
  }
  async function renderSource(id: string, revision: number, text: string, statusRevision: number) {
    const source = sources.find((item) => item.id === id)
    if (!source) return
    const preview = previews.get(id)!
    const processor = (preview.processor ??= new Processor())
    const overrides: Record<string, Scalar> = { ...source.overrides }
    const pages = bufferPages(source, counts)
    const ids = pages ? applicable(source.input.description, pages) : Object.keys(source.input.description.parameters)
    preview.request = { overrides, pages }
    let loadingTask: PDFDocumentLoadingTask | undefined
    try {
      const result = await processor.run(source.input.bytes, revision, {
        reset: ids,
        apply: Object.fromEntries(Object.entries(overrides).filter(([parameter]) => ids.includes(parameter))),
        buffer: pages ? { input: source.input.id, pages } : undefined,
      })
      if (disposed || sources.find((item) => item.id === id)?.revision !== revision) return
      loadingTask = await openPDF(new Uint8Array(result.bytes))
      if (disposed || sources.find((item) => item.id === id)?.revision !== revision) {
        void loadingTask.destroy()
        return
      }
      preview.task = loadingTask
      const pdf = await loadingTask.promise
      await verifyPDF(pdf)
      const latest = sources.find((item) => item.id === id)
      if (disposed || !latest || latest.revision !== revision) {
        void loadingTask.destroy()
        return
      }
      documents.add(pdf, loadingTask)
      preview.rendered = { overrides, pages }
      preview.request = undefined
      update({ ...latest, pdf, pdfPages: pages, status: "ready", error: undefined })
      if (statusRevision === messageRevision) info(text, latest)
      void releaseUnused()
    } catch (reason) {
      void loadingTask?.destroy()
      const latest = sources.find((item) => item.id === id)
      if (!disposed && latest?.revision === revision) {
        preview.request = undefined
        update({
          ...latest,
          status: "error",
          error: reason instanceof Error ? reason.message : "Input style processing failed.",
        })
        if (statusRevision === messageRevision) info("")
      }
    } finally {
      if (preview.task === loadingTask) preview.task = undefined
    }
  }
  function cancelStyle() {
    if (!active) return
    cancelRender(active.id)
    update({
      ...active,
      status: "error",
      revision: active.revision + 1,
      error: "Style processing cancelled. Your choices are retained.",
    })
    info("Cancelled style processing. Your choices are retained.")
  }
  function downloadSnapshot(): Snapshot {
    if (downloadError) throw new Error(downloadError)
    const selection = parts,
      contributors = sources
    return {
      recipe: job(selection, contributors),
      inputs: downloadInputs(selection, contributors),
      expected: output.pages.length,
      name: () => downloadName(selection, contributors),
    }
  }
  function downloaded(recipe: Job) {
    outputChanged = false
    modifiedSources = modifiedSources.filter(
      (id) => !recipe.sources[id] || Object.keys(sources.find((source) => source.id === id)!.drafts).length > 0,
    )
  }
  function home(event: MouseEvent) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    if (unsaved && !confirm("Return home? Input style changes and Output choices have not been downloaded.")) {
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
        const gridDemo = import.meta.env.DEV && demo === "grid"
        if (demo !== "" && demo !== "empty" && !gridDemo) throw new Error(`Unknown demo: ${demo}. Choose a local PDF.`)
        const filename = gridDemo ? "grid.pdf" : "demo.pdf"
        const response = await fetch(`${import.meta.env.BASE_URL}${filename}`)
        const bytes = new Uint8Array(await response.arrayBuffer())
        if (disposed || revision !== openRevision) return
        if (!response.ok) throw new Error("The demo PDF is unavailable. Choose a local PDF.")
        const source = await open(bytes, filename)
        revision = openRevision
        if (!source || source.input.pdf.numPages < 7) return
        if (gridDemo) {
          parts = [
            {
              id: uid(),
              copies: "1",
              front: false,
              pages: Array.from({ length: source.input.pdf.numPages }, (_, page) => ({
                id: uid(),
                content: { source: source.id, page },
              })),
            },
          ]
          info(`Grid workspace · ${source.input.pdf.numPages} pages.`)
          return
        }
        info("Demo workspace ready.")
        if (demo === "empty") return
        const pages = [2, 3, 4, 1, 1, 6]
        choose(source.id, { text: "3-5,2,2,7", pages, repeat: "1", front: false })
        parts = [
          {
            id: uid(),
            copies: "1",
            front: false,
            pages: pages.map((page) => ({ id: uid(), content: { source: source.id, page } })),
          },
        ]
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
    clearTimeout(noticeTimer)
    openingProcessor?.dispose()
    void openingTask?.destroy()
    for (const preview of previews.values()) {
      clearTimeout(preview.timer)
      preview.processor?.dispose()
      void preview.task?.destroy()
    }
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
        cancel={cancelStyle}
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
  <label class="file-picker"
    ><Icon name="add" />Open PDF<input
      type="file"
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
<a class="skip" href="#workspace">Skip to workspace</a>
<header class="masthead">
  <div class="header-inner">
    {#if !active && !parts.length}<button
        type="button"
        class="brand icon-button"
        aria-label="Replay logo animation"
        title="Replay logo animation"
        onclick={() => logoReplay++}><Logo /></button
      >{:else}<a class="brand" href={import.meta.env.BASE_URL} aria-label="PDF Composer home" onclick={home}><Logo /></a
      >{/if}
    {#if notice}<div
        class="notice"
        role="status"
        aria-atomic="true"
        in:fade={{
          duration: matchMedia("(prefers-reduced-motion: no-preference)").matches ? 180 : 0,
        }}
        out:fade={{
          duration: !noticeDismissed && matchMedia("(prefers-reduced-motion: no-preference)").matches ? 800 : 0,
        }}
      >
        <Icon name="info" />
        {#key notice}<p>{notice}</p>{/key}
        <button class="icon-button" aria-label="Dismiss notification" onclick={() => notify("")}
          ><Icon name="close" /></button
        >
      </div>{/if}
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
  {#if failure}<div class="error-banner">
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
            {#each failure as message}<li>{message}</li>{/each}
          </ul>
        </details>{:else}<p role="alert">{failure}</p>{/if}
      <button class="icon-button" aria-label="Dismiss error" onclick={() => (failure = "")}
        ><Icon name="close" /></button
      >
    </div>{/if}
  {#each sources.filter((source) => source.status === "error") as source (source.id)}
    <div class="error-banner" role="alert">
      <p><strong>{source.input.name}</strong>: {source.error} The last completed preview is shown.</p>
      <button onclick={() => schedule(source.id)}>Retry Input styles</button>
    </div>
  {/each}
  {#if !active}
    <Landing {loading} {updating} status={openingStatus} replay={logoReplay} cancel={cancelOpen} open={files} />
  {/if}
  {#if loading && active}<div class="loading-status" role="status">
      <span>{openingStatus}</span><button onclick={cancelOpen}>Cancel</button>
    </div>{/if}
  {#if active || parts.length}<Composer
      bind:this={composer}
      source={active}
      {styleable}
      opening={!!openingSource}
      {sources}
      {parts}
      {output}
      sequence={active ? sequences[active.id] : undefined}
      {choose}
      change={composition}
      download={() => void downloader.start()}
      {error}
      styling={sourceStyling}
      input={inputTools}
      {inspection}
      bind:outputPosition
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
    {#if !loading && message}<p role="status" aria-atomic="true">
        {#key messageRevision}<span class="status-message">{message}</span>{/key}
      </p>{/if}
    <Offline busy={sources.length > 0 || parts.length > 0 || loading} bind:updating {notify} {error} />
  </div>
  <time
    datetime={import.meta.env.BUILD_TIME}
    aria-label={`Build ${import.meta.env.BUILD_ID}`}
    title={`Build ID: Europe/Istanbul · Built ${import.meta.env.BUILD_TIME} (UTC)${import.meta.env.BUILD_REVISION ? ` · Git ${import.meta.env.BUILD_REVISION}` : ""}`}
    >{import.meta.env.BUILD_ID}</time
  >
</footer>

<Download
  bind:this={downloader}
  prepare={downloadSnapshot}
  blocked={outputProcessing || !!downloadError}
  {info}
  complete={downloaded}
/>

{#if probe && demo === "grid"}
  {#await import("./Geometry.svelte") then module}<module.default />{/await}
{/if}
