# PDF Composer design

This document owns visual rules, layout reference cases, and the [UI glossary](#ui-glossary). [SPEC.md](SPEC.md) owns
workspace behavior and product terminology. [Stylesheets](../src/main.css) and their imported component styles own exact
CSS values, breakpoints, and animation keyframes. The rules below retain deliberate visual constraints without
duplicating the implementation or the interaction specification.

## Contents

- [Tokens and assets](#tokens-and-assets)
- [Alignment](#alignment)
- [Focus, selection, and motion](#focus-selection-and-motion)
- [Workspace](#workspace)
- [Page fields](#page-fields)
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
512 px icon also supports Android launcher masks. All visible curves stay inside the central safe circle with radius 40%
of the canvas width.

Page-selection hints and Style descriptions use the body text size. Compact numbers and secondary metadata retain
smaller text. The landing's prepared-PDF link uses a thin dotted underline with clear space between dots and below the
text. The underline is black in light mode and white in dark mode. Forced colors retain the underline. Desktop
supporting copy describes ordinary PDF support. Narrow layouts retain the short copy and a single-line purpose heading
at normal text size.

The spacing scale uses a 28 px workspace gutter and fluid control gaps of 12–16 px at normal text size. Narrow layouts
reduce gutters before reducing usable control space. Standard controls use 4 px corners. The landing frame uses softer
12 px corners. Primary buttons are at least 104 × 46 px. Interactive targets are at least 44 px. Compact headers and
single-pane Grid pagination use the target sizes in [Grid and Page](#grid-and-page).

The shared `--icon-size` token sets ordinary icons to 1.125 rem. Control-specific icon sizes use their own visual role.

Icon buttons use transparent surfaces, accent stroke emphasis on hover, and immediate press feedback. Destructive
actions retain danger colors. Text and primary buttons can use a soft accent glow. Hover requires a fine pointer with
hover support. Disabled actions remain recognizable. In particular, both Input addition and Output duplication keep a
clearly visible + against their primary surface.

## Alignment

Each visual group has an explicit alignment reference: an edge, centerline, or text baseline. Related headers, content,
and footers use the same reference on both axes. Align text by its baseline and icons by their visible bounds. A
centered control stays on the content's centerline when adjacent controls have different widths.

Grid grips use the card's inline center and the header's block center in both densities. Page numbers, folded corners,
digit counts, and interaction target sizes do not move these references. Size text and interaction areas around them.

Use the visible content as the reference when controls belong to an image or document. Use the frame reference below for
single-pane touch Page layouts. Do not infer alignment from invisible control boxes or incidental padding. Keep usable
interaction targets around aligned content. Check alignment again when fitting, aspect ratio, zoom, font size, or
conditional controls change the layout.

## Focus, selection, and motion

The interface targets [WCAG 2.2 AA](https://www.w3.org/TR/WCAG22/). Status and selection do not rely on color alone.
Keyboard focus remains visible in both themes and forced colors. Bordered controls show one accent border without a
separate outer ring. Transparent outlines remain available for forced-colors repainting. Controls without visible
borders can use a focus outline. Compound fields mark their outer boundary. Embedded buttons retain their own visible
focus. Focus does not change control geometry.

Selection and keyboard position remain distinct. Selected Grid cards have a 2 px accent contour and a subtle accent
tint. The Grid cursor uses a 2 px secondary contour around the card and folded corner, including on selected cards.
Forced colors use system Highlight. Grips retain their own focus emphasis before activation moves focus to the page.
Page uses a 1 px contour, increased inward to 2 px for selection. Its heading receives selection tint while its image
viewport stays neutral. Border, header, footer, and padding compensation prevent selected cards from moving or resizing
their images.

Motion follows reduced-motion preferences. Hover lifts, drag tilt, parallax, fades, and animated movement disappear
under reduced motion. Static selection and operation highlights remain. Loading indicators retain a visible busy state
without rotation. Animations do not delay document edits, capture input, or change operation targets. Outgoing cards
cannot receive input. Removal can fade outgoing cards. Batch and view switches retain their ordinary transitions.

## Workspace

Coarse-pointer landing layouts above 375 px use equal outer margins through 40 em. Wider layouts use two gutters above
the frame and center it horizontally.

Desktop Input and Output have equal widths and equal gutters around the center separator. Their headings, tabs, fields,
hints, and content share row tracks. The filename chooser belongs to Input's heading and includes Remove Input below the
open-PDF list. Open PDF and Download occupy corresponding positions. Output totals sit beside Download. Relevant
processing replaces it in the same reserved area without changing heading dimensions. Narrow two-pane headings place
Open PDF and Download on their second row. Output totals share that row beside Download. Both actions align at the
bottom of the shared heading track, including with long filenames.

The header places the Home logo at the start and Help, Settings, and theme controls at the end. It states that
processing stays on the device. When no Notice is present, actions can use all space after the logo before wrapping.
Help remains visible on coarse-pointer devices and on the landing page. Settings opens a right drawer. Lens controls
show the magnification beside − and + buttons, aligned like the Page zoom controls. Application information sits at the
bottom behind a thin separator. Version and Build ID values align to the end and wrap with enlarged text. The repository
link uses an accessible icon target.

Pointer opening places initial focus on the Settings drawer. Keyboard opening focuses its Close button. Keyboard
navigation keeps a visible focus indicator on each control.

Tabs use square corners and an accent underline. Unselected tabs gain color on hover. Keyboard focus uses a soft tint
and one border, without glow. Grid, Page, and Style use their existing outlined icons. Disabled Style retains its
crossed-out brush and explanatory hint. Density controls sit beside the Grid tabs, outside the tablist. Narrow panes
reduce tab padding to keep both groups on one row at normal text size. Adjacent tools wrap as a group when more space is
needed. Tabs use the available width and reserve space for adjacent controls across views. The toolbar retains its
height in Page so desktop content frames remain aligned.

Routine hints, empty states, and tour steps describe controls and results without assuming a mouse or keyboard. Keep
input-specific instructions in Help's Keyboard and Mouse sections.

Grid and Page use the remaining viewport height after the header, workspace controls, page fields, and status bar.
Normal and Compact share that height. Density changes card dimensions and complete row capacity. Both Input and Output
use the same capacity policy. Pagination stays inside the available screen at ordinary text size.

A frame reserves at least one complete card row and usable pagination. If these minimums cannot fit, the document
scrolls. It does not shrink controls or show a partial final row. Enlarged text and short landscape screens can require
this exception. Page also reserves a usable image area below its heading. Its header and footer each retain one complete
control row, including with enlarged text. Do not increase image height to make a narrow header fit. Style keeps
document flow for its editable fields. Its companion pane uses the shared fit reference.

Below 480 CSS px of viewport height, the workspace status bar scrolls with the document. It must not cover card targets
when enlarged text or the minimum complete row requires scrolling.

Two-pane Grid and Page frames align at the top and bottom. The pane divider reaches the same edge. Shorter PDF pages
center within the shared image area. Application zoom changes the PDF inside that frame. The browser viewport already
excludes browser controls. The application does not estimate or subtract them again.

The portrait [Grid fixture](../test/fixtures/README.md#grid-fixture) has these desktop references at 100% browser zoom
and normal text size. Dimensions describe the browser viewport, not the physical monitor. Each matrix gives columns ×
rows = pages and applies to both Input and Output.

| Viewport                | Workspace width | Normal     | Compact       |
| ----------------------- | --------------- | ---------- | ------------- |
| FHD-, 1920 × 983        | 1232 px         | 3 × 2 = 6  | 6 × 4 = 24    |
| Full HD, 1920 × 1080    | 1232 px         | 3 × 2 = 6  | 6 × 4 = 24    |
| QHD window, 2560 × 1280 | 1472 px         | 4 × 3 = 12 | 8 × 6 = 48    |
| QHD-, 2560 × 1310       | 1472 px         | 4 × 3 = 12 | 8 × 6 = 48    |
| QHD, 2560 × 1440        | 1472 px         | 4 × 3 = 12 | 8 × 7 = 56    |
| UHD-, 3840 × 1966       | 2208 px         | 7 × 6 = 42 | 12 × 11 = 132 |
| UHD, 3840 × 2160        | 2208 px         | 7 × 7 = 49 | 12 × 13 = 156 |

Desktop references ending in `-` keep the nominal width. Their estimated height is `round(height * 0.91)`, where
`height` is the logical screen height. These are test inputs with about 9% reserved for browser and desktop controls.
The viewport inventory also covers distinct Mac notebook and display geometries in fullscreen and at this estimated
browser height. Panel resolution and logical CSS dimensions remain separate metadata.

The measured QHD- browser viewport matches this estimate. FHD- and UHD- remain provisional. Their matrices have
browser-test evidence. Physical-monitor measurements for FHD- and UHD- are pending.

When the corresponding physical monitors become available, replace the estimates with measured browser viewport
dimensions.

Runtime measurements count complete rows within the CSS frame. Compact has no arbitrary row limit. More space can admit
more rows without enlarging cards or concealing pagination. Browser zoom changes available CSS dimensions.

Touch references use the same fixture, nominal CSS dimensions, 100% browser zoom, and normal text size. Each matrix
applies to both Input and Output. Short screens retain one complete row and scroll when necessary.

Manual tablet profiles use nominal dimensions in both orientations. Physical-device measurements in standalone mode are
pending. Phone profiles ending in `-` keep the nominal width and estimate the available height as
`2 * floor(height * 0.85 / 2)`. Calculate each orientation from its nominal dimensions. These estimates define test
viewports; the application does not subtract the estimated browser controls again.

| Device       | CSS viewport | Normal     | Compact    |
| ------------ | ------------ | ---------- | ---------- |
| Narrow phone | 320 × 568    | 1 × 1 = 1  | 3 × 1 = 3  |
| iPhone       | 375 × 667    | 2 × 1 = 2  | 4 × 1 = 4  |
| iPhone       | 667 × 375    | 4 × 1 = 4  | 7 × 1 = 7  |
| iPhone       | 390 × 844    | 2 × 1 = 2  | 4 × 2 = 8  |
| iPhone       | 844 × 390    | 5 × 1 = 5  | 9 × 1 = 9  |
| iPhone       | 393 × 852    | 2 × 1 = 2  | 4 × 2 = 8  |
| iPhone       | 852 × 393    | 5 × 1 = 5  | 9 × 1 = 9  |
| iPhone       | 440 × 956    | 2 × 1 = 2  | 4 × 3 = 12 |
| iPhone       | 956 × 440    | 2 × 1 = 2  | 5 × 1 = 5  |
| iPad mini 6  | 744 × 1133   | 4 × 2 = 8  | 8 × 4 = 32 |
| iPad mini 6  | 1133 × 744   | 3 × 1 = 3  | 6 × 1 = 6  |
| iPad         | 768 × 1024   | 4 × 1 = 4  | 8 × 3 = 24 |
| iPad         | 1024 × 768   | 2 × 1 = 2  | 5 × 2 = 10 |
| iPad gen 9   | 810 × 1080   | 5 × 2 = 10 | 9 × 4 = 36 |
| iPad gen 9   | 1080 × 810   | 3 × 1 = 3  | 5 × 2 = 10 |

Mobile has a persistent one-tap Input/Output switch and preserves pane state. Headings retain the chooser or totals
beside Open PDF/Download. Enlarged text can stack these groups. Labels stay complete. Long filenames truncate, with
their full text available through hover and the chooser. Remove Input remains available in the chooser at every width.
Tabs and shared page fields remain usable in Page. Both densities fill complete rows within the available pane height.
Input and Output do not use fixed thumbnail counts.

## Page fields

Selection fields and Style profiles span the pane width. Both page fields have the accessible name Page selection.
Action menus occupy the first position and open below the field's start edge. Menus share padding, corners, and viewport
bounds. Output shows movement buttons in the field bar when the pane fits seven 44 px controls and a ten-character
field. Narrower panes put movement before Blank insertion in the menu. This rule uses pane width and font metrics,
including tablet and desktop layouts. Removal and duplication stay in the field bar. Individual page controls use
transparent surfaces. Input + and Output duplicate + use the same primary treatment through the field's outer edge.
Active Output removal uses a red surface and white minus. Invalid targets use the disabled treatment. The + remains
legible while disabled. Empty fields show an `Example:` placeholder.

Hints align below the field. Selection counts use accent emphasis. Errors replace the hint with danger text at the same
small size. Hints reserve space and wrap naturally, so errors, bold counts, and drag guidance do not move fitted page
images. Input and Output use the same control dimensions. Preserve usable field width and full-size touch targets.

## Grid and Page

### Card proportions and spacing

These rules apply to shared layouts and viewport calibrations in both densities. Card count does not override them.

Apply these priorities in order: usable controls and complete PDF images; the required visual bounds below; then card
count optimization within a calibration. If a complete usable row cannot fit, permit document scrolling. Do not reduce
image legibility or control sizes to avoid that exception. Shared layouts do not need to maximize card count.

Ratios use width:height. The A4 target `1:sqrt(2)` describes the full card, including its header and actions. Controls
can make the card taller than paper. At ordinary text size, the required portrait-reference bounds are
`sqrt(2) <= height / width <= 280 / 150`, approximately 1.41–1.87. The upper bound includes the accepted tall QHD card;
it is not another paper standard. Aim toward A4 when control space permits. Enlarged text can require more height. The
PDF image always keeps its original proportions, including landscape and square pages.

Use the maintained A4 portrait fixture to check image legibility at ordinary text size. Its rendered page height must be
at least 140 CSS px in Normal and 80 CSS px in Compact. These floors retain the smallest accepted reference images. They
prevent both densities from shrinking together while still passing the relative-scale rule. They do not set the height
of landscape or square PDFs. On short screens, keep a usable row and scroll rather than reduce these reference sizes.

Image margins measure the space between the rendered PDF page and its image area. They exclude header and action rows,
card borders, and white space inside the PDF. Upper and lower margins match. Side margins match and can exceed the
vertical margins moderately. For an A4 portrait reference, a side margin around one to two vertical margins is a visual
review guide, not a universal acceptance ratio. A larger difference needs rendered measurements and a reason, such as
the PDF's own proportions. Extra card count alone is not a reason. Do not force this multiplier onto all page shapes or
enlarged text.

The minimum card gap must reach 85% of the image's vertical margin. Remaining width is shared equally between columns
and at both outside edges. Prefer the same gap between rows. Calibrations can adjust row spacing within the tolerance:
`min(a, b) / max(a, b) >= 0.85` for horizontal and vertical gaps. For example, 16 and 14 px pass, but 16 and 12 px do
not. This 15% tolerance is a project design rule, not an external standard. It applies to gap comparisons and the image
scale rule below, not to every proportion in this section. Rendered bounds permit 1 CSS px for fractional layout.
Authored geometry still meets each required bound; the pixel allowance is not an extra design tolerance. Measure an A4
portrait reference at ordinary text size. Extra space from other PDF proportions does not increase the minimum. The
side-margin guide above does not use this tolerance.

At ordinary text size, compare the same portrait PDF image in both densities within one viewport and pane. The target
Normal/Compact linear scale ratio is 2. For the measured ratio `r`, require `min(r, 2) / max(r, 2) >= 0.85`,
approximately 1.70 to 2.35. Use the rendered PDF image, excluding card controls and margins. Card area does not need to
have a fixed ratio. This rule applies to shared geometry and calibrations. Enlarged text preserves readable content and
usable controls before this ordinary-size target.

Separate usable targets remain necessary around adjacent cards. Selection does not change these dimensions. Partial
final rows keep the same card widths, column positions, and gaps as complete rows. Rows start at the top of the card
area. Remaining height stays below them; it does not spread rows apart or vertically center a sparse batch.

Viewport calibration optimizes the number of complete cards within these constraints. Excess bottom space can justify
different card or image dimensions, column counts, or spacing. An extra row or column must preserve the portrait
silhouette, balanced margins, image legibility, and control sizes. If another row does not fit, balanced unused space is
permitted. Shared layouts prioritize readable images, stable spacing, and reachable pagination on unknown screens. They
do not need to find the greatest possible card count.

Matching Input and Output cards have equal dimensions at the same density, including sparse rows. Normal cards place
numbers at the start, grips in the center, and face information at the upper-right corner. Back uses a curved folded
corner. Front retains its normal corner. The fold continues the current contour without leaving a rectangular border
behind it. Accessible labels and hover help identify both faces. Page corners do not intercept tool interactions.

The shared Normal reference uses 148 × 240 px cards; Compact uses 74 × 125 px cards at ordinary text size. The minimum
gap is 85% of the authored vertical image padding, with a 0.5 rem floor for usable separation. Actual distributed
spacing drives both row capacity and calibrated card height. Do not calculate one from the minimum gap and the other
from the distributed gap.

The QHD calibration targets three Normal rows with card heights from 240 to 280 px. Portrait thumbnails grow with the
cards and keep equal 16 px upper and lower margins. Cards use a 9.375 rem width and a 14 px minimum gap. Heading and
footer controls retain their ordinary size and at least 44 px targets. Viewport-specific card dimensions and spacing
belong in `frame.css`. Card styles consume those shared values.

The calibration table requires viewport width, viewport height, primary pointer, orientation where relevant, and pane
layout. Upper bounds are exclusive. Entries do not override another entry at the same density. Each entry changes only
card dimensions and spacing. The shared frame budget and pagination placement stay independent of calibration.

| Reference                  | Width, CSS px | Height, CSS px | Input condition          | Pane layout | Card geometry                                                                                                                                                                 |
| -------------------------- | ------------- | -------------- | ------------------------ | ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Desktop Compact            | 1280–2140     | 700–1200       | Fine pointer with hover  | Two panes   | Compact: six fitted columns, 121 px high, 6.4 px image padding; images stay within 1 px of the shared reference.                                                              |
| Medium desktop             | 2200–2400     | 1100–1350      | Fine pointer with hover  | Two panes   | Normal: 134 × 236 px, 12 px padding. Compact: up to seven fitted columns, 123.625 px high, 7.5 px padding.                                                                    |
| Large desktop              | 2960–3200     | 1500–1750      | Fine pointer with hover  | Two panes   | Normal: up to five fitted columns, 134–150 × 235 px, 11.5 px padding. Compact: up to nine fitted columns, 124.625 px high, 8 px padding.                                      |
| QHD                        | 2560–2880     | 1280–1800      | Fine pointer with hover  | Two panes   | Normal: 240–280 px high, 150 px wide, 16 px image padding, 14 px minimum gaps                                                                                                 |
| UHD-                       | 3840–4160     | 1900–2050      | Fine pointer with hover  | Two panes   | Normal: up to seven fitted columns, 134–140 × 237–240 px, 14.5 px padding. Both densities: row gap is 90% of the distributed column gap, bounded by the minimum gap.          |
| UHD                        | 3840–4160     | 2050–2250      | Fine pointer with hover  | Two panes   | Normal: up to seven fitted columns, 134–140 × 233 px, 10.5 px padding. Compact: up to twelve fitted columns, 121.625 px high, 6.5 px padding.                                 |
| Short touch landscape      | 667–1000      | 250–500        | Coarse pointer, no hover | One pane    | Normal: up to five fitted columns, 134–142 × 232 px, 10 px padding. Safe-area insets reduce the available column budget.                                                      |
| Small touch portrait       | 740–750       | 1047–1090      | Coarse pointer, no hover | One pane    | Normal: 137 × 226 px, 9 px image padding. The 744 × 1047 Simulator Safari sample fits two rows with a 140 px portrait image.                                                  |
| Medium touch portrait      | 805–835       | 980–1220       | Coarse pointer, no hover | One pane    | Normal: 142 × 231 px, 9.5 px image padding. The 810 × 994 Simulator Safari sample fits five columns with a 144 px portrait image. Compact keeps the shared geometry.          |
| Small touch portrait, tall | 740–750       | 1100–1160      | Coarse pointer, no hover | One pane    | Compact: 77.7 px wide at ordinary text size. The 744 × 1133 Simulator Safari fullscreen sample fits four rows without reducing the image.                                     |
| Air-width touch portrait   | 820–830       | 1080–1120      | Coarse pointer, no hover | One pane    | Compact: 77 × 117.625 px, 4.5 px padding. The 820 × 1094 Safari sample gains a fourth row.                                                                                    |
| Medium touch landscape     | 1080–1133     | 700–900        | Coarse pointer, no hover | Two panes   | Normal: 234 px high, 136 px wide, 11 px image padding, 12 px minimum gaps. Compact: 74.57 × 116.5 px, 4 px padding. The 1080 × 778 web-app sample gains a second Compact row. |
| Wide touch landscape       | 1180–1220     | 730–900        | Coarse pointer, no hover | Two panes   | Compact: 79 × 119 px, 5 px padding. The 1180 × 734 Safari sample gains a second row with an 80 px portrait image.                                                             |
| Large touch portrait       | 1000–1050     | 1200–1400      | Coarse pointer, no hover | Two panes   | Normal: 142 × 231 px, 9.5 px padding. The 1024 × 1280 Safari candidate grows from 2 × 2 to 3 × 3 with the same 144 px image.                                                  |
| Large touch portrait, tall | 1024–1050     | 1300–1400      | Coarse pointer, no hover | Two panes   | Compact: 81 × 119.625 px, 5.5 px padding, targeting a sixth row.                                                                                                              |
| Large touch landscape      | 1360–1380     | 980–1060       | Coarse pointer, no hover | Two panes   | Normal: 152 × 236 px, 12 px padding. Compact: 83 × 120.625 px, 6 px padding, with a 0.9 row-gap factor.                                                                       |

A mouse with a secondary touch input keeps the desktop calibration. A primary touch pointer uses touch conditions.
Unmatched screens use the shared dimensions. Device names describe measured references, not hardware detection. New
measurements can establish another disjoint entry. A new entry must not change defaults to tune one screen. Use
DevTools' Desktop device type for desktop references. Mobile or touch emulation changes the primary-input match, even
when its viewport dimensions equal a desktop reference.

CSS fits complete columns at the chosen card width, including minimum outside gaps. It distributes remaining width
without stretching cards into squares. Input, Output, and Page's thumbnail reference use the same column policy. Shared
dimensions and calibration entries belong in `frame.css`. Card styles consume these values. Keep an exception in its
entry rather than in another component stylesheet. Drop previews use the same outside inset and the actual column and
row strides, including fractional card dimensions.

Page's lens reference and drop previews use the card's fitted image dimensions. They do not define separate density
sizes. Selection keeps the same image bounds when border emphasis changes.

Compact headers use three equal cells. The number occupies the first cell and the grip occupies the center cell. Both
targets are at least 24 px wide and 44 px tall, without overlap. Page numbers fit their cell through smaller text.
Numbers through 10,000 keep at least 2 px of separation without moving the grip or widening the card. Tabular digits
keep semibold weight. Hover changes their color without changing geometry.

Viewport calibrations can choose narrower cards within the visual rules above. Enlarged text keeps control targets and
complete labels usable. It can reduce capacity and require document scrolling.

Every card header and footer occupies one row, on every device and in both densities. This rule includes Page headers
and bottom navigation. Controls, counters, and their text never wrap or stack inside these rows. Preserve usable targets
and readable text. Grid reduces column capacity when its card controls need more width. Page uses compact controls and
smaller gaps first. If controls still do not fit, put the excess Page actions in the existing pane page-actions menu.
Keep every action accessible; do not clip controls, overlap targets, or introduce horizontal scrolling. Workspace
headings, view toolbars, and pagination captions outside cards follow their own layout rules.

Selection hides individual actions without moving the image or changing card dimensions. Normal footers keep their
height and separator. Input centers addition. Output places removal left of duplication with one control gap. Page
places navigation chevrons at the outer edges around these actions. Movement actions use stemmed arrows, distinct from
navigation chevrons. All action targets remain usable with keyboard and touch.

PDF content, Blank, and Padding keep physical proportions and the same fit rules. Neutral image frames distinguish white
page edges in light mode. Resizing and density changes keep completed pixels visible until replacement renders finish.
Selection does not clear or repaint unchanged images. Initial previews show a small centered loading ring with an
accessible busy state. Rendering does not stretch unfinished canvases.

Page headings and navigation stay outside the image viewport. Except in the single-pane touch layout below, the counter
text and Previous icon align with the fitted image's inline start. Fit and Next icons align with its inline end. If the
fitted image is narrower than the minimum control span, expand the shared header/footer span enough to keep targets
separate within the frame. These positions stay fixed during zoom and panning. The Input grip aligns with centered
addition. Output has no grip.

A single-pane touch layout shows Input or Output at a time and has a coarse primary pointer without hover. Use the
active pane layout and input capabilities, not device names or orientation, to determine this scope. In this layout,
neither Input Page nor Output Page exposes a grip. Remove its reserved space and interaction target. Grid grips retain
their existing behavior. Page selection remains available through the page-selection bar.

In single-pane touch Page, align the header and footer groups to the frame's inner edges. Use equal inline gutters of 16
CSS px at ordinary text size. The counter occupies the start; tools occupy the end. Previous and Next occupy the
footer's outer positions; addition and removal stay centered between them. Keep all targets inside the frame. Center
visible content vertically within each row, with at least 44 CSS px of row height. These references do not follow the
PDF image, even when the fitted image is narrow. Image proportions, zoom, and panning do not move the controls.

Single-pane touch Page uses a minimum image gutter of 2 rem on all four sides: 32 CSS px at ordinary text size. Fit
centers the complete image in the available image viewport with these gutters. If the fitted image occupies less than
70% of that viewport's full width, the initial Page entry enlarges it to the available width after the two inline
gutters, up to 400%. Round down to a whole percentage to avoid horizontal overflow. The image starts with the full top
gutter and retains the same bottom gutter when scrolled to the end. Wider manual zoom levels can require horizontal
scrolling. These gutters belong to the image area, outside the PDF; they do not increase header or footer height.

Determine the initial zoom after opening completes, using the rendered image viewport and the page's physical ratio.
Apply it once per Source and once for Output. Preserve explicit zoom choices, including Fit, through view switches,
navigation, Source switches, and resizing. Bring the frame into view on initial pointer entry. Keep keyboard focus
visible. Where the minimum frame fits the screen, its navigation must be visible above status. Fit always means 100% and
the complete page inside the current image viewport. Use the existing Fit and zoom controls; do not add a separate
fitting control. The image frame uses the same available-height budget as Grid. On short screens, document scrolling
preserves the minimum usable frame and exposes bottom navigation without the status bar covering it.

Compare and Show original page precede the zoom controls when they fit inline. Larger panes show the percentage, minus,
plus, and Fit as four evenly spaced items. Narrow panes show three: minus, plus, and one Fit button. At Fit, that button
shows the existing icon; at other zoom levels, it shows the percentage. Activating it always restores Fit. The zoom
value remains available to screen readers in both layouts. Equal control cells keep visible item centers evenly spaced.
The counter and tools share one row; the complete tools group never moves to a second row.

Counters keep their dimensions during inline page entry. Current values use stronger text and totals muted text. Spaces
separate each slash from both numbers. Grid's caption uses `4 / 27 · 28–36 / 240`, with accessible names describing both
ranges. Its native slider has one stop per batch, gray group markers, and previous/next buttons. At most 64 markers
sample the full range, including its endpoints. The slider and caption retain exact batch and page positions. Wide
layouts align Grid and Page navigation. The caption always stays below the slider in both densities and both pane
layouts. It stays close to the slider and clear of the status bar. Two-pane layouts use the bottom gutter for captions.
Calibration entries change card dimensions without changing this shared placement rule.

Single-pane layouts use one pagination layout for Normal and Compact: the caption sits directly below the slider row,
with previous/next buttons at the row's outer edges. The visible arrow centers align with the pane's content edges, as
do its heading and page fields. The row can extend into available side margins while all targets stay inside the
viewport. Pagination stays clear of the status bar within the shared bottom gutter. Its arrows use separate 40 × 44 px
targets; the slider retains a 44 px height. Page totals stay beside the current number. The page-entry field does not
cover another control.

The lens overlays the image without receiving input. Its magnifier cursor remains visible over light and dark page
content. Inherited image tooltips stay out of the lens. Page details use a click interaction, leaving image hover
available for inspection.

Touch holds place the lens above or below the finger within the viewport. Grip dragging responds directly to finger
movement. Grid text and page images suppress native selection and touch callouts while retaining ordinary scrolling.

## Style presentation

Style labels and widgets share a row on wide panes and stack on narrow panes. Native group disclosures follow authored
order. Group headings use Title Case. The object count remains visible at the end, including while collapsed. Object
titles align with group titles. Descriptions use muted text, wrap naturally, and explain meaning rather than repeat a
label. Parameter IDs belong in information panels, not main field labels. Baseline, override, mixed, and unrepresentable
states remain distinguishable.

Profile selects appear above groups with the page field's height, borders, and corners. Their selected descriptions sit
directly below. The first select aligns with Output's page field. A neutral divider separates profiles from individual
controls. Style selects retain native selection behavior, use the shared inset chevron, and keep their full touch height
on touch browsers.

A Quartet presents Fill, Stroke, Width, and Visibility in equal components. Fill and Stroke summaries combine
independent color and opacity rows. Color swatches show full color independently of opacity. A separate level marker
shows exact opacity. Width belongs visually to Stroke. Values use neutral ink, including overrides. Labels and type
icons stay together. Color codes and short value captions stay on one line.

Wide panes show a strip. Narrow panes use two equal columns, then one column with enlarged text. Color fields receive no
extra width. An expanded editor follows the selected component's row without stretching the summaries. Paint duo color
and opacity share one frame and retain separate resets. Native disclosures and controls retain keyboard access.

Unavailable parameters use a muted hatch and prohibition icon while retaining their component's space. N/A appears only
in hover help with an accessible explanation. Missing Visibility uses this treatment and preserves original display
states. Mixed or unrepresentable baselines remain editable. Available Visibility can be indeterminate. A Show/Hide
checkbox controls Quartet Visibility. Individual display fields use equal Show/Hide segments with native radio
navigation. The selected segment has clear emphasis. Neither segment is selected for an unassigned original value.

Hover emphasizes the relevant component or information marker without adding another border or moving values. Open
editors retain an accent frame. Invalid drafts use danger text. Short labels retain full authored accessible names. The
active Style tab row holds processing feedback and the danger-colored reset icon.

## Drag and drop

Visible grips and field hints identify drag sources. The pointer carries a proportionate image of the visible page, with
slight tilt only under motion. Two pages show two sheets. Larger groups show three. Blank and Padding use plain bordered
sheets. Source cards fade while Output gains an accent outline. Guidance distinguishes adding from moving and announces
the exact destination. Touch Grid outlines only the card area, excluding pane headers, tabs, and Selection. The drag
image follows the finger directly while neighboring cards ease into their prospective positions. Pressing a touch grip
immediately highlights the grip and card. A small scale change marks the press when motion is enabled.

During a narrow touch transfer, Output's workspace button gains a dashed accent border that becomes solid under the
finger. Input's forbidden-drop marker appears only after a pause away from the valid target. Movement toward Output
postpones the marker. The pane changes after a successful drop.

Grid opens a stable card-sized slot and shifts neighboring cards into prospective positions. The slot holds a faint copy
without contour or shadow. Output Page shows that copy beside the image on the insertion side. Reduced motion keeps
sheets straight and changes positions immediately. Feedback disappears on drop, cancellation, or leaving Output. It
never changes document order before drop. Enlarged Page uses grab/grabbing cursors for mouse panning. The landing drop
target keeps its layout and does not flicker on nested drag events.

## Onboarding and product tour

Help uses a native modal dialog with contextual topic tabs. App remains available. A workspace adds input-specific
Keyboard, Mouse, or Touch topics. Start Tour appears beside them only with a workspace. The tab row wraps on narrow
screens. Available panels determine its size. Switching topics does not resize the dialog. Each panel scrolls
independently, while its heading and navigation stay visible. At normal text size, topics fit desktop viewports from
1440 × 900 without scrolling. Desktop width is capped at 64rem and touch layouts at 52rem. The dialog leaves at least
one control gap at viewport edges. Padding uses one gap, with two gaps at the bottom for breathing room. Inactive panels
retain measurement space without receiving focus.

Input and Output shortcut sections align their headings and tables. Selection Field has its own Enter row. Workspace
keys and routing notes sit below. Narrow screens stack panes and notes. Keycaps use consistent neutral surfaces,
borders, and text size. Named keys have enough width for their full labels. Topic selection supplies the panel title
without a duplicate heading.

The welcome is a short native dialog. The product tour is a nonmodal popover with a compact card near the lower-right
corner. Narrow screens use the available width above the bottom edge. Long content scrolls inside the card while heading
and controls remain visible. End tour keeps a full touch target. Compact progress shows the step count without crowding
this action.

One soft spotlight follows the target's visible bounds with clear surrounding space. Tab steps include their tab and
content in the same light area. The remaining interface dims without blurring it. The tour card stays clear. Scrolling
and resizing keep the light aligned. Reduced motion skips backdrop fades. Text describes purpose and actions briefly.
Detailed shortcut tables stay in Help.

The first-addition hint brightens a visible Input thumbnail, then sends a fading visual copy toward empty Output. The
copy begins moving before the fixed light fully fades. On mobile it moves toward the Output switch and stays within the
viewport. The header reserves space for its Notice before animation geometry is measured. Reduced motion retains only
the instruction. [SPEC.md](SPEC.md#help-and-onboarding) owns hint eligibility, dismissal, and tour state restoration.

App installation guidance uses a separate native dialog and dismissal state. iPhone and iPad browser visits show it once
before pending onboarding. Desktop users reach it through Help → App without an opening prompt. Continue in browser has
primary emphasis. The optional native installation action has secondary emphasis. Standalone startup has no installation
recommendation. The title and visible close icon share a vertical centerline. Narrow layouts and enlarged text retain
scrolling within the dialog. Installation guidance does not change workspace geometry or Grid capacity.

The landing product name retains a readable minimum independently of the purpose heading. Enlarged text scales the name
and permits wrapping. The persistent drop hint appears only with fine-pointer and hover capability. Actual file dragging
still reveals the drop overlay on other inputs. The file chooser remains the primary opening action.

## Feedback presentation

| Message | Placement                                                         | Treatment                                                                        |
| ------- | ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Info    | Bottom status row.                                                | Small muted `--info` text.                                                       |
| Notice  | Header center, above controls on narrow screens.                  | Bold `--ink` text, `--secondary` information icon, and `--muted` dismiss button. |
| Error   | Above the workspace, or beside the affected field/dialog control. | Danger color with explanation and recovery actions.                              |

The status row reserves its height and stays at the viewport bottom during scrolling. Last controls remain reachable.
Operation and offline feedback share a centered column. Update controls appear below operation feedback. Larger
workspace views show the active filename at the start and Build ID at the end. Narrow mobile workspace views retain
feedback and offline actions only. The landing places Build ID at the bottom center. It can wrap between groups with
enlarged text. Long filenames truncate with full hover text.

New footer status briefly highlights the message with a light accent tint and a soft glow just around the text, then
fades to its ordinary treatment. A successful Page image copy briefly brightens the image and its contour. Repeated
operations restart the feedback. Reduced motion skips these effects. Neither effect changes geometry.

All page additions use a 1200 ms preview along a shallow curve, including copies, repetition, and Blank insertion. A
group uses a small page stack. Input additions use the Output workspace button on single-pane layouts. Otherwise, the
preview moves toward a new Output image in the visible Grid batch, or the Output heading when no new image is displayed
or Output is in Page. Single-pane layouts use the Output button when no new image is displayed. Preview centers follow
the visible source image and target on both axes. Grid arrivals match the target image size across pane densities. A
Blank uses a blank preview.

Additions use the targeted page's rendered image and start at that image. Output copying uses the same occurrence
identity for buttons, menus, and keyboard shortcuts. A group uses its first target in print order. If that image is
unavailable, use the action area as the origin; do not substitute another page's image. This also applies when Page
shows a different page from the prepared Input sequence or Output selection. Removal and movement retain each affected
occurrence's own image and position.

When the preview targets the Output workspace button, that button gains a soft accent glow over the same 1200 ms. The
glow rises and fades during the flight. Arrival or cancellation clears it without changing the button's geometry.

The preview uses a rendered page when available. It does not delay the edit or change selection, scrolling, or the
active view. New Output cards reserve their space but stay hidden and inert until arrival. Keyboard duplication keeps
focus in Grid, then focuses the copy on arrival unless the user navigates elsewhere. If Page displays a new occurrence,
it also waits for arrival. Cancellation reveals the completed edit. Repeated additions replace the previous preview.

Removal shrinks and fades each visible outgoing card over 1200 ms. Cards keep their places until the exit completes and
cannot receive input. Page retains a snapshot of the removed image during the exit, then shows its replacement. Removing
an Input uses the same exit for its visible page images. Document edits and totals update immediately. After a Grid exit
completes, the remaining cards slide into their new positions over 800 ms.

A new edit or transfer finishes earlier Grid removals before choosing its page targets.

Moves slide existing cards and their neighbors to their new positions over 1200 ms. A position change in Page gives the
image a short movement in that direction. The inspected occurrence, Selection, and focus follow their existing rules.
These animations use the same paths for buttons, menus, keyboard shortcuts, and gestures.

Drag and drop retains its own preview during movement. Reduced motion shows all edits immediately, without these
effects.

Notices use no colored surface or border. They can wrap beside their icon and keyboard-accessible dismiss button. The
header remains visible during a Notice. Notice text keeps its full contrast between entry and dismissal. Entry and
dismissal can fade the Notice. Reduced motion keeps the instruction static. Errors retain their local explanation and do
not repeat details in the footer. Loading, empty, error, and cancellation states identify the next action.

## Validation

The [browser suites](../test/) own automated visual and interaction assertions. [AGENTS.md](../../AGENTS.md#web) owns
execution commands. Layout changes exercise both themes, keyboard focus, normal and 200% text, and widths of 320, 390,
and 768 px. Desktop changes also exercise the [capacity references](#workspace), mixed page sizes, both densities, and
Grid/Page alignment. Relevant cases include empty and selected states, long filenames, five-digit page numbers, loading,
errors, cancellation, and reduced motion. No layout introduces horizontal overflow or conceals an action behind a fold,
toolbar, or fixed status row. Touch emulation covers taps and scrolling. Physical-device drag behavior and assistive
technology require separate evidence.

Physical iOS acceptance includes a fresh Home Screen installation, the icon on light and dark wallpaper, and paired
heading alignment in Chrome landscape tabbed mode. Record the OS/browser versions, presentation mode, actual CSS
viewport, revision, and screenshots. Check sustained lens movement with a representative complex PDF, including touch
holds and crop edges. Keep measured frame, memory, and installation costs separate from automated correctness results.
These cases remain open until their physical evidence exists.

Animation assertions wait for the rendered effect to start before checking its duration or geometry. Updated document
totals do not prove that a transition has started. Edit feedback checks also run with CPU throttling and identify the
viewport and density in their diagnostics. Do not use fixed sleeps or automatic retries to hide timing failures.

Alignment is an acceptance gate for every layout change. Exercise every affected width range from the
[capacity references](#workspace), including both ends when a range changes. Check Input and Output in Normal and
Compact, both themes, normal and 200% text, selected and unselected cards, and one- through five-digit numbers. Measure
visible icon bounds against their declared references on both axes. Center offsets must stay below 1 CSS px; targets
must remain separate and usable. Compare Grid with Page's thumbnail reference. At each desktop reference, assert the
rendered Normal and Compact column × row matrices against the table. Apply the touch references in both orientations,
including Input/Output page counts and partial rows. Screenshots confirm the surrounding visual groups. Passing column
counts, target sizes, or overflow checks alone does not pass this gate.

Check calibration boundaries in both viewport dimensions and in each applicable orientation. Include a fine pointer with
secondary touch input, a primary touch pointer, and unmatched viewport dimensions. Verify that only the matching entry
changes card geometry. Both densities must use the available height and keep pagination reachable. Measure portrait card
proportions, image margins, distributed column gaps, and row gaps against the
[card rules](#card-proportions-and-spacing). Check partial final batches without changing their column positions or row
spacing. Compare Normal/Compact image scale for the same portrait page against the 2× target and its 15% tolerance. The
[Grid tests](../test/grid.test.js) check these bounds, image-size floors, calibration isolation, and stable partial
batches. The [Page geometry tests](../test/geometry.test.js) check fitted image and control alignment. Keep these checks
aligned with this document when a reference changes.

Page zoom items share one centerline, with less than 1 CSS px of vertical deviation. Control targets stay inside their
heading and do not overlap. Card headers and footers each occupy one row, including counters and inline page entry.
Check these rules at Fit and other zoom levels, with both themes and normal/200% text. Landscape phone checks cover 667
× 375, 844 × 390, and 956 × 440 CSS px. The browser tests retain a screenshot under `.local/tmp/web/layout/` when a
matrix or Page-control assertion fails.

Single-pane touch Page checks include 320 × 568, 375 × 667, 390 × 844, 440 × 956, and portrait iPad mini viewports.
Check both panes, short and tall PDF pages, and transitions into and out of two-pane layout. Assert that Page grips have
no visible or keyboard target in the single-pane touch layout. Measure symmetric frame gutters and vertical control
centers with both narrow and wide fitted images. For an overflowing image, measure its initial top gap and scroll to its
bottom gap and navigation. Check narrow fine-pointer and two-pane touch layouts separately to enforce the scope.

CI uploads layout failure screenshots as `layout-<shard>` artifacts and retains them for seven days.

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
labels such as Input, Output, Grid, Page, and Style retain their English names in both languages.

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

| English term      | Turkish equivalent          | UI element                                                                                         |
| ----------------- | --------------------------- | -------------------------------------------------------------------------------------------------- |
| App header        | Uygulama üst çubuğu         | The top section with the logo, privacy information, and header actions.                            |
| Logo / Home link  | Logo / Ana sayfa bağlantısı | The upper-left logo. It opens Home in the workspace and replays the animation on the landing page. |
| Header actions    | Üst çubuk işlemleri         | The Help, Settings, and theme buttons as a group.                                                  |
| Privacy indicator | Gizlilik göstergesi         | The lock icon and “On your device” text.                                                           |
| Theme toggle      | Tema değiştirme düğmesi     | The sun/moon button that switches between light and dark themes.                                   |
| Skip link         | İçeriğe atlama bağlantısı   | The “Skip to workspace” link that becomes visible with keyboard focus.                             |
| Workspace         | Çalışma alanı               | The main area for work with Input and Output.                                                      |
| Input pane        | Input bölmesi               | The complete Input section, including its header, tabs, selection bar, and content.                |
| Output pane       | Output bölmesi              | The complete Output section, including its header, tabs, selection bar, and content.               |
| Pane divider      | Bölme ayırıcısı             | The fixed vertical line between Input and Output on desktop.                                       |

The pane divider is a separator. It has no resize interaction, so its name is not splitter.

#### Pane headers and status bar

| English term            | Turkish equivalent                | UI element                                                                                     |
| ----------------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| Pane header             | Bölme üst alanı                   | The section with the Input chooser and Open PDF, or the Output heading, summary, and Download. |
| Pane heading            | Bölme başlığı                     | The Input or Output title text.                                                                |
| Input selector          | Input seçicisi                    | The chooser that opens from the filename in the Input header.                                  |
| Input list              | Input listesi                     | The open-PDF list with numbers, filenames, and a checkmark for the active Input.               |
| Count badge             | Sayı rozeti                       | A small bordered count, such as the Input count or a Style group's object count.               |
| Remove Input button     | Input kaldırma düğmesi            | The action below the open-PDF list that removes the active Input.                              |
| File picker button      | Dosya seçme düğmesi               | Open PDF or Choose a PDF. It opens the system file picker.                                     |
| Output summary          | Output özet bilgisi               | The PDF page count, duplex sheet count, and optional Padding count.                            |
| Download button         | İndirme düğmesi                   | The primary action that downloads Output.                                                      |
| Status bar / App footer | Durum çubuğu / Uygulama alt alanı | The bottom row with the filename, status message, and Build ID.                                |
| Build ID                | Derleme kimliği                   | The build value in the status bar and Settings.                                                |

### Views and tabs

Tab, tab list, and tab panel follow the [W3C tabs terminology](https://www.w3.org/WAI/ARIA/apg/patterns/tabs/).

| English term          | Turkish equivalent         | UI element                                                                     |
| --------------------- | -------------------------- | ------------------------------------------------------------------------------ |
| View toolbar          | Görünüm araç çubuğu        | The row with view tabs and the adjacent density controls or Style actions.     |
| Tab list              | Sekme çubuğu               | The Grid, Page, and Style tabs as a group. Help has a Keyboard/Mouse tab list. |
| Tab                   | Sekme                      | One Grid, Page, Style, Keyboard, or Mouse choice.                              |
| Tab panel             | Sekme içerik paneli        | The content area associated with the active tab.                               |
| Active tab indicator  | Etkin sekme göstergesi     | The accent underline beneath the active tab.                                   |
| Grid density control  | Izgara yoğunluğu denetimi  | The Normal and Compact buttons.                                                |
| View switcher         | Görünüm değiştirici        | The mobile Input/Output switch. Its buttons expose their pressed state.        |
| Modified indicator    | Değişiklik göstergesi      | The small dot on the Style tab that indicates overrides or drafts.             |
| Unavailable indicator | Kullanılamazlık göstergesi | The crossed-out brush and explanation for a visible but unavailable Style tab. |

Grid density controls sit outside the tab list. The mobile view switcher uses buttons rather than tab roles.

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
| Validation message         | Doğrulama iletisi               | The error that replaces the hint for an invalid selection expression.                                    |

#### Repetition and blank pages

| English term             | Turkish equivalent           | UI element                                                                                |
| ------------------------ | ---------------------------- | ----------------------------------------------------------------------------------------- |
| Repetition control       | Tekrar sayısı denetimi       | The repetition field with decrease, increase, and reset buttons in the page actions menu. |
| Front alignment checkbox | Ön yüze hizalama onay kutusu | The “Start each repeat on front” choice.                                                  |
| Repeat button            | Tekrarlama düğmesi           | The “Repeat selected pages” button in the Output page actions menu.                       |
| Insert blank actions     | Boş sayfa ekleme işlemleri   | The choices that insert a Blank before the first selected page or at the end of Output.   |

### Grid

#### Cards and previews

| English term         | Turkish equivalent                | UI element                                                                                               |
| -------------------- | --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Thumbnail grid       | Küçük resim ızgarası              | The area that arranges page cards in rows and columns.                                                   |
| Page card            | Sayfa kartı                       | One complete card with its header, body, image, footer, and outer boundary.                              |
| Card header          | Kart üst alanı                    | The upper section with the page number, drag handle, and page face indicator.                            |
| Page number          | Sayfa numarası                    | The physical page position in the pane's sequence.                                                       |
| Page label           | Sayfa etiketi                     | A PDF-authored label shown alongside a different physical page number.                                   |
| Drag handle / Grip   | Sürükleme tutamacı                | The dotted handle in the card header. A click also selects or unselects the page.                        |
| Page face indicator  | Sayfa yüzü göstergesi             | The corner indicator that identifies the front or back side.                                             |
| Folded corner        | Katlanmış köşe                    | The curved corner that marks a back side.                                                                |
| Card body            | Kart gövdesi                      | The main image section between the header and footer.                                                    |
| Thumbnail frame      | Küçük resim çerçevesi             | The neutral area around the small page image.                                                            |
| Page thumbnail       | Sayfa küçük resmi                 | The small rendered PDF page image inside the frame.                                                      |
| Card footer          | Kart alt alanı                    | The section below the image that reserves space for card actions.                                        |
| Card actions         | Kart işlemleri                    | Input addition or Output removal and duplication buttons.                                                |
| Page details trigger | Sayfa ayrıntılarını açma denetimi | The interactive page number that opens page details.                                                     |
| Page details popover | Sayfa ayrıntı paneli              | Source details or Output-copy information. Compact also includes a larger preview and available actions. |
| Blank page preview   | Boş sayfa önizlemesi              | The content-free page appearance with a Blank or Padding label.                                          |

Grid is the view name. Input uses an HTML list, and Output uses an ordered list. The view name does not imply an ARIA
`grid` role.

#### Pagination

| English term         | Turkish equivalent               | UI element                                                               |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------ |
| Grid pagination      | Izgara sayfalaması               | The complete navigation area for thumbnail groups.                       |
| Pagination buttons   | Sayfalama düğmeleri              | The arrows that show the previous or next thumbnail group.               |
| Pagination slider    | Sayfalama kaydırıcısı            | The horizontal control that selects a thumbnail group directly.          |
| Batch counter        | Önizleme grubu sayacı            | The current group and total group count, such as `1 / 2`.                |
| Page range indicator | Görünen sayfa aralığı göstergesi | The visible physical page range and total page count, such as `1–6 / 7`. |

The pagination slider changes thumbnail groups. A scrollbar changes the visible position within content.

### Page

#### Header and controls

| English term              | Turkish equivalent                   | UI element                                                                                  |
| ------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| Page view                 | Page görünümü                        | The complete single-page viewer with its header, viewport, and bottom navigation.           |
| Page header               | Page üst alanı                       | The section with the page counter, optional grip, and page controls.                        |
| Page counter              | Sayfa sayacı                         | The current page and total page count, such as `1 / 7`.                                     |
| Go-to-page field          | Sayfaya gitme alanı                  | The page-number field that opens in place of the counter.                                   |
| Page controls             | Sayfa görüntüleme denetimleri        | The Compare, original-page, zoom, and Fit controls as a group.                              |
| Compare toggle            | Karşılaştırma düğmesi                | The button that switches between an Output page's original and completed styled appearance. |
| Show original page button | Özgün sayfayı gösterme düğmesi       | The button that opens the corresponding original Input page.                                |
| Zoom level indicator      | Yakınlaştırma düzeyi göstergesi      | The displayed zoom percentage, such as `100%`.                                              |
| Zoom in/out buttons       | Yakınlaştırma/uzaklaştırma düğmeleri | The + and − buttons that change the page-image scale.                                       |
| Fit page button           | Sayfayı sığdırma düğmesi             | The button that fits the page in the available area. PDF Composer displays Fit as `100%`.   |

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

| English term             | Turkish equivalent               | UI element                                                                          |
| ------------------------ | -------------------------------- | ----------------------------------------------------------------------------------- |
| Style profile selector   | Stil profili seçicisi            | The select above the Style groups, with profile choices such as Generic and Inkjet. |
| Profile description      | Profil açıklaması                | The description directly below the selected profile.                                |
| Style group / Disclosure | Stil grubu / Açılır-kapanır grup | A PDF-authored group, such as Watermark, Patterns, or Guides.                       |
| Group header             | Grup üst alanı                   | The row with the disclosure indicator, group title, description, and object count.  |
| Disclosure indicator     | Açılma-kapanma göstergesi        | The small arrow whose direction indicates the expanded or collapsed state.          |
| Object count badge       | Nesne sayısı rozeti              | The number of Style objects at the end of the group header.                         |
| Group content            | Grup içeriği                     | The objects and controls visible inside an expanded group.                          |
| Style object             | Stil nesnesi                     | The object associated with related Style controls, such as Stamp or Slants.         |
| Object heading           | Nesne başlığı                    | The object name and its description.                                                |

#### Quartet and property editors

| English term                  | Turkish equivalent                   | UI element                                                                                |
| ----------------------------- | ------------------------------------ | ----------------------------------------------------------------------------------------- |
| Quartet                       | Dörtlü denetim grubu                 | The complete Fill, Stroke, Width, and Visibility presentation for one Style object.       |
| Property trigger              | Özellik düzenleyicisini açma düğmesi | The control that opens a Fill, Stroke, Width, or Visibility editor.                       |
| Fill                          | Dolgu                                | The paint properties for an object's interior.                                            |
| Stroke                        | Kontur                               | The paint properties for an object's lines or outline.                                    |
| Stroke width                  | Kontur kalınlığı                     | The property that appears as Width in the Quartet.                                        |
| Visibility                    | Görünürlük                           | The object display control.                                                               |
| Paint duo                     | Renk ve opaklık ikilisi              | The combined color and opacity presentation within Fill or Stroke.                        |
| Color swatch                  | Renk örneği                          | The small square that shows a color value.                                                |
| Opacity indicator             | Opaklık göstergesi                   | The small visual indicator that represents opacity with a fill level.                     |
| Value readout                 | Değer göstergesi                     | A displayed hex color, percentage, millimeter value, or value-state text.                 |
| Visibility toggle             | Görünürlük anahtarı                  | The Show/Hide control in the Quartet. It is a checkbox with a switch appearance.          |
| Inline editor                 | Satır içi düzenleyici                | The editor that expands below the selected Quartet property within the content flow.      |
| Information button            | Bilgi düğmesi                        | The ⓘ control that opens parameter details.                                               |
| Parameter information popover | Parametre bilgi paneli               | The panel with the parameter ID, baseline, Input scope, Output coverage, and constraints. |
| Field reset button            | Alanı sıfırlama düğmesi              | The ↺ control that removes an explicit value for one parameter.                           |
| Reset all styles button       | Bütün stilleri sıfırlama düğmesi     | The reset control in the Style toolbar.                                                   |
| Value state indicator         | Değer durumu göstergesi              | Original state, Explicit override, Mixed, `—`, or Invalid information.                    |
| Not-applicable indicator      | Uygulanamazlık göstergesi            | The hatching and prohibition symbol for a property without a declared parameter.          |
| Cancel processing button      | İşlem iptal düğmesi                  | The “Cancel style processing” button.                                                     |

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
| Tick marks                      | Kademe işaretleri              | The marks that indicate group positions on the Grid pagination slider.                          |

#### Buttons and supporting text

| English term       | Turkish equivalent     | UI element                                                                     |
| ------------------ | ---------------------- | ------------------------------------------------------------------------------ |
| Icon button        | İkon düğmesi           | A button with a visible icon instead of text.                                  |
| Toggle button      | Durum düğmesi          | A button with a persistent pressed state, such as Compare or a density choice. |
| Primary button     | Birincil işlem düğmesi | An emphasized action, such as Download or the main addition button.            |
| Destructive button | Silme/kaldırma düğmesi | A button with danger colors for an action such as removal.                     |
| Tooltip            | Araç ipucu             | A short explanation that appears after a pointer pause over an element.        |

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
| Download dialog                   | İndirme iletişim kutusu                 | The download preparation, error, Cancel, and Retry interface.                             |
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
| Status message              | Durum iletisi                         | Progress, result, or cancellation information in the status bar. SPEC calls this Info. |
| Error banner                | Hata bandı                            | A persistent general error area above the workspace content.                           |
| Inline error message        | Alan içi hata iletisi                 | Local error text beside selection, Style, or page preview content.                     |
| Dismiss button              | Bildirimi kapatma düğmesi             | The × control within a notice or error message.                                        |
| Loading indicator / Spinner | Yükleme göstergesi                    | The ring visible during PDF preview or processing.                                     |
| Loading status              | Yükleme durum alanı                   | The explanation and Cancel action during PDF opening.                                  |
| Processing status           | İşleme durum alanı                    | Information such as “Updating PDF…” in the Download action area.                       |
| Empty state                 | Boş durum görünümü                    | Explanatory content such as “Your Output starts here.”                                 |
| Operation highlight         | İşlem vurgusu                         | Temporary emphasis after addition, movement, or removal.                               |
| Page transfer animation     | Sayfa aktarım animasyonu              | A page or stack moving toward Output after addition or during first-addition guidance. |
| Offline/update status       | Çevrimdışı kullanım/güncelleme durumu | Offline installation and update messages, with the Update application button.          |

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

| English example                                         | Turkish example                                        | Element path                                           |
| ------------------------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------ |
| The hint below the Input selection bar.                 | Input seçim çubuğunun yardım metni.                    | Input selection bar → Selection hint                   |
| The duplicate button in the Output card footer.         | Output kartının alt alanındaki çoğaltma düğmesi.       | Output page card → Card footer → Duplicate button      |
| The background of the Page viewport.                    | Page viewport’unun arka planı.                         | Page view → Viewport background                        |
| The hex color field in the Stamp Quartet's Fill editor. | Stamp Quartet’inin Fill düzenleyicisindeki renk alanı. | Stamp → Quartet → Fill inline editor → Hex color field |

### References

#### Project documents and components

| Reference                                                                                                                                          | Responsibility                                                             |
| -------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| [Web SPEC](SPEC.md) and [glossary](SPEC.md#glossary)                                                                                               | Workspace behavior and product terminology.                                |
| [Design rules](#tokens-and-assets)                                                                                                                 | Visual rules and layout references.                                        |
| [App](../src/App.svelte), [Landing](../src/Landing.svelte), and [Theme](../src/Theme.svelte)                                                       | Application shell, pane header controls, landing page, and theme control.  |
| [Composer](../src/Composer.svelte) and [Repetition](../src/Repetition.svelte)                                                                      | Panes, view controls, selection bars, page actions, and repetition.        |
| [Grid](../src/Grid.svelte), [Page](../src/Page.svelte), [Counter](../src/Counter.svelte), [Pdf](../src/Pdf.svelte), and [Lens](../src/Lens.svelte) | Thumbnail pagination, page viewer, page entry, page images, and magnifier. |
| [Style](../src/Style.svelte), [Quartet](../src/Quartet.svelte), and [Control](../src/Control.svelte)                                               | Profiles, groups, Style objects, property summaries, and editors.          |
| [Help](../src/Help.svelte) and [Settings](../src/Settings.svelte)                                                                                  | Help, welcome, Product tour, and Settings.                                 |
| [Offline](../src/Offline.svelte) and [drag](../src/drag.ts)                                                                                        | Offline/update status and drag images.                                     |

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
