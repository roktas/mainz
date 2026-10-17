import { tick } from "svelte";

export function animateAddition(
  sheet: HTMLCanvasElement,
  quantity: number,
  destination: () => HTMLElement | null,
  reveal: () => void,
) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)");
  const origin = sheet.getBoundingClientRect();
  if (!motion.matches || !sheet.width || !sheet.height || !origin.width || !origin.height) return;
  const fit = Math.min(1, 120 / origin.width, 160 / origin.height);
  const width = origin.width * fit,
    height = origin.height * fit;
  const image = document.createElement("canvas");
  image.width = Math.ceil(width * Math.min(devicePixelRatio, 2));
  image.height = Math.ceil(height * Math.min(devicePixelRatio, 2));
  const paint = image.getContext("2d");
  if (!paint) return;
  paint.drawImage(sheet, 0, 0, image.width, image.height);
  image.className = "addition-preview";
  image.dataset.copies = String(Math.min(quantity, 3));
  image.setAttribute("aria-hidden", "true");
  image.style.inlineSize = `${width}px`;
  image.style.blockSize = `${height}px`;
  let animation: Animation | undefined;
  let frame = 0;
  let disposed = false;
  const stop = () => {
    if (disposed) return;
    disposed = true;
    cancelAnimationFrame(frame);
    animation?.cancel();
    image.remove();
    image.width = image.height = 0;
    motion.removeEventListener("change", stop);
    window.removeEventListener("resize", stop);
    window.removeEventListener("scroll", stop, true);
    reveal();
  };
  motion.addEventListener("change", stop, { once: true });
  void tick().then(() => {
    if (disposed) return;
    frame = requestAnimationFrame(() => {
      const target = destination();
      if (disposed || !sheet.isConnected || !target) return stop();
      const start = sheet.getBoundingClientRect();
      const viewport = sheet.closest(".page-scroll")?.getBoundingClientRect();
      const left = Math.max(0, start.left, viewport?.left ?? 0),
        right = Math.min(innerWidth, start.right, viewport?.right ?? innerWidth),
        top = Math.max(0, start.top, viewport?.top ?? 0),
        bottom = Math.min(innerHeight, start.bottom, viewport?.bottom ?? innerHeight);
      if (right <= left || bottom <= top) return stop();
      const x = (left + right - width) / 2,
        y = (top + bottom - height) / 2;
      const thumbnail = target.querySelector<HTMLElement>(".thumbnail");
      const end = (thumbnail ?? target).getBoundingClientRect();
      if (!end.width || !end.height) return stop();
      const padding = thumbnail && getComputedStyle(thumbnail);
      const inline = padding ? parseFloat(padding.paddingInlineStart) + parseFloat(padding.paddingInlineEnd) : 0,
        block = padding ? parseFloat(padding.paddingBlockStart) + parseFloat(padding.paddingBlockEnd) : 0;
      const scale = Math.min((end.width - inline) / width, (end.height - block) / height);
      const dx = end.left + end.width / 2 - x - width / 2,
        dy = end.top + end.height / 2 - y - height / 2;
      const distance = Math.hypot(dx, dy);
      if (!distance) return stop();
      const arc = Math.min(64, distance * 0.14);
      const segments = 12;
      const frames = Array.from({ length: segments + 1 }, (_, index) => {
        const progress = index / segments,
          bend = 4 * progress * (1 - progress) * arc;
        return {
          transform: `translate(${dx * progress + (dy / distance) * bend}px, ${dy * progress - (dx / distance) * bend}px) scale(${1 + (scale - 1) * progress})`,
          offset: progress,
        };
      });
      image.style.insetInlineStart = `${x}px`;
      image.style.insetBlockStart = `${y}px`;
      document.body.append(image);
      animation = image.animate(frames, {
        duration: 1200,
        easing: getComputedStyle(sheet).getPropertyValue("--ease-in-out").trim(),
        fill: "forwards",
      });
      animation.addEventListener("finish", stop, { once: true });
      animation.addEventListener("cancel", stop, { once: true });
      window.addEventListener("resize", stop, { once: true });
      window.addEventListener("scroll", stop, { once: true, capture: true });
    });
  });
  return stop;
}
