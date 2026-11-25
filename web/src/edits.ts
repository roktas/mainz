// Animates Output page additions, removals, moves, and grid/list reorders.

import { onDestroy, tick } from "svelte"
import { SvelteSet } from "svelte/reactivity"
import { scale as scaleOut, slide } from "svelte/transition"
import { quadIn, quadOut } from "svelte/easing"
import { sizeOf } from "./model.ts"
import type { Expanded, Size, Source } from "./model.ts"
import type { PDFDocumentProxy } from "pdfjs-dist"
import { cachedRaster, renderCoverCanvas, thumbnail as suppliedThumbnail } from "./pdf.ts"
import type { Edit } from "./output.svelte.ts"
import { createDragImage } from "./drag.ts"
import { inert, motionQuery } from "./motion.ts"

const additionDuration = 900
const removalDuration = 300
const moveDuration = 500

export type EditAnimationContext = {
  sources: readonly Source[]
  previousPages: readonly Expanded[]
  inspectedId: () => string | undefined
  inspectedPosition: number
  chosenFirstId?: string
  outputPosition: (id: string) => number | undefined
  outputPanel: HTMLElement | undefined
  outputTab: "grid" | "list" | "page"
  outputTarget: () => HTMLButtonElement | undefined
  transferActive: boolean
}

export function additionOrigin(
  key: string,
  panel: HTMLElement | undefined,
  tab: "grid" | "list" | "page",
  inspectedId: string | undefined,
  position: number | undefined,
  id?: string,
) {
  const image =
    tab === "page"
      ? id === inspectedId
        ? panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
        : undefined
      : document
          .getElementById(`${key}-${id}`)
          ?.querySelector<HTMLElement>(".page-image :is(canvas, .composition-blank), .list-choice")
  return (
    image ??
    (tab === "list" && position !== undefined
      ? panel?.querySelector<HTMLElement>(`.list-heading[data-page="${position}"]`)
      : undefined) ??
    panel?.querySelector<HTMLElement>(".sequence-entry")
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
  #motion = motionQuery()
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
      for (const card of this.#panel()?.querySelectorAll(".composition-card, .list-row, .list-section") ?? [])
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
    for (const card of this.#panel()?.querySelectorAll<HTMLElement>(
      ".composition-card.removing, .list-row.removing, .list-section.removing",
    ) ?? []) {
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
          card.matches(".list-row, .list-section")
            ? slide(card, { duration: 400, easing: quadOut })
            : scaleOut(card, { duration: removalDuration, start: 0.86, easing: quadIn }),
        )
    }
  }
  transition(node: Element, id: string) {
    return this.#motion.matches && this.removing.has(id)
      ? (this.#transitions.get(node) ?? { duration: 0 })
      : { duration: 0 }
  }
  exitTransition = (node: HTMLElement) => {
    // A virtual row's reactive scope can be gone before its exit starts.
    const id = node.id.slice(this.#key.length + 1)
    if (this.removing.has(id)) {
      inert(node)
      node.setAttribute("aria-hidden", "true")
      node.classList.add("removing")
    }
    return this.transition(node, id)
  }
  animate(edit: Edit, context: EditAnimationContext, origin?: HTMLElement | null) {
    this.stop()
    const expanded = edit.pages
    const added = expanded.filter((page) => edit.added.has(page.id))
    this.prepare(edit, context.outputTab)
    const reordering =
      !added.length &&
      !this.removing.size &&
      expanded.some((page, index) => page.id !== context.previousPages[index]?.id)
    const panel = context.outputPanel
    if (context.outputTab === "list") {
      const list = panel?.querySelector<HTMLElement>(".page-list")
      if (list) this.move = animateOrder(list, 500, reordering)
    }
    if (added.length && !context.transferActive) {
      const originId = "blank" in added[0].content ? undefined : context.chosenFirstId
      const sheet =
        origin ??
        additionOrigin(
          this.#key,
          panel,
          context.outputTab,
          context.inspectedId(),
          originId ? context.outputPosition(originId) : undefined,
          originId,
        )
      if (sheet) {
        const content = added[0].content
        const contributor = "source" in content ? context.sources.find((item) => item.id === content.source) : undefined
        const preview =
          contributor && "page" in content
            ? sheet.closest(".selection-panel")
              ? { pdf: contributor.input.pdf, page: content.page }
              : contributor.preview.appearance(content.page)
            : undefined
        this.addition = animateAddition(
          sheet,
          sizeOf(added[0].content, context.sources),
          "blank" in added[0].content,
          added.length,
          () => {
            const button = context.outputTarget()
            const row = document.getElementById(`${this.#key}-${added[0].id}`)
            const image = row?.matches(".list-row")
              ? row
              : panel?.querySelector<HTMLElement>(
                  `.composition-card[data-adding] .page-image, .inspection-target .page-scroll, .list-section[data-index="${context.outputPosition(added[0].id)}"] .list-heading`,
                )
            if (button?.offsetWidth && (origin?.closest(".selection-panel") || !image)) return button
            return image ?? document.getElementById(`${this.#key}-output`)
          },
          () => {
            const id = context.inspectedId()
            const focused = document.activeElement
            const restore =
              id && this.pending.has(id) && focused?.matches(".composition-output :is(.composition-grid, .page-list)")
            this.pending.clear()
            if (restore)
              void tick().then(() => {
                if (document.activeElement === focused && context.inspectedId() === id)
                  document
                    .getElementById(`${this.#key}-${id}`)
                    ?.querySelector<HTMLElement>(".page-image, .list-choice, .list-heading")
                    ?.focus({ preventScroll: true })
              })
          },
          preview,
          context.outputTab === "list" && !!panel?.offsetWidth,
        )
      }
      if (this.addition) for (const page of added) this.pending.add(page.id)
    }
    const inspected = context.inspectedId()
    if (inspected && this.removing.has(inspected) && context.outputTab === "page") {
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet) this.removal = animateRemoval(sheet, () => this.page.clear())
      if (this.removal) this.page.add(inspected)
    }
    if (reordering && inspected && context.outputTab === "page") {
      const position = expanded.findIndex((page) => page.id === inspected)
      const sheet = panel?.querySelector<HTMLElement>(".page-scroll canvas, .blank-sheet")
      if (sheet && position !== context.inspectedPosition)
        this.move = animateMove(sheet, position - context.inspectedPosition)
    }
    if (reordering && context.outputTab === "grid") {
      const grid = panel?.querySelector<HTMLElement>(".composition-grid")
      if (grid) this.move = animateOrder(grid, undefined, true)
    }
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
  preview?: { pdf: PDFDocumentProxy; page: number },
  strip = false,
) {
  const motion = motionQuery()
  if (!motion.matches) return
  if (strip) sheet = sheet.closest<HTMLElement>(".list-row, .list-section") ?? sheet
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
  const raster = strip ? undefined : snapshot(blank ? undefined : sheet, width, height)
  if (!strip && !raster) return
  let image: HTMLElement | undefined = raster
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
    image?.remove()
    if (image instanceof HTMLCanvasElement) image.width = image.height = 0
    reveal()
  }
  motion.addEventListener("change", stop, { once: true, signal: events.signal })
  void (async () => {
    if (raster && !blank && (!(sheet instanceof HTMLCanvasElement) || !sheet.width || !sheet.height) && preview) {
      const cached = cachedRaster(preview.pdf, preview.page) ?? (await suppliedThumbnail(preview.pdf, preview.page))
      if (disposed) return
      const rendered = cached ?? (await renderCoverCanvas(preview.pdf, preview.page + 1))
      try {
        if (!disposed) raster.getContext("2d")!.drawImage(rendered, 0, 0, raster.width, raster.height)
      } finally {
        if (!cached) rendered.width = rendered.height = 0
      }
      if (disposed) return
    }
    await tick()
    if (disposed) return
    frame = requestAnimationFrame(() => {
      const target = destination()
      if (disposed || !target) return stop()
      const row = strip && target.closest<HTMLElement>(".list-row, .list-section")
      const carried = row ? createDragImage(row, quantity) : undefined
      const flight = carried?.image ?? raster
      if (!flight) return stop()
      image = flight
      flight.classList.add("addition-preview")
      if (!carried) flight.dataset.copies = String(Math.min(quantity, 3))
      const boxWidth = carried?.width ?? size.width * fit,
        boxHeight = carried?.height ?? size.height * fit
      const x = start.left + (start.width - boxWidth) / 2,
        y = start.top + (start.height - boxHeight) / 2
      const thumbnail = target.querySelector<HTMLElement>(".thumbnail")
      const end = (row || thumbnail || target).getBoundingClientRect()
      if (!end.width || !end.height) return stop()
      const padding = thumbnail && getComputedStyle(thumbnail)
      const inline = padding ? parseFloat(padding.paddingInlineStart) + parseFloat(padding.paddingInlineEnd) : 0,
        block = padding ? parseFloat(padding.paddingBlockStart) + parseFloat(padding.paddingBlockEnd) : 0
      const scale = Math.min((end.width - inline) / boxWidth, (end.height - block) / boxHeight)
      const dx = end.left + end.width / 2 - x - boxWidth / 2,
        dy = end.top + end.height / 2 - y - boxHeight / 2
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
      flight.style.insetInlineStart = `${x}px`
      flight.style.insetBlockStart = `${y}px`
      document.body.append(flight)
      animation = flight.animate(frames, {
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
  })().catch(stop)
  return stop
}

export function animateRemoval(sheet: HTMLElement, reveal: () => void) {
  const motion = motionQuery()
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
  const motion = motionQuery()
  if (!motion.matches) return
  const animation = sheet.animate(
    [{ translate: "0 0" }, { translate: `${Math.sign(direction) * 32}px 0`, offset: 0.4 }, { translate: "0 0" }],
    { duration: moveDuration, easing: getComputedStyle(sheet).getPropertyValue("--ease-in-out").trim() },
  )
  const events = new AbortController()
  let disposed = false
  const stop = () => {
    if (disposed) return
    disposed = true
    events.abort()
    animation.cancel()
  }
  animation.addEventListener("finish", stop, { once: true, signal: events.signal })
  animation.addEventListener("cancel", stop, { once: true, signal: events.signal })
  motion.addEventListener("change", stop, { once: true, signal: events.signal })
  return stop
}

export function animateOrder(grid: HTMLElement, duration = moveDuration, settle = false) {
  const motion = motionQuery()
  if (!motion.matches) return
  const start = grid.getBoundingClientRect()
  const positions = new Map(
    [
      ...grid.querySelectorAll<HTMLElement>(
        ":scope > :is(.composition-card, .list-row, .list-section):not([data-dragging])",
      ),
    ].map((card) => {
      const bounds = card.getBoundingClientRect()
      return [card.id, { left: bounds.left - start.left, top: bounds.top - start.top }]
    }),
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
      const cards = [
        ...grid.querySelectorAll<HTMLElement>(":scope > :is(.composition-card, .list-row, .list-section)"),
      ].map((card) => ({
        card,
        bounds: card.getBoundingClientRect(),
      }))
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
