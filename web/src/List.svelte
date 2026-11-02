<!-- Displays page rows with the pane's shared cursor, selection, and page actions. -->

<script lang="ts">
  import { tick, untrack } from "svelte"
  import type { Snippet } from "svelte"
  import { shortcut, shortcutContext } from "./keyboard.ts"

  let {
    pane,
    count,
    pages,
    position = $bindable(0),
    select,
    edit,
    children,
  }: {
    pane: "Input" | "Output"
    count: number
    pages?: readonly number[]
    position?: number
    select: (position: number, range: boolean, anchor?: number) => void
    edit: (action: "add" | "duplicate" | "remove", position: number) => boolean
    children: Snippet
  } = $props()
  const cursor = $derived(pages ? pages.indexOf(position) : position)

  function reveal(element: HTMLElement) {
    element.addEventListener("keydown", keys)
    $effect(() => {
      const index = position
      untrack(() => element.querySelector<HTMLElement>(`[data-page="${index}"]`)?.scrollIntoView({ block: "nearest" }))
    })
    return () => element.removeEventListener("keydown", keys)
  }
  async function keys(event: KeyboardEvent) {
    if (!(event.target instanceof HTMLElement)) return
    if (!event.target.matches(".list-choice, .page-list")) return
    const action = shortcut(event, shortcutContext(event, { pane, view: "list" }), "list")
    if (action === "suppress") {
      event.preventDefault()
      return
    }
    if (!action || !count) return
    const element = event.currentTarget as HTMLElement
    const index = Math.max(0, cursor)
    position = pages?.[index] ?? index
    if (action === "add" || action === "duplicate" || action === "remove") {
      event.preventDefault()
      if (!event.repeat) edit(action, position)
      return
    }
    if (
      ![
        "copy",
        "left",
        "right",
        "up",
        "down",
        "first",
        "last",
        "previous",
        "next",
        "batchPrevious",
        "batchNext",
      ].includes(action)
    )
      return
    event.preventDefault()
    if (action === "copy" && event.repeat) return
    if (action === "copy") select(position, false)
    const row = element.querySelector<HTMLElement>(`[data-page="${position}"]`)?.closest("li"),
      stride = Math.max(1, Math.floor(element.clientHeight / (row?.getBoundingClientRect().height || 44)))
    const next =
      action === "first"
        ? 0
        : action === "last"
          ? count - 1
          : Math.max(
              0,
              Math.min(
                count - 1,
                index +
                  (action === "batchPrevious"
                    ? -stride
                    : action === "batchNext"
                      ? stride
                      : ["left", "up", "previous"].includes(action)
                        ? -1
                        : 1),
              ),
            )
    const anchor = position
    position = pages?.[next] ?? next
    if (event.shiftKey && !["next", "previous"].includes(action)) select(position, true, anchor)
    await tick()
    element.querySelector<HTMLElement>(`[data-page="${position}"]`)?.focus()
  }
</script>

<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
<ul
  class="page-list"
  aria-label={`${pane} page list`}
  aria-keyshortcuts={`ArrowUp ArrowDown Home End PageUp PageDown N P Space Enter V Control+A Meta+A Shift+ArrowUp Shift+ArrowDown Plus${pane === "Output" ? " - Delete Control+ArrowUp Control+ArrowDown Meta+ArrowUp Meta+ArrowDown" : ""}`}
  tabindex="-1"
  {@attach reveal}
>
  {@render children()}
</ul>
