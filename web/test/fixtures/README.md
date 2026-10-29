# Prepared PDF sample

[demo.pdf](demo.pdf) contains four Pages from Megic's Ital Winters 7.9 mm A4 series. PDF Composer's `?demo` mode opens
it in development, production, and offline after application installation.

The Pages are the cover, `ital-guid-79a4-wxgx`, full-sheet CROS (`ital-cros-79a4-wxgf`), and partial CROS
(`ital-cros-79a4-wxgr`), in that order. Output starts with `1,2,3,4,3,4,3,4`. Repetitions expose no additional Book
content.

The sample has nine Style objects and 35 parameters for the cover, patterns, guide lines, and the SAMPLE watermark.
Cover controls the ribbon and motifs, with saved fill color `#A0892C`. Text stays fixed. Pattern fills start at
`#999999` with 40% opacity and remain editable. Marks and Frame remain fixed. Embedded Generic and Inkjet profiles
provide named style choices. Opening the sample preserves its saved appearance. Generic restores the sample's gray
pattern fills. Inkjet uses 0.04 mm thin guides and soft blue (`#6B7F99`) Pattern and Partial Pattern fills at 40%
opacity. The Style groups appear in this order: Cover, Patterns, Guides, Watermark.

The Watermark Style object controls the small, distressed red SAMPLE stamp at the center of all four pages, including
the cover. Its fill color and opacity remain editable. Visibility is unavailable. Its frame and letter outlines stay
fixed and visible outside the editable targets. Megic maintains the vector source and declaration in
`test/integration/watermark.svg` and `test/integration/watermark.json`.

## Rebuild

Build the native Mainz CLI and install Megic's Ruby dependencies first. The script renders only the cover SVG and the
three permitted practice Pages. It requires no full Book PDF. Run from the sibling Megic checkout, on `main`:

```sh
direnv exec . env PATH="$PWD/../mainz/.local/var/cpp/build/native:$PATH" bundle exec ./test/integration/sample.rb . ../mainz/.local/var/cpp/build/native/mainz
cp .local/sample/demo.pdf ../mainz/web/test/fixtures/demo.pdf
```

The script checks the contract, saved overrides, reset, and protected content with independent HexaPDF inspection. It
also compares the fixed watermark outline with an independent SVG export after setting fill opacity to zero. Poppler
requires exact original/reset raster equality at 150/300 DPI. The separate Cairo Inkjet reference permits a maximum
24/255 difference in 0.001% of raster channels. That bound permits subpixel differences from re-export while retaining
exact protected-content comparisons. Vite copies this maintained fixture into the application assets on each start or
build.

## Grid fixture

Grid demo contains 240 physical pages: 60 repetitions of the four Pages in `demo.pdf`. Its maintained Job and Input
bindings are [`grid-job.json`](grid-job.json) and [`grid-inputs.json`](grid-inputs.json).
[`VIEW.md`](../../doc/VIEW.md#workspace) defines Normal and Compact geometry and expected desktop capacities.

If `.local/tmp/web/grid/sample.pdf` is absent, run these commands from the repository root after building the native
CLI:

```sh
mkdir -p .local/tmp/web/grid
.local/var/cpp/build/native/mainz compose web/test/fixtures/grid-job.json --inputs web/test/fixtures/grid-inputs.json --output .local/tmp/web/grid/sample.pdf > .local/tmp/web/grid/report.json
```

After rebuilding `demo.pdf`, rebuild `sample.pdf` too. With the development server running, open
`http://127.0.0.1:5173/?demo=grid`. Add `&input=page` or `&output=page` to compare Grid with Page. Production and
offline startup execute the same Job in the browser, using the bundled four-page PDF. The 240-page PDF stays outside
production assets and the offline cache. The examples dialog lists Grid demo second.

## Geometry collection and calibration

See [MEMO](../../doc/MEMO.md#collection-and-calibration) for the shared probe, native Simulator acquisition, desktop
references, calibration commands, and evidence retention. [VIEW](../../doc/VIEW.md#grid-and-page) owns visual acceptance
limits.
