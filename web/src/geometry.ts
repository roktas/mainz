// Measures rendered workspace geometry without changing Grid state or PDF content.

export function geometry() {
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes the complete probe.
  const rect = (element: Element) =>
    element.getBoundingClientRect().toJSON() as {
      x: number
      y: number
      width: number
      height: number
      top: number
      right: number
      bottom: number
      left: number
    }
  const query = (root: ParentNode, selector: string) => {
    const element = root.querySelector(selector)
    return element ? rect(element) : null
  }
  function grid(element: HTMLElement) {
    const area = element.querySelector<HTMLElement>(".composition-grid")!
    const cards = [...area.querySelectorAll(".composition-card")].map(rect)
    const card = cards[0]
    const image = query(element, ".thumbnail canvas")
    const thumbnail = query(element, ".thumbnail")
    if (!card || !image || !thumbnail || !image.width || !image.height) return null
    const bounds = rect(area)
    const columns = new Set(cards.map((item) => item.left)).size
    const pane = element.closest<HTMLElement>(".selection-panel, .composition-output")!
    const style = getComputedStyle(pane)
    const computed = getComputedStyle(area)
    const thumbnailStyle = getComputedStyle(element.querySelector(".thumbnail")!)
    const slider = query(element, ".batch-slider")
    const caption = query(element, ".batch-caption")
    const cardsBottom = Math.max(...cards.map((item) => item.bottom))
    const status = query(document, ".footnote")
    return {
      available: [innerWidth, innerHeight],
      matrix: [columns, new Set(cards.map((item) => item.top)).size, cards.length],
      capacity: [Number(element.dataset.columns), Number(element.dataset.rows), Number(element.dataset.batch)],
      frame: rect(element),
      grid: bounds,
      card,
      cards,
      image,
      thumbnail,
      edges: [card.left - bounds.left, bounds.right - cards[columns - 1].right],
      margins: [
        image.top - thumbnail.top,
        thumbnail.bottom - image.bottom,
        image.left - thumbnail.left,
        thumbnail.right - image.right,
      ],
      gaps: [
        columns > 1 ? cards[1].left - card.right : null,
        cards.length > columns ? cards[columns].top - card.bottom : null,
      ],
      slider,
      caption,
      pager: query(element, ".page-batches"),
      cardsBottom,
      status: status?.top ?? null,
      clearance: slider ? slider.top - cardsBottom : null,
      scroll: document.documentElement.scrollHeight - innerHeight,
      scrollPosition: [scrollX, scrollY],
      horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
      ready: [...element.querySelectorAll(".thumbnail")].every((item) => item.getAttribute("aria-busy") === "false"),
      computed: {
        columns: computed.gridTemplateColumns,
        rows: computed.gridAutoRows,
        rowGap: computed.rowGap,
        columnGap: computed.columnGap,
      },
      authored: {
        width: card.width,
        height: parseFloat(computed.gridAutoRows),
        gap: parseFloat(computed.columnGap),
        padding: parseFloat(thumbnailStyle.paddingTop),
        rowFactor: Number(style.getPropertyValue("--grid-row-factor").trim() || 1),
      },
      variables: Object.fromEntries(
        [
          "--grid-width",
          "--grid-height",
          "--grid-gap",
          "--grid-row-gap",
          "--grid-column-gap",
          "--grid-row-factor",
          "--thumbnail-padding",
          "--grid-pager-height",
        ].map((name) => [name, style.getPropertyValue(name).trim()]),
      ),
    }
  }
  type Grid = NonNullable<ReturnType<typeof grid>>
  const input: Record<string, Grid> = {},
    output: Record<string, Grid> = {}
  for (const pane of document.querySelectorAll<HTMLElement>(".selection-panel, .composition-output")) {
    const frame = pane.querySelector<HTMLElement>(".grid-view")
    if (!frame || !frame.getBoundingClientRect().width || !frame.getBoundingClientRect().height) continue
    const measured = grid(frame)
    if (measured) (pane.matches(".selection-panel") ? input : output)[pane.dataset.density || "normal"] = measured
  }
  const probe = document.createElement("div")
  Object.assign(probe.style, {
    position: "fixed",
    visibility: "hidden",
    pointerEvents: "none",
    inlineSize: "0",
    insetBlockStart: "0",
    insetInlineStart: "0",
    padding:
      "env(safe-area-inset-top) env(safe-area-inset-right) env(safe-area-inset-bottom) env(safe-area-inset-left)",
  })
  let svh: number | null = null,
    dvh: number | null = null,
    lvh: number | null = null
  let safeArea: Record<string, number>
  document.body.append(probe)
  try {
    const style = getComputedStyle(probe)
    safeArea = {
      top: parseFloat(style.paddingTop),
      right: parseFloat(style.paddingRight),
      bottom: parseFloat(style.paddingBottom),
      left: parseFloat(style.paddingLeft),
    }
    const height = (unit: string) => {
      if (!CSS.supports("height", `100${unit}`)) return null
      probe.style.blockSize = `100${unit}`
      return parseFloat(getComputedStyle(probe).blockSize)
    }
    svh = height("svh")
    dvh = height("dvh")
    lvh = height("lvh")
  } finally {
    probe.remove()
  }
  const media = Object.fromEntries(
    [
      "(pointer: coarse)",
      "(pointer: fine)",
      "(hover: hover)",
      "(hover: none)",
      "(any-pointer: coarse)",
      "(any-pointer: fine)",
      "(any-hover: hover)",
      "(orientation: portrait)",
      "(display-mode: standalone)",
      "(display-mode: fullscreen)",
      "(prefers-reduced-motion: reduce)",
    ].map((condition) => [condition, matchMedia(condition).matches]),
  )
  const calibrations: { condition: string; matches: boolean }[] = []
  function rules(items: CSSRuleList) {
    for (const rule of items) {
      if (
        rule instanceof CSSMediaRule &&
        rule.conditionText.includes("width") &&
        rule.conditionText.includes("height") &&
        rule.cssText.includes("--grid-")
      )
        calibrations.push({ condition: rule.conditionText, matches: matchMedia(rule.conditionText).matches })
      if ("cssRules" in rule) rules((rule as CSSGroupingRule).cssRules)
    }
  }
  for (const sheet of document.styleSheets) {
    try {
      if (sheet.cssRules) rules(sheet.cssRules)
    } catch {
      /* Cross-origin stylesheets cannot be inspected. */
    }
  }
  const standalone =
    media["(display-mode: standalone)"] || (navigator as Navigator & { standalone?: boolean }).standalone === true
  const ua = navigator.userAgent
  const chrome = ua.match(/(?:Chrome|CriOS)\/([\d.]+)/)
  const safari = !chrome && ua.match(/Version\/([\d.]+).*Safari/)
  return {
    schemaVersion: 1,
    environment: {
      source: "unknown",
      device: null as string | null,
      os: null as string | null,
      osVersion: null as string | null,
      browserFamily: chrome ? "chrome-like" : safari ? "safari" : "unknown",
      browser: chrome ? "Chrome-like" : safari ? "Safari" : "unknown",
      browserVersion: chrome?.[1] ?? (safari ? safari[1] : null),
      userAgent: ua,
      navigatorStandalone: (navigator as Navigator & { standalone?: boolean }).standalone ?? null,
      fullscreenAvailable: typeof document.fullscreenEnabled === "boolean" ? document.fullscreenEnabled : null,
      fullscreenElement: !!document.fullscreenElement,
      renderingEngine:
        /AppleWebKit/.test(ua) && !/Chrome\//.test(ua) ? "WebKit" : /Chrome\//.test(ua) ? "Blink" : "unknown",
      presentationMode: standalone
        ? "standalone-pwa"
        : document.fullscreenElement || media["(display-mode: fullscreen)"]
          ? "browser-fullscreen"
          : "browser-tabbed",
      orientation: media["(orientation: portrait)"] ? "portrait" : "landscape",
      toolbarState: "unknown",
      windowMode: "unknown",
      textScale: null as string | null,
      browserZoom: null as string | null,
      pointer: media["(pointer: coarse)"] ? "coarse" : media["(pointer: fine)"] ? "fine" : "none",
      hover: media["(hover: hover)"] ? "hover" : "none",
      media,
      requestedViewport: null as number[] | null,
    },
    viewport: {
      screenCss: [screen.width, screen.height],
      screenAvailable: [screen.availWidth, screen.availHeight],
      windowOuter: [outerWidth, outerHeight],
      inner: [innerWidth, innerHeight],
      documentClient: [document.documentElement.clientWidth, document.documentElement.clientHeight],
      visual: visualViewport ? [visualViewport.width, visualViewport.height] : null,
      visualScale: visualViewport?.scale ?? null,
      visualOffset: visualViewport ? [visualViewport.offsetLeft, visualViewport.offsetTop] : null,
      scroll: [scrollX, scrollY],
      dpr: devicePixelRatio,
      svh,
      dvh,
      lvh,
      safeArea,
      units: { bounds: "css-px", screenCss: "css-px", windowOuter: "browser-reported-px", screenshots: "bitmap-px" },
    },
    layout: {
      paneMode:
        getComputedStyle(document.querySelector(".composition-panels") ?? document.body).display === "flex"
          ? "one-pane"
          : "two-pane",
      workspace: Object.fromEntries(
        ["main", ".composer", ".selection-panel", ".composition-output", ".footnote"].map((selector) => [
          selector,
          query(document, selector),
        ]),
      ),
      input,
      output,
      calibrations,
    },
    provenance: {
      measuredAt: new Date().toISOString(),
      fixture: "grid",
      evidenceClass: "unknown",
      revision: null as string | null,
      nativeUiScreenshot: null as string | null,
      documentScreenshot: null as string | null,
      notes: null as string | null,
    },
  }
}

export type Geometry = ReturnType<typeof geometry>

function choose(name: string) {
  const tabs = document.querySelector(".mobile-workspace-tabs")
  if (tabs?.getBoundingClientRect().width)
    [...tabs.querySelectorAll("button")].find((button) => button.textContent?.trim() === name)?.click()
}

function density(name: string, compact: boolean) {
  const button = document.querySelector<HTMLButtonElement>(
    `button[aria-label="${compact ? "Compact" : "Normal"} ${name} grid"]`,
  )
  button?.click()
  return !!button
}

export async function view(name: "Input" | "Output", compact: boolean): Promise<Geometry> {
  choose(name)
  if (!density(name, compact)) throw new Error(`Open ${name} in Grid before capturing geometry.`)
  return stable()
}

export async function capture(): Promise<Geometry> {
  const sample = await stable()
  sample.layout.input = {}
  sample.layout.output = {}
  const composer = document.querySelector<HTMLElement>(".composer")!
  const previous = {
    pane: composer.dataset.view,
    input: document.querySelector<HTMLElement>(".selection-panel")?.dataset.density,
    output: document.querySelector<HTMLElement>(".composition-output")?.dataset.density,
    focus: document.activeElement,
    scroll: [scrollX, scrollY],
  }
  try {
    for (const name of ["Input", "Output"] as const) {
      for (const compact of [false, true]) {
        const current = await view(name, compact)
        if (!Object.keys(sample.layout.input).length) sample.viewport = current.viewport
        const pane = name === "Input" ? "input" : "output"
        const mode = compact ? "compact" : "normal"
        if (!current.layout[pane][mode]) throw new Error(`Open ${name} in Grid before capturing geometry.`)
        sample.layout[pane][mode] = current.layout[pane][mode]
      }
    }
    return sample
  } finally {
    for (const name of ["Input", "Output"] as const) {
      choose(name)
      density(name, previous[name === "Input" ? "input" : "output"] === "compact")
    }
    choose(previous.pane === "output" ? "Output" : "Input")
    await stable()
    if (previous.focus instanceof HTMLElement) previous.focus.focus({ preventScroll: true })
    scrollTo(previous.scroll[0], previous.scroll[1])
  }
}

export async function stable(timeout = 45000): Promise<Geometry> {
  if (
    [...document.querySelectorAll(".page-view")].some((element) => element.checkVisibility()) &&
    ![...document.querySelectorAll(".grid-view")].some((element) => element.checkVisibility())
  )
    throw new Error("Open Input and Output in Grid before capturing geometry.")
  const deadline = performance.now() + timeout
  let previous = "",
    matches = 0
  while (performance.now() < deadline) {
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Grid capture timed out waiting for an animation frame.")),
        Math.max(0, deadline - performance.now()),
      )
      requestAnimationFrame(() => {
        clearTimeout(timer)
        resolve()
      })
    })
    const sample = geometry()
    const grids = [...Object.values(sample.layout.input), ...Object.values(sample.layout.output)]
    const signature = JSON.stringify(sample.layout)
    matches = signature === previous ? matches + 1 : 0
    previous = signature
    if (grids.length && grids.every((grid) => grid.ready && grid.capacity[2] > 0) && matches >= 3) return sample
  }
  throw new Error("Grid geometry did not stabilize before the capture deadline.")
}

function cell(value: unknown) {
  const text = typeof value === "string" && /^[=+\-@\t\r]/.test(value) ? `'${value}` : String(value ?? "")
  return `"${text.replaceAll('"', '""')}"`
}

export function csv(sample: Geometry): string {
  const columns = [
    "source",
    "device",
    "os",
    "osVersion",
    "browser",
    "browserVersion",
    "browserFamily",
    "presentationMode",
    "orientation",
    "evidenceClass",
    "pane",
    "density",
    "viewportWidth",
    "viewportHeight",
    "columns",
    "rows",
    "batch",
    "frameWidth",
    "frameHeight",
    "cardWidth",
    "cardHeight",
    "imageWidth",
    "imageHeight",
    "gapHorizontal",
    "gapVertical",
    "pagerClearance",
    "marginTop",
    "marginBottom",
    "marginLeft",
    "marginRight",
    "outsideLeft",
    "outsideRight",
    "scrollHeight",
    "dpr",
    "visualScale",
  ]
  const rows: unknown[][] = [columns]
  for (const pane of ["input", "output"] as const)
    for (const [mode, grid] of Object.entries(sample.layout[pane]))
      rows.push([
        sample.environment.source,
        sample.environment.device,
        sample.environment.os,
        sample.environment.osVersion,
        sample.environment.browser,
        sample.environment.browserVersion,
        sample.environment.browserFamily,
        sample.environment.presentationMode,
        sample.environment.orientation,
        sample.provenance.evidenceClass,
        pane,
        mode,
        ...sample.viewport.inner,
        ...grid.capacity,
        grid.frame.width,
        grid.frame.height,
        grid.card.width,
        grid.card.height,
        grid.image.width,
        grid.image.height,
        ...grid.gaps,
        grid.clearance,
        ...grid.margins,
        ...grid.edges,
        grid.scroll,
        sample.viewport.dpr,
        sample.viewport.visualScale,
      ])
  return rows.map((row) => row.map(cell).join(",")).join("\r\n") + "\r\n"
}
