// Coordinates mouse press feedback and focus, and builds native/touch drag images.

import type { Size } from "./model.ts"

export function retainFocus(event: MouseEvent) {
  if (event.button !== 0) return
  const control = event.currentTarget as HTMLElement
  if ((event.ctrlKey || event.metaKey) && control.classList.contains("page-image")) {
    event.preventDefault()
    return
  }
  if (control.draggable) {
    control.setAttribute("data-press", "")
    const events = new AbortController()
    const release = () => {
      control.removeAttribute("data-press")
      events.abort()
    }
    for (const name of ["mouseup", "pointercancel", "dragend", "blur"])
      window.addEventListener(name, release, { once: true, signal: events.signal })
  }
  const focused = document.activeElement
  if (focused === control) return
  let frame: number
  const restore = () => {
    cancelAnimationFrame(frame)
    control.removeEventListener("dragstart", restore)
    window.removeEventListener("mouseup", restore)
    if (document.activeElement !== control) return
    control.blur()
    if (focused instanceof HTMLElement && focused !== document.body) focused.focus({ preventScroll: true })
  }
  // Restore after native mousedown; changing focus inside it prevents dragging.
  control.addEventListener("dragstart", restore, { once: true })
  window.addEventListener("mouseup", restore, { once: true })
  frame = requestAnimationFrame(restore)
}

export function createDragImage(control: HTMLElement, quantity: number, size?: Size, floating = false) {
  const row = control.closest<HTMLElement>(".list-row")
  if (row) {
    const bounds = row.getBoundingClientRect(),
      style = getComputedStyle(row),
      choice = row.querySelector<HTMLElement>(".list-choice")!,
      text = choice.textContent?.trim() ?? "",
      font = getComputedStyle(choice),
      width = Math.min(bounds.width, innerWidth - 24, floating ? 320 : Infinity),
      height = bounds.height,
      numberCell = row.querySelector<HTMLElement>(".list-number")!,
      numberWidth = numberCell.getBoundingClientRect().width,
      numberOffset = numberCell.getBoundingClientRect().left - bounds.left,
      nameOffset = choice.getBoundingClientRect().left - bounds.left,
      original = numberCell.querySelector("strong")?.textContent?.trim() ?? "",
      number = document.createElement("strong")
    const thumbnail = document.createElement("canvas"),
      image = document.createElement("div")
    thumbnail.width = Math.ceil(width)
    thumbnail.height = Math.ceil(height)
    const paint = thumbnail.getContext("2d")!
    const colors = document.createElement("span")
    colors.style.cssText = "background:var(--surface);color:var(--edge)"
    row.append(colors)
    const palette = getComputedStyle(colors)
    paint.fillStyle = style.backgroundColor === "rgba(0, 0, 0, 0)" ? palette.backgroundColor : style.backgroundColor
    paint.fillRect(0, 0, width, height)
    paint.strokeStyle = palette.color
    image.style.backgroundColor = paint.fillStyle
    image.style.outlineColor = palette.color
    colors.remove()
    paint.strokeRect(0.5, 0.5, width - 1, height - 1)
    paint.fillStyle = style.color
    paint.font = `${font.fontWeight} ${font.fontSize} ${font.fontFamily}`
    paint.textBaseline = "middle"
    const available = width - nameOffset - 28 - (quantity > 1 ? 52 : 0)
    let label = text
    if (paint.measureText(text).width > available) {
      let low = 0,
        high = text.length
      while (low < high) {
        const middle = Math.ceil((low + high) / 2)
        if (paint.measureText(text.slice(0, middle) + "…").width <= available) low = middle
        else high = middle - 1
      }
      label = text.slice(0, low) + "…"
    }
    paint.fillText(label, nameOffset + parseFloat(font.paddingInlineStart), height / 2)
    if (quantity > 1) {
      paint.textAlign = "end"
      paint.fillText(`×${quantity}`, width - 14, height / 2)
    }
    image.className = "drag-image"
    image.dataset.strip = ""
    image.style.inlineSize = `${width}px`
    image.style.blockSize = `${height}px`
    image.style.font = `${font.fontWeight} ${font.fontSize}/${font.lineHeight} ${font.fontFamily}`
    image.style.gridTemplateColumns = `${numberOffset}px ${numberWidth}px ${Math.max(0, nameOffset - numberOffset - numberWidth)}px minmax(0,1fr) auto`
    image.style.color = style.color
    number.className = "drag-number"
    number.textContent = original
    number.style.font = getComputedStyle(numberCell.querySelector("strong")!).font
    image.append(number)
    const title = document.createElement("span")
    title.className = "drag-title"
    title.textContent = text
    image.append(title)
    if (quantity > 1) {
      const count = document.createElement("span")
      count.textContent = `×${quantity}`
      image.append(count)
    }
    image.setAttribute("aria-hidden", "true")
    document.body.append(image)
    return { image, thumbnail, width, height, number, original, origin: { x: bounds.left, y: bounds.top } }
  }
  const card =
    control.closest(".composition-card, .page-view") ??
    control.closest(".selection-panel")?.querySelector(".composition-card.selected, .page-view")
  const sheet = card?.querySelector<HTMLElement>(
    ".page-image canvas, .page-scroll canvas, .page-image .composition-blank, .page-scroll .blank-sheet",
  )
  const bounds = sheet?.getBoundingClientRect() ?? size
  if (bounds?.width && bounds.height) {
    const limit = { width: 120, height: 160 }
    const layers = Math.min(3, quantity)
    const offset = (layers - 1) * 6
    const scale = Math.min((limit.width - 2 - offset) / bounds.width, (limit.height - 2 - offset) / bounds.height)
    const width = Math.round(bounds.width * scale) + 2
    const height = Math.round(bounds.height * scale) + 2
    const cssWidth = width + offset,
      cssHeight = height + offset,
      density = Math.min(Math.max(devicePixelRatio, 2), 3)
    const image = document.createElement("div"),
      raster = document.createElement("canvas"),
      number = document.createElement("strong"),
      original =
        card?.querySelector(".page-origin strong, .page-number strong, .page-position strong")?.textContent?.trim() ??
        ""
    number.className = "drag-number"
    number.textContent = original
    image.dataset.card = ""
    image.append(number)
    if (quantity > 1) {
      const count = document.createElement("span")
      count.className = "drag-count"
      count.textContent = `×${quantity}`
      image.append(count)
    }
    raster.width = Math.ceil(cssWidth * density)
    raster.height = Math.ceil(cssHeight * density)
    raster.style.inlineSize = `${cssWidth}px`
    raster.style.blockSize = `${cssHeight}px`
    raster.style.display = "block"
    image.style.inlineSize = `${cssWidth}px`
    image.style.blockSize = `${cssHeight + 22}px`
    image.append(raster)
    const context = raster.getContext("2d")
    if (context) {
      context.scale(density, density)
      const thumbnail = document.createElement("canvas")
      thumbnail.width = Math.ceil((width - 2) * density)
      thumbnail.height = Math.ceil((height - 2) * density)
      const paint = thumbnail.getContext("2d")!
      paint.fillStyle = "oklch(100% 0 none)"
      paint.fillRect(0, 0, thumbnail.width, thumbnail.height)
      if (sheet instanceof HTMLCanvasElement && sheet.width && sheet.height)
        paint.drawImage(sheet, 0, 0, thumbnail.width, thumbnail.height)
      context.fillStyle = "oklch(100% 0 none)"
      context.strokeStyle = getComputedStyle(card ?? control).borderColor
      for (let layer = layers - 1; layer >= 0; layer--) {
        const inset = layer * 6
        context.fillRect(inset, inset, width, height)
        context.strokeRect(inset + 0.5, inset + 0.5, width - 1, height - 1)
      }
      context.drawImage(thumbnail, 1, 1, width - 2, height - 2)
      image.className = "drag-image"
      image.setAttribute("aria-hidden", "true")
      document.body.append(image)
      image.getBoundingClientRect()
      return { image, thumbnail, width: cssWidth, height: cssHeight + 22, number, original }
    }
  }
}
