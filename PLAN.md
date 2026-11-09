# Pages View and Grid Scrolling Plan

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

Combine Grid and List into one **Pages** tab (five letters) with a Grid/List toggle inside that view's toolbar. Keep
Page separate and Style available for eligible Inputs. The toggle selects presentation only. It must not change page
identity, selection, Output, preparation, zoom, or inspect position. Each Input and Output retains its Pages mode and
relevant scroll positions.

Defer the Grid card footer redesign until the owner chooses its two direct controls. Make the back-page fold smaller
**in Grid only**. Preserve controls, selection, keyboard access, touch hit targets, drag and drop, focus behavior,
light/dark themes, and reduced motion.

The implementation must not add dependencies, compatibility shims for deliberately retired Compact/pagination behavior,
speculative data models, or generic helpers without a second real owner.

## Owners and boundaries

| Concern                                                         | Owner and review points                                                                                                        |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Per-pane active view, Pages mode, inspection, and return target | `interaction.svelte.ts`, with minimal orchestration in `Composer.svelte`; `App.svelte` only for the initial-view/tour boundary |
| Grid scroll, visible window, measurements, and keyboard cursor  | `Grid.svelte`; reuse List's proven viewport concepts only when they represent the same contract                                |
| Card geometry and responsive frame limits                       | `frame.css`, `fit.ts`, `grid.css`; retain shared Page thumbnail/reference geometry                                             |
| Grid footer and back-page fold                                  | `cards.css`, `workspace.css`, existing Composer card snippets                                                                  |
| Page identity, selection, Output mutations                      | Existing Output/composition owners; no parallel view-specific selection state                                                  |
| Drag/drop geometry, preview and edge scrolling                  | `transfer.svelte.ts`, `drag.ts`, and existing motion rules                                                                     |
| Product behavior, visual requirements, test inventory           | `web/doc/SPEC.md`, `web/doc/VIEW.md`, `web/doc/MEMO.md`, Web README, Help/Tour, and existing browser tests                     |

Before splitting any file, map callers and data ownership. Extract only a cohesive responsibility that reduces coupling.
In particular, avoid another large state machine inside `Composer.svelte` or unrelated edits to `App.svelte`.

## Implementation checkpoints

### 0. Baseline and preview gate

- [x] Inspect the checkout's branch, HEAD, and dirty state before local work.
- [x] Reuse Vite preview; HTTP 200 at `http://127.0.0.1:5173/?demo` (container-local).
- [ ] Run existing focused Grid, List, selection, transfer, alignment, and keyboard tests against current behavior.
      Record failures rather than silently changing baselines.
  - [x] On the archived `f7fd4c8` checkout (not current `next`), Chromium passed three focused baseline tests: 250-page
        Grid virtualization and geometry at 390/768/1440 px; 300-page Grid scroll, selection, and Output; 10,000-page
        Output transfer with native/touch cancellation and drop (3/3). These are behavioral regression checks, not
        measured memory or interaction latency. Repeat against the current branch before closure.
- [ ] Capture baseline geometry and screenshots at affected phone, tablet, and split-view desktop widths; include both
      panes, themes, large page numbers, touch/fine pointer, and long labels.
  - [x] Baseline Normal card width: 148 px at 390/768/1440 px. Additional scenarios remain pending.

**Gate:** baseline evidence and a working preview URL. Do not begin a visual edit without it.

### 1. Simplify view ownership before feature changes

- [x] Audit the current `grid/list/page/style` tab state, Page return targets, per-Input state, Output state, demo/tour
      setup, and focus-routing callers.
- [x] Define one canonical pane view (`pages/page/style` for Input, `pages/page` for Output) and one Pages presentation
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
  - [x] Replace the geometry capture and viewport probes with current single-Grid measurements. Three Chromium viewport
        tests passed across phone, tablet, and split-view sizes; historical calibration references remain evidence.
  - [x] Replace the retired capacity matrices with responsive and touch scroll assertions (2/2 Chromium). Verify the
        card bounds and scrollbar frame (1/1 Chromium). Remaining browser groups require broader regression coverage.
- [ ] Run focused Grid, geometry, touch, and alignment checks.
  - [x] Chromium alignment tests passed for mouse (12 widths) and touch (26 widths), plus Style/Page frame, app header,
        and 10,000-page number/grip geometry. Removed the Page-only row-capacity width reduction. Page/Grid reference
        widths agree within 1 CSS px across checked sizes.

**Gate:** one Grid density remains; Normal card width, height, image bounds, and column spacing match baseline at each
relevant viewport.

### 3. Replace batches with scroll inside the fixed frame

- [x] Remove page-batch slider, arrows, markers, counters, snap-to-batch offsets, and pager-height reservation. Use a
      stable, thin vertical scrollbar in the pane gutter, as in List.
- [x] Render a bounded visible **row** window plus spacers for long documents. Derive row/column mapping from the same
      measured card geometry; preserve physical Input order and Output occurrence identity.
- [ ] Store and restore scroll position for each Input and Output; reveal the inspected item on Go to page, Contents
      navigation, Page return, selection navigation, and Input changes without unnecessary scroll jumps.
  - [x] Chromium verified Page-to-List and Page-to-Grid return, inspected-page highlight, and independent Grid/List
        scroll restoration in both panes. WebKit remains unverified.
- [ ] Adapt arrow, Home/End, PageUp/PageDown, V, focus recovery, and Shift selection to a continuous Grid. Keep keyboard
      navigation across unmounted windows and enable native wheel/touch scroll.
  - [x] Chromium verified Shift ranges, scroll-window navigation, and empty-Output focus recovery across Input and
        Output at 1440/390 px. Further touch and WebKit checks remain open.
  - [x] Chromium Touch Selection passed at 810/390 px, 100/200% text, and light/dark themes; broader touch and WebKit
        checks remain open.
- [ ] Update drag/drop hit testing, insertion previews, movement feedback, and edge autoscroll for a
      scrolling/virtualized Grid. Do not assume that a batch start, page-range attribute, or currently mounted card
      bounds the Output.
  - [x] Chromium verified native and touch transfers across 10,000 Output occurrences, including offscreen selected
        pages, cancellation, and drop (1 focused regression).
- [ ] Remove batch-specific `keyboard.ts` and transfer paths only after all callers are mapped; keep List/Page semantics
      intact.
- [ ] Align integration tests for scroll range, exact Go to page, continuity, long Input/Output, edits at window
      boundaries, and no horizontal overflow. Check Grid/List/Page shared frame alignment.
  - [x] Chromium verified 1,000/10,000-row List virtualization, ranges, Page returns, and removal (1/1). Contents jumps
        to exact pages across Grid, Page, and List without changing selection (1/1).
  - [x] Chromium checked Grid scrolling to the last page and status clearance at six viewport/text sizes (7/7); expanded
        desktop Page fitting and Input-to-Output copy previews passed (1/1).
  - [x] Chromium verified PageUp/PageDown, Home/End, Input/Output selection independence (1 test), and shared Grid/Page
        frame, fitted PDF geometry, themes, responsive zoom, and empty Output (10 subtests).
  - [x] Chromium verified Contents jumps, touch drag previews, Grid/List/Page return, footer hover/touch controls, and
        page-name disclosure layout (5 focused regressions). WebKit remains pending on Ubuntu 26.04.
  - [x] Chromium Grid/Page selection, zoom, inspection, and focus regression uses virtual page reveal instead of the
        removed thumbnail range slider; focused test passed.
  - [x] Chromium verified unused and modified Grid keys, native shortcut priority, focus, and pane isolation with Pages
        tab selectors.
  - [x] Chromium selection menus, toolbar actions, and mouse/keyboard shortcut priorities passed (3 focused tests).
        Pages tab takes focus after Escape and after removing the last Output page.
  - [x] Chromium verified demo Output order by physical occurrence across the scroll window and Input gesture
        cancellation after switching Inputs; both focused browser tests passed.

**Gate:** the full sequence is reachable, including 240+ pages; selection, editing, keyboard, touch, and drag/drop still
work across scroll windows, with unchanged card geometry.

### 4. Grid fold and deferred footer

- [ ] Revisit footer actions after the owner selects the two controls. No footer change in this iteration.
- [x] Reduce the back-page fold in Grid only; keep the Page fold and the card's page-number/grip alignment unchanged.
- [ ] Add focused browser assertions for control visibility, glyph centers, clickable bounds, keyboard focus, touch
      targets, selected/unselected states, and the smaller fold.
  - [x] Chromium Grid grip touch hit area passed at 390/440 px: Input and Output upper-edge/center taps select exactly
        once; existing grip, drag, and press regressions passed (4/4). WebKit remains unverified.
  - [ ] Output footer action hit testing at 440 px fails at its lower one-pixel boundary. The footer redesign remains
        deferred pending the owner's two-control decision.

**Gate:** Grid fold is smaller with unchanged Page fold and card geometry. Footer redesign is deferred.

### 5. Enable the Pages tab and Grid/List toggle (superseded by 5c)

- [x] Replace separate Grid/List tabs with **Pages**, keeping Page and eligible Style tabs. Provide a labeled,
      keyboard-accessible Grid/List toggle in the Pages toolbar, using existing control styles and symbols.
- [x] Wire the toggle to the canonical per-pane mode. Retain List folds/virtualized viewport and Grid scroll
      independently; preserve inspection, selection, and Page-to-origin return.
- [ ] Update tab focus, shortcuts, ARIA relationships, Go to page, Contents, tour targets, and narrow single-pane
      layouts.
- [ ] Align browser tests for toggle activation, focus, keyboard navigation, Input switching, Output independence, Page
      return, both themes, and normal/200% text.
  - [x] Chromium workspace toolbar alignment passed across 9 viewport, theme, text-size, and font combinations; the test
        now checks the Pages toggle instead of the retired Compact density switch.
  - [x] Chromium pane-toolbar alignment passed at 320–951 px, both themes, 100/200% text, and empty/populated Output.
        Removed stale narrow-screen Grid-icon offset after Pages replaced Grid/List tabs.
  - [x] Chromium tour regression passed including 320 px width with 200% text. Reset scroll when a tour step changes,
        even if the next target reuses the same pane element.

**Historical gate (superseded by 5c):** one Pages tab per pane, two reliable presentation modes, no lost workspace
state, and no toolbar wrapping.

### 5a. Refactor Flow view vocabulary to Pages (owner decision, 2026-11-09)

- [x] Rename the **Flow** view concept to **Pages** throughout the application, not only the visible tab text. **Pages**
      manages all document pages in Grid or List; **Page** inspects one page. Preserve behavior, page identity,
      selection, Input/Output independence, inspection returns, and scroll restoration.
- [x] Refactor the complete workspace-view lexicon: internal view values, types, fields, functions, local variables,
      constants, selectors, tour targets, accessible names, keyboard and test helpers, test descriptions, and any
      related CSS class names. Replace rather than alias retired view names; do not retain compatibility shims without a
      real external or persisted contract.
- [x] Align Help, Product Tour, UI glossary, `SPEC.md`, `VIEW.md`, `MEMO.md`, Web README, and relevant tests with
      **Pages** and **Page**. Search case-insensitively for the former view name across the affected repository. Keep
      unrelated terms such as CSS normal flow, reflow, and general data/control flow unchanged.
- [x] Verify Pages/Page tab focus, Grid/List switching, Page returns, Input switching, Output independence, keyboard
      navigation, Tour, accessibility, narrow layouts, and both themes in Chromium.

  - [x] Eight focused Chromium regressions passed: independent Input/Output Pages layouts, switching Inputs, Tour
        restoration, empty-Output tour, keyboard/selection returns, Page inspection, responsive toolbar geometry, and
        shortcut Help. The toolbar matrix covered 320–1280 px, light/dark themes, and 100%/200% text. Node 24 format,
        lint (0 errors, 26 existing warnings), type checks, and 52/52 unit tests passed. The Svelte autofixer CLI was
        unavailable from the offline npm cache; `svelte-check` passed instead.

**Gate:** The view has one canonical name, **Pages**, in code, tests, and current product documentation. No stale
**Flow**-view identifier or user-facing label remains; behavior and geometry stay unchanged.

### 5b. Represent Pages with a multi-page icon (superseded by 5c, 2026-11-09)

- [x] Replace the Pages tab icon with a recognizable stack of document pages, distinct from the single-page **Page**
      icon. Keep the existing icon name, accessible tab label, SVG size, and focus and interaction behavior.
- [x] Verify the Input and Output Pages icons in Chromium at narrow and wide widths, both themes, and enlarged text.
      Compare icon and label alignment, and run the relevant focused checks.

  - [x] Chromium checked visible glyph alignment and overflow in 32 states: 320/390/768/1440 px, 100%/200% text,
        light/dark themes, and both panes. The focused workspace toolbar regression passed (1/1). Node 24 formatting,
        type checks, and 52/52 unit tests passed; lint reported 0 errors and 26 existing warnings.

**Historical gate (superseded by 5c):** Both Pages tabs use the same page-stack glyph without layout or behavior
regressions.

### 5c. Replace the Pages mode toggle with direct Grid and List tabs (owner decision, 2026-11-09)

- [x] Display separate **Grid** and **List** tabs, each with its own glyph, beside **Page** in Input and Output.
      **Pages** remains the collective term for whole-document views; do not rename document/page concepts.
- [x] Remove the Pages toggle button and its stale target, CSS, labels, and keyboard path. Preserve each pane's selected
      mode, Input switching, and the last whole-document view when returning from Page or Style.
- [x] Update Product Tour guidance and targets, Help, SPEC, VIEW, glossary, and browser expectations for direct tabs.
      Preserve the established toolbar geometry, focus and accessible tab semantics, and responsive layout.
- [x] Test both panes at phone and desktop widths, keyboard navigation, Page return, Input changes, and Product Tour.
      Run focused Chromium checks, type checks, formatting, lint, and unit tests before closing this checkpoint.
  - [x] Product Tour, direct Grid/List/Page tab navigation, and Page pinch-cancellation Chromium regressions passed
        (3/3). The direct-tab test covered both panes at 320/1440 px, keyboard focus, and Page return. Node 24
        formatting, lint (0 errors), Svelte/TypeScript (0 errors, 0 warnings), and 52/52 unit tests passed.
  - [x] The complete minimal Chromium matrix passed (21/21) on the current direct-tab checkout with WebKit disabled.
        Standard/full browser matrices and physical-device validation remain pending under stage 7.

**Gate:** Grid and List use separate one-click tabs in both panes. No live Pages-toggle path remains.

### 6. Aggressive stale-code and document audit

- [ ] Search all affected code, tests, fixtures, CSS, docs, icons, Help, tours, measurement/calibration scripts, and
      test selection lists for Compact, density, batch, pagination, old tab names, unreachable branches, obsolete
      helpers, debug output, and unused imports.
  - [x] Replaced Compact-dependent navigation and Input-addition test variants in `composition.test.js` with explicit
        light/dark and button/keyboard cases; retained 12/13-page additions. Node 24 file-level syntax, formatting,
        lint, Svelte/TypeScript checks, and 52 unit tests passed. The complete formatter and Chromium E2E checks still
        require a current checkout; the old archive has a formatting difference in interaction.svelte.ts.
  - [x] Removed two single-density wrappers, unreachable Compact action branches, and a stale batch comment from
        `composition.test.js`. Card, selection, keyboard, Page, addition, removal, and movement checks remain. Node 24
        syntax, formatting, lint, and 52 unit tests pass. Chromium E2E needs the complete current checkout.
  - [x] Removed a runner-selection assertion for a superseded partial-Grid-batch test name. Positive checks for minimal,
        standard, full, and calibration selection remain. Node 24: 52 unit tests, file format, and lint pass.
  - [x] Removed unreachable Compact drag-preview thresholds and a single-value density loop from the selection tests.
        The focused Chromium drag/drop regression passed (1/1) on the archived `f7fd4c8` app with this exact test body.
        Node 24 syntax, formatting, lint, and 52 unit tests passed. Current-branch E2E remains unverified.
  - [x] Removed the singleton Normal density loop from the long-name List regression. Existing Input/Output, light/dark,
        selected/unselected, and 100%/200% coverage remains. Chromium passed the focused test (1/1) on the archived
        `f7fd4c8` app with this exact test body; file syntax, formatting, and lint pass. Current-branch E2E is pending.
  - [x] Removed the singleton Normal density loop from the toolbar alignment test. Chromium passed the focused test
        (1/1) on the archived `f7fd4c8` app across eight widths, two themes, two text scales, and populated/empty cases.
        The edited test block matches the remote source; syntax, formatting, and lint pass. Current-branch E2E remains
        pending.
  - [x] Removed four empty calibration media/container rules from `frame.css`; retained all active viewport rules. Node
        24 production build, Svelte/TypeScript, and CSS formatting pass. Chromium frame/card bounds are identical before
        and after at 390/light, 768/dark, and 1440/light. Current-branch full E2E remains pending.
  - [x] Matched the List scrollbar to Grid with `scrollbar-width: thin` and aligned VIEW guidance. Chromium checked
        Input/Output at 390/1440 px in both themes (8 cases): each gutter measures 10 px, versus List's prior 15 px. The
        focused 300-page Grid regression and the new scrollbar check passed (2/2). Node 24 Svelte/TypeScript and 52 unit
        tests pass; lint reports 0 errors and 26 existing warnings. Broader browser coverage remains pending.
- [ ] Delete only superseded implementation and its dependent tests/docs/config. Do not remove valid PDF/Page navigation
      or historical calibration evidence without separating it from active requirements.
- [ ] Update `SPEC.md`, `VIEW.md`, `MEMO.md`, Web README, UI glossary, keyboard/help descriptions, test runner groups,
      and relevant layout references to **current** behavior. Do not document migration history.
  - [x] Replaced active Compact/pagination test guidance in Web MEMO and the large Grid fixture README.
  - [x] Removed obsolete Compact advice from Help and updated the Grid keyboard measurement comment. Node 24 checks and
        focused Chromium Page regressions passed (2/2).
  - [x] Removed obsolete Normal/Compact capacity-table wording from current VIEW guidance and explicitly dated the
        earlier Android Style/Compact Chromium result in MEMO. Historical measurements remain intact. Affected documents
        passed Oxfmt; no browser behavior changed.
  - [x] Updated acceptance and execution notes for the direct Grid/List tabs. Marked the earlier Pages-toggle and
        stacked-icon gates as historical decisions superseded by 5c. Current behavior is described only by the new gate.
- [ ] Review the bounded affected surface, not just edited lines, for redundant state, accidental churn, unclear
      ownership, and unnecessary Svelte/CSS abstractions.
- [ ] Run narrow checks after each cleanup and inspect the final diff for unrelated changes.

**Gate:** no live Compact/pagination branches, tests, labels, CSS rules, or active documentation remain; no abandoned
files or new slop.

### 7. Validation and handoff

- [ ] Run formatting, lint, type checks, unit tests, and `npm run test:minimal`.
  - [x] On current `next` (`4f66ebe`), Node 24.21.0 passed format (153 files), lint (0 errors, 28 warnings),
        Svelte/TypeScript checks (0 errors and warnings), 52/52 unit tests, and the Chromium minimal browser
        matrix (21/21). The chained minimal command was not rerun; WebKit remains deferred.
  - [x] Chromium passed Grid image/grip selection, selection-preserving drags, and production Input-switch
        thumbnail/Lens rendering (3/3 focused tests). Legacy Grid sliders were replaced with native scroll-to-start.
  - [x] Node 24: format and type checks passed, lint reported 0 errors (26 existing warnings), 52/52 unit tests passed.
        Full minimal/standard suites and WebKit are still open.
  - [x] Chromium startup regression verified early PDF preview, cancellation, invalid PDF rejection, and completed Pages
        initialization (1/1 focused test). Retired Compact density and unconditional Origin-detail expectations removed.
  - [x] Chromium verified large-Input PDF reuse, provenance, Page/Compare returns, and Output edits (1/1 focused test).
        Removed two obsolete direct Grid tab selectors.
- [ ] Run `npm run test:standard` and focused Full browser matrices for Grid, List, transfer, Page, alignment, geometry,
      and viewport calibration where affected.
  - [x] The pre-fix `4f66ebe` checkout completed `npm run test:standard` with WebKit disabled. Production build,
        format, lint, 52 unit tests, and TypeScript/Svelte checks passed. The Chromium browser suite ran 247 tests:
        230 passed, 15 failed, one timed out/cancelled, and one skipped. Generated Recipe fixtures are missing;
        the four Recipe-check tests failed. Other failures need isolated investigation. Standard is not passing.
  - [x] Fixed stale browser assertions: Page counter screenshots referenced removed `density`, and the Workspace
        layout test queried four tabs as one. Both focused Chromium reruns passed (2/2), with format, lint (0 errors,
        28 warnings), TypeScript/Svelte checks (0 diagnostics), and 52/52 unit tests. The standard suite needs
        another run after other failures are resolved.
  - [x] Current-branch `npm run test:browser -- standard grid` with WebKit disabled: 92 checks, 86 passed, five failed,
        and one cancelled (the 30-second long-List test). Other failures include two Grid label/detail waits, a 320 px
        Input hit area, the already-deferred 440 px Output footer hit area, and a narrow List heading-toolbar alignment
        assertion. This is incomplete regression evidence, not a passing standard suite. Investigate and rerun failures.
  - [x] Updated the narrow List toolbar test for the direct Grid tab. The glyph remains centered in its 44 px tab; the
        Go to page glyph keeps its 4 px trailing inset. VIEW now describes the direct-tab layout. The focused
        current-source Chromium test passed (1/1). Formatter and file lint passed (0 errors, 10 existing warnings).
  - [x] Fixed Grid column-change restoration near the end of a long document. Wait for the reactive virtual spacer
        heights before setting `scrollTop` to the preserved physical-page anchor. On the current Chromium source, the
        300-page wide-to-narrow regression and page-295 Details/Contents regression passed (2/2). Node 24
        Svelte/TypeScript checks and 52/52 unit tests passed; lint reported 0 errors and 28 warnings.
  - [x] Kept Grid header/footer 44 px hit areas inside scroll clipping and prevented the touch grip pointer-up from
        generating a second selection through a retargeted click. The current Chromium 320/390/412/440 px Grid target
        test passed with 100%/200% text and both panes (1/1). The focused 440 px Output footer test passed (1/1). Node
        24 Svelte/TypeScript and 52/52 unit tests passed; lint reported 0 errors and 28 warnings. The full footer matrix
        still needs a rerun.
- [ ] Validate light/dark, keyboard, touch, fine pointer, reduced motion, 100%/200% text, 320/390/768 px and
      representative split-view desktop widths, 1–5 digit page numbers, selected/unselected and long-name cases.
- [ ] Compare screenshots and measured card geometry against the original Normal Grid; record any real difference and
      resolve it before handoff.
  - [x] Chromium captured 16 comparison screenshots for the original `f7fd4c8` and pre-review `4f66ebe`, both
        panes at 390/light/100%, 768/dark/100%, 1440/light/100%, and 390/dark/200%. At 100%, card (148 × 240 CSS
        px), image (134.81 × 172 CSS px), and column gap (12 CSS px) match in both panes with identical bounds. At
        390/dark/200%, Input matches, but Output grid and card/image widths grow by 10 CSS px, consistent with the
        deliberately thinner scrollbar. Broader screenshot checks and visual signoff remain open. Retained evidence:
        `.local/var/measurements/grid/` in this checkout (ignored by Git).
- [ ] Review the complete diff and docs once; remove disposable outputs and retain only required evidence in `.local/`.
- [ ] Mark each completed checkpoint here, report actual commands/results and any unverified physical-device behavior.

### 8. Final adversarial review and performance audit (owner request, 2026-11-09)

Preserve every owner question as an explicit review item. Inspect the affected code and its callers, not only the
changes in this branch. Record each finding with file/line evidence, impact, proposed action, and the tests or
measurements that support the judgment. Do not report a hypothetical cost as a measured defect.

#### Code quality, data structures, and ownership

- [ ] **Is there slop code?**
- [ ] **Which parts of the code have low quality?**
- [ ] **Can the data structures be enriched?**
- [ ] **Are concerns separated correctly?**
- [ ] **Is there duplicate code?**
- [ ] **Is common logic managed in the right place?**
- [ ] **Does the implementation follow Svelte, TypeScript, and CSS best practices?**
- [ ] **Are there hidden state machines? If so, can their states and transitions be managed more correctly?**

#### Leftovers and documentation

- [ ] **Is there leftover or stale code?**
- [ ] **Is there leftover or stale content?**
- [ ] **Are the documents aligned?**

#### Tests

- [ ] **Are any tests missing or inadequate?**
- [ ] **Are any tests unnecessary or useless?**

#### Performance and cost

- [ ] **Are there obvious performance problems?**
- [ ] **Is the code suboptimal?**
- [ ] **Are there unnecessary costs?**
- [ ] Review Grid/List virtualization, large Inputs and Output occurrences, repeated computations, Svelte reactive
      dependencies, DOM measurements, mounting and rendering, scroll/drag handling, worker interactions, PDF preview
      memory, and cleanup. Measure reproducible problems before optimizing; retain useful baseline and after-change
      evidence for any performance claim.
  - [x] Removed-Input lifecycle: `Composer.svelte` retained view choices and Grid/List viewport caches for deleted
        Inputs while other Inputs remained. Prune stale IDs when `sources` changes. The Input-switch regression now
        covers removal and a newly opened Input; focused Chromium passed (1/1). Node 24 format, lint (0 errors, 28
        warnings), Svelte/TypeScript checks (0 errors and warnings), and 52/52 unit tests passed. No heap reduction
        was measured.

#### Closure

- [ ] Fix confirmed defects and unnecessary complexity with small, behavior-preserving changes. Add or repair tests at
      stable user-visible seams. Do not add abstractions or data fields without a demonstrated need.
- [ ] Record positive findings and unresolved risks as well as defects. Distinguish verified behavior, partial evidence,
      untested physical-device behavior, and performance hypotheses.
- [ ] Update this plan after each validated checkpoint and immediately commit and push that checkpoint to `next`. Review
      the final diff for stale vocabulary, leftover code/content, unrelated churn, and documentation drift.

**Gate:** Every question above has an evidence-based answer. Confirmed in-scope issues are corrected and validated;
remaining risks are explicit. WebKit remains deferred by owner decision.

## Acceptance

Grid and List have separate direct tabs beside Page in both panes; **Pages** remains the collective term for these
whole-document views. Grid shows all pages by vertical scroll inside its existing fixed frame. Grid and List use the
same thin scrollbar. No Compact density or pagination remains. Normal card geometry is unchanged and Grid back folds are
smaller. The footer redesign is deferred. Page actions, selection, identity, drag/drop, inspection, keyboard navigation,
focus, and independent Input/Output state remain correct. Tests and documents describe the current UI.

## Execution note

Implementation was approved on 2026-11-08. Push validated checkpoints to `next` with the plan updated.

Progress: separate Grid/List/Page tabs and Compact removal compile. Chromium passed direct-tab focus and return tests,
Product Tour, and 21/21 minimal browser regressions. Node 24 Svelte/TypeScript, lint, formatting, and 52/52 unit tests
pass. The standard/full browser matrices and WebKit remain pending. WebKit requires GLIBC_2.43 and cannot run on this
Debian 13 host.
