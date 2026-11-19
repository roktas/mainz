# Mainz specification

Mainz composes PDF pages and changes declared paint without the source drawing. PDF Composer is its local web consumer.
The CLI provides batch operations. Both use the same library contract.

Read this document for the design boundaries. Then read the owner of the affected behavior:

| Document               | Owns                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------- |
| [PDF](spec/pdf.md)     | Embedded manifest, page metadata, editable paint, baselines, and file representation   |
| [Library](spec/lib.md) | Operations, errors, resource limits, native/WASM adapters, Plan, Recipe, and Imprinter |
| [CLI](spec/cli.md)     | Commands, filesystem policy, diagnostics, cancellation, and output installation        |
| [Web](spec/web.md)     | Workspace behavior, local processing, recovery, and product vocabulary                 |
| [GUI](spec/gui.md)     | Appearance, layout references, focus presentation, motion, and UI anatomy              |

[AGENTS.md](../AGENTS.md) owns repository workflows and build gates. The [test guide](test.md) owns browser setup,
native measurement, calibration, and evidence handling. Each detailed specification defines its own terms. A reference
to another owner does not create a second definition.

## PDF and styling

Ordinary PDFs support page composition. A prepared PDF also contains explicit editable painting choices and immutable
baselines. Page names, tags, and PNG thumbnails are independent metadata; they do not create Style controls.

Styling changes only declared paint. It preserves path geometry, text, layout, and other protected content. The saved
PDF retains enough state to reopen, edit, and reset without an original PDF, source drawing, or producer. Ordinary PDF
viewers render its saved appearance.

Bindings identify painting occurrences explicitly. The processor does not infer targets from colors, names, or geometry.
It does not interpret source selectors or regenerate pages from SVG or rasters. The
[PDF contract](spec/pdf.md#the-styling-boundary) defines supported properties, contexts, and preservation guarantees.

## Ownership

| Owner                 | Responsibility                                                                                      |
| --------------------- | --------------------------------------------------------------------------------------------------- |
| Processor             | Validate, describe, style, reset, extract, compose, and serialize PDF results                       |
| Native Imprinter      | Resolve SVG selection, render occurrences, capture baselines, and publish prepared PDFs             |
| Host                  | Bind files or bytes, schedule calls, handle cancellation, and install or hand off completed results |
| Consuming application | Define parameter meaning, publication defaults, page choices, repetition, layout, and imposition    |

One C++20/QPDF processor serves native and WASM hosts. It imports no producer or application code. The native Imprinter
and other producers publish the same file contract. The processor requires no producer installation.

Mainz imports neither Sevgi nor Megic. Sevgi owns the generic Style DSL and its export integration. Megic owns
publication policy and parameter semantics. Their real integrations remain in those repositories.

The file contract and CLI commands are public surfaces. Processor adapters and application widgets are internal. Version
1 promises no separate SDK, UI package, plugin system, or arbitrary-PDF styling.

## Documents and composition

A Document is an immutable validated PDF. Hosts bind Inputs separately from processing requests. Independent Input
instances can share PDF bytes while keeping complete independent style assignments.

A Recipe stores portable choices and logical Input IDs. Resolution assesses bound PDFs and produces a concrete Plan.
Composition executes the Plan and returns an Artifact with a Document and separate Provenance. Workspace selection,
preview state, and local file paths do not enter these portable records.

Page operations rebuild valid bindings and retain applicable state. The result remains editable without the Inputs. The
[library contract](spec/lib.md#plans-and-composition) defines repetition, Blanks, alignment, metadata, and page limits.

## Trust and results

PDF bytes, embedded metadata, and requests are untrusted. Invalid contracts remain errors. The processor does not infer
a replacement contract or silently approximate unsupported painting contexts. Bounds apply before allocation, decoding,
or expansion. Failed work produces no successful or partial result.

Native and WASM can serialize different bytes, but their content, choices, geometry, and appearance must agree.
Structured errors retain their codes and locations across adapters. Hosts own cancellation and installation; they
preserve Inputs and publish only completed results.

PDF Composer processes documents on the device. PDF bytes and document-derived values never enter uploads or the offline
cache. The [web contract](spec/web.md#processing-boundaries) defines worker recovery, resource release, and asset
updates.

## Versions and evidence

Software, PDF, Recipe, Plan, and Provenance versions identify different contracts. A web Build ID identifies an asset
build. Publication identity and compatibility provide a separate producer veto on Recipe replay; they do not
authenticate a publisher.

Validation of one PDF does not prove preservation against another PDF or full ISO PDF conformance. Independent content,
geometry, and raster comparisons provide preservation evidence. Synthetic browsers, simulators, physical devices,
assistive technology, and printers require distinct evidence. Support claims and publication defaults remain limited to
the recorded environments and results.
