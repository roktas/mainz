// Checks complete workspace flows and offline updates across viewports.

import assert from "node:assert/strict"
import test from "node:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve as resolvePath } from "node:path"
import { build, preview } from "vite"
import { chromium, devices } from "playwright"
import { aligned, checkWorkspace } from "./workspace.js"
import { checkGeometry, checkStatus, createServer, fixture } from "./browser.js"

async function checkMobile(browser, url) {
  const sample = await readFile("test/fixtures/demo.pdf")
  for (const [width, text, colorScheme] of [
    [320, "100%", "light"],
    [375, "100%", "dark"],
    [390, "100%", "dark"],
    [768, "100%", "light"],
    [320, "200%", "dark"],
    [375, "200%", "light"],
    [390, "200%", "light"],
    [768, "200%", "dark"],
  ]) {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width, height: width === 375 ? 667 : 900 },
      colorScheme,
      reducedMotion: "reduce",
    })
    try {
      const page = await context.newPage()
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(url)
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
      assert.equal(await page.evaluate(() => innerWidth), width)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      const picker = page.locator(".drop-zone .file-picker[aria-hidden=false]")
      const resting = await picker.evaluate((element) => getComputedStyle(element).backgroundColor)
      await picker.hover()
      assert.equal(
        await picker.evaluate((element) => getComputedStyle(element).backgroundColor),
        resting,
        "Touch screens do not retain hover paint on the PDF chooser",
      )
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "demo.pdf", mimeType: "application/pdf", buffer: sample })
      await page.locator(".composer").waitFor({ timeout: 60000 })
      await page.getByRole("button", { name: "Settings", exact: true }).tap()
      const settings = page.getByRole("dialog", { name: "Settings", exact: true })
      assert.equal(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
      const identifier = await settings.locator("time").boundingBox()
      assert.ok(identifier.x >= 0 && identifier.x + identifier.width <= width)
      assert.ok(identifier.y >= 0 && identifier.y + identifier.height <= page.viewportSize().height)
      await settings.getByRole("button", { name: "Close Settings", exact: true }).tap()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
      assert.equal(await views.isVisible(), true)
      assert.equal(
        await views.getByRole("button").evaluateAll((buttons) =>
          buttons.every((button) => {
            const range = document.createRange()
            range.selectNodeContents(button.lastChild)
            const rects = [...range.getClientRects()]
            const bounds = button.getBoundingClientRect()
            return rects.length === 1 && rects[0].left >= bounds.left && rects[0].right <= bounds.right
          }),
        ),
        true,
        "Mobile view labels remain complete on one line at enlarged text sizes",
      )
      assert.equal(await output.isVisible(), false)
      const navigationBox = await views.getByRole("button", { name: "Input", exact: true }).boundingBox()
      const openingBox = await input.locator(".file-picker").boundingBox()
      assert.ok(Math.abs(openingBox.width - navigationBox.width) < 1)
      assert.ok(Math.abs(openingBox.height - navigationBox.height) < 1)
      if (width <= 390) {
        assert.equal(await page.locator(".footnote > time").isVisible(), false)
        assert.equal(await page.locator(".footnote > .status-input").isVisible(), false)
        const footer = await page.locator(".footnote").boundingBox()
        assert.equal(footer.x, 0)
        assert.equal(footer.width, await page.evaluate(() => document.documentElement.clientWidth))
        assert.equal(
          await page.locator(".footnote").evaluate((element) => {
            const style = getComputedStyle(element)
            return parseFloat(style.paddingTop) >= 12 && parseFloat(style.paddingBottom) >= 12
          }),
          true,
          "Mobile feedback has breathing room above and below",
        )
      }
      const selection = input.getByRole("textbox", { name: "Page selection", exact: true })
      const thumbnail = input.getByRole("button", { name: "Select Input page 1", exact: true })
      await thumbnail.tap()
      assert.equal(await selection.inputValue(), "1", "Touching an image selects the page")
      assert.equal(await thumbnail.evaluate((item) => item === document.activeElement), true)
      const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true })
      await grip.tap()
      assert.equal(await selection.inputValue(), "")
      assert.equal(await thumbnail.evaluate((item) => item === document.activeElement), true)
      await grip.tap()
      assert.equal(await selection.inputValue(), "1")
      assert.equal(await thumbnail.evaluate((item) => item === document.activeElement), true)
      await input.getByRole("button", { name: "Add to Output", exact: true }).tap()
      assert.equal(await output.locator(".output-state strong").textContent(), "1 PDF page")
      assert.equal(await selection.inputValue(), "")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3")
      await input.getByRole("button", { name: "Add to Output", exact: true }).tap()
      await input.getByRole("tab", { name: "Style", exact: true }).tap()
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
      await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
      const guides = input.getByRole("group", { name: "Minors", exact: true })
      await guides.getByLabel("Edit Width", { exact: true }).tap()
      const widthField = guides.getByRole("spinbutton", {
        name: "Minors Stroke Width (mm)",
        exact: true,
      })
      assert.equal(await widthField.inputValue(), "0.04")
      await widthField.fill("0.05")
      assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "")
      assert.match(await input.locator(".style-profile .control-description").textContent(), /Custom styles/)
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
      await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
      assert.equal(await widthField.inputValue(), "0.04")
      const pattern = input.locator('.style-object[aria-label="Pattern"]')
      await checkGeometry(pattern)
      if (width <= 390)
        assert.equal(
          await pattern
            .locator(".quartet-component")
            .evaluateAll((elements) =>
              elements.every((element) => getComputedStyle(element).borderTopColor !== "rgba(0, 0, 0, 0)"),
            ),
          true,
          "Touch Quartet summaries retain visible boundaries",
        )
      for (const label of await pattern
        .locator(".quartet-caption > span, .quartet-text > span:not([aria-hidden])")
        .all())
        assert.ok(
          await label.evaluate(
            (element) => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).fontSize) * 1.7,
          ),
          "Quartet captions and values must stay on one line",
        )
      await pattern.getByLabel("Edit Fill", { exact: true }).tap()
      assert.equal(
        await pattern.evaluate((element) => {
          const selected = element
            .querySelector('[aria-expanded="true"]')
            .closest(".quartet-property")
            .getBoundingClientRect()
          const dock = element.querySelector(".quartet-dock").getBoundingClientRect()
          const gap = parseFloat(getComputedStyle(element.querySelector(".quartet-fields")).rowGap)
          return dock.y >= selected.bottom && dock.y - selected.bottom <= gap * 3 + 1
        }),
        true,
        "The editor opens directly below its selected summary row",
      )
      const colorField = pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true })
      assert.equal(
        await colorField.evaluate((element) => {
          const style = getComputedStyle(element)
          const canvas = document.createElement("canvas").getContext("2d")
          canvas.font = style.font
          return (
            element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >=
            canvas.measureText(element.value).width
          )
        }),
        true,
        "The complete color code must fit in the editor",
      )
      assert.equal(
        await pattern.getByText("Fill opacity: 0% is transparent; 100% is opaque.", { exact: true }).isVisible(),
        true,
      )
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await checkStatus(page)
      await views.getByRole("button", { name: "Output", exact: true }).tap()
      assert.equal(await input.isVisible(), false)
      assert.equal(await output.isVisible(), true)
      await output.getByRole("tab", { name: "Page", exact: true }).tap()
      const downloadingBox = await output.getByRole("button", { name: "Download", exact: true }).boundingBox()
      assert.ok(Math.abs(downloadingBox.width - navigationBox.width) < 1)
      assert.ok(Math.abs(downloadingBox.height - navigationBox.height) < 1)
      if (width <= 390) {
        assert.equal(await output.locator(".sequence-entry").isVisible(), true)
        assert.equal(
          await output.locator(".page-tools .tool").evaluateAll((elements) => {
            const boxes = elements.map((element) => element.getBoundingClientRect())
            return boxes.every((box) => box.width >= 44 && box.height >= 44)
          }),
          true,
          "All compact Page tools retain full-size touch targets",
        )
      }
      assert.equal(await aligned(output), true, "Page controls align at narrow widths and enlarged text")
      const tools = output.getByRole("group", { name: "Output Page controls", exact: true })
      assert.equal(await tools.isVisible(), true)
      const toolsBox = await tools.boundingBox()
      assert.ok(toolsBox.x >= 0 && toolsBox.x + toolsBox.width <= width)
      await tools.getByRole("button", { name: "Zoom in", exact: true }).tap()
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%")
      await tools.getByRole("button", { name: "Fit page", exact: true }).tap()
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "100%")
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await views.getByRole("button", { name: "Input", exact: true }).tap()
      assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
    } finally {
      await context.close()
    }
  }
}

test(
  "PDF workspace preserves composition, styles, focus, and responsive controls",
  { timeout: 240000 },
  async (context) => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    let page
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      await page.addInitScript(() => {
        const Original = Worker
        window.Worker = class extends Original {
          #processor = false
          constructor(url, options) {
            super(url, options)
            if (String(url).includes("processor.worker")) {
              this.#processor = true
              const root = document.documentElement
              root.dataset.processors = String(Number(root.dataset.processors ?? 0) + 1)
              root.dataset.activeProcessors = String(Number(root.dataset.activeProcessors ?? 0) + 1)
            }
          }
          terminate() {
            if (this.#processor) {
              const root = document.documentElement
              root.dataset.activeProcessors = String(Number(root.dataset.activeProcessors) - 1)
              this.#processor = false
            }
            super.terminate()
          }
        }
      })
      await page.goto(server.resolvedUrls.local[0])
      await page.evaluate(() => localStorage.setItem("mainz:onboarding", "18"))
      await page.reload()
      const result = await checkWorkspace(page, fixture(), fixture(false))
      assert.equal(result.failed, 0)
      console.log(`${result.checks} browser checks passed.`)
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Mixed visibility.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, true),
        })
      await page.getByRole("button", { name: "Skip", exact: true }).click()
      assert.equal(await page.getByRole("dialog", { name: "Product tour", exact: true }).isVisible(), false)
      await page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7")
      await page.getByRole("button", { name: "Add to Output", exact: true }).click()
      await page.getByRole("tab", { name: "Style", exact: true }).click()
      const visibility = page.getByRole("article", { name: "Show Guides", exact: true })
      const show = visibility.getByRole("radio", { name: "Show", exact: true })
      const hide = visibility.getByRole("radio", { name: "Hide", exact: true })
      const reset = visibility.getByRole("button", { name: "Reset Show Guides", exact: true })
      assert.equal(await show.isChecked(), false)
      assert.equal(await hide.isChecked(), false)
      assert.match(await visibility.innerText(), /No single value/)
      assert.equal(await reset.isDisabled(), true)
      await hide.check()
      assert.equal(await hide.isChecked(), true)
      assert.equal(await show.isChecked(), false)
      await hide.press("ArrowLeft")
      assert.equal(await show.isChecked(), true)
      assert.equal(await hide.isChecked(), false)
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
      assert.equal(await page.locator(".error-banner").count(), 0)
      await reset.click()
      assert.equal(await show.isChecked(), false)
      assert.equal(await hide.isChecked(), false)
      assert.match(await visibility.innerText(), /No single value/)
      assert.equal(await reset.isDisabled(), true)
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
      assert.equal(await page.locator(".error-banner").count(), 0)
      console.log("Mixed visibility, Show/Hide, keyboard selection, and reset checks passed.")
      const blankOutput = page.locator(".composition-output")
      await blankOutput.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      await page.locator(".selection-panel").getByRole("tab", { name: "Grid", exact: true }).click()
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await blankOutput.locator(".output-options > summary").click()
      await blankOutput.getByRole("button", { name: "Add blank page at end", exact: true }).click()
      await blankOutput.getByRole("button", { name: "Clear Output selection", exact: true }).click()
      await blankOutput.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
      await page.locator(".input-picker > summary").click()
      await page.locator(".input-picker").getByRole("button", { name: "Remove Input", exact: true }).click()
      await page.locator(".selection-panel").waitFor({ state: "hidden" })
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.getByRole("button", { name: "Start Tour", exact: true }).click()
      const blankTour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await blankTour.waitFor()
      for (const key of ["output-grid", "output-page", "download"]) {
        await page.waitForFunction(
          (value) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === value,
          key,
        )
        assert.equal(await page.locator(`[data-tour-target="${key}"]`).isVisible(), true)
        if (key !== "download") await blankTour.getByRole("button", { name: "Next", exact: true }).click()
      }
      assert.match(await blankTour.locator(".tour-progress").textContent(), /\/ 3/)
      await blankTour.getByRole("button", { name: "Finish", exact: true }).click()
      assert.equal(await blankOutput.locator(".composition-totals strong").textContent(), "1 PDF page")
      assert.equal(
        await blankOutput.locator(".composition-totals").getByText("1 duplex sheet", { exact: true }).isVisible(),
        true,
      )
      console.log("Blank-only Output has a tour without Input or Style steps.")
      page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      })
      await page.goto(server.resolvedUrls.local[0])
      const openHintInput = async () => {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "First action.pdf",
            mimeType: "application/pdf",
            buffer: fixture(false),
          })
        await page.locator(".input-current").waitFor()
      }
      await openHintInput()
      const instruction = "Select pages · Use + to add to Output."
      const status = page.locator(".footnote [role=status] span")
      const notice = page.getByRole("banner").getByRole("status")
      const instructionText = notice.locator("p")
      const flight = page.locator(".page-flight:popover-open")
      const hintWelcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      const hintTour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await hintWelcome.waitFor()
      const statusStyle = await status.evaluate((element) => ({
        font: getComputedStyle(element).fontSize,
        color: getComputedStyle(element).color,
        weight: getComputedStyle(element).fontWeight,
        background: getComputedStyle(element).backgroundColor,
      }))
      assert.equal(await notice.count(), 0)
      await hintWelcome.getByRole("button", { name: "Take a tour", exact: true }).click()
      await hintTour.waitFor()
      assert.equal(await notice.count(), 0)
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click()
      await flight.waitFor()
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector(".page-flight"), "::backdrop").opacity) > 0.9,
      )
      assert.equal(await flight.evaluate((element) => getComputedStyle(element).opacity), "0")
      assert.equal(await instructionText.textContent(), instruction)
      assert.equal(
        await page.getByRole("button", { name: "Select Input page 1", exact: true }).getAttribute("aria-pressed"),
        "true",
      )
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages")
      const origin = await page.locator('[data-tour-target="first-page"] .thumbnail canvas').boundingBox()
      const spotlight = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop")
        return [style.translate, style.insetInlineStart, style.insetBlockStart]
      })
      await page.waitForFunction(
        (left) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > left,
        origin.x + 8,
      )
      const fading = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop")
        return {
          position: [style.translate, style.insetInlineStart, style.insetBlockStart],
          opacity: Number(style.opacity),
        }
      })
      assert.deepEqual(fading.position, spotlight, "The spotlight stays over Input while the copy moves")
      assert.ok(
        fading.opacity > 0.25 && fading.opacity < 0.9,
        "The copy starts moving while the fading light is visible",
      )
      await page.waitForFunction(
        (right) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > right,
        origin.x + origin.width,
      )
      assert.equal(
        await instructionText.evaluate((element) => getComputedStyle(element).opacity),
        "1",
        "Notice text keeps its full contrast during display",
      )
      await flight.waitFor({ state: "hidden" })
      assert.equal(await instructionText.textContent(), instruction)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages")
      assert.ok(
        Number(await instructionText.evaluate((element) => getComputedStyle(element).fontWeight)) >
          Number(statusStyle.weight),
      )
      assert.ok(
        parseFloat(await instructionText.evaluate((element) => getComputedStyle(element).fontSize)) >
          parseFloat(statusStyle.font),
      )
      assert.equal(await notice.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)")
      const headerBounds = await page.getByRole("banner").boundingBox()
      const noticeBounds = await notice.boundingBox()
      assert.ok(
        Math.abs(noticeBounds.x + noticeBounds.width / 2 - headerBounds.x - headerBounds.width / 2) < 1,
        "The compact Notice is centered in the header",
      )
      assert.match(await status.textContent(), /Opened 1 page/)
      await page.waitForFunction(() => {
        const element = document.querySelector(".notice")
        return element && Number(getComputedStyle(element).opacity) < 0.9
      })
      await notice.waitFor({ state: "detached", timeout: 15000 })
      assert.match(await status.textContent(), /Opened 1 page/)
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.getByRole("button", { name: "Start Tour", exact: true }).click()
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click()
      assert.equal(await flight.isVisible(), false)
      await page.reload()
      await openHintInput()
      await flight.waitFor()
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await flight.waitFor({ state: "hidden" })
      assert.match(await status.textContent(), /Added 1 page to Output/)
      await notice.waitFor({ state: "detached" })
      assert.equal(await notice.count(), 0)
      assert.deepEqual(
        await status.evaluate((element) => ({
          font: getComputedStyle(element).fontSize,
          color: getComputedStyle(element).color,
          weight: getComputedStyle(element).fontWeight,
          background: getComputedStyle(element).backgroundColor,
        })),
        statusStyle,
      )
      await page.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await flight.isVisible(), false)
      assert.equal(await page.locator(".composition-empty").isVisible(), true)
      await page.reload()
      await openHintInput()
      await flight.waitFor()
      await page.emulateMedia({ reducedMotion: "reduce" })
      await flight.waitFor({ state: "hidden" })
      assert.equal(await instructionText.textContent(), instruction)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages")
      await page.reload()
      await openHintInput()
      await notice.filter({ hasText: instruction }).waitFor()
      assert.equal(await flight.isVisible(), false)
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      assert.match(await status.textContent(), /Added 1 page to Output/)
      await page.setViewportSize({ width: 390, height: 900 })
      await page.emulateMedia({ reducedMotion: "no-preference" })
      await page.reload()
      await openHintInput()
      await flight.waitFor()
      const bounds = await notice.boundingBox()
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391)
      assert(bounds.y >= 0 && bounds.y + bounds.height <= 901)
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick()
      await flight.waitFor({ state: "hidden" })
      assert.match(await status.textContent(), /Added 1 page to Output/)
      await page.setViewportSize({ width: 390, height: 650 })
      await page.reload()
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      await openHintInput()
      assert.equal(await notice.count(), 0)
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).scrollIntoViewIfNeeded()
      await notice.filter({ hasText: instruction }).waitFor()
      const enlarged = await notice.boundingBox()
      assert(enlarged && enlarged.x >= 0 && enlarged.x + enlarged.width <= 391)
      assert(enlarged.y >= 0 && enlarged.y + enlarged.height <= 651)
      await page.getByRole("button", { name: "Dismiss notification", exact: true }).focus()
      await page.keyboard.press("Enter")
      await notice.waitFor({ state: "detached" })
      assert.equal(await notice.count(), 0)
      assert.match(await status.textContent(), /Opened 1 page/)
      console.log(
        "The first-page animation waits for onboarding/tour and visibility, leaves Output and Selection unchanged, uses an expiring header Notice, stops on addition, and respects reduced motion and enlarged mobile text.",
      )
    } catch (error) {
      if (page) context.diagnostic((await page.locator("[role=alert], .footnote").allTextContents()).join("\n"))
      throw error
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)

test("Offline assets, scoped startup, and updates preserve a compatible workspace", { timeout: 180000 }, async () => {
  const temporary = resolvePath("../.local/tmp/web")
  await mkdir(temporary, { recursive: true })
  const outDir = await mkdtemp(join(temporary, "offline-"))
  let server, browser
  let finishInstall
  const installation = new Promise((resolve) => {
    finishInstall = resolve
  })
  try {
    const previous = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = "production"
      await build({ base: "/composer/", build: { outDir, emptyOutDir: true }, logLevel: "warn" })
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
    const worker = await readFile(join(outDir, "sw.js"), "utf8")
    assert.deepEqual(await readFile(join(outDir, "demo.pdf")), await readFile("test/fixtures/demo.pdf"))
    let paused = false,
      release = "initial",
      incompatible = false
    server = await preview({
      base: "/composer/",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "offline-release-test",
          configurePreviewServer(value) {
            value.middlewares.use((request, response, next) => {
              if (request.url === "/composer/sw.js") {
                response.setHeader("Content-Type", "text/javascript")
                response.setHeader("Cache-Control", "no-store")
                response.end(
                  `const activate = self.skipWaiting.bind(self);
                     self.skipWaiting = async () => {
                       await new Promise((resolve) => setTimeout(resolve, 500));
                       return activate();
                     };\n` + worker.replace(/const VERSION = '[^']+';/, `const VERSION = '${release}';`),
                )
              } else if (paused && request.url === "/composer/notices/svelte.txt") {
                void installation.then(next)
              } else if (incompatible && request.url === "/composer/processor.mjs") {
                response.setHeader("Content-Type", "text/javascript")
                response.end("throw new Error('incompatible processor');")
              } else next()
            })
          },
        },
      ],
    })
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    const url = server.resolvedUrls.local[0]
    await checkMobile(browser, url)
    const foreignCache = `mainz:${new URL("/elsewhere/", url).href}:other`
    paused = true
    await page.goto(url)
    const identifier = page.locator(".footnote > time")
    // Wider font metrics reproduce the enlarged landing layout failure.
    await identifier.evaluate((element) => {
      element.style.fontFamily = '"DejaVu Sans", sans-serif'
    })
    const buildId = await identifier.textContent()
    assert.match(buildId, /^\d{4}-\d{4}-\d{4}-\d{4}$/)
    assert.equal(await identifier.getAttribute("aria-label"), `Build ${buildId}`)
    assert.match(
      await identifier.getAttribute("title"),
      /^Build ID: Europe\/Istanbul · Built \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \(UTC\)/,
    )
    const localBuild = new Date(Date.parse(await identifier.getAttribute("datetime")) + 3 * 60 * 60 * 1000)
      .toISOString()
      .replace(/\D/g, "")
    assert.equal(
      buildId,
      `${localBuild.slice(0, 4)}-${localBuild.slice(4, 8)}-${localBuild.slice(8, 12)}-${localBuild.slice(12, 16)}`,
    )
    await page.getByText("Installing offline application…", { exact: true }).waitFor()
    const installingPage = await context.newPage()
    await installingPage.goto(`${url}?demo`)
    const feedback = installingPage.getByText("Demo workspace ready.", { exact: true })
    const offline = installingPage.getByText("Installing offline application…", {
      exact: true,
    })
    await feedback.waitFor()
    await offline.waitFor()
    for (const [width, text, colorScheme] of [
      [1440, "100%", "light"],
      [839, "100%", "dark"],
      [320, "200%", "dark"],
      [390, "200%", "light"],
      [768, "200%", "dark"],
    ]) {
      for (const view of [page, installingPage]) {
        await view.setViewportSize({ width, height: 900 })
        await view.emulateMedia({ colorScheme, reducedMotion: "reduce" })
        await view.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      }
      assert.equal(await identifier.isVisible(), true)
      assert.equal(
        await identifier.evaluate((element) => {
          const range = document.createRange()
          range.selectNodeContents(element)
          const bounds = range.getBoundingClientRect()
          const footer = element.closest("footer").getBoundingClientRect()
          return Math.abs(bounds.x + bounds.width / 2 - footer.x - footer.width / 2) < 1
        }),
        true,
        "The landing Build ID stays at the bottom center",
      )
      const messageBox = await feedback.boundingBox(),
        offlineBox = await offline.boundingBox()
      assert.ok(messageBox.y + messageBox.height <= offlineBox.y)
      assert.ok(
        Math.abs(messageBox.x + messageBox.width / 2 - offlineBox.x - offlineBox.width / 2) < 1,
        "Offline installation and operation feedback share a centered column",
      )
      await checkStatus(installingPage)
    }
    await installingPage.close()
    paused = false
    finishInstall()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
      timeout: 60000,
    })
    const initialCaches = await page.evaluate(() => caches.keys())
    assert.equal(initialCaches.length, 1)
    assert.ok(initialCaches[0].startsWith("mainz:"))
    assert.match(initialCaches[0], /\/composer\/:initial$/)
    const installed = page.getByText("PDF Composer is ready for offline use.", { exact: true })
    await installed.waitFor()
    assert.equal(await page.getByRole("banner").getByRole("status").count(), 1)
    const installedBox = await installed.boundingBox(),
      landingBox = await page.locator(".drop-zone").boundingBox()
    assert.ok(installedBox.y + installedBox.height <= landingBox.y)
    await installed.waitFor({ state: "detached", timeout: 15000 })
    await page.evaluate(() => localStorage.setItem("mainz:onboarding", "19"))
    await context.setOffline(true)
    const demo = await context.newPage()
    await demo.goto(`${url}?demo`)
    await demo.waitForFunction(() => document.querySelector(".input-current")?.textContent === "demo.pdf", null, {
      timeout: 60000,
    })
    await demo.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    )
    assert.equal(await demo.locator(".offline").count(), 0)
    assert.equal(await demo.locator(".footnote > time").textContent(), buildId)
    assert.equal(await demo.locator(".status-input").textContent(), "demo.pdf")
    assert.equal(await demo.locator(".composition-totals strong").textContent(), "6 PDF pages")
    assert.equal(await demo.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true }).count(), 0)
    await demo.locator(".selection-panel").getByRole("tab", { name: "Style", exact: true }).click()
    await demo.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    await demo.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    const demoSaved = demo.waitForEvent("download")
    await demo.locator(".composition-output").getByRole("button", { name: "Download", exact: true }).click()
    const demoArtifact = await demoSaved
    assert.equal(await demoArtifact.failure(), null)
    assert.match((await readFile(await demoArtifact.path())).subarray(0, 8).toString(), /^%PDF-/)
    await demo.close()
    console.log("The bundled production demo opens, styles and downloads offline under /composer/.")
    await page.goto(`${url}?reset`)
    await page.waitForURL(url)
    assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), null)
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Offline.pdf", mimeType: "application/pdf", buffer: fixture() })
    await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "Offline.pdf", null, {
      timeout: 60000,
    })
    await page.getByRole("button", { name: "Skip", exact: true }).click()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.waitForFunction(() => !document.querySelector(".output-status[aria-hidden=false]"))
    const saved = page.waitForEvent("download")
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const artifact = await saved
    assert.equal(await artifact.failure(), null)
    assert.match((await readFile(await artifact.path())).subarray(0, 8).toString(), /^%PDF-/)
    const cachedURLs = await page.evaluate(async () =>
      (await (await caches.open((await caches.keys())[0])).keys()).map((request) => request.url),
    )
    assert.ok(cachedURLs.length > 100)
    assert.ok(cachedURLs.every((path) => path.startsWith(new URL(url).origin + "/composer/")))
    assert.ok(cachedURLs.includes(new URL("demo.pdf", url).href))
    assert.ok(cachedURLs.every((path) => !/Offline\.pdf|blob:/.test(path)))
    await context.setOffline(false)
    await page.evaluate(async (name) => {
      await caches.open(name)
    }, foreignCache)
    release = "next"
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
    const update = page.getByRole("button", { name: "Update application", exact: true })
    await update.waitFor({ timeout: 60000 })
    const updateNotice = page.getByRole("banner").getByRole("status")
    await page.waitForTimeout(5500)
    assert.equal(await updateNotice.isVisible(), true)
    assert.match(
      await updateNotice.textContent(),
      /An application update is ready\. Download and close your PDF before updating\./,
    )
    await updateNotice.waitFor({ state: "detached", timeout: 15000 })
    assert.equal(await update.isVisible(), true)
    assert.equal(await update.isDisabled(), true)
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages")
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#884488")
    await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
    await update.waitFor()
    assert.equal(await update.isEnabled(), true)
    const other = await context.newPage()
    await other.goto(url)
    await update.click()
    await page.getByText("Close other PDF Composer tabs before updating.", { exact: true }).waitFor()
    assert.notEqual(
      await page.locator(".error-banner").evaluate((element) => getComputedStyle(element).color),
      await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
    )
    assert.equal(await page.locator(".drop-zone input[type=file]").isEnabled(), true)
    assert.ok((await page.evaluate(() => caches.keys())).some((name) => name.endsWith(":initial")))
    await other.close()
    const reloaded = page.waitForEvent("load")
    await update.click()
    const opening = page.locator(".drop-zone input[type=file]")
    assert.equal(await opening.isDisabled(), true, "Opening waits for application activation")
    await opening.setInputFiles({
      name: "During update.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    })
    assert.equal(await page.locator(".composer").count(), 0)
    assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).count(), 0)
    await reloaded
    assert.equal(await opening.isEnabled(), true)
    assert.equal(await page.locator(".composer").count(), 0)
    await page.waitForFunction(async () => {
      const names = await caches.keys()
      return names.length === 2 && names.some((name) => name.endsWith(":next"))
    })
    assert.deepEqual(
      (await page.evaluate(() => caches.keys())).toSorted(),
      [foreignCache, `mainz:${url}:next`].toSorted(),
    )
    await page.evaluate((name) => caches.delete(name), foreignCache)
    await page.waitForFunction(() => !document.querySelector(".error-banner")?.textContent.includes("Close other"))
    incompatible = true
    release = "broken"
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      const completed = new Promise((resolve, reject) => {
        registration.addEventListener(
          "updatefound",
          () => {
            const installing = registration.installing
            installing.addEventListener("statechange", () => {
              if (installing.state === "redundant") resolve()
              if (installing.state === "activated") reject(new Error("Incompatible update activated"))
            })
          },
          { once: true },
        )
      })
      await registration.update()
      await completed
    })
    await page
      .getByText("Offline installation failed. The current application is retained.", {
        exact: true,
      })
      .waitFor()
    assert.notEqual(
      await page.locator(".error-banner").evaluate((element) => getComputedStyle(element).color),
      await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
    )
    assert.ok((await page.evaluate(() => caches.keys())).every((name) => name.endsWith(":next")))
    await context.setOffline(true)
    await page.reload()
    assert.equal(
      await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).isVisible(),
      true,
    )
    assert.deepEqual(
      await page.evaluate(async () =>
        (await document.fonts.load('500 32px "EB Garamond"', "PDF Composer Select pages and style prepared PDFs.")).map(
          (font) => font.status,
        ),
      ),
      ["loaded"],
      "Landing headings retain the embedded font offline under the application scope",
    )
    const fontLicense = await page.evaluate(async () => {
      const response = await fetch(new URL("fonts/eb-garamond.txt", document.baseURI))
      return { status: response.status, text: await response.text() }
    })
    assert.equal(fontLicense.status, 200)
    assert.match(fontLicense.text, /SIL OPEN FONT LICENSE Version 1\.1/)
    assert.equal(await page.locator(".error-banner").count(), 0)
  } finally {
    finishInstall()
    await browser?.close()
    if (server)
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
    await rm(outDir, { recursive: true, force: true })
  }
})
