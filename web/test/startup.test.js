// Checks opening, preview loading, assets, and offline updates.

import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import test, { after } from "node:test"
import { serve } from "./server.ts"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve as resolvePath } from "node:path"
import { build, preview } from "vite"
import { chromium, devices } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { checkGeometry, checkStatus, createServer, trackWorkers, fixture, tab, pixel, gridPage } from "./browser.js"

let compiled

function production() {
  return (compiled ??= (async () => {
    const temporary = resolvePath("../.local/tmp/web")
    await mkdir(temporary, { recursive: true })
    const outDir = await mkdtemp(join(temporary, "production-"))
    const previous = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = "production"
      await build({ base: "/composer/", build: { outDir, emptyOutDir: true }, logLevel: "warn" })
      return outDir
    } catch (error) {
      await rm(outDir, { recursive: true, force: true })
      throw error
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })())
}

after(async () => {
  const outDir = await compiled
  if (outDir) await rm(outDir, { recursive: true, force: true })
})

async function checkMobile(browser, url) {
  for (const [width, text, colorScheme] of [
    [320, "200%", "dark"],
    [768, "100%", "light"],
  ]) {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width, height: 900 },
      colorScheme,
      reducedMotion: "reduce",
    })
    try {
      const page = await context.newPage()
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:installation", "seen")
      })
      await page.goto(`${url}?demo=empty`)
      await page.getByText("Demo workspace ready.", { exact: true }).waitFor()
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const views = page.getByRole("navigation", { name: "Workspace view", exact: true })
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
        "Mobile view labels remain complete at enlarged text sizes",
      )
      await input.getByLabel("Page selection", { exact: true }).fill("2,3")
      await input.getByRole("button", { name: "Add to Output", exact: true }).tap()
      assert.equal(await output.locator(".output-state strong").textContent(), "2 pages")
      await tab(input, "Style")
      const profile = input.getByRole("combobox", { name: "Style profile", exact: true })
      await profile.selectOption("inkjet")
      await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
      const pattern = input.locator('.style-object[aria-label="Pattern"]')
      await checkGeometry(pattern)
      assert.equal(
        await pattern
          .locator(".quartet-caption > span, .quartet-text > span:not([aria-hidden])")
          .evaluateAll((labels) =>
            labels.every(
              (element) =>
                element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).fontSize) * 1.7,
            ),
          ),
        true,
        "Quartet captions and values stay on one line",
      )
      await pattern.getByLabel("Edit Fill", { exact: true }).tap()
      const editor = pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true })
      assert.deepEqual(
        await editor.evaluate((element) => {
          const style = getComputedStyle(element)
          const canvas = document.createElement("canvas").getContext("2d")
          canvas.font = style.font
          const available =
            element.getBoundingClientRect().width -
            parseFloat(style.paddingLeft) -
            parseFloat(style.paddingRight) -
            parseFloat(style.borderLeftWidth) -
            parseFloat(style.borderRightWidth)
          const group = element.closest(".style-object")
          const selected = group
            .querySelector('[aria-expanded="true"]')
            .closest(".quartet-property")
            .getBoundingClientRect()
          const dock = group.querySelector(".quartet-dock").getBoundingClientRect()
          const gap = parseFloat(getComputedStyle(group.querySelector(".quartet-fields")).rowGap)
          return {
            colorFits: canvas.measureText(element.value).width <= available,
            dockBelow: dock.y >= selected.bottom && dock.y - selected.bottom <= gap * 3 + 1,
          }
        }),
        { colorFits: true, dockBelow: true },
      )
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await checkStatus(page)
      await views.getByRole("button", { name: "Output", exact: true }).tap()
      await tab(output, "Page")
      await aligned(output)
      await zoom(output, "Reset zoom")
      await zoom(output, "Zoom in")
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%")
      await zoom(output, "Reset zoom")
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      const saved = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).tap()
      const artifact = await saved
      assert.equal(await artifact.failure(), null)
      assert.match((await readFile(await artifact.path())).subarray(0, 8).toString(), /^%PDF-/)
      await views.getByRole("button", { name: "Input", exact: true }).tap()
      assert.equal(await profile.inputValue(), "inkjet")
    } finally {
      await context.close()
    }
  }
}

test(
  "Landing file actions keep paired widths and padding with theme-aware PDF and JSON icons",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await page.goto(server.resolvedUrls.local[0])
      for (const [width, text, family = ""] of [
        [1920, "100%"],
        [1440, "100%"],
        [375, "100%"],
        [768, "100%"],
        [390, "100%"],
        [428, "100%"],
        [320, "200%"],
        [320, "200%", "DejaVu Sans"],
      ]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        await page.evaluate((value) => (document.body.style.fontFamily = value), family)
        for (const colorScheme of ["light", "dark"]) {
          await page.emulateMedia({ colorScheme })
          const actions = await page.locator(".welcome .buttons > label").evaluateAll((labels) =>
            labels.map((element) => {
              const box = element.getBoundingClientRect(),
                style = getComputedStyle(element),
                icon = element.querySelector("svg").getBoundingClientRect()
              const label = document.createRange()
              label.selectNodeContents(element.querySelector("span"))
              const words = label.getBoundingClientRect()
              return {
                width: box.width,
                height: box.height,
                top: box.top,
                center: box.top + box.height / 2,
                padding: [
                  style.paddingBlockStart,
                  style.paddingBlockEnd,
                  style.paddingInlineStart,
                  style.paddingInlineEnd,
                ],
                icon: [icon.width, icon.height],
                lines: label.getClientRects().length,
                fits:
                  words.x >= box.x + parseFloat(style.paddingInlineStart) - 1 &&
                  words.right <= box.right - parseFloat(style.paddingInlineEnd) + 1,
              }
            }),
          )
          assert.ok(Math.abs(actions[0].width - actions[1].width) < 1)
          assert.ok(
            actions.every((action) => action.lines === 1 && action.fits),
            JSON.stringify({ width, text, family, actions }),
          )
          assert.ok(Math.abs(actions[1].height - actions[0].height - 1) < 0.5)
          assert.ok(
            actions.every(
              (action) =>
                action.padding[0] === action.padding[1] &&
                action.padding[2] === action.padding[3] &&
                action.icon.every((size) => size >= 24),
            ),
          )
          if (text === "100%") assert.ok(Math.abs(actions[0].center - actions[1].center) < 1)
          if (width === 1920) assert.ok(actions.every((action) => action.width >= 120))
          if (width === 428) {
            const spacing = await page.locator(".drop-zone").evaluate((element) => {
              const box = element.getBoundingClientRect()
              const buttons = element.querySelector(".buttons").getBoundingClientRect()
              const style = getComputedStyle(element)
              return {
                padding: parseFloat(style.paddingInlineStart),
                width: box.width,
                start: buttons.left - box.left,
                end: box.right - buttons.right,
              }
            })
            assert.ok(spacing.padding <= 0.027 * width, JSON.stringify(spacing))
            assert.ok(Math.abs(spacing.start - spacing.end) < 1 && spacing.start <= spacing.padding + 1)
          }
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        }
      }
    } finally {
      await browser.close()
    }
  },
)

test("Landing compact headings fit phones and tablets and logos follow theme changes and reloads", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true })
    await page.goto(server.resolvedUrls.local[0])
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.title(), "PDF Composer")
    assert.equal(await page.locator(".brand-title").innerText(), "PDF Composer")
    const heading = page.getByRole("heading", { level: 1 })
    const copy = page.getByText("Select and repeat PDF pages. Style prepared PDFs for your printer.", { exact: true })
    for (const [width, height] of [
      [320, 568],
      [375, 667],
      [390, 844],
      [414, 896],
      [430, 932],
      [440, 763],
      [480, 800],
      [481, 800],
      [640, 960],
    ]) {
      await page.setViewportSize({ width, height })
      assert.equal(await heading.innerText(), "Select & style prepared PDFs.")
      assert.equal(await copy.isVisible(), true)
      for (const text of ["100%", "200%"]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        if (text === "100%")
          assert.ok(
            await heading.evaluate(
              (element) =>
                Math.abs(element.getBoundingClientRect().height - parseFloat(getComputedStyle(element).lineHeight)) < 1,
            ),
            `${width}px: the phone heading fits one line`,
          )
        const layout = await page.evaluate(() => {
          const mark = document.querySelector(".hero-mark").getBoundingClientRect()
          const product = document.querySelector(".brand-title")
          const purpose = document.querySelector(".welcome h1")
          const area = document.querySelector(".drop-zone")
          const frame = area.getBoundingClientRect()
          return {
            mark: mark.width,
            gap: product.getBoundingClientRect().y - mark.bottom,
            inset: mark.y - frame.y,
            left: frame.x,
            right: document.querySelector("#app").getBoundingClientRect().right - frame.right,
            top: frame.y - document.querySelector(".header-inner").getBoundingClientRect().bottom,
            headerStart: frame.x - document.querySelector(".header-inner").getBoundingClientRect().x,
            headerEnd: frame.right - document.querySelector(".header-inner").getBoundingClientRect().right,
            product: parseFloat(getComputedStyle(product).fontSize),
            heading: parseFloat(getComputedStyle(purpose).fontSize),
          }
        })
        assert.ok(layout.mark >= 160, `${width}px: the logo has room above the text`)
        assert.ok(layout.gap >= 16 && layout.inset >= 18, `${width}px: the logo retains its surrounding space`)
        if (width > 375) {
          assert.ok(
            Math.abs(layout.left - layout.right) < 1 && Math.abs(layout.left - layout.top) < 1,
            `${width}px: mobile landing margins are equal`,
          )
          assert.ok(
            Math.abs(layout.headerStart) < 1 && Math.abs(layout.headerEnd) < 1,
            `${width}px: the header aligns with the landing border`,
          )
          if (text === "100%") assert.ok(layout.left >= 40, `${width}px: margins retain the largest existing gap`)
        } else if (text === "100%") assert.equal(layout.left, 28, "SE retains its compact margins")
        if (width <= 480) {
          assert.ok(layout.gap >= 28, `${width}px: more space separates the logo and product name`)
          if (text === "100%") {
            assert.ok(layout.mark >= 190, `${width}px: small phones use a larger logo`)
            assert.ok(Math.abs(layout.inset - 25) < 1, `${width}px: more space precedes the logo`)
          }
        }
        assert.ok(
          layout.product >= (text === "100%" ? 24 : 48),
          `${width}px: the product name retains a readable minimum independently of the purpose heading`,
        )
        if (width <= 390) {
          if (text === "100%") assert.ok(layout.heading <= 26, `${width}px: phone headings use smaller type`)
        }
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    }
    for (const [width, height] of [
      [768, 1024],
      [810, 1080],
      [820, 1180],
      [1024, 768],
      [1080, 810],
      [1180, 820],
      [1194, 834],
    ]) {
      await page.setViewportSize({ width, height })
      assert.equal(await heading.innerText(), "Select & style prepared PDFs.")
      assert.ok(
        await heading.evaluate(
          (element) =>
            Math.abs(element.getBoundingClientRect().height - parseFloat(getComputedStyle(element).lineHeight)) < 1,
        ),
        `${width}px: the tablet heading fits one line`,
      )
      const layout = await page.evaluate(() => {
        const area = document.querySelector(".drop-zone").getBoundingClientRect()
        const header = document.querySelector(".header-inner").getBoundingClientRect()
        return {
          inset: area.x,
          right: document.querySelector("#app").getBoundingClientRect().right - area.right,
          top: area.y - header.bottom,
          start: area.x - header.x,
          end: area.right - header.right,
        }
      })
      assert.ok(layout.inset >= 40, `${width}px: tablets have wider outer margins`)
      assert.ok(Math.abs(layout.start) < 1 && Math.abs(layout.end) < 1, `${width}px: header and landing edges align`)
      assert.ok(
        Math.abs(layout.inset - layout.right) < 1 && Math.abs(layout.inset - layout.top) < 1,
        `${width}px: tablet landing margins are equal`,
      )
    }
    await page.setViewportSize({ width: 1440, height: 1100 })
    assert.equal(await heading.innerText(), "Select pages and style prepared PDFs.")
    assert.equal(await copy.isVisible(), true)

    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const width of [320, 390, 430, 768, 1475]) {
        await page.setViewportSize({ width, height: width === 1475 ? 776 : 1024 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const typography = await page.locator(".welcome").evaluate((element) => {
            const product = getComputedStyle(element.querySelector(".brand-title"))
            const purpose = getComputedStyle(element.querySelector("h1"))
            const paragraph = element.querySelector("p:not(.brand-title)")
            const context = document.createElement("canvas").getContext("2d")
            const luminance = (color) => {
              context.fillStyle = color
              context.fillRect(0, 0, 1, 1)
              const channels = [...context.getImageData(0, 0, 1, 1).data].slice(0, 3).map((value) => {
                const channel = value / 255
                return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
              })
              return channels.reduce((total, channel, index) => total + channel * [0.2126, 0.7152, 0.0722][index], 0)
            }
            const paper = luminance(getComputedStyle(document.documentElement).backgroundColor)
            const contrast = (color) => {
              const foreground = luminance(color)
              return (Math.max(paper, foreground) + 0.05) / (Math.min(paper, foreground) + 0.05)
            }
            const range = document.createRange()
            range.selectNodeContents(paragraph)
            return {
              product: parseFloat(product.fontSize),
              heading: parseFloat(purpose.fontSize),
              productContrast: contrast(product.color),
              headingContrast: contrast(purpose.color),
              copyContrast: contrast(getComputedStyle(paragraph).color),
              lines: range.getClientRects().length,
              fits: document.documentElement.scrollWidth <= innerWidth,
            }
          })
          assert.ok(typography.product >= (text === "100%" ? 24 : 48), "The product name retains a readable minimum")
          assert.ok(typography.headingContrast >= 7, "The purpose heading retains strong contrast")
          assert.ok(
            typography.headingContrast < typography.productContrast,
            "The product name leads the purpose heading",
          )
          assert.ok(
            typography.headingContrast > typography.copyContrast,
            "The purpose heading leads the supporting copy",
          )
          assert.equal(typography.fits, true, `${width}px: landing text stays within the viewport at ${text}`)
          if (width === 1475 && text === "100%") {
            assert.ok(typography.product >= 0.9 * typography.heading, "The desktop product name retains its prominence")
            assert.equal(typography.lines, 1, "Wide desktop supporting copy fits one line")
          }
          const link = await page.getByRole("link", { name: "prepared", exact: true }).screenshot()
          const clearance = await page.evaluate(
            async ({ data, dark }) => {
              const bitmap = new Image()
              bitmap.src = `data:image/png;base64,${data}`
              await bitmap.decode()
              const canvas = document.createElement("canvas")
              canvas.width = bitmap.width
              canvas.height = bitmap.height
              const context = canvas.getContext("2d")
              context.drawImage(bitmap, 0, 0)
              const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
              let glyph = -1,
                dots = Infinity
              for (let y = 0; y < canvas.height; y++)
                for (let x = 0; x < canvas.width; x++) {
                  const offset = 4 * (y * canvas.width + x)
                  const maximum = Math.max(...pixels.slice(offset, offset + 3))
                  const minimum = Math.min(...pixels.slice(offset, offset + 3))
                  if (maximum - minimum > 20) glyph = Math.max(glyph, y)
                  else if (maximum - minimum < 4 && (dark ? minimum >= 128 : maximum <= 100)) dots = Math.min(dots, y)
                }
              return glyph >= 0 && Number.isFinite(dots) ? dots - glyph - 1 : -1
            },
            { data: link.toString("base64"), dark: colorScheme === "dark" },
          )
          assert.ok(clearance >= 2, `${width}px at ${text}: dotted underline leaves ${clearance}px below descenders`)
        }
      }
    }
    await page.setViewportSize({ width: 768, height: 1024 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    const colors = { light: [128, 0, 128], dark: [229, 195, 156] }
    const checkLogos = async (theme) => {
      await page.waitForFunction(
        (pressed) => document.querySelector(".theme")?.getAttribute("aria-pressed") === pressed,
        String(theme === "dark"),
      )
      assert.equal(
        await page.getByRole("button", { name: "Dark theme", exact: true }).getAttribute("aria-pressed"),
        String(theme === "dark"),
      )
      for (const selector of [".brand .logo", ".hero-mark .logo"]) {
        const screenshot = await page.locator(selector).screenshot()
        const color = await page.evaluate(async (data) => {
          const bitmap = new Image()
          bitmap.src = `data:image/png;base64,${data}`
          await bitmap.decode()
          const canvas = document.createElement("canvas")
          canvas.width = bitmap.width
          canvas.height = bitmap.height
          const context = canvas.getContext("2d")
          context.drawImage(bitmap, 0, 0)
          return Array.from(
            context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data,
          )
        }, screenshot.toString("base64"))
        assert.ok(
          colors[theme].every((value, index) => Math.abs(value - color[index]) <= 2),
          `${selector}: ${theme}`,
        )
      }
    }
    for (const system of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: system })
      await page.evaluate(() => localStorage.removeItem("mainz:theme"))
      await page.reload()
      await checkLogos(system)
      await page.emulateMedia({ colorScheme: system === "light" ? "dark" : "light" })
      await checkLogos(system === "light" ? "dark" : "light")
      await page.emulateMedia({ colorScheme: system })
      await checkLogos(system)
      await page.getByRole("button", { name: "Dark theme" }).press("Enter")
      await checkLogos(system === "light" ? "dark" : "light")
      await page.getByRole("button", { name: "Dark theme" }).click()
      await page.emulateMedia({ colorScheme: system === "light" ? "dark" : "light" })
      await checkLogos(system)
      await page.reload()
      await checkLogos(system)
    }
  } finally {
    await browser?.close()
  }
})

test("Landing top spacing stays bounded on wide coarse-pointer screens", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true })
    await page.goto(server.resolvedUrls.local[0])
    await page.evaluate(() => document.fonts.ready)
    assert.equal(await page.evaluate(() => matchMedia("(any-pointer: coarse)").matches), true)
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme })
      for (const [width, height] of [
        [1194, 834],
        [1920, 1254],
        [2264, 1341],
        [1194, 834],
      ]) {
        await page.setViewportSize({ width, height })
        const layout = await page.evaluate(() => {
          const area = document.querySelector(".drop-zone").getBoundingClientRect()
          const header = document.querySelector(".header-inner").getBoundingClientRect()
          return {
            top: area.y - header.bottom,
            left: area.x,
            right: document.querySelector("#app").getBoundingClientRect().right - area.right,
            start: area.x - header.x,
            end: area.right - header.right,
          }
        })
        assert.ok(Math.abs(layout.top - 56) < 1, `${width}px: top spacing stays at the tablet reference`)
        assert.ok(Math.abs(layout.left - layout.right) < 1, `${width}px: the frame stays centered`)
        assert.ok(Math.abs(layout.start) < 1 && Math.abs(layout.end) < 1, `${width}px: header and frame edges align`)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      }
    }
  } finally {
    await browser?.close()
  }
})

test("Logo clicks choose Home, animation, or examples and retain landing parallax", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: "no-preference",
    })
    await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded" })
    const mark = page.locator(".hero-mark")
    const logo = mark.locator(".logo")
    await mark.waitFor()
    const corner = async () => {
      const area = await page.locator(".drop-zone").boundingBox()
      await page.mouse.move(area.x + area.width - 8, area.y + area.height - 8)
    }
    await corner()
    assert.equal(
      await logo.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
      0,
      "Pointer movement waits for the opening animation",
    )
    await mark.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
      const replay = page.getByRole("link", { name: "PDF Composer home", exact: true })
      await replay.dblclick()
      await page.waitForFunction(
        () => document.querySelector(".hero-mark")?.getAnimations()[0]?.playState === "running",
      )
      assert.equal(
        await mark.evaluate((element) => element.getAnimations()[0]?.playState),
        "running",
        `${theme}: the header logo restarts the entry animation`,
      )
      await mark.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
      await page.mouse.move(10, 10)
      await corner()
      await page.waitForFunction(
        () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".hero-mark .logo")).transform).m41 > 10,
      )
      const position = await logo.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform)
        return { x: matrix.m41, y: matrix.m42 }
      })
      assert.ok(position.x <= 16 && position.y <= 12, `${theme}: parallax stays bounded`)
      await page.mouse.move(10, 10)
      await page.waitForFunction(() => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".hero-mark .logo")).transform)
        return Math.abs(matrix.m41) < 0.01 && Math.abs(matrix.m42) < 0.01
      })
      await page.mouse.move(1300, 30)
      assert.ok(
        Math.abs(await logo.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)) <
          0.01,
        "Pointer movement outside the framed area leaves the logo centered",
      )
    }
    await corner()
    await page.emulateMedia({ reducedMotion: "reduce" })
    assert.equal(await logo.evaluate((element) => getComputedStyle(element).transform), "none")
    await page.getByRole("link", { name: "PDF Composer home", exact: true }).dblclick()
    assert.equal(await mark.evaluate((element) => element.getAnimations().length), 0)
    const touch = await browser.newPage({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "no-preference",
    })
    await touch.goto(server.resolvedUrls.local[0])
    await touch
      .locator(".hero-mark")
      .evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)))
    const touchLogo = touch.getByRole("link", { name: "PDF Composer home", exact: true })
    await touchLogo.tap()
    await touchLogo.tap()
    await touch.waitForFunction(() => document.querySelector(".hero-mark")?.getAnimations()[0]?.playState === "running")
    assert.equal(
      await touch.locator(".hero-mark").evaluate((element) => element.getAnimations()[0]?.playState),
      "running",
    )
    await touch.locator(".hero-mark").dispatchEvent("pointermove", {
      pointerType: "touch",
      clientX: 350,
      clientY: 500,
      bubbles: true,
    })
    assert.equal(
      await touch.locator(".hero-mark .logo").evaluate((element) => getComputedStyle(element).transform),
      "none",
    )
    for (const [target, clicks] of [
      [page, 3],
      [touch, 4],
      [page, 6],
    ]) {
      await target.reload()
      const trigger = target.getByRole("link", { name: "PDF Composer home", exact: true })
      for (let click = 0; click < clicks; click++) await trigger[target === touch ? "tap" : "click"]()
      const examples = target.getByRole("dialog", { name: "Explore the app", exact: true })
      await examples.waitFor()
      assert.deepEqual(await examples.locator("a strong").allTextContents(), [
        "Single demo",
        "Large demo",
        "TOC demo",
        "TOCs demo",
        "Recipe demo",
        "Empty demo",
      ])
      assert.equal(await examples.getByRole("link").nth(1).getAttribute("href"), "?demo=grid")
      await examples.getByRole("button", { name: "Close examples", exact: true }).click()
    }
    await page.goto(server.resolvedUrls.local[0] + "?demo")
    await page.locator(".input-current").waitFor()
    assert.equal(await page.getByRole("link", { name: "PDF Composer home" }).count(), 1)
    const home = page.getByRole("link", { name: "PDF Composer home", exact: true })
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await home.dblclick()
    await page.waitForFunction(
      () => document.querySelector(".brand .logo")?.getAnimations()[0]?.playState === "running",
    )
    assert.equal(new URL(page.url()).search, "?demo", "Double-click preserves the workspace")
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "8 pages")
    await home.click()
    await page.locator(".drop-zone").waitFor()
    assert.equal(new URL(page.url()).search, "", "One click opens Home")
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".input-current").waitFor()
    await home.press("Enter")
    await page.locator(".drop-zone").waitFor()
    assert.equal(new URL(page.url()).search, "", "Keyboard activation opens Home")
  } finally {
    await browser?.close()
  }
})

test("PDF opening and composition work over non-secure HTTP", { timeout: 60000 }, async () => {
  const server = await createServer({
    server: { port: 0, host: "127.0.0.1", allowedHosts: ["mainz.test"] },
  })
  let browser
  try {
    await server.listen()
    browser = await launch(chromium, {
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      args: ["--host-resolver-rules=MAP mainz.test 127.0.0.1"],
    })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.goto(server.resolvedUrls.local[0].replace("127.0.0.1", "mainz.test") + "?demo")
    assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof crypto.randomUUID]), [false, "undefined"])
    await page.locator(".input-current").waitFor()
    assert.equal(await page.locator(".input-current").textContent(), "demo.pdf")
    await page.waitForFunction(
      () => document.querySelector(".composition-output .composition-totals strong")?.textContent === "8 pages",
    )
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "8 pages")
    assert.equal(await page.getByRole("alert").count(), 0)
    const output = page.locator(".composition-output")
    await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "9 pages")
    const saved = page.waitForEvent("download")
    await output.getByRole("button", { name: "Download", exact: true }).click()
    const download = await saved
    assert.equal(await download.failure(), null)
    const bytes = await readFile(await download.path())
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-")
  } finally {
    await browser?.close()
    await server.close()
  }
})

test(
  "Ordinary Inputs release validation workers while preview and Download stay available",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.addInitScript(trackWorkers)
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      for (const name of ["First.pdf", "Second.pdf"]) {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name, mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
        await input.locator(".input-current").filter({ hasText: name }).waitFor()
        await page.locator(".composer:not([inert])").waitFor()
        assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).count(), 0)
        assert.equal(
          await page.evaluate(
            () =>
              window.workers.filter((worker) => worker.url.includes("processor.worker") && !worker.terminated).length,
          ),
          0,
          "Ordinary Inputs have no style processing to retain a WASM worker for",
        )
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await input.locator(".thumbnail[aria-busy=false] canvas").waitFor()
        assert.ok(await input.locator(".thumbnail canvas").evaluate((canvas) => canvas.width > 0))
      }
      assert.equal(await output.locator(".composition-totals strong").textContent(), "2 pages")
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      assert.equal(await (await pending).failure(), null)
      await page.waitForFunction(() =>
        window.workers.filter((worker) => worker.url.includes("processor.worker")).every((worker) => worker.terminated),
      )
    } finally {
      await browser?.close()
    }
  },
)

test(
  "Multi-file opening recovers from invalid PDFs and cancellation stops the remaining files",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      const bytes = fixture({ prepared: false })
      const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: bytes })
      await page.locator('input[type="file"]').first().setInputFiles(pdf("First.pdf"))
      const input = page.locator(".selection-panel")
      await input.locator(".input-current").filter({ hasText: "First.pdf" }).waitFor()
      await page
        .locator('.selection-panel .input-heading > .file-picker input[type="file"]')
        .setInputFiles([
          { name: "Broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("Not a PDF") },
          pdf("Last.pdf"),
        ])
      await input.locator(".input-current").filter({ hasText: "Last.pdf" }).waitFor()
      await page.locator(".header-feedback .opening-progress").waitFor({ state: "detached" })
      assert.deepEqual(await input.locator(".input-list button[data-source] > span:first-child").allTextContents(), [
        "First.pdf",
        "Last.pdf",
      ])
      assert.equal(await page.getByRole("alert").innerText(), "1 file failed")
      await page.getByRole("alert").getByRole("button").click()
      assert.match(
        await page.getByRole("list", { name: "File errors", exact: true }).innerText(),
        /Could not open Broken\.pdf/,
      )
      await page.evaluate(() => {
        const read = File.prototype.arrayBuffer
        window.readFiles = []
        File.prototype.arrayBuffer = async function () {
          window.readFiles.push(this.name)
          if (this.name === "Cancelled.pdf") await new Promise((resolve) => (window.releaseRead = resolve))
          return read.call(this)
        }
      })
      await input
        .locator('.input-heading > .file-picker input[type="file"]')
        .setInputFiles([
          { name: "Another-broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("Not a PDF") },
          pdf("Cancelled.pdf"),
          pdf("Unopened.pdf"),
        ])
      await page.waitForFunction(() => !!window.releaseRead)
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await input.locator('.input-heading > .file-picker input[type="file"]').setInputFiles(pdf("Retry.pdf"))
      await input.locator(".input-current").filter({ hasText: "Retry.pdf" }).waitFor()
      await page.evaluate(() => window.releaseRead())
      await page.evaluate(() => new Promise(requestAnimationFrame))
      assert.deepEqual(await page.evaluate(() => window.readFiles), [
        "Another-broken.pdf",
        "Cancelled.pdf",
        "Retry.pdf",
      ])
      assert.equal(await input.locator(".input-list button[data-source]").count(), 3)
      assert.equal(await input.locator(".input-current").textContent(), "Retry.pdf")
      assert.equal(await page.getByRole("alert").count(), 0, "An abandoned batch cannot restore stale errors")
    } finally {
      await browser?.close()
    }
  },
)

test("Large failure batches announce a summary and retain every file error", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      window.announcements = []
      new MutationObserver(() => {
        for (const element of document.querySelectorAll('[role="alert"]'))
          if (element.textContent) window.announcements.push(element.textContent)
      }).observe(document, { childList: true, characterData: true, subtree: true })
    })
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({ name: "Initial.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) })
    await page.locator(".input-current").filter({ hasText: "Initial.pdf" }).waitFor()
    const failed = Array.from({ length: 40 }, (_, index) => ({
      name: `${index}-${"long-publication-name-".repeat(6)}.${index < 2 ? "pdf" : "txt"}`,
      mimeType: "application/pdf",
      buffer: Buffer.from("Not a PDF"),
    }))
    await page
      .locator('.selection-panel .input-heading > .file-picker input[type="file"]')
      .setInputFiles([
        ...failed,
        { name: "Ready.pdf", mimeType: "application/pdf", buffer: fixture({ prepared: false }) },
      ])
    await page.locator(".input-current").filter({ hasText: "Ready.pdf" }).waitFor()
    const announcement = page.getByRole("alert")
    await announcement.waitFor()
    assert.ok((await announcement.innerText()).length < 120, "Batch announcements must not include every diagnostic")
    assert.match(await announcement.innerText(), /40 files failed/)
    assert.ok(
      await page.evaluate(() => window.announcements.every((text) => text.length < 120)),
      "Per-file failures must not produce long intermediate announcements",
    )
    const errors = page.getByRole("list", { name: "File errors", exact: true })
    const disclosure = announcement.getByRole("button")
    for (const [width, text, colorScheme] of [
      [320, "100%", "light"],
      [320, "200%", "dark"],
      [390, "200%", "dark"],
      [768, "200%", "light"],
      [1440, "100%", "dark"],
    ]) {
      await page.setViewportSize({ width, height: 900 })
      await page.emulateMedia({ colorScheme })
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
      assert.equal(await errors.isVisible(), false)
      const alignment = await announcement.evaluate((element) => {
        const group = element.closest(".feedback").getBoundingClientRect()
        const header = document.querySelector(".header-inner").getBoundingClientRect()
        return Math.abs(group.x + group.width / 2 - header.x - header.width / 2)
      })
      assert.ok(alignment < 1, `${width}px: aligned batch message`)
      await disclosure.focus()
      await page.keyboard.press("Enter")
      await errors.waitFor()
      const panelBounds = await page.locator(".message-details:popover-open").evaluate((element) => {
        const box = element.getBoundingClientRect()
        return box.x >= 0 && box.right <= innerWidth + 1 && box.y >= 0 && box.bottom <= innerHeight + 1
      })
      assert.ok(
        panelBounds,
        `${width}px, ${text}: Error details fit the viewport outside the header: ${JSON.stringify(await page.locator(".message-details:popover-open").boundingBox())}`,
      )
      const messages = await errors.getByRole("listitem").allTextContents()
      assert.equal(messages.length, failed.length)
      for (const [index, file] of failed.entries()) assert.ok(messages[index].includes(file.name))
      assert.match(messages[0], /Could not open/)
      assert.match(messages[2], /Choose a PDF file/)
      const bounds = await errors.evaluate((element) => ({
        height: element.clientHeight,
        overflow: element.scrollHeight > element.clientHeight,
      }))
      assert.ok(bounds.height <= 360 && bounds.overflow, "Details must scroll within the viewport")
      await errors.focus()
      await page.keyboard.press("End")
      await page.waitForFunction(() => document.querySelector(".message-details ul")?.scrollTop > 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await disclosure.focus()
      await page.keyboard.press("Enter")
    }
    await announcement.getByRole("button").click()
    await page.getByRole("button", { name: "Dismiss error", exact: true }).click()
    assert.equal(await announcement.count(), 0)
    assert.equal(await disclosure.count(), 0)
    assert.equal(await page.locator(".input-current").textContent(), "Ready.pdf")
  } finally {
    await browser?.close()
  }
})

test("The first PDF previews before validation and commits only after success", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  const gates = []
  const release = () => {
    for (const proceed of gates.splice(0)) proceed()
  }
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.route("**/processor.mjs", async (route) => {
      await new Promise((resolve) => gates.push(resolve))
      await route.continue().catch(() => {})
    })
    await page.goto(server.resolvedUrls.local[0])
    // The preview is visible before validation, with the same Grid presentation after commit.
    const bytes = fixture({ count: 33 })
    const input = page.locator(".selection-panel")
    const open = async (name, buffer) => {
      await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer })
      await page.locator(".composer[inert]").waitFor()
      await page.waitForFunction(() => document.querySelector(".selection-panel .page-image canvas")?.width > 0)
      assert.equal(await page.locator(".drop-zone").count(), 0)
      assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "0 pages")
      assert.equal(await page.locator(".composer").getAttribute("aria-busy"), "true")
      assert.equal(await page.locator(".header-feedback .opening-progress").isVisible(), true)
    }
    await open("Cancelled.pdf", bytes)
    await page.locator(".header-feedback .opening-progress .feedback-message p").click()
    for (const key of ["Control+a", "Enter", "+"]) await page.keyboard.press(key)
    assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0)
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "0 pages")
    await page.setViewportSize({ width: 390, height: 1100 })
    await page.emulateMedia({ colorScheme: "dark" })
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await page.getByRole("button", { name: "Cancel", exact: true }).click()
    await page.locator(".drop-zone").waitFor()
    release()
    assert.equal(await page.locator(".composer").count(), 0)
    await page.evaluate(() => document.documentElement.style.removeProperty("font-size"))
    await page.setViewportSize({ width: 2560, height: 1440 })
    await page.emulateMedia({ colorScheme: "light" })
    await open("Invalid.pdf", Buffer.from(bytes.toString().replace('"version":1', '"version":2')))
    release()
    await page.getByRole("alert").waitFor()
    await page.getByRole("alert").getByRole("button").click()
    assert.match(await page.getByRole("list", { name: "File errors", exact: true }).innerText(), /style format/)
    await page.locator(".drop-zone").waitFor()
    assert.equal(await page.locator(".composer").count(), 0)
    await open("Ready.pdf", bytes)
    release()
    await page.locator(".composer:not([inert])").waitFor()
    await input.getByRole("tab", { name: "Style", exact: true }).waitFor()
    assert.equal(await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
    assert.equal(await input.locator(".composition-card").first().isVisible(), true)
    assert.equal(await input.locator(".input-picker .count").innerText(), "1")
    assert.equal(await page.locator(".header-feedback .opening-progress").count(), 0)
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "1 page")
    assert.deepEqual(errors, [])
  } finally {
    release()
    await browser?.close()
  }
})

test("Development assets remain available after a production build", { timeout: 60000 }, async () => {
  const temporary = resolvePath("../.local/tmp/web")
  await mkdir(temporary, { recursive: true })
  const outDir = await mkdtemp(join(temporary, "asset-rebuild-"))
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    page.setDefaultTimeout(10000)
    const url = server.resolvedUrls.local[0]
    await page.goto(`${url}?demo`)
    await page.locator(".input-current").waitFor()
    const previous = process.env.NODE_ENV
    try {
      process.env.NODE_ENV = "production"
      await build({ build: { outDir, emptyOutDir: true }, logLevel: "warn" })
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
    const response = await fetch(`${url}processor.wasm`)
    assert.equal(response.status, 200)
    assert.match(response.headers.get("content-type"), /^application\/wasm/)
    assert.deepEqual(
      [...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)],
      [0, 97, 115, 109],
      "The open development server keeps serving WASM, not the HTML fallback",
    )
    await page.reload()
    await page.locator(".input-current").waitFor()
    assert.equal(await page.locator(".input-current").textContent(), "demo.pdf")
    await page.waitForFunction(
      () => document.querySelector(".composition-output .composition-totals strong")?.textContent === "8 pages",
    )
  } finally {
    await browser?.close()
    await rm(outDir, { recursive: true, force: true })
  }
})

test("Demo composition follows the opened page count", async () => {
  const server = await serve()
  const browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
  try {
    for (const query of ["", "=grid"]) {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.route("**/*.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture({ count: 1 }) }),
      )
      await page.goto(`${server.resolvedUrls.local[0]}?demo${query}`)
      await page.locator(".input-current").waitFor()
      await page
        .locator(".composition-output .composition-totals strong")
        .filter({ hasText: /^1 page$/ })
        .waitFor()
      assert.equal(await page.locator(".composition-output .page-image").count(), 1)
      assert.equal(await page.getByRole("alert").count(), 0)
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test("Demo variants open the maintained Input with populated or empty Output", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [query, pages, selected] of [
      ["", 8, 4],
      ["=empty", 0, 0],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      })
      page.setDefaultTimeout(10000)
      await page.goto(`${server.resolvedUrls.local[0]}?demo${query}`)
      await page.locator(".input-current").waitFor()
      await page.waitForFunction(
        (count) =>
          document.querySelector(".composition-output .composition-totals strong")?.textContent === `${count} pages`,
        pages,
      )
      const input = page.locator(".selection-panel")
      assert.equal(await input.locator(".input-current").textContent(), "demo.pdf")
      assert.equal(await input.locator(".thumbnail").count(), 4)
      assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), selected)
      if (!query) {
        const output = page.locator(".composition-output")
        const order = []
        for (let number = 1; number <= 8; number++) {
          const thumbnail = await gridPage(output, number)
          order.push(
            await thumbnail
              .locator('xpath=ancestor::*[contains(@class, "composition-card")][1]')
              .locator('.page-origin-info .page-details tr:has(th:text-is("Original page")) td')
              .textContent(),
          )
        }
        assert.deepEqual(order, [1, 2, 3, 4, 3, 4, 3, 4].map(String))
        await gridPage(output, 1)
        assert.equal(await input.getByLabel("Page selection", { exact: true }).inputValue(), "1-4")
        await input.getByRole("tab", { name: "Page", exact: true }).click()
        await input.locator(".page-scroll").press("End")
        assert.match(await input.locator(".page-position").textContent(), /4/)
        assert.equal(
          await input.locator(".page-view").evaluate((element) => element.classList.contains("selected")),
          true,
        )
        await input.locator(".page-scroll").press("Home")
        await tab(input, "Grid")
        await output.getByLabel("Page selection", { exact: true }).fill("1")
        for (const button of [
          input.getByRole("button", { name: "Add to Output", exact: true }),
          output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }),
        ])
          assert.equal(await button.locator("svg").evaluate((svg) => getComputedStyle(svg).strokeWidth), "3px")
      }
      const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
      if (query) {
        await welcome.getByRole("button", { name: "Close welcome", exact: true }).click()
        await page.locator(".page-flight:popover-open").waitFor()
        assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0)
        assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "0 pages")
        assert.equal(await input.getByRole("button", { name: "Add to Output", exact: true }).count(), 0)
        const sequence = input.getByLabel("Page selection", { exact: true })
        await sequence.fill("1")
        await sequence.fill("1,")
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme)
          await page.waitForFunction(() => {
            const button = document.querySelector(".selection-panel .transfer")
            return getComputedStyle(button).borderRightColor === getComputedStyle(button.parentElement).borderRightColor
          })
          const borders = await input.locator(".transfer").evaluate((button) => {
            const style = getComputedStyle(button)
            const frame = getComputedStyle(button.parentElement)
            return {
              disabled: button.disabled,
              top: style.borderTop,
              right: style.borderRight,
              bottom: style.borderBottom,
              frame: frame.borderRight,
            }
          })
          assert.equal(borders.disabled, true)
          assert.equal(borders.top, borders.frame, `${theme}: the disabled arrow keeps the selection frame`)
          assert.equal(borders.right, borders.frame)
          assert.equal(borders.bottom, borders.frame)
        }
      } else assert.equal(await welcome.isVisible(), false)
      await tab(input, "Page")
      assert.equal(
        (await input.locator(".inspection-heading .page-number").innerText()).replace(/\s+/g, ""),
        "1/4",
        "The Page counter does not repeat an identical PDF label",
      )
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Unknown demo variants report an error and permit opening a local PDF", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    for (const value of ["missing", "<unknown>"]) {
      await page.goto(`${server.resolvedUrls.local[0]}?demo=${encodeURIComponent(value)}`)
      const error = page.getByRole("alert")
      await error.waitFor()
      assert.ok((await error.innerText()).includes(`Unknown demo: ${value}. Choose a local PDF`))
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Local.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
      await page.locator(".composer[aria-busy=false]").waitFor()
      assert.equal(await page.locator(".input-current").innerText(), "Local.pdf")
    }
  } finally {
    await browser?.close()
  }
})

test("A delayed demo cannot replace local pages or report obsolete failures", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const status of [200, 503]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      const response = Promise.withResolvers()
      const request = Promise.withResolvers()
      await page.route("**/demo.pdf", async (route) => {
        request.resolve()
        await response.promise
        await route.fulfill({ status, contentType: "application/pdf", body: fixture() })
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await request.promise
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Local.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      })
      await page.locator(".composer[aria-busy=false]").waitFor()
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-3")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      response.resolve()
      await page.waitForLoadState("networkidle")
      await page.locator(".header-feedback .opening-progress").waitFor({ state: "detached" })
      assert.equal(await input.locator(".input-current").textContent(), "Local.pdf")
      assert.equal(await input.locator(".input-heading .count").textContent(), "1")
      assert.equal(await output.locator(".composition-totals strong").textContent(), "2 pages")
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1-2")
      assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Grid, List and Page transitions keep thumbnail bounds", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const output = page.locator(".composition-output")
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    for (const mode of ["Grid", "List", "Page", "Grid"]) {
      await tab(output, mode)
      if (mode === "Grid") {
        const image = output.locator(".page-image .thumbnail").first()
        await image.waitFor()
        assert.equal(
          await image.evaluate((frame) => {
            const canvas = frame.querySelector("canvas")
            return !canvas || canvas.getBoundingClientRect().height <= frame.getBoundingClientRect().height + 1
          }),
          true,
        )
      } else if (mode === "Page") {
        await output.locator(".page-scroll").waitFor()
      } else {
        await output.locator(".page-list").waitFor()
      }
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser.close()
  }
})

test("Home asks once before discarding changes and cancellation retains the workspace", async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.waitForFunction(
      () => document.querySelector(".composition-output .composition-totals strong")?.textContent === "8 pages",
    )
    const preparation = page.locator(".selection-panel").getByLabel("Page selection", { exact: true })
    await preparation.fill("1")
    await preparation.press("Enter")
    const home = page.getByRole("link", { name: "PDF Composer home", exact: true })
    const warnings = []
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    const confirmation = page.waitForEvent("dialog")
    await home.click()
    await confirmation
    assert.deepEqual(warnings, ["confirm"])
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "9 pages")
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    const reloadWarning = page.waitForEvent("dialog")
    await page.evaluate(() => location.reload())
    await reloadWarning
    assert.deepEqual(warnings, ["confirm", "beforeunload"], "Reload retains its independent exit warning")
    assert.equal(await page.locator(".composition-output .composition-totals strong").textContent(), "9 pages")
    page.on("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.accept()
    })
    await home.click()
    await page.locator(".drop-zone").waitFor()
    assert.deepEqual(warnings, ["confirm", "beforeunload", "confirm"], "Each Home attempt asks exactly once")
  } finally {
    await browser?.close()
  }
})

test("Input switching renders thumbnails and the lens from the selected PDF", { timeout: 60000 }, async () => {
  const outDir = await production()
  let server, browser
  try {
    server = await preview({
      base: "/composer/",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
      logLevel: "warn",
    })
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    })
    page.setDefaultTimeout(10000)
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    const input = page.locator(".selection-panel")
    const thumbnail = input.locator(".page-image .thumbnail canvas")
    const lens = page.getByRole("region", { name: "Magnified page 1 at 16×", exact: true })
    const inspect = async (name, color) => {
      assert.equal(await page.locator(".input-current").textContent(), name)
      assert.equal(await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true")
      const card = await input.locator(".composition-card").first().boundingBox()
      assert.equal(Math.round(card.width), 148, "Sources share the Normal card width")
      await input.locator(".page-image .thumbnail[aria-busy=false]").waitFor()
      const expected = [color, color, color, 255]
      assert.deepEqual(await pixel(thumbnail, 0.7), expected, `${name}: thumbnail content`)
      await page.mouse.move(0, 0)
      const bounds = await thumbnail.boundingBox()
      await thumbnail.hover({ position: { x: bounds.width / 2, y: bounds.height * 0.7 } })
      await lens.waitFor()
      await page.waitForFunction(() => document.querySelector(".lens")?.getAttribute("aria-busy") === "false")
      assert.deepEqual(await pixel(lens.locator("canvas"), 0.5), expected, `${name}: lens content`)
    }
    const documents = [
      { name: "Filled.pdf", buffer: fixture({ prepared: false, fillOnly: true }), color: 0 },
      { name: "Outline.pdf", buffer: fixture({ prepared: false }), color: 255 },
    ]
    for (const document of documents) {
      await page.locator("input[type=file]").first().setInputFiles({
        name: document.name,
        mimeType: "application/pdf",
        buffer: document.buffer,
      })
      await page.locator(".input-current").filter({ hasText: document.name }).waitFor()
      await inspect(document.name, document.color)
    }
    for (const index of [0, 1, 0, 1]) {
      await page.locator(".input-picker > summary").focus()
      await page.keyboard.press("Enter")
      await page.locator(".input-list button[data-source]").nth(index).focus()
      await page.keyboard.press("Enter")
      await lens.waitFor({ state: "detached" })
      await inspect(documents[index].name, documents[index].color)
    }
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
    if (server)
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
  }
})

test("Concurrent Source previews isolate resets and ignore obsolete worker replies", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" })
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      window.pendingReplies = []
      const Original = Worker
      window.Worker = class extends Original {
        constructor(url, options) {
          super(url, options)
          this.processor = String(url).includes("processor.worker")
        }
        addEventListener(type, listener, options) {
          if (type !== "message" || !this.processor) return super.addEventListener(type, listener, options)
          super.addEventListener(
            type,
            (event) => {
              if (window.holdReplies) window.pendingReplies.push(() => listener.call(this, event))
              else listener.call(this, event)
            },
            options,
          )
        }
      }
    })
    await page.goto(server.resolvedUrls.local[0])
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    for (const name of ["First.pdf", "Second.pdf"]) {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name,
          mimeType: "application/pdf",
          buffer: fixture({ grouped: true, fillOnly: true }),
        })
      await input.locator(".input-current").filter({ hasText: name }).waitFor()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
    }
    const choose = async (index) => {
      await input.locator(".input-picker > summary").click()
      await input.locator(".input-list button[data-source]").nth(index).click()
      await tab(input, "Style")
      await input.getByRole("button", { name: "Edit Fill", exact: true }).click()
    }
    const color = input.getByRole("textbox", { name: "Fill Color", exact: true })
    await page.evaluate(() => (window.holdReplies = true))
    await choose(0)
    await color.fill("#ff0000")
    await page.waitForFunction(() => window.pendingReplies.length === 1)
    await choose(1)
    await color.fill("#00ff00")
    await page.waitForFunction(() => window.pendingReplies.length === 2)
    await choose(0)
    await input.getByRole("button", { name: "Reset Fill Color", exact: true }).click()
    assert.equal(await color.inputValue(), "#000000")
    assert.equal(await output.getByRole("button", { name: "Download", exact: true }).isDisabled(), true)
    await page.evaluate(() => {
      window.holdReplies = false
      for (const reply of window.pendingReplies.splice(0).toReversed()) reply()
    })
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    assert.equal(await color.inputValue(), "#000000", "An obsolete reply cannot undo the first Source's reset")
    const canvases = output.locator(".composition-card .thumbnail canvas")
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll(".composition-output .composition-card .thumbnail canvas")]
      return (
        images.length === 2 &&
        images.every((canvas) => canvas.width > 0 && canvas.parentElement.getAttribute("aria-busy") === "false")
      )
    })
    assert.deepEqual(await pixel(canvases.nth(0), 0.7), [0, 0, 0, 255])
    assert.deepEqual(await pixel(canvases.nth(1), 0.7), [0, 255, 0, 255])
    await choose(1)
    assert.equal(await color.inputValue(), "#00ff00", "The second Source completes independently")
    await page.evaluate(() => (window.holdReplies = true))
    await color.fill("#0000ff")
    await page.waitForFunction(() => window.pendingReplies.length === 1)
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("2")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await input.locator(".input-picker > summary").click()
    await input.getByRole("button", { name: "Remove Input", exact: true }).click()
    assert.equal(await input.locator(".input-current").innerText(), "First.pdf")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "1 page")
    await page.evaluate(() => {
      window.holdReplies = false
      for (const reply of window.pendingReplies.splice(0)) reply()
    })
    await tab(input, "List")
    await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).click()
    await page.waitForFunction(() => {
      const images = [...document.querySelectorAll(".composition-output .composition-card .thumbnail canvas")]
      return images.length === 2 && images.every((canvas) => canvas.parentElement.getAttribute("aria-busy") === "false")
    })
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 pages")
    assert.deepEqual(await pixel(canvases.nth(0), 0.7), [0, 0, 0, 255])
    assert.deepEqual(await pixel(canvases.nth(1), 0.7), [0, 0, 0, 255])
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
  }
})

test("Production demos download on demand and reuse verified files offline", { timeout: 120000 }, async () => {
  const outDir = await production()
  const worker = await readFile(join(outDir, "sw.js"), "utf8")
  const assets = JSON.parse(worker.match(/const ASSETS = (.*);\n/)[1])
  const examples = JSON.parse(worker.match(/const EXAMPLES = (.*);\n/)[1])
  const replacement = await readFile(join(outDir, "toc/bridge.pdf"))
  const original = await readFile(join(outDir, "toc/lorem.pdf"))
  const replacementHash = createHash("sha256").update(replacement).digest("hex")
  const next = examples
    .filter((asset) => asset.path !== "toc/bridge.pdf")
    .map((asset) =>
      asset.path === "toc/lorem.pdf" ? { ...asset, bytes: replacement.length, sha256: replacementHash } : asset,
    )
  const requests = []
  let changed = false
  let server, browser
  try {
    server = await preview({
      base: "/composer/",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "demo-catalog-test",
          configurePreviewServer(value) {
            value.middlewares.use((request, response, advance) => {
              const path = request.url.split("?")[0].replace("/composer/", "")
              if (examples.some((asset) => asset.path === path)) requests.push(path)
              if (path === "sw.js") {
                response.setHeader("Content-Type", "text/javascript")
                response.setHeader("Cache-Control", "no-store")
                response.end(
                  changed
                    ? worker
                        .replace(/const VERSION = '[^']+';/, "const VERSION = 'catalog-update';")
                        .replace(/const EXAMPLES = .*;\n/, `const EXAMPLES = ${JSON.stringify(next)};\n`)
                    : worker,
                )
              } else if (path === "toc/lorem.pdf") {
                response.setHeader("Content-Type", "application/pdf")
                response.setHeader("Cache-Control", "public, max-age=31536000")
                response.end(changed ? replacement : original)
              } else advance()
            })
          },
        },
      ],
    })
    browser = await launch(chromium)
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    const url = server.resolvedUrls.local[0]
    const paths = [
      "demo.pdf",
      "recipe.json",
      "recipe/guides.pdf",
      "recipe/crossings.pdf",
      "toc/lorem.pdf",
      "toc/bridge.pdf",
    ]
    assert.ok(assets.every((asset) => !paths.includes(asset.path)))
    assert.equal(examples.length, 6)
    assert.ok(examples.reduce((sum, asset) => sum + asset.bytes, 0) <= 4 * 1024 * 1024)
    assert.ok(examples.filter((asset) => asset.path.endsWith(".pdf")).every((asset) => asset.bytes <= 2 * 1024 * 1024))
    await page.goto(url)
    await page.waitForFunction(() => navigator.serviceWorker.controller)
    assert.deepEqual(requests, [], "Installing the app does not download demo documents")
    await page.context().setOffline(true)
    await page.goto(`${url}?demo=toc`)
    await page.getByRole("alert").filter({ hasText: "Connect" }).waitFor()
    await page.context().setOffline(false)
    for (const multiple of [false, true]) {
      await page.goto(`${url}?demo=toc${multiple ? "-multiple" : ""}`)
      await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
      assert.equal(await page.locator(".input-current").innerText(), "Lorem Ipsum")
      assert.equal(
        await page.locator(".composition-output .composition-totals strong").textContent(),
        multiple ? "11 pages" : "9 pages",
      )
      await page.getByRole("button", { name: "Input contents", exact: true }).click()
      assert.ok(
        await page
          .locator(".contents:popover-open")
          .getByRole("button", { name: "Fold 1. Foundations of Digital Documents", exact: true })
          .isVisible(),
      )
      await page.keyboard.press("Escape")
      await page.context().setOffline(true)
      await page.reload()
      await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
      assert.equal(
        await page.locator(".composition-output .composition-totals strong").textContent(),
        multiple ? "11 pages" : "9 pages",
      )
      await page.context().setOffline(false)
    }
    await page.goto(`${url}?demo=recipe`)
    await page.getByRole("button", { name: "Sample PDFs", exact: true }).click()
    await page.getByText("3 of 3 Inputs selected · Ready to apply recipe", { exact: true }).waitFor()
    await page.context().setOffline(true)
    await page.reload()
    await page.getByRole("button", { name: "Sample PDFs", exact: true }).click()
    await page.getByText("3 of 3 Inputs selected · Ready to apply recipe", { exact: true }).waitFor()
    const cached = await page.evaluate(async () => {
      const cacheName = (await caches.keys()).find((name) => name.endsWith(":examples"))
      return (await (await caches.open(cacheName)).keys()).map((request) => request.url)
    })
    assert.equal(cached.length, 6)
    assert.ok(cached.every((key) => new URL(key).searchParams.has("sha256")))
    await page.context().setOffline(false)
    await page.goto(url)
    const before = [...requests]
    changed = true
    const reloaded = page.waitForEvent("load")
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration()
      await registration.update()
      const installing = registration.installing
      if (installing && !["installed", "activated", "redundant"].includes(installing.state))
        await new Promise((resolve) =>
          installing.addEventListener("statechange", () => {
            if (["installed", "activated", "redundant"].includes(installing.state)) resolve()
          }),
        )
      registration.waiting?.postMessage("activate-idle")
    })
    await page.waitForFunction(async () => {
      const names = await caches.keys()
      const cacheName = names.find((name) => name.endsWith(":examples"))
      return (
        names.some((name) => name.endsWith(":catalog-update")) &&
        cacheName &&
        (await (await caches.open(cacheName)).keys()).length === 4
      )
    })
    await reloaded
    assert.deepEqual(requests, before, "Updating the demo catalog does not prefetch its files")
    const retained = await page.evaluate(async () => {
      const cacheName = (await caches.keys()).find((name) => name.endsWith(":examples"))
      return (await (await caches.open(cacheName)).keys()).map((request) => request.url)
    })
    assert.equal(retained.length, 4, "The changed file and the retired file are removed; four unchanged files remain")
    assert.ok(retained.every((key) => !/\/toc\//.test(key)))
    const fresh = await page.evaluate(async (base) => {
      const bytes = await (await fetch(new URL("toc/lorem.pdf", base))).arrayBuffer()
      return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join("")
    }, url)
    assert.equal(fresh, replacementHash, "The new digest bypasses an old HTTP response with a long freshness lifetime")
  } finally {
    await browser?.close()
    await server?.httpServer.close()
  }
})

test("Production Grid demo repeats the bundled sample without another PDF asset", { timeout: 120000 }, async () => {
  const outDir = await production()
  let server, browser
  try {
    server = await preview({ base: "/composer/", build: { outDir }, preview: { host: "127.0.0.1", port: 0 } })
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(60000)
    const requests = []
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith(".pdf")) requests.push(new URL(request.url()).pathname)
    })
    await page.goto(server.resolvedUrls.local[0])
    const logo = page.getByRole("link", { name: "PDF Composer home", exact: true })
    for (let click = 0; click < 3; click++) await logo.click()
    const examples = page.getByRole("dialog", { name: "Explore the app", exact: true })
    assert.equal(await examples.getByRole("link").nth(1).getAttribute("href"), "?demo=grid")
    await examples.getByRole("link").nth(1).click()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await page.getByText("Grid workspace · 240 pages.", { exact: true }).waitFor()
    assert.equal(await input.locator(".input-current").textContent(), "grid.pdf")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "240 pages")
    await tab(input, "Page")
    await input.locator(".page-scroll").press("End")
    assert.match(await input.locator(".page-position").textContent(), /240/)
    await page.waitForFunction(() => navigator.serviceWorker.controller)
    await page.context().setOffline(true)
    await page.reload()
    await page.getByText("Grid workspace · 240 pages.", { exact: true }).waitFor()
    assert.equal(await output.locator(".composition-totals strong").textContent(), "240 pages")
    assert.ok(requests.length >= 2)
    assert.ok(requests.every((path) => path === "/composer/demo.pdf"))
    assert.equal(await page.getByRole("alert").count(), 0)
  } finally {
    await browser?.close()
    await server?.httpServer.close()
  }
})

test("Offline reads do not recreate a retired cache", { timeout: 60000 }, async () => {
  const outDir = await production()
  let server, browser
  try {
    server = await preview({ base: "/composer/", build: { outDir }, preview: { host: "127.0.0.1", port: 0 } })
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.goto(server.resolvedUrls.local[0])
    await page.waitForFunction(() => !!navigator.serviceWorker.controller)
    const result = await page.evaluate(async () => {
      const names = await caches.keys()
      for (const name of names) await caches.delete(name)
      const response = await fetch(new URL("logo.svg", document.baseURI))
      return { status: response.status, names: await caches.keys() }
    })
    assert.equal(result.status, 503, "A retired worker cannot serve assets from a missing cache")
    assert.deepEqual(result.names, [], "A late read must not recreate a retired cache")
  } finally {
    await browser?.close()
    if (server)
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
  }
})

test(
  "Application update progress replaces earlier feedback without a vertical header scroller",
  { timeout: 60000 },
  async () => {
    const outDir = await production()
    const server = await preview({
      base: "/composer/",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
    })
    const browser = await launch(chromium)
    try {
      for (const [width, text, colorScheme] of [
        [1440, "100%", "light"],
        [1440, "200%", "dark"],
        [1024, "100%", "dark"],
        [320, "200%", "light"],
        [390, "100%", "dark"],
        [768, "200%", "light"],
      ]) {
        const page = await browser.newPage({ viewport: { width, height: 900 }, colorScheme, reducedMotion: "reduce" })
        await page.addInitScript(() => {
          // Hold activation at the browser boundary so progress remains measurable.
          const container = new EventTarget()
          container.register = async () =>
            Object.assign(new EventTarget(), { active: {}, waiting: { postMessage() {} } })
          Object.defineProperty(navigator, "serviceWorker", { value: container })
        })
        await page.goto(server.resolvedUrls.local[0])
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
        await page.getByText("Update ready", { exact: true }).waitFor()
        for (const previous of ["notice", "error"]) {
          if (previous === "error") {
            await page.evaluate(() =>
              navigator.serviceWorker.dispatchEvent(new MessageEvent("message", { data: "update-blocked" })),
            )
            await page.getByRole("alert").filter({ hasText: "Close other PDF Composer tabs" }).waitFor()
          }
          const header = await page.locator(".header-inner").boundingBox()
          const main = await page.locator("main").boundingBox()
          await page.getByRole("button", { name: "Update app", exact: true }).click()
          await page.getByText("Updating application…", { exact: true }).waitFor()
          const panel = page.locator(".header-feedback")
          assert.equal(await panel.locator(":scope > .feedback").count(), 1)
          assert.equal(await panel.getByRole("alert").count(), 0)
          assert.deepEqual(await page.locator(".header-inner").boundingBox(), header)
          assert.deepEqual(await page.locator("main").boundingBox(), main)
          const geometry = await panel.evaluate((element) => {
            const feedback = element.querySelector(".feedback").getBoundingClientRect()
            const spinner = element.querySelector(".spinner").getBoundingClientRect()
            const message = element.querySelector(".feedback-message").getBoundingClientRect()
            const frame = document.querySelector(".header-inner").getBoundingClientRect()
            return {
              overflow: getComputedStyle(element).overflowY,
              contained: feedback.top >= frame.top && feedback.bottom <= frame.bottom,
              centered: Math.abs(feedback.x + feedback.width / 2 - frame.x - frame.width / 2) < 1,
              aligned: Math.abs(spinner.y + spinner.height / 2 - message.y - message.height / 2) < 1,
              fits: element.scrollHeight <= element.clientHeight && element.scrollWidth <= element.clientWidth,
            }
          })
          const label = `${width}px, ${text}, ${colorScheme}, after ${previous}: ${JSON.stringify(geometry)}`
          assert.ok(!["auto", "scroll"].includes(geometry.overflow), label)
          assert.ok(geometry.contained && geometry.centered && geometry.aligned && geometry.fits, label)
          if (previous === "notice" && (width === 320 || (width === 1440 && text === "100%"))) {
            await mkdir("../.local/tmp/web/layout/feedback", { recursive: true })
            await page
              .locator(".masthead")
              .screenshot({ path: `../.local/tmp/web/layout/feedback/update-${width}.png` })
          }
        }
        await page.close()
      }
    } finally {
      await browser.close()
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
    }
  },
)

test("Offline assets, scoped startup, and updates preserve a compatible workspace", { timeout: 180000 }, async () => {
  const outDir = await production()
  let server, browser
  let finishInstall
  const installation = new Promise((resolve) => {
    finishInstall = resolve
  })
  try {
    const worker = await readFile(join(outDir, "sw.js"), "utf8")
    assert.deepEqual(await readFile(join(outDir, "demo.pdf")), await readFile("test/fixtures/demo.pdf"))
    let paused = false,
      release = "initial",
      incompatible = false,
      transient = false,
      attempts = 0
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
              } else if (transient && request.url === "/composer/processor.mjs") {
                if (++attempts === 1) {
                  response.statusCode = 503
                  response.end("Temporarily unavailable")
                } else next()
              } else if (incompatible && request.url === "/composer/processor.mjs") {
                response.setHeader("Content-Type", "text/javascript")
                response.end("throw new Error('incompatible processor');")
              } else next()
            })
          },
        },
      ],
    })
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const context = await browser.newContext({ acceptDownloads: true })
    const page = await context.newPage()
    const url = server.resolvedUrls.local[0]
    await checkMobile(browser, url)
    await page.clock.install()
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
      const [messageBox, offlineBox, headerBox] = await feedback.evaluate((message) => [
        message.getBoundingClientRect().toJSON(),
        document.querySelector(".header-feedback .offline-progress").getBoundingClientRect().toJSON(),
        document.querySelector(".header-inner").getBoundingClientRect().toJSON(),
      ])
      assert.ok(
        offlineBox.y + offlineBox.height <= messageBox.y,
        JSON.stringify({ width, text, colorScheme, messageBox, offlineBox }),
      )
      assert.ok(
        Math.abs(headerBox.x + headerBox.width / 2 - offlineBox.x - offlineBox.width / 2) < 1,
        "Offline installation progress stays on the header's centerline",
      )
      await checkStatus(installingPage)
    }
    transient = true
    paused = false
    finishInstall()
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
      timeout: 60000,
    })
    await page.waitForFunction(async () => (await caches.keys()).some((name) => name.endsWith(":examples")))
    const initialCaches = (await page.evaluate(() => caches.keys())).filter((name) => !name.endsWith(":examples"))
    assert.equal(initialCaches.length, 1)
    assert.ok(initialCaches[0].startsWith("mainz:"))
    assert.match(initialCaches[0], /\/composer\/:initial$/)
    await installingPage.close()
    assert.equal(attempts, 2, "Installation recovers from a temporary asset download failure")
    transient = false
    const installed = page.getByText("PDF Composer is ready for offline use", { exact: true })
    await installed.waitFor()
    assert.equal(await page.getByRole("banner").getByRole("status").count(), 1)
    const installedBox = await installed.boundingBox(),
      landingBox = await page.locator(".drop-zone").boundingBox()
    assert.ok(installedBox.y + installedBox.height <= landingBox.y)
    await page.clock.fastForward(15000)
    await installed.waitFor({ state: "detached" })
    await page.evaluate(() => localStorage.setItem("mainz:onboarding", "19"))
    await context.setOffline(true)
    const demo = await context.newPage()
    await demo.goto(`${url}?demo`)
    await demo.waitForFunction(() => document.querySelector(".input-current")?.textContent === "demo.pdf", null, {
      timeout: 60000,
    })
    await demo.waitForFunction(
      () => document.querySelector(".composition-output .composition-totals strong")?.textContent === "8 pages",
    )
    assert.equal(await demo.locator(".offline-progress").count(), 0)
    assert.equal(await demo.locator(".footnote > time").textContent(), buildId)
    assert.equal(await demo.locator(".status-input").textContent(), "demo.pdf")
    assert.equal(await demo.locator(".composition-output .composition-totals strong").textContent(), "8 pages")
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
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
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
    assert.ok(!cachedURLs.includes(new URL("demo.pdf", url).href), "Demo files stay outside the installation cache")
    assert.ok(
      await page.evaluate(async () =>
        (await (await caches.open((await caches.keys()).find((name) => name.endsWith(":examples")))).keys()).some(
          (request) => new URL(request.url).pathname.endsWith("/demo.pdf"),
        ),
      ),
    )
    for (const name of ["apple-touch-icon.png", "icon-192.png", "icon-512.png"])
      assert.ok(
        cachedURLs.includes(new URL(name, url).href),
        `${name} remains available offline under the application scope`,
      )
    assert.deepEqual(
      await page.evaluate(async () =>
        Promise.all(
          ["apple-touch-icon.png", "icon-192.png", "icon-512.png"].map(async (name) => {
            const response = await fetch(new URL(name, document.baseURI))
            const image = await createImageBitmap(await response.blob())
            const result = [response.headers.get("content-type"), image.width, image.height]
            image.close()
            return result
          }),
        ),
      ),
      [
        ["image/png", 180, 180],
        ["image/png", 192, 192],
        ["image/png", 512, 512],
      ],
    )
    assert.ok(cachedURLs.every((path) => !/Offline\.pdf|blob:/.test(path)))
    await context.setOffline(false)
    await page.evaluate(async (name) => {
      await caches.open(name)
    }, foreignCache)
    release = "next"
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update())
    const update = page.getByRole("button", { name: "Update app", exact: true })
    await update.waitFor({ timeout: 60000 })
    const updateNotice = page.getByRole("banner").getByRole("status")
    await page.clock.fastForward(5500)
    assert.equal(await updateNotice.isVisible(), true)
    assert.match(await updateNotice.textContent(), /Update ready\. Download and close your PDF$/)
    for (const width of [810, 1080]) {
      await page.setViewportSize({ width, height: 1080 })
      const lines = await updateNotice.evaluate((element) => {
        const range = document.createRange()
        range.selectNodeContents(element.querySelector("button") ?? element)
        return [...range.getClientRects()].length
      })
      assert.equal(lines, 1, `${width}px: the iPad update message fits on one line`)
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    await page.clock.fastForward(15000)
    await updateNotice.waitFor({ state: "detached" })
    assert.equal(await update.isVisible(), true)
    assert.equal(await update.isDisabled(), true)
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 pages")
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#884488")
    await Promise.all([
      page.waitForEvent("load"),
      page.getByRole("link", { name: "PDF Composer home", exact: true }).click(),
    ])
    await update.waitFor()
    assert.equal(await update.isEnabled(), true)
    await updateNotice.waitFor()
    for (const [width, text] of [
      [320, "200%"],
      [1440, "100%"],
    ]) {
      await page.setViewportSize({ width, height: 900 })
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
      const alignment = await updateNotice.evaluate((message) => {
        const group = message.closest(".feedback").getBoundingClientRect()
        const header = document.querySelector(".header-inner").getBoundingClientRect()
        const range = document.createRange()
        range.selectNodeContents(message.querySelector("button"))
        const words = range.getBoundingClientRect()
        return {
          center: group.x + group.width / 2,
          headerCenter: header.x + header.width / 2,
          vertical: words.y + words.height / 2 - header.y - header.height / 2,
          height: words.height,
          lineHeight: parseFloat(getComputedStyle(message).lineHeight),
        }
      })
      assert.ok(Math.abs(alignment.center - alignment.headerCenter) < 1, JSON.stringify(alignment))
      assert.ok(Math.abs(alignment.vertical) < 2, JSON.stringify(alignment))
      assert.ok(alignment.height <= alignment.lineHeight, JSON.stringify(alignment))
      const gap = await update.evaluate((button) => {
        const timestamp = document.querySelector(".footnote > time").getBoundingClientRect()
        return timestamp.top - button.getBoundingClientRect().bottom
      })
      assert.ok(gap >= 12, `${width}px, ${text}: Update app retains space above Build ID`)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    }
    const other = await context.newPage()
    await other.goto(url)
    await update.click()
    await page.getByText("Close other PDF Composer tabs before updating", { exact: true }).waitFor()
    assert.equal(await page.locator(".header-feedback > .feedback").count(), 1)
    assert.equal(await page.locator(".header-feedback .notice").count(), 0)
    await page.clock.fastForward(11000)
    assert.equal(await page.locator(".header-feedback .notice").count(), 0)
    assert.notEqual(
      await page
        .locator(".header-feedback .feedback[data-kind=error]")
        .evaluate((element) => getComputedStyle(element).color),
      await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
    )
    assert.equal(await page.locator(".welcome .file-picker input[type=file]").isEnabled(), true)
    assert.ok((await page.evaluate(() => caches.keys())).some((name) => name.endsWith(":initial")))
    await other.close()
    const reloaded = page.waitForEvent("load")
    await update.click()
    const opening = page.locator(".welcome .file-picker input[type=file]")
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
      return names.length === 3 && names.some((name) => name.endsWith(":next"))
    })
    assert.deepEqual(
      (await page.evaluate(() => caches.keys())).toSorted(),
      [foreignCache, `mainz:${url}:next`, `mainz:${url}:examples`].toSorted(),
    )
    await page.evaluate((name) => caches.delete(name), foreignCache)
    await page.waitForFunction(
      () => !document.querySelector(".header-feedback .feedback[data-kind=error]")?.textContent.includes("Close other"),
    )
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
    const failure = page.getByText(
      "Offline setup failed. Reload this page in a moment. If it keeps failing, report it.",
      { exact: true },
    )
    const recovery = page.locator(".header-feedback")
    await recovery.getByRole("alert").waitFor()
    for (const width of [320, 390, 768]) {
      for (const colorScheme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        const box = await recovery.boundingBox()
        const landing = await page.locator(".drop-zone").boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= width)
        assert.ok(box.y + box.height <= landing.y, "The recovery area stays above the file controls")
        await recovery.getByRole("alert").getByRole("button").click()
        await failure.waitFor()
        const end = await failure.boundingBox()
        assert.ok(end.y + end.height <= 900, "The full recovery message remains reachable in its panel")
        await page.keyboard.press("Escape")
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
    assert.notEqual(
      await page
        .locator(".header-feedback .feedback[data-kind=error]")
        .evaluate((element) => getComputedStyle(element).color),
      await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
    )
    assert.deepEqual(
      (await page.evaluate(() => caches.keys())).toSorted(),
      [`mainz:${url}:next`, `mainz:${url}:examples`].toSorted(),
    )
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
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
  } finally {
    finishInstall()
    await browser?.close()
    if (server)
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
  }
})

test("Public TOC examples open on a fresh static-host visit without a service worker", { timeout: 60000 }, async () => {
  const outDir = await production()
  const server = await preview({
    base: "/composer/",
    appType: "mpa",
    build: { outDir },
    preview: { host: "127.0.0.1", port: 0 },
  })
  const browser = await launch(chromium)
  try {
    const url = server.resolvedUrls.local[0]
    assert.equal((await fetch(`${url}missing-entry`)).status, 404, "The static server has no application fallback")
    const landing = await browser.newPage({ serviceWorkers: "block" })
    await landing.goto(url)
    const logo = landing.getByRole("link", { name: "PDF Composer home", exact: true })
    for (let click = 0; click < 3; click++) await logo.click()
    const examples = landing.getByRole("dialog", { name: "Explore the app", exact: true })
    await examples.waitFor()
    const links = await examples.locator("a").evaluateAll((entries) => entries.map((entry) => entry.href))
    await landing.close()
    for (const demo of ["toc", "toc-multiple"]) {
      const href = links.find((link) => new URL(link).searchParams.get("demo") === demo)
      assert.equal(href, `${url}?demo=${demo}`)
      const context = await browser.newContext({ serviceWorkers: "block" })
      try {
        const page = await context.newPage()
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        assert.equal((await page.goto(href)).status(), 200)
        await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
        assert.ok(
          (await page.locator(".selection-panel .list-current").allTextContents()).includes(
            "1. Foundations of Digital Documents",
          ),
        )
        const chapter = page.locator('.selection-panel .list-section[data-index="3"]').first()
        assert.equal(await chapter.locator(".list-number").innerText(), "4")
        assert.equal(await chapter.locator(".list-pdf-label").count(), 0)
        await chapter.locator(".list-disclosure").click()
        await page
          .getByRole("button", {
            name: "Unfold Input section: 1. Foundations of Digital Documents › 1.1 The Document Model",
            exact: true,
          })
          .waitFor()
        await page.getByRole("button", { name: "Input contents", exact: true }).click()
        const titles = await page.locator(".contents:popover-open .destination > span:first-child").allTextContents()
        assert.equal(titles.length, 40)
        assert.ok(titles.includes("1. Foundations of Digital Documents"))
        assert.ok(titles.includes("1.1 The Document Model"))
        assert.ok(titles.includes("1.1.1 Logical Structure"))
        assert.ok(titles.includes("3.2.1 Parent and Child Entries"))
        await page.keyboard.press("Escape")
        assert.equal(
          await page.locator(".composition-output .composition-totals strong").textContent(),
          demo === "toc" ? "9 pages" : "11 pages",
        )
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
    await server.httpServer.close()
  }
})

test(
  "Opening cancellation during file reads or page labels cannot adopt an obsolete Input",
  { timeout: 60000 },
  async () => {
    const server = await serve(),
      browser = await launch(chromium)
    try {
      for (const stage of ["read", "labels"]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.getByText("Demo workspace ready.", { exact: true }).waitFor()
        const original = await page.locator(".input-current").textContent()
        await page.evaluate(
          async ({ stage, bytes }) => {
            const suspend = async () => {
              document.documentElement.dataset.openPending = "true"
              await new Promise((resolve) => window.addEventListener("release-open", resolve, { once: true }))
              document.documentElement.dataset.openPending = "false"
            }
            if (stage === "read") {
              const read = File.prototype.arrayBuffer
              File.prototype.arrayBuffer = async function () {
                File.prototype.arrayBuffer = read
                await suspend()
                return read.call(this)
              }
            } else {
              const { openPDF } = await import("/src/pdf.ts")
              const task = await openPDF(Uint8Array.from(bytes)),
                pdf = await task.promise
              const prototype = Object.getPrototypeOf(pdf),
                labels = prototype.getPageLabels
              prototype.getPageLabels = async function () {
                prototype.getPageLabels = labels
                const value = await labels.call(this)
                await suspend()
                return value
              }
              await task.destroy()
            }
          },
          { stage, bytes: Array.from(fixture({ prepared: false })) },
        )
        const input = page.locator('.input-heading input[type=file][aria-label="Open PDF"]')
        await input.setInputFiles({
          name: "Cancelled.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
        await page.waitForFunction(() => document.documentElement.dataset.openPending === "true")
        await page.getByRole("button", { name: "Cancel", exact: true }).click()
        assert.equal(await page.locator(".input-current").textContent(), original)
        await input.setInputFiles({
          name: "Retry.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ prepared: false }),
        })
        await page.locator(".input-current").filter({ hasText: "Retry.pdf" }).waitFor()
        await page.evaluate(() => window.dispatchEvent(new Event("release-open")))
        await page.waitForFunction(() => document.documentElement.dataset.openPending === "false")
        assert.equal(await page.locator(".input-current").textContent(), "Retry.pdf")
        assert.equal(await page.locator(".input-list button[data-source]").count(), 2)
        await page.close()
      }
    } finally {
      await browser.close()
    }
  },
)
