# Mainz review

What this repo does: Mainz composes PDF pages and edits declared paint in prepared PDFs. PDF Composer runs the shared
processor in a local browser workspace. This review assumes one person per workspace, up to the documented 10,000 Output
pages and 32 referenced Inputs.

Review date: 2026-10-23. Baseline: `4da31ea` on `main`, initially clean.

## Scope and result

The review covers web components and styles, test assertions and scenario loops, test orchestration, and all tracked
documentation. Library inspection follows the contracts and test boundaries relevant to these findings. It is not a
complete C++ implementation audit.

The initial audit found two behavior or contract mismatches, one undocumented diagnostic value, one gap in the visual
test assertions, and four smaller maintenance findings. No P1 failure was established. File length alone did not justify
a finding or a component split.

The test inventory contains 142 JavaScript/TypeScript cases, 71 Ruby cases, and 13 Simulator entrypoints before this
change. The JavaScript count includes the two generated mouse/touch alignment cases. Nested subtests and the sequential
WASM harness are listed with their parent or harness. One redundant model case was removed. The remaining named case
count was 225 across these three runners. The follow-up adds one producer regression and one Page-label regression,
bringing the current count to 227.

The initial audit removed that test and improved the three module READMEs. The follow-up implements findings 1–8 and the
localized documentation changes. All module READMEs remain in place. Broader validation also exposed the shutdown
failure in finding 9. Its unsafe Cairo debug reset was removed.

## Follow-up changes

Findings 1–8 describe baseline `4da31ea`. Their source-line links point to that revision. The test inventory links point
to the current files. Validation results for the follow-up appear at the end of this report.

| Finding               | Applied change                                                                                                                               |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| 1. Output labels      | Original PDF labels follow Output occurrences. Page control fitting reserves label space and uses the existing overflow menu.                |
| 2. Producer order     | Unlisted parameters use ID order. The reactor and second JSON parse are removed. Explicit arrays retain their order.                         |
| 3. Error source       | Library and CLI documentation define declaration parse diagnostics. The existing rejection test checks source and location.                  |
| 4. Grid bounds        | Reference tests and calibration share per-grid visual bounds, including minimum separation. A negative floor case uses a real captured grid. |
| 5. Tour               | The duplication sentence places copies after the last selected page.                                                                         |
| 6. Asset integration  | The unchanged integration case moves to the standard/full startup group. Minimal keeps the fast unit checks.                                 |
| 7. Native CI          | The native job defers contract tests to the existing parity prerequisite. Sanitizer and standalone tasks retain full coverage.               |
| 8. Production fixture | Source switching and offline scenarios share one scoped production build, with separate preview servers and browser storage.                 |
| 9. Renderer shutdown  | The SVG command no longer resets Cairo globals; font-cache cleanup remains. Rejected text and images must return validation exit code 1.     |

No shared browser process or loaded-document cache was added. Unmeasured matrix reductions remain optional experiments.

## Must fix

### 1. P2: Output Page omits the PDF page label

- What this is: Page shows a physical position and, for Input, the PDF's separate page label.
- Problem: Open a PDF with Roman labels and add pages `2,1`. Input shows `1 / 3` and `i`, but Output shows only `1 / 2`.
  Its first page loses the identifying label `ii`. This contradicts
  [Web SPEC](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/doc/SPEC.md#L69).
- Fix: Resolve the inspected Output occurrence's original Input label and show it beside the Output counter. Keep the
  physical Output position. Add one browser regression with reordered labels, a repeated page, and a Blank.
- If skipped: Readers cannot identify appendix or front-matter pages by their published labels while arranging Output.

Input renders the label at
[Composer.svelte](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/src/Composer.svelte#L1203).
The Output heading at
[Composer.svelte](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/src/Composer.svelte#L1410)
has no equivalent. The existing Input-only assertion at
[startup.test.js](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/test/startup.test.js#L963)
checks suppression of a redundant numeric label.

Confirmed in Chromium. [Screenshot](.local/var/review/xray/labels.png) and
[three-page input](.local/var/review/xray/labels.pdf) are retained locally. These evidence files are outside Git.

### 2. P2: The producer gives JSON object order a presentation meaning

- What this is: Without explicit groups, SVG production creates an Other controls group.
- Problem: Two declarations with identical members produce different control order when the parameter object changes
  from `z,a` to `a,z`. The library says object order has no meaning and unlisted parameters use ID order.
- Fix: Iterate the parsed parameter map in ID order. Remove the second JSON parse and its `Order` reactor. Preserve
  explicit group arrays. Add one producer regression with reversed object members.
- If skipped: JSON serialization changes can reorder controls, and producers cannot rely on the documented ordering
  rule.

The conflicting rules are in
[encoding](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/doc/SPEC.md#L168) and
[presentation groups](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/doc/SPEC.md#L239).
[producer.cpp](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/src/producer.cpp#L18)
defines the reactor.
[producer.cpp](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/src/producer.cpp#L98)
reparses the object to recover member order. This is a concrete simplification opportunity: roughly 25 lines and one
extra parse can disappear.

Confirmed with the existing native CLI: the two generated group parameter arrays were `["z","a"]` and `["a","z"]`. The
[declarations](.local/var/review/xray/order-za.json), [reversed declaration](.local/var/review/xray/order-az.json), and
[SVG](.local/var/review/xray/order.svg) are retained locally. Existing PDFs already contain explicit group arrays, so
the proposed fix does not require rewriting their presentation.

## Should fix

### 3. P2: Producer JSON errors have no documented source enumeration

- What this is: Structured errors identify the JSON input responsible for a failure.
- Problem:
  [Library SPEC](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/doc/SPEC.md#L648)
  defines `manifest` and `request` for processor errors. A malformed SVG declaration returns
  `{"code":"invalid-contract","source":"declaration","location":""}` with exit code 1. Neither the producer section nor
  CLI diagnostics defines this additional source value.
- Fix: Document `declaration` for producer input in the library error contract and link that rule from CLI SPEC. Add the
  source and location to the existing malformed-declaration assertion.
- If skipped: Callers have no complete documented set of JSON input sources for `produce` diagnostics.

The producer calls `parse(bytes, "declaration")` at
[producer.cpp](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/src/producer.cpp#L38).
The parser preserves that value at
[contract.cpp](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/lib/src/contract.cpp#L116).
The web protocol serves processor workers, so its narrower source type does not need a producer-only value.

### 4. P2: Two Grid assertion paths enforce different minimum gaps

- What this is: `quality()` judges calibration captures. `checkGrid()` judges several browser reference cases.
- Problem:
  [quality.ts](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/test/quality.ts#L44)
  enforces an 8 px minimum with the existing pixel allowance.
  [checkGrid](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/test/grid.test.js#L650)
  duplicates much of that logic but omits this minimum. A 6 px gap with a 7 px image margin passes its gap comparisons,
  although `quality()` rejects it.
- Fix: Share the single-grid visual bounds between these two test paths. Keep paired-density rules separate. Add one
  small rejection case for a gap below the floor.
- If skipped: Some expensive reference cases can pass with spacing that the calibration tool rejects.

This is an assertion gap, not evidence that the current UI renders 6 px gaps. The existing hit-target tests remain
useful and must stay.

## Nice to have

### 5. P3: The tour describes the wrong duplication position

- What this is: The Output selection tour explains the shared action bar.
- Problem:
  [Tour.svelte](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/src/Tour.svelte#L138)
  says copies appear beside their originals. For A B C D with A and C selected, the implementation produces A B C A C D.
- Fix: Say that + inserts the copied selection after the last selected page. Keep the existing behavior and behavioral
  tests. A text-equality test adds little value.
- If skipped: The tour teaches a different arrangement from the action users perform.

[composition.ts](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/src/composition.ts#L56)
and [Web SPEC](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/doc/SPEC.md#L133) agree
on the actual behavior.

### 6. P3: The fast unit command also performs asset integration work

- What this is: `npm test` selects every `.test.ts` file, including
  [assets.test.ts](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/test/assets.test.ts#L8).
- Problem: That case launches Vite subprocesses, copies PDF.js, and creates several servers. Its current body took 4.72
  seconds. The other three selected files together finished in 0.36 seconds after this change.
- Fix: Keep this valuable integration test, but run it with the standard/full asset checks. Keep model, offline, and
  runner tests in the quick unit command. Update the runner, npm commands, and documentation together.
- If skipped: Every minimal check pays the asset integration cost, even for a small model or prose change.

The measured saving available here is approximately this single test's cost on this host. It is not a benchmark of a
revised full gate. Package hashes, atomic publication, and concurrent-server checks must remain covered before pushes.

### 7. P3: Native CI runs the complete contract suite twice

- What this is: WASM parity consumes files generated by the native contract tests.
- Problem: The native job runs `test:native`, then `test:wasm`.
  [Rakefile](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/Rakefile#L428) makes parity
  depend on the complete contract suite, so the same native contract assertions and rasters run again.
- Fix: In the native CI job, defer its contract run to the existing parity prerequisite. Run producer, CLI, inspector,
  and package checks first. Keep standalone native and parity commands complete.
- If skipped: The native job repeats fixture production, CLI operations, and 150/300 DPI rendering before parity.

The two calls are at
[check.yml](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/.github/workflows/check.yml#L92)
and
[check.yml](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/.github/workflows/check.yml#L101).
CTest already supports selecting the other native cases with `ctest --preset native -E '^contract$'`. This avoids a new
fixture cache or a second fixture framework. Sanitizer coverage remains independent and necessary. The retained older
native run spent 14.33 seconds in contract tests, which is historical context rather than a current saving measurement.

### 8. P3: Source-switching coverage builds a separate production application

- What this is:
  [startup.test.js](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/test/startup.test.js#L1322)
  verifies that thumbnails and lenses follow the chosen Source.
- Problem: This test creates another production build and preview server. The same file already builds a production
  application for offline and scoped-startup coverage.
- Fix: Reuse that production fixture for the Source-switching scenario, with a fresh context. Keep its exact pixel,
  density, and lens assertions. Keep the dev-server-during-build test independent because it tests a different boundary.
- If skipped: Each startup run recompiles the application solely to repeat a production setup.

The proposed reuse is limited to immutable production assets. A prior local experiment found that reusing one loaded
document across viewport references made those tests slower. Do not revive that experiment or share mutable browser
contexts.

## Additional must-fix finding

### 9. P2: SVG rejection can abort during renderer-cache cleanup

This additional finding came from follow-up native validation, rather than the initial audit.

- Problem: `test_selected_text_and_images_are_rejected` aborted in `_cairo_hash_table_destroy` instead of returning a
  structured validation failure. The assertion reported a nonempty cache at destruction.
- Cause: The CLI's scope destructor reset Cairo and Fontconfig globally after releasing only the current Pango font map.
  Cairo requires all Cairo objects to be gone before a debug reset. Pango's default-map reset affects only the current
  thread. Those APIs do not establish ownership of every renderer cache. This is an inference from the failure and API
  contracts, not a traced identification of the remaining object. See the
  [Cairo contract](https://cairographics.org/manual/cairo-Error-handling.html#cairo-debug-reset-static-data) and
  [Pango contract](https://docs.gtk.org/PangoCairo/method.FontMap.set_default.html).
- Fix: Remove only `cairo_debug_reset_static_data()`. Keep Pango and Fontconfig cache cleanup. Removing all cleanup
  exposed Fontconfig leaks under LeakSanitizer. Scoped producer objects still use RAII. The existing text/image
  rejection case also asserts exit code 1.
- Evidence: [Failed native run](.local/var/review/xray/native-shutdown-failure.log). Twenty focused visible-text calls
  did not reproduce the abort, so the failure's frequency is unknown. No automatic retry was added.

## Visual review evidence

The review exercised the maintained demo at 1440 × 1000, 744 × 1133, 390 × 844, and 320 × 568. Samples cover Grid, Page,
Style, both themes, and enlarged text. Additional samples cover Compact details, Output Page, Settings, and custom PDF
labels. No persistent horizontal overflow or overlapping primary controls was established in these samples.

The phone Output capture completed at 161% initial zoom with a 291.42 px image inside a 356 px viewport. Its
`scrollWidth` and `clientWidth` were both 356 px. An early screenshot taken during rendering looked cropped. The
completed capture waited for fonts, finished PDF rendering, and 30 animation frames. It did not reproduce that
appearance, so it is not a defect finding.

Selected evidence outside Git:

| Capture                                                               | Purpose                                              |
| --------------------------------------------------------------------- | ---------------------------------------------------- |
| [Desktop Page](.local/var/review/xray/desktop-page-light.png)         | Paired frames and navigation at normal text size.    |
| [Desktop Style](.local/var/review/xray/desktop-style-dark.png)        | Dark controls and the companion Output frame.        |
| [Phone Grid](.local/var/review/xray/phone-grid-dark.png)              | Narrow selected cards and pagination.                |
| [Compact details](.local/var/review/xray/compact.png)                 | Larger preview and individual actions in dark mode.  |
| [Completed phone Page](.local/var/review/xray/output-phone-ready.png) | Initial zoom and horizontal fit.                     |
| [Settings at 200%](.local/var/review/xray/settings-small.png)         | Short viewport, wrapped metadata, and full controls. |
| [Labeled PDF](.local/var/review/xray/labels.png)                      | Finding 1.                                           |

Svelte autofixer ran on App, Composer, Grid, Page, Pdf, Lens, Help, Tour, Style, Quartet, Control, and Install.
Suggestions about effects and element bindings did not establish bugs. The nonreactive preview-resource map does not
need conversion to reactive state. No dead exported symbol or unused dependency was established in the reviewed web
surface.

## Documentation review

All 12 Markdown documents tracked at the baseline were reviewed. Local file and heading links resolved. The two license
texts were inspected for their role and retention. They are not prose-cleanup targets. `CMakeLists.txt` is build code,
not a documentation file.

### Decisions by document

| Document                                                   | Decision and useful scope                                                                                            |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| [README.md](README.md)                                     | Keep. It gives the product purpose, privacy boundary, and component navigation.                                      |
| [AGENTS.md](AGENTS.md)                                     | Keep. It owns workflows and validation gates. Its current length is within the 200-line limit.                       |
| [CHANGELOG.md](CHANGELOG.md)                               | Keep. Internal implementation bullets in Unreleased were shortened. Release history remains intact.                  |
| [lib/README.md](lib/README.md)                             | Improved. It maps processor, producer, WASM, and test entrypoints to their responsibilities.                         |
| [lib/doc/SPEC.md](lib/doc/SPEC.md)                         | Keep as the contract owner. Findings 2 and 3 are aligned. Its example and glossary remain.                           |
| [cli/README.md](cli/README.md)                             | Improved. It adds ordinary/prepared scope, request examples, and command ownership.                                  |
| [cli/doc/SPEC.md](cli/doc/SPEC.md)                         | Keep. It owns stdin, diagnostics, cancellation, and no-clobber output. It links the error-source contract.           |
| [web/README.md](web/README.md)                             | Improved. Repeated shortcut detail gives way to a short source map. Asset restart and cleanup instructions remain.   |
| [web/doc/SPEC.md](web/doc/SPEC.md)                         | Keep. It owns observable behavior. Finding 1 exposes an implementation gap, not a reason to weaken the requirement.  |
| [web/doc/DESIGN.md](web/doc/DESIGN.md)                     | Keep its bounds, references, and UI glossary. Split dense geometry sentences without changing their numerical rules. |
| [web/doc/VIEWPORTS.md](web/doc/VIEWPORTS.md)               | Keep. Completed-run narrative was shortened. Acquisition rules, provenance, and open coverage gaps remain.           |
| [web/test/fixtures/README.md](web/test/fixtures/README.md) | Keep. It gives fixture provenance, rebuild steps, and independent comparison limits.                                 |
| [LICENSE](LICENSE)                                         | Retain unchanged. It contains the project's license text.                                                            |
| [Font license](web/public/fonts/eb-garamond.txt)           | Retain unchanged with the bundled font.                                                                              |

No whole tracked document warrants deletion after the module README improvements. The completed-run narrative at
[VIEWPORTS](web/doc/VIEWPORTS.md#retained-evidence) was shortened. Current coverage gaps, revision references, source
hashes, and acquisition rules remain.

### Language changes applied

The library and CLI specifications already use short, direct sentences. A vocabulary-wide rewrite would risk changing
contract terms. `verify`, `validate`, `reset`, Input, and Source have distinct meanings here and must stay distinct. The
following localized changes improve reading without changing claim strength:

| Location and rule                                                                                                                 | Original text                                                                                                                                                                                                                  | Applied replacement                                                                                                                                                                                                                       |
| --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [DESIGN](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/doc/DESIGN.md#L324), rules 6.1 and 6.3 | “Touch portrait Compact uses a 0.9 row-gap factor, reduced to 0.8 below 600 CSS px, 6–7.5 px image padding, and a height of at least 109.5 px, increased when a wider calibrated card needs the required portrait silhouette.” | “Touch portrait Compact uses a 0.9 row-gap factor, reduced to 0.8 below 600 CSS px. Image padding is 6–7.5 px. Card height is at least 109.5 px. If a wider calibrated card needs the required portrait silhouette, increase its height.” |
| [DESIGN](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/doc/DESIGN.md#L429), rule 6.3          | “If the fitted image occupies less than 70% of that viewport's full width, the initial Page entry enlarges it to the available width after the two inline gutters, up to 400%.”                                                | “If the fitted image occupies less than 70% of the viewport's full width, enlarge it on initial Page entry. Use the available width after the two inline gutters, up to 400% zoom.”                                                       |
| [VIEWPORTS](https://github.com/roktas/mainz/blob/4da31ea939052be1ec3a045ec5c952e830386721/web/doc/VIEWPORTS.md#L322), rule 6.1    | “The desktop follow-up retains physical Safari windows at 2200 × 1298, 2400 × 1358, and 2560 × 1358 CSS px, plus an installed Safari web app at native fullscreen 2560 × 1440.”                                                | “The desktop follow-up retains physical Safari windows at 2200 × 1298, 2400 × 1358, and 2560 × 1358 CSS px. It also retains an installed Safari web app at native fullscreen 2560 × 1440.”                                                |

Unreleased now groups repeated calculation and index work under shorter descriptions. Exact implementation details
remain in source and retained measurements. These edits add no new performance claim.

These Plain-mode clarity changes preserve obligations, uncertainty, publication policy, and support claims.

## Test value and cost

The expensive tests mostly protect useful behavior. In particular, native/WASM agreement, independent preservation,
worker cleanup, interrupted output installation, and real browser gestures are separate boundaries. Similar-looking
assertions across those boundaries are not redundant tests.

Removed: `Output repeats complete ordered page groups` from `web/test/model.test.ts`. Its two examples repeat the
unaligned expansion loop already exercised by the duplex sequence, occurrence identity, and browser bulk-operation
cases. No unique validation or failure case was removed. The diff deletes five lines. Its baseline body took less than
one millisecond, so this is maintenance cleanup, not a material speed optimization.

### Speed work and remaining experiments

| Work                   | Retain                                                                                                  | Reduce or change                                                                                                                              | Evidence and limit                                                                                                                       |
| ---------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| Asset integration      | Digest, notice, publication, and concurrent-server assertions.                                          | Remove it from the minimal unit path, not from standard/full.                                                                                 | Current isolated body: 4.72 s. Finding 6.                                                                                                |
| Native parity setup    | Native contract once, ASan/UBSan, WASM comparison, and independent rasters.                             | The second identical native contract run in the same CI job.                                                                                  | Finding 7. Historical native contract: 14.33 s.                                                                                          |
| Production startup     | Real built assets, scoped offline use, updates, and Source-switch pixels.                               | An independent build for the Source-switch scenario.                                                                                          | Finding 8. No saving measured.                                                                                                           |
| Selection gestures     | Selection combinations, key priority, focus, motion preferences, both panes, and theme-specific colors. | In the standard gate, separate repeated pure mutations from per-theme appearance assertions. Retain the complete presentation matrix in full. | The image/grip case repeats its mutation sequence for two themes, two motion settings, and two panes. Measure before changing its setup. |
| Shared Grid assertions | Measured bounds and paired-density checks.                                                              | Two copies of the per-grid acceptance rules.                                                                                                  | Finding 4. This reduces maintenance drift more than runtime.                                                                             |
| Browser startup        | Fresh contexts, storage isolation, and worker teardown.                                                 | Experiment with one browser per file only after measuring the current startup share.                                                          | The server is already reused per file. Do not add another server pool or raise concurrency.                                              |
| Candidate search       | Real-renderer smoke for each type of capacity improvement.                                              | Repeating exhaustive search for unrelated work.                                                                                               | Already full-only. Keep that separation. The older 564 s observation is not a current timing.                                            |

The existing minimal/standard/full split already removes broad calibration matrices from ordinary pushes. It does not
need another mode. The recommendations preserve full boundary coverage and the native measurements required for layout
changes. They do not propose dropping slow safety tests.

### Inventory key

Each named test or native acquisition entrypoint has a decision in the inventory that follows. Rows refer to the current
file unless marked Removed. Cost classes describe the code path, not a measured duration:

- U: Pure model, runner, or controlled offline logic.
- C: Native commands and small PDF fixtures.
- R: Raster comparison, large fixtures, or repeated native transformations.
- B: Browser interaction or lifecycle case with bounded setup.
- M: Browser matrix or a long stateful workflow.
- I: Build, installation, asset publication, or offline integration.
- N: Native Simulator acquisition, outside the ordinary browser gate.

H means high benefit for correctness, user data, accessibility, or contract behavior. M means a narrower visual or
tooling benefit. L means redundant coverage. Keep preserves the behavior and its assertions. Where a row proposes moving
repeated presentation checks to full, retain every documented full matrix.

Historical timings are labeled S or F in the cost column. S comes from the retained standard run based on `2a72d23`. F
comes from the older application-full run based on `df16984`. Neither is a timing for this review's HEAD. Current full
values come from the follow-up Grid and Page geometry groups. A dash means no matching historical timing. Newly added
cases were assessed from their setup, loops, and assertions. No matched performance benchmark was run.

### JavaScript and TypeScript cases

#### `web/test/alignment.test.js`

| Test                                                                                                   | Benefit | Cost         | Current gate | Decision |
| ------------------------------------------------------------------------------------------------------ | ------- | ------------ | ------------ | -------- |
| [Style retains a Compact companion frame on short touch landscapes](web/test/alignment.test.js#L10)    | H       | M            | Full         | Keep.    |
| [Style scrolling preserves its companion Grid capacity and Page frame](web/test/alignment.test.js#L53) | H       | M            | Full         | Keep.    |
| [Grid grips and Page thumbnail references stay aligned for mouse](web/test/alignment.test.js#L167)     | H       | M (F 86.2 s) | Full         | Keep.    |
| [Grid grips and Page thumbnail references stay aligned for touch](web/test/alignment.test.js#L167)     | H       | M (F 73.4 s) | Full         | Keep.    |
| [App header uses available width before wrapping its actions](web/test/alignment.test.js#L270)         | M       | M (F 3.7 s)  | Full         | Keep.    |
| [Calibrations keep five-digit numbers clear of centered grips](web/test/alignment.test.js#L313)        | H       | M (F 36.2 s) | Full         | Keep.    |

#### `web/test/assets.test.js`

| Test                                                                                               | Benefit | Cost               | Current gate | Decision                                                |
| -------------------------------------------------------------------------------------------------- | ------- | ------------------ | ------------ | ------------------------------------------------------- |
| [Vite verifies Mainz packages and publishes complete asset revisions](web/test/assets.test.js#L10) | H       | I (current 4.72 s) | S/F          | Kept in startup integration; excluded from minimal (6). |

#### `web/test/composition.test.js`

| Test                                                                                                                         | Benefit | Cost         | Current gate | Decision |
| ---------------------------------------------------------------------------------------------------------------------------- | ------- | ------------ | ------------ | -------- |
| [Output Page removes the current occurrence, including Blank and the final page](web/test/composition.test.js#L13)           | H       | B (S 4.0 s)  | S/F          | Keep.    |
| [Input changes cancel their pending gestures and transfers while Output stays independent](web/test/composition.test.js#L62) | H       | B (S 4.2 s)  | S/F          | Keep.    |
| [Grid navigation retains physical page positions during additions](web/test/composition.test.js#L190)                        | H       | M (S 8.5 s)  | S/F          | Keep.    |
| [Input additions reach Output without delaying edits or taking focus](web/test/composition.test.js#L261)                     | H       | M (S 10.4 s) | S/F          | Keep.    |
| [Addition previews use their target image or the action area](web/test/composition.test.js#L533)                             | H       | M (S 23.4 s) | S/F          | Keep.    |
| [Output additions, removals, and moves animate across page actions and shortcuts](web/test/composition.test.js#L689)         | H       | M (S 23.4 s) | S/F          | Keep.    |
| [Bulk page actions consume preparations and preserve selected occurrences](web/test/composition.test.js#L1117)               | H       | M (S 8.9 s)  | S/F          | Keep.    |
| [Edited Padding retains its dimensions and page order in the downloaded PDF](web/test/composition.test.js#L1333)             | H       | M (S 3.4 s)  | Min/S/F      | Keep.    |
| [Grid boundary duplication focuses the final new Output occurrence](web/test/composition.test.js#L1444)                      | H       | B (S 2.0 s)  | S/F          | Keep.    |

#### `web/test/geometry.test.js`

| Test                                                                                                                      | Benefit | Cost                                 | Current gate | Decision                   |
| ------------------------------------------------------------------------------------------------------------------------- | ------- | ------------------------------------ | ------------ | -------------------------- |
| [Paired pane headings align actions, metadata, tabs, and selection fields](web/test/geometry.test.js#L10)                 | H       | M (F 17.1 s) · current full 22.7 s   | Full         | Keep full layout coverage. |
| [Page headings and navigation follow fitted image edges](web/test/geometry.test.js#L119)                                  | H       | M (F 139.5 s) · current full 121.3 s | Full         | Keep.                      |
| [Page controls retain space and alignment with wide fonts and enlarged mobile text](web/test/geometry.test.js#L301)       | H       | M (F 2.7 s) · current full 3.2 s     | Full         | Keep.                      |
| [Touch Page starts readable, keeps balanced gutters, and preserves explicit zoom choices](web/test/geometry.test.js#L355) | H       | M (F 13.0 s) · current full 30.4 s   | Full         | Keep.                      |
| [Page fit preserves screen size across expanded desktop viewports](web/test/geometry.test.js#L555)                        | H       | M (F 8.1 s) · current full 15.7 s    | Full         | Keep.                      |

#### `web/test/grid.test.js`

| Test                                                                                                        | Benefit | Cost                               | Current gate | Decision                                |
| ----------------------------------------------------------------------------------------------------------- | ------- | ---------------------------------- | ------------ | --------------------------------------- |
| [Normal card targets stay separate through phone pane and text transitions](web/test/grid.test.js#L12)      | H       | M · current full 15.7 s            | S/F          | Keep actual touch hit testing.          |
| [Normal card targets route footer and grip taps across consecutive rows](web/test/grid.test.js#L106)        | H       | M · current full 39.7 s            | S/F          | Keep cross-row target regression.       |
| [Workspace scrolling keeps Grid and Page controls clear of status](web/test/grid.test.js#L223)              | H       | M · current full 10.9 s            | S/F          | Keep.                                   |
| [Grid keeps feasible matrices across nearby desktop calibration boundaries](web/test/grid.test.js#L286)     | H       | M · current full 93.2 s            | Full         | Keep.                                   |
| [Grid retains feasible matrices across fractional desktop pane widths](web/test/grid.test.js#L339)          | H       | M · current full 13.7 s            | Full         | Keep.                                   |
| [Touch portrait Normal Grid fits readable cards across nearby phone dimensions](web/test/grid.test.js#L370) | H       | M · current full 9.4 s             | S/F          | Keep.                                   |
| [Phone Compact gaps keep the narrow-screen allowance below tablet widths](web/test/grid.test.js#L425)       | H       | M · current full 9.9 s             | S/F          | Keep.                                   |
| [Measured touch frames retain complete readable matrices](web/test/grid.test.js#L463)                       | H       | M · current full 10.9 s            | Full         | Keep.                                   |
| [Measured touch calibrations isolate viewport bounds and primary input](web/test/grid.test.js#L509)         | H       | M · current full 48.4 s            | Full         | Keep.                                   |
| [Touch portrait pagination uses available height above the safe area](web/test/grid.test.js#L599)           | H       | M · current full 5.3 s             | S/F          | Keep.                                   |
| [Touch Grid uses complete rows within the available viewport](web/test/grid.test.js#L665)                   | H       | M (F 23.6 s) · current full 34.3 s | Full         | Keep.                                   |
| [Desktop Grid retains measured capacity within readable bounds](web/test/grid.test.js#L721)                 | H       | M · current full 167.9 s           | Full         | Keep.                                   |
| [Grid fitting respects viewport bounds and input capabilities](web/test/grid.test.js#L771)                  | H       | M · current full 236.7 s           | Full         | Keep calibration boundaries, full only. |
| [Partial Grid batches retain full-matrix card positions and dimensions](web/test/grid.test.js#L1048)        | H       | M (S 23.0 s) · current full 49.7 s | S/F          | Keep.                                   |
| [Grid density retains inspection and compact page commands](web/test/grid.test.js#L1115)                    | H       | M · current full 19.5 s            | S/F          | Keep.                                   |
| [Grid pagination bounds its marks and retains exact page navigation](web/test/grid.test.js#L1207)           | H       | M (S 10.3 s) · current full 12.0 s | Min/S/F      | Keep 1/64/1,000/10,000-page boundaries. |
| [Compact pagination retains readable four- and five-digit numbers](web/test/grid.test.js#L1280)             | H       | M (F 3.7 s) · current full 10.7 s  | Full         | Keep.                                   |

#### `web/test/install.test.js`

| Test                                                                                                    | Benefit | Cost        | Current gate | Decision                            |
| ------------------------------------------------------------------------------------------------------- | ------- | ----------- | ------------ | ----------------------------------- |
| [Installation guidance stays optional and independent of the product tour](web/test/install.test.js#L8) | H       | I (S 9.3 s) | S/F          | Keep storage and platform branches. |

#### `web/test/lens.test.js`

| Test                                                                                                            | Benefit | Cost                             | Current gate | Decision |
| --------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------- | ------------ | -------- |
| [Lens fits short viewports at every edge for mouse and touch](web/test/lens.test.js#L80)                        | H       | B · current full 10.6 s          | S/F          | Keep.    |
| [Lens teardown releases acquired pages after delayed or failed renderer loading](web/test/lens.test.js#L142)    | H       | B (S 3.9 s) · current full 4.0 s | S/F          | Keep.    |
| [An open lens refines during continuous movement without restarting active renders](web/test/lens.test.js#L189) | H       | B (S 1.5 s) · current full 2.0 s | S/F          | Keep.    |

#### `web/test/model.test.ts`

| Test                                                                                                                | Benefit | Cost | Current gate   | Decision                                 |
| ------------------------------------------------------------------------------------------------------------------- | ------- | ---- | -------------- | ---------------------------------------- |
| [Profiles replace their complete scope and leave other styles independent](web/test/model.test.ts#L22)              | H       | U    | All unit gates | Keep.                                    |
| [Download names use the first contributing Input and local time to hundredths](web/test/model.test.ts#L86)          | H       | U    | All unit gates | Keep.                                    |
| Output repeats complete ordered page groups (baseline L119)                                                         | L       | U    | Removed        | Removed; overlapping expansion examples. |
| [Page entry retains exact order and repetitions with bounded expansion](web/test/model.test.ts#L119)                | H       | U    | All unit gates | Keep.                                    |
| [Input range toggles retain authored order and repeated pages](web/test/model.test.ts#L128)                         | H       | U    | All unit gates | Keep.                                    |
| [Output selections and destinations follow occurrence identity and physical order](web/test/model.test.ts#L137)     | H       | U    | All unit gates | Keep.                                    |
| [Duplex alignment includes leading and every trailing Blank with preceding dimensions](web/test/model.test.ts#L166) | H       | U    | All unit gates | Keep.                                    |
| [Occurrence ordering swaps adjacent positions without crossing boundaries](web/test/model.test.ts#L176)             | H       | U    | All unit gates | Keep.                                    |
| [Occurrence identities survive materialization, insertion, reordering, and repetition](web/test/model.test.ts#L191) | H       | U    | All unit gates | Keep.                                    |
| [Job includes only used Sources, full explicit overrides, and zero-based references](web/test/model.test.ts#L218)   | H       | U    | All unit gates | Keep.                                    |
| [Download preflight counts referenced Input identities and their aggregate bytes](web/test/model.test.ts#L237)      | H       | U    | All unit gates | Keep.                                    |
| [Page inspection follows occurrence identity and surviving neighbors after edits](web/test/model.test.ts#L263)      | H       | U    | All unit gates | Keep.                                    |
| [Available styles follow only applicable Output pages from the same Source](web/test/model.test.ts#L279)            | H       | U    | All unit gates | Keep.                                    |
| [Style coverage counts Source occurrences and copies without duplex padding or Blanks](web/test/model.test.ts#L309) | H       | U    | All unit gates | Keep.                                    |
| [Preview processing follows changed Output parameters and retains deferred choices](web/test/model.test.ts#L330)    | H       | U    | All unit gates | Keep.                                    |
| [Invalid style drafts block only their Source's eligible Output pages](web/test/model.test.ts#L371)                 | H       | U    | All unit gates | Keep.                                    |
| [Small buffers apply only to large Sources with few distinct Output pages](web/test/model.test.ts#L398)             | H       | U    | All unit gates | Keep.                                    |
| [Reference controls preserve color steps, width constraints, and exact opacity values](web/test/model.test.ts#L432) | H       | U    | All unit gates | Keep.                                    |
| [Parameter groups use Title Case and preserve authored array order](web/test/model.test.ts#L456)                    | M       | U    | All unit gates | Keep.                                    |
| [Quartets use complete Style objects at their first parameter's position](web/test/model.test.ts#L496)              | H       | U    | All unit gates | Keep.                                    |

#### `web/test/offline.test.ts`

| Test                                                                                                                  | Benefit | Cost | Current gate   | Decision |
| --------------------------------------------------------------------------------------------------------------------- | ------- | ---- | -------------- | -------- |
| [Offline installation overlaps a bounded number of verified asset requests](web/test/offline.test.ts#L90)             | H       | U    | All unit gates | Keep.    |
| [A failed digest waits for in-flight writes before deleting the partial offline cache](web/test/offline.test.ts#L106) | H       | U    | All unit gates | Keep.    |
| [Offline installation retries transient downloads and stops on permanent failures](web/test/offline.test.ts#L129)     | H       | U    | All unit gates | Keep.    |

#### `web/test/page.test.js`

| Test                                                                                                                        | Benefit | Cost                       | Current gate | Decision                                                |
| --------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------- | ------------ | ------------------------------------------------------- |
| [Arrows enter Grid without selection and Page keys change thumbnail groups](web/test/page.test.js#L14)                      | H       | M (S 44.4 s)               | S/F          | Keep.                                                   |
| [Page and Grid share viewport bounds and density keeps the fitted image size](web/test/page.test.js#L207)                   | H       | M (S 31.2 s)               | S/F          | Keep.                                                   |
| [Page pinch zoom preserves its anchor and shares the button zoom range](web/test/page.test.js#L368)                         | H       | M (S 8.1 s)                | Min/S/F      | Keep.                                                   |
| [Page cancellation clears a pending pinch before the next render](web/test/page.test.js#L505)                               | H       | M                          | Min/S/F      | Keep.                                                   |
| [The lens waits for a settled mouse and cancels pending openings](web/test/page.test.js#L565)                               | H       | M (S 9.7 s)                | S/F          | Keep.                                                   |
| [Grid and Page share edits while inspection, original appearance, and Sources stay independent](web/test/page.test.js#L651) | H       | M (S 24.9 s)               | S/F          | Keep.                                                   |
| [Page image activation repeats current-page copies and preserves selections](web/test/page.test.js#L1168)                   | H       | B (S 4.0 s)                | S/F          | Keep.                                                   |
| [Repeated Page copies emphasize the image and status without changing focus or geometry](web/test/page.test.js#L1280)       | H       | M (S 11.2 s)               | S/F          | Keep.                                                   |
| [Output Page keeps original PDF labels through composition and Input changes](web/test/page.test.js#L1388)                  | H       | M · current standard 4.4 s | S/F          | Keep composition labels and usable long-label controls. |
| [Grid and Page switches preserve selections, zoom, and the inspected page](web/test/page.test.js#L1507)                     | H       | M (S 5.1 s)                | S/F          | Keep.                                                   |
| [Grid selection keeps painted pages in place](web/test/page.test.js#L1622)                                                  | H       | M (S 5.7 s)                | S/F          | Keep.                                                   |
| [Unused and modified Grid keys preserve pointer controls and native shortcut priority](web/test/page.test.js#L1757)         | H       | M (S 2.9 s)                | S/F          | Keep.                                                   |
| [Page shortcuts follow the mouse side and page counters open a stable inline entry](web/test/page.test.js#L1843)            | H       | M (S 3.7 s)                | S/F          | Keep.                                                   |
| [Large Sources reuse selected-page PDFs and keep original page identities in Page and Compare](web/test/page.test.js#L2033) | H       | M (S 10.2 s)               | S/F          | Keep.                                                   |

#### `web/test/pdf.test.js`

| Test                                                                                                                              | Benefit | Cost                             | Current gate | Decision |
| --------------------------------------------------------------------------------------------------------------------------------- | ------- | -------------------------------- | ------------ | -------- |
| [Overlapping preview generations release their own pages and never paint stale results](web/test/pdf.test.js#L9)                  | H       | B (S 1.8 s) · current full 2.8 s | Min/S/F      | Keep.    |
| [Input inspection bounds pending metadata and releases pages on completion, cancellation, and failure](web/test/pdf.test.js#L150) | H       | B (S 1.2 s) · current full 0.6 s | Min/S/F      | Keep.    |
| [Document ownership releases tasks and rasters once, including validation failures](web/test/pdf.test.js#L234)                    | H       | B (S 1.1 s) · current full 0.5 s | S/F          | Keep.    |
| [Releasing PDF rasters clears only that document and preserves the shared cache budget](web/test/pdf.test.js#L292)                | H       | B (S 1.0 s) · current full 0.5 s | S/F          | Keep.    |
| [Source replacement retains opened rasters for comparison and releases them on removal](web/test/pdf.test.js#L352)                | H       | B (S 2.3 s) · current full 2.9 s | S/F          | Keep.    |

#### `web/test/processor.test.js`

| Test                                                                                                              | Benefit | Cost                   | Current gate | Decision |
| ----------------------------------------------------------------------------------------------------------------- | ------- | ---------------------- | ------------ | -------- |
| [Processor workers pin their module and recover from failed document cleanup](web/test/processor.test.js#L53)     | H       | B · current full 2.8 s | Min/S/F      | Keep.    |
| [Processors bound idle runtimes and reuse immutable page buffers across retries](web/test/processor.test.js#L131) | H       | B · current full 3.0 s | Min/S/F      | Keep.    |

#### `web/test/runner.test.ts`

| Test                                                                                                                     | Benefit | Cost | Current gate   | Decision |
| ------------------------------------------------------------------------------------------------------------------------ | ------- | ---- | -------------- | -------- |
| [Browser modes retain critical regressions and reserve calibration matrices for full checks](web/test/runner.test.ts#L7) | H       | U    | All unit gates | Keep.    |

#### `web/test/selection.test.js`

| Test                                                                                                                  | Benefit | Cost         | Current gate | Decision                                                           |
| --------------------------------------------------------------------------------------------------------------------- | ------- | ------------ | ------------ | ------------------------------------------------------------------ |
| [Touch grips restrict Grid drops and keep Selection unfocused](web/test/selection.test.js#L11)                        | H       | M (S 19.1 s) | S/F          | Keep.                                                              |
| [Touch Selection keeps the keyboard closed and image gestures preserve pages](web/test/selection.test.js#L211)        | H       | M (S 17.1 s) | Min/S/F      | Keep.                                                              |
| [Grid images and grips share selection and ordinary page focus](web/test/selection.test.js#L380)                      | H       | M (S 17.3 s) | S/F          | Keep motion, focus, and colors; consider standard/full separation. |
| [Dragging opens stable page slots, previews density, and commits only on drop](web/test/selection.test.js#L523)       | H       | M (S 18.2 s) | S/F          | Keep.                                                              |
| [Dragging page images and grips preserves selection and page focus](web/test/selection.test.js#L759)                  | H       | M (S 2.6 s)  | S/F          | Keep.                                                              |
| [Open menus retain page commands from both panes](web/test/selection.test.js#L822)                                    | H       | M (S 2.2 s)  | S/F          | Keep.                                                              |
| [Grid keyboard selection toggles at the cursor and stops at boundaries](web/test/selection.test.js#L865)              | H       | M (S 16.1 s) | S/F          | Keep.                                                              |
| [Selection bars expose meaningful actions in both panes](web/test/selection.test.js#L1080)                            | H       | M (S 6.5 s)  | S/F          | Keep.                                                              |
| [Output separates page controls from group actions for keyboard and mouse](web/test/selection.test.js#L1279)          | H       | M (S 7.8 s)  | S/F          | Keep.                                                              |
| [Grid shortcuts resolve both pane selections and allow mouse then keyboard actions](web/test/selection.test.js#L1459) | H       | M (S 27.2 s) | S/F          | Keep.                                                              |
| [Escape clears the target selection without moving inspection or scroll positions](web/test/selection.test.js#L1753)  | H       | M (S 7.6 s)  | S/F          | Keep.                                                              |
| [Selection and view shortcuts target the mouse pane and preserve native keys](web/test/selection.test.js#L1858)       | H       | M (S 3.7 s)  | S/F          | Keep.                                                              |
| [Page and Grid keyboard actions respect key priority and the visible page order](web/test/selection.test.js#L2021)    | H       | M (S 5.9 s)  | Min/S/F      | Keep.                                                              |
| [Output movement keeps direction buttons fixed at selection boundaries](web/test/selection.test.js#L2316)             | H       | M (S 22.4 s) | S/F          | Keep.                                                              |

#### `web/test/startup.test.js`

| Test                                                                                                                        | Benefit | Cost         | Current gate | Decision                                  |
| --------------------------------------------------------------------------------------------------------------------------- | ------- | ------------ | ------------ | ----------------------------------------- |
| [Landing compact headings fit phones and tablets and logos follow theme changes and reloads](web/test/startup.test.js#L148) | M       | M (S 5.1 s)  | S/F          | Keep.                                     |
| [Landing top spacing stays bounded on wide coarse-pointer screens](web/test/startup.test.js#L413)                           | M       | B (S 1.1 s)  | S/F          | Keep.                                     |
| [Landing logo replays entry and keeps parallax inside its framed area](web/test/startup.test.js#L453)                       | M       | B (S 10.8 s) | S/F          | Keep.                                     |
| [PDF opening and composition work over non-secure HTTP](web/test/startup.test.js#L551)                                      | H       | B (S 3.0 s)  | S/F          | Keep.                                     |
| [Ordinary Inputs release validation workers while preview and Download stay available](web/test/startup.test.js#L587)       | H       | B (S 2.0 s)  | S/F          | Keep.                                     |
| [Multi-file opening recovers from invalid PDFs and cancellation stops the remaining files](web/test/startup.test.js#L634)   | H       | B            | S/F          | Keep.                                     |
| [Large failure batches announce a summary and retain every file error](web/test/startup.test.js#L705)                       | H       | B            | S/F          | Keep.                                     |
| [The first PDF previews before validation and commits only after success](web/test/startup.test.js#L804)                    | H       | B (S 3.0 s)  | Min/S/F      | Keep.                                     |
| [Development assets remain available after a production build](web/test/startup.test.js#L881)                               | H       | I (S 5.1 s)  | S/F          | Keep independent dev/build boundary.      |
| [Demo variants open the maintained Input with populated or empty Output](web/test/startup.test.js#L922)                     | H       | B (S 3.8 s)  | S/F          | Keep.                                     |
| [Unknown demo variants report an error and permit opening a local PDF](web/test/startup.test.js#L1001)                      | H       | B (S 1.7 s)  | S/F          | Keep.                                     |
| [A delayed demo cannot replace local pages or report obsolete failures](web/test/startup.test.js#L1029)                     | H       | B (S 3.3 s)  | S/F          | Keep.                                     |
| [Input density starts from two Normal batches and retains each Source choice](web/test/startup.test.js#L1071)               | H       | M (S 9.2 s)  | S/F          | Keep.                                     |
| [View switches reuse painted PDFs and loading keeps thumbnails within their frames](web/test/startup.test.js#L1150)         | H       | B (S 8.2 s)  | S/F          | Keep.                                     |
| [Home asks once before discarding changes and cancellation retains the workspace](web/test/startup.test.js#L1305)           | H       | B (S 2.3 s)  | S/F          | Keep.                                     |
| [Input switching renders thumbnails and the lens from the selected PDF](web/test/startup.test.js#L1349)                     | H       | I (S 4.0 s)  | S/F          | Keep pixels; shared production build (8). |
| [Concurrent Source previews isolate resets and ignore obsolete worker replies](web/test/startup.test.js#L1420)              | H       | B (S 4.2 s)  | S/F          | Keep.                                     |
| [Offline assets, scoped startup, and updates preserve a compatible workspace](web/test/startup.test.js#L1514)               | H       | I (S 63.6 s) | S/F          | Keep real offline/update integration.     |

#### `web/test/transfer.test.js`

| Test                                                                                                              | Benefit | Cost        | Current gate | Decision |
| ----------------------------------------------------------------------------------------------------------------- | ------- | ----------- | ------------ | -------- |
| [Large Output transfers preserve offscreen selections across cancellation and drop](web/test/transfer.test.js#L9) | H       | B           | S/F          | Keep.    |
| [Interrupted transfers release their previews and leave subsequent actions usable](web/test/transfer.test.js#L99) | H       | B (S 6.3 s) | S/F          | Keep.    |

#### `web/test/viewport.test.js`

| Test                                                                                                          | Benefit | Cost | Current gate | Decision                                    |
| ------------------------------------------------------------------------------------------------------------- | ------- | ---- | ------------ | ------------------------------------------- |
| [Stable geometry retains fresh viewport metadata after resizing](web/test/viewport.test.js#L12)               | M       | M    | Full         | Keep.                                       |
| [Grid measurement refreshes stylesheet preferences within the same frame](web/test/viewport.test.js#L43)      | M       | M    | Full         | Keep.                                       |
| [One geometry schema captures desktop and touch without changing Grid choices](web/test/viewport.test.js#L70) | M       | M    | Full         | Keep.                                       |
| [Measured frames gain rows or columns while keeping balanced readable images](web/test/viewport.test.js#L275) | H       | M    | Full         | Keep full-only renderer/search integration. |

#### `web/test/workspace.test.js`

| Test                                                                                                                                   | Benefit | Cost         | Current gate | Decision                                        |
| -------------------------------------------------------------------------------------------------------------------------------------- | ------- | ------------ | ------------ | ----------------------------------------------- |
| [Opaque profile-set IDs keep their descriptions across Input switches](web/test/workspace.test.js#L11)                                 | H       | M            | S/F          | Keep.                                           |
| [Download explains the referenced Input limit before preparation and recovers after removal](web/test/workspace.test.js#L94)           | H       | B            | S/F          | Keep.                                           |
| [Style reset appears only for changes and retains keyboard focus](web/test/workspace.test.js#L141)                                     | H       | B            | S/F          | Keep.                                           |
| [Dialogs dismiss outside taps without native light dismissal](web/test/workspace.test.js#L187)                                         | H       | M            | S/F          | Keep.                                           |
| [Workspace tools wrap without moving the view tabs](web/test/workspace.test.js#L231)                                                   | H       | M (S 12.3 s) | S/F          | Keep.                                           |
| [Help stays available across pointer types and tours retain visible focus](web/test/workspace.test.js#L404)                            | H       | M (S 3.9 s)  | S/F          | Keep.                                           |
| [Download blocks only invalid styles used by Output, including after Input switching](web/test/workspace.test.js#L437)                 | H       | B (S 2.9 s)  | S/F          | Keep.                                           |
| [Shortcut help follows the visible views, preserves focus, and starts the tour](web/test/workspace.test.js#L492)                       | H       | M (S 6.2 s)  | S/F          | Keep.                                           |
| [Style requires applicable Output references and retains independent Source choices](web/test/workspace.test.js#L712)                  | H       | B (S 7.1 s)  | S/F          | Keep.                                           |
| [Style and Download cancellation release preview workers and retain choices](web/test/workspace.test.js#L825)                          | H       | B (S 4.0 s)  | Min/S/F      | Keep cancellation and URL ownership.            |
| [Info reports actions, errors stay above the workspace, and newer feedback survives style processing](web/test/workspace.test.js#L978) | H       | M (S 6.3 s)  | S/F          | Keep.                                           |
| [Style selectors retain touch height and inset arrows across workspace widths](web/test/workspace.test.js#L1117)                       | H       | M (S 7.0 s)  | S/F          | Keep; reserve exhaustive presentation for full. |
| [Settings steps lens magnification by two and keeps its value beside the controls](web/test/workspace.test.js#L1203)                   | H       | M (S 7.5 s)  | S/F          | Keep.                                           |
| [Quartets and profiles preserve PDF edits and open files without profiles](web/test/workspace.test.js#L1346)                           | H       | M (S 15.0 s) | S/F          | Keep.                                           |
| [Opaque parameter IDs retain style edits, draft errors, and downloaded values](web/test/workspace.test.js#L1683)                       | H       | M (S 3.4 s)  | Min/S/F      | Keep.                                           |
| [Page addition hint skips on any click](web/test/workspace.test.js#L1753)                                                              | H       | B (S 4.3 s)  | S/F          | Keep.                                           |
| [Onboarding reset is consumed once and preserves other preferences](web/test/workspace.test.js#L1802)                                  | H       | B (S 2.2 s)  | S/F          | Keep.                                           |
| [PDF workspace preserves composition, styles, focus, and responsive controls](web/test/workspace.test.js#L1844)                        | H       | M (S 61.5 s) | S/F          | Keep end-to-end state transitions.              |

### Ruby cases

These tests protect native behavior and the independent comparison tools. Per-case durations were not measured in this
review.

#### `lib/test/contract_test.rb`

| Test                                                                                            | Benefit | Cost | Decision |
| ----------------------------------------------------------------------------------------------- | ------- | ---- | -------- |
| [test_description_exposes_baselines_and_plain_text](lib/test/contract_test.rb#L35)              | H       | C    | Keep.    |
| [test_optional_display_preserves_original_visibility](lib/test/contract_test.rb#L75)            | H       | C    | Keep.    |
| [test_shared_baselines_keep_occurrence_specific_widths](lib/test/contract_test.rb#L114)         | H       | C    | Keep.    |
| [test_styling_and_reset_preserve_immutable_baselines](lib/test/contract_test.rb#L136)           | H       | C    | Keep.    |
| [test_large_legal_manifests_remain_editable](lib/test/contract_test.rb#L185)                    | H       | R    | Keep.    |
| [test_dense_descriptions_remain_editable](lib/test/contract_test.rb#L195)                       | H       | R    | Keep.    |
| [test_baseline_summaries_retain_numeric_precision](lib/test/contract_test.rb#L206)              | H       | C    | Keep.    |
| [test_unrepresentable_baselines_do_not_become_scalar_values](lib/test/contract_test.rb#L233)    | H       | C    | Keep.    |
| [test_noops_and_repeated_choices_preserve_bytes](lib/test/contract_test.rb#L259)                | H       | C    | Keep.    |
| [test_invalid_style_requests_preserve_existing_output](lib/test/contract_test.rb#L276)          | H       | C    | Keep.    |
| [test_error_context_does_not_use_request_string_limits](lib/test/contract_test.rb#L305)         | H       | C    | Keep.    |
| [test_invalid_manifests_and_numeric_tokens_are_rejected](lib/test/contract_test.rb#L322)        | H       | C    | Keep.    |
| [test_opaque_ids_survive_document_operations](lib/test/contract_test.rb#L357)                   | H       | C    | Keep.    |
| [test_enums_retain_choices_with_a_nonempty_intersection](lib/test/contract_test.rb#L407)        | H       | C    | Keep.    |
| [test_color_baselines_use_a_valid_schema_spelling](lib/test/contract_test.rb#L420)              | H       | C    | Keep.    |
| [test_escaped_names_and_inline_images_remain_editable](lib/test/contract_test.rb#L436)          | H       | C    | Keep.    |
| [test_context_and_resource_mismatches_are_rejected](lib/test/contract_test.rb#L455)             | H       | C    | Keep.    |
| [test_latent_fills_require_closed_nonoverlapping_subpaths](lib/test/contract_test.rb#L499)      | H       | C    | Keep.    |
| [test_duplicate_fills_ignore_numeric_spelling](lib/test/contract_test.rb#L532)                  | H       | C    | Keep.    |
| [test_decoded_content_and_manifest_limits_are_enforced](lib/test/contract_test.rb#L554)         | H       | R    | Keep.    |
| [test_repeated_edits_bound_object_growth](lib/test/contract_test.rb#L568)                       | H       | R    | Keep.    |
| [test_styling_preserves_content_and_reset_appearance](lib/test/contract_test.rb#L578)           | H       | R    | Keep.    |
| [test_extraction_preserves_content_and_rebuilds_the_contract](lib/test/contract_test.rb#L597)   | H       | R    | Keep.    |
| [test_extraction_prunes_navigation_and_retains_form_fields](lib/test/contract_test.rb#L655)     | H       | C    | Keep.    |
| [test_extraction_prunes_bindings_and_keeps_page_labels](lib/test/contract_test.rb#L703)         | H       | C    | Keep.    |
| [test_page_selection_prunes_targets_without_eligible_bindings](lib/test/contract_test.rb#L724)  | H       | C    | Keep.    |
| [test_invalid_page_selections_preserve_existing_output](lib/test/contract_test.rb#L765)         | H       | C    | Keep.    |
| [test_composition_isolates_source_styles_and_reports_padding](lib/test/contract_test.rb#L790)   | H       | R    | Keep.    |
| [test_composition_indexes_reordered_repeated_regions](lib/test/contract_test.rb#L830)           | H       | C    | Keep.    |
| [test_composition_keeps_page_geometry_and_sizes_padding](lib/test/contract_test.rb#L855)        | H       | C    | Keep.    |
| [test_composition_rejects_invalid_jobs_and_identifiers](lib/test/contract_test.rb#L878)         | H       | C    | Keep.    |
| [test_blank_composition_obeys_geometry_and_page_limits](lib/test/contract_test.rb#L911)         | H       | C    | Keep.    |
| [test_composition_remaps_links_and_isolates_annotations](lib/test/contract_test.rb#L935)        | H       | C    | Keep.    |
| [test_shared_records_isolate_styles_and_retain_baselines](lib/test/contract_test.rb#L980)       | H       | C    | Keep.    |
| [test_alpha_resources_validate_each_paint_scope](lib/test/contract_test.rb#L1031)               | H       | C    | Keep.    |
| [test_bindings_require_eligible_records_in_every_target](lib/test/contract_test.rb#L1058)       | H       | C    | Keep.    |
| [test_shared_record_tables_require_complete_valid_bindings](lib/test/contract_test.rb#L1070)    | H       | C    | Keep.    |
| [test_shared_record_expansion_obeys_record_and_text_limits](lib/test/contract_test.rb#L1099)    | H       | R    | Keep.    |
| [test_profiles_survive_styling_extraction_and_composition](lib/test/contract_test.rb#L1133)     | H       | C    | Keep.    |
| [test_profiles_require_valid_scopes_and_original_first_choice](lib/test/contract_test.rb#L1172) | H       | C    | Keep.    |

#### `lib/test/parity_test.rb`

| Test                                                                                | Benefit | Cost | Decision                                                    |
| ----------------------------------------------------------------------------------- | ------- | ---- | ----------------------------------------------------------- |
| [test_wasm_matches_native_state_content_and_appearance](lib/test/parity_test.rb#L9) | H       | R    | Keep parity; avoid duplicate native prerequisite in CI (7). |

#### `lib/test/preserve_test.rb`

| Test                                                                                          | Benefit | Cost | Decision                            |
| --------------------------------------------------------------------------------------------- | ------- | ---- | ----------------------------------- |
| [test_paint_changes_preserve_protected_content](lib/test/preserve_test.rb#L24)                | H       | C    | Keep independent oracle regression. |
| [test_geometry_clipping_transforms_and_text_changes_are_found](lib/test/preserve_test.rb#L32) | H       | C    | Keep independent oracle regression. |
| [test_graphics_scope_changes_are_found](lib/test/preserve_test.rb#L44)                        | H       | C    | Keep independent oracle regression. |
| [test_unbalanced_graphics_state_is_rejected](lib/test/preserve_test.rb#L61)                   | H       | C    | Keep independent oracle regression. |
| [test_font_and_image_changes_are_found](lib/test/preserve_test.rb#L68)                        | H       | C    | Keep independent oracle regression. |
| [test_page_and_form_geometry_changes_are_found](lib/test/preserve_test.rb#L75)                | H       | C    | Keep independent oracle regression. |
| [test_inline_image_changes_are_found](lib/test/preserve_test.rb#L97)                          | H       | C    | Keep independent oracle regression. |
| [test_incomplete_content_is_rejected](lib/test/preserve_test.rb#L103)                         | H       | C    | Keep independent oracle regression. |

#### `lib/test/producer_test.rb`

| Test                                                                                         | Benefit | Cost | Decision                                                        |
| -------------------------------------------------------------------------------------------- | ------- | ---- | --------------------------------------------------------------- |
| [test_production_preserves_rendering_and_declared_styles](lib/test/producer_test.rb#L21)     | H       | R    | Keep.                                                           |
| [test_parameter_groups_preserve_arrays_and_sort_unlisted_ids](lib/test/producer_test.rb#L82) | H       | C    | Keep explicit-array and unordered-object presentation contract. |
| [test_optional_display_preserves_source_visibility](lib/test/producer_test.rb#L101)          | H       | R    | Keep.                                                           |
| [test_targets_require_parameter_bindings](lib/test/producer_test.rb#L129)                    | H       | C    | Keep.                                                           |
| [test_physical_units_match_css_pixel_dimensions](lib/test/producer_test.rb#L148)             | H       | R    | Keep.                                                           |
| [test_opaque_target_and_parameter_ids_survive_production](lib/test/producer_test.rb#L165)    | H       | C    | Keep.                                                           |
| [test_unsupported_sources_and_declarations_are_rejected](lib/test/producer_test.rb#L180)     | H       | C    | Keep.                                                           |
| [test_excessive_paint_records_are_rejected](lib/test/producer_test.rb#L236)                  | H       | R    | Keep.                                                           |
| [test_selected_text_and_images_are_rejected](lib/test/producer_test.rb#L251)                 | H       | C    | Keep.                                                           |

#### `cli/test/cli_test.rb`

| Test                                                                                | Benefit | Cost | Decision                                 |
| ----------------------------------------------------------------------------------- | ------- | ---- | ---------------------------------------- |
| [test_version_and_verification_return_structured_results](cli/test/cli_test.rb#L41) | H       | C    | Keep.                                    |
| [test_stdout_failures_return_host_errors](cli/test/cli_test.rb#L48)                 | H       | C    | Keep.                                    |
| [test_usage_errors_write_only_stderr](cli/test/cli_test.rb#L61)                     | H       | C    | Keep.                                    |
| [test_invalid_dimensions_are_argument_errors](cli/test/cli_test.rb#L78)             | H       | C    | Keep.                                    |
| [test_invalid_input_bindings_report_request_locations](cli/test/cli_test.rb#L96)    | H       | C    | Keep.                                    |
| [test_input_paths_cannot_contain_null_bytes](cli/test/cli_test.rb#L116)             | H       | C    | Keep.                                    |
| [test_output_errors_preserve_input_and_existing_files](cli/test/cli_test.rb#L134)   | H       | C    | Keep.                                    |
| [test_output_retries_temporary_cleanup_after_install](cli/test/cli_test.rb#L146)    | H       | C    | Keep filesystem failure injection.       |
| [test_interruptions_preserve_existing_output](cli/test/cli_test.rb#L191)            | H       | C    | Keep real signals and output protection. |
| [test_stdin_matches_file_input_and_preserves_output](cli/test/cli_test.rb#L225)     | H       | C    | Keep.                                    |
| [test_invalid_pdf_reports_syntax_failure](cli/test/cli_test.rb#L233)                | H       | C    | Keep.                                    |

#### `cli/test/package_test.rb`

| Test                                                                                       | Benefit | Cost | Decision |
| ------------------------------------------------------------------------------------------ | ------- | ---- | -------- |
| [test_install_replaces_stale_members_and_keeps_failed_output](cli/test/package_test.rb#L9) | H       | C    | Keep.    |
| [test_archive_preserves_binary_content_names_and_modes](cli/test/package_test.rb#L28)      | H       | C    | Keep.    |

#### `web/test/setup_test.rb`

| Test                                                                  | Benefit | Cost | Decision                                                    |
| --------------------------------------------------------------------- | ------- | ---- | ----------------------------------------------------------- |
| [test_setup_restores_resolvable_packages](web/test/setup_test.rb#L10) | H       | I    | Keep clean/stale/deleted dependency states; three installs. |

### Sequential WASM harness

[lib/test/wasm.mjs](lib/test/wasm.mjs) is invoked by parity. Its sections share one module to test lifetime and
recovery.

| Section                                                                | Benefit | Cost | Decision                                |
| ---------------------------------------------------------------------- | ------- | ---- | --------------------------------------- |
| Native description and styled-result agreement                         | H       | C    | Keep.                                   |
| Immutable Input, reset no-ops, and extraction order                    | H       | C    | Keep.                                   |
| Invalid requests and closed/reopened handles                           | H       | C    | Keep boundary state transitions.        |
| Same-sized corrupt Inputs and recovery                                 | H       | C    | Keep trust-boundary regression.         |
| Shared records, dense manifests, precision, and opaque IDs             | H       | R    | Keep native/WASM equivalence.           |
| Invalid paint contexts and expanded resource limits                    | H       | R    | Keep safety limits.                     |
| Page labels, ordinary PDFs, and prepared-only operations               | H       | C    | Keep format behavior.                   |
| Registry IDs, UTF-8, composition report, and buffer lifetime           | H       | C    | Keep ABI ownership checks.              |
| Failed composition, retained Inputs, clearing, and retry               | H       | C    | Keep recovery behavior.                 |
| Blank-only composition and missing-contract failures                   | H       | C    | Keep source-free Jobs.                  |
| Optional display, profiles, and fill eligibility after page operations | H       | C    | Keep distinct property/operation paths. |

### Simulator entrypoints

These are acquisition entrypoints, not interchangeable unit tests. The collector selects them by name and records native
evidence.

| Entrypoint in `web/test/simulator/Probe.swift`                       | Benefit | Cost | Decision                                                  |
| -------------------------------------------------------------------- | ------- | ---- | --------------------------------------------------------- |
| [testSafariPortrait](web/test/simulator/Probe.swift#L108)            | H       | N    | Keep on demand.                                           |
| [testSafariLandscape](web/test/simulator/Probe.swift#L109)           | H       | N    | Keep on demand.                                           |
| [testStandalonePortrait](web/test/simulator/Probe.swift#L110)        | H       | N    | Keep on demand.                                           |
| [testStandaloneLandscape](web/test/simulator/Probe.swift#L111)       | H       | N    | Keep on demand.                                           |
| [testSearchSafariPortrait](web/test/simulator/Probe.swift#L112)      | H       | N    | Keep for calibration changes only.                        |
| [testSearchSafariLandscape](web/test/simulator/Probe.swift#L113)     | H       | N    | Keep for calibration changes only.                        |
| [testSearchStandalonePortrait](web/test/simulator/Probe.swift#L114)  | H       | N    | Keep for calibration changes only.                        |
| [testSearchStandaloneLandscape](web/test/simulator/Probe.swift#L115) | H       | N    | Keep for calibration changes only.                        |
| [testFullscreenPortrait](web/test/simulator/Probe.swift#L116)        | H       | N    | Keep optional API acquisition; record unsupported states. |
| [testFullscreenLandscape](web/test/simulator/Probe.swift#L117)       | H       | N    | Keep optional API acquisition; record unsupported states. |
| [testSearchFullscreenPortrait](web/test/simulator/Probe.swift#L118)  | H       | N    | Keep optional API acquisition; record unsupported states. |
| [testSearchFullscreenLandscape](web/test/simulator/Probe.swift#L119) | H       | N    | Keep optional API acquisition; record unsupported states. |
| [testInstall](web/test/simulator/Probe.swift#L121)                   | H       | N    | Keep actual Home Screen installation/launch.              |

## Initial audit verification

- Before deletion: model, offline, and runner checks passed 29/29 in 0.531 s, including five offline subtests.
- After deletion: the same files passed 28/28 in 0.358 s. Startup and cache variation prevent attributing the difference
  to the deletion.
- Asset integration passed separately: 1/1, 4.72 s test body, 4.85 s runner total.
- The three test runs used Node 24.21.0. Manual previews used Node 26.12.1 and 24.21.0 with Chromium 153.0.8010.12.
- Short native reproductions confirmed producer ordering and the undocumented diagnostic source.
- Markdown local-link inspection and `git diff --check` passed. Final formatting covers the changed documents and test
  file.

Commands executed from `web/` during the initial audit (baseline file names):

```sh
node --test test/model.test.ts test/offline.test.ts test/runner.test.ts
node --test test/assets.test.ts
```

The report uses retained older timing records to rank cost without rerunning long suites. Their revisions and limits
remain explicit. The initial audit did not run full browser/native suites or physical acceptance. External documentation
links and the Homebrew installation were not exercised. Follow-up validation is recorded below.

The follow-up preserves safety tests and reduces repeated setup. Unmeasured matrix and browser-process experiments
remain deferred.

Lean: removed one redundant test, the second producer JSON parse, and the unsafe Cairo debug reset. Added two behavior
regressions. No dependency was added or removed.

Not checked: complete C++ internals, physical mobile interaction, assistive technology, printer output, and current
hosted CI.

## Follow-up validation

Retained logs live under `.local/var/review/xray/`. Browser suites run sequentially. Automated web checks use Node
24.21.0.

| Check                                       | Result                                                                                                                                                                                    |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Native producer baseline                    | 8 cases, 454 assertions passed before the new regression.                                                                                                                                 |
| Ordering regression against baseline        | Failed on the unsorted Other controls array, as expected.                                                                                                                                 |
| Page-label regression against baseline      | Failed on the missing Output label, as expected.                                                                                                                                          |
| Native final producer/CLI/inspector/package | 30 cases, 803 assertions passed. Producer raster checks compare with librsvg at 150/300 DPI.                                                                                              |
| Native/WASM parity                          | Native contract: 40 cases, 1,143 assertions. Parity: 1 case, 65 assertions. Both passed.                                                                                                  |
| ASan/UBSan                                  | Contract, inspector, and package passed in the broad run. After narrowing cache cleanup, producer passed 9 cases/469 assertions and CLI passed separately. No leak suppression was added. |
| Focused production and geometry             | Source switching, offline/update, and shared geometry capture passed: 3 cases in 99.1 s.                                                                                                  |
| Full Page geometry                          | 5/5 cases passed in 194.2 s.                                                                                                                                                              |
| Page label and navigation regressions       | 2/2 passed in 11.5 s after the shared control-budget fix.                                                                                                                                 |
| Visual evidence                             | 16 settled viewport captures at 1440/768/390/320 px, both themes and panes, both densities, selected/unselected, and enlarged narrow-screen text.                                         |
| C++ checks                                  | Format and clang-tidy passed on the final sources. Clang-tidy reports only suppressed system-header diagnostics.                                                                          |
| Workflow syntax                             | Actionlint passed after ignoring its outdated known-runner list for the unchanged `ubuntu-26.04` label. No workflow rule was suppressed.                                                  |
| Standard pre-push gate                      | Passed: 28 unit checks and 107 browser checks, including nested cases. Browser duration: 993.0 s. Format, lint, types, and production build passed. Oxlint retains six existing warnings. |

The resumed native runs used Ruby 4.0.8; `.ruby-version` selects 4.0.7. No run on the pinned Ruby patch version is
claimed.

The broad sanitizer run initially failed in the producer after all font-cache cleanup was removed. The final change
removes only Cairo's debug reset. The final producer and CLI sanitizer runs pass with Pango/Fontconfig cleanup intact.

[Visual bounds and screenshots](.local/var/review/xray/page-labels/bounds.json) retain the label widths and tool modes.
At 1440 px, Output's long label keeps 78.28 px instead of 16.11 px; Compare and original-page controls remain in the
existing actions menu. At 320 px with 200% text, the label keeps 111.45 px. Full label text remains accessible.

The full Grid group passed 193 checks, including nested viewport cases, in 820.8 s. In the standard run, asset
integration took 4.8 s, Source switching 5.1 s, offline/update 26.9 s, and the new Page-label case 4.4 s. These are
test-body observations, not a matched before/after benchmark. The final review found no additional defect in the changed
surfaces.

No complete release/full gate, exhaustive candidate search, Xcode run, physical device, printer, screen-reader, or
hosted-CI result is claimed. Native mobile acceptance remains separate. Browser-process reuse and presentation-matrix
reductions were not implemented because no current measurement justified them.
