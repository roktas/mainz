import type { PDFDocumentProxy } from "pdfjs-dist";
import type { Description, Scalar } from "./styles.ts";

export type Size = { width: number; height: number };
export type Content = { source: string; page: number } | { blank: Size };
export type Page = { id: string; content: Content };
export type Part = { id: string; pages: Page[]; copies: string; front: boolean };
export type Input = {
  id: string;
  name: string;
  bytes: Uint8Array;
  pdf: PDFDocumentProxy;
  description: Description;
  sizes: Size[];
  labels: string[];
};
export type Source = {
  id: string;
  input: Input;
  pdf: PDFDocumentProxy;
  overrides: Record<string, Scalar>;
  pdfPages?: number[];
  drafts: Record<string, string>;
  status: "ready" | "pending" | "error";
  error?: string;
  revision: number;
};
export type Expanded = Page & { part: string; copy: number; padding: boolean };
export type Job = {
  version: 1;
  sources: Record<string, { input: string; overrides: Record<string, Scalar> }>;
  parts: { pages: Content[]; copies: number; front: boolean }[];
};
export const maxCopies = 1000;
export const maxPages = 10000;
// getRandomValues also works over local-network HTTP.
export const uid = () => crypto.getRandomValues(new Uint32Array(4)).join("-");
const pad = (value: number) => String(value).padStart(2, "0");

export function appearance(source: Source, page: number) {
  const index = source.pdfPages?.indexOf(page) ?? page;
  return index < 0 ? { pdf: source.input.pdf, page } : { pdf: source.pdf, page: index };
}

export function positionAfterEdit(previous: Page[], next: Page[], position: number): number {
  const positions = new Map(next.map((page, index) => [page.id, index]));
  const index = positions.get(previous[position]?.id);
  if (index !== undefined) return index;
  const neighbor =
    previous.slice(position + 1).find((page) => positions.has(page.id)) ??
    previous.slice(0, position).findLast((page) => positions.has(page.id));
  return neighbor ? positions.get(neighbor.id)! : 0;
}

export function downloadName(
  parts: Part[],
  sources: { id: string; input: { name: string } }[],
  date = new Date(),
): string {
  const content = parts.flatMap((part) => part.pages).find((page) => "source" in page.content)?.content;
  const name =
    content && "source" in content ? sources.find((source) => source.id === content.source)?.input.name : undefined;
  const stem = name?.replace(/\.pdf$/i, "") || "blank-pages";
  return `${stem}_${String(date.getFullYear()).padStart(4, "0")}-${pad(date.getMonth() + 1)}${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}-${pad(date.getSeconds())}${pad(Math.floor(date.getMilliseconds() / 10))}.pdf`;
}

export function copyError(text: string): string | undefined {
  if (!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text) < 1 || Number(text) > maxCopies)
    return `Enter a whole number from 1 to ${maxCopies}.`;
}

export function sizeOf(content: Content, sources: { id: string; input: { sizes: Size[] } }[]): Size {
  if ("blank" in content) return content.blank;
  const size = sources.find((source) => source.id === content.source)?.input.sizes[content.page];
  if (!size) throw new Error("Input page dimensions are unavailable.");
  return size;
}

export function expand(parts: Part[], sources: { id: string; input: { sizes: Size[] } }[]): Expanded[] {
  const result: Expanded[] = [];
  function push(page: Expanded) {
    if (result.length >= maxPages) throw new Error(`The composition preview supports up to ${maxPages} PDF pages.`);
    result.push(page);
  }
  for (const part of parts) {
    const error = copyError(part.copies);
    if (error) throw new Error(error);
    if (!part.pages.length) throw new Error("Output needs at least one page.");
    function padding(copy: number, id: string) {
      const preceding = result.at(-1);
      if (!preceding) return;
      push({
        id,
        content: { blank: { ...sizeOf(preceding.content, sources) } },
        part: part.id,
        copy,
        padding: true,
      });
    }
    if (part.front && result.length % 2) padding(0, `${part.id}:leading`);
    for (let copy = 0; copy < Number(part.copies); copy++) {
      for (const page of part.pages)
        push({
          id: copy === 0 ? page.id : `${part.id}:${copy}:${page.id}`,
          content: page.content,
          part: part.id,
          copy,
          padding: false,
        });
      if (part.front && part.pages.length % 2) padding(copy, `${part.id}:padding:${copy}`);
    }
  }
  return result;
}

export function move<T>(items: T[], indices: number[], offset: number): T[] {
  if (
    indices.some((index) => index < 0 || index >= items.length || index + offset < 0 || index + offset >= items.length)
  )
    return items;
  const result = [...items];
  for (const index of offset < 0 ? indices : indices.toReversed())
    [result[index], result[index + offset]] = [result[index + offset], result[index]];
  return result;
}

export function job(
  parts: Part[],
  sources: {
    id: string;
    input: { id: string; sizes: Size[] };
    overrides: Record<string, Scalar>;
  }[],
): Job {
  if (!parts.length) throw new Error("Add pages to Output before downloading.");
  expand(parts, sources);
  const used = new Set(
    parts.flatMap((part) => part.pages.flatMap((page) => ("source" in page.content ? [page.content.source] : []))),
  );
  return {
    version: 1,
    sources: Object.fromEntries(
      sources
        .filter((source) => used.has(source.id))
        .map((source) => [source.id, { input: source.input.id, overrides: { ...source.overrides } }]),
    ),
    parts: parts.map((part) => ({
      pages: part.pages.map((page) => structuredClone(page.content)),
      copies: Number(part.copies),
      front: part.front,
    })),
  };
}
