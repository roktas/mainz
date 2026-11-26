// Checks static help routes, native playback, and discoverable screencast links.

import assert from "node:assert/strict"
import test, { after } from "node:test"
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises"
import { join, resolve } from "node:path"
import { build, preview as servePreview } from "vite"
import { engines, launch } from "./browsers.js"

let server, directory
async function closeServer(target) {
  if (target)
    await new Promise((resolve, reject) => target.httpServer.close((error) => (error ? reject(error) : resolve())))
}
async function production() {
  if (server) return server
  const temporary = resolve("../.local/tmp/web")
  await mkdir(temporary, { recursive: true })
  directory = await mkdtemp(join(temporary, "screencasts-"))
  const previous = process.env.NODE_ENV
  try {
    process.env.NODE_ENV = "production"
    await build({ base: "./", build: { outDir: directory }, logLevel: "warn" })
    server = await servePreview({
      base: "/composer/",
      appType: "mpa",
      build: { outDir: directory },
      preview: { host: "127.0.0.1", port: 0 },
    })
    return server
  } catch (error) {
    await closeServer(server)
    server = undefined
    throw error
  } finally {
    if (previous === undefined) delete process.env.NODE_ENV
    else process.env.NODE_ENV = previous
  }
}
after(async () => {
  await closeServer(server)
  server = undefined
  if (directory) await rm(directory, { recursive: true, force: true })
})

test("Screencast previews show loading and failure feedback", { timeout: 60000 }, async () => {
  const url = (await production()).resolvedUrls.local[0]
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ serviceWorkers: "block", reducedMotion: "no-preference" })
      let release
      const pending = new Promise((finish) => (release = finish))
      await page.route("**/*.webp", async (route) => {
        await pending
        await route.continue()
      })
      await page.clock.install()
      await page.clock.pauseAt(new Date())
      await page.goto(`${url}help/`, { waitUntil: "domcontentloaded" })
      const previews = page.locator("nav .screencast-media")
      await previews.last().waitFor()
      assert.equal(await previews.getByRole("status").count(), 0, "A quick load does not show a busy ring")
      await page.clock.runFor(200)
      await previews.first().getByRole("status", { name: "Loading screencast…", exact: true }).waitFor()
      assert.equal(await previews.locator('[role="status"]').count(), 2)
      for (const preview of await previews.all()) {
        assert.equal(await preview.getAttribute("aria-busy"), "true")
        const spinner = preview.locator(".spinner")
        assert.equal(await spinner.isVisible(), true)
        assert.equal(await spinner.evaluate((element) => element.getAnimations().length), 1)
        assert.ok((await preview.getByText("Loading screencast…", { exact: true }).boundingBox()).width <= 1)
        assert.notEqual(await preview.evaluate((element) => getComputedStyle(element).backgroundImage), "none")
      }
      release()
      await previews.and(page.locator('[aria-busy="true"]')).first().waitFor({ state: "hidden" })
      assert.equal(await previews.getByRole("status").count(), 0)
      await page.unroute("**/*.webp")
      await page.goto(`${url}help/`)
      await page.waitForFunction(
        () => document.querySelectorAll('nav .screencast-media[aria-busy="false"]').length === 2,
        undefined,
        { polling: 50 },
      )
      assert.equal(await previews.getByRole("status").count(), 0)
      await page.route("**/*.webp", (route) => route.abort())
      await page.clock.resume()
      await page.goto(`${url}help/booklet/`)
      await page.getByRole("tab", { name: "WebP", exact: true }).click()
      const player = page.getByRole("tabpanel")
      await player.getByRole("status").filter({ hasText: "Screencast could not load" }).waitFor()
      assert.equal(await player.getAttribute("aria-busy"), "false")
      await page.unroute("**/*.webp")
      await page.getByRole("tab", { name: "WebM", exact: true }).click()
      await page.getByRole("tab", { name: "WebP", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector('#screencast-player[aria-busy="false"] img')?.naturalWidth === 1920,
      )
      assert.equal(await player.getByRole("status").count(), 0)
    } finally {
      await browser.close()
    }
  }
})

test("Screencasts open from static paths with native playback", { timeout: 120000 }, async () => {
  const url = (await production()).resolvedUrls.local[0]
  assert.equal((await fetch(`${url}missing-entry`)).status, 404)
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ serviceWorkers: "block" })
      await page.addInitScript(() => {
        CSS.supports = () => false
      })
      const requests = []
      page.on("request", (request) => requests.push(new URL(request.url()).pathname))
      for (const path of ["help", "help/"]) {
        await page.goto(`${url}${path}`)
        const menu = page.getByRole("navigation", { name: "Screencasts", exact: true })
        await menu.waitFor()
        assert.equal(await menu.locator("a").count(), 2)
        assert.equal(await page.locator("video").count(), 0)
        const previews = await menu.locator("a").evaluateAll(async (links) => {
          const result = []
          for (const link of links) {
            const image = link.querySelector("img")
            await image.decode()
            const description = link.querySelector(".screencast-description")
            const hint = description.nextElementSibling
            result.push({
              box: link.getBoundingClientRect().toJSON(),
              title: link.querySelector("h2").getBoundingClientRect().toJSON(),
              image: image.getBoundingClientRect().toJSON(),
              descriptionBottom: description.getBoundingClientRect().bottom,
              hintTop: hint.getBoundingClientRect().top,
              hint: hint.textContent,
              width: image.naturalWidth,
              height: image.naturalHeight,
            })
          }
          return result
        })
        assert.ok(previews[1].box.y >= previews[0].box.bottom, "Screencasts form one vertical list")
        for (const entry of previews) {
          assert.equal(entry.width, 960)
          assert.equal(entry.height, 540)
          assert.equal(entry.hint, "Open a preview for higher resolution and more formats.")
          assert.ok(entry.hintTop >= entry.descriptionBottom, "The hint follows the screencast description")
          assert.ok(entry.title.x < entry.image.x, "Descriptions occupy the narrow leading column")
          assert.ok(Math.abs(entry.image.right - entry.box.right) < 1, "Previews align with the right edge of the list")
        }
        assert.ok(previews[1].image.bottom <= 720, "Two screencasts fit the desktop viewport")
      }
      assert.equal(
        requests.some((path) => /\.(?:webm|mp4|webp)$/.test(path) && !path.endsWith("/preview.webp")),
        false,
        "The screencast menu fetches only the small animations",
      )
      for (const [id, title] of [
        ["booklet", "Prepare a styled booklet"],
        ["recipe", "Save and reuse a booklet recipe"],
      ]) {
        for (const path of [`help/${id}`, `help/${id}/`]) {
          assert.equal((await page.goto(`${url}${path}`)).status(), 200, path)
          await page.getByRole("heading", { name: title, exact: true }).waitFor()
          const video = page.locator("video")
          assert.equal(await video.getAttribute("preload"), "none")
          assert.equal(await video.evaluate((element) => element.paused && !element.autoplay), true)
          assert.deepEqual(
            await page.getByRole("tablist", { name: "Screencast format" }).getByRole("tab").allTextContents(),
            ["WebP", "WebM", "MP4"],
          )
        }
      }
      assert.equal(
        requests.some((path) => /(?:App-|processor|pdfjs)/.test(path)),
        false,
        "Help does not load PDF processing",
      )
      for (const fallback of [false, true]) {
        await page.route("**/*.webm", (route) => (fallback ? route.abort() : route.continue()))
        await page.goto(`${url}help/booklet/`)
        const video = page.locator("video")
        await video.evaluate((element) => element.play())
        await page.waitForFunction(() => document.querySelector("video").currentTime > 0)
        const media = await video.evaluate((element) => ({
          width: element.videoWidth,
          height: element.videoHeight,
          src: element.currentSrc,
        }))
        assert.equal(media.width, 1920)
        assert.equal(media.height, 1080)
        const frame = await video.evaluate((element) => ({
          width: element.clientWidth,
          height: element.clientHeight,
          border: getComputedStyle(element).borderInlineWidth,
        }))
        assert.equal(frame.border, "0px")
        assert.ok(Math.abs(frame.width / frame.height - 16 / 9) < 0.005)
        if (fallback) assert.ok(media.src.endsWith(".mp4"), "MP4 plays when WebM cannot load")
        assert.equal(
          await page.getByRole("tab", { selected: true }).innerText(),
          media.src.endsWith(".mp4") ? "MP4" : "WebM",
        )
        await video.evaluate((element) => element.pause())
        await page.unroute("**/*.webm")
      }
      await page.getByRole("tab", { name: "WebP", exact: true }).click()
      await page.locator("#screencast-player img").waitFor()
      await page.locator("#screencast-player img").evaluate((element) => element.decode())
      assert.equal(await page.getByRole("tab", { name: "WebP", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(
        await page.locator("#screencast-player img").evaluate((element) => element.src),
        `${url}help/booklet/booklet.webp`,
      )
      await page.getByRole("tab", { name: "WebP", exact: true }).press("Tab")
      assert.equal(
        await page.getByRole("tabpanel").evaluate((panel) => panel === document.activeElement),
        true,
        "Keyboard focus reaches the screencast when its format has no native controls",
      )
      await page.getByRole("tab", { name: "WebP", exact: true }).press("ArrowRight")
      assert.equal(await page.getByRole("tab", { name: "WebM", exact: true }).getAttribute("aria-selected"), "true")
      await page.getByRole("tab", { name: "WebM", exact: true }).press("ArrowRight")
      assert.equal(await page.getByRole("tab", { name: "MP4", exact: true }).getAttribute("aria-selected"), "true")
      const explicit = page.locator("video")
      await explicit.evaluate((element) => element.play())
      await page.waitForFunction(() => document.querySelector("video").currentTime > 0)
      assert.ok((await explicit.evaluate((element) => element.currentSrc)).endsWith(".mp4"))
      await explicit.evaluate((element) => element.pause())
      for (const width of [320, 390, 768, 1440]) {
        for (const colorScheme of ["light", "dark"]) {
          await page.setViewportSize({ width, height: 1000 })
          await page.emulateMedia({ colorScheme })
          for (const size of ["100%", "200%"]) {
            await page.evaluate((value) => {
              document.documentElement.style.fontSize = value
            }, size)
            const icons = await page.evaluate(() => {
              const back = document.querySelector(".screencast-back svg path").getBoundingClientRect()
              const theme = [...document.querySelectorAll(".theme svg")]
                .find((svg) => getComputedStyle(svg).display !== "none")
                .querySelector("path, circle")
                .getBoundingClientRect()
              return Math.abs(back.y + back.height / 2 - theme.y - theme.height / 2)
            })
            assert.ok(icons < 1, `${engine.name()} ${width}px ${colorScheme}: header icon centers differ by ${icons}px`)
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
            for (const box of await page
              .locator(".screencast-formats button")
              .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().toJSON()))) {
              assert.ok(box.height >= 44 && box.x >= 0 && box.right <= width)
            }
          }
        }
      }
      await page.goto(`${url}help/`)
      await page.getByRole("navigation", { name: "Screencasts", exact: true }).waitFor()
      await page.keyboard.press("Tab")
      assert.equal(
        await page
          .getByRole("link", { name: "PDF Composer home", exact: true })
          .evaluate((link) => link.matches(":focus-visible")),
        true,
      )
      assert.equal(
        await page
          .getByRole("link", { name: "PDF Composer home", exact: true })
          .evaluate((link) => getComputedStyle(link).outlineWidth),
        "1px",
        "Screencasts retain the shared keyboard focus contour",
      )
    } finally {
      await browser.close()
    }
  }
})

test("Screencast previews stay reachable on portrait tablets", { timeout: 30000 }, async () => {
  const url = (await production()).resolvedUrls.local[0]
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ hasTouch: true, colorScheme: "dark", reducedMotion: "reduce" })
      for (const [width, height, fitsWithoutScroll] of [
        [744, 1109, true],
        [810, 1056, false],
        [834, 1170, false],
        [1024, 1342, true],
      ]) {
        await page.setViewportSize({ width, height })
        await page.goto(`${url}help/`)
        assert.equal(await page.evaluate(() => matchMedia("(pointer: coarse)").matches), true)
        const images = page.locator("nav img")
        assert.equal(await images.count(), 2)
        for (const preview of await images.all()) {
          if (!fitsWithoutScroll) await preview.scrollIntoViewIfNeeded()
          const image = await preview.evaluate((element) => element.getBoundingClientRect().toJSON())
          assert.ok(
            image.top >= -1 && image.bottom <= height + (fitsWithoutScroll ? -16 : 1),
            JSON.stringify({ width, height, image }),
          )
          assert.ok(image.left >= 0 && image.right <= width, JSON.stringify({ width, height, image }))
          assert.ok(Math.abs(image.width / image.height - 16 / 9) < 0.005)
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test(
  "Landing and Help link to screencasts without adding media to offline installation",
  { timeout: 30000 },
  async () => {
    const url = (await production()).resolvedUrls.local[0]
    const worker = await readFile(join(directory, "sw.js"), "utf8")
    const assets = JSON.parse(worker.match(/^const ASSETS = (.*);$/m)[1])
    assert.equal(
      assets.some((asset) => /^help\/.*\.(?:webm|mp4|webp|png)$/.test(asset.path)),
      false,
    )
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ serviceWorkers: "block", reducedMotion: "reduce" })
        await page.goto(url)
        const landing = page.getByRole("link", { name: "Get started with short screencasts", exact: true })
        await landing.waitFor()
        assert.equal(await landing.evaluate((link) => link.href), `${url}help/`)
        assert.equal(await landing.evaluate((link) => getComputedStyle(link).textDecorationLine), "none")
        await landing.hover()
        assert.notEqual(await landing.evaluate((link) => getComputedStyle(link).textShadow), "none")
        const landingTheme = page.getByRole("button", { name: "Dark theme", exact: true })
        await landingTheme.hover()
        const appThemeHover = await landingTheme.evaluate((button) => {
          const svg = [...button.querySelectorAll("svg")].find((node) => getComputedStyle(node).display !== "none")
          return {
            boxShadow: getComputedStyle(button).boxShadow,
            backgroundColor: getComputedStyle(button).backgroundColor,
            filter: getComputedStyle(svg).filter,
          }
        })
        await page.getByRole("button", { name: "Help", exact: true }).click()
        const help = page.getByRole("dialog", { name: "Help", exact: true })
        assert.equal(
          await help.locator(".help-screencasts p").evaluate((element) => getComputedStyle(element).fontWeight),
          "400",
        )
        for (const width of [320, 390, 768, 1440]) {
          for (const colorScheme of ["light", "dark"]) {
            await page.setViewportSize({ width, height: 1000 })
            await page.emulateMedia({ colorScheme })
            for (const text of ["100%", "200%"]) {
              await page.evaluate((size) => {
                document.documentElement.style.fontSize = size
              }, text)
              assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                `${engine.name()} ${width}px ${text}`,
              )
              const alignment = await landing.evaluate((link) => {
                const label = link.querySelector("span")
                const icon = link.querySelector("svg path").getBoundingClientRect()
                const font = getComputedStyle(label)
                const canvas = document.createElement("canvas").getContext("2d")
                canvas.font = font.font
                const letters = canvas.measureText(label.textContent)
                const marker = document.createElement("i")
                marker.style.display = "inline-block"
                label.prepend(marker)
                const top = marker.getBoundingClientRect().y - letters.actualBoundingBoxAscent
                label.append(marker)
                const bottom = marker.getBoundingClientRect().y + letters.actualBoundingBoxDescent
                marker.remove()
                return Math.abs((top + bottom) / 2 - (icon.y + icon.height / 2))
              })
              assert.ok(alignment <= 1.5, `${engine.name()} ${width}px ${text}: guide centers differ by ${alignment}px`)
              for (const link of [landing, help.getByRole("link", { name: "Watch the screencasts", exact: true })]) {
                const box = await link.boundingBox()
                assert.ok(
                  box.height >= 44 && box.x >= 0 && box.x + box.width <= width,
                  `${engine.name()} ${width}px ${text}: ${await link.getAttribute("class")} ${JSON.stringify(box)}`,
                )
              }
            }
          }
        }
        await page.evaluate(() => {
          document.documentElement.style.fontSize = "100%"
        })
        const frame = () =>
          page.evaluate(() =>
            [".masthead", ".header-inner", ".brand .logo", ".theme", "main"].map((selector) => {
              const box = document.querySelector(selector).getBoundingClientRect()
              return { x: box.x, y: box.y, width: box.width }
            }),
          )
        const original = await frame()
        await help.getByRole("link", { name: "Watch the screencasts", exact: true }).click()
        await page.getByRole("navigation", { name: "Screencasts", exact: true }).waitFor()
        assert.deepEqual(await frame(), original, "Screencasts reuse the application frame and logo dimensions")
        const theme = page.getByRole("button", { name: "Dark theme", exact: true })
        const readThemeStyle = () =>
          page.evaluate(() => ({
            scheme: getComputedStyle(document.documentElement).colorScheme,
            background: getComputedStyle(document.documentElement).backgroundColor,
          }))
        const initialStyle = await readThemeStyle()
        const previous = await theme.getAttribute("aria-pressed")
        await theme.click()
        assert.notEqual(await theme.getAttribute("aria-pressed"), previous)
        const chosen = await page.evaluate(() => document.documentElement.dataset.theme)
        const toggledStyle = await readThemeStyle()
        assert.equal(toggledStyle.scheme, chosen)
        assert.notEqual(toggledStyle.background, initialStyle.background)
        await page.reload()
        await theme.waitFor()
        assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), chosen)
        assert.equal(await page.evaluate(() => localStorage.getItem("mainz:theme")), chosen)
        assert.deepEqual(await readThemeStyle(), toggledStyle)
        await theme.hover()
        const helpThemeHover = await theme.evaluate((button) => {
          const svg = [...button.querySelectorAll("svg")].find((node) => getComputedStyle(node).display !== "none")
          return {
            boxShadow: getComputedStyle(button).boxShadow,
            backgroundColor: getComputedStyle(button).backgroundColor,
            filter: getComputedStyle(svg).filter,
          }
        })
        assert.equal(helpThemeHover.boxShadow, "none")
        assert.equal(helpThemeHover.backgroundColor, "rgba(0, 0, 0, 0)")
        assert.ok(helpThemeHover.filter.includes("drop-shadow("), helpThemeHover.filter)
        assert.deepEqual(helpThemeHover, appThemeHover)
        await theme.click()
        const revertedStyle = await readThemeStyle()
        assert.equal(revertedStyle.scheme, chosen === "light" ? "dark" : "light")
        assert.equal(revertedStyle.background, initialStyle.background)
        assert.equal(await page.locator("nav img").count(), 2)
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.waitForFunction(() =>
          [...document.querySelectorAll("nav img")].every((image) => image.currentSrc.endsWith(".webp")),
        )
        await page.emulateMedia({ reducedMotion: "reduce" })
        await page.waitForFunction(() =>
          [...document.querySelectorAll("nav img")].every((image) => image.currentSrc.endsWith(".png")),
        )
        await page.getByRole("link", { name: /Prepare a styled booklet/ }).click()
        await page.getByRole("heading", { name: "Prepare a styled booklet", exact: true }).waitFor()
      } finally {
        await browser.close()
      }
    }
  },
)
