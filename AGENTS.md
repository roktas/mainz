# Mainz Agent Instructions

## Before editing

Read the [project specification](doc/spec.md) and the contract for the affected behavior.

| Change                                                                   | Owner                               |
| ------------------------------------------------------------------------ | ----------------------------------- |
| Manifest, metadata, paint, baselines, or PDF representation              | [PDF contract](doc/spec/pdf.md)     |
| Processor, limits, native/WASM boundary, Plan, Recipe, or SVG production | [Library contract](doc/spec/lib.md) |
| Commands, request files, diagnostics, or output installation             | [CLI contract](doc/spec/cli.md)     |
| Workspace behavior, local processing, or product vocabulary              | [Web contract](doc/spec/web.md)     |
| Appearance, layout, focus presentation, motion, or UI anatomy            | [GUI contract](doc/spec/gui.md)     |
| Browser/SDK setup, viewport acquisition, calibration, or evidence        | [Test guide](doc/test.md)           |

Follow the [preview gate](#preview-and-mockups) before UI edits. Use the owning contract's glossary. Keep exact CSS
values and keyframes in source. If code and a contract disagree, identify the difference before changing the contract.

Read callers and tests before refactoring. Give shared logic one owner and match sibling names when adding paths. Prefer
focused integration tests for behavior gaps. Before handoff, review the affected surface for stale code, tests, docs,
and generated files. Update the owning documents and make sure that relative links and anchors resolve.

## Ownership and files

Follow the [component boundaries](doc/spec.md#ownership). Keep shared CLI file policy in `cli/src/command.*` and real
Sevgi and Megic integrations in their repositories. The root `Rakefile` runs the component Minitest suites.

Keep project inputs in Git. Keep dependency checkouts in `.local/src/`, builds and retained evidence in `.local/var/`,
disposable outputs in `.local/tmp/`, and one-off scripts in `.local/bin/`. Follow
[tool storage](doc/test.md#tool-storage) for SDKs and caches outside Dropbox.

Builds, tests, and runtime use the versioned [fixtures](web/test/fixtures/README.md). Regenerate demos or capture
screencasts only on request. Follow the [demo guide](doc/demo/README.md) or [capture guide](doc/help/README.md).
Published screencasts live in `web/public/help/`.

## Build and validation

Run commands from the repository root. Use the pinned Ruby and Node versions and CI tool versions.

- Native: CMake 3.25+, Clang/clang-tidy/clang-format 22+, QPDF 12.4.2, zlib development files, and pkg-config.
- SVG Imprinter: Cairo, librsvg, libxml2, Pango, and Fontconfig development files.
- Tests and packaging: Ruby, Bundler, OpenSSL development files, `rsvg-convert`, `qpdf`, and `pdftoppm`.

Run `direnv allow .` to load the project's Bundler paths from `.envrc`. You can also set the paths in the shell before
installing the bundle.

```sh
export BUNDLE_PATH="$PWD/.local/var/ruby"
export BUNDLE_APP_CONFIG="$BUNDLE_PATH"
bundle install
bundle exec rake build:native test:native
```

The default Rake task runs native tests. Run the applicable gates before publication.

| Change                                       | Tasks                                                                |
| -------------------------------------------- | -------------------------------------------------------------------- |
| Processor or shared PDF contract             | `build:native test:native`, then `build:wasm test:wasm package:wasm` |
| Ownership, bounds, allocation, or arithmetic | Also `build:sanitize test:sanitize` with ASan/UBSan                  |
| Native Imprinter                             | `build:native test:imprinter`                                        |
| CLI commands or file policy                  | `build:native test:cli`                                              |
| Packaging                                    | `test:package` and the relevant package task                         |
| Web asset setup                              | `setup:web test:web`, followed by the web gates below                |

Run native, sanitizer, and WASM suites sequentially. They share test outputs. Use `bundle exec rake -T` for focused
tasks. `MAINZ_CLI` defaults to `.local/var/cpp/build/native/mainz`. For C++ changes, also run
`cmake --build --preset format-check` and `cmake --build --preset lint`.

Sanitizer and WASM builds require the QPDF revision pinned in [CMakeLists.txt](CMakeLists.txt). Put the checkout in
`.local/src/qpdf/` or set `MAINZ_QPDF_SOURCE`. WASM also requires Python and the activated Emscripten SDK outside
Dropbox. `EMSDK` identifies the SDK. Run `bundle exec rake 'preserve[original.pdf,edited.pdf,reset.pdf]'` for a HexaPDF
content and geometry comparison.

### Processor and Imprinter review

Follow the [library implementation boundaries](doc/spec/lib.md#implementation-boundaries) and the
[PDF protection rules](doc/spec/pdf.md#protected-content). Review all mutable paths to shared QPDF objects. Use
independent HexaPDF content/geometry comparisons and Poppler appearance comparisons at relevant 150/300 DPI cases.

For Imprinter changes, compare with librsvg. Reject unexplained raster differences before changing references. Measure
before optimizing. QPDF checks do not prove preservation or full PDF conformance. Record platform versions, revision,
PDF digests, and results before changing support claims or printer defaults.

Physical devices, screen readers, printers, and hosted workflows require their own evidence.

## Web

Use `svelte-code-writer` and `svelte-core-bestpractices` for Svelte work and `good-css` and `modern-css` for CSS when
available. Run the Svelte autofixer on affected components. Reuse [styles](web/src/main.css), the
[logo](web/public/logo.svg), existing controls, and both themes. Keep user PDFs and document-derived values out of the
offline cache.

Start each CSS, TypeScript, and Svelte file under `web/src/` with a useful one-line responsibility or ownership comment.
Follow it with one blank line. Update the comment when the responsibility changes.

Before UI publication, pass the GUI [alignment](doc/spec/gui.md#alignment) and [validation](doc/spec/gui.md#validation)
gates. Use focused browser tests and screenshots for alignment fixes. Exercise keyboard, narrow layouts, enlarged text,
both themes, and recovery.

[Oxfmt](.oxfmtrc.json) owns formatting, including Markdown. Exclude `.local/` and `node_modules/`.
[Oxlint](.oxlintrc.json) covers scripts and Svelte script blocks. Svelte diagnostics and `svelte-check` cover
templates/types. Do not add competing formatters or linters. Keep `offline.worker.ts` and `processor.worker.ts` as
worker entrypoints. Keep worker types separate from the DOM application in `tsconfig.worker.json`.

### Setup and checks

Match `node --version` to `.node-version`. Run `bundle exec rake setup:web` to install or refresh web dependencies.
Build and package WASM before Vite work. Set `MAINZ_WASM_DIR` to use a package outside `.local/var/package/wasm/`.

```sh
npm run test:minimal
npm run test:standard
npm run test:full
```

Use focused checks during development, standard before publication, and full before releases. Run browser suites
sequentially per host. See the [browser guide](doc/test.md#browser-checks) for modes, CI groups, and evidence
requirements.

### Preview and mockups

Before a UI or mockup edit, start or reuse `npm run dev -- --port 5173 --strictPort`. Make sure that the URL responds
and share it before editing. Keep the server until push, then stop it.

`?demo` opens the demo menu. `?demo=single` opens the four-page fixture with eight Output pages. Development accepts
`?demo=single&paint` for Style with Filled. Preview: `npm run preview -- --port 4173 --strictPort`.

Keep self-contained HTML mockups under `.local/tmp/web/`, using project tokens and vocabulary. Retain descriptive
variants for comparison. Add `package.json` with `{"private":true}` there to retain its Vite cache. Serve with
`web/node_modules/.bin/vite .local/tmp/web --host 127.0.0.1 --port 4174 --strictPort`. Use
`web/node_modules/.bin/playwright screenshot` for screenshots. Deliver working URLs or absolute file links.

## Packaging and releases

The Linux development CLI bundle uses pinned QPDF and reviewed zlib/JPEG archives:

```sh
direnv exec . env ZLIB_PREFIX="$(brew --prefix zlib-ng-compat)" JPEG_PREFIX="$(brew --prefix jpeg-turbo)" bundle exec rake package:native
```

`ZLIB_SHA256` and `JPEG_SHA256` select reviewed hashes for other archive builds. Packaging runs native tests and writes
provenance, notices, and `.local/var/package/mainz-linux-x86_64.tar.gz`. Retain GPL-3.0-only and pinned dependency
inputs and notices in packages.

Keep root `VERSION` as `MAJOR.MINOR.PATCH`, without a prefix. Follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html). Use `v<VERSION>` for release tags. Contract versions and web
Build IDs have separate meanings. Homebrew packages require immutable release sources and SHA-256 digests. Follow
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Record user-visible changes in [CHANGELOG.md](CHANGELOG.md).
Keep `Unreleased` first, then releases newest first as `MAJOR.MINOR.PATCH - YYYY-MM-DD`. Use only nonempty categories.
At release, move `Unreleased` entries to that version and use them as release notes. Before publishing, pass native,
sanitizer, WASM, and full web checks. Follow every release CI run to completion.
