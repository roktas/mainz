# Performance notes

This document records CLI observations and improvement candidates from the worksheet production workflow on 2026-11-01.
The candidates below are proposals. They do not change the current contracts.

## Measurements

The workload used 16 Recipes to produce 16 PDFs with 56 physical pages at revision `4da1c81`. Fourteen A4 outputs
selected pages directly from three Megic Books. Two A5 outputs used Megic's native worksheets and existing placement of
two worksheets per landscape A4 sheet. GA selected Outlined, and IA selected Filled.

Both measurements used the existing Megic production cache and included the complete `./make` execution. The script ran
no additional `mainz verify` or `qpdf --check` commands. Normal Mainz production validation remained active.

| Execution | Workers | Elapsed seconds | User CPU seconds | System CPU seconds |
| --------- | ------- | --------------- | ---------------- | ------------------ |
| Serial    | 1       | 205.48          | 201.56           | 3.44               |
| Parallel  | 8       | 53.04           | 258.25           | 4.63               |

Parallel execution reduced elapsed time by 74.2%, a 3.87-fold speedup. Aggregate CPU time increased. Each separate CLI
invocation still reads and processes its own Inputs.

These are individual observations, without repeated samples or a cold-cache comparison. The measurements do not isolate
phase costs or total peak memory. The script subsequently adopted `nproc` to select concurrency at startup. This host
reported eight available CPUs.

Local evidence lives outside Git:

- Workload and script: `.local/tmp/Alıştırmalar/`
- Serial measurement: `.local/var/performance/practice/serial.txt`
- Parallel measurement: `.local/var/performance/practice/parallel.txt`

## Improvement candidates

### 1. Reuse Inputs across Recipes

The first priority is one CLI invocation for several Recipes, with reuse of immutable Inputs. The current
[Recipe command](cli/src/command/recipe.cpp) reads and opens its Inputs for each invocation. Parallel processes shorten
elapsed time but retain this repeated work.

The library already supports [composition from immutable Documents](lib/doc/SPEC.md#64-composition-adapters) through
`compose_validated`. A batch executor can use this interface and retain exact Input bytes across Recipes. The
performance benefit of this reuse remains unmeasured.

A batch contract needs explicit rules for memory limits, failures, cancellation, and output installation. Each result
PDF still needs normal production validation. Scheduling and filesystem policy belong in the CLI.

### 2. Summarize resolved Plans

The library's [Recipe resolver](lib/doc/SPEC.md#65-portable-recipes) returns a Plan and warnings without PDF production.
The CLI exposes this operation through `resolve`, without an output path.

A future concise summary can show bound Inputs, expanded physical pages, copies, Blanks, and alignment. A future summary
can also identify the matched profiles.

This summary can help authors review zero-based page indexes and style choices before an expensive production run.

### 3. Report phase timings

Optional timings can separate Input reading, validation, Recipe resolution, composition, and output installation. The
current external measurement reports only elapsed time and aggregate CPU time. It cannot show which internal phase
dominates this workload.

Machine-readable timing records can use stderr and retain the existing success JSON on stdout. Each record needs enough
Recipe and output context to remain useful during concurrent execution.

### 4. Support explicit atomic regeneration

The [CLI file policy](cli/doc/SPEC.md#4-results-and-files) rejects existing destinations. The local script writes all
output PDFs into a temporary directory, then replaces the destination files after every Recipe succeeds.

An explicit replacement mode can reduce this wrapper code for repeated production. Default protection for existing files
and protection for Inputs remain requirements. Atomic replacement of one output and installation of an entire batch are
separate guarantees.

## SPEC guidance

The CLI SPEC distinguishes the guarantees of production and subsequent inspection:

| Operation              | Guarantee                                                               |
| ---------------------- | ----------------------------------------------------------------------- |
| Normal production      | Built-in Input and result PDF validation under the operation's contract |
| `mainz verify`         | Contract and supported-context assessment of one PDF                    |
| Independent comparison | Content, geometry, or appearance comparison against reference material  |

A subsequent `verify` call does not establish independent preservation against an earlier PDF.

Recipe `profiles` and `overrides` arrays are already optional under the
[Recipe contract](lib/doc/SPEC.md#65-portable-recipes). Omission of empty arrays is an export-format choice and needs no
contract extension.
