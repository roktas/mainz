# Italic Strokes

`dolor.pdf` contains four A4 pages from Megic's Ital Winters 7.9 mm series: the cover, `ital-guid-79a4-wxgx`,
`ital-cros-79a4-wxgf`, and `ital-cros-79a4-wxgr`. Its title is `Italic Strokes`.

The PDF has ten Style objects and 39 editable parameters. Groups are Cover, Patterns, Guides, Margins, and Watermark.
Profiles are Outlined, Filled, Outlined+, and Filled+, with IDs `generic`, `inkjet`, `generic+`, and `inkjet+`. Pattern
fills start transparent. Filled uses soft blue `#6B7F99` fills at 40% opacity and 0.04 mm guides. Cover exposes ribbon
and motif fill color `#A0892C`. Text, Marks, and Frame stay fixed.

`dolor.svg` and `dolor.json` define the distressed SAMPLE stamp. Fill color and opacity are editable on all four pages.
The frame and letter outlines stay fixed. Page names are `COVER` and the three uppercase sheet codes.

## Production

Use the explicit `dolor` task in the [demo guide](../README.md#explicit-production). `dolor.rb` renders the four
selected pages through Megic and Sevgi. The native Mainz CLI verifies the resulting prepared PDF. The script accepts
Megic and CLI paths, plus an optional output path for integration checks.

Megic's `test/integration/sample.rb` compares profile edits, protected content, reset, and watermark outlines against
independent exports at 150 and 300 DPI. Independent reference PDFs remain beside the generated output under `.local/`.
Current Megic uses larger sheet labels than the retained snapshot. Review this difference before replacing fixtures. The
recorded source revisions are Megic `61e08b4` and Sevgi `0401d38`.

Mainz uses dolor for Single, Empty, Style tests, and the other practice samples. Keep Megic's authored rights metadata.
