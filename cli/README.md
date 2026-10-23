# CLI

`mainz` runs PDF operations and prepares editable PDFs from SVG. It returns JSON results and writes each PDF to an
explicit destination without replacing an existing file.

Ordinary PDFs support `describe`, `extract`, and `compose`. Styling, reset, and verification require prepared PDFs.

## Install

```sh
brew install roktas/tap/mainz
```

You can also [build from source](../README.md#build-and-checks).

## Use

```sh
mainz describe input.pdf
mainz apply input.pdf --request changes.json --output edited.pdf
mainz reset input.pdf --output original.pdf
mainz extract input.pdf --pages pages.json --output selected.pdf
mainz compose job.json --inputs inputs.json --output composed.pdf
mainz produce source.svg --declaration parameters.json --output prepared.pdf
mainz verify prepared.pdf
mainz --version
```

Use parameter IDs from `describe` in `changes.json`, such as `{"partial-opacity":0.4}` for the library's prepared
example. An extraction request of `[0,2]` keeps the first and third physical pages, in that order. Composition uses a
[Job and separate Input bindings](doc/SPEC.md#2-requests).

The [CLI specification](doc/SPEC.md) defines options, stdin, exit codes, diagnostics, and output installation. The
[library specification](../lib/doc/SPEC.md#71-svg-declarations) defines SVG declarations.

Command implementations live in [src/command/](src/command/). [command.cpp](src/command.cpp) owns shared argument and
file handling. Follow the [root build and validation guide](../AGENTS.md#build-and-validation) for CLI checks.
