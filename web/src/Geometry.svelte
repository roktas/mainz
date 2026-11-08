<!-- Exports fixture-only geometry samples from real development browsers. -->

<script lang="ts">
  import { capture, csv, stable, view } from "./geometry.ts"
  import type { Geometry } from "./geometry.ts"
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"
  import Feedback from "./Feedback.svelte"

  let dialog: HTMLDialogElement
  let chooser: HTMLDetailsElement
  let sample = $state<Geometry>()
  let source = $state("unknown")
  let device = $state("")
  let osVersion = $state("")
  let busy = $state(false)
  let message = $state("")
  let failed = $state(false)
  let fullscreen = $state(false)
  function close() {
    dialog.close()
    ;[...document.querySelectorAll(".grid-view")]
      .find((element) => element.checkVisibility())
      ?.scrollIntoView({ block: "start", behavior: "instant" })
  }
  async function show(name: "Input" | "Output") {
    failed = false
    busy = true
    chooser.open = false
    dialog.close()
    try {
      await view(name)
      close()
    } catch (reason) {
      failed = true
      message = reason instanceof Error ? reason.message : "Grid view is unavailable."
      dialog.showModal()
    } finally {
      busy = false
    }
  }
  async function open() {
    failed = false
    busy = true
    try {
      await stable()
      message = "Grid ready."
    } catch (reason) {
      failed = true
      message = reason instanceof Error ? reason.message : "Grid geometry is unavailable."
    } finally {
      fullscreen = !!document.fullscreenElement
      busy = false
      dialog.showModal()
    }
  }
  async function toggleFullscreen() {
    failed = false
    dialog.close()
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (reason) {
      failed = true
      message = reason instanceof Error ? reason.message : "Fullscreen is unavailable."
      dialog.showModal()
    }
  }
  async function collect() {
    failed = false
    busy = true
    sample = undefined
    message = ""
    dialog.close()
    try {
      const measured = await capture()
      measured.environment.source = source
      measured.environment.device = device || null
      measured.environment.osVersion = osVersion || null
      measured.provenance.evidenceClass =
        source === "simulator" ? "ios-simulator-ui" : source === "physical" ? "physical-browser-ui" : "unknown"
      measured.provenance.revision = import.meta.env.BUILD_REVISION || null
      sample = measured
      message = "Captured Input and Output."
    } catch (reason) {
      failed = true
      message = reason instanceof Error ? reason.message : "Geometry capture failed."
    } finally {
      busy = false
      dialog.showModal()
    }
  }
  function download(kind: "json" | "csv") {
    if (!sample) return
    const url = URL.createObjectURL(
      new Blob([kind === "json" ? JSON.stringify(sample, null, 2) : csv(sample)], {
        type: kind === "json" ? "application/json" : "text/csv;charset=utf-8",
      }),
    )
    const link = document.createElement("a")
    link.href = url
    link.download = `geometry.${kind}`
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }
  async function copy() {
    failed = false
    if (!sample) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(sample, null, 2))
      message = "Geometry copied."
    } catch {
      failed = true
      message = "Clipboard unavailable. Use Save JSON."
    }
  }
</script>

<button class="geometry-launcher" data-geometry disabled={busy} onclick={open}>Geometry</button>
<dialog
  bind:this={dialog}
  class="geometry-dialog"
  data-geometry
  aria-labelledby="geometry-title"
  closedby="any"
  {@attach dismiss}
>
  <div class="dialog-heading">
    <h2 id="geometry-title">Grid geometry</h2>
    <button class="icon-button" aria-label="Close geometry" onclick={close}><Icon name="close" /></button>
  </div>
  <Feedback
    header
    kind={failed ? "error" : "notice"}
    text={message}
    summary={failed ? "Geometry unavailable." : undefined}
  />
  <details bind:this={chooser}>
    <summary>Grid views</summary>
    {#each ["Input", "Output"] as const as name (name)}
      <fieldset>
        <legend>{name}</legend>
        <div class="geometry-actions">
          <button aria-label={`Show ${name} Grid`} onclick={() => show(name)}>Grid</button>
        </div>
      </fieldset>
    {/each}
  </details>
  <div class="geometry-actions">
    <button onclick={() => location.reload()}>Reload</button>
    <button onclick={collect} disabled={busy}>Capture</button>
    {#if document.fullscreenEnabled}<button onclick={toggleFullscreen}>{fullscreen ? "Windowed" : "Fullscreen"}</button
      >{/if}
  </div>
  {#if sample}<div class="geometry-actions">
      <button onclick={() => download("json")}>Save JSON</button><button onclick={() => download("csv")}
        >Save CSV</button
      ><button onclick={copy}>Copy JSON</button>
    </div>
    <p>{sample.viewport.inner.join(" × ")} CSS px · {sample.environment.presentationMode}</p>{/if}
  <p>Measures the local 240-page fixture. No PDF content is exported.</p>
  <label
    >Evidence source<select bind:value={source}
      ><option value="unknown">Unknown</option><option value="simulator">iOS Simulator</option><option value="physical"
        >Physical browser</option
      ></select
    ></label
  >
  <label>Device or environment<input bind:value={device} placeholder="Optional known model" /></label>
  <label>OS version<input bind:value={osVersion} placeholder="Unknown unless recorded" /></label>
</dialog>

<style>
  .geometry-launcher {
    position: fixed;
    inset-block-end: max(var(--gap), env(safe-area-inset-bottom, 0px));
    inset-inline-end: max(var(--gap), env(safe-area-inset-right, 0px));
    z-index: 10;
  }
  .geometry-dialog {
    inline-size: min(30rem, calc(100vi - 2 * var(--gap)));
  }
  .dialog-heading {
    align-items: center;
  }
  label {
    display: grid;
    gap: calc(var(--gap) / 2);
    margin-block: var(--gap);
  }
  .geometry-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, var(--action-width)), 1fr));
    gap: var(--gap);
    margin-block: var(--gap);
  }
  fieldset {
    min-inline-size: 0;
    margin: 0;
    padding: 0;
    border: 0;
  }
  legend {
    padding: 0;
    font-weight: 600;
  }
</style>
