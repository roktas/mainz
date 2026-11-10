// Builds shared section trees and visible page ranges for List and Grid.

import type { SectionPath } from "./outline.ts"

export type Section = {
  id: number
  key: string
  node: string
  start: number
  end: number
  path: readonly string[]
  parent?: Section
  children: Section[]
}

export function sectionsOf(
  count: number,
  headings?: (page: number) => readonly SectionPath[],
  identity?: (page: number) => string,
) {
  const roots: Section[] = []
  const nodes = new Map<number, Section>()
  const open = new Map<string, Section>()
  if (!headings) return { roots, nodes }
  for (let page = 0; page < count; page++) {
    const present = new Set<string>()
    for (const { path, keys, starts } of headings(page)) {
      let siblings = roots
      let parent: Section | undefined
      for (let depth = 0; depth < path.length; depth++) {
        const key = keys[depth]
        present.add(key)
        let section = open.get(key)
        if (section && starts?.[depth] && section.start !== page) {
          // A repeated heading page starts a new Output group, even if the original TOC key matches.
          for (const [activeKey, active] of open) {
            for (let ancestor: Section | undefined = active; ancestor; ancestor = ancestor.parent)
              if (ancestor === section) {
                open.delete(activeKey)
                break
              }
          }
          section = undefined
        }
        if (!section) {
          if (starts && !starts[depth]) {
            // A reordered continuation is not a section start. A real child can still start here.
            parent = undefined
            siblings = roots
            continue
          }
          section = {
            id: nodes.size,
            key: JSON.stringify([identity?.(page) ?? page, key]),
            node: key,
            start: page,
            end: page + 1,
            path: path.slice(0, depth + 1),
            parent,
            children: [],
          }
          siblings.push(section)
          nodes.set(section.id, section)
          open.set(key, section)
        }
        section.end = page + 1
        siblings = section.children
        parent = section
      }
    }
    for (const key of open.keys()) if (!present.has(key)) open.delete(key)
  }
  return { roots, nodes }
}

export function gridSections(tree: ReturnType<typeof sectionsOf>, count: number, folded: ReadonlySet<string>) {
  const pages = new Set<number>()
  const headings = new Map<number, Section>()
  for (const row of flattenSections(tree.roots, count, folded)) {
    if (row >= 0) {
      pages.add(row)
      continue
    }
    const section = tree.nodes.get(-row - 1)!
    pages.add(section.start)
    // A single page image can carry one ribbon; prefer the outermost visible heading.
    if (!headings.has(section.start)) headings.set(section.start, section)
  }
  return { pages: [...pages].toSorted((a, b) => a - b), headings }
}

export function flattenSections(roots: readonly Section[], count: number, collapsed: ReadonlySet<string>) {
  const rows: number[] = []
  let page = 0
  const pages = (end: number) => {
    while (page < end) rows.push(page++)
  }
  const visit = (section: Section) => {
    pages(section.start)
    // Negative IDs distinguish headers from physical page indexes during virtualization.
    rows.push(-section.id - 1)
    if (collapsed.has(section.key)) page = Math.max(page, section.end)
    else {
      for (const child of section.children) visit(child)
      pages(section.end)
    }
  }
  for (const root of roots) visit(root)
  pages(count)
  return rows
}

// Grid has one ribbon per page, so coincident child disclosures cannot remain inaccessible.
export function unfoldSamePage(section: Section, folded: Set<string>) {
  folded.delete(section.key)
  for (const child of section.children) if (child.start === section.start) unfoldSamePage(child, folded)
}
