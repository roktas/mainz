// Presents screencast previews and native format selection without loading PDF processing.

import catalog from "../public/help/catalog.json"
import { mount } from "svelte"
import Icon from "./Icon.svelte"
import Logo from "./Logo.svelte"
import Theme from "./Theme.svelte"
import "./shell.css"
import "./screencasts.css"

mount(Logo, { target: document.querySelector(".brand")! })
mount(Theme, { target: document.querySelector(".header-actions")! })

const root = new URL(".", document.baseURI)
const id = new URL(location.href).pathname.match(/\/help\/([^/]+?)(?:\.html)?\/?$/)?.[1] ?? ""
const main = document.querySelector<HTMLElement>("main")!
const heading = main.querySelector("h1")!
const menu = main.querySelector("nav")!
const screencast = catalog.find((item) => item.id === id)

function loading(container: HTMLElement, image: HTMLImageElement) {
  container.classList.add("screencast-media")
  if (image.complete && image.naturalWidth) {
    container.setAttribute("aria-busy", "false")
    return
  }
  container.setAttribute("aria-busy", "true")
  const status = document.createElement("span")
  status.className = "screencast-loading"
  status.hidden = true
  status.setAttribute("role", "status")
  const label = "Loading screencast…"
  status.setAttribute("aria-label", label)
  const spinner = document.createElement("span")
  spinner.className = "spinner"
  spinner.setAttribute("aria-hidden", "true")
  const message = document.createElement("span")
  message.className = "visually-hidden"
  message.textContent = label
  status.append(spinner, message)
  container.append(status)
  let timer: ReturnType<typeof setTimeout> | undefined
  let observer: IntersectionObserver | undefined
  const schedule = () => {
    if (timer === undefined) timer = setTimeout(() => (status.hidden = false), 180)
  }
  const rect = container.getBoundingClientRect()
  const visible =
    rect.width > 0 &&
    rect.height > 0 &&
    rect.bottom > 0 &&
    rect.top < innerHeight &&
    rect.right > 0 &&
    rect.left < innerWidth
  if (image.loading === "lazy" && !visible && typeof IntersectionObserver === "function") {
    observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer?.disconnect()
        observer = undefined
        if (!image.complete) schedule()
      }
    })
    observer.observe(container)
  } else {
    schedule()
  }
  const events = new AbortController()
  const cleanup = () => {
    clearTimeout(timer)
    events.abort()
    observer?.disconnect()
    observer = undefined
  }
  image.addEventListener(
    "load",
    () => {
      cleanup()
      if (!container.contains(status)) return
      container.setAttribute("aria-busy", "false")
      status.remove()
    },
    { once: true, signal: events.signal },
  )
  image.addEventListener(
    "error",
    () => {
      cleanup()
      if (!container.contains(status)) return
      container.setAttribute("aria-busy", "false")
      status.removeAttribute("aria-label")
      status.textContent = "Screencast could not load. Reload to try again."
      status.hidden = false
    },
    { once: true, signal: events.signal },
  )
}

if (screencast) {
  document.title = `${screencast.title} · PDF Composer`
  heading.textContent = screencast.title
  document.querySelector<HTMLAnchorElement>(".screencast-back")!.hidden = false
  menu.remove()
  const media = new URL(`help/${screencast.id}/${screencast.id}`, root).href
  const formats = document.createElement("div")
  formats.className = "screencast-formats"
  formats.setAttribute("role", "tablist")
  formats.setAttribute("aria-label", "Screencast format")
  const panel = document.createElement("div")
  panel.id = "screencast-player"
  panel.tabIndex = 0
  panel.setAttribute("role", "tabpanel")
  const video = document.createElement("video")
  video.controls = true
  video.playsInline = true
  video.preload = "none"
  video.width = 1920
  video.height = 1080
  video.poster = `${media}.png`
  video.setAttribute("aria-label", screencast.title)
  for (const [extension, type] of [
    ["webm", 'video/webm; codecs="vp9"'],
    ["mp4", "video/mp4"],
  ]) {
    const source = document.createElement("source")
    source.src = `${media}.${extension}`
    source.type = type
    video.append(source)
  }
  video.append("Choose another format if video playback is unavailable.")
  const animation = document.createElement("img")
  animation.width = 1920
  animation.height = 1080
  animation.alt = screencast.title
  let selected = video.canPlayType('video/webm; codecs="vp9"') ? "webm" : "mp4"
  const tabs = new Map<string, HTMLButtonElement>()
  function select(format: string) {
    selected = format
    for (const [name, tab] of tabs) {
      tab.setAttribute("aria-selected", String(name === format))
      tab.tabIndex = name === format ? 0 : -1
    }
    panel.setAttribute("aria-labelledby", `format-${format}`)
  }
  for (const [extension, label] of [
    ["webp", "WebP"],
    ["webm", "WebM"],
    ["mp4", "MP4"],
  ]) {
    const tab = document.createElement("button")
    tab.type = "button"
    tab.id = `format-${extension}`
    tab.textContent = label
    tab.setAttribute("role", "tab")
    tab.setAttribute("aria-controls", panel.id)
    tab.addEventListener("click", () => {
      if (selected === extension) return
      video.pause()
      video.removeAttribute("src")
      video.replaceChildren()
      video.load()
      if (extension === "webp") {
        panel.replaceChildren(animation)
        animation.src = `${media}.webp`
        loading(panel, animation)
      } else {
        animation.removeAttribute("src")
        video.src = `${media}.${extension}`
        panel.replaceChildren(video)
        panel.setAttribute("aria-busy", "false")
      }
      select(extension)
    })
    tab.addEventListener("keydown", (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return
      const names = [...tabs.keys()]
      if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return
      event.preventDefault()
      const index =
        event.key === "Home"
          ? 0
          : event.key === "End"
            ? names.length - 1
            : (names.indexOf(selected) + (event.key === "ArrowRight" ? 1 : -1) + names.length) % names.length
      tabs.get(names[index])!.click()
      tabs.get(names[index])!.focus()
    })
    tabs.set(extension, tab)
    formats.append(tab)
  }
  video.addEventListener("loadedmetadata", () => {
    if (video.isConnected && video.currentSrc) select(video.currentSrc.endsWith(".mp4") ? "mp4" : "webm")
  })
  select(selected)
  panel.append(video)
  const poster = new Image()
  poster.src = video.poster
  loading(panel, poster)
  const toolbar = document.createElement("div")
  toolbar.className = "screencast-toolbar"
  const introduction = document.createElement("div")
  introduction.className = "screencast-intro"
  const description = document.createElement("p")
  description.className = "screencast-description"
  description.textContent = screencast.description
  introduction.append(heading, description)
  toolbar.append(introduction, formats)
  main.append(toolbar, panel)
} else {
  heading.remove()
  main.classList.add("screencast-menu")
  for (const item of catalog) {
    const link = document.createElement("a")
    link.href = new URL(`help/${item.id}/`, root).href
    const media = new URL(`help/${item.id}/`, root)
    const preview = document.createElement("div")
    preview.style.backgroundImage = `url(${new URL(`${item.id}.png`, media).href})`
    const picture = document.createElement("picture")
    const source = document.createElement("source")
    source.type = "image/webp"
    source.media = "(prefers-reduced-motion: no-preference)"
    source.srcset = new URL("preview.webp", media).href
    const image = document.createElement("img")
    image.src = new URL(`${item.id}.png`, media).href
    image.width = 960
    image.height = 540
    image.loading = "lazy"
    image.decoding = "async"
    image.fetchPriority = "low"
    image.alt = ""
    picture.append(source, image)
    preview.append(picture)
    const title = document.createElement("h2")
    title.textContent = item.title
    const description = document.createElement("p")
    description.className = "screencast-description"
    description.textContent = item.description
    const hint = document.createElement("p")
    hint.className = "screencast-hint"
    mount(Icon, { target: hint, props: { name: "info" } })
    hint.append("Open a preview for higher resolution and more formats.")
    const introduction = document.createElement("div")
    introduction.className = "screencast-intro"
    introduction.append(title, description, hint)
    link.append(introduction, preview)
    menu.append(link)
    loading(preview, image)
  }
}
