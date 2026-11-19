# CLI

`mainz` reads, styles, and combines PDFs. It also prepares editable PDFs from SVG. PDF commands write to a destination
you specify and leave existing files intact. Processing commands report results as JSON.

Ordinary PDFs support `describe`, `profiles`, `extract`, and `compose`. Style and reset require a PDF with editable
paint. Verify accepts any PDF with a valid Mainz manifest, including one that declares only page metadata.

## Install with Homebrew

```sh
brew install roktas/tap/mainz
```

## Build from source

Install CMake 3.25 or later, Clang 22 or later, QPDF 12.4.2, zlib, and pkg-config. Install the development libraries for
Cairo, librsvg, libxml2, Pango, and Fontconfig. Run these commands from the repository root.

```sh
cmake -S . -B .local/var/cpp/build/cli -DCMAKE_CXX_COMPILER=clang++ -DCMAKE_BUILD_TYPE=Release -DBUILD_TESTING=OFF -DMAINZ_LINT=OFF
cmake --build .local/var/cpp/build/cli --target mainz
.local/var/cpp/build/cli/mainz --help
```

## Use

Run the built executable directly or put it on your `PATH`. Run `mainz --help` for command syntax.

```sh
mainz describe input.pdf
mainz profiles input.pdf
mainz style input.pdf --overrides changes.json --output edited.pdf
mainz style input.pdf --profile inkjet --output inkjet.pdf
mainz style input.pdf --set print --profile inkjet --output inkjet-print.pdf
mainz reset input.pdf --output original.pdf
mainz extract input.pdf --pages pages.json --output selected.pdf
mainz compose plan.json --inputs inputs.json --output composed.pdf
mainz apply recipe.json --root ./pdfs --output composed.pdf
mainz apply recipe.json --inputs bindings.json --output composed.pdf
mainz resolve recipe.json --inputs bindings.json --jsonl
mainz align recipe.json --inputs bindings.json --output aligned.json
mainz imprint source.svg --declaration parameters.json --output prepared.pdf
mainz verify prepared.pdf
mainz --version
```

Use parameter IDs from `describe` in `changes.json`. An extraction request of `[0,2]` keeps the first and third physical
pages. Composition uses a [Plan and separate Input bindings](../doc/spec/cli.md#requests).

`compose` and `apply` write the composed PDF to `--output` and return its Provenance JSON on stdout. Provenance maps the
result's pages and parameters to their sources. Use `--force` to accept a Recipe review for one operation. Errors and
producer vetoes always stop the command.

`apply` consumes a portable [Recipe](../doc/spec/lib.md#portable-recipes) containing logical Input IDs, Input instance
styles, and composition choices. Use `--inputs bindings.json` to map IDs to PDF paths, such as
`{"book":"pdfs/updated-book.pdf"}`. Without explicit bindings, the CLI treats each ID as a relative path. It appends
`.pdf` when needed and looks under the working directory or `--root`. `align` writes a separate Recipe with updated
references. Use `--jsonl` for one JSON object per diagnostic or result, or `--verbose` for more detail on stderr. See
the [Recipe execution rules](../doc/spec/cli.md#recipe-execution) for Input checks and path limits.

`profiles` returns the available sets and profile IDs. If an ID belongs to more than one set, supply `--set`. Selecting
a profile restores omitted parameters in that set to their baselines. Use either `--profile` or `--overrides`.

The [CLI specification](../doc/spec/cli.md) defines options, stdin, exit codes, diagnostics, and output installation.
The [library specification](../doc/spec/lib.md#svg-declarations) defines SVG declarations.

Command implementations live in [src/command/](src/command/). [command.cpp](src/command.cpp) owns shared argument and
file handling. Follow the [root build and validation guide](../AGENTS.md#build-and-validation) for CLI checks.
