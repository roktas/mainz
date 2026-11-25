<!-- Coordinates pane views, editing state, transfers, and responsive workspace framing. -->

<script lang="ts">
  import { onDestroy, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { filename as normalizeFilename, filenameError } from "./model.ts"
  import type { Source } from "./model.ts"
  import { InputViews, OutputView } from "./pane.svelte.ts"
  import type { Output } from "./output.svelte.ts"
  import { Interaction } from "./interaction.svelte.ts"
  import type { Sequence } from "./pages.ts"
  import { Transfer } from "./transfer.svelte.ts"
  import { Editing } from "./editing.svelte.ts"
  import { Peeks } from "./Peek.svelte"
  import type { Inspection } from "./Page.svelte"
  import InputPane from "./InputPane.svelte"
  import OutputPane from "./OutputPane.svelte"
  import WorkspaceBar from "./WorkspaceBar.svelte"
  import type { Magnification } from "./Lens.svelte"
  import Icon from "./Icon.svelte"
  import type { TourStep } from "./Tour.svelte"

  let {
    source,
    styleable,
    sources,
    output,
    sequence,
    choose,
    change,
    download,
    sharing,
    print,
    viewPDF,
    viewInputPDF,
    recipe,
    filename,
    suggestFilename,
    setFilename,
    rename,
    error,
    styling,
    input,
    inputChoices,
    openPDF,
    inspection,
    activate,
    outputProcessing = false,
    downloadError,
    opening = false,
    magnification = 16,
    tour,
    initial = { input: "grid", output: "grid" },
  }: {
    source?: Source
    styleable: boolean
    sources: readonly Source[]
    output: Output
    sequence?: Sequence
    choose: (id: string, sequence: Sequence) => void
    change: (text: string) => void
    download: () => void
    sharing: boolean
    print: () => void
    viewPDF: () => void
    viewInputPDF: () => void
    recipe: () => void
    filename?: string
    suggestFilename: () => string
    setFilename: (name: string) => void
    rename: (source: HTMLElement) => void
    error: (message: string) => void
    styling?: Snippet<[toolbarOnly?: boolean]>
    input: Snippet<[heading: string]>
    inputChoices: Snippet<[close: () => void, compact: boolean]>
    openPDF: Snippet
    inspection?: Inspection
    activate: (id: string) => void
    outputProcessing?: boolean
    downloadError?: string
    opening?: boolean
    magnification?: Magnification
    tour?: TourStep
    initial?: { input: "grid" | "list" | "page" | "style"; output: "grid" | "list" | "page" }
  } = $props()

  const key = $props.id()
  let compact = $state(false)
  let documentMenu = $state<HTMLDivElement>()
  let inputTarget = $state<HTMLButtonElement>()
  let outputTarget = $state<HTMLButtonElement>()
  let outputPane = $state<ReturnType<typeof OutputPane>>()
  const peeks = new Peeks()

  const inputViews = new InputViews(
    untrack(() => initial.input),
    () => source,
    () => sources,
    () => tour,
    () => styleable,
  )
  const outputView = new OutputView(
    untrack(() => initial.output),
    untrack(() => output),
    () => tour,
  )

  const transfer: Transfer = new Transfer({
    get pages() {
      return output.pages
    },
    get positions() {
      return output.positions
    },
    get inspected() {
      return output.inspected
    },
    set inspected(id) {
      output.inspected = id
    },
    get position() {
      return output.position
    },
    set position(value) {
      output.position = value
    },
    get input() {
      return interaction.activeView === "input"
    },
    get insertion() {
      return editing.insertion
    },
    get outputTarget() {
      return outputTarget
    },
    start(event, value, control) {
      editing.start(event, value, control)
      if (transfer.touching) editing.selection.resetPointer()
    },
    drop: (value, at) => editing.drop(value, at),
    reveal() {
      interaction.view = "output"
    },
  })

  const interaction: Interaction = new Interaction({
    input: inputViews,
    outputView,
    get tour() {
      return tour
    },
    cancelMotion: () => editing.cancelMotion(),
    get key() {
      return key
    },
    get source() {
      return source
    },
    get output() {
      return output
    },
    get draft() {
      return editing.selection.draft
    },
    get count() {
      return editing.selection.count
    },
    get opening() {
      return opening
    },
    get transfer() {
      return transfer
    },
    get peeks() {
      return peeks
    },
    resetPointer: () => editing.selection.resetPointer(),
    get originOpen() {
      return editing.originOpen
    },
    set originOpen(value) {
      editing.originOpen = value
    },
    get outputText() {
      return editing.selection.outputText
    },
    get repetitions() {
      return editing.repetitions
    },
    get front() {
      return editing.front
    },
    selectAll: (pane) => editing.selection.selectAll(pane),
    copyCurrent: (pane) => editing.copyCurrent(pane),
    clearInput: () => editing.selection.clearInput(),
    clearOutput: () => editing.selection.clearOutput(),
    editOutput(action, control) {
      const target = control && outputPane?.focusedRange(control)
      return editing.commandOutput(action, target ? { kind: "focused", ...target } : undefined)
    },
  })

  const editing: Editing = new Editing({
    get key() {
      return key
    },
    get source() {
      return source
    },
    get sources() {
      return sources
    },
    get output() {
      return output
    },
    get sequence() {
      return sequence
    },
    inputViews,
    outputView,
    interaction,
    transfer,
    peeks,
    get outputTarget() {
      return outputTarget
    },
    captureEditFocus: (selecting) =>
      outputView.captureEditFocus(
        key,
        selecting,
        () => interaction.touchPointer,
        () => transfer.touching,
        editing.feedback.pending,
      ),
    choose: (id, next) => choose(id, next),
    change: (text) => change(text),
    error: (message) => error(message),
    activate: (id) => activate(id),
  })

  const sourceId = $derived(source?.id)
  const frameHeadingHeight = $derived(
    Math.max(
      inputViews.active === "page" && source ? inputViews.headingHeight : 0,
      outputView.active === "page" && inspection ? outputView.headingHeight : 0,
    ),
  )

  $effect(() => {
    if (!sourceId) return
    return () => editing.resetSource()
  })

  onDestroy(() => editing.dispose())

  export function views() {
    return { input: inputViews.active, output: outputView.active }
  }

  function layout(element: HTMLDivElement) {
    const switcher = element.querySelector<HTMLElement>(".mobile-workspace-tabs")!
    let frame = 0
    const update = () => {
      compact = getComputedStyle(switcher).display !== "none"
      if (!compact) editing.comparing = false
    }
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(update)
    })
    observer.observe(element)
    observer.observe(switcher)
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
    }
  }

  function closeDocument() {
    if (documentMenu?.matches(":popover-open")) {
      const launcher = interaction.activeView === "input" ? inputTarget : outputTarget
      documentMenu.hidePopover()
      launcher?.focus({ preventScroll: true })
      return launcher
    }
  }

  function switchPane(view: "input" | "output", event: MouseEvent & { currentTarget: HTMLButtonElement }) {
    if (interaction.activeView === view) {
      event.currentTarget.focus({ preventScroll: true })
      return
    }
    event.preventDefault()
    editing.cancelMotion()
    interaction.view = view
  }

  function interact(event: Event) {
    if (
      !tour ||
      !(event.target instanceof Element) ||
      !event.target.closest(".composer :is(button, input, select, summary, label, .page-scroll)")
    )
      return
    interaction.inputTab(inputViews.active)
    outputView.tab(outputView.active)
    interaction.view = interaction.activeView
    const openTour = document.querySelector<HTMLElement>(".help-tour:popover-open")
    if (openTour) {
      openTour.dataset.workspaceAction = "true"
      openTour.hidePopover()
    }
  }
</script>

<svelte:window
  onpointermove={transfer.moveTouch}
  onpointerup={transfer.finishTouch}
  onpointercancel={transfer.cancelTouch}
  onblur={transfer.blur}
  onresize={() => transfer.end()}
  onclickcapture={transfer.click}
  ondragend={() => transfer.end()}
/>
<svelte:document
  onvisibilitychange={() => {
    if (document.hidden) transfer.end()
  }}
  onfocusin={interact}
  onpointerdowncapture={(event) => transfer.pointer(event)}
  onpointermove={(event) => {
    if (event.pointerType === "mouse") {
      interaction.pointerX = event.clientX
      if (event.movementX || event.movementY) interaction.usingKeyboard = false
    }
  }}
  onpointerdown={(event) => {
    interaction.touchPointer = event.pointerType === "touch" || event.pointerType === "pen"
    const element = event.target instanceof Element ? event.target : null
    if (!element?.closest(".page-image")) editing.selection.resetPointer()
    if (event.pointerType === "mouse") interaction.pointerX = event.clientX
    interaction.usingKeyboard = false
    interact(event)
    if (!element?.closest(".page-origin")) editing.originOpen = undefined
    if (inputViews.menu && !inputViews.menu.contains(event.target as Node)) inputViews.menu.open = false
    if (outputView.menu && !outputView.menu.contains(event.target as Node)) outputView.menu.open = false
  }}
/>

{#snippet outputName(menu = false)}
  {#if menu}
    <div class="entry output-filename">
      <input
        aria-label="Output filename"
        value={filename || suggestFilename()}
        onchange={(event) => {
          const name = event.currentTarget.value
          const failure = filenameError(name)
          if (failure) {
            error(failure)
            event.currentTarget.value = filename || suggestFilename()
            return
          }
          setFilename(normalizeFilename(name, ".pdf"))
        }}
      />
      <button
        class="icon-button"
        aria-haspopup="dialog"
        aria-label="Set Output filename"
        title="Output details"
        onclick={(event) => rename(closeDocument() ?? event.currentTarget)}><Icon name="next" /></button
      >
    </div>
  {:else}
    <button
      class="output-name"
      aria-label="Set Output filename"
      aria-haspopup="dialog"
      title={filename ? `Output filename · ${filename}` : "Set Output filename"}
      onclick={(event) => rename(closeDocument() ?? event.currentTarget)}
      ><Icon name="output" /><span>Output</span><Icon name="next" /></button
    >
  {/if}
{/snippet}

{#snippet recipeAction(menu = false)}
  <button
    class="icon-button recipe-action"
    aria-label="Export recipe"
    title={downloadError ?? "Export recipe"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    onclick={() => {
      closeDocument()
      recipe()
    }}
    ><Icon name="json" />{#if menu}<span>Export recipe</span>{/if}</button
  >
{/snippet}

{#snippet printAction(menu = false)}
  <button
    class="icon-button print-action"
    aria-label="Print PDF"
    title={downloadError ?? "Print Output PDF"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    onclick={() => {
      closeDocument()
      print()
    }}
    ><Icon name="print" />{#if menu}<span>Print PDF</span>{/if}</button
  >
{/snippet}

{#snippet viewAction(menu = false)}
  <button
    class="icon-button view-action"
    aria-label="View PDF"
    title={downloadError ?? "View Output PDF"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    onclick={() => {
      closeDocument()
      viewPDF()
    }}
    ><Icon name="eye" />{#if menu}<span>View PDF</span>{/if}</button
  >
{/snippet}

{#snippet saveOutput()}
  <button
    class={{ primary: true, "share-action": sharing }}
    aria-label={sharing ? "Share" : "Download"}
    disabled={!output.pages.length || outputProcessing || !!downloadError}
    title={downloadError ?? (sharing ? "Share" : "Download")}
    aria-describedby={downloadError ? `${key}-download-error` : undefined}
    onclick={download}><Icon name={sharing ? "share" : "down"} /><span>{sharing ? "Share" : "Download"}</span></button
  >
{/snippet}

<div
  class="composer"
  data-compact={compact || undefined}
  style:--page-heading-height={frameHeadingHeight ? `${frameHeadingHeight + 1}px` : undefined}
  data-view={interaction.activeView}
  data-drag={transfer.value?.kind}
  data-touch={interaction.touchPointer || undefined}
  data-touch-drag={transfer.touching || undefined}
  data-keyboard={interaction.usingKeyboard}
  inert={opening}
  aria-busy={opening}
  {@attach transfer.track}
  {@attach layout}
>
  <WorkspaceBar
    {key}
    {compact}
    {source}
    {output}
    {editing}
    {interaction}
    {transfer}
    {tour}
    {downloadError}
    bind:inputTarget
    bind:outputTarget
    bind:documentMenu
    onSwitch={switchPane}
    {closeDocument}
    {inputChoices}
    {openPDF}
    {outputName}
    {viewAction}
    {printAction}
    {recipeAction}
    {saveOutput}
  />
  {#if compact && downloadError}<span hidden id={`${key}-download-error`}>{downloadError}</span>{/if}
  <div class="composition-panels">
    <InputPane
      {key}
      {compact}
      {source}
      {styleable}
      {styling}
      {input}
      {viewInputPDF}
      view={inputViews}
      {output}
      {editing}
      {interaction}
      {transfer}
      {tour}
      {opening}
      {magnification}
      {error}
      {peeks}
    />

    <OutputPane
      bind:this={outputPane}
      {key}
      {compact}
      {output}
      {sources}
      view={outputView}
      inputs={inputViews}
      {inspection}
      {editing}
      {interaction}
      {transfer}
      {tour}
      {opening}
      {magnification}
      {error}
      {peeks}
      {downloadError}
      {outputName}
    >
      {#snippet documentActions()}
        {@render recipeAction()}{@render printAction()}{@render viewAction()}{@render saveOutput()}
      {/snippet}
    </OutputPane>
  </div>
</div>
