<!-- Renders the front or back sheet side indicator for a page. -->

<script lang="ts">
  let { index }: { index: number } = $props()
  const front = $derived(index % 2 === 0)
</script>

<span
  class="page-face"
  role="img"
  aria-label={front ? "Front side" : "Back side"}
  title={front ? "Front side" : "Back side"}
>
  {#if !front}<svg class="page-fold" viewBox="0 0 24 24" aria-hidden="true">
      <path class="fold-fill" d="M0 1Q0 0 1 1L23 23Q24 24 23 24H6A6 6 0 0 1 0 18Z" vector-effect="non-scaling-stroke" />
      <path class="fold-edge" d="M0 0V18A6 6 0 0 0 6 24H24" vector-effect="non-scaling-stroke" />
    </svg>{/if}
</span>
