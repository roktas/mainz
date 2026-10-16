# Library

One C++20/QPDF processor serves native and WebAssembly applications. It reads PDFs, changes declared styles, restores
original styles, extracts pages, and executes composition Jobs. Operations return new validated documents and leave
Input bytes unchanged.

The native SVG producer prepares editable PDFs from SVG and separate style declarations. Ordinary PDFs support page
operations. Styling and reset require a valid prepared PDF.

The [specification and glossary](doc/SPEC.md) define the PDF contract, processor operations, and SVG declarations. See
the [CLI](../cli/README.md) for command-line use and the [root README](../README.md#build-and-checks) for building.
