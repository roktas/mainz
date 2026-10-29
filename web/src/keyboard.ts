// Resolves workspace command eligibility while components own pane targeting and actions.

export const fields = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"

function blocked() {
  return !!document.querySelector(
    "dialog[open], [popover]:popover-open, .sequence-options[open], .input-picker[open], .page-origin[open], .quartet-panel, .control details[open], .composer[data-drag]",
  )
}

export type ShortcutContext = {
  field: boolean
  native: boolean
  tab: boolean
  pageControl: boolean
  pagination: boolean
  overlay: boolean
  repeat: boolean
  pane?: "Input" | "Output"
  view?: "grid" | "page" | "style"
}
export type Shortcut =
  | "all"
  | "view"
  | "clear"
  | "help"
  | "left"
  | "right"
  | "up"
  | "down"
  | "previous"
  | "next"
  | "first"
  | "last"
  | "batchPrevious"
  | "batchNext"
  | "extend"
  | "zoomIn"
  | "zoomOut"
  | "resetZoom"
  | "entry"
  | "copy"
  | "add"
  | "duplicate"
  | "remove"
  | "earlier"
  | "later"
  | "suppress"

export function shortcutContext(
  event: KeyboardEvent,
  context: Pick<ShortcutContext, "pane" | "view"> & { overlay?: boolean } = {},
): ShortcutContext {
  const target = event.target instanceof Element ? event.target : document.activeElement
  return {
    field: !!target?.closest(fields),
    native: !!target?.closest("button, summary, a[href]"),
    tab: !!target?.matches('[role="tab"]'),
    pageControl: !!target?.matches(".page-image, .page-grip"),
    pagination: !!target?.matches('.page-batches input[type="range"]'),
    overlay: context.overlay ?? blocked(),
    repeat: event.repeat,
    pane: context.pane,
    view: context.view,
  }
}

export function shortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
  scope: "workspace" | "grid" | "help" | "output" | "escape",
): Shortcut | undefined {
  const key = event.key.toLowerCase()
  const modified = event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  if (scope === "grid" && context.pageControl && [" ", "enter"].includes(key) && (modified || context.overlay))
    return "suppress"
  if (event.defaultPrevented || event.isComposing || event.altKey || context.overlay) return
  if (scope === "escape") return key === "escape" && !modified && !context.repeat ? "clear" : undefined
  if (context.field && !(scope === "grid" && context.pagination && ["pageup", "pagedown"].includes(key))) return
  if (scope === "help") return key === "?" && !event.ctrlKey && !event.metaKey && !context.repeat ? "help" : undefined
  if (scope === "output") {
    if (event.metaKey || event.shiftKey) return
    if (key === "delete" && !event.ctrlKey) return "remove"
    if (event.ctrlKey && key === "arrowleft") return "earlier"
    if (event.ctrlKey && key === "arrowright") return "later"
    return
  }
  const all = key === "a" && (event.ctrlKey || event.metaKey)
  if ((event.ctrlKey || event.metaKey) && !(scope === "workspace" && all)) return
  if (scope === "workspace") {
    if (event.shiftKey && !["+", "=", "n", "p", "z", "v", "g"].includes(key)) return
    if (context.tab && ["arrowleft", "arrowright", "arrowup", "arrowdown", "home", "end"].includes(key)) return
    if (context.native && key === " ") return
    if (all) return "all"
    if (key === "v") return "view"
    if (key === "+" || key === "=") return "zoomIn"
    if (key === "-") return "zoomOut"
    if (key === "0" || key === "z") return "resetZoom"
    if (key === "g") return "entry"
  } else {
    const extending = event.shiftKey && ["arrowleft", "arrowright"].includes(key)
    if (event.shiftKey && !extending && !["shift", "n", "p", "+"].includes(key)) return
    if (key === "shift") return "extend"
    if (key === "enter") return context.pane === "Input" ? "add" : "duplicate"
    if (key === "+") return "duplicate"
    if (key === "-") return "remove"
  }
  if (key === "arrowleft") return "left"
  if (key === "arrowright") return "right"
  if (key === "arrowup") return "up"
  if (key === "arrowdown") return "down"
  if (key === "p") return "previous"
  if (key === "n") return "next"
  if (key === "home") return "first"
  if (key === "end") return "last"
  if (key === "pageup") return scope === "grid" ? "batchPrevious" : "previous"
  if (key === "pagedown") return scope === "grid" ? "batchNext" : "next"
  if (key === " ") return "copy"
}
