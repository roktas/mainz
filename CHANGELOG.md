# Changelog

## Unreleased

### Added

- Optional plain-text `details` on parameter schemas, groups, profile sets, and profiles, requiring an accompanying
  description and preserved through PDF operations.
- On-demand authored guidance in Style, with no information button for missing or blank details.
- Print for the generated Output PDF, with browser PDF viewing and download alternatives.
- Editable Output filenames for Download and Print, with a way to restore automatic naming.
- A separate View PDF action between Print and Download, with preparation feedback in the app header.
- Native Share on iOS and Android, with named Output files, a share icon, and a ready-file step when the browser needs
  another tap. Desktop and unsupported browsers retain Download.

### Changed

- Profile choices apply matching names across open files by default, using each file's own values. A profile options
  menu offers per-file choices.
- Refreshed the Megic demo's profiles and guidance, with an unfilled Outlined default.
- Extended Page zoom to 3200% for buttons, keyboard shortcuts, pinch, and width fitting.
- Floating Quartet editors on desktop, retaining inline editors on narrow and touch layouts.
- Reduced desktop pane headings and document icons while preserving interaction targets.
- Matched Print and View glyphs to the 28 px document icons, with equal visible gaps between Output actions.
- Compact mobile Output actions, with a square Download icon button and totals beside the icons.

### Fixed

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
