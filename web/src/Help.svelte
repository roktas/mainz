<!-- Provides contextual help and coordinates installation, onboarding, and addition guidance. -->

<script lang="ts">
  import { tick, untrack } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"
  import Install from "./Install.svelte"
  import Tour from "./Tour.svelte"
  import type { TourStep } from "./Tour.svelte"
  import { blocked, fields } from "./keyboard.ts"

  let {
    hasInput,
    hasOutput,
    styleable,
    hasProfiles,
    views,
    onboarding = true,
    change,
    hint,
    dismissed,
  }: {
    hasInput: boolean
    hasOutput: boolean
    styleable: boolean
    hasProfiles: boolean
    views: () => { input: "grid" | "page" | "style"; output: "grid" | "page" }
    onboarding?: boolean
    change: (step?: TourStep) => void
    hint: (show: boolean) => void
    dismissed: () => void
  } = $props()
  const id = $props.id()
  const motion = new MediaQuery("(prefers-reduced-motion: no-preference)")
  const fine = new MediaQuery("(any-pointer: fine)")
  const coarse = new MediaQuery("(any-pointer: coarse)")
  type Topic = "keyboard" | "mouse" | "touch" | "app"
  const workspace = $derived(hasInput || hasOutput)
  const topics = $derived<Topic[]>([
    ...(workspace && fine.current ? (["keyboard", "mouse"] as const) : []),
    ...(workspace && coarse.current ? (["touch"] as const) : []),
    "app",
  ])
  const labels = { keyboard: "Keyboard", mouse: "Mouse", touch: "Touch", app: "App" }
  let installationPending = $state(false)
  const guidance = $derived(onboarding && !installationPending)
  let welcome: HTMLDialogElement
  let help: HTMLDialogElement
  let modes = $state<ReturnType<typeof views>>({ input: "grid", output: "grid" })
  let topic = $state<Topic>("app")
  let tour: ReturnType<typeof Tour>
  let touring = $state(false)
  let helpButton: HTMLButtonElement
  let flight: HTMLCanvasElement
  let welcomed = false
  let hinted = false
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
  function closeWelcome() {
    remember()
    welcome.close()
  }
  function stopFlight() {
    animation?.cancel()
    flight.hidePopover()
  }
  function stopHint() {
    hintObserver?.disconnect()
    hintReady?.disconnect()
    stopFlight()
  }
  function dismissHint() {
    stopFlight()
    hint(false)
  }
  async function suggest() {
    await tick()
    if (hinted || !guidance || !hasInput || hasOutput || welcome.open || help.open || touring) return
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
        help.open ||
        touring ||
        page.parentElement?.getAttribute("aria-busy") !== "false"
      )
        return
      hinted = true
      stopHint()
      hint(true)
      await tick()
      if (!page.isConnected || hasOutput || !guidance || help.open || touring) return
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
        { delay: 3800, duration: 5600, easing: "ease-in-out", fill: "both" },
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
  async function start() {
    stopHint()
    closeWelcome()
    help.close()
    await tick()
    tour.start()
  }
  function restoreTourFocus() {
    const destination = helpButton.checkVisibility()
      ? helpButton
      : document.querySelector<HTMLButtonElement>(".settings-button, .theme")
    destination?.focus()
  }
  function showHelp() {
    stopHint()
    if (touring) tour.close()
    modes = views()
    topic = topics[0]!
    help.showModal()
    document.getElementById(`${id}-help-${topic}`)?.focus()
  }
  function topicKey(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
    event.preventDefault()
    topic =
      event.key === "Home"
        ? topics[0]!
        : event.key === "End"
          ? topics.at(-1)!
          : topics[(topics.indexOf(topic) + (event.key === "ArrowRight" ? 1 : -1) + topics.length) % topics.length]!
    document.getElementById(`${id}-help-${topic}`)?.focus()
  }
  $effect(() => {
    if (!topics.includes(topic)) topic = topics[0]!
  })
  $effect(() => {
    if (hasOutput) hinted = true
    if (hasOutput || !guidance) {
      stopHint()
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
</script>

<svelte:window
  onresize={() => {
    stopFlight()
  }}
  onkeydown={(event) => {
    if (event.key === "Escape" && flight.matches(":popover-open")) stopFlight()
    if (
      event.key !== "?" ||
      event.repeat ||
      event.isComposing ||
      event.altKey ||
      event.ctrlKey ||
      event.metaKey ||
      (event.target instanceof Element && event.target.closest(fields)) ||
      blocked()
    )
      return
    event.preventDefault()
    showHelp()
  }}
/>
<svelte:document
  onscrollcapture={() => {
    stopFlight()
  }}
  onclickcapture={dismissHint}
  onclick={() => void suggest()}
/>

<button
  bind:this={helpButton}
  class="icon-button help-button"
  aria-label="Help"
  title="Help (?)"
  aria-keyshortcuts="?"
  aria-haspopup="dialog"
  onclick={showHelp}><Icon name="help" /></button
>

{#snippet shortcutList(mode: "grid" | "page", pane: "Input" | "Output")}
  <dl class="shortcut-list">
    {#if mode === "grid"}<div>
        <dt><kbd>←</kbd> / <kbd>→</kbd></dt>
        <dd>Start navigation (no selection)</dd>
      </div>{/if}
    <div>
      <dt><kbd>V</kbd></dt>
      <dd>Switch Grid / Page</dd>
    </div>
    <div>
      <dt><kbd>↑</kbd> <kbd>↓</kbd> <kbd>←</kbd> <kbd>→</kbd></dt>
      <dd>{mode === "grid" ? "Move focus between pages" : "Scroll the page"}</dd>
    </div>
    <div>
      <dt><kbd>N</kbd> / <kbd>P</kbd></dt>
      <dd>{mode === "grid" ? "Focus next / previous page" : "Show next / previous page"}</dd>
    </div>
    <div>
      <dt><kbd class="named">Home</kbd> / <kbd class="named">End</kbd></dt>
      <dd>{mode === "grid" ? "Focus first / last page" : "Show first / last page"}</dd>
    </div>
    <div>
      <dt><kbd class="named">Space</kbd></dt>
      <dd>
        {mode === "grid"
          ? "Select or unselect page"
          : pane === "Input"
            ? "Add the current page to Output"
            : "Duplicate the current page"}
      </dd>
    </div>
    {#if mode === "grid"}
      <div>
        <dt><kbd class="named">PgUp</kbd> / <kbd class="named">PgDn</kbd></dt>
        <dd>Previous / next thumbnail group</dd>
      </div>
      <div>
        <dt><kbd class="named">Shift</kbd> + <kbd>←</kbd> / <kbd>→</kbd></dt>
        <dd>Select / unselect pages</dd>
      </div>
      <div>
        <dt>
          <kbd class="named">Enter</kbd>{#if pane === "Output"}
            / <kbd>+</kbd>{/if}
        </dt>
        <dd>{pane === "Input" ? "Add pages to Output" : "Duplicate pages"}</dd>
      </div>
      {#if pane === "Output"}
        <div>
          <dt><kbd class="named">Del</kbd> / <kbd>−</kbd></dt>
          <dd>Remove pages</dd>
        </div>
        <div>
          <dt><kbd class="named">Ctrl</kbd> + <kbd>←</kbd> / <kbd>→</kbd></dt>
          <dd>Move pages earlier / later</dd>
        </div>
      {/if}
    {:else}
      <div>
        <dt><kbd class="named">PgUp</kbd> / <kbd class="named">PgDn</kbd></dt>
        <dd>Show previous / next page</dd>
      </div>
      <div>
        <dt><kbd>G</kbd></dt>
        <dd>Go to page</dd>
      </div>
      <div>
        <dt><kbd>+</kbd> / <kbd>−</kbd></dt>
        <dd>Zoom in / out</dd>
      </div>
      <div>
        <dt><kbd>0</kbd> or <kbd>Z</kbd></dt>
        <dd>Fit page (100%)</dd>
      </div>
    {/if}
  </dl>
{/snippet}

<Install bind:pending={installationPending} recommend={onboarding} {dismissed}>
  {#snippet children(content)}
    <dialog bind:this={help} class="help-dialog" aria-label="Help" closedby="any" {@attach dismiss}>
      <div class="dialog-heading">
        <h2>Help</h2>
        <button class="icon-button" aria-label="Close help" onclick={() => help.close()}><Icon name="close" /></button>
      </div>
      <div class="help-navigation">
        <div class="tabs" role="tablist" aria-label="Help topics">
          {#each topics as name (name)}
            <button
              id={`${id}-help-${name}`}
              role="tab"
              aria-selected={topic === name}
              aria-controls={`${id}-help-${name}-panel`}
              tabindex={topic === name ? 0 : -1}
              onkeydown={topicKey}
              onclick={() => (topic = name)}>{labels[name]}</button
            >
          {/each}
        </div>
        {#if workspace}<button class="primary" onclick={start}>Start Tour</button>{/if}
      </div>
      <div class="help-panels">
        {#if topics.includes("keyboard")}<div
            id={`${id}-help-keyboard-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-help-keyboard`}
            aria-hidden={topic !== "keyboard"}
            inert={topic !== "keyboard"}
            tabindex="0"
          >
            <div class="help-body">
              <p>
                V, Ctrl+A, Esc, and starting Grid navigation use the mouse side. PgUp/PgDn also change its Grid group.
                Page keys use its Page, or the other open Page.
              </p>
              <div class="shortcut-views">
                {#if hasInput}<section aria-label={`Input ${modes.input}`}>
                    <h3>Input {modes.input === "grid" ? "Grid" : modes.input === "page" ? "Page" : "Style"}</h3>
                    <div class="help-body">
                      {#if modes.input === "style"}
                        <p>
                          Use <kbd class="named">Tab</kbd> and <kbd class="named">Shift</kbd> +
                          <kbd class="named">Tab</kbd> to move between Style controls.
                        </p>
                      {:else}
                        <h4>View</h4>
                        {@render shortcutList(modes.input, "Input")}
                        <h4>Selection Field</h4>
                        <dl class="shortcut-list">
                          <div>
                            <dt><kbd class="named">Enter</kbd></dt>
                            <dd>Add prepared pages to Output</dd>
                          </div>
                        </dl>
                      {/if}
                    </div>
                  </section>{/if}
                <section aria-label={`Output ${modes.output}`}>
                  <h3>Output {modes.output === "grid" ? "Grid" : "Page"}</h3>
                  <div class="help-body">
                    {#if hasOutput}
                      <h4>View</h4>
                      {@render shortcutList(modes.output, "Output")}
                      <h4>Selection Field</h4>
                      <dl class="shortcut-list">
                        <div>
                          <dt><kbd class="named">Enter</kbd></dt>
                          <dd>Remove selected Output pages</dd>
                        </div>
                      </dl>
                    {:else}
                      <p>
                        Add Input pages to use Output page actions.
                        {#if modes.output === "page"}Press <kbd>V</kbd> to return to Grid.{/if}
                      </p>
                    {/if}
                  </div>
                </section>
              </div>
              <section aria-label="Workspace shortcuts">
                <h3>Workspace</h3>
                <div class="help-body shortcut-views">
                  <dl class="shortcut-list">
                    <div>
                      <dt><kbd>?</kbd></dt>
                      <dd>Help</dd>
                    </div>
                    <div>
                      <dt><kbd class="named">Ctrl</kbd> / <kbd>⌘</kbd> + <kbd>A</kbd></dt>
                      <dd>Select all pages in target pane</dd>
                    </div>
                    <div>
                      <dt><kbd class="named">Esc</kbd></dt>
                      <dd>Close, cancel, or clear target selection</dd>
                    </div>
                    <div>
                      <dt><kbd class="named">Del</kbd></dt>
                      <dd>Remove Output selection</dd>
                    </div>
                    <div>
                      <dt><kbd class="named">Ctrl</kbd> + <kbd>←</kbd> / <kbd>→</kbd></dt>
                      <dd>Move Output selection</dd>
                    </div>
                  </dl>
                  <p>Fields and open menus keep their keys. Selection actions use the bar.</p>
                  {#if modes.input === "grid" || modes.output === "grid"}
                    <p>
                      Without a selection, → starts at the first page of the current group. ← starts at the last.
                      Reversing Shift+←/→ restores the step. Navigation stops at each end.
                    </p>
                  {/if}
                </div>
              </section>
            </div>
          </div>{/if}
        {#if topics.includes("mouse")}<div
            id={`${id}-help-mouse-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-help-mouse`}
            aria-hidden={topic !== "mouse"}
            inert={topic !== "mouse"}
            tabindex="0"
          >
            <div class="help-body">
              <p>Grid and Input Page grips share Selection with the page fields.</p>
              <dl class="shortcut-list">
                <div>
                  <dt>Click a Page counter</dt>
                  <dd>Enter a page number</dd>
                </div>
                <div>
                  <dt>Click a Grid image</dt>
                  <dd>Select or unselect a page and continue with the keyboard</dd>
                </div>
                <div>
                  <dt><kbd class="named">Ctrl</kbd> / <kbd>⌘</kbd> + click</dt>
                  <dd>Switch the current page between Grid and Page</dd>
                </div>
                <div>
                  <dt>Double-click a Page image</dt>
                  <dd>
                    Add one current Input page or duplicate the current Output page. Selection stays unchanged, so the
                    action can repeat. Double-clicking an Input Grid image adds the preparation, or one current page.
                  </dd>
                </div>
                <div>
                  <dt>Click a grip</dt>
                  <dd>Select or unselect a page and continue with the keyboard</dd>
                </div>
                <div>
                  <dt><kbd class="named">Shift</kbd> + click a Grid image or grip</dt>
                  <dd>Add or remove a selection range</dd>
                </div>
                <div>
                  <dt>Drag a grip or Grid image</dt>
                  <dd>
                    Input adds pages to Output. Output Grid moves pages. Starting a drag preserves selection and
                    keyboard focus.
                  </dd>
                </div>
                <div>
                  <dt>Drag a Page image</dt>
                  <dd>Pan the image when zoom is above 100%</dd>
                </div>
                <div>
                  <dt>Mouse wheel</dt>
                  <dd>Scroll the workspace; above 100% zoom, scroll inside the Page image</dd>
                </div>
              </dl>
            </div>
          </div>{/if}
        {#if topics.includes("touch")}<div
            id={`${id}-help-touch-panel`}
            role="tabpanel"
            aria-labelledby={`${id}-help-touch`}
            aria-hidden={topic !== "touch"}
            inert={topic !== "touch"}
            tabindex="0"
          >
            <div class="help-body">
              <p>Tap a page image or grip to select it. The page field shows the same selection.</p>
              {#if hasInput}<p>Use the selection bar to add Input pages to Output.</p>{/if}
              {#if hasOutput}<p>Use the selection bar to move, copy, and remove Output pages.</p>{/if}
              <p>
                Double-tap a Grid image to open Page. In Page, double-tap the image to add or duplicate the current
                page. Normal and Compact change thumbnail size.
              </p>
              <p>
                Drag pages from their grips. In Page, swipe to pan an enlarged image, pinch to zoom, or hold to inspect
                with the lens.
              </p>
            </div>
          </div>{/if}
        <div
          id={`${id}-help-app-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-help-app`}
          aria-hidden={topic !== "app"}
          inert={topic !== "app"}
          tabindex="0"
        >
          <div class="help-body">
            <h3>App installation</h3>
            {@render content(false)}
            {#if !workspace}<p>Choose a PDF to see help for page selection and editing.</p>{/if}
          </div>
        </div>
      </div>
    </dialog>
  {/snippet}
</Install>

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
    <button class="icon-button" aria-label="Close welcome" onclick={closeWelcome}><Icon name="close" /></button>
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
        ><strong>Check and download</strong><span>Preview the result, then save your PDF.</span></span
      >
    </li>
  </ol>
  <div class="help-actions">
    <button onclick={start}>Take a tour</button>
    <button class="primary" onclick={closeWelcome}>Skip</button>
  </div>
</dialog>

<Tour
  bind:this={tour}
  bind:active={touring}
  {hasInput}
  {hasOutput}
  {styleable}
  {hasProfiles}
  {change}
  restore={restoreTourFocus}
  ended={() => void suggest()}
/>

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
