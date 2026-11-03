// Defines requests, results, and structured failures shared by the processor host and worker.

import type { Description, Scalar } from "./styles.ts"
import type { Content, Plan } from "./model.ts"
import type { Recipe, Resolution } from "./recipe.ts"

export type ProcessorError = {
  code: string
  message: string
  parameter?: string
  page?: string
  region?: string
  source?: "manifest" | "request"
  location?: string
}
export type Failure = { kind: "processor"; record: ProcessorError } | { kind: "host"; message: string }
export type Operation =
  | {
      bytes: ArrayBuffer
      changes?: {
        overrides: Record<string, Scalar>
        reset: string[]
        buffer?: { input: string; pages: number[] }
      }
    }
  | { plan: Plan; inputs: Record<string, ArrayBuffer> }
  | { preview: { input: number; bytes: ArrayBuffer; page: number } }
  | { recipe: string; inputs?: Record<string, ArrayBuffer> }
export type Request = Operation & {
  revision: number
}
export type Provenance = {
  version: 1
  pages: (Content & { part: number; copy: number; padding?: boolean })[]
  parameters: Record<string, { source: string; parameter: string }>
}
export type Result = {
  revision: number
  bytes: ArrayBuffer
  description: Description
  sha256?: string
  provenance?: Provenance
}
export type Image = { revision: number; image: ArrayBuffer }
export type Success =
  | Result
  | Image
  | { revision: number; definitions: Recipe["inputs"] }
  | { revision: number; resolution: Resolution }
export type Reply = Success | { revision: number; failure: Failure }
