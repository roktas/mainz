# Library

One C++20/QPDF processor serves native and WebAssembly applications. It reads PDFs, changes declared styles, restores
original styles, extracts pages, and executes Plans. Input bytes remain unchanged.

Ordinary PDFs support page operations. Styling and reset require a prepared PDF with a valid Mainz contract. The native
SVG Imprinter creates these PDFs from SVG and separate JSON declarations.

Recipe resolution returns a Plan, Input assessments, editing intent, and an aligned Recipe. Composition returns an
Artifact with a validated PDF Document and Provenance that maps the result to its sources. SVG production returns a
Document. The [PDF contract](../doc/spec/pdf.md#page-metadata) supports page names, tags, and PNG previews independently
of editable paint.

| Entry point                                                       | Responsibility                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [processor.hh](src/processor.hh) and [processor/](src/processor/) | PDF operations, validation, and composition.                                     |
| [recipe.hh](src/recipe.hh)                                        | Portable record inspection and shared resolution to Plans.                       |
| [imprinter.hh](src/imprinter.hh) and [imprinter/](src/imprinter/) | SVG selection, rendering, and baseline capture.                                  |
| [wasm.cpp](src/wasm.cpp)                                          | Synchronous WASM calls, document handles, registered Inputs, and result buffers. |
| [test/](test/)                                                    | Contract, Imprinter, native/WASM parity, and independent preservation tests.     |

Applications supply immutable Inputs separately from their Plans. The [PDF contract](../doc/spec/pdf.md) defines the
file format and protected content. The [library contract](../doc/spec/lib.md) defines operations, resource limits, and
buffer ownership.

Use the [CLI](../cli/README.md) for batch work. Follow the
[root build and validation guide](../AGENTS.md#build-and-validation) for native, WASM, Imprinter, and sanitizer checks.
