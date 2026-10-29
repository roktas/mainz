<!-- Controls lens magnification and shows application details. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  import { dismiss } from "./dismiss.ts"
  import { magnificationLevels } from "./Lens.svelte"
  import type { Magnification } from "./Lens.svelte"
  let {
    magnification = $bindable(16),
  }: {
    magnification?: Magnification
  } = $props()
  const index = $derived(magnificationLevels.indexOf(magnification))
  let settingsDialog: HTMLDialogElement
  let pointer = false
</script>

<button
  class="icon-button settings-button"
  aria-label="Settings"
  title="Settings"
  aria-haspopup="dialog"
  onpointerdown={() => (pointer = true)}
  onkeydown={() => (pointer = false)}
  onclick={() => {
    settingsDialog.showModal()
    if (pointer) settingsDialog.focus({ preventScroll: true })
    pointer = false
  }}><Icon name="settings" /></button
>

<dialog
  bind:this={settingsDialog}
  class="settings-drawer"
  aria-labelledby="settings-title"
  closedby="any"
  {@attach dismiss}
>
  <div class="dialog-heading">
    <h2 id="settings-title">Settings</h2>
    <button class="icon-button" aria-label="Close Settings" onclick={() => settingsDialog.close()}
      ><Icon name="close" /></button
    >
  </div>
  <fieldset class="magnification">
    <legend>Lens magnification</legend>
    <output aria-label="Lens magnification">{magnification}×</output>
    <button
      class="icon-button"
      aria-label="Decrease lens magnification"
      title="Halve lens magnification"
      disabled={index === 0}
      onclick={() => (magnification = magnificationLevels[index - 1]!)}>−</button
    >
    <button
      class="icon-button"
      aria-label="Increase lens magnification"
      title="Double lens magnification"
      disabled={index === magnificationLevels.length - 1}
      onclick={() => (magnification = magnificationLevels[index + 1]!)}>+</button
    >
  </fieldset>
  <section class="about" aria-labelledby="about-title">
    <div class="dialog-heading">
      <h3 id="about-title">PDF Composer</h3>
      <a
        class="icon-button"
        href="https://github.com/roktas/mainz"
        target="_blank"
        rel="noopener noreferrer"
        aria-label="Mainz on GitHub (opens in a new tab)"
        title="Mainz on GitHub"><Icon name="github" /></a
      >
    </div>
    <dl>
      <div>
        <dt>Version</dt>
        <dd>{import.meta.env.VERSION}</dd>
      </div>
      <div>
        <dt>Build ID</dt>
        <dd>
          <time
            datetime={import.meta.env.BUILD_TIME}
            title={`Build ID: Europe/Istanbul · Built ${import.meta.env.BUILD_TIME} (UTC)${import.meta.env.BUILD_REVISION ? ` · Git ${import.meta.env.BUILD_REVISION}` : ""}`}
            >{import.meta.env.BUILD_ID}</time
          >
        </dd>
      </div>
    </dl>
  </section>
</dialog>
