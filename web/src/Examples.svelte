<!-- Offers demo and welcome choices without an address bar. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"

  let { navigate, workspace }: { navigate: (event: MouseEvent) => void; workspace: boolean } = $props()
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
      <strong>Single demo</strong><span>Open a sample PDF with pages already arranged in Output.</span>
    </a>
    <a href="?demo=grid" onclick={navigate}>
      <strong>Large demo</strong><span>Explore a larger workspace with 240 pages.</span>
    </a>
    <a href={`${import.meta.env.BASE_URL}?demo=toc`} onclick={navigate}>
      <strong>TOC demo</strong><span>Explore section navigation and page titles in Input and Output.</span>
    </a><a href={`${import.meta.env.BASE_URL}?demo=toc-multiple`} onclick={navigate}
      ><strong>TOCs demo</strong><span>Explore page provenance with two PDFs.</span></a
    >
    <a href="?demo=recipe" onclick={navigate}>
      <strong>Recipe demo</strong><span>Match three sample PDFs to a saved recipe.</span>
    </a>
    <a href="?demo=empty" onclick={navigate}>
      <strong>Empty demo</strong><span>Use the same sample and choose the pages yourself.</span>
    </a>
    {#if workspace}
      <a href="?demo=empty&reset" onclick={navigate}>
        <strong>Welcome screen</strong><span>Start with the sample and revisit the introduction.</span>
      </a>
    {/if}
  </nav>
</dialog>
