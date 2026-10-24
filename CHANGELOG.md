# Changelog

## Unreleased

### Added

- Optional app installation guidance, dismissible iPhone/iPad startup help, dedicated Home Screen icons, and Android
  launcher-mask support.
- Help on the landing page and touch screens, plus Product tour steps for Grid density and Output selection actions.
- Touch grip dragging, lens inspection, Grid-to-Page double taps, numeric Selection keyboards, and Page pinch zoom.
- Brief status and page emphasis after operations. Additions carry a preview toward Output; removals fade and shrink;
  moves and remaining cards animate into place. The single-pane Output button glows during page arrival. Reduced-motion
  preferences suppress animations.
- Prepared PDFs can expose Style properties without a Show/Hide control.

### Changed

- The landing page gives the product name more prominence and uses a softer neutral tone for the purpose heading.
  Supporting copy is shorter.
- The bundled demo includes an eighth practice page with crossed strokes from the same Ital Winters 7.9 mm series.
- The web application is named PDF Composer. Settings adjusts lens magnification from 2× to 128× with −/+ controls.
- Normal and Compact Grid show complete rows within the available viewport. Input chooses its initial density after
  opening and retains it per Source. Grid and Page share thumbnail dimensions. At ordinary text size, Normal images stay
  near twice Compact size.
- Grid fits more readable cards in measured phone, tablet, Mac, and external-display layouts. Columns distribute space
  evenly, with matching row gaps and unused height below complete rows. Calibrations affect only matching viewports.
- Measured Android touch layouts fit two Normal columns on narrow phones, extra Compact rows, and denser tablet grids.
- Desktop Grid fits four Normal columns in more Safari window sizes. At a measured QHD PWA viewport, Normal shows 16
  pages and Compact shows 64, with complete rows and reachable pagination.
- Grid pagination displays at most 64 marks while retaining every exact slider position and page-range label.
- Touch Page starts with a wider image when Fit is too small, in both pane layouts. Fit restores the complete page, and
  manual zoom persists across view changes. Header and footer controls align with the frame; overflow actions use the
  pane menu.
- iOS and Android Home Screen icons use larger artwork and thicker strokes with matching safe margins.
- Without a Notice, header actions use the space after the logo. Notices use neutral text and the information accent in
  both themes.
- Offline installation verifies four assets concurrently and completes pending writes before rolling back a failed
  install.
- Style previews and Download reuse composition calculations. Repeated pages and drag previews use indexes instead of
  repeated full scans.
- PDF opening reads complete page geometry in bounded groups and releases each inspected page, including on failure or
  cancellation.
- PDF previews cache rendered canvases without creating temporary full-image copies.

### Fixed

- Pane headers, view toolbars, and page selection controls stay on one row in narrow layouts.
- Output Page retains PDF page labels after reordering and repetition. Long labels keep space beside Page controls.
- SVG production uses parameter ID order for Other controls, while preserving explicit group arrays.
- The SVG command keeps Cairo's shared caches intact, avoiding shutdown assertions after rejected content.
- The Output tour places copied selections after the last selected page, matching the actual operation.
- Grid pagination keeps its edge alignment when fitting mounts its controls after a view or density change. Its keyboard
  focus indicator stays clear of the caption.
- Normal Grid card controls keep separate touch targets within cards and across consecutive rows. Long Compact page
  numbers retain readable text.
- The lens fits short landscape viewports in both pointer modes.
- Output explains referenced Input count and byte limits before Download, and profile descriptions retain valid ARIA
  references for opaque profile-set IDs.
- Prepared Inputs retain at most one idle processing worker across the workspace. Repeated Style previews reuse cached
  page buffers without copying and sending the complete PDF again.
- Composition reads unchanged Sources directly from immutable Inputs instead of copying each complete PDF.
- Page pinch cancellation clears pending anchors and temporary transforms after navigation, pane hiding, or teardown.
- Touch Grid dragging locates visible slots without scanning the complete Output on each movement.
- Offline installation retries temporary download failures and gives short reload and reporting guidance if it fails.
- PDF processing retries use a fresh WASM instance after an operation or document cleanup fails. Cleanup errors retain
  the original processing error when both fail.
- The workspace status bar no longer covers Grid pagination or Page controls when a minimum usable frame needs
  scrolling.
- Desktop Grid fits card dimensions and gaps within their visual limits before losing a feasible row or column at a
  calibration boundary.
- Portrait touch Grid fits readable columns and rows across nearby phone and tablet dimensions, including nominal Chrome
  DevTools viewports. Switching to Style retains a mixed-density companion Grid's minimum frame.
- Style shows Reset all styles only after a change and retains keyboard focus when resetting hides the control.
- Touch Page keeps zoom controls and frame alignment when landscape orientation exposes both panes.
- Single-pane Grid reserves one caption line below its slider. Medium tablet portrait layouts fit four Compact rows
  while keeping page previews readable.
- Settings, Help, and installation help close on an outside tap even when native dialog light dismissal is unavailable.
- Two-pane Style scrolls its fields within Input while keeping Output controls, Grid capacity, and Page frames in place.
- FHD Grid fits two Normal rows and four Compact rows in the measured 1920 × 961 browser viewport. Desktop estimates
  reserve 120 CSS px for browser and desktop controls, with separate references for measured content viewports.
- QHD browser windows fit seven Compact rows on the measured GNOME and macOS viewports, with three Normal rows and
  unchanged image padding and control sizes.
- Opening several PDFs continues after an invalid file. A short alert summarizes failures, with complete diagnostics in
  a keyboard-accessible list. The count and details control share a compact, wrapping disclosure. Cancel stops the
  remaining files.
- Overlapping PDF preview renders release their own pages and cancel obsolete tasks while retaining the last completed
  image. Closed PDFs release cached rasters after their last owner leaves. Ordinary PDFs release their validation worker
  after opening.
- Page previews ignore hidden-pane measurements. Loading, density changes, and selection keep images within their
  frames. Lens refinement starts without a settling delay, stays aligned during movement, and releases pages on
  cancellation or failure. Page lens magnification follows the fitted thumbnail in both densities. Selection keeps image
  positions fixed.
- Grid pagination captions stay below the slider in both densities and pane layouts, clear of the status bar. Short
  screens scroll to preserve complete rows, enlarged targets, and header Notices. Tall panes fill the available height.
- Grid grips stay centered and clear of page numbers and folded corners. Page headers, navigation, zoom tools, and image
  gutters retain their alignment and complete targets, including enlarged text. Single-pane touch Page omits grips.
- Input and Output headings align in narrow two-pane layouts, with totals beside Download. Landing spacing and product
  text remain readable; touch-only landing pages omit the persistent file-drag instruction.
- Grid navigation and Shift selection retain correct positions during additions and resizing. Removal and dragging use
  the remaining Output pages. Move buttons stay in place, disable at selection boundaries, and remain in the selection
  bar when space permits.
- Addition animations use the targeted image and position, including prepared sequences and bulk additions. Unavailable
  targets use the action area. New drags retire fading cards before measuring slots; previews respect image insets and
  size bounds.
- Repeated Page activation copies the current page and preserves Selection, including touch browsers without native
  double-click events. Input changes cancel pending double clicks, double taps, and transfers without disturbing Output
  gestures.
- Window blur, resize, and closure release drag previews. Page shortcuts cannot edit during dragging. Touch Grid drops
  and selection actions keep the keyboard closed.
- Invalid style drafts affecting Output block Download, including drafts in inactive Inputs. Style controls retain touch
  targets and inset arrows. Touch-opened Settings keeps its close button free of an initial focus contour.
- The theme button exposes its effective state and follows system changes until an explicit choice. Product tour steps
  start at the beginning after scrolling. Build IDs use Istanbul time and retain the full UTC timestamp in their
  details.
- Concurrent development servers retain complete static-asset revisions, including changed public files and PDF.js
  resources.
- CLI output installation retries temporary-file removal during cleanup if the first removal fails after successful
  installation.

## 1.0.0 - 2026-10-17

Initial release.
