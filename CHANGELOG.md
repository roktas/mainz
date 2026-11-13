# Changelog

## Unreleased

### Added

- Each source block in multi-Input Output has a document heading in Grid, List, and the downloaded PDF's bookmarks.
  Blocks retain their own TOCs through partial selections, repeats, and moves. Blank and Padding pages join the
  preceding block. Recipe replay retains the document titles.

- A Style toolbar control folds or unfolds all visible parameter groups without changing style values.

- A single Output List page-actions menu on phone-width screens, keeping titles readable and the eye control separate.

- Virtual `…` groups for uncovered TOC edge pages, with named cover exceptions and italic small-cap headings in List and
  Contents. The Lorem sample names its first page Cover.

- Alt/Option shortcuts for Grid, List, Page, and the previous pane view, plus a clear upgrade message on unsupported
  browsers.
- Independent Input and Output view selectors in Keyboard help, with task groups, side-by-side desktop guidance, stacked
  narrow layouts, and concise Mouse action/result tables.
- Direct start/end controls for vertical scrolling outside the Page image viewport.
- Blank-page insertion after the current Output page, alongside After last page.
- Compact physical and logical page-label navigation, with labeled first/last controls.
- Editable Output filenames in the compact document menu, with access to document details.
- Go to page in the view toolbar, with a temporary number field and first/last shortcuts that preserve Selection.
- Input List shows PDF page labels in their own column before page names when the document defines them.
- Collapsible List sections with block selection and dragging, section addition or copying, and first-page viewing.
  Sections start closed when the expanded list exceeds the pane height, with a toolbar toggle for all sections and
  ribbon disclosure buttons.
- List section headings are shown by default and can be hidden independently in each pane for a flat page list.
- TOC display titles, compact Input navigation, List section headings, and source-color dots for multiple-Input Output,
  with single and multiple demos.
- Public-domain TOC samples. All demo documents download on demand and use a separate, bounded offline cache.
- Recipe loading from the landing page, with saved Input titles, embedded covers, XMP details, local PDF matching, and a
  separate Recipe demo. Loaded profiles, manual edits, and baseline resets remain editable and exportable.
- Output title and cover-page choices in the existing filename editor, written to generated PDF metadata and retained
  when the PDF is opened as a later Input.
- Optional page names, tags, and embedded PNG previews in the version 1 physical-page array, including metadata-only
  PDFs, numeric page scopes, native/WASM preview access, and `imprint --preview`.
- List view and page-name captions, with complete Selection and Output retained. Thumbnails reuse supplied PNGs and fall
  back to PDF rendering after host image-decoder failures.
- List full-page previews, direct Page inspection with return to List, animated edits, and native/touch drag and drop.
- Matching Grid/List editing shortcuts and Ctrl/Command-arrow movement for selected or focused Output pages.
- `mainz resolve` emits a resolved Plan without producing a PDF. Global `mainz --help` succeeds without an input.
- Recipe export from PDF Composer, with explicit profile intent, manual edits and baseline resets, Input fingerprints,
  and editable logical Input IDs for CLI replay.
- Portable JSON Recipes and noninteractive `mainz apply`, with shared native/WASM resolution, separate file bindings,
  profile and override choices, baseline resets, dynamic all-pages selection, and changed-Input diagnostics.
- Shared Recipe Input assessments for unchanged bytes, quiet updates, explicit review, and blocking errors, with ordered
  page-name digests, reference counts, and an optional publication ID and integer `compat` veto.
- `mainz align` writes a separate reference Recipe without changing processing intent. Recipe commands support
  review-only `--force`, informational `--verbose`, and structured `--jsonl` records.
- Recipe loading shows per-Input explanations and explicit review acceptance. Changed loads offer an updated Recipe.
  Shared e2e cases also provide development-only UI demos outside the logo menu.
- Optional Style families and semantic parameter keys, preserved through production, styling, extraction, and
  composition.
- Optional plain-text `details` on parameter schemas, groups, profile sets, and profiles, requiring an accompanying
  description and preserved through PDF operations.
- On-demand authored guidance in Style, with no information button for missing or blank details.
- Print for the generated Output PDF, with browser PDF viewing and download alternatives.
- Editable Output filenames for Download and Print, with a way to restore automatic naming.
- A separate View PDF action between Print and Download, with preparation feedback in the app header.
- Native Share on iOS and Android, with named Output files, a share icon, and a ready-file step when the browser needs
  another tap. Desktop and unsupported browsers retain Download.

### Changed

- Center Output List source markers between page numbers and titles.
- Update the web toolchain to Node.js 26 LTS and current compatible dependencies.
- Move installation guidance to Settings → Install application, available on the landing page and immediately above
  application details in the workspace.
- Match Output Page footer action sizes and spacing to Input controls.
- Single-pane workspaces combine document menus, centered Input/Output counts, and Open PDF or Download/Share in one
  compact bar. Both menus use the same three-dot icon. Counts retain their text size and show only pages when full
  totals do not fit; document menus retain the complete page/sheet summary.
- Narrow Input and Output align shared view tools and card addition/duplication actions while retaining desktop
  controls.
- View tabs use a soft selected background, with more space between labeled tabs in compact workspaces. Visible toolbar
  icon edges align with the selection fields at every width.
- Grid retains breathing room below its final row when scrolled to the end.
- Grid and List sections fold and unfold faster. Unfolding starts the reverse slide without a heading pulse. Grid also
  opens same-page child sections when their parent is unfolded, avoiding inaccessible page gaps.
- Remove Filename from Output page actions.

- Grid and List share section ribbons and fold choices, with one visible heading per physical starting page.
- The TOC examples use the 59-page Lorem Ipsum PDF with three outline levels.
- List section headings put the current title first, with muted parent titles and a compact full-path panel.
- List places drag grips before page numbers. Section ribbons combine folding and dragging, followed by their starting
  position and optional Input PDF page label. Nested headers use depth tints. Titles and starting page numbers use
  normal text color when closed and primary when open, with the same text weight. Ribbons keep the secondary color.
- Jump to section navigates from headers and pages to their ancestors, including the current Output occurrence.
- Contents reveals the exact target in every view. Jump targets receive a brief highlight that respects reduced motion.
- List rows use the full selection-bar width, with a stable external scrollbar gutter and matching toolbar separator.
- List uses the same thin native scrollbar as Grid in both panes.
- Grid and List are separate one-click tabs, replacing the Pages layout switch while preserving each pane's view state.
- Page places page labels in the leading footer corner and centers navigation arrows beside the middle actions.
- Compact Grid numbers have more leading space, including wide counters.
- Selected expanded List sections use a soft tint and selection tick without a leading line.
- Landing file actions share a row on narrow screens and gain width on wide screens.
- File details align fields and values in a table and include PDF Info authors when XMP has none.
- Shortcut Help uses more compact keycaps and groups routing notes to fit desktop List views.

- Centralized notifications and errors in the header, with short summaries, optional details, and stable local error
  cues.
- Updated Recipe export offers a timestamped copy or explicit local-file replacement in the header message panel.
- Shortened action labels and kept them on one line, with matching button sizes and less space above message actions.
- The header logo opens Home with one click, replays its animation with two, and opens examples with three or more.
- Bounded mounted List rows while preserving physical positions, occurrence identities, selection, and scrolling.
- Centralized persisted Style intent and moved row interaction and edit feedback lifecycle to their owning surfaces.
- Page names use small caps across List, captions, details, previews, and drag strips.
- Product tour steps cover Input and Output List views and explain Recipe export, Print, and View PDF. Help clarifies
  its view-specific shortcuts and List range selection. Recipe export uses JSON braces in the secondary color and bold
  table headings.
- Recipe matching uses a shorter heading, an aligned larger logo, and primary PDF choices that share footer button
  dimensions. Input and Recipe details use readable, bold field names and information icons without circular hover
  shadows.
- Moved Grid cards and List rows show a fading arrival cue. Page returns use a stronger highlight with a longer fade in
  Grid and List.
- Recipe export starts with editable Input names. Narrow Recipe matching keeps PDF choices beside smaller covers and
  opens long descriptions from the title without moving rows.
- Breaking CLI changes for the next major release: PDF styling uses `style --overrides`, Recipe execution uses `apply`,
  and SVG production uses `imprint`. Update callers from `apply --request`, `run`, and `produce`, respectively.
- Aligned library and web names around Plan, Artifact, Provenance, and Imprinter. WASM Recipe resolution returns `plan`;
  composition metadata uses `mainz_provenance` exports. PDF styling uses the combined `mainz_style` boundary.
- Grid and Page show supplied names on page-number hover or focus. List keeps the name inline. Clicking merges the name
  into one detail panel immediately below the number. The demo names its cover and practice sheets and stores
  `Italic Strokes` in standard XMP title metadata.
- View and Grid density changes reveal the inspected page, with a brief secondary cue for tab returns and preserved
  keyboard focus for content returns.
- Grid and List transfers preview resulting page numbers, including moving images and placeholders. Grid folds follow
  the resulting front/back side. List strips retain row typography and column alignment.
- Named pages show a centered lens caption, with long names truncated within the viewport.
- Normal Grid footers and List row actions appear on hover or focus with a fine pointer. Touch retains visible Input
  addition and uses an Output menu in List and Normal Grid.
- Normal Output cards share List's paired movement and remove/duplicate controls. Individual Grid/List plus actions
  preserve selection and keep new occurrences unselected.
- List selections use the primary background with contrasting text and replace row Add/Duplicate actions with an
  unselect tick. Output rows reveal paired move and remove/duplicate actions on hover or focus, with a visible menu for
  touch and narrow panes. Page details stay beside their number.
- Cross-file Style choices use explicit families. Profiles match by family and name; parameter edits and resets require
  matching semantic keys and equal previous values. The profile menu offers per-file scope and disables without
  compatible peers.
- Refreshed the Megic demo's profiles and guidance, with an unfilled Outlined default.
- Extended Page zoom to 3200% for buttons, keyboard shortcuts, pinch, and width fitting.
- Floating Quartet editors on desktop, retaining inline editors on narrow and touch layouts.
- Reduced desktop pane headings and document icons while preserving interaction targets.
- Matched Print and View glyphs to the 28 px document icons, with equal visible gaps between Output actions.
- Compact mobile Output actions, with a square Download icon button and totals beside the icons.

### Fixed

- Contents opens virtual `…` groups into individual page destinations and includes named Cover/Back edge pages without
  duplicating existing TOC targets. These navigation entries remain display-only.

- Complete, ordered single-Input downloads preserve the source document structure while applying styles, including TOC,
  names, labels, XMP, attachments, and publication identity. Unchanged assignments preserve the original bytes.
- Partial and mixed compositions retain source TOC sections, prune empty branches, and retarget bookmarks in Output
  order.
- Output starts in Grid independently of Input, including TOC demos. Mouse Help describes results with Adds, Opens, and
  Moves.
- List additions carry actual page images. Addition flights and their Output glow last 900 ms.

- Page-addition previews target the Output Page viewport instead of its heading in two-pane layouts.

- List uses the remaining viewport height on short screens, keeping its native scrollbar and final row reachable through
  section folding and orientation changes.

- Scroll endpoint controls require complete visible panel rails and persistent document scrollbar gutters, avoiding
  stray markers on mobile landscape screens.

- List titles reclaim the individual editing-action slots while Selection delegates edits to its selection bar.

- Compact List identity and action columns respond to their available width, preserving title space and 44 px target
  height independently of Page footer spacing.

- Wider spacing for compact Output Page actions and icon-only view tabs when room permits.

- Page navigation arrow tips align with the header controls, and labeled single-pane tabs leave more room around the
  changed-Style indicator.
- Keep the touch lens centered on the latest finger position during a hold, and route List paging and Grid endpoints
  through the targeted pane.
- Retain keyboard ownership when Grid or List virtual rows are replaced during large scroll jumps, and keep enlarged
  insertion menu labels readable with wider system fonts.
- Keep enlarged Output insertion labels within their menu, preserve Page label space, and return focus to Page tabs on
  Escape with an empty selection. Hide scroll endpoints when document scrolling is clipped.
- Align Grid, List, Page, and Style content below compact selection hints; keep individual Style fields at full width.
- Keep large Grid and List scroll destinations reachable in WebKit without changing the native scrollbar range.
- Keep Contents destinations visible after unfolding and align Page footer actions vertically.
- Use compact filename fields and spaced dialog actions, a visible desktop Output disclosure, and consistent Go to page
  headings.
- Preserve folded Grid cards on Page return, highlight navigation targets, and keep touch editing controls visible.
- Keep tablet detail and action panels compact and opaque; align Page footer controls and simplify Help and menus.
- Keep mobile Input and Output labels within their buttons at enlarged text sizes.

- Restored List heading focus and highlighting when jumping from Contents.
- Matched Grid and Page thumbnail sizing for consistent lens scales.

- Modified Enter and Space on List section headings preserve selection and the current view.
- Grid removal finishes without reading discarded row state.
- Grid action menus retain clickable controls after focus moves into them. Addition previews start at the captured image
  position.

- Keep Grid card touch targets fully inside the scroll frame and prevent touch grip selection from toggling twice.
- Compact repetition menus and Page navigation, widen phone landing actions, and clear stale notices when new work
  starts.
- Offer native PDF sharing for printing from iPhone Home Screen apps, with cancellation and download recovery.
- Align the first narrow view icon and measure the trailing Go to page control in browser regressions.

- Retain List viewport positions across view returns and let touch drag strips move freely in both directions.
- Align section navigation markers, anchor tablet Input details to their trigger, and restore Output Grid footer
  actions.
- Use icon-only view tabs in narrow toolbars.
- Align workspace separators and Grid page controls, hide redundant PDF labels, and preserve source-dot colors.
- Restore Input addition feedback in List and narrow layouts, and clip jump feedback to folded page corners.

- Clearing a header report cannot crash child effects during teardown.
- Normal Grid keeps physical numbers centered and shows page labels in a detail table; long section paths stay inside
  the detail panel.
- List page and section View icons stay aligned when hierarchy controls widen the shared action column.
- Keep the Output Remove button's danger background on hover and press so its white minus remains visible in light mode.
- Header feedback keeps application update progress within one row without a vertical scrollbar.
- TOC examples open on a fresh static-host visit through query URLs.
- Contents reveals the current section in long outlines and announces one current location.

- TOC containers with unusable headings or targets retain their navigable children without extending unrelated sections.
- Large outlines reuse indexed title lookups and bounded breadcrumb caches; closed Contents trees mount only when
  opened.
- Clearing a header message no longer interrupts feedback rendering.
- Allowed dense prepared PDFs to discard stale previews with a separate 4,194,304-reference traversal budget. Cleanup
  avoids array copies and retains attachments referenced elsewhere in the PDF.

- Shortened the landing PDF action so its label fits enlarged text with wider system fonts.

- Kept header feedback usable inside the filename editor and in short landscape viewports. Open panels retain visibility
  when header controls hide, and page names retain wrapping.

- Replaced trailing timestamps in automatic Output filenames so repeated exports keep a single timestamp.
- Raised Recipe matching instructions toward the filename, leaving more space above the PDF choices.

- Rejected escaped compositing CSS in SVG production before splitting overlapping layers. Safe selectors and quoted line
  continuations remain supported.
- Kept Recipe binding cancellation at exit 130 and rejected invalid lookup components before adding the PDF suffix.
- Counted shared Input bytes once across independent Input instances, matching Download preflight.
- Reused transferred PDF bytes across distinct PNG requests and bounded validated processor PNG retention to 16 MiB.
- Preserved PNG thumbnail proportions on white page backgrounds and displayed opaque metadata keys literally.
- Cancelled pending List hover previews with Escape.
- Restored inspected List rows after Input switching and kept Delete limited to the Output selection.
- Released page-detail state when List rows leave their mounted window, so later hover previews remain available.
- Aligned plain List page numbers with detail buttons and replaced repeated name tooltips with selection help.
- Delayed parameter information and page-name hover tooltips by 220 ms while keeping explicit activation immediate.
- Shortened view-return feedback to 1.2 seconds, removed its side bar, and held the final color to prevent a second
  flash.
- Capitalized the demo cover's page name as `COVER`.
- Inset matched PDF filenames and status text to balance the download glyph's opposite margin, with narrow stacking
  retained.
- Aligned the cover-page number field with Use default while retaining usable widths when the cover controls wrap.

- List transfers keep a flat strip attached to its grab point and a stable insertion slot while neighboring rows move.
  Output rows keep source page labels in details so they do not appear as duplicate position numbers.
- Multiple PDF-opening errors remain readable in a separate details panel outside the header.
- Retained stationary lens hover intent when a thumbnail raster refreshes, while preserving Escape and pointer-leave
  dismissal.
- Corrected profile-styling diagnostics for metadata-only PDFs.
- Kept narrow Normal card grips centered when the paired footer and selection contour are present.
- Kept narrow List selections from reserving hidden action columns and shortened long row names with an ellipsis.
- Applied the shared worker cleanup and error recovery to PNG preview access.
- Cleared List entrance feedback when motion preferences change during an edit.
- Kept page-name tooltips inside the viewport, preventing horizontal overflow and blocked touch targets on narrow
  screens.
- Kept the lens's accessible physical page number when previews use extracted PDFs.
- Kept PNG previews outside changed parameters' page scopes during styling, reset, and composition.
- Kept List keyboard navigation in its pane, included the first row in Shift ranges, preserved Input selection when
  opening Page by double-click, and retained row focus after unselecting its tick.
- Equalized Output page-menu action dimensions and added consistent space between actions.
- Prevented late offline asset requests from recreating retired application caches.
- Kept Style opacity values readable as percentages and preserved slider space and stored precision.
- Matched the desktop Open PDF and Download button dimensions.
- Kept parameter information dismissal inside its Style editor and restored focus to its information button.
- Reduced exaggerated thin strokes in Grid thumbnails with bounded sampling and separate thumbnail/Page raster reuse.
- Kept narrow-screen header feedback within the existing header area without moving the workspace.
- Used a separate PDF window for Safari printing to retain all Output pages instead of printing an embedded first page.
- Opened View without a second confirmation in iPad Chrome and Safari Home Screen apps, with their native PDF viewers.
- Kept header messages compact, centered, and on one row, with reachable recovery actions and no persistent touch focus
  outlines on non-editable controls.

## 1.0.0 - 2026-10-29

Initial release.
