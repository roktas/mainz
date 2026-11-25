// Checks Recipe details, file matching, batches, alignment, and WASM replay fidelity.

import { setup, selectPane, outputCount, fixture, tab, outputAction, paneButton } from "./browser.js"
import { engines, launch } from "./browsers.js"
import assert from "node:assert/strict"
import test from "node:test"
import { readFile, mkdir, writeFile, mkdtemp, rm } from "node:fs/promises"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { join, resolve as resolvePath } from "node:path"
import { chromium } from "playwright"
import { serve } from "./server.ts"

function contents(path) {
  const objects = JSON.parse(execFileSync("qpdf", ["--json", "--json-stream-data=inline", path])).qpdf[1]
  delete objects.trailer.value["/ID"]
  for (const object of Object.values(objects)) {
    if (!object.stream) continue
    for (const key of ["/Length", "/Filter", "/DecodeParms"]) delete object.stream.dict[key]
  }
  return objects
}

function raster(path, number) {
  return execFileSync("pdftoppm", ["-r", "150", "-f", String(number), "-l", String(number), "-singlefile", path], {
    maxBuffer: 12 * 1024 * 1024,
  })
}

test("Recipe details retain opaque metadata keys as literal labels", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage()
    const recipe = JSON.parse(await readFile(new URL("./fixtures/recipe/nulla.json", import.meta.url), "utf8"))
    for (const input of Object.values(recipe.inputs))
      input.xmp = Object.fromEntries([
        ["__proto__", "Opaque prototype"],
        ["constructor", "Opaque constructor"],
      ])
    await page.goto(server.resolvedUrls.local[0])
    await page.locator(".landing-recipe input").setInputFiles({
      name: "opaque.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recipe)),
    })
    const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
    await panel.locator(".binding-meta .guidance-trigger").first().click()
    const details = page.locator(".guidance:popover-open")
    assert.deepEqual(await details.getByRole("rowheader").allTextContents(), ["__proto__", "constructor"])
    assert.deepEqual(await details.getByRole("cell").allTextContents(), ["Opaque prototype", "Opaque constructor"])
  } finally {
    await browser.close()
  }
})

test(
  "Recipe matching shows long descriptions below titles in equal rows and keeps borderless actions",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const recipe = JSON.parse(await readFile(new URL("./fixtures/recipe/nulla.json", import.meta.url), "utf8"))
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
    for (const engine of engines) {
      const browser = await launch(engine)
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
                      Math.abs(button.width - choices[0].width) < 1 && Math.abs(button.height - choices[0].height) < 1,
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
          const intro = element.querySelector(".load-intro").getBoundingClientRect()
          const choices = element.querySelector(".load-choices").getBoundingClientRect()
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
            below: choices.y - intro.bottom,
            left: Math.abs(arrow.x + (arrow.width * 8.2) / 24 - heading.x),
          }
        })
        assert.ok(
          header.sameRow && header.gap >= 16 && header.logo >= 190 && header.left < 1 && header.top < 1,
          JSON.stringify(header),
        )
        assert.ok(header.above >= 12 && header.above <= 20, "Recipe heading sits closer to the filename")
        assert.ok(header.below >= 24, "Recipe supporting text leaves clear space above the PDF choices")
        await page.emulateMedia({ reducedMotion: "no-preference" })
        await page.getByRole("link", { name: "PDF Composer home", exact: true }).dblclick()
        await page.waitForFunction(
          () => document.querySelector(".load-mark")?.getAnimations()[0]?.playState === "running",
        )
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
        await page.locator(".header-feedback").getByRole("alert").waitFor()
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
    const browser = await launch(chromium)
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
        ["Sample PDFs", "Choose PDFs"],
      )
      assert.equal(await panel.locator(".binding-target .load-download").count(), 0)
      assert.equal(
        await panel.getByRole("link", { name: "Download recipe JSON", exact: true }).getAttribute("download"),
        "nulla.json",
      )
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
      assert.deepEqual(await details.locator("th").allTextContents(), ["Title", "Producer"])
      await page.keyboard.press("Escape")
      await page.locator(".footnote").getByText("0 of 3 Inputs selected · 3 remaining", { exact: true }).waitFor()

      for (const width of [1440, 1024, 820, 768, 390, 375, 320]) {
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
                Math.abs(button.width - choices[0].width) < 1 && Math.abs(button.height - choices[0].height) < 1,
            ),
            `${width}px, ${text}: sample and local choices keep equal dimensions`,
          )
        }
      }
      await page.setViewportSize({ width: 1440, height: 1000 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await panel.getByRole("button", { name: "Sample PDFs", exact: true }).click()
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
              const group = target.querySelector(".binding-pick")
              const actions = group.getBoundingClientRect()
              const result = target.querySelector(".binding-result").getBoundingClientRect()
              const change = target.querySelector(".file-picker").getBoundingClientRect()
              const download = target.querySelector(".load-download").getBoundingClientRect()
              const style = getComputedStyle(target.querySelector(".file-picker"))
              const glyph = target.querySelector(".load-download svg")
              const ink = glyph.getBBox()
              const edge = new DOMPoint(ink.x + ink.width, 0).matrixTransform(glyph.getScreenCTM()).x
              const file = target.querySelector(".binding-file")
              const filename = file.getBoundingClientRect()
              const status = target.querySelector(".binding-status")
              return {
                centered:
                  Math.abs(
                    (Math.min(result.y, actions.y) + Math.max(result.bottom, actions.bottom)) / 2 -
                      bounds.y -
                      bounds.height / 2,
                  ) < 1,
                beside: result.right <= actions.x && Math.abs(result.y - actions.y) < 1,
                statusUnderline:
                  getComputedStyle(file).backgroundImage.startsWith("radial-gradient(") &&
                  getComputedStyle(status).clipPath !== "none",
                peers:
                  getComputedStyle(group).flexDirection === "column"
                    ? change.bottom <= download.top &&
                      Math.abs(change.x + change.width / 2 - download.x - download.width / 2) < 1
                    : Math.abs(change.y + change.height / 2 - download.y - download.height / 2) < 1,
                single: style.flexWrap === "nowrap",
                padding: style.paddingInlineStart === style.paddingInlineEnd,
                inset:
                  Math.abs(result.y + result.height / 2 - actions.y - actions.height / 2) >= 1 ||
                  Math.abs(filename.x - bounds.x - (bounds.right - edge)) < 2,
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
              layout.boxes.every(
                (box) =>
                  box.centered &&
                  box.peers &&
                  box.single &&
                  box.padding &&
                  box.fits &&
                  box.statusUnderline &&
                  (width === 1440 ? box.inset : box.beside),
              ),
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
        panel.getByRole("button", { name: "Download dolor.pdf", exact: true }),
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
      await panel.getByRole("button", { name: "Download dolor.pdf", exact: true }).click()
      const saved = await savedPDF
      assert.equal(saved.suggestedFilename(), "dolor.pdf")
      assert.deepEqual(
        await readFile(await saved.path()),
        await readFile(new URL("./fixtures/dolor.pdf", import.meta.url)),
      )
      await panel.getByRole("button", { name: "Apply recipe", exact: true }).click()
      await panel.waitFor({ state: "hidden" })
      assert.equal(await outputCount(page).textContent(), "3 pages")
      assert.equal(await page.locator(".input-picker .count").textContent(), "3")
      const output = page.locator(".composition-output")
      await tab(output, "List")
      assert.deepEqual(
        (await output.locator(".list-number .page-origin > button").allTextContents()).map((text) => text.trim()),
        ["1", "2", "3"],
        "Output rows show one unambiguous position",
      )
      await output.getByRole("button", { name: "Details for Output page 2", exact: true }).click()
      const provenance = page.locator(".card-menu-options:popover-open .page-details")
      await provenance.getByRole("row", { name: "Input minim.pdf", exact: true }).waitFor()
      assert.equal(await provenance.getByRole("row", { name: "Original page 1", exact: true }).count(), 1)
      await page.keyboard.press("Escape")
      const reference = JSON.parse(await readFile(new URL("./fixtures/recipe/nulla.json", import.meta.url), "utf8"))
      assert.deepEqual(
        (await page.locator(".input-choice-title").allTextContents()).toSorted(),
        Object.values(reference.inputs)
          .map((input) => input.title)
          .toSorted(),
        "selected PDFs retain the saved XMP titles",
      )
      await page.locator(".input-picker > summary h2").click()
      const menu = await page.locator(".input-list").evaluate((element) => {
        const choices = [...element.querySelectorAll(".input-choice")].map((button) => button.getBoundingClientRect())
        const remove = element.querySelector(".input-list-actions > .danger").getBoundingClientRect()
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
      await (await outputAction(page, "Export recipe")).click()
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
      await setup(blank)
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
      assert.equal(await outputCount(blank).textContent(), "2 pages")
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
    inputs: Object.fromEntries(
      ["book", "guides", "crossings"].map((id) => [
        id,
        {
          sha256: createHash("sha256")
            .update(fixture({ prepared: false }))
            .digest("hex"),
        },
      ]),
    ),
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
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
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
    await rows.first().getByRole("button", { name: "Input result for book", exact: true }).click()
    await page.locator(".header-feedback").getByRole("alert").waitFor()
    await page.locator(".header-feedback").getByRole("button", { name: "PDF cannot be used", exact: true }).click()
    const errorDetails = await page.locator(".message-details:popover-open").innerText()
    assert.match(errorDetails, /^broken\.pdf:/)
    assert.doesNotMatch(errorDetails, /\bbook\.pdf:/)
    assert.ok(await panel.getByRole("button", { name: "Apply recipe", exact: true }).isDisabled())
    await page.keyboard.press("Escape")
    assert.equal(
      await rows.first().locator(".binding-file").textContent(),
      "book.pdf",
      "Failed replacements retain the previous PDF",
    )
    await panel.getByRole("button", { name: "Back", exact: true }).click()
    await picker.setInputFiles(file)
    await rows.first().waitFor()
    await rows.first().locator("input").setInputFiles(pdf("book.pdf"))
    await rows.first().locator(".binding-file").waitFor()
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
    const feedback = page.locator(".header-feedback")
    await feedback.getByRole("status", { name: "Reading PDF", exact: true }).waitFor()
    assert.equal(await feedback.locator(".spinner").isVisible(), true)
    await feedback.getByRole("button", { name: "Cancel PDF reading", exact: true }).click()
    await page.evaluate(() => window.releaseRead())
    await page.evaluate(() => new Promise(requestAnimationFrame))
    assert.deepEqual(await page.evaluate(() => window.readFiles), ["Held.pdf"])
    assert.equal(await panel.locator(".bound").count(), 1)
    assert.equal(await rows.first().locator(".binding-file").textContent(), "book.pdf")
    await panel.getByRole("button", { name: "Back", exact: true }).click()
    await page.evaluate(() => (window.releaseRead = undefined))
    await picker.setInputFiles({ ...file, name: "delayed.json" })
    await page.waitForFunction(() => !!window.releaseRead)
    await feedback.getByRole("status", { name: "Reading recipe", exact: true }).waitFor()
    assert.equal(await feedback.locator(".spinner").isVisible(), true)
    await feedback.getByRole("button", { name: "Cancel recipe reading", exact: true }).click()
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
    assert.equal(await outputCount(page).textContent(), "1 page")
    await page.close()
    const interrupted = await browser.newPage({ reducedMotion: "reduce" })
    let releaseDemo
    const waiting = new Promise((resolve) => (releaseDemo = resolve))
    await interrupted.route("**/nulla.json", async (route) => {
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
    const resumed = interrupted.waitForResponse((response) => response.url().endsWith("/nulla.json"))
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
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    page.setDefaultTimeout(5000)
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    const names = ["__proto__", "constructor"]
    const record = {
      version: 1,
      inputs: Object.fromEntries(
        names.map((name) => [
          name,
          {
            title: "   ",
            sha256: createHash("sha256")
              .update(fixture({ prepared: false }))
              .digest("hex"),
          },
        ]),
      ),
      sources: Object.fromEntries(names.map((name) => [name, { input: name }])),
      parts: [{ pages: names.map((source) => ({ source, page: 0 })) }],
    }
    await page
      .locator(".landing-recipe input")
      .setInputFiles({ name: "opaque.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(record)) })
    const panel = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
    await panel.locator(".binding-row").first().waitFor()
    assert.deepEqual(await panel.locator(".binding-row h2").allTextContents(), names)
    assert.equal(await panel.locator(".binding-target.bound").count(), 0)
    assert.equal(await panel.getByRole("button", { name: /^Input result for / }).count(), 0)
    await panel.locator(".load-choices input").setInputFiles(
      names.map((name) => ({
        name: `${name}.pdf`,
        mimeType: "application/pdf",
        buffer: fixture({ prepared: false }),
      })),
    )
    await page.waitForFunction(() => document.querySelectorAll(".binding-target.bound").length === 2)
    await page.waitForFunction(() =>
      [...document.querySelectorAll(".binding-row")].every((row) => row.dataset.state === "ready"),
    )
    await panel.getByRole("button", { name: "Apply recipe", exact: true }).click()
    await panel.waitFor({ state: "hidden" })
    assert.equal(await outputCount(page).textContent(), "2 pages")
    await page.evaluate(() => {
      HTMLCanvasElement.prototype.toDataURL = () => {
        throw new Error("Cover encoding unavailable")
      }
    })
    await (await outputAction(page, "Export recipe")).click()
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
  "Recipe export keeps its toolbar and panel aligned across narrow layouts and enlarged text",
  { timeout: 90000 },
  async () => {
    const server = await serve()
    const screenshots = resolvePath("../.local/tmp/web/recipe-review")
    await mkdir(screenshots, { recursive: true })
    for (const engine of engines) {
      const browser = await launch(engine)
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
          await setup(page)
          await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
          await page.locator(".composer[aria-busy=false]").waitFor()
          if (text === 2) await page.addStyleTag({ content: "html { font-size: 200%; }" })
          const switcher = page.getByRole("button", { name: "Output", exact: true })
          await selectPane(switcher)
          const label = `${engine.name()}-${width}-${text}`
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            const action = await outputAction(page, "Export recipe")
            const bounds = await action.evaluate((button) => {
              const box = button.getBoundingClientRect(),
                icon = button.querySelector("svg").getBoundingClientRect()
              const menu = button.closest(".document-actions")
              const toolbar = (menu ?? button.closest(".section-heading")).getBoundingClientRect()
              const peers = [...button.parentElement.querySelectorAll(".print-action svg, .view-action svg")].map(
                (svg) => svg.getBoundingClientRect(),
              )
              return {
                width: box.width,
                height: box.height,
                center: [
                  menu ? icon.x - box.x - 8 : icon.x + icon.width / 2 - box.x - box.width / 2,
                  icon.y + icon.height / 2 - box.y - box.height / 2,
                ],
                row: icon.y >= toolbar.y && icon.bottom <= toolbar.bottom,
                peers: peers.every(
                  (peer) =>
                    Math.abs(peer.width - icon.width) < 1 &&
                    Math.abs(peer.height - icon.height) < 1 &&
                    (menu || icon.right < peer.left),
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
                gap:
                  Math.abs(buttons[1].top - buttons[0].top) < 1
                    ? buttons[1].left - buttons[0].right
                    : buttons[1].top - buttons[0].bottom,
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
            const menu = paneButton(page, "Output")
            const launcher = (await menu.isVisible()) ? menu : action
            assert.equal(await launcher.evaluate((element) => element === document.activeElement), true, label)
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
  "Recipe export preserves profile edits and duplicate file bindings through WASM replay",
  { timeout: 60000 },
  async (context) => {
    const server = await serve()
    const browser = await launch(chromium)
    const temporary = resolvePath("../.local/tmp/web")
    await mkdir(temporary, { recursive: true })
    const directory = await mkdtemp(join(temporary, "recipe-"))
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      const first = fixture({
        grouped: true,
        profileCount: 2,
        family: "fixture",
        count: 3,
        metadata: [{ name: "01-Fine" }, { name: "Guides" }, { name: "Guides" }],
      })
      const second = fixture({
        grouped: true,
        profileCount: 2,
        family: "fixture",
        count: 2,
        metadata: [{ name: "01-Fine" }],
      })
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
      await page
        .locator(".composer")
        .getByRole("button", { name: "Export recipe", exact: true })
        .waitFor({ state: "visible" })
      await page
        .locator(".composer")
        .locator('input[type=file][aria-label="Open PDF"]')
        .setInputFiles({ name: "same.pdf", mimeType: "application/pdf", buffer: second })
      await page.locator(".input-picker .count").filter({ hasText: /^2$/ }).waitFor()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      await output.getByLabel("Output page actions", { exact: true }).click()
      await output.getByRole("button", { name: "Blank after last", exact: true }).click()
      const exportAction = page.locator(".composer").getByRole("button", { name: "Export recipe", exact: true })
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
      const recipe = await readFile(recordPath, "utf8")
      const record = JSON.parse(recipe)
      assert.equal(record.version, 1)
      assert.deepEqual(Object.keys(record.inputs), ["book", "other"])
      assert.deepEqual(
        Object.values(record.sources).map((source) => source.input),
        ["book", "other"],
      )
      assert.deepEqual(
        record.parts.flatMap((part) =>
          part.pages.flatMap((entry) => ("source" in entry ? [[record.sources[entry.source].input, entry.page]] : [])),
        ),
        [
          ["book", "01-Fine"],
          ["book", 1],
          ["other", "01-Fine"],
        ],
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
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
      const pdf = await pdfPending
      const expected = await readFile(await pdf.path())
      const bindings = [
        { id: "book", bytes: [...first] },
        { id: "other", bytes: [...second] },
      ]
      const resolved = await page.evaluate(
        async ({ savedRecipe, sourceFiles }) => {
          const { Processor } = await import("/src/processor.ts")
          const { openPDF } = await import("/src/pdf.ts")
          const processor = new Processor()
          try {
            const inputs = sourceFiles.map(({ id, bytes }) => ({ id, bytes: new Uint8Array(bytes) }))
            const { plan, checks } = await processor.resolve(savedRecipe, inputs, 1)
            const result = await processor.compose(plan, inputs, 2)
            const task = await openPDF(new Uint8Array(result.bytes))
            try {
              const document = await task.promise
              return { checks, count: document.numPages, bytes: [...new Uint8Array(result.bytes)] }
            } finally {
              await task.destroy()
            }
          } finally {
            processor.dispose()
          }
        },
        { savedRecipe: recipe, sourceFiles: bindings },
      )
      assert.equal(resolved.checks.state, "ready")
      assert.equal(resolved.count, 4)
      assert.deepEqual(Buffer.from(resolved.bytes), expected)
      if (process.env.MAINZ_CLI) {
        await context.test("Native mainz apply reproduces the browser export", async () => {
          const result = join(directory, "native.pdf")
          const browserPDF = join(directory, "browser.pdf")
          const inputFile = join(directory, "bindings.json")
          const paths = {}
          for (const { id, bytes } of bindings) {
            paths[id] = join(directory, id + ".pdf")
            await writeFile(paths[id], Uint8Array.from(bytes))
          }
          await writeFile(inputFile, JSON.stringify(paths))
          await writeFile(browserPDF, expected)
          execFileSync(process.env.MAINZ_CLI, ["apply", recordPath, "--inputs", inputFile, "--output", result])
          assert.deepEqual(contents(result), contents(browserPDF))
          for (let number = 1; number <= 4; number++)
            assert.ok(
              raster(result, number).equals(raster(browserPDF, number)),
              `Native and browser page ${number} match`,
            )
        })
      }
      await page.addInitScript(() => {
        let rejectFirstApply = true
        const Original = Worker
        window.Worker = class extends Original {
          constructor(...args) {
            super(...args)
            this.addEventListener("message", ({ data }) => {
              const resolution = data?.resolution
              if (rejectFirstApply && resolution) {
                rejectFirstApply = false
                resolution.plan.parts[0].pages[0].page = -1
              }
            })
          }
        }
      })
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
        await rows.nth(index).getByText("Ready", { exact: true }).waitFor()
      }
      const apply = loading.getByRole("button", { name: "Apply recipe", exact: true })
      await apply.click()
      const alert = page.locator(".header-feedback").getByRole("alert")
      await alert.filter({ hasText: "Could not load recipe" }).waitFor()
      assert.equal(await page.locator(".composer").count(), 0)
      assert.equal(await rows.getByText("Ready", { exact: true }).count(), 2)
      await apply.click()
      await loading.waitFor({ state: "hidden" })
      assert.equal(await outputCount(page).textContent(), "4 pages")
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
  "Recipe export fits the byte limit and reopens with thousands of repeated page names",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    const browser = await launch(chromium)
    const name = "é".repeat(2048)
    const pdf = {
      name: "book.pdf",
      mimeType: "application/pdf",
      buffer: fixture({ count: 2, metadata: [{ name }, { name: "End" }] }),
    }
    try {
      for (const [repeats, selector] of [
        [3980, name],
        [4000, 0],
      ]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
        await setup(page)
        async function openRecipe(buffer) {
          await page.goto(server.resolvedUrls.local[0])
          await page.locator('.landing-recipe input[type="file"]').setInputFiles({
            name: "book.json",
            mimeType: "application/json",
            buffer,
          })
          const loading = page.getByRole("region", { name: "Choose your source PDFs", exact: true })
          await loading.locator('.binding-row input[type="file"]').setInputFiles(pdf)
          await loading.getByRole("button", { name: "Apply recipe", exact: true }).click()
          await loading.waitFor({ state: "hidden" })
          assert.equal(await outputCount(page).textContent(), `${repeats + 1} pages`)
        }
        try {
          await openRecipe(
            Buffer.from(
              JSON.stringify({
                version: 1,
                inputs: { book: { sha256: createHash("sha256").update(pdf.buffer).digest("hex") } },
                sources: { source: { input: "book" } },
                parts: [
                  {
                    pages: [
                      ...Array.from({ length: repeats }, () => ({ source: "source", page: 0 })),
                      { source: "source", page: 1 },
                    ],
                  },
                ],
              }),
            ),
          )
          await page.locator(".composer").getByRole("button", { name: "Export recipe", exact: true }).click()
          const panel = page.getByRole("dialog", { name: "Export recipe", exact: true })
          const pending = page.waitForEvent("download")
          await panel.getByRole("button", { name: "Export", exact: true }).click()
          const path = await (await pending).path()
          const bytes = await readFile(path)
          assert.ok(bytes.length <= 16 * 1024 * 1024)
          const record = JSON.parse(bytes)
          const pages = record.parts.flatMap((part) => part.pages)
          assert.equal(pages.length, repeats + 1)
          assert.ok(pages.slice(0, -1).every((page) => page.page === selector))
          assert.equal(pages.at(-1).page, "End")

          await openRecipe(bytes)
        } finally {
          await page.close()
        }
      }
    } finally {
      await browser.close()
    }
  },
)

test("Recipe file details align optional author and copyright fields without colons", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await page.goto(server.resolvedUrls.local[0])
    const recipe = JSON.parse(await readFile(new URL("./fixtures/recipe/nulla.json", import.meta.url), "utf8"))
    recipe.inputs.book.xmp["dc:creator"] = "Example author"
    recipe.inputs.book.xmp["dc:rights"] = "© Example rights"
    await page.locator(".landing-recipe input").setInputFiles({
      name: "session.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(recipe)),
    })
    for (const width of [390, 1920]) {
      await page.setViewportSize({ width, height: 960 })
      for (const colorScheme of ["light", "dark"]) {
        await page.emulateMedia({ colorScheme })
        await page.locator(".binding-meta").first().getByRole("button").click()
        const table = page.locator(".guidance:popover-open table")
        assert.equal(await table.getByRole("rowheader", { name: "Author", exact: true }).count(), 1)
        assert.equal(await table.getByRole("rowheader", { name: "Copyright", exact: true }).count(), 1)
        assert.match(await table.innerText(), /Example author/)
        assert.match(await table.innerText(), /© Example rights/)
        const cells = await table.locator("tr").evaluateAll((rows) =>
          rows.map((row) => {
            const [field, value] = row.cells
            const label = document.createRange()
            label.selectNodeContents(field)
            return { end: label.getBoundingClientRect().right, value: value.getBoundingClientRect().left }
          }),
        )
        assert.ok(cells.every((cell) => Math.abs(cell.end - cells[0].end) < 1 && cell.value - cell.end >= 8))
        assert.equal(await table.evaluate((element) => element.scrollWidth <= element.clientWidth), true)
        await page.getByRole("button", { name: "Close details", exact: true }).click()
      }
    }
  } finally {
    await browser.close()
  }
})
