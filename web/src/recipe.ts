// Serializes accepted Output choices and explicit style intent to the shared portable Recipe contract.

/// <reference lib="es2024.string" />

import { downloadInputs, job } from "./model.ts"
import type { Job, Part, Source } from "./model.ts"
import type { Scalar } from "./styles.ts"

type Profile = { set: string; id: string } | { family: string; name: string }
type Override = ({ id: string } | { family: string; key: string }) & { value: Scalar | null }
export type Recipe = {
  version: 1
  inputs: Record<string, { sha256: string; publication?: { id: string; version: string } }>
  sources: Record<string, { input: string; profiles: Profile[]; overrides: Override[] }>
  parts: Job["parts"]
}

export function identities(ids: Record<string, string>): Record<string, string> {
  const values = Object.values(ids).map((value) => value.trim())
  return Object.fromEntries(
    Object.entries(ids).flatMap(([key, draft]) => {
      const id = draft.trim()
      const error = !id
        ? "Enter an Input ID."
        : !id.isWellFormed() || new TextEncoder().encode(id).length > 4096
          ? "Use a valid, shorter Input ID."
          : // oxlint-disable-next-line no-control-regex -- IDs exclude control characters.
            /[\u0000-\u001f\u007f-\u009f]/.test(id)
            ? "Use an Input ID without control characters."
            : values.filter((value) => value === id).length > 1
              ? "Each Input needs a unique ID."
              : ""
      return error ? [[key, error]] : []
    }),
  )
}

export function recipe(parts: readonly Part[], sources: readonly Source[]): Recipe {
  const request = job(parts, sources)
  const inputs = downloadInputs(parts, sources)
  return {
    version: 1,
    inputs: Object.fromEntries(
      inputs.map((input) => {
        if (!input.sha256) throw new Error(`The fingerprint for ${input.name} is unavailable. Reopen this Input.`)
        return [
          input.id,
          {
            sha256: input.sha256,
            ...(input.description.publication ? { publication: { ...input.description.publication } } : {}),
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
            if (!edits.has(id) && assigned === defaults.has(id) && source.overrides[id] === defaults.get(id)) continue
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
          return [source.id, { input: source.input.id, profiles, overrides }]
        }),
    ),
    parts: request.parts,
  }
}
