// Applies Output page edits and retains occurrence identities and the dimensions of materialized Blanks.

import { move, sizeOf, uid } from "./model.ts"
import type { Page, Part, Source } from "./model.ts"

export function part(pages: Page[], copies = "1", front = false): Part {
  return { id: uid(), pages: pages.map(({ id, content }) => ({ id, content })), copies, front }
}

export function materialize(pages: Page[]): Part[] {
  return pages.length ? [part(pages)] : []
}

export function insert(parts: Part[], pages: Page[], addition: Part, from?: number, to = from): Part[] {
  if (from === undefined) return [...parts, addition]
  return [...materialize(pages.slice(0, from)), addition, ...materialize(pages.slice(to))]
}

export function order(pages: Page[], ids: string[], offset: number) {
  const moving = new Set(ids)
  const indices = pages.flatMap((page, index) => (moving.has(page.id) ? [index] : []))
  if (!indices.length || (offset < 0 ? indices[0] === 0 : indices.at(-1) === pages.length - 1)) return
  return { pages: move(pages, indices, offset), count: indices.length }
}

export function duplicate(pages: Page[], ids: string[]) {
  const copying = new Set(ids)
  const indices = pages.flatMap((page, index) => (copying.has(page.id) ? [index] : []))
  if (!indices.length) return
  const copies = indices.map((index) => ({ id: uid(), content: pages[index].content }))
  const at = indices.at(-1)! + 1
  return { pages: pages.toSpliced(at, 0, ...copies), ids: copies.map((page) => page.id), at }
}

export function remove(pages: Page[], ids: string[]) {
  const removed = new Set(ids)
  const remaining = pages.filter((page) => !removed.has(page.id))
  const count = pages.length - remaining.length
  if (count) return { pages: remaining, count }
}

export function blank(pages: Page[], at: number, sources: Source[]) {
  const neighbor = pages[at - 1] ?? pages[at]
  if (!neighbor) return
  const page = { id: uid(), content: { blank: { ...sizeOf(neighbor.content, sources) } } }
  return { pages: pages.toSpliced(at, 0, page), id: page.id }
}

export function transfer(pages: Page[], ids: string[], at: number) {
  const selected = new Set(ids)
  const moving = pages.filter((page) => selected.has(page.id))
  const remaining = pages.filter((page) => !selected.has(page.id))
  const position = at - pages.slice(0, at).filter((page) => selected.has(page.id)).length
  return { pages: remaining.toSpliced(position, 0, ...moving), position, count: moving.length }
}
