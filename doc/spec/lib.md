# Mainz library contract

The library implements one C++20/QPDF processor for native and WebAssembly hosts, plus a native SVG Imprinter. This
document owns operations, errors, resource limits, adapter ownership, Plans, Recipes, and SVG declarations. The
[PDF contract](pdf.md) owns the embedded manifest, painting rules, and producer-independent file requirements. The
[CLI](cli.md) owns filesystem access and output installation. The [web application](web.md) owns workspace state.

- [Implementation boundaries](#implementation-boundaries)
- [Processor operations](#processor-operations)
- [Description record](#description-record)
- [Errors and limits](#errors-and-limits)
- [Plans and composition](#plans-and-composition)
- [Composition adapters](#composition-adapters)
- [Portable Recipes](#portable-recipes)
- [SVG declarations](#svg-declarations)
- [Glossary](#glossary)

## Implementation boundaries

Follow the [C++ Core Guidelines](https://isocpp.github.io/CppCoreGuidelines/CppCoreGuidelines). Use RAII with scoped
QPDF and standard-library values. Headers remain self-contained and destructors do not throw. Owners remain alive while
values borrow their storage. Native and WASM hosts catch exceptions at their boundaries and retain structured error
codes. Hosts copy module results before another call or cleanup.

Copied `QPDFObjectHandle` values share objects. Isolate each changed occurrence and every mutable resource dictionary on
its path. Retain immutable sharing and Inputs. Shared syntax never implies shared mutable painting state.

Protected numeric tokens and original streams retain their precision. Floating point serves style values and derived
scales. Reject overflow and unrepresentable values without clamping. Enforce bounds before allocation or decoded-buffer
growth. Validate completed serialized outputs. Pipeline budgets and WASM heap capacity do not measure total peak memory.

## Processor operations

Operations return results without modifying input bytes or document handles. Adapters own handles, buffers, lifetime,
and error conversion, without exposing QPDF object graphs.

| Operation  | Request and result                                                                                     |
| ---------- | ------------------------------------------------------------------------------------------------------ |
| `read`     | Validates PDF and any contract, returning an immutable document handle.                                |
| `describe` | Returns definitions, overrides, baseline summaries, page scope, and presentation.                      |
| `preview`  | Returns PNG bytes for a physical page, or no image when that page has no preview.                      |
| `style`    | Applies a parameter-ID-to-value patch and returns PDF bytes.                                           |
| `reset`    | Removes selected overrides, or all with omitted IDs, and returns PDF bytes.                            |
| `extract`  | Retains unique physical pages in requested order and rebuilds the contract.                            |
| `compose`  | Executes a Plan against separately supplied Inputs, returning Artifact with a Document and Provenance. |

`style` validates the complete request first. Unknown IDs, invalid values, unsupported properties, and malformed
definitions fail. `{}` is valid. Omitted IDs retain overrides. Requests cannot replace schemas, bindings, baselines, or
presentation. `reset` accepts optional unique existing parameter IDs. Omission resets all. `[]` resets none. Unknown IDs
fail even without a current override. Reset removes `value`, never assigning defaults or changing definitions. An
explicit baseline value still creates an override. Unchanged stored state from valid style/reset returns original bytes.

Native `Document::style(overrides, reset)` combines a patch with a reset-ID array. Patch values take precedence for IDs
in both inputs. Both inputs must be valid before any change. The processor writes and validates the final state once.
Unchanged final overrides return original bytes.

Style and reset retain page names and tags. A changed stored assignment removes the preview reference from every page in
that parameter's scope. Other pages retain their preview references. No-op operations retain the images and original
bytes. Reset does not recreate a removed preview. The host uses PDF rendering until a producer supplies another image.

Extraction accepts a nonempty unique array of integer zero-based physical indexes, including pages without editable
regions. It neither duplicates, scales, rotates, imposes, nor repaints pages. All pages in original order returns
original bytes. Invalid requests fail before page-tree changes. Retained streams, resources, boxes, rotation,
`UserUnit`, and page labels stay intact. Navigation to retained pages keeps its destination. Discarded page references
become null. Form fields belonging only to discarded pages are removed. Unrelated attachments and metadata remain. No
document actions execute.

Extraction remaps page indexes and prunes discarded regions, record sets, baselines, targets, and presentation
references. Bindings retain only targets with eligible records for their property. Unbound parameters and empty groups
disappear. Targets without surviving bindings leave the contract without changing their paint. Retained identities,
definitions, baselines, and overrides stay unchanged. Results are validated and reopened. Without editable regions, the
paint maps are empty. Retained page metadata still keeps the manifest and its Associated File reference. Extraction
rebuilds the page array in extraction order and removes discarded page entries. Without editable regions or page
metadata, the manifest and its Associated File reference disappear. Restoring excluded pages requires the full Input,
not the extraction result.

Read, description, extraction, and composition accept ordinary PDFs under the same limits and encryption/signature
restrictions. An invalid manifest is always an error. Style and reset require a prepared PDF and report
`missing-contract` otherwise. The [CLI contract](cli.md#commands) defines verification.

Preview access accepts a valid zero-based physical index and returns owned PNG bytes without changing the document. A
valid page without a preview returns no bytes. An out-of-range index fails with `invalid-request`. Description and
preview access also work with page metadata that has no editable regions. Operations remove unused managed preview
attachments only when no other surviving PDF use requires them. Unrelated attachments retain their existing protection.

Effective styles regenerate from baselines plus overrides. Hiding never deletes paths, paints white, or uses zero stroke
width. All resulting contracts and PDF structures are validated before success. Identical inputs, operation, and
processor build produce identical bytes. Native and WASM serialization can differ, but content, choices, and appearance
must agree.

Style serialization uses fast lossless compression for changed streams. Equivalent edited Forms can share storage when
their complete attributes and resources agree. Tagged Forms keep separate structure identities. The processor validates
the complete serialized result. It never treats shared syntax as shared painting state.

### Description record

Description has exactly `version`, `pageCount`, `pages`, `parameters`, and optional `groups`, `profileSets`, and
`publication`. Version is `1`. Page count is positive within build limits and includes physical pages without editable
regions. `pages` is an array in physical order with exactly `pageCount` objects, including pages without a manifest.
Each entry has an optional string PDF `label` and retains supplied `name` and `tags`. An available `preview` descriptor
has exactly `file`, `width`, and `height`. `file` is the embedded-file name. Width and height are positive integer
pixels from the PNG header. Description contains no image bytes or base64 payloads. Indexes name actual pages. Missing
labels fall back to one-based physical numbers. Prepared descriptions have nonempty parameter maps. Documents without a
manifest have empty parameter maps and no `groups`. Documents with page metadata and no paint also have empty parameter
maps. Profile sets include all profile annotations and are returned without selecting or changing them.

Each parameter entry has exactly:

| Field       | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `parameter` | Complete manifest parameter record, with `value` only for an override |
| `baseline`  | Summary independent of current overrides                              |
| `pages`     | Nonempty unique zero-based physical page-index array in current order |

Groups retain their descriptions and details. Parameter schemas and profile sets retain the same annotations. Width uses
millimeters, alpha a unitless ratio, and color/display no numeric unit. Description contains no widget names or
executable content.

| Baseline summary  | Exact fields and meaning                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| `uniform`         | `kind` and `value`, valid for the schema and property                               |
| `mixed`           | Only `kind`, for different original states                                          |
| `unrepresentable` | `kind` and nonempty plain-text `reason`, for one state without a valid scalar value |

Mixed takes precedence over unrepresentable. Uniform never rounds original colors or substitutes zero for positive
physical width. Summaries never assign overrides. For [Complete JSON example](pdf.md#complete-json-example),
`partial-opacity` has this entry:

```json
{
  "parameter": {
    "schema": { "type": "number", "minimum": 0, "maximum": 1, "title": "Stroke opacity" },
    "binding": { "targets": ["pattern.partial"], "property": "stroke-opacity" },
    "value": 0.15
  },
  "baseline": { "kind": "mixed" },
  "pages": [0]
}
```

Its saved override does not make its baseline uniform. Other baseline summaries in that example are:

| Parameter              | Kind      | Value                       |
| ---------------------- | --------- | --------------------------- |
| `partial-fill-color`   | `uniform` | `#000000`                   |
| `partial-fill-opacity` | `uniform` | `0`                         |
| `partial-stroke-color` | `uniform` | `#333333`                   |
| `partial-width`        | `uniform` | Approximately `0.070556` mm |
| `partial-display`      | `uniform` | `inline`                    |

### Errors and limits

PDF bytes, JSON, and referenced records are untrusted. Limits apply before unbounded allocation, decoding, retention, or
expansion. Exhaustion returns no successful output. Documents cannot raise limits. Reference-build ceilings include:

| Scope                                     | Ceiling    |
| ----------------------------------------- | ---------- |
| PDF input/output bytes                    | 128 MiB    |
| Shared processor pipeline bytes per call  | 512 MiB    |
| Embedded manifest                         | 16 MiB     |
| Pixels per preview image                  | 16,777,216 |
| Apply/reset/extraction request JSON       | 1 MiB      |
| Manifest JSON items                       | 2,000,000  |
| Other JSON items per input                | 50,000     |
| Referenced paint occurrences              | 500,000    |
| Cumulative expanded locator text per call | 128 MiB    |
| Shared Form/attachment/field/Plan visits  | 65,536     |
| Preview cleanup references per traversal  | 4,194,304  |

Preview cleanup counts each inspected reference, including scalar array elements and repeated references. It expands
shared indirect objects once. Its separate traversal budget does not consume the shared Form/attachment/field/Plan visit
budget.

Locator accounting counts each shared-array occurrence, including repeated Input instance and completed-result
validation. For each occurrence, it counts UTF-8 region, target, and resolved baseline IDs, paint marker, fill
capability, and Form-step resource names. Shared arrays and slots do not reduce the total. Limits apply before copied
text and paths are stored. Other page, string, nesting, decoded-byte, and traversal ceilings remain enforced. Plan
limits appear in [Plans and composition](#plans-and-composition) and producer limits in
[SVG declarations](#svg-declarations). Published ceilings depend on the released build. They measure neither peak memory
nor device support.

Processor errors require plain-text `code` and nonempty `message`. Codes are `pdf-syntax`, `missing-contract`,
`unsupported-version`, `unsupported-context`, `invalid-contract`, `invalid-request`, or `limit-exceeded`. Recipe
assessment also uses `input-incompatible` for a publication veto and `review-required` for unaccepted review. See
[Input references and assessment](#input-references-and-assessment) for assessment states and diagnostics. Optional
`parameter`, `page`, and `region` identify affected records. Field errors supply both `source` (`manifest` or `request`)
and `location`. Location is a [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901), not a URI fragment. The empty
pointer names the whole JSON input. It can identify missing or unknown fields without resolving to an existing value.
Producer JSON parse errors use `source: "declaration"` and an empty `location` for the complete SVG declaration.

```json
{
  "code": "invalid-request",
  "message": "Stroke opacity must be between 0 and 1.",
  "parameter": "partial-opacity",
  "source": "request",
  "location": "/partial-opacity"
}
```

Messages explain failures but are not stable identifiers. Adapters preserve codes and identities rather than replacing
them with generic failures. Hosts report cancellation, file, worker, preview, and download failures separately. Failed
or cancelled work never counts as a successful PDF result. The host owns access, scheduling, cancellation, isolation,
and installation. It never implicitly overwrites Inputs or publishes partial results. Browser workers preserve
responsiveness, not a hard total-memory boundary. Processor allocation limits remain necessary.

### Plans and composition

A Plan is a concrete versioned request for composition. A host can resolve it from a Recipe or build it directly from
accepted workspace choices. Composition still applies full request and Input validation.

The record contains ordered occurrences, complete Input instance styles, repetition, and duplex alignment. It excludes
bytes, paths, selections, UI labels, and preview state. Applications supply immutable Inputs separately. Input and Input
instance IDs follow [Encoding and identifiers](pdf.md#encoding-and-identifiers).

| Record         | Fields                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Plan           | Required `version`, `sources`, `parts`; optional `metadata`                                             |
| `version`      | Integer `1`                                                                                             |
| `sources`      | Input instance-ID map, empty for Blank-only Plans                                                       |
| Input instance | Required `input` ID and complete `overrides` object; optional `title`                                   |
| `parts`        | Nonempty ordered Part array                                                                             |
| Part           | Required nonempty `pages`, optional `copies` and `front`                                                |
| `copies`       | Positive integer, default `1`                                                                           |
| `front`        | Boolean, default `false`                                                                                |
| Content page   | Exactly `source` and zero-based physical `page`                                                         |
| Blank page     | Exactly `blank`, containing finite positive `width` and `height` in millimeters, each at most 1,000,000 |

Every Input instance has a content reference. Every supplied Input serves an Input instance. Several Input instances can
share an Input. Pages can repeat within and across Parts. Unknown fields, duplicate keys, bad versions, missing
references, and invalid indexes fail. Ordinary Input instances require empty overrides. Prepared Input instances
validate every supplied value against their Input's definitions.

Input instance overrides replace complete saved state rather than applying a patch. Omitted overrides return to authored
baselines. Mixed and unrepresentable baselines remain unassigned. Input instance changes never alter Inputs or other
Input instances. All retained occurrences share their Input instance's parameter scope. Independent styles require
independent Input instances, even with the same Input and page.

Optional `metadata` contains exactly `title` and `coverPage`. The title is nonblank UTF-8 text of at most 4096 bytes and
must contain valid XML 1.0 characters. `coverPage` is a one-based physical Output page number after repetition and
Padding expansion. It must identify an existing page. Composition writes the title as XMP `dc:title` with the
`x-default` language and the matching PDF Info `Title`. It writes the cover as `mainz:coverPage` in the namespace
`https://github.com/roktas/mainz/ns/1.0/`. Omitting `metadata` writes neither field in a new catalog. Input metadata is
never merged.

When one Input instance contributes every physical page once in its original order, omitting `metadata` selects
whole-Input styling. The processor applies the complete overrides directly to that document and preserves its catalog
and page structure. Navigation, document metadata, labels, page names, attachments, and the publication declaration
remain. Parameter identities remain unchanged. Provenance maps those original identities to the Input instance. If the
saved assignments are unchanged, the result retains the original bytes.

An optional Input instance `title` supplies a document heading for the composed PDF outline. It follows the Output
metadata title's text and byte rules. It does not change document metadata or page names. When at least two Input
instances contribute pages and every instance has a title, each contiguous source block receives its own root heading. A
change of Input instance starts a new block, including a return to an earlier instance. Blank and Padding pages join the
preceding block. Leading Blank and Padding pages remain outside the blocks. Each heading targets its block's first
source page and contains only the source outline retained by that block. Source pages can be partial, reordered, or
repeated within a block. Repeated sections target their first occurrence within that block. Root headings follow Output
order. An instance without an outline still receives its root headings. The 64-level outline limit includes the new root
heading.

Each Part repeats its complete sequence `copies` times. With `front: true`, copies start at even zero-based result
indexes and finish complete duplex sheets. An odd preceding length adds leading Padding. Odd sequences add trailing
Padding after every copy, including the last. Padding uses the preceding page's visible box: `CropBox` intersected with
`MediaBox`, falling back to `MediaBox` for an empty intersection. Dimensions include rotation and `UserUnit`, never
`TrimBox`. Explicit Blanks retain declared dimensions. Alignment does not configure a printer.

Composition retains content streams, resources, boxes, rotation, and `UserUnit`. Each occurrence receives a distinct
page object and array position. Annotations and form fields are copied without sharing mutable annotations. Internal
links resolve to the first retained occurrence in the same Input instance. Discarded destinations become null. Unrelated
attachments copy once per Input, with collision-free Input prefixes for multiple Inputs. The new catalog does not merge
document-wide actions, metadata, or logical structure. It rebuilds local PDF outlines from real source sections. Section
ranges follow the next sibling or ancestor target, with the final open sections extending to the last Input page. Usable
source outline titles contain nonblank text and at most 4096 UTF-8 bytes. Same-page siblings remain distinct. Empty
sections disappear. Each retained section targets its first Output occurrence within that range or its descendants, even
when its original heading page is absent. Ancestor context remains, and siblings follow their first Output position.
Repeated pages use that first occurrence. Each Input instance keeps its own outline tree. Invalid or external targets
add no heading but retain navigable children. Only an explicit Input instance title creates a document root. No page
name or host-only group creates a PDF outline entry. Outline traversal shares the 65536-visit budget and permits at most
64 levels.

Input instances retain independent parameter, target, and baseline identities. Definitions, overrides, and presentation
survive, with bindings covering every eligible retained occurrence. Unused targets, parameters, baselines, and empty
groups disappear. Without editable regions, the composed Document has no editable paint. Reset restores retained
authored baselines without Inputs. Completion validates and reopens the Document before success.

Each retained occurrence copies its source page's name and tags at its new array position. Unchanged saved assignments
permit reuse of its PNG preview. Changed assignments follow the invalidation rule in
[Processor operations](#processor-operations). Attachment names and preview references change together after collisions.
Shared payloads copy once per Input. Blank and Padding pages have an empty page object, without authored name, tags, or
preview. The processor does not infer metadata from neighboring pages. Page metadata survives without editable regions.
The manifest disappears only when neither paint bindings nor page metadata remain.

The separate version 1 Provenance record has `pages` in composed Document order. Each record includes zero-based `part`
and `copy`. Content records also name original `source` and physical `page`. Blank records give dimensions and Boolean
`padding`. Its `parameters` map relates generated IDs to original `source` and `parameter` IDs. Provenance is result
metadata, neither a PDF binding nor an extra Plan field. Input references and Recipe assessment remain separate from
this record.

Both adapters enforce these limits before Input retention or expansion:

| Quantity                 | Maximum |
| ------------------------ | ------- |
| Inputs / Input instances | 32 each |
| Aggregate Input bytes    | 128 MiB |
| Plan JSON                | 1 MiB   |
| Copies per Part          | 1,000   |
| Expanded pages           | 10,000  |

Aggregate Input bytes count each binding once, including distinct bindings with identical bytes. Input instances using
the same binding share its bytes. Each instance has an independent editing graph, subject to shared pipeline, locator,
and traversal limits.

Other manifest, output, decoding, and traversal limits still apply. Failures preserve Inputs and return no successful
PDF or partial Provenance. Plan field errors use `source: "request"` and pointers to their Input instance, Part, or page
reference.

This Plan uses the prepared example from [Complete JSON example](pdf.md#complete-json-example) as Input `book`, with two
independently styled Input instances:

```json
{
  "version": 1,
  "sources": {
    "original": { "input": "book", "overrides": {} },
    "darker": { "input": "book", "overrides": { "partial-stroke-color": "#222222" } }
  },
  "parts": [
    {
      "pages": [
        { "source": "original", "page": 0 },
        { "source": "darker", "page": 0 }
      ],
      "copies": 2,
      "front": true
    }
  ]
}
```

It produces four content pages without Padding because the sequence length is even. Both maps omit `partial-opacity`,
restoring its original per-record baselines instead of retaining the saved 0.15 override.

### Composition adapters

The native executor accepts Plan JSON and an Input-ID-to-owned-byte map. It returns Artifact with `document` and
`provenance`, without file access or scheduling. The Document owns the validated PDF. Provenance is a separate JSON
record under [Plans and composition](#plans-and-composition). Artifact is an adapter result, not another serialized
record or a field in the PDF manifest. The [CLI](cli.md#requests) resolves file bindings before calling it.

The optional `previous` document in native `compose` permits reuse of its input validation and parsed content. Reuse
requires exact input bytes. Input instance edits stay independent. Composition applies Input instance styles in memory
and validates the complete serialized Document once, without intermediate Input instance PDFs. A whole-Input result with
unchanged bytes retains the original validation.

`compose_validated(plan, inputs)` accepts an Input-ID-to-immutable-`Document` map. It reuses those exact Inputs' prior
validation and parsed content without copying their PDF bytes into another binding map. The owners remain alive for the
synchronous call. Independent Input instances receive separate editing graphs. This entry point lets Recipe resolution
and composition share the same validated Inputs.

The WASM module has one active immutable styling document. `mainz_read` opens it and `mainz_close` releases its handle.
Applying styles, resetting, extracting, and composing do not replace that active document. A host closes it before
opening another. Callers own input buffers, borrowed only during synchronous calls.

`mainz_fingerprint(handle)` returns the active document's SHA-256 as 64 lowercase ASCII hexadecimal bytes through the
result buffer. It hashes the retained original bytes without another PDF read and leaves the active document intact. The
host can retain this value in the Recipe Input's `sha256` field. This operation follows the same handle and
result-buffer rules.

`mainz_preview(handle, page)` returns PNG bytes for a zero-based physical page through `mainz_result` and `mainz_size`.
Success without an image has size zero. Invalid indexes use the existing structured request error. The call retains the
active document. Each immutable Document retains at most 16 MiB of validated PNG payloads, shared by attachment
identity. Larger previews remain accessible through bounded decoding. Derived Documents build their own preview index
after validation. The host copies the bytes before another operation and owns image decoding and disposal.

WASM builds use native WebAssembly exception handling instead of JavaScript exception emulation. Hosts must support the
pinned toolchain's legacy exception instructions. Processor and host failures retain the status and result records
below.

`mainz_style(handle, overridesPointer, overridesSize, resetPointer, resetSize)` combines overrides and reset in one
operation. Both buffers contain JSON and each has the 1 MiB request limit. Patch values take precedence over resets.

`mainz_input(idPointer, idSize, pdfPointer, pdfSize)` copies valid UTF-8 IDs and PDF bytes into a separate registry.
Duplicate IDs fail. `mainz_clear_inputs()` releases registered bytes. They otherwise persist until cleared or worker
termination. `mainz_compose(planPointer, planSize)` uses the native interpreter against that registry. The module can
retain one previously validated Input for exact-byte reuse across Style and composition calls. Failure clears this
retained Input. Clearing the registry releases its registered bytes independently.

PDF and preview bytes use `mainz_result` and `mainz_size`. Provenance JSON uses `mainz_provenance` and
`mainz_provenance_size`. Results belong to the module until the next operation. Both must be copied before another call,
including cleanup. `mainz_status()` distinguishes success (`0`), structured processor failure (`1`), and host failure
(`2`). The host owns worker scheduling, cancellation, Input recovery, and downloads.

### Portable Recipes

A Recipe is a versioned JSON record for applying a composition to separately supplied Inputs, including updated PDFs. It
resolves to a Plan. It stores processing choices rather than UI events, preview state, or PDF bytes. Native and WASM
consumers use the same interpreter. The CLI owns filesystem access under its
[Recipe execution rules](cli.md#recipe-execution).

Recipe version 1 requires `version`, `inputs`, `sources`, and `parts` and permits optional `metadata` under the Plan's
title and cover-page rules. Resolution checks the cover against the expanded Output and carries these choices into the
Plan. Version is integer `1`. Recipe and Plan versions are separate contracts. Encoding, unknown-field rejection,
identifiers, and numeric rules follow [Encoding and identifiers](pdf.md#encoding-and-identifiers).

| Record                  | Fields                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Input                   | Optional `sha256`, `pageCount`, `pageNamesSha256`, `publication`, `title`, `cover`, `xmp`; an empty object is valid |
| Input instance          | Required `input`; optional `title`, `profiles`, `overrides`; the latter two are arrays                              |
| Local profile choice    | Exactly `set` and `id`, containing the Input's opaque set/profile IDs                                               |
| Semantic profile choice | Required `family` and `name`; optional Boolean `all`, default `false`                                               |
| Local override          | Exactly parameter `id` and `value`                                                                                  |
| Semantic override       | Required `family`, `key`, and `value`; optional Boolean `all`, default `false`                                      |

`inputs` and `sources` are ID maps, empty for Blank-only Recipes. Every Input serves an Input instance and every Input
instance has a page reference. Input IDs name logical PDF bindings; Input instance IDs name independent styled uses of
those Inputs. Several Input instances can use one Input. Both kinds of ID are opaque under
[Encoding and identifiers](pdf.md#encoding-and-identifiers). The record has no file-location fields. The host binds each
Input ID to actual PDF bytes at execution time. A filename without its `.pdf` suffix is a convenient initial ID, not a
required filesystem location. Displayed one-based indexes identify rows only; they are not stored identities or
references. JSON member order does not define a host's display order.

Optional Input instance `title` follows the Plan's document-heading rules. Resolution carries this processing choice
into the Plan unchanged. It is independent of the Input matching title described below.

Optional Input `title`, `cover`, and `xmp` describe the reference PDF for file matching. They do not affect resolution
or establish PDF identity. The title is a string of at most 4096 UTF-8 bytes. `xmp` is a map of at most 32 string
fields; keys contain 1–128 bytes and values contain at most 4096 bytes. A cover is a `data:image/png;base64,` string of
at most 256 KiB, including its prefix. Its base64 encoding, PNG signature, IHDR header, and dimensions of 1–512 pixels
on each axis must be valid. Hosts own pixel decoding and can omit an unavailable cover. No external image URL is
accepted.

#### Input references and assessment

Input `sha256` records the reference PDF's SHA-256 as 64 lowercase hexadecimal characters. `pageCount` records the
reference physical page count. It is a comparison value, not an exact-count execution constraint. Optional
`pageNamesSha256` records the ordered authored page-name digest with the same hexadecimal encoding. Display titles, PDF
labels, covers, tags, and XMP fields do not establish page identity.

The page-name digest hashes a byte sequence beginning with `mainz-page-names-v1\n`. Each physical page appends `-;` when
its name is absent. Otherwise it appends the decimal UTF-8 byte length, `:`, the exact UTF-8 name, and `;`. The library
does not trim, normalize, or case-fold names. Omit the digest when every name is absent. This encoding preserves order,
missing positions, and string boundaries. The digest does not identify unnamed pages or distinguish occurrences with
repeated names. Only the library computes these references, for native and WASM consumers alike.

PDF validation, Recipe structure, actual page bounds, Style resolution, schemas, and resource limits always apply. Each
supplied Input then receives one result, in this priority order:

| State    | Meaning and default action                                                                                                                                                   |
| -------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `error`  | A real validation or processing error, or a producer veto. Reject. Explicit acceptance cannot bypass it.                                                                     |
| `ready`  | The recorded byte digest matches. No change handling is needed.                                                                                                              |
| `update` | Bytes changed, page counts and ordered name digests match, current page names are complete and unique, and all Recipe choices remain applicable. Continue without a warning. |
| `review` | The Input passed actual checks, but the available reference facts do not establish an update result. Reject until explicitly accepted.                                       |

Missing checksums, missing reference counts, changed counts, missing or changed name digests, incomplete or repeated
page names, and a lost publication declaration require review. Equal publication IDs and `compat` values do not promote
a result. A changed count can require review while an out-of-range requested page is always an error.

Assessment returns each Input's state, current factual reference, and structured diagnostics. Each diagnostic contains
`code`, `message`, and Recipe JSON Pointer `location`, with optional `expected` and `actual` values. The containing
Input result supplies its logical `input` ID. A full report has `state` and an `inputs` array. Its state is the most
restrictive Input result: error, review, update, then ready. Recipe-wide errors retain their original locations.

The library owns assessment and enforcement. Hosts must not infer another result from hashes or metadata. A partial
single-Input check validates that Input's Recipe styles and page references before the host enables execution. Full
resolution checks every Input and the complete expanded Plan. Detected errors block the whole operation. No partial Plan
or workspace is installed.

Explicit force accepts review results for one invocation. It never skips validation, changes fixed page indexes, drops
pages, substitutes profiles, bypasses a publication veto, or changes file installation policy. Review results remain
visible in diagnostics after acceptance. Default rejection uses `review-required`, with the report in `details`.

#### Recipe alignment

Alignment explicitly creates a new Recipe against accepted current Inputs. It uses the same validation and review policy
as execution. It replaces factual Input references and preserves logical IDs, Input instances, selectors, profiles,
explicit overrides, resets, Parts, copies, front alignment, dynamic `pages: "all"`, and Output metadata.

A changed Input loses stale optional title, cover, and XMP annotations. A host can supply current display annotations
from the accepted PDF. Unchanged Inputs retain their annotations. Alignment never changes the supplied Recipe or PDF
bytes. It returns a separate record only after successful validation. Executing with force does not implicitly save or
replace the reference Recipe. Saving the aligned record is an explicit, separate acceptance of the new baseline.

Style selector strings are exact and case-sensitive. Semantic family/name/key strings follow
[Manifest fields](pdf.md#manifest-fields). A semantic selector without `all: true` requires exactly one match within its
Input instance's Input. Zero matches and ambiguous matches fail. With `all: true`, the operation explicitly addresses
every match and still requires at least one. Exact local selectors do not accept `all`. There is no fallback between
local IDs and semantic fields.

An Input instance starts from authored baselines, following the Plan's complete-state semantics. Profiles apply first,
using the current Input's own definitions. Two choices cannot address the same profile set. Explicit overrides apply
afterward. A non-null `value` is a scalar validated under each matched parameter's schema and paint property. A null
value removes that parameter's profile assignment, restoring its own baseline. It does not enter the Plan. Two explicit
overrides cannot address the same parameter, including through overlapping selectors. Other Input instance styles never
change implicitly. Saved Input overrides survive only when the Recipe explicitly retains them.

Recipe Parts use the Plan's `copies`, `front`, and explicit Blanks. A content page has `source` and one of the following
fields.

- A numeric `page` is a zero-based physical index within the Input.
- A string `page` matches exactly one authored page name in the Input's [manifest](pdf.md#page-metadata). The match is
  case-sensitive and uses the full string, including spaces and digits. The resolver reports an error for a missing or
  ambiguous name. The resolved Plan uses the current physical index. PDF page labels have their own metadata field.
- `pages: "all"` selects every current physical page of the Input in order, before repetition and duplex alignment.

The Input assessment rules apply to all three choices. Explicit complete lists never imply all-pages intent.

```json
{
  "version": 1,
  "inputs": { "book": {} },
  "sources": {
    "original": { "input": "book" },
    "styled": {
      "input": "book",
      "profiles": [{ "set": "print", "id": "inkjet" }],
      "overrides": [{ "id": "partial-opacity", "value": 0.4 }]
    }
  },
  "parts": [
    {
      "pages": [
        { "source": "original", "page": "Cover" },
        { "source": "styled", "pages": "all" }
      ],
      "front": true
    }
  ]
}
```

The example's IDs and page name must exist in the supplied Input. A web consumer can export its complete accepted
composition as a Recipe. It names logical Inputs, converts override-map entries to local override records, and retains
exact Parts. Replaying that record with the same Inputs uses the same composition engine and preserves the represented
content, page order, copies, Blanks, and styles. Profile intent or dynamic selection requires its explicit Recipe
representation; it cannot be inferred from an equivalent concrete snapshot.

`recipe_inputs(recipe)` validates the unbound record and returns its Input definitions as JSON. It reads no files.
`recipe_reference(document)` returns a current factual Input reference as JSON.
`check_recipe_input(recipe, id, document)` returns one Input assessment without generating a Plan. Both use an immutable
validated Document. `resolve_recipe(recipe, inputs, force = false)` validates separately supplied Input bytes and
returns `Resolution` with `plan`, `checks`, `intent`, and `aligned` JSON strings. The `plan` member contains the Plan.
`intent` maps each Input instance ID to `profiles`, a local profile-set-ID-to-profile-ID map, and `edits`, an array of
explicitly overridden local parameter IDs. Equal-valued edits and null baseline resets retain their explicit intent.
Hosts use these records for further editing and export; composition uses the Plan. Resolution generates no intermediate
styled PDFs or final PDF. The Plan executes through `compose`. Missing or extra bindings fail. Validation reports
original Recipe pointers and retains structured PDF errors. Failure returns no partial result.

The native `resolve_recipe` overload for immutable `Document` Inputs reuses their descriptions. The CLI reads and
validates each binding once, then uses this overload and `compose_validated`. The byte-map overload remains available
for hosts that supply bytes rather than retained validated documents. Both use the same resolver and validation rules.

`mainz_reference(handle)` returns the factual Input reference through the standard result buffer.
`mainz_check_recipe_input(handle, idPointer, idSize, recipePointer, recipeSize)` returns one Input assessment. The ID
buffer contains UTF-8 text. The Recipe buffer contains JSON. Both calls retain the active Document.
`mainz_recipe_inputs(pointer, size)` exposes unbound inspection through WASM.
`mainz_resolve_recipe(pointer, size, force)` accepts integer `0` for default rejection or `1` for explicit review
acceptance. It resolves against the registered Inputs and returns
`{ "plan": ..., "checks": {...}, "intent": {...}, "aligned": {...} }` through `mainz_result` and `mainz_size`. The
response combines separately bounded records. The checks and aligned Recipe each have a 16 MiB limit. The Plan and style
intent each have a 1 MiB limit. These operations retain the active styling document and do not generate PDF bytes. The
host copies the result before another operation, then can pass the returned Plan to `mainz_compose` using the same
registered bytes.

Recipe JSON has a 16 MiB limit. Plan JSON retains its 1 MiB limit. Only Recipe cover strings exceed the ordinary
4096-byte string ceiling, within their separate limit above. The Plan's Input/Input instance, aggregate Input byte,
copy, and expanded page limits apply during resolution. Parts and each unexpanded page-selector array contain at most
10000 entries. Retained description JSON has a 512 MiB aggregate byte budget. These byte budgets do not measure total
peak memory. Checks precede page-list expansion. Existing PDF, manifest, decoding, and traversal limits still apply.
Reproducibility covers the resolved operations and represented PDF content; it does not promise identical serialized
bytes across processor or dependency versions. File naming, printing, sharing, and UI state remain host concerns.

## SVG declarations

The native `imprint` function accepts SVG and a separate SVG declaration and returns a Document. Declarations require
`targets` and `parameters`, with optional `groups`, `profileSets`, `publication`, and `page`. Publication identity and
compatibility follow [Manifest fields](pdf.md#manifest-fields). `page` contains optional `name` and `tags` under the
page metadata rules. At least one field must be present. The producer assigns these fields to its single emitted page
object. The producer also accepts separate optional PNG bytes. It embeds the image and records the resulting attachment
reference in page metadata. The host supplies bytes, not paths or URLs inside the declaration. Preview production does
not change the SVG used for PDF content. Declarations with page metadata or a supplied preview can have empty `targets`
and `parameters` together. Each target has selectors and can declare `fill: true` for eligible closed paths or
`display: "none"` for authored hidden state. Targets are disjoint, preserve paint order, and have at least one parameter
binding. A target's display field records its original state without requiring an editable display parameter. Profiles
follow [Style profiles](pdf.md#style-profiles) and do not apply automatically during export.

The producer captures baselines and applies authored `value` overrides before it attaches the supplied PNG. The image
represents that final saved appearance. The producer validates the completed PDF, including its preview, before success.

Declaration selectors support only `#id` and `#id > use.class`. Selector IDs/classes use `[A-Za-z_][A-Za-z0-9_-]*`. They
select whole `g` elements or `use` placements, not content inside `defs` or `symbol`. Selected use placements need
authored IDs. For an SVG group named Ink:

```json
{
  "targets": { "ink": { "selectors": ["#Ink"] } },
  "parameters": {
    "display": {
      "schema": { "type": "string", "enum": ["inline", "none"] },
      "binding": { "targets": ["ink"], "property": "display" }
    }
  }
}
```

Properties and schemas follow [Version 1 properties](pdf.md#version-1-properties) and
[Parameter schemas](pdf.md#parameter-schemas). `value` applies only after baseline capture. `default` must agree with
eligible baselines. Ordered groups carry presentation order without changing parameter semantics. Unlisted parameters
form an Other controls group in ID order.

Selected targets support vector paths. Text and images stay outside them. Masks, filters, group opacity, unsupported
paint contexts, and ambiguous visibility fail. Targets hidden by `display: none !important` cannot be materialized. If
the SVG stylesheet uses attribute selectors, CSS escapes, or `MainzSource`, source paint roots need authored IDs. These
stylesheet restrictions do not extend the declaration-selector grammar. CSS property checks decode escapes and skip
comments in both inline styles and stylesheets. Selector names do not count as compositing properties. Unbalanced
blocks, unterminated comments or strings, invalid escapes, and at-rules fail before rendering.

SVG input is limited to 128 MiB, 64 XML levels, and one million elements. Declarations are limited to 1 MiB. Captured
manifest metadata uses the 16 MiB embedded-manifest limit. Decoded Form capture shares a 128 MiB budget. Producer errors
use structured records and can add `imprinter-error` to processor error codes.

## Glossary

The [PDF glossary](pdf.md#glossary) owns file and painting terms. The [web glossary](web.md#glossary) owns workspace
terms.

| Term            | Meaning                                                                                                                              |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Artifact        | Composition result containing a Document and its Provenance.                                                                         |
| Composition     | Operation that executes a Plan against separately supplied Inputs and returns Artifact.                                              |
| Description     | Read-only processor record of pages, definitions, overrides, baseline summaries, groups, and profiles.                               |
| Document        | Validated immutable PDF, usable as an Input or operation result.                                                                     |
| Extraction      | Retaining unique pages in order and rebuilding bindings, without changing drawing content.                                           |
| Input           | Immutable PDF bytes supplied separately under an opaque Input ID. Several Input instances can share them.                            |
| Input ID        | Logical key for a PDF binding, independent of its file location.                                                                     |
| Recipe          | Portable choices and logical Input IDs that resolve against bound PDFs into a Plan.                                                  |
| Resolution      | Recipe resolution result containing a Plan, Input checks, explicit style intent, and an aligned Recipe, without a produced Document. |
| Plan            | Concrete composition request with physical page references, Blanks, complete Input instance overrides, copies, and alignment.        |
| Provenance      | Versioned record of page origins, Part and copy positions, and source mappings for parameter identities.                             |
| Part            | Nonempty ordered sequence of content pages and Blanks with one copy count and front-alignment choice.                                |
| Processor       | Library applying the PDF contract and contract-aware page operations independently of producers.                                     |
| Imprinter       | Native source component creating Documents from SVG and separate declarations.                                                       |
| Selector        | Producer-side source selection, resolved before processor input.                                                                     |
| Input instance  | One Input reference with complete independent overrides shared across retained occurrences.                                          |
| SVG declaration | Separate producer JSON for targets, parameters, and optional presentation, profiles, publication identity, and page annotations.     |
| Verification    | Assessment of one PDF's Mainz contract. Preservation requires independent input/output comparison.                                   |
