# PDF Composer design

This document owns visual rules, layout reference cases, and the [UI glossary](#ui-glossary). [SPEC.md](SPEC.md) owns
workspace behavior and product terminology. [Stylesheets](../src/main.css) and their imported component styles own exact
CSS values, breakpoints, and animation keyframes. The rules below retain deliberate visual constraints without
duplicating the implementation or the interaction specification.

The [workspace specification](SPEC.md#implementation-status) defines the implemented views and metadata behavior.

## Contents

- [Tokens and assets](#tokens-and-assets)
- [Alignment](#alignment)
- [Focus, selection, and motion](#focus-selection-and-motion)
- [Workspace](#workspace)
- [Page fields](#page-fields)
- [List](#list)
- [Grid and Page](#grid-and-page)
- [Style presentation](#style-presentation)
- [Drag and drop](#drag-and-drop)
- [Onboarding and product tour](#onboarding-and-product-tour)
- [Feedback presentation](#feedback-presentation)
- [Validation](#validation)
- [UI glossary](#ui-glossary)

## Tokens and assets

| Role              | Light                                      | Dark                              |
| ----------------- | ------------------------------------------ | --------------------------------- |
| Paper             | White.                                     | Near-black.                       |
| Text and surfaces | Near-black text on light neutral surfaces. | Light text on dark gray surfaces. |
| Accent            | Purple, `#800080`.                         | Beige, `#e5c39c`.                 |
| Secondary         | Slate blue, `#426b8a`.                     | Pale blue, `#9abbd1`.             |

CSS expresses colors in OKLCH. Neutral hues use `none`. Theme variations derive from the same palette. Workspace text
uses the system sans-serif stack. The landing product name and purpose heading use bundled EB Garamond at weight 500.
The font, [license](../public/fonts/eb-garamond.txt), and [logo](../public/logo.svg) ship as local application assets.
Fallback fonts keep text visible during loading. The logo supplies the header, landing image, and favicon. Its upright
curves use the accent at full opacity. Horizontal curves remain faint. Each inline instance has unique SVG IDs. The
dedicated [app icon](../public/icon.svg) uses the same curves in fixed purple on white, with a square canvas and safe
margins. Its maintained PNG renditions supply the 180 px iOS touch icon and the 192/512 px manifest icons. The opaque
512 px icon also supports Android launcher masks. All renditions use the same artwork scale. Visible curves reach
approximately 39.7% of the canvas width from its center, inside the central safe circle with radius 40%.

Page-selection hints and Style descriptions use the body text size. Small numbers and secondary metadata retain smaller
text. The landing's prepared-PDF link uses a thin dotted underline with clear space between dots and below the text. The
underline is black in light mode and white in dark mode. Forced colors retain the underline. The purpose heading uses a
neutral tone between primary and muted text, with at least 7:1 contrast and an accent link. Supporting copy
distinguishes PDF page selection and repetition from styling prepared PDFs. It fits on one line on wide desktops and
wraps on narrower layouts. Narrow layouts retain a single-line purpose heading at normal text size.

The spacing scale uses a 28 px workspace gutter and fluid control gaps of 12–16 px at normal text size. Narrow layouts
reduce gutters before reducing usable control space. Standard controls use 4 px corners. The landing frame uses softer
12 px corners. Primary buttons are at least 104 × 46 px. Interactive targets are at least 44 px. Grid headers and Page
controls use the target sizes in [Grid and Page](#grid-and-page).

Controls of the same type in a visible panel, toolbar, or action group must have the same width and height unless this
document defines an explicit exception. Type means interaction role, such as a selection row, action button, icon
button, or form field. Label length, icons, color, and action priority do not create a different type. Use the control
that needs the most space to set the shared size. Define shared dimensions with one token or shared layout track. Keep
equal gaps between controls. After the final adjustment, measure their rendered bounds in the browser and verify equal
dimensions; visual estimates are not sufficient. Colors, surfaces, and hover treatments follow each control's role.
Different control types can use their documented dimensions but must share an explicit alignment edge or centerline. In
the Input chooser, selection rows share dimensions; information icons occupy a separate fixed-width column. Remove Input
is a compact separate action whose end edge aligns with the selection rows. Narrow choosers hide secondary titles and
indexes and show Remove Input as an accessible icon action. Desktop Open PDF and Download share the same dimensions.

The shared `--icon-size` token sets ordinary icons to 1.125 rem. Control-specific icon sizes use their own visual role.

Action labels use sentence case. Keep acronyms such as PDF and JSON and product terms such as Input and Output. Write
the intended text directly; do not use CSS capitalization.

**Button labels must never wrap. Shorten the label before increasing the button width.** Use the surrounding context
instead of repeating it: use Save when the panel already identifies the file. Keep the full action clear. Do not shrink,
clip, or truncate action labels. Keep peer buttons equal in size and aligned after shortening their labels. At narrow
widths and enlarged text, move or stack whole controls when needed; never split their labels. Page names inside
selection controls retain their own wrapping rules. Confirmation actions place Cancel or Dismiss before Save or Apply.
Keep the positive action on the right in a row, or below the dismissive action when stacked.

The landing labels are PDF and Recipe. The PDF picker retains the accessible name Open PDF. These actions share width
and padding on all four sides. At normal text size, their icons are 24 px. PDF is 54 px high; Recipe is 1 px taller.
Wide layouts center them on one row with a muted `or`; narrow layouts stack them. The primary PDF action uses the
unboxed Acrobat ribbon. Its color is the opposite theme's accent: beige in light mode and purple in dark mode. Recipe
uses JSON braces and a quiet secondary surface. The existing animated logo and landing composition remain the visual
anchor.

Icon buttons use transparent surfaces, accent stroke emphasis on hover, and immediate press feedback. Destructive
actions retain danger colors. Text and primary buttons can use a soft accent glow with a fine pointer and hover support.
Touch presses use color and brightness feedback without box glows. Disable the browser's native tap highlight throughout
the application. Disabled actions remain recognizable. In particular, both Input addition and Output duplication keep a
clearly visible + against their primary surface.

## Alignment

Each visual group has an explicit alignment reference: an edge, centerline, or text baseline. Related headers, content,
and footers use the same reference on both axes. Align text by its baseline and icons by their visible bounds. A
centered control stays on the content's centerline when adjacent controls have different widths.

Panels and popovers use equal, moderate inline insets. Header labels, separators, root content, and footers share those
edges vertically. A close icon's visible trailing edge aligns with the right content edge; its invisible target padding
does not define the margin. Nested content keeps its hierarchy within these shared bounds. Reserve scrollbar space
outside the content edges so scrolling does not shift columns or break symmetry. Verify both scrolling and non-scrolling
states at phone, tablet, and desktop widths.

Stacked rows with corresponding controls share column widths and gaps. Align each control's start and end edges with the
controls above and below it. Apply the same tracks to buttons and selectors; their labels do not set independent widths.

Grid grips and section ribbons use the card's inline center and the header's block center. Page numbers, folded corners,
digit counts, and interaction target sizes do not move these references. Size text and interaction areas around them.

Use the visible content as the reference when controls belong to an image or document. Use the frame reference below for
Page layouts. Do not infer alignment from invisible control boxes or incidental padding. Keep usable interaction targets
around aligned content. Check alignment again when fitting, aspect ratio, zoom, font size, or conditional controls
change the layout.

## Focus, selection, and motion

The interface targets [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Status and selection do not rely on color alone.
Keyboard focus remains visible in both themes and forced colors. Bordered controls show one secondary border without a
separate outer ring. Transparent outlines remain available for forced-colors repainting. Controls without visible
borders use a 1 px secondary focus outline. Compound fields mark their outer boundary. Embedded buttons retain their own
visible focus. Pointer and touch actions do not leave focus outlines on non-editable controls, including dialog
defaults. Keyboard input restores visible focus. Focus does not change control geometry.

Selection and keyboard position remain distinct. Selected Grid cards have a 2 px accent contour and a subtle accent
tint. The Grid cursor uses a 2 px neutral black/light or white/dark contour around the card and folded corner, including
on selected cards. Forced colors use system Highlight. Grips retain their own focus emphasis before activation moves
focus to the page. Page uses a 1 px contour, increased inward to 2 px for selection. Its heading receives selection tint
while its image viewport stays neutral. Border, header, footer, and padding compensation prevent selected cards from
moving or resizing their images. Keyboard focus on the Page viewport uses the complete frame's neutral contour. Pointer
zoom focuses the viewport for navigation without showing that contour or a clipped inner outline.

Returning through Grid, List, or Page tabs briefly marks the inspected item with a 30% secondary tint. Keep the cue for
1200 ms, with a longer fade after the initial hold. Hold the final color until the cue clears. Reduced motion uses the
same static cue without fading. The active tab retains focus. Keyboard content returns focus the inspected item without
this cue. The cue does not select the item or reopen its preview.

Motion follows reduced-motion preferences. Hover lifts, drag tilt, parallax, fades, and animated movement disappear
under reduced motion. Static selection and operation highlights remain. Loading indicators retain a visible busy state
without rotation. Animations do not delay document edits, capture input, or change operation targets. Outgoing cards
cannot receive input. Removal can fade outgoing cards. View switches retain their ordinary transitions.

Use short feedback for controls and more time for large movements, following
[Fluent's motion guidance](https://fluent2.microsoft.design/motion) and
[Carbon's productive motion guidance](https://www.carbondesignsystem.com/building-blocks/foundations/motion/overview).
Controls use 120–280 ms. Exits accelerate; movement within the workspace eases in and out without overshoot. Animate the
affected element. Read card positions and exit styles together before starting animations. Keyboard glow belongs to the
focused card, so its animation does not recalculate inherited values throughout the workspace.

## Workspace

The desktop landing and workspace share the same header and content edges. Size the landing to the workspace's existing
width. Its heading and graphic scale with the available content space. Keep workspace and Grid geometry independent of
landing typography. Primary coarse-pointer landing layouts above 375 px use equal outer margins through 40 em. Wider
touch layouts use two gutters above the frame and center it horizontally.

Desktop Input and Output have equal widths and equal gutters around the center separator. Their headings, tabs, fields,
hints, and content share row tracks. The filename chooser belongs to Input's heading and includes Remove Input below the
open-PDF list. At normal text size, desktop pane headings use 16 px text and 28 px document icons, scaling with text.
Open PDF and Download occupy corresponding positions and have equal dimensions. Print and View icons precede Download,
in that order. Their glyphs share the document icon's 28 px size on desktop and mobile, scaling with text. Their targets
are at least 46 × 46 px. The visible Print–View, View–Download, and Input eye–Open PDF gaps match with compact shared spacing. These icon actions are exceptions to equal
peer-button widths. Output totals sit before these actions. Relevant processing disables Download, View, and Print
without changing heading dimensions. Progress and Cancel belong to the app header. The Output heading is a frameless
button that opens the filename editor. It retains Input's heading typography and icon alignment. Hover and keyboard
focus identify the action. Its panel uses the standard full-height entry and equal Use default and Save buttons. When
the cover thumbnail and field share a row, the number entry ends at Use default's end edge. Wrapped fields retain a
usable width. Invalid fields retain their error state without adding layout space.

Input file details open from each item in the Input chooser, not from the closed selector. Long details scroll within
the available viewport below the trigger.

Each pane header, view toolbar, and selection bar stays on one control row at every supported width and text size.
Controls never wrap or move to another row. Preserve usable gaps, full-size touch targets, and shared vertical
alignment. The closed Input selector shows the document title at regular weight and preserves the source number. The
Input chooser retains full filenames and their detail controls. Input pages/sheets and View Input PDF appear immediately
before Open PDF. On narrow headers, Input counts move into an information popover while their eye action stays visible.
The reclaimed header width goes to the Input document title. The Output summary uses concise counts, such as `6 pages, 3 sheets`, without PDF or duplex prefixes. If these counts
still do not fit, make them available through a clickable details control. Do not split the header to fit them. At
enlarged text sizes, Open PDF and Download can use their icons with the same accessible names and touch targets.

In single-pane layouts, the Input/Output switch uses two equal columns. The Input header keeps its three groups on one
row: selector, page/sheet summary with View Input PDF, and Open PDF. Output totals align to the end of the space before
Print, View, and Download. These actions stay together at the end of the row with matching compact gaps. Download uses the same 28
px icon size as Print and View, with a square primary-colored target and no text label. Desktop Download retains its
labeled primary button. If enlarged text leaves insufficient room, keep the Input/Output switch labels and omit their
icons.

On iOS and Android with native file sharing, Share replaces Download at the same position and keeps the primary target.
Its 28 px share glyph matches Print and View and scales with text. Its button, tooltip, and accessible name say Share.
Desktop and unsupported environments keep Download. The ready-file panel names its actions Share and Download without
the redundant PDF suffix. A required fresh gesture uses neutral feedback rather than a permission error.

Export recipe uses JSON braces in the secondary color, immediately before Print and View in the Output header. Its glyph
and target match Print and View. It remains available in every workspace view. Its centered panel uses a Name, Index,
Path, Title table with bold column headings and equal Cancel and Export buttons with the shared control gap. Index uses
tabular numbers. Path is compact, muted read-only text with full-path hover. The table scrolls within its panel when
columns cannot remain readable. Title shows the Input title. Name cells use accent text, a light accent tint, and a
dotted underline to show editing. Activating a cell replaces its button with a full-width text field. Long values wrap
within their cells. The panel scrolls within the viewport and retains keyboard focus behavior in both themes.

Recipe matching uses paired rows: the saved cover and title on one side and the local PDF selection on the other. Keep
cover and file selection beside each other at every width. Wide covers display at 110–130 CSS px; narrow covers use
80–110 px. The selection box shares the cover frame's height. Narrow rows place the smaller title, monospace Input ID,
and information icon together above the cover. Each narrow row uses its content height, with a small consistent gap. At
375 × 667 and normal text size, the first two complete demo Inputs fit on the first screen. Input details expose
complete titles and available XMP fields. Wide Input headers and chooser entries show titles as muted secondary text.

Matching is the landing's next step. The 24 px Back icon uses a target of at least 44 px beside the Recipe filename.
Align its visible start edge with the heading, file choices, and covers below. Back retains its accessible name and
hover description, with glyph-only glow and no hover surface. The small Recipe-download icon sits beside the filename.
The larger logo occupies the upper end-side space and retains entry motion and parallax. Sample PDFs precedes Choose
PDFs; both actions share dimensions and stay on one row when they fit. Stack whole buttons at constrained widths. An
empty box centers Choose a PDF and its drop hint on both axes. Narrow layouts hide the drop hint and the logo, use
shorter supporting copy, and reduce the gap below the Recipe filename. Wide layouts also keep a compact gap below the
filename. The larger logo's visible top aligns with the Back arrow, without increasing the heading height. Choose a PDF
uses the primary surface. It shares width and height with Cancel and Apply recipe where the row has enough space. At
narrow widths or enlarged text, the PDF choice can retain its + icon and full accessible name.

After selection, the box places the filename and match status in one half and the Change PDF/download group in the
other. Both groups center vertically. In a shared row, the filename's start inset matches the download glyph's end
inset. Keep this text inset when narrow layouts stack the groups. Change PDF keeps its icon and text on one line, with
equal side padding. Its download icon stays beside it. Narrow layouts can stack the two groups. At enlarged text sizes
with insufficient space, Change PDF can retain its icon with the same accessible name. Change PDF, Cancel, and Apply
recipe share dimensions. The footer group has equal space above and below it, bounded by its separator and the outer
frame. Download icons have no hover surface or circular shadow; only the glyph gains emphasis.

Each selected PDF keeps its filename and one short result in the existing box. The combined result is a details trigger
with a 44 px minimum target. Truncate long text within the box; keep the complete result available to assistive
technology. Clicking opens explanations or a Review step with an explicit approval button. Opening, accepting, and
closing details must not move or resize the row, cover, or PDF box. Both wide and narrow layouts use this interaction.
The filename and result share a start edge at every width. Ready and update results use primary emphasis. Review uses
secondary emphasis, including after acceptance. Error uses danger text and has no acceptance control. Unreadable PDFs
retain the same selected-file box, filename, and Change PDF placement. Details show only explanations for ordinary
results. A Review step stays beside the selected PDF, explains its issues, and centers its Use anyway button at the
bottom with one standard gap above it. Keep the panel below the header and within the viewport. Long explanations scroll
within the panel while the approval button remains visible. The header's Review action opens this step at the
corresponding PDF row. The header uses the single action Review PDF; the row retains the state Review required. The
action uses text glow without a button surface or box shadow. Do not repeat the filename or result, or add a Review
heading inside the panel. Show one issue as a paragraph; show several issues as a list. After a changed load, the
header's References updated message opens an explanation and two rows of controls in the same panel. The first row
places the filename on the left and Save on the right. The second places Dismiss on the left and Overwrite on the right.
All three buttons and the filename field share one width and height and align on both axes. Use a slightly wider
horizontal gap than the vertical gap. The filename has a light secondary tint and an underline instead of a button
outline. Overwrite uses the secondary fill; Save uses the primary fill. Stack whole controls when enlarged text leaves
insufficient room. The workspace keeps its normal heading and content positions.

Wide Input rows share a height. The title is primary text. Optional XMP `dc:description` appears directly below it as
smaller, muted text with a clear gap. It is separate content, not a repeated or punctuation-split title. The description
uses the row's vertical space and can scroll when very long. Narrow layouts hide the inline description and expose it
through the title's text trigger in the shared information popover, without shifting rows. The monospace logical Input
ID and information icon share a compact row at the cover's lower edge on wide layouts. Do not repeat Saved Input beside
every icon. Input and saved Recipe details use the same readable field names, such as Filename, Title, and Producer.
Field names use bold text. Information controls use borderless surfaces and glyph emphasis without a circular hover
surface or shadow. Keyboard focus remains visible. The shared status line holds Input counts and scrolls below the
matching content. Initial demo opening does not draw a focus contour around the matching frame. Keyboard opening focuses
Back; Tab and other keyboard actions retain visible control focus.

At constrained widths with enlarged text, all four Output action glyphs shrink together to fit their row. They retain a
28 px minimum and full interaction targets. Counts retain their details control. Normal text keeps the shared 28 px
document icon size.

The header places the Home logo at the start and Help, Settings, and theme controls at the end. It states that
processing stays on the device. Feedback occupies the center, as defined below. Header actions use all space after the
logo before wrapping. Help remains visible on coarse-pointer devices and on the landing page. Settings opens a right
drawer. Lens controls show the magnification beside − and + buttons, aligned like the Page zoom controls. Application
information sits at the bottom behind a thin separator. Version and Build ID values align to the end and wrap with
enlarged text. The repository link uses an accessible icon target.

A single click on the logo opens Home. A double-click replays its existing entry animation. Three or more quick clicks
open Explore the app as a normal modal dialog on every screen. Use short action labels and plain descriptions of each
example, without showing query strings or developer parameter names. Only the workspace offers the welcome choice. PDF
chooser controls do not select text or open native touch callouts during a hold. Taps open the system file picker.

Pointer opening places initial focus on the Settings drawer. Keyboard opening focuses its Close button. Keyboard
navigation keeps a visible focus indicator on each control.

Tabs use square corners and an accent underline. Grid uses four thumbnail squares; List uses horizontal lines; Page uses
a single sheet. Glyphs retain the same size and visible center. Unselected tabs gain color on hover. Keyboard focus uses
a soft tint and one border, without glow. Input offers Grid, List, Page, and eligible Style tabs. Output offers Grid,
List, and Page. Grid and List are the two direct Pages views, each with its own tab, icon, and accessible name. Each
Input and Output retains its selected Pages layout. Focus stays on the selected tab after activation.

Toolbars at or below 26 em use icon-only tabs. Wider panes show text. Keep at least 12 CSS px between adjacent tab
contents when labels are visible. Tabs and Style tools must not wrap or overlap. Keep their height consistent across
views so that the pane content frame does not move. Inset each active tab underline by 4 CSS px.

Go to page sits at the end of the Pages/Page toolbar. Its icon opens a compact panel centered below the trigger within
the viewport gutters. The panel has one numeric-keyboard field, a Go action, first and last page icons, the valid page
range, and a Close target. Opening selects the current page number. Enter confirms valid input; Escape cancels.
Navigation preserves Selection. The Selection bar and its hints retain their selection role.

Routine hints, empty states, and tour steps describe controls and results without assuming a mouse or keyboard. Keep
input-specific instructions in Help's Keyboard and Mouse sections.

Grid and Page use the remaining viewport height after the header, workspace controls, page fields, and status bar. Grid
scrolls vertically inside its fixed frame. The scrollbar occupies the pane's right gutter and does not reduce card
width. List uses the same thin native scrollbar and gutter policy. Grid never clips pages into fixed batches and has no
pager.

Keep the full card geometry at every scroll position. On short screens, the document scrolls when the minimum usable
frame does not fit. Page reserves a usable image area below its heading. Its header and footer each retain one complete
control row, including with enlarged text. In two-pane layout, Style groups scroll below their profile selector. The
selector retains full pane width. Single-pane Style fields use document scrolling.

The workspace status bar follows content in document order. It stays at the viewport bottom when the workspace fits. If
document scrolling is required, the status bar scrolls with the document. It must not cover Grid cards, Page controls,
or Style fields.

Two-pane Grid and Page frames align at the top and bottom. The pane divider reaches the same edge. Shorter PDF pages
center within the shared image area. Application zoom changes the PDF inside that frame. The application does not
subtract browser controls from the viewport a second time.

Retain native measurements and calibration evidence in [MEMO](MEMO.md#retained-evidence) and the viewport inventory.
Current Grid validation measures card geometry, scroll access, and bounded mounted rows without requiring a fixed number
of cards per frame.

Mobile has a persistent one-tap Input/Output switch and preserves pane state. Headings retain the chooser or totals
beside Open PDF or the Print and Download actions on one row, including with enlarged text. Labels stay complete. Long
filenames truncate, with their full text available through hover and the chooser. Remove Input remains available in the
chooser at every width. Tabs and shared page fields remain usable in Page. Grid scrolls the complete page sequence
inside the pane frame. Input and Output do not use fixed thumbnail counts.

## Page fields

Selection fields and Style profiles span the pane width. Profile selectors use the same continuous field frame and
divided 44 px leading track as the page fields. The first selector's options button occupies that track; all select
edges align. Options use the disabled treatment when the Web SPEC reports no compatible peer operation. The selected
profile's description and its adjacent information button share one row below the selector. General guidance belongs in
the options menu and selector help. Authored set details remain independently reachable. Both page fields have the
accessible name Page selection. The field, action-menu button, and all inline actions stay on one row, including with
enlarged text and active selections. Action menus occupy the first position and open below the field's start edge. Menus
share padding, corners, and viewport bounds. Peer menu actions fill the same width, share row heights, and use the
standard control gap between rows. Output shows movement buttons in the field bar when the pane fits seven 44 px
controls and a ten-character field. Narrower panes put movement before Blank insertion in the menu. This rule uses pane
width and font metrics, including tablet and desktop layouts. Removal and duplication stay in the field bar. Individual
page controls use transparent surfaces. Input + and Output duplicate + use the same primary treatment through the
field's outer edge. Active Output removal uses a red surface and white minus. Invalid targets use the disabled
treatment. The + remains legible while disabled. Empty fields show an `Example:` placeholder.

Hints align below the field. Selection counts use accent emphasis. Errors replace the hint with danger text at the same
small size. Hints reserve space and wrap naturally, so errors, bold counts, and drag guidance do not move fitted page
images. Input and Output use the same control dimensions. Preserve usable field width and full-size touch targets.

## List

Contents uses an open-book icon distinct from List, fixed at the far right of Input's Pages and Page toolbar. The Pages
switch sits beside the tabs. Its tree uses indentation, fine branch lines, quiet page positions, and a thin
current-section marker. Nodes have no individual boxes or filled cards. Full titles wrap, and navigation preserves
selection. Output has no Contents control.

Contents keeps a compact fixed heading with one Unfold all / Fold all control. Its width is 32 rem, clamped to the Input
toolbar's usable width and viewport, and stays fixed across expansion changes. Height follows the visible tree; only its
inset tree area scrolls when required. Leaf rows use a 28 px minimum and parents 32 px, including touch. Long titles
increase row height. Touch retains a wider disclosure column except on phones, where the column and nested indentation
shrink. Contents, the separator, root disclosure glyphs, page positions, and the close glyph share equal 20–24 px side
insets. The scrollbar occupies the outer inset without moving the content edges. Disclosure glyphs align with the first
text line and the Contents heading edge in both states. Use TOC titles appears below the tree only when it changes a
page's display title. When enlarged text leaves insufficient header width, move the complete Unfold all / Fold all
control below the title and close button.

List shows the section tree as flat rows, with every ancestor header before its descendants and no depth indentation.
Nested headers use progressively stronger secondary surface tints through three nested levels. Depth changes do not move
the shared columns or change text size. Each TOC entry has a header, whether or not it has children. A header and its
page rows may display the same title; both use the established small-caps typography. Page display-title preferences do
not hide or rename section headers. Lists without a TOC contain only page rows. Section rows use the page rows' columns:
a combined ribbon disclosure and drag control, the starting position, an optional Input PDF page label, the heading,
and + and View actions. The starting position is the physical page number in Input and the occurrence number in Output.
Heading text uses the same size and small caps as page names, with the same starting edge. Folded sections use normal
text color for current titles and starting page numbers; only the section directly unfolded by the user
outlines its entire row in secondary (primary if selected, neutral if keyboard-focused). Newly exposed nested
rows have no section outline until opened themselves. Ribbons use secondary when folded and a
lighter neutral gray when unfolded, including on hover. The secondary ribbon hover glow does not recolor an unfolded
ribbon. Folding does not change the depth tint. Text and disclosure glyphs share the row's vertical center. The ribbon
has a long rectangular body with a shallow rear notch and front point. It points right to expand a closed section or
down to collapse an open section. Its interaction target is at least 44 px tall and uses the grip column's width: 32 px
for fine pointers, 44 px for touch. It uses a transparent background without a border, rounded corners, or shadow. It
fills the section row's height. Section rows retain the page rows' thin bottom separator. The List reserves native
scrollbar space outside the row width, so rows align with the selection bar and folding does not move columns. Header,
footer, and toolbar separators extend by half the workspace gutter equally on both sides in Grid, List, and Page. The
toolbar uses overlapping pages with a minus or plus to fold or unfold all sections. A separate Section headings toggle
follows it and stays in place when the expand/collapse control disappears. Section headings are shown by default. Hiding
them produces uninterrupted page rows and hides the fold/unfold toolbar control.

On narrow screens, toolbar icons have no gap between their 44 px targets. The Grid glyph is centered within its 44 px
tab; Go to page sits 4 px inside the trailing toolbar edge. Wider layouts retain normal spacing.

The heading button toggles selection, including with Enter or Space. A fully selected closed section uses the primary
background. A fully selected open section retains its primary selection tint, with readable heading text. Its members
retain their selected page appearance. Clicking the ribbon, or pressing Enter or Space, toggles folding. Moving the
pressed ribbon starts dragging and replaces it with an unrotated grip until the drop or cancellation. A stationary hold
keeps the ribbon. Dropping or cancelling does not toggle expansion. A drag selects the group and shows a page stack.
The + action appears on hover or keyboard focus and stays visible with a touch pointer. Mouse focus alone does not keep
it visible. An always-visible Unselect tick replaces + when all members are selected. View remains visible and shares
the page rows' trailing column.

All List action groups align to the end of their shared column. Extra hierarchy controls must not move the page rows'
View glyphs away from the section rows' View glyphs.

Section headings show the current title before its parents in reverse hierarchy order, on one line with ellipsis when
needed. Parents use the same small caps, size, and weight as the current title, with muted color. Separators use a
larger, bold neutral `‹` with equal space on both sides. Parent text uses free space before the trailing actions.
Selected closed sections keep all heading text readable against the primary surface.

A return-arrow navigation icon opens Jump to section independently of selection on headers and pages with TOC paths. For
root headers with no ancestor target, it remains present but disabled. Page-row navigation remains enabled. For fine
pointers, it appears on hover, keyboard focus, or while its panel is open; touch keeps it visible. Its compact panel has
16 px padding, a short heading row with a 44 px Close target, and a numbered vertical trail from root to current
section. Each trail entry is a navigation button with an inset level marker, a physical-page column, and a visible
keyboard focus outline. Level markers, physical page numbers, and title blocks share their vertical center, including
wrapped titles. Trail text wraps; the current level uses the primary color. Activating an entry closes the panel and
focuses its header in the same pane. Jump targets briefly fade in and out with a 3000 ms secondary highlight. Grid and
Page use a translucent overlay across the complete target, without dimming content or adding a contour. Reduced motion
disables this animation. Escape and outside click dismiss the panel.

The Contents toolbar icon uses the primary color while its panel is open. Selecting an entry reveals its exact physical
page in Grid, List, or Page, including Grid pages outside the visible scroll window.

Grid headers show only physical page numbers. Page Label and Output mappings appear in a two-column detail table. Normal
Grid detail columns shrink within the viewport even when breadcrumb titles are long.

TOC-derived Input detail headings retain breadcrumbs with full-title popovers. Output details retain flat headings. The
detail table pairs each field with its value. The Output field shows copy mappings such as `2× → 2, 9`, without repeated
leaf titles or inferred-range explanations. Page labels remain available in details even without an outline or Output
copies.

The section used as the display title remains the bold detail heading. Other paths follow below its separator in
regular-weight, muted text, so the distinction survives without color.

Multiple-source Output List rows show an 8 px source-color dot centered exactly between the number and grip. The same
dot identifies Input's current file and chooser entries. Dots have no contour, retain their colors during selection, use
distinct light/dark colors, and expose accessible source names. No visible source number, colored row background, or
colored page-name text is added. In the single-pane layout, Input carries the active accent and the current filename
uses normal text color.

Page rows start with the drag grip, then the physical number. Section rows place the combined ribbon control in the grip
column and the starting position in the number column. Fine pointers use a 32 px base grip column and a 28 px number
column; touch keeps 44 px targets. Ribbons use a proportionate 1.5em square SVG with a 6 px leading inset. The grip
column reserves an extra 0.25em from the title column to retain the surrounding gaps. Input List places PDF page labels
immediately before the page name in a muted, centered 4ch column with 0.125em side padding. This column exists only when
the PDF defines labels, and its width stays fixed across scrolling and folding. Long labels truncate with ellipsis and
retain their full text in accessible text and the hover title. Labels identical to physical page numbers remain hidden
in every view and detail. Normal Input Grid places differing labels at the bottom start of the card. Output Grid keeps
its footer for page actions; PDF labels remain available in page details. Selected labels inherit the row color. Section
headings keep their text in the page-name column and show the starting page's label only when it differs from the
physical number.

List rows align page numbers, supplied names, and page actions in stable columns. Keep number and action columns visible
in narrow panes. Plain numbers and detail buttons use the same type size and column center. Names wrap in the remaining
space without horizontal scrolling. Narrow rows truncate names on one line with an ellipsis; the full name remains in
the control's accessible text and page preview. The hover title explains selection. The selection tick reserves only one
action target when the row uses a compact action menu. Unnamed pages reserve no empty name line. Repeated names retain
separate numbered rows. Selected rows use the primary surface and its contrasting text color, without a selection
contour. Numbers, names, and ticks keep this contrast on hover and keyboard focus. Unselected row text and actions use
an 80% mix of the text color over the page background. A tick replaces the row's Add or Duplicate action without moving
its position. Keyboard focus remains visible independently of selection. Output groups its up/down controls and
removal/duplication into two contiguous pairs, with 6 px between the pairs and no divider. On a fine pointer, Input Add
and the Output pairs appear on row hover or focus. Hover changes the icon color without boxes or glow. Eye and the
selection tick remain visible. Row actions use 32 px targets with a fine pointer and 44 px targets for touch, in both
themes. Coarse pointers keep Input Add visible. Output uses a row-menu button for coarse pointers and narrow panes. Page
details use a compact, start-aligned popover beside the number, including in narrow panes. List uses its own tab beside
Grid. Switching views retains the toolbar height and content-frame position.

Each row has a grip beside its number and a View icon at the trailing edge. View hover or keyboard focus shows a large
full-page preview beside the row. Keep the preview within the viewport and preserve the page's aspect ratio. It does not
receive pointer input. Its caption appears only for a supplied page name. Narrow Output rows group their operations in a
separate action menu. Number details show the supplied name and provenance. Output rows show one Output position; source
page numbers and differing PDF labels belong in details.

List numbers do not repeat the visible name in a hover tooltip. The name's hover text explains selection. Grid and Page
name tooltips wait 220 ms on pointer hover. Keyboard focus shows them immediately. Parameter information uses the same
hover delay. Leaving, scrolling, or Escape cancels a pending opening.

Keyboard focus draws one neutral high-contrast contour around the complete row, including its number, name, and trailing
controls. Individual row controls do not draw additional contours. Focus remains distinct from the primary selection
surface. List additions slide in briefly; removed rows collapse and fade; surviving rows move into place. After its 240
ms movement, a moved Output row shows a secondary tint and fine inner contour that fade for 1200 ms. Grid uses the same
arrival cue after its movement. Use a lighter, vertical movement than Grid and respect reduced motion. The insertion
marker lies across the row's top or bottom edge.

## Grid and Page

Grid renders page cards in continuous rows inside its fixed viewport. Input uses an HTML list, and Output uses an
ordered list. Long documents mount a bounded row window and spacer rows. The scrollbar stays in the pane gutter. Wheel,
touch, and keyboard navigation reach the full sequence. Responsive columns preserve the first visible page. Changing
Pages layout restores the previous Grid or List scroll position.

When sections are shown for a PDF with a TOC, Grid shares each pane's fold/unfold choices with List. Its single vertical
ribbon replaces the center grip on each visible heading-page card. The ribbon has a straight top edge and a notched
bottom, with no visible title text. The card continues to show the original starting page image, and its footer uses the
neutral footer controls. An unfolded Grid card has a subtle secondary tint across the card and thumbnail surround;
selected cards retain their primary tint. An unfolded, unselected section card has a 2 px secondary contour; selected
cards keep the primary contour. Unfolded ribbons use neutral gray in both themes, including on hover, while the hover
glow remains secondary. The ribbon extends to the card's top edge. The ribbon's accessible name includes the section
path. Folding keeps the starting page visible and hides its following pages through the section end. A parent fold
retains its children's choices. Multiple TOC headings on one physical page share a single card and an outermost-heading
ribbon; use List for the remaining same-page disclosures. Grid page images still select and drag individual pages.
Active transfers temporarily show every page to preserve physical insertion targets, then restore the retained folds.
Newly visible cards pulse once with a 1400 ms secondary glow; List rows use a contour-free
background and opacity pulse of the same duration. Folding slides departing visible cards and rows toward their nearest
surviving section heading for 900 ms, shrinking and fading as they arrive. After the items disappear and the fold
completes, the corresponding heading pulses once for 800 ms without changing its contour. Nested sections target their
surviving parent heading. Virtual scrolling never restarts an unfold pulse; reduced-motion preferences disable the
fold transition and heading pulse. The Fold all/Unfold all and Section headings toolbar controls are available in both
Grid and List. Hiding headings restores the full flat page Grid.

Grid footer actions appear on hover or focus with a fine pointer. Input's Add action stays visible on touch. Output
touch actions use the existing menu. The card footer design is separate from the Pages layout. Do not change its content
or targets while changing scroll behavior.

A page name appears in a one-line tooltip when a Grid or Page number receives hover or keyboard focus. Long names
truncate inside the viewport. Clicking the number opens details beneath it. The page name appears first when present.
List shows names inline. Page retains its own controls and navigation.

Grid back pages use a 12 px folded corner; Page keeps a 24 px fold. The fold follows the selected contour without
covering page controls. Front pages retain their ordinary corners. Page faces remain identifiable through their labels.

Review thumbnail sampling at the actual rendered image size. Fine guides remain visible on guide-only pages. Compare
text, raster, and authored colors with saved appearance. Sampling must not change the card geometry or aspect ratio.

### Card proportions and spacing

Keep the existing readable Normal geometry, without a second density. The common reference is a 148 × 240 CSS px card at
ordinary text size. Other calibrated sizes retain their current preferred dimensions and minimum readability. Do not
shrink or stretch cards to fit an extra row. Additional pages scroll instead.

The full card includes its header, thumbnail, and footer. For a portrait reference, the accepted height-to-width range
is `sqrt(2)` through `280 / 150`, about 1.41–1.87. Controls can make the card taller than paper. PDF content retains its
own aspect ratio, including landscape and square pages. Keep the portrait image at least 128 CSS px high at normal text
size, except where enlarged controls require the document to scroll.

Grid's card width is at least 136 CSS px to fit three 44 px header cells and their separation. The number occupies the
first cell, and the grip stays on the centerline. The face indicator stays at the upper-right edge. Selected cards keep
their dimensions; expanded touch targets must not overlap. Four- and five-digit numbers use tabular digits and must not
move the grip.

Image margins are measured between the page and its thumbnail area. Exclude card borders and padding inside the PDF. Top
and bottom margins match. Side margins match and can be moderately wider. Keep at least 85% of the vertical image
padding as a gap between cards. Minimum gaps are 9 px across columns and 10.5 px between rows. Fine-pointer hover
requires at least 12 px where cards can lift. The Grid viewport reserves 12 px above the first row for the
hover lift and shadow without clipping; scroll-into-view respects the same top clearance. Extra pane width is distributed between columns and outer edges without
stretching the cards.

A partial final row preserves the same card widths, positions, and gaps. Grid computes the visible window from measured
columns and row strides. Card count changes the scroll height, not card geometry. The stable scrollbar gutter must not
reduce the thumbnail's measured width. The Grid's internal layout remains independent of Page's reference fitting.

### Page alignment and controls

Page headings and navigation stay outside the image viewport. The frame provides the alignment reference for both rows.
Counter and Page Label share the start edge; zoom reset uses the end edge. Keep visible control content at least 8 CSS
px inside the folded corner's inner edge. Center the complete action group on the frame's true centerline.

Page headers and footers occupy one row. Never wrap controls, counters, or text into another row. If controls do not
fit, put excess Page actions in the existing page-actions menu. Targets remain at least 44 CSS px high and stay within
the frame. Short labels can truncate with their full accessible name retained. Selection hides individual actions
without shifting the image or its controls.

On desktop, keep native scrollbars when the enlarged Page image overflows. Center the image in the remaining area and
reserve scrollbar space before fitting. Touch Page hides its grip when the primary pointer is coarse and has no hover.
Page selection remains available through its selection bar. Touch Page has a minimum image gutter of 2 rem on all four
sides, independent of PDF size. Wider manual zoom levels can require horizontal scrolling.

Compare and Show original precede zoom controls when they fit. Wide panes show the percentage, minus, plus, and zoom
reset. Narrow panes show minus, plus, and one reset/width-fit button. The counter and tools stay on one row. Missing
space moves reset/width-fit into the page-actions menu. At 100%, zoom reset fits to width.

Where the minimum frame fits the screen, Page navigation stays above status. Short screens use document scrolling rather
than shrinking the minimum usable image frame.

### Lens

The square lens fits within the viewport with 12 px margins, including its border and optional name caption. The caption
occupies one line and truncates long names. The lens overlays the image without receiving input. Touch holds place the
lens above or below the finger. Grip dragging responds directly to finger movement. Grid images suppress native
selection and touch callouts while preserving ordinary scrolling.

PDF content, Blank, and Padding keep physical proportions and the same fit rules. Neutral image frames distinguish white
page edges in light mode. Resizing and Pages layout changes keep completed pixels visible until replacement renders
finish. Selection does not clear or repaint unchanged images. Initial previews show a small centered loading ring with
an accessible busy state. Rendering does not stretch unfinished canvases.

## Style presentation

Style labels and widgets share a row on wide panes and stack on narrow panes. Native group disclosures follow authored
order. Group names use small uppercase text. Open groups use the accent color; closed groups use the normal text color.
Their type size, weight, and spacing remain unchanged when toggled. Group names use the shared hover color without
moving text. Group disclosure outlines follow the input method: keyboard activation shows focus, and pointer activation
clears it. Their targets are at least 44 px high. The object count and disclosure arrow sit at the inline end, including
while collapsed. Group titles, object titles, and widget blocks share the same inline start without indentation,
including with enlarged text and on narrow panes. Their right edges remain at the group's content edge. Quartet
components share the remaining width equally. A first individual control adds no extra top padding below the group
heading. Editors inside a Quartet retain their component alignment. Descriptions use muted text, wrap naturally, and
explain meaning rather than repeat a label. Parameter IDs belong in information panels, not main field labels. Baseline,
override, mixed, and unrepresentable states remain distinguishable.

Narrow Style color and width controls place their value above the adjustment buttons, including with enlarged text.
Opacity value fields have a fixed width and a visible percent suffix. Sliders use the remaining width. Decimal precision
does not change the field width or move adjacent controls.

Profile selects appear above groups with the page field's height, borders, and corners. Their selected descriptions sit
directly below. The first select aligns with Output's page field. A neutral divider separates profiles from individual
controls. Style selects retain native selection behavior, use the shared inset chevron, and keep their full touch height
on touch browsers.

Authored-guidance buttons sit beside their group's or Quartet's heading, or their profile's description. Their visible
icons align with the first text line. Set guidance occupies the selector's trailing track and shares its vertical
center. All guidance buttons retain a 44 px touch target. Missing, empty, or whitespace-only details create no guidance
icon or reserved space. Shared guidance uses a floating panel anchored to the button, with its owner's name above the
longer text. If no anchored position fits, it centers within the viewport. The panel wraps text, scrolls within the
viewport, and uses the shared surface, border, focus, and theme tokens. Opening it does not move the workspace or
individual controls.

A Quartet presents Fill, Stroke, Width, and Visibility in equal components. Fill and Stroke summaries combine
independent color and opacity rows. Color swatches show full color independently of opacity. A separate level marker
shows exact opacity. Width belongs visually to Stroke. Values use neutral ink, including overrides. Labels and type
icons stay together. Color codes and short value captions stay on one line.

The Quartet's own width controls its layout. Wide Quartets show a strip. Narrow Quartets use two equal columns, then one
column with enlarged text. Color fields receive no extra width. On desktop with a fine pointer, an editor floats above
the workspace without moving the summaries. It anchors to its trigger, flips or centers when necessary, and scrolls
within the viewport. Its heading includes Close. Paint duo controls stack within this panel. Narrow or touch layouts
retain an inline editor after the selected component's row. Paint duo color and opacity share one frame and retain
separate resets. Native disclosures and controls retain keyboard access.

Unavailable parameters use a muted hatch and prohibition icon while retaining their component's space. N/A appears only
in hover help with an accessible explanation. Missing Visibility uses this treatment and preserves original display
states. Mixed or unrepresentable baselines remain editable. Available Visibility can be indeterminate. A Show/Hide
checkbox controls Quartet Visibility. Individual display fields use equal Show/Hide segments with native radio
navigation. The selected segment has clear emphasis. Neither segment is selected for an unassigned original value.

Hover emphasizes the relevant component or information marker without adding another border or moving values. Open
editors retain an accent frame. Invalid drafts use danger text. Short labels retain full authored accessible names. The
active Style tab row holds the danger-colored reset icon. Processing feedback uses the header.

## Drag and drop

Visible grips and field hints identify drag sources. The pointer carries a proportionate image of the visible page, with
slight tilt only under motion. Two pages show two sheets. Larger groups show three. Blank and Padding use plain bordered
sheets. Input cards fade while Output gains an accent outline. Guidance distinguishes adding from moving and announces
the exact destination. Touch Grid outlines only the card area, excluding pane headers, tabs, and Selection. The drag
image follows the finger directly while neighboring cards ease into their prospective positions. Pressing a mouse drag
source or touch grip immediately fades its card and applies the drag tilt and scale, before the movement threshold.
Touch grips also receive an accent highlight. Pressing alone does not change selection. Release or cancellation clears
the press feedback. Reduced motion keeps the fade and highlight without tilt or scaling.

List drags use a flat horizontal strip at the row's height, with its number and name aligned to the row's columns. The
strip appears on press and stays attached to the original grab point while moving. Do not tilt or scale it. Multiple
pages add a count. Do not put a page raster in this strip. The insertion slot holds one faint strip in the same columns
and text size. Keep the moving strip opaque and the insertion slot stationary while neighboring rows move over 180 ms.
Logical row bounds select targets independently of their animated positions. A pointer inside the open slot retains its
destination. On drop, reveal the moved row at its destination instead of animating it from its hidden source position.
Grid drag images and other moving page images use sharp rasters at device density, with a minimum density of two. Grid
images stay attached to the pointer at their heading instead of above the card.

During Grid and List transfers, the moving image, placeholder, and neighboring pages show prospective Output numbers.
Output moves hide the original card or row and close its old slot. Input copying retains its source. Grid folds use the
same number as their card. Number changes update text and frame decoration without rendering the PDF again.

During a narrow touch transfer, Output's workspace button gains a dashed accent border that becomes solid under the
finger. Input's forbidden-drop marker appears only after a pause away from the valid target. Movement toward Output
postpones the marker. The pane changes after a successful drop.

Grid opens a stable card-sized slot and shifts neighboring cards into prospective positions over 450 ms for mouse and
touch. Target updates and drops remain immediate. The slot holds a faint copy without contour or shadow. Output Page
shows that copy beside the image on the insertion side. Reduced motion keeps sheets straight and changes positions
immediately. Feedback disappears on drop, cancellation, or leaving Output. It never changes document order before drop.
Enlarged Page uses grab/grabbing cursors for mouse panning. The landing drop target keeps its layout and does not
flicker on nested drag events.

## Onboarding and product tour

Help uses a native modal dialog with contextual topic tabs. App remains available. A workspace adds input-specific
Keyboard, Mouse, or Touch topics. Start Tour appears beside them only with a workspace and wraps below when space is
limited. The topic row scrolls horizontally when its tabs do not fit. Available panels determine its size without
stretching short content to the viewport height. Switching topics does not resize the dialog. Each panel scrolls
independently, while its heading and navigation stay visible. At normal text size, topics fit desktop viewports from
1440 × 900 without scrolling. Desktop width is capped at 64rem and touch layouts at 52rem. The dialog leaves at least
one control gap at viewport edges. Padding uses one gap, with two gaps at the bottom for breathing room. Inactive panels
retain measurement space without receiving focus.

Input and Output shortcut sections align their headings and tables. Selection Field has its own Enter row. Workspace
keys and routing notes sit below. A secondary-colored reminder explains that shortcuts follow the current pane views.
Narrow screens stack panes and notes. Keycaps use consistent neutral surfaces, borders, and text size. Named keys have
enough width for their full labels. Topic selection supplies the panel title without a duplicate heading.

The welcome is a short native dialog. The product tour is a nonmodal popover with a compact card near the lower-right
corner. Narrow screens use the available width above the bottom edge. Long content scrolls inside the card while heading
and controls remain visible. End tour keeps a full touch target. Compact progress shows the step count without crowding
this action.

One soft spotlight follows the target's visible bounds with clear surrounding space. Tab steps include their tab and
content in the same light area. The remaining interface dims without blurring it. The tour card stays clear. Scrolling
and resizing keep the light aligned. Reduced motion skips backdrop fades. Text describes purpose and actions briefly.
Detailed shortcut tables stay in Help.

The first-addition hint brightens a visible Input thumbnail, waits 2600 ms, then sends a fading visual copy toward empty
Output over 4200 ms. The copy begins moving before the fixed light fully fades. On mobile it moves toward the Output
switch and stays within the viewport. Its instruction uses the header notification area. Reduced motion retains only the
instruction. [SPEC.md](SPEC.md#help-and-onboarding) owns hint eligibility, dismissal, and tour state restoration.

App installation guidance uses a separate native dialog. Use browser has primary emphasis. The optional native
installation action has secondary emphasis. The title and visible close icon share a vertical centerline. Narrow layouts
and enlarged text retain scrolling within the dialog. Installation guidance does not change workspace geometry or Grid
capacity. [SPEC.md](SPEC.md#help-and-onboarding) owns startup eligibility, dismissal, and access through Help → App.

Landing PDF and Recipe actions share one row with equal widths. On phones, they fill the available content width, with
inline frame padding capped at 2.5% of the container width. Enlarged text can stack them when space is insufficient.
Inline padding grows on wide screens. File details use a table with end-aligned field names, start-aligned values, and a
gap instead of colons.

The landing product name retains a readable minimum independently of the purpose heading. Enlarged text scales the name
and permits wrapping. The persistent drop hint appears only with fine-pointer and hover capability. Actual file dragging
still reveals the drop overlay on other inputs. The file chooser remains the primary opening action. Keyboard focus
highlights the landing frame. A touch press keeps its feedback on the chooser without tinting the frame.

## Feedback presentation

| Message | Placement                                               | Treatment                                                                                              |
| ------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| Info    | Header during work; bottom status row after completion. | Bold black/light or white/dark text, accent busy ring, and Cancel during work; small `--info` results. |
| Notice  | Center of the app header.                               | Borderless black/light or white/dark text at weight 700, with relevant actions.                        |
| Error   | Header; optional local cues identify the affected item. | Danger color, a short explanation, and recovery actions.                                               |

Header feedback uses one shared presentation for opening, Style processing, offline installation, Notices, and general
Errors. Center the complete message and action group on the header's inline centerline. Messages and results use no
decorative information, warning, error, or success icons. Align the busy ring's visible block center with progress text.
Keep Cancel beside progress with a full interaction target. Wide header actions remain available. Feedback has no
enclosing border, shadow, or button surface. Messages use black text in light mode and white text in dark mode, at
weight 700. Busy rings use the accent. Errors use the danger color. Header summaries, action labels, and state labels
have no final period. Full explanations retain sentence punctuation. Ongoing progress uses an ellipsis.

Wide headers use balanced side columns for the logo and actions, with feedback in the middle. The privacy indicator
gives its space to active feedback. Feedback keeps its natural content width so that actions stay beside the message.
Center the group vertically within the existing header. Feedback does not change the header height or workspace
position. Its container has a transparent background and stays above the header separator. Narrow headers show feedback
within the existing header area and temporarily hide the logo and header actions. Opening or dismissing feedback does
not move the workspace or document scroll. Open dialogs and popovers remain visible when their header launcher is
hidden. Each message and its actions use one row. Long messages scroll horizontally within their line, with the complete
text retained for assistive technology and hover. Recovery actions keep a clear gap. Feedback never introduces
horizontal overflow or overlaps header controls. Prefer a short sentence naming the issue or next action. The message
itself is the trigger: it opens available actions, shows its full explanation, or takes the user to the affected item.
Do not add a separate Details or ellipsis control. Explanations and action menus use a bounded panel below the header.
Cancellable progress retains a visible Cancel control. Show one message group at a time; errors precede notices after
the active operation. Active feedback remains visible during document scrolling and respects the safe area.

Message-panel action buttons use the shared action width and height, matching ordinary screen controls such as Cancel
and Change PDF. Do not stretch them across the panel. Center the action group below the explanation with one standard
gap. Put two actions side by side when they fit; otherwise stack whole buttons. Use short, single-line labels. Place a
concise explanation beside the Close control above the actions; do not reserve an empty heading row.

The footer owns workspace status and completed operation reports. The header owns notifications, warnings, and error
messages, including failures inside dialogs. Modal feedback stays visible and operable above its backdrop. An invalid
field can retain its border and accessible error description. An affected item can retain an outline or a short
explanation in reserved space. These local cues must not move nearby controls, resize rows, or change scroll position.
They identify the source; the header provides the general message and recovery action.

New Download or Print preparation uses a compact native modal centered at the header. It shares the busy ring, message,
and actions above. Progress needs one row without a separate title or Close button. Errors retain readable text, Cancel,
and Retry. The modal backdrop distinguishes its locked workspace from ordinary header feedback. View preparation uses
ordinary header feedback and opens the PDF only when preparation succeeds. Compact Output dialogs use named icons for
Cancel and Retry when text leaves insufficient room. Home Screen Safari can show its reserved viewer before the
completed PDF loads.

Direct PDF printing opens the browser's print UI without an application PDF viewer or another panel behind it.
Preparation and return preserve pane geometry, selections, view, zoom, and document scroll. Focus remains on Print.
Browsers that need an explicit PDF handoff use a compact panel with Open PDF to print and Download PDF.

The status row reserves its height below the workspace. The landing keeps it at the viewport bottom during scrolling.
The workspace uses the document-flow rule above so that its last controls remain reachable. Completed operation feedback
and update controls share a centered column. Larger workspace views show the active filename at the start and Build ID
at the end. Narrow mobile workspace views retain feedback and offline actions only. The landing places Build ID at the
bottom center. It can wrap between groups with enlarged text. Long filenames truncate with full hover text. The landing
keeps one standard gap between Update app and Build ID.

New footer status briefly highlights the message with a light accent tint and a soft glow just around the text, then
fades to its ordinary treatment. Repeated operations restart the feedback. Reduced motion skips this effect, which does
not change geometry.

All page additions use a 600 ms preview along a shallow curve, including copies, repetition, and Blank insertion. A
group uses a small page stack. Input additions use the Output workspace button on single-pane layouts. Otherwise, the
preview moves toward a new Output image in the visible Grid window, or the Output heading when no new image is displayed
or Output is in Page. Single-pane layouts use the Output button when no new image is displayed. Preview centers follow
the visible source image and target on both axes. Grid arrivals match the target image size across pane densities. A
Blank uses a blank preview.

Additions use the targeted page's rendered image and start at that image. Output copying uses the same occurrence
identity for buttons, menus, and keyboard shortcuts. A group uses its first target in print order. If that image is
unavailable, use the action area as the origin; do not substitute another page's image. This also applies when Page
shows a different page from the prepared Input sequence or Output selection. Removal and movement retain each affected
occurrence's own image and position.

When the preview targets the Output workspace button, that button gains a soft accent glow over the same 600 ms. The
glow rises and fades during the flight. Arrival or cancellation clears it without changing the button's geometry.

The preview uses a rendered page when available. It does not delay the edit or change selection, scrolling, or the
active view. New Output cards reserve their space but stay hidden and inert until arrival. Keyboard duplication keeps
focus in Grid, then focuses the copy on arrival unless the user navigates elsewhere. If Page displays a new occurrence,
it also waits for arrival. Cancellation reveals the completed edit. Repeated additions replace the previous preview.

Removal shrinks and fades each visible outgoing card over 300 ms. Cards keep their places until the exit completes and
cannot receive input. Page retains a snapshot of the removed image during the exit, then shows its replacement. Removing
an Input uses the same exit for its visible page images. Document edits and totals update immediately. After a Grid exit
completes, the remaining cards slide into their new positions over 350 ms.

A new edit or transfer finishes earlier Grid removals before choosing its page targets.

Moves slide existing cards and their neighbors to their new positions over 500 ms. A position change in Page gives the
image a short movement in that direction. The inspected occurrence, Selection, and focus follow their existing rules.
These animations use the same paths for buttons, menus, keyboard shortcuts, and gestures.

Drag and drop retains its own preview during movement. Reduced motion shows all edits immediately, without these
effects.

Notice text keeps full contrast until dismissal. Reduced motion keeps busy rings static. Errors retain their explanation
and do not repeat details in the footer. Loading, empty, error, and cancellation states identify the next action.

Batch opening announces one short failure count after processing. The count itself opens its explanations and actions.
Keep the message on one row, including on narrow screens and with enlarged text. All controls retain at least 44 px
targets.

The message opens a separate popover with each filename and diagnostic outside the live alert and header bounds. The
list has a bounded height and supports keyboard scrolling.

## Validation

The [browser suites](../test/) own automated visual and interaction assertions. [AGENTS.md](../../AGENTS.md#web) owns
execution commands. Layout changes exercise both themes, keyboard focus, normal and 200% text, and widths of 320, 390,
and 768 px. The [feedback tests](../test/feedback.test.js) also cover header layout boundaries, long filenames, modal
cancellation and recovery, and matching desktop landing/workspace edges. Desktop changes exercise scroll geometry, mixed
page sizes, Pages layouts, and Grid/Page alignment. Relevant cases include empty and selected states, long filenames,
five-digit page numbers, loading, errors, cancellation, and reduced motion. No layout introduces horizontal overflow or
conceals an action behind a fold, toolbar, or fixed status row. Touch emulation covers taps and scrolling.
Physical-device drag behavior and assistive technology require separate evidence.

Physical iOS acceptance includes a fresh Home Screen installation, the icon on light and dark wallpaper, and paired
heading alignment in Chrome landscape tabbed mode. Record the OS/browser versions, presentation mode, actual CSS
viewport, revision, and screenshots. Check sustained lens movement with a representative complex PDF, including touch
holds and crop edges. Keep measured frame, memory, and installation costs separate from automated correctness results.
These cases remain open until their physical evidence exists.

Animation assertions wait for the rendered effect to start before checking its duration or geometry. Updated document
totals do not prove that a transition has started. Full mode runs edit feedback checks with CPU throttling and
identifies the viewport and Pages layout in its diagnostics. Do not use fixed sleeps or automatic retries to hide timing
failures.

Alignment is an acceptance gate for every layout change. Exercise each affected width range, including both sides of its
responsive boundaries. Check both panes in Grid, List, and Page, with both themes, normal and 200% text, selected and
unselected cards, and one- through five-digit numbers. Measure visible icon bounds against their references on both
axes. Center offsets must remain below 1 CSS px. Interaction targets must remain separate and usable. Compare Grid with
Page's thumbnail reference. Verify scroll reachability, card dimensions, and incomplete final rows. Screenshots confirm
surrounding visual groups. Passing column counts and overflow checks alone does not pass this gate.

For action buttons, measure the rendered label as well as the control. At normal and 200% text, each label must occupy
one line and fit inside its button. Check peer dimensions, centers, and gaps after shortening labels or changing their
layout. A no-wrap declaration alone does not prove that a label fits.

Check responsive boundaries in both viewport dimensions and each applicable orientation. Include fine and coarse primary
pointers. Verify that only matching calibration entries change card geometry. Measure portrait proportions, image
margins, distributed column gaps, and row gaps against the [card rules](#card-proportions-and-spacing). Keep card
positions and widths stable across scroll windows and partial final rows. Test documents above 240 pages to verify
window bounds, keyboard navigation, and the final page. Compare Grid and Page alignment. The
[Grid tests](../test/grid.test.js) own scroll geometry; the [Page tests](../test/geometry.test.js) own fitted images.

Page zoom items share one centerline, with less than 1 CSS px of vertical deviation. Control targets stay inside their
heading and do not overlap. Card headers and footers each occupy one row, including counters and inline page entry.
Check these rules at Fit and other zoom levels, with both themes and normal/200% text. Landscape phone checks cover 667
× 375, 844 × 390, and 956 × 440 CSS px. The browser tests retain a screenshot under `.local/tmp/web/layout/` when a
matrix or Page-control assertion fails.

Touch Page checks include 320 × 568, 375 × 667, 390 × 844, 440 × 956, 810 × 1048, 1080 × 778, and iPad mini viewports.
Check both panes, short and tall PDF pages, and transitions into and out of two-pane layout. Assert that Page grips have
no visible or keyboard target in touch layouts. Measure symmetric frame gutters and vertical control centers with both
narrow and wide fitted images. For an overflowing image, measure its initial top gap and scroll to its bottom gap and
navigation. Check fine-pointer layouts separately. Rotate touch layouts across the pane breakpoint and preserve explicit
zoom choices, including Fit.

CI uploads layout failure screenshots as `layout-<group>` artifacts and retains them for seven days.

## UI glossary

This glossary gives English names and Turkish equivalents for the UI elements in PDF Composer. The tables group repeated
instances by element type. PDF-authored group and object labels vary with each document.

### Glossary topics

- [Naming conventions](#naming-conventions)
- [Application layout](#application-layout)
- [Views and tabs](#views-and-tabs)
- [Page selection](#page-selection)
- [Grid](#grid)
- [Page](#page)
- [Style](#style)
- [Shared controls](#shared-controls)
- [Dialogs and guidance](#dialogs-and-guidance)
- [Landing page](#landing-page)
- [Feedback and drag and drop](#feedback-and-drag-and-drop)
- [Interaction states](#interaction-states)
- [Conversation examples](#conversation-examples)
- [References](#references)

### Naming conventions

English terms serve as the technical names. Turkish equivalents support conversations about the same elements. Visible
labels such as Input, Output, Grid, List, Page, and Style retain their English names in both languages.

Prefixes identify an element's location or purpose. For example, Input selection bar names the selection bar in the
Input pane. These qualified names use standard component terms.

A header is an upper section. A heading is title text. A body is the central content section. A footer is a lower
section. These distinctions apply to panes, cards, viewers, and dialogs.

A page card is the complete UI component. A page thumbnail is the small page image inside it. A thumbnail frame is the
neutral area around that image. [Fluent 2](https://fluent2.microsoft.design/components/web/react/core/card/usage)
describes card anatomy. [Adobe Acrobat](https://helpx.adobe.com/acrobat/using/page-thumbnails-bookmarks-pdfs.html)
describes page thumbnails.

Quartet and Paint duo use the existing definitions in the [product glossary](SPEC.md#glossary). The tables below
identify their visible parts.

UI anatomy names describe visible elements and their purpose. A name alone does not establish an HTML element or an ARIA
role. For example, toolbar and menu can describe visual groups without corresponding `toolbar` or `menu` roles.

### Application layout

#### Header and workspace

| English term      | Turkish equivalent          | UI element                                                                                            |
| ----------------- | --------------------------- | ----------------------------------------------------------------------------------------------------- |
| App header        | Uygulama üst çubuğu         | The top section with the logo, privacy information, feedback, and header actions.                     |
| Logo / Home link  | Logo / Ana sayfa bağlantısı | The upper-left logo. One click opens Home, two replay its animation, and three or more open examples. |
| Header actions    | Üst çubuk işlemleri         | The Help, Settings, and theme buttons as a group.                                                     |
| Header feedback   | Üst çubuk bildirim alanı    | Centered notifications, active progress, cancellation, and recovery actions.                          |
| Privacy indicator | Gizlilik göstergesi         | The lock icon and “On your device” text.                                                              |
| Theme toggle      | Tema değiştirme düğmesi     | The sun/moon button that switches between light and dark themes.                                      |
| Examples dialog   | Örnekler penceresi          | The “Explore the app” dialog with demo, empty Output, and welcome choices.                            |
| Workspace         | Çalışma alanı               | The main area for work with Input and Output.                                                         |
| Input pane        | Input bölmesi               | The complete Input section, including its header, tabs, selection bar, and content.                   |
| Output pane       | Output bölmesi              | The complete Output section, including its header, tabs, selection bar, and content.                  |
| Pane divider      | Bölme ayırıcısı             | The fixed vertical line between Input and Output on desktop.                                          |

The pane divider is a separator. It has no resize interaction, so its name is not splitter.

#### Pane headers and status bar

| English term                    | Turkish equivalent                  | UI element                                                                                            |
| ------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Pane header                     | Bölme üst alanı                     | The section with the Input chooser and Open PDF, or the Output heading, summary, Print, and Download. |
| Pane heading                    | Bölme başlığı                       | The Input or Output title text.                                                                       |
| Input selector                  | Input seçicisi                      | The chooser that opens from the filename in the Input header.                                         |
| Input list                      | Input listesi                       | The open-PDF list with numbers, filenames, and a checkmark for the active Input.                      |
| Count badge                     | Sayı rozeti                         | A small bordered count, such as the Input count or a Style group's object count.                      |
| Remove Input button             | Input kaldırma düğmesi              | The action below the open-PDF list that removes the active Input.                                     |
| File picker button              | Dosya seçme düğmesi                 | Open PDF or Choose a PDF. It opens the system file picker.                                            |
| Output summary                  | Output özet bilgisi                 | Concise page and sheet counts, such as 6 pages, 3 sheets.                                             |
| Output details button / popover | Output ayrıntıları düğmesi / paneli | The control that exposes the counts when the concise Output summary does not fit inline.              |
| Download button                 | İndirme düğmesi                     | The primary action that downloads Output.                                                             |
| Share button                    | Paylaşım düğmesi                    | The primary mobile action that opens system sharing for the completed Output PDF.                     |
| Print button                    | Yazdır düğmesi                      | The icon action before Download that prepares Output for PDF printing.                                |
| Output filename button / panel  | Output dosya adı düğmesi / paneli   | The Output heading and its filename editor with Use default and Save.                                 |
| Status bar / App footer         | Durum çubuğu / Uygulama alt alanı   | The bottom row with the filename, status message, and Build ID.                                       |
| Build ID                        | Derleme kimliği                     | The build value in the status bar and Settings.                                                       |

### Views and tabs

Tab, tab list, and tab panel follow the [W3C tabs terminology](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

| English term                 | Turkish equivalent                   | UI element                                                                     |
| ---------------------------- | ------------------------------------ | ------------------------------------------------------------------------------ |
| View toolbar                 | Görünüm araç çubuğu                  | The row with Grid, List, Page, and eligible Style tabs and actions.            |
| Tab list                     | Sekme çubuğu                         | The Grid, List, Page, and Style tabs. Help groups Keyboard and Mouse.          |
| Tab                          | Sekme                                | One Grid, List, Page, Style, Keyboard, or Mouse choice.                        |
| Tab panel                    | Sekme içerik paneli                  | The content area associated with the active tab.                               |
| Active tab indicator         | Etkin sekme göstergesi               | The accent underline beneath the active tab.                                   |
| Grid and List tabs           | Grid ve Liste sekmeleri              | Direct tab buttons that select one of the two Pages layouts.                   |
| Export recipe button / panel | Recipe dışa aktarma düğmesi / paneli | The arrow-out-of-square icon and the panel for saving portable Recipe JSON.    |
| View switcher                | Görünüm değiştirici                  | The mobile Input/Output switch. Its buttons expose their pressed state.        |
| Modified indicator           | Değişiklik göstergesi                | The small dot on the Style tab that indicates overrides or drafts.             |
| Unavailable indicator        | Kullanılamazlık göstergesi           | The crossed-out brush and explanation for a visible but unavailable Style tab. |

Grid and List are part of the same tab list. The mobile view switcher uses buttons rather than tab roles.

| English term      | Turkish equivalent   | UI element                                                                              |
| ----------------- | -------------------- | --------------------------------------------------------------------------------------- |
| List view         | Liste görünümü       | The row view of Input pages or Output occurrences with page numbers and supplied names. |
| Page name caption | Sayfa adı açıklaması | The supplied page name below the Page image frame, or in a Grid header tooltip.         |
| Contents          | İçindekiler          | Input's embedded PDF outline navigation, opened with the open-book icon.                |
| Section headings  | Bölüm başlıkları     | The collapsible List section rows with block selection, addition or copying, and View.  |
| Section path      | Bölüm yolu           | A section breadcrumb; List headers put the current title before its muted ancestors.    |
| Jump to section   | Bölüme git           | The navigation button and numbered ancestor trail for a List header or page.            |
| Source marker     | Kaynak işareti       | A small color dot identifying an Input and its Output List occurrences.                 |

### Page selection

#### Selection bar and actions

The bar is the complete bordered row. The field is only the text-entry area within that row.

| English term               | Turkish equivalent              | UI element                                                                                               |
| -------------------------- | ------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Page selection bar         | Sayfa seçim çubuğu              | The complete row with the menu trigger, text field, and action buttons.                                  |
| Page selection field       | Sayfa seçim alanı               | The text field for expressions such as `3-5,2,2,7`.                                                      |
| Page actions menu          | Sayfa işlemleri menüsü          | The menu at the start of the selection bar.                                                              |
| Menu trigger               | Menü açma düğmesi               | The ellipsis control that opens a menu.                                                                  |
| Select all button          | Tümünü seçme düğmesi            | The button with a checked-box icon that selects all pages.                                               |
| Clear button               | Temizleme düğmesi               | The × button. It clears Input preparation and its repetition/alignment choices, or the Output selection. |
| Add to Output button       | Output’a ekleme düğmesi         | The primary + button in the Input selection bar.                                                         |
| Selection actions          | Seçim işlemleri                 | The movement, removal, and duplication controls for selected Output pages.                               |
| Move earlier/later buttons | Önceye/sonraya taşıma düğmeleri | The actions in the Output page actions menu that change positions in the Output order.                   |
| Remove button              | Kaldırma düğmesi                | The − button that removes Output pages or a selection.                                                   |
| Duplicate button           | Çoğaltma düğmesi                | The + button that duplicates Output pages or a selection.                                                |
| Selection hint             | Seçim yardım metni              | The text below the bar with usage, insertion destination, repetition, and alignment information.         |
| Selection count            | Seçim sayacı                    | The emphasized count, such as “6 pages selected”.                                                        |
| Validation message         | Doğrulama iletisi               | The header error for an invalid selection expression; the field retains its invalid state.               |

#### Repetition and blank pages

| English term             | Turkish equivalent           | UI element                                                                                |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Repetition control       | Tekrar sayısı denetimi       | The repetition field with decrease, increase, and reset buttons in the page actions menu. |
| Front alignment checkbox | Ön yüze hizalama onay kutusu | The “Start each repeat on front” choice.                                                  |
| Repeat button            | Tekrarlama düğmesi           | The “Repeat” button in the Output page actions menu.                                      |
| Insert blank actions     | Boş sayfa ekleme işlemleri   | The choices that insert a Blank before the first selected page or at the end of Output.   |

### Grid

#### Cards and previews

| English term         | Turkish equivalent                | UI element                                                                        |
| -------------------- | --------------------------------- | --------------------------------------------------------------------------------- |
| Thumbnail grid       | Küçük resim ızgarası              | The area that arranges page cards in rows and columns.                            |
| Page card            | Sayfa kartı                       | One complete card with its header, body, image, footer, and outer boundary.       |
| Card header          | Kart üst alanı                    | The upper section with the page number, drag handle, and page face indicator.     |
| Page number          | Sayfa numarası                    | The physical page position in the pane's sequence.                                |
| Page label           | Sayfa etiketi                     | An optional PDF-authored page identifier, independent of its physical position.   |
| Drag handle / Grip   | Sürükleme tutamacı                | The dotted handle in the card header. A click also selects or unselects the page. |
| Page face indicator  | Sayfa yüzü göstergesi             | The corner indicator that identifies the front or back side.                      |
| Folded corner        | Katlanmış köşe                    | The curved corner that marks a back side.                                         |
| Card body            | Kart gövdesi                      | The main image section between the header and footer.                             |
| Thumbnail frame      | Küçük resim çerçevesi             | The neutral area around the small page image.                                     |
| Page thumbnail       | Sayfa küçük resmi                 | The small page image inside the frame, from a producer PNG or PDF rendering.      |
| Card footer          | Kart alt alanı                    | The section below the image that reserves space for card actions.                 |
| Card actions         | Kart işlemleri                    | Input addition or Output movement, removal, and duplication controls.             |
| Page details trigger | Sayfa ayrıntılarını açma denetimi | The interactive page number that opens page details.                              |
| Page details popover | Sayfa ayrıntı paneli              | Input details or Output-copy information, including available actions.            |
| Blank page preview   | Boş sayfa önizlemesi              | The content-free page appearance with a Blank or Padding label.                   |

Grid is the view name. Input uses an HTML list, and Output uses an ordered list. The view name does not imply an ARIA
`grid` role.

#### Scrolling

| English term       | Turkish equivalent      | UI element                                                       |
| ------------------ | ----------------------- | ---------------------------------------------------------------- |
| Grid viewport      | Izgara görüntü alanı    | The fixed-height area that scrolls the continuous page sequence. |
| Scrollbar gutter   | Kaydırma çubuğu boşluğu | The reserved edge outside the page cards.                        |
| Visible row window | Görünür satır penceresi | The mounted Grid rows and their scroll spacers.                  |

### Page

#### Header and controls

| English term              | Turkish equivalent                   | UI element                                                                                  |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Page view                 | Page görünümü                        | The complete single-page viewer with its header, viewport, and bottom navigation.           |
| Page header               | Page üst alanı                       | The section with the page counter, optional grip, and page controls.                        |
| Page counter              | Sayfa sayacı                         | The current page and total page count, such as `1 / 7`.                                     |
| Go-to-page field          | Sayfaya gitme alanı                  | The page-number field that opens in place of the counter.                                   |
| Page controls             | Sayfa görüntüleme denetimleri        | The Compare, original-page, zoom, and reset controls as a group.                            |
| Compare toggle            | Karşılaştırma düğmesi                | The button that switches between an Output page's original and completed styled appearance. |
| Show original page button | Özgün sayfayı gösterme düğmesi       | The button that opens the corresponding original Input page.                                |
| Zoom level indicator      | Yakınlaştırma düzeyi göstergesi      | The displayed zoom percentage, such as `100%`.                                              |
| Zoom in/out buttons       | Yakınlaştırma/uzaklaştırma düğmeleri | The + and − buttons that change the page-image scale.                                       |
| Zoom reset button         | Yakınlaştırma sıfırlama düğmesi      | The button that resets zoom to `100%`, or fits the width at `100%`.                         |

#### Viewport and navigation

| English term               | Turkish equivalent             | UI element                                                                                |
| -------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------- |
| PDF viewport               | PDF görüntüleme alanı          | The visible area that contains the page and supports scrolling at larger zoom levels.     |
| Viewport background        | Görüntüleme alanı arka planı   | The neutral surface around the page image.                                                |
| Page image                 | Sayfa görüntüsü                | The rendered PDF page image inside the viewport.                                          |
| Scrollbar                  | Kaydırma çubuğu                | The horizontal or vertical control that changes the visible position of enlarged content. |
| Lens / Magnifier           | Büyüteç                        | The local enlargement that appears after a pointer pause over a Grid or Page image.       |
| Page navigation bar        | Sayfa gezinme çubuğu           | The section below the image with navigation and page actions.                             |
| Previous/next page buttons | Önceki/sonraki sayfa düğmeleri | The chevrons that show another page in the complete sequence.                             |
| Page actions               | Sayfa işlemleri                | The addition, removal, or duplication controls in the center of the navigation bar.       |

Zoom changes the scale of the complete page image. The Lens magnifies a local crop. Navigation chevrons change the
inspected page. Movement arrows change the Output order.

### Style

#### Profiles, groups, and objects

Style groups use the [disclosure pattern](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/). Group and object labels
come from the PDF.

| English term             | Turkish equivalent               | UI element                                                                                              |
| ------------------------ | -------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Style profile selector   | Stil profili seçicisi            | The select above the Style groups, with profile choices such as Outlined and Filled.                    |
| Profile description      | Profil açıklaması                | The description directly below the selected profile.                                                    |
| Guidance button / panel  | Ayrıntılı bilgi düğmesi / paneli | The information button and longer authored guidance for a group, Style object, profile set, or profile. |
| Style group / Disclosure | Stil grubu / Açılır-kapanır grup | A PDF-authored group, such as Watermark, Patterns, or Guides.                                           |
| Group header             | Grup üst alanı                   | The row with the disclosure indicator, group title, description, and object count.                      |
| Disclosure indicator     | Açılma-kapanma göstergesi        | The small arrow whose direction indicates the expanded or collapsed state.                              |
| Object count badge       | Nesne sayısı rozeti              | The number of Style objects at the end of the group header.                                             |
| Group content            | Grup içeriği                     | The objects and controls visible inside an expanded group.                                              |
| Style object             | Stil nesnesi                     | The object associated with related Style controls, such as Watermark or Slants.                         |
| Object heading           | Nesne başlığı                    | The object name and its description.                                                                    |

#### Quartet and property editors

| English term                  | Turkish equivalent                   | UI element                                                                                                         |
| ----------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------ |
| Quartet                       | Dörtlü denetim grubu                 | The complete Fill, Stroke, Width, and Visibility presentation for one Style object.                                |
| Property trigger              | Özellik düzenleyicisini açma düğmesi | The control that opens a Fill, Stroke, Width, or Visibility editor.                                                |
| Fill                          | Dolgu                                | The paint properties for an object's interior.                                                                     |
| Stroke                        | Kontur                               | The paint properties for an object's lines or outline.                                                             |
| Stroke width                  | Kontur kalınlığı                     | The property that appears as Width in the Quartet.                                                                 |
| Visibility                    | Görünürlük                           | The object display control.                                                                                        |
| Paint duo                     | Renk ve opaklık ikilisi              | The combined color and opacity presentation within Fill or Stroke.                                                 |
| Color swatch                  | Renk örneği                          | The small square that shows a color value.                                                                         |
| Opacity indicator             | Opaklık göstergesi                   | The small visual indicator that represents opacity with a fill level.                                              |
| Value readout                 | Değer göstergesi                     | A displayed hex color, percentage, millimeter value, or value-state text.                                          |
| Visibility toggle             | Görünürlük anahtarı                  | The Show/Hide control in the Quartet. It is a checkbox with a switch appearance.                                   |
| Inline editor                 | Satır içi düzenleyici                | The editor that expands below the selected Quartet property within the content flow.                               |
| Floating editor               | Açılır düzenleyici                   | The desktop Quartet editor above the workspace, anchored to its property button.                                   |
| Information button            | Bilgi düğmesi                        | The ⓘ control that opens parameter details.                                                                        |
| Parameter information popover | Parametre bilgi paneli               | The scrollable panel with authored details, parameter ID, baseline, Input scope, Output coverage, and constraints. |
| Field reset button            | Alanı sıfırlama düğmesi              | The ↺ control that removes an explicit value for one parameter.                                                    |
| Reset all styles button       | Bütün stilleri sıfırlama düğmesi     | The reset control in the Style toolbar.                                                                            |
| Value state indicator         | Değer durumu göstergesi              | Original state, Explicit override, Mixed, `—`, or Invalid information.                                             |
| Not-applicable indicator      | Uygulanamazlık göstergesi            | The hatching and prohibition symbol for a property without a declared parameter.                                   |

Paint duo values and resets remain independent. Mixed describes different original values. `—` can represent an
unrepresentable original value. Not applicable describes an absent parameter. Invalid describes a draft error.

The Visibility toggle can be indeterminate. Its visual switch appearance does not change its checkbox semantics.

### Shared controls

#### Fields and choices

Slider track, thumb, and tick marks use standard slider terminology.
[W3C](https://www.w3.org/WAI/ARIA/apg/patterns/slider/) describes the slider and its thumb.

| English term                    | Turkish equivalent             | UI element                                                                                      |
| ------------------------------- | ------------------------------ | ----------------------------------------------------------------------------------------------- |
| Control                         | Denetim                        | An interactive UI element that accepts input or performs an action.                             |
| Field label                     | Alan etiketi                   | The text that names an input field.                                                             |
| Field description / Helper text | Alan açıklaması / Yardım metni | The text that explains a control's meaning or use.                                              |
| Placeholder text                | Yer tutucu metin               | Text inside an empty field, such as “Example: …” or “No single value”.                          |
| Text input                      | Metin giriş alanı              | A field for a page expression, hex color, or text value.                                        |
| Number input                    | Sayı giriş alanı               | A field for direct numeric entry, such as Width or Opacity.                                     |
| Stepper buttons                 | Artırma-azaltma düğmeleri      | The −/+ pair that changes a value in steps. For color, the buttons darken or lighten the value. |
| Color picker                    | Renk seçici                    | The native color interface that opens from a color swatch.                                      |
| Hex color field                 | Hex renk alanı                 | The text field for a color value such as `#CC0000`.                                             |
| Select / Dropdown list          | Seçim listesi / Açılır liste   | A control for selection from profiles or allowed parameter values.                              |
| Radio group                     | Radyo düğmesi grubu            | A group with one choice, such as Show/Hide.                                                     |
| Checkbox                        | Onay kutusu                    | The control for an independent choice, such as front alignment.                                 |
| Slider                          | Kaydırıcı                      | The control that selects a value within a range, such as opacity or a thumbnail group.          |
| Slider track                    | Kaydırıcı yolu                 | The horizontal path along which the slider thumb moves.                                         |
| Slider thumb                    | Kaydırıcı tutamacı             | The movable part of the slider.                                                                 |

#### Buttons and supporting text

| English term       | Turkish equivalent     | UI element                                                              |
| ------------------ | ---------------------- | ----------------------------------------------------------------------- |
| Icon button        | İkon düğmesi           | A button with a visible icon instead of text.                           |
| Toggle button      | Durum düğmesi          | A button with a persistent pressed state, such as Compare.              |
| Primary button     | Birincil işlem düğmesi | An emphasized action, such as Download or the main addition button.     |
| Destructive button | Silme/kaldırma düğmesi | A button with danger colors for an action such as removal.              |
| Tooltip            | Araç ipucu             | A short explanation that appears after a pointer pause over an element. |

### Dialogs and guidance

A modal dialog prevents interaction with the interface behind it. A drawer describes an edge-aligned panel's visual
form. A popover describes content that appears above other content. See the
[W3C modal dialog pattern](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/) and the
[MDN Popover API reference](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API).

#### Dialog anatomy

| English term   | Turkish equivalent          | UI element                                                       |
| -------------- | --------------------------- | ---------------------------------------------------------------- |
| Modal dialog   | Modal iletişim kutusu       | A window that prevents interaction with the interface behind it. |
| Dialog header  | İletişim kutusu üst alanı   | The section with the title and close button.                     |
| Dialog body    | İletişim kutusu içeriği     | The explanation, choices, or help content.                       |
| Dialog actions | İletişim kutusu işlem alanı | The group with actions such as Cancel, Retry, or Skip.           |
| Close button   | Kapatma düğmesi             | The × control in the dialog header.                              |
| Backdrop       | Arka örtü                   | The dimmed surface behind an open dialog.                        |

#### Help, welcome, Settings, and Download

| English term                      | Turkish equivalent                      | UI element                                                                                |
| --------------------------------- | --------------------------------------- | ----------------------------------------------------------------------------------------- |
| Help button / Help dialog         | Yardım düğmesi / Yardım iletişim kutusu | The ? button and the dialog with App help and input-specific workspace instructions.      |
| Shortcut list                     | Kısayol listesi                         | The help lists that pair keys with actions.                                               |
| Keycap                            | Tuş gösterimi                           | A bordered key representation, such as Ctrl, Enter, or an arrow.                          |
| Welcome dialog                    | Karşılama iletişim kutusu               | The initial three-step explanation with Take a tour and Skip.                             |
| App installation help             | Uygulama kurulum yardımı                | Optional guidance for a separate app window, independent of the welcome and Product tour. |
| Settings button / Settings drawer | Ayarlar düğmesi / Ayarlar yan paneli    | The gear button and the panel that opens from the right.                                  |
| Lens magnification control        | Büyüteç büyütme oranı denetimi          | The −/+ buttons and adjacent magnification value in Settings.                             |
| About section                     | Uygulama bilgileri bölümü               | The product name, GitHub link, Version, and Build ID in Settings.                         |
| Download dialog                   | İndirme iletişim kutusu                 | Compact modal feedback at the header with preparation, error, Cancel, and Retry.          |
| Confirmation dialog               | Onay iletişim kutusu                    | A native confirmation, such as the warning before a return to Home with unsaved choices.  |

Settings uses a drawer appearance and modal dialog behavior. The system owns native file pickers, color pickers, and
confirmation dialogs. Their internal controls vary by browser and operating system.

#### Product tour

| English term         | Turkish equivalent    | UI element                                                                  |
| -------------------- | --------------------- | --------------------------------------------------------------------------- |
| Product tour popover | Tanıtım turu paneli   | The popover that explains actual interface elements.                        |
| Tour step counter    | Tur adımı sayacı      | The current step and total step count, such as `1 / 8`.                     |
| Tour navigation      | Tur gezinme düğmeleri | Back, Next, Finish, and End tour.                                           |
| Spotlight            | Vurgu alanı           | The highlight that separates the current tour target from its surroundings. |

The Product tour uses a non-modal dialog in a popover. Parameter information and page details also use floating panels.
Their visual popover name does not require every panel to use the browser's Popover API.

### Landing page

| English term      | Turkish equivalent    | UI element                                                                                 |
| ----------------- | --------------------- | ------------------------------------------------------------------------------------------ |
| Landing page      | Açılış sayfası        | The page visible before the workspace opens.                                               |
| Hero section      | Ana tanıtım alanı     | The main area with the product name, heading, explanation, file picker, and large graphic. |
| Product name      | Ürün adı              | The large “PDF Composer” text.                                                             |
| Hero heading      | Ana başlık            | The “Select pages and style prepared PDFs.” heading.                                       |
| Supporting copy   | Destekleyici açıklama | The short explanation and desktop ordinary-PDF support text below the heading.             |
| Inline link       | Metin içi bağlantı    | The prepared link within the hero heading.                                                 |
| Dotted underline  | Noktalı alt çizgi     | The dotted emphasis beneath the prepared link.                                             |
| Hero graphic      | Ana görsel            | The large logo graphic.                                                                    |
| File drop zone    | Dosya bırakma alanı   | The main framed area that accepts PDF file drops.                                          |
| Drop hint         | Bırakma açıklaması    | The “Drag PDFs into this area…” instruction.                                               |
| File drop overlay | Dosya bırakma katmanı | The “Drop PDFs to open” layer visible during a file drag.                                  |

### Feedback and drag and drop

#### Feedback

| English term                | Turkish equivalent                    | UI element                                                                             |
| --------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------- |
| Notice                      | Geçici bildirim                       | Temporary guidance or an event message in the app header.                              |
| Status message              | Durum iletisi                         | A result or cancellation in the status bar. SPEC calls this Info.                      |
| Error message               | Hata iletisi                          | A persistent general or Input error in the header, with recovery actions.              |
| Inline error message        | Alan içi hata iletisi                 | Local error text in reserved space that identifies the affected item.                  |
| Dismiss button              | Bildirimi kapatma düğmesi             | The Dismiss action in a notification or error menu.                                    |
| Cancel processing button    | İşlem iptal düğmesi                   | The Cancel action for the operation named in header feedback or the Download dialog.   |
| Loading indicator / Spinner | Yükleme göstergesi                    | The ring visible during PDF preview or processing.                                     |
| Loading status              | Yükleme durum alanı                   | Header feedback with the opening filename and Cancel action.                           |
| Processing status           | İşleme durum alanı                    | Header feedback with the Input filename, busy ring, and Cancel during Style work.      |
| Empty state                 | Boş durum görünümü                    | Explanatory content such as “Your Output starts here.”                                 |
| Operation highlight         | İşlem vurgusu                         | Temporary emphasis after addition, movement, or removal.                               |
| Page transfer animation     | Sayfa aktarım animasyonu              | A page or stack moving toward Output after addition or during first-addition guidance. |
| Offline/update status       | Çevrimdışı kullanım/güncelleme durumu | Header installation/update feedback and the footer's Update app button.                |

#### Drop targets and previews

| English term              | Turkish equivalent        | UI element                                                               |
| ------------------------- | ------------------------- | ------------------------------------------------------------------------ |
| Drop target               | Bırakma hedefi            | The Output area or specific insertion position that accepts pages.       |
| Drag preview / Drag image | Sürükleme önizlemesi      | The page or page-stack image that follows the pointer during a drag.     |
| Drop indicator            | Bırakma konumu göstergesi | The contour or highlight that identifies the insertion position.         |
| Drop placeholder          | Bırakma yer tutucusu      | The temporary card slot in Grid or the neighboring-page preview in Page. |
| Drag status               | Sürükleme durum metni     | Text such as “Move…” or “Release…” below the selection bar.              |

### Interaction states

Selection, keyboard focus, and the Grid page cursor are independent. The terms below identify different states rather
than interchangeable visual effects.

| English term                         | Turkish equivalent              | UI state                                                                          |
| ------------------------------------ | ------------------------------- | --------------------------------------------------------------------------------- |
| Hover state                          | Üzerine gelme durumu            | The response while the pointer is over an element.                                |
| Pressed state                        | Basılı durum                    | A button press or the persistent state of a toggle button.                        |
| Active tab                           | Etkin sekme                     | The tab whose content is visible.                                                 |
| Selected state / Selection indicator | Seçili durum / Seçim göstergesi | The contour and tint that identify a selected card or page.                       |
| Keyboard focus / Focus indicator     | Klavye odağı / Odak göstergesi  | The element that receives keyboard input and the visual indication of that focus. |
| Page cursor                          | Sayfa imleci                    | The Grid navigation position, independent of selection.                           |
| Disabled state                       | Devre dışı durum                | A control whose action is currently unavailable.                                  |
| Invalid state                        | Geçersiz durum                  | A field whose value fails validation.                                             |
| Busy state                           | Meşgul durum                    | The state during opening, preview generation, or processing.                      |
| Expanded/collapsed state             | Açık/kapalı durum               | The visible or hidden content state of a disclosure or editor.                    |
| Indeterminate state                  | Belirsiz durum                  | The absence of one Show/Hide value in a control such as Visibility.               |

### Conversation examples

The location comes first, followed by the component and its part. The path column shows the same structure with English
terms.

| English example                                             | Turkish example                                            | Element path                                        |
| ----------------------------------------------------------- | ---------------------------------------------------------- | --------------------------------------------------- |
| The hint below the Input selection bar.                     | Input seçim çubuğunun yardım metni.                        | Input selection bar → Selection hint                |
| The duplicate button in the Output card footer.             | Output kartının alt alanındaki çoğaltma düğmesi.           | Output page card → Card footer → Duplicate button   |
| The background of the Page viewport.                        | Page viewport’unun arka planı.                             | Page view → Viewport background                     |
| The hex color field in the Watermark Quartet's Fill editor. | Watermark Quartet’inin Fill düzenleyicisindeki renk alanı. | Watermark → Quartet → Fill editor → Hex color field |

### References

#### Project documents and components

| Reference                                                                                                                                            | Responsibility                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| [Web SPEC](SPEC.md) and [glossary](SPEC.md#glossary)                                                                                                 | Workspace behavior and product terminology.                                          |
| [Design rules](#tokens-and-assets)                                                                                                                   | Visual rules and layout references.                                                  |
| [App](../src/App.svelte), [Landing](../src/Landing.svelte), and [Theme](../src/Theme.svelte)                                                         | Application shell, pane header controls, landing page, and theme control.            |
| [Composer](../src/Composer.svelte), [Selection](../src/Selection.svelte), [Origin](../src/Origin.svelte), and [Repetition](../src/Repetition.svelte) | Panes, view controls, selection bars, page actions, and repetition.                  |
| [Grid](../src/Grid.svelte), [Page](../src/Page.svelte), [Counter](../src/Counter.svelte), [Pdf](../src/Pdf.svelte), and [Lens](../src/Lens.svelte)   | Scrollable thumbnails, page viewer, page entry, page images, and magnifier.          |
| [Style](../src/Style.svelte), [Quartet](../src/Quartet.svelte), [Control](../src/Control.svelte), and [Guidance](../src/Guidance.svelte)             | Profiles, groups, Style objects, property summaries, editors, and authored guidance. |
| [Help](../src/Help.svelte), [Tour](../src/Tour.svelte), [Settings](../src/Settings.svelte), and [Examples](../src/Examples.svelte)                   | Help, welcome, Product tour, Settings, and examples.                                 |
| [Export](../src/Export.svelte), [Print](../src/Print.svelte), and [Filename](../src/Filename.svelte)                                                 | Shared Output preparation, download, native PDF printing, and filename editing.      |
| [Offline](../src/Offline.svelte) and [drag](../src/drag.ts)                                                                                          | Offline/update status and drag images.                                               |

#### Standard terminology

| Reference                                                                                           | Terms                                                     |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| [Fluent 2: Card](https://fluent2.microsoft.design/components/web/react/core/card/usage)             | Card, header, body, preview, and footer.                  |
| [Adobe: Page thumbnails](https://helpx.adobe.com/acrobat/using/page-thumbnails-bookmarks-pdfs.html) | Page thumbnail.                                           |
| [W3C: Tabs](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/)                                         | Tab, tab list, and tab panel.                             |
| [W3C: Toolbar](https://www.w3.org/WAI/ARIA/apg/patterns/toolbar/)                                   | Toolbar semantics and control grouping.                   |
| [W3C: Disclosure](https://www.w3.org/WAI/ARIA/apg/patterns/disclosure/)                             | Expandable control and associated content.                |
| [W3C: Slider](https://www.w3.org/WAI/ARIA/apg/patterns/slider/)                                     | Slider, track, and thumb.                                 |
| [W3C: Modal dialog](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/)                         | Dialog, modality, and background interaction.             |
| [MDN: Popover API](https://developer.mozilla.org/en-US/docs/Web/API/Popover_API)                    | Popover behavior and its distinction from a modal dialog. |
