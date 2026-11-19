// Dismisses modal dialogs after a complete click or tap on their backdrop.

export function dismiss(dialog: HTMLDialogElement) {
  let backdrop = false
  function outside(event: MouseEvent) {
    const bounds = dialog.getBoundingClientRect()
    return (
      event.target === dialog &&
      (event.clientX < bounds.left ||
        event.clientX > bounds.right ||
        event.clientY < bounds.top ||
        event.clientY > bounds.bottom)
    )
  }
  const down = (event: PointerEvent) => {
    backdrop = outside(event)
  }
  const cancel = () => {
    backdrop = false
  }
  const click = (event: MouseEvent) => {
    if (backdrop && outside(event)) dialog.close()
    backdrop = false
  }
  dialog.addEventListener("pointerdown", down)
  dialog.addEventListener("pointercancel", cancel)
  dialog.addEventListener("click", click)
  return () => {
    dialog.removeEventListener("pointerdown", down)
    dialog.removeEventListener("pointercancel", cancel)
    dialog.removeEventListener("click", click)
  }
}
