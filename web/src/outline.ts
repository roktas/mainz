// Owns source and composed Output outlines, section ranges, and authored/TOC display titles.

import type { PDFDocumentProxy } from "pdfjs-dist"
import { titleOf } from "./model.ts"
import type { Input, Page } from "./model.ts"

export type SectionPath = {
  path: readonly string[]
  keys: readonly string[]
  starts?: readonly boolean[]
  synthetic?: boolean
}
export type Outline = SectionPath & { title: string; depth: number; page: number; end: number }

export async function readOutline(
  pdf: Pick<PDFDocumentProxy, "numPages" | "getOutline" | "getDestination" | "getPageIndex">,
  cancelled = () => false,
): Promise<Outline[]> {
  const result: Outline[] = []
  const destinations = new Map<string, ReturnType<typeof pdf.getDestination>>()
  const pages = new Map<string, ReturnType<typeof pdf.getPageIndex>>()
  try {
    const pending = ((await pdf.getOutline()) ?? [])
      .map((node) => ({ node, path: [] as string[], keys: [] as string[], depth: 0 }))
      .toReversed()
    let visited = 0
    while (pending.length && visited++ < 10000 && !cancelled()) {
      const { node, path, keys, depth } = pending.pop()!
      if (path.length >= 64) continue
      const title = node.title?.trim() && node.title.length <= 4096 ? node.title : undefined
      const next = title ? [...path, title] : path
      const nextKeys = title ? [...keys, String(visited)] : keys
      let retained = false
      if (title)
        try {
          let destination = node.dest
          if (typeof destination === "string") {
            const name = destination
            if (!destinations.has(name)) destinations.set(name, pdf.getDestination(name))
            destination = await destinations.get(name)!
          }
          if (cancelled()) return []
          let page: number | undefined
          if (destination) {
            const target = destination[0]
            if (typeof target === "number") page = target
            else {
              const key = `${target.num}:${target.gen}`
              if (!pages.has(key)) pages.set(key, pdf.getPageIndex(target))
              page = await pages.get(key)
            }
          }
          if (cancelled()) return []
          if (typeof page === "number" && Number.isInteger(page) && page >= 0 && page < pdf.numPages) {
            result.push({ title, path: next, keys: nextKeys, depth, page, end: pdf.numPages - 1 })
            retained = true
          }
        } catch {
          // A broken navigation target must not prevent opening the PDF or reading its children.
        }
      for (const child of node.items.toReversed())
        pending.push({ node: child, path: next, keys: nextKeys, depth: retained ? depth + 1 : depth })
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
    for (let index = start; index <= end; index++) {
      const content = pages[index].content
      if (!("source" in content)) continue
      for (const entry of sectionsAt(source.input.outline, content.page)) {
        for (
          let ancestor: Outline | undefined = entry;
          ancestor && !headings.has(ancestor);
          ancestor = catalog.get(ancestor)!.parent
        )
          headings.set(ancestor, { entry: ancestor, page: index, children: [] })
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

const indexes = new WeakMap<readonly Outline[], readonly (readonly Outline[])[] | null>()
const maxIndexedSections = 250000

function leaves(matching: readonly Outline[]) {
  return matching.filter((entry, order) => {
    const next = matching[order + 1]
    return !next || next.depth <= entry.depth || !entry.keys.every((key, depth) => key === next.keys[depth])
  })
}

export function sectionsAt(outline: readonly Outline[] | undefined, page: number): readonly Outline[] {
  if (!outline?.length) return []
  let index = indexes.get(outline)
  if (index === undefined) {
    const changes = new Map<number, { add: number[]; remove: number[] }>()
    const change = (position: number) => {
      let entry = changes.get(position)
      if (!entry) changes.set(position, (entry = { add: [], remove: [] }))
      return entry
    }
    outline.forEach((entry, position) => {
      change(entry.page).add.push(position)
      change(entry.end + 1).remove.push(position)
    })
    const pages: Outline[][] = []
    const active = new Set<number>()
    let sections: Outline[] = []
    let references = 0
    for (const [position, edits] of [...changes].toSorted(([a], [b]) => a - b)) {
      while (pages.length < position) pages.push(sections)
      for (const removed of edits.remove) active.delete(removed)
      for (const added of edits.add) active.add(added)
      const matching = [...active].toSorted((a, b) => a - b).map((entry) => outline[entry])
      sections = leaves(matching)
      references += sections.length
      // Unusually overlapping bookmarks must not retain a page-by-section matrix.
      if (references > maxIndexedSections) {
        index = null
        break
      }
    }
    if (index !== null) index = pages
    indexes.set(outline, index)
  }
  if (index === null) return leaves(outline.filter((entry) => entry.page <= page && entry.end >= page))
  return index[page] ?? []
}

export type PageTitle = {
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
