<!-- Renders the Output pane and owns its view navigation and edit focus. -->

<script lang="ts">
  import { MediaQuery } from "svelte/reactivity"
  import type { Snippet } from "svelte"
  import { sizeOf } from "./model.ts"
  import type { Content, Expanded, Source } from "./model.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Output } from "./output.svelte.ts"
  import type { OutputView, InputViews } from "./pane.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { Magnification } from "./Lens.svelte"
  import type { TourStep } from "./Tour.svelte"
  import { projection, sectionsAt, titlesOf } from "./outline.ts"
  import { outputSections, sectionsOf, Sections } from "./sections.ts"
  import Icon from "./Icon.svelte"
  import Origin from "./Origin.svelte"
  import PageView from "./Page.svelte"
  import type { Inspection } from "./Page.svelte"
  import Peek from "./Peek.svelte"
  import type { Peeks } from "./Peek.svelte"
  import Pdf from "./Pdf.svelte"
  import Face from "./Face.svelte"
  import SectionPath from "./SectionPath.svelte"
  import PageControls from "./PageControls.svelte"
  import Toolbar from "./Toolbar.svelte"
  import Summary from "./Summary.svelte"
  import Occurrence from "./Occurrence.svelte"
  import OutputCollection from "./OutputCollection.svelte"
  import OutputSelection from "./OutputSelection.svelte"

  let {
    key,
    compact,
    output,
    sources,
    view,
    inputs,
    inspection,
    editing,
    interaction,
    transfer,
    tour,
    opening,
    magnification,
    error,
    peeks,
    downloadError,
    outputName,
    documentActions,
  }: {
    key: string
    compact: boolean
    output: Output
    sources: readonly Source[]
    view: OutputView
    inputs: InputViews
    inspection?: Inspection
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    tour?: TourStep
    opening: boolean
    magnification: Magnification
    error: (message: string) => void
    peeks: Peeks
    downloadError?: string
    outputName: Snippet<[menu?: boolean]>
    documentActions: Snippet
  } = $props()

  const narrow = new MediaQuery("(width <= 30rem)")
  const chosen = $derived(output.selected)
  const selectedIds = $derived(output.selection)
  const inspected = $derived(editing.inspected)
  const showComparison = $derived(inspection?.kind === "pdf" && !!inspection.comparison?.enabled)
  const comparing = $derived(compact ? editing.comparing : undefined)
  const feedback = $derived(editing.feedback)
  const pendingAddition = $derived(feedback.pending)
  const removingPage = $derived(feedback.page.size > 0)
  const project = projection()
  const navigation = $derived(project(output.pages, sources))
  const outline = $derived(navigation.outline)
  const firstSource = $derived(output.pages.find(({ content }) => "source" in content)?.content)
  const tree = $derived(
    outline
      ? sectionsOf(outline, (page) => output.pages[page].id)
      : outputSections(
          output.pages,
          firstSource && "source" in firstSource
            ? navigation.sources.find(({ id }) => id === firstSource.source)
            : undefined,
        ),
  )
  const emptyTree = sectionsOf()
  const outputProjection = $derived(new Sections(view.grouped ? tree : emptyTree, output.pages.length, view.folds))
  const outputSectionState = $derived(view.sectionView ? outputProjection.state() : "none")
  const tocTitlesRevision = $derived(sources.map(({ id }) => inputs.titles(id)).join(","))
  const revision = $derived({ pages: output.pages, grouped: view.grouped, titles: tocTitlesRevision })
  const sourcesById = $derived(new Map(sources.map((source) => [source.id, source])))
  const labels = $derived(
    output.pages.map(({ content }) =>
      "source" in content ? (sourcesById.get(content.source)?.input.labels[content.page] ?? "") : "",
    ),
  )

  function outputPaths(content: Content, index: number) {
    const sectionView = view.sectionView
    if (!view.grouped || !sectionView) return []
    if (outline) return sectionsAt(outline, index).map(({ keys }) => sectionView.paths(index, keys))
    if (!("source" in content)) return []
    const source = sourcesById.get(content.source)
    return source
      ? titlesOf(source.input)
          .at(content.page)
          .headings.map(({ keys }) =>
            sectionView.paths(
              index,
              keys.map((node) => content.source + ":" + node),
            ),
          )
      : []
  }

  function comparePage(menu = false) {
    if (compact) editing.comparing = !editing.comparing
    else editing.showOriginal()
    if (menu && view.menu) {
      view.menu.open = false
      view.menu.querySelector("summary")?.focus({ preventScroll: true })
    }
  }

  export function focusedRange(control: HTMLElement) {
    const row = control.closest<HTMLElement>(".composition-card, .list-row, .list-section")
    if (!row || !view.panel?.contains(row)) return
    const { index, sectionEnd } = row.dataset
    return { first: Number(index), end: sectionEnd === undefined ? undefined : Number(sectionEnd) }
  }
</script>

{#snippet outputOrigin(page: Expanded, index: number, total?: number)}
  {@const origin = editing.provenance(page.content)}
  <Origin
    id={total === undefined ? `${key}-output-menu-${page.id}` : `${key}-output-counter`}
    pane="Output"
    number={total === undefined ? transfer.number(index) : index + 1}
    count={total}
    identity={origin && "page" in page.content
      ? { source: origin, page: page.content.page, tocTitles: inputs.titles(origin.id) }
      : { blank: sizeOf(page.content, sources), padding: page.padding }}
    multiple={!!outline}
    mode={view.active === "list" ? "list" : "normal"}
    bind:opened={editing.originOpen}
  >
    {#snippet navigation()}
      {@const paths = outputPaths(page.content, index)}
      {#if paths.some((path) => path.length)}
        <div class="page-detail-navigation">
          <SectionPath
            id={`${key}-output-page-${index}-jump`}
            pane="Output"
            {paths}
            {output}
            jump={(sectionId) => {
              editing.originOpen = undefined
              void view.sectionView?.revealSection(sectionId)
            }}
          />
        </div>
      {/if}
    {/snippet}
  </Origin>
{/snippet}

{#snippet outputPeek(page: Expanded, index: number)}
  {@const origin = editing.provenance(page.content)}
  <Peek
    id={`${key}-peek-output-${page.id}`}
    pane="Output"
    number={index + 1}
    name={editing.pageName(page.content) ??
      ("blank" in page.content ? (page.padding ? "Padding" : "Blank") : undefined)}
    size={sizeOf(page.content, sources)}
    enabled={!transfer.value && !editing.originOpen}
    owner={peeks}
    open={(event) => {
      output.position = index
      void interaction.toggleView("Output", event)
    }}
  >
    {#if origin && "page" in page.content}
      <Pdf
        {...origin.preview.appearance(page.content.page)}
        pageNumber={page.content.page + 1}
        size={origin.input.sizes[page.content.page]}
        thumbnail
        {error}
      />
    {:else}<div class="composition-blank">
        <Icon name="blank" /><span>{page.padding ? "Padding" : "Blank"}</span>
      </div>{/if}
  </Peek>
{/snippet}

{#snippet occurrenceActions(page: Expanded, index: number, controls: boolean, end = index + 1)}
  <Occurrence
    {key}
    {page}
    {index}
    {end}
    total={output.pages.length}
    active={view.active}
    narrow={narrow.current}
    {controls}
    enabled={!!editing.outputTargets({ kind: "individual", first: index, end }).length}
    onEdit={(action, target) => editing.commandOutput(action, target)}
  />
{/snippet}

{#snippet outputPageHeading(fitWidth: () => void)}
  <span class="page-number">
    {#if inspected}
      {@render outputOrigin(inspected, output.position, output.pages.length)}
    {/if}
  </span>
  <PageControls
    pane="Output"
    zoom={view.zoom}
    {comparing}
    {showComparison}
    onCompare={() => comparePage()}
    onZoomBy={(offset) => interaction.zoomBy("Output", offset)}
    onResetZoom={() => interaction.setZoom("Output", 100)}
    onFitWidth={fitWidth}
  />
  <Face index={output.position} />
{/snippet}

{#snippet outputPageActions()}
  {#if inspected}
    {@render occurrenceActions(inspected, output.position, true)}
  {/if}
{/snippet}

<section
  class="composition-output"
  data-preview={transfer.preview || (view.active === "list" && transfer.destination !== undefined) ? true : undefined}
  aria-labelledby={`${key}-${compact ? "output-switch" : "output"}`}
  data-drop={transfer.value && transfer.target.kind === "append" ? "end" : undefined}
  ondragover={(event) => transfer.over(event)}
  ondragleave={transfer.leaveOutput}
  ondrop={(event) => transfer.drop(event)}
>
  {#if !compact}<div class="section-heading">
      <div>
        <h2 id={`${key}-output`} aria-label="Output">
          {@render outputName()}
        </h2>
      </div>
      <Summary id={`${key}-output-summary`} pane="Output" pages={output.pages.length} />
      <div class="output-actions" data-tour-target="download" data-tour-active={tour === "download"}>
        {@render documentActions()}
      </div>
      {#if downloadError}<span hidden id={`${key}-download-error`}>{downloadError}</span>{/if}
    </div>{/if}

  <Toolbar
    {key}
    pane="Output"
    active={view.active}
    panelId={`${key}-output-panel`}
    className="output-tabs"
    {tour}
    sectionState={outputSectionState}
    hasSections={tree.nodes.size > 0}
    grouped={view.grouped}
    count={output.pages.length}
    position={output.position}
    {labels}
    onTab={(tab) => interaction.setOutputTab(tab)}
    onTabKey={(event) => interaction.tabKey(event, "Output")}
    onToggleSections={() => view.sectionView?.toggleSections()}
    onToggleGrouped={() => {
      view.grouped = !view.grouped
      void view.reveal()
    }}
    onJump={(position, event) => void view.goTo(position, event)}
  />

  <div
    class="output-panel"
    bind:this={view.panel}
    data-tour-target={`output-${view.active}`}
    data-tour-active={tour?.startsWith("output-")}
    id={`${key}-output-panel`}
    role="tabpanel"
    aria-labelledby={`${key}-output-${view.active}`}
  >
    <OutputSelection
      {key}
      {output}
      {view}
      {editing}
      {interaction}
      {transfer}
      {tour}
      {showComparison}
      {comparing}
      onCompare={comparePage}
    />
    <div class="page-content">
      {#if view.active === "page"}
        <div
          class="inspection-target"
          data-adding={(inspected && pendingAddition.has(inspected.id)) || undefined}
          data-removing={removingPage || undefined}
          role="group"
          aria-label="Output page drop target"
          data-drop={!transfer.blocked && transfer.targetIndex === output.position
            ? transfer.targetAfter
              ? "after"
              : "before"
            : undefined}
          ondragover={(event) => transfer.over(event, output.position)}
          ondrop={transfer.drop}
        >
          <PageView
            bind:this={view.page}
            count={output.pages.length}
            sheet={inspection}
            name={inspected ? editing.pageName(inspected.content) : undefined}
            bind:headingHeight={() => view.headingHeight, (height) => (view.headingHeight = height)}
            bind:controls={() => view.controls, (controls) => (view.controls = controls)}
            initialize={!opening && !view.pageInitialized ? (zoom) => view.setZoom(zoom) : undefined}
            bind:position={() => output.position, (position) => (output.position = position)}
            bind:zoom={() => view.zoom, (zoom) => view.setZoom(zoom)}
            {comparing}
            bind:region={() => view.region, (region) => (view.region = region)}
            heading={inspected ? outputPageHeading : undefined}
            actions={inspected && !chosen.length ? outputPageActions : undefined}
            copyable={!editing.selection.outputSelectionError}
            grid={(event) => void interaction.toggleView("Output", event)}
            selected={!!inspected && selectedIds.has(inspected.id)}
            navigationOver={transfer.navigate}
            navigationLeave={transfer.leave}
            {error}
            {magnification}
          />
          {#if !transfer.blocked && transfer.targetIndex === output.position}
            <div class="page-drop-ghost" aria-hidden="true">
              <canvas width="0" height="0" {@attach transfer.ghost}></canvas>
            </div>
          {/if}
        </div>
      {:else}
        <OutputCollection
          {key}
          {output}
          {sources}
          {view}
          {editing}
          {interaction}
          {transfer}
          {outputProjection}
          hasOutline={!!outline}
          {revision}
          {magnification}
          {error}
          origin={outputOrigin}
          peek={outputPeek}
          occurrence={occurrenceActions}
        />
      {/if}
    </div>
  </div>
</section>
