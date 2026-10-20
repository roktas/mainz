# Changelog

## Unreleased

### Added

- Optional app installation guidance, with dismissible iPhone/iPad startup help and a permanent Help topic.
- Help on the landing page and touch screens, with topics for the current input and workspace.
- Development-only Grid geometry exports and a shared viewport inventory and calibration search.

- Dedicated iOS Home Screen and PWA icons with fixed colors and tested raster sizes.
- Prepared PDFs can expose editable Style properties without a Show/Hide control.
- Product tour steps explain Normal/Compact Grid density and Output selection actions.
- Touch controls for grip dragging, lens inspection, and switching from Grid to Page with a double tap.
- Numeric Selection keyboards on touch screens.
- Pinch zoom in Page, with the same range as the zoom controls.
- Brief status emphasis after operations and page emphasis after a double-tap or double-click copy.
- Page additions, including copies, repeats, and Blanks, move a preview toward Output before the new pages appear.
- Page removal fades and shrinks outgoing pages. Moves animate cards into their new positions.

### Changed

- The landing product name keeps a readable minimum on narrow screens. Touch-only landing pages omit the persistent
  file-drag instruction.
- Grid calibrations fit more complete cards in measured iPhone and iPad layouts and in Mac and external-display
  references, while preserving readable previews, usable controls, and shared Input/Output frame dimensions.
- Header actions use the available space after the logo when no Notice is present.
- The workspace status bar scrolls with very short screens so it does not cover enlarged card targets.

- Offline installation verifies up to four assets concurrently and completes pending writes before rolling back a failed
  installation.
- Style controls share one Output page-usage count instead of scanning every occurrence for each control.
- Header Notices use neutral text and the existing blue information accent in both themes.
- The web application is named PDF Composer.
- Settings uses −/+ controls for lens magnification from 2× to 128×, with the current factor displayed beside them.
- Remaining Grid cards slide into place after removal, and the single-pane Output button glows during page arrival.
- Both Grid densities paginate complete rows within the available viewport. Very short screens retain usable cards and
  controls through document scrolling.
- Grid columns share available width with equal outside spaces. Row spacing follows column spacing, leaving unused
  height below the cards.
- Normal Grid images stay near twice the linear size of Compact images at ordinary text size.

### Fixed

- Lens refinement starts without a movement settling delay, keeps completed detail aligned during movement, and releases
  acquired pages on cancellation or renderer failure.
- Closed PDFs release their cached preview rasters after their last owner leaves.
- The theme button exposes its effective dark-theme state and follows system changes until an explicit choice.
- Narrow two-pane headings align Open PDF and Download, with Output totals beside Download.
- Window blur, resizing, and workspace closure release native and touch drag previews.
- Concurrent Vite servers retain complete static-asset revisions, including changed public files and PDF.js resources.
- Landing top spacing stays bounded on wide screens with coarse-pointer input.
- Grid pagination captions stay below the slider in both densities and pane layouts.
- Enlarged text keeps complete Grid rows above pagination and header Notices visible while scrolling.
- Viewport calibrations change card dimensions and spacing within explicit width, height, and primary-input bounds.
  Unmatched screens use shared geometry and the same pagination policy.
- Product tour steps start at the beginning of their explanations after scrolling.
- Output movement buttons keep their positions and become disabled at selection boundaries.
- Bulk page additions target a new image in the visible Output Grid batch when both panes are displayed.
- Style selectors retain their touch height on iPad and keep their arrows inset from the field edge.
- Opening Settings by touch keeps the close button free of an initial focus contour.
- Grid navigation and Shift selection keep the correct page positions while new copies await arrival and after resizing.
- Dragging during page removal uses the remaining Output pages for insertion.
- Mobile Grid pagination shares one layout in both densities, with the caption below the slider row. Phone pagination
  stays clear of the status bar.
- Tall two-pane layouts fill the space above the status bar, keeping pagination and the pane divider at the bottom.
- Double-tapping Page images copies the current page on touch browsers without native double-click events.
- Grid grips stay centered across card widths, selection states, and page-number lengths.
- Grid and Page use the same thumbnail column dimensions on touch and mouse layouts.
- Page lens magnification uses the thumbnail's fitted width and height in both densities.
- Page heading and navigation keep their fitted alignment while zoom changes the image size.
- Animated additions initialize Grid capacity, and drag previews follow the rendered card slots and image insets in both
  densities.
- Carried page previews respect their size bounds at fractional card dimensions.
- Compact selection keeps page images fixed when border emphasis changes.
- Input chooses its initial density after opening completes, without counting the temporary loading area.
- Drag feedback on touch screens. Grid drops and selection actions keep the keyboard closed.
- Repeated Page image activation copies the current page and preserves Selection.
- Move controls stay in the Output selection bar when space permits, including tablet landscape layouts.
- Build IDs use Istanbul time and retain the full UTC build timestamp in their details.
- Input changes cancel pending double-clicks, double-taps, and transfers. Output gestures stay independent. Page
  shortcuts cannot edit the workspace during a drag.
- Download stays disabled for invalid style drafts that affect Output, including drafts in inactive Inputs.
- Large Style panels calculate page coverage without repeated linear searches.
- Ordinary PDFs release their validation worker after opening instead of retaining unused WASM memory.

## 1.0.0 - 2026-10-17

Initial release.
