<!-- Exports fixture-only geometry samples from real development browsers. -->

<script lang="ts">
  import { capture, csv, stable, view } from "./geometry.ts"
  import type { Geometry } from "./geometry.ts"
  import { search } from "../test/calibration.ts"
  import type { Calibration } from "../test/calibration.ts"
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"

  let dialog: HTMLDialogElement
  let chooser: HTMLDetailsElement
  let sample = $state<Geometry>()
  let report = $state<Calibration>()
  let preview = $state<HTMLStyleElement>()
  let source = $state("unknown")
  let device = $state("")
  let osVersion = $state("")
  let busy = $state(false)
  let message = $state("")
  let fullscreen = $state(false)
  function close() {
    dialog.close()
    ;[...document.querySelectorAll(".grid-view")]
      .find((element) => element.checkVisibility())
      ?.scrollIntoView({ block: "start", behavior: "instant" })
  }
  async function show(name: "Input" | "Output", compact: boolean) {
    busy = true
    chooser.open = false
    dialog.close()
    try {
      await view(name, compact)
      close()
    } catch (reason) {
      message = reason instanceof Error ? reason.message : "Grid view is unavailable."
      dialog.showModal()
    } finally {
      busy = false
    }
  }
  async function open() {
    busy = true
    try {
      await stable()
      message = "Grid ready."
    } catch (reason) {
      message = reason instanceof Error ? reason.message : "Grid geometry is unavailable."
    } finally {
      fullscreen = !!document.fullscreenElement
      busy = false
      dialog.showModal()
    }
  }
  async function toggleFullscreen() {
    dialog.close()
    try {
      if (document.fullscreenElement) await document.exitFullscreen()
      else await document.documentElement.requestFullscreen()
    } catch (reason) {
      message = reason instanceof Error ? reason.message : "Fullscreen is unavailable."
      open()
    }
  }
  async function collect() {
    busy = true
    sample = undefined
    report = undefined
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
      message = reason instanceof Error ? reason.message : "Geometry capture failed."
    } finally {
      busy = false
      dialog.showModal()
    }
  }
  async function calibrate() {
    busy = true
    sample = undefined
    report = undefined
    message = ""
    preview?.remove()
    dialog.close()
    const style = document.createElement("style")
    document.head.append(style)
    try {
      report = await search(capture, (css) => {
        style.textContent = css
      })
      sample = report.baseline
      message = `Searched ${report.candidates.length} candidates.`
    } catch (reason) {
      message = reason instanceof Error ? reason.message : "Candidate search failed."
    } finally {
      style.remove()
      busy = false
      dialog.showModal()
    }
  }
  function inspect() {
    const candidate = report?.candidates.find((item) => item.name === report?.recommendation)
    if (!candidate) return
    preview?.remove()
    preview = document.createElement("style")
    preview.textContent = candidate.css
    document.head.append(preview)
    dialog.close()
  }
  function download(kind: "json" | "csv") {
    if (!sample) return
    const url = URL.createObjectURL(
      new Blob([kind === "json" ? JSON.stringify(report ?? sample, null, 2) : csv(sample)], {
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
    if (!sample) return
    try {
      await navigator.clipboard.writeText(JSON.stringify(report ?? sample, null, 2))
      message = "Geometry copied."
    } catch {
      message = "Clipboard unavailable. Use Export JSON."
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
  <p role="status">{message}</p>
  <details bind:this={chooser}>
    <summary>Grid views</summary>
    <div class="geometry-actions">
      {#each ["Input", "Output"] as const as name (name)}
        {#each [false, true] as compact (compact)}
          <button aria-label={`Show ${name} ${compact ? "Compact" : "Normal"}`} onclick={() => show(name, compact)}
            >{name} · {compact ? "Compact" : "Normal"}</button
          >
        {/each}
      {/each}
    </div>
  </details>
  <div class="geometry-actions">
    <button onclick={() => location.reload()}>Reload fixture</button>
    <button onclick={collect} disabled={busy}>Capture all views</button>
    <button onclick={calibrate} disabled={busy}>Search candidates</button>
    {#if document.fullscreenEnabled}<button onclick={toggleFullscreen}
        >{fullscreen ? "Exit browser fullscreen" : "Enter browser fullscreen"}</button
      >{/if}
    {#if report?.recommendation}<button onclick={inspect}>Preview candidate</button>{/if}
    {#if preview}<button
        onclick={() => {
          preview?.remove()
          preview = undefined
          dialog.close()
        }}>Restore baseline</button
      >{/if}
  </div>
  {#if sample}<div class="geometry-actions">
      <button onclick={() => download("json")}>Export JSON</button><button onclick={() => download("csv")}
        >Export CSV</button
      ><button onclick={copy}>Copy JSON</button>
    </div>
    <p>{sample.viewport.inner.join(" × ")} CSS px · {sample.environment.presentationMode}</p>{/if}
  {#if report}<p>{report.decision}</p>{/if}
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
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap);
    margin-block: var(--gap);
  }
</style>
