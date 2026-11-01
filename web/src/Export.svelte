<!-- Prepares validated Output PDFs for printing, viewing, and downloading with shared cancellation and progress. -->

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
  import Icon from "./Icon.svelte"

  let {
    prepare,
    blocked,
    info,
    print,
    progress = $bindable(""),
  }: {
    prepare: () => Snapshot
    blocked: boolean
    info: (text: string) => void
    print: (pdf: Prepared, viewer?: Window) => void
    progress?: string
  } = $props()
  let action = $state<"Download" | "Print" | "View">("Download")
  let dialog: HTMLDialogElement
  let failure = $state("")
  let running = $state(false)
  let stage = $state("")
  let processor: Processor | undefined
  let revision = 0
  let task: PDFDocumentLoadingTask | undefined
  let url: string | undefined
  let viewURL = $state<string>()
  let timer: ReturnType<typeof setTimeout> | undefined
  let disposed = false
  let reserved: Window | undefined
  let viewReady = $state(false)
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  function view() {
    if (!viewURL) return
    if (standalone) {
      const viewer = reserved
      if (!viewer || viewer.closed) return
      viewer.location.replace(viewURL)
      viewer.opener = null
      reserved = undefined
      dialog.close()
      return
    }
    if (/CriOS\//.test(navigator.userAgent)) {
      const link = document.createElement("a")
      link.href = viewURL
      link.target = "_blank"
      link.rel = "noopener"
      document.body.append(link)
      link.click()
      link.remove()
      dialog.close()
      return
    }
    const viewer = window.open(viewURL, "_blank")
    if (!viewer) throw new Error("Allow popups to view PDF.")
    viewer.opener = null
    dialog.close()
  }
  function release() {
    clearTimeout(timer)
    if (url) URL.revokeObjectURL(url)
    url = undefined
  }
  export function cancel() {
    if (running) {
      revision++
      processor?.dispose()
      processor = undefined
      void task?.destroy()
      task = undefined
      running = false
      progress = ""
      reserved?.close()
      reserved = undefined
      info(`${action} cancelled. Your pages and styles are retained.`)
    }
    dialog.close()
  }
  export async function start(next: "Download" | "Print" | "View" = "Download") {
    if (running || blocked) return
    action = next
    viewReady = false
    const generation = ++revision
    const worker = new Processor()
    failure = ""
    let loadingTask: PDFDocumentLoadingTask | undefined
    try {
      const snapshot = prepare()
      const { recipe, inputs, expected } = snapshot
      running = true
      if (
        (action === "Print" && navigator.pdfViewerEnabled && navigator.vendor.includes("Apple")) ||
        (action === "View" && standalone)
      ) {
        // Home Screen Safari needs the viewer window reserved during the tap.
        reserved = window.open("", "_blank") ?? undefined
        if (!reserved) throw new Error(`Allow popups to ${action.toLowerCase()} PDF.`)
        reserved.document.title = `${action} Output`
      }
      let bytes = snapshot.prepared
      if (!bytes) {
        stage = "Preparing PDF…"
        if (action === "View") progress = stage
        else if (!dialog.open) dialog.showModal()
        processor = worker
        const result = await worker.compose(recipe, inputs, generation)
        if (disposed || generation !== revision) return
        if (result.description.pageCount !== expected || result.report?.pages.length !== expected)
          throw new Error("The completed PDF does not match the Output page count.")
        stage = "Checking PDF…"
        if (action === "View") progress = stage
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
      if (action === "View") {
        if (viewURL) URL.revokeObjectURL(viewURL)
        viewURL = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }))
        viewReady = true
        view()
        return
      }
      if (action === "Print") {
        print({ bytes, name: snapshot.name(), expected, complete: snapshot.complete }, reserved)
        reserved = undefined
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
        reserved?.close()
        reserved = undefined
        failure = reason instanceof Error ? reason.message : "Output processing failed."
        info("")
        if (!dialog.open) dialog.showModal()
      }
    } finally {
      void loadingTask?.destroy()
      worker.dispose()
      if (generation === revision) {
        progress = ""
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
    if (viewURL) URL.revokeObjectURL(viewURL)
    reserved?.close()
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
      <button aria-label="Cancel" title="Cancel" onclick={cancel}><Icon name="close" /><span>Cancel</span></button>
      {#if !running && viewReady && standalone}<a
          class="primary"
          href={viewURL}
          target="_blank"
          rel="noopener"
          aria-label="Retry"
          title="Retry"
          onclick={() => dialog.close()}><Icon name="reset" /><span>Retry</span></a
        >{:else if !running}<button
          class="primary"
          aria-label="Retry"
          title="Retry"
          disabled={blocked}
          onclick={() => {
            if (action === "View" && viewReady) {
              try {
                view()
              } catch (reason) {
                failure = reason instanceof Error ? reason.message : "PDF viewing failed."
              }
            } else void start(action)
          }}><Icon name="reset" /><span>Retry</span></button
        >{/if}
    {/snippet}
  </Feedback>
</dialog>
