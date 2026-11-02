# Mainz CLI Specification

`mainz` is the batch interface for PDF operations and native SVG production. This document owns command syntax, request
files, diagnostics, cancellation, and output installation. The [library SPEC](../../lib/doc/SPEC.md) owns PDF and
processing contracts. [AGENTS.md](../../AGENTS.md) owns build and validation commands.

The `--preview` option, SVG page annotations, and verification of manifests without editable paint below are pending
requirements. The current CLI does not implement these extensions. `verify` currently requires a prepared PDF. See the
[library implementation status](../../lib/doc/SPEC.md#implementation-status).

`resolve` and successful global `--help` below are pending implementation. The command changes are breaking changes from
released version 1.0.0 and require the next major software release. PDF, Recipe, Plan, and Provenance contract versions
remain independent and unchanged.

## 1. Commands

| Command                     | Required options                                            | Optional options                               | Success on stdout                                           |
| --------------------------- | ----------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------------- |
| `mainz describe input.pdf`  | None                                                        | None                                           | Processor description                                       |
| `mainz profiles input.pdf`  | None                                                        | None                                           | Ordered profile-set array                                   |
| `mainz verify input.pdf`    | None                                                        | None                                           | `{"valid":true,"version":1}`                                |
| `mainz style input.pdf`     | `--output edited.pdf` and one of `--overrides`, `--profile` | `--set` with `--profile`                       | `{"ok":true}`                                               |
| `mainz reset input.pdf`     | `--output reset.pdf`                                        | `--ids parameters.json`                        | `{"ok":true}`                                               |
| `mainz extract input.pdf`   | `--pages pages.json --output selected.pdf`                  | None                                           | `{"ok":true}`                                               |
| `mainz compose plan.json`   | `--inputs inputs.json --output composed.pdf`                | None                                           | Provenance                                                  |
| `mainz apply recipe.json`   | `--output composed.pdf`                                     | `--inputs bindings.json` or `--root directory` | Provenance                                                  |
| `mainz imprint source.svg`  | `--declaration parameters.json --output prepared.pdf`       | `--width`, `--height`, `--dpi`, `--preview`    | `{"ok":true}`                                               |
| `mainz resolve recipe.json` | None                                                        | `--inputs bindings.json` or `--root directory` | Plan                                                        |
| `mainz --help`              | None                                                        | None                                           | Human-readable usage                                        |
| `mainz --version`           | None                                                        | None                                           | Software version, contract version, and dependency versions |

Options follow the positional input and each take one value. Missing, unknown, or duplicate options fail with exit
code 2. Commands never request interactive input. PDF output always requires an explicit destination. `style` and
`reset` require prepared PDFs with editable paint. `verify` requires a Mainz manifest and also accepts page metadata
without editable paint. `describe`, `profiles`, `extract`, and `compose` also accept ordinary PDFs. An invalid embedded
contract remains an error. It does not become an ordinary-PDF fallback. Version output uses software `version`, integer
`contract`, and dependency version fields.

`verify` assesses one PDF's contract and supported contexts without changing it. It does not establish preservation
against an earlier PDF. Independent input/output comparisons establish preservation. A processor failure produces
`{"valid":false,"error":{...}}` on stdout as well as the error on stderr. Argument and file failures produce no
verification result.

## 2. Requests

JSON uses the library's [encoding and identifier rules](../../lib/doc/SPEC.md#41-encoding-and-identifiers).

| Request                 | Contents and effect                                                                                                                           |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `style --overrides`     | Parameter-ID-to-value object. Omitted IDs retain overrides. `{}` changes nothing.                                                             |
| `style --profile`       | Exact profile ID. Replaces all overrides in its set. Omitted parameters return to their baselines.                                            |
| `reset --ids`           | Unique existing parameter IDs. Omission resets all. `[]` resets none.                                                                         |
| `extract --pages`       | Nonempty unique zero-based physical indexes in output order, for example `[0,2,3]`.                                                           |
| `compose plan.json`     | Complete version 1 [Plan](../../lib/doc/SPEC.md#63-plans-and-composition). Input instance overrides replace saved state rather than patch it. |
| `compose --inputs`      | Input-ID-to-PDF-path object, `{}` for a Blank-only Plan.                                                                                      |
| `apply --inputs`        | Exact Recipe-Input-ID-to-PDF-path object, `{}` for a Blank-only Recipe.                                                                       |
| `imprint --declaration` | [SVG targets, scalar parameters, page annotations, and optional presentation](../../lib/doc/SPEC.md#71-svg-declarations).                     |
| `imprint --preview`     | PNG file whose bytes become the produced page's optional thumbnail.                                                                           |

The positional input and `--overrides`, `--ids`, `--pages`, `--inputs`, `--declaration`, or `--preview` accept `-` for
stdin. At most one input can use stdin.

`imprint --preview image.png` reads the PNG through the ordinary input file policy. The CLI passes owned image bytes to
the native Imprinter. The declaration contains no image filesystem path or URL. The library owns PNG structure, size
limits, and embedded-file references under its [preview contract](../../lib/doc/SPEC.md#preview-images).

Composition and explicit Recipe bindings supply Inputs separately from the record. Bound PDF paths cannot use stdin.
Relative paths resolve from the current working directory, including paths inside `inputs.json`. Paths cannot contain
null bytes. No path is resolved relative to its request file.

### 2.1 Profile selection

`profiles` returns the description's `profileSets` array without changing its records or authored order. An ordinary PDF
or a prepared PDF without profile sets returns `[]`. Invalid embedded contracts remain errors.

`style` requires exactly one of `--overrides changes.json` and `--profile ID`. `--set ID` is permitted only with
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

### 2.2 Recipe execution

`apply` consumes the shared [Recipe contract](../../lib/doc/SPEC.md#65-portable-recipes). It resolves profiles,
overrides, resets, and page selectors through the library, then executes the resulting Plan through normal composition.
It never requests interactive input. The same portable record can originate from a web consumer or be authored for the
CLI.

The Recipe names logical Inputs and has no file-location fields. `--inputs bindings.json` explicitly maps every required
Input ID to a PDF path. Missing or additional IDs fail before PDF reading. Paths follow the same rules as
`compose --inputs`: absolute paths are permitted, relative paths resolve from the working directory, and symlinks follow
the ordinary host file policy. The binding file, unlike the Recipe, is a local execution artifact.

Without `--inputs`, automatic lookup treats each Input ID as a relative path. It appends `.pdf` only if the ID does not
already end in that extension, matched without case. For example, `practice/italic` resolves to `practice/italic.pdf`.
The default lookup root is the current working directory, independently of the Recipe file's location.
`--root directory` selects another root; a relative root also resolves from the working directory.

Lookup supports `/` for subdirectories. It rejects absolute paths, backslashes, colons, empty components, `.` and `..`
components. It opens regular files without following symlinks below the chosen root or expanding shell syntax. Other
opaque IDs remain valid in a Recipe and use explicit bindings. `--inputs` and `--root` are mutually exclusive.

A Recipe can come from stdin with automatic lookup under the current directory. At most one JSON input can use stdin.
File locations and root arguments never enter the Recipe. Each Input is read once within the aggregate byte limit.
Resolution and composition share those same owned bytes; several Input instances can use one binding without rereading
its file. Existing `compose` behavior stays unchanged.

A SHA-256 mismatch produces one warning JSON record per Input on stderr and does not require a force option. Recorded
publication identity and a compatible forward SemVer version suppress that digest warning. Missing, incompatible, older,
zero-major, or pre-release declarations do not establish a compatible forward change. The library's publication
comparison and all validation still run; an actual page or style error terminates execution even when the producer
claims compatibility. Explicit page-count expectations, missing pages, unknown or ambiguous styles, invalid values, and
resource-limit failures remain errors. Warnings do not replace diagnostics for subsequent failures. Success stdout
remains the Provenance JSON and follows atomic installation. Existing destinations and Inputs are never replaced.

### 2.3 Recipe resolution

`resolve` uses the same Recipe parsing, bindings, automatic lookup, stdin policy, aggregate byte limits, and resolver as
Recipe `apply`. It accepts `--inputs` or `--root`, never both. It rejects `--output`. Success writes only the resolved
Plan JSON to stdout and one JSON record per change warning to stderr. No PDF is produced or installed. A resolved Plan
does not guarantee that later composition will succeed. Resolver errors retain their codes and original Recipe JSON
Pointers. Failure emits no partial Plan. The Recipe and resolved Plan each have the library's 1 MiB limit. Bound Inputs
share its 128 MiB aggregate limit.

Global `--help` succeeds only as `mainz --help`, without an input or additional arguments. It writes usage to stdout and
exits with code 0. Invalid invocations retain stderr diagnostics and exit code 2.

## 3. SVG viewport

`imprint` accepts finite positive `--width`, `--height`, and `--dpi` values. Width and height bound the viewport in
pixels, preserving uniform scale. Supplying both fits the drawing within both bounds. DPI defaults to 96. Physical SVG
units resolve at 96 DPI. Invalid dimension arguments fail with exit code 2 before the CLI reads input files. The library
[producer contract](../../lib/doc/SPEC.md#71-svg-declarations) owns selection, eligibility, and resource limits.

## 4. Results and files

`compose` and `apply` write the composed Document to the output file and emit its Provenance JSON on stdout. The CLI
does not serialize the library's Artifact return package. Recipe change warnings use stderr and remain separate from
Provenance.

`description` and `details` remain plain-text JSON strings. `describe` retains them on parameter schemas, groups,
profile sets, and profiles; `profiles` retains both set and profile annotations. Details require their owner's own
description under the library contract. Invalid annotation dependencies use the existing structured validation errors.

PDF operations and resolution use stdout JSON. Global help uses plain text. Diagnostics use stderr. Machine output
contains no terminal controls. Document-supplied text in human-readable diagnostics escapes control characters.
Processor errors retain the library's structured error record. Producer-specific failures can use `imprinter-error`.
Declaration parse errors retain the library's [source and location fields](../../lib/doc/SPEC.md#62-errors-and-limits).
Validation failures produce no stdout result except for the `verify` wrapper. Usage and file failures report through
stderr without a JSON result.

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
