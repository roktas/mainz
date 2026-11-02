# Library

One C++20/QPDF processor serves native and WebAssembly applications. It reads PDFs, changes declared styles, restores
original styles, extracts pages, and executes Plans. Input bytes remain unchanged.

Ordinary PDFs support page operations. Styling and reset require a prepared PDF with a valid Mainz contract. The native
SVG Imprinter creates these PDFs from SVG and separate JSON declarations.

Recipe resolution returns a Plan and warnings. Composition returns Artifact, containing a Document and its Provenance.
SVG production returns a Document. The [version 1 contract](doc/SPEC.md#page-metadata) uses one object per physical page
and numeric region page references. Independent optional page names, tags, triviality, and embedded PNG previews also
work without editable paint. Document-wide descriptive metadata belongs in standard PDF XMP.

| Entry point                                                       | Responsibility                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [processor.hh](src/processor.hh) and [processor/](src/processor/) | PDF operations, validation, and composition.                                     |
| [recipe.hh](src/recipe.hh)                                        | Portable record inspection and shared resolution to Plans.                       |
| [imprinter.hh](src/imprinter.hh) and [imprinter/](src/imprinter/) | SVG selection, rendering, and baseline capture.                                  |
| [wasm.cpp](src/wasm.cpp)                                          | Synchronous WASM calls, document handles, registered Inputs, and result buffers. |
| [test/](test/)                                                    | Contract, Imprinter, native/WASM parity, and independent preservation tests.     |

The processor imports no producer or application code. Applications supply immutable Inputs separately from their Plans.
The [specification and glossary](doc/SPEC.md) define the file contract, operation semantics, limits, and buffer
ownership.

Use the [CLI](../cli/README.md) for batch work. Follow the
[root build and validation guide](../AGENTS.md#build-and-validation) for native, WASM, Imprinter, and sanitizer checks.
