<!-- Owns the themed logo artwork and its shared entry/parallax interaction. -->

<script module lang="ts">
  export function parallax(element: HTMLDivElement) {
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

<script lang="ts">
  import svg from "../public/logo.svg?raw"

  const id = $props.id()
  // Use the page palette instead of cached SVG document styles.
  const logo = svg
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace("<svg ", '<svg class="logo" aria-hidden="true" ')
    .replaceAll('id="', `id="${id}-`)
    .replaceAll('href="#', `href="#${id}-`)
</script>

{@html logo}
