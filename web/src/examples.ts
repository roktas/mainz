// Owns demo startup, initial views, and first-use downloads before offline control.

import type { Content, Source } from "./model.ts"
import { uid } from "./model.ts"
import type { Sequence } from "./pages.ts"
import type { Output } from "./output.svelte.ts"
import { Processor } from "./processor.ts"
import gridPlan from "../test/fixtures/grid-plan.json"

export const query = new URLSearchParams(location.search)
const toc = query.get("demo") === "toc" || query.get("demo") === "toc-multiple"
export const initialViews = {
  input: toc
    ? "list"
    : import.meta.env.DEV && query.has("demo") && query.has("paint")
      ? "style"
      : import.meta.env.DEV && query.get("input") === "page"
        ? "page"
        : "grid",
  output: toc ? "list" : import.meta.env.DEV && query.get("output") === "page" ? "page" : "grid",
} as const

type Preset = { recipe: string; inputs: Record<string, string>; automatic?: boolean }
type Host = {
  readonly revision: number
  readonly disposed: boolean
  output: Output
  open: (bytes: Uint8Array, name: string) => Promise<Source | undefined>
  choose: (id: string, sequence: Sequence) => void
  recipe: (file: File, preset: Preset) => Promise<void>
  profile: (set: string, profile: string) => void
  preparing: (processor?: Processor) => void
  info: (text: string) => void
  error: (text: string) => void
}

export async function openExample(demo: string, host: Host) {
  let revision = host.revision
  const current = () => !host.disposed && revision === host.revision
  const base = import.meta.env.BASE_URL
  const arrange = (contents: Content[]) => {
    host.output.commit([
      { id: uid(), copies: 1, front: false, pages: contents.map((content) => ({ id: uid(), content })) },
    ])
    host.output.acknowledge(host.output.parts)
  }
  try {
    host.info("Loading demo…")
    if (demo === "toc" || demo === "toc-multiple") {
      const bytes = new Uint8Array(await (await fetchExample(`${base}toc/lorem.pdf`)).arrayBuffer())
      if (!current()) return
      const opened = await host.open(bytes, "lorem.pdf")
      revision = host.revision
      if (!opened || host.disposed) return
      const starts = [
        ...new Set(
          opened.input.outline
            ?.filter(
              (entry, index, entries) =>
                entry.depth >= 2 && (!entries[index + 1] || entries[index + 1].depth <= entry.depth),
            )
            .map((entry) => entry.page),
        ),
      ]
      if (starts.length < 3) throw new Error("The TOC sample is missing its sections.")
      const pages = [...starts.slice(0, 5), starts[1], starts[2], starts.at(-1)!, starts[1]].map((page) => ({
        source: opened.id,
        page,
      }))
      if (demo === "toc-multiple") {
        const secondaryBytes = new Uint8Array(await (await fetchExample(`${base}toc/bridge.pdf`)).arrayBuffer())
        if (!current()) return
        const secondary = await host.open(secondaryBytes, "bridge.pdf")
        revision = host.revision
        if (!secondary || host.disposed) return
        if (!secondary.input.outline || secondary.input.outline.length < 2)
          throw new Error("The TOC sample is missing its sections.")
        pages.splice(
          3,
          0,
          ...secondary.input.outline.slice(0, 2).map((entry) => ({ source: secondary.id, page: entry.page })),
        )
      }
      arrange(pages)
      host.info("TOC demo ready.")
      return opened.id
    }
    if (import.meta.env.DEV && demo.startsWith("recipe-")) {
      const checks = `${base}checks/`
      const response = await fetch(`${checks}cases.json`)
      if (!response.ok) throw new Error("The Recipe check fixtures are unavailable.")
      const cases: { id: string; pdf: string }[] = await response.json()
      const entry = cases.find((item) => item.id === demo.slice("recipe-".length))
      if (!entry) throw new Error(`Unknown Recipe check demo: ${demo}.`)
      const record = await fetch(`${checks}${entry.id}.json`)
      if (!record.ok) throw new Error("The Recipe check example is unavailable.")
      const bytes = await record.arrayBuffer()
      if (!current()) return
      await host.recipe(new File([bytes], `${entry.id}.json`, { type: "application/json" }), {
        recipe: `${checks}${entry.id}.json`,
        inputs: { book: `${checks}${entry.pdf}` },
        automatic: true,
      })
      return
    }
    if (demo === "recipe") {
      const bytes = await (await fetchExample(`${base}recipe.json`)).arrayBuffer()
      if (!current()) return
      await host.recipe(new File([bytes], "practice-session.json", { type: "application/json" }), {
        recipe: `${base}recipe.json`,
        inputs: {
          book: `${base}demo.pdf`,
          guides: `${base}recipe/guides.pdf`,
          crossings: `${base}recipe/crossings.pdf`,
        },
      })
      host.info("Recipe demo ready.")
      return
    }
    const grid = demo === "grid"
    if (demo !== "single" && demo !== "empty" && !grid) throw new Error(`Unknown demo: ${demo}. Choose a local PDF.`)
    const filename = grid ? "grid.pdf" : "demo.pdf"
    let bytes = new Uint8Array(
      await (await fetchExample(`${base}${grid && import.meta.env.DEV ? filename : "demo.pdf"}`)).arrayBuffer(),
    )
    if (!current()) return
    if (grid && !import.meta.env.DEV) {
      const processor = new Processor()
      host.preparing(processor)
      revision = host.revision
      try {
        bytes = new Uint8Array(
          (await processor.compose({ ...gridPlan, version: 1 }, [{ id: "fixture", bytes }], revision)).bytes,
        )
      } finally {
        processor.dispose()
        if (current()) host.preparing()
      }
      if (!current()) return
    }
    const source = await host.open(bytes, filename)
    revision = host.revision
    if (!source || host.disposed) return
    const pages = Array.from({ length: source.input.pdf.numPages }, (_, page) => page)
    if (grid) {
      arrange(pages.map((page) => ({ source: source.id, page })))
      host.info(`Grid workspace · ${pages.length} pages.`)
      return
    }
    host.info("Demo workspace ready.")
    if (demo === "empty") return
    host.choose(source.id, { text: `1-${pages.length}`, pages, repeat: "1", front: false })
    arrange([...pages, ...pages.slice(2), ...pages.slice(2)].map((page) => ({ source: source.id, page })))
    if (import.meta.env.DEV && query.has("paint")) {
      const set = source.input.description.profileSets?.find((entry) =>
        entry.profiles.some((profile) => profile.id === "inkjet"),
      )
      if (set) host.profile(set.id, "inkjet")
    }
  } catch (reason) {
    if (current()) host.error(reason instanceof Error ? reason.message : "Demo could not open.")
  }
}

export async function fetchExample(url: string, signal?: AbortSignal) {
  let response: Response
  try {
    response = await fetch(url, { signal, cache: "reload" })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new Error("Connect to download this demo before using it offline. You can also choose a local file.", {
      cause: error,
    })
  }
  if (!response.ok) throw new Error("This demo is unavailable. Connect and try again, or choose a local file.")
  if (import.meta.env.PROD && "serviceWorker" in navigator && !navigator.serviceWorker.controller) {
    const copy = response.clone()
    void navigator.serviceWorker.ready
      .then(async (registration) => {
        const bytes = await copy.arrayBuffer()
        registration.active?.postMessage({ type: "remember-example", url: response.url, bytes }, [bytes])
      })
      .catch(() => {})
  }
  return response
}
