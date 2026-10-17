<!-- Controls lens magnification and shows application details. -->

<script lang="ts">
  import Icon from "./Icon.svelte"
  let {
    magnification = $bindable(16),
  }: {
    magnification?: 8 | 16 | 32
  } = $props()
  let settingsDialog: HTMLDialogElement
</script>

<button
  class="icon-button settings-button"
  aria-label="Settings"
  title="Settings"
  aria-haspopup="dialog"
  onclick={() => settingsDialog.showModal()}><Icon name="settings" /></button
>

<dialog bind:this={settingsDialog} class="settings-drawer" aria-labelledby="settings-title" closedby="any">
  <div class="dialog-heading">
    <h2 id="settings-title">Settings</h2>
    <button class="icon-button" aria-label="Close Settings" onclick={() => settingsDialog.close()}
      ><Icon name="close" /></button
    >
  </div>
  <fieldset class="magnification-options">
    <legend>Lens magnification</legend>
    {#each [8, 16, 32] as level (level)}
      <label><input type="radio" name="magnification" value={level} bind:group={magnification} />{level}×</label>
    {/each}
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
