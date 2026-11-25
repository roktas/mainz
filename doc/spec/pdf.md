# Mainz PDF contract

This document defines the version 1 Mainz file contract: editable paint, page metadata, and their PDF representation.
[Library operations](lib.md) apply this contract. [The project specification](../spec.md) defines component ownership.

- [Prepared PDFs](#prepared-pdfs)
- [The styling boundary](#the-styling-boundary)
- [Targets and state](#targets-and-state)
- [JSON contract](#json-contract)
- [PDF representation](#pdf-representation)
- [Producer and consumer obligations](#producer-and-consumer-obligations)
- [Required publication behavior](#required-publication-behavior)
- [Glossary](#glossary)

## Prepared PDFs

A prepared PDF carries editable painting choices, their original baselines, and saved overrides. PDF Composer can change
its declared colors, line widths, opacity, or visibility while keeping text, layout, and path geometry fixed. The PDF
remains editable and resettable without its drawing source or producer. Ordinary viewers render its saved appearance.
Ordinary PDFs support page composition but have no Mainz Style controls.

Page names, tags, and thumbnail images are optional page metadata. They can accompany ordinary or prepared PDFs. Page
metadata does not create Style controls or change the printed page.

## The styling boundary

### Parameter policy

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

### Version 1 properties

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

### Protected content

Styling preserves:

- Path operators and their original numeric operands.
- Transformations, clipping, Form bounds, and placement order.
- Page count, order, boxes, rotation, and `UserUnit`.
- Text operators, content, font resources, and embedded font bytes.
- Unselected painting, images in page content, navigation, PDF labels, unrelated attachments, and unrelated metadata.

Object numbers, compression, stream packaging, and cross-reference structures can change. Protected numbers cannot be
rounded. Only declared painting state and painting operations change within page content. The processor never
regenerates drawing content from SVG, CSS, or rasters.

Styling can remove managed preview references and unused preview assets under
[Processor operations](lib.md#processor-operations). Page names and tags remain intact.

### Supported painting contexts

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

## Targets and state

### Occurrences, regions, and bindings

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

### Baseline, override, and effective style

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

### Fill eligibility

Existing fills retain paint order and fill rule, including implicit subpath closure. No additional fill overlays an
existing fill. A stroke-only record can acquire fill only with producer declaration and processor proof of eligibility.
Every subpath with drawing operations must be closed, with at least one closed subpath. An isolated open `m` subpath
paints nothing and does not affect eligibility. One close operator elsewhere is insufficient. Open paths cannot acquire
fill.

Latent fill requires a recorded fill color, fill rule, and baseline fill alpha zero. Color alone leaves the record
unfilled. Positive fill opacity enables it at the original paint position. Reset restores the original stroke-only
operator. A stroke record duplicating a separate existing fill of the same geometry cannot acquire another fill.

## JSON contract

### Encoding and identifiers

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
details on demand. Empty or whitespace-only details create no information icon or other details control. The
[workspace contract](web.md#input-styles) owns the interactions.

### Manifest fields

| Field         | Requirement                                                                                                            |
| ------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `version`     | Required integer `1`                                                                                                   |
| `pages`       | Required nonempty array with exactly one object per physical PDF page, in PDF order                                    |
| `regions`     | Required map of region IDs to occurrence records from [Identity and baseline records](#identity-and-baseline-records)  |
| `baselines`   | Required map of baseline IDs to immutable records from [Identity and baseline records](#identity-and-baseline-records) |
| `targets`     | Required map of target IDs to nonempty region-ID arrays                                                                |
| `parameters`  | Required parameter-ID map                                                                                              |
| `recordSets`  | Optional nonempty map of record-set IDs to shared locator arrays                                                       |
| `groups`      | Optional ordered presentation groups                                                                                   |
| `profileSets` | Optional ordered profile sets                                                                                          |
| `publication` | Optional producer-declared stable document identity and compatibility veto                                             |

A parameter requires `schema` and `binding`, with optional `value`, `family`, and `key`. A binding has exactly `targets`
and `property`. Its nonempty target array references existing targets. Its property belongs to
[Version 1 properties](#version-1-properties). Page indexes name actual PDF pages. Every region belongs to one target.
Every target has at least one parameter binding. Every baseline has at least one record reference. Optional fields
follow their full rules whenever present.

The four paint maps are nonempty together or empty together. Empty paint maps require at least one page metadata field.
Such a document has no editable paint and remains ordinary for Style operations. The manifest still carries its page
metadata. Empty paint maps also require omission of `recordSets`, `groups`, and `profileSets`.

Bindings contain resolved PDF regions, never source selectors or CSS. Page labels remain separate from parameter and
publication identity. Optional publication metadata follows the declaration below and never selects painting behavior.

#### Page metadata

`pages` is an array in physical PDF order. Its length equals the PDF page count. The array index is the page identity
inside this Document. Each element is an object containing only the optional fields below. `{}` represents a page
without authored metadata and retains its position.

| Field     | Value                                                       | Meaning                                                        |
| --------- | ----------------------------------------------------------- | -------------------------------------------------------------- |
| `name`    | Nonblank plain-text string without control characters       | Authored display name for the page.                            |
| `tags`    | Array of unique nonblank strings without control characters | Unordered labels for page selection.                           |
| `preview` | Nonempty embedded-file name                                 | PNG thumbnail under [Manifest transport](#manifest-transport). |

Names can repeat, including after composition. Names are display text, not page identities. Tags use exact,
case-sensitive string equality. Their order has no meaning, and an empty array is valid. The processor does not trim,
case-fold, normalize, split, or interpret these strings. Existing string and JSON limits apply. Nonblank follows the
whitespace rule in [Encoding and identifiers](#encoding-and-identifiers).

Consumers can derive name-to-page and tag-to-page indexes in memory. A name can resolve to several physical indexes. The
PDF stores no reverse lookup tables. A [Recipe](lib.md#portable-recipes) can select a page by its exact name when the
name is unique in the Input. Consumers resolve tag predicates to physical page indexes before they build a Plan or
Recipe.

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

Styling, extraction, and whole-Input styling under [Plans and composition](lib.md#plans-and-composition) retain existing
document metadata. Other composition creates a new Document and does not choose or merge Input titles, authors, or
rights declarations. The producing application can supply a title and cover page through the Plan's optional `metadata`
field. Composition writes these choices to XMP under [Plans and composition](lib.md#plans-and-composition). Other
publication metadata remains the producing application's responsibility.

#### Style families and semantic keys

Optional `family` and `key` occur together on a parameter, outside its schema and binding. Both use the identifier
encoding and string limits from [Encoding and identifiers](#encoding-and-identifiers) and must contain non-whitespace
text. Matching is exact and case-sensitive. Separators have no syntax. Consumers never derive these fields from local
IDs, titles, filenames, publication metadata, or values. Missing fields permit local editing without cross-file
matching.

`family` names an authored Style compatibility family, for example `megic`. It is not proof of publisher identity. `key`
names one stable parameter meaning within that family, for example `guides.stroke-width`. The producer guarantees that
equal family/key pairs have the same meaning and paint property. The property defines units under
[Version 1 properties](#version-1-properties). Local schemas can narrow valid values independently. A changed meaning
requires a different key or family. No registry, remote lookup, or separate family version is required.

Local parameter IDs remain document references. Equal semantic keys do not merge targets, bindings, baselines, or
overrides. Several independent parameters can share a family/key pair, including after composition. Their paint property
must agree within one manifest. Different schemas, baselines, and current values remain independent.

Read and description retain these fields. Style and reset never change them. Extraction retains them on surviving
parameters. Composition retains them unchanged when it remaps local IDs. SVG declarations use the same fields and rules.
The processor validates metadata and preserves independence. The consuming application owns cross-file choice
propagation under the [workspace contract](web.md#profiles-and-reset); no processor operation couples files.

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
removes it. No-op extraction retains the original bytes. Whole-Input styling under
[Plans and composition](lib.md#plans-and-composition) preserves the declaration. Other composition never inherits it. A
producer must explicitly declare the identity and compatibility value of its final assembled output.

### Parameter schemas

A schema describes one scalar value under the restricted JSON Schema 2020-12 profile. Without `$schema`, version 1 fixes
that dialect. If supplied, `$schema` must be `https://json-schema.org/draft/2020-12/schema`. The processor never fetches
it.

| Keyword                                                      | Rule                                                                                        |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `$schema`                                                    | Exact dialect URI above                                                                     |
| `type`                                                       | Required `number` or `string`, matching the property                                        |
| `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum` | Finite numeric bounds for numbers                                                           |
| `enum`                                                       | Nonempty unique valid values of the declared type                                           |
| `pattern`                                                    | Colors only, exactly `^#[0-9a-fA-F]{6}$`                                                    |
| `title`, `description`, `details`                            | Optional plain-text annotations under [Encoding and identifiers](#encoding-and-identifiers) |
| `default`                                                    | Optional baseline annotation, never an assignment                                           |

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

### Presentation groups

`groups` is an ordered array. Each group requires plain-text `title` and ordered `parameters`, with optional plain-text
`description` and `details` under [Encoding and identifiers](#encoding-and-identifiers). References name existing
parameters. A parameter occurs in at most one group. Empty groups and an empty array are permitted.

Groups are presentation hints, not targets or assignment scopes. A group can contain several Style objects or part of
one. Bindings identify related controls. Applications choose widgets without introducing parameter types, coupled
assignments, or placeholder PDF parameters. Workspace rendering belongs to the [workspace contract](web.md#input-styles)
and [GUI contract](gui.md#style-presentation).

Group and parameter arrays preserve authored presentation order. Unlisted parameters use ID order. JSON object order
never substitutes for these arrays. Description, extraction, and composition retain their order while pruning or
remapping references. Presentation never changes scope, precedence, validation, or paint.

### Style profiles

`profileSets` stores named override choices in the same manifest. It contains no CSS, geometry, printer detection, or
executable rules. An empty array is permitted. Each set requires `id`, `name`, nonempty unique `parameters`, and
`profiles`, with optional `family`, `description`, and `details` under
[Encoding and identifiers](#encoding-and-identifiers). Set IDs are unique within the manifest. Set and profile IDs
follow [Encoding and identifiers](#encoding-and-identifiers). Names are nonempty plain text. Descriptions are plain
text. A parameter belongs to at most one set. Unlisted parameters remain editable.

Each set has 1–32 ordered profiles. A profile requires `id`, `name`, and `overrides`, with optional `description` and
`details`. IDs follow [Encoding and identifiers](#encoding-and-identifiers) and are unique within their set. Override
keys belong to that set and hold valid parameter scalar values. Unknown fields and references fail. The first profile
represents original styles and has empty overrides.

Profile names, descriptions, and details follow [Encoding and identifiers](#encoding-and-identifiers). A name identifies
the visible style; its description summarizes that style. Details can expand the summary with usage guidance, rationale,
or tradeoffs. They require that profile's own description, even when the set has a description. Annotations do not
change profile identity, parameter scope, overrides, or printer behavior.

Opening preserves saved overrides without applying a profile. Choosing a profile replaces all overrides within its set.
Omitted parameters return to their own baselines. Other parameters and sets retain their choices.

Applications supply a complete Input instance map or combine the set's reset IDs and the profile's overrides in one
`style` call. There is no inheritance, cascade, saved active-profile field, or additional processor operation. Profile
values and meanings belong to the author.

Optional set `family` follows the Style-family string rules in [Manifest fields](#manifest-fields) and applies to every
profile in that set. Within a family-bearing set, profile names must be unique. The producer guarantees that the same
family and profile name represent the same authored choice across files. Values and parameter scopes can differ; each
file uses its own definition. Set IDs, set names, and profile IDs remain local and do not establish cross-file
compatibility. Several independent sets can share a family and profile name. They remain independently editable. Without
a set family, profile selection remains local. Parameter families are explicit and are not inherited from their set.
Style operations, description, extraction, and composition retain set families alongside the other retained definition
fields.

The [CLI specification](cli.md#profile-selection) owns command-line ID lookup and ambiguity diagnostics.

Styling, reset, and description preserve all profile annotations. Extraction prunes missing parameter references and
overrides, dropping sets with no retained parameters. Composition remaps set and parameter identities per Input
instance. Extraction and composition retain names, descriptions, details, and authored order. Repeated pages share their
Input instance's sets. Separate Input instances keep independent sets even with the same Input.

### Complete JSON example

This manifest describes two closed stroke-only records in one Style object. Fill starts transparent. Stroke alpha
differs between records. The saved opacity override is 0.15. Groups order the controls. Profiles use the same declared
parameters. A corresponding PDF must supply the scopes and resources from [PDF representation](#pdf-representation).

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

## PDF representation

### Manifest transport

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

### Identity and baseline records

An inline region has exactly `page`, `marker`, and `records`. A shared region has exactly `page`, `marker`, `recordSet`,
and `baselineRefs`. Both forms can coexist. `page` is a nonnegative integer less than the PDF page count and indexes the
manifest's `pages` array. Region markers name resources in their page's effective `Properties` dictionary. Exactly one
`/Figure /marker BDC ... EMC` sequence identifies each region. Regions contain complete graphics objects and balanced
scopes, without nesting or overlap.

Extraction remaps region page indexes. Composition assigns every retained occurrence its new physical page index.

Inline `records` is a nonempty ordered locator array. Shared `recordSet` references a nonempty array in root
`recordSets` and excludes inline `records`. Every shared array has a region reference. Locators have exactly these
fields:

| Field      | Meaning                                                                           |
| ---------- | --------------------------------------------------------------------------------- |
| `path`     | Ordered Form-invocation steps, empty for paint directly in the page region        |
| `marker`   | Local `Properties` name identifying one complete paint scope in the final owner   |
| `baseline` | Baseline ID for inline records, or local baseline-slot ID for shared records      |
| `fill`     | `existing`, `latent`, or `none`, subject to [Fill eligibility](#fill-eligibility) |

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

### Paint-scope grammar

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

For [Complete JSON example](#complete-json-example), an enclosing `/Figure /Rows2 BDC ... EMC` identifies the region.
Resources include `/Properties << /Paint2 << >> >>` and
`/ExtGState << /Alpha2 << /Type /ExtGState /CA 0.15 /ca 0 >> >>`. The second record has its own Rows3 and Paint3
markers. Foreign marked-content sequences can surround complete scopes, never interrupt path objects.

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

### Physical width

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

## Producer and consumer obligations

A producer that exposes Style resolves source rules, selectors, render instances, paint order, and compositing before
publication. It supplies resolved bindings and original baselines, never source rules for the processor to evaluate. It
retains editable occurrences and rejects selections requiring reordered paint or unsupported compositing. Baselines
precede authored `value` overrides. Publication applies those overrides through the processor.

Contract-aware page operations read the original manifest, retain applicable definitions/state, and rebuild resulting
bindings. Missing targets, unbound parameters, and invalid presentation references cannot survive. Independently
editable duplicates need distinct occurrence identities. Conflicting identities, definitions, or overrides require an
explicit merge policy or failure.

Layout and imposition belong to consuming applications and can change scale. Resulting width bindings must still satisfy
[Physical width](#physical-width). Desired physical widths apply after layout. Losing the manifest makes later styling
fail, rather than triggering inferred reconstruction. Ordinary page operations remain available under
[Processor operations](lib.md#processor-operations).

## Required publication behavior

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

The [library glossary](lib.md#glossary) owns processor and composition terms. The [web glossary](web.md#glossary) owns
workspace terms.

| Term                     | Meaning                                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Baseline                 | Immutable original state of one paint record before overrides.                                                   |
| Baseline slot            | Shared locator's local reference mapped to a region's own baseline.                                              |
| Binding                  | One parameter's connection to one property on eligible records in declared targets.                              |
| Effective style          | Paint state after baseline, overrides, and display combine. Hidden targets retain selected values.               |
| Publication              | Producer-declared logical document identity and integer compatibility veto.                                      |
| Mainz                    | Project, contract, processor, reference Imprinter, CLI, and WASM boundary, consumed by PDF Composer.             |
| Manifest                 | Embedded declaration of the ordered page array, optional page metadata, and any editable paint and presentation. |
| Locator                  | Ordered Form invocation path and paint marker resolving one record in a page region.                             |
| Marker                   | Local empty PDF property resource identifying one balanced Figure sequence.                                      |
| Mixed baseline           | Different original values across one parameter's eligible records.                                               |
| Occurrence               | One use of content in its page/resource context, independent of shared geometry storage.                         |
| Override                 | Explicit parameter `value`. Reset removes it rather than assigning a new default.                                |
| Page metadata            | Optional name, tags, and PNG preview reference in one physical page's array entry.                               |
| Page name                | Authored display text for a page, independent of physical number, PDF label, and navigation titles.              |
| Page tag                 | One exact string in a page's unordered tag set, available to consumers for page selection.                       |
| Paint property           | Supported PDF painting attribute, distinct from a parameter or JSON Schema's properties keyword.                 |
| Paint record             | Declared path painting operation with immutable baseline and capabilities.                                       |
| Painted extent           | Painted area within clipping, potentially changed without changing geometry.                                     |
| Parameter                | Named scalar styling choice with constraints, presentation, and a binding.                                       |
| Semantic key             | Producer-declared stable parameter meaning within a Style family, independent of document-local IDs.             |
| Style family             | Authored compatibility namespace for profile names and parameter semantic keys.                                  |
| Path geometry            | Path operators and coordinates, preserved by styling.                                                            |
| Prepared PDF             | Materialized editable geometry, valid manifest, resolved bindings, and immutable baselines in one PDF.           |
| Preview image            | Producer-supplied PNG representing the saved page at thumbnail size.                                             |
| Presentation group       | Ordered parameter references with title/description, without style identity or assignment scope.                 |
| PDF Composer             | Local web consumer for page composition and Input instance styling.                                              |
| Reference application    | Consumer exposing the common processor. File conformance does not depend on its widgets.                         |
| Record set               | Shared ordered locator syntax retaining separate occurrences and baseline identities.                            |
| Region                   | Unique occurrence scope with ordered paint records, belonging to one target.                                     |
| Schema                   | Restricted JSON Schema for one parameter's scalar values and annotations.                                        |
| Styling                  | Declared paint changes preserving geometry, protected content, and page structure.                               |
| Style object             | Parameters bound to the same exact unordered target set.                                                         |
| Style scope              | Balanced marker sequence containing local state, complete path, paint, and state restoration.                    |
| Style profile            | Named overrides replacing their set's assignments, with omitted parameters restored to baseline.                 |
| Profile set              | Ordered profiles over one independent parameter scope, beginning with original styles.                           |
| Target                   | Named nonempty region set receiving declared style changes.                                                      |
| Unrepresentable baseline | One original state without a valid scalar override, such as a hairline for positive width.                       |

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
