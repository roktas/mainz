// Identifies editable fields and UI states that take priority over workspace shortcuts.

export const fields = "input, textarea, select, [contenteditable]:not([contenteditable='false'])"

export function blocked() {
  return !!document.querySelector(
    "dialog[open], [popover]:popover-open, .sequence-options[open], .input-picker[open], .page-origin[open], .quartet-panel, .control details[open], .composer[data-drag]",
  )
}
