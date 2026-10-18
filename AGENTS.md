# Mainz Agent Instructions

Keep this file within 200 lines.

## Before editing

Use the owner table, outlines, and links to read only relevant sections. Reuse them until the scope or document changes.

| Change                                                        | Owner                           |
| ------------------------------------------------------------- | ------------------------------- |
| PDF contract, processor, native/WASM boundary, SVG production | [Library SPEC](lib/doc/SPEC.md) |
| Commands, request files, diagnostics, output installation     | [CLI SPEC](cli/doc/SPEC.md)     |
| Workspace behavior and product vocabulary                     | [Web SPEC](web/doc/SPEC.md)     |
| Visual rules, focus, motion, layout references, UI anatomy    | [Web DESIGN](web/doc/DESIGN.md) |

Keep rules, shared tokens, and required layout references in their owning documents. Keep implementation details and
animation keyframes in source files. Maintain product terms in the [library glossary](lib/doc/SPEC.md#glossary) and
[web glossary](web/doc/SPEC.md#glossary). Maintain UI element names in the [UI glossary](web/doc/DESIGN.md#ui-glossary).

## Documentation alignment

Before a commit or handoff, review the final diff and align relevant documentation once. Update only durable changes to
behavior, contracts, terminology, design rules, or workflows. Leave accurate documentation unchanged.

## Naming

Before creating or splitting files or directories, inspect sibling names and match their form. Name each file or
directory for its responsibility. Prefer specific one-word names. Use compounds or `-`/`_` only to follow a justified
local convention. Treat naming difficulty as a warning to reconsider the proposed boundaries.

## Refactoring

- Inspect responsibilities, data structures, callers, and tests. Favor readable, discoverable, maintainable code. Treat
  length as a signal, not a target. Distinguish inherent complexity from mixed concerns or repetition.
- Split only for clearer ownership and dependencies. Keep code that changes together. Extra props, callbacks, shared
  mutable state, and indirection can outweigh smaller files. Avoid artificial layers and abstractions.
- Separate domain data from presentation. Give shared logic one owner. Reuse existing patterns and remove dead or
  redundant code. Group by responsibility, not file extension.
- Before refactoring, record steps, regression risks, and coverage in root `PLAN.md`. Prefer real E2E/integration tests.
  Add focused tests only for coverage gaps. Run them against current behavior first.
- Preserve behavior in coherent steps. Make sure that affected flows pass. Record results in the plan. Keep tests and
  refactors proportional to the maintenance benefit.

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

The processor imports no producer or application code. Mainz imports neither Sevgi nor Megic. Sevgi owns the generic
Style DSL and export integration. Megic owns publication policy and parameter semantics. Keep real integration scenarios
in those repositories.

Keep maintained inputs in Git and generated files under root `.local/`. Components share this tree. Removing
`.local/var/` can require installation or rebuilding. Removing `.local/tmp/` discards only disposable output.

## Build and validation

Run commands from the repository root. Required tools:

- Native: CMake 3.25+, Clang/clang-tidy/clang-format 22+, QPDF 12.4.2, and pkg-config.
- SVG producer: Cairo, librsvg, libxml2, Pango, and Fontconfig development files.
- Maintenance/PDF: direnv, Ruby, Bundler, OpenSSL development files, `rsvg-convert`, QPDF, `pdftoppm`.

Tool versions: `.ruby-version`, `.node-version`, `Gemfile.lock`, `CMakePresets.json`, package locks, CI. Initial setup:

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

Run native, sanitizer, and WASM suites sequentially: they share `.local/tmp/test/lib/`. Narrow suites are
`test:contract`, `test:producer`, `test:cli`, `test:inspector`, `test:parity`, `test:package`, and `test:web`.
`test:parity` refreshes contract fixtures first. `MAINZ_CLI` defaults to `.local/var/cpp/build/native/mainz`. For C++
changes, also run `cmake --build --preset format-check` and `cmake --build --preset lint`.

Sanitizer and WASM builds need the QPDF checkout at `.local/src/qpdf/`, pinned by `Rakefile`. `MAINZ_QPDF_SOURCE`
selects another location. WASM also needs the activated Emscripten SDK at `.local/var/cpp/emsdk/` and Python.

Independent HexaPDF comparison: `direnv exec . bundle exec rake 'preserve[original.pdf,edited.pdf,reset.pdf]'`.

### Processor and producer review

- Follow the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines). Use RAII with scoped
  QPDF and standard-library values.
- Keep owners alive while values borrow storage. Keep headers self-contained and destructors non-throwing.
- Preserve protected numeric tokens in QPDF and original streams. Use floating point only for styles and derived scales.
- Copied `QPDFObjectHandle` values share objects. Isolate changed occurrences and all mutable resource dictionaries on
  their paths.
- Retain immutable sharing and Inputs. Make sure that changed outputs fully pass validation. Enforce limits before
  allocation or decoded-buffer growth.
- Reject overflow and unrepresentable values, without clamping. Define WASM buffer ownership. Catch exceptions at
  native/WASM boundaries.
- Preserve structured error codes and native/WASM equivalence in content, choices, geometry, and appearance.
- Keep HexaPDF content/geometry comparisons independent of processor validation. Compare appearance with Poppler at
  relevant 150/300 DPI cases.
- For producer changes, compare with ordinary librsvg. Reject unexplained raster differences before changing references.
- Measure performance before optimizing. QPDF checks do not prove preservation or full PDF conformance.
- Pipeline budgets and WASM heap capacity do not measure total peak memory.
- Before changing support claims or printer defaults, record platform versions, revision, PDF digests, and results.
- Physical devices, screen readers, printers, and hosted workflows require their own evidence.

## Web

Use the pinned Svelte, TypeScript, Vite, and PDF.js stack. When available, use `svelte-code-writer` and
`svelte-core-bestpractices` before component or module work. When available, use `good-css` and `modern-css` for CSS.
Run the Svelte autofixer on affected components. Reuse [styles](web/src/main.css), the [logo](web/public/logo.svg),
existing controls, and both themes. Follow DESIGN's focus and reduced-motion rules. Keep user PDFs and document-derived
values out of the offline cache.

Start each CSS, TypeScript, and Svelte file under `web/src/` with a useful one-line responsibility or ownership comment.
Follow it with one blank line. When the responsibility changes, update the comment.

Before UI commit/push/handoff, pass DESIGN's [alignment](web/doc/DESIGN.md#alignment) and
[validation](web/doc/DESIGN.md#validation) gates. Use rendered bounds and screenshots at affected widths, both
densities/panes, selected states, and long labels. Compare visible icon centers with owning content on both axes.
Formatting, types, and no overflow do not pass this gate. Cover alignment fixes with focused browser regression tests.

[Oxfmt](.oxfmtrc.json) owns formatting, including Markdown. Exclude `.local/` and `node_modules/`.
[Oxlint](.oxlintrc.json) covers web scripts and Svelte script blocks. Svelte diagnostics and `svelte-check` cover
templates and types. Do not add competing formatters or linters. Keep `offline.worker.ts` and `processor.worker.ts` as
worker entrypoints. Keep worker types separate from the DOM application in `tsconfig.worker.json`.

### Setup and checks

Use root `.node-version` for web checks. Make sure that `node --version` matches before comparing results with CI.

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

The build checks Svelte/worker types, then writes `.local/var/js/dist/`. Vite cache: `.local/var/js/cache/vite/`.
Browser tests start their own servers. If Chromium is unavailable, run
`npm --prefix web exec -- playwright install chromium`. `PLAYWRIGHT_CHANNEL=chrome` uses installed Chrome. Exercise
changed flows with keyboard, narrow layouts, enlarged text, both themes, and relevant loading/error/cancellation states.

### Preview and mockups

For UI implementation, reuse the workspace server or start one: `npm run dev -- --port 5173 --strictPort`. Share its URL
immediately. Keep it until push, then stop it. Documentation/design discussion need no server.

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

Keep root `VERSION` as `MAJOR.MINOR.PATCH` without a prefix. Follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Use `v<VERSION>` for release tags. Contract versions and web
Build IDs have separate meanings. Homebrew packages require immutable release sources and SHA-256 digests.

Follow [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Record user-visible changes in
[CHANGELOG.md](CHANGELOG.md). Keep `Unreleased` first, then releases newest first as `MAJOR.MINOR.PATCH - YYYY-MM-DD`.
Include only nonempty categories. At release, move relevant `Unreleased` entries into the version section and use them
as release notes.
