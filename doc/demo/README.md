# Demo sources

This directory retains optional production sources for Mainz demos. Normal builds, tests, and runtime use the versioned
outputs in [web/test/fixtures](../../web/test/fixtures/README.md). They never load this Rakefile or require its
producers. Remake a sample only on request. A source change alone does not refresh an application fixture.

## Samples

| Sample                   | Purpose                                                    | Output       |
| ------------------------ | ---------------------------------------------------------- | ------------ |
| [dolor](dolor/README.md) | Four editable Italic Strokes pages with a SAMPLE watermark | `dolor.pdf`  |
| [minim](minim/README.md) | Guide and practice pages from dolor                        | `minim.pdf`  |
| [culpa](culpa/README.md) | Two crosshatch pages, a distinct third Recipe Input        | `culpa.pdf`  |
| [magna](magna/README.md) | Sixty repetitions of dolor, 240 pages                      | `magna.pdf`  |
| [nulla](nulla/README.md) | Three-input practice session Recipe                        | `nulla.json` |
| [lorem](lorem/README.md) | 42-page illustrated reading sample with nested contents    | `lorem.pdf`  |
| [ipsum](ipsum/README.md) | 11-page illustrated reading sample with three chapters     | `ipsum.pdf`  |

Each sample uses its directory name for its primary sources and output. The practice PDFs retain their authored titles
and rights metadata. The reading documents use lorem ipsum throughout, including titles, headings, and running heads.
Their headings use a fixed selection of placeholder words. Remakes do not randomize them.

## Explicit production

Run from the Mainz root. Use the existing Ruby bundle and a built native CLI:

```sh
direnv exec . bundle exec rake -f doc/demo/Rakefile -T
direnv exec . bundle exec rake -f doc/demo/Rakefile lorem ipsum
direnv exec . bundle exec rake -f doc/demo/Rakefile install
```

The default task prints guidance without production. Named tasks remake only those samples. `install` copies completed
outputs into the application fixtures without running producers. It leaves fixtures without a completed replacement
unchanged. Review outputs before installation. If a Recipe Input changes, remake `nulla` before installing it.

To explicitly remake the entire collection and then install it:

```sh
direnv exec . bundle exec rake -f doc/demo/Rakefile remake
direnv exec . bundle exec rake -f doc/demo/Rakefile install
```

The `remake` task orders dolor, its derivatives, nulla, and the reading samples. Individual derivative tasks use a
completed PDF under `.local/var/demo/` when available. Otherwise, they use the retained application fixture.

Completed outputs stay under `.local/var/demo/<name>/<name>.*`. ConTeXt intermediates stay under `.local/tmp/demo/`.
Practice producers retain intermediate PDFs and independent appearance references under `.local/var/demo/`. The install
task also copies `magna.json` into the fixtures and `magna.pdf` into `.local/var/fixtures/` for native geometry
collection. No large PDF enters the production assets or offline cache.

## Optional tools

- Reading samples: ConTeXt LMTX with EB Garamond, QPDF, and the native Mainz CLI for lorem's metadata-only manifest.
- Practice samples and Recipe: sibling Megic and Sevgi checkouts with Megic's locked Bundler environment and renderer.
- Recipe covers: Poppler's `pdftoppm`.
- Magna: the native Mainz CLI and QPDF. It needs no renderer when the retained dolor PDF is available.

`MAINZ_CLI` selects a different native executable. `MEGIC` selects a different Megic checkout. No task installs tools or
updates dependencies. The reading samples were rendered with ConTeXt `2026.07.06 13:29` and LuaMetaTeX `2.11.09`. The
reading sample producer removes the optional creation and modification dates from the PDF Info dictionary.

## Review and rights

The practice snapshots retain Megic's source drawings and rights information. Keep that information in derivative
outputs. Renderer revisions can change appearance and PDF bytes.

The owner supplied both cover PNGs. Lorem's scan shows _Biblia Pauperum_, reproduced in Joseph Cundall's _A Brief
History of Wood-engraving_ (1895). Ipsum's scan shows a historical woodcut with a figure in a tree. Keep the supplied
images unchanged. This collection grants no additional rights to supplied artwork or Megic material. New reading layout
and placeholder-text sources are CC0-1.0.

After a remake, make sure that page counts, outlines, contents links, metadata, and the demo size budgets remain
correct. Render covers, contents, chapter openings, continuation pages, and final pages with Poppler for visual review.
After installation, run asset publication, demo startup, offline, and Recipe browser checks.
