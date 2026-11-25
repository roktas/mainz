// Checks cold landing presentation, unsupported browser notice, logo actions, and HTTP entry.

import { outputCount, createServer, paneButton } from "./browser.js"
import { launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { serve } from "./server.ts"
import { readFile } from "node:fs/promises"
import { chromium, devices } from "playwright"

test(
  "Unsupported browsers explain the system requirement before loading the workspace",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const context = await browser.newContext({ ...devices["iPhone 13"] })
      await context.addInitScript(() => {
        const supports = CSS.supports.bind(CSS)
        CSS.supports = (...args) =>
          args[0] === "color" && args[1] === "light-dark(white, black)" ? false : supports(...args)
      })
      const page = await context.newPage()
      await page.goto(server.resolvedUrls.local[0])
      await page
        .getByRole("alert")
        .getByText(/iPhone needs a newer iOS version/)
        .waitFor()
      assert.equal(await page.locator(".composer, .landing").count(), 0)
      await context.close()
    } finally {
      await browser.close()
    }
  },
)

test(
  "Landing file actions keep paired widths and padding with theme-aware PDF and JSON icons",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await page.goto(server.resolvedUrls.local[0])
      await page.locator(".welcome .buttons > label").first().waitFor()
      for (const [width, text, family = ""] of [
        [1920, "100%"],
        [1440, "100%"],
        [375, "100%"],
        [768, "100%"],
        [390, "100%"],
        [428, "100%"],
        [320, "100%"],
        [320, "100%", "DejaVu Sans"],
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
            assert.ok(Math.abs(spacing.start - spacing.end) < 1 && spacing.start >= 16)
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
      [428, 926],
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
          const actions = [...area.querySelectorAll(".buttons > label")].map((element) =>
            element.getBoundingClientRect(),
          )
          const guide = area.querySelector(".landing-help").getBoundingClientRect()
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
            buttonWidths: actions.map((action) => action.width),
            actionInset: Math.min(actions[0].x - frame.x, frame.right - actions[1].right),
            guideGap: guide.y - Math.max(...actions.map((action) => action.bottom)),
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
          assert.ok(Math.abs(layout.buttonWidths[0] - layout.buttonWidths[1]) < 1, "Opening actions keep equal widths")
          assert.ok(layout.actionInset >= 4, `${width}px: buttons stay inside the frame`)
          if (width === 428 && text === "100%")
            assert.ok(layout.actionInset >= 20, "iPhone 12 Pro Max buttons clear the frame edges")
          assert.ok(layout.guideGap >= 24, `${width}px: the screencast guide clears the buttons`)
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
        await page.locator(".drop-zone").waitFor()
        await page.locator(".header-inner").waitFor()
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
      const started = await page.evaluate(() => performance.timeOrigin)
      await replay.click()
      await page.waitForFunction(
        () => document.querySelector(".hero-mark")?.getAnimations()[0]?.playState === "running",
      )
      assert.equal(
        await mark.evaluate((element) => element.getAnimations()[0]?.playState),
        "running",
        `${theme}: the header logo restarts the entry animation`,
      )
      assert.equal(
        await page.evaluate(() => performance.timeOrigin),
        started,
        "Landing replay keeps the current document",
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
    const touchStarted = await touch.evaluate(() => performance.timeOrigin)
    await touchLogo.tap()
    await touch.waitForFunction(() => document.querySelector(".hero-mark")?.getAnimations()[0]?.playState === "running")
    assert.equal(
      await touch.locator(".hero-mark").evaluate((element) => element.getAnimations()[0]?.playState),
      "running",
    )
    assert.equal(await touch.evaluate(() => performance.timeOrigin), touchStarted)
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
    await page.goto(server.resolvedUrls.local[0] + "?demo=single")
    await page.locator(".input-current").waitFor({ state: "attached" })
    assert.equal(await page.getByRole("link", { name: "PDF Composer home" }).count(), 1)
    const home = page.getByRole("link", { name: "PDF Composer home", exact: true })
    const workspaceStarted = await page.evaluate(() => performance.timeOrigin)
    await page.emulateMedia({ reducedMotion: "no-preference" })
    await home.dblclick()
    await page.waitForFunction(
      () => document.querySelector(".brand .logo")?.getAnimations()[0]?.playState === "running",
    )
    assert.equal(new URL(page.url()).search, "?demo=single", "Double-click preserves the workspace")
    assert.equal(await outputCount(page).textContent(), "8 pages")
    await home.click()
    await page.locator(".drop-zone").waitFor()
    assert.equal(new URL(page.url()).search, "", "One click opens Home")
    assert.equal(
      await page.evaluate(() => performance.timeOrigin),
      workspaceStarted,
      "Home retains the loaded application",
    )
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    await page.locator(".input-current").waitFor({ state: "attached" })
    await home.press("Enter")
    await page.locator(".drop-zone").waitFor()
    assert.equal(new URL(page.url()).search, "", "Keyboard activation opens Home")
    assert.equal(await home.evaluate((element) => element === document.activeElement), true)
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
    await page.goto(server.resolvedUrls.local[0].replace("127.0.0.1", "mainz.test") + "?demo=single")
    assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof crypto.randomUUID]), [false, "undefined"])
    await page.locator(".input-current").waitFor({ state: "attached" })
    assert.equal(await page.locator(".status-input").textContent(), "dolor.pdf")
    await page.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "8 pages",
    )
    assert.equal(await outputCount(page).textContent(), "8 pages")
    assert.equal(await page.getByRole("alert").count(), 0)
    const output = page.locator(".composition-output")
    await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click()
    assert.equal(await outputCount(page).textContent(), "9 pages")
    const saved = page.waitForEvent("download")
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const download = await saved
    assert.equal(await download.failure(), null)
    const bytes = await readFile(await download.path())
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-")
  } finally {
    await browser?.close()
    await server.close()
  }
})

test("Bare demo URL opens the example menu before choosing a document", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 810, height: 1080 }, hasTouch: true })
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    const menu = page.getByRole("dialog", { name: "Explore the app" })
    await menu.waitFor()
    await menu.getByRole("link", { name: /Single demo/ }).click()
    await page.locator(".composer").waitFor()
    assert.equal(new URL(page.url()).searchParams.get("demo"), "single")
    await page
      .getByRole("navigation", { name: "Workspace view" })
      .getByRole("button", { name: "Output", exact: true })
      .click()
    const panel = page.locator(".composition-output .composition-card").first().locator(".occurrence-actions")
    const boxes = await panel
      .locator("button")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
    assert.equal(boxes.length, 4)
    for (let index = 1; index < boxes.length; index++) assert.ok(boxes[index].x >= boxes[index - 1].right)
    assert.ok(await panel.evaluate((element) => element.getBoundingClientRect().height < 120))
    await page.keyboard.press("Escape")
    await paneButton(page, "Output").click()
    const filename = page.getByRole("textbox", { name: "Output filename", exact: true })
    await filename.fill("result.pdf")
    await filename.press("Tab")
    await page.keyboard.press("Escape")
    await paneButton(page, "Output").click()
    assert.equal(await filename.inputValue(), "result.pdf")
    const disclosure = page.getByRole("button", { name: "Set Output filename", exact: true })
    assert.ok(
      (await disclosure.boundingBox()).x >= (await filename.boundingBox()).x + (await filename.boundingBox()).width,
    )
    await disclosure.click()
    await page.getByRole("textbox", { name: "Filename", exact: true }).waitFor()
  } finally {
    await browser.close()
  }
})
