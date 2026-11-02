// Runs cancellable processor requests and owns their worker lifetime.

import type { Failure, Image, Operation, Reply, Result } from "./protocol.ts"
import type { Plan } from "./model.ts"
import type { Scalar } from "./styles.ts"

const messages: Record<string, string> = {
  "pdf-syntax": "PDF Composer cannot read this PDF. Try an unprotected copy that opens in a PDF viewer.",
  "missing-contract": "This PDF has no editable styles. Choose a PDF prepared for styling.",
  "unsupported-version":
    "This PDF uses a style format that PDF Composer does not support. Update PDF Composer or ask its creator for a compatible PDF.",
  "unsupported-context":
    "This PDF contains features that PDF Composer does not support. Ask its creator for a supported PDF.",
  "invalid-contract":
    "The style information in this PDF is invalid or incompatible with PDF Composer. Ask its creator to prepare it again with the current Mainz format.",
  "invalid-request": "The page or style choices are invalid. Review your choices and try again.",
  "limit-exceeded": "This PDF or Output exceeds the processing limits. Try a smaller PDF or fewer Output pages.",
}

class OperationError extends Error {
  constructor(readonly failure: Failure) {
    super(failure.kind === "processor" ? (messages[failure.record.code] ?? failure.record.message) : failure.message)
  }
}

const idle = new Set<Processor>()

export class Processor {
  private worker?: Worker
  private buffer?: string
  private active?: {
    revision: number
    buffer?: string
    resolve: (result: Result | Image) => void
    reject: (error: Error) => void
  }

  run(
    bytes: Uint8Array,
    revision: number,
    changes?: {
      overrides: Record<string, Scalar>
      reset: string[]
      buffer?: { input: string; pages: number[] }
    },
  ): Promise<Result> {
    if (this.active) return Promise.reject(new Error("A processing operation is already active."))
    const buffer = changes?.buffer && JSON.stringify(changes.buffer)
    const input = buffer && buffer === this.buffer ? new ArrayBuffer(0) : bytes.slice().buffer
    return this.send({ bytes: input, changes }, revision, [input], buffer).then(document)
  }

  compose(plan: Plan, inputs: { id: string; bytes: Uint8Array }[], revision: number): Promise<Result> {
    if (this.active) return Promise.reject(new Error("A processing operation is already active."))
    const bindings = Object.fromEntries(inputs.map((input) => [input.id, input.bytes.slice().buffer]))
    return this.send({ plan, inputs: bindings }, revision, Object.values(bindings)).then(document)
  }

  preview(bytes: Uint8Array, page: number): Promise<ArrayBuffer> {
    if (this.active) return Promise.reject(new Error("A processing operation is already active."))
    const input = bytes.slice().buffer
    return this.send({ preview: { bytes: input, page } }, 0, [input]).then((result) => {
      if (!("image" in result)) throw new Error("The processor returned no preview result.")
      return result.image
    })
  }

  private send(
    operation: Operation,
    revision: number,
    transfers: ArrayBuffer[],
    buffer?: string,
  ): Promise<Result | Image> {
    idle.delete(this)
    if (!this.worker) {
      this.worker = new Worker(new URL("./processor.worker.ts", import.meta.url), {
        type: "module",
      })
      this.worker.addEventListener("message", (event: MessageEvent<Reply>) => {
        const reply = event.data
        if (!this.active || reply.revision !== this.active.revision) return
        const active = this.active
        this.active = undefined
        if ("failure" in reply) {
          this.buffer = undefined
          active.reject(new OperationError(reply.failure))
        } else {
          this.buffer = active.buffer
          active.resolve(reply)
        }
        idle.add(this)
        if (idle.size > 1) idle.values().next().value!.dispose()
      })
      this.worker.addEventListener("error", (event) => {
        event.preventDefault()
        this.stop(new Error("PDF processing failed. Reload PDF Composer and try again."))
      })
      this.worker.addEventListener("messageerror", () =>
        this.stop(new Error("PDF processing returned an unreadable result. Try the action again.")),
      )
    }
    return new Promise((resolve, reject) => {
      this.active = { revision, resolve, reject, buffer }
      try {
        this.worker!.postMessage({ revision, ...operation }, transfers)
      } catch (error) {
        this.stop(error instanceof Error ? error : new Error("Cannot send the processing input."))
      }
    })
  }

  cancel() {
    if (this.active) this.dispose()
  }

  dispose() {
    this.stop(new DOMException("Processing cancelled.", "AbortError"))
  }

  private stop(error: Error) {
    idle.delete(this)
    this.buffer = undefined
    this.worker?.terminate()
    this.worker = undefined
    const active = this.active
    this.active = undefined
    active?.reject(error)
  }
}

function document(result: Result | Image): Result {
  if (!("description" in result)) throw new Error("The processor returned no document result.")
  return result
}
