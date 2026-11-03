// Owns a browser download's temporary URL until replacement, disposal, or expiry.

export class Download {
  #url: string | undefined
  #timer: ReturnType<typeof setTimeout> | undefined

  save(blob: Blob, name: string) {
    this.dispose()
    this.#url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = this.#url
    link.download = name
    link.click()
    this.#timer = setTimeout(() => this.dispose(), 30000)
  }

  dispose() {
    clearTimeout(this.#timer)
    if (this.#url) URL.revokeObjectURL(this.#url)
    this.#url = undefined
  }
}
