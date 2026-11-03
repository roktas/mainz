// Owns Input style schemas, accepted intent transitions, applicability, and preview requirements.

import type { Part } from "./model.ts"

export type Scalar = number | string
export type Render = { overrides: Record<string, Scalar>; pages?: number[] }
export type Usage = Map<string, Map<number, number>>
export type Annotations = { description?: string; details?: never } | { description: string; details?: string }
export type PaintDuo = { color?: string; opacity?: string }
export type Quartet = {
  fill: PaintDuo
  stroke: PaintDuo
  width?: string
  visibility?: string
}
export type Property = "display" | "stroke-width" | "stroke-color" | "fill-color" | "stroke-opacity" | "fill-opacity"
export type Schema = Annotations & {
  type: "number" | "string"
  title?: string
  enum?: Scalar[]
  minimum?: number
  maximum?: number
  exclusiveMinimum?: number
  exclusiveMaximum?: number
  pattern?: string
  default?: Scalar
}
export type Entry = {
  parameter: {
    family?: string
    key?: string
    schema: Schema
    binding: { property: Property; targets: string[] }
    value?: Scalar
  }
  baseline: { kind: "uniform"; value: Scalar } | { kind: "mixed" } | { kind: "unrepresentable"; reason: string }
  pages: number[]
}
export type Profile = Annotations & {
  id: string
  name: string
  overrides: Record<string, Scalar>
}
export type ProfileSet = Annotations & {
  id: string
  family?: string
  name: string
  parameters: string[]
  profiles: Profile[]
}
export type Group = Annotations & { title: string; parameters: string[] }
export type Description = {
  version: 1
  publication?: { id: string; version: string }
  pageCount: number
  pages: {
    label?: string
    name?: string
    tags?: string[]
    triviality?: number
    preview?: { file: string; width: number; height: number }
  }[]
  parameters: Record<string, Entry>
  groups?: Group[]
  profileSets?: ProfileSet[]
}

export type StyleState = {
  overrides: Record<string, Scalar>
  drafts: Record<string, string>
  profiles?: Record<string, string>
  edits?: readonly string[]
}
type StyleSource = StyleState & { input: { description: Description } }

function effective(entry: Entry): Scalar | undefined {
  return Object.hasOwn(entry.parameter, "value")
    ? entry.parameter.value
    : entry.baseline.kind === "uniform"
      ? entry.baseline.value
      : undefined
}
function semantic(entry: Entry): string | undefined {
  const { family, key, binding } = entry.parameter
  return family && key ? JSON.stringify([family, key, binding.property]) : undefined
}
function comparable(entry: Entry): Scalar | undefined {
  const value = effective(entry)
  return typeof value === "string" && entry.parameter.binding.property.endsWith("color") ? value.toLowerCase() : value
}

export function counterparts(source: StyleSource, target: StyleSource, ids: readonly string[]) {
  const keys = new Map<string, Map<Scalar, string>>()
  for (const id of ids) {
    const entry = resolve(source.input.description.parameters[id], source.overrides, id)
    const key = semantic(entry)
    if (!key) continue
    const values = keys.get(key) ?? new Map<Scalar, string>()
    keys.set(key, values)
    const value = comparable(entry)
    if (value !== undefined && !Object.hasOwn(source.drafts, id)) values.set(value, id)
  }
  const pairs: [string, string][] = []
  let skipped = 0
  if (!keys.size) return { pairs, skipped }
  for (const [id, definition] of Object.entries(target.input.description.parameters)) {
    const key = semantic(definition)
    const values = key && keys.get(key)
    if (!values) continue
    const value = comparable(resolve(definition, target.overrides, id))
    const original = value === undefined ? undefined : values.get(value)
    if (original !== undefined && !Object.hasOwn(target.drafts, id)) pairs.push([original, id])
    else skipped++
  }
  return { pairs, skipped }
}

export function propagate(
  source: StyleSource,
  next: Pick<StyleState, "overrides" | "drafts">,
  target: StyleSource,
  ids: readonly string[],
) {
  // A completed edit compares with the last valid value retained beneath its draft.
  const before = { ...source, drafts: { ...source.drafts } }
  for (const id of ids)
    if (Object.hasOwn(next.overrides, id) && !Object.hasOwn(next.drafts, id)) delete before.drafts[id]
  const matches = counterparts(before, target, ids)
  if (!matches.pairs.length) return { overrides: target.overrides, changed: false, skipped: matches.skipped, edits: [] }
  const overrides = new Map(Object.entries(target.overrides))
  let changed = false
  const edits: string[] = []
  for (const [original, id] of matches.pairs) {
    const assigned = Object.hasOwn(next.overrides, original)
    const value = next.overrides[original]
    if (
      Object.hasOwn(next.drafts, original) ||
      (assigned && feedback(target.input.description.parameters[id], String(value)))
    ) {
      matches.skipped++
      continue
    }
    edits.push(id)
    if (assigned === overrides.has(id) && (!assigned || overrides.get(id) === value)) continue
    if (assigned) overrides.set(id, value)
    else overrides.delete(id)
    changed = true
  }
  return { overrides: Object.fromEntries(overrides), changed, skipped: matches.skipped, edits }
}

export function sharedProfiles(set: ProfileSet, target: ProfileSet, name: string) {
  return !!set.family && set.family === target.family && target.profiles.some((profile) => profile.name === name)
}

export function matchingProfile(
  set: ProfileSet,
  overrides: Record<string, Scalar>,
  drafts: Record<string, string>,
): Profile | undefined {
  return set.profiles.find((profile) =>
    set.parameters.every(
      (id) =>
        !Object.hasOwn(drafts, id) &&
        Object.hasOwn(overrides, id) === Object.hasOwn(profile.overrides, id) &&
        overrides[id] === profile.overrides[id],
    ),
  )
}

export function applyProfile(set: ProfileSet, profile: Profile, state: StyleState): StyleState {
  const parameters = new Set(set.parameters)
  const outside = <T>(values: Record<string, T>) =>
    Object.fromEntries(Object.entries(values).filter(([id]) => !parameters.has(id)))
  return {
    overrides: { ...outside(state.overrides), ...profile.overrides },
    drafts: outside(state.drafts),
    profiles: { ...state.profiles, [set.id]: profile.id },
    edits: state.edits?.filter((id) => !parameters.has(id)) ?? [],
  }
}

export function editStyle(entry: Entry, id: string, text: string, state: StyleState) {
  const error = feedback(entry, text)
  const drafts = { ...state.drafts, [id]: text }
  if (!error) delete drafts[id]
  return {
    error,
    state: {
      ...state,
      drafts,
      overrides: error
        ? state.overrides
        : { ...state.overrides, [id]: entry.parameter.schema.type === "number" ? Number(text) : text },
      edits: error ? state.edits : manualEdits(state, [id]),
    },
  }
}

function manualEdits(state: StyleState, ids: readonly string[]) {
  return [...new Set([...(state.edits ?? []), ...ids])]
}

export function applyEdits(state: StyleState, overrides: StyleState["overrides"], ids: readonly string[]): StyleState {
  return { ...state, overrides, edits: manualEdits(state, ids) }
}

export function resetStyles(state: StyleState, id?: string): StyleState {
  if (id === undefined) return { overrides: {}, drafts: {}, profiles: undefined, edits: undefined }
  const overrides = { ...state.overrides },
    drafts = { ...state.drafts }
  delete overrides[id]
  delete drafts[id]
  return { ...state, overrides, drafts, edits: manualEdits(state, [id]) }
}

export function groups(description: Description): Group[] {
  const supplied = description.groups ?? []
  const used = new Set(supplied.flatMap((group) => group.parameters))
  const remaining = Object.keys(description.parameters)
    .toSorted()
    .filter((id) => !used.has(id))
  return [...supplied, ...(remaining.length ? [{ title: "Other controls", parameters: remaining }] : [])].map(
    (group) => ({
      ...group,
      title: group.title.replace(/(^|[^\p{L}\p{N}])(\p{L})/gu, (_, prefix, letter) => prefix + letter.toUpperCase()),
    }),
  )
}

export function objects(description: Description) {
  const bindings = new Map<string, string[]>()
  for (const [id, entry] of Object.entries(description.parameters)) {
    const key = JSON.stringify(entry.parameter.binding.targets.toSorted())
    const members = bindings.get(key) ?? []
    members.push(id)
    bindings.set(key, members)
  }
  return (ids: string[]) => {
    const order = new Map(ids.map((id, index) => [id, index]))
    return ids.flatMap<{
      parameters: string[]
      quartet: Quartet | undefined
    }>((id) => {
      const key = JSON.stringify(description.parameters[id].parameter.binding.targets.toSorted())
      const peers = bindings.get(key)!
      const complete = peers.every((other) => order.has(other))
      const properties = Object.fromEntries(
        peers.map((other) => [description.parameters[other].parameter.binding.property, other]),
      ) as Partial<Record<Property, string>>
      if (!complete || peers.length === 1) return [{ parameters: [id], quartet: undefined }]
      const members = peers.toSorted((a, b) => order.get(a)! - order.get(b)!)
      return id === members[0]
        ? [
            {
              parameters: members,
              quartet: {
                fill: { color: properties["fill-color"], opacity: properties["fill-opacity"] },
                stroke: {
                  color: properties["stroke-color"],
                  opacity: properties["stroke-opacity"],
                },
                width: properties["stroke-width"],
                visibility: properties.display,
              },
            },
          ]
        : []
    })
  }
}

export function applicable(description: Description, pages: Iterable<number>): string[] {
  const scope = new Set(pages)
  return groups(description)
    .flatMap((group) => group.parameters)
    .filter((id) => description.parameters[id].pages.some((page) => scope.has(page)))
}

export function available(source: { id: string; input: { description: Description } }, counts: Usage): string[] {
  return applicable(source.input.description, usedPages(source, counts))
}

export function usage(parts: readonly Part[]): Usage {
  const sources: Usage = new Map()
  for (const part of parts) {
    for (const { content } of part.pages)
      if ("source" in content) {
        let counts = sources.get(content.source)
        if (!counts) sources.set(content.source, (counts = new Map()))
        counts.set(content.page, (counts.get(content.page) ?? 0) + part.copies)
      }
  }
  return sources
}

export function draftError(
  source: { id: string; input: { name: string; description: Description }; drafts: Record<string, string> },
  counts: Usage,
): string | undefined {
  if (!Object.keys(source.drafts).length) return
  const scope = new Set(available(source, counts))
  for (const [id, text] of Object.entries(source.drafts)) {
    if (!scope.has(id)) continue
    const entry = source.input.description.parameters[id]
    if (feedback(entry, text)) return `${source.input.name}: fix ${entry.parameter.schema.title ?? id} before Download.`
  }
}

function usedPages(source: { id: string }, counts: Usage): number[] {
  return [...(counts.get(source.id)?.keys() ?? [])]
}

export function bufferPages(
  source: { id: string; input: { description: Description } },
  counts: Usage,
): number[] | undefined {
  const pages = usedPages(source, counts).toSorted((a, b) => a - b)
  const count = source.input.description.pageCount
  if (!pages.length || count < 32 || pages.length * 4 > count) return
  return pages
}

export function needsRender(
  source: { id: string; overrides: Record<string, Scalar>; input: { description: Description } },
  counts: Usage,
  rendered: Render,
): boolean {
  const changed = new Set(
    Object.keys({ ...rendered.overrides, ...source.overrides }).filter(
      (id) =>
        Object.hasOwn(source.overrides, id) !== Object.hasOwn(rendered.overrides, id) ||
        source.overrides[id] !== rendered.overrides[id],
    ),
  )
  if (!changed.size && rendered.pages === undefined) return false
  const used = usedPages(source, counts)
  const buffered = rendered.pages && new Set(rendered.pages)
  const missing = buffered !== undefined && used.some((page) => !buffered.has(page))
  if (!changed.size && !missing) return false
  const eligible = applicable(source.input.description, used)
  return eligible.length > 0 && (missing || eligible.some((id) => changed.has(id)))
}

export function resolve(entry: Entry, overrides: Record<string, Scalar>, id: string): Entry {
  const parameter = { ...entry.parameter }
  delete parameter.value
  if (Object.hasOwn(overrides, id)) parameter.value = overrides[id]
  return { ...entry, parameter }
}

export function current(entry: Entry, draft?: string): string {
  if (draft !== undefined) return draft
  if (Object.hasOwn(entry.parameter, "value")) return String(entry.parameter.value)
  return entry.baseline.kind === "uniform" ? String(entry.baseline.value) : ""
}

export function step(entry: Entry, text: string, direction: -1 | 1): string | undefined {
  if (feedback(entry, text)) return undefined
  const property = entry.parameter.binding.property
  let next: string
  if (property.endsWith("color")) {
    next =
      "#" +
      text
        .slice(1)
        .match(/../g)!
        .map((channel) =>
          Math.max(0, Math.min(255, parseInt(channel, 16) + direction * 8))
            .toString(16)
            .padStart(2, "0"),
        )
        .join("")
    if (next.toLowerCase() === text.toLowerCase()) return undefined
  } else if (property === "stroke-width") {
    next = String(Number((Number(text) * 1.05 ** direction).toPrecision(4)))
    if (Number(next) === Number(text)) return undefined
  } else return undefined
  return feedback(entry, next) ? undefined : next
}

// Field feedback helps entry. The processor remains the authority for PDF operations.
export function feedback(entry: Entry, text: string): string | undefined {
  const { schema, binding } = entry.parameter
  if (!text.trim()) return "Enter a value or reset this control."
  const value = schema.type === "number" ? Number(text) : text
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "Enter a finite number."
    if (binding.property === "stroke-width" ? value <= 0 : value < 0 || value > 1)
      return binding.property === "stroke-width"
        ? "Width must be greater than zero."
        : "Opacity must be between 0% and 100%."
    if (
      (schema.minimum !== undefined && value < schema.minimum) ||
      (schema.maximum !== undefined && value > schema.maximum) ||
      (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) ||
      (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum)
    )
      return "This value is outside the declared range."
  } else if (binding.property.endsWith("color") && !/^#[0-9a-fA-F]{6}$/.test(value)) {
    return "Use # followed by six hexadecimal digits."
  }
  if (schema.enum && !schema.enum.includes(value)) return "Choose a declared value."
  return undefined
}
