<!-- Provides input-specific help, onboarding, and access to independent installation guidance. -->

<script lang="ts">
  import { tick, untrack } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"
  import Install from "./Install.svelte"
  import Tour from "./Tour.svelte"
  import type { TourStep } from "./Tour.svelte"
  import { shortcut, shortcutContext } from "./keyboard.ts"

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
    views: () => { input: "grid" | "list" | "page" | "style"; output: "grid" | "list" | "page" }
    onboarding?: boolean
    change: (step?: TourStep) => void
    hint: (show: boolean) => void
    dismissed: () => void
  } = $props()
  const id = $props.id()
  const motion = new MediaQuery("(prefers-reduced-motion: no-preference)")
  const fine = new MediaQuery("(any-pointer: fine)")
  const coarse = new MediaQuery("(any-pointer: coarse)")
  type Topic = "keyboard" | "mouse" | "touch"
  const workspace = $derived(hasInput || hasOutput)
  const topics = $derived<Topic[]>([
    ...(workspace && fine.current ? (["keyboard", "mouse"] as const) : []),
    ...(workspace && coarse.current ? (["touch"] as const) : []),
  ])
  const labels = { keyboard: "Keyboard", mouse: "Mouse", touch: "Touch" }
  let installationPending = $state(false)
  let installation: ReturnType<typeof Install>
  const guidance = $derived(onboarding && !installationPending)
  let welcome: HTMLDialogElement
  let help: HTMLDialogElement
  const panes = ["Input", "Output"] as const
  let modes = $state({
    Input: "grid" as "grid" | "list" | "page" | "style",
    Output: "grid" as "grid" | "list" | "page",
  })
  const contexts = $derived([
    ...(hasInput
      ? (["grid", "list", "page", ...(styleable ? ["style" as const] : [])] as const).map((mode) => ({
          pane: "Input" as const,
          mode,
        }))
      : []),
    ...(["grid", "list", "page"] as const).map((mode) => ({ pane: "Output" as const, mode })),
  ])
  let topic = $state<Topic>("keyboard")
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
  export function showInstallation() {
    if (touring) tour.close()
    installation.open()
  }
  function showHelp() {
    stopHint()
    if (touring) tour.close()
    const current = views()
    modes = { Input: current.input, Output: current.output }
    topic = topics[0] ?? "keyboard"
    help.showModal()
    const first = document.getElementById(`${id}-help-${topic}`)
    if (first) first.focus()
    else help.querySelector<HTMLButtonElement>('[aria-label="Close help"]')?.focus()
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
    const first = document.getElementById(`${id}-help-${topic}`)
    if (first) first.focus()
    else help.querySelector<HTMLButtonElement>('[aria-label="Close help"]')?.focus()
  }
  $effect(() => {
    if (topics.length && !topics.includes(topic)) topic = topics[0]!
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
    if (shortcut(event, shortcutContext(event), "help") !== "help") return
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

{#snippet shortcutList(mode: "grid" | "list" | "page" | "style", pane: "Input" | "Output")}
  <h4>Navigate</h4>
  <dl class="shortcut-list">
    <div>
      <dt><kbd class="named">Alt/⌥</kbd> + <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd></dt>
      <dd>Switch this pane to Grid / List / Page</dd>
    </div>
    <div>
      <dt><kbd class="named">Alt/⌥</kbd> + <kbd>V</kbd></dt>
      <dd>Return to the previous view in this pane</dd>
    </div>
    {#if mode === "style"}
      <div>
        <dt><kbd class="named">Tab</kbd></dt>
        <dd>Move to the next Style control</dd>
      </div>
      <div>
        <dt><kbd class="named">Shift</kbd> + <kbd class="named">Tab</kbd></dt>
        <dd>Move to the previous Style control</dd>
      </div>
    {:else}
      {#if mode === "grid"}<div>
          <dt><kbd>←</kbd> / <kbd>→</kbd></dt>
          <dd>Start at the first / last page (no selection)</dd>
        </div>{/if}
      <div>
        <dt><kbd>V</kbd></dt>
        <dd>
          {mode === "list" ? "Switch List / Page" : mode === "page" ? "Return to Grid or List" : "Switch Grid / Page"}
        </dd>
      </div>
      <div>
        <dt>
          <kbd>↑</kbd> <kbd>↓</kbd>{#if mode === "grid"}
            <kbd>←</kbd> <kbd>→</kbd>{/if}
        </dt>
        <dd>{mode === "page" ? "Scroll the image vertically" : "Move focus between pages"}</dd>
      </div>
      <div>
        <dt><kbd>N</kbd> / <kbd>P</kbd></dt>
        <dd>{mode === "page" ? "Show next / previous page" : "Focus next / previous page"}</dd>
      </div>
      <div>
        <dt><kbd class="named">Home</kbd> / <kbd class="named">End</kbd></dt>
        <dd>{mode === "page" ? "Show first / last page" : "Focus first / last page"}</dd>
      </div>
      <div>
        <dt><kbd class="named">PgUp</kbd> / <kbd class="named">PgDn</kbd></dt>
        <dd>
          {mode === "list"
            ? "Move one screen of rows"
            : mode === "grid"
              ? "Previous / next thumbnail group"
              : "Show previous / next page"}
        </dd>
      </div>
      {#if mode === "page"}
        <div>
          <dt><kbd>←</kbd> / <kbd>→</kbd></dt>
          <dd>Change page if width fits; otherwise scroll</dd>
        </div>
        <div>
          <dt><kbd>G</kbd></dt>
          <dd>Go to page</dd>
        </div>
      {/if}
    {/if}
    <div>
      <dt><kbd>?</kbd></dt>
      <dd>Open Help</dd>
    </div>
  </dl>
  {#if mode !== "style"}
    <h4>Select</h4>
    <dl class="shortcut-list">
      {#if mode !== "page"}
        <div>
          <dt><kbd class="named">Space</kbd></dt>
          <dd>{mode === "list" ? "Select or unselect page and advance" : "Select or unselect page"}</dd>
        </div>
        <div>
          <dt>
            <kbd class="named">Shift</kbd> + <kbd>{mode === "list" ? "↑" : "←"}</kbd> /
            <kbd>{mode === "list" ? "↓" : "→"}</kbd>
          </dt>
          <dd>Select / unselect pages</dd>
        </div>
        {#if mode === "list"}
          <div>
            <dt><kbd class="named">Shift</kbd> + <kbd class="named">Home</kbd> / <kbd class="named">End</kbd></dt>
            <dd>Extend selection to the first / last row</dd>
          </div>
          <div>
            <dt><kbd class="named">Shift</kbd> + <kbd class="named">PgUp</kbd> / <kbd class="named">PgDn</kbd></dt>
            <dd>Extend selection by one screen of rows</dd>
          </div>
        {/if}
      {/if}
      <div>
        <dt><kbd class="named">Ctrl/⌘</kbd> + <kbd>A</kbd></dt>
        <dd>Select all {pane} pages (outside fields)</dd>
      </div>
      <div>
        <dt><kbd class="named">Esc</kbd></dt>
        <dd>Close, cancel, or clear {pane} selection</dd>
      </div>
    </dl>
    <h4>Edit</h4>
    <dl class="shortcut-list">
      {#if mode === "page"}
        <div>
          <dt><kbd class="named">Space</kbd></dt>
          <dd>{pane === "Input" ? "Add the current page to Output" : "Duplicate the current page"}</dd>
        </div>
        <div>
          <dt><kbd>+</kbd> / <kbd>−</kbd></dt>
          <dd>Zoom in / out</dd>
        </div>
        <div>
          <dt><kbd>0</kbd> or <kbd>Z</kbd></dt>
          <dd>Reset zoom (100%)</dd>
        </div>
      {:else}
        <div>
          <dt>
            <kbd class="named">Enter</kbd>{#if pane === "Output" || mode === "list"}
              / <kbd>+</kbd>{/if}{#if mode === "list"}
              / <kbd>=</kbd>{/if}
          </dt>
          <dd>{pane === "Input" ? "Add pages to Output" : "Duplicate pages"}</dd>
        </div>
      {/if}
      {#if pane === "Output"}
        <div>
          <dt>
            <kbd class="named">Del</kbd>{#if mode !== "page"}
              / <kbd>−</kbd>{/if}
          </dt>
          <dd>Remove Output selection</dd>
        </div>
        <div>
          <dt>
            <kbd class="named">Ctrl/⌘</kbd> + <kbd>{mode === "list" ? "↑" : "←"}</kbd> /
            <kbd>{mode === "list" ? "↓" : "→"}</kbd>
          </dt>
          <dd>Move pages earlier / later</dd>
        </div>
      {/if}
      <div>
        <dt><kbd class="named">Enter</kbd></dt>
        <dd>
          {pane === "Input" ? "Add prepared pages from the page field" : "Remove selected pages from the page field"}
        </dd>
      </div>
    </dl>
  {:else}
    <dl class="shortcut-list">
      <div>
        <dt><kbd class="named">Esc</kbd></dt>
        <dd>Close an editor or menu</dd>
      </div>
    </dl>
  {/if}
{/snippet}

<Install bind:this={installation} bind:pending={installationPending} recommend={onboarding} {dismissed} />
<dialog bind:this={help} class="help-dialog" aria-label="Help" closedby="any" {@attach dismiss}>
  <div class="dialog-heading">
    <h2>Help</h2>
    <button class="icon-button" aria-label="Close help" onclick={() => help.close()}><Icon name="close" /></button>
  </div>
  {#if workspace}<div class="help-navigation">
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
  {/if}
  {#if workspace}<div class="help-panels">
      {#if topics.includes("keyboard")}<div
          id={`${id}-help-keyboard-panel`}
          role="tabpanel"
          aria-labelledby={`${id}-help-keyboard`}
          aria-hidden={topic !== "keyboard"}
          inert={topic !== "keyboard"}
          tabindex="0"
        >
          <div class="help-body">
            <div class="keyboard-panes">
              {#each panes as owner (owner)}
                {#if contexts.some((item) => item.pane === owner)}
                  <section aria-label={`${owner} shortcuts`}>
                    <h3>{owner}</h3>
                    <span class="entry select">
                      <select aria-label={`${owner} shortcut view`} bind:value={modes[owner]}>
                        {#each contexts.filter((item) => item.pane === owner) as item (item.mode)}
                          <option value={item.mode}
                            >{item.mode === "grid"
                              ? "Grid"
                              : item.mode === "list"
                                ? "List"
                                : item.mode === "page"
                                  ? "Page"
                                  : "Style"}</option
                          >
                        {/each}
                      </select>
                      <Icon name="next" />
                    </span>
                    <div class="keyboard-contexts">
                      {#each contexts.filter((item) => item.pane === owner) as item (item.mode)}
                        <section
                          aria-label={`${item.pane} ${item.mode}`}
                          aria-hidden={modes[owner] !== item.mode}
                          inert={modes[owner] !== item.mode}
                        >
                          <div class="help-body">
                            {#if item.pane === "Input" || hasOutput}
                              {@render shortcutList(item.mode, item.pane)}
                            {:else}<p>Add Input pages to use Output page actions.</p>{/if}
                          </div>
                        </section>
                      {/each}
                    </div>
                  </section>
                {/if}
              {/each}
            </div>
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
            <table class="mouse-actions" aria-label="Mouse actions">
              <thead><tr><th scope="col">Action</th><th scope="col">Result</th></tr></thead>
              <tbody>
                <tr><td>Click a Page counter</td><td>Enter a page number</td></tr>
                <tr><td>Click a Grid image or grip</td><td>Select or unselect a page</td></tr>
                <tr
                  ><td><kbd class="named">Ctrl</kbd> / <kbd>⌘</kbd> + click an image</td><td
                    >Open Page or return to Grid or List</td
                  ></tr
                >
                <tr
                  ><td><kbd class="named">Shift</kbd> + click a Grid image or grip</td><td
                    >Add or remove a selection range</td
                  ></tr
                >
                <tr><td>Double-click an Input Grid image</td><td>Add prepared pages, or this page, to Output</td></tr>
                <tr><td>Double-click a Page image</td><td>Zoom to 200% at that point, or return to 100%</td></tr>
                <tr><td>Drag an Input grip or Grid image</td><td>Add pages to Output</td></tr>
                <tr><td>Drag an Output grip or Grid image</td><td>Move Output pages</td></tr>
                <tr><td>Drag a Page image</td><td>Pan above 100% zoom</td></tr>
                <tr><td>Mouse wheel</td><td>Scroll; above 100%, scroll the Page image</td></tr>
                <tr><td>Click Reset zoom</td><td>Reset zoom to 100%</td></tr>
              </tbody>
            </table>
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
            <ul>
              <li>Tap a page image or grip to select it. The page field shows the same selection.</li>
              {#if hasInput}<li>Use the selection bar to add Input pages to Output.</li>{/if}
              {#if hasOutput}<li>Use the selection bar to move, copy, and remove Output pages.</li>{/if}
              <li>Page starts enlarged when the complete page would look narrow.</li>
              <li>
                The zoom reset button returns to the complete page at 100%. At 100%, it fits the page to the width.
              </li>
              <li>
                Double-tap a Grid image to open Page. In Page, double-tap to zoom to 200% at that point, or return an
                enlarged page to 100%. Select the Grid or List tab to change the Pages layout without changing your
                selection.
              </li>
              <li>
                Drag pages from their grips. In Page, swipe left or right to change pages when the image fits
                horizontally. A wider image pans instead. Pinch to zoom, or hold to inspect with the lens.
              </li>
            </ul>
          </div>
        </div>{/if}
    </div>
  {:else}<p>Open a PDF to see its keyboard, mouse, and touch controls.</p>{/if}
</dialog>

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
        ><strong>Check and save</strong><span>Preview the result, then download or share your PDF.</span></span
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
