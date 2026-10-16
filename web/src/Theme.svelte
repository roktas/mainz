<!-- Switches the page theme and keeps the browser tint in sync. -->
<script lang="ts">
  import { onMount } from "svelte";
  function tint() {
    const theme = document.documentElement.dataset.theme;
    const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content = dark ? "#e5c39c" : "#800080";
  }
  onMount(() => {
    const system = matchMedia("(prefers-color-scheme: dark)");
    tint();
    system.addEventListener("change", tint);
    return () => system.removeEventListener("change", tint);
  });
  function toggle() {
    const theme = document.documentElement.dataset.theme;
    const dark = theme === "dark" || (theme !== "light" && matchMedia("(prefers-color-scheme: dark)").matches);
    const next = dark ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    tint();
    try {
      localStorage.setItem("mainz:theme", next);
    } catch {
      /* Theme selection also works without storage. */
    }
  }
</script>

<button type="button" class="theme" aria-label="Toggle theme" title="Toggle dark/light mode" onclick={toggle}>
  <svg class="light-icon" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="6" fill="currentColor" />
    <path
      d="m5.6 5.6-2.1-2.1m15 2.1 2.1-2.1m-15 15-2.1 2.1m15-2.1 2.1 2.1M12 4V2.8m0 17.2v1.2M4 12H2.8m17.2 0h1.2"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    />
  </svg>
  <svg
    class="dark-icon"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2"
    stroke-linecap="round"
    stroke-linejoin="round"
    aria-hidden="true"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79Z" />
  </svg>
</button>
