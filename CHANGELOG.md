# Changelog

## Unreleased

### Security

- Enforce QPDF decompression and filter memory limits, compose record/locator budgets, and inline signature checks.
- Reject SVG processing instructions (`<?xml-stylesheet?>`) and XInclude directives in `mainz imprint`.
- Add strict Content-Security-Policy and `no-referrer` metadata to the web app and anchor `help.html` `<base href>` to
  the same origin.

### Fixed

- Support inline-dictionary `BDC` markers and `/GoTo` actions, enforce `/OC` and `/AIS` guards, handle partial
  `/PageLabels`, and preserve `/MediaBox` fallbacks in `mainz imprint`.
- Allow saving Output filename and title when Output is empty, hide individual Input List add buttons during selection,
  and always show an explanation above header Dismiss actions.
- Fix thumbnail failure fallback, PDF raster cleanup on cancellation, offline cache asset filtering, List section reveal
  on Page return, Settings focus, Scroll control DOM placement, and Quartet popover re-anchoring.
- Make native release archives deterministic and atomic, and record `pangocairo` and `fontconfig` versions in
  provenance.

## 1.0.0 - 2026-11-20

### Added

- Compose PDF pages from multiple inputs, with page ordering, repetition, and blank pages.
- Edit declared paint and restore original styles in prepared PDFs.
- Save and replay composition Recipes in PDF Composer and the CLI.
- Prepare editable PDFs from SVG with `mainz imprint`.
