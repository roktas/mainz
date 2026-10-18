// Checks Output edit animations across page actions and shortcuts.

import assert from "node:assert/strict"
import test from "node:test"
import { chromium } from "playwright"
import { createServer, tab } from "./browser.js"

test(
  "Output additions, removals, and moves animate across page actions and shortcuts",
  { timeout: 120000 },
  async (t) => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
    let browser
    try {
      await server.listen()
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      for (const [width, height, hasTouch, colorScheme, cpu] of [
        [1440, 1100, false, "light", 4],
        [1024, 768, true, "dark", 1],
        [810, 1080, true, "dark", 1],
        [390, 844, true, "light", 4],
      ]) {
        const page = await browser.newPage({
          viewport: { width, height },
          hasTouch,
          isMobile: hasTouch,
          colorScheme,
          reducedMotion: "no-preference",
        })
        await (await page.context().newCDPSession(page)).send("Emulation.setCPUThrottlingRate", { rate: cpu })
        t.diagnostic(`${width} × ${height}, ${colorScheme}, ${cpu}× CPU slowdown`)
        page.setDefaultTimeout(10000)
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo`)
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
        )
        await page.evaluate(() => {
          new MutationObserver(() => {
            document.querySelectorAll(".addition-preview, .removal-preview").forEach((element) => {
              element.getAnimations().forEach((animation) => {
                animation.pause()
                animation.currentTime = 0
              })
            })
          }).observe(document.body, { childList: true })
        })
        const output = page.locator(".composition-output")
        const workspace = page.locator(".mobile-workspace-tabs > button:last-child")
        if (await workspace.isVisible()) await workspace.click()
        const selection = output.getByLabel("Page selection", { exact: true })
        const total = async () => Number.parseInt(await output.locator(".composition-totals strong").textContent(), 10)
        const finish = async (flight) => {
          await flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.finish()))
          await page.waitForFunction(() => !document.querySelector(".addition-preview, .removal-preview"))
        }
        const addition = async (action, quantity = 1, blank = false) => {
          const before = await total()
          await action()
          const flight = page.locator(".addition-preview")
          await flight.waitFor()
          await flight.evaluate(async (element) => {
            await element.getAnimations()[0].ready
            await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
          })
          assert.equal(await flight.count(), 1, "Focus recovery does not cancel addition feedback")
          assert.equal(await total(), before + quantity, "Additions update the document before arrival")
          assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
          assert.equal(await output.locator(".composition-card[data-adding]").count(), quantity)
          if (blank)
            assert.equal(
              await flight.evaluate((canvas) => canvas.getContext("2d").getImageData(0, 0, 1, 1).data[3]),
              0,
              "A Blank preview does not copy its neighbor's PDF image",
            )
          await finish(flight)
          assert.equal(await output.locator("[data-adding]").count(), 0)
        }
        const removal = async (action, quantity = 1) => {
          const before = await total()
          await output.locator(".composition-card").evaluateAll((cards) => {
            for (const card of cards)
              card.addEventListener(
                "outrostart",
                () =>
                  queueMicrotask(() => {
                    for (const animation of card.getAnimations()) {
                      animation.pause()
                      animation.currentTime = 0
                    }
                  }),
                { once: true },
              )
          })
          await action()
          assert.equal(await total(), before - quantity, "Removal updates the document without waiting")
          const outgoing = output.locator(".composition-card.removing")
          await page.waitForFunction(
            (expected) => document.querySelectorAll(".composition-card.removing").length === expected,
            quantity,
          )
          assert.equal(
            await outgoing.evaluateAll((cards) =>
              cards.every(
                (card) =>
                  card.inert &&
                  card.getAttribute("aria-hidden") === "true" &&
                  card.getAnimations().some((a) => a.effect.getTiming().duration === 1200),
              ),
            ),
            true,
          )
          await outgoing.evaluateAll((cards) =>
            cards.forEach((card) =>
              card.getAnimations().forEach((animation) => {
                animation.currentTime = 600
              }),
            ),
          )
          assert.equal(
            await outgoing.evaluateAll((cards) =>
              cards.every((card) => {
                const style = getComputedStyle(card)
                return (
                  Number(style.opacity) > 0.3 &&
                  Number(style.opacity) < 0.7 &&
                  new DOMMatrixReadOnly(style.transform).a < 1
                )
              }),
            ),
            true,
            "Removed cards fade and shrink over 1200 ms",
          )
          const positions = await output.locator(".composition-card:not(.removing)").evaluateAll((cards) =>
            cards.map((card) => {
              const { x, y } = card.getBoundingClientRect()
              const grid = card.parentElement.getBoundingClientRect()
              return { id: card.id, x: x - grid.x, y: y - grid.y }
            }),
          )
          await outgoing.evaluateAll((cards) =>
            cards.forEach((card) => card.getAnimations().forEach((animation) => animation.finish())),
          )
          await page.waitForFunction(() => !document.querySelector(".composition-card.removing"))
          await page.waitForFunction(() => {
            const animations = document
              .querySelector(".composition-output .composition-grid")
              .getAnimations({ subtree: true })
              .filter((animation) => animation.effect.getTiming().duration === 800)
            if (!animations.length) return false
            for (const animation of animations) {
              animation.pause()
              animation.currentTime = 400
            }
            return true
          })
          const reflow = await output.locator(".composition-grid").evaluate((grid) =>
            grid
              .getAnimations({ subtree: true })
              .filter((animation) => animation.effect.getTiming().duration === 800)
              .map((animation) => {
                const card = animation.effect.target
                const middle = card.getBoundingClientRect()
                const frame = grid.getBoundingClientRect()
                animation.finish()
                const end = card.getBoundingClientRect()
                return {
                  id: card.id,
                  middle: { x: middle.x - frame.x, y: middle.y - frame.y },
                  end: { x: end.x - frame.x, y: end.y - frame.y },
                }
              }),
          )
          assert.ok(reflow.length, `${width}: remaining cards slide after the exit`)
          for (const { id, middle, end } of reflow) {
            const start = positions.find((position) => position.id === id)
            assert.ok(start, `${width}: reflow retains the remaining occurrence`)
            assert.ok(Math.hypot(middle.x - end.x, middle.y - end.y) > 1, `${width}: reflow has not snapped to its end`)
            assert.ok(Math.abs(2 * middle.x - start.x - end.x) < 1, `${width}: reflow x midpoint`)
            assert.ok(Math.abs(2 * middle.y - start.y - end.y) < 1, `${width}: reflow y midpoint`)
          }
        }
        await selection.fill("2-3")
        if (
          !(await output
            .locator(".inline-moves")
            .getByRole("button", { name: "Move selected pages later", exact: true })
            .isVisible())
        )
          await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".output-pages")
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.effect.getTiming().duration === 1200),
        )
        if (width === 1440) {
          const elapsed = await output.locator(".composition-grid").evaluate(async (grid) => {
            const moving = grid
              .getAnimations({ subtree: true })
              .find((animation) => animation.effect.getTiming().duration === 1200)
            const started = performance.now(),
              current = Number(moving.currentTime)
            await moving.finished
            return current + performance.now() - started
          })
          assert.ok(elapsed >= 1100 && elapsed < 4000, `The first move lasts 1200 ms: ${elapsed}`)
        } else
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((animation) => animation.finish()))
        await output.locator(".composition-grid").press("Control+ArrowLeft")
        await page.waitForFunction(() =>
          document
            .querySelector(".output-pages")
            ?.getAnimations({ subtree: true })
            .some((animation) => animation.effect.getTiming().duration === 1200),
        )
        await output
          .locator(".composition-grid")
          .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((animation) => animation.finish()))
        for (const density of ["Normal", "Compact"]) {
          t.diagnostic(`${width}: ${density} edit feedback`)
          await output.getByRole("button", { name: `${density} Output grid`, exact: true }).click()
          const clear = output.getByRole("button", { name: "Clear Output selection", exact: true })
          if (await clear.isVisible()) await clear.click()
          const details = async () => {
            if (density === "Compact")
              await output.getByRole("button", { name: "Details for Output page 1", exact: true }).click()
          }
          await details()
          await addition(() => output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click())
          await selection.fill("1-2")
          await addition(
            () => output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click(),
            2,
          )
          await selection.fill("1")
          await addition(() => output.locator(".composition-grid").press("Enter"))
          assert.equal(
            await output
              .locator(".composition-card.selected .page-image")
              .evaluate((element) => element === document.activeElement),
            true,
            "Keyboard duplication focuses the copy after arrival",
          )
          await selection.fill("1")
          await output.getByLabel("Output page actions", { exact: true }).click()
          await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("2")
          await addition(() => output.getByRole("button", { name: "Repeat selected pages", exact: true }).click())
          for (const label of ["Blank before first selected page", "Add blank page at end"]) {
            await output.getByLabel("Output page actions", { exact: true }).click()
            await addition(() => output.getByRole("button", { name: label, exact: true }).click(), 1, true)
          }
          await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
          await output.locator(".page-image").first().press("Home")
          await page.mouse.move(1, 1)
          await details()
          await removal(() => output.getByRole("button", { name: "Remove Output page 1", exact: true }).click())
          for (const action of [
            () => output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click(),
            () => selection.press("Enter"),
            () => output.locator(".composition-grid").press("Delete"),
            () => output.locator(".composition-grid").press("-"),
          ]) {
            await selection.fill("1")
            await removal(action)
          }
          await selection.fill("2-3")
          for (const direction of ["earlier", "later"]) {
            assert.equal(
              await output
                .locator(".inline-moves")
                .getByRole("button", {
                  name: `Move selected pages ${direction}`,
                  exact: true,
                })
                .isVisible(),
              width !== 390,
              `${width}: movement follows available pane width`,
            )
          }
          await selection.fill("1-2")
          const before = await output.locator(".composition-card").evaluateAll((cards) => cards.map((card) => card.id))
          await output.getByLabel("Output page actions", { exact: true }).click()
          await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
          await page.waitForFunction(() =>
            document
              .querySelector(".output-pages")
              ?.getAnimations({ subtree: true })
              .some((a) => a.effect.getTiming().duration === 1200),
          )
          const after = await output.locator(".composition-card").evaluateAll((cards) => cards.map((card) => card.id))
          assert.deepEqual(
            after.slice(0, 3),
            [before[2], before[0], before[1]],
            "Moves retain occurrence identity and print order",
          )
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((a) => a.finish()))
          await output.locator(".composition-grid").press("Control+ArrowLeft")
          await page.waitForFunction(() =>
            document
              .querySelector(".output-pages")
              ?.getAnimations({ subtree: true })
              .some((a) => a.effect.getTiming().duration === 1200),
          )
          await page.emulateMedia({ reducedMotion: "reduce" })
          await page.waitForFunction(
            () =>
              document
                .querySelector(".output-pages")
                ?.getAnimations({ subtree: true })
                .every((animation) => animation.playState !== "running"),
            undefined,
            { timeout: 500 },
          )
          await page.emulateMedia({ reducedMotion: "no-preference" })
          await output
            .locator(".composition-grid")
            .evaluate((grid) => grid.getAnimations({ subtree: true }).forEach((a) => a.finish()))
        }
        await selection.fill("1")
        await output.locator(".composition-grid").press("Enter")
        await page.locator(".addition-preview").waitFor()
        assert.equal(
          await output.locator(".composition-grid").evaluate((element) => element === document.activeElement),
          true,
          "Keyboard focus stays in Grid while a new copy is hidden",
        )
        await output.locator(".composition-grid").press("Home")
        const first = output.getByRole("button", { name: "Select Output page 1", exact: true })
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 1")
        await finish(page.locator(".addition-preview"))
        assert.equal(
          await first.evaluate((element) => element === document.activeElement),
          true,
          "Arrival preserves navigation during the preview",
        )
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
        await tab(output, "Page")
        await output.locator('.pdf-viewport[aria-busy="false"], .blank-sheet').waitFor()
        const copy = async () => {
          const sheet = output.locator(".page-scroll canvas, .blank-sheet")
          if (hasTouch) {
            await page.waitForTimeout(400)
            await sheet.tap()
            await sheet.tap()
          } else await sheet.dblclick()
        }
        let count = await total()
        for (const action of [copy, () => output.locator(".page-scroll").press("Space")]) {
          await action()
          assert.equal(await total(), ++count, `${width}: ${action.toString()}`)
          await page.locator(".addition-preview").waitFor()
          await finish(page.locator(".addition-preview"))
          assert.equal(await selection.inputValue(), "", "Page copies preserve the Output selection")
        }
        await output.getByRole("button", { name: /Remove Output page/, exact: false }).click()
        const flight = page.locator(".removal-preview")
        await flight.waitFor()
        assert.equal(await total(), --count)
        assert.equal(await flight.evaluate((element) => element.getAnimations()[0].effect.getTiming().duration), 1200)
        assert.equal(await output.locator(".inspection-target").getAttribute("data-removing"), "true")
        await finish(flight)
        assert.equal(await output.locator("[data-removing]").count(), 0)
        await selection.fill("1")
        await output.getByLabel("Output page actions", { exact: true }).click()
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".composition-output .page-scroll")
            ?.getAnimations({ subtree: true })
            .some((a) => a.effect.getTiming().duration === 1200),
        )
        await page.emulateMedia({ reducedMotion: "reduce" })
        await selection.fill("1")
        await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click()
        assert.equal(await total(), ++count)
        assert.equal(await page.locator(".addition-preview, .removal-preview").count(), 0)
        await selection.press("Enter")
        assert.equal(await total(), --count)
        assert.equal(await page.locator(".removal-preview").count(), 0)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        await selection.fill(`1-${count}`)
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
        assert.equal(await total(), 0)
        if (await workspace.isVisible()) await page.locator(".mobile-workspace-tabs > button:first-child").click()
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.locator(".selection-panel .thumbnail[aria-busy=false]").first().waitFor()
        await page.locator(".input-picker > summary").click()
        await page.getByRole("button", { name: "Remove Input", exact: true }).click()
        await page.locator(".removal-preview").first().waitFor()
        assert.equal(await page.locator(".selection-panel").count(), 0)
        assert.equal(
          await page
            .locator(".removal-preview")
            .evaluateAll((elements) =>
              elements.every(
                (element) =>
                  element.getAttribute("aria-hidden") === "true" &&
                  getComputedStyle(element).pointerEvents === "none" &&
                  element.getAnimations()[0].effect.getTiming().duration === 1200,
              ),
            ),
          true,
        )
        await page
          .locator(".removal-preview")
          .evaluateAll((elements) =>
            elements.forEach((element) => element.getAnimations().forEach((animation) => animation.finish())),
          )
        await page.waitForFunction(() => !document.querySelector(".removal-preview"))
        await page.close()
      }
    } finally {
      await browser?.close()
      await server.close()
    }
  },
)
