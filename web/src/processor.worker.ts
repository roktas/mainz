// Runs WASM requests, manages document handles, and bounds reusable page and style results.

/// <reference lib="webworker" />
import type { Failure, Request, Reply, Result, Report } from "./protocol.ts"

type Module = {
  HEAPU8: Uint8Array
  _malloc(size: number): number
  _free(pointer: number): void
  _mainz_read(pointer: number, size: number): number
  _mainz_style(handle: number, pointer: number, size: number, resetPointer: number, resetSize: number): void
  _mainz_extract(handle: number, pointer: number, size: number): void
  _mainz_describe(handle: number): void
  _mainz_close(handle: number): void
  _mainz_input(idPointer: number, idSize: number, pdfPointer: number, pdfSize: number): void
  _mainz_clear_inputs(): void
  _mainz_compose(pointer: number, size: number): void
  _mainz_report(): number
  _mainz_report_size(): number
  _mainz_result(): number
  _mainz_size(): number
  _mainz_status(): number
}
let module: Module | undefined
let extracted: { input: string; pages: string; bytes: Uint8Array<ArrayBuffer> } | undefined
let styled:
  | { input: Uint8Array<ArrayBuffer>; results: Map<string, { result: Result; size: number }>; size: number }
  | undefined
const styleLimit = 16 * 1024 * 1024
let busy = false
const encoder = new TextEncoder()
const decoder = new TextDecoder("utf-8", { fatal: true })

class OperationError extends Error {
  constructor(readonly failure: Failure) {
    super("Processor operation failed.")
  }
}

function result(wasm: Module): Uint8Array<ArrayBuffer> {
  const bytes = wasm.HEAPU8.slice(wasm["_mainz_result"](), wasm["_mainz_result"]() + wasm["_mainz_size"]())
  const status = wasm["_mainz_status"]()
  if (status) {
    const record = JSON.parse(decoder.decode(bytes))
    throw new OperationError(
      status === 1
        ? { kind: "processor", record }
        : { kind: "host", message: record.hostError ?? "WASM operation failed." },
    )
  }
  return bytes
}

function input<T>(wasm: Module, bytes: Uint8Array, call: (pointer: number, size: number) => T): T {
  const pointer = wasm["_malloc"](bytes.length || 1)
  if (!pointer) throw new Error("Cannot allocate the processing input.")
  try {
    wasm.HEAPU8.set(bytes, pointer)
    return call(pointer, bytes.length)
  } finally {
    wasm["_free"](pointer)
  }
}

async function run(job: Request): Promise<Result> {
  if (!module) {
    const moduleUrl = new URL(/* @vite-ignore */ "../processor.mjs", import.meta.url).href
    const { default: create } = await import(/* @vite-ignore */ moduleUrl)
    module = await create({ locateFile: (name: string) => new URL(name, moduleUrl).href })
  }
  const wasm = module!
  let bytes = "bytes" in job ? new Uint8Array(job.bytes) : new Uint8Array(0)
  const selection = "bytes" in job ? job.changes?.buffer : undefined
  const pages = selection ? JSON.stringify(selection.pages) : ""
  const cached = selection && extracted?.input === selection.input && extracted.pages === pages
  if (cached) bytes = extracted!.bytes
  let report: Report | undefined
  let handle = 0
  let failed = false
  let styleKey: string | undefined
  let styleInput: Uint8Array<ArrayBuffer> | undefined
  function reuse(candidate: Uint8Array<ArrayBuffer>, key?: string): Result | undefined {
    if (styled) {
      let same = styled.input.length === candidate.length
      for (let index = 0; same && index < candidate.length; index++) same = styled.input[index] === candidate[index]
      if (!same) styled = undefined
    }
    if (!key) return
    const reused = styled?.results.get(key)
    if (!reused) return
    styled!.results.delete(key)
    styled!.results.set(key, reused)
    return { ...reused.result, revision: job.revision, bytes: reused.result.bytes.slice(0) }
  }
  function open() {
    if (handle) return
    handle = input(wasm, bytes, (p, n) => wasm["_mainz_read"](p, n))
    result(wasm)
    if (!handle) throw new Error("The processor returned no document handle.")
  }
  function reopen() {
    wasm["_mainz_close"](handle)
    handle = 0
    result(wasm)
    open()
  }
  try {
    if ("job" in job) {
      const inputs = Object.values(job.inputs)
      if (inputs.length === 1) {
        styleInput = new Uint8Array(inputs[0])
        styleKey = JSON.stringify({ job: job.job, input: Object.keys(job.inputs)[0] })
        const reused = reuse(styleInput, styleKey)
        if (reused) return reused
      } else styled = undefined
      wasm["_mainz_clear_inputs"]()
      result(wasm)
      try {
        for (const [id, buffer] of Object.entries(job.inputs)) {
          input(wasm, encoder.encode(id), (idPointer, idSize) =>
            input(wasm, new Uint8Array(buffer), (pdfPointer, pdfSize) =>
              wasm["_mainz_input"](idPointer, idSize, pdfPointer, pdfSize),
            ),
          )
          result(wasm)
        }
        input(wasm, encoder.encode(JSON.stringify(job.job)), (p, n) => wasm["_mainz_compose"](p, n))
        bytes = result(wasm)
        report = JSON.parse(
          decoder.decode(
            wasm.HEAPU8.slice(wasm["_mainz_report"](), wasm["_mainz_report"]() + wasm["_mainz_report_size"]()),
          ),
        )
      } finally {
        wasm["_mainz_clear_inputs"]()
      }
    }
    if (selection && !cached) {
      open()
      input(wasm, encoder.encode(pages), (p, n) => wasm["_mainz_extract"](handle, p, n))
      bytes = result(wasm)
      reopen()
      extracted = { input: selection.input, pages, bytes }
    }
    if ("bytes" in job && job.changes && (job.changes.reset.length || Object.keys(job.changes.apply).length)) {
      const changes = job.changes
      styleKey = JSON.stringify({ apply: changes.apply, reset: changes.reset })
      styleInput = bytes
      const reused = reuse(bytes, styleKey)
      if (reused) return reused
      open()
      input(wasm, encoder.encode(JSON.stringify(changes.apply)), (p, n) =>
        input(wasm, encoder.encode(JSON.stringify(changes.reset)), (resetPointer, resetSize) =>
          wasm["_mainz_style"](handle, p, n, resetPointer, resetSize),
        ),
      )
      bytes = result(wasm)
      reopen()
    } else if ("bytes" in job) reuse(bytes)
    open()
    wasm["_mainz_describe"](handle)
    const description = JSON.parse(decoder.decode(result(wasm)))
    const reply: Result = {
      revision: job.revision,
      bytes: (bytes === extracted?.bytes ? bytes.slice() : bytes).buffer as ArrayBuffer,
      description,
      report,
    }
    if (styleKey && styleInput) {
      const size =
        reply.bytes.byteLength +
        encoder.encode(styleKey).length +
        encoder.encode(JSON.stringify({ description, report })).length
      if (styleInput.length + size <= styleLimit) {
        styled ??= { input: styleInput.slice(), results: new Map(), size: styleInput.length }
        while (styled.results.size && (styled.results.size >= 4 || styled.size + size > styleLimit)) {
          const first = styled.results.keys().next().value!
          styled.size -= styled.results.get(first)!.size
          styled.results.delete(first)
        }
        styled.results.set(styleKey, { result: { ...reply, bytes: reply.bytes.slice(0) }, size })
        styled.size += size
      }
    }
    return reply
  } catch (error) {
    failed = true
    throw error
  } finally {
    if (handle) {
      try {
        wasm["_mainz_close"](handle)
        result(wasm)
      } catch (error) {
        // oxlint-disable-next-line no-unsafe-finally -- Fail successful work, but preserve an earlier operation error.
        if (!failed) throw error
      }
    }
  }
}

self.addEventListener("message", async (event: MessageEvent<Request>) => {
  const job = event.data
  let reply: Reply
  if (busy) {
    self.postMessage(
      {
        revision: job.revision,
        failure: { kind: "host", message: "A processing job is already active." },
      },
      [],
    )
    return
  }
  busy = true
  try {
    reply = await run(job)
  } catch (error) {
    module = undefined
    extracted = undefined
    styled = undefined
    reply = {
      revision: job.revision,
      failure:
        error instanceof OperationError
          ? error.failure
          : {
              kind: "host",
              message: error instanceof Error ? error.message : "Processing worker failed.",
            },
    }
  } finally {
    busy = false
  }
  self.postMessage(reply, "bytes" in reply ? [reply.bytes] : [])
})
