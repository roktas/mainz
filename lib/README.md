# Library

One C++20/QPDF processor serves native and WebAssembly applications. It reads PDFs, changes declared styles, restores
original styles, extracts pages, and executes composition Jobs. Operations return new validated documents and leave
Input bytes unchanged.

Ordinary PDFs support page operations. Styling and reset require a prepared PDF with a valid Mainz contract. The native
SVG producer creates these PDFs from SVG and separate JSON style declarations.

| Entry point                                                       | Responsibility                                                                   |
| ----------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| [processor.hh](src/processor.hh) and [processor/](src/processor/) | PDF operations, validation, and composition.                                     |
| [producer.hh](src/producer.hh) and [producer/](src/producer/)     | SVG selection, rendering, and baseline capture.                                  |
| [wasm.cpp](src/wasm.cpp)                                          | Synchronous WASM calls, document handles, registered Inputs, and result buffers. |
| [test/](test/)                                                    | Contract, producer, native/WASM parity, and independent preservation tests.      |

The processor imports no producer or application code. Applications supply immutable Inputs separately from their Jobs.
The [specification and glossary](doc/SPEC.md) define the file contract, operation semantics, limits, and buffer
ownership.

Use the [CLI](../cli/README.md) for batch work. Follow the
[root build and validation guide](../AGENTS.md#build-and-validation) for native, WASM, producer, and sanitizer checks.
