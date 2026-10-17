# Mainz Agent Instructions

## Before editing

Use outlines and links to find context-relevant sections in the documents that own the affected behavior. Read only
those sections. Unless the task scope or document content changes, reuse sections already in context.

Use the owner table to locate the relevant document:

| Change                                                        | Owner                           |
| ------------------------------------------------------------- | ------------------------------- |
| PDF contract, processor, native/WASM boundary, SVG production | [Library SPEC](lib/doc/SPEC.md) |
| Commands, request files, diagnostics, output installation     | [CLI SPEC](cli/doc/SPEC.md)     |
| Workspace behavior and product vocabulary                     | [Web SPEC](web/doc/SPEC.md)     |
| Visual rules, focus, motion, layout references, UI anatomy    | [Web DESIGN](web/doc/DESIGN.md) |

Keep each rule in its owning document. Record shared tokens and required layout references. Keep implementation details
and animation keyframes in source files. Maintain product terms in the [library glossary](lib/doc/SPEC.md#glossary) and
[web glossary](web/doc/SPEC.md#glossary). Maintain UI element names in the [UI glossary](web/doc/DESIGN.md#ui-glossary).

## Documentation alignment

Before a commit or final handoff, review the final diff. Align context-relevant documentation in one pass. Update owning
documents only for durable changes to behavior, contracts, terminology, design rules, or workflows. If current
documentation already describes the final change, leave it unchanged.

## Ownership and layout

| Path                       | Responsibility                                                                    |
| -------------------------- | --------------------------------------------------------------------------------- |
| `lib/src/`                 | One C++20/QPDF processor for native and WASM.                                     |
| `lib/src/processor/`       | PDF validation, styling, page operations, and composition internals.              |
| `lib/src/producer/`        | Native source selection, SVG rendering, and prepared-PDF production.              |
| `cli/src/command/`         | CLI commands. Shared file policy belongs in `cli/src/command.*`.                  |
| `web/src/`                 | Workspace state, widgets, and worker hosts.                                       |
| Component `test/*_test.rb` | Ruby Minitest suites, with automation in the single root `Rakefile`.              |
| `.local/src/`              | Dependency source checkouts.                                                      |
| `.local/var/`              | Installed dependencies, build trees, packages, caches, and retained measurements. |
| `.local/tmp/`              | Disposable test output, rasters, reviews, and mockups.                            |
| `.local/bin/`              | One-off executable scripts.                                                       |

The processor imports no producer or consuming-application code. Mainz imports neither Sevgi nor Megic. Sevgi owns the
generic Style DSL and export integration. Megic owns publication policy and parameter semantics. Their real integration
scenarios stay in their consuming repositories.

Keep maintained inputs in Git and generated local files under root `.local/`. Components share that tree. Removing
`.local/var/` can require installation or rebuilding. Removing `.local/tmp/` discards only disposable output.

## Build and validation

Run commands from the repository root. Required tools:

- Native: CMake 3.25+, Clang/clang-tidy/clang-format 22+, QPDF 12.4.2, and pkg-config.
- SVG producer: Cairo, librsvg, libxml2, Pango, and Fontconfig development files.
- Maintenance and PDF tests: direnv, Ruby, Bundler, OpenSSL development files, `rsvg-convert`, QPDF, and Poppler's
  `pdftoppm`.
- Web: Node.js 24+. WebAssembly compilation also requires the pinned Emscripten SDK and Python.

`.ruby-version`, `Gemfile.lock`, `CMakePresets.json`, package locks, and the CI workflow own tool versions. Initial
setup and native checks:

```sh
direnv allow .
direnv exec . bundle install
direnv exec . bundle exec rake build:native test:native
```

Run these task groups with `direnv exec . bundle exec rake`:

| Change                                       | Tasks                                                                 |
| -------------------------------------------- | --------------------------------------------------------------------- |
| Processor or shared PDF contract             | `build:native test:native`, then `build:wasm test:wasm package:wasm`. |
| Ownership, bounds, allocation, or arithmetic | Also `build:sanitize test:sanitize` with ASan/UBSan.                  |
| Native producer                              | `build:native test:producer`.                                         |
| CLI commands or file policy                  | `build:native test:cli`.                                              |
| Packaging                                    | `test:package` and the relevant package task.                         |
| Web asset setup                              | `setup:web test:web`, followed by the web checks below.               |

Run native, sanitizer, and WASM suites sequentially because they share `.local/tmp/test/lib/` fixtures. Narrow suites
are `test:contract`, `test:producer`, `test:cli`, `test:inspector`, `test:parity`, `test:package`, and `test:web`.
`test:parity` refreshes contract fixtures first. `MAINZ_CLI` selects a binary, defaulting to
`.local/var/cpp/build/native/mainz`. C++ changes also require `cmake --build --preset format-check` and
`cmake --build --preset lint`.

Sanitizer and WASM builds require the pinned QPDF checkout at `.local/src/qpdf/`. `Rakefile` pins its revision.
`MAINZ_QPDF_SOURCE` selects another location. WASM also requires the activated Emscripten SDK at `.local/var/cpp/emsdk/`
and Python.

Independent protected-content comparison uses HexaPDF:

```sh
direnv exec . bundle exec rake 'preserve[original.pdf,edited.pdf,reset.pdf]'
```

### Processor and producer review

- Follow the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines). Use scoped QPDF and
  standard-library values with RAII.
- Keep owners alive while values borrow storage. Keep headers self-contained and destructors non-throwing.
- Preserve protected numeric tokens in QPDF and original streams. Use floating point only for styles and derived scales.
- Copied `QPDFObjectHandle` values share objects. Isolate changed occurrences and every mutable resource dictionary on
  their path.
- Retain immutable sharing and Inputs. Fully validate changed outputs. Enforce limits before allocation or
  decoded-buffer growth.
- Reject overflowing or unrepresentable values instead of clamping. Define WASM buffer ownership and catch exceptions at
  native/WASM boundaries.
- Preserve structured error codes. Keep native and WASM content, choices, geometry, and appearance equivalent.
- Keep HexaPDF content/geometry comparisons independent of processor validation. Compare appearance with Poppler at
  relevant 150/300 DPI cases.
- Producer changes also require ordinary librsvg comparisons. Reject unexplained raster differences before changing
  references.
- Measure performance before optimizing. QPDF checks do not prove preservation or full PDF conformance.
- Pipeline budgets and WASM heap capacity do not measure total peak memory.
- Before changing platform-support claims or printer defaults, record platform versions, source revision, PDF digests,
  and observed results.
- Physical devices, screen readers, printers, and hosted workflows require their own evidence.

## Web

Use the pinned Svelte, TypeScript, Vite, and PDF.js stack. When available, use `svelte-code-writer` and
`svelte-core-bestpractices` before component or module work. When available, use `good-css` and `modern-css` for CSS.
Run the Svelte autofixer on affected components. Reuse [styles](web/src/style.css), the [logo](web/public/logo.svg),
existing controls, and both themes. Follow DESIGN's focus and reduced-motion rules. User PDFs and document-derived
values stay out of the offline cache.

Before committing, pushing, or handing off a UI change, pass DESIGN's [alignment rules](web/doc/DESIGN.md#alignment) and
[validation cases](web/doc/DESIGN.md#validation) using rendered bounds and screenshots. Check every affected width
range, both densities, and both panes. Compare visible icon centers with their owning content on both axes, including
selected states and long labels. A formatter, type check, or non-overflowing layout does not pass this gate. Cover a
corrected alignment defect with a focused browser regression test.

[Oxfmt](.oxfmtrc.json) owns formatting across supported repository files, including Markdown. Generated `.local/` files
and `node_modules/` stay excluded. [Oxlint](.oxlintrc.json) covers web scripts and Svelte script blocks. Svelte compiler
diagnostics and `svelte-check` cover templates and types. Do not add competing formatters or linters. Keep
`offline.worker.ts` and `processor.worker.ts` as worker entrypoints. Worker types use `tsconfig.worker.json` separately
from the DOM application.

### Setup and checks

Root npm scripts use dependencies linked from `web/node_modules` to `.local/var/js/node_modules/`. After dependency
changes or removal of `.local/var/js/`, run `direnv exec . bundle exec rake setup:web`. Build and package WASM before
Vite work. Its default package is `.local/var/package/wasm/`. `MAINZ_WASM_DIR` selects another package.

```sh
npm run format
npm run format:check
npm run lint
npm test
npm run build
npm run test:browser
```

The build runs Svelte and worker type checks, then writes `.local/var/js/dist/`. Vite caches under
`.local/var/js/cache/vite/`. Browser tests start their own servers. If Chromium is unavailable, install it with
`npm --prefix web exec -- playwright install chromium`. `PLAYWRIGHT_CHANNEL=chrome` selects installed Chrome. Exercise
changed flows with keyboard, narrow layouts, enlarged text, both themes, and relevant loading, error, and cancellation
states.

### Preview and mockups

When UI implementation starts, look for this workspace's running development server. Reuse it or start one instance and
immediately share its URL. Documentation and design discussion do not require a server. Keep the server running until
push, then stop it.

```sh
npm run dev -- --port 5173 --strictPort
```

`http://127.0.0.1:5173/?demo` opens the maintained seven-page fixture. Development also accepts `?demo&paint` for Style
with Inkjet. Production preview uses `npm run preview -- --port 4173 --strictPort`.

Keep self-contained HTML mockups under `.local/tmp/web/`, using project tokens and vocabulary. Retain descriptive
variants for comparison. Add `package.json` containing `{"private":true}` in that temporary tree to keep Vite's cache
there. Serve it with `web/node_modules/.bin/vite .local/tmp/web --host 127.0.0.1 --port 4174 --strictPort`. Use
`web/node_modules/.bin/playwright screenshot` for screenshots. Deliver working preview URLs or absolute file links.

## Packaging and releases

The Linux development CLI bundle uses the pinned QPDF checkout and reviewed zlib/JPEG archives:

```sh
direnv exec . env ZLIB_PREFIX="$(brew --prefix zlib-ng-compat)" JPEG_PREFIX="$(brew --prefix jpeg-turbo)" bundle exec rake package:native
```

`ZLIB_SHA256` and `JPEG_SHA256` select reviewed hashes for other archive builds. Packaging runs native tests and writes
provenance and dependency notices with `.local/var/package/mainz-linux-x86_64.tar.gz`. Retain GPL-3.0-only and pinned
dependency inputs and notices in packages.

Keep the software version in root `VERSION` as `MAJOR.MINOR.PATCH`, without a prefix, and follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Use `v<VERSION>` for release tags. Contract versions and web
Build IDs have separate meanings. Homebrew packages require immutable release sources and SHA-256 digests.

Record user-visible changes in [CHANGELOG.md](CHANGELOG.md) using
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Keep `Unreleased` first. Use `MAJOR.MINOR.PATCH - YYYY-MM-DD`
release headings, newest first, and include only nonempty change categories. For each release, move its entries from
`Unreleased` into the matching version section and use those entries as release notes.
