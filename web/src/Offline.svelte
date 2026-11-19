<!-- Installs offline assets and coordinates application updates. -->

<script lang="ts">
  import { onMount } from "svelte"
  let {
    busy,
    updating = $bindable(false),
    status = $bindable(""),
    notify,
    error,
  }: {
    busy: boolean
    updating?: boolean
    status?: string
    notify: (text: string) => void
    error: (text: string) => void
  } = $props()
  let waiting = $state<ServiceWorker>()
  const updateReady = $derived(busy ? "Update ready. Download and close your PDF." : "Update ready.")
  const installFailed = "Offline setup failed. Reload this page in a moment. If it keeps failing, report it."
  function report(text: string, kind: "info" | "notice" | "error" = "info") {
    notify("")
    status = kind === "info" ? text : ""
    if (kind === "notice") notify(text)
    if (kind === "error") error(text)
  }
  const changed = () => {
    if (!busy && waiting) location.reload()
  }
  const message = (event: MessageEvent) => {
    if (event.data === "update-blocked") {
      updating = false
      report("Close other PDF Composer tabs before updating.", "error")
    }
  }
  onMount(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return
    let disposed = false
    let disconnect: (() => void) | undefined
    navigator.serviceWorker.addEventListener("controllerchange", changed)
    navigator.serviceWorker.addEventListener("message", message)
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((value) => {
        if (disposed) return
        let worker: ServiceWorker | undefined
        function stopWatching() {
          worker?.removeEventListener("statechange", stateChanged)
          worker = undefined
        }
        function stateChanged() {
          if (!worker) return
          if (["installed", "activating", "activated"].includes(worker.state)) {
            waiting = value.active && value.waiting === worker ? worker : undefined
            report(waiting ? updateReady : "PDF Composer is ready for offline use.", "notice")
          } else if (worker.state === "redundant") report(installFailed, "error")
          else return
          stopWatching()
        }
        function observe() {
          const next = value.installing ?? (!value.active ? value.waiting : null) ?? undefined
          if (worker === next) return
          stopWatching()
          worker = next
          worker?.addEventListener("statechange", stateChanged)
          stateChanged()
        }
        waiting = value.active ? (value.waiting ?? undefined) : undefined
        report(
          waiting ? updateReady : value.active ? "" : "Installing offline application…",
          waiting ? "notice" : "info",
        )
        value.addEventListener("updatefound", observe)
        disconnect = () => {
          value.removeEventListener("updatefound", observe)
          stopWatching()
        }
        observe()
      })
      .catch(() => {
        if (!disposed) report(installFailed, "error")
      })
    return () => {
      disposed = true
      disconnect?.()
      navigator.serviceWorker.removeEventListener("controllerchange", changed)
      navigator.serviceWorker.removeEventListener("message", message)
    }
  })
  function update() {
    if (busy || updating || !waiting) return
    updating = true
    report("Updating application…")
    try {
      waiting.postMessage("activate-idle", [])
    } catch {
      updating = false
      report("Application update failed. Reconnect and reload to retry.", "error")
    }
  }
</script>

{#if waiting}
  <button
    type="button"
    disabled={busy || updating}
    title={busy ? "Download and close your PDF before updating." : "Update PDF Composer"}
    onclick={update}>Update application</button
  >
{/if}
