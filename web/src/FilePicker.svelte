<!-- Renders the PDF file-open trigger button. -->

<script lang="ts">
  import Icon from "./Icon.svelte"

  let {
    label = "Open PDF",
    disabled = false,
    onFiles,
  }: {
    label?: string
    disabled?: boolean
    onFiles: (files: FileList) => void
  } = $props()
</script>

<label class="file-picker" title={label}
  ><Icon name="add" /><span>{label}</span><input
    type="file"
    aria-label={label}
    accept="application/pdf,.pdf"
    multiple
    {disabled}
    onchange={(event) => {
      if (event.currentTarget.files) onFiles(event.currentTarget.files)
      event.currentTarget.value = ""
    }}
  /></label
>
