// Resolves workspace command eligibility while components own pane targeting and actions.

export const fields = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"

const baseOverlays = [
  "dialog[open]",
  ".input-picker[open]",
  ".quartet-panel",
  ".control details:is([open], [data-hover-pending])",
]

const overlaySelectors = {
  shortcut: [
    ...baseOverlays,
    "[popover]:popover-open:not(.page-peek, .header-feedback, .scroll-controls)",
    ".sequence-options[open]",
    ".composer[data-drag]",
  ].join(", "),
  escape: [...baseOverlays, "[popover]:popover-open:not(.header-feedback, .scroll-controls)", ".lens"].join(", "),
}

export function overlayOpen(mode: "shortcut" | "escape" = "shortcut") {
  return !!document.querySelector(overlaySelectors[mode])
}

type ShortcutContext = {
  field: boolean
  native: boolean
  tab: boolean
  pageControl: boolean
  overlay: boolean
  repeat: boolean
  pane?: "Input" | "Output"
  view?: "grid" | "list" | "page" | "style"
}
type Shortcut =
  | "all"
  | "view"
  | "gridView"
  | "listView"
  | "pageView"
  | "previousView"
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
  | "viewportPrevious"
  | "viewportNext"
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
    pageControl: !!target?.matches(".page-image, .page-grip, .list-choice, .list-heading"),
    overlay: context.overlay ?? overlayOpen("shortcut"),
    repeat: event.repeat,
    pane: context.pane,
    view: context.view,
  }
}

export function shortcut(
  event: KeyboardEvent,
  context: ShortcutContext,
  scope: "workspace" | "grid" | "list" | "help" | "output" | "escape",
): Shortcut | undefined {
  const key = event.key.toLowerCase()
  const modified = event.isComposing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
  if (
    (scope === "grid" || scope === "list") &&
    context.pageControl &&
    [" ", "enter"].includes(key) &&
    (modified || context.overlay)
  )
    return "suppress"
  if (event.defaultPrevented || event.isComposing || context.overlay) return
  if (scope === "workspace" && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
    if (context.field || context.repeat) return
    if (event.code === "Digit1") return "gridView"
    if (event.code === "Digit2") return "listView"
    if (event.code === "Digit3") return "pageView"
    if (event.code === "KeyV") return "previousView"
  }
  if (event.altKey) return
  if (scope === "escape") return key === "escape" && !modified && !context.repeat ? "clear" : undefined
  if (context.field) return
  if (scope === "help") return key === "?" && !event.ctrlKey && !event.metaKey && !context.repeat ? "help" : undefined
  if (scope === "output") {
    if (event.shiftKey) return
    if (key === "delete" && !event.ctrlKey && !event.metaKey) return "remove"
    if (event.ctrlKey || event.metaKey) {
      if (key === (context.view === "list" ? "arrowup" : "arrowleft")) return "earlier"
      if (key === (context.view === "list" ? "arrowdown" : "arrowright")) return "later"
    }
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
    const extending =
      event.shiftKey &&
      (scope === "list"
        ? ["arrowup", "arrowdown", "home", "end", "pageup", "pagedown"]
        : ["arrowleft", "arrowright"]
      ).includes(key)
    if (event.shiftKey && !extending && !["shift", "n", "p", "+"].includes(key) && !(scope === "list" && key === "="))
      return
    if (key === "shift") return "extend"
    if (key === "enter" || key === "+" || (scope === "list" && key === "="))
      return context.pane === "Input" ? "add" : "duplicate"
    if (key === "-" && context.pane === "Output") return "remove"
  }
  if (key === "arrowleft") return "left"
  if (key === "arrowright") return "right"
  if (key === "arrowup") return "up"
  if (key === "arrowdown") return "down"
  if (key === "p") return "previous"
  if (key === "n") return "next"
  if (key === "home") return "first"
  if (key === "end") return "last"
  if (key === "pageup") return scope === "grid" || scope === "list" ? "viewportPrevious" : "previous"
  if (key === "pagedown") return scope === "grid" || scope === "list" ? "viewportNext" : "next"
  if (key === " ") return "copy"
}

const collectionActions = new Set<Shortcut>([
  "left",
  "right",
  "up",
  "down",
  "first",
  "last",
  "next",
  "previous",
  "copy",
])
const zoomActions = new Set<Shortcut>(["zoomIn", "zoomOut"])
const listActions = new Set<Shortcut>([...collectionActions, ...zoomActions, "resetZoom", "entry"])

export function requestedViewTab(action: Shortcut, previous?: "grid" | "list" | "page" | "style") {
  if (action === "previousView") return previous
  if (action === "gridView") return "grid"
  if (action === "listView") return "list"
  if (action === "pageView") return "page"
}

export function collectionHandlesKey(
  action: Shortcut,
  pressed: string,
  focused: Element | null,
  preferredPanel: Element | null | undefined,
) {
  return (
    (focused?.closest(".grid-view") && ["pageup", "pagedown", "home", "end"].includes(pressed)) ||
    (["pageup", "pagedown", "home", "end"].includes(pressed) && !!preferredPanel?.querySelector(".grid-view")) ||
    (["pageup", "pagedown"].includes(pressed) && !!preferredPanel?.querySelector(".page-list")) ||
    (!!focused?.closest(".composition-grid") && (collectionActions.has(action) || zoomActions.has(action))) ||
    (!!focused?.closest(".page-list") && listActions.has(action))
  )
}

export function stepPageIndex(action: Shortcut, position: number, total: number) {
  if (action === "first") return 0
  if (action === "last") return Math.max(0, total - 1)
  return Math.max(0, Math.min(total - 1, position + (action === "previous" || action === "left" ? -1 : 1)))
}

export function cycleTabKey<T extends string>(key: string, tabs: readonly T[], active: T): T | undefined {
  if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(key)) return
  if (key === "Home") return tabs[0]
  if (key === "End") return tabs.at(-1)
  const index = tabs.indexOf(active)
  return tabs[(index + (key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length]
}
