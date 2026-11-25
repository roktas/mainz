# Mainz

Mainz selects, repeats, and combines pages from one or more PDFs. It can insert blank pages and change the page order.

A prepared PDF also declares editable colors, line widths, opacity, and visibility. You can change or restore those
styles while keeping the text, shapes, and page layout intact.

[Open PDF Composer](https://mainz.roktas.dev/) in a modern browser. Your PDFs stay on your device. After PDF Composer
reports that it is ready offline, you can compose PDFs without a network connection.

## Components

- [PDF Composer](web/README.md) is the browser application.
- [CLI](cli/README.md) provides PDF and Recipe commands for scripts.
- [Library](lib/README.md) contains the shared PDF processor and native SVG Imprinter.

The [project specification](doc/spec.md) explains design decisions and links to each detailed contract.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Demo files

The [demo catalog](web/test/fixtures/README.md) lists the PDFs and Recipes that ship with PDF Composer. The optional
[demo sources](doc/demo/README.md) can regenerate them.

## Build and checks

See the [CLI build instructions](cli/README.md#build-from-source) to build the command-line tool. For development builds
and tests, see [AGENTS.md](AGENTS.md#build-and-validation) and the [test guide](doc/test.md).

Mainz uses the [GNU GPL version 3 only](LICENSE) license (`GPL-3.0-only`).
