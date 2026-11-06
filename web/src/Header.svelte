<!-- Owns header feedback priority, report lifetime, and placement above modal surfaces. -->

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { Source } from "./model.ts"
  import Feedback from "./Feedback.svelte"
  import type { Report } from "./Feedback.svelte"
  import Icon from "./Icon.svelte"
  let {
    active = $bindable(false),
    notice = $bindable(""),
    failure = $bindable(""),
    loading,
    openingStatus,
    matching,
    offlineStatus,
    exportStatus,
    processingSource,
    failedSources,
    downloadError,
    cancelOpen,
    cancelExport,
    cancelStyle,
    retry,
  }: {
    active?: boolean
    notice?: string
    failure?: string | string[]
    loading: boolean
    openingStatus: string
    matching: boolean
    offlineStatus: string
    exportStatus: string
    processingSource?: Source
    failedSources: readonly Source[]
    downloadError?: string
    cancelOpen: () => void
    cancelExport: () => void
    cancelStyle: () => void
    retry: (id: string) => void
  } = $props()
  const timers = new Set<ReturnType<typeof setTimeout>>()
  let noticeTimer: ReturnType<typeof setTimeout> | undefined
  export function notify(text: string) {
    clearTimeout(noticeTimer)
    notice = text
    if (text) noticeTimer = setTimeout(() => (notice = ""), 10000)
  }
  let reports = $state.raw<Report[]>([])
  const activeReport = $derived(
    reports.findLast((item) => item.kind === "progress") ??
      reports.findLast((item) => item.kind === "error") ??
      reports.at(-1),
  )
  export function report(item: Report) {
    reports = [...reports, item]
    const remove = () => {
      reports = reports.filter((entry) => entry !== item)
      if (timer) timers.delete(timer)
    }
    const timer = item.kind === "notice" && !item.actions && !item.children ? setTimeout(remove, 10000) : undefined
    if (timer) timers.add(timer)
    return () => {
      clearTimeout(timer)
      remove()
    }
  }
  const headerError = $derived(!!(failure || failedSources.length || downloadError || activeReport?.kind === "error"))
  const headerBusy = $derived(!!(loading || processingSource || offlineStatus || exportStatus))
  const visible = $derived(!!(headerError || headerBusy || notice || activeReport))
  $effect(() => {
    active = visible
  })
  onDestroy(() => {
    clearTimeout(noticeTimer)
    for (const timer of timers) clearTimeout(timer)
  })
  function present(element: HTMLDivElement) {
    const marker = document.createComment("Header feedback")
    element.before(marker)
    function place() {
      const modal = [...document.querySelectorAll<HTMLDialogElement>("dialog:modal")].at(-1)
      const editor = document.querySelector<HTMLElement>(".filename-panel:popover-open")
      const parent = editor ?? modal ?? marker.parentElement!
      if (element.parentElement !== parent) {
        element.hidePopover()
        if (editor || modal) parent.append(element)
        else marker.after(element)
      }
      if (!element.matches(":popover-open")) element.showPopover()
    }
    const observer = new MutationObserver(place)
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ["open"] })
    const toggle = (event: Event) => {
      if (event.target instanceof Element && event.target.matches(".filename-panel")) place()
    }
    document.addEventListener("toggle", toggle, true)
    place()
    return () => {
      document.removeEventListener("toggle", toggle, true)
      observer.disconnect()
      element.remove()
      marker.remove()
    }
  }
</script>

{#snippet dismissReport()}<button
    type="button"
    aria-label={activeReport?.kind === "error" ? "Dismiss error" : "Dismiss notification"}
    onclick={() => (reports = reports.filter((item) => item !== activeReport))}>Dismiss</button
  >{/snippet}
{#if visible}
  <div class="header-feedback" popover="manual" {@attach present}>
    {#if exportStatus}<Feedback kind="progress" text={exportStatus}>
        {#snippet actions()}<button
            type="button"
            class="icon-button"
            aria-label="Cancel"
            title="Cancel"
            onclick={cancelExport}><Icon name="close" /></button
          >{/snippet}
      </Feedback>{:else if loading}<Feedback
        kind="progress"
        class="opening-progress"
        text={openingStatus}
        summary={matching ? "Opening recipe…" : "Opening PDF…"}
      >
        {#snippet actions()}<button
            type="button"
            class="icon-button"
            aria-label="Cancel"
            title="Cancel"
            onclick={cancelOpen}><Icon name="close" /></button
          >{/snippet}
      </Feedback>{:else if processingSource}<Feedback
        kind="progress"
        class="style-progress"
        text={`Updating styles · ${processingSource.input.name}`}
        summary="Updating styles…"
      >
        {#snippet actions()}<button
            type="button"
            class="icon-button"
            aria-label="Cancel style processing"
            title="Cancel"
            onclick={cancelStyle}><Icon name="close" /></button
          >{/snippet}
      </Feedback>{:else if offlineStatus}<Feedback
        kind="progress"
        class="offline-progress"
        text={offlineStatus}
      />{:else if activeReport && (activeReport.kind === "progress" || activeReport.kind === "error" || !headerError)}<Feedback
        {...activeReport}
        actions={activeReport?.actions ??
          (activeReport?.kind === "progress" || activeReport?.children ? undefined : dismissReport)}
      />{:else if failure}<Feedback
        kind="error"
        text={Array.isArray(failure) ? `${failure.length} ${failure.length === 1 ? "file" : "files"} failed` : failure}
        details={Array.isArray(failure) ? failure : undefined}
        summary={typeof failure === "string" && failure.length > 80 ? "Action failed." : undefined}
      >
        {#snippet actions()}<button type="button" aria-label="Dismiss error" onclick={() => (failure = "")}
            >Dismiss</button
          >{/snippet}
      </Feedback>{:else if downloadError && !failedSources.length}<Feedback
        kind="error"
        text={downloadError}
        summary="Check Output Inputs."
      />{:else if failedSources.length}{#each failedSources.slice(0, 1) as source (source.id)}<Feedback
          kind="error"
          text={`${source.input.name}: ${source.preview.error} The last completed preview is shown.`}
          summary="Style update failed."
        >
          {#snippet actions()}<button
              type="button"
              aria-label="Retry Input styles"
              title="Retry styles"
              onclick={() => retry(source.id)}>Retry</button
            >{/snippet}
        </Feedback>{/each}{:else if notice}<Feedback kind="notice" class="notice" text={notice}>
        {#snippet actions()}<button type="button" aria-label="Dismiss notification" onclick={() => notify("")}
            >Dismiss</button
          >{/snippet}
      </Feedback>{/if}
  </div>
{/if}
