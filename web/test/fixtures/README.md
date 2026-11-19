# Demo fixtures

Mainz retains versioned outputs for demos, browser tests, and optional offline use. The
[demo sources](../../../doc/demo/README.md) retain optional producers for explicit remakes. Normal builds, tests, and
runtime require none of those sources or producer tools. Mainz-specific synthetic fixtures and contract/error scenarios
remain separate.

| Fixture                                | Producer | Use                                             |
| -------------------------------------- | -------- | ----------------------------------------------- |
| [dolor.pdf](dolor.pdf)                 | `dolor`  | Single demo, Empty demo, and prepared-PDF tests |
| [toc/lorem.pdf](toc/lorem.pdf)         | `lorem`  | TOC demo and TOCs demo                          |
| [toc/ipsum.pdf](toc/ipsum.pdf)         | `ipsum`  | TOCs demo                                       |
| [recipe/minim.pdf](recipe/minim.pdf)   | `minim`  | Recipe demo's `guides` Input                    |
| [recipe/culpa.pdf](recipe/culpa.pdf)   | `culpa`  | Recipe demo's `crossings` Input                 |
| [recipe/nulla.json](recipe/nulla.json) | `nulla`  | Recipe demo                                     |
| [magna.json](magna.json)               | `magna`  | Large demo's runtime Plan                       |

## Refresh copies

Follow the [explicit production steps](../../../doc/demo/README.md#explicit-production). Remake only the requested
samples. Review the completed outputs, then run the separate `install` task. If a Recipe Input changes, remake nulla
before installation so its references and covers match. Keep its logical IDs `book`, `guides`, and `crossings`. Run
asset publication, demo startup, offline, and Recipe browser checks after a refresh.

## Demo behavior

Single demo opens four prepared pages with Output ordered `1,2,3,4,3,4,3,4`. It retains ten Style objects, 39
parameters, and Outlined, Filled, Outlined+, and Filled+ profiles. Browser tests use their shared fixture builder for
unnamed capacity, metadata-only, and PNG cases.

Large demo contains 240 pages. Development serves `.local/var/fixtures/magna.pdf`. Production and offline startup
execute the same Plan in the browser using dolor, without publishing or caching a large PDF. Open `?demo=grid`; use
`&input=page` or `&output=page` to compare views. The [GUI contract](../../../doc/spec/gui.md#grid-and-page) owns layout
acceptance. The [test guide](../../../doc/test.md#collection-and-geometry) owns geometry acquisition and evidence.

Recipe demo offers the JSON and three distinct PDFs for matching. Input records include titles, XMP fields, digests, and
covers. The two derived PDFs have long descriptions; the retained four-page snapshot has no description. Output contains
the first page from each Input with title `Practice session` and cover page 1.

TOC demo uses the 42-page Lorem Ipsum PDF with 40 outline entries across three levels and 40 contents links. A
metadata-only Mainz manifest names its first page Cover. TOCs demo also loads the 11-page Ipsum Dolor PDF with three
chapter outlines and no authored page names. Both use EB Garamond and the owner-supplied cover PNGs. All authored
reading text is lorem ipsum, including headings.

## Download and storage budget

Vite publishes these fixtures as optional static files. They stay outside the offline installation manifest. The
application downloads each file only when its demo or sample download is requested. Each PDF is at most 2 MiB, each
Recipe at most 1 MiB, and the complete optional catalog at most 4 MiB. A separate cache retains only current,
hash-matched catalog files. Updates retain unchanged examples, replace changed ones, and remove retired entries. The
[workspace contract](../../../doc/spec/web.md#demo) owns this offline behavior.
