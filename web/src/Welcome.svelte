<!-- Owns first-visit onboarding welcome dialog and first-action page flight hint. -->

<script lang="ts">
  import { tick, untrack } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import Icon from "./Icon.svelte"

  let {
    id,
    guidance,
    hasInput,
    hasOutput,
    touring,
    helpOpen,
    onStartTour,
    hint,
  }: {
    id: string
    guidance: boolean
    hasInput: boolean
    hasOutput: boolean
    touring: boolean
    helpOpen: () => boolean
    onStartTour: () => void
    hint: (show: boolean) => void
  } = $props()

  const motion = new MediaQuery("(prefers-reduced-motion: no-preference)")
  let welcome: HTMLDialogElement
  let flight: HTMLCanvasElement
  let welcomed = false
  let hinted = $state(false)
  let hintShown = $state(false)
  let flying = $state(false)
  let hintObserver: IntersectionObserver | undefined
  let hintReady: MutationObserver | undefined
  let animation: Animation | undefined
  let focus = $state({ x: 0, y: 0, width: 0, height: 0 })

  function remember() {
    try {
      localStorage.setItem("mainz:onboarding", "19")
    } catch {
      /* Storage can be unavailable. */
    }
  }

  export function close() {
    remember()
    welcome.close()
  }

  function stopFlight() {
    animation?.cancel()
    animation = undefined
    flying = false
    if (flight?.matches(":popover-open")) flight.hidePopover()
  }

  export function stopHint() {
    hintObserver?.disconnect()
    hintReady?.disconnect()
    stopFlight()
  }

  function dismissHint() {
    stopFlight()
    hintShown = false
    hint(false)
  }

  function focusTarget(element: HTMLElement) {
    if (!element) return
    const rect = element.getBoundingClientRect()
    const left = Math.max(0, Math.min(innerWidth, rect.left - 24))
    const top = Math.max(0, Math.min(innerHeight, rect.top - 24))
    const right = Math.max(0, Math.min(innerWidth, rect.right + 24))
    const bottom = Math.max(0, Math.min(innerHeight, rect.bottom + 24))
    focus = {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    }
  }

  export async function suggest() {
    await tick()
    if (hinted || !guidance || !hasInput || hasOutput || welcome.open || helpOpen() || touring) return
    const page = document.querySelector<HTMLCanvasElement>('[data-tour-target="first-page"] .thumbnail canvas')
    if (!page) return
    stopHint()
    let visible = false
    async function show() {
      if (
        !page ||
        !visible ||
        hinted ||
        !guidance ||
        hasOutput ||
        welcome.open ||
        helpOpen() ||
        touring ||
        page.parentElement?.getAttribute("aria-busy") !== "false"
      )
        return
      hinted = true
      stopHint()
      hintShown = true
      hint(true)
      await tick()
      if (!page.isConnected || hasOutput || !guidance || helpOpen() || touring) return
      if (!motion.current) return
      const destination = [
        ...document.querySelectorAll<HTMLElement>(".mobile-workspace-tabs button:last-child, .composition-empty"),
      ].find((element) => element.getBoundingClientRect().width > 0)
      if (!destination) return
      const origin = page.getBoundingClientRect(),
        end = destination.getBoundingClientRect()
      const x =
        Math.max(origin.width / 2 + 8, Math.min(innerWidth - origin.width / 2 - 8, end.left + end.width / 2)) -
        origin.left -
        origin.width / 2
      const y =
        Math.max(origin.height / 2 + 8, Math.min(innerHeight - origin.height / 2 - 8, end.top + end.height / 2)) -
        origin.top -
        origin.height / 2
      flight.width = page.width
      flight.height = page.height
      flight.getContext("2d")?.drawImage(page, 0, 0)
      flight.style.insetInlineStart = `${origin.left}px`
      flight.style.insetBlockStart = `${origin.top}px`
      flight.style.inlineSize = `${origin.width}px`
      flight.style.blockSize = `${origin.height}px`
      const card = page.closest<HTMLElement>('[data-tour-target="first-page"]') ?? page
      focusTarget(card)
      flight.showPopover()
      flying = true
      animation = flight.animate(
        [
          { opacity: 0, transform: "translate(0, 0) scale(1) rotate(0deg)", offset: 0 },
          { opacity: 0.9, transform: "translate(0, 0) scale(1) rotate(0deg)", offset: 0.12 },
          {
            opacity: 0.85,
            transform: `translate(${x * 0.55}px, ${y * 0.55}px) scale(0.9) rotate(4deg)`,
            offset: 0.55,
          },
          {
            opacity: 0.3,
            transform: `translate(${x * 0.9}px, ${y * 0.9}px) scale(0.65) rotate(2deg)`,
            offset: 0.82,
          },
          {
            opacity: 0,
            transform: `translate(${x}px, ${y}px) scale(0.45) rotate(0deg)`,
            offset: 1,
          },
        ],
        { delay: 2600, duration: 4200, easing: "ease-in-out", fill: "both" },
      )
      animation.onfinish = stopFlight
    }
    hintObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.25
        void show()
      },
      { threshold: 0.25 },
    )
    hintReady = new MutationObserver(() => void show())
    hintReady.observe(page.parentElement!, { attributes: true, attributeFilter: ["aria-busy"] })
    hintObserver.observe(page)
  }

  $effect(() => {
    if (hasOutput) hinted = true
    if (hasOutput || !guidance) {
      stopHint()
      hintShown = false
      untrack(() => hint(false))
    }
    return stopHint
  })
  $effect(() => {
    if (!motion.current) stopFlight()
  })
  $effect(() => {
    if (!guidance || !hasInput || welcomed) return
    welcomed = true
    try {
      if (localStorage.getItem("mainz:onboarding") === "19") {
        void suggest()
        return
      }
    } catch {
      /* Show the welcome when storage is unavailable. */
    }
    welcome.showModal()
    welcome.querySelector<HTMLButtonElement>(".primary")?.focus()
  })
  function suggestOnClick() {
    void suggest()
  }
  $effect(() => {
    if ((!guidance || !hasInput || hasOutput || hinted) && !flying && !hintShown) return
    const onKeydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && flight?.matches(":popover-open")) stopFlight()
    }
    window.addEventListener("resize", stopFlight)
    window.addEventListener("keydown", onKeydown)
    document.addEventListener("scroll", stopFlight, true)
    document.addEventListener("click", dismissHint, true)
    document.addEventListener("click", suggestOnClick)
    return () => {
      window.removeEventListener("resize", stopFlight)
      window.removeEventListener("keydown", onKeydown)
      document.removeEventListener("scroll", stopFlight, true)
      document.removeEventListener("click", dismissHint, true)
      document.removeEventListener("click", suggestOnClick)
    }
  })
</script>

<dialog
  bind:this={welcome}
  class="welcome-dialog"
  aria-labelledby={`${id}-welcome-title`}
  onclose={() => {
    remember()
    void suggest()
  }}
>
  <div class="dialog-heading">
    <h2 id={`${id}-welcome-title`}>Welcome to PDF Composer</h2>
    <button class="icon-button" aria-label="Close welcome" onclick={close}><Icon name="close" /></button>
  </div>
  <p>Make a PDF with the pages and styles you need.</p>
  <ol class="welcome-steps">
    <li>
      <Icon name="input" /><span><strong>Open your PDFs</strong><span>Your files stay on this device.</span></span>
    </li>
    <li>
      <Icon name="grid" /><span><strong>Build your Output</strong><span>Choose, repeat, and arrange pages.</span></span>
    </li>
    <li>
      <Icon name="down" /><span
        ><strong>Check and save</strong><span>Preview the result, then download or share your PDF.</span></span
      >
    </li>
  </ol>
  <div class="help-actions">
    <button onclick={onStartTour}>Take a tour</button>
    <button class="primary" onclick={close}>Skip</button>
  </div>
</dialog>

<canvas
  bind:this={flight}
  class="page-flight"
  popover="manual"
  aria-hidden="true"
  style:--focus-x={`${focus.x}px`}
  style:--focus-y={`${focus.y}px`}
  style:--focus-width={`${focus.width}px`}
  style:--focus-height={`${focus.height}px`}
></canvas>
