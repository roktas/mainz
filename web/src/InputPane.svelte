<!-- Renders the Input pane and owns its Grid, List, Page, and Style presentation. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import type { Source } from "./model.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Output } from "./output.svelte.ts"
  import type { InputViews } from "./pane.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { Magnification } from "./Lens.svelte"
  import type { TourStep } from "./Tour.svelte"
  import { destinations } from "./composition.ts"
  import { titlesOf } from "./outline.ts"
  import { sectionsOf, Sections } from "./sections.ts"
  import { retainFocus } from "./drag.ts"
  import Feedback from "./Feedback.svelte"
  import Icon from "./Icon.svelte"
  import Contents from "./Contents.svelte"
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
  import PageControls from "./PageControls.svelte"
  import Toolbar from "./Toolbar.svelte"
  import Summary from "./Summary.svelte"
  import Grip from "./Grip.svelte"

  let {
    key,
    compact,
    source,
    styleable,
    styling,
    input,
    viewInputPDF,
    view,
    output,
    editing,
    interaction,
    transfer,
    tour,
    opening,
    magnification,
    error,
    peeks,
  }: {
    key: string
    compact: boolean
    source?: Source
    styleable: boolean
    styling?: Snippet<[toolbarOnly?: boolean]>
    input: Snippet<[heading: string]>
    viewInputPDF: () => void
    view: InputViews
    output: Output
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    tour?: TourStep
    opening: boolean
    magnification: Magnification
    error: (message: string) => void
    peeks: Peeks
  } = $props()

  const count = $derived(editing.count)
  const draft = $derived(editing.draft)
  const inputSelected = $derived(editing.inputSelected)
  const inputPosition = $derived(view.position)
  const hasStyles = $derived(!!source && Object.keys(source.input.description.parameters).length > 0)
  const titleChoice = $derived(source ? titlesOf(source.input).choice : false)
  const outputPositions = $derived(destinations(output.pages, source?.id))
  const outline = $derived(view.current.grouped ? source?.input.outline : undefined)
  const folds = $derived(view.current.folds)
  const tree = $derived(sectionsOf(outline))
  const inputSections = $derived(new Sections(tree, count, folds))
  const inputSectionState = $derived(view.sectionView ? inputSections.state() : "none")
  const allInput = $derived(
    !editing.invalid && draft.pages.length === count && draft.pages.every((page, index) => page === index),
  )
  const inputInspection: Inspection | undefined = $derived(
    source
      ? {
          kind: "pdf",
          pdf: source.input.pdf,
          page: inputPosition,
          size: source.input.sizes[inputPosition],
        }
      : undefined,
  )

  function inputName(page: number) {
    return source ? titlesOf(source.input).at(page, view.current.tocTitles).name : undefined
  }
</script>

{#snippet inputPageHeading(fitWidth: () => void)}
  <span class="page-number">
    {@render inputOrigin(inputPosition, `${key}-input-counter`, count)}
  </span>
  <button
    class="page-grip"
    aria-label={`Select or drag Input page ${view.current.position + 1} to Output`}
    aria-pressed={inputSelected.has(inputPosition)}
    title="Select or unselect this page."
    draggable="true"
    onmousedown={retainFocus}
    onclick={(event) => {
      editing.toggle(inputPosition, event.shiftKey)
      interaction.focusPage(event.currentTarget)
    }}
    ondragstart={(event) => editing.start(event, editing.inputPayload(view.current.position))}
    onpointerdown={(event) => transfer.press(event, editing.inputPayload(view.current.position))}
    ondragend={() => transfer.end()}><Icon name="reorder" /></button
  >
  <PageControls
    pane="Input"
    zoom={view.current.zoom}
    onZoomBy={(offset) => interaction.zoomBy("Input", offset)}
    onResetZoom={() => interaction.setZoom("Input", 100)}
    onFitWidth={fitWidth}
  />
  <Face index={view.current.position} />
{/snippet}

{#snippet inputPageActions(page: number = inputPosition, end = page + 1)}
  <button
    class="icon-button"
    aria-label={end > page + 1
      ? `Add Input section pages ${page + 1}–${end} to Output`
      : `Add Input page ${page + 1} to Output`}
    title={end > page + 1 ? "Add section to Output" : "Add one copy"}
    onclick={(event) => {
      event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
      if (editing.commandInput(editing.inputRange(page, end), undefined, false)) {
        view.set({ position: page })
        interaction.focusPage(event.currentTarget)
      }
    }}><Icon name="add" /></button
  >
{/snippet}

{#snippet inputOrigin(page: number, detail: string, total?: number)}
  {#if source}<Origin
      id={detail}
      pane="Input"
      number={page + 1}
      count={total}
      identity={{ source, page, tocTitles: view.current.tocTitles, destinations: outputPositions.get(page) }}
      mode={view.active === "list" ? "list" : "normal"}
      bind:opened={editing.originOpen}
    >
      {#snippet navigation()}
        {#if view.current.grouped && view.sectionView}
          {@const paths = titlesOf(source.input)
            .at(page)
            .headings.map(({ keys }) => view.sectionView?.paths(page, keys) ?? [])}
          {#if paths.some((path) => path.length)}
            <div class="page-detail-navigation">
              <SectionPath
                id={`${detail}-jump`}
                pane="Input"
                {paths}
                jump={(sectionId) => {
                  editing.originOpen = undefined
                  void view.sectionView?.revealSection(sectionId)
                }}
              />
            </div>
          {/if}
        {/if}
      {/snippet}
    </Origin>{/if}
{/snippet}

{#snippet inputPeek(page: number)}
  {#if source}
    {#key source.id}
      <Peek
        id={`${key}-peek-input-${page}`}
        pane="Input"
        number={page + 1}
        name={inputName(page)}
        size={source.input.sizes[page]}
        enabled={!transfer.value && !editing.originOpen}
        owner={peeks}
        open={(event) => {
          view.set({ position: page })
          void interaction.toggleView("Input", event)
        }}
      >
        <Pdf pdf={source.input.pdf} {page} pageNumber={page + 1} thumbnail {error} />
      </Peek>
    {/key}
  {/if}
{/snippet}

{#snippet inputTools()}
  <details class="sequence-options input-options" bind:this={view.menu}>
    <summary aria-label="Input page actions" title="Input page actions"><Icon name="more" /></summary>
    <div class="menu-options">
      {#if view.active === "page" && !controlCapabilities[view.controls].zoom}
        <PageControls
          pane="Input"
          menu
          zoom={view.current.zoom}
          showFit={!controlCapabilities[view.controls].fit}
          onZoomBy={(offset) => interaction.zoomBy("Input", offset)}
          onResetZoom={() => interaction.setZoom("Input", 100)}
          onFitWidth={() => view.page?.fitWidth()}
        />
      {/if}
      <Repetition
        pane="Input"
        bind:value={() => draft.repeat, (repeat) => editing.set({ repeat })}
        bind:front={() => draft.front, (front) => editing.set({ front })}
      />
    </div>
  </details>
{/snippet}

{#if source}<section
    class="selection-panel"
    data-warning={(transfer.warning &&
      transfer.touching &&
      transfer.value?.kind === "source" &&
      interaction.activeView === "input") ||
      undefined}
    aria-labelledby={`${key}-${compact ? "input-switch" : "selection"}`}
  >
    {#if !compact}
      <div class="section-heading input-heading" data-tour-target="input" data-tour-active={tour === "input"}>
        {@render input(`${key}-selection`)}
        <div class="input-preview-tools output-actions">
          <Summary id={`${key}-input-summary`} pane="Input" pages={count} className="input-state" />
          <button
            class="icon-button view-action"
            aria-label="View Input PDF"
            title="View Input PDF"
            onclick={viewInputPDF}><Icon name="eye" /></button
          >
        </div>
      </div>
    {/if}

    <Toolbar
      {key}
      pane="Input"
      active={view.active}
      panelId={`${key}-source-panel`}
      className="source-tabs"
      anchorName="--input-pane"
      {tour}
      sectionState={inputSectionState}
      hasSections={!!source.input.outline?.length}
      grouped={view.current.grouped}
      showJump={view.active !== "style"}
      {count}
      position={inputPosition}
      labels={source.input.labels}
      onTab={(tab) => interaction.inputTab(tab)}
      onTabKey={(event) => interaction.tabKey(event)}
      onToggleSections={() => view.sectionView?.toggleSections()}
      onToggleGrouped={() => {
        view.set({ grouped: !view.current.grouped })
        void view.reveal()
      }}
      onJump={(position, event) => void view.goTo(position, event)}
    >
      {#snippet extraTab()}
        {#if hasStyles}<button
            id={`${key}-style`}
            role="tab"
            aria-label="Style"
            data-modified={!!(Object.keys(source.overrides).length || Object.keys(source.drafts).length) || undefined}
            aria-selected={view.active === "style"}
            aria-controls={`${key}-source-panel`}
            tabindex={view.active === "style" ? 0 : -1}
            onkeydown={interaction.tabKey}
            onclick={() => interaction.inputTab("style")}
            disabled={!styleable}
            aria-describedby={!styleable ? `${key}-style-unavailable` : undefined}
            title={styleable
              ? Object.keys(source.overrides).length || Object.keys(source.drafts).length
                ? "Style · Modified"
                : "Style"
              : "Style unavailable. Add applicable pages from this Input to Output to use Style."}
            data-tour-tab="style"
            data-tour-active={tour === "style"}
            ><Icon name={styleable ? "style" : "style-off"} /><span>Style</span></button
          >{/if}
      {/snippet}
      {#snippet extraTools()}
        {#if view.active === "style" && styling}{@render styling(true)}{/if}
        {#if source.input.outline?.length}<Contents
            outline={source.input.outline}
            source={source.id}
            position={inputPosition}
            name={inputName}
            pages={source.input.description.pages}
            {titleChoice}
            bind:tocTitles={() => view.current.tocTitles, (tocTitles) => view.set({ tocTitles })}
            navigate={async (position) => {
              view.set({ position, offset: position })
              if (view.active === "list") await view.list?.revealPage(position)
              void view.reveal(undefined, true)
            }}
          />{/if}
      {/snippet}
    </Toolbar>

    <div
      class="input-panel"
      bind:this={view.panel}
      id={`${key}-source-panel`}
      role="tabpanel"
      data-tour-target={view.active === "style" ? "style" : `input-${view.active}`}
      data-tour-active={tour === "style" || tour?.startsWith("input-")}
      aria-labelledby={`${key}-${view.active}`}
    >
      {#if view.active === "style" && styling}
        <div class="page-content">
          {@render styling()}
        </div>
      {:else}
        <Selection
          id={`${key}-input-selection`}
          pane="Input"
          value={draft.text}
          invalid={editing.invalid}
          error={editing.selectionError}
          change={editing.numbers}
          submit={() => editing.commandInput()}
          menu={inputTools}
        >
          {#snippet actions()}
            {#if !allInput}<button
                class="step"
                aria-label="Select all"
                title="Select all · Ctrl+A / ⌘A"
                aria-keyshortcuts="Control+A Meta+A"
                onclick={(event) => {
                  editing.selectAll("Input")
                  interaction.focusAfterSelection("Input", event)
                }}><Icon name="select" /></button
              >{/if}
            {#if draft.text || draft.pages.length || draft.repeat !== "1" || draft.front}<button
                class="reset"
                aria-label="Clear page sequence"
                title="Clear"
                onclick={(event) => {
                  editing.clearInput()
                  interaction.focusAfterSelection("Input", event)
                }}><Icon name="close" /></button
              >{/if}
            {#if draft.pages.length}<button
                class="step transfer primary"
                aria-label="Add to Output"
                title={`Add to Output${editing.insertion === undefined ? " at the end" : ` after page ${editing.insertion}`}.`}
                draggable="true"
                disabled={!!editing.selectionError}
                ondragstart={(event) => editing.start(event, editing.inputPayload())}
                onpointerdown={(event) => transfer.press(event, editing.inputPayload())}
                ondragend={() => transfer.end()}
                onclick={() => editing.commandInput()}><Icon name="add" /></button
              >{/if}
          {/snippet}
          {#snippet hint()}
            {#if draft.pages.length}<strong
                >{draft.pages.length} {draft.pages.length === 1 ? "page" : "pages"} selected</strong
              > ·
            {/if}
            {draft.pages.length
              ? editing.insertion === undefined
                ? "Append to Output."
                : `Add after Output ${editing.insertion}.`
              : "Select pages or type numbers."}
            {#if draft.repeat !== "1" || draft.front}
              Repeat ×{draft.repeat}{draft.front ? " · Front aligned" : ""}.{/if}
            {#if hasStyles && !styleable}<span id={`${key}-style-unavailable`}
                >Style needs applicable Output pages.</span
              >{/if}
          {/snippet}
        </Selection>
        <div class="page-content">
          {#if transfer.warning && transfer.touching && transfer.value?.kind === "source" && interaction.activeView === "input"}
            <Feedback
              header
              kind="notice"
              text="Move to Output."
              details="Drag onto the Output tab to place the selected pages in Output."
            />
          {/if}
          {#if view.active === "page"}
            {#key source.id}<PageView
                pane="Input"
                bind:this={view.page}
                {count}
                sheet={inputInspection}
                name={inputName(inputPosition)}
                bind:headingHeight={() => view.headingHeight, (height) => (view.headingHeight = height)}
                bind:controls={() => view.controls, (controls) => (view.controls = controls)}
                initialize={!opening && !view.current.pageInitialized ? (zoom) => view.setZoom(zoom) : undefined}
                bind:position={() => view.current.position, (position) => view.set({ position, alignment: undefined })}
                bind:zoom={() => view.current.zoom, (zoom) => view.setZoom(zoom)}
                bind:region={() => view.current.region, (region) => view.set({ region, alignment: undefined })}
                alignment={view.current.alignment}
                heading={inputPageHeading}
                actions={!draft.pages.length ? inputPageActions : undefined}
                grid={(event) => void interaction.toggleView("Input", event)}
                selected={inputSelected.has(inputPosition)}
                {error}
                {magnification}
              />{/key}
          {:else if view.active === "list"}
            {#key source.id}
              <List
                viewport={view.listViewport(source.id)}
                bind:this={view.list}
                sections={inputSections}
                onfold={(folds) => view.set({ folds })}
                pane="Input"
                active={() => interaction.shortcutPane() === "Input"}
                labeled={source.input.labels.length > 0}
                revision={`${view.current.grouped}:${view.current.tocTitles}`}
                selected={(first, end) => editing.selectedSection("Input", first, end)}
                bind:position={() => inputPosition, (position) => view.set({ position })}
                select={(page, range, anchor, sectionEnd) =>
                  sectionEnd === undefined
                    ? editing.toggle(page, range, anchor)
                    : editing.selectSection("Input", page, sectionEnd)}
                edit={(action, page, end) => action === "add" && editing.commandInput(editing.focusedInput(page, end))}
              >
                {#snippet section(start, end, path, expanded, toggle, id)}
                  <SectionRow
                    {key}
                    pane="Input"
                    first={start}
                    {end}
                    {path}
                    {expanded}
                    selected={expanded ? inputSelected.has(start) : editing.selectedSection("Input", start, end)}
                    pdfLabel={source.input.labels[start]}
                    {id}
                    payload={editing.inputPayload(start, end)}
                    {transfer}
                    touch={interaction.touchPointer}
                    start={editing.start}
                    {toggle}
                    select={(event) => {
                      editing.selectInput(start, event, expanded ? undefined : end)
                      return () => editing.restoreInput(start)
                    }}
                    open={(event) => {
                      view.set({ position: start })
                      void interaction.toggleView("Input", event)
                    }}
                  >
                    {#snippet origin()}{@render inputOrigin(start, `${key}-list-input-${start}`)}{/snippet}
                    {#snippet actions()}
                      {#if !draft.pages.length}{@render inputPageActions(start, end)}{/if}
                      {@render inputPeek(start)}
                    {/snippet}
                  </SectionRow>
                {/snippet}
                {#snippet children(page, retained)}
                  <li
                    class="list-row"
                    data-retained={page === retained || undefined}
                    aria-setsize={count}
                    aria-posinset={page + 1}
                    data-returning={(interaction.returning?.kind === "source" &&
                      interaction.returning.source === source.id &&
                      interaction.returning.page === page) ||
                      undefined}
                    class:selected={inputSelected.has(page)}
                    data-dragging={(transfer.value?.kind === "source" &&
                      transfer.value.source === source.id &&
                      (transfer.value.choice.kind === "page"
                        ? transfer.value.choice.page === page
                        : transfer.value.choice.kind === "pages"
                          ? transfer.value.choice.pages.includes(page)
                          : inputSelected.has(page))) ||
                      undefined}
                  >
                    <Row
                      pane="Input"
                      number={page + 1}
                      index={page}
                      name={inputName(page)}
                      label={inputName(page) ?? `Page ${page + 1}`}
                      pdfLabel={source.input.labels[page]}
                      selected={inputSelected.has(page)}
                      touch={interaction.touchPointer}
                      {transfer}
                      payload={editing.inputPayload(page)}
                      start={editing.start}
                      inspect={() => view.set({ position: page })}
                      toggle={(range) => editing.toggle(page, range)}
                      select={(event) => editing.selectInputRow(page, event)}
                      open={(event) => void interaction.toggleView("Input", event)}
                    >
                      {#snippet origin()}{@render inputOrigin(page, `${key}-list-input-${page}`)}{/snippet}
                      {#snippet actions()}{#if !draft.pages.length}{@render inputPageActions(page)}{/if}{/snippet}
                      {#snippet preview()}{@render inputPeek(page)}{/snippet}
                    </Row>
                  </li>
                {/snippet}
              </List>{/key}
          {:else}
            <Grid
              bind:this={view.grid}
              viewport={view.gridViewport(source.id)}
              pane="Input"
              active={() => interaction.shortcutPane() === "Input"}
              sections={inputSections}
              onfold={(folds) => view.set({ folds })}
              bind:position={() => view.current.position, (position) => view.set({ position })}
              bind:offset={() => view.current.offset, (offset) => view.set({ offset })}
              bind:keyboard={() => interaction.usingKeyboard, (keyboard) => (interaction.usingKeyboard = keyboard)}
              selected={(position) => inputSelected.has(position)}
              toggle={(page) => editing.toggle(page, false)}
              edit={(action, page, end) => action === "add" && editing.commandInput(editing.focusedInput(page, end))}
            >
              {#snippet children(pages, headings, fold, folded)}
                {#each pages as page, index (page)}
                  {@const section = headings.get(page)}
                  {@const first = index === 0}
                  {@const destinations = outputPositions.get(page) ?? []}
                  {@const detail = `${key}-input-${source.id}-${page}`}
                  <li
                    class={[
                      "composition-card",
                      {
                        selected:
                          section && folded.has(section.key)
                            ? editing.selectedSection("Input", section.start, section.end)
                            : inputSelected.has(page),
                        "grid-section-card": !!section,
                        "grid-section-open": !!section && !folded.has(section.key),
                      },
                    ]}
                    data-returning={(interaction.returning?.kind === "source" &&
                      interaction.returning.source === source.id &&
                      interaction.returning.page === page) ||
                      undefined}
                    class:range-highlight={editing.highlight?.kind === "source" &&
                      editing.highlight.source === source.id &&
                      page >= editing.highlight.first &&
                      page <= editing.highlight.last}
                    data-tour-target={first ? "first-page" : undefined}
                    data-face={page % 2 === 0 ? "front" : "back"}
                    data-dragging={transfer.value?.kind === "source" &&
                    (transfer.value.choice.kind === "page"
                      ? transfer.value.choice.page === page
                      : inputSelected.has(page))
                      ? true
                      : undefined}
                  >
                    <div class="page-label">
                      {@render inputOrigin(page, detail)}
                      {#if section}
                        <Ribbon
                          {key}
                          pane="Input"
                          {section}
                          folded={folded.has(section.key)}
                          payload={editing.inputPayload(section.start, section.end)}
                          {transfer}
                          start={editing.start}
                          {fold}
                        />
                      {:else}<Grip
                          pane="Input"
                          number={page + 1}
                          selected={inputSelected.has(page)}
                          payload={editing.inputPayload(page)}
                          {transfer}
                          start={editing.start}
                          onToggle={(shiftKey, control) => {
                            editing.toggle(page, shiftKey)
                            view.set({ position: page })
                            interaction.focusPage(control)
                          }}
                        />{/if}
                      <button
                        class="icon-button grid-inspect"
                        type="button"
                        aria-label={`View Input page ${page + 1}`}
                        title="View page"
                        onclick={(event) => {
                          view.set({ position: page })
                          void interaction.toggleView("Input", event)
                        }}><Icon name="eye" /></button
                      >
                    </div>
                    <button
                      class="page-image"
                      data-page={page}
                      aria-label={section && folded.has(section.key)
                        ? `Select Input section ${section.path.join(" › ")}: pages ${section.start + 1}–${section.end}`
                        : `Select Input page ${page + 1}`}
                      aria-pressed={section && folded.has(section.key)
                        ? editing.selectedSection("Input", section.start, section.end)
                        : inputSelected.has(page)}
                      aria-describedby={destinations.length ? detail : undefined}
                      title={section && folded.has(section.key)
                        ? "Select or unselect the entire folded section."
                        : "Select pages for Output."}
                      aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Plus Delete"
                      draggable="true"
                      onmousedown={retainFocus}
                      onclick={(event) =>
                        editing.selectInput(page, event, section && folded.has(section.key) ? section.end : undefined)}
                      ondblclick={(event) => editing.doubleClickInput(page, event)}
                      ondragstart={(event) => editing.start(event, editing.inputPayload(page))}
                      ondragend={() => transfer.end()}
                    >
                      <Pdf
                        pdf={source.input.pdf}
                        {page}
                        pageNumber={page + 1}
                        name={inputName(page)}
                        preview={source.input.description.pages[page]?.preview}
                        thumbnail
                        {magnification}
                        {error}
                      />
                    </button>
                    <div class="input-footer">
                      {#if source.input.labels[page] && source.input.labels[page] !== String(page + 1)}<span
                          class="grid-pdf-label"
                          title={`Page Label: ${source.input.labels[page]}`}>{source.input.labels[page]}</span
                        >{/if}
                      {#if !draft.pages.length}{@render inputPageActions(page, section?.end)}{/if}
                    </div>
                    <Face index={page} />
                  </li>
                {/each}
              {/snippet}
            </Grid>
          {/if}
        </div>
      {/if}
    </div>
  </section>{/if}
