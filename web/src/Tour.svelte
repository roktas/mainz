<!-- Owns Product tour steps, target tracking, spotlight geometry, and navigation. -->

<script module lang="ts">
  export type TourStep =
    | "input"
    | "input-grid"
    | "input-density"
    | "input-page"
    | "style"
    | "style-profile"
    | "output-grid"
    | "output-density"
    | "output-selection"
    | "output-page"
    | "download"
</script>

<script lang="ts">
  import { tick } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import Icon from "./Icon.svelte"

  let {
    hasInput,
    hasOutput,
    styleable,
    hasProfiles,
    change,
    restore,
    ended,
    active = $bindable(false),
  }: {
    hasInput: boolean
    hasOutput: boolean
    styleable: boolean
    hasProfiles: boolean
    change: (step?: TourStep) => void
    restore: () => void
    ended: () => void
    active?: boolean
  } = $props()
  const id = $props.id()
  const motion = new MediaQuery("(prefers-reduced-motion: no-preference)")
  let tour: HTMLDivElement
  let index = $state(0)
  let context: string | undefined
  let target = $state<HTMLElement>()
  let tab = $state<HTMLElement>()
  let focus = $state({ x: 0, y: 0, width: 0, height: 0 })
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
        ]
      : []),
    {
      key: hasInput ? "input-density" : "output-density",
      title: "Choose a Grid density",
      text: [
        "Normal gives each page more space. Compact fits more thumbnails so you can scan and arrange a larger set.",
        "Use the two buttons beside Grid and Page. Input and Output keep separate density choices; changing density keeps page order and selection.",
      ],
    },
    ...(hasInput
      ? [
          {
            key: "input-page" as const,
            title: "Inspect an Input page",
            text: [
              "Page shows all original pages once, in order, regardless of selection. The outer chevrons browse without changing selection.",
              "On touch screens, use the page-selection field. With a mouse, the heading grip selects or unselects. Selection stays shared with Grid and the field. With a selection, use the bar’s + to add it. Without a selection, bottom + adds the current page.",
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
      key: "output-selection",
      title: "Edit selected Output pages",
      text: [
        "Select Output pages with their images, grips, or this field. The bar applies each action to the selection.",
        "← moves pages earlier and → moves them later in print order. An unavailable direction stays in place but is disabled. On narrow screens, find these moves in the … menu.",
        "− removes selected pages. + adds one copy of the selection after its last page. Without a selection, these controls are disabled in this tour; your pages stay unchanged.",
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
  ])
  const step = $derived(steps[Math.min(index, steps.length - 1)])

  function focusTarget(element = target, button = tab) {
    if (!element) return
    const rect = element.getBoundingClientRect()
    const heading = button?.getBoundingClientRect() ?? rect
    const left = Math.max(0, Math.min(innerWidth, Math.min(rect.left, heading.left) - 24))
    const top = Math.max(0, Math.min(innerHeight, Math.min(rect.top, heading.top) - 24))
    const right = Math.max(0, Math.min(innerWidth, Math.max(rect.right, heading.right) + 24))
    const bottom = Math.max(0, Math.min(innerHeight, Math.max(rect.bottom, heading.bottom) + 24))
    focus = {
      x: (left + right) / 2,
      y: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    }
  }
  async function point() {
    const key = step.key
    change(key)
    await tick()
    if (tour.matches(":popover-open")) {
      const previous = target
      const previousTab = tab
      target = document.querySelector<HTMLElement>(`[data-tour-target="${key}"]`) ?? undefined
      tab = document.querySelector<HTMLElement>(`[data-tour-tab="${key}"]`) ?? undefined
      target?.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "instant",
      })
      tab?.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "instant" })
      if (target !== previous || tab !== previousTab) tour.scrollTop = 0
      focusTarget()
      if (target !== previous && motion.current) {
        tour.animate([{ opacity: 0.65 }, { opacity: 1 }], {
          duration: 280,
          easing: "ease-out",
          pseudoElement: "::backdrop",
        })
      }
    }
  }
  export function start() {
    index = 0
    tour.showPopover()
  }
  function advance(delta: number) {
    index = Math.max(0, Math.min(steps.length - 1, index + delta))
    void point()
  }
  export function close() {
    tour.hidePopover()
    restore()
  }
  $effect(() => {
    const next = `${hasInput}:${hasOutput}:${styleable}:${hasProfiles}`
    if (context !== undefined && context !== next) tour.hidePopover()
    context = next
  })
  $effect(() => {
    const observer = new ResizeObserver(() => focusTarget())
    if (target) observer.observe(target)
    if (tab) observer.observe(tab)
    return () => observer.disconnect()
  })
</script>

<svelte:window
  onresize={() => {
    if (active) void point()
  }}
  onkeydown={(event) => {
    if (event.key === "Escape" && active) close()
  }}
/>
<svelte:document onscrollcapture={() => focusTarget()} />

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
      active = false
      target = undefined
      tab = undefined
      change()
    }
  }}
  ontoggle={(event) => {
    if (event.newState === "closed") ended()
    else {
      active = true
      void point()
      tour.querySelector<HTMLButtonElement>(".help-actions .primary")?.focus()
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
        if (index >= steps.length - 1) close()
        else advance(1)
      }}
    >
      {#if index >= steps.length - 1}Finish{:else}Next<Icon name="next" />{/if}
    </button>
  </div>
</div>
