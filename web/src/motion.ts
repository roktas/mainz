// Animates page edits, section folding, and navigation targets with reduced motion support.

import { onDestroy, tick } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { scale as scaleOut, slide } from "svelte/transition"
import { quadIn, quadOut } from "svelte/easing"
import type { Size } from "./model.ts"
import type { Edit } from "./output.svelte.ts"

const additionDuration = 600
const removalDuration = 300
const moveDuration = 500

export function flash(element: HTMLElement) {
  if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return
  const surface = getComputedStyle(element).backgroundColor
  const overlay = element.matches(".page-view, .composition-card")
  const frames = overlay
    ? [
        { opacity: 0, offset: 0 },
        { opacity: 0.4, offset: 0.1 },
        { opacity: 0.4, offset: 0.6 },
        { opacity: 0, offset: 1 },
      ]
    : [
        { background: surface, offset: 0 },
        { background: `color-mix(in oklch, var(--secondary) 45%, ${surface})`, offset: 0.1 },
        { background: `color-mix(in oklch, var(--secondary) 45%, ${surface})`, offset: 0.6 },
        { background: surface, offset: 1 },
      ]
  element
    .getAnimations({ subtree: true })
    .filter((animation) => animation.id === "jump")
    .forEach((animation) => animation.cancel())
  element.animate(frames, {
    id: "jump",
    duration: 3000,
    easing: "ease-out",
    ...(overlay ? { pseudoElement: "::after" } : {}),
  })
}

type SectionMotionItem = { element: HTMLElement; heading: HTMLElement | DOMRectReadOnly | null }

function slideSection(items: readonly SectionMotionItem[], opening: boolean): Promise<void> | undefined {
  if (!items.length || !matchMedia("(prefers-reduced-motion: no-preference)").matches) return
  const animations = items.map(({ element, heading }) => {
    const from = element.getBoundingClientRect()
    const to = heading instanceof HTMLElement ? heading.getBoundingClientRect() : heading
    const dx = to ? to.left + to.width / 2 - from.left - from.width / 2 : 0
    const dy = to ? to.top + to.height / 2 - from.top - from.height / 2 : -24
    const frames: Keyframe[] = [
      { opacity: 1, transform: "translate(0, 0) scale(1)", offset: 0 },
      { opacity: 0.85, transform: `translate(${dx * 0.7}px, ${dy * 0.7}px) scale(0.7)`, offset: 0.7 },
      { opacity: 0, transform: `translate(${dx}px, ${dy}px) scale(0.25)`, offset: 1 },
    ]
    return element.animate(
      opening
        ? [
            { ...frames[2], offset: 0 },
            { ...frames[1], offset: 0.3 },
            { ...frames[0], offset: 1 },
          ]
        : frames,
      { id: opening ? "unfold" : "fold", duration: 900, easing: "ease-in-out", fill: "forwards" },
    )
  })
  return Promise.allSettled(animations.map((animation) => animation.finished)).then(() => {
    for (const animation of animations) animation.cancel()
  })
}

export function foldInto(items: readonly SectionMotionItem[]) {
  return slideSection(items, false)
}

export function unfoldFrom(items: readonly SectionMotionItem[]) {
  return slideSection(items, true)
}

export function pulseSectionHeading(element: HTMLElement): Animation | undefined {
  if (!matchMedia("(prefers-reduced-motion: no-preference)").matches) return
  const grid = element.matches(".composition-card")
  const surface = getComputedStyle(element).backgroundColor
  element
    .getAnimations({ subtree: true })
    .find((animation) => animation.id === "section-heading")
    ?.cancel()
  return element.animate(
    grid
      ? [{ opacity: 0 }, { opacity: 0.22 }, { opacity: 0 }]
      : [
          { backgroundColor: surface },
          { backgroundColor: `color-mix(in oklch, var(--secondary) 35%, ${surface})` },
          { backgroundColor: surface },
        ],
    {
      id: "section-heading",
      duration: 800,
      easing: "ease-in-out",
      ...(grid ? { pseudoElement: "::after" } : {}),
    },
  )
}

export class Edits {
  readonly pending = new SvelteSet<string>()
  readonly arriving = new SvelteSet<string>()
  readonly removing = new SvelteSet<string>()
  readonly page = new SvelteSet<string>()
  addition?: () => void
  removal?: () => void
  move?: () => void
  #motion = matchMedia("(prefers-reduced-motion: no-preference)")
  #transitions = new WeakMap<Element, ReturnType<typeof scaleOut>>()
  #arrivals?: ReturnType<typeof setTimeout>
  #generation = 0
  #key: string
  #panel() {
    return document.getElementById(`${this.#key}-output-panel`)
  }

  constructor(key: string) {
    this.#key = key
    const change = () => {
      if (this.#motion.matches) return
      this.stop()
      for (const card of this.#panel()?.querySelectorAll(".composition-card, .list-row") ?? [])
        for (const animation of card.getAnimations()) animation.finish()
    }
    this.#motion.addEventListener("change", change)
    onDestroy(() => {
      this.#motion.removeEventListener("change", change)
      this.stop()
    })
  }
  stop() {
    this.#generation++
    clearTimeout(this.#arrivals)
    this.arriving.clear()
    this.removing.clear()
    this.page.clear()
    this.addition?.()
    this.pending.clear()
    this.removal?.()
    this.move?.()
    this.addition = this.removal = this.move = undefined
    // Outgoing cards must leave before another edit or transfer uses their slots.
    for (const card of this.#panel()?.querySelectorAll<HTMLElement>(".composition-card.removing, .list-row.removing") ??
      []) {
      for (const animation of card.getAnimations()) animation.finish()
      card.style.display = "none"
    }
  }
  prepare(edit: Edit, tab: "grid" | "list" | "page") {
    for (const id of edit.removed) this.removing.add(id)
    this.#transitions = new WeakMap()
    if (!this.#motion.matches) return
    if (tab === "list") {
      for (const id of edit.added) this.arriving.add(id)
      const generation = this.#generation
      void tick().then(() => {
        if (generation !== this.#generation) return
        this.#arrivals = setTimeout(() => this.arriving.clear(), 240)
      })
    }
    // Read all outgoing styles before Svelte changes individual cards.
    for (const id of edit.removed) {
      const card = document.getElementById(`${this.#key}-${id}`)
      if (card)
        this.#transitions.set(
          card,
          card.classList.contains("list-row")
            ? slide(card, { duration: 220, easing: quadOut })
            : scaleOut(card, { duration: removalDuration, start: 0.86, easing: quadIn }),
        )
    }
  }
  transition(node: Element, id: string) {
    return this.#motion.matches && this.removing.has(id)
      ? (this.#transitions.get(node) ?? { duration: 0 })
      : { duration: 0 }
  }
}

function visibleBounds(sheet: HTMLElement) {
  const bounds = sheet.getBoundingClientRect()
  const viewport = sheet.closest(".page-scroll, .page-list")?.getBoundingClientRect()
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
  image.width = Math.ceil(width * Math.min(Math.max(devicePixelRatio, 2), 3))
  image.height = Math.ceil(height * Math.min(Math.max(devicePixelRatio, 2), 3))
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
  if (sheet?.matches(".list-choice")) {
    const style = getComputedStyle(sheet)
    paint.scale(image.width / width, image.height / height)
    paint.fillStyle = getComputedStyle(sheet.closest(".list-row")!).backgroundColor
    paint.fillRect(0, 0, width, height)
    paint.fillStyle = style.color
    paint.font = `${style.fontSize} ${style.fontFamily}`
    paint.textBaseline = "middle"
    paint.fillText(sheet.textContent ?? "", 8, height / 2, width - 16)
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
  let glow: Animation | undefined
  let frame = 0
  let disposed = false
  const events = new AbortController()
  const stop = () => {
    if (disposed) return
    disposed = true
    events.abort()
    cancelAnimationFrame(frame)
    animation?.cancel()
    glow?.cancel()
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
        duration: additionDuration,
        easing,
        fill: "forwards",
      })
      if (target.matches(".mobile-workspace-tabs > button"))
        glow = target.animate(
          [
            {},
            {
              backgroundColor: "var(--tint)",
              borderColor: "var(--accent)",
              boxShadow: "0 0 18px color-mix(in oklch, var(--accent) 45%, transparent)",
            },
            {},
          ],
          { duration: additionDuration, easing },
        )
      animation.addEventListener("finish", stop, { once: true, signal: events.signal })
      animation.addEventListener("cancel", stop, { once: true, signal: events.signal })
      window.addEventListener("resize", stop, { once: true, signal: events.signal })
      frame = requestAnimationFrame(() => {
        if (!disposed) window.addEventListener("scroll", stop, { once: true, capture: true, signal: events.signal })
      })
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
      duration: removalDuration,
      easing: "ease-in",
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
    { duration: moveDuration, easing: getComputedStyle(sheet).getPropertyValue("--ease-in-out").trim() },
  )
  const stop = () => {
    animation.cancel()
    motion.removeEventListener("change", stop)
  }
  animation.addEventListener("finish", stop, { once: true })
  motion.addEventListener("change", stop, { once: true })
  return stop
}

export function animateOrder(grid: HTMLElement, duration = moveDuration, settle = false) {
  const motion = matchMedia("(prefers-reduced-motion: no-preference)")
  if (!motion.matches) return
  const start = grid.getBoundingClientRect()
  const positions = new Map(
    [...grid.querySelectorAll<HTMLElement>(":scope > :is(.composition-card, .list-row:not([data-dragging]))")].map(
      (card) => {
        const bounds = card.getBoundingClientRect()
        return [card.id, { left: bounds.left - start.left, top: bounds.top - start.top }]
      },
    ),
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
      const end = grid.getBoundingClientRect()
      // Read every destination before animations invalidate styles for the next card.
      const cards = [...grid.querySelectorAll<HTMLElement>(":scope > :is(.composition-card, .list-row)")].map(
        (card) => ({
          card,
          bounds: card.getBoundingClientRect(),
        }),
      )
      for (const { card, bounds: to } of cards) {
        if (settle && card.classList.contains("range-highlight"))
          animations.push(
            card.animate(
              [
                {
                  backgroundColor: "color-mix(in oklch, var(--secondary) 32%, var(--return-surface))",
                  boxShadow: "inset 0 0 0 1px var(--secondary)",
                },
                { backgroundColor: "var(--return-surface)", boxShadow: "inset 0 0 0 1px transparent" },
              ],
              { delay: duration, duration: 1200, easing },
            ),
          )
        const from = positions.get(card.id)
        if (!from) continue
        const x = from.left - (to.left - end.left),
          y = from.top - (to.top - end.top)
        if (!x && !y) continue
        animations.push(
          card.animate([{ translate: `${x}px ${y}px` }, { translate: "0 0" }], {
            duration,
            easing,
          }),
        )
        const slot = card.querySelector<HTMLElement>(":scope > .list-drop-preview")
        if (slot)
          animations.push(slot.animate([{ translate: `${-x}px ${-y}px` }, { translate: "0 0" }], { duration, easing }))
      }
      void Promise.all(animations.map((animation) => animation.finished)).then(stop, stop)
    })
  })
  return stop
}
