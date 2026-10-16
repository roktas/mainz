<!-- Embeds the application logo with unique SVG IDs and the current theme. -->
<script lang="ts">
  import svg from "../public/logo.svg?raw";

  const id = $props.id();
  // Use the page palette instead of cached SVG document styles.
  const logo = svg
    .replace(/<style>[\s\S]*?<\/style>/, "")
    .replace("<svg ", '<svg class="logo" aria-hidden="true" ')
    .replaceAll('id="', `id="${id}-`)
    .replaceAll('href="#', `href="#${id}-`);
</script>

{@html logo}
