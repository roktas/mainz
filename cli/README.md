# CLI

`mainz` runs PDF operations and prepares editable PDFs from SVG. It returns JSON results and writes each PDF to an
explicit destination without replacing an existing file.

Ordinary PDFs support `describe`, `profiles`, `extract`, and `compose`. Styling, reset, and verification currently
require prepared PDFs. The [specification](doc/SPEC.md) also defines pending page metadata and PNG preview extensions.

## Install

```sh
brew install roktas/tap/mainz
```

You can also [build from source](../README.md#build-and-checks).

## Use

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
mainz imprint source.svg --declaration parameters.json --output prepared.pdf
mainz verify prepared.pdf
mainz --version
```

Use parameter IDs from `describe` in `changes.json`, such as `{"partial-opacity":0.4}` for the library's prepared
example. An extraction request of `[0,2]` keeps the first and third physical pages, in that order. Composition uses a
[Plan and separate Input bindings](doc/SPEC.md#2-requests).

`compose` and `apply` write the composed PDF to `--output` and return its Provenance JSON on stdout. Provenance maps the
result's pages and parameters to their sources. Recipe change warnings use stderr.

`apply` consumes a portable [Recipe](../lib/doc/SPEC.md#65-portable-recipes) containing logical Input IDs, Input
instance styles, and composition choices. Use `--inputs bindings.json` to map IDs to PDF paths, such as
`{"book":"pdfs/updated-book.pdf"}`. Without explicit bindings, each ID acts as a relative path. The CLI appends `.pdf`
when absent and resolves from the working directory, or from `--root` when supplied. This shared record can also
represent a web consumer's Output. The [execution rules](doc/SPEC.md#22-recipe-execution) define changed-Input warnings,
explicit page-count expectations, and path containment.

`profiles` returns the embedded profile sets as JSON, or `[]` when none exist. Use the returned set and profile IDs. The
examples above use `print` and `inkjet`; other PDFs can define different IDs. `--set` is optional when the profile ID
matches only one set. An ambiguous selection reports the available IDs. Profile selection replaces its complete set,
restores omitted parameters to their baselines, and retains other sets. `--profile` and `--overrides` are separate modes
and cannot be combined.

The [CLI specification](doc/SPEC.md) defines options, stdin, exit codes, diagnostics, and output installation. The
[library specification](../lib/doc/SPEC.md#71-svg-declarations) defines SVG declarations.

Command implementations live in [src/command/](src/command/). [command.cpp](src/command.cpp) owns shared argument and
file handling. Follow the [root build and validation guide](../AGENTS.md#build-and-validation) for CLI checks.
