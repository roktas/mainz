// Owns PDF section hierarchy, indexed page ranges, and authored/TOC display-title policy.

import type { PDFDocumentProxy } from "pdfjs-dist"
import type { Input } from "./model.ts"

export type Outline = { title: string; path: string[]; depth: number; page: number; end: number }

export async function readOutline(
  pdf: Pick<PDFDocumentProxy, "numPages" | "getOutline" | "getDestination" | "getPageIndex">,
  cancelled = () => false,
): Promise<Outline[]> {
  const result: Outline[] = []
  try {
    const pending = ((await pdf.getOutline()) ?? [])
      .map((node) => ({ node, path: [] as string[], depth: 0 }))
      .toReversed()
    let visited = 0
    while (pending.length && visited++ < 10000 && !cancelled()) {
      const { node, path, depth } = pending.pop()!
      if (path.length >= 64) continue
      const title = node.title?.trim() && node.title.length <= 4096 ? node.title : undefined
      const next = title ? [...path, title] : path
      let retained = false
      if (title)
        try {
          const destination = typeof node.dest === "string" ? await pdf.getDestination(node.dest) : node.dest
          const page =
            destination &&
            (typeof destination[0] === "number" ? destination[0] : await pdf.getPageIndex(destination[0]))
          if (typeof page === "number" && Number.isInteger(page) && page >= 0 && page < pdf.numPages) {
            result.push({ title, path: next, depth, page, end: pdf.numPages - 1 })
            retained = true
          }
        } catch {
          // A broken navigation target must not prevent opening the PDF or reading its children.
        }
      for (const child of node.items.toReversed())
        pending.push({ node: child, path: next, depth: retained ? depth + 1 : depth })
    }
  } catch {
    return []
  }
  if (cancelled()) return []
  const open: Outline[] = []
  for (const entry of result) {
    while (open.length && entry.depth <= open.at(-1)!.depth) {
      const previous = open.pop()!
      previous.end = Math.max(previous.page, entry.page - 1)
    }
    open.push(entry)
  }
  return result
}

const indexes = new WeakMap<readonly Outline[], readonly (readonly Outline[])[] | null>()
const maxIndexedSections = 250000

function leaves(matching: readonly Outline[]) {
  return matching.filter((entry, order) => {
    const next = matching[order + 1]
    return !next || next.depth <= entry.depth || !entry.path.every((part, depth) => part === next.path[depth])
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
  heading: readonly string[]
  sectionCount: number
}
type TitleInput = Pick<Input, "description" | "outline">
const titles = new WeakMap<TitleInput, Titles>()
const untitled: PageTitle = { context: [], heading: [], sectionCount: 0 }

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
        heading: section ? (section.path.length > 1 ? section.path.slice(0, -1) : section.path) : [],
        sectionCount: sections.length,
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
