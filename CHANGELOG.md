# Changelog

## Unreleased

### Added

- Optional plain-text `details` on parameter schemas, groups, profile sets, and profiles, requiring an accompanying
  description and preserved through PDF operations.
- On-demand authored guidance in Style, with no information button for missing or blank details.
- Print for the generated Output PDF, with browser PDF viewing and download alternatives.
- Editable Output filenames for Download and Print, with a way to restore automatic naming.

### Changed

- Refreshed the Megic demo's profiles and guidance, with an unfilled Outlined default.
- Extended Page zoom to 3200% for buttons, keyboard shortcuts, pinch, and width fitting.
- Floating Quartet editors on desktop, retaining inline editors on narrow and touch layouts.
- Reduced desktop pane headings and document icons while preserving interaction targets.

### Fixed

- Prevented late offline asset requests from recreating retired application caches.
- Kept Style opacity values readable as percentages and preserved slider space and stored precision.
- Matched the desktop Open PDF and Download button dimensions.
- Kept parameter information dismissal inside its Style editor and restored focus to its information button.
- Reduced exaggerated thin strokes in Grid thumbnails with bounded sampling and separate thumbnail/Page raster reuse.

## 1.0.0 - 2026-10-29

Initial release.
