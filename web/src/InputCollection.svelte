<!-- Renders Input List and Grid page collections with card selection, drag grips, and section ribbons. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import type { Source } from "./model.ts"
  import type { InputViews } from "./pane.svelte.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { Sections } from "./sections.ts"
  import type { Magnification } from "./Lens.svelte"
  import { retainFocus } from "./drag.ts"
  import Icon from "./Icon.svelte"
  import Grid from "./Grid.svelte"
  import List from "./List.svelte"
  import Row from "./Row.svelte"
  import Pdf from "./Pdf.svelte"
  import Face from "./Face.svelte"
  import Ribbon from "./Ribbon.svelte"
  import SectionRow from "./SectionRow.svelte"
  import Grip from "./Grip.svelte"

  let {
    key,
    source,
    view,
    editing,
    interaction,
    transfer,
    inputSections,
    outputPositions,
    inputName,
    magnification,
    error,
    origin: pageOrigin,
    peek,
    actions: pageActions,
  }: {
    key: string
    source: Source
    view: InputViews
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    inputSections: Sections
    outputPositions: ReadonlyMap<number, readonly number[]>
    inputName: (page: number) => string | undefined
    magnification: Magnification
    error: (message: string) => void
    origin: Snippet<[page: number, detail: string, total?: number]>
    peek: Snippet<[page: number]>
    actions: Snippet<[page?: number, end?: number]>
  } = $props()

  const count = $derived(editing.selection.count)
  const draft = $derived(editing.selection.draft)
  const inputSelected = $derived(editing.selection.inputSelected)
  const inputPosition = $derived(view.position)
</script>

{#if view.active === "list"}
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
      selected={(first, end) => editing.selection.selectedSection("Input", first, end)}
      bind:position={() => inputPosition, (position) => view.set({ position })}
      select={(page, range, anchor, sectionEnd) =>
        sectionEnd === undefined
          ? editing.selection.toggle(page, range, anchor)
          : editing.selection.selectSection("Input", page, sectionEnd)}
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
          selected={expanded ? inputSelected.has(start) : editing.selection.selectedSection("Input", start, end)}
          pdfLabel={source.input.labels[start]}
          {id}
          payload={editing.inputPayload(start, end)}
          {transfer}
          touch={interaction.touchPointer}
          start={editing.start}
          {toggle}
          select={(event) => {
            editing.selection.selectInput(start, event, expanded ? undefined : end)
            return () => editing.selection.restoreInput(start)
          }}
          inspect={() => view.set({ position: start })}
          open={(event) => {
            view.set({ position: start })
            void interaction.toggleView("Input", event)
          }}
        >
          {#snippet origin()}{@render pageOrigin(start, `${key}-list-input-${start}`)}{/snippet}
          {#snippet actions()}
            {#if !draft.pages.length}{@render pageActions(start, end)}{/if}
            {@render peek(start)}
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
            toggle={(range) => editing.selection.toggle(page, range)}
            select={(event) => editing.selection.selectInputRow(page, event)}
            open={(event) => void interaction.toggleView("Input", event)}
          >
            {#snippet origin()}{@render pageOrigin(page, `${key}-list-input-${page}`)}{/snippet}
            {#snippet actions()}{#if !draft.pages.length}{@render pageActions(page)}{/if}{/snippet}
            {#snippet preview()}{@render peek(page)}{/snippet}
          </Row>
        </li>
      {/snippet}
    </List>{/key}
{:else}
  {#key source.id}
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
      toggle={(page) => editing.selection.toggle(page, false)}
      edit={(action, page, end) => action === "add" && editing.commandInput(editing.focusedInput(page, end))}
    >
      {#snippet children(pages, headings, fold, folded)}
        {#each pages as page, index (page)}
          {@const section = headings.get(page)}
          {@const first = index === 0}
          {@const destinations = outputPositions.get(page) ?? []}
          {@const detail = `${key}-input-${source.id}-${page}`}
          <li
            aria-setsize={count}
            aria-posinset={page + 1}
            class={[
              "composition-card",
              {
                selected:
                  section && folded.has(section.key)
                    ? editing.selection.selectedSection("Input", section.start, section.end)
                    : inputSelected.has(page),
                "grid-section-card": !!section,
                "grid-section-open": !!section && !folded.has(section.key),
              },
            ]}
            data-returning={(interaction.returning?.kind === "source" &&
              interaction.returning.source === source.id &&
              interaction.returning.page === page) ||
              undefined}
            class:range-highlight={editing.selection.highlight?.kind === "source" &&
              editing.selection.highlight.source === source.id &&
              page >= editing.selection.highlight.first &&
              page <= editing.selection.highlight.last}
            data-tour-target={first ? "first-page" : undefined}
            data-face={page % 2 === 0 ? "front" : "back"}
            data-dragging={transfer.value?.kind === "source" &&
            transfer.value.source === source.id &&
            (transfer.value.choice.kind === "page"
              ? transfer.value.choice.page === page
              : transfer.value.choice.kind === "pages"
                ? transfer.value.choice.pages.includes(page)
                : inputSelected.has(page))
              ? true
              : undefined}
          >
            <div class="page-label">
              {@render pageOrigin(page, detail)}
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
                    editing.selection.toggle(page, shiftKey)
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
                ? editing.selection.selectedSection("Input", section.start, section.end)
                : inputSelected.has(page)}
              aria-describedby={destinations.length ? detail : undefined}
              title={section && folded.has(section.key)
                ? "Select or unselect the entire folded section."
                : "Select pages for Output."}
              aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Plus Delete"
              draggable="true"
              onmousedown={retainFocus}
              onclick={(event) =>
                editing.selection.selectInput(
                  page,
                  event,
                  section && folded.has(section.key) ? section.end : undefined,
                )}
              ondblclick={(event) => editing.selection.doubleClickInput(page, event)}
              ondragstart={(event) => editing.start(event, editing.inputPayload(page))}
              ondragend={() => transfer.end()}
            >
              <Pdf
                pdf={source.input.pdf}
                {page}
                pageNumber={page + 1}
                name={inputName(page)}
                preview={source.input.description.pages[page]?.preview}
                size={source.input.sizes[page]}
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
              {#if !draft.pages.length}{@render pageActions(page, section?.end)}{/if}
            </div>
            <Face index={page} />
          </li>
        {/each}
      {/snippet}
    </Grid>
  {/key}
{/if}
