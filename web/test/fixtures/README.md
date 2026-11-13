# Demo fixtures

Lorem owns the sample sources and production instructions. Mainz keeps selected, versioned outputs for demos, browser
tests, and offline use. These copies come from Lorem revision `7790efa`. The sibling
[Lorem catalog](../../../../lorem/README.md) describes their producers.

Mainz-specific synthetic fixtures and contract/error scenarios stay in Mainz. They are independent of the reusable demo
collection.

| Fixture                                            | Lorem sample            | Use                                             |
| -------------------------------------------------- | ----------------------- | ----------------------------------------------- |
| [known-ghost.pdf](known-ghost.pdf)                 | `known-ghost`           | Single demo, Empty demo, and prepared-PDF tests |
| [toc/lorem-ipsum.pdf](toc/lorem-ipsum.pdf)         | `lorem-ipsum`           | TOC demo and TOCs demo                          |
| [toc/light-burro.pdf](toc/light-burro.pdf)         | `light-burro`           | TOCs demo                                       |
| [recipe/brave-shark.pdf](recipe/brave-shark.pdf)   | `brave-shark`           | Recipe demo's `guides` Input                    |
| [recipe/perky-mamba.pdf](recipe/perky-mamba.pdf)   | `perky-mamba`           | Recipe demo's `crossings` Input                 |
| [recipe/legal-finch.json](recipe/legal-finch.json) | `legal-finch`           | Recipe demo                                     |
| [large-mouse.json](large-mouse.json)               | `large-mouse/plan.json` | Large demo's runtime Plan                       |

## Refresh copies

Rebuild the required samples in Lorem. From the Mainz root, copy their published files:

```sh
cp ../lorem/known-ghost/known-ghost.pdf web/test/fixtures/
cp ../lorem/lorem-ipsum/lorem-ipsum.pdf web/test/fixtures/toc/
cp ../lorem/light-burro/light-burro.pdf web/test/fixtures/toc/
cp ../lorem/brave-shark/brave-shark.pdf web/test/fixtures/recipe/
cp ../lorem/perky-mamba/perky-mamba.pdf web/test/fixtures/recipe/
cp ../lorem/legal-finch/legal-finch.json web/test/fixtures/recipe/
cp ../lorem/large-mouse/plan.json web/test/fixtures/large-mouse.json
mkdir -p .local/var/fixtures
cp ../lorem/large-mouse/large-mouse.pdf .local/var/fixtures/large-mouse.pdf
```

Record the supplying Lorem revision when refreshing copies. If an input PDF changes, rebuild and copy `legal-finch` too
so its digests and covers match. Keep its logical IDs `book`, `guides`, and `crossings`. Run the asset publication, demo
startup, offline, and Recipe browser checks after a refresh.

## Demo behavior

Single demo opens four prepared pages with Output ordered `1,2,3,4,3,4,3,4`. It retains ten Style objects, 39
parameters, and Outlined, Filled, Outlined+, and Filled+ profiles. Browser tests use their shared fixture builder for
unnamed capacity, metadata-only, and PNG cases.

Large demo contains 240 pages. Development serves the native copy at `.local/var/fixtures/large-mouse.pdf`. Production
and offline startup execute the same Plan in the browser using `known-ghost.pdf`, with no large PDF in the published
assets or offline cache. Open `?demo=grid`; use `&input=page` or `&output=page` to compare views.
[VIEW](../../doc/VIEW.md#grid-and-page) owns layout acceptance, and [MEMO](../../doc/MEMO.md#collection-and-geometry)
owns geometry acquisition and evidence.

Recipe demo offers the JSON and three sample PDFs for matching. Input records include titles, XMP fields, digests, and
covers. The two derived PDFs have long descriptions; the retained four-page snapshot has no description, for comparison.
Output contains the first page from each Input with title `Practice session` and cover page 1.

TOC demo uses the 42-page ConTeXt Lorem Ipsum PDF with 40 outline entries across three levels and 40 links. Its first
page is named Cover through a metadata-only Mainz manifest. TOCs demo also loads Bierce's complete 13-page story, with
three original sections and no authored page names. Both have linked printed contents and PDF outlines.

## Download and storage budget

Vite publishes the fixtures as optional static files. They stay outside the offline installation manifest. The
application downloads each file only when its demo or sample download is requested. Each PDF is at most 2 MiB, each
Recipe at most 1 MiB, and the complete optional catalog at most 4 MiB. A separate cache retains only current,
hash-matched catalog files. Updates retain unchanged examples, replace changed ones, and remove retired entries. See
[SPEC](../../doc/SPEC.md#demo) for the offline contract.
