<!-- Prepares validated Output PDFs for download or print, with cancellation and shared progress feedback. -->

<script module lang="ts">
  import type { Input, Job } from "./model.ts"
  export type Prepared = { bytes: ArrayBuffer; name: string; expected: number; complete: () => void }
  export type Snapshot = {
    recipe: Job
    inputs: Input[]
    expected: number
    prepared?: ArrayBuffer
    name: () => string
    complete: () => void
  }
</script>

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { PDFDocumentLoadingTask } from "pdfjs-dist"
  import { Processor } from "./processor.ts"
  import { openPDF, verifyPDF } from "./pdf.ts"
  import Feedback from "./Feedback.svelte"

  let {
    prepare,
    blocked,
    info,
    print,
  }: {
    prepare: () => Snapshot
    blocked: boolean
    info: (text: string) => void
    print: (pdf: Prepared) => void
  } = $props()
  let action = $state<"Download" | "Print">("Download")
  let dialog: HTMLDialogElement
  let failure = $state("")
  let running = $state(false)
  let stage = $state("")
  let processor: Processor | undefined
  let revision = 0
  let task: PDFDocumentLoadingTask | undefined
  let url: string | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  function release() {
    clearTimeout(timer)
    if (url) URL.revokeObjectURL(url)
    url = undefined
  }
  function cancel() {
    if (running) {
      revision++
      processor?.dispose()
      processor = undefined
      void task?.destroy()
      task = undefined
      running = false
      info(`${action} cancelled. Your pages and styles are retained.`)
    }
    dialog.close()
  }
  export async function start(next: "Download" | "Print" = "Download") {
    if (running || blocked) return
    action = next
    const generation = ++revision
    const worker = new Processor()
    failure = ""
    let loadingTask: PDFDocumentLoadingTask | undefined
    try {
      const snapshot = prepare()
      const { recipe, inputs, expected } = snapshot
      running = true
      let bytes = snapshot.prepared
      if (!bytes) {
        stage = "Preparing PDF…"
        if (!dialog.open) dialog.showModal()
        processor = worker
        const result = await worker.compose(recipe, inputs, generation)
        if (disposed || generation !== revision) return
        if (result.description.pageCount !== expected || result.report?.pages.length !== expected)
          throw new Error("The completed PDF does not match the Output page count.")
        stage = "Checking PDF…"
        loadingTask = await openPDF(new Uint8Array(result.bytes))
        if (disposed || generation !== revision) return
        task = loadingTask
        const pdf = await loadingTask.promise
        if (pdf.numPages !== expected)
          throw new Error("The completed PDF could not be inspected with the expected page count.")
        await verifyPDF(pdf)
        if (disposed || generation !== revision) return
        bytes = result.bytes
      }
      dialog.close()
      if (action === "Print") {
        print({ bytes, name: snapshot.name(), expected, complete: snapshot.complete })
        return
      }
      release()
      url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
      const link = document.createElement("a")
      link.href = url
      link.download = snapshot.name()
      link.click()
      timer = setTimeout(release, 30000)
      snapshot.complete()
      info(`Downloaded ${expected} ${expected === 1 ? "page" : "pages"} · ${link.download}.`)
      dialog.close()
    } catch (reason) {
      if (!disposed && generation === revision) {
        failure = reason instanceof Error ? reason.message : "Output processing failed."
        info("")
        if (!dialog.open) dialog.showModal()
      }
    } finally {
      void loadingTask?.destroy()
      worker.dispose()
      if (generation === revision) {
        running = false
        processor = undefined
        task = undefined
      }
    }
  }
  onDestroy(() => {
    disposed = true
    revision++
    processor?.dispose()
    void task?.destroy()
    release()
  })
</script>

<dialog
  bind:this={dialog}
  class="output-dialog export-dialog"
  aria-label={action}
  oncancel={(event) => {
    event.preventDefault()
    cancel()
  }}
>
  <Feedback kind={running ? "progress" : "error"} text={running ? stage : failure}>
    {#snippet actions()}
      <button onclick={cancel}>Cancel</button>
      {#if !running}<button class="primary" disabled={blocked} onclick={() => start(action)}>Retry</button>{/if}
    {/snippet}
  </Feedback>
</dialog>
