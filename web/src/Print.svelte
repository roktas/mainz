<!-- Hands completed Output PDFs to native printing or sharing and owns temporary viewer resources. -->

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { Prepared } from "./Export.svelte"
  import Icon from "./Icon.svelte"
  import Feedback from "./Feedback.svelte"
  let { info }: { info: (text: string) => void } = $props()
  let dialog: HTMLDialogElement
  let frame = $state<HTMLIFrameElement>()
  let pdf = $state.raw<Prepared>()
  let url = $state("")
  let timer: ReturnType<typeof setInterval> | undefined
  const direct = navigator.pdfViewerEnabled
  const separate = navigator.vendor.includes("Apple")
  const phoneApp =
    /iPhone/.test(navigator.userAgent) &&
    (matchMedia("(display-mode: standalone)").matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true)
  const file = $derived(phoneApp && pdf ? new File([pdf.bytes], pdf.name, { type: "application/pdf" }) : undefined)
  const shareable = $derived(
    !!file && typeof navigator.share === "function" && !!navigator.canShare?.({ files: [file] }),
  )
  let sharing = $state(false)
  let failure = $state("")
  function release() {
    clearInterval(timer)
    pdf = undefined
    failure = ""
    if (url) URL.revokeObjectURL(url)
    url = ""
  }
  export function show(prepared: Prepared, viewer?: Window) {
    release()
    if (viewer?.closed) return
    pdf = prepared
    url = URL.createObjectURL(new Blob([prepared.bytes], { type: "application/pdf" }))
    if (!direct || phoneApp) dialog.showModal()
    else if (separate) open(viewer)
  }
  function open(reserved?: Window) {
    const viewer = reserved ?? window.open(url, "_blank")
    if (!viewer) {
      dialog.showModal()
      return
    }
    if (reserved) viewer.location.replace(url)
    let attempts = 0
    timer = setInterval(() => {
      if (viewer.closed || ++attempts > 40) {
        clearInterval(timer)
        if (viewer.closed) pdf = undefined
        else dialog.showModal()
        return
      }
      try {
        if (viewer.document.contentType !== "application/pdf" || viewer.document.readyState !== "complete") return
        clearInterval(timer)
        viewer.document.title = pdf!.name
        viewer.focus()
        viewer.print()
        pdf = undefined
      } catch {
        clearInterval(timer)
        dialog.showModal()
      }
    }, 250)
  }
  async function share() {
    if (!file || sharing) return
    sharing = true
    failure = ""
    try {
      await navigator.share({ files: [file] })
    } catch (reason) {
      if (!(reason instanceof DOMException && reason.name === "AbortError"))
        failure = "Could not open the print menu. Open or download the PDF to print it."
    } finally {
      sharing = false
    }
  }
  function print() {
    if (!pdf || !frame || !url) return
    try {
      const viewer = frame.contentWindow
      if (!viewer || viewer.location.href !== url) return
      if (viewer.document.contentType !== "application/pdf") {
        dialog.showModal()
        return
      }
      viewer.document.title = pdf.name
      viewer.print()
      // PDF viewers can return before preview closes; keep one frame and URL until replacement or disposal.
      pdf = undefined
    } catch {
      dialog.showModal()
    }
  }
  onDestroy(release)
</script>

{#if direct && !separate && !phoneApp && url}
  <iframe
    bind:this={frame}
    class="print-frame"
    title="Output PDF for printing"
    src={url}
    onload={print}
    tabindex="-1"
    aria-hidden="true"
  ></iframe>
{/if}

<dialog bind:this={dialog} class="output-dialog print-dialog" aria-label="Print" onclose={() => (pdf = undefined)}>
  {#if pdf && url}
    <div class="dialog-heading">
      <h2>Print Output</h2>
      <button class="icon-button" aria-label="Close Print" title="Close" onclick={() => dialog.close()}
        ><Icon name="close" /></button
      >
    </div>
    <p class="print-name">{pdf.name}</p>
    <p>
      {phoneApp && shareable
        ? "Open the system share menu, then choose Print."
        : "Open the prepared PDF in your browser or PDF app, then choose Print."}
    </p>
    <Feedback header kind="error" text={failure} />
    <div class="print-actions">
      {#if phoneApp && shareable}<button type="button" disabled={sharing} onclick={share}>Share PDF to print</button
        >{/if}
      <a href={url} target="_blank" rel="noopener">Open PDF to print</a>
      <a
        href={url}
        download={pdf.name}
        onclick={() => {
          pdf!.complete()
          info(`Downloaded ${pdf!.expected} ${pdf!.expected === 1 ? "page" : "pages"} · ${pdf!.name}.`)
          dialog.close()
        }}>Download PDF</a
      >
    </div>
  {/if}
</dialog>
