<!-- Coordinates Help dialog, shortcut reference, onboarding welcome, tour, and installation. -->

<script lang="ts">
  import { tick } from "svelte"
  import { MediaQuery } from "svelte/reactivity"
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"
  import Install from "./Install.svelte"
  import Feedback from "./Feedback.svelte"
  import Tour from "./Tour.svelte"
  import type { TourStep } from "./Tour.svelte"
  import Shortcuts from "./Shortcuts.svelte"
  import type { HelpModes, Topic } from "./Shortcuts.svelte"
  import Welcome from "./Welcome.svelte"
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
  const fine = new MediaQuery("(any-pointer: fine)")
  const coarse = new MediaQuery("(any-pointer: coarse)")
  const workspace = $derived(hasInput || hasOutput)
  const topics = $derived<Topic[]>([
    ...(workspace && fine.current ? (["keyboard", "mouse"] as const) : []),
    ...(workspace && coarse.current ? (["touch"] as const) : []),
  ])
  const labels = { keyboard: "Keyboard", mouse: "Mouse", touch: "Touch" }
  let installationPending = $state(false)
  let installation: ReturnType<typeof Install>
  const guidance = $derived(onboarding && !installationPending)
  let help: HTMLDialogElement
  let modes = $state<HelpModes>({ Input: "grid", Output: "grid" })
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
  let welcome: ReturnType<typeof Welcome>
  let touring = $state(false)
  let helpButton: HTMLButtonElement

  async function start() {
    welcome.stopHint()
    welcome.close()
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
    welcome.stopHint()
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
</script>

<svelte:window
  onkeydown={(event) => {
    if (shortcut(event, shortcutContext(event), "help") !== "help") return
    event.preventDefault()
    showHelp()
  }}
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

<Install bind:this={installation} bind:pending={installationPending} recommend={onboarding} {dismissed} />
<dialog bind:this={help} class="help-dialog" aria-label="Help" closedby="any" {@attach dismiss}>
  <div class="dialog-heading">
    <h2>Help</h2>
    <button class="icon-button" aria-label="Close help" onclick={() => help.close()}><Icon name="close" /></button>
  </div>
  <Feedback kind="notice" class="help-screencasts">
    <p>
      <a href={`${import.meta.env.BASE_URL}help/`}>Watch the screencasts</a> for a quick introduction to the app.
      {#if !workspace}<span class="help-opening">Open a PDF to see its keyboard, mouse, and touch controls.</span>{/if}
    </p>
  </Feedback>
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
    <Shortcuts {id} {topics} {topic} {contexts} {hasInput} {hasOutput} bind:modes />
  {/if}
</dialog>

<Welcome
  bind:this={welcome}
  {id}
  {guidance}
  {hasInput}
  {hasOutput}
  {touring}
  helpOpen={() => help.open}
  onStartTour={start}
  {hint}
/>

<Tour
  bind:this={tour}
  bind:active={touring}
  {hasInput}
  {hasOutput}
  {styleable}
  {hasProfiles}
  {change}
  restore={restoreTourFocus}
  ended={() => void welcome.suggest()}
/>
