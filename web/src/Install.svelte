<!-- Keeps optional app installation guidance separate from the product tour. -->

<script lang="ts">
  import { onMount } from "svelte"
  import type { Snippet } from "svelte"
  import Icon from "./Icon.svelte"

  type Prompt = Event & {
    prompt: () => Promise<void>
    userChoice: Promise<{ outcome: "accepted" | "dismissed" }>
  }
  let {
    pending = $bindable(false),
    recommend,
    dismissed,
    children,
  }: {
    pending?: boolean
    recommend: boolean
    dismissed: () => void
    children: Snippet<[Snippet<[boolean]>]>
  } = $props()
  let dialog: HTMLDialogElement
  let prompt = $state<Prompt>()
  let ios = $state(false)
  let safari = $state(false)
  let standalone = $state(false)
  let requesting = $state(false)
  let message = $state("")
  let previous: Element | null = null

  function remember() {
    try {
      localStorage.setItem("mainz:installation", "seen")
    } catch {
      /* Dismissal lasts for this page when storage is unavailable. */
    }
  }
  function close() {
    remember()
    if (pending) dismissed()
    pending = false
    dialog.close()
  }
  function open() {
    previous = document.activeElement
    dialog.showModal()
  }
  async function install() {
    const request = prompt
    if (!request || requesting) return
    requesting = true
    try {
      await request.prompt()
      const choice = await request.userChoice
      message =
        choice.outcome === "accepted"
          ? "Installation requested. You can continue in this browser."
          : "You can continue in this browser."
      remember()
    } catch {
      message = "Installation is unavailable. You can continue in this browser."
    } finally {
      prompt = undefined
      requesting = false
    }
  }
  function offered(event: Event) {
    event.preventDefault()
    prompt = event as Prompt
  }
  function installed() {
    message = "App installed."
    prompt = undefined
    remember()
    pending = false
    if (dialog.open) close()
  }
  onMount(() => {
    ios =
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
    safari =
      !ios &&
      /Macintosh/.test(navigator.userAgent) &&
      Number(navigator.userAgent.match(/Version\/(\d+).*Safari/)?.[1]) >= 17
    const mode = matchMedia("(display-mode: standalone)")
    const update = () => {
      standalone = mode.matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
      if (standalone && dialog.open) {
        pending = false
        close()
      }
    }
    update()
    let seen = false
    try {
      seen = localStorage.getItem("mainz:installation") === "seen"
    } catch {
      /* First-visit guidance remains dismissible without persistent storage. */
    }
    if (recommend && ios && !standalone && !seen) {
      pending = true
      open()
    }
    window.addEventListener("beforeinstallprompt", offered)
    window.addEventListener("appinstalled", installed)
    mode.addEventListener("change", update)
    return () => {
      window.removeEventListener("beforeinstallprompt", offered)
      window.removeEventListener("appinstalled", installed)
      mode.removeEventListener("change", update)
    }
  })
</script>

{#snippet content(intro: boolean)}
  {#if standalone}<p>PDF Composer is running in its own app window.</p>
  {:else}
    <p>Open PDF Composer in its own window, with more room for your pages. You can also keep using this browser.</p>
    {#if ios}<p>In Safari, choose Share, then Add to Home Screen. Open the saved icon to use the app.</p>
    {:else if safari}<p>If Safari offers File → Add to Dock, choose it to save the app.</p>
    {:else if !prompt}<p>
        This browser has not offered installation. Continue in the browser, or check its app installation menu.
      </p>{/if}
  {/if}
  {#if message}<p role="status">{message}</p>{/if}
  {#if intro || (prompt && !standalone)}<div class="installation-actions">
      {#if intro}<button class="primary" onclick={close}>Continue in browser</button>{/if}
      {#if prompt && !standalone}<button onclick={install} disabled={requesting}>Install app</button>{/if}
    </div>{/if}
{/snippet}

<dialog
  bind:this={dialog}
  class="installation"
  aria-labelledby="installation-title"
  closedby="any"
  onclose={() => {
    remember()
    if (pending) dismissed()
    pending = false
    if (previous instanceof HTMLElement && previous.isConnected) previous.focus({ preventScroll: true })
  }}
>
  <div class="dialog-heading">
    <h2 id="installation-title">Install app</h2>
    <button class="icon-button" aria-label="Close installation help" onclick={close}><Icon name="close" /></button>
  </div>
  {@render content(true)}
</dialog>
{@render children(content)}

<style>
  .installation {
    inline-size: min(30rem, calc(100vi - 2 * var(--gap)));
  }
  .dialog-heading {
    align-items: center;
    & h2 {
      min-inline-size: 0;
      overflow-wrap: anywhere;
    }
  }
  p + p {
    margin-block-start: var(--gap);
  }
  .installation-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap);
    margin-block-start: var(--gap);
    & button {
      min-inline-size: 0;
      max-inline-size: 100%;
      white-space: normal;
    }
  }
</style>
