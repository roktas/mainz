# Mainz PDF Studio Specification

PDF Studio composes local PDF pages and edits declared styles in prepared PDFs. Input retains its opened appearance.
Output shows the composition with completed Source styles. Download executes a Mainz Job.

This document owns workspace behavior and the [product glossary](#glossary). [DESIGN.md](DESIGN.md) owns visual rules,
layout reference cases, and the [UI glossary](DESIGN.md#ui-glossary). The [library specification](../../lib/doc/SPEC.md)
owns PDF contracts, painting restrictions, and processor limits. Source files own implementation details. Build and
validation commands belong in [AGENTS.md](../../AGENTS.md#web).

## Workspace

One workspace supports several independent Inputs and one Output. The main flow is Input selection, addition to Output,
optional Style changes, and Download. View changes preserve selections, Source styles, composition, and preview state.
Ordinary PDFs support composition. Prepared PDFs also expose their declared Style controls.

The landing distinguishes page composition for ordinary PDFs from Style support in prepared PDFs and links to the
library specification. Its header logo replays the landing animation. In the workspace, that logo opens Home.

### Inputs

Opening a PDF creates an independent Source without changing Output. Equal bytes or filenames do not establish Source
identity. Sources can share immutable Input bytes while keeping independent overrides and page preparation.

The first opening shows progressively rendered pages after geometry becomes available. Editing stays blocked until
processor validation succeeds. Cancel remains available. Failure or cancellation discards the provisional Input. Opening
another PDF retains the existing workspace until the new Source is ready. Errors identify the file, cause, and next
action. Incompatible style information requires a newly prepared PDF.

Opening the same PDF again creates an independent Source with the styles saved in that PDF and a new preparation. The
Input chooser lists open Sources and offers Remove Input for the active Source. A Source cannot be removed while Output
references it. Removing Sources never changes existing Blank dimensions.

The Input chooser switches Sources. Each retains its view, inspected page, zoom, Grid density, and preparation. Home
requests confirmation before discarding undownloaded style or Output changes. Acceptance suppresses the browser exit
warning for that navigation. Cancellation retains the workspace. Opening an Input or changing Selection alone does not
mark Output as changed.

### Views and density

Input has Grid and Page, plus Style for prepared PDFs. Output has Grid and Page. Grid and Page share selection and page
operations. Input Page browses every original physical page once, regardless of Selection. Output browses every expanded
occurrence, including Blank and Padding. Navigation does not change selection. Selection does not move the inspected
page or narrow style scope.

Grid interactions establish the page inspected in Page. Returning to Grid reveals that page's batch. Output inspection
follows occurrence identity through movement. Removal chooses the next surviving neighbor, or the previous neighbor at
the end. Input switching does not move Output inspection.

Both panes offer Normal and Compact density. Output starts in Normal. When a Source's Input Grid first becomes visible,
it measures Normal batch capacity. Above twice that capacity, it starts in Compact. Otherwise it starts in Normal. Each
Source retains that choice, including manual changes. Resizing, browser zoom, Page, and Style do not reevaluate it.
Density changes preserve selections, inspection, and operations. [DESIGN.md](DESIGN.md#workspace) defines capacity
references.

When copies exist, Input page numbers open copy counts and Output positions. Output page numbers open the Source
filename and original page number. Mappings distinguish independent Sources and follow edits. Compact details also
provide a larger preview and individual actions. Outside click or Escape closes details. PDF labels supplement physical
numbers. If a PDF label differs from its physical number, Page shows both.

### Demo

| Query         | Result                                                                                         |
| ------------- | ---------------------------------------------------------------------------------------------- |
| `?demo`       | Bundled seven-page Input with six Output pages.                                                |
| `?demo=empty` | The same Input with no Selection and empty Output, including onboarding and the addition hint. |
| `?demo=grid`  | Large Grid fixture, available only in development.                                             |
| `?demo&paint` | Style with the Inkjet profile, available only in development.                                  |

Unknown demo values show an Error and retain local PDF opening. Local opening takes precedence over a pending demo
result or error. The bundled demo remains available offline after application installation. The
[fixture guide](../test/fixtures/README.md) owns its contents and rebuild procedure.

## Selection and addition

Input preparation is an ordered physical page sequence. For example, `3-5,2,2,7` means `3,4,5,2,2,7`. Output selection
is a set of occurrences identified by current positions. Repeated Output numbers select an occurrence once. Operations
use print order. Field edits prepare targets without changing existing Output. Invalid text retains the last valid
selection and blocks selection actions.

| Control                               | Input                                                    | Output                                                     |
| ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------------- |
| Select all                            | Every physical page once, in original order.             | Every occurrence once.                                     |
| Clear                                 | Clears Selection, repetitions to 1, front alignment off. | Clears selection, repetitions to 2, front alignment off.   |
| Field Enter                           | Adds the exact preparation.                              | Removes selected occurrences.                              |
| Individual +                          | Adds one current page without a Selection.               | Duplicates one current occurrence without a selection.     |
| Double-click Grid image               | Adds the preparation, or one current page.               | Keeps the first click's selection.                         |
| Double-click or double-tap Page image | Adds one current page and preserves Selection.           | Duplicates the current occurrence and preserves Selection. |

Select all disappears for a complete selection. Reordered or repeated Input sequences still offer it. Clear appears for
entered text, selected pages, or nondefault Input configuration. It preserves Output. Empty Output has a disabled field
and no action controls. Its menu otherwise supports Blank insertion without a selection. Nondefault repetition and front
alignment remain visible in the field hint. The Output field hint directs selected pages to the selection bar.

Clicking a Grid image or grip toggles selection and gives normal page focus. Shift-click adds missing pages or removes
the anchored range. The Input Page grip uses the same selection. Field values and page borders represent the same
targets.

On touch screens, Selection requests the numeric keyboard. Grid content does not support text selection or touch
callouts. Double-tapping a Grid image opens that page in Page without changing Selection or Output.

Input additions follow the last selected Output occurrence, or append without an Output selection. The Input hint
identifies this destination. Adding a preparation clears it and selects the new Output block after success. Grid and
individual + additions select their new occurrences. Page image activation and Space preserve the Input preparation and
selected Output occurrences. Failure or cancellation preserves preparation.

Any selection hides that pane's individual card and Page action controls. The shared bar edits one or several selected
pages. Clearing selection restores individual controls. Grid editing shortcuts require selection. Navigation and zoom
remain available.

Sequences and expanded Output support at most 10,000 pages, including Padding. Repetitions accept integers from 1 to
1,000. Invalid or empty sequences cannot be added. One-page PDFs support repeated entries such as `1,1`.

## Output composition

Every Output occurrence is independently editable. Selection follows occurrence identity through edits. Other
occurrences, Source pages, and styles remain intact. Page edits preserve expanded order, materialize existing Padding as
fixed removable Blanks, and discard internal Part boundaries.

| Action               | Result                                                                                                      |
| -------------------- | ----------------------------------------------------------------------------------------------------------- |
| Duplicate selection  | One copy of each target in print order, inserted after the last target. New copies form one selected block. |
| Remove               | Removes the target occurrences.                                                                             |
| Move earlier/later   | Shifts every selected occurrence one position, preserving order and gaps.                                   |
| Drag selected Output | Moves the selection as one block in print order.                                                            |
| Insert Blank         | Adds one fixed-size Blank before the first selected page or at the end, and selects it.                     |
| Repeat sequence      | Repeats consecutive occurrences, including Sources and Blanks, in order.                                    |

The Output page actions menu offers movement actions. They disappear at their respective boundaries. A selection
touching both boundaries has neither action. Nonconsecutive selections retain duplication and movement but show an
explanation instead of repetition controls. Repetition includes the current sequence: two copies of A B produce A B A B.
One copy without alignment offers no action. Success selects the final copy's content pages and resets repetitions to 2
and front alignment off. Failure preserves the configuration. Selections do not establish persistent copy groups.

### Duplex alignment and Blanks

Output parity determines Front and Back: position 1 is Front, position 2 is Back. Input parity follows original physical
page numbers. PDF-page counts and duplex-sheet counts remain distinct. Four single-page copies produce four PDF pages
and two sheets.

**Start each repeat on front** is off by default. It gives odd-length copies a trailing Blank, including the final copy.
If preceding pages end on a Front face, a leading Blank completes that sheet.

| Composition                      | Expanded pages                  | PDF pages |
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
the composition unchanged. A completed move follows the moved occurrence. Drop, cancellation, and leaving Output clear
temporary feedback. Native drag support depends on the browser and input device. Buttons support keyboard and touch
alternatives.

Touch dragging starts from a grip when the finger moves. It uses the same selections and insertion rules as mouse
dragging. In Grid, only the card area accepts and highlights drops. On narrow layouts, Input rejects drops and
highlights the Output workspace tab as the target. Dropping there adds the pages at the prepared destination and then
reveals Output. Hover alone does not switch panes. Input shows a delayed rejection hint when movement toward Output
stops. Cancellation preserves the document, selection, and inspected Output page. Scrolling from an image remains
native.

## Keyboard and focus

### Routing and priority

Fields, native controls, menus, dialogs, popovers, and composing input retain their keys. Tab and Shift+Tab retain
native focus navigation. Browser zoom and search shortcuts remain available. Unassigned or modifier-only keys do not
start Grid navigation, except Shift after a clicked selection. Modified Enter and Space do not activate Grid images or
grips. Held view-switch, addition, and removal keys act once per press.

V, Ctrl/Command+A, and Escape target the mouse's screen half. Before mouse use, they target the focused pane. A hidden
or absent pane falls back to the visible pane. Page shortcuts use the same routing, but require a visible, nonempty
Page. If the target pane has none, the other visible Page receives them. Conflicting focused Grid or control keys keep
their targets. Without a suitable Page, Page shortcuts do not change focus or scroll. V also switches an empty Page to
Grid.

| Workspace key                 | Action                                                                                                                 |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| V or Ctrl/Command-click image | Switches Grid/Page, preserving selections, inspection, and zoom.                                                       |
| Ctrl/Command+A                | Selects every page in the target pane once, preserving the other selection, preparation configuration, and inspection. |
| Escape                        | First dismisses an interaction or cancels a drag. Otherwise clears only the target pane's selection and configuration. |
| Delete                        | Removes the Output selection from either pane.                                                                         |
| Ctrl+left/right               | Moves the Output selection earlier/later from either pane.                                                             |
| ?                             | Opens Help outside fields and other open dialogs or popovers.                                                          |

Without an Output selection, Delete and Ctrl+left/right have no action. Input Selection stays unchanged. Escape
otherwise preserves Output, inspection, zoom, and page scroll, then focuses the target view tab and ends Grid
navigation. With no target selection, configuration, or Grid cursor, it has no action. Held Escape cannot clear
selection after dismissing another interaction. A shorter selection bar cannot move window scroll outside document
bounds.

### Grid

| Key                           | Action                                                                                                     |
| ----------------------------- | ---------------------------------------------------------------------------------------------------------- |
| Left/right                    | Moves the cursor in page order without changing selection.                                                 |
| Up/down                       | Moves through rendered columns without changing selection.                                                 |
| N/P                           | Moves in page order. Letter shortcuts accept either case.                                                  |
| Home/End                      | Focuses the first/last physical page across batches without changing selection.                            |
| PageUp/PageDown               | Shows the previous/next batch and focuses its first page, including from pagination controls.              |
| Space                         | Toggles the cursor's page, then advances right. At a boundary it preserves selection and workspace scroll. |
| Shift+right                   | Toggles the cursor's page, then advances right.                                                            |
| Shift+left                    | Retreats, then toggles that page.                                                                          |
| Shift after clicked selection | Places the cursor after it without changing selection.                                                     |
| Enter                         | Adds prepared Input pages or duplicates selected Output occurrences.                                       |
| + / − in Output               | Duplicates/removes the selection. Input Grid gives these keys no page action.                              |

With no selection and inactive Grid navigation, right starts at the current batch's first page and left at its last. The
first press retains the batch and selection. PageUp/PageDown outside Grid target the mouse-side Grid, with the visible
pane as fallback. They stop at the first and last batch.

Plain arrows can visit selected pages. Shift steps can select or unselect. Reversing a step restores membership,
including across gaps and after plain navigation. Unselecting an Input page removes all its prepared occurrences. Other
pages retain order and repetitions. Selecting adds one occurrence.

Navigation does not wrap. Stepping outside Grid hides the cursor and focuses Grid. An inward arrow returns to the
first/last page without changing selection. Shift+right from the start toggles the first page. Shift+left from the end
toggles the last. Outward Shift+arrows have no action. Editing shortcuts remain available at boundaries. Pointer
movement and presses hide the cursor without clearing selection.

### Page

| Key                    | Action                                                       |
| ---------------------- | ------------------------------------------------------------ |
| Arrows                 | Scrolls the image. Reaching an edge never changes page.      |
| N/P or PageDown/PageUp | Goes forward/back one page at every zoom level.              |
| Home/End               | Goes to the first/last page.                                 |
| Space                  | Adds or duplicates one current page and preserves Selection. |
| + or = / −             | Changes zoom through the heading controls' steps.            |
| 0 or Z                 | Restores Fit at 100%.                                        |
| G or click counter     | Opens page entry with its current value selected.            |

Page navigation stops at document boundaries without changing focus or selection. Letter shortcuts accept either case.
Page entry accepts integers from 1 to the page count. Invalid values remain editable with local feedback. Enter accepts,
Escape cancels, and both return focus to that Page viewport. Outside click closes entry without changing selection.

### Focus after actions

Image and grip activation gives normal page focus. Keyboard view switching focuses the inspected page. Pointer switching
does not. Input addition keeps focus in Input. Menu actions close their menu and return focus to its trigger. Removing
the final Output page focuses its active view tab. Removing an Input returns focus to the filename chooser, or to Open
PDF when the final Input is removed.

For mouse and keyboard input, a disappearing field action returns focus to its field. Available selection-bar actions
keep focus. Group removal and Clear return focus to the field while pages remain. Grid keyboard duplication focuses the
final new Output copy. Movement retains focus on the same occurrence. Removal chooses a surviving neighbor. Starting a
mouse drag does not move focus.

On touch screens, only direct activation of the Selection field focuses it. Other Selection actions return focus to Grid
or Page. Touch dragging dismisses the keyboard and does not focus Selection on completion.

## Source styles

A Source owns parameter definitions and overrides. New Sources retain saved overrides. Omitted assignments use authored
baselines. Mixed or unrepresentable baselines stay unassigned. Schema defaults do not create values or averages. A valid
change affects every eligible record in its declared binding. Selections, Part boundaries, and inspection do not narrow
that scope. Independent styling of the same physical page requires an independent Source.

### Scope and controls

Style controls appear only for parameters affecting Output pages from the active Source. Hidden controls retain
overrides and drafts. A prepared Source without applicable Output has a disabled Style tab and an explanation. An
ordinary PDF has no Style tab. Hidden or transparent prepared targets remain editable while their contract and geometry
exist.

Groups and parameters follow authored array order. A group's count represents distinct Style objects by exact binding
target sets. Information panels expose baselines, page scope, Output coverage, constraints, and opaque parameter IDs.
Hover opens them, click pins them, and outside click or Escape dismisses them.

Related parameters combine only within their authored group and only with the same exact target set. Binding properties
identify their roles. A complete set of several related parameters forms a Quartet at its first parameter's position. A
lone parameter retains its individual control. A Quartet uses the display parameter's title and has Fill, Stroke, Width,
and Visibility. Fill and Stroke each combine color and opacity in a Paint duo. Width belongs to Stroke. Visibility
controls the target set. The arrangement adds no processor schema or manifest field.

Each setting opens its editor. A Paint duo opens color and opacity together, retaining independent values and resets.
Outside click or Escape closes an editor. Escape returns focus to its trigger. Expanded editors retain descriptions,
information, constraints, and draft errors. Unavailable parameters create no assignment and imply nothing about the
original paint. Mixed and unrepresentable values remain editable. Unassigned Visibility stays indeterminate, never
implicitly Hide. Individual display controls use Show/Hide radio choices.

Color supports a native picker, hex entry, and eight-level RGB steps. Width uses numeric entry and a 1.05 step factor.
Opacity supports exact numeric entry and a slider. Out-of-range steps and enum choices are disabled. Invalid values are
not rounded or silently corrected. Opening a picker assigns nothing.

### Profiles and reset

A profile set appears only with several profiles and at least one parameter in the current visibility scope. Its name
labels the select. The selected profile's description stays visible. Missing descriptions use a short description based
on the profile name. The affected Input pages appear in hover help.

Choosing a profile replaces the Source's overrides throughout that set and clears its invalid drafts. Omitted parameters
return to authored baselines. Other sets and Sources retain their choices. Matching override maps select the declared
profile. Other maps and invalid drafts show Custom. Profile choices remain individually editable. Names, descriptions,
and values come from the producer and imply no application-defined printer behavior.

Field reset removes one override. **Reset all styles** clears the Source's complete map, including hidden and saved
overrides, and invalid drafts. Resets retain other Sources, selections, composition, and immutable bytes. Reset is
disabled without overrides or invalid drafts.

### Processing

Valid choices are retained immediately. Processing runs only for parameters affecting existing Output pages. Unused
choices do not show processing or block Download. Adding an affected page prepares deferred choices. Reordering or
copying currently styled pages does not repeat processing. Removing the last affected page cancels unnecessary work
while retaining choices. Cancel and Retry retain choices and the last completed preview.

Partial Source processing can use extracted pages, but controls, labels, preview, and Compare retain original physical
identities. Download always uses complete immutable Inputs and complete Source overrides. Source errors offer Retry even
with another Input or tab active. Invalid drafts never enter a Job. Obsolete processing results cannot replace newer
choices.

## Page preview and comparison

Page preserves physical proportions for PDF content, Blank, and Padding. Fit is 100%. The zoom steps are 50%, 100%,
150%, 200%, 300%, and 400%. Pinching a Page image changes zoom continuously within 50–400%, around the midpoint of the
two fingers. Zoom buttons and keyboard controls choose the next step from that value. Pinching preserves Selection and
Output. Application zoom is independent of browser zoom. View changes, Input switches, selection changes, and resizing
retain each pane's zoom and latest visible region.

At enlarged zoom, mouse dragging pans the image. Input transfer uses the Page grip. Output reordering uses Grid,
selection actions, or keyboard controls. At 100% or below, the wheel scrolls the workspace. Above 100%, it scrolls the
image and does not pass scrolling to the workspace at an edge. Keyboard and touch scrolling remain native.

**Compare page** toggles the inspected occurrence between completed Source styles and immutable opened appearance. It
requires a completed relevant style difference. Composition alone does not enable it. Pending or invalid relevant drafts
disable it. Reset can enable Compare by removing saved overrides. Input switching retains Output position and Compare.

**Show original page** opens the occurrence's Source in Input Page at its original physical page, including extracted
previews. It matches Output zoom and visible region once. Later navigation, zoom, and panning remain independent.
Selections, styles, Output position, and Compare stay unchanged. On mobile it activates Input. Blank and Padding disable
the action.

The lens uses opened Input appearance and completed Output styles, or opened appearance during Compare. It opens after
the mouse settles for 180 ms, follows movement immediately once open, and closes on leaving the image. All lenses share
Settings' 8×, 16×, or 32× magnification, initially 16×. The pane's thumbnail defines reference magnification. Page and
zoom compensate for their size difference to retain the same crop scale. The lens does not change layout or intercept
mouse input. On touch screens, holding an image opens the lens. Moving the held finger changes the crop. Release,
cancellation, a second finger, or scrolling dismisses it. A hold does not select, add, duplicate, or move pages.

## Download and recovery

Download is disabled for empty or invalid Output and for invalid drafts affecting its content. Unused invalid parameters
do not block it. Relevant Source processing temporarily replaces Download. Completed Source previews do not imply that a
combined Output PDF already exists.

Download captures the valid Job and supplies each referenced Input once. A modal reports preparation and inspection
while locking workspace actions. Cancel, Escape, and close terminate processing and retain the workspace. Retry uses
current choices. Obsolete results cannot download. The application compares completed page counts and inspects the PDF
before starting the browser download.

The filename is `<input-name>_YYYY-MMDD-HHmm-sscc.pdf`, using the first contributing Input's original filename without
its `.pdf` extension. The timestamp uses local time at browser download. `ss` means seconds and `cc` hundredths. Unused
Inputs do not affect the name. Blank-only Output uses `blank-pages`. Success retains the workspace and clears the
downloaded choices' unsaved warning. Unused Source changes and invalid drafts retain their warning.

Opening, rendering, or processing failures retain the workspace and last completed Source bytes. Errors explain the next
action and retain local retry controls. No partial or uninspected PDF downloads. Recoverable failures do not discard
Inputs.

## Help and onboarding

The first successful PDF opening shows a dismissible welcome about Input, Output, and Download. Skip and Take a tour
remember dismissal locally. No document information is stored. `?reset` clears only that dismissal, consumes itself
once, and preserves other query values and the fragment. The next successful opening shows the welcome. The installed
offline application supports the same entrypoint. It adds no visible Settings control.

The Help button is hidden when the primary pointer is coarse. Help opens on Keyboard with shortcuts for the current pane
views. Mouse explains selection, view switching, addition, drag, and scrolling. Left/right, Home, and End switch topic
tabs and move focus. Dismissal restores prior focus. Start Tour begins the contextual tour directly. The landing page
has no Help. Settings appears only with an open Source and offers lens magnification, software version, Build ID, and
the repository link. Escape, close, or outside click dismisses Settings and restores focus. Theme choice persists
locally with system fallback.

The tour explains actual controls without changing document choices or adding pages. Its core steps cover Input, Input
Grid, Input Page, Output Grid, Output Page, and Download. Applicable Style and profile controls add at most two steps.
Without Input, only the three Output steps remain. Steps temporarily reveal their pane and tab. Closing restores
previous views and returns focus to a visible header control. Using a workspace control ends the tour and retains that
action's pane and tab. Workspace or style availability changes dismiss the tour. Back, Next, Finish, End tour, Escape,
and outside dismissal remain available.

After welcome and tour dismissal, a visible Input thumbnail can introduce addition once per workspace with empty Output.
The visual copy leaves Output and Selection unchanged. Its Notice says “Select pages · Use + to add to Output.” Adding a
page, starting the tour, clicking, scrolling, resizing, or reduced motion stops the animation. Any click also dismisses
the Notice and completes its normal action. Clearing Output does not repeat the hint. Reduced motion keeps the
instruction without animation.

## Feedback

| Message | Purpose                                      | Lifetime                                  |
| ------- | -------------------------------------------- | ----------------------------------------- |
| Info    | Operation progress, result, or cancellation. | Until the next operation or state change. |
| Notice  | Guidance or an event announcement.           | Ten seconds, dismissal, or resolution.    |
| Error   | A failure with its next action.              | Until dismissal or resolution.            |

A new Notice replaces the old Notice and restarts its timer without replacing operation status. All Notices expire,
including actionable guidance. Associated controls remain available. An Error clears the current Notice and operation
status. Local errors retain their nearby explanation and retry action. Delayed completion cannot replace newer operation
feedback. Temporary selection, navigation, and hover use local feedback.

Each operation status briefly emphasizes its message area, including repeated reports with the same text. Successful
Page image copies also briefly emphasize the image. These effects preserve focus, Selection, and message lifetime, and
respect reduced motion.

Errors use plain language and user-visible values rather than raw processor fields or codes.

Messages identify the action, relevant setting, and page quantities or positions. The active filename provides Input
context. Other Inputs are named only for operations concerning them. Opening progress appears once. Detailed errors do
not repeat in the footer. The offline-ready and update-ready events use Notices. An installed application does not
repeat offline-ready guidance. Update controls remain after their Notice expires.

Build ID identifies the application build, separately from software version. Its format is `YYYY-MMDD-HHmm-sscc` in
`Europe/Istanbul` time. Hover identifies this time zone and exposes the full UTC timestamp and available Git revision.
An offline installation retains its build's ID.

## Processing boundaries

The [Job contract](../../lib/doc/SPEC.md#63-job-and-composition) owns serialization and processor validation. PDF Studio
sends only referenced Sources, with complete override maps, and binds Input IDs to immutable bytes separately. A
Blank-only Job has no Sources or Inputs. Selections, labels, view state, invalid drafts, local paths, and PDF bytes stay
outside the Job. The application supplies immediate field feedback. The processor remains authoritative for references,
values, resource limits, repetition, and Padding.

Parameter IDs are opaque. Labels and descriptions are plain text. The application adds no painting engine, executable
document markup, or authoritative contract validator. Downloaded prepared content remains editable without the original
Input or producer. Invalid embedded contracts remain errors. Encrypted, signed, unsupported, and excessive Inputs follow
library restrictions.

PDF processing stays on the device. PDF bytes and document-derived values are never uploaded or placed in the offline
cache. Preview uses bundled assets, fetches no document-specified resources, and executes no PDF actions or scripts.
Offline updates retain one complete compatible asset set without interrupting open work. Updating pauses PDF opening
until reload. A blocked update restores opening.

Each worker runs one job at a time. Cancellation, replacement, or Source removal stops obsolete processing and preview
work. Later jobs start usable workers. Input bytes remain available for retry. Disposal releases document handles,
registered Inputs, buffers, render tasks, and object URLs. Completed rasters use bounded memory caching, separate from
persistent storage and the offline cache. Its budget is not a total-memory guarantee. Persistent editable workspaces,
printer control, and independent Part or occurrence styles are outside this version.

## Acceptance

[Model tests](../test/model.test.ts) cover composition, identities, ordering, and style requests.
[Browser tests](../test/browser.test.js) cover actual PDF edits, keyboard routing, focus, cancellation, recovery, demo,
and offline updates. Layout reference cases and their input matrix belong in [DESIGN.md](DESIGN.md#validation). These
documents describe current requirements, not a claim of physical-device or accessibility certification.

## Glossary

The [library glossary](../../lib/doc/SPEC.md#glossary) owns PDF and painting terms.

| Term               | Meaning                                                                                                 |
| ------------------ | ------------------------------------------------------------------------------------------------------- |
| Blank              | A content-free page with defined physical dimensions. It can be explicit or generated as Padding.       |
| Build ID           | Istanbul timestamp identifying an application build, separate from version and Git revision.            |
| Compare            | Preview of the same Output occurrence with completed styles or its opened Input appearance.             |
| Composition        | Ordered assembly of Source pages and Blanks into Output.                                                |
| Copy count         | Number of repetitions of one complete Part.                                                             |
| Error              | Failure message retained until dismissal or resolution.                                                 |
| Grid               | Thumbnail view of Input or Output.                                                                      |
| Grid density       | Normal or Compact layout chosen independently for each pane, and retained per Source in Input.          |
| Help               | Workspace dialog with contextual Keyboard and Mouse instructions and access to the Product tour.        |
| Info               | Operation progress, result, or cancellation message.                                                    |
| Input              | Immutable PDF bytes supplied separately from a Job. Also the UI label for the active Source.            |
| Job                | Complete processor request for one Output, separate from PDF bytes and editable workspace state.        |
| Keyboard shortcuts | Help instructions for the current pane views and selection fields.                                      |
| Notice             | Temporary guidance or event message in the header.                                                      |
| Onboarding         | First-opening welcome whose dismissal is remembered on the device.                                      |
| Output             | One document assembled from ordered Parts with their Source styles, copies, and Blanks.                 |
| Output preview     | Complete expanded composition, independent of active Source and Selection.                              |
| Output occurrence  | One page in Output with independent identity, including a copy, Blank, or Padding.                      |
| Output selection   | Temporary set of occurrences used for edits and Input insertion destinations.                           |
| Page               | View of one large page, with navigation through the pane's complete sequence.                           |
| Page cursor        | Grid keyboard position, independent of selection and absent at an outer boundary.                       |
| Padding            | Alignment-generated Blanks that remain visible and count toward Output pages.                           |
| Paint duo          | Combined color and opacity control retaining separate parameter identities and resets.                  |
| Part               | Internal flat page sequence with one Copy count and front-alignment choice, without independent styles. |
| PDF Studio         | Mainz's local web application for page composition and Source styling.                                  |
| Product tour       | Contextual explanation of actual controls without changing document choices.                            |
| Quartet            | Fill, Stroke, Width, and Visibility presentation for one Style object.                                  |
| Selection          | Temporary ordered physical pages from one Source, including repeats, prepared for addition.             |
| Source             | Independent workspace entry using immutable Input bytes and owning its overrides and preparation.       |
| Show original page | Opens an Output occurrence's original Input page and matches its visible region once.                   |
| Style profile      | Named choice replacing one profile set's Source overrides.                                              |
| UI group           | Authored presentation section whose order does not alter bindings or assignment scope.                  |
