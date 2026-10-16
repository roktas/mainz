import type { Size } from "./model.ts";

export function retainFocus(event: MouseEvent) {
  if (event.button !== 0) return;
  const control = event.currentTarget as HTMLElement;
  if ((event.ctrlKey || event.metaKey) && control.classList.contains("page-image")) {
    event.preventDefault();
    return;
  }
  const focused = document.activeElement;
  if (focused === control) return;
  let frame: number;
  const restore = () => {
    cancelAnimationFrame(frame);
    control.removeEventListener("dragstart", restore);
    window.removeEventListener("mouseup", restore);
    if (document.activeElement !== control) return;
    control.blur();
    if (focused instanceof HTMLElement && focused !== document.body) focused.focus({ preventScroll: true });
  };
  // Restore after native mousedown; changing focus inside it prevents dragging.
  control.addEventListener("dragstart", restore, { once: true });
  window.addEventListener("mouseup", restore, { once: true });
  frame = requestAnimationFrame(restore);
}

export function createDragImage(event: DragEvent, quantity: number, size?: Size) {
  if (!event.dataTransfer) return;
  const control = event.currentTarget as HTMLElement;
  const card =
    control.closest(".composition-card, .page-view") ??
    control.closest(".selection-panel")?.querySelector(".composition-card.selected, .page-view");
  const sheet = card?.querySelector<HTMLElement>(
    ".page-image canvas, .page-scroll canvas, .page-image .composition-blank, .page-scroll .blank-sheet",
  );
  const bounds = sheet?.getBoundingClientRect() ?? size;
  if (bounds?.width && bounds.height) {
    const compact = card?.classList.contains("composition-card") && card.closest('[data-density="compact"]');
    const limit = compact ? { width: 84, height: 116 } : { width: 120, height: 160 };
    const layers = Math.min(3, quantity);
    const offset = (layers - 1) * 6;
    const tilt = matchMedia("(prefers-reduced-motion: no-preference)").matches;
    const padding = tilt ? 12 : 0;
    const scale = Math.min(
      (limit.width - 2 - offset - padding) / bounds.width,
      (limit.height - 2 - offset - padding) / bounds.height,
    );
    const width = Math.ceil(bounds.width * scale) + 2;
    const height = Math.ceil(bounds.height * scale) + 2;
    const image = document.createElement("canvas");
    image.width = width + offset + padding;
    image.height = height + offset + padding;
    const context = image.getContext("2d");
    if (context) {
      const thumbnail = document.createElement("canvas");
      thumbnail.width = width - 2;
      thumbnail.height = height - 2;
      const paint = thumbnail.getContext("2d")!;
      paint.fillStyle = "oklch(100% 0 none)";
      paint.fillRect(0, 0, thumbnail.width, thumbnail.height);
      if (sheet instanceof HTMLCanvasElement && sheet.width && sheet.height)
        paint.drawImage(sheet, 0, 0, thumbnail.width, thumbnail.height);
      if (tilt) {
        context.translate(image.width / 2, image.height / 2);
        context.rotate(-Math.PI / 60);
        context.translate(-(width + offset) / 2, -(height + offset) / 2);
        context.globalAlpha = 0.9;
      }
      context.fillStyle = "oklch(100% 0 none)";
      context.strokeStyle = getComputedStyle(card ?? control).borderColor;
      for (let layer = layers - 1; layer >= 0; layer--) {
        const inset = layer * 6;
        context.fillRect(inset, inset, width, height);
        context.strokeRect(inset + 0.5, inset + 0.5, width - 1, height - 1);
      }
      context.drawImage(thumbnail, 1, 1);
      image.className = "drag-image";
      image.setAttribute("aria-hidden", "true");
      document.body.append(image);
      image.getBoundingClientRect();
      event.dataTransfer.setDragImage(image, image.width / 2, 12);
      // Keep the canvas rendered until the browser captures its drag image.
      requestAnimationFrame(() => (image.style.visibility = "hidden"));
      return { image, thumbnail };
    }
  }
}
