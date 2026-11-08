# Flow View and Grid Scrolling Plan

> Status: implementation approved. Validated changes are published to `next` in checkpoints.

## Preparation

- [x] Read `roktas/ajans` guidance and the repository `AGENTS.md`.
- [x] Inspect the Web SPEC, VIEW, MEMO, affected components, styles, keyboard and transfer owners, and browser-test
      structure.
- [x] Create `next` from `main` at `bc6cc8e3e5d9e922f54212c5213f360da944335c`.
- [x] Publish this plan on `next`.
- [x] Obtain owner approval **before implementation** (2026-11-08).

## Scope and invariants

Replace Grid's finite batches and slider with a vertical, scrollable sequence inside the existing fixed pane content
frame. Remove the Compact Grid density entirely. Retain the existing **Normal** card dimensions, image geometry, fitted
columns, gaps, and shared Grid/Page alignment; do not optimize card size to fit extra rows. The visible frame, not the
number of cards, limits height.

Combine Grid and List into one **Flow** tab (four letters) with a Grid/List toggle inside that view's toolbar. Keep Page
separate and Style available for eligible Inputs. The toggle selects presentation only. It must not change page
identity, selection, Output, preparation, zoom, or inspect position. Each Input and Output retains its Flow mode and
relevant scroll positions.

Defer the Grid card footer redesign until the owner chooses its two direct controls. Make the back-page fold smaller
**in Grid only**. Preserve controls, selection, keyboard access, touch hit targets, drag and drop, focus behavior,
light/dark themes, and reduced motion.

The implementation must not add dependencies, compatibility shims for deliberately retired Compact/pagination behavior,
speculative data models, or generic helpers without a second real owner.

## Owners and boundaries

| Concern                                                        | Owner and review points                                                                                                        |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Per-pane active view, Flow mode, inspection, and return target | `interaction.svelte.ts`, with minimal orchestration in `Composer.svelte`; `App.svelte` only for the initial-view/tour boundary |
| Grid scroll, visible window, measurements, and keyboard cursor | `Grid.svelte`; reuse List's proven viewport concepts only when they represent the same contract                                |
| Card geometry and responsive frame limits                      | `frame.css`, `fit.ts`, `grid.css`; retain shared Page thumbnail/reference geometry                                             |
| Grid footer and back-page fold                                 | `cards.css`, `workspace.css`, existing Composer card snippets                                                                  |
| Page identity, selection, Output mutations                     | Existing Output/composition owners; no parallel view-specific selection state                                                  |
| Drag/drop geometry, preview and edge scrolling                 | `transfer.svelte.ts`, `drag.ts`, and existing motion rules                                                                     |
| Product behavior, visual requirements, test inventory          | `web/doc/SPEC.md`, `web/doc/VIEW.md`, `web/doc/MEMO.md`, Web README, Help/Tour, and existing browser tests                     |

Before splitting any file, map callers and data ownership. Extract only a cohesive responsibility that reduces coupling.
In particular, avoid another large state machine inside `Composer.svelte` or unrelated edits to `App.svelte`.

## Implementation checkpoints

### 0. Baseline and preview gate

- [x] Inspect the checkout's branch, HEAD, and dirty state before local work.
- [x] Reuse Vite preview; HTTP 200 at `http://127.0.0.1:5173/?demo` (container-local).
- [ ] Run existing focused Grid, List, selection, transfer, alignment, and keyboard tests against current behavior.
      Record failures rather than silently changing baselines.
- [ ] Capture baseline geometry and screenshots at affected phone, tablet, and split-view desktop widths; include both
      panes, themes, large page numbers, touch/fine pointer, and long labels.
  - [x] Baseline Normal card width: 148 px at 390/768/1440 px. Additional scenarios remain pending.

**Gate:** baseline evidence and a working preview URL. Do not begin a visual edit without it.

### 1. Simplify view ownership before feature changes

- [x] Audit the current `grid/list/page/style` tab state, Page return targets, per-Input state, Output state, demo/tour
      setup, and focus-routing callers.
- [x] Define one canonical pane view (`flow/page/style` for Input, `flow/page` for Output) and one Flow presentation
      mode (`grid/list`) per pane. Preserve independent inspection and viewport state.
- [x] Refactor only the state and routing boundaries needed for this distinction. Keep externally visible behavior
      unchanged until the tab change is enabled.
- [x] Align focused view-return, keyboard, input switching, and state-retention tests.

**Gate:** existing transitions, selection, Page return, and input switching still pass; no duplicate source of truth.

### 2. Retire Compact density

- [x] Remove automatic Compact selection, density controls, state, component props, Compact-only popover behavior,
      icons/styles, and density-specific tours/help text.
- [x] Remove Compact-only CSS calibrations and `fit.ts` branches while retaining every effective Normal card geometry
      rule, including valid touch/portrait calibrations.
- [ ] Retarget affected fixtures, measurement helpers, and browser expectations to the single Grid geometry. Keep real
      retained measurement evidence distinct from live assertions.
- [ ] Run focused Grid, geometry, touch, and alignment checks.

**Gate:** one Grid density remains; Normal card width, height, image bounds, and column spacing match baseline at each
relevant viewport.

### 3. Replace batches with scroll inside the fixed frame

- [x] Remove page-batch slider, arrows, markers, counters, snap-to-batch offsets, and pager-height reservation. Use a
      stable, thin vertical scrollbar in the pane gutter, as in List.
- [x] Render a bounded visible **row** window plus spacers for long documents. Derive row/column mapping from the same
      measured card geometry; preserve physical Input order and Output occurrence identity.
- [ ] Store and restore scroll position for each Input and Output; reveal the inspected item on Go to page, Contents
      navigation, Page return, selection navigation, and Input changes without unnecessary scroll jumps.
- [ ] Adapt arrow, Home/End, PageUp/PageDown, V, focus recovery, and Shift selection to a continuous Grid. Keep keyboard
      navigation across unmounted windows and enable native wheel/touch scroll.
- [ ] Update drag/drop hit testing, insertion previews, movement feedback, and edge autoscroll for a
      scrolling/virtualized Grid. Do not assume that a batch start, page-range attribute, or currently mounted card
      bounds the Output.
- [ ] Remove batch-specific `keyboard.ts` and transfer paths only after all callers are mapped; keep List/Page semantics
      intact.
- [ ] Align integration tests for scroll range, exact Go to page, continuity, long Input/Output, edits at window
      boundaries, and no horizontal overflow. Check Grid/List/Page shared frame alignment.

**Gate:** the full sequence is reachable, including 240+ pages; selection, editing, keyboard, touch, and drag/drop still
work across scroll windows, with unchanged card geometry.

### 4. Grid fold and deferred footer

- [ ] Revisit footer actions after the owner selects the two controls. No footer change in this iteration.
- [x] Reduce the back-page fold in Grid only; keep the Page fold and the card's page-number/grip alignment unchanged.
- [ ] Add focused browser assertions for control visibility, glyph centers, clickable bounds, keyboard focus, touch
      targets, selected/unselected states, and the smaller fold.

**Gate:** Grid fold is smaller with unchanged Page fold and card geometry. Footer redesign is deferred.

### 5. Enable the Flow tab and Grid/List toggle

- [x] Replace separate Grid/List tabs with **Flow**, keeping Page and eligible Style tabs. Provide a labeled,
      keyboard-accessible Grid/List toggle in the Flow toolbar, using existing control styles and symbols.
- [x] Wire the toggle to the canonical per-pane mode. Retain List folds/virtualized viewport and Grid scroll
      independently; preserve inspection, selection, and Page-to-origin return.
- [ ] Update tab focus, shortcuts, ARIA relationships, Go to page, Contents, tour targets, and narrow single-pane
      layouts.
- [ ] Align browser tests for toggle activation, focus, keyboard navigation, Input switching, Output independence, Page
      return, both themes, and normal/200% text.

**Gate:** one Flow tab per pane, two reliable presentation modes, no lost workspace state, and no toolbar wrapping.

### 6. Aggressive stale-code and document audit

- [ ] Search all affected code, tests, fixtures, CSS, docs, icons, Help, tours, measurement/calibration scripts, and
      test selection lists for Compact, density, batch, pagination, old tab names, unreachable branches, obsolete
      helpers, debug output, and unused imports.
- [ ] Delete only superseded implementation and its dependent tests/docs/config. Do not remove valid PDF/Page navigation
      or historical calibration evidence without separating it from active requirements.
- [ ] Update `SPEC.md`, `VIEW.md`, `MEMO.md`, Web README, UI glossary, keyboard/help descriptions, test runner groups,
      and relevant layout references to **current** behavior. Do not document migration history.
- [ ] Review the bounded affected surface, not just edited lines, for redundant state, accidental churn, unclear
      ownership, and unnecessary Svelte/CSS abstractions.
- [ ] Run narrow checks after each cleanup and inspect the final diff for unrelated changes.

**Gate:** no live Compact/pagination branches, tests, labels, CSS rules, or active documentation remain; no abandoned
files or new slop.

### 7. Validation and handoff

- [ ] Run formatting, lint, type checks, unit tests, and `npm run test:minimal`.
- [ ] Run `npm run test:standard` and focused Full browser matrices for Grid, List, transfer, Page, alignment, geometry,
      and viewport calibration where affected.
- [ ] Validate light/dark, keyboard, touch, fine pointer, reduced motion, 100%/200% text, 320/390/768 px and
      representative split-view desktop widths, 1–5 digit page numbers, selected/unselected and long-name cases.
- [ ] Compare screenshots and measured card geometry against the original Normal Grid; record any real difference and
      resolve it before handoff.
- [ ] Review the complete diff and docs once; remove disposable outputs and retain only required evidence in `.local/`.
- [ ] Mark each completed checkpoint here, report actual commands/results and any unverified physical-device behavior.

## Acceptance

A single Flow tab toggles between Grid and List in both panes. Grid shows all pages by vertical scroll inside its
existing fixed frame with a thin scrollbar, no Compact density and no pagination. Its Normal card geometry remains
unchanged and Grid back folds are smaller. The footer redesign is deferred. All page actions, selection, identity,
drag/drop, inspection, keyboard navigation, focus, and independent Input/Output state remain correct. Automated tests
and project documentation describe the resulting behavior.

## Execution note

Implementation was approved on 2026-11-08. Push validated checkpoints to `next` with the plan updated.

Progress: Flow modes and compact removal compile. Chromium passed Grid virtualization for 250/300 pages, responsive
scroll retention, Flow switching, fold, and two drag tests. `npm run check`, lint, format and unit tests pass. Broader
legacy browser tests and WebKit remain pending; WebKit lacks libicudata.so.78.
