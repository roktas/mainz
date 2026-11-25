// Owns source and composed Output outlines, section ranges, and authored/TOC display titles.

import type { PDFDocumentProxy } from "pdfjs-dist"
import { titleOf } from "./model.ts"
import type { Input, Page } from "./model.ts"

type SectionPath = {
  path: readonly string[]
  keys: readonly string[]
  synthetic?: boolean
}
export type Outline = SectionPath & { title: string; depth: number; page: number; end: number }

export async function readOutline(
  pdf: Pick<PDFDocumentProxy, "numPages" | "getOutline" | "getDestination" | "getPageIndex">,
  cancelled = () => false,
): Promise<Outline[]> {
  const result: Outline[] = []
  const encoder = new TextEncoder()
  try {
    const roots = (await pdf.getOutline()) ?? []
    if (cancelled() || !roots.length) return []
    type Collected = {
      title: string | undefined
      path: string[]
      keys: string[]
      parent: number
      dest: (typeof roots)[number]["dest"]
    }
    const collected: Collected[] = []
    const pending = roots.map((node) => ({ node, path: [] as string[], keys: [] as string[], parent: -1 })).toReversed()
    let visited = 0
    while (pending.length && visited++ < 10000 && !cancelled()) {
      const { node, path, keys, parent } = pending.pop()!
      if (path.length >= 64) continue
      const title =
        node.title?.trim() && node.title.length <= 4096 && encoder.encode(node.title).byteLength <= 4096
          ? node.title
          : undefined
      const next = title ? [...path, title] : path
      const nextKeys = title ? [...keys, String(visited)] : keys
      const index = collected.length
      collected.push({ title, path: next, keys: nextKeys, parent, dest: title ? node.dest : null })
      for (const child of node.items.toReversed())
        pending.push({ node: child, path: next, keys: nextKeys, parent: index })
    }
    if (cancelled()) return []
    const destinations = new Map<string, Awaited<ReturnType<typeof pdf.getDestination>> | undefined>()
    const names = [...new Set(collected.flatMap((entry) => (typeof entry.dest === "string" ? [entry.dest] : [])))]
    for (let start = 0; start < names.length && !cancelled(); start += 32) {
      const chunk = names.slice(start, start + 32)
      const resolved = await Promise.all(chunk.map((name) => pdf.getDestination(name).catch(() => undefined)))
      for (let i = 0; i < chunk.length; i++) destinations.set(chunk[i], resolved[i])
    }
    if (cancelled()) return []
    type Ref = { num: number; gen: number }
    const refs = new Map<string, Ref>()
    const resolvedDests = collected.map((entry) => {
      if (!entry.title || !entry.dest) return undefined
      const dest = typeof entry.dest === "string" ? destinations.get(entry.dest) : entry.dest
      const target = dest?.[0]
      if (target && typeof target !== "number") refs.set(`${target.num}:${target.gen}`, target)
      return dest
    })
    const pages = new Map<string, number | undefined>()
    const refEntries = [...refs.entries()]
    for (let start = 0; start < refEntries.length && !cancelled(); start += 32) {
      const chunk = refEntries.slice(start, start + 32)
      const resolved = await Promise.all(chunk.map(([, ref]) => pdf.getPageIndex(ref).catch(() => undefined)))
      for (let i = 0; i < chunk.length; i++) pages.set(chunk[i][0], resolved[i])
    }
    if (cancelled()) return []
    const depths = new Int32Array(collected.length)
    for (let i = 0; i < collected.length; i++) {
      const entry = collected[i]
      const depth = entry.parent === -1 ? 0 : depths[entry.parent]
      let retained = false
      if (entry.title) {
        const dest = resolvedDests[i]
        const target = dest?.[0]
        const page =
          target === undefined
            ? undefined
            : typeof target === "number"
              ? target
              : pages.get(`${target.num}:${target.gen}`)
        if (typeof page === "number" && Number.isInteger(page) && page >= 0 && page < pdf.numPages) {
          result.push({ title: entry.title, path: entry.path, keys: entry.keys, depth, page, end: pdf.numPages - 1 })
          retained = true
        }
      }
      depths[i] = retained ? depth + 1 : depth
    }
  } catch {
    return []
  }
  if (cancelled()) return []
  return ranges(result)
}

function ranges(outline: Outline[]) {
  const open: Outline[] = []
  for (const entry of outline) {
    while (open.length && entry.depth <= open.at(-1)!.depth) {
      const previous = open.pop()!
      previous.end = Math.max(previous.page, entry.page - 1)
    }
    open.push(entry)
  }
  return outline
}

export function projection() {
  type Source = { id: string; title?: string; input: Input }
  let previousPages: readonly Page[] = []
  let previousSources: readonly Source[] = []
  let cached: { outline: Outline[] | undefined; sources: readonly Source[] } | undefined
  return (pages: readonly Page[], sources: readonly Source[]) => {
    const samePages =
      pages.length === previousPages.length &&
      pages.every((page, index) => {
        const previous = previousPages[index]
        return (
          page.id === previous.id &&
          (page.content === previous.content ||
            ("source" in page.content &&
              "source" in previous.content &&
              page.content.source === previous.content.source &&
              page.content.page === previous.content.page))
        )
      })
    const sameSources =
      sources.length === previousSources.length &&
      sources.every((source, index) => {
        const previous = previousSources[index]
        return source.id === previous.id && source.input === previous.input && source.title === previous.title
      })
    if (!cached || !samePages || !sameSources) {
      previousPages = pages
      previousSources = sources.map(({ id, input, title }) => ({ id, input, title }))
      cached = { outline: composeOutline(pages, previousSources), sources: previousSources }
    }
    return cached
  }
}

export function composeOutline(
  pages: readonly Page[],
  sources: readonly { id: string; title?: string; input: Pick<Input, "name" | "title" | "outline"> }[],
): Outline[] | undefined {
  const blocks: { source: string; start: number }[] = []
  const used = new Set<string>()
  let previous: string | undefined
  for (const [index, { content }] of pages.entries()) {
    if (!("source" in content) || content.source === previous) continue
    blocks.push({ source: content.source, start: index })
    used.add(content.source)
    previous = content.source
  }
  if (used.size < 2) return
  const catalogs = new Map<string, Map<Outline, { parent?: Outline; order: number }>>()
  const result: Outline[] = []
  for (const [block, { source: id, start }] of blocks.entries()) {
    const source = sources.find((candidate) => candidate.id === id)
    if (!source) return
    const end = (blocks[block + 1]?.start ?? pages.length) - 1
    const title = source.title ?? titleOf(source.input)
    const key = pages[start].id
    result.push({ title, path: [title], keys: [key], depth: 0, page: start, end })
    let catalog = catalogs.get(id)
    if (!catalog) {
      catalog = new Map()
      const open: Outline[] = []
      for (const [order, entry] of (source.input.outline ?? []).entries()) {
        while (open.length && open.at(-1)!.depth >= entry.depth) open.pop()
        catalog.set(entry, { parent: open.at(-1), order })
        open.push(entry)
      }
      catalogs.set(id, catalog)
    }
    type Heading = { entry: Outline; page: number; children: Heading[] }
    const headings = new Map<Outline, Heading>()
    const roots: Heading[] = []
    const outline = source.input.outline
    if (outline?.length) {
      const { nodes, count } = indexOf(outline)
      const visited = new Set<number>()
      for (let index = start; index <= end; index++) {
        const content = pages[index].content
        if (!("source" in content) || content.page < 0 || content.page >= count) continue
        // Later occurrences under the same index node cannot retarget its headings.
        for (let node = count + content.page; node > 0 && !visited.has(node); node >>= 1) {
          visited.add(node)
          for (const entry of nodes[node] ?? []) {
            for (
              let ancestor: Outline | undefined = outline[entry];
              ancestor && !headings.has(ancestor);
              ancestor = catalog.get(ancestor)!.parent
            )
              headings.set(ancestor, { entry: ancestor, page: index, children: [] })
          }
        }
      }
    }
    for (const heading of headings.values()) {
      const ancestor = catalog.get(heading.entry)!.parent
      const parent = ancestor && headings.get(ancestor)
      ;(parent?.children ?? roots).push(heading)
    }
    const append = (siblings: Heading[], path: string[], keys: string[]) => {
      for (const { entry, page, children } of siblings.toSorted(
        (a, b) => a.page - b.page || catalog.get(a.entry)!.order - catalog.get(b.entry)!.order,
      )) {
        const nextPath = [...path, entry.title]
        const nextKeys = [...keys, `${key}:${entry.keys.at(-1)!}`]
        result.push({
          title: entry.title,
          path: nextPath,
          keys: nextKeys,
          depth: path.length,
          page,
          end,
          synthetic: entry.synthetic,
        })
        append(children, nextPath, nextKeys)
      }
    }
    append(roots, [title], [key])
  }
  return ranges(result)
}

export function edgeName(name: string | undefined, edge: "first" | "last") {
  const pattern = edge === "first" ? /^(cover|front|first)$/i : /^(cover|back|last)$/i
  return name && pattern.test(name.trim()) ? name : undefined
}

// Only uncovered edge ranges qualify; bookmark targets do not reveal a final chapter's end.
export function frameOutline(outline: readonly Outline[], pages: readonly { name?: string }[]): Outline[] {
  if (!outline.length) return []
  let first = pages.length
  let last = -1
  for (const entry of outline) {
    first = Math.min(first, entry.page)
    last = Math.max(last, entry.end)
  }
  const start = edgeName(pages[0]?.name, "first") ? 1 : 0
  const end = pages.length - (edgeName(pages.at(-1)?.name, "last") ? 2 : 1)
  const result = [...outline]
  if (start < first)
    result.unshift({
      title: "…",
      path: ["…"],
      keys: ["leading"],
      depth: 0,
      page: start,
      end: first - 1,
      synthetic: true,
    })
  if (last < end)
    result.push({
      title: "…",
      path: ["…"],
      keys: ["trailing"],
      depth: 0,
      page: last + 1,
      end,
      synthetic: true,
    })
  return result
}

type Intervals = { count: number; nodes: number[][] }
const indexes = new WeakMap<readonly Outline[], Intervals>()

function indexOf(outline: readonly Outline[]): Intervals {
  const cached = indexes.get(outline)
  if (cached) return cached
  const count = outline.reduce((length, entry) => Math.max(length, entry.end + 1), 0)
  const nodes = Array<number[]>(2 * count)
  outline.forEach(({ page, end }, index) => {
    // Each interval belongs to disjoint tree nodes. A page visits just its own ancestors.
    for (let left = count + page, right = count + end + 1; left < right; left >>= 1, right >>= 1) {
      if (left % 2) (nodes[left++] ??= []).push(index)
      if (right % 2) (nodes[--right] ??= []).push(index)
    }
  })
  const index = { count, nodes }
  indexes.set(outline, index)
  return index
}

function leaves(matching: readonly Outline[]) {
  return matching.filter((entry, order) => {
    const next = matching[order + 1]
    return !next || next.depth <= entry.depth || !entry.keys.every((key, depth) => key === next.keys[depth])
  })
}

export function sectionsAt(outline: readonly Outline[] | undefined, page: number): readonly Outline[] {
  if (!outline?.length) return []
  const { count, nodes } = indexOf(outline)
  if (page < 0 || page >= count) return []
  const matching: number[] = []
  for (let node = count + page; node > 0; node >>= 1) if (nodes[node]) matching.push(...nodes[node])
  return leaves(matching.toSorted((a, b) => a - b).map((entry) => outline[entry]))
}

type PageTitle = {
  name?: string
  paths?: readonly (readonly string[])[]
  context: readonly (readonly string[])[]
  headings: readonly SectionPath[]
}
type TitleInput = Pick<Input, "description" | "outline">
const titles = new WeakMap<TitleInput, Titles>()
const untitled: PageTitle = { context: [], headings: [] }

class Titles {
  readonly choice: boolean
  #input: TitleInput
  #pages = new Map<number, { authored: PageTitle; toc: PageTitle }>()

  constructor(input: TitleInput) {
    this.#input = input
    this.choice = input.description.pages.some((page, position) => {
      if (!page.name) return false
      const section = sectionsAt(input.outline, position)[0]
      return !!section && page.name !== section.title
    })
  }

  at(position: number, preferTOC = false): PageTitle {
    const page = this.#input.description.pages[position]
    if (!page) return untitled
    let result = this.#pages.get(position)
    if (result) this.#pages.delete(position)
    else {
      const sections = sectionsAt(this.#input.outline, position)
      const section = sections[0]
      const paths = sections.map((entry) => entry.path)
      const authored: PageTitle = {
        name: page.name ?? section?.title,
        paths: page.name ? undefined : paths,
        context: page.name
          ? sections
              .map((entry) => (entry.title === page.name ? entry.path.slice(0, -1) : entry.path))
              .filter((path) => path.length)
          : [],
        headings: sections,
      }
      result = { authored, toc: section ? { ...authored, name: section.title, paths, context: [] } : authored }
      // Retain recently visible identities rather than every page's breadcrumb arrays.
      if (this.#pages.size >= 128) this.#pages.delete(this.#pages.keys().next().value!)
    }
    this.#pages.set(position, result)
    return result[preferTOC ? "toc" : "authored"]
  }
}

export function titlesOf(input: TitleInput) {
  let result = titles.get(input)
  if (!result) titles.set(input, (result = new Titles(input)))
  return result
}
