// Owns a Source's styled preview, completed composition, cancellation, and PDF handoff.

import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist"
import type { Input, Plan, Source } from "./model.ts"
import { titleOf } from "./model.ts"
import { applicable, bufferPages, needsRender } from "./styles.ts"
import type { Description, Render, Scalar, Usage } from "./styles.ts"
import { Documents, openPDF, verifyPDF } from "./pdf.ts"
import { Processor } from "./processor.ts"

type Displayed = { pdf: PDFDocumentProxy; description: Description; overrides: Record<string, Scalar> } & (
  | { kind: "full" }
  | { kind: "subset"; pages: readonly number[]; positions: ReadonlyMap<number, number> }
)
type Work =
  | { kind: "idle" }
  | { kind: "pending"; revision: number; request: Render }
  | { kind: "failure"; error: string }
type Host = {
  documents: Documents
  info: (text: string) => number
  complete: (text: string, revision: number) => void
  release: () => void
}

// Serialize batch previews so cross-file profile choices do not multiply WASM memory.
let processing = Promise.resolve()

export class Preview {
  #input: Input
  #host: Host
  #displayed = $state.raw<Displayed>()
  #completed: ArrayBuffer | undefined
  #work = $state.raw<Work>({ kind: "idle" })
  #counts: Usage = new Map()
  #processor: Processor | undefined
  #timer: ReturnType<typeof setTimeout> | undefined
  #task: PDFDocumentLoadingTask | undefined
  #revision = 0
  #advance: (() => void) | undefined
  #disposed = false

  constructor(input: Input, overrides: Record<string, Scalar>, host: Host, processor?: Processor) {
    this.#input = input
    this.#host = host
    this.#processor = processor
    this.#displayed = { kind: "full", pdf: input.pdf, description: input.description, overrides: { ...overrides } }
  }

  get displayed(): Displayed {
    return this.#displayed!
  }
  get status() {
    return this.#work.kind === "pending" ? "pending" : this.#work.kind === "failure" ? "error" : "ready"
  }
  get error() {
    return this.#work.kind === "failure" ? this.#work.error : undefined
  }
  #render(): Render {
    const displayed = this.displayed
    return { overrides: displayed.overrides, pages: displayed.kind === "subset" ? [...displayed.pages] : undefined }
  }
  appearance(page: number) {
    const displayed = this.displayed
    const index = displayed.kind === "full" ? page : displayed.positions.get(page)
    return index === undefined
      ? { pdf: this.#input.pdf, page, preview: this.#input.description.pages[page]?.preview }
      : { pdf: displayed.pdf, page: index, preview: displayed.description.pages[index]?.preview }
  }

  download(source: Source, pages: readonly number[], metadata: NonNullable<Plan["metadata"]>): ArrayBuffer | undefined {
    if (
      this.status !== "ready" ||
      metadata.title !== titleOf(this.#input) ||
      metadata.coverPage !== 1 ||
      this.displayed.kind !== "full" ||
      pages.length !== this.#input.description.pageCount ||
      pages.some((page, index) => page !== index) ||
      needsRender(source, this.#counts, this.#render())
    )
      return
    return this.#completed
  }

  reconcile(source: Source, counts: Usage) {
    const previous = this.#counts
    this.#counts = counts
    const rendered = this.#render()
    if (
      this.status === "pending" ||
      (needsRender(source, counts, rendered) && !needsRender(source, previous, rendered))
    )
      this.schedule(source, counts)
  }

  schedule(source: Source, counts: Usage, text?: string, serial = false) {
    if (this.#disposed) return
    this.#counts = counts
    const needed = needsRender(source, counts, this.#render())
    if (needed && this.#work.kind === "pending" && !needsRender(source, counts, this.#work.request)) {
      if (text) this.#host.info(text)
      return
    }
    this.#cancel()
    if (!needed) {
      this.#work = { kind: "idle" }
      if (text) this.#host.info(text)
      return
    }
    const request: Render = { overrides: { ...source.overrides }, pages: bufferPages(source, counts) }
    const revision = this.#revision
    this.#work = { kind: "pending", revision, request }
    const statusRevision = this.#host.info("Updating styles…")
    this.#timer = setTimeout(() => {
      this.#timer = undefined
      const run = () => this.#run(revision, request, text ?? "Updated styles.", statusRevision)
      if (serial) {
        const cancelled = new Promise<void>((resolve) => (this.#advance = resolve))
        processing = processing.then(() => Promise.race([run(), cancelled]))
      } else void run()
    }, 200)
  }

  #cancel() {
    this.#revision++
    this.#advance?.()
    this.#advance = undefined
    clearTimeout(this.#timer)
    this.#timer = undefined
    this.#processor?.cancel()
    void this.#task?.destroy()
    this.#task = undefined
  }
  cancel() {
    if (this.#disposed) return
    this.#cancel()
    this.#work = { kind: "failure", error: "Style processing cancelled. Your choices are retained." }
    this.#host.info("Cancelled style processing. Your choices are retained.")
  }
  dispose() {
    this.#disposed = true
    this.#cancel()
    this.#processor?.dispose()
    this.#processor = undefined
    this.#completed = undefined
    this.#work = { kind: "idle" }
  }

  async #run(revision: number, request: Render, text: string, statusRevision: number) {
    if (this.#disposed || revision !== this.#revision) return
    const processor = (this.#processor ??= new Processor())
    const { overrides, pages } = request
    const ids = pages ? applicable(this.#input.description, pages) : []
    let task: PDFDocumentLoadingTask | undefined
    try {
      const result = pages
        ? await processor.run(this.#input.bytes, revision, {
            reset: ids,
            overrides: Object.fromEntries(Object.entries(overrides).filter(([id]) => ids.includes(id))),
            buffer: { input: this.#input.id, pages },
          })
        : await processor.compose(
            {
              version: 1,
              metadata: { title: titleOf(this.#input), coverPage: 1 },
              sources: { [this.#input.id]: { input: this.#input.id, overrides } },
              parts: [
                {
                  pages: Array.from({ length: this.#input.description.pageCount }, (_, page) => ({
                    source: this.#input.id,
                    page,
                  })),
                  copies: 1,
                  front: false,
                },
              ],
            },
            [this.#input],
            revision,
          )
      if (this.#disposed || revision !== this.#revision) return
      const expected = pages?.length ?? this.#input.description.pageCount
      if (result.description.pageCount !== expected || (!pages && result.provenance?.pages.length !== expected))
        throw new Error("The styled PDF does not match the expected page count.")
      task = await openPDF(new Uint8Array(result.bytes))
      if (this.#disposed || revision !== this.#revision) {
        void task.destroy()
        return
      }
      this.#task = task
      const pdf = await task.promise
      if (pdf.numPages !== expected)
        throw new Error("The styled PDF could not be inspected with the expected page count.")
      await verifyPDF(pdf)
      if (this.#disposed || revision !== this.#revision) return
      this.#host.documents.add(pdf, task, { bytes: new Uint8Array(result.bytes), description: result.description })
      this.#completed = pages ? undefined : result.bytes
      this.#displayed = pages
        ? {
            kind: "subset",
            pdf,
            description: result.description,
            overrides,
            pages,
            positions: new Map(pages.map((page, index) => [page, index])),
          }
        : { kind: "full", pdf, description: result.description, overrides }
      this.#work = { kind: "idle" }
      this.#task = undefined
      this.#host.complete(text, statusRevision)
      this.#host.release()
      task = undefined
    } catch (reason) {
      if (!this.#disposed && revision === this.#revision) {
        this.#work = {
          kind: "failure",
          error: reason instanceof Error ? reason.message : "Input style processing failed.",
        }
        this.#host.complete("", statusRevision)
      }
    } finally {
      if (task && this.#task === task) {
        this.#task = undefined
        void task.destroy()
      }
    }
  }
}
