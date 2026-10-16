# Mainz Library Specification

## Prepared PDFs

A prepared PDF carries editable painting choices, their original baselines, and saved overrides. PDF Studio can change
its declared colors, line widths, opacity, or visibility while keeping text, layout, and path geometry fixed. The PDF
remains editable and resettable without its drawing source or producer. Ordinary viewers render its saved appearance.
Ordinary PDFs support page composition but have no Mainz Style controls.

This document owns the version 1 PDF/JSON contract, processor behavior, native/WASM boundaries, and SVG production. The
[CLI SPEC](../../cli/doc/SPEC.md) owns commands and file policy. The [Web SPEC](../../web/doc/SPEC.md) owns workspace
behavior. [AGENTS.md](../../AGENTS.md) owns build and validation procedures. The [glossary](#glossary) defines contract
terms.

## 1. The styling boundary

### 1.1 Parameter policy

A parameter changes paint on existing geometry. Admission requires all of these conditions:

- The property belongs to the supported version and has defined PDF painting semantics.
- Explicit bindings identify its painting occurrences.
- Paths, placement, clipping, text, fonts, and page structure remain intact.
- The PDF contains enough original state for reset without another file.
- Declared scopes isolate the change from other targets.
- Processing requires no source renderer, selector evaluation, script, or network request.

Version 1 accepts only the six properties below. Line caps, dashes, gradients, blend modes, text color, and image tint
remain outside it. Position, angle, scale, spacing, fonts, content replacement, and page layout are outside styling.
Extraction and composition are separate page operations.

Painted extent can change without changing path geometry. Wider strokes and newly enabled fills cover more paper within
existing clipping boundaries. `display: none` suppresses paint without deleting the path.

### 1.2 Version 1 properties

Implementations support every property on eligible records. Producers expose only properties their targets support.

| Property         | Value                                 | Effect                  |
| ---------------- | ------------------------------------- | ----------------------- |
| `stroke-width`   | Finite positive number in millimeters | Physical stroke width   |
| `stroke-color`   | `#` and six hexadecimal digits        | Stroke color            |
| `stroke-opacity` | Finite number from 0 to 1             | Stroke alpha            |
| `fill-color`     | `#` and six hexadecimal digits        | Eligible fill color     |
| `fill-opacity`   | Finite number from 0 to 1             | Eligible fill alpha     |
| `display`        | `inline` or `none`                    | Target paint visibility |

Stroke and fill alpha are independent. Zero opacity does not change `display`. Explicit colors use DeviceRGB components
derived from their hex values. This encoding promises neither matching screen/printer colors nor an sRGB color-managed
workflow.

Every target has exactly one controlling display parameter. One parameter can control several targets. `none` hides
stroke and fill on screen and in print while retaining geometry, bindings, baselines, and selected values. `inline`
restores paint with those values. Showing it again works from the saved PDF alone.

### 1.3 Protected content

Styling preserves:

- Path operators and their original numeric operands.
- Transformations, clipping, Form bounds, and placement order.
- Page count, order, boxes, rotation, and `UserUnit`.
- Text operators, content, font resources, and embedded font bytes.
- Unselected painting, images, navigation, labels, attachments, and unrelated metadata.

Object numbers, compression, stream packaging, and cross-reference structures can change. Protected numbers cannot be
rounded. Only declared painting state and painting operations change. The processor never regenerates drawing content
from SVG, CSS, or rasters.

### 1.4 Supported painting contexts

Targets contain vector path painting in page streams or Form XObjects. A Form XObject is a reusable PDF drawing stream
with resources. Editable colors use DeviceGray or DeviceRGB without effective `DefaultGray` or `DefaultRGB` replacement.
Baselines can contain hairlines. Width overrides must be positive physical widths. Unexposed line caps, joins, dashes,
and other painting state remain intact.

Editable scopes require normal blending, no soft mask, and no overprint. Ancestor transparency groups must be isolated
and non-knockout, with supported DeviceGray or DeviceRGB blending spaces. Group boundaries and compositing state remain
intact. Editable scopes exclude text, images, shading, patterns, and optional-content behavior. Unrelated protected
content can use those features. Unsupported target contexts fail instead of receiving an approximate rendering.

Clip construction stays outside mutable scopes. Editable paint cannot terminate a pending clip operation. Painting under
an existing clip preserves it. Width bindings require nonsingular uniform transforms, including rotation or reflection.
Other properties do not require uniform scale. Producers cannot expose physical width for skewed or nonuniformly scaled
occurrences. Permitted width ranges must respect page and Form clipping.

Version 1 accepts unencrypted PDFs without digital signatures. Encryption, certification signatures, usage-rights
signatures, and other digital signatures are rejected. It makes no PDF/A, PDF/X, or PDF/UA conformance or preservation
claim.

## 2. Ownership

| Component             | Responsibility                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------- |
| Processor             | Validate contracts, describe, style, reset, extract, compose, and serialize PDF results.          |
| Native SVG producer   | Resolve selectors and render occurrences, capture baselines, and publish prepared PDFs.           |
| CLI host              | Read files, schedule calls, handle cancellation, and install output.                              |
| Consuming application | Parameter meaning, publication defaults, page choices, repetition policy, layout, and imposition. |

Native and WASM share one processor. It imports no producer or application code and requires no producer installation.
Other producers use the same file contract. Applications supply Jobs and immutable Inputs separately from workspace
state. An application promising an editable result must preserve a valid contract through its page operations.

The file contract and CLI commands are public surfaces. Processor adapters and application widgets are internal. Version
1 promises no separate SDK, UI package, plugin system, or arbitrary-PDF editor.

## 3. Targets and state

### 3.1 Occurrences, regions, and bindings

An occurrence is one use of content in its page and resource context. Shared Forms can have independently styled
placements. A region identifies one occurrence scope with ordered paint records. Each record identifies one
path-painting operation and immutable baseline. Region IDs are document-unique and independent of object numbers and
page order. Repeated placements need distinct occurrence scopes even with shared record storage.

A target is a named nonempty region set. Every editable region belongs to exactly one target. Targets neither overlap
nor form visibility hierarchies. IDs are opaque. Names, colors, positions, Page codes, and source classes never identify
targets implicitly.

A binding connects a parameter to one property on existing targets. Its eligible records must be explicit and nonempty.
Stroke bindings affect stroke records. Fill bindings affect eligible fill records. Display affects every record in its
targets. Different parameters can control different properties on the same target. Two parameters cannot control the
same property on one record. There is no cascade, request-order precedence, or implicit parameter coupling.

A Style object is the parameters bound to the same exact unordered target-ID set. Subset or overlapping sets identify
different objects. Parameter IDs, titles, UI groups, presentation order, and values do not establish membership. This
derived relationship adds no manifest record or compound value.

### 3.2 Baseline, override, and effective style

Baselines and parameter definitions remain immutable during styling. Optional `value` is an explicit override. Without
it, each eligible record uses its own baseline. Those baselines can differ within one parameter. Effective style
combines baselines, overrides, and display. Hidden records retain selected opacity, color, and width.

For records with original stroke alpha 1.0 and 0.25:

| Operation        | Stored state                   | Selected alpha | Visible result       |
| ---------------- | ------------------------------ | -------------- | -------------------- |
| Open original    | No overrides                   | 1.0 and 0.25   | Original distinction |
| Set opacity 0.65 | Opacity `0.65`                 | 0.65 and 0.65  | Both at 0.65         |
| Hide             | Also display `none`            | 0.65 and 0.65  | No target paint      |
| Set opacity 0.40 | Opacity `0.40`, display `none` | 0.40 and 0.40  | Still hidden         |
| Show             | Display `inline`               | 0.40 and 0.40  | Both at 0.40         |
| Reset opacity    | Only display override remains  | 1.0 and 0.25   | Original distinction |
| Reset all        | No overrides                   | 1.0 and 0.25   | Original appearance  |

An override equal to its baseline remains an override. Reset removes it even without a visible change.

### 3.3 Fill eligibility

Existing fills retain paint order and fill rule, including implicit subpath closure. No additional fill overlays an
existing fill. A stroke-only record can acquire fill only with producer declaration and processor proof of eligibility.
Every subpath with drawing operations must be closed, with at least one closed subpath. An isolated open `m` subpath
paints nothing and does not affect eligibility. One close operator elsewhere is insufficient. Open paths cannot acquire
fill.

Latent fill requires a recorded fill color, fill rule, and baseline fill alpha zero. Color alone leaves the record
unfilled. Positive fill opacity enables it at the original paint position. Reset restores the original stroke-only
operator. A stroke record duplicating a separate existing fill of the same geometry cannot acquire another fill.

## 4. JSON contract

### 4.1 Encoding and identifiers

JSON uses UTF-8 under [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259). Manifest, apply, and Job inputs are objects.
Supplied reset and extraction requests are arrays. Duplicate member names after escape decoding, invalid Unicode, and
byte-order marks are errors. Unknown fields fail at every defined object level. Object member order has no meaning.
Arrays carry order only where specified.

Target, parameter, page, region, baseline, record-set, and baseline-slot IDs are nonempty, case-sensitive strings
without control characters. They obey published string limits and remain opaque rather than selectors, paths, or
delimiter-based commands. ID collections contain no duplicates. Style numbers must fit finite binary64 values within
property limits. Protected PDF numbers never pass through that representation.

### 4.2 Manifest fields

| Field         | Requirement                                                                        |
| ------------- | ---------------------------------------------------------------------------------- |
| `version`     | Required integer `1`                                                               |
| `pages`       | Required nonempty map of page IDs to unique current zero-based integer PDF indexes |
| `regions`     | Required nonempty map of region IDs to occurrence records from Section 5.2         |
| `baselines`   | Required nonempty map of baseline IDs to immutable records from Section 5.2        |
| `targets`     | Required nonempty map of target IDs to nonempty region-ID arrays                   |
| `parameters`  | Required nonempty parameter-ID map                                                 |
| `recordSets`  | Optional nonempty map of record-set IDs to shared locator arrays                   |
| `groups`      | Optional ordered presentation groups                                               |
| `profileSets` | Optional ordered profile sets                                                      |

A parameter requires `schema` and `binding`, with optional `value`. A binding has exactly `targets` and `property`. Its
nonempty target array references existing targets. Its property belongs to Section 1.2. Page indexes name actual PDF
pages. Every region belongs to one target. Every target has its required display binding. Every baseline has at least
one record reference. Optional fields follow their full rules whenever present.

Bindings contain resolved PDF regions, never source selectors or CSS. Producer identity, publication revision, and page
labels are separate optional publication metadata. They add no manifest fields and do not select processor behavior.

### 4.3 Parameter schemas

A schema describes one scalar value under the restricted JSON Schema 2020-12 profile. Without `$schema`, version 1 fixes
that dialect. If supplied, `$schema` must be `https://json-schema.org/draft/2020-12/schema`. The processor never fetches
it.

| Keyword                                                      | Rule                                                 |
| ------------------------------------------------------------ | ---------------------------------------------------- |
| `$schema`                                                    | Exact dialect URI above                              |
| `type`                                                       | Required `number` or `string`, matching the property |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` | Finite numeric bounds for numbers                    |
| `enum`                                                       | Nonempty unique valid values of the declared type    |
| `pattern`                                                    | Colors only, exactly `^#[0-9a-fA-F]{6}$`             |
| `title`, `description`                                       | Optional plain-text annotations                      |
| `default`                                                    | Optional baseline annotation, never an assignment    |

Other keywords, arbitrary regular expressions, `$ref`, remote schemas, and array, object, or Boolean schemas are
rejected. Standard [validation and annotation semantics](https://json-schema.org/draft/2020-12/json-schema-validation)
still apply within this profile.

Constraints must admit at least one valid value. They narrow the supported property domain and trusted limits, never
widen them. For example, `minimum: 0` cannot permit a zero width override. Display requires an enum containing exactly
`inline` and `none`. Every `value` must satisfy its schema, binding capabilities, and trusted limits. `null` is invalid.

`title` labels the parameter. `description` explains the affected drawing and change. Without a title, consuming
applications can use its ID. `default` is permitted only for one representable baseline value shared by all eligible
records and accepted by the schema. Otherwise it is omitted. Description reports mixed or unrepresentable baselines
instead. Reset never applies `default`. Schemas contain no bindings, current state, widgets, or unit extensions. The
property defines its unit.

### 4.4 Presentation groups

`groups` is an ordered array. Each group requires plain-text `title` and ordered `parameters`, with optional plain-text
`description`. References name existing parameters. A parameter occurs in at most one group. Empty groups and an empty
array are permitted.

Groups are presentation hints, not targets or assignment scopes. A group can contain several Style objects or part of
one. Bindings identify related controls. Applications choose widgets without introducing parameter types, coupled
assignments, or placeholder PDF parameters. Workspace rendering belongs to the
[Web SPEC](../../web/doc/SPEC.md#source-styles) and [DESIGN](../../web/doc/DESIGN.md#style-presentation).

Group and parameter arrays preserve authored presentation order. Unlisted parameters use ID order. JSON object order
never substitutes for these arrays. Description, extraction, and composition retain their order while pruning or
remapping references. Presentation never changes scope, precedence, validation, or paint.

### 4.5 Style profiles

`profileSets` stores named override choices in the same manifest. It contains no CSS, geometry, printer detection, or
executable rules. An empty array is permitted. Each set requires `id`, `name`, nonempty unique `parameters`, and
`profiles`, with optional `description`. Set IDs are unique within the manifest. Set and profile IDs follow Section 4.1.
Names are nonempty plain text. Descriptions are plain text. A parameter belongs to at most one set. Unlisted parameters
remain editable.

Each set has 1–32 ordered profiles. A profile requires `id`, `name`, and `overrides`, with optional `description`. IDs
follow Section 4.1 and are unique within their set. Override keys belong to that set and hold valid parameter scalar
values. Unknown fields and references fail. The first profile represents original styles and has empty overrides.

Opening preserves saved overrides without applying a profile. Choosing a profile replaces all overrides within its set.
Omitted parameters return to their own baselines. Other parameters and sets retain their choices. Applications supply a
complete Source map or reset the set before applying its overrides. There is no inheritance, cascade, saved
active-profile field, or additional processor operation. Profile values and meanings belong to the author.

Extraction prunes missing parameter references and overrides, dropping sets with no retained parameters. Composition
remaps set and parameter identities per Source while retaining names, descriptions, and order. Repeated pages share
their Source's sets. Separate Sources keep independent sets even with the same Input.

### 4.6 Complete JSON example

This manifest describes two closed stroke-only records in one Style object. Fill starts transparent. Stroke alpha
differs between records. The saved opacity override is 0.15. Groups order the controls. Profiles use the same declared
parameters. A corresponding PDF must supply the scopes and resources from Section 5.

```json
{
  "version": 1,
  "pages": { "practice": 0 },
  "regions": {
    "practice:r2": {
      "page": "practice",
      "marker": "Rows2",
      "records": [{ "path": [], "marker": "Paint2", "baseline": "dark", "fill": "latent" }]
    },
    "practice:r3": {
      "page": "practice",
      "marker": "Rows3",
      "records": [{ "path": [], "marker": "Paint3", "baseline": "dim", "fill": "latent" }]
    }
  },
  "baselines": {
    "dark": {
      "paint": "S",
      "width": "0.2",
      "stroke": { "operator": "G", "operands": ["0.2"] },
      "fill": { "operator": "g", "operands": ["0"] },
      "strokeOpacity": "1",
      "fillOpacity": "0",
      "display": "inline",
      "fillRule": "nonzero"
    },
    "dim": {
      "paint": "S",
      "width": "0.2",
      "stroke": { "operator": "G", "operands": ["0.2"] },
      "fill": { "operator": "g", "operands": ["0"] },
      "strokeOpacity": "0.25",
      "fillOpacity": "0",
      "display": "inline",
      "fillRule": "nonzero"
    }
  },
  "targets": { "pattern.partial": ["practice:r2", "practice:r3"] },
  "parameters": {
    "partial-fill-color": {
      "schema": { "type": "string", "title": "Fill color" },
      "binding": { "targets": ["pattern.partial"], "property": "fill-color" }
    },
    "partial-fill-opacity": {
      "schema": { "type": "number", "minimum": 0, "maximum": 1, "title": "Fill opacity" },
      "binding": { "targets": ["pattern.partial"], "property": "fill-opacity" }
    },
    "partial-stroke-color": {
      "schema": { "type": "string", "title": "Stroke color" },
      "binding": { "targets": ["pattern.partial"], "property": "stroke-color" }
    },
    "partial-opacity": {
      "schema": { "type": "number", "minimum": 0, "maximum": 1, "title": "Stroke opacity" },
      "binding": { "targets": ["pattern.partial"], "property": "stroke-opacity" },
      "value": 0.15
    },
    "partial-width": {
      "schema": { "type": "number", "exclusiveMinimum": 0, "maximum": 0.4, "title": "Stroke width" },
      "binding": { "targets": ["pattern.partial"], "property": "stroke-width" }
    },
    "partial-display": {
      "schema": { "type": "string", "enum": ["inline", "none"], "title": "Partial rows" },
      "binding": { "targets": ["pattern.partial"], "property": "display" }
    }
  },
  "groups": [
    {
      "title": "Patterns",
      "parameters": [
        "partial-fill-color",
        "partial-fill-opacity",
        "partial-stroke-color",
        "partial-opacity",
        "partial-width",
        "partial-display"
      ]
    }
  ],
  "profileSets": [
    {
      "id": "print",
      "name": "Style profile",
      "parameters": ["partial-fill-color", "partial-fill-opacity", "partial-width"],
      "profiles": [
        { "id": "generic", "name": "Generic", "overrides": {} },
        {
          "id": "inkjet",
          "name": "Inkjet",
          "overrides": {
            "partial-fill-color": "#A9A9A9",
            "partial-fill-opacity": 0.4,
            "partial-width": 0.04
          }
        }
      ]
    }
  ]
}
```

`{"partial-opacity":0.65,"partial-display":"none"}` sets both overrides. A later `{"partial-opacity":0.40}` preserves
the hidden state. Resetting opacity removes only its `value`. Resetting all restores each record's authored state.
Requests contain neither a `changes` envelope nor a target-to-style map.

## 5. PDF representation

### 5.1 Manifest transport

Version 1 uses PDF 1.7 features. Exactly one `mainz.json` entry appears in the standard `EmbeddedFiles` name tree. Its
Filespec `F` and `UF` name `mainz.json`. Both `EF` entries reference the same embedded stream, whose subtype is
`/application#2Fjson`. Other attachments are permitted. The processor resolves complete name trees, including child
nodes, and rejects duplicate or inconsistent manifest declarations.

PDF 2.0 can associate that same Filespec and payload through an Associated File reference. It creates no second source
of truth and requires no PDF-version conversion. Unsupported PDF extensions affecting editable scopes fail. Standard
`Metadata` contains XMP, never raw JSON.

All Mainz-specific data belongs in embedded JSON. PDF scopes use the standard `Figure` tag and local `Properties`,
`XObject`, and `ExtGState` names. Marker property dictionaries are empty, without private keys, actions, optional
content, or structure identifiers. Resource names belong to their owning dictionaries. This encoding needs no private
tag, key, or developer prefix. It asserts no Tagged PDF conformance and preserves foreign logical structure outside
paint records. Later private extensions must follow
[Annex E name rules](https://pdf-issues.pdfa.org/32000-2-2020/clauseAnnexE.html).

### 5.2 Identity and baseline records

An inline region has exactly `page`, `marker`, and `records`. A shared region has exactly `page`, `marker`, `recordSet`,
and `baselineRefs`. Both forms can coexist. Page IDs reference the manifest. Region markers name resources in their
page's effective `Properties` dictionary. Exactly one `/Figure /marker BDC ... EMC` sequence identifies each region.
Regions contain complete graphics objects and balanced scopes, without nesting or overlap.

Inline `records` is a nonempty ordered locator array. Shared `recordSet` references a nonempty array in root
`recordSets` and excludes inline `records`. Every shared array has a region reference. Locators have exactly these
fields:

| Field      | Meaning                                                                         |
| ---------- | ------------------------------------------------------------------------------- |
| `path`     | Ordered Form-invocation steps, empty for paint directly in the page region      |
| `marker`   | Local `Properties` name identifying one complete paint scope in the final owner |
| `baseline` | Baseline ID for inline records, or local baseline-slot ID for shared records    |
| `fill`     | `existing`, `latent`, or `none`, subject to Section 3.3                         |

`baselineRefs` maps every shared slot to an existing baseline, with no missing or unused slots. Regions can map the same
slot to different baselines. Original baseline identities and numeric strings remain intact. Record-set and slot IDs
identify syntax, not painting occurrences. Serialization can replace those IDs. Every locator resolves in its region's
page, resource, invocation, and effective-paint context. Sharing never bypasses occurrence validation or merges Source
baselines.

For example, these regions share syntax but keep separate baselines:

```json
{
  "recordSets": { "row": [{ "path": [], "marker": "Paint", "baseline": "ink", "fill": "none" }] },
  "regions": {
    "first": { "page": "practice", "marker": "Rows1", "recordSet": "row", "baselineRefs": { "ink": "dark" } },
    "second": { "page": "practice", "marker": "Rows2", "recordSet": "row", "baselineRefs": { "ink": "dim" } }
  }
}
```

This fragment requires the other manifest fields and matching PDF scopes. Producers can share equal locator arrays after
assigning local slots. Resource isolation can separate arrays. Extraction removes unused arrays. Composition can share
syntax while keeping Source baselines independent.

A Form step has exactly `resource` and nonnegative integer `occurrence`. Counting starts at zero and includes only `Do`
operations using that resource. The first step counts within the page region. Later steps count within the entire
selected Form stream. The final marker resolves within the selected sequence without entering another Form. Every
traversed Form has explicit `Resources`, without obsolete resource inheritance.

For example, `[{"resource":"Row","occurrence":1},{"resource":"Shape","occurrence":0}]` selects the second Row invocation
and its first Shape invocation. Object numbers never identify either occurrence. Locator resource names use ASCII
letters, digits, dots, or hyphens, with a letter first and no leading slash. Opaque IDs and unrelated PDF resources do
not inherit that restriction. Each marker names an empty dictionary and resolves once in its selected owner. Locators
cannot resolve to the same paint occurrence. Missing, ambiguous, cyclic, overlapping, or inconsistent bindings fail.

A baseline requires exactly these fields:

| Field                          | Meaning                                                                         |
| ------------------------------ | ------------------------------------------------------------------------------- |
| `paint`                        | Original `S`, `s`, `f`, `f*`, `B`, `B*`, `b`, or `b*`                           |
| `width`                        | Original local PDF numeric string, nonnegative, with zero for a hairline        |
| `stroke`                       | `operator` of `G` or `RG`, with one or three original numeric-string `operands` |
| `fill`                         | `operator` of `g` or `rg`, with one or three original numeric-string `operands` |
| `strokeOpacity`, `fillOpacity` | Original alpha as PDF numeric strings                                           |
| `display`                      | Original `inline` or `none`                                                     |
| `fillRule`                     | `nonzero` or `evenodd`, matching existing fill or defining latent fill          |

A PDF numeric string contains exactly one finite PDF number, without whitespace, comments, or exponent notation. Color
and alpha components range from 0 to 1. Reset preserves original strings without conversion through JSON numbers. Equal
baselines can share immutable storage.

`existing` requires original fill. `latent` requires `S` or `s`, zero fill alpha, and every-subpath closure. `none`
requires stroke-only painting and stays ineligible for fill properties. Stroke properties require original stroke
operations. Display applies to all records. These rules determine capabilities without another property list.

Initially hidden or transparent targets retain editable geometry. Producers record original visibility separately from
geometry materialization. Publication without overrides must match authored appearance. Unrecoverable geometry or
original state fails publication.

### 5.3 Paint-scope grammar

Each paint marker identifies exactly this structure:

```text
/Figure /Paint2 BDC
q
0.2 w
0.2 G
0 g
/Alpha2 gs
10 10 m 50 10 l 50 50 l h
S
Q
EMC
```

For Section 4.6, an enclosing `/Figure /Rows2 BDC ... EMC` identifies the region. Resources include
`/Properties << /Paint2 << >> >>` and `/ExtGState << /Alpha2 << /Type /ExtGState /CA 0.15 /ca 0 >> >>`. The second
record has its own Rows3 and Paint3 markers. Foreign marked-content sequences can surround complete scopes, never
interrupt path objects.

After `q`, the prefix has exactly one width, stroke-color, fill-color, and alpha operation, in that order: `w`,
`G`/`RG`, `g`/`rg`, `gs`. The alpha resource contains exactly `Type: ExtGState`, `CA`, and `ca`, with valid numeric
values. A nonempty path follows, then exactly one paint operator, `Q`, and `EMC`. Paths permit only `m`, `l`, `c`, `v`,
`y`, `h`, and `re`, with valid operand counts and subpaths. No other operator or nested marker is permitted. Comments
and whitespace can separate tokens.

Marked-content operators occur between complete graphics objects, following
[ISO 32000-1, Section 14.6](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf).
The processor parses complete tokens and balanced scopes instead of searching for `EMC` or substituting text. Only the
prefix, alpha reference, and paint operator are mutable. Path tokens retain their original numeric spelling. Current
paint must match baseline plus overrides before editing.

Latent nonzero fill uses `B` or `b`. Even-odd fill uses `B*` or `b*`. Hidden records retain their selected paint
operator with zero effective stroke/fill alpha. Before editing a shared occurrence, the processor copies its invoked
Forms and every mutable resource dictionary on that path. A top-level copy cannot isolate shared `XObject` or
`ExtGState` subdictionaries. Immutable geometry, baseline JSON, and unrelated resources can remain shared.

Isolation can update structural locators, never parameter definitions or baselines. New resource names avoid existing
entries. Reuse requires identical immutable style state. Updated locators keep page/region identities and baselines.
Unused processor-owned replacement resources are removed. Repeated edits replace styles rather than nesting scopes or
accumulating resources.

### 5.4 Physical width

For uniform effective scale `s` and page `UserUnit` `u`:

```text
local_width = w_mm * 72 / (25.4 * u * s)
```

Scale includes enclosing `cm` operations and Form matrices. `UserUnit` defaults to 1 and is separate from that scale.
Rotation changes orientation, not physical scale. Physical width precedes any printer-driver scaling. Printing at 100%
is required to obtain it on paper. For 0.20 mm, `u = 1, s = 2` needs approximately 0.2834645669 local units.
`u = 2, s = 2` needs approximately 0.1417322835. Reset restores the original local number.

For `[a b c d e f]`, define `sx = hypot(a,b)` and `sy = hypot(c,d)`. Both must be finite and positive. Uniformity
requires `abs(sx/sy - 1) <= 1e-9` and `abs((a/sx)*(c/sy) + (b/sx)*(d/sy)) <= 1e-9`. Use `s = sx`. Translation has no
effect. This relative tolerance permits floating-point composition without admitting visible skew or nonuniform scale.
Serialized width must remain positive and reproduce the requested width within `1e-8` mm. Unrepresentable widths fail
instead of becoming hairlines or clamped values.

## 6. Processor operations

Operations return results without modifying input bytes or document handles. Adapters own handles, buffers, lifetime,
and error conversion, without exposing QPDF object graphs.

| Operation  | Request and result                                                                     |
| ---------- | -------------------------------------------------------------------------------------- |
| `read`     | Validates PDF and any contract, returning an immutable document handle.                |
| `describe` | Returns definitions, overrides, baseline summaries, page scope, and presentation.      |
| `apply`    | Applies a parameter-ID-to-value patch and returns PDF bytes.                           |
| `reset`    | Removes selected overrides, or all with omitted IDs, and returns PDF bytes.            |
| `extract`  | Retains unique physical pages in requested order and rebuilds the contract.            |
| `compose`  | Executes a Job against separately supplied Inputs, returning PDF bytes and provenance. |

`apply` validates the complete request first. Unknown IDs, invalid values, unsupported properties, and malformed
definitions fail. `{}` is valid. Omitted IDs retain overrides. Requests cannot replace schemas, bindings, baselines, or
presentation. `reset` accepts optional unique existing parameter IDs. Omission resets all. `[]` resets none. Unknown IDs
fail even without a current override. Reset removes `value`, never assigning defaults or changing definitions. An
explicit baseline value still creates an override. Unchanged stored state from valid apply/reset returns original bytes.

Extraction accepts a nonempty unique array of integer zero-based physical indexes, including pages without editable
regions. It neither duplicates, scales, rotates, imposes, nor repaints pages. All pages in original order returns
original bytes. Invalid requests fail before page-tree changes. Retained streams, resources, boxes, rotation,
`UserUnit`, and page labels stay intact. Navigation to retained pages keeps its destination. Discarded page references
become null. Form fields belonging only to discarded pages are removed. Unrelated attachments and metadata remain. No
document actions execute.

Extraction remaps page indexes and prunes discarded regions, record sets, baselines, targets, and presentation
references. Bindings retain only targets with eligible records for their property. Unbound parameters and empty groups
disappear. Retained identities, definitions, baselines, and overrides stay unchanged. Results are validated and
reopened. Without editable regions, the manifest and its Associated File reference disappear, producing an ordinary PDF.
Restoring excluded pages requires the full Input, not the extraction result.

Read, description, extraction, and composition accept ordinary PDFs under the same limits and encryption/signature
restrictions. An invalid manifest is always an error. Apply and reset require a prepared PDF and report
`missing-contract` otherwise. The [CLI SPEC](../../cli/doc/SPEC.md#1-commands) defines verification.

Effective styles regenerate from baselines plus overrides. Hiding never deletes paths, paints white, or uses zero stroke
width. All resulting contracts and PDF structures are validated before success. Identical inputs, operation, and
processor build produce identical bytes. Native and WASM serialization can differ, but content, choices, and appearance
must agree.

### 6.1 Description record

Description has exactly `version`, `pageCount`, `pages`, `parameters`, and optional `groups` and `profileSets`. Version
is `1`. Page count is positive within build limits and includes physical pages without editable regions. `pages` maps
manifest IDs to objects with zero-based integer `index` and optional string PDF `label`. Indexes name actual pages.
Missing labels fall back to one-based physical numbers. Prepared descriptions have nonempty page/parameter maps.
Ordinary PDFs have empty maps and no `groups`. Profile sets are returned without selecting or changing them.

Each parameter entry has exactly:

| Field       | Meaning                                                               |
| ----------- | --------------------------------------------------------------------- |
| `parameter` | Complete manifest parameter record, with `value` only for an override |
| `baseline`  | Summary independent of current overrides                              |
| `pages`     | Nonempty unique page-ID array in current physical order               |

Groups retain their descriptions. Width uses millimeters, alpha a unitless ratio, and color/display no numeric unit.
Description contains no widget names or executable content.

| Baseline summary  | Exact fields and meaning                                                            |
| ----------------- | ----------------------------------------------------------------------------------- |
| `uniform`         | `kind` and `value`, valid for the schema and property                               |
| `mixed`           | Only `kind`, for different original states                                          |
| `unrepresentable` | `kind` and nonempty plain-text `reason`, for one state without a valid scalar value |

Mixed takes precedence over unrepresentable. Uniform never rounds original colors or substitutes zero for positive
physical width. Summaries never assign overrides. For Section 4.6, `partial-opacity` has this entry:

```json
{
  "parameter": {
    "schema": { "type": "number", "minimum": 0, "maximum": 1, "title": "Stroke opacity" },
    "binding": { "targets": ["pattern.partial"], "property": "stroke-opacity" },
    "value": 0.15
  },
  "baseline": { "kind": "mixed" },
  "pages": ["practice"]
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

### 6.2 Errors and limits

PDF bytes, JSON, and referenced records are untrusted. Limits apply before unbounded allocation, decoding, retention, or
expansion. Exhaustion returns no successful output. Documents cannot raise limits. Reference-build ceilings include:

| Scope                                     | Ceiling |
| ----------------------------------------- | ------- |
| PDF input/output bytes                    | 128 MiB |
| Embedded manifest                         | 8 MiB   |
| Apply/reset/extraction request JSON       | 1 MiB   |
| Referenced paint occurrences              | 500,000 |
| Cumulative expanded locator text per call | 128 MiB |

Locator accounting counts each shared-array occurrence, including repeated Source and completed-result validation. For
each occurrence, it counts UTF-8 region, page, target, and resolved baseline IDs, paint marker, fill capability, and
Form-step resource names. Shared arrays and slots do not reduce the total. Limits apply before copied text and paths are
stored. Other page, string, nesting, decoded-byte, and traversal ceilings remain enforced. Job limits appear in Section
6.3 and producer limits in Section 7.1. Published ceilings depend on the released build. They measure neither peak
memory nor device support.

Processor errors require plain-text `code` and nonempty `message`. Codes are `pdf-syntax`, `missing-contract`,
`unsupported-version`, `unsupported-context`, `invalid-contract`, `invalid-request`, or `limit-exceeded`. Optional
`parameter`, `page`, and `region` identify affected records. Field errors supply both `source` (`manifest` or `request`)
and `location`. Location is a [JSON Pointer](https://www.rfc-editor.org/rfc/rfc6901), not a URI fragment. The empty
pointer names the whole JSON input. It can identify missing or unknown fields without resolving to an existing value.

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

### 6.3 Job and composition

A Job contains ordered occurrences, complete Source styles, repetition, and duplex alignment. It excludes bytes, paths,
selections, UI labels, and preview state. Applications supply immutable Inputs separately. Input and Source IDs follow
Section 4.1.

| Record       | Fields                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------- |
| Job          | Required `version`, `sources`, `parts`                                                                  |
| `version`    | Integer `1`                                                                                             |
| `sources`    | Source-ID map, empty for Blank-only Jobs                                                                |
| Source       | Required `input` ID and complete `overrides` object                                                     |
| `parts`      | Nonempty ordered Part array                                                                             |
| Part         | Required nonempty `pages`, optional `copies` and `front`                                                |
| `copies`     | Positive integer, default `1`                                                                           |
| `front`      | Boolean, default `false`                                                                                |
| Content page | Exactly `source` and zero-based physical `page`                                                         |
| Blank page   | Exactly `blank`, containing finite positive `width` and `height` in millimeters, each at most 1,000,000 |

Every Source has a content reference. Every supplied Input serves a Source. Several Sources can share an Input. Pages
can repeat within and across Parts. Unknown fields, duplicate keys, bad versions, missing references, and invalid
indexes fail. Ordinary Sources require empty overrides. Prepared Sources validate every supplied value against their
Input's definitions.

Source overrides replace complete saved state rather than applying a patch. Omitted overrides return to authored
baselines. Mixed and unrepresentable baselines remain unassigned. Source changes never alter Inputs or other Sources.
All retained occurrences share their Source's parameter scope. Independent styles require independent Sources, even with
the same Input and page.

Each Part repeats its complete sequence `copies` times. With `front: true`, copies start at even zero-based Output
indexes and finish complete duplex sheets. An odd preceding length adds leading Padding. Odd sequences add trailing
Padding after every copy, including the last. Padding uses the preceding page's visible box: `CropBox` intersected with
`MediaBox`, falling back to `MediaBox` for an empty intersection. Dimensions include rotation and `UserUnit`, never
`TrimBox`. Explicit Blanks retain declared dimensions. Alignment does not configure a printer.

Composition retains content streams, resources, boxes, rotation, and `UserUnit`. Each occurrence receives a distinct
page object and manifest identity. Annotations and form fields are copied without sharing mutable annotations. Internal
links resolve to the first retained occurrence in the same Source. Discarded destinations become null. Attachments copy
once per Input, with collision-free Input prefixes for multiple Inputs. The new catalog does not merge document-wide
outlines, actions, metadata, or logical structure.

Sources retain independent parameter, target, and baseline identities. Definitions, overrides, and presentation survive,
with bindings covering every eligible retained occurrence. Unused targets, parameters, baselines, and empty groups
disappear. Without editable regions, Output is ordinary. Reset restores retained authored baselines without Inputs.
Completion validates and reopens Output before success.

The separate version 1 report has Output-ordered `pages`. Each record includes zero-based `part` and `copy`. Content
records also name original `source` and physical `page`. Blank records give dimensions and Boolean `padding`. The
report's `parameters` map relates generated IDs to original `source` and `parameter` IDs. Provenance is result metadata,
neither a PDF binding nor an extra Job field.

Both adapters enforce these limits before Input retention or expansion:

| Quantity              | Maximum |
| --------------------- | ------- |
| Inputs / Sources      | 32 each |
| Aggregate Input bytes | 128 MiB |
| Job JSON              | 1 MiB   |
| Copies per Part       | 1,000   |
| Expanded pages        | 10,000  |

Other manifest, output, decoding, and traversal limits still apply. Failures preserve Inputs and return no successful
PDF or partial report. Job field errors use `source: "request"` and pointers to their Source, Part, or page reference.

This Job uses the prepared example from Section 4.6 as Input `book`, with two independently styled Sources:

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

### 6.4 Job adapters

The native executor accepts Job JSON and an Input-ID-to-owned-byte map. It returns owned PDF bytes and report JSON,
without file access or scheduling. The [CLI](../../cli/doc/SPEC.md#2-requests) resolves file bindings before calling it.

The WASM module has one active immutable styling document. `mainz_read` opens it and `mainz_close` releases its handle.
Applying styles, resetting, extracting, and composing do not replace that active document. A host closes it before
opening another. Callers own input buffers, borrowed only during synchronous calls.

`mainz_input(idPointer, idSize, pdfPointer, pdfSize)` copies valid UTF-8 IDs and PDF bytes into a separate registry.
Duplicate IDs fail. `mainz_clear_inputs()` releases registered bytes. They otherwise persist until cleared or worker
termination. `mainz_compose(jobPointer, jobSize)` uses the native interpreter against that registry.

PDF bytes use `mainz_result` and `mainz_size`. Report JSON uses `mainz_report` and `mainz_report_size`. Results belong
to the module until the next operation. Both must be copied before another call, including cleanup. `mainz_status()`
distinguishes success (`0`), structured processor failure (`1`), and host failure (`2`). The host owns worker
scheduling, cancellation, Input recovery, and downloads.

## 7. Producer and consuming-application obligations

A producer resolves source rules, selectors, render instances, paint order, and compositing before publication. It
supplies resolved bindings and original baselines, never source rules for the processor to evaluate. It retains editable
occurrences and rejects selections requiring reordered paint or unsupported compositing. Baselines precede authored
`value` overrides. Publication applies those overrides through the processor.

Contract-aware page operations read the original manifest, retain applicable definitions/state, and rebuild resulting
bindings. Missing targets, unbound parameters, and invalid presentation references cannot survive. Independently
editable duplicates need distinct occurrence identities. Conflicting identities, definitions, or overrides require an
explicit merge policy or failure.

Layout and imposition belong to consuming applications and can change scale. Resulting width bindings must still satisfy
Section 5.4. Desired physical widths apply after layout. Losing the manifest makes later styling fail, rather than
triggering inferred reconstruction. Ordinary page operations remain available under Section 6.

### 7.1 SVG declarations

The native producer accepts SVG and separate JSON declarations. Declarations require `targets` and `parameters`, with
optional `groups` and `profileSets`. Each target has selectors and can declare `fill: true` for eligible closed paths or
`display: "none"` for authored hidden state. Targets are disjoint, preserve paint order, and have a display parameter.
Profiles follow Section 4.5 and do not apply automatically during export.

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

Properties and schemas follow Sections 1.2 and 4.3. `value` applies only after baseline capture. `default` must agree
with eligible baselines. Ordered groups carry presentation order without changing parameter semantics.

Selected targets support vector paths. Text and images stay outside them. Masks, filters, group opacity, unsupported
paint contexts, and ambiguous visibility fail. Targets hidden by `display: none !important` cannot be materialized. If
the SVG stylesheet uses attribute selectors, CSS escapes, or `MainzSource`, source paint roots need authored IDs. These
stylesheet restrictions do not extend the declaration-selector grammar.

SVG input is limited to 128 MiB, 64 XML levels, and one million elements. Declarations and captured manifest metadata
are limited to 1 MiB. Decoded Form capture shares a 128 MiB budget. Producer errors use structured records and can add
`producer-error` to processor error codes.

## 8. Required publication behavior

Equivalent prepared PDFs behave identically regardless of producer or publication names.

| Case                  | Required result                                                            |
| --------------------- | -------------------------------------------------------------------------- |
| Printer adjustment    | Change declared paint, save, reopen, and reset without the original PDF.   |
| Slant guides          | Hide/restore existing guides without changing angle or other targets.      |
| Partial rows/columns  | Change remaining placements while retaining full first-row/column styles.  |
| Mixed placements      | Retain internal order, existing fills, and stroke-only records.            |
| Page selection/layout | Contract-aware applications retain valid styling through their operations. |

For example, first-row stroke alpha 1.0 and remaining-row alpha 0.25 can share existing fill alpha 0.40. Changing
partial stroke alpha preserves first-row styles and fill alpha. Changing partial fill leaves open stroke-only shapes
unchanged. Repeated shared shapes and first-column layouts obey the same rule. Printer defaults and useful ranges belong
to the publication. One profile is not promised for every printer. Physical printer evidence determines those defaults.

## Glossary

The [Web glossary](../../web/doc/SPEC.md#glossary) owns workspace terms.

| Term                     | Meaning                                                                                                       |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- |
| Baseline                 | Immutable original state of one paint record before overrides.                                                |
| Baseline slot            | Shared locator's local reference mapped to a region's own baseline.                                           |
| Binding                  | One parameter's connection to one property on eligible records in declared targets.                           |
| Composition              | Ordered assembly of pages and blanks, preserving retained content and rebuilding the prepared contract.       |
| Description              | Read-only processor record of pages, definitions, overrides, baseline summaries, groups, and profiles.        |
| Effective style          | Paint state after baseline, overrides, and display combine. Hidden targets retain selected values.            |
| Extraction               | Retaining unique pages in order and rebuilding bindings, without changing drawing content.                    |
| Input                    | Immutable PDF bytes supplied separately under an opaque Input ID. Several Sources can share them.             |
| Job                      | Versioned composition request with complete Source overrides, repetition, and duplex alignment.               |
| Mainz                    | Project, contract, processor, reference producer, CLI, and WASM boundary, consumed by PDF Studio.             |
| Manifest                 | Embedded declaration of pages, regions, baselines, targets, parameters, overrides, and optional presentation. |
| Locator                  | Ordered Form invocation path and paint marker resolving one record in a page region.                          |
| Marker                   | Local empty PDF property resource identifying one balanced Figure sequence.                                   |
| Mixed baseline           | Different original values across one parameter's eligible records.                                            |
| Occurrence               | One use of content in its page/resource context, independent of shared geometry storage.                      |
| Override                 | Explicit parameter `value`. Reset removes it rather than assigning a new default.                             |
| Paint property           | Supported PDF painting attribute, distinct from a parameter or JSON Schema's properties keyword.              |
| Paint record             | Declared path painting operation with immutable baseline and capabilities.                                    |
| Painted extent           | Painted area within clipping, potentially changed without changing geometry.                                  |
| Parameter                | Named scalar styling choice with constraints, presentation, and a binding.                                    |
| Path geometry            | Path operators and coordinates, preserved by styling.                                                         |
| Prepared PDF             | Materialized editable geometry, valid manifest, resolved bindings, and immutable baselines in one PDF.        |
| Presentation group       | Ordered parameter references with title/description, without style identity or assignment scope.              |
| PDF Studio               | Local web consumer for page composition and Source styling.                                                   |
| Processor                | Library applying the PDF contract and contract-aware page operations independently of producers.              |
| Producer                 | Software publishing prepared geometry and declarations into the PDF contract.                                 |
| Reference application    | Consumer exposing the common processor. File conformance does not depend on its widgets.                      |
| Record set               | Shared ordered locator syntax retaining separate occurrences and baseline identities.                         |
| Region                   | Unique occurrence scope with ordered paint records, belonging to one target.                                  |
| Schema                   | Restricted JSON Schema for one parameter's scalar values and annotations.                                     |
| Selector                 | Producer-side source selection, resolved before processor input.                                              |
| Source                   | One Input reference with complete independent overrides shared across retained occurrences.                   |
| Styling                  | Declared paint changes preserving geometry, protected content, and page structure.                            |
| Style declaration        | Separate producer input with selectors, bindings, optional presentation, profiles, and overrides.             |
| Style object             | Parameters bound to the same exact unordered target set.                                                      |
| Style scope              | Balanced marker sequence containing local state, complete path, paint, and state restoration.                 |
| Style profile            | Named overrides replacing their set's assignments, with omitted parameters restored to baseline.              |
| Profile set              | Ordered profiles over one independent parameter scope, beginning with original styles.                        |
| Target                   | Named nonempty region set receiving declared style changes.                                                   |
| Unrepresentable baseline | One original state without a valid scalar override, such as a hairline for positive width.                    |
| Verification             | Assessment of one prepared PDF. Preservation requires independent input/output comparison.                    |

## References

- [ISO 32000-1:2008](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf):
  PDF objects, painting, units, transparency, marked content, and attachments.
- [PDF 2.0 specification and errata](https://pdfa.org/resource/pdf-specification-archive/): PDF 2.0 inputs.
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259): JSON interchange.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12): constraint and annotation semantics.
- [QPDF structural checks](https://qpdf.readthedocs.io/en/stable/cli.html#option-check): syntax is not proof of full
  conformance or preservation.

Mainz is an application contract built on PDF features, not an ISO-standardized styling language.
