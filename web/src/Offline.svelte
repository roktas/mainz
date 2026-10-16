<!-- Installs offline assets and coordinates application updates. -->
<script lang="ts">
  import { onMount } from "svelte";
  let {
    busy,
    updating = $bindable(false),
    notify,
    error,
  }: {
    busy: boolean;
    updating?: boolean;
    notify: (text: string) => void;
    error: (text: string) => void;
  } = $props();
  let waiting = $state<ServiceWorker>();
  let status = $state("");
  const updateReady = "An application update is ready. Download and close your PDF before updating.";
  function report(text: string, kind: "info" | "notice" | "error" = "info") {
    status = kind === "info" ? text : "";
    if (kind === "notice") notify(text);
    if (kind === "error") error(text);
  }
  const changed = () => {
    if (!busy && waiting) location.reload();
  };
  const message = (event: MessageEvent) => {
    if (event.data === "update-blocked") {
      updating = false;
      report("Close other PDF Studio tabs before updating.", "error");
    }
  };
  onMount(() => {
    if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
    let disposed = false;
    navigator.serviceWorker.addEventListener("controllerchange", changed);
    navigator.serviceWorker.addEventListener("message", message);
    navigator.serviceWorker
      .register(`${import.meta.env.BASE_URL}sw.js`)
      .then((value) => {
        if (disposed) return;
        waiting = value.waiting ?? undefined;
        report(
          waiting ? updateReady : value.active ? "" : "Installing offline application…",
          waiting ? "notice" : "info",
        );
        value.addEventListener("updatefound", () => {
          const worker = value.installing;
          worker?.addEventListener("statechange", () => {
            if (disposed) return;
            if (worker.state === "installed") {
              waiting = navigator.serviceWorker.controller ? worker : undefined;
              report(waiting ? updateReady : "PDF Studio is ready for offline use.", "notice");
            }
            if (worker.state === "redundant")
              report("Offline installation failed. The current application is retained.", "error");
          });
        });
      })
      .catch(() => {
        if (!disposed) report("Offline installation failed. Reconnect and reload to retry.", "error");
      });
    return () => {
      disposed = true;
      navigator.serviceWorker.removeEventListener("controllerchange", changed);
      navigator.serviceWorker.removeEventListener("message", message);
    };
  });
  function update() {
    if (busy || updating || !waiting) return;
    updating = true;
    report("Updating application…");
    try {
      waiting.postMessage("activate-idle", []);
    } catch {
      updating = false;
      report("Application update failed. Reconnect and reload to retry.", "error");
    }
  }
</script>

{#if status}<p class="offline" role="status">{status}</p>{/if}
{#if waiting}
  <button
    type="button"
    disabled={busy || updating}
    title={busy ? "Download and close your PDF before updating." : "Update PDF Studio"}
    onclick={update}>Update application</button
  >
{/if}
