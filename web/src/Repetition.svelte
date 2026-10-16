<!-- Edits whole-sequence repetitions and front-face alignment. -->
<script lang="ts">
  import { copyError, maxCopies } from "./model.ts";
  import Icon from "./Icon.svelte";

  let {
    pane,
    value = $bindable(),
    front = $bindable(false),
  }: {
    pane: "Input" | "Output";
    value: string;
    front?: boolean;
  } = $props();
  const id = $props.id();
  const error = $derived(copyError(value));
  const label = $derived(pane === "Input" ? "selection" : "Output");
  const initial = $derived(pane === "Input" ? "1" : "2");
</script>

<label for={id}>{pane === "Input" ? "Repetitions" : "Repeat selected sequence"}</label>
<div class={["entry", { invalid: !!error }]}>
  <button
    class="step"
    aria-label={`Fewer ${label} repetitions`}
    disabled={!!error || Number(value) <= 1}
    onclick={() => (value = String(Number(value) - 1))}>−</button
  >
  <input {id} inputmode="numeric" bind:value aria-invalid={!!error} />
  <button
    class="step"
    aria-label={`More ${label} repetitions`}
    disabled={!!error || Number(value) >= maxCopies}
    onclick={() => (value = String(Number(value) + 1))}>+</button
  >
  <button
    class="reset"
    aria-label={`Reset ${label} repetitions`}
    disabled={value === initial}
    onclick={() => (value = initial)}><Icon name="reset" /></button
  >
</div>
{#if error}<p class="error" role="alert">{error}</p>{/if}
<label class="align"><input type="checkbox" bind:checked={front} />Start each repeat on front</label>
<p>
  {pane === "Input"
    ? "Repeats the full order, including copies. Alignment adds visible Blank pages for duplex printing."
    : "The repetition count includes the current sequence. Two repetitions add one more copy."}
</p>
