// Checks optional installation guidance, startup sequencing, and browser install outcomes.

import assert from "node:assert/strict"
import test from "node:test"
import { mkdir } from "node:fs/promises"
import { chromium, devices } from "playwright"
import { createServer } from "./browser.js"

test("Installation guidance stays optional and independent of the product tour", { timeout: 120000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
  let browser
  const directory = "../.local/tmp/web/installation"
  await mkdir(directory, { recursive: true })
  try {
    await server.listen()
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    for (const colorScheme of ["light", "dark"]) {
      const context = await browser.newContext({ ...devices["iPhone 13"], colorScheme, reducedMotion: "reduce" })
      try {
        const page = await context.newPage()
        await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
        const installation = page.getByRole("dialog", { name: "Install app", exact: true })
        const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
        await installation.waitFor()
        await page.locator(".composer").waitFor()
        assert.equal(await welcome.isVisible(), false)
        assert.equal(await installation.getByRole("button", { name: "Install app", exact: true }).count(), 0)
        await page.screenshot({ path: `${directory}/mobile-${colorScheme}.png` })
        const alignment = await installation.evaluate((element) => {
          const title = element.querySelector("h2").getBoundingClientRect()
          const icon = element.querySelector(".icon-button svg").getBoundingClientRect()
          return {
            offset: Math.abs(title.y + title.height / 2 - icon.y - icon.height / 2),
            fits: element.scrollWidth <= element.clientWidth,
          }
        })
        assert.ok(alignment.offset < 1 && alignment.fits)
        await page.setViewportSize({ width: 320, height: 667 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        assert.equal(await installation.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
        await page.screenshot({ path: `${directory}/mobile-enlarged-${colorScheme}.png` })
        await installation.getByRole("button", { name: "Continue in browser", exact: true }).click()
        assert.match(await page.locator(".notice").textContent(), /If you change your mind, open Help → App/)
        await welcome.waitFor()
        assert.equal(await installation.isVisible(), false)
        assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), null)
        await welcome.getByRole("button", { name: "Skip", exact: true }).click()
        await page.reload()
        await page.locator(".composer").waitFor()
        assert.equal(await installation.isVisible(), false)
        assert.equal(await welcome.isVisible(), false)
        const helpButton = page.getByRole("button", { name: "Help", exact: true })
        const help = page.getByRole("dialog", { name: "Help", exact: true })
        await helpButton.click()
        assert.deepEqual(await help.getByRole("tab").allTextContents(), ["Touch", "App"])
        await help.getByRole("tab", { name: "App", exact: true }).click()
        assert.match(await help.getByRole("tabpanel", { name: "App", exact: true }).textContent(), /Add to Home Screen/)
        assert.equal(await page.locator("dialog[open]").count(), 1)
        await page.keyboard.press("Escape")
        await help.waitFor({ state: "hidden" })
        assert.equal(await helpButton.evaluate((element) => element === document.activeElement), true)
        assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), "19")
        await page.goto(server.resolvedUrls.local[0])
        assert.equal(
          await installation.isVisible(),
          false,
          "Skipping the first recommendation suppresses later startup prompts",
        )
        await helpButton.click()
        assert.deepEqual(await help.getByRole("tab").allTextContents(), ["App"])
        assert.equal(await help.getByRole("button", { name: "Start Tour", exact: true }).count(), 0)
        await help.getByRole("button", { name: "Close help", exact: true }).click()
      } finally {
        await context.close()
      }
    }
    for (const storage of ["standalone", "unavailable"]) {
      const context = await browser.newContext({ ...devices["iPhone 13"], reducedMotion: "reduce" })
      try {
        const page = await context.newPage()
        await page.addInitScript((mode) => {
          if (mode === "standalone") Object.defineProperty(navigator, "standalone", { value: true })
          else {
            Storage.prototype.getItem = () => {
              throw new DOMException("Storage unavailable", "SecurityError")
            }
            Storage.prototype.setItem = () => {
              throw new DOMException("Storage unavailable", "SecurityError")
            }
          }
        }, storage)
        await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`)
        const installation = page.getByRole("dialog", { name: "Install app", exact: true })
        const welcome = page.getByRole("dialog", { name: "Welcome to PDF Composer", exact: true })
        if (storage === "unavailable") {
          await installation.waitFor()
          await installation.getByRole("button", { name: "Close installation help", exact: true }).click()
        }
        await welcome.waitFor()
        assert.equal(await installation.isVisible(), false)
        await welcome.getByRole("button", { name: "Skip", exact: true }).click()
      } finally {
        await context.close()
      }
    }
    const context = await browser.newContext({ reducedMotion: "reduce" })
    try {
      const page = await context.newPage()
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`)
      await page.locator(".composer").waitFor()
      const installation = page.getByRole("dialog", { name: "Help", exact: true })
      assert.equal(await installation.isVisible(), false, "Desktop startup stays quiet")
      for (const outcome of ["dismissed", "accepted", "error"]) {
        await page.getByRole("button", { name: "Help", exact: true }).click()
        assert.deepEqual(await installation.getByRole("tab").allTextContents(), ["Keyboard", "Mouse", "App"])
        await installation.getByRole("tab", { name: "App", exact: true }).click()
        await page.screenshot({ path: `${directory}/desktop-${outcome}.png` })
        await page.evaluate((result) => {
          const event = new Event("beforeinstallprompt", { cancelable: true })
          event.prompt = async () => {
            if (!navigator.userActivation.isActive) throw new Error("A user gesture is required")
            if (result === "error") throw new Error("Installation unavailable")
          }
          event.userChoice = Promise.resolve({ outcome: result })
          window.dispatchEvent(event)
        }, outcome)
        await installation.getByRole("button", { name: "Install app", exact: true }).click()
        await installation.getByRole("status").waitFor()
        assert.match(
          await installation.getByRole("status").textContent(),
          outcome === "accepted" ? /Installation requested/ : /continue in this browser/,
        )
        assert.equal(await installation.getByRole("button", { name: "Install app", exact: true }).count(), 0)
        await installation.getByRole("button", { name: "Close help", exact: true }).click()
      }
    } finally {
      await context.close()
    }
  } finally {
    await browser?.close()
    await server.close()
  }
})
