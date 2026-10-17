// Animates page edits with visible snapshots and reduced motion support.

import { tick } from "svelte"
import type { Size } from "./model.ts"

export const editDuration = 1200

function visibleBounds(sheet: HTMLElement) {
  const bounds = sheet.getBoundingClientRect()
  const viewport = sheet.closest(".page-scroll")?.getBoundingClientRect()
  const left = Math.max(0, bounds.left, viewport?.left ?? 0),
    right = Math.min(innerWidth, bounds.right, viewport?.right ?? innerWidth),
    top = Math.max(0, bounds.top, viewport?.top ?? 0),
    bottom = Math.min(innerHeight, bounds.bottom, viewport?.bottom ?? innerHeight)
  return { left, top, width: Math.max(0, right - left), height: Math.max(0, bottom - top) }
}

function snapshot(
  sheet: HTMLElement | undefined,
  width: number,
  height: number,
  crop?: { left: number; top: number; width: number; height: number },
) {
  const image = document.createElement("canvas")
  image.width = Math.ceil(width * Math.min(devicePixelRatio, 2))
  image.height = Math.ceil(height * Math.min(devicePixelRatio, 2))
  const paint = image.getContext("2d")
  if (!paint) return
  if (sheet instanceof HTMLCanvasElement && sheet.width && sheet.height) {
    const origin = sheet.getBoundingClientRect()
    const area = crop ?? origin
    if (origin.width && origin.height) {
      const x = sheet.width / origin.width,
        y = sheet.height / origin.height
      paint.drawImage(
        sheet,
        (area.left - origin.left) * x,
        (area.top - origin.top) * y,
        area.width * x,
        area.height * y,
        0,
        0,
        image.width,
        image.height,
      )
    }
  }
  image.setAttribute("aria-hidden", "true")
  image.style.inlineSize = `${width}px`
  image.style.blockSize = `${height}px`
  return image
}

export function animateAddition(
  sheet: HTMLElement,
  size: Size,
  blank: boolean,
  quantity: number,
  destination: () => HTMLElement | null,
  reveal: () => void,
) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)")
  if (!motion.matches) return
  const origin = sheet.getBoundingClientRect()
  let start = visibleBounds(sheet)
  if ((!start.width || !start.height) && document.activeElement instanceof HTMLElement)
    start = visibleBounds(document.activeElement)
  if (!start.width || !start.height) return
  const easing = getComputedStyle(sheet).getPropertyValue("--ease-in-out").trim()
  const page = sheet.matches("canvas, .blank-sheet, .composition-blank")
  const fit = Math.min(page && origin.width ? origin.width / size.width : 1, 120 / size.width, 160 / size.height)
  const width = size.width * fit,
    height = size.height * fit
  const image = snapshot(blank ? undefined : sheet, width, height)
  if (!image) return
  image.className = "addition-preview"
  image.dataset.copies = String(Math.min(quantity, 3))
  let animation: Animation | undefined
  let frame = 0
  let disposed = false
  const events = new AbortController()
  const stop = () => {
    if (disposed) return
    disposed = true
    events.abort()
    cancelAnimationFrame(frame)
    animation?.cancel()
    image.remove()
    image.width = image.height = 0
    reveal()
  }
  motion.addEventListener("change", stop, { once: true, signal: events.signal })
  void tick().then(() => {
    if (disposed) return
    frame = requestAnimationFrame(() => {
      const target = destination()
      if (disposed || !target) return stop()
      const current = sheet.isConnected ? visibleBounds(sheet) : start
      const from = current.width && current.height ? current : start
      const x = from.left + (from.width - width) / 2,
        y = from.top + (from.height - height) / 2
      const thumbnail = target.querySelector<HTMLElement>(".thumbnail")
      const end = (thumbnail ?? target).getBoundingClientRect()
      if (!end.width || !end.height) return stop()
      const padding = thumbnail && getComputedStyle(thumbnail)
      const inline = padding ? parseFloat(padding.paddingInlineStart) + parseFloat(padding.paddingInlineEnd) : 0,
        block = padding ? parseFloat(padding.paddingBlockStart) + parseFloat(padding.paddingBlockEnd) : 0
      const scale = Math.min((end.width - inline) / width, (end.height - block) / height)
      const dx = end.left + end.width / 2 - x - width / 2,
        dy = end.top + end.height / 2 - y - height / 2
      const distance = Math.hypot(dx, dy)
      const arc = Math.min(64, distance * 0.14)
      const segments = 12
      const frames = Array.from({ length: segments + 1 }, (_, index) => {
        const progress = index / segments,
          bend = 4 * progress * (1 - progress) * arc
        return {
          transform: `translate(${dx * progress + (dy / (distance || 1)) * bend}px, ${dy * progress - (dx / (distance || 1)) * bend}px) scale(${1 + (scale - 1) * progress})`,
          offset: progress,
        }
      })
      image.style.insetInlineStart = `${x}px`
      image.style.insetBlockStart = `${y}px`
      document.body.append(image)
      animation = image.animate(frames, {
        duration: editDuration,
        easing,
        fill: "forwards",
      })
      animation.addEventListener("finish", stop, { once: true, signal: events.signal })
      animation.addEventListener("cancel", stop, { once: true, signal: events.signal })
      window.addEventListener("resize", stop, { once: true, signal: events.signal })
      window.addEventListener("scroll", stop, { once: true, capture: true, signal: events.signal })
    })
  })
  return stop
}

export function animateRemoval(sheet: HTMLElement, reveal: () => void) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)")
  if (!motion.matches) return
  const bounds = visibleBounds(sheet)
  if (!bounds.width || !bounds.height) return
  const image = snapshot(sheet, bounds.width, bounds.height, bounds)
  if (!image) return
  image.className = "removal-preview"
  image.style.insetInlineStart = `${bounds.left}px`
  image.style.insetBlockStart = `${bounds.top}px`
  document.body.append(image)
  const animation = image.animate(
    [
      { opacity: 1, transform: "scale(1)" },
      { opacity: 0, transform: "scale(0.86)" },
    ],
    {
      duration: editDuration,
      easing: getComputedStyle(sheet).getPropertyValue("--ease-in-out").trim(),
      fill: "forwards",
    },
  )
  let disposed = false
  let frame = 0
  const events = new AbortController()
  const stop = () => {
    if (disposed) return
    disposed = true
    cancelAnimationFrame(frame)
    events.abort()
    animation.cancel()
    image.remove()
    image.width = image.height = 0
    reveal()
  }
  animation.addEventListener("finish", stop, { once: true, signal: events.signal })
  animation.addEventListener("cancel", stop, { once: true, signal: events.signal })
  motion.addEventListener("change", stop, { once: true, signal: events.signal })
  window.addEventListener("resize", stop, { once: true, signal: events.signal })
  frame = requestAnimationFrame(() => {
    if (!disposed) window.addEventListener("scroll", stop, { once: true, capture: true, signal: events.signal })
  })
  return stop
}

export function animateMove(sheet: HTMLElement, direction: number) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)")
  if (!motion.matches) return
  const animation = sheet.animate(
    [{ translate: "0 0" }, { translate: `${Math.sign(direction) * 32}px 0`, offset: 0.4 }, { translate: "0 0" }],
    { duration: editDuration, easing: getComputedStyle(sheet).getPropertyValue("--ease-in-out").trim() },
  )
  const stop = () => {
    animation.cancel()
    motion.removeEventListener("change", stop)
  }
  animation.addEventListener("finish", stop, { once: true })
  motion.addEventListener("change", stop, { once: true })
  return stop
}

export function animateOrder(grid: HTMLElement) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)")
  if (!motion.matches) return
  const positions = new Map(
    [...grid.querySelectorAll<HTMLElement>(":scope > .composition-card")].map((card) => [
      card.id,
      card.getBoundingClientRect(),
    ]),
  )
  const easing = getComputedStyle(grid).getPropertyValue("--ease-in-out").trim()
  const animations: Animation[] = []
  const events = new AbortController()
  let frame = 0
  let disposed = false
  const stop = () => {
    if (disposed) return
    disposed = true
    events.abort()
    cancelAnimationFrame(frame)
    for (const animation of animations) animation.cancel()
  }
  motion.addEventListener("change", stop, { once: true, signal: events.signal })
  window.addEventListener("resize", stop, { once: true, signal: events.signal })
  void tick().then(() => {
    if (disposed) return
    frame = requestAnimationFrame(() => {
      for (const card of grid.querySelectorAll<HTMLElement>(":scope > .composition-card")) {
        const from = positions.get(card.id),
          to = card.getBoundingClientRect()
        if (!from || (from.left === to.left && from.top === to.top)) continue
        animations.push(
          card.animate([{ translate: `${from.left - to.left}px ${from.top - to.top}px` }, { translate: "0 0" }], {
            duration: editDuration,
            easing,
          }),
        )
      }
      void Promise.all(animations.map((animation) => animation.finished)).then(stop, stop)
      window.addEventListener("scroll", stop, { once: true, capture: true, signal: events.signal })
    })
  })
  return stop
}
