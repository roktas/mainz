<!-- Displays inspected pages and owns navigation, zoom gestures, panning, and viewport focus. -->

<script module lang="ts">
  export { zoomLevels } from "./viewport.ts"
  export type Controls = "all" | "zoom" | "fit" | "menu"
  export const controlCapabilities = {
    all: { comparison: true, zoom: true, fit: true },
    zoom: { comparison: false, zoom: true, fit: true },
    fit: { comparison: false, zoom: false, fit: true },
    menu: { comparison: false, zoom: false, fit: false },
  } as const
</script>

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { Snippet } from "svelte"
  import type { PDFDocumentProxy } from "pdfjs-dist"
  import type { Size } from "./model.ts"
  import type { Magnification } from "./Lens.svelte"
  import Icon from "./Icon.svelte"
  import Pdf from "./Pdf.svelte"
  import { fitControls, fitting, interactViewport, measureThumbnail, panViewport, scrollViewport } from "./viewport.ts"
  import type { ViewportState } from "./viewport.ts"
  export type Inspection = { size: Size } & (
    | { kind: "blank"; padding: boolean }
    | {
        kind: "pdf"
        pdf: PDFDocumentProxy
        page: number
        comparison?: { pdf: PDFDocumentProxy; page: number; enabled: boolean }
      }
  )
  export type Region = { x: number; y: number }
  let {
    pane = "Output",
    count,
    sheet,
    name,
    position = $bindable(0),
    comparing = false,
    zoom = $bindable(100),
    error,
    magnification = 16,
    heading,
    headingHeight = $bindable(0),
    controls = $bindable<Controls>("all"),
    initialize,
    actions,
    copyable = true,
    grid,
    selected = false,
    region = $bindable({ x: 0, y: 0 }),
    alignment,
    navigationOver,
    navigationLeave,
  }: {
    pane?: "Input" | "Output"
    count: number
    sheet?: Inspection
    name?: string
    position?: number
    comparing?: boolean
    zoom?: number
    error: (message: string) => void
    magnification?: Magnification
    heading?: Snippet<[() => void]>
    headingHeight?: number
    controls?: Controls
    initialize?: (zoom: number) => void
    actions?: Snippet
    copyable?: boolean
    grid: (event: MouseEvent | KeyboardEvent) => void
    selected?: boolean
    region?: Region
    alignment?: Region
    navigationOver?: (event: DragEvent, offset: number) => void
    navigationLeave?: () => void
  } = $props()
  const index = $derived(Math.min(position, Math.max(0, count - 1)))
  const comparison = $derived(sheet?.kind === "pdf" ? sheet.comparison : undefined)
  const original = $derived(comparing && !!comparison?.enabled)
  const document = $derived(sheet?.kind === "pdf" ? (original ? comparison!.pdf : sheet.pdf) : undefined)
  const physicalPage = $derived(sheet?.kind === "pdf" ? (comparison?.page ?? sheet.page) : undefined)
  const renderedPage = $derived(sheet?.kind === "pdf" ? (original ? comparison!.page : sheet.page) : undefined)
  const ratio = $derived(sheet ? sheet.size.width / sheet.size.height : 1)
  const level = $derived(zoom)
  let panning = $state(false)
  let thumbnailWidth = $state(0)
  let headingFrame: number
  const viewportState: ViewportState = { gesture: { kind: "idle" } }
  export function fitWidth() {
    viewportState.cancelZoom?.()
    if (!viewportState.imageViewport) return
    const fitted = fitting(viewportState.imageViewport, level)
    if (fitted) zoom = fitted.zoom
  }
  function navigate(offset: number) {
    viewportState.tap = undefined
    position = Math.max(0, Math.min(count - 1, index + offset))
  }
  function measureHeading(height: number) {
    cancelAnimationFrame(headingFrame)
    headingFrame = requestAnimationFrame(() => (headingHeight = height))
  }
  onDestroy(() => {
    viewportState.cancelZoom?.()
    viewportState.cancelZoom = undefined
    cancelAnimationFrame(headingFrame)
  })
  function attachHeading(element: HTMLDivElement) {
    return fitControls(element, (next) => (controls = next))
  }
  function attachThumbnail(element: HTMLSpanElement) {
    return measureThumbnail(element, ratio, (width) => (thumbnailWidth = width))
  }
  function attachScroll(element: HTMLDivElement) {
    return scrollViewport(element, {
      state: viewportState,
      initialize,
      index,
      kind: sheet?.kind,
      pdf: document,
      page: renderedPage,
      alignment,
      getIndex: () => index,
      getCount: () => count,
      getSheet: () => sheet,
      getZoom: () => zoom,
      setZoom: (next) => (zoom = next),
      getRegion: () => region,
      setRegion: (next) => (region = next),
      navigate,
    })
  }
  function attachPan(element: HTMLDivElement) {
    return panViewport(
      element,
      () => level,
      (active) => (panning = active),
    )
  }
  function attachInteract(element: HTMLElement) {
    return interactViewport(element, {
      state: viewportState,
      getSheet: () => sheet,
      getIndex: () => index,
      getZoom: () => zoom,
      setZoom: (next) => (zoom = next),
      getDocument: () => document,
      getRenderedPage: () => renderedPage,
      grid,
    })
  }
</script>

<section
  class={["page-view", { selected }]}
  style:--ratio={sheet ? ratio : undefined}
  data-controls={controls}
  data-face={index % 2 === 0 ? "front" : "back"}
  aria-label={`${pane} Page view`}
  {@attach attachInteract}
>
  <div class="page-reference" aria-hidden="true"><span {@attach attachThumbnail}></span></div>
  {#if heading}<div
      class="page-label inspection-heading"
      bind:clientHeight={null, measureHeading}
      {@attach attachHeading}
      title={index % 2 === 0 ? "Front side" : "Back side"}
    >
      {@render heading(fitWidth)}
    </div>{/if}
  <!-- Keyboard users need a focusable viewport for scrolling and page shortcuts. -->
  <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
  <div
    class={["page-scroll", { enlarged: level > 100, panning }]}
    role="region"
    aria-label="PDF viewport"
    aria-keyshortcuts={sheet
      ? `ArrowLeft ArrowRight ArrowUp ArrowDown N P PageUp PageDown Home End G V Control+A Meta+A Escape${copyable ? " Space" : ""} Plus = - 0 Z`
      : "V Control+A Meta+A Escape"}
    tabindex="0"
    style:--zoom={level / 100}
    {@attach attachScroll}
    {@attach attachPan}
  >
    {#if sheet?.kind === "pdf" && document}<Pdf
        pdf={document}
        page={renderedPage!}
        pageNumber={physicalPage! + 1}
        {name}
        {zoom}
        {thumbnailWidth}
        {magnification}
        {error}
      />
    {:else if sheet?.kind === "blank"}<div class="pdf-viewport" style:--ratio={sheet.size.width / sheet.size.height}>
        <div class="blank-sheet" style:--ratio={sheet.size.width / sheet.size.height}>
          <Icon name="blank" /><span>{sheet.padding ? "Padding" : "Blank"}</span>
        </div>
      </div>
    {:else}<div class="empty">
        <Icon name="output" />
        <h3>Your Output starts here.</h3>
        <p>Add selected pages to Output.</p>
      </div>{/if}
  </div>
  {#if sheet}
    <nav class="page-navigation" aria-label={`${pane} page navigation`}>
      <button
        class="icon-button"
        data-step="-1"
        aria-label={`Previous ${pane} page`}
        title={`Previous ${pane} page`}
        disabled={index === 0}
        onclick={() => navigate(-1)}
        ondragover={(event) => navigationOver?.(event, -1)}
        ondragleave={navigationLeave}><Icon name="previous" /></button
      >
      <div class="page-actions">
        {#if actions}{@render actions()}{/if}
      </div>
      <button
        class="icon-button"
        data-step="1"
        aria-label={`Next ${pane} page`}
        title={`Next ${pane} page`}
        disabled={index === count - 1}
        onclick={() => navigate(1)}
        ondragover={(event) => navigationOver?.(event, 1)}
        ondragleave={navigationLeave}><Icon name="next" /></button
      >
    </nav>
  {/if}
</section>
