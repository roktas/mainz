// Serializes accepted Output choices and explicit style intent to the shared portable Recipe contract.

/// <reference lib="es2024.string" />

import { downloadInputs, plan } from "./model.ts"
import type { Input, Plan, Part, Source } from "./model.ts"
import { sameScalar } from "./styles.ts"
import type { Scalar, StyleState } from "./styles.ts"

export const maxRecipeBytes = 16 * 1024 * 1024

type Profile = { set: string; id: string } | { family: string; name: string; all?: boolean }
type Override = ({ id: string } | { family: string; key: string; all?: boolean }) & { value: Scalar | null }
export type Reference = {
  sha256: string
  pageCount: number
  pageNamesSha256?: string
  publication?: { id: string; compat: number }
}
export type Diagnostic = { code: string; message: string; location?: string; expected?: unknown; actual?: unknown }
type InputState = "ready" | "update" | "review" | "error"
export type InputCheck = {
  input: string
  state: InputState
  diagnostics: Diagnostic[]
  reference?: Reference
}
export type Checks = { state: InputState; inputs: InputCheck[] }
export type Recipe = {
  version: 1
  metadata?: Plan["metadata"]
  inputs: Record<
    string,
    Partial<Reference> & {
      title?: string
      cover?: string
      xmp?: Record<string, string>
    }
  >
  sources: Record<string, { input: string; title?: string; profiles?: Profile[]; overrides?: Override[] }>
  parts: {
    pages: (
      | Plan["parts"][number]["pages"][number]
      | { source: string; page: string }
      | { source: string; pages: "all" }
    )[]
    copies?: number
    front?: boolean
  }[]
}
export type Resolution = {
  plan: Plan
  checks: Checks
  aligned: Recipe
  intent: Record<string, Required<Pick<StyleState, "profiles" | "edits">>>
}

const encoder = new TextEncoder()

function normalizeInputId(draft: string): string {
  return draft.trim().replace(/\.pdf$/i, "")
}

export function identities(ids: Record<string, string>): Record<string, string> {
  const values = Object.values(ids).map(normalizeInputId)
  return Object.fromEntries(
    Object.entries(ids).flatMap(([key, draft]) => {
      const id = normalizeInputId(draft)
      const error = !id
        ? "Enter an Input name."
        : !id.isWellFormed() || encoder.encode(id).length > 4096
          ? "Use a valid, shorter Input name."
          : // oxlint-disable-next-line no-control-regex -- IDs exclude control characters.
            /[\u0000-\u001f\u007f-\u009f]/.test(id)
            ? "Use an Input name without control characters."
            : values.filter((value) => value === id).length > 1
              ? "Each Input needs a unique name."
              : ""
      return error ? [[key, error]] : []
    }),
  )
}

export function recipe(parts: readonly Part[], sources: readonly Source[], metadata?: Plan["metadata"]): Recipe {
  const request = plan(parts, sources)
  const inputs = downloadInputs(parts, sources)
  return {
    version: 1,
    ...(metadata ? { metadata } : {}),
    inputs: Object.fromEntries(
      inputs.map((input) => {
        if (!input.reference) throw new Error(`The reference for ${input.name} is unavailable. Reopen this Input.`)
        return [
          input.id,
          {
            ...input.reference,
            ...(input.title ? { title: input.title } : {}),
            ...(input.cover ? { cover: input.cover } : {}),
            ...(input.xmp && Object.keys(input.xmp).length ? { xmp: input.xmp } : {}),
          },
        ]
      }),
    ),
    sources: Object.fromEntries(
      sources
        .filter((source) => Object.hasOwn(request.sources, source.id))
        .map((source) => {
          const description = source.input.description
          const sets = description.profileSets ?? []
          const profiles: Profile[] = []
          const defaults = new Map<string, Scalar>()
          for (const [id, selected] of Object.entries(source.profiles ?? {})) {
            const set = sets.find((candidate) => candidate.id === id)
            const profile = set?.profiles.find((candidate) => candidate.id === selected)
            if (!set || !profile) throw new Error(`A selected profile in ${source.input.name} is unavailable.`)
            const matches = sets.filter(
              (candidate) =>
                candidate.family === set.family && candidate.profiles.some((choice) => choice.name === profile.name),
            )
            profiles.push(
              set.family && matches.length === 1
                ? { family: set.family, name: profile.name }
                : { set: set.id, id: profile.id },
            )
            for (const [parameter, value] of Object.entries(profile.overrides)) defaults.set(parameter, value)
          }
          const parameters = description.parameters
          const semantic = new Map<string, number>()
          for (const { parameter } of Object.values(parameters))
            if (parameter.family && parameter.key) {
              const key = JSON.stringify([parameter.family, parameter.key])
              semantic.set(key, (semantic.get(key) ?? 0) + 1)
            }
          const edits = new Set(source.edits)
          const overrides: Override[] = []
          for (const id of new Set([...Object.keys(source.overrides), ...defaults.keys(), ...edits])) {
            const assigned = Object.hasOwn(source.overrides, id)
            if (!edits.has(id) && assigned === defaults.has(id) && sameScalar(source.overrides[id], defaults.get(id)))
              continue
            const parameter = parameters[id]?.parameter
            if (!parameter) throw new Error(`An edited parameter in ${source.input.name} is unavailable.`)
            const value = assigned ? source.overrides[id] : null
            const key = JSON.stringify([parameter.family, parameter.key])
            overrides.push(
              parameter.family && parameter.key && semantic.get(key) === 1
                ? { family: parameter.family, key: parameter.key, value }
                : { id, value },
            )
          }
          const title = request.sources[source.id].title
          return [source.id, { input: source.input.id, ...(title !== undefined ? { title } : {}), profiles, overrides }]
        }),
    ),
    parts: request.parts,
  }
}

export function encodeRecipe(
  record: Recipe,
  inputs: readonly Pick<Input, "id" | "description">[],
  ids: Record<string, string>,
): Uint8Array<ArrayBuffer> {
  const saved = {
    ...record,
    inputs: Object.fromEntries(Object.entries(record.inputs).map(([id, input]) => [normalizeInputId(ids[id]), input])),
    sources: Object.fromEntries(
      Object.entries(record.sources).map(([id, source]) => [
        id,
        { ...source, input: normalizeInputId(ids[source.input]) },
      ]),
    ),
  }
  const serialize = () => encoder.encode(JSON.stringify(saved, null, 2) + "\n")
  const indexed = serialize()
  let remaining = maxRecipeBytes - indexed.length
  let usesNames = false
  const names = new Map(
    inputs.map(({ id, description }) => {
      const counts = new Map<string, number>()
      for (const { name } of description.pages) if (name) counts.set(name, (counts.get(name) ?? 0) + 1)
      return [
        id,
        description.pages.map(({ name }) => (name && counts.get(name) === 1 ? { name, references: 0 } : undefined)),
      ]
    }),
  )
  const namedPage = (source: string, page: number) => names.get(record.sources[source].input)?.[page]

  // Use one selector for every reference to the same page so replay preserves repetition after a reorder.
  for (const part of record.parts)
    for (const page of part.pages) {
      if (!("page" in page) || typeof page.page !== "number") continue
      const candidate = namedPage(page.source, page.page)
      if (candidate) candidate.references++
    }
  for (const pages of names.values())
    for (const [index, candidate] of pages.entries()) {
      if (!candidate?.references) continue
      const cost = (encoder.encode(JSON.stringify(candidate.name)).length - String(index).length) * candidate.references
      if (cost > Math.max(0, remaining)) pages[index] = undefined
      else {
        remaining -= cost
        usesNames = true
      }
    }
  if (remaining < 0) throw new Error("The recipe exceeds the 16 MiB limit. Reduce Output choices.")
  if (!usesNames) return indexed

  saved.parts = record.parts.map((part) => ({
    ...part,
    pages: part.pages.map((page) => {
      if (!("page" in page) || typeof page.page !== "number") return page
      const candidate = namedPage(page.source, page.page)
      return candidate ? { source: page.source, page: candidate.name } : page
    }),
  }))
  return serialize()
}
