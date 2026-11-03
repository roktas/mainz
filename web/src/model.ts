// Defines workspace Inputs, style intent, occurrence identities, and composition Plan validation.

import type { PDFDocumentProxy } from "pdfjs-dist"
import type { Description, Scalar, StyleState, Usage } from "./styles.ts"

export type Size = { width: number; height: number }
export type Content = { source: string; page: number } | { blank: Size }
export type Page = { id: string; content: Content }
export type Part = { id: string; pages: readonly Page[]; copies: number; front: boolean }
export type Input = {
  id: string
  name: string
  bytes: Uint8Array
  pdf: PDFDocumentProxy
  description: Description
  sha256?: string
  sizes: Size[]
  labels: string[]
  title?: string
  coverPage?: number
  cover?: string
  xmp?: Record<string, string>
}
export type Source = StyleState & {
  id: string
  input: Input
  preview: Preview
  modified: boolean
}
export type Preview = {
  readonly displayed: { readonly pdf: PDFDocumentProxy }
  readonly status: "ready" | "pending" | "error"
  readonly error: string | undefined
  appearance: (page: number) => {
    pdf: PDFDocumentProxy
    page: number
    preview?: Description["pages"][number]["preview"]
  }
  download: (
    source: Source,
    pages: readonly number[],
    metadata: NonNullable<Plan["metadata"]>,
  ) => ArrayBuffer | undefined
  reconcile: (source: Source, counts: Usage) => void
  schedule: (source: Source, counts: Usage, text?: string, serial?: boolean) => void
  cancel: () => void
  dispose: () => void
}
export type Expanded = Page & { part: string; copy: number; padding: boolean }
export type Plan = {
  version: 1
  metadata?: { title: string; coverPage: number }
  sources: Record<string, { input: string; overrides: Record<string, Scalar> }>
  parts: { pages: Content[]; copies: number; front: boolean }[]
}
export const maxCopies = 1000
export const maxPages = 10000
export const maxInputBytes = 128 * 1024 * 1024
// getRandomValues also works over local-network HTTP.
export const uid = () => crypto.getRandomValues(new Uint32Array(4)).join("-")
export function titleError(title: string): string {
  if (!title.trim() || new TextEncoder().encode(title).length > 4096) return "Enter a title of up to 4096 bytes."
  // XML 1.0 text must also be representable when written to PDF XMP.
  // oxlint-disable-next-line no-control-regex -- Reject characters XML cannot represent.
  if (!title.isWellFormed() || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/.test(title))
    return "Use a title without invalid text characters."
  return ""
}
export const titleOf = (input: Pick<Input, "name" | "title">) =>
  input.title && input.title !== input.name ? input.title : input.name.replace(/\.pdf$/i, "") || input.name
const pad = (value: number) => String(value).padStart(2, "0")

export function positionAfterEdit(
  previous: readonly Page[],
  positions: ReadonlyMap<string, number>,
  position: number,
): number {
  const index = positions.get(previous[position]?.id)
  if (index !== undefined) return index
  const neighbor =
    previous.slice(position + 1).find((page) => positions.has(page.id)) ??
    previous.slice(0, position).findLast((page) => positions.has(page.id))
  return neighbor ? positions.get(neighbor.id)! : 0
}

export function downloadName(
  parts: readonly Part[],
  sources: readonly { id: string; input: { name: string } }[],
  date = new Date(),
): string {
  const content = parts.flatMap((part) => part.pages).find((page) => "source" in page.content)?.content
  const name =
    content && "source" in content ? sources.find((source) => source.id === content.source)?.input.name : undefined
  const stem = name?.replace(/\.pdf$/i, "") || "blank-pages"
  return `${stem}_${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}-${pad(date.getSeconds())}${pad(Math.floor(date.getMilliseconds() / 10))}.pdf`
}

export function copyError(text: string): string | undefined {
  if (parseCopies(text) === undefined) return `Enter a whole number from 1 to ${maxCopies}.`
}

export function parseCopies(text: string): number | undefined {
  const copies = Number(text)
  if (/^\d+$/.test(text) && Number.isSafeInteger(copies) && copies >= 1 && copies <= maxCopies) return copies
}

export function downloadInputs<T extends { id: string; bytes: { length: number } }>(
  parts: readonly Part[],
  sources: readonly { id: string; input: T }[],
): T[] {
  const used = new Set(
    parts.flatMap((part) => part.pages.flatMap((page) => ("source" in page.content ? [page.content.source] : []))),
  )
  const referenced = sources.filter((source) => used.has(source.id))
  const inputs = [...new Map(referenced.map(({ input }) => [input.id, input])).values()]
  if (inputs.length > 32)
    throw new Error("Download supports up to 32 Inputs. Remove pages from an Input in Output to continue.")
  if (referenced.length > 32)
    throw new Error("Download supports up to 32 independent Input styles. Remove their pages from Output to continue.")
  if (inputs.reduce((total, input) => total + input.bytes.length, 0) > maxInputBytes)
    throw new Error("Inputs used by Output exceed the 128 MiB total limit. Remove pages from an Input to continue.")
  return inputs
}

export function sizeOf(content: Content, sources: readonly { id: string; input: { sizes: readonly Size[] } }[]): Size {
  if ("blank" in content) return content.blank
  const size = sources.find((source) => source.id === content.source)?.input.sizes[content.page]
  if (!size) throw new Error("Input page dimensions are unavailable.")
  return size
}

export function expand(
  parts: readonly Part[],
  sources: readonly { id: string; input: { sizes: readonly Size[] } }[],
): Expanded[] {
  const result: Expanded[] = []
  function push(page: Expanded) {
    if (result.length >= maxPages) throw new Error(`The composition preview supports up to ${maxPages} PDF pages.`)
    result.push(page)
  }
  for (const part of parts) {
    if (!Number.isSafeInteger(part.copies) || part.copies < 1 || part.copies > maxCopies)
      throw new Error(`Enter a whole number from 1 to ${maxCopies}.`)
    if (!part.pages.length) throw new Error("Output needs at least one page.")
    function padding(copy: number, id: string) {
      const preceding = result.at(-1)
      if (!preceding) return
      push({
        id,
        content: { blank: { ...sizeOf(preceding.content, sources) } },
        part: part.id,
        copy,
        padding: true,
      })
    }
    if (part.front && result.length % 2) padding(0, `${part.id}:leading`)
    for (let copy = 0; copy < part.copies; copy++) {
      for (const page of part.pages)
        push({
          id: copy === 0 ? page.id : `${part.id}:${copy}:${page.id}`,
          content: page.content,
          part: part.id,
          copy,
          padding: false,
        })
      if (part.front && part.pages.length % 2) padding(copy, `${part.id}:padding:${copy}`)
    }
  }
  return result
}

export function move<T>(items: readonly T[], indices: readonly number[], offset: number): readonly T[] {
  if (
    indices.some((index) => index < 0 || index >= items.length || index + offset < 0 || index + offset >= items.length)
  )
    return items
  const result = [...items]
  for (const index of offset < 0 ? indices : indices.toReversed())
    [result[index], result[index + offset]] = [result[index + offset], result[index]]
  return result
}

export function plan(
  parts: readonly Part[],
  sources: readonly {
    id: string
    input: { id: string; sizes: readonly Size[] }
    overrides: Record<string, Scalar>
  }[],
): Plan {
  if (!parts.length) throw new Error("Add pages to Output before downloading.")
  expand(parts, sources)
  const used = new Set(
    parts.flatMap((part) => part.pages.flatMap((page) => ("source" in page.content ? [page.content.source] : []))),
  )
  return {
    version: 1,
    sources: Object.fromEntries(
      sources
        .filter((source) => used.has(source.id))
        .map((source) => [source.id, { input: source.input.id, overrides: { ...source.overrides } }]),
    ),
    parts: parts.map((part) => ({
      pages: part.pages.map((page) => structuredClone(page.content)),
      copies: part.copies,
      front: part.front,
    })),
  }
}
