<!-- Coordinates Input opening, style choices, and the Output and preview owners. -->

<script lang="ts">
  import { onDestroy, onMount, tick } from "svelte"
  import { animateRemoval } from "./motion.ts"
  import { downloadInputs, downloadName, expand, maxInputBytes, plan, sizeOf, uid } from "./model.ts"
  import type { Input, Source } from "./model.ts"
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
    sharedProfiles,
    usage,
  } from "./styles.ts"
  import { cover, Documents, Opening } from "./pdf.ts"
  import { Processor } from "./processor.ts"
  import gridPlan from "../test/fixtures/grid-plan.json"
  import { Output } from "./output.svelte.ts"
  import { Preview } from "./preview.svelte.ts"
  import Export from "./Export.svelte"
  import Print from "./Print.svelte"
  import Filename from "./Filename.svelte"
  import Recipe from "./Recipe.svelte"
  import Load from "./Load.svelte"
  import type { Binding } from "./Load.svelte"
  import type { Snapshot } from "./Export.svelte"
  import Landing from "./Landing.svelte"
  import Settings from "./Settings.svelte"
  import Examples from "./Examples.svelte"
  import Theme from "./Theme.svelte"
  import Logo from "./Logo.svelte"
  import Icon from "./Icon.svelte"
  import Feedback from "./Feedback.svelte"
  import Offline from "./Offline.svelte"
  import Style from "./Style.svelte"
  import Guidance from "./Guidance.svelte"
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
  let perFileProfiles = $state(false)
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
  let exportStatus = $state("")
  let tour = $state<TourStep>()
  let exporter = $state<ReturnType<typeof Export>>(null!)
  let printer = $state<ReturnType<typeof Print>>(null!)
  let filenameEditor = $state<ReturnType<typeof Filename>>(null!)
  let recorder = $state<ReturnType<typeof Recipe>>(null!)
  let loader = $state<ReturnType<typeof Load>>(null!)
  let matching = $state(false)
  let recipeStatus = $state("")
  let composer = $state<ReturnType<typeof Composer>>(null!)
  let examples = $state<ReturnType<typeof Examples>>(null!)
  let inputMenu = $state<HTMLDetailsElement>(null!)
  const unsaved = $derived(output.modified || sources.some((source) => source.modified))
  let homeApproved = false
  let logoClicks = 0
  let logoTimer: ReturnType<typeof setTimeout> | undefined
  const documents = new Documents()
  let openingProcessor: Processor | undefined
  let openingJob: Opening | undefined
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
  const shareable = $derived.by(() => {
    if (!active || sources.length < 2) return false
    const ids = [...new Set([...controls, ...Object.keys(active.overrides)])]
    const sets = (active.input.description.profileSets ?? []).filter(
      (set) => set.profiles.length > 1 && set.parameters.some((id) => controls.includes(id)),
    )
    return sources.some((source) => {
      if (source.id === active.id) return false
      const families = new Map<string, Set<string>>()
      for (const set of source.input.description.profileSets ?? []) {
        if (!set.family) continue
        const names = families.get(set.family) ?? new Set<string>()
        for (const profile of set.profiles) names.add(profile.name)
        families.set(set.family, names)
      }
      return (
        sets.some(
          (set) => set.family && set.profiles.some((profile) => families.get(set.family!)?.has(profile.name)),
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
  function sourceFor(input: Input, id = uid(), processor?: Processor): Source {
    const overrides = Object.fromEntries(
      Object.entries(input.description.parameters)
        .filter(([, entry]) => Object.hasOwn(entry.parameter, "value"))
        .map(([key, entry]) => [key, entry.parameter.value!]),
    )
    const editable = Object.keys(input.description.parameters).length > 0
    if (!editable) processor?.dispose()
    return {
      id,
      input,
      overrides,
      drafts: {},
      modified: false,
      preview: previewFor(id, input, overrides, editable ? processor : undefined),
    }
  }
  async function open(file: Uint8Array | File, name: string, report: (text: string) => void = error) {
    if (loading || updating) return
    if ((file instanceof File ? file.size : file.length) > maxInputBytes) {
      report("Choose a PDF smaller than 128 MiB.")
      return
    }
    const revision = ++openRevision
    loading = true
    failure = ""
    notify("")
    openingStatus = `Opening ${name}…`
    info(openingStatus)
    const job = new Opening()
    openingJob = job
    let committed = false
    let preview: Source | undefined
    try {
      const input = await job.read(file, name, revision, (provisional) => {
        preview = sourceFor(provisional)
        if (!sources.length && !parts.length) openingSource = preview
      })
      if (disposed || revision !== openRevision) return
      preview?.preview.dispose()
      const source = sourceFor(input, preview?.id, job.attach(documents))
      choose(source.id, {
        text: input.pdf.numPages === 1 ? "1" : "",
        pages: input.pdf.numPages === 1 ? [0] : [],
        repeat: "1",
        front: false,
      })
      sources = [...sources, source]
      activeId = source.id
      openingSource = undefined
      committed = true
      info(`Opened ${input.pdf.numPages} ${input.pdf.numPages === 1 ? "page" : "pages"}.`)
      return source
    } catch (reason) {
      if (!disposed && revision === openRevision) {
        report(
          `Could not open ${name}. ${reason instanceof Error ? reason.message : "Try another PDF."} Your workspace is retained. Choose a PDF to retry.`,
        )
      }
    } finally {
      if (openingSource?.id === preview?.id) openingSource = undefined
      if (!committed) {
        preview?.preview.dispose()
        job.dispose()
      }
      if (revision === openRevision) {
        loading = false
        openingJob = undefined
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
      if (file.size > maxInputBytes) {
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
  async function openRecipe(file: File) {
    openRevision++
    await loader.show(file)
  }
  async function landingFiles(list: FileList | File[]) {
    if (list.length !== 1) {
      error("Choose one PDF or Recipe to start.")
      return
    }
    const file = list[0]
    if (file.name.toLowerCase().endsWith(".json")) await openRecipe(file)
    else await files(list)
  }
  async function loadRecipe(text: string, bindings: Binding[]) {
    if (loading || updating || sources.length || parts.length) throw new Error("Return home to open a Recipe.")
    const revision = ++openRevision
    loading = true
    failure = ""
    notify("")
    openingStatus = "Opening Recipe…"
    const worker = new Processor()
    openingProcessor = worker
    const prepared: Source[] = []
    let committed = false
    try {
      const resolved = await worker.resolve(
        text,
        bindings.map(({ id, input }) => ({ id, bytes: input.bytes })),
        revision,
      )
      if (disposed || revision !== openRevision) throw new DOMException("Opening cancelled.", "AbortError")
      const inputs = new Map(bindings.map((binding) => [binding.id, binding.input]))
      const identities = new Map<string, string>()
      for (const [id, definition] of Object.entries(resolved.plan.sources)) {
        const source = sourceFor(inputs.get(definition.input)!)
        source.overrides = definition.overrides
        source.profiles = resolved.intent[id].profiles
        source.edits = resolved.intent[id].edits
        prepared.push(source)
        identities.set(id, source.id)
      }
      const next = resolved.plan.parts.map((part) => ({
        id: uid(),
        copies: part.copies,
        front: part.front,
        pages: part.pages.map((content) => ({
          id: uid(),
          content:
            "source" in content
              ? { source: identities.get(content.source)!, page: content.page }
              : structuredClone(content),
        })),
      }))
      expand(next, prepared)
      for (const binding of bindings) binding.opening.attach(documents).dispose()
      sources = prepared
      for (const source of sources)
        choose(source.id, {
          text: source.input.pdf.numPages === 1 ? "1" : "",
          pages: source.input.pdf.numPages === 1 ? [0] : [],
          repeat: "1",
          front: false,
        })
      output.commit(next)
      output.title = resolved.plan.metadata?.title ?? ""
      output.coverPage = resolved.plan.metadata?.coverPage ?? 1
      activeId = sources[0]?.id ?? ""
      committed = true
      for (const source of sources) source.preview.schedule(source, counts, undefined, true)
      info(
        `Opened Recipe · ${output.pages.length} pages.${resolved.warnings.length ? ` ${resolved.warnings.length} Input change warning${resolved.warnings.length === 1 ? "" : "s"}.` : ""}`,
      )
    } finally {
      if (!committed) for (const source of prepared) source.preview.dispose()
      worker.dispose()
      if (revision === openRevision) {
        loading = false
        openingProcessor = undefined
      }
    }
  }
  function cancelOpen() {
    openRevision++
    openingSource = undefined
    openingProcessor?.dispose()
    openingProcessor = undefined
    openingJob?.dispose()
    openingJob = undefined
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
    sources = sources.map((source) => {
      if (perFileProfiles && source.id !== active.id) return source
      let next = source
      for (const candidate of source.id === active.id ? [set] : (source.input.description.profileSets ?? [])) {
        const choice =
          source.id === active.id
            ? profile
            : sharedProfiles(set, candidate, profile.name)
              ? candidate.profiles.find((item) => item.name === profile.name)
              : undefined
        if (!choice) continue
        const matches = matchingProfile(candidate, next.overrides, next.drafts)?.id === choice.id
        if (matches && next.profiles?.[candidate.id] === choice.id) continue
        next = { ...next, ...applyProfile(candidate, choice, next), modified: next.modified || !matches }
      }
      if (next !== source) {
        if (source.id === active.id) affected.unshift(next)
        else affected.push(next)
      }
      return next
    })
    for (const source of affected) source.preview.schedule(source, counts, undefined, affected.length > 1)
    info(`Applied ${profile.name} profile${affected.length > 1 ? ` to ${affected.length} files` : ""}.`)
  }
  function choices(source: Source, text?: string, ids: string[] = []) {
    const original = active!
    let skipped = 0
    const affected: Source[] = []
    sources = sources.map((target) => {
      if (target.id === source.id) {
        const next = { ...source, modified: true }
        if (text) affected.unshift(next)
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
    for (const next of affected) next.preview.schedule(next, counts, undefined, affected.length > 1)
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
        sources = sources.map((source) => {
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
  function inputDetails(input: Input) {
    if (!input.xmp && (!input.title || input.title === input.name)) return undefined
    return { Filename: input.name, ...(input.title ? { "dc:title": input.title } : {}), ...input.xmp }
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
        if (demo === "recipe") {
          const base = import.meta.env.BASE_URL
          const response = await fetch(`${base}recipe.json`)
          if (!response.ok) throw new Error("The sample Recipe is unavailable. Choose a local Recipe.")
          const bytes = await response.arrayBuffer()
          if (disposed || revision !== openRevision) return
          await loader.show(new File([bytes], "practice-session.json", { type: "application/json" }), {
            recipe: `${base}recipe.json`,
            inputs: {
              book: `${base}demo.pdf`,
              guides: `${base}recipe/guides.pdf`,
              crossings: `${base}recipe/crossings.pdf`,
            },
          })
          info("Recipe demo ready.")
          return
        }
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
            const result = await processor.compose({ ...gridPlan, version: 1 }, [{ id: "fixture", bytes }], revision)
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
    openingJob?.dispose()
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
        bind:perFile={perFileProfiles}
        shared={shareable}
        reset={resetStyle}
      />{/key}{/if}
{/snippet}

{#snippet inputTools(heading: string)}
  {#if active}<details class="input-picker" bind:this={inputMenu}>
      <summary aria-label={`Select Input · ${active?.input.name}`}>
        <h2 id={heading}>
          <Icon name="input" /><span class="input-label">Input</span><span class="count"
            >{sources.length + Number(!!openingSource)}</span
          ><span class="input-current" title={active?.input.title || active?.input.name}>{active?.input.name}</span>
          {#if active?.input.title && active.input.title !== active.input.name}<span
              class="input-title"
              title={active.input.title}>{active.input.title}</span
            >{/if}
          <span class="input-chevron"><Icon name="next" /></span>
        </h2>
        {#if active && inputDetails(active.input)}<span class="input-information">
            <Guidance title={active.input.title || active.input.name} fields={inputDetails(active.input)} />
          </span>{/if}
      </summary>
      <div class="input-list" role="group" aria-label="Inputs">
        {#each sources as source, index (source.id)}<div class="input-choice">
            <button
              aria-pressed={source.id === activeId}
              data-source={source.id}
              onclick={() => {
                activeId = source.id
                inputMenu.open = false
                inputMenu.querySelector("summary")?.focus()
              }}
              ><span class="source-tag">{index + 1}</span><span>{source.input.name}</span
              >{#if source.input.title && source.input.title !== source.input.name}<span
                  class="input-choice-title"
                  title={source.input.title}>{source.input.title}</span
                >{/if}{#if source.id === activeId}<span aria-hidden="true">✓</span>{/if}</button
            ><Guidance title={source.input.title || source.input.name} fields={inputDetails(source.input)} />
          </div>{/each}
        <button class="danger" aria-label="Remove Input" title="Remove Input" onclick={removeSource}
          ><Icon name="trash" /><span>Remove Input</span></button
        >
      </div>
    </details>{/if}
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

<svelte:document
  onclick={dismiss}
  onkeydown={dismiss}
  onpointerdowncapture={() => (document.documentElement.dataset.keyboard = "false")}
  onkeydowncapture={() => (document.documentElement.dataset.keyboard = "true")}
/>
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
    {#if loading || processingSource || offlineStatus || exportStatus || failure || failedSources.length || (notice && notice !== firstAction)}
      <div class="header-feedback">
        {#if exportStatus}<Feedback kind="progress" text={exportStatus}>
            {#snippet actions()}<button onclick={() => exporter.cancel()}>Cancel</button>{/snippet}
          </Feedback>{/if}
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
            {#if Array.isArray(failure)}<div class="file-errors">
                <span role="alert"
                  >{failure.length} {failure.length === 1 ? "file could" : "files could"} not be opened.</span
                >
                <button type="button" class="file-errors-trigger" popovertarget="file-error-panel"
                  ><Icon name="next" /><span>Review file errors</span></button
                >
                <div id="file-error-panel" class="file-error-panel" popover="auto" aria-label="File error details">
                  <div class="dialog-heading">
                    <h3>File errors</h3>
                    <button
                      class="icon-button"
                      popovertarget="file-error-panel"
                      popovertargetaction="hide"
                      aria-label="Close file errors"
                      title="Close"><Icon name="close" /></button
                    >
                  </div>
                  <!-- Keyboard users need a focusable list for native scrolling. -->
                  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
                  <ul tabindex="0" aria-label="File errors">
                    {#each failure as message, index (index)}<li>{message}</li>{/each}
                  </ul>
                </div>
              </div>{/if}
          </Feedback>{/if}
        {#each failedSources as source (source.id)}<Feedback
            kind="error"
            text={`${source.input.name}: ${source.preview.error} The last completed preview is shown.`}
          >
            {#snippet actions()}<button aria-label="Retry Input styles" onclick={() => schedule(source.id)}
                >Retry</button
              >{/snippet}
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
  {#if !active && !parts.length && !matching}
    <Landing {loading} {updating} replay={logoReplay} open={landingFiles} recipe={(file) => void openRecipe(file)} />
  {/if}
  <Load
    bind:this={loader}
    bind:active={matching}
    bind:status={recipeStatus}
    replay={logoReplay}
    open={loadRecipe}
    cancel={cancelOpen}
  />
  {#if !active && parts.length && !matching}<div class="empty-input">{@render inputTools("")}</div>{/if}
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
      download={() => void exporter.start()}
      sharing={exporter?.sharing ?? false}
      print={() => void exporter.start("Print")}
      viewPDF={() => void exporter.start("View")}
      recipe={() => recorder.show()}
      filename={output.filename}
      rename={(source) => filenameEditor.show(source)}
      {error}
      styling={sourceStyling}
      input={inputTools}
      {inspection}
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
    {#if !loading && !processingSource && (recipeStatus || message || notice === firstAction)}<p
        role="status"
        aria-atomic="true"
      >
        {#key notice === firstAction ? firstAction : messageRevision}<span class="status-message"
            >{recipeStatus || (notice === firstAction ? notice : message)}</span
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
  preview={coverPreview}
/>
<Recipe bind:this={recorder} {output} {sources} {info} />

<Examples bind:this={examples} navigate={example} workspace={!!active || parts.length > 0} />

{#if probe && demo === "grid"}
  {#await import("./Geometry.svelte") then module}<module.default />{/await}
{/if}
