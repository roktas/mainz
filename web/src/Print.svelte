<!-- Hands completed Output PDF bytes to native PDF printing and owns the viewer's temporary resources. -->

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { Prepared } from "./Export.svelte"
  import Icon from "./Icon.svelte"
  let { info }: { info: (text: string) => void } = $props()
  let dialog: HTMLDialogElement
  let frame = $state<HTMLIFrameElement>()
  let pdf = $state.raw<Prepared>()
  let url = $state("")
  // shortcut: embedded printing is limited to non-Apple desktop viewers; expand after native browser acceptance.
  const direct =
    navigator.pdfViewerEnabled && !navigator.vendor.includes("Apple") && !matchMedia("(pointer: coarse)").matches
  function release() {
    if (url) URL.revokeObjectURL(url)
    url = ""
  }
  export function show(prepared: Prepared) {
    release()
    pdf = prepared
    url = URL.createObjectURL(new Blob([prepared.bytes], { type: "application/pdf" }))
    if (!direct) dialog.showModal()
  }
  function print() {
    if (!pdf || !direct || !frame || !url) return
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

{#if direct && url}
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
    <p>Open the prepared PDF in your browser or PDF app, then choose Print.</p>
    <div class="print-actions">
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
