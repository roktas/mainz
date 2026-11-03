# Changelog

## Unreleased

### Added

- Recipe loading from the landing page, with saved Input titles, embedded covers, XMP details, local PDF matching, and a
  separate Recipe demo. Loaded profiles, manual edits, and baseline resets remain editable and exportable.
- Output title and cover-page choices in the existing filename editor, written to generated PDF metadata and retained
  when the PDF is opened as a later Input.
- Optional page names, tags, triviality, and embedded PNG previews in the version 1 physical-page array, including
  metadata-only PDFs, numeric page scopes, native/WASM preview access, and `imprint --preview`.
- List view, page-name captions, and adjustable Input Grid/List visibility based on triviality, with complete Selection
  and Output retained. Thumbnails reuse supplied PNGs and fall back to PDF rendering after host image-decoder failures.
- List full-page previews, direct Page inspection with return to List, animated edits, and native/touch drag and drop.
- Matching Grid/List editing shortcuts and Ctrl/Command-arrow movement for selected or focused Output pages.
- `mainz resolve` emits a resolved Plan without producing a PDF. Global `mainz --help` succeeds without an input.
- Recipe export from PDF Composer, with explicit profile intent, manual edits and baseline resets, Input fingerprints,
  and editable logical Input IDs for CLI replay.
- Portable JSON Recipes and noninteractive `mainz apply`, with shared native/WASM resolution, separate file bindings,
  profile and override choices, baseline resets, dynamic all-pages selection, and changed-Input diagnostics.
- Optional publication identity and SemVer metadata for warning-free replay across producer-declared compatible changes,
  with all PDF and operation checks retained.
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
- Grid, List, and Page show supplied names on page-number hover or focus. Clicking merges the name into one detail panel
  immediately below the number. The demo names its cover and practice sheets and stores `Italic Strokes` in standard XMP
  title metadata.
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
- Grid and List share the Input visibility threshold and show its trailing toolbar control only for differing triviality
  values.
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
