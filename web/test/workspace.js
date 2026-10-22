import { readFile } from "node:fs/promises"
import { gridPage } from "./browser.js"

export async function zoom(pane, action) {
  const control = pane.locator(".page-zoom").getByRole("button", { name: action, exact: true })
  if (action === "Fit page") return control.click()
  const menu = pane.locator(".sequence-options")
  const summary = pane.locator(':scope:has(.page-view[data-controls="fit"]) .sequence-options > summary')
  await control.or(summary).click()
  if (await menu.evaluate((element) => element.open)) {
    await menu.getByRole("button", { name: action, exact: true }).click()
    await menu.locator("summary").click()
  }
}

export async function aligned(pane) {
  const view = await pane.locator(".page-view").elementHandle()
  const result = await pane.page().waitForFunction((element) => {
    const image = element.querySelector("canvas, .blank-sheet")?.getBoundingClientRect()
    if (!image?.width || element.querySelector('.pdf-viewport[aria-busy="true"]')) return false
    const heading = element.querySelector(".inspection-heading")
    const navigation = element.querySelector(".page-navigation")
    const handle = heading.querySelector(".page-grip")
    const fit = [...heading.querySelector('button[aria-label="Fit page"]').children].find(
      (child) => getComputedStyle(child).display !== "none",
    )
    const current = heading.querySelector(".page-current").getBoundingClientRect()
    const previous = navigation.firstElementChild.querySelector("svg").getBoundingClientRect()
    const next = navigation.lastElementChild.querySelector("svg").getBoundingClientRect()
    const frame = heading.getBoundingClientRect()
    const level = parseFloat(heading.querySelector(".page-zoom output").textContent)
    const fitted = (image.width * 100) / level
    const span = Math.min(
      frame.width,
      Math.max(fitted, parseFloat(element.style.getPropertyValue("--controls-width")) || 0),
    )
    const grip = handle?.checkVisibility() ? handle.getBoundingClientRect() : undefined
    const actions = navigation.querySelector(".page-actions")?.getBoundingClientRect()
    const leading = grip ?? heading.querySelector(".page-number-control").getBoundingClientRect()
    const tools = [...heading.querySelectorAll(".page-tools button")]
      .filter((el) => el.checkVisibility() && getComputedStyle(el).visibility !== "hidden")
      .map((el) => el.getBoundingClientRect())
    const touch = getComputedStyle(element).getPropertyValue("--page-touch").trim() === "1"
    const edges = touch
      ? Math.abs(heading.querySelector(".page-number-control").getBoundingClientRect().left - frame.left - 16) < 1 &&
        Math.abs(navigation.firstElementChild.getBoundingClientRect().left - frame.left - 16) < 1 &&
        Math.abs(
          heading.querySelector('button[aria-label="Fit page"]').getBoundingClientRect().right - frame.right + 16,
        ) < 1 &&
        Math.abs(navigation.lastElementChild.getBoundingClientRect().right - frame.right + 16) < 1
      : Math.abs(current.left - frame.x - (frame.width - span) / 2) < 1 &&
        Math.abs(fit.getBoundingClientRect().right - frame.x - (frame.width + span) / 2) < 1 &&
        Math.abs(current.left - previous.left) < 1 &&
        Math.abs(fit.getBoundingClientRect().right - next.right) < 1
    return (
      edges &&
      (!grip ||
        (Math.abs(grip.x + grip.width / 2 - frame.x - frame.width / 2) < 1 &&
          Math.abs(grip.x + grip.width / 2 - actions.x - actions.width / 2) < 1)) &&
      tools[0].left >= leading.right - 1 &&
      tools.every((tool) => Math.abs(tool.y + tool.height / 2 - tools[0].y - tools[0].height / 2) < 1)
    )
  }, view)
  return result.jsonValue()
}

export async function checkWorkspace(page, prepared, ordinary) {
  const errors = []
  const recordError = (error) => errors.push(error.message)
  page.on("pageerror", recordError)
  let checks = 0
  const check = (value, message) => {
    if (!value) throw new Error(message)
    checks++
  }
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.emulateMedia({ reducedMotion: "reduce" })
  const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
  const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
  const help = page.getByRole("button", { name: "Help", exact: true })
  const startTour = async () => {
    await help.click()
    await page
      .getByRole("dialog", { name: "Help", exact: true })
      .getByRole("button", { name: "Start Tour", exact: true })
      .click()
  }
  const workspaceSteps = [
    "input-grid",
    "input-density",
    "input-page",
    "style",
    "output-grid",
    "output-selection",
    "output-page",
    "download",
  ]
  await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).waitFor()
  check(!(await welcome.isVisible()), "Onboarding waits for a successfully opened PDF")
  check(
    (await page.locator(".header-note").getAttribute("title")) === "Processed on your device. No uploads.",
    "The header note explains local processing on hover",
  )
  const step = async (key) => {
    await page.waitForFunction(
      (value) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === value,
      key,
    )
    const target = page.locator(`[data-tour-target="${key}"]`)
    await target.waitFor()
    check(await target.isVisible(), `Tour target ${key} is visible`)
    await page.waitForFunction((value) => {
      const guide = document.querySelector(".help-tour:popover-open")
      const control = document.querySelector(`[data-tour-target="${value}"]`)
      if (!guide || !control) return false
      const backdrop = getComputedStyle(guide, "::backdrop")
      const width = parseFloat(backdrop.width)
      const height = parseFloat(backdrop.height)
      const left = parseFloat(backdrop.left) - width / 2
      const top = parseFloat(backdrop.top) - height / 2
      const tab = document.querySelector(`[data-tour-tab="${value}"]`)
      const parts = [control, ...(tab ? [tab] : [])].map((part) => part.getBoundingClientRect())
      return (
        parts.every(
          (part) =>
            left <= Math.max(0, part.left - 16) + 1 &&
            top <= Math.max(0, part.top - 16) + 1 &&
            left + width >= Math.min(innerWidth, part.right + 16) - 1 &&
            top + height >= Math.min(innerHeight, part.bottom + 16) - 1,
        ) &&
        width <= Math.max(...parts.map((part) => part.right)) - Math.min(...parts.map((part) => part.left)) + 64 &&
        height <= Math.max(...parts.map((part) => part.bottom)) - Math.min(...parts.map((part) => part.top)) + 64
      )
    }, key)
    check(
      await tour.getByRole("heading", { level: 2 }).evaluate((heading) => {
        const title = heading.getBoundingClientRect()
        const card = heading.closest(".help-tour").getBoundingClientRect()
        return title.top >= card.top && title.bottom <= card.bottom
      }),
      `Tour ${key} starts with its title visible`,
    )
    check(
      await tour.evaluate((guide) => {
        const backdrop = getComputedStyle(guide, "::backdrop")
        return backdrop.filter.startsWith("blur(") && backdrop.boxShadow !== "none" && backdrop.pointerEvents === "none"
      }),
      `Tour ${key} has a soft spotlight without blocking controls`,
    )
    const tab = page.locator(`[data-tour-tab="${key}"]`)
    if (await tab.count()) {
      check(
        (await tab.getAttribute("aria-selected")) === "true" && (await tab.getAttribute("data-tour-active")) === "true",
        `Tour ${key} illuminates the selected tab together with its content`,
      )
    }
    if (await page.evaluate(() => matchMedia("(prefers-reduced-motion: reduce)").matches))
      check(
        await tour.evaluate((guide) => guide.getAnimations({ subtree: true }).length === 0),
        `Tour ${key} honors reduced motion`,
      )
    if (key.endsWith("-density")) {
      check(await target.getByRole("button", { name: /^Normal / }).isVisible(), "Tour reveals Normal density")
      check(await target.getByRole("button", { name: /^Compact / }).isVisible(), "Tour reveals Compact density")
    }
    if (key === "output-selection") {
      const unselected =
        (await target.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === ""
      for (const name of ["Remove selected Output pages", "Duplicate selected Output pages"])
        check(
          (await target.getByRole("button", { name, exact: true }).isDisabled()) === unselected,
          `Tour shows ${name}, disabled without a selection`,
        )
    }
  }
  const open = async (name, buffer) => {
    const count = await page.locator(".input-list button[data-source]").count()
    await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
    await page.waitForFunction(
      ({ label, previous }) =>
        (document.querySelector(".composer:not([inert]) .input-current")?.textContent === label &&
          document.querySelectorAll(".input-list button[data-source]").length === previous + 1) ||
        document.querySelector(".error-banner"),
      { label: name, previous: count },
      { timeout: 60000 },
    )
    check(
      (await page.locator(".input-current").count()) > 0 &&
        (await page.locator(".input-current").textContent()) === name &&
        (await page.locator(".input-list button[data-source]").count()) === count + 1,
      `Open ${name}: ${(await page.locator("[role=alert]").allTextContents()).join("; ")}`,
    )
  }
  check(
    await page.locator(".footnote").evaluate((footer) => getComputedStyle(footer).borderTopWidth === "0px"),
    "Landing status has no divider",
  )
  const fileDrag = await page.evaluateHandle((bytes) => {
    const data = new DataTransfer()
    data.items.add(new File([Uint8Array.from(bytes)], "Practice book.pdf", { type: "application/pdf" }))
    return data
  }, Array.from(prepared))
  const landing = page.locator(".drop-zone")
  const landingHeight = (await landing.boundingBox()).height
  await landing.dispatchEvent("dragenter", { dataTransfer: fileDrag })
  check(
    await landing.getByText("Drop PDFs to open", { exact: true }).isVisible(),
    "PDF drag shows an explicit file target",
  )
  await landing.locator(".welcome").dispatchEvent("dragenter", { dataTransfer: fileDrag })
  await landing.locator(".welcome").dispatchEvent("dragleave", { dataTransfer: fileDrag })
  check(
    (await landing.getByText("Drop PDFs to open", { exact: true }).isVisible()) &&
      (await landing.boundingBox()).height === landingHeight,
    "Nested file drag events preserve the target and layout",
  )
  await landing.dispatchEvent("drop", { dataTransfer: fileDrag })
  await fileDrag.dispose()
  await page.waitForFunction(
    () => document.querySelector(".input-current")?.textContent === "Practice book.pdf",
    null,
    { timeout: 60000 },
  )
  check(!(await page.locator(".drop-prompt").count()), "Opening the dropped PDF clears file drag feedback")
  await welcome.waitFor()
  check(
    await welcome
      .getByRole("button", { name: "Skip", exact: true })
      .evaluate((button) => button === document.activeElement),
    "The first opened PDF shows onboarding with a focused primary action",
  )
  await welcome.getByRole("button", { name: "Take a tour", exact: true }).click()
  await step("input")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await tour.getByRole("button", { name: "Next", exact: true }).click()
  await step("input-grid")
  await page.waitForFunction(() =>
    document
      .querySelector(".help-tour")
      .getAnimations({ subtree: true })
      .some((animation) => animation.effect.pseudoElement === "::backdrop"),
  )
  check(
    await tour.evaluate(async (guide) => {
      const pulse = guide
        .getAnimations({ subtree: true })
        .find((animation) => animation.effect.pseudoElement === "::backdrop")
      const valid = pulse.effect.getTiming().duration === 360
      await pulse.finished
      return valid
    }),
    "A new tour target briefly fades the spotlight backdrop",
  )
  await page.emulateMedia({ reducedMotion: "reduce" })
  await tour.getByRole("button", { name: "Back", exact: true }).click()
  await step("input")
  for (const key of [
    "input-grid",
    "input-density",
    "input-page",
    "output-grid",
    "output-selection",
    "output-page",
    "download",
  ]) {
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step(key)
  }
  check(
    (await tour.locator(".tour-progress").textContent()).includes("/ 8"),
    "Empty Output shows density and selection actions without adding sample pages",
  )
  await page.keyboard.press("Escape")
  await tour.waitFor({ state: "hidden" })
  check(
    await help.evaluate((button) => button === document.activeElement),
    "Escape dismisses the tour and returns focus to Help",
  )
  await page.reload()
  await open("Practice book.pdf", prepared)
  check(!(await welcome.isVisible()), "Onboarding dismissal persists after reopening a PDF")
  await page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true }).fill("3-5,2,2,7")
  await page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true }).press("Enter")
  await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages")
  const input = page.locator(".selection-panel"),
    output = page.locator(".composition-output")
  check(
    (await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === "",
    "Bulk addition clears the Input preparation",
  )
  check(
    (await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === "1-6",
    "Bulk addition selects the new Output block",
  )
  await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("3-5,2,2,7")
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  const inputPages = () => input.getByRole("tab", { name: "Grid", exact: true })
  const inputStyle = () => input.getByRole("tab", { name: "Style", exact: true })
  const outputPages = () => output.getByRole("tab", { name: "Grid", exact: true })
  const outputPage = () => output.getByRole("tab", { name: "Page", exact: true })
  await inputStyle().click()
  await outputPage().click()
  await startTour()
  await step("input")
  check(
    await page.locator('[data-tour-target="input"] input').evaluate((field) => field.multiple),
    "The Input step includes the file chooser that accepts several PDFs",
  )
  for (const key of workspaceSteps) {
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step(key)
    if (key === "input-grid")
      check((await inputPages().getAttribute("aria-selected")) === "true", "Tour opens Input Grid")
    if (key === "input-page")
      check(
        (await input.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected")) === "true",
        "Tour opens Input Page",
      )
    if (key === "style")
      check(
        (await inputStyle().getAttribute("aria-selected")) === "true" &&
          (await inputStyle().getAttribute("data-tour-active")) === "true",
        "Tour selects and highlights Style",
      )
    if (key === "output-grid")
      check((await outputPages().getAttribute("aria-selected")) === "true", "Tour opens Output Grid")
    if (key === "output-page")
      check((await outputPage().getAttribute("aria-selected")) === "true", "Tour opens Output Page")
  }
  check(
    (await tour.locator(".tour-progress").textContent()).includes("/ 9"),
    "Style adds one step to the eight-step tour",
  )
  await tour.getByRole("button", { name: "Finish", exact: true }).click()
  check(
    (await inputStyle().getAttribute("aria-selected")) === "true" &&
      (await outputPage().getAttribute("aria-selected")) === "true",
    "Tour restores the previous workspace tabs",
  )
  check((await output.locator(".composition-totals strong").textContent()) === "6 PDF pages", "Tour preserves Output")
  await startTour()
  await step("input")
  await tour.getByRole("button", { name: "Next", exact: true }).click()
  await step("input-grid")
  await page.evaluate(() => window.scrollBy(0, 32))
  await step("input-grid")
  await page.setViewportSize({ width: 390, height: 900 })
  await step("input-grid")
  await page.setViewportSize({ width: 1440, height: 1100 })
  await step("input-grid")
  await tour.getByRole("button", { name: "End tour", exact: true }).click()
  await tour.waitFor({ state: "hidden" })
  check(
    (await inputStyle().getAttribute("aria-selected")) === "true" &&
      (await outputPage().getAttribute("aria-selected")) === "true" &&
      (await output.locator(".composition-totals strong").textContent()) === "6 PDF pages" &&
      (await help.evaluate((button) => button === document.activeElement)),
    "End tour restores the previous tabs and focus without changing Output",
  )
  await startTour()
  await step("input")
  await tour.getByRole("button", { name: "Next", exact: true }).click()
  await step("input-grid")
  await page.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }).click()
  await tour.waitFor({ state: "hidden" })
  const selectedSequence = page
    .locator(".selection-panel")
    .getByRole("textbox", { name: "Page selection", exact: true })
  check(
    (await selectedSequence.inputValue()) === "3-5, 2, 2, 7, 1",
    "Clicking a toured grip selects its page without restoring Style over the click",
  )
  check(
    (await inputPages().getAttribute("aria-selected")) === "true",
    "Workspace interaction retains the pane and tab being used",
  )
  await selectedSequence.fill("3-5,2,2,7")
  await inputStyle().click()
  await startTour()
  await step("input")
  await tour.getByRole("button", { name: "Next", exact: true }).click()
  await step("input-grid")
  await selectedSequence.focus()
  await tour.waitFor({ state: "hidden" })
  check(
    await selectedSequence.evaluate((field) => field === document.activeElement),
    "Keyboard focus can leave the tour for a workspace control without losing its tab",
  )
  await inputPages().click()
  await outputPages().click()
  check(
    (await page
      .locator(".selection-panel")
      .getByRole("textbox", { name: "Page selection", exact: true })
      .inputValue()) === "3-5,2,2,7",
    "Tour preserves the exact page sequence",
  )
  for (const [width, size] of [
    [390, "100%"],
    [320, "200%"],
  ]) {
    await page.setViewportSize({ width, height: 900 })
    await page.evaluate((value) => (document.documentElement.style.fontSize = value), size)
    await startTour()
    await step("input")
    for (const key of workspaceSteps) {
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await step(key)
      check(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `Workspace tour ${key} fits ${width}px with ${size} text`,
      )
      const exit = await tour.getByRole("button", { name: "End tour", exact: true }).boundingBox()
      const card = await tour.boundingBox()
      check(
        exit.y >= card.y && exit.y + exit.height <= card.y + card.height,
        `End tour stays visible at ${key} with ${size} text`,
      )
    }
    await tour.getByRole("button", { name: "Finish", exact: true }).click()
    check(
      (await page.locator(".composer").getAttribute("data-view")) === "input",
      "Tour restores the mobile Input view",
    )
  }
  await page.evaluate(() => (document.documentElement.style.fontSize = ""))
  await page.setViewportSize({ width: 1440, height: 1100 })
  const entry = input.getByRole("textbox", {
    name: "Page selection",
    exact: true,
  })
  const total = async () => output.locator(".composition-totals strong").textContent()
  const ready = () =>
    page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
  const order = () => output.locator(".page-origin-info .page-context").allTextContents()
  const choose = async (number) => {
    await page.locator(".input-picker > summary").click()
    await page
      .locator(".input-list")
      .getByRole("button", { name: new RegExp(`^${number} `) })
      .click()
  }
  const outputImages = async (count) => {
    const previous = output.getByRole("button", {
      name: "Previous Output thumbnails",
      exact: true,
    })
    const next = output.getByRole("button", { name: "Next Output thumbnails", exact: true })
    while ((await previous.count()) && (await previous.isEnabled())) await previous.click()
    const images = []
    do {
      await ready()
      images.push(
        ...(await output.locator(".composition-card").evaluateAll((cards) =>
          cards.map((card) => {
            const canvas = card.querySelector("canvas")
            const frame = canvas?.parentElement
            const style = frame && getComputedStyle(frame)
            return canvas
              ? {
                  width: frame.clientWidth - parseFloat(style.paddingInlineStart) - parseFloat(style.paddingInlineEnd),
                  height: frame.clientHeight - parseFloat(style.paddingBlockStart) - parseFloat(style.paddingBlockEnd),
                  rasterWidth: canvas.width,
                  rasterHeight: canvas.height,
                  image: canvas.toDataURL(),
                }
              : null
          }),
        )),
      )
      if (!(await next.count()) || (await next.isDisabled())) break
      await next.click()
    } while (images.length < count)
    while ((await previous.count()) && (await previous.isEnabled())) await previous.click()
    return images
  }
  const download = async (count, trigger = output.getByRole("button", { name: "Download", exact: true }), images) => {
    images ??= await outputImages(count)
    const saved = page.waitForEvent("download", { timeout: 60000 })
    await trigger.click()
    const artifact = await saved
    check((await artifact.failure()) === null, "The browser receives the completed PDF")
    check(
      /^.+_\d{4}-\d{4}-\d{4}-[0-5]\d\d{2}\.pdf$/.test(artifact.suggestedFilename()),
      "Download filename includes its base name and local timestamp to hundredths",
    )
    const bytes = await readFile(await artifact.path())
    const inspected = await page.evaluate(
      async ({ bytes: pdfBytes, images: expectedImages }) => {
        const { openPDF, loadRenderer } = await import("/src/pdf.ts")
        const { AnnotationMode } = await loadRenderer()
        const task = await openPDF(Uint8Array.from(pdfBytes))
        try {
          const pdf = await task.promise
          const matches = []
          for (let index = 0; index < pdf.numPages; index++) {
            const sheet = await pdf.getPage(index + 1)
            const expected = expectedImages[index]
            if (!expected) {
              matches.push((await sheet.getOperatorList()).fnArray.length === 0)
              continue
            }
            const size = sheet.getViewport({ scale: 1 })
            const viewport = sheet.getViewport({
              scale:
                Math.min(expected.width / size.width, expected.height / size.height) * Math.min(devicePixelRatio, 2),
            })
            const canvas = document.createElement("canvas")
            canvas.width = expected.rasterWidth
            canvas.height = expected.rasterHeight
            await sheet.render({ canvas, viewport, annotationMode: AnnotationMode.DISABLE }).promise
            matches.push(canvas.toDataURL() === expected.image)
            canvas.width = 0
            canvas.height = 0
          }
          return { pages: pdf.numPages, matches }
        } finally {
          await task.destroy()
        }
      },
      { bytes: Array.from(bytes), images },
    )
    check(
      inspected.pages === count && inspected.matches.every(Boolean),
      `Downloaded pages match Output order, independent styles, dimensions, and Blanks: ${JSON.stringify(inspected)}`,
    )
    check(
      (await total()).startsWith(`${count} PDF `) && !(await page.locator(".download-dialog").isVisible()),
      "Successful Download preserves the workspace and closes its modal",
    )
  }
  const headers = await Promise.all([
    input.locator(".input-heading").boundingBox(),
    output.locator(".section-heading").first().boundingBox(),
  ])
  check(Math.abs(headers[0].y - headers[1].y) < 1, "Input and Output headings align")
  check(await output.locator(".section-heading .primary").isVisible(), "Download is in the Output header")
  await inputStyle().click()
  const control = input.locator("article.control").first()
  const [tools, panel] = await Promise.all([
    input.locator(".source-tools").boundingBox(),
    input.locator(".source-layout").boundingBox(),
  ])
  check(Math.abs(tools.width - panel.width) < 1, "Style controls use the complete Input width")
  const [label, widget] = await Promise.all([
    control.locator(".control-label").boundingBox(),
    control.locator(".entry").first().boundingBox(),
  ])
  check(label.y + label.height <= widget.y, "Narrow panels stack the parameter and widget")
  await page.setViewportSize({ width: 2560, height: 1440 })
  const [wideLabel, wideWidget] = await Promise.all([
    control.locator(".control-label").boundingBox(),
    control.locator(".entry").first().boundingBox(),
  ])
  check(
    Math.abs(wideLabel.y + wideLabel.height / 2 - wideWidget.y - wideWidget.height / 2) < 2,
    "Wide panels keep the parameter and widget in one row",
  )
  await page.setViewportSize({ width: 1440, height: 1100 })
  const details = control.locator(".details.compact")
  await details.locator("summary").hover()
  check(
    (await details.locator("div").isVisible()) && (await details.innerText()).includes("eligible Output pages"),
    "Style information exposes declared scope and Output coverage on hover",
  )
  await details.locator("summary").click()
  await page.mouse.move(0, 0)
  check(await details.locator("div").isVisible(), "Click pins style information")
  await page.keyboard.press("Escape")
  check(!(await details.locator("div").isVisible()), "Escape closes style information")
  await inputPages().click()
  check(!(await input.locator(".style-status").count()), "Style controls belong only to the active Style tab")
  await ready()
  check((await entry.inputValue()) === "3-5,2,2,7", "Ordered duplicate page entry survives Style")
  check(
    !(await input
      .locator(".composition-card")
      .first()
      .evaluate((card) => card.classList.contains("selected"))),
    "An unselected Input page keeps the neutral card state",
  )
  const inputDetails = input.getByLabel("Details for Input page 1", { exact: true })
  check(
    (await input.locator(".composition-card").first().locator(".page-number strong").innerText()) === "1" &&
      (await inputDetails.count()) === 0,
    "Input pages without Output copies show a plain number",
  )
  await input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }).click()
  const pendingCard = input.locator(".composition-card").first()
  check(
    await pendingCard.evaluate((card) => card.classList.contains("selected")),
    "Selecting an Input page uses the accent card state",
  )
  await input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }).click()
  await entry.fill("3-5,2,2,7")
  const mappedCard = input.locator(".composition-card").nth(1)
  await mappedCard.getByLabel("Details for Input page 2", { exact: true }).focus()
  await page.keyboard.press("Enter")
  check(
    (await mappedCard.evaluate((card) => card.classList.contains("selected"))) &&
      (await mappedCard.locator(".page-origin-info").innerText()) === "Copies in Output: 2\nOutput pages: 4-5",
    "Input page details show the copy count and physical Output positions",
  )
  await page.keyboard.press("Escape")
  check(!(await mappedCard.locator(".page-origin-info").isVisible()), "Escape dismisses Input page details")
  await mappedCard.getByLabel("Details for Input page 2", { exact: true }).click()
  const otherCard = input.locator(".composition-card").nth(2)
  await otherCard.getByLabel("Details for Input page 3", { exact: true }).click()
  check(!(await mappedCard.locator(".page-origin-info").isVisible()), "Only one page detail is open at a time")
  await entry.click()
  check(!(await otherCard.locator(".page-origin-info").isVisible()), "Outside click dismisses Input page details")
  const theme = page.getByRole("button", { name: "Dark theme", exact: true })
  const fileFocus = async () => {
    const field = input.locator(".file-picker input")
    await field.focus()
    await page.keyboard.press("Tab")
    await page.keyboard.press("Shift+Tab")
    await page.waitForFunction(() => {
      const element = document.querySelector(".selection-panel .file-picker input")
      const tab = document.querySelector('.selection-panel .tabs [aria-selected="true"]')
      return (
        element.matches(":focus-visible") &&
        getComputedStyle(element.parentElement).borderTopColor === getComputedStyle(tab).borderBottomColor
      )
    })
    check(
      await field.evaluate((element) => {
        const picker = getComputedStyle(element.parentElement)
        const tab = element.closest(".selection-panel").querySelector('.tabs [aria-selected="true"]')
        return (
          element.matches(":focus-visible") &&
          getComputedStyle(element).outlineColor === "rgba(0, 0, 0, 0)" &&
          picker.outlineStyle === "none" &&
          picker.borderTopWidth === "1px" &&
          picker.borderTopColor === getComputedStyle(tab).borderBottomColor
        )
      }),
      "Open PDF keeps one accent border for keyboard focus in both themes",
    )
  }
  await theme.click()
  check(
    await theme.locator(".light-icon").evaluate((icon) => getComputedStyle(icon).display !== "none"),
    "Dark theme shows the light-theme action",
  )
  await fileFocus()
  await theme.click()
  check(
    await theme.locator(".dark-icon").evaluate((icon) => getComputedStyle(icon).display !== "none"),
    "Light theme shows the dark-theme action",
  )
  await fileFocus()
  for (const width of [1060, 1260, 1440]) {
    await page.setViewportSize({ width, height: 1100 })
    const grids = await Promise.all([
      input.locator(".source-catalog").boundingBox(),
      output.locator(".output-pages").boundingBox(),
    ])
    check(Math.abs(grids[0].y - grids[1].y) < 1, "Thumbnail grids share a top edge across desktop widths")
  }
  await input.getByRole("button", { name: "Select all", exact: true }).click()
  check(
    (await entry.inputValue()) === "1-7" && (await total()) === "6 PDF pages",
    "Input Select all changes only the page field",
  )
  await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
  check((await entry.inputValue()) === "" && (await total()) === "6 PDF pages", "Input Clear keeps Output intact")
  await entry.fill("3-5,2,2,7")
  await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click()
  check(
    (await entry.inputValue()).replaceAll(" ", "") === "3-5,7",
    "Unselecting an Input page removes its repeated references",
  )
  await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click()
  check(
    (await entry.inputValue()).replaceAll(" ", "") === "3-5,7,2",
    "Selecting an Input page appends one reference without changing order",
  )
  await entry.fill("1,1,3")
  await input.getByRole("button", { name: "Select or drag Input page 3 to Output", exact: true }).click()
  await input
    .getByRole("button", { name: "Select or drag Input page 5 to Output", exact: true })
    .click({ modifiers: ["Shift"] })
  check((await entry.inputValue()).replaceAll(" ", "") === "1,1,3-5", "Input range selection keeps existing duplicates")
  await input
    .getByRole("button", { name: "Select or drag Input page 4 to Output", exact: true })
    .click({ modifiers: ["Shift"] })
  check(
    (await entry.inputValue()).replaceAll(" ", "") === "1,1,3" && (await total()) === "6 PDF pages",
    "Input range removal preserves duplicates outside the range and leaves Output unchanged",
  )
  await entry.fill("1,1")
  await entry.press("Enter")
  check((await total()) === "8 PDF pages", "Enter adds the exact repeated page entry")
  await inputDetails.click()
  check(
    (await pendingCard.locator(".page-origin-info").innerText()) === "Copies in Output: 2\nOutput pages: 7-8",
    "Input mapping follows newly added Output copies",
  )
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 8", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 7", exact: true }).click()
  check(
    (await pendingCard.locator(".page-number strong").innerText()) === "1" && (await inputDetails.count()) === 0,
    "Removing every Output copy restores the plain Input page number",
  )
  await entry.fill("3-5,2,2,7")
  check(
    await page.getByRole("link", { name: "PDF Composer home", exact: true }).isVisible(),
    "Header PDF symbol provides the home link",
  )
  const settingsButton = page.getByRole("button", { name: "Settings", exact: true })
  const settings = page.getByRole("dialog", { name: "Settings", exact: true })
  await settingsButton.click()
  const about = settings.getByRole("region", { name: "PDF Composer", exact: true })
  check(
    await about.getByText((await readFile("../VERSION", "utf8")).trim(), { exact: true }).isVisible(),
    "Settings shows the software version",
  )
  check(
    (await about.locator("time").textContent()) === (await page.locator(".footnote > time").textContent()),
    "Settings shows the current Build ID",
  )
  const repository = about.getByRole("link", {
    name: "Mainz on GitHub (opens in a new tab)",
    exact: true,
  })
  check(
    (await repository.getAttribute("href")) === "https://github.com/roktas/mainz" &&
      (await repository.getAttribute("target")) === "_blank" &&
      (await repository.locator("svg").isVisible()),
    "Settings links to the Mainz repository through an accessible icon",
  )
  const repositoryBounds = await repository.boundingBox()
  check(repositoryBounds.width >= 44 && repositoryBounds.height >= 44, "The repository icon has a full touch target")
  check(
    (await settings.getByLabel("Lens magnification", { exact: true }).textContent()) === "16×",
    "Settings starts at 16× lens magnification",
  )
  await settings.getByRole("button", { name: "Increase lens magnification", exact: true }).click()
  await page.keyboard.press("Tab")
  check(
    await repository.evaluate(
      (link) => link === document.activeElement && getComputedStyle(link).outlineStyle !== "none",
    ),
    "The repository link has visible keyboard focus",
  )
  await page.keyboard.press("Escape")
  check(
    !(await settings.isVisible()) && (await settingsButton.evaluate((button) => button === document.activeElement)),
    "Escape closes Settings and restores focus",
  )
  await page.mouse.move(0, 0)
  await page.waitForTimeout(300)
  const thumbnail = input.locator(".thumbnail canvas").first()
  await thumbnail.hover()
  await page.locator(".lens").waitFor()
  check(
    (await page.locator(".lens").getAttribute("aria-label")).includes("32×"),
    "Input hover uses the Settings magnification",
  )
  await page.mouse.move(0, 0)
  await page.waitForTimeout(160)
  check((await page.locator(".lens").count()) === 0, "The lens closes when the pointer leaves the page")
  await output.locator(".thumbnail canvas").first().hover()
  await page.locator(".lens").waitFor()
  check(
    (await page.locator(".lens").getAttribute("aria-label")).includes("32×"),
    "Output hover shares the Settings magnification",
  )
  await page.mouse.move(0, 0)
  await page.waitForTimeout(160)
  await settingsButton.click()
  for (let index = 0; index < 2; index++)
    await settings.getByRole("button", { name: "Decrease lens magnification", exact: true }).click()
  await settings.getByRole("button", { name: "Close Settings", exact: true }).click()
  check(
    !(await settings.isVisible()) && (await settingsButton.evaluate((button) => button === document.activeElement)),
    "The Settings close button restores focus",
  )
  const bounds = await thumbnail.boundingBox()
  await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + 10)
  await page.waitForTimeout(30)
  await page.mouse.move(0, 0)
  await page.waitForTimeout(160)
  check((await page.locator(".lens").count()) === 0, "Passing over a page does not open a delayed lens")
  const sizes = await Promise.all([
    input.locator(".composition-card").first().boundingBox(),
    output.locator(".composition-card").first().boundingBox(),
  ])
  check(
    Math.abs(sizes[0].width - sizes[1].width) < 1 && Math.abs(sizes[0].height - sizes[1].height) < 1,
    "Input and Output cards have the same width and height",
  )
  const images = await Promise.all([
    input.locator(".thumbnail canvas").nth(2).boundingBox(),
    output.locator(".thumbnail canvas").first().boundingBox(),
  ])
  check(
    Math.abs(images[0].width - images[1].width) < 1 && Math.abs(images[0].height - images[1].height) < 1,
    "Matching pages render at the same thumbnail dimensions",
  )
  check(
    (await input.locator(".page-label strong").first().innerText()) === "1",
    "Input thumbnail uses the physical number",
  )
  check(
    (await order()).join(",") === "p. 3,p. 4,p. 5,p. 2,p. 2,p. 7",
    "Output preserves repeated physical page references",
  )
  await output.getByLabel("Output page actions", { exact: true }).click()
  await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
  const landscape = await output.locator(".composition-blank").boundingBox()
  check(
    Math.abs(landscape.width / landscape.height - 297 / 210) < 0.01 && landscape.height <= 168,
    "A Blank thumbnail preserves the adjacent landscape page's proportions",
  )
  await outputPage().click()
  const nextPage = output.getByRole("button", { name: "Next Output page", exact: true })
  while (await nextPage.isEnabled()) await nextPage.click()
  const fitted = await output.locator(".blank-sheet").boundingBox()
  check(
    Math.abs(fitted.width / fitted.height - 297 / 210) < 0.01 && fitted.height <= 860,
    "Blank Page preserves landscape proportions within the PDF fit limits",
  )
  check(
    await output.getByRole("button", { name: "Show original page", exact: true }).isDisabled(),
    "Blank has no original Input page",
  )
  await zoom(output, "Zoom in")
  const enlarged = await output.locator(".blank-sheet").boundingBox()
  check(
    Math.abs(enlarged.width / fitted.width - 1.5) < 0.01 && Math.abs(enlarged.height / fitted.height - 1.5) < 0.01,
    "Zoom scales both Blank dimensions without changing its proportions",
  )
  await zoom(output, "Fit page")
  await outputPages().click()
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 7", exact: true }).click()
  const first = output.locator(".composition-card").first()
  await first.locator(".page-image").hover()
  check(!(await first.locator(".page-origin-info").isVisible()), "Hover leaves the lens unobstructed")
  await first.getByLabel("Details for Output page 1", { exact: true }).click()
  await page.mouse.move(0, 0)
  check(
    (await first.locator(".page-origin-info").isVisible()) &&
      (await first.locator(".page-origin-info").innerText()).includes("Practice book.pdf"),
    "Page number pins provenance for touch and keyboard",
  )
  await page.keyboard.press("Escape")
  check(!(await first.locator(".page-origin-info").isVisible()), "Escape dismisses provenance")
  const retainedCanvas = await output.locator(".composition-card").nth(2).locator("canvas").elementHandle()
  await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
  await page.keyboard.press("Control+ArrowLeft")
  const retained = await retainedCanvas.evaluate((image) => ({
    connected: image.isConnected,
    width: image.width,
  }))
  check(retained.connected && retained.width > 0, `Reordering retains the rendered canvas: ${JSON.stringify(retained)}`)
  check(
    await output
      .getByRole("button", { name: "Select Output page 2", exact: true })
      .evaluate((button) => button === document.activeElement),
    "Keyboard reordering retains focus on the occurrence",
  )
  await page.keyboard.press("Control+ArrowRight")
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  const sequenceBeforeInsertion = await entry.inputValue()
  await input.getByRole("button", { name: "Clear page sequence", exact: true }).click()
  await output.getByRole("button", { name: "Select or drag Output page 3", exact: true }).click()
  await input.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
  check(
    (await total()) === "7 PDF pages" && (await order())[3] === "p. 1" && (await entry.inputValue()) === "",
    "Double-click inserts one copy after Output selection without an Input preparation",
  )
  await input.getByRole("button", { name: "Select Input page 2", exact: true }).dblclick()
  check(
    (await total()) === "8 PDF pages" && (await order())[4] === "p. 2",
    "Further insertions follow the last added occurrence",
  )
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 5", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 4", exact: true }).click()
  await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
  check((await total()) === "7 PDF pages", "Output plus adds an adjacent copy")
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 1", exact: true }).press("Space")
  check((await total()) === "6 PDF pages", "Output minus removes only that occurrence")
  check(
    await first.locator(".page-image").evaluate((button) => button === document.activeElement),
    "Removing an occurrence by keyboard moves focus to its neighbor",
  )
  await entry.fill(sequenceBeforeInsertion)
  await page.setViewportSize({ width: 1440, height: 2400 })
  // Let resize cancellation finish before starting the next transfer.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  const dragData = await page.evaluateHandle(() => new DataTransfer())
  const transfer = input.getByRole("button", { name: "Add to Output", exact: true })
  await transfer.dispatchEvent("dragstart", { dataTransfer: dragData })
  check(
    (await page.locator(".composer").getAttribute("data-drag")) === "source" &&
      (await input.locator("[data-dragging]").count()) > 0,
    "Starting a drag identifies its source and highlights Output",
  )
  const destination = output.locator(".composition-card").nth(2)
  let destinationBox = await destination.boundingBox()
  await destination.dispatchEvent("dragover", {
    dataTransfer: dragData,
    clientX: destinationBox.x + 10,
    clientY: destinationBox.y + 60,
  })
  check(
    (await destination.getAttribute("data-drop")) === "before" &&
      (await output.locator(".sequence-help").innerText()).includes("Before page 3"),
    "The left half marks insertion before a page",
  )
  destinationBox = await destination.boundingBox()
  await destination.dispatchEvent("dragover", {
    dataTransfer: dragData,
    clientX: destinationBox.x + destinationBox.width - 10,
    clientY: destinationBox.y + 60,
  })
  check(
    (await destination.getAttribute("data-drop")) === "after" &&
      (await output.locator(".sequence-help").innerText()).includes("After page 3"),
    "The right half marks insertion after a page",
  )
  await page.keyboard.press("Escape")
  check(
    !(await page.locator(".composer[data-drag]").count()) &&
      !(await output.locator("[data-drop]").count()) &&
      (await total()) === "6 PDF pages",
    "Cancelling clears drag feedback without changing Output",
  )
  await dragData.dispose()
  await input
    .getByRole("button", { name: "Add to Output", exact: true })
    .dragTo(output.locator(".section-heading").first())
  check((await total()) === "12 PDF pages", "Compact drag widget adds the sequence directly to Output")
  await page.setViewportSize({ width: 1440, height: 1100 })
  await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("Home")
  const thirdPage = output.getByRole("button", { name: "Select Output page 3", exact: true })
  const thirdBox = await thirdPage.boundingBox()
  await output
    .getByRole("button", { name: "Select or drag Output page 1", exact: true })
    .dragTo(thirdPage, { targetPosition: { x: thirdBox.width - 10, y: 40 } })
  check((await order()).slice(0, 3).join(",") === "p. 4,p. 5,p. 3", "Output thumbnail drag changes occurrence order")
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Select Output page 3", exact: true }).click()
  await output.getByLabel("Output page actions", { exact: true }).click()
  await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
  await output.getByLabel("Output page actions", { exact: true }).click()
  await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click()
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  check((await order()).slice(0, 3).join(",") === "p. 3,p. 4,p. 5", "Buttons provide the same ordering operation")
  const faces = await output.locator(".composition-card").evaluateAll((cards) =>
    cards.slice(0, 2).map((card) => ({
      face: card.dataset.face,
      label: card.querySelector(".page-face").getAttribute("aria-label"),
      help: card.querySelector(".page-face").getAttribute("title"),
    })),
  )
  check(
    faces[0].label === "Front side" &&
      faces[1].label === "Back side" &&
      faces[0].help === "Front side" &&
      faces[1].help === "Back side" &&
      faces[0].face === "front" &&
      faces[1].face === "back",
    "Front and Back retain parity, hover help, and accessible labels",
  )
  const handle = input.locator(".page-grip").first()
  await page.mouse.move(0, 0)
  check(
    await handle.evaluate((element) => {
      const grip = element.getBoundingClientRect(),
        card = element.closest(".composition-card").getBoundingClientRect()
      return (
        getComputedStyle(element).opacity === "1" && Math.abs(grip.x + grip.width / 2 - card.x - card.width / 2) < 1
      )
    }),
    "Input drag grips are visible and centered before interaction",
  )
  const inputOptions = input.getByLabel("Input page actions", { exact: true })
  await inputOptions.click()
  await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
  check(
    (await input.locator(".sequence-help").innerText()).includes("Repeat ×2"),
    "Input repeat options remain available beside the sequence",
  )
  await input.getByRole("button", { name: "Reset selection repetitions", exact: true }).click()
  await page.keyboard.press("Escape")
  check(!(await input.locator(".input-options").evaluate((e) => e.open)), "Escape dismisses Input page options")
  await entry.fill("1-3")
  await inputOptions.click()
  await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2")
  await input.getByLabel("Start each repeat on front", { exact: true }).check()
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  check(
    (await total()) === "20 PDF pages" &&
      (await output.locator(".output-state").innerText()).includes("2 Padding pages"),
    "Input repetitions preserve the sequence and add duplex Padding",
  )
  await download(20)
  await inputOptions.click()
  check(
    (await entry.inputValue()) === "" &&
      (await input.getByRole("textbox", { name: "Repetitions", exact: true }).inputValue()) === "1" &&
      !(await input.getByLabel("Start each repeat on front", { exact: true }).isChecked()),
    "Successful bulk addition resets the sequence, repetition, and alignment",
  )
  await page.keyboard.press("Escape")
  await entry.fill("2,")
  check(
    (await entry.getAttribute("aria-invalid")) === "true" &&
      (await input.getByRole("button", { name: "Add to Output", exact: true }).count()) === 0,
    "Invalid page entry cannot change Output",
  )
  await entry.fill("3-5,2,2,7")
  await page.setViewportSize({ width: 2560, height: 1440 })
  await open("style-sample.pdf", prepared)
  await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "style-sample.pdf", null, {
    timeout: 60000,
  })
  await inputPages().click()
  await entry.fill("1,1,3,4")
  const clear = async () => {
    await outputPages().click()
    const all = output.getByRole("button", { name: "Select all", exact: true })
    if (await all.count()) await all.click()
    const remove = output.getByRole("button", { name: "Remove selected Output pages", exact: true })
    if (await remove.count()) await remove.click()
  }
  await clear()
  check(
    (await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).count()) === 0,
    "The empty selection bar has no removal action",
  )
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  await entry.fill("1,1,3,4")
  await open("style-sample.pdf", prepared)
  check(
    (await entry.inputValue()) === "" && (await total()) === "4 PDF pages",
    "Reopening a PDF starts independent preparation without adding pages",
  )
  await entry.fill("1,1,3,4")
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  await entry.fill("1,1,3,4")
  await inputStyle().click()
  const color = () =>
    input
      .locator("article.control")
      .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
      .locator("input[type=text]")
  const baselineColor = await color().inputValue()
  await color().fill("#555555")
  await output.getByRole("button", { name: "Download", exact: true }).waitFor({ state: "visible", timeout: 60000 })
  check((await total()) === "8 PDF pages", "Styles keep the complete Output sequence")
  const workers = await page.locator("html").getAttribute("data-processors")
  await color().fill("#666666")
  await output.getByRole("button", { name: "Download", exact: true }).waitFor({ state: "visible", timeout: 60000 })
  check(
    (await page.locator("html").getAttribute("data-processors")) === workers,
    "Completed style changes reuse the warm processor",
  )
  await color().fill("#555555")
  await output.getByRole("button", { name: "Download", exact: true }).waitFor({ state: "visible", timeout: 60000 })
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Select or drag Output page 4", exact: true }).click()
  await output
    .getByRole("button", { name: "Select or drag Output page 5", exact: true })
    .click({ modifiers: ["Shift"] })
  await output.getByLabel("Output page actions", { exact: true }).click()
  await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click()
  check(
    (await total()) === "10 PDF pages" && (await order()).slice(3, 7).join(",") === "p. 4,p. 1,p. 4,p. 1",
    "Output repetition preserves a consecutive sequence across independent Inputs",
  )
  check(
    (await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue()) === "6-7",
    "Output repetition selects its final copy",
  )
  await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
  check(
    (await total()) === "8 PDF pages" && (await color().inputValue()) === "#555555",
    "Independent occurrence removal keeps both Input styles and the other copies",
  )
  await outputPage().click()
  await ready()
  check(await output.locator(".inspection-heading .page-tools").isVisible(), "Page controls share the page heading")
  check(await aligned(output), "Page numbers, centered grips, and zoom align with bottom controls")
  const zoomOut = output.getByRole("button", { name: "Zoom out", exact: true })
  const zoomIn = output.getByRole("button", { name: "Zoom in", exact: true })
  await zoomOut.focus()
  await page.keyboard.press("Tab")
  check(await zoomIn.evaluate((el) => el === document.activeElement), "Tab moves between inline zoom controls")
  await page.keyboard.press("Enter")
  check(
    (await output.getByLabel("Output page zoom", { exact: true }).innerText()) === "150%",
    "Enter activates the focused zoom control",
  )
  await zoom(output, "Fit page")
  check(
    (await output.locator(".download-action").count()) === 1 &&
      (await output.locator(".section-heading .download-action").isVisible()),
    "Output keeps one shared Download action while Page is open",
  )
  await zoom(output, "Zoom in")
  check(
    (await output.getByLabel("Output page zoom", { exact: true }).innerText()) === "150%",
    "Output page zoom increases",
  )
  await zoom(output, "Zoom out")
  await zoom(output, "Zoom out")
  check(
    (await output.getByLabel("Output page zoom", { exact: true }).innerText()) === "50%",
    "Output page zoom decreases",
  )
  check(await output.getByRole("button", { name: "Zoom out", exact: true }).isDisabled(), "Zoom stops at 50%")
  await zoom(output, "Fit page")
  check(
    (await output.getByLabel("Output page zoom", { exact: true }).innerText()) === "100%",
    "Fit restores the complete page",
  )
  await ready()
  const previousPage = output.getByRole("button", { name: "Previous Output page", exact: true })
  while (await previousPage.isEnabled()) await previousPage.click()
  check(
    await output.getByRole("button", { name: "Compare page", exact: true }).isDisabled(),
    "Original Input occurrence has no style difference",
  )
  for (
    let position = 0;
    position < 8 && (await output.getByRole("button", { name: "Compare page", exact: true }).isDisabled());
    position++
  )
    await output.getByRole("button", { name: "Next Output page", exact: true }).click()
  await ready()
  const counter = output.locator(".inspection-heading .page-position")
  check(
    await output.getByRole("button", { name: "Compare page", exact: true }).isEnabled(),
    "Styled duplicate is comparable at its own Output position",
  )
  const result = await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL())
  await output.getByRole("button", { name: "Compare page", exact: true }).click()
  await ready()
  const reference = await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL())
  check(
    result !== reference &&
      (await output.getByRole("button", { name: "Compare page", exact: true }).getAttribute("aria-pressed")) === "true",
    "Compare page renders the immutable opened appearance",
  )
  const savedPosition = await counter.innerText()
  await zoom(output, "Zoom in")
  await outputPages().click()
  await outputPage().click()
  check(
    (await counter.innerText()) === savedPosition &&
      (await output.getByLabel("Output page zoom", { exact: true }).innerText()) === "150%" &&
      (await output.getByRole("button", { name: "Compare page", exact: true }).getAttribute("aria-pressed")) === "true",
    "Grid and Page views retain position, zoom, and comparison",
  )
  await zoom(output, "Fit page")
  await output.getByRole("button", { name: "Compare page", exact: true }).click()
  const position = await counter.innerText()
  await choose(2)
  await inputStyle().click()
  check(
    (await color().inputValue()) === baselineColor && (await counter.innerText()) === position,
    "Input switching keeps independent styles and Output preview position",
  )
  await choose(3)
  await inputStyle().click()
  await color().fill("invalid")
  check(
    (await color().getAttribute("aria-invalid")) === "true" &&
      (await output.getByRole("button", { name: "Compare page", exact: true }).isDisabled()),
    "Invalid relevant style draft disables page comparison",
  )
  check(
    (await output.getByRole("button", { name: "Download", exact: true }).isDisabled()) &&
      (await output.getByRole("button", { name: "Download", exact: true }).getAttribute("title")).includes(
        "fix Guide color",
      ),
    "Invalid relevant style drafts block Download before execution",
  )
  await page.getByRole("button", { name: "Reset all styles", exact: true }).click()
  await output.getByRole("button", { name: "Download", exact: true }).waitFor({ state: "visible", timeout: 60000 })
  check(
    (await color().inputValue()) === baselineColor && (await total()) === "8 PDF pages",
    "Style reset preserves Output and repetitions",
  )
  check(
    await output.getByRole("button", { name: "Download", exact: true }).isEnabled(),
    "Completed PDF processing restores Download",
  )
  const actionBounds = await output.locator(".download-action").boundingBox()
  await color().fill("#666666")
  check(
    (await output.locator(".output-status").innerText()) === "Updating PDF…" &&
      (await output.locator(".output-status .spinner").isVisible()),
    "Output identifies PDF processing with text and a spinner",
  )
  check(
    await output.getByRole("button", { name: "Download", exact: true }).isHidden(),
    "PDF processing replaces Download with its status",
  )
  const processingBounds = await output.locator(".download-action").boundingBox()
  check(
    Math.abs(processingBounds.width - actionBounds.width) < 1 &&
      Math.abs(processingBounds.height - actionBounds.height) < 1,
    "PDF processing preserves the Download action dimensions",
  )
  await page.getByRole("button", { name: "Cancel style processing", exact: true }).click()
  check(
    (await input.locator(".style-status").innerText()).includes("Styles need retry"),
    "Cancellation retains styles with retry feedback",
  )
  check(
    await output.getByRole("button", { name: "Download", exact: true }).isVisible(),
    "Cancelled PDF processing restores Download",
  )
  await choose(2)
  await inputStyle().click()
  check(
    await page.getByRole("button", { name: "Retry Input styles", exact: true }).isVisible(),
    "Failed Output preview remains visible and retryable when another Input is active",
  )
  await choose(3)
  await page.getByRole("button", { name: "Retry Input styles", exact: true }).click()
  await output.getByRole("button", { name: "Download", exact: true }).waitFor({ state: "visible", timeout: 60000 })
  check((await color().inputValue()) === "#666666", "Retry completes the retained style choice")
  await outputPages().click()
  await output.getByRole("button", { name: "Select or drag Output page 1", exact: true }).click()
  const options = output.locator(".output-options")
  if ((await options.getAttribute("open")) === null) await options.locator("summary").first().click()
  await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click()
  check(
    (await total()) === "9 PDF pages" && (await order())[0] === "210.0 × 297.0 mm",
    "Blank keeps adjacent physical dimensions",
  )
  const responsive = []
  const previousInput = await page
    .locator('.input-list button[data-source][aria-pressed="true"]')
    .getAttribute("data-source")
  const longFilename = "Practice book with a very long filename for checking the mobile header and file chooser.pdf"
  await open(longFilename, prepared)
  const longInput = await page
    .locator('.input-list button[data-source][aria-pressed="true"]')
    .getAttribute("data-source")
  await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1")
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  await inputStyle().click()
  await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  for (const width of [320, 390, 768])
    for (const scale of [100, 200]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate((textScale) => (document.documentElement.style.fontSize = `${textScale}%`), scale)
      const nav = page.getByRole("navigation", { name: "Workspace view", exact: true })
      await nav.getByRole("button", { name: "Input", exact: true }).click()
      check((await input.isVisible()) && !(await output.isVisible()), "Mobile Input takes its own pane")
      const picker = page.locator(".input-picker > summary")
      const pickerBox = await picker.boundingBox()
      const openBox = await input.locator(".file-picker").boundingBox()
      check(
        (Math.abs(pickerBox.y + pickerBox.height / 2 - openBox.y - openBox.height / 2) < 1 &&
          pickerBox.x + pickerBox.width <= openBox.x) ||
          pickerBox.y + pickerBox.height <= openBox.y,
        "The mobile file chooser and Open PDF share a row or stack without overlapping",
      )
      check(
        (await page.locator(".input-current").getAttribute("title")) === longFilename &&
          (await page.locator(".input-current").evaluate((element) => element.scrollWidth > element.clientWidth)),
        "Long mobile filenames truncate while keeping the full name in hover help",
      )
      await page.locator(".input-picker > summary").click()
      check(
        await page.locator(".input-picker").getByRole("button", { name: "Remove Input", exact: true }).isVisible(),
        "The mobile Input chooser offers removal",
      )
      await page.getByRole("button", { name: "Remove Input", exact: true }).scrollIntoViewIfNeeded()
      check(
        await page.getByRole("button", { name: "Remove Input", exact: true }).evaluate((button) => {
          const rect = button.getBoundingClientRect()
          return (
            document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") === button
          )
        }),
        "The open Input chooser stays above the workspace controls",
      )
      check(
        !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
        "Input menu and style controls fit enlarged text",
      )
      await page.keyboard.press("Escape")
      await nav.getByRole("button", { name: "Output", exact: true }).click()
      check(!(await input.isVisible()) && (await output.isVisible()), "One tap switches to Output")
      await (await gridPage(output, 1)).scrollIntoViewIfNeeded()
      const totalsBox = await output.locator(".output-state").boundingBox()
      const downloadBox = await output.locator(".download-action").boundingBox()
      check(
        (Math.abs(totalsBox.y + totalsBox.height / 2 - downloadBox.y - downloadBox.height / 2) < 1 &&
          totalsBox.x + totalsBox.width <= downloadBox.x) ||
          totalsBox.y + totalsBox.height <= downloadBox.y,
        "Mobile Output totals and Download share a row or stack without overlapping",
      )
      await first.locator(".occurrence-actions").evaluate((element) => element.scrollIntoView({ block: "center" }))
      check(
        await first.locator(".occurrence-actions button").evaluateAll((buttons) => {
          const boxes = buttons.map((button) => button.getBoundingClientRect())
          return boxes.every(
            (box, index) =>
              Math.abs(box.y - boxes[0].y) < 1 &&
              [
                [0, -21],
                [0, 21],
                [-21, 0],
                [21, 0],
              ].every(
                ([x, y]) =>
                  document
                    .elementFromPoint(box.x + box.width / 2 + x, box.y + box.height / 2 + y)
                    ?.closest("button") === buttons[index],
              ),
          )
        }),
        `Output actions retain one row and touch targets (${width}px, ${scale}%)`,
      )
      // Page 1 is Blank; page 2 supplies Source provenance.
      await gridPage(output, 2)
      await output.getByLabel("Details for Output page 2", { exact: true }).click()
      check(
        (await output.locator(".page-origin-info").filter({ hasText: longFilename }).isVisible()) &&
          !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
        "Output provenance fits the mobile pane",
      )
      await page.keyboard.press("Escape")
      await outputPage().click()
      await ready()
      check(
        !(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)),
        "Output preview fits enlarged text",
      )
      await outputPages().click()
      responsive.push({ width, scale, overflow: false })
    }
  if (await output.getByRole("button", { name: "Clear Output selection", exact: true }).count())
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
  await output.getByRole("button", { name: "Remove Output page 2", exact: true }).click()
  await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
  await page.setViewportSize({ width: 390, height: 900 })
  await page
    .getByRole("navigation", { name: "Workspace view", exact: true })
    .getByRole("button", { name: "Input", exact: true })
    .click()
  await page.locator(".input-picker > summary").click()
  await page.locator(".input-picker").getByRole("button", { name: "Remove Input", exact: true }).click()
  check(
    (await page.locator(`.input-list button[data-source="${longInput}"]`).count()) === 0 &&
      (await total()) === "9 PDF pages",
    "The mobile Input menu removes unreferenced Inputs without changing Output",
  )
  await page.evaluate(() => (document.documentElement.style.fontSize = ""))
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.locator(".input-picker > summary").click()
  await page.locator(`.input-list button[data-source="${previousInput}"]`).click()
  await inputPages().click()
  check(
    (await entry.inputValue()) === "1,1,3,4" && (await total()) === "9 PDF pages",
    "Mobile view changes preserve Input and Output",
  )
  await open("ordinary.pdf", ordinary)
  await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "ordinary.pdf", null, {
    timeout: 60000,
  })
  check(!(await welcome.isVisible()), "Another PDF does not repeat onboarding")
  await startTour()
  await step("input")
  for (const key of [
    "input-grid",
    "input-density",
    "input-page",
    "output-grid",
    "output-selection",
    "output-page",
    "download",
  ]) {
    await tour.getByRole("button", { name: "Next", exact: true }).click()
    await step(key)
  }
  check((await tour.locator(".tour-progress").textContent()).includes("/ 8"), "Ordinary PDFs use the eight-step tour")
  await page.keyboard.press("Escape")
  await entry.fill("1,1")
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  check((await total()) === "11 PDF pages", "Ordinary one-page Input supports repetition")
  const dialog = page.locator(".download-dialog")
  let reached, release
  const started = new Promise((resolve) => (reached = resolve))
  const held = new Promise((resolve) => (release = resolve))
  await page.route("**/processor.mjs", async (route) => {
    reached()
    await held
    try {
      await route.continue()
    } catch {
      /* The cancelled worker no longer owns the request. */
    }
  })
  let cancelledDownloads = 0
  const unexpectedDownload = () => cancelledDownloads++
  page.on("download", unexpectedDownload)
  await output.getByRole("button", { name: "Download", exact: true }).click()
  await started
  check(
    (await dialog.getByRole("status").innerText()) === "Preparing PDF…" &&
      (await dialog.evaluate((element) => element.matches(":modal"))),
    "Download exposes progress and locks the workspace with a native modal",
  )
  await page.keyboard.press("Escape")
  release()
  await page.unroute("**/processor.mjs")
  check(
    !(await dialog.isVisible()) && (await total()) === "11 PDF pages" && cancelledDownloads === 0,
    "Escape cancels without downloading or changing Output",
  )
  page.off("download", unexpectedDownload)
  const retryImages = await outputImages(11)
  await page.route("**/processor.mjs", (route) => route.abort("failed"))
  await output.getByRole("button", { name: "Download", exact: true }).click()
  await dialog.getByRole("alert").waitFor()
  check(
    (await total()) === "11 PDF pages" &&
      (await dialog.getByRole("button", { name: "Retry", exact: true }).isVisible()),
    "Worker loading failure offers Retry and retains the Output",
  )
  await page.unroute("**/processor.mjs")
  await download(11, dialog.getByRole("button", { name: "Retry", exact: true }), retryImages)
  const inputs = Number(await page.locator(".input-heading .count").innerText())
  await page.evaluate(() => {
    const read = File.prototype.arrayBuffer
    File.prototype.arrayBuffer = async function () {
      File.prototype.arrayBuffer = read
      document.documentElement.dataset.readingFile = "true"
      await new Promise((resolve) => window.addEventListener("release-file", resolve, { once: true }))
      const bytes = await read.call(this)
      document.documentElement.dataset.readingFile = "false"
      return bytes
    }
  })
  await page
    .locator(".input-heading input[type=file]")
    .setInputFiles({ name: "Cancelled read.pdf", mimeType: "application/pdf", buffer: ordinary })
  await page.waitForFunction(() => document.documentElement.dataset.readingFile === "true")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await page.evaluate(() => window.dispatchEvent(new Event("release-file")))
  await page.waitForFunction(() => document.documentElement.dataset.readingFile === "false")
  check(
    Number(await page.locator(".input-heading .count").innerText()) === inputs &&
      !(await page.getByRole("button", { name: "Cancel", exact: true }).isVisible()),
    "Opening can be cancelled during file reading without adding an obsolete Input",
  )
  await page.evaluate(async (bytes) => {
    const { openPDF } = await import("/src/pdf.ts")
    const task = await openPDF(Uint8Array.from(bytes))
    const document = await task.promise
    const prototype = Object.getPrototypeOf(document)
    const original = prototype.getPageLabels
    prototype.getPageLabels = async function () {
      prototype.getPageLabels = original
      const labels = await original.call(this)
      window.document.documentElement.dataset.labelsPending = "true"
      await new Promise((resolve) => window.addEventListener("release-labels", resolve, { once: true }))
      return labels
    }
    await task.destroy()
  }, Array.from(ordinary))
  await page
    .locator(".input-heading input[type=file]")
    .setInputFiles({ name: "Cancelled.pdf", mimeType: "application/pdf", buffer: ordinary })
  await page.waitForFunction(() => document.documentElement.dataset.labelsPending === "true")
  await page.getByRole("button", { name: "Cancel", exact: true }).click()
  await open("Retry.pdf", ordinary)
  await page.evaluate(() => window.dispatchEvent(new Event("release-labels")))
  await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
  check(
    Number(await page.locator(".input-heading .count").innerText()) === inputs + 1 &&
      (await page.locator(".input-current").innerText()) === "Retry.pdf",
    "Cancellation during page labels cannot restore an obsolete Input after retry",
  )
  await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-11")
  await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
  check((await total()) === "1 PDF page", "Output can retain only an explicit Blank")
  await outputPage().click()
  await zoom(output, "Zoom in")
  await output.getByLabel("Page selection", { exact: true }).fill("1")
  for (let index = 0; index < inputs + 1; index++) {
    await page.locator(".input-picker > summary").click()
    await page.getByRole("button", { name: "Remove Input", exact: true }).click()
  }
  check(
    await page
      .locator("#workspace input[type=file]")
      .first()
      .evaluate((field) => field === document.activeElement),
    "Removing the final Input returns focus to Open PDF",
  )
  check(
    (await page.locator(".drop-zone").isVisible()) &&
      (await page.locator("html").getAttribute("data-active-processors")) === "0",
    "Removing all Inputs releases both busy and idle processors",
  )
  check(
    (await outputPage().getAttribute("aria-selected")) === "true" &&
      (await output.getByLabel("Output page zoom", { exact: true }).innerText()) === "150%" &&
      (await output.getByLabel("Page selection", { exact: true }).inputValue()) === "1",
    "Removing the final Input retains Blank Output view, zoom, and selection",
  )
  await zoom(output, "Fit page")
  await outputPages().click()
  const portrait = await output.locator(".composition-blank").boundingBox()
  check(
    Math.abs(portrait.width / portrait.height - 210 / 297) < 0.01 && portrait.height <= 168,
    "A retained portrait Blank keeps its physical proportions without any Input",
  )
  await outputPage().click()
  const portraitPage = await output.locator(".blank-sheet").boundingBox()
  check(
    Math.abs(portraitPage.width / portraitPage.height - 210 / 297) < 0.01 && portraitPage.height <= 860,
    "Blank-only Page uses portrait proportions and the PDF fit limits",
  )
  await outputPages().click()
  await download(1)
  let warnings = 0
  const dismissWarning = async (warning) => {
    warnings++
    await warning.dismiss()
  }
  page.on("dialog", dismissWarning)
  await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
  await page.waitForLoadState("networkidle")
  check(
    warnings === 0 && (await page.locator(".drop-zone").isVisible()),
    `Downloaded choices return Home without an unsaved warning (${warnings} warnings)`,
  )
  await open("Unused styles.pdf", prepared)
  await entry.fill("1")
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  await inputStyle().click()
  await color().fill("#884488")
  await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
  await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
  await open("Used.pdf", ordinary)
  await entry.fill("1")
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  await download(1)
  await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
  check(
    warnings === 1 && (await page.locator(".input-current").textContent()) === "Used.pdf",
    "Downloading Output retains the warning for undownloaded styles on unused Inputs",
  )
  await choose(1)
  await inputPages().click()
  await entry.fill("1")
  await input.getByRole("button", { name: "Add to Output", exact: true }).click()
  await inputStyle().click()
  await color().fill("invalid")
  await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
  await choose(2)
  await download(1)
  await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
  check(warnings === 2, "Unused invalid drafts do not block Download and retain their unsaved warning")
  page.off("dialog", dismissWarning)
  check(errors.length === 0, `No browser runtime errors: ${errors.join("; ")}`)
  page.off("pageerror", recordError)
  return { checks, failed: 0, responsive, runtimeErrors: errors.length }
}
