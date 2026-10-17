# Mainz

Mainz lets you select, repeat, reorder, and combine PDF pages into a new PDF. You can also insert blank pages.

A prepared PDF declares styles you can change, such as colors, line widths, opacity, and visibility. Text, shapes, and
page layout stay intact. You can restore the original styles without the source drawing.

For example, you can change guide colors or line widths in a practice sheet without changing its lettering or grid
spacing.

[Open PDF Composer](https://mainz.roktas.dev/) in a modern browser. Your PDFs stay on your device. The application also
works offline after installation.

## Components

- [Web](web/README.md): PDF Composer, the browser application.
- [CLI](cli/README.md): The `mainz` command-line tool for scripts and batch operations.
- [Library](lib/README.md): The shared C++ processor for native and WebAssembly applications, plus a native SVG
  producer.

See [CHANGELOG.md](CHANGELOG.md) for release notes.

## Build and checks

See [AGENTS.md](AGENTS.md#build-and-validation) for dependencies, setup, tests, and packaging.

Mainz uses the [GNU GPL version 3 only](LICENSE) license (`GPL-3.0-only`).
