<!-- Renders the Output pane and owns its view navigation and edit focus. -->

<script lang="ts">
  import { MediaQuery } from "svelte/reactivity"
  import type { Snippet } from "svelte"
  import { sizeOf } from "./model.ts"
  import type { Content, Expanded, Source } from "./model.ts"
  import { animateOrder, inert } from "./motion.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Output } from "./output.svelte.ts"
  import type { OutputView, InputViews } from "./pane.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { Magnification } from "./Lens.svelte"
  import type { TourStep } from "./Tour.svelte"
  import { pageRanges } from "./pages.ts"
  import { projection, sectionsAt, titlesOf } from "./outline.ts"
  import { outputSections, sectionsOf, Sections } from "./sections.ts"
  import type { Section } from "./sections.ts"
  import { retainFocus } from "./drag.ts"
  import Icon from "./Icon.svelte"
  import Selection from "./Selection.svelte"
  import Origin from "./Origin.svelte"
  import Grid from "./Grid.svelte"
  import List from "./List.svelte"
  import Row from "./Row.svelte"
  import PageView, { controlCapabilities } from "./Page.svelte"
  import type { Inspection } from "./Page.svelte"
  import Peek from "./Peek.svelte"
  import type { Peeks } from "./Peek.svelte"
  import Pdf from "./Pdf.svelte"
  import Repetition from "./Repetition.svelte"
  import Face from "./Face.svelte"
  import Ribbon from "./Ribbon.svelte"
  import SectionPath from "./SectionPath.svelte"
  import SectionRow from "./SectionRow.svelte"
  import PageTools from "./PageTools.svelte"
  import Toolbar from "./Toolbar.svelte"
  import Summary from "./Summary.svelte"
  import Grip from "./Grip.svelte"
  import OccurrenceActions from "./OccurrenceActions.svelte"

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
  const feedback = $derived(editing.feedback)
  const pendingAddition = $derived(feedback.pending)
  const arriving = $derived(feedback.arriving)
  const removing = $derived(feedback.removing)
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
  const listPreview = $derived(view.active === "list" && transfer.destination !== undefined)
  const skippedRows = $derived(
    listPreview && transfer.value?.kind === "output"
      ? new Set(transfer.value.ids.map((id) => output.positions.get(id)!))
      : undefined,
  )
  const retainedRow = $derived(
    transfer.value?.kind === "output" ? output.positions.get(transfer.value.ids[0]) : undefined,
  )
  const labels = $derived(
    output.pages.map(({ content }) =>
      "source" in content ? (editing.provenance(content)?.input.labels[content.page] ?? "") : "",
    ),
  )

  $effect.pre(() => {
    if (view.active !== "list") return
    const destination = transfer.destination
    const list = view.panel?.querySelector<HTMLElement>(".page-list")
    if (!list) return
    const previous = feedback.move
    feedback.move = animateOrder(list, destination === undefined ? 240 : 180, destination === undefined)
    previous?.()
  })

  function outputPaths(content: Content, index: number) {
    const sectionView = view.sectionView
    if (!view.grouped || !sectionView) return []
    if (outline) return sectionsAt(outline, index).map(({ keys }) => sectionView.paths(index, keys))
    if (!("source" in content)) return []
    const source = editing.provenance(content)
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

  function toggleCompare(menu = false) {
    editing.comparing = !editing.comparing
    if (menu && view.menu) {
      view.menu.open = false
      view.menu.querySelector("summary")?.focus({ preventScroll: true })
    }
  }

  function removal(node: HTMLElement) {
    return editing.removal(node)
  }

  export function focusedRange(control: HTMLElement) {
    const row = control.closest<HTMLElement>(".composition-card, .list-row, .list-section")
    if (!row || !view.panel?.contains(row)) return
    const { index, sectionEnd } = row.dataset
    return { first: Number(index), end: sectionEnd === undefined ? undefined : Number(sectionEnd) }
  }
</script>

{#snippet dropPreview(after: boolean)}
  <div
    class="list-drop-preview"
    data-drop={after ? "after" : "before"}
    aria-hidden="true"
    style:--drop-height={`${transfer.stripHeight}px`}
  >
    <strong class="drop-number">{transfer.destination! + 1}</strong>
    <span class="drop-name">{editing.transferName()}</span>{#if transfer.quantity > 1}<span>×{transfer.quantity}</span
      >{/if}
  </div>
{/snippet}

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
      <Pdf {...origin.preview.appearance(page.content.page)} pageNumber={page.content.page + 1} thumbnail {error} />
    {:else}<div class="composition-blank">
        <Icon name="blank" /><span>{page.padding ? "Padding" : "Blank"}</span>
      </div>{/if}
  </Peek>
{/snippet}

{#snippet outputGridHeading(
  page: Expanded,
  index: number,
  section: Section | undefined,
  folded: ReadonlySet<string>,
  fold: (key: string) => void,
)}
  {@render outputOrigin(page, index)}
  {#if section}
    <Ribbon
      {key}
      pane="Output"
      {section}
      folded={folded.has(section.key)}
      payload={{ kind: "output", ids: editing.outputRange(section.start, section.end) }}
      {transfer}
      start={editing.start}
      {fold}
    />
  {:else}<Grip
      pane="Output"
      number={index + 1}
      selected={selectedIds.has(page.id)}
      payload={{ kind: "output", ids: [page.id] }}
      {transfer}
      start={editing.start}
      onToggle={(shiftKey, control) => {
        editing.selectOutput(page.id, shiftKey)
        interaction.focusPage(control)
      }}
    />{/if}
  <Face index={transfer.number(index) - 1} />
{/snippet}

{#snippet occurrenceActions(page: Expanded, index: number, controls: boolean, end = index + 1)}
  <OccurrenceActions
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
  <PageTools
    pane="Output"
    zoom={view.zoom}
    comparing={editing.comparing}
    {inspection}
    onCompare={() => toggleCompare()}
    onOriginal={editing.showOriginal}
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

{#snippet outputMoves(inline = false)}
  {#if chosen.length || tour === "output-selection"}<button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages earlier"
      title={`Move selected pages earlier · Ctrl/⌘+${view.active === "list" ? "↑" : "←"}`}
      disabled={!chosen.length || !!editing.outputSelectionError || editing.positions[0] === 0}
      onclick={() => editing.commandOutput("earlier")}
      ><Icon name={view.active === "list" ? "move-up" : "earlier"} />{#if !inline}Earlier{/if}</button
    >
    <button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages later"
      title={`Move selected pages later · Ctrl/⌘+${view.active === "list" ? "↓" : "→"}`}
      disabled={!chosen.length ||
        !!editing.outputSelectionError ||
        editing.positions.at(-1) === output.pages.length - 1}
      onclick={() => editing.commandOutput("later")}
      ><Icon name={view.active === "list" ? "move-down" : "later"} />{#if !inline}Later{/if}</button
    >{/if}
{/snippet}

{#snippet outputTools()}
  <details class="sequence-options output-options" bind:this={view.menu}>
    <summary id={`${key}-output-actions`} aria-label="Output page actions" title="Output page actions"
      ><Icon name="more" /></summary
    >
    <div class="menu-options">
      <div class="selected-actions">
        {#if view.active === "page"}
          <PageTools
            pane="Output"
            menu
            zoom={view.zoom}
            showComparison={!controlCapabilities[view.controls].comparison}
            showZoom={!controlCapabilities[view.controls].zoom}
            showFit={!controlCapabilities[view.controls].fit}
            comparing={editing.comparing}
            {inspection}
            onCompare={() => toggleCompare(true)}
            onOriginal={editing.showOriginal}
            onZoomBy={(offset) => interaction.zoomBy("Output", offset)}
            onResetZoom={() => interaction.setZoom("Output", 100)}
            onFitWidth={() => view.page?.fitWidth()}
          />
        {/if}
        <div class="menu-moves">{@render outputMoves()}</div>
        {#if chosen.length}<button
            disabled={!!editing.outputSelectionError}
            onclick={() => editing.blank(editing.positions[0])}
            title="Insert a blank before the first selected page">Before</button
          >{/if}
        <button
          disabled={!output.pages.length}
          onclick={() => editing.blank(output.position + 1)}
          title="Insert a blank page after the current Output page"><Icon name="blank-after" />Blank after this</button
        >
        <button
          disabled={!output.pages.length}
          onclick={() => editing.blank(output.pages.length)}
          title="Insert a blank page after the last Output page"><Icon name="blank-last" />Blank after last</button
        >
      </div>
      {#if chosen.length && editing.adjacent}
        <Repetition pane="Output" bind:value={editing.repetitions} bind:front={editing.front} />
        {#if Number(editing.repetitions) !== 1 || editing.front}<button
            disabled={!!editing.repeatError || !!editing.outputSelectionError}
            onclick={editing.repeat}>Repeat</button
          >{/if}
      {:else if chosen.length}<p>Select consecutive pages to repeat a sequence.</p>{/if}
    </div>
  </details>
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
    <Selection
      id={`${key}-output-selection`}
      pane="Output"
      value={editing.outputText ?? pageRanges(editing.positions)}
      invalid={!!editing.outputSelectionError}
      error={editing.outputSelectionError}
      disabled={!output.pages.length}
      change={editing.outputNumbers}
      submit={() => editing.commandOutput("remove")}
      hiddenHint={!!transfer.value}
      highlight={editing.highlight?.kind === "output" ? (editing.highlight.removing ? "remove" : "range") : undefined}
      tour={tour === "output-selection"}
    >
      {#snippet menu()}
        {#if output.pages.length || tour === "output-selection"}{@render outputTools()}{/if}
      {/snippet}
      {#snippet actions()}
        {#if output.pages.length && (editing.positions.length < output.pages.length || editing.outputSelectionError)}<button
            class="step"
            aria-label="Select all"
            title="Select all · Ctrl+A / ⌘A"
            aria-keyshortcuts="Control+A Meta+A"
            onclick={(event) => {
              editing.selectAll("Output")
              interaction.focusAfterSelection("Output", event)
            }}><Icon name="select" /></button
          >{/if}
        {#if chosen.length || editing.outputText}<button
            class="reset"
            aria-label="Clear Output selection"
            title="Clear selection to use page actions"
            onclick={(event) => {
              editing.clearOutput()
              interaction.focusAfterSelection("Output", event)
            }}><Icon name="close" /></button
          >{/if}
        {#if chosen.length || tour === "output-selection"}
          <div class="output-selection" role="group" aria-label="Selected Output pages">
            <div class="inline-moves">{@render outputMoves(true)}</div>
            <button
              class="step danger"
              aria-label="Remove selected Output pages"
              title="Remove selected pages · Delete"
              disabled={!chosen.length || !!editing.outputSelectionError}
              onclick={() => editing.commandOutput("remove")}><Icon name="remove" /></button
            ><button
              class="step primary"
              aria-label="Duplicate selected Output pages"
              title="Add one copy of the selected pages."
              disabled={!chosen.length || !!editing.outputSelectionError}
              onclick={() => editing.commandOutput("duplicate")}><Icon name="add" /></button
            >
          </div>
        {/if}
      {/snippet}
      {#snippet hint()}
        {#if chosen.length}<strong>{chosen.length} {chosen.length === 1 ? "page" : "pages"} selected</strong> · Use the selection
          bar.{:else if view.active === "page"}Select in Grid or type numbers.{:else}Select pages or type numbers.{/if}
      {/snippet}
      {#snippet feedback()}
        {#if transfer.value}<span class="drag-status"
            ><strong
              >{transfer.value.kind === "output"
                ? transfer.value.ids.length === 1
                  ? "Move this page"
                  : `Move ${transfer.value.ids.length} pages`
                : transfer.value.choice.kind === "preparation"
                  ? "Add sequence"
                  : transfer.value.choice.kind === "pages"
                    ? `Add ${transfer.value.choice.pages.length} pages`
                    : `Add Input page ${transfer.value.choice.page + 1}`}</strong
            >
            <span class="drop-description">
              · {transfer.blocked
                ? "Drop outside the selection."
                : transfer.inside
                  ? `Release · ${transfer.label}`
                  : "Drag into Output"}</span
            >
          </span>{/if}
      {/snippet}
    </Selection>
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
            bind:comparing={editing.comparing}
            bind:region={() => view.region, (region) => (view.region = region)}
            heading={inspected ? outputPageHeading : undefined}
            actions={inspected && !chosen.length ? outputPageActions : undefined}
            copyable={!editing.outputSelectionError}
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
      {:else if view.active === "list" && output.pages.length}
        <List
          viewport={view.listViewport}
          bind:this={view.list}
          sections={outputProjection}
          onfold={(folds) => (view.folds = folds)}
          pane="Output"
          active={() => interaction.shortcutPane() === "Output"}
          {revision}
          selected={(first, end) => editing.selectedSection("Output", first, end)}
          identity={(index) => output.pages[index].id}
          rowId={(index) => `${key}-${output.pages[index].id}`}
          pending={pendingAddition}
          removal={editing.removal}
          skipped={skippedRows}
          retained={retainedRow}
          bind:position={() => output.position, (position) => (output.position = position)}
          select={(index, range, anchor, sectionEnd) =>
            sectionEnd === undefined
              ? editing.selectOutput(
                  output.pages[index].id,
                  range,
                  anchor === undefined ? undefined : output.pages[anchor].id,
                )
              : editing.selectSection("Output", index, sectionEnd)}
          edit={(action, first, end) =>
            action !== "add" && editing.commandOutput(action, { kind: "focused", first, end })}
        >
          {#snippet section(start, end, path, expanded, toggle, id)}
            <SectionRow
              {key}
              pane="Output"
              first={start}
              {end}
              {path}
              labels={outline && path.length > 1 ? path.slice(1) : path}
              {expanded}
              selected={expanded
                ? selectedIds.has(output.pages[start].id)
                : editing.selectedSection("Output", start, end)}
              {id}
              payload={{ kind: "output", ids: editing.outputRange(start, end) }}
              {transfer}
              touch={interaction.touchPointer}
              start={editing.start}
              {toggle}
              select={(event) => editing.activateOutput(start, event, expanded ? start + 1 : end)}
              open={(event) => {
                output.position = start
                void interaction.toggleView("Output", event)
              }}
              {dropPreview}
            >
              {#snippet origin()}{@render outputOrigin(output.pages[start], start)}{/snippet}
              {#snippet actions()}
                {@render occurrenceActions(output.pages[start], start, true, end)}
                {@render outputPeek(output.pages[start], start)}
              {/snippet}
            </SectionRow>
          {/snippet}
          {#snippet children(index, retained)}
            {@const page = output.pages[index]}
            {@const dropHere =
              !transfer.blocked &&
              transfer.inside &&
              (transfer.targetIndex === index ||
                (transfer.target.kind === "append" && index === output.pages.length - 1))}
            {@const dropAfter = transfer.targetAfter || transfer.target.kind === "append"}
            <li
              id={`${key}-${page.id}`}
              class="list-row"
              aria-setsize={output.pages.length}
              aria-posinset={index + 1}
              data-retained={index === retained || undefined}
              data-returning={(interaction.returning?.kind === "output" && interaction.returning.id === page.id) ||
                undefined}
              class:range-highlight={editing.highlight?.kind === "output" && editing.highlight.ids.has(page.id)}
              data-index={index}
              class:selected={selectedIds.has(page.id)}
              data-dragging={transfer.moving(page.id) || undefined}
              data-drop={dropHere ? (dropAfter ? "after" : "before") : undefined}
              data-arriving={arriving.has(page.id) || undefined}
              data-adding={pendingAddition.has(page.id) || undefined}
              style:--drop-height={`${transfer.stripHeight}px`}
              onanimationend={(event) => {
                if (event.target === event.currentTarget && event.animationName === "row-enter")
                  arriving.delete(page.id)
              }}
              out:removal|global
              ondragover={(event) => transfer.over(event, index)}
              ondrop={(event) => transfer.drop(event)}
            >
              {#if dropHere}
                {@render dropPreview(dropAfter)}
              {/if}
              <Row
                pane="Output"
                number={index + 1}
                {index}
                name={editing.pageName(page.content)}
                label={editing.pageName(page.content) ??
                  ("blank" in page.content ? (page.padding ? "Padding" : "Blank") : `Page ${page.content.page + 1}`)}
                selected={selectedIds.has(page.id)}
                touch={interaction.touchPointer}
                {transfer}
                payload={{ kind: "output", ids: [page.id] }}
                start={editing.start}
                inspect={() => (output.position = index)}
                toggle={(range) => editing.selectOutput(page.id, range)}
                select={(event) => editing.activateOutput(index, event)}
                open={(event) => void interaction.toggleView("Output", event)}
              >
                {#snippet origin()}{@render outputOrigin(page, index)}{/snippet}
                {#snippet actions()}{@render occurrenceActions(page, index, true)}{/snippet}
                {#snippet preview()}{@render outputPeek(page, index)}{/snippet}
              </Row>
            </li>
          {/snippet}
        </List>
      {:else}
        {#if output.pages.length}
          <Grid
            bind:this={view.grid}
            viewport={view.gridViewport}
            pane="Output"
            active={() => interaction.shortcutPane() === "Output"}
            sections={outputProjection}
            onfold={(folds) => (view.folds = folds)}
            bind:position={() => output.position, (position) => (output.position = position)}
            bind:offset={() => view.offset, (offset) => (view.offset = offset)}
            bind:keyboard={() => interaction.usingKeyboard, (keyboard) => (interaction.usingKeyboard = keyboard)}
            selected={(position) => selectedIds.has(output.pages[position]?.id)}
            toggle={(position) => editing.selectOutput(output.pages[position].id, false)}
            edit={(action, first, end) =>
              action !== "add" &&
              editing.commandOutput(action, first === undefined ? undefined : { kind: "focused", first, end })}
          >
            {#snippet children(pages, headings, fold, folded)}
              {#each pages as index, offset (output.pages[index].id)}
                {@const page = output.pages[index]}
                {@const section = headings.get(index)}
                {@const origin = editing.provenance(page.content)}
                {@const place = transfer.preview?.positions.get(index)}
                <li
                  id={`${key}-${page.id}`}
                  data-index={index}
                  data-section-end={section && folded.has(section.key) ? section.end : undefined}
                  data-adding={pendingAddition.has(page.id) || undefined}
                  {@attach pendingAddition.has(page.id) && inert}
                  class={[
                    "composition-card",
                    {
                      selected:
                        section && folded.has(section.key)
                          ? editing.selectedSection("Output", section.start, section.end)
                          : selectedIds.has(page.id),
                      "grid-section-card": !!section,
                      "grid-section-open": !!section && !folded.has(section.key),
                    },
                  ]}
                  data-returning={(interaction.returning?.kind === "output" && interaction.returning.id === page.id) ||
                    undefined}
                  class:range-highlight={editing.highlight?.kind === "output" && editing.highlight.ids.has(page.id)}
                  out:removal|global
                  onoutroend={(event) => {
                    const grid = event.currentTarget.parentElement
                    // The row's reactive scope is already destroyed when its outro finishes.
                    const id = event.currentTarget.id.slice(key.length + 1)
                    if (grid && removing.has(id) && !feedback.move) feedback.move = animateOrder(grid, 350)
                  }}
                  data-face={transfer.number(index) % 2 === 1 ? "front" : "back"}
                  data-dragging={transfer.moving(page.id) || undefined}
                  data-preview-hidden={transfer.preview && (place === undefined || place >= transfer.grid!.limit)
                    ? true
                    : undefined}
                  style:translate={place === undefined ? undefined : transfer.displacement(place, offset)}
                  data-drop={!transfer.blocked && transfer.targetIndex === index
                    ? transfer.targetAfter
                      ? "after"
                      : "before"
                    : undefined}
                  ondragover={(event) => transfer.over(event, index)}
                  ondrop={(event) => transfer.drop(event)}
                >
                  <div class="page-label">
                    {@render outputGridHeading(page, index, section, folded, fold)}
                    <button
                      class="icon-button grid-inspect"
                      type="button"
                      aria-label={`View Output page ${index + 1}`}
                      title="View page"
                      onclick={(event) => {
                        output.position = index
                        void interaction.toggleView("Output", event)
                      }}><Icon name="eye" /></button
                    >
                  </div>
                  <button
                    class="page-image"
                    data-page={index}
                    aria-label={section && folded.has(section.key)
                      ? `Select Output section ${section.path.join(" › ")}: pages ${section.start + 1}–${section.end}`
                      : `Select Output page ${index + 1}`}
                    aria-pressed={section && folded.has(section.key)
                      ? editing.selectedSection("Output", section.start, section.end)
                      : selectedIds.has(page.id)}
                    title={section && folded.has(section.key)
                      ? "Select or unselect the entire folded section."
                      : "Select pages to edit Output."}
                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Plus - Delete"
                    draggable="true"
                    onmousedown={retainFocus}
                    onclick={(event) => {
                      editing.activateOutput(index, event, section && folded.has(section.key) ? section.end : undefined)
                      if (event.detail) event.currentTarget.focus({ preventScroll: true })
                    }}
                    ondragstart={(event) => editing.start(event, { kind: "output", ids: [page.id] })}
                    ondragend={() => transfer.end()}
                  >
                    {#if origin && "page" in page.content}<Pdf
                        {...origin.preview.appearance(page.content.page)}
                        pageNumber={page.content.page + 1}
                        name={editing.pageName(page.content)}
                        thumbnail
                        {magnification}
                        {error}
                      />{:else}<div class="thumbnail">
                        <div
                          class="composition-blank"
                          style:--ratio={sizeOf(page.content, sources).width / sizeOf(page.content, sources).height}
                        >
                          <Icon name="blank" /><span>{page.padding ? "Padding" : "Blank"}</span>
                        </div>
                      </div>{/if}
                  </button>

                  {@render occurrenceActions(page, index, !chosen.length, section?.end)}
                </li>
              {/each}
              {#if transfer.preview && transfer.grid && transfer.preview.slot < transfer.grid.limit}
                <li
                  class="drop-placeholder"
                  aria-hidden="true"
                  style:inline-size={`${transfer.grid.width}px`}
                  style:block-size={`${transfer.grid.height}px`}
                  style:translate={transfer.displacement(transfer.preview.slot)}
                >
                  <strong class="drop-number">{transfer.destination! + 1}</strong>
                  <canvas width="0" height="0" {@attach transfer.ghost}></canvas>
                </li>
              {/if}
            {/snippet}
          </Grid>
        {:else}<div class="composition-empty">
            {#if transfer.value && transfer.inside}<div class="drop-placeholder" aria-hidden="true">
                <canvas width="0" height="0" {@attach transfer.ghost}></canvas>
              </div>
            {:else}<Icon name="output" />
              <h3>Your Output starts here.</h3>
              <p>Add pages from Input.</p>{/if}
          </div>{/if}
      {/if}
    </div>
  </div>
</section>
