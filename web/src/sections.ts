// Builds shared section trees and visible page ranges for List and Grid.

import type { Page } from "./model.ts"
import type { Outline } from "./outline.ts"

export type Section = {
  id: number
  key: string
  node: string
  start: number
  end: number
  path: readonly string[]
  parent?: Section
  synthetic?: boolean
  children: Section[]
}

export type SectionTree = { roots: Section[]; nodes: Map<number, Section> }

function append(
  tree: SectionTree,
  path: readonly string[],
  node: string,
  start: number,
  end: number,
  identity: string | number,
  synthetic?: boolean,
  parent?: Section,
) {
  const section: Section = {
    id: tree.nodes.size,
    key: JSON.stringify([identity, node]),
    node,
    start,
    end,
    path,
    synthetic,
    parent,
    children: [],
  }
  ;(parent?.children ?? tree.roots).push(section)
  tree.nodes.set(section.id, section)
  return section
}

export function sectionsOf(outline: readonly Outline[] = [], identity?: (page: number) => string): SectionTree {
  const tree: SectionTree = { roots: [], nodes: new Map() }
  const open = new Map<string, Section>()
  for (const { path, keys, page, end, synthetic } of outline.toSorted((a, b) => a.page - b.page)) {
    let parent: Section | undefined
    for (const [depth, key] of keys.entries()) {
      let section = open.get(key)
      if (!section || section.end < page) {
        section = append(
          tree,
          path.slice(0, depth + 1),
          key,
          page,
          end + 1,
          identity?.(page) ?? page,
          synthetic && depth === path.length - 1,
          parent,
        )
        open.set(key, section)
      } else section.end = Math.max(section.end, end + 1)
      parent = section
    }
  }
  return tree
}

type Range = { start: number; end: number }

// A contiguous Output span can be skipped when all its physical pages are inside the range.
function pageRuns(pages: readonly number[]) {
  const size = 2 ** Math.ceil(Math.log2(Math.max(1, pages.length)))
  const minimum = new Int32Array(2 * size).fill(-1)
  const maximum = minimum.slice()
  minimum.set(pages, size)
  maximum.set(pages, size)
  for (let node = size - 1; node; node--) {
    minimum[node] = Math.min(minimum[node * 2], minimum[node * 2 + 1])
    maximum[node] = Math.max(maximum[node * 2], maximum[node * 2 + 1])
  }
  return function outside(index: number, limit: number, range: Range): number {
    function seek(node: number, first: number, end: number): number {
      if (end <= index || first >= limit || (minimum[node] >= range.start && maximum[node] < range.end)) return limit
      if (end === first + 1) return first
      const middle = (first + end) / 2
      const left = seek(node * 2, first, middle)
      return left < limit ? left : seek(node * 2 + 1, middle, end)
    }
    return seek(1, 0, size)
  }
}

function rangeAt<T extends Range>(ranges: readonly T[], page: number) {
  let first = 0,
    end = ranges.length
  while (first < end) {
    const middle = (first + end) >> 1
    if (ranges[middle].end <= page) first = middle + 1
    else end = middle
  }
  const range = ranges[first]
  return range && range.start <= page ? range : undefined
}

const paths = new WeakMap<SectionTree, Map<string, Section[]>>()

export function outputSections(
  pages: readonly Page[],
  source?: { id: string; input: { outline?: readonly Outline[] } },
): SectionTree {
  const tree: SectionTree = { roots: [], nodes: new Map() }
  const outline = source?.input.outline
  if (!source || !outline?.length) return tree
  const starts = new Map<number, Outline[]>()
  const coverage = new Map<string, Range[]>()
  for (const entry of outline.toSorted((a, b) => a.page - b.page)) {
    if (!starts.has(entry.page)) starts.set(entry.page, [])
    starts.get(entry.page)!.push(entry)
    for (const key of entry.keys) {
      if (!coverage.has(key)) coverage.set(key, [])
      const ranges = coverage.get(key)!
      const last = ranges.at(-1)
      if (last && last.end >= entry.page) last.end = Math.max(last.end, entry.end + 1)
      else ranges.push({ start: entry.page, end: entry.end + 1 })
    }
  }
  const sequence = pages.map(({ content }) => ("source" in content && content.source === source.id ? content.page : -1))
  const outside = pageRuns(sequence)
  const next = new Map<number, number>()
  const repeats = new Int32Array(sequence.length)
  for (let index = sequence.length - 1; index >= 0; index--) {
    const page = sequence[index]
    if (!starts.has(page)) continue
    repeats[index] = next.get(page) ?? sequence.length
    next.set(page, index)
  }
  const open = new Map<string, Section>()
  for (const [index, page] of sequence.entries()) {
    for (const entry of starts.get(page) ?? []) {
      const key = entry.keys.at(-1)!
      const ancestor = open.get(entry.keys.at(-2)!)
      const parent = ancestor && index < ancestor.end ? ancestor : undefined
      const limit = Math.min(repeats[index], parent?.end ?? sequence.length)
      const ranges = coverage.get(key)!
      let end = index
      while (end < limit) {
        const range = rangeAt(ranges, sequence[end])
        if (!range) break
        end = outside(end, limit, range)
      }
      open.set(
        key,
        append(tree, entry.path, `${source.id}:${key}`, index, end, pages[index].id, entry.synthetic, parent),
      )
    }
  }
  return tree
}

export function gridSections(tree: SectionTree, count: number, folded: ReadonlySet<string>) {
  const pages: number[] = []
  const headings = new Map<number, Section>()
  const ends = new Map<number, number>()
  let hiddenUntil = 0
  const visit = (section: Section) => {
    if (section.start < hiddenUntil && !headings.has(section.start)) return
    // One ribbon represents the widest coincident range; equal ranges retain the outer heading.
    const heading = headings.get(section.start)
    if (!heading || section.end > heading.end) headings.set(section.start, section)
    if (folded.has(section.key)) {
      hiddenUntil = Math.max(hiddenUntil, section.end)
      ends.set(section.start, hiddenUntil)
    } else for (const child of section.children) visit(child)
  }
  for (const root of tree.roots) visit(root)
  for (let page = 0; page < count; page = Math.max(page + 1, ends.get(page) ?? 0)) pages.push(page)
  const visible = new Set(pages)
  for (const page of headings.keys()) if (!visible.has(page)) headings.delete(page)
  return { pages, headings, ends }
}

// Both views start open; only an explicit fold or navigation changes this pane's choices.
export class Sections {
  #visible?: ReturnType<typeof gridSections>
  #state?: "none" | "open" | "closed"
  readonly tree: SectionTree
  readonly count: number
  readonly folded: ReadonlySet<string>
  constructor(tree: SectionTree, count: number, folded: ReadonlySet<string> = new Set()) {
    this.tree = tree
    this.count = count
    this.folded = folded
  }
  get visible() {
    return (this.#visible ??= gridSections(this.tree, this.count, this.folded))
  }
  state() {
    if (this.#state) return this.#state
    if (!this.tree.nodes.size) return (this.#state = "none")
    for (const heading of this.visible.headings.values())
      if (!this.folded.has(heading.key)) return (this.#state = "open")
    return (this.#state = "closed")
  }
  toggle() {
    return this.state() === "open"
      ? new Set([...this.tree.nodes.values()].map((entry) => entry.key))
      : new Set<string>()
  }
  fold(key: string) {
    const next = new Set(this.folded)
    const section = [...this.tree.nodes.values()].find((entry) => entry.key === key)
    if (next.has(key)) {
      if (section) unfoldSamePage(this.tree, section, next)
    } else next.add(key)
    return next
  }
  expand(index: number) {
    const next = new Set(this.folded)
    for (const entry of this.tree.nodes.values()) if (entry.start < index && index < entry.end) next.delete(entry.key)
    return next
  }
  paths(page: number, ancestors: readonly string[]) {
    let index = paths.get(this.tree)
    if (!index) {
      index = new Map()
      for (const entry of this.tree.nodes.values()) {
        if (!index.has(entry.node)) index.set(entry.node, [])
        index.get(entry.node)!.push(entry)
      }
      paths.set(this.tree, index)
    }
    const matching: Section[] = []
    for (const key of ancestors) {
      const ranges = index.get(key)
      const match = ranges && rangeAt(ranges, page)
      if (match) matching.push(match)
    }
    return matching.toSorted((a, b) => a.id - b.id)
  }
}

// One visible ribbon opens every coincident section represented by its page.
export function unfoldSamePage(tree: SectionTree, section: Section, folded: Set<string>) {
  for (const entry of tree.nodes.values()) if (entry.start === section.start) folded.delete(entry.key)
}
