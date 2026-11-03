// Checks named Output PDFs, native sharing and printing, and floating Style editors through the workspace.

import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, resolve as resolvePath } from "node:path"
import { chromium, webkit } from "playwright"
import { serve } from "./server.ts"
import { fixture, tab, trackWorkers } from "./browser.js"

const inventory = JSON.parse(await readFile(new URL("./viewports.json", import.meta.url), "utf8"))

test(
  "Recipe matching shows long descriptions below titles in equal rows and keeps borderless actions",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const recipe = JSON.parse(await readFile(new URL("./fixtures/recipe/session.json", import.meta.url), "utf8"))
    for (const input of Object.values(recipe.inputs)) {
      input.xmp ??= {}
      input.xmp["dc:description"] =
        "A practical collection of prepared pages for pen movement, rhythm and deliberate letterforms"
    }
    const file = {
      name: "practice-session.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recipe)),
    }
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await page.goto(server.resolvedUrls.local[0])
        await page.locator(".landing-recipe input").setInputFiles(file)
        const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
        await panel.locator(".binding-row").first().waitFor()
        for (const width of [1440, 768, 390, 375, 320]) {
          await page.setViewportSize({ width, height: width === 375 ? 667 : width === 768 ? 1024 : 1000 })
          for (const text of ["100%", "200%"]) {
            await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
            for (const colorScheme of ["light", "dark"]) {
              await page.emulateMedia({ colorScheme })
              await panel.locator(".binding-description").first().waitFor({ state: "attached" })
              const layout = () =>
                panel.evaluate((element) => {
                  const rows = [...element.querySelectorAll(".binding-row")].map((row) => {
                    const box = row.getBoundingClientRect()
                    return [box.y + scrollY, box.height]
                  })
                  const actions = element.querySelector(".load-actions").getBoundingClientRect()
                  return {
                    rows,
                    actions: actions.y + scrollY,
                    width: element.clientWidth,
                    content: element.scrollWidth,
                  }
                })
              const before = await layout()
              if (width === 375 && text === "100%")
                assert.ok(
                  before.rows[1][0] + before.rows[1][1] <= 667,
                  `${engine.name()}: two complete Inputs fit on iPhone SE`,
                )
              assert.ok(before.content <= before.width + 1, `${engine.name()}, ${width}px, ${text}: no overflow`)
              const narrow = await panel
                .locator(".binding-source")
                .first()
                .evaluate((element) => getComputedStyle(element).display === "contents")
              if (!narrow)
                assert.ok(
                  before.rows.every(([, height]) => Math.abs(height - before.rows[0][1]) < 1),
                  "equal desktop Input rows",
                )
              const titleStyle = await panel
                .locator(".binding-identity")
                .first()
                .evaluate((element) => {
                  const title = getComputedStyle(element.querySelector("h2"))
                  const full = getComputedStyle(element.querySelector(".binding-description"))
                  return {
                    size: parseFloat(full.fontSize) < parseFloat(title.fontSize),
                    muted: full.color !== title.color,
                  }
                })
              assert.ok(titleStyle.size && titleStyle.muted, "description is smaller and muted")
              const compact = await panel.evaluate((element) => {
                const row = element.querySelector(".binding-row")
                if (getComputedStyle(row.querySelector(".binding-source")).display !== "contents") return
                const box = (selector) => row.querySelector(selector).getBoundingClientRect()
                const cover = box(".binding-cover"),
                  target = box(".binding-target"),
                  title = box("h2"),
                  meta = box(".binding-meta")
                const choices = [...element.querySelectorAll(".load-choices > :is(button,label)")].map((button) =>
                  button.getBoundingClientRect(),
                )
                return {
                  paired:
                    Math.abs(cover.y - target.y) < 1 &&
                    Math.abs(cover.height - target.height) < 1 &&
                    cover.right < target.x,
                  title: title.bottom <= cover.y,
                  meta: Math.abs(meta.y + meta.height / 2 - title.y - title.height / 2) < 1 && meta.x > title.right,
                  hint: getComputedStyle(row.querySelector(".binding-pick > .control-description")).display === "none",
                  logo: getComputedStyle(element.querySelector(".load-mark")).display === "none",
                  choices: choices.every(
                    (button) =>
                      Math.abs(button.y - choices[0].y) < 1 &&
                      Math.abs(button.width - choices[0].width) < 1 &&
                      Math.abs(button.height - choices[0].height) < 1,
                  ),
                }
              })
              if (compact)
                assert.ok(
                  Object.values(compact).every(Boolean),
                  `${engine.name()}, ${width}px, ${text}: ${JSON.stringify(compact)}`,
                )
              assert.equal(await panel.locator(".binding-description").first().isVisible(), !compact)
              if (compact) {
                const title = panel.locator(".binding-heading h2 .guidance-label").first()
                await title.click()
                const details = page.locator(".guidance:popover-open")
                await details.waitFor()
                assert.match(await details.innerText(), /A practical collection/)
                const after = await layout()
                assert.deepEqual(after.rows, before.rows, "Reading a long title does not move Input rows")
                await page.keyboard.press("Escape")
              }

              for (const action of [
                panel.getByRole("button", { name: "Back", exact: true }),
                panel.locator(".guidance-trigger").first(),
              ]) {
                await action.hover()
                const style = await action.evaluate((element) => {
                  const computed = getComputedStyle(element)
                  return {
                    border: computed.borderWidth,
                    background: computed.backgroundColor,
                    shadow: computed.boxShadow,
                    glow: getComputedStyle(element.querySelector("svg")).filter,
                  }
                })
                assert.equal(style.border, "0px")
                assert.equal(style.background, "rgba(0, 0, 0, 0)")
                if ((await action.getAttribute("class")) === "load-back") {
                  assert.equal(style.shadow, "none")
                  assert.notEqual(style.glow, "none")
                } else assert.equal(style.shadow, "none", "Information icons have no surrounding halo")
              }
            }
          }
        }
        await page.setViewportSize({ width: 1440, height: 1000 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        const header = await panel.locator(".load-heading").evaluate((element) => {
          const back = element.querySelector(".load-back").getBoundingClientRect()
          const name = element.querySelector(".load-name").getBoundingClientRect()
          const mark = element.querySelector(".load-mark").getBoundingClientRect()
          const arrow = element.querySelector(".load-back svg").getBoundingClientRect()
          const heading = element.querySelector("h1").getBoundingClientRect()
          const visibleTop = (selector) => {
            const svg = element.querySelector(selector)
            return new DOMPoint(0, svg.getBBox().y).matrixTransform(svg.getScreenCTM()).y
          }
          return {
            sameRow: Math.abs(back.y + back.height / 2 - name.y - name.height / 2) < 1,
            gap: name.x - back.right,
            logo: mark.width,
            top: Math.abs(visibleTop(".load-mark svg") - visibleTop(".load-back svg")),
            above: heading.y - back.bottom,
            left: Math.abs(arrow.x + (arrow.width * 8.2) / 24 - heading.x),
          }
        })
        assert.ok(
          header.sameRow && header.gap >= 16 && header.logo >= 190 && header.left < 1 && header.top < 1,
          JSON.stringify(header),
        )
        assert.ok(header.above <= 36, "Recipe heading keeps a compact gap below the filename")
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.getByRole("button", { name: "Replay logo animation", exact: true }).click()
        await page.waitForFunction(() =>
          document
            .querySelector(".load-mark")
            .getAnimations()
            .every((animation) => animation.playState === "finished"),
        )
        const zone = await panel.locator(".load-heading").boundingBox()
        await page.mouse.move(zone.x + zone.width - 8, zone.y + zone.height / 2)
        await page.waitForFunction(
          () => parseFloat(document.querySelector(".load-mark").style.getPropertyValue("--logo-x")) > 0,
        )
        await page.emulateMedia({ reducedMotion: "reduce" })
        assert.equal(
          await panel.locator(".load-mark .logo").evaluate((element) => getComputedStyle(element).transform),
          "none",
        )
        await panel.getByRole("button", { name: "Back", exact: true }).click()
        assert.ok(await page.locator(".drop-zone").isVisible())
        assert.equal(
          await page.locator(".landing-recipe input").evaluate((element) => element === document.activeElement),
          true,
        )
        await page
          .locator(".landing-recipe input")
          .setInputFiles({ name: "invalid.json", mimeType: "application/json", buffer: Buffer.from("{") })
        await panel.getByRole("alert").waitFor()
        await panel.getByRole("button", { name: "Cancel", exact: true }).click()
        assert.ok(await page.locator(".drop-zone").isVisible())
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Recipe demo matches its sample PDFs and Blank-only Recipes open an editable Output",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.goto(`${server.resolvedUrls.local[0]}?demo=recipe`)
      const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
      await panel.locator(".binding-row").first().waitFor()
      assert.equal(await panel.locator(".binding-row").count(), 3)
      assert.equal(await panel.evaluate((element) => getComputedStyle(element).outlineColor), "rgba(0, 0, 0, 0)")
      await page.keyboard.press("Tab")
      const back = panel.getByRole("button", { name: "Back", exact: true })
      assert.equal(
        await back.evaluate((element) => element === document.activeElement && element.matches(":focus-visible")),
        true,
      )
      assert.deepEqual(
        (await panel.locator(".load-choices > :is(button,label)").allTextContents()).map((text) => text.trim()),
        ["Use sample PDFs", "Choose local PDFs"],
      )
      assert.equal(await panel.locator(".binding-target .load-download").count(), 0)
      const aligned = await panel.evaluate((element) => {
        const options = [...element.querySelectorAll(".load-choices > :is(button,label)")].map((item) =>
          item.getBoundingClientRect(),
        )
        const rows = [...element.querySelectorAll(".binding-row")].map((row) => {
          const cover = row.querySelector(".binding-cover").getBoundingClientRect()
          const target = row.querySelector(".binding-target").getBoundingClientRect()
          const pick = row.querySelector(".binding-pick").getBoundingClientRect()
          const meta = row.querySelector(".binding-meta").getBoundingClientRect()
          const actions = [...row.querySelector(".binding-pick").children].map((item) => item.getBoundingClientRect())
          return {
            height: Math.abs(cover.height - target.height),
            center: Math.max(
              Math.abs(pick.y + pick.height / 2 - target.y - target.height / 2),
              Math.abs(pick.x + pick.width / 2 - target.x - target.width / 2),
            ),
            meta: Math.abs(meta.bottom - cover.bottom),
            sameRow: actions.every(
              (item) => Math.abs(item.y + item.height / 2 - actions[0].y - actions[0].height / 2) < 1,
            ),
          }
        })
        return {
          options: options.every(
            (item) =>
              Math.abs(item.y - options[0].y) < 1 &&
              Math.abs(item.height - options[0].height) < 1 &&
              Math.abs(item.width - options[0].width) < 1,
          ),
          rows,
        }
      })
      assert.ok(aligned.options, "local and sample choices share a row and dimensions")
      assert.ok(
        aligned.rows.every((row) => row.height < 1 && row.center < 1 && row.meta < 1 && row.sameRow),
        JSON.stringify(aligned.rows),
      )
      const dimensions = await panel
        .locator(".binding-empty, .load-actions > button")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
      assert.ok(
        dimensions.every(
          (button) =>
            Math.abs(button.width - dimensions[0].width) < 1 && Math.abs(button.height - dimensions[0].height) < 1,
        ),
        "PDF choices, Cancel, and Apply recipe share dimensions",
      )
      await panel.locator(".binding-meta .guidance-trigger").first().click()
      const details = page.locator(".guidance:popover-open")
      assert.deepEqual(await details.locator(".guidance-text strong").allTextContents(), ["Title:", "Producer:"])
      await page.keyboard.press("Escape")
      await page.locator(".footnote").getByText("0 of 3 Inputs selected · 3 remaining", { exact: true }).waitFor()

      for (const width of [1440, 768, 390, 375, 320]) {
        await page.setViewportSize({ width, height: width === 375 ? 667 : width === 768 ? 1024 : 1000 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const bounds = await panel.evaluate((element) => ({
            width: element.clientWidth,
            content: element.scrollWidth,
          }))
          assert.ok(bounds.content <= bounds.width + 1, `${width}px, ${text}: matching stays within the landing frame`)
          assert.equal(
            await panel
              .locator(".binding-empty")
              .evaluateAll((elements) =>
                elements.every(
                  (element) =>
                    element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
                ),
              ),
            true,
            `${width}px, ${text}: PDF choices keep all visible content inside the button`,
          )
          if (width === 375 && text === "100%") {
            for (const family of ["", "DejaVu Sans, sans-serif"]) {
              await page.evaluate((font) => (document.body.style.fontFamily = font), family)
              const bottom = await panel
                .locator(".binding-row")
                .nth(1)
                .evaluate((row) => row.getBoundingClientRect().bottom)
              assert.ok(bottom <= 667, `Two complete Inputs fit on iPhone SE (${family || "system font"}): ${bottom}`)
            }
            await page.evaluate(() => (document.body.style.fontFamily = ""))
          }
          const choices = await panel
            .locator(".load-choices > :is(button,label)")
            .evaluateAll((buttons) => buttons.map((button) => button.getBoundingClientRect().toJSON()))
          assert.ok(
            choices.every(
              (button) =>
                Math.abs(button.y - choices[0].y) < 1 &&
                Math.abs(button.width - choices[0].width) < 1 &&
                Math.abs(button.height - choices[0].height) < 1,
            ),
            `${width}px, ${text}: sample and local choices stay side by side`,
          )
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await panel.getByRole("button", { name: "Use sample PDFs", exact: true }).click()
      await page
        .locator(".footnote")
        .getByText("3 of 3 Inputs selected · Ready to apply recipe", { exact: true })
        .waitFor()
      for (const width of [1440, 768, 390, 375, 320]) {
        await page.setViewportSize({ width, height: width === 375 ? 667 : width === 768 ? 1024 : 1000 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((value) => (document.documentElement.style.fontSize = value), text)
          const layout = await panel.evaluate((element) => {
            const outer = element.getBoundingClientRect()
            const boxes = [...element.querySelectorAll(".bound")].map((target) => {
              const bounds = target.getBoundingClientRect()
              const actions = target.querySelector(".binding-pick").getBoundingClientRect()
              const result = target.querySelector(".binding-result").getBoundingClientRect()
              const change = target.querySelector(".file-picker").getBoundingClientRect()
              const download = target.querySelector(".load-download").getBoundingClientRect()
              const style = getComputedStyle(target.querySelector(".file-picker"))
              return {
                centered:
                  Math.abs(
                    (Math.min(result.y, actions.y) + Math.max(result.bottom, actions.bottom)) / 2 -
                      bounds.y -
                      bounds.height / 2,
                  ) < 1,
                peers: Math.abs(change.y + change.height / 2 - download.y - download.height / 2) < 1,
                single: style.flexWrap === "nowrap",
                padding: style.paddingInlineStart === style.paddingInlineEnd,
                fits: target.scrollWidth <= target.clientWidth + 1,
              }
            })
            const actions = element.querySelector(".load-actions").getBoundingClientRect()
            const buttons = [...element.querySelectorAll(".load-actions button")].map((button) =>
              button.getBoundingClientRect(),
            )
            const first = Math.min(...buttons.map((button) => button.y))
            const last = Math.max(...buttons.map((button) => button.bottom))
            return {
              boxes,
              fits: element.scrollWidth <= element.clientWidth + 1,
              footer: Math.abs(first - actions.y - (outer.bottom - last)) < 2,
              buttons: [...element.querySelectorAll(".bound .file-picker, .load-actions button")].map((button) => {
                const box = button.getBoundingClientRect()
                return [box.width, box.height]
              }),
            }
          })
          assert.ok(
            layout.fits &&
              layout.footer &&
              layout.boxes.every((box) => box.centered && box.peers && box.single && box.padding && box.fits),
            `${width}px, ${text}: ${JSON.stringify(layout)}`,
          )
          if (width === 1440 && text === "100%")
            assert.ok(
              layout.buttons.every(
                ([buttonWidth, height]) =>
                  Math.abs(buttonWidth - layout.buttons[0][0]) < 1 && Math.abs(height - layout.buttons[0][1]) < 1,
              ),
              "Change PDF and footer actions share dimensions",
            )
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      for (const download of [
        panel.getByRole("link", { name: "Download recipe JSON", exact: true }),
        panel.getByRole("button", { name: "Download book.pdf", exact: true }),
      ]) {
        await download.hover()
        const style = await download.evaluate((element) => {
          const computed = getComputedStyle(element)
          return { background: computed.backgroundColor, shadow: computed.boxShadow }
        })
        assert.equal(style.background, "rgba(0, 0, 0, 0)")
        assert.equal(style.shadow, "none")
      }
      const savedPDF = page.waitForEvent("download")
      await panel.getByRole("button", { name: "Download book.pdf", exact: true }).click()
      const saved = await savedPDF
      assert.equal(saved.suggestedFilename(), "book.pdf")
      assert.deepEqual(
        await readFile(await saved.path()),
        await readFile(new URL("./fixtures/demo.pdf", import.meta.url)),
      )
      await panel.getByRole("button", { name: "Apply recipe", exact: true }).click()
      await panel.waitFor({ state: "hidden" })
      assert.equal(await page.locator(".composition-totals strong").textContent(), "3 pages")
      assert.equal(await page.locator(".input-picker .count").textContent(), "3")
      const output = page.locator(".composition-output")
      await tab(output, "List")
      assert.deepEqual(
        (await output.locator(".list-number .page-origin > button").allTextContents()).map((text) => text.trim()),
        ["1", "2", "3"],
        "Output rows show one unambiguous position",
      )
      await output.getByRole("button", { name: "Details for Output page 2", exact: true }).click()
      await page.locator(".card-menu-options:popover-open").getByText("Input page 1", { exact: true }).waitFor()
      await page.keyboard.press("Escape")
      const reference = JSON.parse(await readFile(new URL("./fixtures/recipe/session.json", import.meta.url), "utf8"))
      assert.deepEqual(
        (await page.locator(".input-choice-title").allTextContents()).toSorted(),
        Object.values(reference.inputs)
          .map((input) => input.title)
          .toSorted(),
        "selected PDFs retain the saved XMP titles",
      )
      await page.locator(".input-picker > summary h2").click()
      const menu = await page.locator(".input-list").evaluate((element) => {
        const choices = [...element.querySelectorAll(".input-choice > button:not(.icon-button)")].map((button) =>
          button.getBoundingClientRect(),
        )
        const remove = element.querySelector(":scope > button").getBoundingClientRect()
        return {
          peers: choices.every(
            (box) => Math.abs(box.width - choices[0].width) < 1 && Math.abs(box.height - choices[0].height) < 1,
          ),
          aligned: Math.abs(remove.right - choices[0].right) < 1,
          compact: remove.width <= choices[0].width && remove.height <= choices[0].height,
        }
      })
      assert.ok(menu.peers && menu.aligned && menu.compact, JSON.stringify(menu))
      await page.keyboard.press("Escape")
      await page.getByRole("button", { name: "Export recipe", exact: true }).click()
      const exported = page.getByRole("dialog", { name: "Export recipe", exact: true })
      await exported.locator(".recipe-title").first().waitFor()
      assert.deepEqual(await exported.getByRole("columnheader").allTextContents(), ["Name", "Index", "Path", "Title"])
      assert.deepEqual(
        (await exported.locator(".recipe-title").allTextContents()).toSorted(),
        Object.values(reference.inputs)
          .map((input) => input.title)
          .toSorted(),
      )
      await exported.getByRole("button", { name: "Close recipe", exact: true }).click()
      await page.close()
      const blank = await browser.newPage({ reducedMotion: "reduce" })
      await blank.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await blank.goto(server.resolvedUrls.local[0])
      await blank.locator('.landing-recipe input[type="file"]').setInputFiles({
        name: "blank.json",
        mimeType: "application/json",
        buffer: Buffer.from(
          JSON.stringify({
            version: 1,
            inputs: {},
            sources: {},
            parts: [{ pages: [{ blank: { width: 80, height: 100 } }], copies: 2 }],
          }),
        ),
      })
      const loading = blank.getByRole("region", { name: "Choose your source PDFs", exact: true })
      await loading.getByText("This Recipe uses only blank pages and needs no PDFs.", { exact: true }).waitFor()
      await loading.getByRole("button", { name: "Apply recipe", exact: true }).click()
      await loading.waitFor({ state: "hidden" })
      assert.equal(await blank.locator(".composition-totals strong").textContent(), "2 pages")
      assert.ok(await blank.locator(".composer").isVisible())
    } finally {
      await browser.close()
    }
  },
)

test("Recipe batches match named PDFs first and discard abandoned reads", { timeout: 60000 }, async () => {
  const server = await serve()
  const record = {
    version: 1,
    inputs: { book: {}, guides: {}, crossings: {} },
    sources: { book: { input: "book" }, guides: { input: "guides" }, crossings: { input: "crossings" } },
    parts: [
      {
        pages: [
          { source: "book", page: 0 },
          { source: "guides", page: 0 },
          { source: "crossings", page: 0 },
        ],
      },
    ],
  }
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    const picker = page.locator(".landing-recipe input")
    const file = { name: "bindings.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) }
    await picker.setInputFiles(file)
    const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
    const rows = panel.locator(".binding-row")
    await rows.first().waitFor()
    const bytes = fixture({ prepared: false })
    const pdf = (name) => ({ name, mimeType: "application/pdf", buffer: bytes })
    await panel.locator(".load-choices input").setInputFiles([pdf("unmatched.pdf"), pdf("book.pdf"), pdf("guides.PDF")])
    await panel.getByRole("button", { name: "Apply recipe", exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll(".binding-target.bound").length === 3)
    assert.deepEqual(
      await rows.evaluateAll((elements) =>
        Object.fromEntries(
          elements.map((row) => [
            row.querySelector("code").textContent,
            row.querySelector(".binding-file").textContent,
          ]),
        ),
      ),
      { book: "book.pdf", guides: "guides.PDF", crossings: "unmatched.pdf" },
    )
    await rows
      .first()
      .locator("input")
      .setInputFiles({ name: "broken.pdf", mimeType: "application/pdf", buffer: Buffer.from("bad") })
    await panel.getByRole("alert").waitFor()
    assert.equal(
      await rows.first().locator(".binding-file").textContent(),
      "book.pdf",
      "Failed replacements retain the previous PDF",
    )
    await panel.getByRole("button", { name: "Back", exact: true }).click()
    await picker.setInputFiles(file)
    await rows.first().waitFor()
    await page.evaluate(() => {
      const read = File.prototype.arrayBuffer
      window.readFiles = []
      File.prototype.arrayBuffer = async function () {
        window.readFiles.push(this.name)
        if (this.name === "Held.pdf" || this.name === "delayed.json")
          await new Promise((resolve) => (window.releaseRead = resolve))
        return read.call(this)
      }
    })
    await panel.locator(".load-choices input").setInputFiles([pdf("Held.pdf"), pdf("Unopened.pdf")])
    await page.waitForFunction(() => !!window.releaseRead)
    await panel.getByRole("button", { name: "Back", exact: true }).click()
    await picker.setInputFiles(file)
    await rows.first().waitFor()
    await page.evaluate(() => window.releaseRead())
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.deepEqual(await page.evaluate(() => window.readFiles), ["Held.pdf", "bindings.json"])
    assert.equal(await panel.locator(".bound").count(), 0)
    await panel.getByRole("button", { name: "Back", exact: true }).click()
    await page.evaluate(() => (window.releaseRead = undefined))
    await picker.setInputFiles({ ...file, name: "delayed.json" })
    await page.waitForFunction(() => !!window.releaseRead)
    await panel.getByRole("button", { name: "Back", exact: true }).click()
    await picker.setInputFiles({
      ...file,
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          inputs: {},
          sources: {},
          parts: [{ pages: [{ blank: { width: 80, height: 100 } }] }],
        }),
      ),
    })
    await panel.getByText("This Recipe uses only blank pages and needs no PDFs.", { exact: true }).waitFor()
    await page.evaluate(() => window.releaseRead())
    await page.evaluate(() => new Promise(requestAnimationFrame))
    await panel.getByRole("button", { name: "Apply recipe", exact: true }).click()
    await panel.waitFor({ state: "hidden" })
    assert.equal(await page.locator(".composition-totals strong").textContent(), "1 page")
    await page.close()
    const interrupted = await browser.newPage({ reducedMotion: "reduce" })
    let releaseDemo
    const waiting = new Promise((resolve) => (releaseDemo = resolve))
    await interrupted.route("**/recipe.json", async (route) => {
      await waiting
      await route.continue()
    })
    await interrupted.goto(`${server.resolvedUrls.local[0]}?demo=recipe`, { waitUntil: "domcontentloaded" })
    await interrupted.locator(".landing-recipe input").setInputFiles({
      ...file,
      buffer: Buffer.from(
        JSON.stringify({
          version: 1,
          inputs: {},
          sources: {},
          parts: [{ pages: [{ blank: { width: 80, height: 100 } }] }],
        }),
      ),
    })
    const local = interrupted.getByText("This Recipe uses only blank pages and needs no PDFs.", { exact: true })
    await local.waitFor()
    const resumed = interrupted.waitForResponse((response) => response.url().endsWith("/recipe.json"))
    releaseDemo()
    await resumed
    await interrupted.evaluate(() => new Promise(requestAnimationFrame))
    assert.ok(await local.isVisible(), "A delayed demo cannot replace a user-selected Recipe")
  } finally {
    await browser.close()
  }
})

test("Opaque Input names load and export without optional cover previews", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    page.setDefaultTimeout(5000)
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(server.resolvedUrls.local[0])
    const names = ["__proto__", "constructor"]
    const record = {
      version: 1,
      inputs: Object.fromEntries(names.map((name) => [name, { title: "   " }])),
      sources: Object.fromEntries(names.map((name) => [name, { input: name }])),
      parts: [{ pages: names.map((source) => ({ source, page: 0 })) }],
    }
    await page
      .locator(".landing-recipe input")
      .setInputFiles({ name: "opaque.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) })
    const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
    await panel.locator(".binding-row").first().waitFor()
    assert.deepEqual(await panel.locator(".binding-row h2").allTextContents(), names)
    await panel.locator(".load-choices input").setInputFiles(
      names.map((name) => ({
        name: `${name}.pdf`,
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false }),
      })),
    )
    await page.waitForFunction(() => document.querySelectorAll(".binding-target.bound").length === 2)
    await panel.getByRole("button", { name: "Apply recipe", exact: true }).click()
    await panel.waitFor({ state: "hidden" })
    assert.equal(await page.locator(".composition-totals strong").textContent(), "2 pages")
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toDataURL = () => {
        throw new Error("Cover encoding unavailable")
      }
    })
    await page.getByRole("button", { name: "Export recipe", exact: true }).click()
    const exported = page.getByRole("dialog", { name: "Export recipe", exact: true })
    await exported.locator(".recipe-title").first().waitFor()
    const pending = page.waitForEvent("download")
    await exported.getByRole("button", { name: "Export", exact: true }).click()
    const saved = JSON.parse(await readFile(await (await pending).path(), "utf8"))
    assert.deepEqual(Object.keys(saved.inputs).toSorted(), names)
    assert.ok(
      Object.values(saved.inputs).every((input) => input.sha256 && input.title && !Object.hasOwn(input, "cover")),
    )
  } finally {
    await browser.close()
  }
})

test(
  "Output file details become XMP identity when the downloaded PDF opens as a later Input",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.getByText("Demo workspace ready.", { exact: true }).waitFor()
      const input = page.locator(".selection-panel")
      await input.getByRole("button", { name: "Details for Italic Strokes", exact: true }).click()
      assert.ok(await page.getByRole("region", { name: "Italic Strokes", exact: true }).isVisible())
      assert.deepEqual(await page.locator(".guidance:popover-open .guidance-text strong").allTextContents(), [
        "Filename:",
        "Title:",
        "Producer:",
      ])
      await page.getByRole("button", { name: "Close details", exact: true }).click()
      await page.getByRole("button", { name: "Set Output filename", exact: true }).click()
      const editor = page.locator(".filename-panel")
      await editor.getByRole("textbox", { name: "Filename", exact: true }).fill("collected.pdf")
      const title = editor.getByRole("textbox", { name: "Title", exact: true })
      await title.fill("Bad\u0001title")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      await title.fill("Collected strokes & guides")
      const cover = editor.getByRole("spinbutton", { name: "Cover page", exact: true })
      await cover.fill("2")
      await cover.press("Tab")
      await editor.locator('img[alt="Cover · page 2"]').waitFor()
      await editor.getByRole("button", { name: "Save", exact: true }).click()
      const pending = page.waitForEvent("download")
      await page.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await pending
      assert.equal(saved.suggestedFilename(), "collected.pdf")
      const bytes = await readFile(await saved.path())
      await input
        .locator('input[type="file"]')
        .setInputFiles({ name: "collected.pdf", mimeType: "application/pdf", buffer: bytes })
      await page.locator(".input-current").filter({ hasText: "collected.pdf" }).waitFor()
      await input.getByRole("button", { name: "Details for Collected strokes & guides", exact: true }).click()
      const details = page.getByRole("region", { name: "Collected strokes & guides", exact: true })
      assert.match(await details.innerText(), /Cover page: 2/)
    } finally {
      await browser.close()
    }
  },
)

function contents(path) {
  const objects = JSON.parse(execFileSync("qpdf", ["--json", "--json-stream-data=inline", path])).qpdf[1]
  delete objects.trailer.value["/ID"]
  for (const object of Object.values(objects)) {
    if (!object.stream) continue
    for (const key of ["/Length", "/Filter", "/DecodeParms"]) delete object.stream.dict[key]
  }
  return objects
}

test(
  "Recipe export keeps its toolbar and panel aligned across narrow layouts and enlarged text",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const screenshots = resolvePath("../.local/tmp/web/recipe-review")
    await mkdir(screenshots, { recursive: true })
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        for (const [width, height, text] of [
          [1440, 1000, 1],
          [810, 1080, 1],
          [375, 812, 1],
          [320, 812, 2],
          [810, 1080, 2],
        ]) {
          const page = await browser.newPage({
            viewport: { width, height },
            hasTouch: width < 1000,
            reducedMotion: "reduce",
          })
          await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
          await page.goto(`${server.resolvedUrls.local[0]}?demo`)
          await page.locator(".composer[aria-busy=false]").waitFor()
          if (text === 2) await page.addStyleTag({ content: "html { font-size: 200%; }" })
          const switcher = page.getByRole("button", { name: "Output", exact: true })
          if (await switcher.isVisible()) await switcher.click()
          const action = page.getByRole("button", { name: "Export recipe", exact: true })
          const label = `${engine.name()}-${width}-${text}`
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            const bounds = await action.evaluate((button) => {
              const box = button.getBoundingClientRect(),
                icon = button.querySelector("svg").getBoundingClientRect()
              const toolbar = button.closest(".section-heading").getBoundingClientRect()
              const peers = [...button.parentElement.querySelectorAll(".print-action svg, .view-action svg")].map(
                (svg) => svg.getBoundingClientRect(),
              )
              return {
                width: box.width,
                height: box.height,
                center: [
                  icon.x + icon.width / 2 - box.x - box.width / 2,
                  icon.y + icon.height / 2 - box.y - box.height / 2,
                ],
                row: icon.y >= toolbar.y && icon.bottom <= toolbar.bottom,
                peers: peers.every(
                  (peer) =>
                    Math.abs(peer.width - icon.width) < 1 &&
                    Math.abs(peer.height - icon.height) < 1 &&
                    icon.right < peer.left,
                ),
                overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
              }
            })
            assert.ok(bounds.width >= 44 && bounds.height >= 44, label)
            assert.ok(
              bounds.center.every((axis) => Math.abs(axis) < 1),
              label,
            )
            assert.ok(bounds.row && bounds.peers && bounds.overflow <= 1, `${label}: ${JSON.stringify(bounds)}`)
            await action.click()
            const panel = page.getByRole("dialog", { name: "Export recipe", exact: true })
            await panel.locator("th").nth(1).waitFor()
            const layout = await panel.evaluate((element) => {
              const index = element.querySelectorAll("th")[1]
              const indexText = document.createRange()
              indexText.selectNodeContents(index)
              const singleLine =
                indexText.getBoundingClientRect().height < parseFloat(getComputedStyle(index).lineHeight) * 1.5
              const box = element.getBoundingClientRect()
              const buttons = [...element.querySelectorAll(".recipe-actions button")].map((button) =>
                button.getBoundingClientRect(),
              )
              const title = element.querySelector("h2").getBoundingClientRect()
              const close = element.querySelector(".dialog-heading button svg").getBoundingClientRect()
              return {
                singleLine,
                fits:
                  box.x >= 0 &&
                  box.right <= innerWidth + 1 &&
                  box.y >= 0 &&
                  box.bottom <= innerHeight + 1 &&
                  element.scrollWidth <= element.clientWidth + 1,
                peers:
                  Math.abs(buttons[0].width - buttons[1].width) < 1 &&
                  Math.abs(buttons[0].height - buttons[1].height) < 1,
                gap: buttons[1].left - buttons[0].right,
                headingCentered: Math.abs(title.y + title.height / 2 - close.y - close.height / 2) < 1,
              }
            })
            assert.ok(
              layout.fits && layout.peers && layout.headingCentered && layout.gap >= 8 && layout.singleLine,
              `${label}: ${JSON.stringify(layout)}`,
            )
            if (width === 320 && text === 2) {
              await panel.locator(".recipe-table").focus()
              await page.keyboard.press("ArrowRight")
              await page.waitForFunction(() => document.querySelector(".recipe-table").scrollLeft > 0)
            }
            await page.screenshot({ path: join(screenshots, `${label}-${colorScheme}.png`), fullPage: true })
            await page.keyboard.press("Escape")
            assert.equal(await action.evaluate((element) => element === document.activeElement), true, label)
          }
          await page.close()
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test(
  "Recipe export preserves profile edits and duplicate file bindings through CLI replay",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch({ channel: "chromium" })
    const directory = await mkdtemp(resolvePath("../.local/tmp/web/recipe-"))
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(server.resolvedUrls.local[0])
      const first = fixture({ grouped: true, profileCount: 2, family: "fixture", count: 3 })
      const second = fixture({ grouped: true, profileCount: 2, family: "fixture", count: 2 })
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "same.pdf", mimeType: "application/pdf", buffer: first })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(input, "Style")
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
      await input.getByRole("button", { name: "Edit Width", exact: true }).click()
      await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.06")
      await output.getByRole("button", { name: "Export recipe", exact: true }).waitFor({ state: "visible" })
      await input
        .locator("input[type=file]")
        .setInputFiles({ name: "same.pdf", mimeType: "application/pdf", buffer: second })
      await page.locator(".input-picker .count").filter({ hasText: /^2$/ }).waitFor()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click()
      await output.getByLabel("Output page actions", { exact: true }).click()
      await output.getByRole("button", { name: "Add blank page at end", exact: true }).click()
      const exportAction = output.getByRole("button", { name: "Export recipe", exact: true })
      await exportAction.click()
      const panel = page.getByRole("dialog", { name: "Export recipe", exact: true })
      await panel.getByRole("table", { name: "Recipe Inputs", exact: true }).waitFor()
      assert.equal(await panel.getByRole("button", { name: "Export", exact: true }).isDisabled(), true)
      assert.deepEqual(await panel.getByRole("columnheader").allTextContents(), ["Name", "Index", "Path", "Title"])
      for (const [index, id] of [
        [1, "book"],
        [2, "other"],
      ]) {
        await panel.getByRole("button", { name: `Edit Name ${index}`, exact: true }).click()
        const field = panel.getByRole("textbox", { name: `Name ${index}`, exact: true })
        const border = await field.evaluate((element) => {
          const style = getComputedStyle(element)
          return [style.borderBlockEndWidth, style.borderInlineEndWidth, style.boxShadow]
        })
        assert.deepEqual(border, ["0px", "0px", "none"])
        await field.fill(`${id}.pdf`)
        await field.press("Enter")
        assert.equal(await panel.getByRole("button", { name: `Edit Name ${index}`, exact: true }).innerText(), id)
      }
      assert.deepEqual(await panel.locator(".recipe-path").allTextContents(), ["book.pdf", "other.pdf"])
      assert.equal(await panel.locator(".recipe-path input").count(), 0)
      await panel.getByRole("button", { name: "Edit Name 1", exact: true }).click()
      const reverted = panel.getByRole("textbox", { name: "Name 1", exact: true })
      await reverted.fill("temporary")
      await reverted.press("Escape")
      assert.equal(await panel.getByRole("button", { name: "Edit Name 1", exact: true }).innerText(), "book")
      const pending = page.waitForEvent("download")
      await panel.getByRole("button", { name: "Export", exact: true }).click()
      const saved = await pending
      assert.match(saved.suggestedFilename(), /^same_.*\.json$/)
      const recordPath = join(directory, "recipe.json")
      await saved.saveAs(recordPath)
      const record = JSON.parse(await readFile(recordPath, "utf8"))
      assert.equal(record.version, 1)
      assert.deepEqual(Object.keys(record.inputs), ["book", "other"])
      assert.deepEqual(
        Object.values(record.sources).map((source) => source.input),
        ["book", "other"],
      )
      assert.deepEqual(
        Object.values(record.inputs).map((value) => value.sha256),
        [createHash("sha256").update(first).digest("hex"), createHash("sha256").update(second).digest("hex")],
      )
      assert.deepEqual(
        Object.values(record.sources).map((source) => source.profiles),
        [[{ family: "fixture", name: "Inkjet" }], []],
      )
      assert.deepEqual(Object.values(record.sources)[0].overrides, [
        { family: "fixture", key: "guides-stroke-width", value: 0.06 },
      ])
      await exportAction.click()
      assert.equal(await panel.getByRole("button", { name: "Edit Name 1", exact: true }).innerText(), "book")
      await panel.getByRole("button", { name: "Cancel", exact: true }).click()
      const confirmation = page.waitForEvent("dialog").then(async (dialog) => {
        assert.match(dialog.message(), /have not been downloaded/, "Recipe export retains the PDF unsaved warning")
        await dialog.dismiss()
      })
      await page.getByRole("link", { name: "PDF Composer home", exact: true }).click()
      await confirmation
      const pdfPending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const pdf = await pdfPending
      const expected = await readFile(await pdf.path())
      await writeFile(join(directory, "source.pdf"), first)
      await writeFile(join(directory, "other.pdf"), second)
      // Native execution is enabled by the existing MAINZ_CLI setting; web-only CI uses the same WASM interpreter below.
      if (process.env.MAINZ_CLI) {
        const result = join(directory, "native.pdf")
        const bindings = join(directory, "bindings.json")
        await writeFile(
          bindings,
          JSON.stringify({ book: join(directory, "source.pdf"), other: join(directory, "other.pdf") }),
        )
        execFileSync(process.env.MAINZ_CLI, ["apply", recordPath, "--inputs", bindings, "--output", result])
        const browserPDF = join(directory, "browser.pdf")
        await writeFile(browserPDF, expected)
        assert.deepEqual(contents(result), contents(browserPDF))
      }
      const resolved = await page.evaluate(
        async ({ savedRecord, inputs }) => {
          const { default: create } = await import("/processor.mjs")
          const wasm = await create()
          const encoder = new TextEncoder(),
            decoder = new TextDecoder()
          const buffer = (bytes, call) => {
            const pointer = wasm["_malloc"](bytes.length || 1)
            try {
              wasm.HEAPU8.set(bytes, pointer)
              return call(pointer, bytes.length)
            } finally {
              wasm["_free"](pointer)
            }
          }
          const result = () => {
            const bytes = wasm.HEAPU8.slice(wasm["_mainz_result"](), wasm["_mainz_result"]() + wasm["_mainz_size"]())
            if (wasm["_mainz_status"]()) throw new Error(decoder.decode(bytes))
            return bytes
          }
          for (const id of Object.keys(savedRecord.inputs)) {
            buffer(encoder.encode(id), (p, n) =>
              buffer(new Uint8Array(inputs[id]), (bp, bn) => wasm["_mainz_input"](p, n, bp, bn)),
            )
            result()
          }
          buffer(encoder.encode(JSON.stringify(savedRecord)), (p, n) => wasm["_mainz_resolve_recipe"](p, n))
          const resolution = JSON.parse(decoder.decode(result()))
          buffer(encoder.encode(JSON.stringify(resolution.plan)), (p, n) => wasm["_mainz_compose"](p, n))
          return { warnings: resolution.warnings, bytes: [...result()] }
        },
        { savedRecord: record, inputs: { book: [...first], other: [...second] } },
      )
      assert.deepEqual(resolved.warnings, [])
      assert.deepEqual(Buffer.from(resolved.bytes), expected)
      await page.goto(server.resolvedUrls.local[0])
      await page.locator('.landing-recipe input[type="file"]').setInputFiles(recordPath)
      const loading = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
      const rows = loading.locator(".binding-row")
      await rows.first().waitFor()
      assert.equal(await rows.count(), 2)
      assert.equal(await rows.locator(".binding-cover img").count(), 2)
      for (const [index, name, buffer] of [
        [0, "book.pdf", first],
        [1, "other.pdf", second],
      ]) {
        await rows.nth(index).locator('input[type="file"]').setInputFiles({ name, mimeType: "application/pdf", buffer })
        await rows.nth(index).getByText("Matches the saved Input.", { exact: true }).waitFor()
      }
      await loading.getByRole("button", { name: "Apply recipe", exact: true }).click()
      await loading.waitFor({ state: "hidden" })
      assert.equal(await output.locator(".composition-totals strong").textContent(), "4 pages")
      await exportAction.click()
      await panel.getByRole("button", { name: "Export", exact: true }).waitFor({ state: "visible" })
      const replayPending = page.waitForEvent("download")
      await panel.getByRole("button", { name: "Export", exact: true }).click()
      const replay = JSON.parse(await readFile(await (await replayPending).path(), "utf8"))
      const styled = Object.values(replay.sources).find((source) => source.profiles.length)
      assert.deepEqual(styled.profiles, [{ family: "fixture", name: "Inkjet" }])
      assert.deepEqual(styled.overrides, [{ family: "fixture", key: "guides-stroke-width", value: 0.06 }])
      assert.deepEqual(replay.metadata, record.metadata)
    } finally {
      await browser.close()
      await rm(directory, { recursive: true, force: true })
    }
  },
)

test(
  "View prepares before opening the Output PDF and retains cancellation and popup recovery",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch({ channel: "chromium" })
    try {
      const page = await browser.newPage({ reducedMotion: "reduce" })
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        const Original = Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (window.holdExport && message.plan) {
              window.resumeExport = () => super.postMessage(message, ...rest)
              return
            }
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      await page.evaluate(() => (window.holdExport = true))
      const before = await output.boundingBox()
      await output.getByRole("button", { name: "View PDF", exact: true }).click()
      const progress = page.locator('.header-feedback .feedback[data-kind="progress"]')
      await progress.getByRole("button", { name: "Cancel", exact: true }).waitFor()
      assert.equal(page.context().pages().length, 1, "No blank preparation tab")
      assert.deepEqual(await output.boundingBox(), before)
      const pending = page.waitForEvent("popup")
      await page.evaluate(() => window.resumeExport())
      await progress.waitFor({ state: "hidden" })
      const viewer = await pending
      await viewer.waitForLoadState()
      assert.ok(viewer.url().startsWith("blob:"))
      const bytes = await page.evaluate(
        async (url) => [...new Uint8Array(await (await fetch(url)).arrayBuffer())],
        viewer.url(),
      )
      assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-")
      const description = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        try {
          return (await processor.run(new Uint8Array(buffer), 1)).description
        } finally {
          processor.dispose()
        }
      }, bytes)
      assert.equal(description.pageCount, 8)
      await viewer.close()
      await page.evaluate(() => {
        window.holdExport = true
        window.resumeExport = undefined
      })
      await output.getByRole("button", { name: "View PDF", exact: true }).click()
      await progress.getByRole("button", { name: "Cancel", exact: true }).click()
      assert.equal(page.context().pages().length, 1)
      assert.match(await page.locator(".footnote").innerText(), /View cancelled/)
      // Reject the browser popup only, then retry the already completed PDF with a fresh user gesture.
      await page.evaluate(() => {
        window.holdExport = false
        window.originalOpen = window.open
        window.open = () => null
      })
      await output.getByRole("button", { name: "View PDF", exact: true }).click()
      const failure = page.getByRole("dialog", { name: "View", exact: true })
      await failure.waitFor()
      await failure.getByRole("button", { name: "Retry", exact: true }).waitFor()
      assert.match(await failure.innerText(), /Allow popups/)
      await page.evaluate(() => (window.open = window.originalOpen))
      const retry = page.waitForEvent("popup")
      await failure.getByRole("button", { name: "Retry", exact: true }).click()
      await (await retry).close()
    } finally {
      await browser.close()
    }
  },
)

test("iPad Chrome View opens without another confirmation or download", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    const page = await browser.newPage({
      viewport: { width: 810, height: 1080 },
      hasTouch: true,
      reducedMotion: "reduce",
      userAgent:
        "Mozilla/5.0 (iPad; CPU OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/158.0.8127.2 Mobile Safari/604.1",
    })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    await page.getByRole("button", { name: "Output", exact: true }).tap()
    const downloads = []
    page.on("download", (download) => downloads.push(download))
    const pending = page.waitForEvent("popup")
    await page.locator(".composition-output").getByRole("button", { name: "View PDF", exact: true }).tap()
    const viewer = await pending
    await viewer.waitForLoadState()
    assert.ok(viewer.url().startsWith("blob:"))
    assert.equal(await page.getByRole("dialog", { name: "View", exact: true }).isVisible(), false)
    assert.equal(downloads.length, 0)
    await viewer.close()
  } finally {
    await browser.close()
  }
})

test("Installed View opens the native PDF viewer without another confirmation", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19")
      Object.defineProperty(navigator, "standalone", { get: () => true })
      const Original = Worker
      window.Worker = class extends Original {
        postMessage(message, ...rest) {
          if (!window.holdExport || !message.plan) super.postMessage(message, ...rest)
        }
      }
    })
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const pending = page.waitForEvent("popup")
    await page.locator(".composition-output").getByRole("button", { name: "View PDF", exact: true }).click()
    const viewer = await pending
    await viewer.waitForURL(/^blob:/)
    assert.ok(viewer.url().startsWith("blob:"))
    assert.equal(await page.getByRole("dialog", { name: "View", exact: true }).isVisible(), false)
    assert.equal(await page.locator(".composition-output .composition-totals").innerText(), "8 pages, 4 sheets")
    await viewer.close()
    await page.evaluate(() => (window.holdExport = true))
    const cancelled = page.waitForEvent("popup")
    await page.locator(".composition-output").getByRole("button", { name: "View PDF", exact: true }).click()
    const waiting = await cancelled
    assert.equal(waiting.url(), "about:blank")
    const closed = waiting.waitForEvent("close")
    await page.locator(".header-feedback").getByRole("button", { name: "Cancel", exact: true }).click()
    await closed
    assert.match(await page.locator(".footnote").innerText(), /View cancelled/)
  } finally {
    await browser.close()
  }
})

test("Mobile Share preserves named PDFs and desktop Download", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch({ channel: "chromium" })
  try {
    for (const entry of [
      {
        agent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15 Safari/605.1.15",
        platform: "MacIntel",
        touch: true,
        api: true,
        label: "Share",
      },
      {
        agent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/158.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        touch: true,
        api: true,
        label: "Share",
      },
      { platform: "Linux x86_64", touch: false, api: true, label: "Download" },
      {
        agent: "Mozilla/5.0 (Linux; Android 15) AppleWebKit/537.36 Chrome/158.0.0.0 Mobile Safari/537.36",
        platform: "Linux armv8l",
        touch: true,
        api: false,
        label: "Download",
      },
    ]) {
      const page = await browser.newPage({ reducedMotion: "reduce", userAgent: entry.agent, hasTouch: entry.touch })
      await page.addInitScript(({ platform, api }) => {
        localStorage.setItem("mainz:onboarding", "19")
        Object.defineProperty(navigator, "platform", { value: platform })
        Object.defineProperty(navigator, "canShare", { value: api ? () => true : undefined })
        Object.defineProperty(navigator, "share", {
          value: api
            ? async ({ files: [file] }) => {
                window.shared = {
                  name: file.name,
                  type: file.type,
                  magic: new TextDecoder().decode((await file.arrayBuffer()).slice(0, 5)),
                }
              }
            : undefined,
        })
      }, entry)
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      const button = output.getByRole("button", { name: entry.label, exact: true })
      for (const [width, size, theme] of entry.touch
        ? [
            [320, 200, "light"],
            [390, 100, "dark"],
            [768, 100, "light"],
            [810, 100, "light"],
            [1440, 100, "light"],
          ]
        : [[1440, 100, "light"]]) {
        await page.setViewportSize({ width, height: 1080 })
        await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), size)
        await page.emulateMedia({ colorScheme: theme })
        const switcher = page.getByRole("button", { name: "Output", exact: true })
        if (await switcher.isVisible()) await switcher.click()
        const box = await button.boundingBox()
        assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width)
        const heading = await output.locator(".section-heading").boundingBox()
        assert.ok(
          box.x + box.width <= heading.x + heading.width + 1,
          JSON.stringify({ entry, width, size, box, heading }),
        )
        if (entry.label === "Share") {
          const center = await button.locator("path").evaluate((path) => {
            const bounds = path.getBBox()
            const point = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(
              path.getScreenCTM(),
            )
            return { x: point.x, y: point.y }
          })
          assert.ok(Math.abs(center.y - box.y - box.height / 2) < 1)
          if (await button.locator("span").isVisible()) {
            const glyph = await button.locator("svg").boundingBox()
            const label = await button.locator("span").boundingBox()
            assert.ok(Math.abs((glyph.x + label.x + label.width) / 2 - box.x - box.width / 2) < 1)
          } else assert.ok(Math.abs(center.x - box.x - box.width / 2) < 1)
          assert.equal(
            (await button.locator("svg").boundingBox()).width,
            (await output.locator(".print-action svg").boundingBox()).width,
          )
          if (width === 390 || width === 320) {
            await mkdir("../.local/tmp/web/layout/export", { recursive: true })
            await output
              .locator(".section-heading")
              .screenshot({ path: `../.local/tmp/web/layout/export/share-${entry.platform}-${width}-${theme}.png` })
          }
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
      if (entry.label === "Share") {
        await button.click()
        await page
          .locator(".footnote")
          .getByText(/Shared 8 pages/)
          .waitFor()
        const file = await page.evaluate(() => window.shared)
        assert.match(file.name, /^demo_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
        assert.equal(file.type, "application/pdf")
        assert.equal(file.magic, "%PDF-")
        await mkdir("../.local/tmp/web/layout/export", { recursive: true })
        await output
          .locator(".section-heading")
          .screenshot({ path: `../.local/tmp/web/layout/export/share-${entry.platform}.png` })
      } else {
        const pending = page.waitForEvent("download")
        await button.click()
        const download = await pending
        assert.match(download.suggestedFilename(), /^demo_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
        assert.equal((await readFile(await download.path())).subarray(0, 5).toString(), "%PDF-")
        assert.equal(
          await page.evaluate(async (url) => (await fetch(url)).headers.get("Content-Type"), download.url()),
          "application/pdf",
        )
        assert.equal(await page.evaluate(() => window.shared), undefined)
      }
      await page.close()
    }
  } finally {
    await browser.close()
  }
})

test(
  "Share retains the prepared file for a fresh gesture, cancellation, and Download",
  { timeout: 30000 },
  async () => {
    const server = await serve()
    const browser = await chromium.launch({ channel: "chromium" })
    try {
      const page = await browser.newPage({
        viewport: { width: 810, height: 1080 },
        hasTouch: true,
        userAgent:
          "Mozilla/5.0 (iPad; CPU OS 26_6_2 like Mac OS X) AppleWebKit/605.1.15 CriOS/158.0.8127.2 Mobile Safari/604.1",
        reducedMotion: "reduce",
      })
      await page.addInitScript(trackWorkers)
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19")
        window.shareNames = []
        window.allowed = true
        Object.defineProperty(navigator, "canShare", { value: () => window.allowed })
        Object.defineProperty(navigator, "share", {
          value: async ({ files: [file] }) => {
            window.shareNames.push(file.name)
            if (window.shareNames.length === 1) throw new DOMException("A fresh gesture is required", "NotAllowedError")
            if (window.cancelShare) throw new DOMException("Cancelled", "AbortError")
            await new Promise((resolve) => (window.finishShare = resolve))
          },
        })
      })
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      const button = output.getByRole("button", { name: "Share", exact: true })
      await page.getByRole("button", { name: "Output", exact: true }).click()
      const before = await page.evaluate(() => window.workers.length)
      await button.click()
      const ready = page.getByRole("dialog", { name: "Share", exact: true })
      await ready.getByText("PDF ready to share.", { exact: true }).waitFor()
      assert.equal(await ready.locator('.feedback[data-kind="notice"]').count(), 1)
      for (const width of [320, 390]) {
        await page.setViewportSize({ width, height: 1080 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        const buttons = await ready
          .locator("button")
          .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()))
        for (const box of buttons) {
          assert.ok(box.width >= 44 && box.height >= 44 && box.x >= 0 && box.x + box.width <= width)
          assert.ok(Math.abs(box.y + box.height / 2 - buttons[0].y - buttons[0].height / 2) < 1)
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
        assert.ok((await ready.locator(".feedback-message").boundingBox()).width >= 60)
        if (width === 320) {
          await mkdir("../.local/tmp/web/layout/export", { recursive: true })
          await ready.screenshot({ path: "../.local/tmp/web/layout/export/share-ready-320.png" })
        }
      }
      const workers = await page.evaluate((start) => window.workers.slice(start), before)
      assert.ok(workers.some((worker) => worker.url.includes("processor.worker")))
      assert.ok(
        workers.filter((worker) => worker.url.includes("processor.worker")).every((worker) => worker.terminated),
      )
      const prepared = await page.evaluate(() => window.workers.length)
      await ready.getByRole("button", { name: "Share", exact: true }).click()
      await page.waitForFunction(() => window.finishShare)
      assert.equal(
        await page.evaluate(() => window.workers.length),
        prepared,
        "Sharing the ready PDF needs no new workers",
      )
      const names = await page.evaluate(() => window.shareNames)
      assert.equal(names[0], names[1])
      await page.evaluate(() => window.finishShare())
      await page
        .locator(".footnote")
        .getByText(/Shared 8 pages/)
        .waitFor()
      await page.evaluate(() => (window.cancelShare = true))
      await button.click()
      await page
        .locator(".footnote")
        .getByText(/Share cancelled/)
        .waitFor()
      assert.equal(await ready.isVisible(), false)
      assert.match(await output.locator(".composition-totals").textContent(), /8 pages,\s*4\s+sheets/)
      await page.evaluate(() => (window.allowed = false))
      await button.click()
      await ready.getByText("This PDF cannot be shared. Use Download.").waitFor()
      const pending = page.waitForEvent("download")
      await ready.getByRole("button", { name: "Download", exact: true }).click()
      const download = await pending
      assert.equal((await readFile(await download.path())).subarray(0, 5).toString(), "%PDF-")
      assert.equal(await ready.isVisible(), false)
    } finally {
      await browser.close()
    }
  },
)

test("Output actions stay reachable with enlarged text", { timeout: 30000 }, async () => {
  const server = await serve()
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
    await page.goto(`${server.resolvedUrls.local[0]}?demo`)
    await page.locator(".composer[aria-busy=false]").waitFor()
    const output = page.locator(".composition-output")
    for (const width of [320, 390, 768, 1440, 1920]) {
      await page.setViewportSize({ width, height: width === 375 ? 667 : width === 768 ? 1024 : 1000 })
      for (const size of [100, 200]) {
        await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
        const switcher = page.getByRole("button", { name: "Output", exact: true })
        const mobile = await switcher.isVisible()
        if (mobile) await switcher.click()
        const print = await output.getByRole("button", { name: "Print", exact: true }).boundingBox()
        const download = await output.getByRole("button", { name: "Download", exact: true }).boundingBox()
        const view = await output.getByRole("button", { name: "View PDF", exact: true }).boundingBox()
        assert.equal(print.width, view.width)
        assert.equal(print.height, view.height)
        assert.ok(print.x + print.width < view.x && view.x + view.width < download.x)
        const glyphs = await output
          .locator('.output-actions > :is(.print-action, .view-action, [aria-label="Download"]) svg')
          .evaluateAll((icons) => icons.map((icon) => icon.getBoundingClientRect().width))
        assert.equal(glyphs[0], glyphs[1])
        assert.ok(glyphs[0] >= 28)
        if (mobile) {
          assert.equal(glyphs[0], glyphs[2])
          assert.equal(download.width, print.width)
          assert.equal(download.height, download.width)
          assert.equal(
            await output.getByRole("button", { name: "Download", exact: true }).locator("span").isVisible(),
            false,
          )
        }
        const ink = await output
          .locator(".output-actions > :is(.print-action, .view-action) path")
          .evaluateAll((paths) =>
            paths.map((path) => {
              const box = path.getBBox()
              const matrix = path.getScreenCTM()
              return {
                left: new DOMPoint(box.x, box.y).matrixTransform(matrix).x,
                right: new DOMPoint(box.x + box.width, box.y).matrixTransform(matrix).x,
              }
            }),
          )
        assert.ok(
          Math.abs(ink[1].left - ink[0].right - (download.x - ink[1].right)) < 1,
          "Visible Print–View and View–Download gaps match",
        )
        const documentIcon = page.locator(".input-heading .workspace-icon, .input-title .workspace-icon").first()
        if (await documentIcon.isVisible()) assert.equal((await documentIcon.boundingBox()).width, glyphs[0])
        assert.ok(print.width >= 44 && print.height >= 44 && download.width >= 44 && download.height >= 44)
        assert.ok(print.x >= 0 && print.x + print.width < download.x && download.x + download.width <= width)
        assert.ok(Math.abs(print.y + print.height / 2 - download.y - download.height / 2) < 1)
        const icon = await output.locator(".print-action path").evaluate((path) => {
          const box = path.getBBox()
          const center = new DOMPoint(box.x + box.width / 2, box.y + box.height / 2).matrixTransform(
            path.getScreenCTM(),
          )
          return { x: center.x, y: center.y }
        })
        assert.ok(Math.abs(icon.x - print.x - print.width / 2) < 1)
        assert.ok(Math.abs(icon.y - print.y - print.height / 2) < 1)
        const open = page.locator(".selection-panel .file-picker")
        if (await open.isVisible()) {
          const button = await open.boundingBox()
          assert.ok(Math.abs(button.width - download.width) < 1 && Math.abs(button.height - download.height) < 1)
          const headings = await page.evaluate(() =>
            [document.querySelector(".input-label"), document.querySelector(".output-name > span")].map((element) => {
              const style = getComputedStyle(element),
                box = element.getBoundingClientRect()
              return { font: style.font, center: box.y + box.height / 2 }
            }),
          )
          assert.equal(headings[0].font, headings[1].font)
          assert.ok(Math.abs(headings[0].center - headings[1].center) < 1)
        }
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
      }
    }
    await page.setViewportSize({ width: 390, height: 1000 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await output.getByLabel("Output page actions", { exact: true }).click()
    await output.getByRole("button", { name: "Set Output filename", exact: true }).click()
    await page.locator(".filename-panel").waitFor({ state: "visible" })
  } finally {
    await browser.close()
  }
})

test("Mobile Output keeps Print, View, and Download on one row", { timeout: 90000 }, async () => {
  const server = await serve()
  const cases = inventory.cases.filter((entry) => entry.pointer === "coarse")
  await mkdir("../.local/tmp/web/layout/export", { recursive: true })
  for (const engine of [chromium, webkit]) {
    const browser = await engine.launch()
    try {
      const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" })
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
      await page.goto(`${server.resolvedUrls.local[0]}?demo`)
      await page.locator(".composer[aria-busy=false]").waitFor()
      const output = page.locator(".composition-output")
      for (const {
        id,
        viewport: [width, height],
      } of cases) {
        await page.setViewportSize({ width, height })
        for (const size of [100, 200]) {
          await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
          await page.emulateMedia({ colorScheme: size === 100 ? "dark" : "light" })
          const switcher = page.getByRole("button", { name: "Output", exact: true })
          if (!(await switcher.isVisible())) continue
          await switcher.click()
          const download = output.getByRole("button", { name: "Download", exact: true })
          const button = await download.boundingBox()
          const print = await output.getByRole("button", { name: "Print", exact: true }).boundingBox()
          const view = await output.getByRole("button", { name: "View PDF", exact: true }).boundingBox()
          const recipe = await output.getByRole("button", { name: "Export recipe", exact: true }).boundingBox()
          const state = await output.locator(".output-state").boundingBox()
          const diagnostic = JSON.stringify({ engine: engine.name(), id, size, button, recipe, print, view, state })
          const totals = output.locator(".composition-totals")
          if (await totals.isVisible()) {
            const counts = await totals.boundingBox()
            assert.ok(Math.abs(counts.x + counts.width - state.x - state.width) < 1, diagnostic)
            const gap = recipe.x - counts.x - counts.width
            assert.ok(gap >= 12 && gap <= recipe.width, "Counts stay close to the icons with a readable gap")
          }
          assert.equal(print.width, view.width, diagnostic)
          assert.equal(print.height, view.height, diagnostic)
          assert.equal(recipe.width, print.width, diagnostic)
          assert.equal(recipe.height, print.height, diagnostic)
          assert.ok(recipe.x + recipe.width < print.x, diagnostic)
          assert.ok(print.x + print.width < view.x && view.x + view.width < button.x, diagnostic)
          assert.ok(print.width >= 44 && print.height >= 44 && state.width >= 44, diagnostic)
          assert.ok(state.x + state.width <= recipe.x && print.x + print.width < button.x, diagnostic)
          assert.ok(Math.abs(recipe.y + recipe.height / 2 - button.y - button.height / 2) < 1, diagnostic)
          assert.ok(Math.abs(print.y + print.height / 2 - button.y - button.height / 2) < 1, diagnostic)
          assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), diagnostic)
          if (width === 375 && height === 667)
            await output
              .locator(".section-heading")
              .screenshot({ path: `../.local/tmp/web/layout/export/mobile-${engine.name()}-SE-${size}.png` })
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test("Print receives the generated Output PDF and its selected filename", { timeout: 90000 }, async () => {
  const server = await serve()
  for (const touch of [false, true]) {
    const browser = await chromium.launch({ channel: "chromium" })
    try {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1000 },
        reducedMotion: "reduce",
        hasTouch: touch,
      })
      await page.addInitScript((apple) => {
        if (location.protocol === "http:") localStorage.setItem("mainz:onboarding", "19")
        window.printRequests = []
        if (apple) {
          Object.defineProperty(navigator, "vendor", { get: () => "Apple Computer, Inc." })
          const open = window.open
          window.open = (...args) => {
            const viewer = open.apply(window, args)
            if (!viewer) return viewer
            return new Proxy(viewer, {
              get(target, key) {
                if (key === "print")
                  return () => {
                    if (window.blockPrint) throw new Error("Printing blocked")
                    window.printRequests.push({
                      href: target.location.href,
                      type: target.document.contentType,
                      title: target.document.title,
                    })
                  }
                const value = Reflect.get(target, key, target)
                return typeof value === "function" ? value.bind(target) : value
              },
            })
          }
        }
        window.addEventListener("message", (event) => {
          if (event.origin === location.origin && event.data?.kind === "print-test")
            window.printRequests.push(event.data)
        })
        // Substitute only the operating-system print dialog, retaining the real PDF viewer and generated bytes.
        window.print = () =>
          parent.postMessage(
            { kind: "print-test", href: location.href, type: document.contentType, title: document.title },
            location.origin,
          )
      }, touch)
      await page.goto(server.resolvedUrls.local[0])
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Export.pdf", mimeType: "application/pdf", buffer: fixture({ grouped: true }) })
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
      await input.getByRole("button", { name: "Add to Output", exact: true }).click()
      await tab(input, "Style")
      await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
      await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#765432")
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
      const trigger = output.getByRole("button", { name: "Set Output filename", exact: true })
      await trigger.click()
      const editor = page.locator(".filename-panel"),
        field = editor.getByLabel("Filename", { exact: true })
      assert.equal(await editor.locator(".error").count(), 0)
      assert.ok((await field.boundingBox()).height >= 44)
      await field.fill("bad/name")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      assert.match(await editor.getByRole("alert").innerText(), /slashes/)
      await field.fill("Bad\u0085name")
      assert.equal(await editor.getByRole("button", { name: "Save", exact: true }).isDisabled(), true)
      await field.fill("Practice")
      await editor.getByRole("button", { name: "Save", exact: true }).click()
      const action = output.getByRole("button", { name: "Print", exact: true })
      await action.focus()
      const before = await output.locator(".section-heading").boundingBox()
      await page.evaluate(() => {
        window.transitions = []
        window.watchPrint = true
        // oxlint-disable-next-line unicorn/consistent-function-scoping -- Playwright serializes this page callback.
        const sample = () => {
          if (!window.watchPrint) return
          const composer = document.querySelector(".composer")
          window.transitions.push({
            scroll: [scrollX, scrollY],
            view: composer.dataset.view,
            tabs: [...composer.querySelectorAll("[role=tab][aria-selected=true]")].map((element) => element.id),
            panes: [...composer.querySelectorAll(".selection-panel, .composition-output")].map((element) =>
              element.getBoundingClientRect().toJSON(),
            ),
            panel: !!document.querySelector(".print-dialog[open]"),
          })
          requestAnimationFrame(sample)
        }
        sample()
      })
      await action.click()
      const print = page.getByRole("dialog", { name: "Print", exact: true })
      await page.waitForFunction(() => window.printRequests.length > 0)
      const request = await page.evaluate(() => window.printRequests[0])
      assert.equal(request.type, "application/pdf")
      assert.equal(request.title, "Practice.pdf")
      const url = request.href
      assert.equal(await print.isVisible(), false)
      assert.deepEqual(await output.locator(".section-heading").boundingBox(), before)
      assert.equal(await action.evaluate((button) => document.activeElement === button), true)
      const transitions = await page.evaluate(() => {
        window.watchPrint = false
        return window.transitions
      })
      for (const sample of transitions) assert.deepEqual(sample, transitions[0])

      const bytes = await page.evaluate(
        async (href) => [...new Uint8Array(await (await fetch(href)).arrayBuffer())],
        url,
      )
      assert.equal(Buffer.from(bytes).subarray(0, 5).toString(), "%PDF-")
      const pending = page.waitForEvent("download")
      await output.getByRole("button", { name: "Download", exact: true }).click()
      const saved = await pending
      assert.equal(saved.suggestedFilename(), "Practice.pdf")
      assert.ok((await readFile(await saved.path())).equals(Buffer.from(bytes)), "Downloaded bytes match the print PDF")
      const description = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        try {
          return (await processor.run(new Uint8Array(buffer), 1)).description
        } finally {
          processor.dispose()
        }
      }, bytes)
      assert.equal(description.pageCount, 2, "Print gets composed Output, not the seven-page Input")
      assert.equal(description.parameters["s0:guides-stroke-color"].parameter.value, "#765432")
      await page.evaluate(() => (window.blockPrint = true))
      await page.addInitScript(() => {
        window.print = () => {
          throw new Error("Printing blocked")
        }
      })
      await action.click()
      await print.getByRole("link", { name: "Open PDF to print", exact: true }).waitFor()
      assert.equal(await print.locator(".print-name").innerText(), "Practice.pdf")
      await print.getByRole("button", { name: "Close Print", exact: true }).click()
      await trigger.click()
      assert.equal(await field.inputValue(), "Practice.pdf")
      await editor.getByRole("button", { name: "Use default", exact: true }).click()
      await trigger.click()
      assert.match(await field.inputValue(), /^Export_\d{4}-\d{4}-\d{4}-\d{4}\.pdf$/)
      await mkdir("../.local/var/printing", { recursive: true })
      await writeFile(
        `../.local/var/printing/chromium-${touch ? "touch" : "desktop"}.json`,
        JSON.stringify(
          {
            browser: browser.version(),
            platform: process.platform,
            pdf: createHash("sha256").update(Buffer.from(bytes)).digest("hex"),
            inputPages: 7,
            outputPages: description.pageCount,
            mode: "native-pdf-viewer",
            systemDialog: "substituted at window.print",
            result: "passed",
          },
          null,
          2,
        ),
      )
    } finally {
      await browser.close()
    }
  }
})

test(
  "Quartet editors float on desktop and keep their inline layout on narrow screens",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    for (const engine of [chromium, webkit]) {
      const browser = await engine.launch()
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"))
        await page.goto(`${server.resolvedUrls.local[0]}?demo&paint`)
        const input = page.locator(".selection-panel")
        await page.locator(".composer[aria-busy=false]").waitFor()
        await mkdir("../.local/tmp/web/layout/export", { recursive: true })
        for (const [width, theme, size, expected] of [
          [1440, "light", 100, true],
          [1920, "dark", 100, true],
          [1920, "dark", 200, true],
          [390, "dark", 100, false],
        ]) {
          await page.setViewportSize({ width, height: width === 375 ? 667 : width === 768 ? 1024 : 1000 })
          await page.emulateMedia({ colorScheme: theme })
          await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
          const trigger = input.getByRole("button", { name: "Edit Stroke", exact: true }).first()
          await trigger.scrollIntoViewIfNeeded()
          const before = await trigger.boundingBox()
          await trigger.click()
          const panel = input.locator(".quartet-dock:not([hidden])")
          await panel.waitFor()
          const floating = await panel.evaluate((element) => element.matches(":popover-open"))
          assert.equal(floating, expected)
          if (floating) {
            assert.deepEqual(await trigger.boundingBox(), before, "Opening an editor does not move its Quartet")
            const box = await panel.boundingBox()
            assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 1000)
          }
          await panel.screenshot({
            path: `../.local/tmp/web/layout/export/quartet-${engine.name()}-${width}-${theme}-${size}.png`,
          })
          await panel.getByRole("textbox").first().focus()
          await page.keyboard.press("Escape")
          assert.equal(await panel.count(), 0)
          assert.equal(await trigger.evaluate((button) => button === document.activeElement), true)
        }
      } finally {
        await browser.close()
      }
    }
  },
)
