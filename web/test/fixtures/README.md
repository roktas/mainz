# Prepared PDF sample

[demo.pdf](demo.pdf) contains four Pages from Megic's Ital Winters 7.9 mm A4 series. PDF Composer's `?demo` mode opens
it in development and production. The sample downloads on first use and then works offline when its optional cache is
available.

The Pages are the cover, `ital-guid-79a4-wxgx`, full-sheet CROS (`ital-cros-79a4-wxgf`), and partial CROS
(`ital-cros-79a4-wxgr`), in that order. Output starts with `1,2,3,4,3,4,3,4`. Repetitions expose no additional Book
content.

The page names are `COVER`, `ITAL-GUID-79A4-WXGX`, `ITAL-CROS-79A4-WXGF`, and `ITAL-CROS-79A4-WXGR`. The standard XMP
`dc:title` is `Italic Strokes`; the legacy Info title agrees with it. These fields describe the Input without
duplicating the title in the manifest. The sample has no PNG previews. Browser tests use the shared fixture builder for
unnamed capacity, metadata-only, and PNG cases.

The sample has ten Style objects and 39 parameters for the cover, patterns, guide lines, header, and the SAMPLE
watermark. Cover controls the ribbon and motifs, with saved fill color `#A0892C`. Text stays fixed. Pattern fills start
transparent and remain editable. Marks and Frame remain fixed. Embedded Outlined, Filled, Outlined+, and Filled+
profiles include short descriptions and longer `details` with printer guidance. Their IDs remain `generic`, `inkjet`,
`generic+`, and `inkjet+`. Opening the sample preserves its saved appearance. Outlined restores the sample's unfilled
patterns. Filled uses 0.04 mm thin guides and soft blue (`#6B7F99`) Pattern and Repeats fills at 40% opacity. The Style
groups appear in this order: Cover, Patterns, Guides, Margins, Watermark. Margins contains Header.

Every parameter declares Style family `megic` and an explicit semantic key from the authored sample declaration. Profile
sets also declare family `megic`. Publication can rename local parameter IDs while retaining those keys. The four-page
sample supports contract-based profile selection and parameter edits across compatible open files.

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
requires exact original/reset raster equality at 150/300 DPI. The separate Cairo Filled reference permits a maximum
24/255 difference in 0.001% of raster channels. That bound permits subpixel differences from re-export while retaining
exact protected-content comparisons. Vite copies this maintained fixture into the application assets on each start or
build.

## Grid fixture

Grid demo contains 240 physical pages: 60 repetitions of the four pages in `demo.pdf`. Its maintained Plan and Input
bindings are [`grid-plan.json`](grid-plan.json) and [`grid-inputs.json`](grid-inputs.json).
[`VIEW.md`](../../doc/VIEW.md#workspace) defines the single Normal card geometry and scrollable Grid frame.

If `.local/tmp/web/grid/sample.pdf` is absent, run these commands from the repository root after building the native
CLI:

```sh
mkdir -p .local/tmp/web/grid
.local/var/cpp/build/native/mainz compose web/test/fixtures/grid-plan.json --inputs web/test/fixtures/grid-inputs.json --output .local/tmp/web/grid/sample.pdf > .local/tmp/web/grid/provenance.json
```

After rebuilding `demo.pdf`, rebuild `sample.pdf` too. With the development server running, open
`http://127.0.0.1:5173/?demo=grid`. Add `&input=page` or `&output=page` to compare Grid with Page. Production and
offline startup execute the same Plan in the browser, using the downloaded four-page PDF. The 240-page PDF stays outside
production assets and the offline cache. The examples dialog lists it second as Large demo.

## Geometry collection and calibration

See [MEMO](../../doc/MEMO.md#collection-and-calibration) for the shared probe, native Simulator acquisition, desktop
references, calibration commands, and evidence retention. [VIEW](../../doc/VIEW.md#grid-and-page) owns visual acceptance
limits.

## Recipe fixture

`?demo=recipe` opens [`recipe/session.json`](recipe/session.json) for Input matching. The example offers its JSON and
PDFs as downloads and can select the sample PDFs through Sample PDFs. The `book` binding reuses `demo.pdf`.
[`recipe/guides.pdf`](recipe/guides.pdf) contains its physical pages 2–4; its title is `Guide sheets` and its cover is
page 1. [`recipe/crossings.pdf`](recipe/crossings.pdf) contains physical pages 3–4; its title is `Crossing strokes` and
its cover is page 2. Both use short XMP `dc:title` and PDF Info `Title` values, with longer text in XMP
`dc:description`. The Recipe retains both fields and matching file digests. `Italic Strokes` has no description, for
comparison. Both are native compositions with empty complete overrides and explicit Plan metadata, followed by a QPDF
metadata update for the descriptions. They retain the SAMPLE watermark and editable practice content.

The Recipe contains three independent logical Inputs, each with a saved title, XMP fields, digest, and embedded PNG
cover. Output contains the original cover and the first page from each derived PDF. Its title is `Practice session`.
After rebuilding the PDFs, open the Recipe demo, choose the replacement files, and export a new Recipe to refresh the
digests and covers. Keep the logical IDs `book`, `guides`, and `crossings` so the demo's sample bindings remain valid.

## TOC samples

[`toc/bash.pdf`](toc/bash.pdf) is Mendel Cooper's complete _Advanced Bash-Scripting Guide_, revision 10 (2014), from
[The Linux Documentation Project](https://tldp.org/LDP/abs/abs-guide.pdf). It contains 916 pages, 38 chapters, and 156
outline entries across three levels. Examples include Chapter 9 → Section 9.2 → Subsection 9.2.1, and Chapter 10 →
Section 10.1 → Subsections 10.1.1 and 10.1.2. Chapters without children, appendices, tables, and code examples provide
other realistic List cases. The author explicitly places the work in the
[public domain](https://tldp.org/LDP/abs/html/copyright.html).

The source PDF has duplicate resource dictionary keys. QPDF 12.4.2 normalizes these dictionaries and compresses object
storage. All 916 page content streams, page boxes, and outline titles and destinations remain unchanged. No text,
headings, or layout are authored for the demo. Output starts with pages from third-level outline entries to expose
multilevel headers and repeated occurrences.

To refresh this fixture, download the pinned source and normalize it:

```sh
mkdir -p .local/tmp/web
curl -fL https://tldp.org/LDP/abs/abs-guide.pdf -o .local/tmp/web/abs-guide.pdf
printf '%s  %s\n' 'e36fca77351b221715567db4700cdb0041c8558d8db5c022e5dc2e2d35be4199' '.local/tmp/web/abs-guide.pdf' | sha256sum --check
qpdf --warning-exit-0 --deterministic-id --object-streams=generate .local/tmp/web/abs-guide.pdf web/test/fixtures/toc/bash.pdf
qpdf --check web/test/fixtures/toc/bash.pdf
```

[`toc/bridge.pdf`](toc/bridge.pdf) contains Ambrose Bierce's complete _An Occurrence at Owl Creek Bridge_ (1890), with
its three original sections, in 13 pages. The text comes from
[Project Gutenberg #375](https://www.gutenberg.org/ebooks/375), which lists the work as public domain in the USA. The
reading PDF omits Gutenberg branding and license boilerplate.

Both PDFs include printed contents, linked PDF outlines, and standard document metadata. Neither adds authored page
names. Each PDF is smaller than the 2 MiB demo budget. [`toc/sources.json`](toc/sources.json) retains the Bierce text,
source URLs, and source hashes. Source attribution remains in each PDF. New layout contributions to the Bierce PDF are
dedicated to the public domain under CC0-1.0.

Run the deterministic Bierce builder from the repository root:

```sh
uv run --with reportlab==5.1.0 web/test/fixtures/toc/build.py
```

The builder reads only retained inputs and requires no network access after its dependencies are installed. After a
rebuild, inspect the outlines with QPDF and render the pages with Poppler. Make sure that headings, contents links, and
page numbers remain correct before replacing the fixtures.

## Download and storage budget

All demo PDFs and Recipes stay outside the offline installation manifest. Vite publishes them as optional static files.
The application downloads each file only when a user opens its demo or requests its sample PDFs. A separate cache
retains only the current catalog's hash-matched files, up to 4 MiB in total. Application updates retain unchanged
examples and remove changed or retired hashes. New downloads bypass the HTTP cache. A fresh offline installation cannot
open a demo that has not been downloaded. The build rejects PDFs above 2 MiB and Recipes above 1 MiB. Large demo repeats
the shared four-page sample in the browser.
