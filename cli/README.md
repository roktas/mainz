# CLI

`mainz` runs PDF operations and prepares editable PDFs from SVG. It returns JSON results and writes each PDF to an
explicit destination without replacing an existing file.

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

The [specification](doc/SPEC.md) defines request formats, options, exit codes, and file handling. The
[library specification](../lib/doc/SPEC.md#71-svg-declarations) defines SVG style declarations.
