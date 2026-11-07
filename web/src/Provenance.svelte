<!-- Identifies a workspace Input with a stable, theme-aware source color. -->

<script module lang="ts">
  const hues = [244.6048, 57.2598, 182.1362, 304.2437, 6.0676, 109.7692]
  function hue(index: number): number {
    while (hues.length <= index) {
      const sorted = hues.toSorted((a, b) => a - b)
      let gap = 0,
        start = 0
      for (let i = 0; i < sorted.length; i++) {
        const end = i + 1 < sorted.length ? sorted[i + 1] : sorted[0] + 360
        if (end - sorted[i] > gap) {
          gap = end - sorted[i]
          start = sorted[i]
        }
      }
      hues.push((start + gap / 2) % 360)
    }
    return hues[index]
  }
</script>

<script lang="ts">
  let { number, title, id }: { number: number; title: string; id?: string } = $props()
  const color = $derived(
    number <= 6
      ? `var(--source-${number - 1})`
      : `light-dark(oklch(55% 0.13 ${hue(number - 1)}), oklch(76% 0.13 ${hue(number - 1)}))`,
  )
</script>

<span
  class="provenance"
  {id}
  data-provenance={number}
  role="img"
  aria-label={`Input ${number}: ${title}`}
  {title}
  style:--source-color={color}><i aria-hidden="true"></i></span
>

<style>
  .provenance {
    --source-0: light-dark(oklch(54.9391% 0.137157 244.6048), oklch(72.1154% 0.121525 249.8488));
    --source-1: light-dark(oklch(59.6567% 0.138498 57.2598), oklch(78.6866% 0.128835 70.0123));
    --source-2: light-dark(oklch(55.3383% 0.099049 182.1362), oklch(76.825% 0.118295 183.2369));
    --source-3: light-dark(oklch(49.6494% 0.159464 304.2437), oklch(74.5467% 0.124378 301.8669));
    --source-4: light-dark(oklch(55.9008% 0.155295 6.0676), oklch(74.5403% 0.129517 359.3762));
    --source-5: light-dark(oklch(55.1036% 0.120118 109.7692), oklch(77.144% 0.125041 109.0047));
    display: inline-flex;
    flex: none;
    align-items: center;
  }
  i {
    display: block;
    flex: none;
    inline-size: 8px;
    block-size: 8px;
    border-radius: 50%;
    background: var(--source-color);
  }
  @media (forced-colors: active) {
    i {
      background: CanvasText;
    }
  }
</style>
