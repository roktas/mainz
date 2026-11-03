// Owns Output composition, file identity, occurrence selection, inspection, and Download acknowledgment.

import { expand, positionAfterEdit, titleOf } from "./model.ts"
import type { Expanded, Part, Source } from "./model.ts"
import { select } from "./composition.ts"

type Projection = {
  parts: readonly Part[]
  pages: readonly Expanded[]
  positions: ReadonlyMap<string, number>
}
export type Edit = {
  pages: readonly Expanded[]
  selected: readonly string[]
  inspected: string | undefined
  position: number
  added: ReadonlySet<string>
  removed: ReadonlySet<string>
}
type Destination = {
  select?: (pages: readonly Expanded[]) => readonly string[]
  inspect?: string
  focusSelection?: boolean
}

export class Output {
  filename = $state("")
  title = $state("")
  cover = $state<string>()
  #downloadedTitle = $state("")
  #downloadedCover = $state<string>()
  #sources: () => readonly Source[]
  #composition = $state.raw<Projection>({ parts: [], pages: [], positions: new Map() })
  #downloaded = $state.raw<readonly Part[]>(this.#composition.parts)
  #selection = $state.raw<ReadonlySet<string>>(new Set())
  #selected = $derived([...this.#selection].toSorted((a, b) => this.positions.get(a)! - this.positions.get(b)!))
  #anchor = $state<string>()
  #inspected = $state<string>()

  constructor(sources: () => readonly Source[]) {
    this.#sources = sources
  }

  get parts() {
    return this.#composition.parts
  }
  get pages() {
    return this.#composition.pages
  }
  get positions() {
    return this.#composition.positions
  }
  get selection() {
    return this.#selection
  }
  get selected(): readonly string[] {
    return this.#selected
  }
  get anchor() {
    return this.#anchor
  }
  get inspected() {
    return this.#inspected
  }
  set inspected(id: string | undefined) {
    if (id === undefined || this.positions.has(id)) this.#inspected = id
  }
  get position() {
    return this.positions.get(this.#inspected ?? "") ?? 0
  }
  set position(position: number) {
    this.#inspected = this.pages[Math.max(0, Math.min(this.pages.length - 1, position))]?.id
  }
  get modified() {
    return (
      this.parts !== this.#downloaded || this.title !== this.#downloadedTitle || this.cover !== this.#downloadedCover
    )
  }

  get coverPage() {
    return (this.positions.get(this.cover ?? "") ?? 0) + 1
  }
  set coverPage(page: number) {
    this.cover = page === 1 ? undefined : this.pages[page - 1]?.id
  }
  get defaultTitle() {
    const content = this.pages.find((page) => "source" in page.content)?.content
    const input =
      content && "source" in content ? this.#sources().find((source) => source.id === content.source)?.input : undefined
    return input ? titleOf(input) : "Blank pages"
  }
  get metadata() {
    return { title: this.title || this.defaultTitle, coverPage: this.coverPage }
  }

  acknowledge(parts: readonly Part[], title = this.title, cover = this.cover) {
    this.#downloaded = parts
    this.#downloadedTitle = title
    this.#downloadedCover = cover
  }

  select(ids: Iterable<string>, anchor?: string) {
    this.#selection = new Set([...ids].filter((id) => this.positions.has(id)))
    this.#anchor = anchor && this.positions.has(anchor) ? anchor : undefined
  }

  toggle(id: string, range: boolean, anchor?: string) {
    const next = select(this.pages, this.selection, id, range ? (this.#anchor ?? anchor) : undefined)
    this.select(next.selected, id)
    return next
  }

  commit(next: readonly Part[], destination: Destination = {}, before?: (edit: Edit) => void): Edit {
    const pages = expand(next, this.#sources())
    const positions = new Map(pages.map((page, index) => [page.id, index]))
    const selection = new Set([...(destination.select?.(pages) ?? this.#selection)].filter((id) => positions.has(id)))
    const selected = pages.filter((page) => selection.has(page.id)).map((page) => page.id)
    const previous = this.positions.get(destination.inspect ?? this.#inspected ?? "") ?? this.position
    const requested = destination.focusSelection ? selected.at(-1) : destination.inspect
    const position =
      requested && positions.has(requested)
        ? positions.get(requested)!
        : positionAfterEdit(this.pages, positions, previous)
    const inspected = pages[position]?.id
    const edit: Edit = {
      pages,
      selected,
      inspected,
      position,
      added: new Set(pages.filter((page) => !this.positions.has(page.id)).map((page) => page.id)),
      removed: new Set(this.pages.filter((page) => !positions.has(page.id)).map((page) => page.id)),
    }
    before?.(edit)
    const anchor = destination.select ? selected.at(-1) : this.#anchor
    this.#composition = { parts: next, pages, positions }
    this.#selection = selection
    this.#anchor = anchor && positions.has(anchor) ? anchor : undefined
    this.#inspected = inspected
    return edit
  }
}
