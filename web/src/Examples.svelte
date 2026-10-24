<!-- Offers demo and welcome choices without an address bar. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"

  let { navigate }: { navigate: (event: MouseEvent) => void } = $props()
  let dialog: HTMLDialogElement

  export function show() {
    dialog.showModal()
  }
</script>

<dialog class="examples" bind:this={dialog} aria-labelledby="examples-title" closedby="any" {@attach dismiss}>
  <div class="dialog-heading">
    <h2 id="examples-title">Explore the app</h2>
    <button class="icon-button" aria-label="Close examples" onclick={() => dialog.close()}><Icon name="close" /></button
    >
  </div>
  <nav aria-label="Examples">
    <a href="?demo" onclick={navigate}>
      <strong>Try the demo</strong><span>Open a sample PDF with pages already arranged in Output.</span>
    </a>
    <a href="?demo=empty" onclick={navigate}>
      <strong>Start with empty Output</strong><span>Use the same sample and choose the pages yourself.</span>
    </a>
    <a href="?demo=empty&reset" onclick={navigate}>
      <strong>Show the welcome again</strong><span>Start with the sample and revisit the introduction.</span>
    </a>
  </nav>
</dialog>
