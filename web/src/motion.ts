// Animates section transitions, focus locks, and navigation targets with reduced motion support.

import { onDestroy, tick } from "svelte"

const locks = new WeakMap<HTMLElement, { initial: boolean; owners: Set<symbol> }>()

export function motionQuery() {
  return matchMedia("(prefers-reduced-motion: no-preference)")
}

// Overlapping transitions must release only their own interaction block.
export function inert(element: HTMLElement) {
  const owner = Symbol()
  const state = locks.get(element) ?? { initial: element.inert, owners: new Set<symbol>() }
  locks.set(element, state)
  state.owners.add(owner)
  element.inert = true
  return () => {
    if (!state.owners.delete(owner) || state.owners.size) return
    locks.delete(element)
    element.inert = state.initial
  }
}

export function flash(element: HTMLElement) {
  if (!motionQuery().matches) return
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

function slideSection(items: readonly SectionMotionItem[], opening: boolean) {
  if (!items.length || !motionQuery().matches) return
  const restore = items.map(({ element, heading }) => {
    if (opening) return
    if (element.contains(document.activeElement) && heading instanceof HTMLElement)
      heading.querySelector<HTMLElement>(".list-disclosure, .grid-ribbon")?.focus({ preventScroll: true })
    return inert(element)
  })
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
      { id: opening ? "unfold" : "fold", duration: 750, easing: "ease-in-out", fill: "forwards" },
    )
  })
  let cancelled = false
  const cancel = () => {
    if (cancelled) return
    cancelled = true
    for (const animation of animations) animation.cancel()
    for (const reset of restore) reset?.()
  }
  return { finished: Promise.allSettled(animations.map((animation) => animation.finished)).then(cancel), cancel }
}

function pulseSectionHeading(element: HTMLElement): Animation | undefined {
  if (!motionQuery().matches) return
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
      duration: 600,
      easing: "ease-in-out",
      ...(grid ? { pseudoElement: "::after" } : {}),
    },
  )
}

export class Folds {
  pending: Set<string> | undefined
  #epoch = 0
  #headings = new Set<Animation>()
  #motion: ReturnType<typeof slideSection>
  constructor(
    private scope: () => unknown,
    private commit: (next: Set<string>) => void,
  ) {
    onDestroy(() => this.cancel())
  }
  cancel() {
    this.#epoch++
    this.pending = undefined
    this.#motion?.cancel()
    this.#motion = undefined
    for (const animation of this.#headings) animation.cancel()
    this.#headings.clear()
  }
  pulse(element: HTMLElement) {
    const animation = pulseSectionHeading(element)
    if (!animation) return
    this.#headings.add(animation)
    void animation.finished.finally(() => this.#headings.delete(animation))
  }
  change(next: Set<string>, departing: readonly SectionMotionItem[], after: () => void) {
    this.cancel()
    const epoch = this.#epoch
    const scope = this.scope()
    this.pending = next
    const apply = () => {
      if (epoch !== this.#epoch || scope !== this.scope()) return
      this.pending = undefined
      this.commit(next)
      void tick().then(() => {
        if (epoch === this.#epoch && scope === this.scope()) after()
      })
    }
    this.#motion = slideSection(departing, false)
    if (this.#motion) void this.#motion.finished.then(apply)
    else apply()
  }
  open(items: readonly SectionMotionItem[]) {
    this.#motion?.cancel()
    this.#motion = slideSection(items, true)
  }
  fold(
    container: HTMLElement | undefined,
    next: Set<string>,
    departing: readonly SectionMotionItem[],
    entries: () => readonly SectionMotionItem[],
    beforeOpen?: () => void,
  ) {
    const targets = new Set(departing.flatMap(({ heading }) => (heading instanceof HTMLElement ? [heading] : [])))
    this.change(next, departing, () => {
      beforeOpen?.()
      if (!container) return
      for (const heading of targets) if (container.contains(heading)) this.pulse(heading)
      this.open(entries())
    })
  }
}
