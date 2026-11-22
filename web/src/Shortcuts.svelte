<!-- Renders keyboard shortcut, mouse, and touch reference panels for the Help dialog. -->

<script module lang="ts">
  export type Topic = "keyboard" | "mouse" | "touch"
  export type HelpContext = { pane: "Input" | "Output"; mode: "grid" | "list" | "page" | "style" }
  export type HelpModes = { Input: "grid" | "list" | "page" | "style"; Output: "grid" | "list" | "page" }
</script>

<script lang="ts">
  import Icon from "./Icon.svelte"

  let {
    id,
    topics,
    topic,
    contexts,
    hasInput,
    hasOutput,
    modes = $bindable(),
  }: {
    id: string
    topics: readonly Topic[]
    topic: Topic
    contexts: readonly HelpContext[]
    hasInput: boolean
    hasOutput: boolean
    modes: HelpModes
  } = $props()

  const panes = ["Input", "Output"] as const
</script>

{#snippet shortcutList(mode: "grid" | "list" | "page" | "style", pane: "Input" | "Output")}
  <h4>Navigate</h4>
  <dl class="shortcut-list">
    <div>
      <dt><kbd class="named">Alt/⌥</kbd> + <kbd>1</kbd> / <kbd>2</kbd> / <kbd>3</kbd></dt>
      <dd>Switch this pane to Grid / List / Page</dd>
    </div>
    <div>
      <dt><kbd class="named">Alt/⌥</kbd> + <kbd>V</kbd></dt>
      <dd>Return to the previous view in this pane</dd>
    </div>
    {#if mode === "style"}
      <div>
        <dt><kbd class="named">Tab</kbd></dt>
        <dd>Move to the next Style control</dd>
      </div>
      <div>
        <dt><kbd class="named">Shift</kbd> + <kbd class="named">Tab</kbd></dt>
        <dd>Move to the previous Style control</dd>
      </div>
    {:else}
      {#if mode === "grid"}<div>
          <dt><kbd>←</kbd> / <kbd>→</kbd></dt>
          <dd>Start at the first / last page (no selection)</dd>
        </div>{/if}
      <div>
        <dt><kbd>V</kbd></dt>
        <dd>
          {mode === "list" ? "Switch List / Page" : mode === "page" ? "Return to Grid or List" : "Switch Grid / Page"}
        </dd>
      </div>
      <div>
        <dt>
          <kbd>↑</kbd> <kbd>↓</kbd>{#if mode === "grid"}
            <kbd>←</kbd> <kbd>→</kbd>{/if}
        </dt>
        <dd>{mode === "page" ? "Scroll the image vertically" : "Move focus between pages"}</dd>
      </div>
      <div>
        <dt><kbd>N</kbd> / <kbd>P</kbd></dt>
        <dd>{mode === "page" ? "Show next / previous page" : "Focus next / previous page"}</dd>
      </div>
      <div>
        <dt><kbd class="named">Home</kbd> / <kbd class="named">End</kbd></dt>
        <dd>{mode === "page" ? "Show first / last page" : "Focus first / last page"}</dd>
      </div>
      <div>
        <dt><kbd class="named">PgUp</kbd> / <kbd class="named">PgDn</kbd></dt>
        <dd>
          {mode === "list"
            ? "Move one screen of rows"
            : mode === "grid"
              ? "Previous / next thumbnail group"
              : "Show previous / next page"}
        </dd>
      </div>
      {#if mode === "page"}
        <div>
          <dt><kbd>←</kbd> / <kbd>→</kbd></dt>
          <dd>Change page if width fits; otherwise scroll</dd>
        </div>
        <div>
          <dt><kbd>G</kbd></dt>
          <dd>Go to page</dd>
        </div>
      {/if}
    {/if}
    <div>
      <dt><kbd>?</kbd></dt>
      <dd>Open Help</dd>
    </div>
  </dl>
  {#if mode !== "style"}
    <h4>Select</h4>
    <dl class="shortcut-list">
      {#if mode !== "page"}
        <div>
          <dt><kbd class="named">Space</kbd></dt>
          <dd>{mode === "list" ? "Select or unselect page and advance" : "Select or unselect page"}</dd>
        </div>
        <div>
          <dt>
            <kbd class="named">Shift</kbd> + <kbd>{mode === "list" ? "↑" : "←"}</kbd> /
            <kbd>{mode === "list" ? "↓" : "→"}</kbd>
          </dt>
          <dd>Select / unselect pages</dd>
        </div>
        {#if mode === "list"}
          <div>
            <dt><kbd class="named">Shift</kbd> + <kbd class="named">Home</kbd> / <kbd class="named">End</kbd></dt>
            <dd>Extend selection to the first / last row</dd>
          </div>
          <div>
            <dt><kbd class="named">Shift</kbd> + <kbd class="named">PgUp</kbd> / <kbd class="named">PgDn</kbd></dt>
            <dd>Extend selection by one screen of rows</dd>
          </div>
        {/if}
      {/if}
      <div>
        <dt><kbd class="named">Ctrl/⌘</kbd> + <kbd>A</kbd></dt>
        <dd>Select all {pane} pages (outside fields)</dd>
      </div>
      <div>
        <dt><kbd class="named">Esc</kbd></dt>
        <dd>Close, cancel, or clear {pane} selection</dd>
      </div>
    </dl>
    <h4>Edit</h4>
    <dl class="shortcut-list">
      {#if mode === "page"}
        <div>
          <dt><kbd class="named">Space</kbd></dt>
          <dd>{pane === "Input" ? "Add the current page to Output" : "Duplicate the current page"}</dd>
        </div>
        <div>
          <dt><kbd>+</kbd> / <kbd>−</kbd></dt>
          <dd>Zoom in / out</dd>
        </div>
        <div>
          <dt><kbd>0</kbd> or <kbd>Z</kbd></dt>
          <dd>Reset zoom (100%)</dd>
        </div>
      {:else}
        <div>
          <dt>
            <kbd class="named">Enter</kbd> / <kbd>+</kbd>{#if mode === "list"}
              / <kbd>=</kbd>{/if}
          </dt>
          <dd>{pane === "Input" ? "Add pages to Output" : "Duplicate pages"}</dd>
        </div>
      {/if}
      {#if pane === "Output"}
        <div>
          <dt>
            <kbd class="named">Del</kbd>{#if mode !== "page"}
              / <kbd>−</kbd>{/if}
          </dt>
          <dd>Remove Output selection</dd>
        </div>
        <div>
          <dt>
            <kbd class="named">Ctrl/⌘</kbd> + <kbd>{mode === "list" ? "↑" : "←"}</kbd> /
            <kbd>{mode === "list" ? "↓" : "→"}</kbd>
          </dt>
          <dd>Move pages earlier / later</dd>
        </div>
      {/if}
      <div>
        <dt><kbd class="named">Enter</kbd></dt>
        <dd>
          {pane === "Input" ? "Add prepared pages from the page field" : "Remove selected pages from the page field"}
        </dd>
      </div>
    </dl>
  {:else}
    <dl class="shortcut-list">
      <div>
        <dt><kbd class="named">Esc</kbd></dt>
        <dd>Close an editor or menu</dd>
      </div>
    </dl>
  {/if}
{/snippet}

<div class="help-panels">
  {#if topics.includes("keyboard")}<div
      id={`${id}-help-keyboard-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-help-keyboard`}
      aria-hidden={topic !== "keyboard"}
      inert={topic !== "keyboard"}
      tabindex="0"
    >
      <div class="help-body">
        <div class="keyboard-panes">
          {#each panes as owner (owner)}
            {#if contexts.some((item) => item.pane === owner)}
              <section aria-label={`${owner} shortcuts`}>
                <h3>{owner}</h3>
                <span class="entry select">
                  <select aria-label={`${owner} shortcut view`} bind:value={modes[owner]}>
                    {#each contexts.filter((item) => item.pane === owner) as item (item.mode)}
                      <option value={item.mode}
                        >{item.mode === "grid"
                          ? "Grid"
                          : item.mode === "list"
                            ? "List"
                            : item.mode === "page"
                              ? "Page"
                              : "Style"}</option
                      >
                    {/each}
                  </select>
                  <Icon name="next" />
                </span>
                <div class="keyboard-contexts">
                  {#each contexts.filter((item) => item.pane === owner) as item (item.mode)}
                    <section
                      aria-label={`${item.pane} ${item.mode}`}
                      aria-hidden={modes[owner] !== item.mode}
                      inert={modes[owner] !== item.mode}
                    >
                      <div class="help-body">
                        {#if item.pane === "Input" || hasOutput}
                          {@render shortcutList(item.mode, item.pane)}
                        {:else}<p>Add Input pages to use Output page actions.</p>{/if}
                      </div>
                    </section>
                  {/each}
                </div>
              </section>
            {/if}
          {/each}
        </div>
      </div>
    </div>{/if}
  {#if topics.includes("mouse")}<div
      id={`${id}-help-mouse-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-help-mouse`}
      aria-hidden={topic !== "mouse"}
      inert={topic !== "mouse"}
      tabindex="0"
    >
      <div class="help-body">
        <table class="mouse-actions" aria-label="Mouse actions">
          <thead><tr><th scope="col">Action</th><th scope="col">Result</th></tr></thead>
          <tbody>
            <tr><td>Click a Page counter</td><td>Shows page details when available</td></tr>
            <tr><td>Click a Grid image or grip</td><td>Selects or unselects a page</td></tr>
            <tr
              ><td><kbd class="named">Ctrl</kbd> / <kbd>⌘</kbd> + click an image</td><td
                >Opens Page or returns to Grid or List</td
              ></tr
            >
            <tr
              ><td><kbd class="named">Shift</kbd> + click a Grid image or grip</td><td
                >Adds or removes a selection range</td
              ></tr
            >
            <tr><td>Double-click an Input Grid image</td><td>Adds prepared pages, or this page, to Output</td></tr>
            <tr><td>Double-click a Page image</td><td>Zooms to 200% at that point, or returns to 100%</td></tr>
            <tr><td>Drag an Input grip or Grid image</td><td>Adds pages to Output</td></tr>
            <tr><td>Drag an Output grip or Grid image</td><td>Moves Output pages</td></tr>
            <tr><td>Drag a Page image</td><td>Pans above 100% zoom</td></tr>
            <tr><td>Mouse wheel</td><td>Scrolls the page list or the enlarged Page image</td></tr>
            <tr><td>Click Reset zoom</td><td>Resets zoom to 100%</td></tr>
          </tbody>
        </table>
      </div>
    </div>{/if}
  {#if topics.includes("touch")}<div
      id={`${id}-help-touch-panel`}
      role="tabpanel"
      aria-labelledby={`${id}-help-touch`}
      aria-hidden={topic !== "touch"}
      inert={topic !== "touch"}
      tabindex="0"
    >
      <div class="help-body">
        <ul>
          <li>Tap a page image or grip to select it. The page field shows the same selection.</li>
          {#if hasInput}<li>Use the selection bar to add Input pages to Output.</li>{/if}
          {#if hasOutput}<li>Use the selection bar to move, copy, and remove Output pages.</li>{/if}
          <li>Page starts enlarged when the complete page would look narrow.</li>
          <li>Tap the zoom percentage to return to 100%. At 100%, tap it to fit the page to the width.</li>
          <li>
            Double-tap a Grid image to open Page. In Page, double-tap to zoom to 200% at that point, or return an
            enlarged page to 100%. Select the Grid or List tab to change the Pages layout without changing your
            selection.
          </li>
          <li>
            Drag pages from their grips. In Page, swipe left or right to change pages when the image fits horizontally.
            A wider image pans instead. Pinch to zoom, or hold to inspect with the lens.
          </li>
        </ul>
      </div>
    </div>{/if}
</div>
