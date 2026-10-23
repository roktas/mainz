# Mainz CLI Specification

`mainz` is the batch interface for PDF operations and native SVG production. This document owns command syntax, request
files, diagnostics, cancellation, and output installation. The [library SPEC](../../lib/doc/SPEC.md) owns PDF, Job, and
producer semantics. [AGENTS.md](../../AGENTS.md) owns build and validation commands.

## 1. Commands

| Command                     | Required options                                      | Optional options               | Success on stdout                                           |
| --------------------------- | ----------------------------------------------------- | ------------------------------ | ----------------------------------------------------------- |
| `mainz describe input.pdf`  | None                                                  | None                           | Processor description                                       |
| `mainz verify prepared.pdf` | None                                                  | None                           | `{"valid":true,"version":1}`                                |
| `mainz apply input.pdf`     | `--request changes.json --output edited.pdf`          | None                           | `{"ok":true}`                                               |
| `mainz reset input.pdf`     | `--output reset.pdf`                                  | `--ids parameters.json`        | `{"ok":true}`                                               |
| `mainz extract input.pdf`   | `--pages pages.json --output selected.pdf`            | None                           | `{"ok":true}`                                               |
| `mainz compose job.json`    | `--inputs inputs.json --output composed.pdf`          | None                           | Composition report                                          |
| `mainz produce source.svg`  | `--declaration parameters.json --output prepared.pdf` | `--width`, `--height`, `--dpi` | `{"ok":true}`                                               |
| `mainz --version`           | None                                                  | None                           | Software version, contract version, and dependency versions |

Options follow the positional input and each take one value. Missing, unknown, or duplicate options fail with exit
code 2. Commands never request interactive input. PDF output always requires an explicit destination. `apply`, `reset`,
and `verify` require prepared PDFs. `describe`, `extract`, and `compose` also accept ordinary PDFs. An invalid embedded
contract remains an error. It does not become an ordinary-PDF fallback. Version output uses software `version`, integer
`contract`, and dependency version fields.

`verify` assesses one PDF's contract and supported contexts without changing it. It does not establish preservation
against an earlier PDF. Independent input/output comparisons establish preservation. A processor failure produces
`{"valid":false,"error":{...}}` on stdout as well as the error on stderr. Argument and file failures produce no
verification result.

## 2. Requests

JSON uses the library's [encoding and identifier rules](../../lib/doc/SPEC.md#41-encoding-and-identifiers).

| Request                 | Contents and effect                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `apply --request`       | Parameter-ID-to-value object. Omitted IDs retain overrides. `{}` changes nothing.                                                  |
| `reset --ids`           | Unique existing parameter IDs. Omission resets all. `[]` resets none.                                                              |
| `extract --pages`       | Nonempty unique zero-based physical indexes in output order, for example `[0,2,3]`.                                                |
| `compose job.json`      | Complete version 1 [Job](../../lib/doc/SPEC.md#63-job-and-composition). Source overrides replace saved state rather than patch it. |
| `compose --inputs`      | Input-ID-to-PDF-path object, `{}` for a Blank-only Job.                                                                            |
| `produce --declaration` | [SVG targets, scalar parameters, and optional presentation](../../lib/doc/SPEC.md#71-svg-declarations).                            |

Each command permits one PDF, SVG, or JSON input to use `-` for stdin. All other inputs require file paths. Composition
binds Inputs separately from the Job. Bound PDF paths cannot use stdin. Relative paths resolve from the current working
directory, including paths inside `inputs.json`. Paths cannot contain null bytes. No path is resolved relative to its
request file.

## 3. SVG viewport

`produce` accepts finite positive `--width`, `--height`, and `--dpi` values. Width and height bound the viewport in
pixels, preserving uniform scale. Supplying both fits the drawing within both bounds. DPI defaults to 96. Physical SVG
units resolve at 96 DPI. Invalid dimension arguments fail with exit code 2 before the CLI reads input files. The library
[producer contract](../../lib/doc/SPEC.md#71-svg-declarations) owns selection, eligibility, and resource limits.

## 4. Results and files

Success results use stdout JSON. Diagnostics use stderr. Machine output contains no terminal controls. Document-supplied
text in human-readable diagnostics escapes control characters. Processor errors retain the library's structured error
record. Producer-specific failures can use `producer-error`. Validation failures produce no stdout result except for the
`verify` wrapper. Usage and file failures report through stderr without a JSON result.

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
