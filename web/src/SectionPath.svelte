<!-- Renders section hierarchy jump controls inside page origin details. -->

<script lang="ts">
  import type { Section } from "./sections.ts"
  import type { Output } from "./output.svelte.ts"
  import type { PaneName } from "./editing.svelte.ts"

  let {
    id,
    pane,
    paths,
    output,
    jump,
  }: {
    id: string
    pane: PaneName
    paths: readonly (readonly Section[])[]
    output?: Output
    jump: (sectionId: number) => void
  } = $props()
</script>

<div {id} class="section-path" role="group" aria-labelledby={`${id}-title`}>
  <header><h3 id={`${id}-title`}>Jump to section</h3></header>
  {#each paths as path, index (index)}
    <ol>
      {#each path as node, depth (node.id)}
        {@const content = pane === "Output" ? output?.pages[node.start]?.content : undefined}
        {@const physical = content && "source" in content ? content.page + 1 : node.start + 1}
        <li aria-current={depth === path.length - 1 ? "step" : undefined}>
          <button
            type="button"
            class="path-step"
            aria-label={`Go to section: ${node.path.join(" › ")}`}
            onclick={(event) => {
              event.currentTarget.closest<HTMLElement>("[popover]")?.hidePopover()
              jump(node.id)
            }}
            ><span class="path-level" aria-hidden="true">{depth + 1}</span><span
              class="path-page"
              aria-label={`Physical page ${physical}`}>{physical}</span
            ><span class:synthetic={node.synthetic}>{node.path.at(-1)}</span></button
          >
        </li>
      {/each}
    </ol>
  {/each}
</div>
