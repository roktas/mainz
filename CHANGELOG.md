# Changelog

## Unreleased

### Added

- Prepared PDFs can expose editable Style properties without a Show/Hide control.
- Product tour steps explain Normal/Compact Grid density and Output selection actions.
- Touch controls for grip dragging, lens inspection, and switching from Grid to Page with a double tap.
- Numeric Selection keyboards on touch screens.
- Pinch zoom in Page, with the same range as the zoom controls.
- Brief status emphasis after operations and page emphasis after a double-tap or double-click copy.
- Page additions, including copies, repeats, and Blanks, move a preview toward Output before the new pages appear.
- Page removal fades and shrinks outgoing pages. Moves animate cards into their new positions.

### Changed

- Header Notices use neutral text and the existing blue information accent in both themes.
- The web application is named PDF Composer.
- Settings uses −/+ controls for lens magnification from 2× to 128×, with the current factor displayed beside them.
- Remaining Grid cards slide into place after removal, and the single-pane Output button glows during page arrival.

### Fixed

- Product tour steps start at the beginning of their explanations after scrolling.
- Output movement buttons keep their positions and become disabled at selection boundaries.
- Bulk page additions target a new image in the visible Output Grid batch when both panes are displayed.
- Normal grids fit three rows at Full HD and four at QHD, with pagination captions below the slider.
- Style selectors retain their touch height on iPad and keep their arrows inset from the field edge.
- Opening Settings by touch keeps the close button free of an initial focus contour.
- Grid navigation and Shift selection keep the correct page positions while new copies await arrival and after resizing.
- Dragging during page removal uses the remaining Output pages for insertion.
- Phone Compact grids fit four columns and four rows without shrinking portrait thumbnails.
- Mobile Grid pagination shares one layout in both densities, with the caption next to the slider row. Phone pagination
  sits immediately above the status bar.
- Tall two-pane layouts fill the space above the status bar, keeping pagination and the pane divider at the bottom.
- Double-tapping Page images copies the current page on touch browsers without native double-click events.
- Grid grips stay centered across card widths, selection states, and page-number lengths.
- Touch grids fit more columns with smaller image margins and retain columns when viewport height changes. Page uses the
  same thumbnail width.
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
