# Prepared PDF sample

[demo.pdf](demo.pdf) contains the cover and six practice Pages from Megic's Ital Winters 7.9 mm A4 Book. PDF Studio's
`?demo` mode opens it in development, production, and offline after application installation.

The sample has eight Style objects and 35 parameters for patterns, guide lines, and the SAMPLE watermark. Pattern fills
start at `#999999` with 40% opacity and remain editable. Marks and Frame remain fixed. Embedded Generic and Inkjet
profiles provide named style choices. Opening the sample preserves its saved appearance. Generic restores the sample's
gray pattern fills. Inkjet uses 0.04 mm thin guides and soft blue (`#6B7F99`) Pattern and Partial Pattern fills at 40%
opacity. The Style groups appear in this order: Patterns, Guides, Watermark.

The Stamp Style object controls the small, distressed red SAMPLE stamp at the center of all seven pages, including the
cover. Its fill color and opacity remain editable. The visibility control hides only the fill. Its frame and letter
outlines stay fixed and visible. Megic maintains the vector source and declaration in `test/integration/watermark.svg`
and `test/integration/watermark.json`.

## Rebuild

Build the native Mainz CLI and install Megic's Ruby dependencies first. The script uses Megic's existing
`ital-book-79a4-wxaa` PDF for the cover. Run from the sibling Megic checkout, on `main`:

```sh
direnv exec . env PATH="$PWD/../mainz/.local/var/cpp/build/native:$PATH" bundle exec ./test/integration/sample.rb . ../mainz/.local/var/cpp/build/native/mainz
cp .local/sample/demo.pdf ../mainz/web/test/fixtures/demo.pdf
```

The script checks the contract, saved overrides, reset, and protected content with independent HexaPDF inspection. It
also compares the fixed watermark outline with an independent SVG export after hiding its fill. Poppler requires exact
original/reset raster equality at 150/300 DPI. The separate Cairo Inkjet reference permits a maximum 24/255 difference
in 0.001% of raster channels. That bound permits subpixel differences from re-export while retaining exact
protected-content comparisons. Vite copies this maintained fixture into the application assets on each start or build.

## Grid fixture

The development Grid sample composes 240 physical pages from `demo.pdf`. Its maintained Job and Input bindings are
[`grid-job.json`](grid-job.json) and [`grid-inputs.json`](grid-inputs.json).
[`DESIGN.md`](../../doc/DESIGN.md#workspace) defines Normal and Compact geometry and expected desktop capacities.

If `.local/tmp/web/grid/sample.pdf` is absent, run these commands from the repository root after building the native
CLI:

```sh
mkdir -p .local/tmp/web/grid
.local/var/cpp/build/native/mainz compose web/test/fixtures/grid-job.json --inputs web/test/fixtures/grid-inputs.json --output .local/tmp/web/grid/sample.pdf > .local/tmp/web/grid/report.json
```

Reuse an existing `sample.pdf`. With the development server running, open `http://127.0.0.1:5173/?demo=grid`. Add
`&input=page` or `&output=page` to compare Grid with Page. The fixture stays outside production assets and the offline
cache. Both densities remain available in production with local PDFs and the bundled seven-page demo.
