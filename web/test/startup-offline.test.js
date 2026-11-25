// Checks production bundles, offline cache persistence, service worker updates, and static demos.

import { setup, outputCount, checkGeometry, checkStatus, fixture, tab, pixel } from "./browser.js"
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

let compiled

function closeServer(server) {
  return server
    ? new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())))
    : Promise.resolve()
}

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
      compiled = undefined
      await rm(outDir, { recursive: true, force: true })
      throw error
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV
      else process.env.NODE_ENV = previous
    }
  })())
}

after(async () => {
  const outDir = await compiled?.catch(() => undefined)
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
      await setup(page)
      await page.addInitScript(() => {
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
            range.selectNodeContents(button.querySelector(".workspace-label > span"))
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
      assert.equal(await outputCount(page).textContent(), "2 pages")
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
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).tap()
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

test("Startup import and mount failures offer reload in development and production", { timeout: 60000 }, async () => {
  const browser = await launch(chromium)
  const development = await serve()
  const outDir = await production()
  const built = await preview({ base: "/composer/", build: { outDir }, preview: { host: "127.0.0.1", port: 0 } })
  try {
    for (const server of [development, built]) {
      for (const failure of ["import", "mount"]) {
        const page = await browser.newPage({ serviceWorkers: "block" })
        const route = /\/(?:src\/App\.svelte|assets\/App-[^/]+\.js)(?:\?|$)/
        await page.route(route, async (request) => {
          if (failure === "import") await request.abort()
          else
            await request.fulfill({
              contentType: "application/javascript",
              body: 'export default function() { throw new Error("Mount failed") }',
            })
        })
        await page.goto(server.resolvedUrls.local[0])
        const recovery = page.getByRole("alert")
        await recovery.getByRole("heading", { name: "PDF Composer could not load" }).waitFor()
        assert.equal(await page.locator("#app > *").count(), 1)
        await page.unroute(route)
        await recovery.getByRole("button", { name: "Reload", exact: true }).click()
        await page.locator(".drop-zone").waitFor()
        await page.close()
      }
    }
  } finally {
    await browser.close()
    await closeServer(built)
  }
})

test("Startup shows an accessible spinner before application imports finish", { timeout: 60000 }, async () => {
  const development = await serve()
  const outDir = await production()
  const built = await preview({ base: "/composer/", build: { outDir }, preview: { host: "127.0.0.1", port: 0 } })
  const browser = await launch(chromium)
  try {
    for (const server of [development, built])
      for (const reducedMotion of ["reduce", "no-preference"]) {
        const page = await browser.newPage({ serviceWorkers: "block", reducedMotion })
        let release
        const pending = new Promise((resolve) => (release = resolve))
        const route = /\/(?:src\/App\.svelte|assets\/App-[^/]+\.js)(?:\?|$)/
        await page.route(route, async (request) => {
          await pending
          await request.continue()
        })
        try {
          await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded" })
          const status = page.getByRole("status", { name: "Loading PDF Composer", exact: true })
          await status.waitFor()
          assert.equal((await status.innerText()).trim(), "")
          const spinner = status.locator(".startup-spinner")
          const size = await spinner.boundingBox()
          assert.ok(size.width >= 40 && size.height >= 40)
          const content = await page.locator("body").boundingBox()
          assert.ok(Math.abs(size.x + size.width / 2 - (content.x + content.width / 2)) < 1)
          assert.ok(Math.abs(size.y + size.height / 2 - page.viewportSize().height / 2) < 1)
          assert.equal(
            await spinner.evaluate((element) => getComputedStyle(element).animationName),
            reducedMotion === "reduce" ? "none" : "startup-spin",
          )
          release()
          await page.locator(".drop-zone").waitFor()
          assert.equal(await status.count(), 0)
        } finally {
          release()
          await page.close()
        }
      }
  } finally {
    await browser.close()
    await closeServer(built)
  }
})

test("Cold startup reaches the landing page before workspace code loads", { timeout: 60000 }, async () => {
  const outDir = await production()
  const server = await preview({ base: "/composer/", build: { outDir }, preview: { host: "127.0.0.1", port: 0 } })
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ serviceWorkers: "block" })
    await setup(page)
    const route = /\/assets\/Composer-[^/]+\.js$/
    const requests = []
    page.on("request", (request) => requests.push(new URL(request.url()).pathname))
    await page.route(route, (request) => request.abort())
    let resume
    const bootstrap = new Promise((resolve) => (resume = resolve))
    const entry = /\/assets\/index-[^/]+\.js$/
    await page.route(entry, async (request) => {
      await bootstrap
      await request.continue()
    })
    const shell = page.waitForRequest(/\/assets\/App-[^/]+\.js$/)
    const navigation = page.goto(server.resolvedUrls.local[0])
    try {
      await shell
    } finally {
      resume()
    }
    await navigation
    await page.unroute(entry)
    await page.locator(".drop-zone").waitFor()
    assert.equal(
      requests.some((path) => route.test(path)),
      false,
    )
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Cold.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 2 }),
      })
    const recovery = page.getByRole("alert").filter({ hasText: "The workspace could not load" })
    await recovery.waitFor()
    await page.unroute(route)
    await recovery.getByRole("button", { name: "Reload", exact: true }).click()
    await page.locator(".drop-zone").waitFor()
    await page
      .locator('input[type="file"]')
      .first()
      .setInputFiles({
        name: "Cold.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false, count: 2 }),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    await page.locator(".header-feedback [role=status]").filter({ hasText: "Select pages" }).waitFor()
    await page.context().addInitScript(() => {
      CSS.supports = () => false
    })
    requests.length = 0
    page.on("dialog", (dialog) => dialog.accept())
    await page.reload()
    await page.getByRole("heading", { name: "PDF Composer needs a newer system", exact: true }).waitFor()
    assert.equal(
      requests.some((path) => /\/assets\/App-/.test(path)),
      false,
    )
  } finally {
    await browser.close()
    await closeServer(server)
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
    await setup(page)
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
      await page.locator(".status-input").filter({ hasText: document.name }).waitFor({ state: "attached" })
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
    await closeServer(server)
  }
})

test("Production demos download on demand and reuse verified files offline", { timeout: 120000 }, async () => {
  const outDir = await production()
  const worker = await readFile(join(outDir, "sw.js"), "utf8")
  const assets = JSON.parse(worker.match(/const ASSETS = (.*);\n/)[1])
  const examples = JSON.parse(worker.match(/const EXAMPLES = (.*);\n/)[1])
  const replacement = await readFile(join(outDir, "toc/ipsum.pdf"))
  const original = await readFile(join(outDir, "toc/lorem.pdf"))
  const replacementHash = createHash("sha256").update(replacement).digest("hex")
  const next = examples
    .filter((asset) => asset.path !== "toc/ipsum.pdf")
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
    await setup(page)
    const url = server.resolvedUrls.local[0]
    const paths = ["dolor.pdf", "nulla.json", "recipe/minim.pdf", "recipe/culpa.pdf", "toc/lorem.pdf", "toc/ipsum.pdf"]
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
      assert.equal(await outputCount(page).textContent(), multiple ? "11 pages" : "9 pages")
      await page.getByRole("button", { name: "Input contents", exact: true }).click()
      assert.ok(
        await page
          .locator(".contents:popover-open")
          .getByRole("button", { name: "Unfold 1 Laboris tempor sit", exact: true })
          .isVisible(),
      )
      await page.keyboard.press("Escape")
      await page.context().setOffline(true)
      await page.reload()
      await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
      assert.equal(await outputCount(page).textContent(), multiple ? "11 pages" : "9 pages")
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
    await closeServer(server)
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
    const input = page.locator(".selection-panel")
    await page.getByText("Grid workspace · 240 pages.", { exact: true }).waitFor()
    assert.equal(await input.locator(".input-current").textContent(), "magna.pdf")
    assert.equal(await outputCount(page).textContent(), "240 pages")
    await tab(input, "Page")
    await input.locator(".page-scroll").press("End")
    assert.match(await input.locator(".page-position").textContent(), /240/)
    await page.waitForFunction(() => navigator.serviceWorker.controller)
    await page.context().setOffline(true)
    await page.reload()
    await page.getByText("Grid workspace · 240 pages.", { exact: true }).waitFor()
    assert.equal(await outputCount(page).textContent(), "240 pages")
    assert.ok(requests.length >= 2)
    assert.ok(requests.every((path) => path === "/composer/dolor.pdf"))
    assert.equal(await page.getByRole("alert").count(), 0)
  } finally {
    await browser?.close()
    await closeServer(server)
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
    await closeServer(server)
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
          await page.getByRole("button", { name: "Update application", exact: true }).click()
          await page.getByRole("status", { name: "Updating application", exact: true }).waitFor()
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
      await closeServer(server)
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
    assert.deepEqual(await readFile(join(outDir, "dolor.pdf")), await readFile("test/fixtures/dolor.pdf"))
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
    await page.getByRole("status", { name: "Installing offline application", exact: true }).waitFor()
    const installingPage = await context.newPage()
    await installingPage.goto(`${url}?demo=single`)
    const feedback = installingPage.getByText("Demo workspace ready.", { exact: true })
    const offline = installingPage.getByRole("status", {
      name: "Installing offline application",
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
    await installingPage.setViewportSize({ width: 1440, height: 900 })
    await installingPage.evaluate(() => {
      document.documentElement.style.fontSize = "100%"
      localStorage.setItem("mainz:onboarding", "19")
    })
    await installingPage.getByRole("link", { name: "PDF Composer home", exact: true }).press("Enter")
    await installingPage.locator(".drop-zone").waitFor()
    await offline.waitFor()
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
    await installingPage.getByText("PDF Composer is ready for offline use", { exact: true }).waitFor()
    assert.equal(await offline.count(), 0)
    await installingPage.close()
    assert.equal(attempts, 2, "Installation recovers from a temporary asset download failure")
    transient = false
    const installed = page.getByText("PDF Composer is ready for offline use", { exact: true })
    await installed.waitFor()
    await installed.click()
    assert.match(
      await page.locator(".message-details:popover-open p").innerText(),
      /Application files are saved on this device/,
    )
    await page.keyboard.press("Escape")
    assert.equal(await page.getByRole("banner").getByRole("status").count(), 1)
    const installedBox = await installed.boundingBox(),
      landingBox = await page.locator(".drop-zone").boundingBox()
    assert.ok(installedBox.y + installedBox.height <= landingBox.y)
    await page.clock.fastForward(15000)
    await installed.waitFor({ state: "detached" })
    await page.evaluate(() => localStorage.setItem("mainz:onboarding", "19"))
    await context.setOffline(true)
    const demo = await context.newPage()
    await demo.goto(`${url}?demo=single`)
    await demo.waitForFunction(() => document.querySelector(".status-input")?.textContent === "dolor.pdf", null, {
      timeout: 60000,
    })
    await demo.waitForFunction(
      () =>
        document.querySelector(".mobile-workspace-tabs > button:last-child .composition-totals strong")?.textContent ===
        "8 pages",
    )
    assert.equal(await demo.locator(".offline-progress").count(), 0)
    assert.equal(await demo.locator(".footnote > time").textContent(), buildId)
    assert.equal(await demo.locator(".status-input").textContent(), "dolor.pdf")
    assert.equal(await demo.locator(".composition-output .composition-totals strong").textContent(), "8 pages")
    assert.equal(await demo.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true }).count(), 0)
    await demo.locator(".selection-panel").getByRole("tab", { name: "Style", exact: true }).click()
    await demo.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    await demo.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    const demoSaved = demo.waitForEvent("download")
    await demo.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
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
    const input = page.locator(".selection-panel")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488")
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    const saved = page.waitForEvent("download")
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const artifact = await saved
    assert.equal(await artifact.failure(), null)
    assert.match((await readFile(await artifact.path())).subarray(0, 8).toString(), /^%PDF-/)
    const cachedURLs = await page.evaluate(async () =>
      (await (await caches.open((await caches.keys())[0])).keys()).map((request) => request.url),
    )
    assert.ok(cachedURLs.length > 100)
    assert.ok(cachedURLs.every((path) => path.startsWith(new URL(url).origin + "/composer/")))
    assert.ok(!cachedURLs.includes(new URL("dolor.pdf", url).href), "Demo files stay outside the installation cache")
    assert.ok(
      await page.evaluate(async () =>
        (await (await caches.open((await caches.keys()).find((name) => name.endsWith(":examples")))).keys()).some(
          (request) => new URL(request.url).pathname.endsWith("/dolor.pdf"),
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
    const update = page.getByRole("button", { name: "Update application", exact: true })
    await update.waitFor({ timeout: 60000 })
    const updateNotice = page.getByRole("banner").getByRole("status")
    await page.clock.fastForward(5500)
    assert.equal(await updateNotice.isVisible(), true)
    assert.match(await updateNotice.textContent(), /Update ready\. Download and close your PDF$/)
    await updateNotice.getByRole("button").click()
    assert.match(await page.locator(".message-details:popover-open p").innerText(), /new application version is ready/)
    await page.keyboard.press("Escape")
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
    assert.equal(await outputCount(page).textContent(), "2 pages")
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#884488")
    await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
    await page.locator(".drop-zone").waitFor()
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
      assert.ok(gap >= 12, `${width}px, ${text}: Update application retains space above Build ID`)
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
        const metadataWarnings = []
        page.on("console", (message) => {
          if (/Bad value, for key "(CreationDate|ModDate)", in Info/.test(message.text()))
            metadataWarnings.push(message.text())
        })
        await setup(page)
        assert.equal((await page.goto(href)).status(), 200)
        await page.getByRole("status").filter({ hasText: "TOC demo ready." }).waitFor()
        assert.ok(
          (await page.locator(".selection-panel .list-current").allTextContents()).includes("1 Laboris tempor sit"),
        )
        const chapter = page.locator('.selection-panel .list-section[data-index="2"]').first()
        assert.equal(await chapter.locator(".list-number").innerText(), "3")
        assert.equal(await chapter.locator(".list-pdf-label").count(), 0)
        if ((await chapter.locator(".list-disclosure").getAttribute("aria-expanded")) === "false")
          await chapter.locator(".list-disclosure").click()
        assert.equal(await chapter.locator(".list-disclosure").getAttribute("aria-expanded"), "true")
        await page.getByRole("button", { name: "Input contents", exact: true }).click()
        await page.locator(".contents:popover-open").getByRole("button", { name: "Unfold all", exact: true }).click()
        const titles = await page.locator(".contents:popover-open .destination > span:first-child").allTextContents()
        assert.equal(titles.length, 43)
        assert.equal(titles[0], "Cover")
        assert.equal(titles[1], "…")
        assert.equal(
          await page
            .locator(".composition-output")
            .getByRole("tab", { name: "Grid", exact: true })
            .getAttribute("aria-selected"),
          "true",
        )
        assert.ok(titles.includes("1 Laboris tempor sit"))
        assert.ok(titles.includes("1.1 Nostrud commodo veniam"))
        assert.ok(titles.includes("1.1.1 Cupidatat ipsum"))
        assert.ok(titles.includes("3.2.1 Eiusmod culpa"))
        await page.keyboard.press("Escape")
        assert.equal(await outputCount(page).textContent(), demo === "toc" ? "9 pages" : "11 pages")
        assert.deepEqual(metadataWarnings, [])
      } finally {
        await context.close()
      }
    }
  } finally {
    await browser.close()
    await closeServer(server)
  }
})
