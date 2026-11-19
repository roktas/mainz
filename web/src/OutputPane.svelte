<!-- Renders the Output pane and owns its view navigation and edit focus. -->

<script module lang="ts">
  export type OutputTarget = { kind: "focused" | "individual"; first: number; end?: number } | { kind: "current" }
  export type OutputAction = "duplicate" | "remove" | "earlier" | "later"
</script>

<script lang="ts">
  import { tick } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import type { Snippet } from "svelte"
  import type { TransitionConfig } from "svelte/transition"
  import { sizeOf } from "./model.ts"
  import type { Content, Expanded, Source } from "./model.ts"
  import { animateOrder, inert } from "./motion.ts"
  import type { Edits } from "./motion.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Output, Edit } from "./output.svelte.ts"
  import type { OutputView, InputViews } from "./pane.svelte.ts"
  import type { Payload, Transfer } from "./transfer.svelte.ts"
  import type { Magnification } from "./Lens.svelte"
  import type { TourStep } from "./Tour.svelte"
  import { viewLabels, viewTabs } from "./pane.svelte.ts"
  import { pageRanges } from "./pages.ts"
  import { projection, sectionsAt, titlesOf } from "./outline.ts"
  import { outputSections, sectionsOf, Sections } from "./sections.ts"
  import type { Section } from "./sections.ts"
  import type { Highlight, PaneSnippets } from "./Composer.svelte"
  import { retainFocus } from "./drag.ts"
  import Icon from "./Icon.svelte"
  import Jump from "./Jump.svelte"
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

  type Actions = {
    numbers: (text: string) => void
    all: () => void
    clear: () => void
    selectedSection: (first: number, end: number) => boolean
    select: (id: string, range: boolean, anchor?: string) => void
    activate: (index: number, event: MouseEvent, end?: number) => (() => void) | undefined
    section: (first: number, end: number) => void
    targets: (target?: OutputTarget) => readonly string[]
    edit: (action: OutputAction, target?: OutputTarget) => boolean
    blank: (at: number) => void
    repeat: () => void
  }
  let {
    key,
    compact,
    output,
    sources,
    view,
    inputs,
    inspection,
    opened: originOpen = $bindable<string>(),
    comparing = $bindable(false),
    outputText,
    outputSelectionError,
    positions,
    adjacent,
    repetitions = $bindable("2"),
    front = $bindable(false),
    repeatError,
    actions: commands,
    interaction,
    transfer,
    start,
    tour,
    opening,
    magnification,
    error,
    peeks,
    highlight,
    feedback,
    removal,
    pageName,
    downloadError,
    snippets,
    outputName,
    documentActions,
    comparisonControls,
    dropPreview,
  }: {
    key: string
    compact: boolean
    output: Output
    sources: readonly Source[]
    view: OutputView
    inputs: InputViews
    inspection?: Inspection
    opened?: string
    comparing?: boolean
    outputText?: string
    outputSelectionError?: string
    positions: readonly number[]
    adjacent: boolean
    repetitions?: string
    front?: boolean
    repeatError?: string
    actions: Actions
    interaction: Interaction
    transfer: Transfer
    start: (event: DragEvent | PointerEvent, payload: Payload) => void
    tour?: TourStep
    opening: boolean
    magnification: Magnification
    error: (message: string) => void
    peeks: Peeks
    highlight?: Highlight
    feedback: Edits
    removal: (node: HTMLElement) => TransitionConfig
    pageName: (content: Content) => string | undefined
    downloadError?: string
    snippets: PaneSnippets
    outputName: Snippet<[menu?: boolean]>
    documentActions: Snippet
    comparisonControls: Snippet<[menu?: boolean]>
    dropPreview: Snippet<[after: boolean]>
  } = $props()
  const {
    summary,
    pageFace,
    pageTools,
    zoomControls,
    zoomReset,
    gridRibbon,
    sectionRow,
    sectionJump,
    counts: outputSummary,
  } = $derived(snippets)
  const narrow = new MediaQuery("(width <= 30rem)")
  const chosen = $derived(output.selected)
  const selectedIds = $derived(output.selection)
  const inspected = $derived(output.pages[output.position])
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
      "source" in content ? (provenance(content)?.input.labels[content.page] ?? "") : "",
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

  function provenance(content: Content) {
    return "source" in content ? sources.find((source) => source.id === content.source) : undefined
  }
  function outputPaths(content: Content, index: number) {
    const sectionView = view.sectionView
    if (!view.grouped || !sectionView) return []
    if (outline) return sectionsAt(outline, index).map(({ keys }) => sectionView.paths(index, keys))
    if (!("source" in content)) return []
    const source = provenance(content)
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
  async function goTo(position: number, event: MouseEvent) {
    output.position = position
    view.offset = position
    await tick()
    await view.sectionView?.revealPage(position)
    await view.reveal(event, true)
  }
  export function focusedRange(control: HTMLElement) {
    const row = control.closest<HTMLElement>(".composition-card, .list-row, .list-section")
    if (!row || !view.panel?.contains(row)) return
    const { index, sectionEnd } = row.dataset
    return { first: Number(index), end: sectionEnd === undefined ? undefined : Number(sectionEnd) }
  }
  export function captureEditFocus(selecting: boolean) {
    const focused = document.activeElement as HTMLElement | null
    const card = focused?.closest<HTMLElement>(".output-pages .composition-card, .composition-output .page-list > li")
    const grid = focused?.matches(".output-pages")
    const pageAction = focused?.closest(".composition-output .page-actions")
    const selectionAction = focused?.closest(".composition-output .sequence-entry") ?? grid
    const menu = focused?.closest<HTMLDetailsElement>(".sequence-options[open]")
    const index = card ? Number(card.dataset.index) : -1
    const inspect = output.pages[index]?.id
    const focusSelection = selecting && !!(card || grid)
    return {
      inspect,
      focusSelection,
      restore: (edit: Edit) => {
        const expanded = edit.pages
        const selection = edit.selected
        const destination = card || focusSelection ? edit.position : undefined
        if (destination !== undefined) view.offset = destination
        if (transfer.touching) return
        if (menu) menu.querySelector("summary")?.focus()
        else if (selectionAction)
          void tick().then(() => {
            if (interaction.touchPointer && expanded.length) {
              view.focusSelection(interaction.touchPointer)
              return
            }
            if (grid && selecting && destination !== undefined && destination >= 0) {
              ;(pendingAddition.has(selection.at(-1)!)
                ? focused
                : document.getElementById(`${key}-${selection.at(-1)}`)?.querySelector<HTMLElement>(".page-image")
              )?.focus({ preventScroll: true })
              return
            }
            if (!selection.length || !focused?.isConnected || focused.matches(":disabled")) {
              if (expanded.length) view.focusSelection(interaction.touchPointer)
              else document.getElementById(`${key}-output-${view.active}`)?.focus({ preventScroll: true })
            } else focused.focus({ preventScroll: true })
          })
        else if (card || pageAction)
          void tick().then(() => {
            if (
              !selecting &&
              focused?.matches(".page-image, .list-choice, .list-heading") &&
              focused?.isConnected &&
              !focused.matches(":disabled") &&
              (!card || expanded.some((page) => `${key}-${page.id}` === card.id))
            ) {
              focused.focus()
              return
            }
            const page = output.pages[destination ?? Math.min(index, output.pages.length - 1)]
            const neighbor =
              page &&
              (document.getElementById(`${key}-${page.id}`) ??
                view.panel?.querySelector<HTMLElement>(`.list-section[data-index="${destination}"]`))
            const viewport =
              !card && output.pages.length ? view.panel?.querySelector<HTMLElement>(".page-scroll") : undefined
            ;(
              (page && pendingAddition.has(page.id)
                ? view.panel?.querySelector<HTMLElement>(".composition-grid, .page-list")
                : neighbor?.querySelector<HTMLButtonElement>(".page-image, .list-choice, .list-heading")) ??
              viewport ??
              document.getElementById(`${key}-output-${view.active}`)
            )?.focus({ preventScroll: !!pageAction || pendingAddition.size > 0 })
          })
      },
    }
  }
</script>

{#snippet outputOrigin(page: Expanded, index: number, total?: number)}
  {@const origin = provenance(page.content)}
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
    bind:opened={originOpen}
  >
    {#snippet navigation()}
      {@const paths = outputPaths(page.content, index)}
      {#if paths.some((path) => path.length)}
        <div class="page-detail-navigation">
          {@render sectionJump("Output", paths, `${key}-output-page-${index}-jump`)}
        </div>
      {/if}
    {/snippet}
  </Origin>
{/snippet}

{#snippet outputPeek(page: Expanded, index: number)}
  {@const origin = provenance(page.content)}
  <Peek
    id={`${key}-peek-output-${page.id}`}
    pane="Output"
    number={index + 1}
    name={pageName(page.content) ?? ("blank" in page.content ? (page.padding ? "Padding" : "Blank") : undefined)}
    size={sizeOf(page.content, sources)}
    enabled={!transfer.value && !originOpen}
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
    {@render gridRibbon("Output", section, folded.has(section.key), fold)}
  {:else}<button
      class="page-grip"
      aria-label={`Select or drag Output page ${index + 1}`}
      aria-pressed={selectedIds.has(page.id)}
      title="Select or unselect this page."
      draggable="true"
      onmousedown={retainFocus}
      onclick={(event) => {
        if (event instanceof PointerEvent && event.pointerType === "touch") return
        commands.select(page.id, event.shiftKey)
        interaction.focusPage(event.currentTarget)
      }}
      onpointerup={(event) => {
        if (event.pointerType !== "touch" || !event.isPrimary || transfer.touching) return
        transfer.suppressClick()
        commands.select(page.id, event.shiftKey)
        interaction.focusPage(event.currentTarget)
      }}
      ondragstart={(event) => start(event, { kind: "output", ids: [page.id] })}
      onpointerdown={(event) => transfer.press(event, { kind: "output", ids: [page.id] })}
      ondragend={() => transfer.end()}
    >
      <Icon name="reorder" />
    </button>{/if}
  {@render pageFace(transfer.number(index) - 1)}
{/snippet}

{#snippet occurrenceActions(page: Expanded, index: number, controls: boolean, end = index + 1)}
  {@const target = { kind: "individual" as const, first: index, end }}
  {@const enabled = !!commands.targets(target).length}
  {@const group = end > index + 1}
  {#snippet move(offset: -1 | 1, menu = false)}
    <button
      class="icon-button move"
      aria-label={`Move Output ${group ? `section pages ${index + 1}–${end}` : `page ${index + 1}`} ${offset < 0 ? "earlier" : "later"}`}
      title={`Move ${group ? "section" : "page"} ${offset < 0 ? "earlier" : "later"}`}
      disabled={!enabled || (offset < 0 ? index === 0 : end === output.pages.length)}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        commands.edit(offset < 0 ? "earlier" : "later", target)
      }}
      ><Icon
        name={view.active === "list" ? (offset < 0 ? "move-up" : "move-down") : offset < 0 ? "earlier" : "later"}
      />{#if menu}<span>{offset < 0 ? "Move earlier" : "Move later"}</span>{/if}</button
    >
  {/snippet}
  {#snippet copies(menu = false)}
    <button
      class="icon-button"
      aria-label={`Remove Output ${group ? `section pages ${index + 1}–${end}` : `page ${index + 1}`}`}
      title={group ? "Remove section" : "Remove this page"}
      disabled={!enabled}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        commands.edit("remove", target)
      }}
      ><Icon name="remove" />{#if menu}<span>Remove</span>{/if}</button
    ><button
      class="icon-button"
      aria-label={`Duplicate Output ${group ? `section pages ${index + 1}–${end}` : `page ${index + 1}`}`}
      title={group ? "Add one adjacent copy of section" : "Add one adjacent copy"}
      disabled={!enabled}
      onclick={(event) => {
        event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
        commands.edit("duplicate", target)
      }}
      ><Icon name="add" />{#if menu}<span>Duplicate</span>{/if}</button
    >
  {/snippet}
  {#snippet pairs()}
    <div class="occurrence-moves" role="group" aria-label={`Move Output page ${index + 1}`}>
      {@render move(-1)}{@render move(1)}
    </div>
    <div class="occurrence-copies" role="group" aria-label={`Remove or duplicate Output page ${index + 1}`}>
      {@render copies()}
    </div>
  {/snippet}
  <div class="occurrence-actions">
    {#if controls && enabled}
      {#if view.active === "list" && narrow.current}
        {@const menuId = `${key}-${page.id}-actions`}
        <button
          class="list-edit-trigger icon-button"
          aria-label={`Actions for Output page ${index + 1}`}
          title="Page actions"
          popovertarget={menuId}><Icon name="more" /></button
        >
        <div id={menuId} class="list-edit-options" popover="auto" aria-label={`Actions for Output page ${index + 1}`}>
          {@render move(-1, true)}{@render move(1, true)}{@render copies(true)}
        </div>
      {:else if view.active === "grid"}<span class="card-inline-actions">{@render pairs()}</span>
      {:else}{@render pairs()}{/if}
    {/if}
  </div>
{/snippet}

{#snippet outputPageHeading(fitWidth: () => void)}
  <span class="page-number">
    {#if inspected}
      {@render outputOrigin(inspected, output.position, output.pages.length)}
    {/if}
  </span>
  {@render pageTools("Output", fitWidth)}
  {@render pageFace(output.position)}
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
      disabled={!chosen.length || !!outputSelectionError || positions[0] === 0}
      onclick={() => commands.edit("earlier")}
      ><Icon name={view.active === "list" ? "move-up" : "earlier"} />{#if !inline}Earlier{/if}</button
    >
    <button
      class={inline ? "step" : undefined}
      aria-label="Move selected pages later"
      title={`Move selected pages later · Ctrl/⌘+${view.active === "list" ? "↓" : "→"}`}
      disabled={!chosen.length || !!outputSelectionError || positions.at(-1) === output.pages.length - 1}
      onclick={() => commands.edit("later")}
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
          {#if !controlCapabilities[view.controls].comparison}{@render comparisonControls(true)}{/if}
          {#if !controlCapabilities[view.controls].zoom}
            {@render zoomControls("Output", true)}
            {#if !controlCapabilities[view.controls].fit}{@render zoomReset(
                "Output",
                () => view.page?.fitWidth(),
                true,
              )}{/if}
          {/if}
        {/if}
        <div class="menu-moves">{@render outputMoves()}</div>
        {#if chosen.length}<button
            disabled={!!outputSelectionError}
            onclick={() => commands.blank(positions[0])}
            title="Insert a blank before the first selected page">Before</button
          >{/if}
        <button
          disabled={!output.pages.length}
          onclick={() => commands.blank(output.position + 1)}
          title="Insert a blank page after the current Output page"><Icon name="blank-after" />Blank after this</button
        >
        <button
          disabled={!output.pages.length}
          onclick={() => commands.blank(output.pages.length)}
          title="Insert a blank page after the last Output page"><Icon name="blank-last" />Blank after last</button
        >
      </div>
      {#if chosen.length && adjacent}
        <Repetition pane="Output" bind:value={repetitions} bind:front />
        {#if Number(repetitions) !== 1 || front}<button
            disabled={!!repeatError || !!outputSelectionError}
            onclick={commands.repeat}>Repeat</button
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
      <div class="output-state" data-details={`${key}-output-summary`} {@attach summary}>
        <span class="composition-totals">{@render outputSummary()}</span>
        <button
          class="icon-button"
          popovertarget={`${key}-output-summary`}
          aria-label="Output details"
          title="Output details"><Icon name="info" /></button
        >
      </div>
      <div class="output-actions" data-tour-target="download" data-tour-active={tour === "download"}>
        {@render documentActions()}
      </div>
      {#if downloadError}<span hidden id={`${key}-download-error`}>{downloadError}</span>{/if}
    </div>
    <div id={`${key}-output-summary`} class="output-details" popover="auto" role="note" aria-label="Output details">
      {@render outputSummary()}
    </div>{/if}
  <div class="editing-toolbar output-tabs">
    <div class="tabs" role="tablist" aria-label="Output workspace">
      {#each viewTabs as tab (tab)}<button
          id={`${key}-output-${tab}`}
          role="tab"
          aria-label={viewLabels[tab]}
          aria-keyshortcuts={`Alt+${viewTabs.indexOf(tab) + 1}`}
          aria-selected={view.active === tab}
          aria-controls={`${key}-output-panel`}
          tabindex={view.active === tab ? 0 : -1}
          onkeydown={(event) => interaction.tabKey(event, "Output")}
          onclick={() => interaction.setOutputTab(tab)}
          title={`${viewLabels[tab]} view`}
          data-tour-tab={`output-${tab}`}
          data-tour-active={tour === `output-${tab}` || (tab === "grid" && tour === "output-selection")}
          ><Icon name={tab} /><span>{viewLabels[tab]}</span></button
        >{/each}
    </div>
    {#if view.sectionView && outputSectionState !== "none"}<button
        type="button"
        class="icon-button"
        aria-label={outputSectionState === "closed" ? "Unfold all Output sections" : "Fold all Output sections"}
        title={outputSectionState === "closed" ? "Unfold all sections" : "Fold all sections"}
        onclick={() => view.sectionView?.toggleSections()}
        ><Icon name={outputSectionState === "closed" ? "expand" : "collapse"} /></button
      >{/if}
    {#if (view.active === "list" || view.active === "grid") && tree.nodes.size}<button
        type="button"
        class="icon-button"
        aria-label="Section headings"
        aria-pressed={view.grouped}
        title={view.grouped ? "Hide section headings" : "Show section headings"}
        onclick={() => {
          view.grouped = !view.grouped
          void view.reveal()
        }}><Icon name="sections" /></button
      >{/if}
    <Jump
      pane="Output"
      count={output.pages.length}
      {labels}
      position={output.position}
      navigate={(position, event) => void goTo(position, event)}
    />
  </div>

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
      value={outputText ?? pageRanges(positions)}
      invalid={!!outputSelectionError}
      error={outputSelectionError}
      disabled={!output.pages.length}
      change={commands.numbers}
      submit={() => commands.edit("remove")}
      hiddenHint={!!transfer.value}
      highlight={highlight?.kind === "output" ? (highlight.removing ? "remove" : "range") : undefined}
      tour={tour === "output-selection"}
    >
      {#snippet menu()}
        {#if output.pages.length || tour === "output-selection"}{@render outputTools()}{/if}
      {/snippet}
      {#snippet actions()}
        {#if output.pages.length && (positions.length < output.pages.length || outputSelectionError)}<button
            class="step"
            aria-label="Select all"
            title="Select all · Ctrl+A / ⌘A"
            aria-keyshortcuts="Control+A Meta+A"
            onclick={(event) => {
              commands.all()
              interaction.focusAfterSelection("Output", event)
            }}><Icon name="select" /></button
          >{/if}
        {#if chosen.length || outputText}<button
            class="reset"
            aria-label="Clear Output selection"
            title="Clear selection to use page actions"
            onclick={(event) => {
              commands.clear()
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
              disabled={!chosen.length || !!outputSelectionError}
              onclick={() => commands.edit("remove")}><Icon name="remove" /></button
            ><button
              class="step primary"
              aria-label="Duplicate selected Output pages"
              title="Add one copy of the selected pages."
              disabled={!chosen.length || !!outputSelectionError}
              onclick={() => commands.edit("duplicate")}><Icon name="add" /></button
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
            name={inspected ? pageName(inspected.content) : undefined}
            bind:headingHeight={() => view.headingHeight, (height) => (view.headingHeight = height)}
            bind:controls={() => view.controls, (controls) => (view.controls = controls)}
            initialize={!opening && !view.pageInitialized ? (zoom) => view.setZoom(zoom) : undefined}
            bind:position={() => output.position, (position) => (output.position = position)}
            bind:zoom={() => view.zoom, (zoom) => view.setZoom(zoom)}
            bind:comparing
            bind:region={() => view.region, (region) => (view.region = region)}
            heading={inspected ? outputPageHeading : undefined}
            actions={inspected && !chosen.length ? outputPageActions : undefined}
            copyable={!outputSelectionError}
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
          selected={(first, end) => commands.selectedSection(first, end)}
          identity={(index) => output.pages[index].id}
          rowId={(index) => `${key}-${output.pages[index].id}`}
          pending={pendingAddition}
          {removal}
          skipped={skippedRows}
          retained={retainedRow}
          bind:position={() => output.position, (position) => (output.position = position)}
          select={(index, range, anchor, sectionEnd) =>
            sectionEnd === undefined
              ? commands.select(
                  output.pages[index].id,
                  range,
                  anchor === undefined ? undefined : output.pages[anchor].id,
                )
              : commands.section(index, sectionEnd)}
          edit={(action, first, end) => action !== "add" && commands.edit(action, { kind: "focused", first, end })}
        >
          {#snippet section(start, end, path, expanded, toggle, id)}
            {#snippet origin()}{@render outputOrigin(output.pages[start], start)}{/snippet}
            {#snippet actionsForRow()}
              {@render occurrenceActions(output.pages[start], start, true, end)}
              {@render outputPeek(output.pages[start], start)}
            {/snippet}
            {@render sectionRow(
              "Output",
              start,
              end,
              path,
              expanded,
              toggle,
              id,
              origin,
              actionsForRow,
              outline && path.length > 1 ? path.slice(1) : path,
            )}
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
              class:range-highlight={highlight?.kind === "output" && highlight.ids.has(page.id)}
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
                name={pageName(page.content)}
                label={pageName(page.content) ??
                  ("blank" in page.content ? (page.padding ? "Padding" : "Blank") : `Page ${page.content.page + 1}`)}
                selected={selectedIds.has(page.id)}
                touch={interaction.touchPointer}
                {transfer}
                payload={{ kind: "output", ids: [page.id] }}
                {start}
                inspect={() => (output.position = index)}
                toggle={(range) => commands.select(page.id, range)}
                select={(event) => commands.activate(index, event)}
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
            toggle={(position) => commands.select(output.pages[position].id, false)}
            edit={(action, first, end) =>
              action !== "add" &&
              commands.edit(action, first === undefined ? undefined : { kind: "focused", first, end })}
          >
            {#snippet children(pages, headings, fold, folded)}
              {#each pages as index, offset (output.pages[index].id)}
                {@const page = output.pages[index]}
                {@const section = headings.get(index)}
                {@const origin = provenance(page.content)}
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
                          ? commands.selectedSection(section.start, section.end)
                          : selectedIds.has(page.id),
                      "grid-section-card": !!section,
                      "grid-section-open": !!section && !folded.has(section.key),
                    },
                  ]}
                  data-returning={(interaction.returning?.kind === "output" && interaction.returning.id === page.id) ||
                    undefined}
                  class:range-highlight={highlight?.kind === "output" && highlight.ids.has(page.id)}
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
                      ? commands.selectedSection(section.start, section.end)
                      : selectedIds.has(page.id)}
                    title={section && folded.has(section.key)
                      ? "Select or unselect the entire folded section."
                      : "Select pages to edit Output."}
                    aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Plus - Delete"
                    draggable="true"
                    onmousedown={retainFocus}
                    onclick={(event) => {
                      commands.activate(index, event, section && folded.has(section.key) ? section.end : undefined)
                      if (event.detail) event.currentTarget.focus({ preventScroll: true })
                    }}
                    ondragstart={(event) => start(event, { kind: "output", ids: [page.id] })}
                    ondragend={() => transfer.end()}
                  >
                    {#if origin && "page" in page.content}<Pdf
                        {...origin.preview.appearance(page.content.page)}
                        pageNumber={page.content.page + 1}
                        name={pageName(page.content)}
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
