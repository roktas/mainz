# Mainz Library Specification

## Prepared PDFs

A prepared PDF carries editable painting choices, their original baselines, and saved overrides. PDF Composer can change
its declared colors, line widths, opacity, or visibility while keeping text, layout, and path geometry fixed. The PDF
remains editable and resettable without its drawing source or producer. Ordinary viewers render its saved appearance.
Ordinary PDFs support page composition but have no Mainz Style controls.

Page names, tags, and thumbnail images are optional page metadata. They can accompany ordinary or prepared PDFs. Page
metadata does not create Style controls or change the printed page.

This document owns the version 1 PDF/JSON contract, processor behavior, native/WASM boundaries, and SVG production. The
[CLI SPEC](../../cli/doc/SPEC.md) owns commands and file policy. The [Web SPEC](../../web/doc/SPEC.md) owns workspace
behavior. [AGENTS.md](../../AGENTS.md) owns build and validation procedures. The [glossary](#glossary) defines contract
terms.

## Implementation status

The native and WASM processor implement the version 1 physical-page array, numeric region references, independent page
metadata, and manifests without editable paint. Description includes PNG descriptors; preview access returns image
bytes. The native Imprinter accepts page annotations and separate PNG bytes. Pixel decoding belongs to the host.

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

Display is optional, like the other properties. A target has at most one controlling display parameter. Without one,
styling retains each record's original display state. One parameter can control several targets. `none` hides stroke and
fill on screen and in print while retaining geometry, bindings, baselines, and selected values. `inline` restores paint
with those values. Showing it again works from the saved PDF alone.

### 1.3 Protected content

Styling preserves:

- Path operators and their original numeric operands.
- Transformations, clipping, Form bounds, and placement order.
- Page count, order, boxes, rotation, and `UserUnit`.
- Text operators, content, font resources, and embedded font bytes.
- Unselected painting, images in page content, navigation, PDF labels, unrelated attachments, and unrelated metadata.

Object numbers, compression, stream packaging, and cross-reference structures can change. Protected numbers cannot be
rounded. Only declared painting state and painting operations change within page content. The processor never
regenerates drawing content from SVG, CSS, or rasters.

Styling can remove managed preview references and unused preview assets under Section 6. Page names and tags remain
intact.

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
Other producers use the same file contract. Applications supply Plans and immutable Inputs separately from workspace
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
nor form visibility hierarchies. IDs are opaque. Names, colors, positions, page codes, and source classes never identify
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

JSON uses UTF-8 under [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259). Manifest, overrides, Plan, and Recipe inputs
are objects. Supplied reset and extraction requests are arrays. Duplicate member names after escape decoding, invalid
Unicode, and byte-order marks are errors. Unknown fields fail at every defined object level. Object member order has no
meaning. Arrays carry order only where specified.

Target, parameter, region, baseline, record-set, and baseline-slot IDs are nonempty, case-sensitive strings without
control characters. They obey published string limits and remain opaque rather than selectors, paths, or delimiter-based
commands. ID collections contain no duplicates. Style numbers must fit finite binary64 values within property limits.
Protected PDF numbers never pass through that representation.

#### Presentation annotations

Parameter schemas, presentation groups, profile sets, and profiles share the following annotation semantics. Their
existing `name` or `title` requirements remain unchanged.

| Field             | Requirement                                                    | Purpose                                                |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| `name` or `title` | Defined by the owning object                                   | The shortest display label.                            |
| `description`     | Optional                                                       | A concise explanation displayed with its owning label. |
| `details`         | Optional; requires a nonblank `description` on the same object | A longer explanation that expands that description.    |

Details explain the same subject as their description. They do not replace it or introduce a separate assignment scope.
A supplied `details` field without a description, or with an empty or whitespace-only description, is invalid.
Whitespace-only means empty after ECMAScript `String.trim()` whitespace and line terminators are removed. Descriptions
without details remain valid. Neither annotation assigns values or changes PDF painting.

Both fields are plain-text strings under the existing JSON string and total-byte limits. Paragraph breaks are permitted.
Consumers do not interpret markup or executable content. They display a supplied description with its label and expose
details on demand. Empty or whitespace-only details create no information icon or other details control. The Web SPEC
owns the workspace interactions.

### 4.2 Manifest fields

| Field         | Requirement                                                                         |
| ------------- | ----------------------------------------------------------------------------------- |
| `version`     | Required integer `1`                                                                |
| `pages`       | Required nonempty array with exactly one object per physical PDF page, in PDF order |
| `regions`     | Required map of region IDs to occurrence records from Section 5.2                   |
| `baselines`   | Required map of baseline IDs to immutable records from Section 5.2                  |
| `targets`     | Required map of target IDs to nonempty region-ID arrays                             |
| `parameters`  | Required parameter-ID map                                                           |
| `recordSets`  | Optional nonempty map of record-set IDs to shared locator arrays                    |
| `groups`      | Optional ordered presentation groups                                                |
| `profileSets` | Optional ordered profile sets                                                       |
| `publication` | Optional producer-declared stable document identity and compatibility veto          |

A parameter requires `schema` and `binding`, with optional `value`, `family`, and `key`. A binding has exactly `targets`
and `property`. Its nonempty target array references existing targets. Its property belongs to Section 1.2. Page indexes
name actual PDF pages. Every region belongs to one target. Every target has at least one parameter binding. Every
baseline has at least one record reference. Optional fields follow their full rules whenever present.

The four paint maps are nonempty together or empty together. Empty paint maps require at least one page metadata field.
Such a document has no editable paint and remains ordinary for Style operations. The manifest still carries its page
metadata. Empty paint maps also require omission of `recordSets`, `groups`, and `profileSets`.

Bindings contain resolved PDF regions, never source selectors or CSS. Page labels remain separate from parameter and
publication identity. Optional publication metadata follows the declaration below and never selects painting behavior.

#### Page metadata

`pages` is an array in physical PDF order. Its length equals the PDF page count. The array index is the page identity
inside this Document. Each element is an object containing only the optional fields below. `{}` represents a page
without authored metadata and retains its position.

| Field     | Value                                                       | Meaning                              |
| --------- | ----------------------------------------------------------- | ------------------------------------ |
| `name`    | Nonblank plain-text string without control characters       | Authored display name for the page.  |
| `tags`    | Array of unique nonblank strings without control characters | Unordered labels for page selection. |
| `preview` | Nonempty embedded-file name                                 | PNG thumbnail under Section 5.1.     |

Names can repeat, including after composition. Names are display text, not page identities. Tags use exact,
case-sensitive string equality. Their order has no meaning, and an empty array is valid. The processor does not trim,
case-fold, normalize, split, or interpret these strings. Existing string and JSON limits apply. Nonblank follows the
whitespace rule in Section 4.1.

Consumers can derive name-to-page and tag-to-page indexes in memory. A name can resolve to several physical indexes. The
PDF stores no reverse lookup tables. Consumers resolve named choices and tag predicates to physical page indexes before
the existing Plan or Recipe path. This version defines no query grammar, Boolean-expression field, or dynamic name/tag
selector in those records.

Page names and tags remain separate from PDF page labels, outlines, and named destinations. The processor neither infers
them from navigation structures nor generates a TOC from them. Existing navigation preservation and composition rules
remain in effect.

This fragment describes two physical pages; only the first has annotations:

```json
{
  "pages": [
    {
      "name": "Cross strokes",
      "tags": ["practice", "cross-strokes"],
      "preview": "practice.png"
    },
    {}
  ]
}
```

The PDF must contain the referenced PNG attachment. The attachment name has no filesystem or URL semantics. Page
metadata belongs to version 1.

#### Document metadata

Document-wide title, description, authorship, and copyright belong in standard PDF XMP metadata, not in the Mainz
manifest. Their standard properties are `dc:title`, `dc:description`, `dc:creator`, and `dc:rights`. The producer owns
these values and their encoding. If it also writes equivalent legacy Info entries, it keeps them consistent with XMP.
The manifest's `publication` record remains a separate processing-compatibility claim.

Styling, extraction, and whole-Input styling under Section 6.3 retain existing document metadata. Other composition
creates a new Document and does not choose or merge Input titles, authors, or rights declarations. The producing
application can supply a title and cover page through the Plan's optional `metadata` field. Composition writes these
choices to XMP under Section 6.3. Other publication metadata remains the producing application's responsibility.

#### Style families and semantic keys

Optional `family` and `key` occur together on a parameter, outside its schema and binding. Both use the identifier
encoding and string limits from Section 4.1 and must contain non-whitespace text. Matching is exact and case-sensitive.
Separators have no syntax. Consumers never derive these fields from local IDs, titles, filenames, publication metadata,
or values. Missing fields permit local editing without cross-file matching.

`family` names an authored Style compatibility family, for example `megic`. It is not proof of publisher identity. `key`
names one stable parameter meaning within that family, for example `guides.stroke-width`. The producer guarantees that
equal family/key pairs have the same meaning and paint property. The property defines units under Section 1.2. Local
schemas can narrow valid values independently. A changed meaning requires a different key or family. No registry, remote
lookup, or separate family version is required.

Local parameter IDs remain document references. Equal semantic keys do not merge targets, bindings, baselines, or
overrides. Several independent parameters can share a family/key pair, including after composition. Their paint property
must agree within one manifest. Different schemas, baselines, and current values remain independent.

Read and description retain these fields. Style and reset never change them. Extraction retains them on surviving
parameters. Composition retains them unchanged when it remaps local IDs. SVG declarations use the same fields and rules.
The processor validates metadata and preserves independence. The consuming application owns cross-file choice
propagation under the Web SPEC; no processor operation couples files.

The fields are optional additions to contract version 1. Updated readers continue to accept definitions without them.
Older strict readers reject definitions containing these fields. Publication with semantic metadata requires updated
consumers.

#### Publication identity and compatibility

Optional `publication` contains exactly `id` and `compat`. The ID is a stable, nonblank identifier for one logical
publication. Its namespace is producer-owned. Consumers treat it as opaque and never derive it from filenames, page
names, or Style families. It is not publisher authentication.

`compat` is a positive safe integer, from 1 through 9,007,199,254,740,991. The producer changes it when it wants to
reject earlier Recipes for a new PDF, even when every observable processing choice remains valid. Values compare for
equality within the same publication ID. Numeric order grants no compatibility. Equal values provide no positive
compatibility guarantee. The producer need not change this value on each export or compatible content edit.

A changed Input with different declared publication IDs or different declared `compat` values is blocked. A force
request cannot override this veto. A missing declaration supplies no veto by itself; losing a previously recorded
declaration requires review. All actual page, Style, schema, format, and resource checks remain authoritative.

Mainz manifest `version`, Recipe `version`, Plan `version`, and software versions remain independent. A supported format
identifies how to interpret a record. A publication veto identifies a producer restriction on replay.

Read, describe, style, reset, and SVG production preserve the declaration. Extraction that changes the page sequence
removes it. No-op extraction retains the original bytes. Whole-Input styling under Section 6.3 preserves the
declaration. Other composition never inherits it. A producer must explicitly declare the identity and compatibility
value of its final assembled output.

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
| `title`, `description`, `details`                            | Optional plain-text annotations under Section 4.1    |
| `default`                                                    | Optional baseline annotation, never an assignment    |

Other keywords, arbitrary regular expressions, `$ref`, remote schemas, and array, object, or Boolean schemas are
rejected. Standard [validation and annotation semantics](https://json-schema.org/draft/2020-12/json-schema-validation)
still apply within this profile. `details` is a Mainz presentation annotation, not a JSON Schema validation keyword.

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
`description` and `details` under Section 4.1. References name existing parameters. A parameter occurs in at most one
group. Empty groups and an empty array are permitted.

Groups are presentation hints, not targets or assignment scopes. A group can contain several Style objects or part of
one. Bindings identify related controls. Applications choose widgets without introducing parameter types, coupled
assignments, or placeholder PDF parameters. Workspace rendering belongs to the
[Web SPEC](../../web/doc/SPEC.md#input-styles) and [VIEW](../../web/doc/VIEW.md#style-presentation).

Group and parameter arrays preserve authored presentation order. Unlisted parameters use ID order. JSON object order
never substitutes for these arrays. Description, extraction, and composition retain their order while pruning or
remapping references. Presentation never changes scope, precedence, validation, or paint.

### 4.5 Style profiles

`profileSets` stores named override choices in the same manifest. It contains no CSS, geometry, printer detection, or
executable rules. An empty array is permitted. Each set requires `id`, `name`, nonempty unique `parameters`, and
`profiles`, with optional `family`, `description`, and `details` under Section 4.1. Set IDs are unique within the
manifest. Set and profile IDs follow Section 4.1. Names are nonempty plain text. Descriptions are plain text. A
parameter belongs to at most one set. Unlisted parameters remain editable.

Each set has 1–32 ordered profiles. A profile requires `id`, `name`, and `overrides`, with optional `description` and
`details`. IDs follow Section 4.1 and are unique within their set. Override keys belong to that set and hold valid
parameter scalar values. Unknown fields and references fail. The first profile represents original styles and has empty
overrides.

Profile names, descriptions, and details follow Section 4.1. A name identifies the visible style; its description
summarizes that style. Details can expand the summary with usage guidance, rationale, or tradeoffs. They require that
profile's own description, even when the set has a description. Annotations do not change profile identity, parameter
scope, overrides, or printer behavior.

Opening preserves saved overrides without applying a profile. Choosing a profile replaces all overrides within its set.
Omitted parameters return to their own baselines. Other parameters and sets retain their choices.

Applications supply a complete Input instance map or combine the set's reset IDs and the profile's overrides in one
`style` call. There is no inheritance, cascade, saved active-profile field, or additional processor operation. Profile
values and meanings belong to the author.

Optional set `family` follows the Style-family string rules in Section 4.2 and applies to every profile in that set.
Within a family-bearing set, profile names must be unique. The producer guarantees that the same family and profile name
represent the same authored choice across files. Values and parameter scopes can differ; each file uses its own
definition. Set IDs, set names, and profile IDs remain local and do not establish cross-file compatibility. Several
independent sets can share a family and profile name. They remain independently editable. Without a set family, profile
selection remains local. Parameter families are explicit and are not inherited from their set. Style operations,
description, extraction, and composition retain set families alongside the other retained definition fields.

The [CLI specification](../../cli/doc/SPEC.md#21-profile-selection) owns command-line ID lookup and ambiguity
diagnostics.

Styling, reset, and description preserve all profile annotations. Extraction prunes missing parameter references and
overrides, dropping sets with no retained parameters. Composition remaps set and parameter identities per Input
instance. Extraction and composition retain names, descriptions, details, and authored order. Repeated pages share their
Input instance's sets. Separate Input instances keep independent sets even with the same Input.

### 4.6 Complete JSON example

This manifest describes two closed stroke-only records in one Style object. Fill starts transparent. Stroke alpha
differs between records. The saved opacity override is 0.15. Groups order the controls. Profiles use the same declared
parameters. A corresponding PDF must supply the scopes and resources from Section 5.

```json
{
  "version": 1,
  "pages": [{}],
  "regions": {
    "practice:r2": {
      "page": 0,
      "marker": "Rows2",
      "records": [{ "path": [], "marker": "Paint2", "baseline": "dark", "fill": "latent" }]
    },
    "practice:r3": {
      "page": 0,
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
        { "id": "generic", "name": "Outlined", "overrides": {} },
        {
          "id": "inkjet",
          "name": "Filled",
          "description": "Pale fills and fine outlines.",
          "details": "Pale fills suit inkjet printers. Some entry-level laser printers reproduce them as visible dot patterns.",
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

All Mainz-specific declarations belong in embedded JSON. Preview PNG bytes belong in separate embedded files. PDF scopes
use the standard `Figure` tag and local `Properties`, `XObject`, and `ExtGState` names. Marker property dictionaries are
empty, without private keys, actions, optional content, or structure identifiers. Resource names belong to their owning
dictionaries. This encoding needs no private tag, key, or developer prefix. It asserts no Tagged PDF conformance and
preserves foreign logical structure outside paint records. Later private extensions must follow
[Annex E name rules](https://pdf-issues.pdfa.org/32000-2-2020/clauseAnnexE.html).

#### Preview images

A page's `preview` names exactly one entry in the same `EmbeddedFiles` name tree. Its Filespec `F` and `UF` match that
name. Both `EF` entries reference one embedded stream with subtype `/image#2Fpng`. The reference cannot resolve to
`mainz.json`, an external file, or a network resource. Several pages can reference the same image. The producer stores
that payload once.

The payload is a single-image PNG. The processor examines its signature, header, chunk bounds, and pixel dimensions
before use. Animated PNG control chunks are unsupported. Image bytes count toward the existing PDF and processor byte
budgets. Pixel-count arithmetic must not overflow. The reference-build ceiling is 16,777,216 pixels per image. The
processor neither decodes image pixels nor imports a source renderer for preview access.

A preview represents the saved page appearance at thumbnail size. Producers can simplify guides and strengthen strokes
for that purpose. The image retains the visible page proportions and displayed orientation, with integer pixel rounding.
Consumers fit the complete image without cropping or stretching it. Pixel equality with the full PDF rendering is not
required. The producer owns image resolution. The file contract imposes no fixed 256, 288, or 512 px target.

Consumers use the image only for thumbnails. Detailed page viewing, magnification, comparison, printing, and PDF output
use the actual PDF. If an image is absent, exceeds host decode limits, or fails pixel decoding, the consumer uses its
PDF rendering path. Invalid manifest references, malformed PNG structure, and processor limit failures remain contract
errors. An image decoder failure does not change valid PDF content or produce a replacement image in the saved PDF.

### 5.2 Identity and baseline records

An inline region has exactly `page`, `marker`, and `records`. A shared region has exactly `page`, `marker`, `recordSet`,
and `baselineRefs`. Both forms can coexist. `page` is a nonnegative integer less than the PDF page count and indexes the
manifest's `pages` array. Region markers name resources in their page's effective `Properties` dictionary. Exactly one
`/Figure /marker BDC ... EMC` sequence identifies each region. Regions contain complete graphics objects and balanced
scopes, without nesting or overlap.

Extraction remaps region page indexes. Composition assigns every retained occurrence its new physical page index.

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
page, resource, invocation, and effective-paint context. Sharing never bypasses occurrence validation or merges Input
instance baselines.

For example, these regions share syntax but keep separate baselines:

```json
{
  "recordSets": { "row": [{ "path": [], "marker": "Paint", "baseline": "ink", "fill": "none" }] },
  "regions": {
    "first": { "page": 0, "marker": "Rows1", "recordSet": "row", "baselineRefs": { "ink": "dark" } },
    "second": { "page": 0, "marker": "Rows2", "recordSet": "row", "baselineRefs": { "ink": "dim" } }
  }
}
```

This fragment requires the other manifest fields and matching PDF scopes. Producers can share equal locator arrays after
assigning local slots. Resource isolation can separate arrays. Extraction removes unused arrays. Composition can share
syntax while keeping Input instance baselines independent.

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
`missing-contract` otherwise. The [CLI SPEC](../../cli/doc/SPEC.md#1-commands) defines verification.

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

### 6.1 Description record

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
physical width. Summaries never assign overrides. For Section 4.6, `partial-opacity` has this entry:

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

### 6.2 Errors and limits

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
limits appear in Section 6.3 and producer limits in Section 7.1. Published ceilings depend on the released build. They
measure neither peak memory nor device support.

Processor errors require plain-text `code` and nonempty `message`. Codes are `pdf-syntax`, `missing-contract`,
`unsupported-version`, `unsupported-context`, `invalid-contract`, `invalid-request`, or `limit-exceeded`. Optional
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

### 6.3 Plans and composition

A Plan is a concrete versioned request for composition. A host can resolve it from a Recipe or build it directly from
accepted workspace choices. Composition still applies full request and Input validation.

The record contains ordered occurrences, complete Input instance styles, repetition, and duplex alignment. It excludes
bytes, paths, selections, UI labels, and preview state. Applications supply immutable Inputs separately. Input and Input
instance IDs follow Section 4.1.

| Record         | Fields                                                                                                  |
| -------------- | ------------------------------------------------------------------------------------------------------- |
| Plan           | Required `version`, `sources`, `parts`; optional `metadata`                                             |
| `version`      | Integer `1`                                                                                             |
| `sources`      | Input instance-ID map, empty for Blank-only Plans                                                       |
| Input instance | Required `input` ID and complete `overrides` object                                                     |
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
ranges follow the next sibling or ancestor target, with the final open sections extending to the last Input page.
Same-page siblings remain distinct. Empty sections disappear. Each retained section targets its first Output occurrence
within that range or its descendants, even when its original heading page is absent. Ancestor context remains, and
siblings follow their first Output position. Repeated pages use that first occurrence. Each Input instance keeps its own
outline tree. Invalid or external targets add no heading but retain navigable children. No page name or host-only group
creates a PDF outline entry. Outline traversal shares the 65536-visit budget and permits at most 64 levels.

Input instances retain independent parameter, target, and baseline identities. Definitions, overrides, and presentation
survive, with bindings covering every eligible retained occurrence. Unused targets, parameters, baselines, and empty
groups disappear. Without editable regions, the composed Document has no editable paint. Reset restores retained
authored baselines without Inputs. Completion validates and reopens the Document before success.

Each retained occurrence copies its source page's name and tags at its new array position. Unchanged saved assignments
permit reuse of its PNG preview. Changed assignments follow the invalidation rule in Section 6. Attachment names and
preview references change together after collisions. Shared payloads copy once per Input. Blank and Padding pages have
an empty page object, without authored name, tags, or preview. The processor does not infer metadata from neighboring
pages. Page metadata survives without editable regions. The manifest disappears only when neither paint bindings nor
page metadata remain.

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

This Plan uses the prepared example from Section 4.6 as Input `book`, with two independently styled Input instances:

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

### 6.4 Composition adapters

The native executor accepts Plan JSON and an Input-ID-to-owned-byte map. It returns Artifact with `document` and
`provenance`, without file access or scheduling. The Document owns the validated PDF. Provenance is a separate JSON
record under Section 6.3. Artifact is an adapter result, not another serialized record or a field in the PDF manifest.
The [CLI](../../cli/doc/SPEC.md#2-requests) resolves file bindings before calling it.

The optional `previous` document in native `compose` permits reuse of its input validation and parsed content. Reuse
requires exact input bytes. Input instance edits stay independent. Composition applies Input instance styles in memory
and validates the complete serialized Document once, without intermediate Input instance PDFs.

`compose_validated(plan, inputs)` accepts an Input-ID-to-immutable-`Document` map. It reuses those exact Inputs' prior
validation and parsed content without copying their PDF bytes into another binding map. The owners remain alive for the
synchronous call. Independent Input instances still receive separate editing graphs, and the completed Document still
passes full validation. This entry point lets Recipe resolution and composition share the same validated Inputs.

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

### 6.5 Portable Recipes

A Recipe is a versioned JSON record for applying a composition to separately supplied Inputs, including updated PDFs. It
resolves to a Plan. It stores processing choices rather than UI events, preview state, or PDF bytes. Native and WASM
consumers use the same interpreter. The CLI owns filesystem access under its
[Recipe execution rules](../../cli/doc/SPEC.md#22-recipe-execution).

Recipe version 1 requires `version`, `inputs`, `sources`, and `parts` and permits optional `metadata` under the Plan's
title and cover-page rules. Resolution checks the cover against the expanded Output and carries these choices into the
Plan. Version is integer `1`. Recipe and Plan versions are separate contracts. Encoding, unknown-field rejection,
identifiers, and numeric rules follow Section 4.1.

Names and tag predicates can help a host construct a selection. The host records their resolved physical indexes as
concrete page references. Replay does not repeat that name or tag lookup. Existing explicit `pages: "all"` selection
retains its separate dynamic meaning.

| Record                  | Fields                                                                                                              |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Input                   | Optional `sha256`, `pageCount`, `pageNamesSha256`, `publication`, `title`, `cover`, `xmp`; an empty object is valid |
| Input instance          | Required `input`; optional `profiles`, `overrides`, both arrays                                                     |
| Local profile choice    | Exactly `set` and `id`, containing the Input's opaque set/profile IDs                                               |
| Semantic profile choice | Required `family` and `name`; optional Boolean `all`, default `false`                                               |
| Local override          | Exactly parameter `id` and `value`                                                                                  |
| Semantic override       | Required `family`, `key`, and `value`; optional Boolean `all`, default `false`                                      |

`inputs` and `sources` are ID maps, empty for Blank-only Recipes. Every Input serves an Input instance and every Input
instance has a page reference. Input IDs name logical PDF bindings; Input instance IDs name independent styled uses of
those Inputs. Several Input instances can use one Input. Both kinds of ID are opaque under Section 4.1. The record has
no file-location fields. The host binds each Input ID to actual PDF bytes at execution time. A filename without its
`.pdf` suffix is a convenient initial ID, not a required filesystem location. Displayed one-based indexes identify rows
only; they are not stored identities or references. JSON member order does not define a host's display order.

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
single-Input check validates that Input's Recipe styles and physical references before the host enables execution. Full
resolution checks every Input and the complete expanded Plan. Detected errors block the whole operation. No partial Plan
or workspace is installed.

Explicit force accepts review results for one invocation. It never skips validation, changes page indexes, drops pages,
substitutes profiles, bypasses a publication veto, or changes file installation policy. Review results remain visible in
diagnostics after acceptance. Default rejection uses `review-required`, with the report in `details`.

#### Recipe alignment

Alignment explicitly creates a new Recipe against accepted current Inputs. It uses the same validation and review policy
as execution. It replaces factual Input references and preserves logical IDs, Sources, selectors, profiles, explicit
overrides, resets, Parts, copies, front alignment, dynamic `pages: "all"`, and Output metadata.

A changed Input loses stale optional title, cover, and XMP annotations. A host can supply current display annotations
from the accepted PDF. Unchanged Inputs retain their annotations. Alignment never changes the supplied Recipe or PDF
bytes. It returns a separate record only after successful validation. Executing with force does not implicitly save or
replace the reference Recipe. Saving the aligned record is an explicit, separate acceptance of the new baseline.

Style selector strings are exact and case-sensitive. Semantic family/name/key strings follow Section 4.2. A semantic
selector without `all: true` requires exactly one match within its Input instance's Input. Zero matches and ambiguous
matches fail. With `all: true`, the operation explicitly addresses every match and still requires at least one. Exact
local selectors do not accept `all`. There is no fallback between local IDs and semantic fields.

An Input instance starts from authored baselines, following the Plan's complete-state semantics. Profiles apply first,
using the current Input's own definitions. Two choices cannot address the same profile set. Explicit overrides apply
afterward. A non-null `value` is a scalar validated under each matched parameter's schema and paint property. A null
value removes that parameter's profile assignment, restoring its own baseline. It does not enter the Plan. Two explicit
overrides cannot address the same parameter, including through overlapping selectors. Other Input instance styles never
change implicitly. Saved Input overrides survive only when the Recipe explicitly retains them.

Recipe Parts use the Plan's `copies`, `front`, explicit content pages, and explicit Blanks. A content page can instead
be exactly `{ "source": "id", "pages": "all" }`. This expands every current physical page of that Input instance's Input
in order, before repetition and duplex alignment. Fixed `page` indexes remain zero-based and must exist. Explicit
complete lists never imply all-pages intent. Out-of-range pages fail; the interpreter never drops or clamps them.

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
        { "source": "original", "page": 0 },
        { "source": "styled", "pages": "all" }
      ],
      "front": true
    }
  ]
}
```

The example's IDs must exist in the supplied Input; they are not built-in profile or parameter names. A web consumer can
export its complete accepted composition as a Recipe. It names logical Inputs, converts override-map entries to local
override records, and retains exact Parts. Replaying that record with the same Inputs uses the same composition engine
and preserves the represented content, page order, copies, Blanks, and styles. Profile intent or dynamic selection
requires its explicit Recipe representation; it cannot be inferred from an equivalent concrete snapshot.

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
`{ "plan": ..., "checks": {...}, "intent": {...}, "aligned": {...} }` through `mainz_result` and `mainz_size`. These
operations retain the active styling document and do not generate PDF bytes. The host copies the result before another
operation, then can pass the returned Plan to `mainz_compose` using the same registered bytes.

Recipe JSON has a 16 MiB limit. Plan JSON retains its 1 MiB limit. Only Recipe cover strings exceed the ordinary
4096-byte string ceiling, within their separate limit above. The Plan's Input/Input instance, aggregate Input byte,
copy, and expanded page limits apply during resolution. Parts and each unexpanded page-selector array contain at most
10000 entries. Retained description JSON has a 512 MiB aggregate byte budget. These byte budgets do not measure total
peak memory. Checks precede page-list expansion. Existing PDF, manifest, decoding, and traversal limits still apply.
Reproducibility covers the resolved operations and represented PDF content; it does not promise identical serialized
bytes across processor or dependency versions. File naming, printing, sharing, and UI state remain host concerns.

## 7. Imprinter and consuming-application obligations

A producer that exposes Style resolves source rules, selectors, render instances, paint order, and compositing before
publication. It supplies resolved bindings and original baselines, never source rules for the processor to evaluate. It
retains editable occurrences and rejects selections requiring reordered paint or unsupported compositing. Baselines
precede authored `value` overrides. Publication applies those overrides through the processor.

Contract-aware page operations read the original manifest, retain applicable definitions/state, and rebuild resulting
bindings. Missing targets, unbound parameters, and invalid presentation references cannot survive. Independently
editable duplicates need distinct occurrence identities. Conflicting identities, definitions, or overrides require an
explicit merge policy or failure.

Layout and imposition belong to consuming applications and can change scale. Resulting width bindings must still satisfy
Section 5.4. Desired physical widths apply after layout. Losing the manifest makes later styling fail, rather than
triggering inferred reconstruction. Ordinary page operations remain available under Section 6.

### 7.1 SVG declarations

The native `imprint` function accepts SVG and a separate SVG declaration and returns a Document. Declarations require
`targets` and `parameters`, with optional `groups`, `profileSets`, `publication`, and `page`. Publication identity and
compatibility follow Section 4.2. `page` contains optional `name` and `tags` under the page metadata rules. At least one
field must be present. The producer assigns these fields to its single emitted page object. The producer also accepts
separate optional PNG bytes. It embeds the image and records the resulting attachment reference in page metadata. The
host supplies bytes, not paths or URLs inside the declaration. Preview production does not change the SVG used for PDF
content. Declarations with page metadata or a supplied preview can have empty `targets` and `parameters` together. Each
target has selectors and can declare `fill: true` for eligible closed paths or `display: "none"` for authored hidden
state. Targets are disjoint, preserve paint order, and have at least one parameter binding. A target's display field
records its original state without requiring an editable display parameter. Profiles follow Section 4.5 and do not apply
automatically during export.

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

Properties and schemas follow Sections 1.2 and 4.3. `value` applies only after baseline capture. `default` must agree
with eligible baselines. Ordered groups carry presentation order without changing parameter semantics. Unlisted
parameters form an Other controls group in ID order.

Selected targets support vector paths. Text and images stay outside them. Masks, filters, group opacity, unsupported
paint contexts, and ambiguous visibility fail. Targets hidden by `display: none !important` cannot be materialized. If
the SVG stylesheet uses attribute selectors, CSS escapes, or `MainzSource`, source paint roots need authored IDs. These
stylesheet restrictions do not extend the declaration-selector grammar. CSS property checks decode escapes and skip
comments in both inline styles and stylesheets. Selector names do not count as compositing properties. Unbalanced
blocks, unterminated comments or strings, invalid escapes, and at-rules fail before rendering.

SVG input is limited to 128 MiB, 64 XML levels, and one million elements. Declarations are limited to 1 MiB. Captured
manifest metadata uses the 16 MiB embedded-manifest limit. Decoded Form capture shares a 128 MiB budget. Producer errors
use structured records and can add `imprinter-error` to processor error codes.

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

| Term                     | Meaning                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Baseline                 | Immutable original state of one paint record before overrides.                                                                       |
| Baseline slot            | Shared locator's local reference mapped to a region's own baseline.                                                                  |
| Binding                  | One parameter's connection to one property on eligible records in declared targets.                                                  |
| Artifact                 | Composition result containing a Document and its Provenance.                                                                         |
| Composition              | Operation that executes a Plan against separately supplied Inputs and returns Artifact.                                              |
| Description              | Read-only processor record of pages, definitions, overrides, baseline summaries, groups, and profiles.                               |
| Document                 | Validated immutable PDF, usable as an Input or operation result.                                                                     |
| Effective style          | Paint state after baseline, overrides, and display combine. Hidden targets retain selected values.                                   |
| Extraction               | Retaining unique pages in order and rebuilding bindings, without changing drawing content.                                           |
| Input                    | Immutable PDF bytes supplied separately under an opaque Input ID. Several Input instances can share them.                            |
| Input ID                 | Logical key for a PDF binding, independent of its file location.                                                                     |
| Recipe                   | Portable choices and logical Input IDs that resolve against bound PDFs into a Plan.                                                  |
| Resolution               | Recipe resolution result containing a Plan, Input checks, explicit style intent, and an aligned Recipe, without a produced Document. |
| Plan                     | Concrete composition request with physical page references, Blanks, complete Input instance overrides, copies, and alignment.        |
| Provenance               | Versioned record of page origins, Part and copy positions, and source mappings for parameter identities.                             |
| Publication              | Producer-declared logical document identity and integer compatibility veto.                                                          |
| Mainz                    | Project, contract, processor, reference Imprinter, CLI, and WASM boundary, consumed by PDF Composer.                                 |
| Manifest                 | Embedded declaration of the ordered page array, optional page metadata, and any editable paint and presentation.                     |
| Locator                  | Ordered Form invocation path and paint marker resolving one record in a page region.                                                 |
| Marker                   | Local empty PDF property resource identifying one balanced Figure sequence.                                                          |
| Mixed baseline           | Different original values across one parameter's eligible records.                                                                   |
| Occurrence               | One use of content in its page/resource context, independent of shared geometry storage.                                             |
| Override                 | Explicit parameter `value`. Reset removes it rather than assigning a new default.                                                    |
| Page metadata            | Optional name, tags, and PNG preview reference in one physical page's array entry.                                                   |
| Page name                | Authored display text for a page, independent of physical number, PDF label, and navigation titles.                                  |
| Page tag                 | One exact string in a page's unordered tag set, available to consumers for page selection.                                           |
| Paint property           | Supported PDF painting attribute, distinct from a parameter or JSON Schema's properties keyword.                                     |
| Paint record             | Declared path painting operation with immutable baseline and capabilities.                                                           |
| Painted extent           | Painted area within clipping, potentially changed without changing geometry.                                                         |
| Parameter                | Named scalar styling choice with constraints, presentation, and a binding.                                                           |
| Part                     | Nonempty ordered sequence of content pages and Blanks with one copy count and front-alignment choice.                                |
| Semantic key             | Producer-declared stable parameter meaning within a Style family, independent of document-local IDs.                                 |
| Style family             | Authored compatibility namespace for profile names and parameter semantic keys.                                                      |
| Path geometry            | Path operators and coordinates, preserved by styling.                                                                                |
| Prepared PDF             | Materialized editable geometry, valid manifest, resolved bindings, and immutable baselines in one PDF.                               |
| Preview image            | Producer-supplied PNG representing the saved page at thumbnail size.                                                                 |
| Presentation group       | Ordered parameter references with title/description, without style identity or assignment scope.                                     |
| PDF Composer             | Local web consumer for page composition and Input instance styling.                                                                  |
| Processor                | Library applying the PDF contract and contract-aware page operations independently of producers.                                     |
| Imprinter                | Native source component creating Documents from SVG and separate declarations.                                                       |
| Reference application    | Consumer exposing the common processor. File conformance does not depend on its widgets.                                             |
| Record set               | Shared ordered locator syntax retaining separate occurrences and baseline identities.                                                |
| Region                   | Unique occurrence scope with ordered paint records, belonging to one target.                                                         |
| Schema                   | Restricted JSON Schema for one parameter's scalar values and annotations.                                                            |
| Selector                 | Producer-side source selection, resolved before processor input.                                                                     |
| Input instance           | One Input reference with complete independent overrides shared across retained occurrences.                                          |
| Styling                  | Declared paint changes preserving geometry, protected content, and page structure.                                                   |
| SVG declaration          | Separate producer JSON for targets, parameters, and optional presentation, profiles, publication identity, and page annotations.     |
| Style object             | Parameters bound to the same exact unordered target set.                                                                             |
| Style scope              | Balanced marker sequence containing local state, complete path, paint, and state restoration.                                        |
| Style profile            | Named overrides replacing their set's assignments, with omitted parameters restored to baseline.                                     |
| Profile set              | Ordered profiles over one independent parameter scope, beginning with original styles.                                               |
| Target                   | Named nonempty region set receiving declared style changes.                                                                          |
| Unrepresentable baseline | One original state without a valid scalar override, such as a hairline for positive width.                                           |
| Verification             | Assessment of one PDF's Mainz contract. Preservation requires independent input/output comparison.                                   |

## References

- [ISO 32000-1:2008](https://raw.githubusercontent.com/adobe/dc-acrobat-sdk-docs/master/docs/standards/pdfstandards/pdf/PDF32000_2008.pdf):
  PDF objects, painting, units, transparency, marked content, and attachments.
- [PDF 2.0 specification and errata](https://pdfa.org/resource/pdf-specification-archive/): PDF 2.0 inputs.
- [RFC 8259](https://www.rfc-editor.org/rfc/rfc8259): JSON interchange.
- [Adobe XMP](https://developer.adobe.com/xmp/docs/): standard document title, description, authorship, and rights
  metadata.
- [JSON Schema 2020-12](https://json-schema.org/draft/2020-12): constraint and annotation semantics.
- [QPDF structural checks](https://qpdf.readthedocs.io/en/stable/cli.html#option-check): syntax is not proof of full
  conformance or preservation.

Mainz is an application contract built on PDF features, not an ISO-standardized styling language.
