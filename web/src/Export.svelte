<!-- Prepares validated Output PDFs for printing, viewing, downloading, and sharing with cancellation and progress. -->

<script module lang="ts">
  import type { Input, Plan } from "./model.ts"
  export type Prepared = { bytes: ArrayBuffer; name: string; expected: number; complete: () => void }
  export type Snapshot = {
    plan: Plan
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
  import { Download } from "./download.ts"
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
  const saved = new Download()
  let viewURL = $state<string>()
  let disposed = false
  let reserved: Window | undefined
  let viewReady = $state(false)
  let ready = $state.raw<{ file: File; expected: number; complete: () => void }>()
  const standalone =
    matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  export const sharing =
    (/Android|iPhone|iPad|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 0)) &&
    typeof navigator.share === "function" &&
    typeof navigator.canShare === "function"
  let shareReady = $derived(action === "Download" && sharing && !!ready && !running && !failure)
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
  function download() {
    const pdf = ready
    if (!pdf) return
    saved.save(pdf.file, pdf.file.name)
    pdf.complete()
    ready = undefined
    info(`Downloaded ${pdf.expected} ${pdf.expected === 1 ? "page" : "pages"} · ${pdf.file.name}.`)
    dialog.close()
  }
  async function share() {
    const pdf = ready
    if (!pdf) return
    const generation = revision
    running = true
    dialog.close()
    try {
      if (!navigator.canShare({ files: [pdf.file] })) throw new Error("This PDF cannot be shared. Use Download.")
      await navigator.share({ files: [pdf.file] })
      if (disposed || generation !== revision) return
      pdf.complete()
      ready = undefined
      info(`Shared ${pdf.expected} ${pdf.expected === 1 ? "page" : "pages"} · ${pdf.file.name}.`)
    } catch (reason) {
      if (disposed || generation !== revision) return
      if (reason instanceof DOMException && reason.name === "AbortError") {
        ready = undefined
        info("Share cancelled. Your pages and styles are retained.")
        return
      }
      failure =
        reason instanceof DOMException && reason.name === "NotAllowedError"
          ? ""
          : reason instanceof Error
            ? reason.message
            : "PDF sharing failed."
      info("")
      dialog.showModal()
    } finally {
      if (generation === revision) running = false
    }
  }
  export function cancel() {
    ready = undefined
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
      info(`${action === "Download" && sharing ? "Share" : action} cancelled. Your pages and styles are retained.`)
    }
    dialog.close()
  }
  export async function start(next: "Download" | "Print" | "View" = "Download") {
    if (running || blocked) return
    action = next
    viewReady = false
    ready = undefined
    const generation = ++revision
    const worker = new Processor()
    failure = ""
    let loadingTask: PDFDocumentLoadingTask | undefined
    try {
      const snapshot = prepare()
      const { plan, inputs, expected } = snapshot
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
        const result = await worker.compose(plan, inputs, generation)
        if (disposed || generation !== revision) return
        if (result.description.pageCount !== expected || result.provenance?.pages.length !== expected)
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
      ready = {
        file: new File([bytes], snapshot.name(), { type: "application/pdf" }),
        expected,
        complete: snapshot.complete,
      }
      bytes = undefined
      if (sharing) {
        worker.dispose()
        processor = undefined
        void loadingTask?.destroy()
        loadingTask = undefined
        task = undefined
        await share()
      } else download()
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
    ready = undefined
    processor?.dispose()
    void task?.destroy()
    saved.dispose()
    if (viewURL) URL.revokeObjectURL(viewURL)
    reserved?.close()
  })
</script>

<dialog
  bind:this={dialog}
  class="output-dialog export-dialog"
  aria-label={action === "Download" && sharing ? "Share" : action}
  oncancel={(event) => {
    event.preventDefault()
    cancel()
  }}
>
  <Feedback
    kind={running ? "progress" : failure ? "error" : "notice"}
    text={running ? stage : failure || "PDF ready to share."}
  >
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
          aria-label={shareReady ? "Share" : "Retry"}
          title={shareReady ? "Share" : "Retry"}
          disabled={blocked}
          onclick={() => {
            if (action === "Download" && sharing && ready) void share()
            else if (action === "View" && viewReady) {
              try {
                view()
              } catch (reason) {
                failure = reason instanceof Error ? reason.message : "PDF viewing failed."
              }
            } else void start(action)
          }}><Icon name={shareReady ? "share" : "reset"} /><span>{shareReady ? "Share" : "Retry"}</span></button
        >{/if}
      {#if !running && action === "Download" && sharing && ready}<button
          aria-label="Download"
          title="Download"
          disabled={blocked}
          onclick={download}><Icon name="down" /><span>Download</span></button
        >{/if}
    {/snippet}
  </Feedback>
</dialog>
