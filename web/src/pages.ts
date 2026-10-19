// Parses and toggles ordered page selections, and formats physical page ranges.

import { maxPages } from "./model.ts"

export type Sequence = {
  text: string
  pages: number[]
  repeat: string
  front: boolean
}

export function toggleSequence(selected: number[], page: number, anchor = page) {
  const first = Math.min(anchor, page),
    last = Math.max(anchor, page)
  const existing = new Set(selected)
  const adding = !existing.has(page)
  let pages = [...selected]
  if (adding) {
    for (let number = first; number <= last; number++) if (!existing.has(number)) pages.push(number)
  } else pages = pages.filter((number) => number < first || number > last)
  return { pages, first, last, adding }
}

export function parseSequence(text: string, count: number): { pages: number[]; error?: string } {
  if (!text.trim()) return { pages: [] }
  const selected: number[] = []
  for (const part of text.split(",")) {
    const match = /^\s*(\d+)\s*(?:-\s*(\d+)\s*)?$/.exec(part)
    if (!match) return { pages: [], error: "Use page numbers or ranges, such as 1,3-6." }
    const first = Number(match[1]),
      last = Number(match[2] ?? match[1])
    if (!Number.isSafeInteger(first) || !Number.isSafeInteger(last) || first < 1 || last > count || first > last)
      return { pages: [], error: `Use ascending ranges between 1 and ${count}.` }
    if (selected.length + last - first + 1 > maxPages)
      return { pages: [], error: `Choose up to ${maxPages} pages, including copies.` }
    for (let number = first; number <= last; number++) selected.push(number - 1)
  }
  return { pages: selected }
}

export function pageRanges(pages: number[]): string {
  const parts: string[] = []
  for (let i = 0; i < pages.length; i++) {
    const first = pages[i]
    while (i + 1 < pages.length && pages[i + 1] === pages[i] + 1) i++
    const last = pages[i]
    parts.push(first === last ? String(first + 1) : `${first + 1}-${last + 1}`)
  }
  return parts.join(", ")
}
