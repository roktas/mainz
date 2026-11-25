<!-- Renders Output List, Grid, and empty states with drop previews, section ribbons, and transitions. -->

<script lang="ts">
  import type { Snippet } from "svelte"
  import { sizeOf } from "./model.ts"
  import type { Expanded, Source } from "./model.ts"
  import { animateOrder } from "./edits.ts"
  import { inert } from "./motion.ts"
  import type { Interaction } from "./interaction.svelte.ts"
  import type { Output } from "./output.svelte.ts"
  import type { OutputView } from "./pane.svelte.ts"
  import type { Transfer } from "./transfer.svelte.ts"
  import type { Editing } from "./editing.svelte.ts"
  import type { Magnification } from "./Lens.svelte"
  import type { Section, Sections } from "./sections.ts"
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
    output,
    sources,
    view,
    editing,
    interaction,
    transfer,
    outputProjection,
    hasOutline,
    revision,
    magnification,
    error,
    origin: pageOrigin,
    peek,
    occurrence,
  }: {
    key: string
    output: Output
    sources: readonly Source[]
    view: OutputView
    editing: Editing
    interaction: Interaction
    transfer: Transfer
    outputProjection: Sections
    hasOutline: boolean
    revision: { pages: readonly Expanded[]; grouped: boolean; titles: string }
    magnification: Magnification
    error: (message: string) => void
    origin: Snippet<[page: Expanded, index: number, total?: number]>
    peek: Snippet<[page: Expanded, index: number]>
    occurrence: Snippet<[page: Expanded, index: number, controls: boolean, end?: number]>
  } = $props()

  const chosen = $derived(output.selected)
  const selectedIds = $derived(output.selection)
  const feedback = $derived(editing.feedback)
  const pendingAddition = $derived(feedback.pending)
  const arriving = $derived(feedback.arriving)
  const removing = $derived(feedback.removing)
  const listPreview = $derived(view.active === "list" && transfer.destination !== undefined)
  const skippedRows = $derived(
    listPreview && transfer.value?.kind === "output"
      ? new Set(
          transfer.value.ids.flatMap((id) => {
            const index = output.positions.get(id)
            return index === undefined ? [] : [index]
          }),
        )
      : undefined,
  )
  const retainedRow = $derived(
    transfer.value?.kind === "output" ? output.positions.get(transfer.value.ids[0]) : undefined,
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

  function removal(node: HTMLElement) {
    return feedback.exitTransition(node)
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

{#snippet outputGridHeading(
  page: Expanded,
  index: number,
  section: Section | undefined,
  folded: ReadonlySet<string>,
  fold: (key: string) => void,
)}
  {@render pageOrigin(page, index)}
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
        editing.selection.selectOutput(page.id, shiftKey)
        interaction.focusPage(control)
      }}
    />{/if}
  <Face index={transfer.number(index) - 1} />
{/snippet}

{#if view.active === "list" && output.pages.length}
  <List
    viewport={view.listViewport}
    bind:this={view.list}
    sections={outputProjection}
    onfold={(folds) => (view.folds = folds)}
    pane="Output"
    active={() => interaction.shortcutPane() === "Output"}
    {revision}
    selected={(first, end) => editing.selection.selectedSection("Output", first, end)}
    sectionDrop={(start, end, expanded) => {
      if (transfer.blocked || !transfer.inside) return undefined
      if (
        transfer.target.kind === "append" &&
        (expanded ? start === output.pages.length - 1 : end === output.pages.length)
      )
        return "after"
      if (transfer.targetIndex === undefined) return undefined
      if (expanded) {
        if (transfer.targetIndex === start) return transfer.targetAfter ? "after" : "before"
        return undefined
      }
      if (transfer.targetIndex === start && !transfer.targetAfter) return "before"
      if (transfer.targetIndex === end - 1 && transfer.targetAfter) return "after"
      return undefined
    }}
    dropHeight={transfer.stripHeight}
    identity={(index) => output.pages[index].id}
    rowId={(index) => `${key}-${output.pages[index].id}`}
    pending={pendingAddition}
    {removal}
    skipped={skippedRows}
    retained={retainedRow}
    bind:position={() => output.position, (position) => (output.position = position)}
    select={(index, range, anchor, sectionEnd) =>
      sectionEnd === undefined
        ? editing.selection.selectOutput(
            output.pages[index].id,
            range,
            anchor === undefined ? undefined : output.pages[anchor].id,
          )
        : editing.selection.selectSection("Output", index, sectionEnd)}
    edit={(action, first, end) => action !== "add" && editing.commandOutput(action, { kind: "focused", first, end })}
  >
    {#snippet section(start, end, path, expanded, toggle, id, drop)}
      <SectionRow
        {key}
        pane="Output"
        first={start}
        {end}
        {path}
        labels={hasOutline && path.length > 1 ? path.slice(1) : path}
        {expanded}
        selected={expanded
          ? selectedIds.has(output.pages[start].id)
          : editing.selection.selectedSection("Output", start, end)}
        {id}
        payload={{ kind: "output", ids: editing.outputRange(start, end) }}
        {transfer}
        touch={interaction.touchPointer}
        start={editing.start}
        {toggle}
        select={(event) => editing.selection.activateOutput(start, event, expanded ? start + 1 : end)}
        inspect={() => (output.position = start)}
        open={(event) => {
          output.position = start
          void interaction.toggleView("Output", event)
        }}
        {drop}
        {dropPreview}
      >
        {#snippet origin()}{@render pageOrigin(output.pages[start], start)}{/snippet}
        {#snippet actions()}
          {@render occurrence(output.pages[start], start, true, end)}
          {@render peek(output.pages[start], start)}
        {/snippet}
      </SectionRow>
    {/snippet}
    {#snippet children(index, retained)}
      {@const page = output.pages[index]}
      {@const dropHere =
        !transfer.blocked &&
        transfer.inside &&
        (transfer.targetIndex === index || (transfer.target.kind === "append" && index === output.pages.length - 1))}
      {@const dropAfter = transfer.targetAfter || transfer.target.kind === "append"}
      <li
        id={`${key}-${page.id}`}
        class="list-row"
        aria-setsize={output.pages.length}
        aria-posinset={index + 1}
        data-retained={index === retained || undefined}
        data-returning={(interaction.returning?.kind === "output" && interaction.returning.id === page.id) || undefined}
        class:range-highlight={editing.selection.highlight?.kind === "output" &&
          editing.selection.highlight.ids.has(page.id)}
        data-index={index}
        class:selected={selectedIds.has(page.id)}
        data-dragging={transfer.moving(page.id) || undefined}
        data-drop={dropHere ? (dropAfter ? "after" : "before") : undefined}
        data-arriving={arriving.has(page.id) || undefined}
        data-adding={pendingAddition.has(page.id) || undefined}
        style:--drop-height={`${transfer.stripHeight}px`}
        onanimationend={(event) => {
          if (event.target === event.currentTarget && event.animationName === "row-enter") arriving.delete(page.id)
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
          toggle={(range) => editing.selection.selectOutput(page.id, range)}
          select={(event) => editing.selection.activateOutput(index, event)}
          open={(event) => void interaction.toggleView("Output", event)}
        >
          {#snippet origin()}{@render pageOrigin(page, index)}{/snippet}
          {#snippet actions()}{@render occurrence(page, index, true)}{/snippet}
          {#snippet preview()}{@render peek(page, index)}{/snippet}
        </Row>
      </li>
    {/snippet}
  </List>
{:else if output.pages.length}
  <Grid
    bind:this={view.grid}
    viewport={view.gridViewport}
    pane="Output"
    active={() => interaction.shortcutPane() === "Output"}
    sections={outputProjection}
    projecting={!!transfer.value}
    onfold={(folds) => (view.folds = folds)}
    bind:position={() => output.position, (position) => (output.position = position)}
    bind:offset={() => view.offset, (offset) => (view.offset = offset)}
    bind:keyboard={() => interaction.usingKeyboard, (keyboard) => (interaction.usingKeyboard = keyboard)}
    selected={(position) => selectedIds.has(output.pages[position]?.id)}
    toggle={(position) => editing.selection.selectOutput(output.pages[position].id, false)}
    edit={(action, first, end) =>
      action !== "add" &&
      editing.commandOutput(action, first === undefined ? undefined : { kind: "focused", first, end })}
  >
    {#snippet children(pages, headings, fold, folded)}
      {#each pages as index, offset (output.pages[index].id)}
        {@const page = output.pages[index]}
        {@const section = headings.get(index)}
        {@const pageOrigin = editing.provenance(page.content)}
        {@const place = transfer.preview?.positions.get(index)}
        <li
          id={`${key}-${page.id}`}
          aria-setsize={output.pages.length}
          aria-posinset={index + 1}
          data-index={index}
          data-section-end={section && folded.has(section.key) ? section.end : undefined}
          data-adding={pendingAddition.has(page.id) || undefined}
          {@attach pendingAddition.has(page.id) && inert}
          class={[
            "composition-card",
            {
              selected:
                section && folded.has(section.key)
                  ? editing.selection.selectedSection("Output", section.start, section.end)
                  : selectedIds.has(page.id),
              "grid-section-card": !!section,
              "grid-section-open": !!section && !folded.has(section.key),
            },
          ]}
          data-returning={(interaction.returning?.kind === "output" && interaction.returning.id === page.id) ||
            undefined}
          class:range-highlight={editing.selection.highlight?.kind === "output" &&
            editing.selection.highlight.ids.has(page.id)}
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
              ? editing.selection.selectedSection("Output", section.start, section.end)
              : selectedIds.has(page.id)}
            title={section && folded.has(section.key)
              ? "Select or unselect the entire folded section."
              : "Select pages to edit Output."}
            aria-keyshortcuts="ArrowLeft ArrowRight ArrowUp ArrowDown Shift+ArrowLeft Shift+ArrowRight Home End N P V Control+A Meta+A Escape Control+ArrowLeft Control+ArrowRight Meta+ArrowLeft Meta+ArrowRight Space Enter Plus - Delete"
            draggable="true"
            onmousedown={retainFocus}
            onclick={(event) => {
              editing.selection.activateOutput(
                index,
                event,
                section && folded.has(section.key) ? section.end : undefined,
              )
              if (event.detail) event.currentTarget.focus({ preventScroll: true })
            }}
            ondragstart={(event) => editing.start(event, { kind: "output", ids: [page.id] })}
            ondragend={() => transfer.end()}
          >
            {#if pageOrigin && "page" in page.content}<Pdf
                {...pageOrigin.preview.appearance(page.content.page)}
                pageNumber={page.content.page + 1}
                name={editing.pageName(page.content)}
                size={pageOrigin.input.sizes[page.content.page]}
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

          {@render occurrence(page, index, !chosen.length, section?.end)}
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
