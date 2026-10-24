// Checks opening, preview loading, assets, and offline updates.

import assert from "node:assert/strict"
import test, { after } from "node:test"
import { serve } from "./server.ts"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve as resolvePath } from "node:path"
import { build, preview } from "vite"
import { chromium, devices } from "playwright"
import { aligned, zoom } from "./workspace.js"
import { checkGeometry, checkStatus, createServer, trackWorkers, fixture, tab, pixel } from "./browser.js"
import { measure } from "./measure.js"

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
      await zoom(output, "Fit page")
      await zoom(output, "Zoom in")
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%")
      await zoom(output, "Fit page")
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

test("Landing compact headings fit phones and tablets and logos follow theme changes and reloads", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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

test("Landing logo replays entry and keeps parallax inside its framed area", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      const replay = page.getByRole("button", { name: "Replay logo animation" })
      if (theme === "light") await replay.click()
      else await replay.press("Enter")
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
    await page.getByRole("button", { name: "Replay logo animation" }).press("Space")
    assert.equal(await mark.evaluate((element) => element.getAnimations()[0]?.playState), "running")
    await page.emulateMedia({ reducedMotion: "reduce" })
    assert.equal(await logo.evaluate((element) => getComputedStyle(element).transform), "none")
    await page.getByRole("button", { name: "Replay logo animation" }).click()
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
    await touch.getByRole("button", { name: "Replay logo animation" }).tap()
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
    await page.goto(server.resolvedUrls.local[0] + "?demo")
    await page.locator(".input-current").waitFor()
    assert.equal(await page.getByRole("link", { name: "PDF Composer home" }).count(), 1)
    assert.equal(await page.getByRole("button", { name: "Replay logo animation" }).count(), 0)
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
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      args: ["--host-resolver-rules=MAP mainz.test 127.0.0.1"],
    })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.goto(server.resolvedUrls.local[0].replace("127.0.0.1", "mainz.test") + "?demo")
    assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof crypto.randomUUID]), [false, "undefined"])
    await page.locator(".input-current").waitFor()
    assert.equal(await page.locator(".input-current").textContent(), "demo.pdf")
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "6 pages")
    assert.equal(await page.locator(".composition-totals strong").textContent(), "6 pages")
    assert.equal(await page.getByRole("alert").count(), 0)
    const output = page.locator(".composition-output")
    await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
    assert.equal(await page.locator(".composition-totals strong").textContent(), "7 pages")
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
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
          .setInputFiles({ name, mimeType: "application/pdf", buffer: fixture(false) })
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
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ reducedMotion: "reduce" })
      page.setDefaultTimeout(10000)
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      const bytes = fixture(false)
      const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: bytes })
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles([
          pdf("First.pdf"),
          { name: "Broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("Not a PDF") },
          pdf("Last.pdf"),
        ])
      const input = page.locator(".selection-panel")
      await input.locator(".input-current").filter({ hasText: "Last.pdf" }).waitFor()
      await page.locator(".loading-status").waitFor({ state: "detached" })
      assert.deepEqual(await input.locator(".input-list button[data-source] > span:nth-child(2)").allTextContents(), [
        "First.pdf",
        "Last.pdf",
      ])
      assert.equal(await page.getByRole("alert").innerText(), "1 file could not be opened.")
      await page.getByText("Review file errors", { exact: true }).click()
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
        .locator('input[type="file"]')
        .setInputFiles([
          { name: "Another-broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("Not a PDF") },
          pdf("Cancelled.pdf"),
          pdf("Unopened.pdf"),
        ])
      await page.waitForFunction(() => !!window.releaseRead)
      await page.getByRole("button", { name: "Cancel", exact: true }).click()
      await input.locator('input[type="file"]').setInputFiles(pdf("Retry.pdf"))
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
    const failed = Array.from({ length: 40 }, (_, index) => ({
      name: `${index}-${"long-publication-name-".repeat(6)}.${index < 2 ? "pdf" : "txt"}`,
      mimeType: "application/pdf",
      buffer: Buffer.from("Not a PDF"),
    }))
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles([...failed, { name: "Ready.pdf", mimeType: "application/pdf", buffer: fixture(false) }])
    await page.locator(".input-current").filter({ hasText: "Ready.pdf" }).waitFor()
    const announcement = page.getByRole("alert")
    await announcement.waitFor()
    assert.ok((await announcement.innerText()).length < 120, "Batch announcements must not include every diagnostic")
    assert.match(await announcement.innerText(), /40 files could not be opened/)
    assert.ok(
      await page.evaluate(() => window.announcements.every((text) => text.length < 120)),
      "Per-file failures must not produce long intermediate announcements",
    )
    const errors = page.getByRole("list", { name: "File errors", exact: true })
    const disclosure = page.locator(".file-errors > summary")
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
      const alignment = await page.locator(".error-banner").evaluate((element) => {
        const summary = element.querySelector("summary").getBoundingClientRect()
        const button = element.querySelector("button").getBoundingClientRect()
        const icon = element.querySelector("button svg").getBoundingClientRect()
        const action = element.querySelector("summary > span:last-child").getBoundingClientRect()
        return [
          summary.y - button.y,
          icon.x + icon.width / 2 - button.x - button.width / 2,
          icon.y + icon.height / 2 - button.y - button.height / 2,
          Math.max(0, action.right - summary.right),
        ]
      })
      assert.ok(
        alignment.every((offset) => Math.abs(offset) < 1),
        `${width}px: ${alignment}`,
      )
      if (width === 1440) {
        assert.ok(
          (await page.locator(".error-banner").boundingBox()).height <= 76,
          "A desktop error uses one control row",
        )
        assert.ok((await disclosure.boundingBox()).height <= 44, "The count and disclosure share one row")
      }
      await disclosure.focus()
      await page.keyboard.press("Enter")
      await errors.waitFor()
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
      await page.waitForFunction(() => document.querySelector(".file-errors ul")?.scrollTop > 0)
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await disclosure.focus()
      await page.keyboard.press("Enter")
    }
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
    // More than two Normal QHD batches selects Compact after validation.
    const bytes = fixture(true, false, 0, false, false, {}, 33)
    const input = page.locator(".selection-panel")
    const open = async (name, buffer) => {
      await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer })
      await page.locator(".composer[inert]").waitFor()
      await page.waitForFunction(() => document.querySelector(".selection-panel .page-image canvas")?.width > 0)
      assert.equal(await page.locator(".drop-zone").count(), 0)
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 pages")
      assert.equal(await page.locator(".composer").getAttribute("aria-busy"), "true")
      assert.equal(await page.locator(".loading-status").isVisible(), true)
    }
    await open("Cancelled.pdf", bytes)
    await page.locator(".loading-status span").click()
    for (const key of ["Control+a", "Enter", "+"]) await page.keyboard.press(key)
    assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0)
    assert.equal(await page.locator(".composition-totals strong").textContent(), "0 pages")
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
    await page.getByText("Review file errors", { exact: true }).click()
    assert.match(await page.getByRole("list", { name: "File errors", exact: true }).innerText(), /style format/)
    await page.locator(".drop-zone").waitFor()
    assert.equal(await page.locator(".composer").count(), 0)
    await open("Ready.pdf", bytes)
    release()
    await page.locator(".composer:not([inert])").waitFor()
    await input.getByRole("tab", { name: "Style", exact: true }).waitFor()
    assert.equal(await input.getAttribute("data-density"), "compact")
    assert.equal(await input.locator(".input-picker .count").innerText(), "1")
    assert.equal(await page.locator(".loading-status").count(), 0)
    assert.equal(await input.locator(".card-menu-options canvas").count(), 0, "Closed details do not build previews")
    const details = input.getByRole("button", { name: "Details for Input page 1", exact: true })
    await details.press("Space")
    await input.locator(".card-menu-options:popover-open .thumbnail[aria-busy=false]").waitFor()
    await page.keyboard.press("Escape")
    await page.waitForFunction(() => !document.querySelector(".card-menu-options canvas"))
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByLabel("Page selection", { exact: true }).press("Enter")
    assert.equal(await page.locator(".composition-totals strong").textContent(), "1 page")
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "6 pages")
  } finally {
    await browser?.close()
    await rm(outDir, { recursive: true, force: true })
  }
})

test("Demo variants open the maintained Input with populated or empty Output", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [query, pages, selected] of [
      ["", 6, 4],
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
        (count) => document.querySelector(".composition-totals strong")?.textContent === `${count} pages`,
        pages,
      )
      const input = page.locator(".selection-panel")
      assert.equal(await input.locator(".input-current").textContent(), "demo.pdf")
      assert.equal(await input.locator(".thumbnail").count(), 6)
      assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), selected)
      if (!query) {
        const output = page.locator(".composition-output")
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
        assert.equal(await page.locator(".composition-totals strong").textContent(), "0 pages")
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
        "1/8",
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage()
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    for (const value of ["missing", "<unknown>"]) {
      await page.goto(`${server.resolvedUrls.local[0]}?demo=${encodeURIComponent(value)}`)
      const error = page.getByRole("alert")
      await error.waitFor()
      assert.ok((await error.innerText()).includes(`Unknown demo: ${value}. Choose a local PDF.`))
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Local.pdf",
          mimeType: "application/pdf",
          buffer: fixture(false),
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      await page.locator(".loading-status").waitFor({ state: "detached" })
      assert.equal(await input.locator(".input-current").textContent(), "Local.pdf")
      assert.equal(await input.locator(".input-heading .count").textContent(), "1")
      assert.equal(await output.locator(".composition-totals strong").textContent(), "2 pages")
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1-2")
      assert.equal(await page.locator(".error-banner").count(), 0)
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test("Input density starts from two Normal batches and retains each Source choice", { timeout: 90000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const [width, height, small, large] of [
      [1920, 1080, 12, 13],
      [2560, 1440, 32, 33],
      [390, 1100, 2, 3],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      if (width === 390) {
        await page.emulateMedia({ colorScheme: "dark" })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
      }
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const open = async (name, count) => {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name,
            mimeType: "application/pdf",
            buffer: fixture(true, false, 0, false, false, {}, count),
          })
        await page.waitForFunction((label) => document.querySelector(".input-current")?.textContent === label, name)
        await page.waitForFunction(() => !!document.querySelector(".selection-panel .source-catalog")?.clientWidth)
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      }
      const choose = async (name) => {
        await input.locator(".input-picker > summary").click()
        await input.locator(".input-list button[data-source]").filter({ hasText: name }).click()
      }
      await open("Small.pdf", small)
      assert.equal(await input.getAttribute("data-density"), "normal", "Exactly two batches retain Normal")
      assert.equal(
        small,
        2 * (await measure(input)).capacity[2],
        "The small fixture contains exactly two Normal batches",
      )
      assert.equal(await output.getAttribute("data-density"), "normal")
      await input.getByRole("button", { name: "Compact Input grid", exact: true }).press("Space")
      await open("Large.pdf", large)
      await page.waitForFunction(
        () => document.querySelector(".selection-panel")?.getAttribute("data-density") === "compact",
      )
      assert.equal(await output.getAttribute("data-density"), "normal", "The heuristic affects only Input")
      if (width !== 390) {
        await page.setViewportSize({ width: width === 1920 ? 2560 : 3840, height: 2160 })
        await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
        assert.equal(await input.getAttribute("data-density"), "compact", "A larger screen retains the initial choice")
        await page.setViewportSize({ width, height })
      }
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).press("Space")
      await tab(input, "Page")
      await tab(input, "Grid")
      assert.equal(await input.getAttribute("data-density"), "normal", "View switches retain the manual choice")
      await choose("Small.pdf")
      assert.equal(await input.getAttribute("data-density"), "compact", "The first Source retains its manual choice")
      await choose("Large.pdf")
      assert.equal(await input.getAttribute("data-density"), "normal", "The second Source retains its manual choice")
      await open("Another.pdf", large)
      await page.waitForFunction(
        () => document.querySelector(".selection-panel")?.getAttribute("data-density") === "compact",
      )
      assert.equal(await output.getAttribute("data-density"), "normal")
      assert.deepEqual(errors, [])
      await page.close()
    }
  } finally {
    await browser?.close()
  }
})

test(
  "View switches reuse painted PDFs and loading keeps thumbnails within their frames",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({
        viewport: { width: 2560, height: 1440 },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      })
      const errors = []
      page.on("pageerror", (error) => errors.push(error.message))
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
      )
      await page.addInitScript(() => {
        const overflows = (window.previewOverflows = [])
        const inspect = () => {
          for (const frame of document.querySelectorAll(".page-image .thumbnail")) {
            const canvas = frame.querySelector("canvas")
            if (canvas && canvas.getBoundingClientRect().height > frame.getBoundingClientRect().height + 1)
              overflows.push(canvas.getBoundingClientRect().height)
          }
          requestAnimationFrame(inspect)
        }
        requestAnimationFrame(inspect)
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&input=page`)
      const output = page.locator(".composition-output")
      const ready = () =>
        page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
      await measure(output)
      await ready()
      await page.evaluate(async () => {
        const { openPDF } = await import("/src/pdf.ts")
        const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()))
        const pdf = await task.promise
        const prototype = Object.getPrototypeOf(await pdf.getPage(1))
        const render = prototype.render
        const cleanup = prototype.cleanup
        window.pdfRenderCount = 0
        window.pdfCleanups = new Set()
        window.holdPDFRendering = true
        window.pdfContinuations = []
        prototype.cleanup = function (...args) {
          const released = cleanup.apply(this, args)
          if (released) window.pdfCleanups.add(this.pageNumber)
          return released
        }
        prototype.render = function (...args) {
          window.pdfRenderCount++
          const drawing = render.apply(this, args)
          drawing.onContinue = (proceed) =>
            window.holdPDFRendering ? window.pdfContinuations.push(proceed) : proceed()
          return drawing
        }
        await task.destroy()
      })
      const snapshots = new Map()
      const snapshot = () =>
        output
          .locator(".page-image canvas, .pdf-viewport canvas")
          .first()
          .evaluate((canvas) => canvas.toDataURL())
      snapshots.set("Normal", await snapshot())
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click()
      await page.waitForFunction(() => window.pdfContinuations.length > 0)
      const spinner = output.locator(".render-status").first()
      assert.equal(await spinner.innerText(), "")
      assert.equal(await spinner.getAttribute("aria-hidden"), "true")
      assert.equal(await spinner.evaluate((element) => getComputedStyle(element).borderTopWidth), "2px")
      await page.evaluate(() => new Promise(requestAnimationFrame))
      assert.deepEqual(
        await page.evaluate(() => window.previewOverflows),
        [],
        "Loading at 2× pixel density does not stretch thumbnails",
      )
      await page.evaluate(() => {
        window.holdPDFRendering = false
        for (const proceed of window.pdfContinuations) proceed()
        window.pdfContinuations = []
      })
      await ready()
      const count = (await measure(output)).matrix[2]
      snapshots.set("Compact", await snapshot())
      await tab(output, "Page")
      await ready()
      assert.ok(
        await page.evaluate((minimum) => window.pdfCleanups.size >= minimum, count),
        "Leaving Grid releases its PDF page resources",
      )
      snapshots.set("Page", await snapshot())
      for (const mode of ["Grid", "Normal", "Compact", "Page", "Grid"]) {
        await page.evaluate(() => (window.pdfRenderCount = 0))
        if (mode === "Normal" || mode === "Compact")
          await output.getByRole("button", { name: `${mode} Output grid`, exact: true }).click()
        else await tab(output, mode)
        await ready()
        // Density changes retain the previous raster until the next resize paint.
        await page.waitForFunction(({ canvas, pixels }) => canvas.toDataURL() === pixels, {
          canvas: await output.locator(".page-image canvas, .pdf-viewport canvas").first().elementHandle(),
          pixels: snapshots.get(mode === "Grid" ? "Compact" : mode),
        })
        assert.equal(await page.evaluate(() => window.pdfRenderCount), 0, `${mode}: completed pages need no PDF redraw`)
      }
      const input = page.locator(".selection-panel")
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Cold.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, false, 0, false, false, {}, 33),
        })
      await input.locator(".input-current").filter({ hasText: "Cold.pdf" }).waitFor()
      await tab(input, "Grid")
      await ready()
      const cold = input.locator(".page-image canvas").first()
      const compactPixels = await cold.evaluate((canvas) => canvas.toDataURL())
      const compactWidth = await cold.evaluate((canvas) => canvas.clientWidth)
      await page.evaluate(() => (window.holdPDFRendering = true))
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click()
      await page.waitForFunction(() => window.pdfContinuations.length > 0)
      assert.equal(
        await cold.evaluate((canvas) => canvas.toDataURL()),
        compactPixels,
        "The first Normal render retains the Compact image",
      )
      assert.ok(
        (await cold.evaluate((canvas) => canvas.clientWidth)) > compactWidth,
        "The retained image fits its Normal card immediately",
      )
      assert.equal(await input.locator(".render-status").count(), 0, "Existing images do not return to loading rings")
      await page.evaluate(() => {
        window.holdPDFRendering = false
        for (const proceed of window.pdfContinuations) proceed()
        window.pdfContinuations = []
      })
      await ready()
      assert.notEqual(
        await cold.evaluate((canvas) => canvas.toDataURL()),
        compactPixels,
        "Normal replaces the retained image with its sharper raster",
      )
      assert.deepEqual(await page.evaluate(() => window.previewOverflows), [])
      assert.deepEqual(errors, [])
    } finally {
      await browser?.close()
    }
  },
)

test("Home asks once before discarding changes and cancellation retains the workspace", async () => {
  const server = await serve()
  let browser
  try {
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "6 pages")
    const preparation = page.locator(".selection-panel").getByLabel("Page selection", { exact: true })
    await preparation.fill("1")
    await preparation.press("Enter")
    const home = page.getByRole("link", { name: "PDF Composer home", exact: true })
    const warnings = []
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    await home.click()
    assert.deepEqual(warnings, ["confirm"])
    assert.equal(await page.locator(".composition-totals strong").textContent(), "7 pages")
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type())
      await dialog.dismiss()
    })
    const reloadWarning = page.waitForEvent("dialog")
    await page.evaluate(() => location.reload())
    await reloadWarning
    assert.deepEqual(warnings, ["confirm", "beforeunload"], "Reload retains its independent exit warning")
    assert.equal(await page.locator(".composition-totals strong").textContent(), "7 pages")
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
      assert.equal(
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).getAttribute("aria-pressed"),
        String(name === "Filled.pdf"),
        "Production retains each Source's grid density",
      )
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
      { name: "Filled.pdf", buffer: fixture(false, false, 0, false, true), color: 0 },
      { name: "Outline.pdf", buffer: fixture(false), color: 255 },
    ]
    for (const document of documents) {
      await page.locator("input[type=file]").first().setInputFiles({
        name: document.name,
        mimeType: "application/pdf",
        buffer: document.buffer,
      })
      await page.locator(".input-current").filter({ hasText: document.name }).waitFor()
      if (document.name === "Filled.pdf")
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).click()
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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
          buffer: fixture(true, false, 0, true, true),
        })
      await input.locator(".input-current").filter({ hasText: name }).waitFor()
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
    assert.equal(await output.locator(".download-action button").isDisabled(), true)
    await page.evaluate(() => {
      window.holdReplies = false
      for (const reply of window.pendingReplies.splice(0).toReversed()) reply()
    })
    await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'))
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
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("2")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await input.locator(".input-picker > summary").click()
    await input.getByRole("button", { name: "Remove Input", exact: true }).click()
    assert.equal(await input.locator(".input-current").innerText(), "First.pdf")
    assert.equal(await output.locator(".composition-totals strong").textContent(), "1 page")
    assert.equal(await page.locator(".error-banner").count(), 0)
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
  }
})

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
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
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
    transient = true
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
    assert.equal(attempts, 2, "Installation recovers from a temporary asset download failure")
    transient = false
    const installed = page.getByText("PDF Composer is ready for offline use.", { exact: true })
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
    await demo.waitForFunction(() => document.querySelector(".composition-totals strong")?.textContent === "6 pages")
    assert.equal(await demo.locator(".offline").count(), 0)
    assert.equal(await demo.locator(".footnote > time").textContent(), buildId)
    assert.equal(await demo.locator(".status-input").textContent(), "demo.pdf")
    assert.equal(await demo.locator(".composition-totals strong").textContent(), "6 pages")
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
    const update = page.getByRole("button", { name: "Update application", exact: true })
    await update.waitFor({ timeout: 60000 })
    const updateNotice = page.getByRole("banner").getByRole("status")
    await page.clock.fastForward(5500)
    assert.equal(await updateNotice.isVisible(), true)
    assert.match(
      await updateNotice.textContent(),
      /An application update is ready\. Download and close your PDF before updating\./,
    )
    await page.clock.fastForward(15000)
    await updateNotice.waitFor({ state: "detached" })
    assert.equal(await update.isVisible(), true)
    assert.equal(await update.isDisabled(), true)
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 pages")
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
    const failure = page.getByText(
      "Offline setup failed. Reload this page in a moment. If it keeps failing, report it.",
      { exact: true },
    )
    await failure.waitFor()
    for (const width of [320, 390, 768]) {
      for (const colorScheme of ["light", "dark"]) {
        await page.setViewportSize({ width, height: 900 })
        await page.emulateMedia({ colorScheme })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        const box = await failure.boundingBox()
        const landing = await page.locator(".drop-zone").boundingBox()
        assert.ok(box.x >= 0 && box.x + box.width <= width)
        assert.ok(box.y + box.height <= landing.y, "Recovery guidance stays above the file controls")
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
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
  }
})
