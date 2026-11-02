# Changelog

## Unreleased

### Added

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

- Breaking CLI changes for the next major release: PDF styling uses `style --overrides`, Recipe execution uses `apply`,
  and SVG production uses `imprint`. Update callers from `apply --request`, `run`, and `produce`, respectively.
- Aligned library and web names around Plan, Artifact, Provenance, and Imprinter. WASM Recipe resolution returns `plan`;
  composition metadata uses `mainz_provenance` exports. PDF styling uses the combined `mainz_style` boundary.

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
