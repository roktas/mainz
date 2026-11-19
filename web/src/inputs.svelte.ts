// Owns installed Inputs, their preparation, and cancellable workspace opening.

import { tick } from "svelte"
import { maxInputBytes, uid } from "./model.ts"
import type { Input, Plan, Source } from "./model.ts"
import type { Sequence } from "./pages.ts"
import type { Binding } from "./Load.svelte"
import { Documents, Opening } from "./pdf.ts"
import { Processor } from "./processor.ts"
import { Output } from "./output.svelte.ts"
import { Preview, schedulePreviews } from "./preview.svelte.ts"
import { usage } from "./styles.ts"

type Work = { dispose: () => void }
type Host = {
  updating: () => boolean
  clear: () => void
  info: (text: string, source?: Pick<Source, "id" | "input">) => number
  complete: (text: string, revision: number, source: Pick<Source, "id" | "input">) => void
  error: (text: string | string[]) => void
}

export class Inputs {
  sources = $state.raw<Source[]>([])
  sequences = $state.raw<Record<string, Sequence>>({})
  activeId = $state("")
  provisional = $state.raw<Source>()
  readonly output = new Output(() => this.sources)
  #documents = new Documents()
  #pending = $state.raw<{ job: Work; status: string; summary?: string }>()
  #generation = 0
  #number = 1
  #disposed = false

  constructor(private host: Host) {}

  get active() {
    return this.sources.find(({ id }) => id === this.activeId) ?? this.provisional
  }
  get revision() {
    return this.#generation
  }
  get disposed() {
    return this.#disposed
  }
  get loading() {
    return !!this.#pending
  }
  get status() {
    return this.#pending?.status ?? ""
  }
  get summary() {
    return this.#pending?.summary
  }
  #available() {
    return !this.#pending && !this.#disposed && !this.host.updating()
  }
  #start(job: Work, status: string, summary?: string) {
    const revision = ++this.#generation
    this.#pending = { job, status, summary }
    this.host.clear()
    this.host.info("")
    return revision
  }
  #current(revision: number) {
    return !this.#disposed && revision === this.#generation
  }
  #finish(job: Work, revision: number) {
    job.dispose()
    if (this.#current(revision)) {
      this.provisional = undefined
      this.#pending = undefined
    }
  }
  choose(id: string, sequence: Sequence) {
    this.sequences = { ...this.sequences, [id]: sequence }
  }
  #source(input: Input, id: string, number: number, processor?: Processor): Source {
    const identity = { id, input }
    const values = Object.entries(input.description.parameters)
    const overrides = Object.fromEntries(
      values
        .filter(([, entry]) => Object.hasOwn(entry.parameter, "value"))
        .map(([key, entry]) => [key, entry.parameter.value!]),
    )
    if (!values.length) processor?.dispose()
    const preview = new Preview(
      input,
      overrides,
      {
        documents: this.#documents,
        info: (text) => this.host.info(text, identity),
        complete: (text, revision) => this.host.complete(text, revision, identity),
        release: () => void this.#release(),
      },
      values.length ? processor : undefined,
    )
    return { ...identity, number, overrides, drafts: {}, modified: false, preview }
  }
  #publish(sources: Source[]) {
    const sequences = { ...this.sequences }
    for (const { id, input } of sources) {
      const single = input.pdf.numPages === 1
      sequences[id] = { text: single ? "1" : "", pages: single ? [0] : [], repeat: "1", front: false }
    }
    this.sequences = sequences
    this.sources = [...this.sources, ...sources]
    this.activeId = sources[0]?.id ?? ""
    this.provisional = undefined
    this.#number += sources.length
  }
  async open(file: Uint8Array | File, name: string, report: (text: string) => void = this.host.error) {
    if (!this.#available()) return
    if ((file instanceof File ? file.size : file.length) > maxInputBytes) {
      report("Choose a PDF smaller than 128 MiB.")
      return
    }
    const job = new Opening()
    const revision = this.#start(job, `Opening ${name}…`, "Opening PDF")
    const id = uid()
    let provisional: Source | undefined
    try {
      const input = await job.read(file, name, revision, (pending) => {
        if (this.#current(revision) && !this.sources.length && !this.output.parts.length) {
          provisional = this.#source(pending, id, this.#number)
          this.provisional = provisional
        }
      })
      if (!this.#current(revision)) return
      const source = this.#source(input, id, this.#number, job.attach(this.#documents))
      this.#publish([source])
      this.host.info(`Opened ${input.pdf.numPages} ${input.pdf.numPages === 1 ? "page" : "pages"}.`)
      return source
    } catch (reason) {
      if (this.#current(revision)) {
        report(
          `Could not open ${name}. ${reason instanceof Error ? reason.message : "Try another PDF."} Your workspace is retained. Choose a PDF to retry.`,
        )
        void this.#release()
      }
    } finally {
      provisional?.preview.dispose()
      this.#finish(job, revision)
    }
  }
  async files(list: FileList | File[]) {
    if (!this.#available()) return
    const failed: string[] = []
    for (const file of Array.from(list)) {
      if (!file.name.toLowerCase().endsWith(".pdf")) {
        failed.push(`Could not open ${file.name}. Choose a PDF file.`)
        continue
      }
      if (file.size > maxInputBytes) {
        failed.push(`Could not open ${file.name}. Choose a PDF smaller than 128 MiB.`)
        continue
      }
      const revision = this.#generation + 1
      await this.open(file, file.name, (text) => failed.push(text))
      if (!this.#current(revision) || this.host.updating()) return
    }
    if (failed.length) this.host.error(failed)
  }
  async replay(text: string, bindings: readonly Binding[], force: boolean) {
    if (!this.#available() || this.sources.length || this.output.parts.length)
      throw new Error("Return home to open a Recipe.")
    const worker = new Processor()
    const revision = this.#start(worker, "Opening recipe")
    try {
      const { plan, intent, aligned } = await worker.resolve(
        text,
        bindings.map(({ id, input }) => ({ id, bytes: input.bytes })),
        revision,
        force,
      )
      if (!this.#current(revision)) throw new DOMException("Opening cancelled.", "AbortError")
      const documents = new Map(bindings.map(({ id, input }) => [id, input]))
      const sources = new Map<string, Source>()
      for (const [id, definition] of Object.entries(plan.sources)) {
        const input = documents.get(definition.input)
        if (!input) throw new Error("Recipe Input is unavailable. Choose its PDF again.")
        const source = this.#source(input, uid(), this.#number + sources.size)
        sources.set(id, { ...source, ...intent[id], title: definition.title, overrides: definition.overrides })
      }
      const parts = plan.parts.map((part) => ({
        id: uid(),
        copies: part.copies,
        front: part.front,
        pages: part.pages.map((content) => ({
          id: uid(),
          content:
            "source" in content ? { source: sources.get(content.source)?.id ?? "", page: content.page } : content,
        })),
      }))
      const installed = [...sources.values()]
      this.output.install(parts, installed, () => {
        for (const { opening } of bindings) opening.attach(this.#documents).dispose()
        this.#publish(installed)
      })
      this.output.title = plan.metadata?.title ?? ""
      this.output.cover = undefined
      if (plan.metadata) this.output.coverPage = plan.metadata.coverPage
      schedulePreviews(installed, usage(parts), this.activeId)
      this.host.info(`Opened Recipe · ${this.output.pages.length} pages.`)
      return aligned
    } finally {
      this.#finish(worker, revision)
    }
  }
  async composeDemo(plan: Plan, bytes: Uint8Array) {
    if (!this.#available()) return
    const worker = new Processor()
    const revision = this.#start(worker, "Preparing Grid demo…")
    try {
      const result = await worker.compose(plan, [{ id: "fixture", bytes }], revision)
      if (this.#current(revision)) return new Uint8Array(result.bytes)
    } catch (reason) {
      if (this.#current(revision)) this.host.error(reason instanceof Error ? reason.message : "Demo could not open.")
    } finally {
      this.#finish(worker, revision)
    }
  }
  cancel() {
    this.#generation++
    this.#pending?.job.dispose()
    this.#pending = undefined
    this.provisional = undefined
  }
  remove(source: Source) {
    source.preview.dispose()
    const sequences = { ...this.sequences }
    delete sequences[source.id]
    this.sequences = sequences
    this.sources = this.sources.filter(({ id }) => id !== source.id)
    this.activeId = this.sources[0]?.id ?? ""
    void this.#release()
  }
  async #release() {
    await tick()
    this.#documents.retain(this.sources.flatMap(({ preview, input }) => [preview.displayed.pdf, input.pdf]))
  }
  dispose() {
    this.#disposed = true
    this.cancel()
    for (const source of this.sources) source.preview.dispose()
    this.#documents.dispose()
  }
}
