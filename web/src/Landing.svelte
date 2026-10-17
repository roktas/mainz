<!-- Offers local PDF opening, file drops, and the landing logo animation. -->
<script lang="ts">
  import Icon from "./Icon.svelte"
  import Logo from "./Logo.svelte"
  let {
    loading,
    updating,
    status,
    replay,
    cancel,
    open,
  }: {
    loading: boolean
    updating: boolean
    status: string
    replay: number
    cancel: () => void
    open: (list: FileList | File[]) => Promise<void>
  } = $props()
  let dragging = $state(false)
  let dragDepth = 0
  function parallax(element: HTMLDivElement) {
    const zone = element.parentElement!
    const events = new AbortController()
    const { signal } = events
    const motion = matchMedia("(prefers-reduced-motion: no-preference) and (hover: hover) and (pointer: fine)")
    let entered = false
    const reset = () => {
      element.style.removeProperty("--logo-x")
      element.style.removeProperty("--logo-y")
    }
    element.addEventListener(
      "animationstart",
      () => {
        entered = false
        reset()
      },
      { signal },
    )
    element.addEventListener(
      "animationend",
      () => {
        entered = true
      },
      { signal },
    )
    zone.addEventListener(
      "pointermove",
      (event) => {
        if (!entered || !motion.matches || event.pointerType !== "mouse") return
        const bounds = zone.getBoundingClientRect()
        const x = Math.max(-1, Math.min(1, (2 * (event.clientX - bounds.left)) / bounds.width - 1))
        const y = Math.max(-1, Math.min(1, (2 * (event.clientY - bounds.top)) / bounds.height - 1))
        element.style.setProperty("--logo-x", `${x}`)
        element.style.setProperty("--logo-y", `${y}`)
      },
      { signal, passive: true },
    )
    zone.addEventListener("pointerleave", reset, { signal })
    motion.addEventListener("change", reset, { signal })
    return () => events.abort()
  }
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
    <p>
      Choose, repeat, and style pages for your printer.
      <span class="ordinary">Ordinary PDFs also support page selection and repetition.</span>
    </p>
    <div class="buttons">
      <div class="file-action">
        <label class="file-picker primary" aria-hidden={loading}
          >Choose a PDF<input
            type="file"
            accept="application/pdf,.pdf"
            multiple
            disabled={loading || updating}
            onchange={(event) => {
              if (event.currentTarget.files) void open(event.currentTarget.files)
              event.currentTarget.value = ""
            }}
          /></label
        >
        <button class="file-picker primary" aria-hidden={!loading} disabled={!loading} onclick={cancel}>Cancel</button>
      </div>
      {#if loading}<span role="status">{status}</span>{/if}
    </div>
  </div>
  {#key replay}<div class="hero-mark" {@attach parallax}><Logo /></div>{/key}
  <p class="drop-note"><Icon name="input" />Drag PDFs into this area to open them.</p>
  {#if dragging}<div class="drop-prompt" role="status">
      <Icon name="input" />
      <strong>Drop PDFs to open</strong>
      <span>Your files stay on this device.</span>
    </div>{/if}
</section>
