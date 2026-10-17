<!-- Provides shortcut help, onboarding, the product tour, and the addition hint. -->
<script module lang="ts">
  export type TourStep =
    | "input"
    | "input-grid"
    | "input-page"
    | "style"
    | "style-profile"
    | "output-grid"
    | "output-page"
    | "download";
</script>

<script lang="ts">
  import { tick, untrack } from "svelte";
  import { MediaQuery } from "svelte/reactivity";
  import Icon from "./Icon.svelte";
  import { blocked, fields } from "./keyboard.ts";

  let {
    hasInput,
    hasOutput,
    styleable,
    hasProfiles,
    views,
    onboarding = true,
    change,
    hint,
  }: {
    hasInput: boolean;
    hasOutput: boolean;
    styleable: boolean;
    hasProfiles: boolean;
    views: () => { input: "grid" | "page" | "style"; output: "grid" | "page" };
    onboarding?: boolean;
    change: (step?: TourStep) => void;
    hint: (show: boolean) => void;
  } = $props();
  const id = $props.id();
  const motion = new MediaQuery("(prefers-reduced-motion: no-preference)");
  let welcome: HTMLDialogElement;
  let help: HTMLDialogElement;
  let modes = $state<ReturnType<typeof views>>({ input: "grid", output: "grid" });
  let topic = $state<"keyboard" | "mouse">("keyboard");
  let tour: HTMLDivElement;
  let helpButton: HTMLButtonElement;
  let flight: HTMLCanvasElement;
  let index = $state(0);
  let context: string | undefined;
  let welcomed = false;
  let hinted = false;
  let hintObserver: IntersectionObserver | undefined;
  let hintReady: MutationObserver | undefined;
  let animation: Animation | undefined;
  let target = $state<HTMLElement>();
  let tab = $state<HTMLElement>();
  let focus = $state({ x: 0, y: 0, width: 0, height: 0 });
  const steps = $derived<{ key: TourStep; title: string; text: string[] }[]>([
    ...(hasInput
      ? [
          {
            key: "input" as const,
            title: "Open your PDFs",
            text: [
              "Open PDF adds one or more files, kept on this device. Input shows each original; Output holds your chosen pages from any Input.",
              "Switch Inputs or remove the current Input in the filename menu. Each keeps its position, view, and selection. Opening or switching Inputs keeps Output.",
            ],
          },
          {
            key: "input-grid" as const,
            title: "Choose pages in Grid",
            text: [
              "Select pages using images, grips, or the page field. Borders and the page field show the same selection.",
              "Or type a sequence: 3-5,2,2,7. The field’s + adds it to Output, clears the preparation, and selects the new Output pages. Its menu sets repetitions and front alignment.",
              "Selection moves addition into the bar and hides card buttons. Without a selection, a card’s + adds one copy.",
            ],
          },
          {
            key: "input-page" as const,
            title: "Inspect an Input page",
            text: [
              "Page shows all original pages once, in order, regardless of selection. The outer chevrons browse without changing selection.",
              "The heading grip selects or unselects. Selection stays shared with Grid and the field. Selection hides bottom +; use the bar to add it. Without a selection, bottom + adds one current page.",
              "Use the page counter to go to a page. Zoom controls fit, reduce, or enlarge the page.",
            ],
          },
        ]
      : []),
    ...(styleable
      ? [
          {
            key: "style" as const,
            title: "Adjust the styles",
            text: [
              "Style affects this Input’s applicable pages and Output copies. Input keeps its original appearance. The prepared PDF supplies the controls.",
              "Open controls to edit color, opacity, or values within the PDF’s units and limits. Output updates live; its Page view offers Compare and Show original page.",
              "Reset restores authored values. Switching Inputs keeps styles. Open the same PDF again to style another independent Input.",
            ],
          },
        ]
      : []),
    ...(hasProfiles
      ? [
          {
            key: "style-profile" as const,
            title: "Choose a Style profile",
            text: [
              "Read a profile’s description, then choose it to apply its values to this Input’s applicable pages.",
              "Adjust values as needed. Custom means no named profile matches. Choose a profile again to reapply it; Reset restores authored values.",
            ],
          },
        ]
      : []),
    {
      key: "output-grid",
      title: "Arrange Output in Grid",
      text: hasOutput
        ? [
            "Copies appear in print order, numbered by current position. Each number opens its source details. A folded corner marks a back face; a border and tint mark selection.",
            "Select with images, grips, or the field. The bar moves, removes, or duplicates selected pages. Clear resets selection and repeat settings, keeping Output.",
            "Selection hides individual controls. Clear restores them. The first menu moves selected pages, repeats consecutive pages, and inserts blanks.",
          ]
        : [
            "Add Input pages. Grid shows copies in print order, with current positions and sources.",
            "Select with images, grips, or the field. Without a selection, a card’s − removes one page and + duplicates it. Selection shows bar actions for one or several pages and temporarily hides card controls.",
          ],
    },
    {
      key: "output-page",
      title: "Check Output in Page",
      text: hasOutput
        ? [
            "Inspect Output in print order. Outer chevrons browse without changing selection. Selection stays shared with Grid and the field.",
            "Without an Output selection, bottom − removes the current page and bottom + duplicates it. Use the bar to edit selected pages. Compare shows the original appearance when available. Show original page opens its matching Input page.",
            "Use the page counter to go to a page. Zoom controls fit, reduce, or enlarge the page.",
          ]
        : [
            "Add Input pages to inspect Output at a larger size, in print order. Chevrons browse; blanks and padding keep their physical proportions.",
            "Compare shows the original appearance when available. Show original page opens the matching Input page.",
          ],
    },
    {
      key: "download",
      title: "Save your PDF",
      text: [
        "Inspect Output, then Download to build and check its order, copies, blanks, and styles. Original PDFs stay intact.",
        "The dialog shows preparation and validation. Cancel or an error keeps the workspace so you can adjust and retry.",
      ],
    },
  ]);
  const step = $derived(steps[Math.min(index, steps.length - 1)]);

  function remember() {
    try {
      localStorage.setItem("mainz:onboarding", "19");
    } catch {
      /* Storage can be unavailable. */
    }
  }
  function stopFlight() {
    animation?.cancel();
    flight.hidePopover();
  }
  function stopHint() {
    hintObserver?.disconnect();
    hintReady?.disconnect();
    stopFlight();
  }
  function dismissHint() {
    stopFlight();
    hint(false);
  }
  async function suggest() {
    await tick();
    if (hinted || !onboarding || !hasInput || hasOutput || welcome.open || help.open || tour.matches(":popover-open"))
      return;
    const page = document.querySelector<HTMLCanvasElement>('[data-tour-target="first-page"] .thumbnail canvas');
    if (!page) return;
    stopHint();
    let visible = false;
    async function show() {
      if (
        !page ||
        !visible ||
        hinted ||
        !onboarding ||
        hasOutput ||
        welcome.open ||
        help.open ||
        tour.matches(":popover-open") ||
        page.parentElement?.getAttribute("aria-busy") !== "false"
      )
        return;
      hinted = true;
      stopHint();
      hint(true);
      await tick();
      if (!page.isConnected || hasOutput || !onboarding || help.open || tour.matches(":popover-open")) return;
      if (!motion.current) return;
      const destination = [
        ...document.querySelectorAll<HTMLElement>(".mobile-workspace-tabs button:last-child, .composition-empty"),
      ].find((element) => element.getBoundingClientRect().width > 0);
      if (!destination) return;
      const origin = page.getBoundingClientRect(),
        end = destination.getBoundingClientRect();
      const x =
        Math.max(origin.width / 2 + 8, Math.min(innerWidth - origin.width / 2 - 8, end.left + end.width / 2)) -
        origin.left -
        origin.width / 2;
      const y =
        Math.max(origin.height / 2 + 8, Math.min(innerHeight - origin.height / 2 - 8, end.top + end.height / 2)) -
        origin.top -
        origin.height / 2;
      flight.width = page.width;
      flight.height = page.height;
      flight.getContext("2d")?.drawImage(page, 0, 0);
      flight.style.insetInlineStart = `${origin.left}px`;
      flight.style.insetBlockStart = `${origin.top}px`;
      flight.style.inlineSize = `${origin.width}px`;
      flight.style.blockSize = `${origin.height}px`;
      const card = page.closest<HTMLElement>('[data-tour-target="first-page"]') ?? page;
      focusTarget(card, card);
      flight.showPopover();
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
      );
      animation.onfinish = stopFlight;
    }
    hintObserver = new IntersectionObserver(
      ([entry]) => {
        visible = entry.isIntersecting && entry.intersectionRatio >= 0.25;
        void show();
      },
      { threshold: 0.25 },
    );
    hintReady = new MutationObserver(() => void show());
    hintReady.observe(page.parentElement!, { attributes: true, attributeFilter: ["aria-busy"] });
    hintObserver.observe(page);
  }
  function focusTarget(element = target, button = tab) {
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const heading = button?.getBoundingClientRect() ?? rect;
    const left = Math.max(0, Math.min(innerWidth, Math.min(rect.left, heading.left) - 24));
    const top = Math.max(0, Math.min(innerHeight, Math.min(rect.top, heading.top) - 24));
    const right = Math.max(0, Math.min(innerWidth, Math.max(rect.right, heading.right) + 24));
    const bottom = Math.max(0, Math.min(innerHeight, Math.max(rect.bottom, heading.bottom) + 24));
    focus = {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    };
  }
  async function point() {
    const key = step.key;
    change(key);
    await tick();
    if (tour.matches(":popover-open")) {
      const previous = target;
      target = document.querySelector<HTMLElement>(`[data-tour-target="${key}"]`) ?? undefined;
      tab = document.querySelector<HTMLElement>(`[data-tour-tab="${key}"]`) ?? undefined;
      target?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      });
      tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" });
      focusTarget();
      if (target !== previous && motion.current) {
        tour.animate([{ opacity: 0.65 }, { opacity: 1 }], {
          duration: 360,
          easing: "ease-out",
          pseudoElement: "::backdrop",
        });
      }
    }
  }
  async function start() {
    index = 0;
    stopHint();
    welcome.close();
    help.close();
    await tick();
    tour.showPopover();
  }
  function showHelp() {
    stopHint();
    modes = views();
    topic = "keyboard";
    help.showModal();
    document.getElementById(`${id}-help-keyboard`)?.focus();
  }
  function topicKey(event: KeyboardEvent) {
    if (event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    topic =
      event.key === "Home" ? "keyboard" : event.key === "End" ? "mouse" : topic === "keyboard" ? "mouse" : "keyboard";
    document.getElementById(`${id}-help-${topic}`)?.focus();
  }
  function advance(delta: number) {
    index = Math.max(0, Math.min(steps.length - 1, index + delta));
    void point();
  }
  function close() {
    tour.hidePopover();
    const destination = helpButton.checkVisibility()
      ? helpButton
      : document.querySelector<HTMLButtonElement>(".settings-button, .theme");
    destination?.focus();
  }
  $effect(() => {
    if (hasOutput) hinted = true;
    if (hasOutput || !onboarding) {
      stopHint();
      untrack(() => hint(false));
    }
    return stopHint;
  });
  $effect(() => {
    if (!motion.current) stopFlight();
  });
  $effect(() => {
    const next = `${hasInput}:${hasOutput}:${styleable}:${hasProfiles}`;
    if (context !== undefined && context !== next) tour.hidePopover();
    context = next;
  });
  $effect(() => {
    const observer = new ResizeObserver(() => focusTarget());
    if (target) observer.observe(target);
    if (tab) observer.observe(tab);
    return () => observer.disconnect();
  });
  $effect(() => {
    if (!onboarding || !hasInput || welcomed) return;
    welcomed = true;
    try {
      if (localStorage.getItem("mainz:onboarding") === "19") {
        void suggest();
        return;
      }
    } catch {
      /* Show the welcome when storage is unavailable. */
    }
    welcome.showModal();
    welcome.querySelector<HTMLButtonElement>(".primary")?.focus();
  });
</script>

<svelte:window
  onresize={() => {
    stopFlight();
    if (tour.matches(":popover-open")) void point();
  }}
  onkeydown={(event) => {
    if (event.key === "Escape" && tour.matches(":popover-open")) close();
    if (event.key === "Escape" && flight.matches(":popover-open")) stopFlight();
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
      return;
    event.preventDefault();
    showHelp();
  }}
/>
<svelte:document
  onscrollcapture={() => {
    focusTarget();
    stopFlight();
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

<dialog bind:this={help} class="help-dialog" aria-label="Help" closedby="any">
  <div class="dialog-heading">
    <h2>Help</h2>
    <button class="icon-button" aria-label="Close help" onclick={() => help.close()}><Icon name="close" /></button>
  </div>
  <div class="help-navigation">
    <div class="tabs" role="tablist" aria-label="Help topics">
      {#each ["keyboard", "mouse"] as const as name (name)}
        <button
          id={`${id}-help-${name}`}
          role="tab"
          aria-selected={topic === name}
          aria-controls={`${id}-help-${name}-panel`}
          tabindex={topic === name ? 0 : -1}
          onkeydown={topicKey}
          onclick={() => (topic = name)}>{name === "keyboard" ? "Keyboard" : "Mouse"}</button
        >
      {/each}
    </div>
    <button class="primary" onclick={start}>Start Tour</button>
  </div>
  <div class="help-panels">
    <div
      id={`${id}-help-keyboard-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-help-keyboard`}
      aria-hidden={topic !== "keyboard"}
      inert={topic !== "keyboard"}
      tabindex="0"
    >
      <div class="help-body">
        <p>
          V, Ctrl+A, Esc, and starting Grid navigation use the mouse side. PgUp/PgDn also change its Grid group. Page
          keys use its Page, or the other open Page.
        </p>
        <div class="shortcut-views">
          {#if hasInput}<section aria-label={`Input ${modes.input}`}>
              <h3>Input {modes.input === "grid" ? "Grid" : modes.input === "page" ? "Page" : "Style"}</h3>
              <div class="help-body">
                {#if modes.input === "style"}
                  <p>
                    Use <kbd class="named">Tab</kbd> and <kbd class="named">Shift</kbd> + <kbd class="named">Tab</kbd> to
                    move between Style controls.
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
                Without a selection, → starts at the first page of the current group. ← starts at the last. Reversing
                Shift+←/→ restores the step. Navigation stops at each end.
              </p>
            {/if}
          </div>
        </section>
      </div>
    </div>
    <div
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
              Add one current Input page or duplicate the current Output page. Selection stays unchanged, so the action
              can repeat. Double-clicking an Input Grid image adds the preparation, or one current page.
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
              Input adds pages to Output. Output Grid moves pages. Starting a drag preserves selection and keyboard
              focus.
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
    </div>
  </div>
</dialog>

<dialog
  bind:this={welcome}
  class="welcome-dialog"
  aria-labelledby={`${id}-welcome-title`}
  onclose={() => {
    remember();
    void suggest();
  }}
>
  <div class="dialog-heading">
    <h2 id={`${id}-welcome-title`}>Welcome to PDF Composer</h2>
    <button class="icon-button" aria-label="Close welcome" onclick={() => welcome.close()}><Icon name="close" /></button
    >
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
    <button class="primary" onclick={() => welcome.close()}>Skip</button>
  </div>
</dialog>

<div
  bind:this={tour}
  id={`${id}-tour`}
  class="help-tour"
  popover="auto"
  role="dialog"
  aria-label="Product tour"
  data-step={step.key}
  style:--focus-x={`${focus.x}px`}
  style:--focus-y={`${focus.y}px`}
  style:--focus-width={`${focus.width}px`}
  style:--focus-height={`${focus.height}px`}
  onbeforetoggle={(event) => {
    if (event.newState === "closed") {
      target = undefined;
      tab = undefined;
      change();
    }
  }}
  ontoggle={(event) => {
    if (event.newState === "closed") void suggest();
    else {
      void point();
      tour.querySelector<HTMLButtonElement>(".help-actions .primary")?.focus();
    }
  }}
>
  <div class="dialog-heading">
    <span class="tour-progress"
      ><span class="tour-label">Product tour · </span>{Math.min(index + 1, steps.length)} / {steps.length}</span
    >
    <button class="text-button" onclick={close}>End tour</button>
  </div>
  <div class="tour-copy" aria-live="polite" aria-atomic="true">
    <h2>{step.title}</h2>
    {#each step.text as text (text)}<p>{text}</p>{/each}
  </div>
  <div class="help-actions">
    <button disabled={index === 0} onclick={() => advance(-1)}><Icon name="previous" />Back</button>
    <button
      class="primary"
      onclick={() => {
        if (index >= steps.length - 1) close();
        else advance(1);
      }}
    >
      {#if index >= steps.length - 1}Finish{:else}Next<Icon name="next" />{/if}
    </button>
  </div>
</div>

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
