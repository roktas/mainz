<!-- Offers one local PDF as the primary action, secondary Recipe opening, and the landing logo animation. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  import Logo, { parallax } from "./Logo.svelte"
  let {
    loading,
    updating,
    replay,
    open,
    recipe,
  }: {
    loading: boolean
    updating: boolean
    replay: number
    open: (list: FileList | File[]) => Promise<void>
    recipe: (file: File) => void
  } = $props()
  let dragging = $state(false)
  let dragDepth = 0
</script>

<svelte:window
  ondragend={() => {
    dragDepth = 0
    dragging = false
  }}
/>

<section
  class="drop-zone"
  aria-label="Open a local PDF"
  ondragenter={(event) => {
    if (!event.dataTransfer?.types.includes("Files") || loading || updating) return
    dragDepth++
    dragging = true
  }}
  ondragover={(event) => {
    event.preventDefault()
    if (event.dataTransfer)
      event.dataTransfer.dropEffect =
        event.dataTransfer.types.includes("Files") && !loading && !updating ? "copy" : "none"
  }}
  ondragleave={() => {
    dragDepth = Math.max(0, dragDepth - 1)
    dragging = dragDepth > 0
  }}
  ondrop={(event) => {
    event.preventDefault()
    dragDepth = 0
    dragging = false
    if (event.dataTransfer?.files && !loading && !updating) void open(event.dataTransfer.files)
  }}
>
  <div class="welcome">
    <p class="brand-title"><span>PDF</span> Composer</p>
    <h1>
      <span class="expanded">Select pages and style</span><span class="compact">Select &amp; style</span>
      <a href="https://github.com/roktas/mainz/blob/HEAD/lib/doc/SPEC.md#prepared-pdfs" title="About prepared PDFs"
        >prepared</a
      > PDFs.
    </h1>
    <p>Select and repeat PDF pages. Style prepared PDFs for your printer.</p>
    <div class="buttons">
      <label class="file-picker primary"
        ><Icon name="pdf" /><span>Choose a PDF</span><input
          type="file"
          accept="application/pdf,.pdf"
          disabled={loading || updating}
          onchange={(event) => {
            if (event.currentTarget.files) void open(event.currentTarget.files)
            event.currentTarget.value = ""
          }}
        /></label
      >
      <span class="landing-or">or</span>
      <label class="landing-recipe" title="Open a saved recipe"
        ><Icon name="json" /><span>Open recipe</span><input
          type="file"
          accept="application/json,.json"
          aria-label="Open recipe"
          disabled={loading || updating}
          onchange={(event) => {
            const file = event.currentTarget.files?.[0]
            if (file) recipe(file)
            event.currentTarget.value = ""
          }}
        /></label
      >
    </div>
  </div>
  {#key replay}<div class="hero-mark" {@attach parallax}><Logo /></div>{/key}
  <p class="drop-note"><Icon name="input" />Drag a PDF into this area to open it.</p>
  {#if dragging}<div class="drop-prompt" role="status">
      <Icon name="input" />
      <strong>Drop a PDF to open</strong>
      <span>Your files stay on this device.</span>
    </div>{/if}
</section>
