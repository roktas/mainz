# Mainz CLI Specification

`mainz` is the batch interface for PDF operations and native SVG production. This document owns command syntax, request
files, diagnostics, cancellation, and output installation. The [library SPEC](../../lib/doc/SPEC.md) owns PDF, Job, and
producer semantics. [AGENTS.md](../../AGENTS.md) owns build and validation commands.

## 1. Commands

| Command                     | Required options                                          | Optional options               | Success on stdout                                           |
| --------------------------- | --------------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `mainz describe input.pdf`  | None                                                      | None                           | Processor description                                       |
| `mainz profiles input.pdf`  | None                                                      | None                           | Ordered profile-set array                                   |
| `mainz verify prepared.pdf` | None                                                      | None                           | `{"valid":true,"version":1}`                                |
| `mainz apply input.pdf`     | `--output edited.pdf` and one of `--request`, `--profile` | `--set` with `--profile`       | `{"ok":true}`                                               |
| `mainz reset input.pdf`     | `--output reset.pdf`                                      | `--ids parameters.json`        | `{"ok":true}`                                               |
| `mainz extract input.pdf`   | `--pages pages.json --output selected.pdf`                | None                           | `{"ok":true}`                                               |
| `mainz compose job.json`    | `--inputs inputs.json --output composed.pdf`              | None                           | Composition report                                          |
| `mainz produce source.svg`  | `--declaration parameters.json --output prepared.pdf`     | `--width`, `--height`, `--dpi` | `{"ok":true}`                                               |
| `mainz --version`           | None                                                      | None                           | Software version, contract version, and dependency versions |

Options follow the positional input and each take one value. Missing, unknown, or duplicate options fail with exit
code 2. Commands never request interactive input. PDF output always requires an explicit destination. `apply`, `reset`,
and `verify` require prepared PDFs. `describe`, `profiles`, `extract`, and `compose` also accept ordinary PDFs. An
invalid embedded contract remains an error. It does not become an ordinary-PDF fallback. Version output uses software
`version`, integer `contract`, and dependency version fields.

`verify` assesses one PDF's contract and supported contexts without changing it. It does not establish preservation
against an earlier PDF. Independent input/output comparisons establish preservation. A processor failure produces
`{"valid":false,"error":{...}}` on stdout as well as the error on stderr. Argument and file failures produce no
verification result.

## 2. Requests

JSON uses the library's [encoding and identifier rules](../../lib/doc/SPEC.md#41-encoding-and-identifiers).

| Request                 | Contents and effect                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apply --request`       | Parameter-ID-to-value object. Omitted IDs retain overrides. `{}` changes nothing.                                                  |
| `apply --profile`       | Exact profile ID. Replaces all overrides in its set. Omitted parameters return to their baselines.                                 |
| `reset --ids`           | Unique existing parameter IDs. Omission resets all. `[]` resets none.                                                              |
| `extract --pages`       | Nonempty unique zero-based physical indexes in output order, for example `[0,2,3]`.                                                |
| `compose job.json`      | Complete version 1 [Job](../../lib/doc/SPEC.md#63-job-and-composition). Source overrides replace saved state rather than patch it. |
| `compose --inputs`      | Input-ID-to-PDF-path object, `{}` for a Blank-only Job.                                                                            |
| `produce --declaration` | [SVG targets, scalar parameters, and optional presentation](../../lib/doc/SPEC.md#71-svg-declarations).                            |

The positional input and `--request`, `--ids`, `--pages`, `--inputs`, or `--declaration` accept `-` for stdin. At most
one input can use stdin.

Composition binds Inputs separately from the Job. Bound PDF paths cannot use stdin. Relative paths resolve from the
current working directory, including paths inside `inputs.json`. Paths cannot contain null bytes. No path is resolved
relative to its request file.

### 2.1 Profile selection

`profiles` returns the description's `profileSets` array without changing its records or authored order. An ordinary PDF
or a prepared PDF without profile sets returns `[]`. Invalid embedded contracts remain errors.

`apply` requires exactly one of `--request changes.json` and `--profile ID`. `--set ID` is permitted only with
`--profile`. Profile and set selectors use exact, case-sensitive IDs, not display names. IDs remain opaque strings.
Colons, slashes, spaces, and Unicode have no selector syntax. The literal `-` in either selector is an ID, not stdin.

Without `--set`, the profile ID must match exactly one set in the PDF. With `--set`, the profile must belong to that
set. Unknown or ambiguous selections fail with exit code 2. Diagnostics list the available set and profile IDs.
Ambiguous selections require `--set`; the CLI never chooses the first match or applies all matches. An ordinary PDF
still fails with `missing-contract` and exit code 1 when applying a profile.

Profile selection resets all parameters in the selected set and applies that profile's overrides in one processor call.
Other parameters and sets retain their saved overrides. The first profile's empty overrides restore only its set's
baselines. The processor writes and validates the final PDF once. Profile definitions remain unchanged and no
active-profile field is stored. An unchanged final state retains the original bytes. Output installation still requires
a new explicit file path.

## 3. SVG viewport

`produce` accepts finite positive `--width`, `--height`, and `--dpi` values. Width and height bound the viewport in
pixels, preserving uniform scale. Supplying both fits the drawing within both bounds. DPI defaults to 96. Physical SVG
units resolve at 96 DPI. Invalid dimension arguments fail with exit code 2 before the CLI reads input files. The library
[producer contract](../../lib/doc/SPEC.md#71-svg-declarations) owns selection, eligibility, and resource limits.

## 4. Results and files

`description` and `details` remain plain-text JSON strings. `describe` retains them on parameter schemas, groups,
profile sets, and profiles; `profiles` retains both set and profile annotations. Details require their owner's own
description under the library contract. Invalid annotation dependencies use the existing structured validation errors.

Success results use stdout JSON. Diagnostics use stderr. Machine output contains no terminal controls. Document-supplied
text in human-readable diagnostics escapes control characters. Processor errors retain the library's structured error
record. Producer-specific failures can use `producer-error`. Declaration parse errors retain the library's
[source and location fields](../../lib/doc/SPEC.md#62-errors-and-limits). Validation failures produce no stdout result
except for the `verify` wrapper. Usage and file failures report through stderr without a JSON result.

| Exit code | Meaning                                  |
| --------- | ---------------------------------------- |
| 0         | Success                                  |
| 1         | Processor or producer validation failure |
| 2         | Host, file, argument, or stdout failure  |
| 130       | SIGINT or SIGTERM cancellation           |

PDF output requires a file path. `-` is not an output destination. Existing destinations, including the input path, are
never replaced. The CLI writes and flushes a complete mode-0600 temporary file in the destination directory, then
installs it atomically without replacing an existing path. Installation uses a no-clobber link. An incomplete PDF is
never installed. Atomic installation does not guarantee that the destination survives a power loss. The CLI flushes file
contents but does not sync the parent directory.

Success JSON follows PDF installation. After the CLI installs a complete destination, a stdout failure can return exit
code 2. The caller can inspect that destination before retrying. Failed stdout writes can also leave incomplete JSON.

SIGINT and SIGTERM mark the operation for cancellation. Input reading and output writing observe that state. An active
processor or producer call can finish before cancellation is observed. Cancellation then prevents output installation
and returns 130. Normal cleanup removes temporary files. Abrupt termination can leave a temporary file, but cannot
install a partial destination.
