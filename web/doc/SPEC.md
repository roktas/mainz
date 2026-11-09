# PDF Composer Specification

PDF Composer builds one Output from selected pages of local PDFs. The workspace supports extraction, duplication,
repetition, removal, and ordering across Inputs. Prepared PDFs also expose their declared Style controls. Ordinary PDFs
support page composition. Input retains its opened appearance. Output shows the arranged pages with completed Input
styles. Download, Share, and Print use the generated Output PDF.

This document owns workspace behavior and the [product glossary](#glossary). [VIEW.md](VIEW.md) owns visual rules,
layout reference cases, and the [UI glossary](VIEW.md#ui-glossary). The [library specification](../../lib/doc/SPEC.md)
owns PDF contracts, painting restrictions, and processor limits. Implementation details belong in code. Build and
validation commands belong in [AGENTS.md](../../AGENTS.md#web).

## Implementation status

The application implements Grid, List, Page, Style, and authored page-name captions. Thumbnails use eligible producer
PNGs with PDF rendering as the host-decoder fallback. Page, lens, Compare, and generated PDFs use PDF content. The
[library contract](../../lib/doc/SPEC.md#implementation-status) owns page metadata and preview validation.

## Workspace

One workspace supports several independent Inputs and one Output. The main flow is Input selection, addition to Output,
optional Style changes, and Download or Print. View changes preserve selections, Input styles, Output, and preview
state. Ordinary PDFs support composition. Prepared PDFs also expose their declared Style controls.

The landing distinguishes page composition for ordinary PDFs from Style support in prepared PDFs and links to the
library specification. Its primary Open PDF action selects one PDF. The secondary Recipe action selects a JSON Recipe
and starts Input matching. The workspace offers Recipe export. Its header logo opens Home on a single click and replays
the logo animation on a double-click.

### Inputs

Opening a PDF creates an independent Input without changing Output. Equal bytes or filenames do not establish Input
identity. Inputs can share immutable Input bytes while keeping independent overrides and page preparation.

The first opening shows progressively rendered pages after geometry becomes available. Editing stays blocked until
processor validation succeeds. The header reports opening progress and provides Cancel once, on both the landing page
and the workspace. Failure or cancellation discards the provisional Input. Opening another PDF retains the existing
workspace until the new Input is ready. Errors identify the file, cause, and next action. Incompatible style information
requires a newly prepared PDF.

A multi-file selection in the workspace opens each file in order. A file that fails does not prevent later files from
opening. Errors appear after the batch completes. A short alert reports the failed count. Clicking that message opens a
scrollable list with every failed filename and diagnostic in a separate popover outside the header. Cancel stops the
current opening and the remaining files.

Opening the same PDF again creates an independent Input with the styles saved in that PDF and a new preparation. The
Input chooser lists open Inputs and offers Remove Input for the active Input. An Input cannot be removed while Output
references it. Removing Inputs never changes existing Blank dimensions.

Input titles come from nonblank XMP `dc:title`, then PDF Info `Title`, then the opened filename. Candidates must fit the
4096-byte UTF-8 limit and XML text rules. If no valid candidate exists, use `Untitled`. Wide layouts show a muted title
beside the filename, with truncation when necessary. The Input chooser also shows the title. Hover and the information
button expose the full title in constrained layouts. Available XMP fields appear as plain text in those details. Missing
fields add no empty placeholders. Details include Author and Copyright when declared in XMP; PDF Info Author supplies
the author when XMP has none. The declared XMP `mainz:coverPage` selects the cover when it is a valid physical page;
otherwise the first page is used.

The Input chooser switches Inputs. Each retains its view, inspected page, zoom, Pages layout, scroll position, and
preparation. Home requests confirmation before discarding undownloaded style or Output changes. Acceptance suppresses
the browser exit warning for that navigation. Cancellation retains the workspace. Opening an Input or changing Selection
alone does not mark Output as changed.

### Views and Pages

Input offers Grid, List, and Page tabs, plus Style for prepared PDFs. Output offers Grid, List, and Page. Grid and List
are two direct views of Pages. Grid shows scrollable thumbnails; List shows page numbers, names, and section headings.
Both use one shared selection model. Input includes every physical page in PDF order. Output includes every expanded
occurrence, including Blank and Padding. Page shows one enlarged page at a time without narrowing the current selection.

Grid scrolls within the fixed pane frame and keeps one readable card geometry. It renders a bounded window of visible
rows for long documents. The scrollbar sits in the pane's right gutter. Wheel and touch gestures scroll the full
sequence without pagination. The first and last physical pages remain reachable.

Each Input retains its Pages layout and its Grid and List scroll positions. Output keeps independent settings. Changing
the Pages layout preserves selection, inspected page, and Output order. List keeps expanded sections. Changing browser
size preserves the first visible page when the number of columns changes. Page returns to the previous Pages layout and
reveals its inspected page.

Grid and List interactions set the page that Page inspects. Output inspection follows occurrence identity through edits.
Removal chooses the next surviving neighbor, or the previous neighbor at the end. Switching Inputs does not change
Output inspection. Changing a view does not change page selection.

Pages and Page offer Go to page in their toolbar. Its temporary number field accepts one physical Input page or one
Output position. Enter navigates without changing selection. Escape or an outside click cancels navigation. First and
last page controls navigate directly. Invalid numbers keep the field open with an error.

Page preserves the originating Grid or List presentation for V and modified-click return gestures. Grid/List tab changes
retain toolbar focus. Pointer returns briefly emphasize the inspected card or row. Keyboard returns use a separate focus
contour. Selection does not change during these transitions.

In two-pane layouts, Style groups scroll below profile selectors while both pane frames retain their height. In a
single-pane layout, Style uses document scrolling.

Input page numbers show copy counts and Output positions when copies exist. Output numbers show their source Input and
original page. Mappings distinguish Inputs and follow edits. Outside click or Escape closes details. PDF labels
supplement physical numbers. Page shows both when they differ.

### Named pages and List

The shared Description page array follows physical PDF order. Each entry can supply independent `name`, `tags`, and
preview metadata. There is no page-ID lookup. Page names can repeat; consumers derive any name/tag reverse indexes in
memory. Document title, description, authorship, and copyright remain standard PDF XMP metadata rather than page or
workspace fields.

List shows one row per physical Input page or expanded Output occurrence, in the same order as the pane's page sequence.
Each row retains its physical number or Output position and supplied page name. When an Input defines PDF page labels,
List shows them in a separate column between the physical number and page name, only when they differ from physical
numbers. Inputs without page labels reserve no label column. Labels come from the PDF and do not replace physical
selection or navigation numbers. Output rows show one position and keep original page numbers and differing PDF labels
in details. Pages without names remain available by number. Repeated names do not merge rows or occurrences. Blank and
Padding rows retain their existing product identities without invented authored names.

Authored page names and the embedded PDF outline have independent roles. Names identify pages for selection; the outline
supplies section hierarchy and fallback display titles. Prepared status does not change these rules. Page names never
create section headers. Without an outline, List remains flat even when named pages repeat.

By default, each page uses its authored name, then a matching TOC title, then `Page N` with its physical page number. A
matching child takes priority over its ancestors. Ranges are inferred from subsequent section targets, so an omitted
heading cannot close a preceding section. Same-page siblings remain separate even at different depths; their first
section supplies the display title. Headings without usable titles or targets do not hide their navigable children or
attach them to unrelated sections. Input List navigation shows all matching paths when several sections cover a page,
without changing selection. These titles never enter the Description, Recipe matching, or generated page-name metadata.
Output resolves titles through each occurrence's original Input page.

Contents offers Use TOC titles only when at least one authored page name differs from its matching section title. It is
off by default. This per-Input preference reverses the display priority to section title, authored name, then `Page N`.
The preference changes page display titles independently of the section hierarchy. It applies to that Input and its
Output occurrences without changing the PDF or Recipe. The default priority always favors authored names. TOC-derived
Input detail headings show breadcrumbs; authored names retain a flat heading. Output details use flat headings, filename
and original page number, and the document Title when several Inputs contribute pages.

The open-book Contents control navigates the Input outline in Grid, List, and Page without changing selection. Output
has no Contents control. Opening Contents reveals the current leaf, or its visible ancestor when the branch is
collapsed. Only that entry announces the current location. Ancestors retain their visual emphasis. List builds a section
tree in each pane's page order, then flattens its visible headers and pages without indentation. Every retained TOC
entry has its own header, including leaves, root entries, entries with identical titles, and entries that share a page.
Child entries are not required. A TOC title can supply both a header and the fallback name of its pages. Physical page
rows appear once, including pages shared by several TOC entries. Output headings include the document Title when several
Inputs contribute pages. A heading controls all pages in its subtree, including pages under child headers. Its ribbon
hides or reveals that subtree without changing selection, page numbers, or Output. Clicking the heading text selects or
unselects all section members. Dragging the ribbon selects the complete section and shows a page stack. Holding it
without movement does not start a drag. Input sections copy to Output; Output sections move together. A closed section
accepts a drop before or after its complete group.

Section headings place the current section title first, followed by its ancestors from nearest to farthest. Long titles
truncate within the row. A separate navigation button opens the complete path from root to current section in a Jump to
section panel without changing selection or Output. Each path entry navigates to its header in the same pane: it closes
the panel, opens the required ancestors, and scrolls to and focuses the header. Output navigation stays within the
current occurrence's ancestry. It preserves selection, the inspected page, and Output. The control is available on every
section header and on page rows with TOC ancestry. A root header's button is disabled because its only target is the
header itself. Page rows show every matching path and its physical target page numbers. Hiding headings also hides these
navigation controls.

Grid and List share section fold/unfold state for each pane. Grid keeps the physical starting-page image as a section's
visible card and hides later pages inside folded sections. The centered ribbon is vertical, with no title text on the
card and a secondary-colored footer. One page can show one ribbon; if several sections start on the same page, Grid
exposes the outermost visible heading, while List retains every separate disclosure. Grid's section ribbon folds or
unfolds only; the page image continues to support individual selection and dragging. Transfers temporarily show all
pages to preserve the physical Output order and drop targets. The Section headings toggle and Fold all/Unfold all
actions apply to both views without clearing per-section choices.

The + action adds an Input section to Output or copies an Output section. When all members are selected, an Unselect
action replaces +. View opens the section's first page without changing selection. On the first List opening, sections
start closed if the expanded list exceeds the pane height. Otherwise, sections start open. Each pane retains expansion
choices across view changes and resizing. The toolbar button folds or unfolds all sections. Contents navigation opens
every ancestor of a collapsed destination. Reopening a parent retains its children's individual fold choices. Lists
without sections retain uninterrupted page rows.

Section headings are shown by default. Each pane's Section headings toggle hides them to show a flat List with every
page row, including pages in collapsed sections. Showing headings restores the retained expansion choices. This per-pane
view choice survives view changes and does not change selections or Output.

When several Inputs contribute to Output, List occurrence numbers have small source-color dots between the number and
grip. Input's current file and chooser use the matching colors. Colors remain stable for each workspace source across
reordering and duplication; filename and original page details provide the source identity independently of color.

List mounts the visible window and a small margin, with spacers retaining the scroll range. Unmounted rows keep their
physical positions, occurrence identities, and selections in the existing workspace owners. Contextual row actions mount
when their menu opens.

List choices use the existing Selection and page-action model. They resolve to physical indexes or Output occurrence
identities. List does not own another selection state or change the numeric Selection grammar. View changes retain the
selection, inspection, Output, styles, and each pane's Pages layout. The numeric field retains its touch keyboard
behavior.

List uses one keyboard cursor per pane, shared with Grid and Page inspection. Arrow Up/Down moves one row; Home/End
moves to the first/last row. Cursor movement scrolls the complete row into view. Shift with cursor movement extends
selection. Space toggles the row and advances the cursor. Page Up/Down moves one screen of rows. Enter adds the Input
preparation or duplicates Output, following Grid. Plus offers the same action. Minus removes the Output selection or the
cursor's row. Delete removes only the Output selection. V and the View button open Page. Modified Enter/Space preserve
native shortcuts. These keys act only while the List content owns focus. The numeric Selection field retains its Enter
action and does not intercept List navigation.

The trailing View button opens the row in Page without changing selection. On a fine pointer, a 220 ms hover over this
button shows a full-page preview. Keyboard focus provides the same preview. Leaving, scrolling, Escape, or a transfer
closes it. Only one row preview opens at a time. Input uses the original PDF; Output uses its completed appearance. In
Page, V returns to the originating List or Grid. Returning to List restores focus and scrolling at the inspected row.

Clicking a row's selection area uses the shared selection model. Page numbers open anchored details beside the number.
Individual Add and Duplicate actions in Grid and List preserve selection; new occurrences remain unselected. Selected
rows replace their Add or Duplicate button with a tick that unselects that row. Their page operations use the pane's
shared page-action bar. Unselected Input rows retain Add even when other rows are selected. Unselected Output rows
retain individual movement, removal, and duplication, without applying those actions to another selection. On a fine
pointer, Input Add and Output row actions appear on hover or focus. Output uses two button pairs. Eye and selected ticks
remain visible. Touch keeps Input Add visible. Output uses an action menu for touch and narrow panes. Output movement
steps one occurrence up or down and preserves its identity. Action controls keep accessible names and keyboard focus.
Removing a focused occurrence focuses the surviving neighbor. Switching views reveals the inspected item and transfers
content focus to its equivalent only when content had focus. Tab activation keeps focus on the tab. List scrolls within
the same pane content frame as Grid. Input switching restores its inspected item and reveals that row without changing
Output. List edits use immediate document updates with addition, removal, and movement feedback. Reduced motion disables
this feedback. Animation does not delay actions or leave outgoing rows interactive.

Grid and Page show supplied names after 220 ms of pointer hover over their page number, or immediately on keyboard
focus. List shows names inline and uses selection help on the name instead of repeating it in hover tooltips. Full names
remain available through accessible labels, the View preview, and page details. Tooltip names stay horizontal on one
line and truncate only at the viewport limit. Clicking replaces the name tooltip with one detail panel, with the name as
its first row. The panel opens immediately below the number. Page has no name below the image. Missing names add no
empty caption or invented name tooltip. Names supplement physical numbers and PDF labels. They do not replace navigation
identities. [VIEW](VIEW.md#grid-and-page) owns caption placement and layout. Normal Input Grid footers retain Add when
no pages are selected. Selection and page actions retain their addition behavior.

The shared library owns page names and tags under its [page metadata contract](../../lib/doc/SPEC.md#page-metadata).
Tags remain available as data for future page selection. This version defines no tag-query control, expression grammar,
or dynamic Recipe lookup.

### Demo

| URL                  | Result                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| `?demo`              | Four-page Input, all pages selected, with Output ordered as `1,2,3,4,3,4,3,4`.                              |
| `?demo=empty`        | The same Input with no Selection and empty Output, including onboarding and the addition hint.              |
| `?demo=grid`         | 240-page Input and Output from 60 repetitions of the four sample pages.                                     |
| `?demo&paint`        | Style with the Filled profile, available only in development.                                               |
| `?demo=toc`          | The complete Advanced Bash-Scripting Guide with three-level Contents and arranged Output.                   |
| `?demo=toc-multiple` | Advanced Bash-Scripting Guide and An Occurrence at Owl Creek Bridge, with pages from both Inputs in Output. |

Both TOC demos start in List with section headings. The maintained public-domain reading PDFs have real embedded
outlines and no authored page names.

On every screen, three or more quick clicks or taps on the upper-left logo open the examples dialog. It lists Single
demo, Large demo, TOC demo, TOCs demo, Recipe demo, and Empty demo, in that order. The workspace also offers Welcome
screen. Menu entry names use two words. Links navigate inside the application scope, including in an installed app.
Before an example replaces undownloaded changes, the application asks for confirmation. A single click returns Home, and
a double-click replays the logo animation. Actions wait until the quick-click sequence ends. Reduced motion disables the
animation. Open PDF always opens local PDFs.

Unknown demo values show an Error and retain local PDF opening. Local opening takes precedence over a pending demo
result or error. Demo PDFs and Recipes are excluded from offline installation. They download from the application's own
server only when requested. A first request needs a connection; downloaded examples remain available offline in a
separate cache. The build limits each demo PDF to 2 MiB, each Recipe to 1 MiB, and the complete example catalog to 4
MiB. The cache accepts only catalog entries with matching byte lengths and SHA-256 digests. Updates retain unchanged
examples and remove changed or retired hashes. New downloads bypass the HTTP cache, so stale responses cannot populate a
new catalog entry. User PDFs and generated files never enter this cache. If optional storage is unavailable, an online
demo still opens. Core offline installation and updates do not depend on demo downloads. The
[fixture guide](../test/fixtures/README.md) owns its contents and rebuild procedure.

Production builds prepare Grid demo in the browser from the downloaded four-page sample. After that sample is cached,
Grid demo works offline without another PDF download. Development uses the equivalent native fixture for geometry
measurements.

## Selection and addition

Input preparation is an ordered physical page sequence. For example, `3-5,2,2,7` means `3,4,5,2,2,7`. Output selection
is a set of occurrences identified by current positions. Repeated Output numbers select an occurrence once. Operations
use print order. Field edits prepare targets without changing existing Output. Invalid text retains the last valid
selection and blocks selection actions.

| Control                 | Input                                                    | Output                                                     |
| ----------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Select all              | Every physical page once, in original order.             | Every occurrence once.                                     |
| Clear                   | Clears Selection, repetitions to 1, front alignment off. | Clears selection, repetitions to 2, front alignment off.   |
| Field Enter             | Adds the exact preparation.                              | Removes selected occurrences.                              |
| Individual +            | Adds one current page without a Selection.               | Duplicates one current occurrence without a selection.     |
| Double-click Grid image | Adds the preparation, or one current page.               | Keeps the first click's selection.                         |
| Space in Page           | Adds one current page and preserves Selection.           | Duplicates the current occurrence and preserves Selection. |

Select all disappears for a complete selection. Reordered or repeated Input sequences still offer it. Clear appears for
entered text, selected pages, or nondefault Input configuration. It preserves Output. Empty Output has a disabled field
and no action controls. Its menu otherwise supports Blank insertion without a selection. Nondefault repetition and front
alignment remain visible in the field hint. The Output field hint directs selected pages to the selection bar.

Clicking a Grid image or grip toggles selection and gives normal page focus. Shift-click adds missing pages or removes
the anchored range. Where available, the Input Page grip uses the same selection. Field values and page borders
represent the same targets.

On touch screens, Selection requests the numeric keyboard. Grid content does not support text selection or touch
callouts. Double-tapping a Grid image opens that page in Page without changing Selection or Output.

Input additions follow the last selected Output occurrence, or append without an Output selection. The Input hint
identifies this destination. Adding a preparation clears it and selects the new Output block after success. Individual
Grid/List + additions preserve the current selection and keep new occurrences unselected. Space in Page preserves the
Input preparation and selected Output occurrences. Failure or cancellation preserves preparation.

Any selection hides that pane's individual card and Page action controls. The shared bar edits one or several selected
pages. Clearing selection restores individual controls. Grid editing shortcuts require selection. Navigation and zoom
remain available.

Sequences and expanded Output support at most 10,000 pages, including Padding. Repetitions accept integers from 1 to
1,000. Invalid or empty sequences cannot be added. One-page PDFs support repeated entries such as `1,1`.

## Output structure

Every Output occurrence is independently editable. Selection follows occurrence identity through edits. Other
occurrences, Input pages, and styles remain intact. Page edits preserve expanded order, materialize existing Padding as
fixed removable Blanks, and discard internal Part boundaries.

| Action               | Result                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Duplicate selection  | One copy of each target in print order, inserted after the last target. New copies form one selected block. |
| Remove               | Removes the target occurrences.                                                                             |
| Move earlier/later   | Shifts every selected occurrence one position, preserving order and gaps.                                   |
| Drag selected Output | Moves the selection as one block in print order.                                                            |
| Insert Blank         | Adds one fixed-size Blank before the first selected page or at the end, and selects it.                     |
| Repeat sequence      | Repeats consecutive occurrences, including Inputs and Blanks, in order.                                     |

Output offers movement actions in its selection bar, or in the page actions menu when space is limited. Both directions
retain their positions while a selection exists. Each action is disabled at its boundary. A selection touching both
boundaries has both actions disabled. Nonconsecutive selections retain duplication and movement but show an explanation
instead of repetition controls. Repetition includes the current sequence: two copies of A B produce A B A B. One copy
without alignment offers no action. Success selects the final copy's content pages and resets repetitions to 2 and front
alignment off. Failure preserves the configuration. Selections do not establish persistent copy groups.

### Duplex alignment and Blanks

Output parity determines Front and Back: position 1 is Front, position 2 is Back. Input parity follows original physical
page numbers. PDF-page counts and duplex-sheet counts remain distinct. Four single-page copies produce four PDF pages
and two sheets.

**Start each repeat on front** is off by default. It gives odd-length copies a trailing Blank, including the final copy.
If preceding pages end on a Front face, a leading Blank completes that sheet.

| Output structure                 | Expanded pages                  | PDF pages |
| -------------------------------- | ------------------------------- | --------- |
| A B C, two copies, alignment off | A B C A B C                     | 6         |
| A B C, two copies, alignment on  | A B C Blank A B C Blank         | 8         |
| X, then the aligned sequence     | X Blank A B C Blank A B C Blank | 10        |

Padding uses the preceding page's dimensions and contributes to pages and totals. Unedited Parts recalculate it. Page
edits preserve it as explicit Blanks. An explicit Blank takes the preceding page's dimensions, or the following page at
the beginning. Insertion requires an adjacent page. Its dimensions remain fixed.

Composition preserves page boxes, rotation, and mixed physical sizes. Alignment does not configure a printer or binding
edge. Booklet imposition, multiple pages per sheet, crop, scaling, and rotation edits are outside this version.

### Drag and drop

Dragging selected Input pages or its Page grip adds the complete preparation, including repetition and alignment.
Dragging the field's + does the same. Dragging an unselected Input page adds one copy and preserves preparation.
Dragging an unselected Output page moves only that occurrence. Starting a drag preserves selection. A press without a
drag completes its click action on release.

An Output card's left/right halves insert before/after it. The Output background appends. Dropping on a selected Output
occurrence leaves order unchanged. A prospective slot never changes document order before drop. Output Page navigation
advances the inspected drop target after a hover dwell. Cancellation or rejection restores prior inspection and leaves
Output unchanged. A completed move follows the moved occurrence. Drop, cancellation, and leaving Output clear temporary
feedback. Native drag support depends on the browser and input device. Buttons support keyboard and touch alternatives.

List supports the same preparations and occurrence identities. Its row name supports native dragging, and its grip
supports native and touch dragging. The top/bottom row halves insert before/after the row. A line marks the target; the
list scrolls near its top and bottom edges. Cancellation preserves selection, order, and inspection. A List drag uses a
strip with its page number and name, plus a count for multiple pages. Its target placeholder uses the same columns and
text size as the rows. Cross-view drops retain each destination view's insertion rules.

Grid and List show prospective Output numbers during a transfer. The moving image, target placeholder, and affected
pages use the numbers they receive after drop. During Output moves, the source row or card leaves the visual sequence;
only the moving image and insertion preview remain. Multiple Output pages retain print order. Input preparations include
repetition and front-alignment padding in these numbers. The page images do not render again for number changes. Grid
folds follow the prospective page's front/back side. Leaving Output or cancelling restores current numbers.

Touch dragging starts from a grip when the finger moves. It uses the same selections and insertion rules as mouse
dragging. In Grid, only the card area accepts and highlights drops. On narrow layouts, Input rejects drops and
highlights the Output workspace tab as the target. Dropping there adds the pages at the prepared destination and then
reveals Output. Hover alone does not switch panes. Input shows a delayed rejection hint when movement toward Output
stops. Cancellation preserves the document, selection, and inspected Output page. Scrolling from an image remains
native.

Switching Inputs cancels pending double-click, double-tap, and transfer actions from the previous Input. Output gestures
stay independent. Keyboard page actions stay inactive during a drag.

A native drag keeps its session when platform dragging temporarily takes window focus while the page remains visible.
Drop, drag end, page hiding, resize, or workspace closure clears the session. Window blur still cancels a pending touch
press or active touch transfer.

| Transfer state          | Event                                                   | Result                                             |
| ----------------------- | ------------------------------------------------------- | -------------------------------------------------- |
| Grip pressed            | Movement reaches the drag threshold                     | Start one transfer without changing selection.     |
| Active                  | Accepted drop                                           | Apply the edit and remove temporary feedback.      |
| Pressed or active       | Page hiding, resize, cancellation, or workspace closure | Cancel the transfer and remove temporary feedback. |
| Touch pressed or active | Window blur                                             | Cancel the transfer and remove temporary feedback. |
| Touch pressed or active | A second pointer                                        | Cancel the transfer and preserve Output.           |

## Keyboard and focus

### Routing and priority

Fields, native controls, menus, dialogs, popovers, and composing input retain their keys. Tab and Shift+Tab retain
native focus navigation. The first Tab stop is the header logo. Browser zoom and search shortcuts remain available.
Unassigned or modifier-only keys do not start Grid navigation, except Shift after a clicked selection. Modified Enter
and Space do not activate Grid images or grips. Held view-switch, addition, and removal keys act once per press.

V, Ctrl/Command+A, and Escape target the mouse's screen half. Before mouse use, they target the focused pane. A hidden
or absent pane falls back to the visible pane. Page shortcuts use the same routing, but require a visible, nonempty
Page. If the target pane has none, the other visible Page receives them. Conflicting focused Grid or control keys keep
their targets. Without a suitable Page, Page shortcuts do not change focus or scroll. V also returns from an empty Page
to its originating view.

| Workspace key                 | Action                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| V or Ctrl/Command-click image | Switches Grid or List with Page, preserving selection, inspection, and zoom.                                           |
| Ctrl/Command+A                | Selects every page in the target pane once, preserving the other selection, preparation configuration, and inspection. |
| Escape                        | First dismisses an interaction or cancels a drag. Otherwise clears only the target pane's selection and configuration. |
| Delete                        | Removes the Output selection from either pane.                                                                         |
| Ctrl/Command+left/right       | Moves Output earlier/later in Grid or Page. In List, Ctrl/Command+up/down moves rows.                                  |
| ?                             | Opens Help outside fields and other open dialogs or popovers.                                                          |

Without an Output selection, Delete has no action. A move uses the focused Output card or row when selection is empty.
Input Selection stays unchanged. Escape otherwise preserves Output, inspection, zoom, and page scroll, then focuses the
target view tab and ends Grid navigation. With no target selection, configuration, or Grid cursor, it has no action.
Held Escape cannot clear selection after dismissing another interaction. A shorter selection bar cannot move window
scroll outside document bounds.

### Grid

| Key                           | Action                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Left/right                    | Moves the cursor in page order without changing selection.                                                 |
| Up/down                       | Moves through rendered columns without changing selection.                                                 |
| N/P                           | Moves in page order. Letter shortcuts accept either case.                                                  |
| Home/End                      | Focuses the first/last physical page without changing selection.                                           |
| PageUp/PageDown               | Moves the Grid cursor by one viewport of rows and reveals the target page.                                 |
| Space                         | Toggles the cursor's page, then advances right. At a boundary it preserves selection and workspace scroll. |
| Shift+right                   | Toggles the cursor's page, then advances right.                                                            |
| Shift+left                    | Retreats, then toggles that page.                                                                          |
| Shift after clicked selection | Places the cursor after it without changing selection.                                                     |
| Enter                         | Adds prepared Input pages or duplicates selected Output occurrences.                                       |
| + / − in Output               | Duplicates/removes the selection. Input Grid gives these keys no page action.                              |

Without active Grid navigation, right starts at the first mounted page and left starts at the last mounted page.
PageUp/PageDown target the mouse-side Grid, with the visible pane as fallback. They stop at the sequence boundaries.

Plain arrows can visit selected pages. Shift steps can select or unselect. Reversing a step restores membership,
including across gaps and after plain navigation. Unselecting an Input page removes all its prepared occurrences. Other
pages retain order and repetitions. Selecting adds one occurrence.

Navigation does not wrap. Stepping outside Grid hides the cursor and focuses Grid. An inward arrow returns to the
first/last page without changing selection. Shift+right from the start toggles the first page. Shift+left from the end
toggles the last. Outward Shift+arrows have no action. Editing shortcuts remain available at boundaries. Pointer
movement and presses hide the cursor without clearing selection.

Addition feedback preserves page indexes for navigation and Selection. Grid keeps focus while its cursor visits a hidden
new Output page.

### Page

| Key                    | Action                                                                                    |
| ---------------------- | ----------------------------------------------------------------------------------------- |
| Left/right             | Goes back/forward one page when the image fits horizontally; otherwise scrolls the image. |
| Up/down                | Scrolls the image vertically.                                                             |
| N/P or PageDown/PageUp | Goes forward/back one page at every zoom level.                                           |
| Home/End               | Goes to the first/last page.                                                              |
| Space                  | Adds or duplicates one current page and preserves Selection.                              |
| + or = / −             | Changes zoom through the heading controls' steps.                                         |
| 0 or Z                 | Resets zoom to the complete page at 100%.                                                 |
| G or click counter     | Opens page entry with its current value selected.                                         |

Page navigation stops at document boundaries without changing focus or selection. Letter shortcuts accept either case.
Horizontal scrolling at an image edge does not change pages while the image remains wider than its viewport. Page entry
accepts integers from 1 to the page count. Invalid values remain editable with local feedback. Enter accepts, Escape
cancels, and both return focus to that Page viewport. Outside click closes entry without changing selection.

### Focus after actions

Mouse activation of inline Page tools focuses the PDF viewport. Keyboard activation retains focus on the tool.

Image and grip activation gives normal page focus. Keyboard view switching focuses the inspected page. Pointer switching
does not. Input addition keeps focus in Input. Menu actions close their menu and return focus to its trigger. Removing
the final Output page focuses its active view tab. Removing an Input returns focus to the filename chooser, or to Open
PDF when the final Input is removed.

For mouse and keyboard input, a disappearing field action returns focus to its field. Available selection-bar actions
keep focus. Group removal and Clear return focus to the field while pages remain. Grid keyboard duplication focuses the
final new Output copy after arrival. Grid retains keyboard navigation while the copy is hidden. Movement retains focus
on the same occurrence. Removal chooses a surviving neighbor. Starting a mouse drag does not move focus.

On touch screens, only direct activation of the Selection field focuses it. Other Selection actions return focus to Grid
or Page. Touch dragging dismisses the keyboard and does not focus Selection on completion.

If a focused header feedback action disappears, focus returns to Help without scrolling. Download retains native modal
focus and returns focus to its trigger on close.

## Input styles

An Input owns parameter definitions and overrides. New Inputs retain saved overrides. Omitted assignments use authored
baselines. Mixed or unrepresentable baselines stay unassigned. Schema defaults do not create values or averages. A valid
change affects every eligible record in its declared binding. Selections, Part boundaries, and inspection do not narrow
that scope. Independent styling of the same physical page requires an independent Input.

### Scope and controls

Style controls appear only for parameters affecting Output pages from the active Input. Hidden controls retain overrides
and drafts. A prepared Input without applicable Output has a disabled Style tab and an explanation. An ordinary PDF has
no Style tab. Hidden or transparent prepared targets remain editable while their contract and geometry exist.

Groups and parameters follow authored array order. A group's count represents distinct Style objects by exact binding
target sets. Information panels expose baselines, page scope, Output coverage, constraints, and opaque parameter IDs.
Pointer hover opens them after 220 ms. Leaving, scrolling, or Escape cancels a pending opening. Click or keyboard
activation pins them immediately, and outside click or Escape dismisses them. With focus inside parameter information,
Escape returns focus to its information button and keeps the enclosing editor open.

Related parameters combine only within their authored group and only with the same exact target set. Binding properties
identify their roles. A complete set of several related parameters forms a Quartet at its first parameter's position. A
lone parameter retains its individual control. A Quartet has Fill, Stroke, Width, and Visibility. Its title and
description come from the display parameter when present, otherwise from its first authored parameter. Fill and Stroke
each combine color and opacity in a Paint duo. Width belongs to Stroke. An available Visibility control affects the
target set. Without a display parameter, Visibility is unavailable and original display states remain unchanged. The
arrangement adds no processor schema or manifest field. Quartet guidance uses the same representative parameter's
annotations; there is no separate Quartet annotation record.

Each setting opens its editor. Desktop layouts with a fine pointer use a floating panel; narrow or touch layouts expand
the editor inline. A Paint duo opens color and opacity together, retaining independent values and resets. Close, outside
click, or Escape closes a floating editor. Escape returns focus to its trigger. Editors retain descriptions,
information, constraints, and draft errors. Unavailable parameters create no assignment and imply nothing about the
original paint. Mixed and unrepresentable values remain editable. Unassigned Visibility stays indeterminate, never
implicitly Hide. Individual display controls use Show/Hide radio choices.

Color supports a native picker, hex entry, and eight-level RGB steps. Width uses numeric entry and a 1.05 step factor.
Opacity uses percentages for numeric entry, choices, and slider feedback. Unfocused numeric fields show at most one
decimal place. Numeric entry accepts fractional percentages. Hover help exposes the full percentage. Display rounding
and focus changes preserve stored values. Out-of-range steps and enum choices are disabled. Invalid values are not
rounded or silently corrected. Opening a picker assigns nothing.

Authored descriptions remain visible when supplied. Parameter details extend the description in the existing parameter
information panel. Group, Quartet, profile-set, and profile details use a shared on-demand panel. Their information
buttons appear only for nonempty details after trimming whitespace. Empty or missing details add no authored-guidance
button. Existing parameter information still exposes baselines, scope, and constraints without authored guidance. Panels
retain plain text and paragraph breaks. Close, Escape, or an outside click dismisses them. Escape returns focus to the
information button. Opening group guidance does not toggle the group or change styles.

### Profiles and reset

A profile set appears only with several profiles and at least one parameter in the current visibility scope. Its name
labels the select. The selected profile's description stays visible. Missing descriptions use a short description based
on the profile name. The affected Input pages appear in hover help.

Profile-set descriptions appear in selector hover help, accessible descriptions, and the options menu. Set details
remain available beside the selector, including when the options button is disabled. Only the selected profile's
description appears below its selector. A selected profile's details button sits beside its own description. Changing
the profile or Input closes its panel. Custom styles and profiles without details show no profile guidance button.
Reading guidance does not change styles.

Choosing a profile replaces the Input's overrides throughout that set and clears its invalid drafts. Omitted parameters
return to authored baselines. Other sets on that Input retain their choices. By default, the choice also applies to each
profile set on other open Inputs that declares the same nonempty family and profile name. Families and names match
exactly, regardless of set names or local IDs. Each Input uses its own declared profile values. Sets without this
explicit match retain their choices. Missing family metadata never permits name-only propagation.

The first profile selector's options menu offers **Apply only to this file**, off by default. When on, subsequent
profile choices affect only the active Input. The option remains in effect across Input switches for the current
workspace. Changing the option does not change existing styles. The option also limits parameter edits and resets.

With that option off, a valid parameter edit propagates only to parameters on other open Inputs with equal explicit
family and key, the same paint property, and the same pre-edit effective scalar value. Each destination must accept the
new value under its own schema. Comparison uses numeric values and color components, never rounded UI text. An explicit
override supplies the scalar; otherwise a uniform representable baseline supplies it. Mixed or unrepresentable effective
values, invalid drafts, different values, and incompatible destinations remain intact. Invalid active drafts never
propagate. A completed valid edit compares the last valid value retained beneath its draft. Matching metadata does not
merge independent parameters within the active Input. Feedback reports skipped counterpart parameters when they prevent
a complete cross-file edit.

Custom is a derived UI state, not a stored profile. Family/key matching continues after overrides stop matching a
profile. Parameter reset uses the same metadata and pre-edit value conditions and removes each destination's own
override. It never copies the active Input's baseline. Reset all applies that rule independently to the active Input's
changed parameters; unrelated destination parameters retain their choices. Invalid active drafts clear locally without
propagation.

The options button is disabled with only one open Input or no compatible operation on another Input. A compatible
profile operation exists when any choice in the visible selectors has a family/name match on another Input. A compatible
parameter operation exists when a visible parameter or a changed parameter eligible for reset has a family/key/property
match with an equal, comparable current value and no invalid draft. Eligibility considers the available choices before
activation, so users can select per-file scope before choosing a shared profile. Custom alone never disables the button.
The button's disabled state does not reset the workspace preference. Opening and dismissing its menu changes no styles.

Matching override maps select the declared profile. Other maps and invalid drafts show Custom. Profile choices remain
individually editable. Names, descriptions, details, and values come from the producer and imply no application-defined
printer behavior.

Each Input retains its explicit profile choices for Recipe export. The visible selector still derives its current choice
from the override map. A later manual edit can show Custom without removing the earlier explicit profile choice. The
Input also retains the IDs of parameters edited after that choice, including edits equal to a profile value. Choosing
another profile clears those edit IDs within its set. Field reset retains an explicit baseline reset. Reset all clears
the active Input's profile intent and manual edit IDs together with its overrides and drafts.

Field reset removes one override. **Reset all styles** clears the active Input's complete map, including hidden and
saved overrides, and invalid drafts. Other Inputs follow only the eligible propagation above. Resets retain selections,
Output, and immutable bytes. Reset appears only with overrides or invalid drafts. Keyboard activation returns focus to
the Style tab before the control disappears.

### Processing

Valid choices are retained immediately. Processing runs only for parameters affecting existing Output pages. Unused
choices do not show processing or block Download. Adding an affected page prepares deferred choices. Reordering or
copying currently styled pages does not repeat processing. Removing the last affected page cancels unnecessary work
while retaining choices. Cancel and Retry retain choices and the last completed preview.

Cross-file profile changes process Input previews one file at a time to bound WASM memory. A profile choice schedules
the active Input first. Queued requests that are replaced or cancelled do not start processing. Individual Input edits
keep independent processing and cancellation.

The header reports active Style processing with the Input filename and Cancel. It favors the active Input, then the
first pending Input. Cancel stops only that Input's work. A failed Input keeps its explanation and Retry in the header,
including when another Input or view is active.

Each Style request sends complete Input overrides in one processor operation. Full-document previews use a single-Input
composition, so their completed bytes also support Download. Extracted previews combine resets and selected overrides.
The processor writes and validates the final PDF once.

Partial Input processing can use extracted pages, but controls, labels, preview, and Compare retain original physical
identities. New Download processing uses complete immutable Inputs and complete Input overrides. Input errors offer
Retry even with another Input or tab active. Invalid drafts never enter a Plan. Obsolete processing results cannot
replace newer choices.

## Page preview and comparison

Page preserves physical proportions for PDF content, Blank, and Padding. Fit is 100%. The zoom steps are 50%, 100%,
150%, 200%, 300%, 400%, 800%, 1600%, and 3200%. Pinching a Page image changes zoom continuously within 50–3200%, around
the midpoint of the two fingers, within the image's scroll bounds. An image that fits an axis stays centered on that
axis. Zoom buttons and keyboard controls choose the next step from that value. Pinching preserves Selection and Output.
Application zoom is independent of browser zoom. View changes, Input switches, selection changes, and resizing retain
each pane's zoom and latest visible region.

The Page zoom reset button restores the complete page at 100% from any other zoom. At 100%, the same button fits the
image to the available width, with equal image gutters and a maximum of 3200%. It rounds down to a whole percentage to
prevent horizontal overflow. The button's name describes its current action: Reset zoom or Fit width. Keyboard 0 and Z
always reset to 100%. Double activation of the image retains its separate 100%/200% behavior.

Double-clicking or double-tapping a Page image zooms to 200% when its current zoom is 100% or below. The activation
point stays in place within the image's scroll bounds. Above 100%, double activation returns to Fit. These actions
preserve Selection, the inspected page, and Output.

On every screen and input type, the first Page entry enlarges a fitted image narrower than 70% of its viewport. It uses
the available width with equal image gutters, up to 3200%. The percentage rounds down to prevent horizontal overflow.
This initial choice runs once per Input and once for Output, after PDF opening completes. It uses the rendered image
viewport and the page's physical ratio. An explicit zoom choice takes precedence, including Fit. Touch entry brings the
Page frame into view. Keyboard entry keeps the focused control visible. Reset zoom restores 100% and shows the complete
page. [VIEW](VIEW.md#grid-and-page) defines fitting and spacing.

Page controls stay on one row. Actions that do not fit remain available in the existing pane page-actions menu. A touch
Page has no grip in either pane layout; use the page-selection bar to select pages. Grid grips remain available.

At enlarged zoom, mouse dragging pans the image. Where available, Input transfer uses the Page grip. Output reordering
uses Grid, selection actions, or keyboard controls. At 100% or below, the wheel scrolls the workspace. Above 100%, it
scrolls the image and does not pass scrolling to the workspace at an edge. Keyboard and touch scrolling remain native.
In touch Page, a vertical swipe at an image edge can continue into the workspace.

With touch input, a horizontal swipe changes pages only when the image fits horizontally at the start of the gesture.
Swipe left for the next page and right for the previous page. A wider image pans instead, including at its scroll edges.
The gesture keeps its initial purpose until release. Short or vertical movements do not change pages. A second finger,
touch cancellation, window blur, resize, or visibility change cancels page navigation. Pinch zoom and lens holds retain
their existing actions. Navigation stops at document boundaries and preserves Selection and Output.

**Compare page** toggles the inspected occurrence between completed Input styles and immutable opened appearance. It
requires a completed relevant style difference. Page arrangement alone does not enable it. Pending or invalid relevant
drafts disable it. Reset can enable Compare by removing saved overrides. Input switching retains Output position and
Compare.

**Show original page** opens the occurrence's Input in Input Page at its original physical page, including extracted
previews. It matches Output zoom and visible region once. Later navigation, zoom, and panning remain independent.
Selections, styles, Output position, and Compare stay unchanged. On mobile it activates Input. Blank and Padding disable
the action.

The lens uses opened Input appearance and completed Output styles, or opened appearance during Compare. It opens after
the mouse settles for 180 ms, follows movement immediately once open, and closes on leaving the image. All lenses share
Settings' 2×–128× magnification, initially 16×. The pane's thumbnail defines reference magnification. Page and zoom
compensate for their size difference to retain the same crop scale. The lens does not change layout or intercept mouse
input. On touch screens, holding an image opens the lens. Moving the held finger changes the crop. Release,
cancellation, a second finger, or scrolling dismisses it. A hold does not select, add, duplicate, or move pages.

A thumbnail raster refresh retains a pending mouse hover while the pointer remains over the image. The opening delay
restarts when the raster is ready. Escape, leaving the image, and the other dismissal actions clear that intent.

For a named physical page, the lens shows its name below the crop in Input and Output, including Compare. Pages without
a name have no lens caption. Its accessible page number uses the original physical page, including extracted previews.

Resizing dismisses the lens. [VIEW](VIEW.md#grid-and-page) owns its shape and viewport margins.

An open lens updates its preview immediately and refines the latest position without a settling delay. Only one detail
render runs at a time. Completed detail stays aligned with the pointer where its crop overlaps the current view. Closing
the lens cancels that render and releases its acquired page and crop buffers.

Settings shows the current lens magnification beside − and + buttons. Each step halves or doubles the magnification. The
buttons disable at 2× and 128× respectively.

## Recipe loading

Recipe on the landing page accepts a JSON file of at most 16 MiB. Dropping JSON on the landing starts the same flow.
Matching replaces the landing content on the same page. Back or Cancel returns to the PDF/Recipe choices and releases
selected documents. The shared worker validates its encoding, structure, and Input definitions before matching. Each row
pairs the saved Input title and cover with a PDF selected on this device. Missing display metadata does not prevent
loading. A blank saved title falls back to its logical Input ID. Available saved XMP fields appear behind an information
button. Saved XMP `dc:description`, when present, appears directly below the title as longer descriptive text on wide
layouts. In narrow layouts, tapping the title opens this description in the shared information popover without moving
the Input rows. The title and description are separate metadata fields. The application does not derive them by
splitting title punctuation.

Users can choose or drop one PDF per row or choose several PDFs together through Choose PDFs. Batch selection reserves
filename matches to logical Input IDs before filling unmatched rows. File names and covers help users choose; the shared
resolver remains authoritative. Each PDF is validated and prepared before workspace installation. Selected bytes share
the 128 MiB aggregate limit. The shared library assesses each selected Input before execution. Each row shows a short
result. Clicking it opens diagnostic details without resizing the row. A failed read retains the previous selected PDF
and blocks execution until a valid replacement is selected.

Apply recipe becomes available after all required PDFs pass assessment and every review result receives explicit
acceptance. The selected and remaining Input counts use the application status line. Blank-only Recipes require no PDFs.
Resolution and complete page expansion precede installation of one editable workspace. Loading preserves Parts, styles,
explicit profile choices, manual edits, baseline resets, and optional Output title and cover. The selected PDF's actual
saved appearance remains distinct from the requested Output styles. Cancellation and failures release unadopted
documents and workers. No incomplete workspace is installed.

Input results follow the library's [assessment contract](../../lib/doc/SPEC.md#input-references-and-assessment). An
error shows a blocking result; its details explain the failure and provide no override. Ready and update results use
primary emphasis, review uses secondary emphasis, and errors use the danger color. Details omit repeated headings and
filenames. One issue uses a paragraph; several issues use a list. A review result opens its reasons, expected/current
facts when useful, and an explicit **Use anyway** approval button in a Review step. The header offers Review until each
affected PDF receives a decision. It does not expire. Review opens the corresponding PDF's review panel beside its row,
which identifies the approval target. Apply remains blocked until each affected Input is explicitly accepted. Approval
enables Apply when all Inputs are ready. This acceptance applies only to the current PDF bytes and Recipe. Replacing
either clears it. The status line distinguishes selected, review, and blocked Inputs instead of declaring every selected
PDF ready.

The library checks styles, physical page references, and producer vetoes. The UI never derives another compatibility
result from checksums, names, counts, or `compat`. The final shared resolution repeats complete checks before installing
the workspace. No partial workspace is installed after rejection or cancellation.

After changed Inputs load successfully, the header shows **References updated**. Clicking it opens an editable filename
beside Save in the same message panel, with Dismiss and Overwrite below. The default is
`<original-stem>_YYYY-MMDD-HHmm-sscc.json`, using the same local timestamp and suffix replacement as Output filenames.
An empty stem uses `recipe`. Save confirms a new copy. Closing the panel retains the offer and filename draft without
downloading. The editor rejects empty names, path separators, and control characters, and adds `.json` when needed.
Dismiss closes the optional offer. A successful copy shows **Updated recipe exported** in the header.

Overwrite opens the browser's file picker with the original Recipe filename as its suggestion. The user selects and
approves the file to replace. This action is disabled when the browser has no local-file write picker. Picker
cancellation and failed or cancelled writes retain the offer and leave the existing file unchanged. Once the final
replacement begins, Cancel is disabled. Successful replacement shows **Recipe overwritten** in the header.

Both actions save the library's aligned record with current available display annotations. They preserve original
logical IDs and processing intent, including dynamic all-pages selectors. They do not reconstruct alignment by exporting
expanded workspace Parts. Accepting review permits one load; saving the aligned Recipe separately accepts a new
reference baseline. Failure or cancellation never saves alignment, and the browser never silently replaces the selected
source JSON file.

Development-only Recipe assessment demos use `?demo=recipe-<case>`. Cases are `ready`, `update`, `review`, `count`,
`unnamed`, `compat`, `format`, `style`, and `page`. They select the relevant fixture PDFs automatically for UI
inspection. The [shared fixture guide](../../lib/test/fixtures/README.md) defines each case and its generation command.
These entries are absent from production and the offline cache and never appear in the logo's examples menu. CLI, WASM,
and browser e2e tests consume the same generated cases.

The Recipe demo places Sample PDFs before Choose PDFs. The JSON download icon sits beside the Recipe filename. After a
PDF is selected, its download icon saves those selected bytes under their opened filename. Empty bindings offer only
selection and dropping. Download actions retain accessible names and hover descriptions. These bundled examples use the
same inspection, binding, and resolution path as local files.

## Recipe export

**Export recipe** in the Output header saves a portable JSON Recipe for the shared
[Recipe contract](../../lib/doc/SPEC.md#65-portable-recipes). The CLI executes this file with `mainz apply`; the landing
page opens it through Input matching. Export requires a nonempty, valid Output and uses the existing contributing-Input
and draft checks. Relevant pending Style work disables the action.

The export panel shows Name, Index, Path, and Title. Index shows a one-based row number. The compact Path column is
muted, read-only text derived from Name with `.pdf` appended; hover exposes the complete path. Name supplies the logical
Input ID and uses accent-colored editable cells. Title is read-only Input metadata. Activating a Name cell opens a text
field. Enter or focus loss accepts the edit; Escape restores its prior value. Acceptance removes outer whitespace and a
final `.pdf` suffix. The initial Name is the opened filename without that suffix. Names must be nonempty and unique.
Invalid names retain local explanations and disable Export. Editing a Name updates the Recipe's Input map and instance
references without changing the workspace or actual files. Duplicate filenames require distinct names. The row index is
presentation only. Blank-only Output requires no Input names.

The Recipe contains no file-location fields. At execution, the host binds logical Input IDs to files or selected bytes.
The CLI accepts an explicit ID-to-file map. Automatic lookup uses the ID as a relative path, adds `.pdf` when absent,
and resolves from cwd or `--root`. The processor's `sources` entries retain independent style instances. Their page
references use instance IDs, separate from logical Input bindings.

Each accepted Input supplies the library-computed factual reference: SHA-256, physical page count, available ordered
page-name digest, and optional publication identity/compatibility veto. Export adds the Input title, available
descriptive XMP fields, and a PNG render of its declared cover page. The image has a maximum edge of 512 pixels and an
encoded limit of 256 KiB. The Recipe embeds it so matching works on another device without a local cache. Export does
not reopen the original file or prepare another PDF. An unavailable cover render omits that optional display field and
does not block export. The record contains no PDF bytes, browser resources, invalid drafts, or incidental UI state.

Explicitly chosen profiles remain profile choices in the record. Later manual edits and baseline resets apply after
those choices. Unique semantic family/name or family/key matches use semantic selectors. Ambiguous scopes use exact
local IDs. Export never infers a profile from matching values. Inputs without explicit profile intent export their
complete accepted override maps.

The record preserves explicit physical pages, order, copies, front alignment, and Blanks. It never infers dynamic
all-pages intent from a complete page list. The recorded count is comparison data rather than a hard exact-count
expectation. The shared library controls replay diagnostics and applicability against updated PDFs.

The JSON filename uses the current Output filename stem with `.json`. Its default follows the existing dynamic Output
name. The 16 MiB Recipe limit applies before download. The record also saves the Output title and cover-page choice.
Saving or cancelling retains Output, style choices, Selection, previews, and PDF Download/Share acknowledgment. Saving a
Recipe does not clear the PDF unsaved warning.

## Download, Print, View, and recovery

Download, Print, and View are disabled for empty or invalid Output and for invalid drafts affecting its content. Unused
invalid parameters do not block them. Relevant Input processing disables these actions while the header reports
progress. Full-document Style processing retains one completed composed PDF per Input. Other combined Outputs need their
own PDF preparation.

Output also checks the referenced Inputs and Input instances against the Download limits: 32 of each and 128 MiB of
aggregate Input bytes. Each Input identity counts once. Unused open Inputs do not count. An actionable error appears
beside Download as soon as Output exceeds a limit. Removing the excess restores Download. Processor validation remains
authoritative.

Download captures the valid Plan. If Output contains every page from one completed Input in physical order, Download
reuses its validated and inspected composed PDF. Current styles, page quantities, title, and cover page must match. This
path needs no new processing or inspection. Copies, Blanks, other page orders, and multiple Inputs require a new
composition.

New preparation supplies each referenced Input once. A compact modal at the header reports preparation and inspection
while locking workspace actions. It uses the same feedback presentation as other header operations. Cancel and Escape
terminate processing and retain the workspace. Retry uses current choices. Obsolete results cannot download. The
application compares completed page counts and inspects the PDF before the browser download.

On iOS and Android with native file sharing, Share replaces the primary Download action. Desktop browsers and browsers
without these APIs retain Download. Share uses the same preparation, inspection, limits, and Output filename. The system
panel offers file destinations and other sharing actions.

When the browser requires a fresh gesture after preparation, a neutral PDF ready to share message offers Share and
Download. Both actions reuse the inspected File without new processing. Cancellation retains the workspace and its
unsaved warning. A successful share handoff acknowledges the captured choices. It does not prove a file write to disk.

Preparation workers release before the system panel opens. Only the ready File and its acknowledgment remain until
handoff, cancellation, or disposal.

The default filename is `<input-name>_YYYY-MMDD-HHmm-sscc.pdf`, using the first contributing Input's original filename
without its `.pdf` extension. Automatic naming removes all consecutive trailing `_YYYY-MMDD-HHmm-sscc` suffixes before
it adds the new timestamp. Other parts of the name remain unchanged. An empty stem uses `blank-pages`. The timestamp
uses local time when the PDF is ready. `ss` means seconds and `cc` hundredths. Unused Inputs do not affect the name.
Blank-only Output uses `blank-pages`. In wide layouts, the Output heading opens the filename editor. A custom name
applies to Download, Share, and Print and remains in the workspace until Home. The editor rejects empty names, path
separators, and control characters, and adds `.pdf` when needed. Use default restores automatic naming. The header does
not display the filename beside its controls.

The same editor contains the Output title and cover-page choice, with a preview of that page. The title defaults to the
first contributing Input's title, or its filename stem when no authored title exists. Empty stems retain the opened
filename. Blank-only Output uses `Blank pages`. The cover defaults to the first Output page. A selected cover follows
its occurrence through reordering; removing it restores the first-page default. Use default resets all three file
fields. Download remains a direct action. The editor rejects titles that cannot be written as XML text or exceed 4096
UTF-8 bytes. Composition writes the title to XMP `dc:title` and PDF Info `Title`, and the cover to XMP
`mainz:coverPage`, using the library's namespace. Opening this PDF later uses those fields as Input metadata.

Print captures the same Plan and uses the same preparation, validation, inspection, and cancellation as Download. It
hands the completed PDF bytes to the browser's PDF viewer, preserving the Output pages and styles. Browsers with native
PDF viewing receive a print request with the Output filename as the viewer document title, without an application viewer
panel. iPhone Home Screen apps offer the system file-sharing menu, where users choose Print. Cancellation retains the
prepared PDF; unavailable sharing retains Open PDF and Download recovery. Other Apple browsers use a separate PDF window
because embedded iOS PDF printing can omit pages. Print reserves that window during the user action, before asynchronous
preparation. Cancellation or preparation failure closes the reserved window. Browsers without native PDF viewing use a
panel with Open PDF to print and Download PDF. A rejected or inaccessible print API also opens that panel. The browser
can silently ignore a print request; Download remains available. Paper, scaling, printer selection, and the choice of
system dialog belong to the browser or PDF application, which also controls the print-job name. A print request does not
prove that printing completed and does not clear the unsaved warning. Downloading the prepared PDF clears the downloaded
choices' warning. Unused Input changes and invalid drafts retain their warning.

View captures and inspects the same Output PDF. Preparation and Cancel appear in the app header. View opens the
completed PDF without a second application confirmation. iPad Chrome follows a native PDF link after preparation.

Home Screen Safari reserves its viewer window during the tap and loads the PDF after inspection. Preparation can briefly
show an empty viewer. Cancellation or preparation failure closes the reserved window. Closing the PDF viewer retains the
workspace.

A failed handoff retains the completed PDF for Retry. Viewing does not clear the unsaved warning. The browser controls
its PDF viewer's displayed name and download behavior.

Opening, rendering, or processing failures retain the workspace and last completed Input bytes. Errors explain the next
action and retain local retry controls. No partial or uninspected PDF downloads. Recoverable failures do not discard
Inputs.

## Help and onboarding

The first successful PDF opening shows a dismissible welcome about Input, Output, and Download. Skip and Take a tour
remember dismissal locally. No document information is stored. `?reset` clears only that dismissal, consumes itself
once, and preserves other query values and the fragment. The next successful opening shows the welcome. The installed
offline application supports the same entrypoint. It adds no visible Settings control.

Help remains available on the landing page and in the workspace on all platforms. The landing shows App help. An open
workspace adds Keyboard and Mouse for fine-pointer input, and Touch for coarse-pointer input. Hybrid input can expose
both sets. Keyboard describes the current pane views. Left/right, Home, and End switch available topics and move focus.
Dismissal restores prior focus. Start Tour appears only with a workspace. Settings appears with an open Input and offers
lens magnification, software version, Build ID, and the repository link. Escape, close, or outside click dismisses
Settings and restores focus. Theme choice persists locally with system fallback.

App installation help is separate from the welcome and Product tour. The first iPhone or iPad browser visit shows a
dismissible introduction before a pending welcome. Use browser and Close permit normal PDF work. Standalone launches
show no recommendation. Desktop startup stays quiet. Help's App topic always offers installation information. Closing
the first recommendation shows a Notice that points to Help → App. Dismissal never removes that topic.

Installation dismissal uses `mainz:installation` independently of `mainz:onboarding`. If storage is unavailable,
dismissal lasts for the current page. Browser and standalone storage can differ. Installation does not replay the tour.
`?reset` continues to reset only the welcome dismissal. Manual installation help closes active tour guidance first.

Chromium installation requires an available `beforeinstallprompt` event and a user action. An accepted prompt means
installation was requested. Only `appinstalled` reports completion. iOS help describes Safari's Add to Home Screen
action. Supported desktop Safari versions show Add to Dock instructions. Unsupported browsers offer no native install
button. Continuing in the browser remains available after dismissal or failure.

The tour explains actual controls without changing document choices or adding pages. Its core steps cover Input, Input
Grid, Input List, Input Page, Output Grid, Output List, Output selection actions, Output Page, and Output delivery. The
final step explains Download or Share, Print, View PDF, and Export recipe. The Output selection step explains
earlier/later moves, duplication, and removal. Without a selection, that step shows the real actions disabled and keeps
the selection empty. Applicable Style and profile controls add at most two steps. Without Input, the five Output steps
remain. Steps temporarily reveal their pane and tab. Each new step starts at the beginning of its explanation. Closing
restores previous views and returns focus to a visible header control. Using a workspace control ends the tour and
retains that action's pane and tab. Workspace or style availability changes dismiss the tour. Back, Next, Finish, End
tour, Escape, and outside dismissal remain available.

After welcome and tour dismissal, a visible Input thumbnail can introduce addition once per workspace with empty Output.
The visual copy leaves Output and Selection unchanged. The header says “Select pages · Use + to add to Output.” Adding a
page, starting the tour, clicking, scrolling, resizing, or reduced motion stops the animation. Any click also dismisses
the instruction and completes its normal action. The instruction expires after ten seconds. Dismissal or expiry restores
the operation status unless a newer operation replaced it. Clearing Output does not repeat the hint. Reduced motion
keeps the instruction without animation.

## Feedback

| Message | Purpose                                      | Lifetime                                  |
| ------- | -------------------------------------------- | ----------------------------------------- |
| Info    | Operation progress, result, or cancellation. | Until the next operation or state change. |
| Notice  | Guidance or an event announcement.           | Ten seconds, dismissal, or resolution.    |
| Error   | A failure with its next action.              | Until dismissal or resolution.            |

A new Notice replaces the old timed Notice and restarts its timer without replacing operation status. New work or error
feedback clears the timed Notice, so it cannot reappear after the newer message ends. The optional updated-Recipe offer
lasts until export or dismissal. The header presents notifications, warnings, errors, active operations, and recovery
actions. The footer retains workspace status, completed results, and cancellations. Active opening and Style progress do
not repeat in the footer. The header shows one message group at a time. Active operations keep Cancel available. Errors
take priority over notices after active work ends. Header messages have no final period. Clicking a message opens its
available actions or full explanation, or navigates to the affected item. Separate Details controls do not repeat this
trigger. Dialog errors use the same visible, operable header area. Field errors retain accessible descriptions and
invalid states. Local cues can identify an affected item without moving controls, resizing rows, or changing scroll
position. Closing a dialog clears its field errors from the header. Delayed completion cannot replace newer operation
feedback. Selection, navigation, and hover retain their local state cues.

Opening, Style processing, offline installation, and new Download preparation use an indeterminate busy indicator and
action text. Download distinguishes preparation from inspection. These operations report no percentage or remaining time
because the processor does not expose measured work progress. Reduced motion retains a static busy indicator.

Each completed operation status briefly emphasizes its message area, including repeated reports with the same text. This
effect preserves focus, Selection, and message lifetime, and respects reduced motion.

Errors use plain language and user-visible values rather than raw processor fields or codes.

Messages identify the action, relevant setting, and page quantities or positions. The active filename provides Input
context. Other Inputs are named only for operations concerning them. Opening progress appears once. Detailed errors do
not repeat in the footer. The offline-ready and update-ready events use Notices. An installed application does not
repeat offline-ready guidance. Update controls remain after their Notice expires. Offline installation progress appears
in the header. Update app stays in the footer. The update-ready Notice asks users to download and close their PDF only
while a workspace or opening operation exists.

Build ID identifies the application build, separately from software version. Its format is `YYYY-MMDD-HHmm-sscc` in
`Europe/Istanbul` time. Hover identifies this time zone and exposes the full UTC timestamp and available Git revision.
An offline installation retains its build's ID.

## Processing boundaries

The [Plan contract](../../lib/doc/SPEC.md#63-plans-and-composition) owns serialization and processor validation. PDF
Composer sends only referenced Inputs, with complete override maps, and binds Input IDs to immutable bytes separately. A
Blank-only Plan needs no Input bindings. Selections, labels, view state, invalid drafts, local paths, and PDF bytes stay
outside the Plan. The application supplies immediate field feedback. The processor remains authoritative for references,
values, resource limits, repetition, and Padding.

A workspace Input has independent styles and page preparation. At the library boundary, immutable PDF bytes form an
Input binding, and each independent styled use is an Input instance. The Plan's `sources` map records Input instances;
their `input` fields name the immutable bindings. Accepted Output choices produce a Plan. Composition produces a
Document with Provenance. Output remains the editable workspace target.

Parameter IDs are opaque. Labels and descriptions are plain text. The application adds no painting engine, executable
document markup, or authoritative contract validator. Downloaded prepared content remains editable without the original
Input or producer. Invalid embedded contracts remain errors. Encrypted, signed, unsupported, and excessive Inputs follow
library restrictions.

PDF processing stays on the device. User PDF bytes and document-derived values are never uploaded or placed in the
offline cache. Preview uses bundled assets, fetches no document-specified resources, and executes no PDF actions or
scripts. Offline updates retain one complete compatible asset set without interrupting open work. Updating pauses PDF
opening until reload. A blocked update restores opening. Offline installation retries temporary download failures before
it reports a failure. Missing or incompatible assets block installation. Failure guidance asks users to reload the page
and report repeated failures.

Each worker runs one operation at a time and loads only its bundled processor module. A failed operation discards the
WASM instance and extracted-page cache before the next request. Cleanup errors fail successful work without replacing an
earlier operation error. The workspace retains at most one idle processing worker. Completing another operation releases
the previous idle worker. Active operations keep independent cancellation. Ordinary Inputs release their validation
worker after opening. Repeated Style requests for the same cached Input and page sequence reuse the extracted bytes
without sending the complete PDF again. Distinct PNG requests for the same immutable Input also reuse its transferred
bytes. Failure, Input replacement, or worker disposal clears that reuse state. Cancellation, replacement, or Input
removal stops obsolete processing and preview work. Later operations start usable workers. Input bytes remain available
for retry.

A worker retains at most four completed Style or single-Input composition results for one exact input buffer. The 16 MiB
budget counts the retained input, result PDFs, request keys, descriptions, and Provenance records. Reuse requires exact
input bytes, requests, and Input bindings. A cache hit returns an owned copy of a fully validated result without another
PDF read.

Different input bytes, processing failure, multiple-Input composition, and worker disposal clear this cache. The first
request computes only its selected styles. No profile work runs during Input opening and no profile cache enters the
saved PDF.

Disposal releases document handles, registered Inputs, buffers, render tasks, and object URLs. Completed rasters use
bounded memory caching, separate from persistent storage and the offline cache. Removing the last owner of a PDF
releases its cached rasters. Input and Style comparison retain their shared PDFs. The 32 MiB budget counts retained
canvas pixels; it excludes active renders, PDF.js memory, and browser overhead. It is not a total-memory guarantee.
Persistent editable workspaces, printer control, and independent Part or occurrence styles are outside this version.

Low-density thumbnails use a bounded temporary render and reduction to reduce exaggerated thin strokes at small sizes.
This changes preview pixels without changing PDF bytes, Input styles, page proportions, or Page and lens detail
rendering. Exact raster reuse distinguishes thumbnail sampling from direct Page rendering. Only final-sized rasters
enter the retained cache. Temporary render canvases release after completion, cancellation, and failure.

An available producer PNG takes precedence over PDF rendering for the saved page's thumbnail appearance. The application
fits the complete image to the page proportions. It does not stretch or crop the image. The application uses the PDF
renderer after preview invalidation, absence, host limit rejection, or pixel decode failure. Page, lens, and Compare
detail always use the actual PDF.

Shared PNGs decode once per required raster size. Their final-sized canvases use the existing bounded raster cache.
Reuse requires the same document, embedded image identity, raster size, and sampling mode. Temporary PNG bytes and
object URLs release after decoding, cancellation, replacement, or failure. Image access follows the existing worker
ownership policy. It does not retain an idle worker for every open Input. Producer images and derived values remain
document data and never enter the offline cache.

App coordinates Input opening and selects retained documents after view updates. Output owns the accepted Parts,
occurrence selection, inspection, filename, title, cover, and Download and Share acknowledgment. Export owns shared
Output preparation and inspection, the ready Share File, and the latest View URL. Print owns its native PDF frame or
window and temporary URL. The filename editor owns only its draft. Each Input's Preview owns style processing,
cancellation, and displayed-document handoff. App and Preview ignore obsolete processing results. The PDF boundary owns
loading-task and raster release, initial page geometry, and labels. Opening reads complete geometry in bounded batches
and releases each acquired page after inspection. Cancellation discards incomplete geometry. Each preview render
releases its own acquired page, including obsolete generations, and cancels superseded render tasks. Cancellation
retains the last completed raster.

Recipe owns its captured JSON and editable Input names. It changes no PDF-handoff owner. Download owns each temporary
browser-download URL for Output PDFs, Recipes, and selected matching PDFs. Replacement, expiry, or caller disposal
releases that URL. Recipe loading owns selected opening tasks until App adopts their prepared documents. Closing or
replacing the flow disposes tasks that were not adopted and cancels pending sample requests. Late file reads cannot
change a later matching flow. Titles, XMP fields, and rendered covers remain document data and never enter the offline
cache.

Page pinch anchoring belongs to the displayed PDF, physical page, and sequence position. Cancellation, a page-context
change, a hidden pane, or teardown clears pending anchoring and its temporary transform. Reattaching the same Page
during a zoom update preserves its pending anchor.

| Stage             | Retained resources                                              | Cancellation or replacement                                                                                            |
| ----------------- | --------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Open and validate | Pending PDF loading task and validation worker                  | Destroy the task and worker. Ignore late reads and labels.                                                             |
| Attach            | Immutable PDF bytes and an independent workspace Input          | Retain bytes while any open Input uses them.                                                                           |
| Style update      | Input preview, completed composition bytes, and processor       | Cancel obsolete work. Keep the last completed preview.                                                                 |
| Download          | Completed bytes or independent processing, temporary URL        | Release temporary resources. Keep selections and styles.                                                               |
| Share             | One inspected File and acknowledgment                           | Keep the File for a fresh Share or Download action. Handoff, cancellation, or disposal releases it.                    |
| Print             | One native PDF frame or window and URL; snapshot during handoff | Handoff, window close, or panel close releases the snapshot. Replacement or disposal releases the owned frame and URL. |
| View              | Latest completed PDF URL                                        | The next completed View or disposal releases the URL.                                                                  |
| Remove or dispose | Documents retained by remaining Inputs                          | Release documents and rasters after their last owner leaves.                                                           |

## Acceptance

[Model tests](../test/model.test.ts) cover composition, identities, ordering, and style requests.
[Browser tests](../test/) cover actual PDF edits, keyboard routing, focus, cancellation, recovery, demo, and offline
updates. Layout reference cases and their input matrix belong in [VIEW.md](VIEW.md#validation). These documents describe
current requirements, not a claim of physical-device or accessibility certification.

## Glossary

The [library glossary](../../lib/doc/SPEC.md#glossary) owns PDF and painting terms.

| Term               | Meaning                                                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| Blank              | A content-free page with defined physical dimensions. It can be explicit or generated as Padding.                        |
| Build ID           | Istanbul timestamp identifying an application build, separate from version and Git revision.                             |
| Compare            | Preview of the same Output occurrence with completed styles or its opened Input appearance.                              |
| Composition        | Library operation that executes Output's accepted Plan to create a Document and its Provenance.                          |
| Copy count         | Number of repetitions of one complete Part.                                                                              |
| Error              | Failure message retained until dismissal or resolution.                                                                  |
| Grid               | Thumbnail view of Input or Output.                                                                                       |
| Pages layout       | Grid or List layout retained independently for each pane and each open Input.                                            |
| Help               | Dialog with App help, input-specific workspace instructions, and access to the Product tour.                             |
| Info               | Operation progress, result, or cancellation message.                                                                     |
| Input              | Opened PDF with independent styles and page choices. Recipe IDs bind its immutable bytes.                                |
| Input index        | One-based row number in the Recipe export table, independent of the persisted Input ID.                                  |
| Plan               | Concrete library composition request captured from accepted Output choices, separate from PDF bytes and workspace state. |
| Keyboard shortcuts | Help instructions for the current pane views and selection fields.                                                       |
| List               | Row view of Input pages or Output occurrences, with supplied names and the shared selection model.                       |
| Notice             | Temporary guidance or event message in the header.                                                                       |
| Onboarding         | First-opening welcome whose dismissal is remembered on the device.                                                       |
| Output             | Editable workspace target defined by ordered Parts, Input styles, copies, and Blanks.                                    |
| Output preview     | Expanded Output page sequence, independent of active Input and Selection.                                                |
| Output occurrence  | One page in Output with independent identity, including a copy, Blank, or Padding.                                       |
| Output selection   | Temporary set of occurrences used for edits and Input insertion destinations.                                            |
| Page               | View of one large page, with navigation through the pane's complete sequence.                                            |
| Page cursor        | Grid keyboard position, independent of selection and absent at an outer boundary.                                        |
| Page name          | Authored name for List and Grid/Page captions, separate from page numbers and PDF labels.                                |
| Padding            | Alignment-generated Blanks that remain visible and count toward Output pages.                                            |
| Paint duo          | Combined color and opacity control retaining separate parameter identities and resets.                                   |
| Part               | Page sequence with shared repetition and front alignment. Its styles belong to referenced Input instances.               |
| PDF Composer       | Local web application for page composition and declared styles in prepared PDFs.                                         |
| Product tour       | Contextual explanation of actual controls without changing document choices.                                             |
| Recipe             | Portable JSON choices that resolve against bound Inputs into a Plan.                                                     |
| Quartet            | Fill, Stroke, Width, and Visibility presentation for one Style object.                                                   |
| Selection          | Temporary ordered physical pages from one Input, including repeats, prepared for addition.                               |
| Share              | Mobile action that hands the completed Output File to the system sharing panel.                                          |
| Show original page | Opens an Output occurrence's original Input page and matches its visible region once.                                    |
| Style profile      | Named choice replacing one profile set's Input overrides.                                                                |
| UI group           | Authored presentation section whose order does not alter bindings or assignment scope.                                   |
