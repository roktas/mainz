<!-- Renders the application masthead, status header, help/settings controls, and demo progress banner. -->

<script lang="ts">
  import { onDestroy } from "svelte"
  import type { Source } from "./model.ts"
  import type { Magnification } from "./Lens.svelte"
  import type { TourStep } from "./Tour.svelte"
  import Feedback from "./Feedback.svelte"
  import Header from "./Header.svelte"
  import Help from "./Help.svelte"
  import Icon from "./Icon.svelte"
  import Logo from "./Logo.svelte"
  import Scroll from "./Scroll.svelte"
  import Settings from "./Settings.svelte"
  import Theme from "./Theme.svelte"

  let {
    header = $bindable(),
    headerActive = $bindable(false),
    notice = $bindable(""),
    failure = $bindable(""),
    help = $bindable(),
    magnification = $bindable(16),
    logoReplay = $bindable(0),
    loading,
    openingStatus,
    openingSummary,
    offlineStatus,
    exportStatus,
    processingSource,
    failedSources,
    downloadError,
    demoLoading,
    landing,
    unsaved,
    hasInput,
    hasOutput,
    workspace,
    styleable,
    hasProfiles,
    onboarding,
    views,
    firstAction,
    notify,
    cancelOpen,
    cancelExport,
    cancelStyle,
    retry,
    home,
    showExamples,
    onTourChange,
    onHint,
  }: {
    header?: ReturnType<typeof Header>
    headerActive?: boolean
    notice?: string
    failure?: string | string[]
    help?: ReturnType<typeof Help>
    magnification?: Magnification
    logoReplay?: number
    loading: boolean
    openingStatus: string
    openingSummary?: string
    offlineStatus: string
    exportStatus: string
    processingSource?: Source
    failedSources: readonly Source[]
    downloadError?: string
    demoLoading: boolean
    landing: boolean
    unsaved: boolean
    hasInput: boolean
    hasOutput: boolean
    workspace: boolean
    styleable: boolean
    hasProfiles: boolean
    onboarding: boolean
    views: () => { input: "grid" | "list" | "page" | "style"; output: "grid" | "list" | "page" }
    firstAction: string
    notify: (text: string, details?: string) => void
    cancelOpen: () => void
    cancelExport: () => void
    cancelStyle: () => void
    retry: (id: string) => void
    home: () => Promise<void>
    showExamples: () => void
    onTourChange: (step?: TourStep) => void
    onHint: (show: boolean) => void
  } = $props()

  let logoClicks = 0
  let logoTimer: ReturnType<typeof setTimeout> | undefined

  function logo(event: MouseEvent) {
    if (event.button || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return
    event.preventDefault()
    clearTimeout(logoTimer)
    logoClicks++
    logoTimer = setTimeout(() => {
      const clicks = logoClicks
      logoClicks = 0
      if (clicks >= 3) {
        showExamples()
        return
      }
      if (clicks === 2 || landing) {
        logoReplay++
        return
      }
      if (unsaved && !confirm("Return home? Input style changes and Output choices have not been downloaded.")) return
      void home()
    }, 400)
  }

  onDestroy(() => {
    clearTimeout(logoTimer)
  })
</script>

<header class="masthead">
  <div class="header-inner" data-feedback={headerActive || undefined}>
    <a
      class="brand"
      href={import.meta.env.BASE_URL}
      aria-label="PDF Composer home"
      title="Home"
      data-replay={logoReplay > 0 || undefined}
      onclick={logo}
      >{#key logoReplay}<Logo />{/key}</a
    >
    <Header
      bind:this={header}
      bind:active={headerActive}
      bind:notice
      bind:failure
      {loading}
      {openingStatus}
      {openingSummary}
      {offlineStatus}
      {exportStatus}
      {processingSource}
      {failedSources}
      {downloadError}
      {cancelOpen}
      {cancelExport}
      {cancelStyle}
      {retry}
    />
    <div class="header-actions">
      <span class="header-note" title="Processed on your device. No uploads."><Icon name="lock" />On your device</span
      ><Help
        bind:this={help}
        {hasInput}
        {hasOutput}
        {styleable}
        {hasProfiles}
        {views}
        {onboarding}
        dismissed={() =>
          notify(
            "Install in Settings.",
            "Open Settings and choose Install application whenever you want to install PDF Composer.",
          )}
        change={onTourChange}
        hint={onHint}
      /><Settings bind:magnification {workspace} {hasInput} install={() => help?.showInstallation()} /><Theme />
    </div>
  </div>
</header>
<Scroll />
<Feedback header kind="progress" active={demoLoading && landing} text="Loading demo…">
  {#snippet actions()}<button
      type="button"
      class="icon-button"
      aria-label="Cancel demo"
      title="Cancel"
      onclick={cancelOpen}><Icon name="close" /></button
    >{/snippet}
</Feedback>
