// Checks Style controls, group identity, profiles, and preview ownership.

import assert from "node:assert/strict"
import test from "node:test"
import { captureLayout, checkGeometry, checkStatus, fixture, outputCount, setup, tab, trackWorkers } from "./browser.js"
import { engines, launch } from "./browsers.js"
import { serve } from "./server.ts"
import { chromium } from "playwright"
import { mkdir, readFile } from "node:fs/promises"

test("Parameter hover waits, cancels on leaving or Escape, and keeps click immediate", { timeout: 30000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single&paint`)
      await page.locator('.composer[aria-busy="false"]').waitFor()
      const details = page.locator(".control .details.compact").first(),
        summary = details.locator("summary")
      await page.mouse.move(0, 0)
      await page.clock.install({ time: new Date("2026-01-01T00:00:00Z") })
      await page.clock.pauseAt(new Date("2026-01-01T00:00:01Z"))
      await summary.hover()
      await page.clock.runFor(150)
      assert.equal(await details.evaluate((element) => element.open), false)
      await page.mouse.move(0, 0)
      await page.clock.runFor(300)
      assert.equal(await details.evaluate((element) => element.open), false)
      await summary.hover()
      await page.keyboard.press("Escape")
      await page.clock.runFor(300)
      assert.equal(await details.evaluate((element) => element.open), false)
      await page.mouse.move(0, 0)
      await summary.hover()
      await page.clock.runFor(220)
      assert.equal(await details.evaluate((element) => element.open), true)
      await summary.click()
      await page.mouse.move(0, 0)
      assert.equal(await details.evaluate((element) => element.open), true)
      await summary.click()
      assert.equal(await details.evaluate((element) => element.open), false)
    } finally {
      await browser.close()
    }
  }
})

test("Profile options require compatible peers and consider future profile choices", { timeout: 60000 }, async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    const input = page.locator(".selection-panel")
    for (const [name, family, original] of [
      ["First", "one", "Private"],
      ["Foreign", "two", "Private"],
      ["Peer", "one", "Other"],
    ]) {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: `${name}.pdf`,
          mimeType: "application/pdf",
          buffer: fixture({
            count: 3,
            family,
            profileSets: [
              {
                id: name,
                name: "Choices",
                parameters: ["guides-stroke-width"],
                profiles: [
                  { id: "original", name: original, overrides: {} },
                  { id: "shared", name: "Shared", overrides: { "guides-stroke-width": 0.04 } },
                ],
              },
            ],
          }),
        })
      await input
        .locator(".input-current")
        .filter({ hasText: `${name}.pdf` })
        .waitFor()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      await tab(input, "Style")
      assert.equal(
        await input.getByRole("button", { name: "Profile options", exact: true }).isDisabled(),
        name !== "Peer",
      )
    }
    await page.locator(".input-picker > summary h2").click()
    await input.getByRole("button", { name: /First\.pdf/ }).click()
    assert.equal(
      await input.getByRole("button", { name: "Profile options", exact: true }).isEnabled(),
      true,
      "Scope can be changed before choosing Shared, even though Private has no peer",
    )
    await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.06")
    assert.equal(await input.getByRole("combobox", { name: "Choices", exact: true }).inputValue(), "")
    assert.equal(
      await input.getByRole("button", { name: "Profile options", exact: true }).isEnabled(),
      true,
      "Custom retains eligible operations",
    )
  } finally {
    await browser.close()
  }
})

test(
  "Profile names apply each open file's own values unless per-file profiles are enabled",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    await mkdir("../.local/tmp/web/layout/profiles", { recursive: true })
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
        await setup(page)
        await page.addInitScript(trackWorkers)
        await page.addInitScript(() => {
          window.stylePlans = 0
          window.peakStylePlans = 0
          const Original = Worker
          window.Worker = class extends Original {
            busy = false
            constructor(...args) {
              super(...args)
              this.addEventListener("message", () => this.finish())
              this.addEventListener("error", () => this.finish())
            }
            finish() {
              if (this.busy) window.stylePlans--
              this.busy = false
            }
            postMessage(message, ...rest) {
              if (message.changes || message.plan) {
                this.busy = true
                window.peakStylePlans = Math.max(window.peakStylePlans, ++window.stylePlans)
              }
              return super.postMessage(message, ...rest)
            }
            terminate() {
              this.finish()
              super.terminate()
            }
          }
        })
        await page.goto(server.resolvedUrls.local[0])
        const input = page.locator(".selection-panel")
        for (const [name, id, profileName, value] of [
          ["Alpha", "alpha", "Fine", 0.04],
          ["Beta", "beta", "Fine", 0.08],
          ["Gamma", "alpha", "Other", 0.12],
        ]) {
          await page
            .locator("input[type=file]")
            .first()
            .setInputFiles({
              name: `${name}.pdf`,
              mimeType: "application/pdf",
              buffer: fixture({
                count: 3,
                family: "megic",
                profileSets: [
                  {
                    id,
                    name: `${name} choices`,
                    parameters: ["guides-stroke-width"],
                    profiles: [
                      { id: "generic", name: "Generic", overrides: {} },
                      { id: `${id}-fine`, name: profileName, overrides: { "guides-stroke-width": value } },
                    ],
                  },
                ],
              }),
            })
          await input
            .locator(".input-current")
            .filter({ hasText: `${name}.pdf` })
            .waitFor()
        }
        const activate = async (name) => {
          await page.locator(".input-picker > summary h2").click()
          await input.getByRole("button", { name: new RegExp(`${name}\\.pdf`) }).click()
        }
        const options = input.getByRole("button", { name: "Profile options", exact: true })
        const perFile = input.getByRole("checkbox", { name: "Apply only to this file", exact: true })
        const profile = (name) => input.getByRole("combobox", { name: `${name} choices`, exact: true })
        await activate("Alpha")
        await tab(input, "List")
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
        await tab(input, "Style")
        for (const [width, size, colorScheme] of [
          [1440, 100, "dark"],
          [810, 100, "light"],
          [390, 200, "dark"],
        ]) {
          await page.setViewportSize({ width, height: 1100 })
          await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
          await page.emulateMedia({ colorScheme })
          const frame = input.locator(".profile-choice").first()
          const alignment = await frame.evaluate((element) => {
            const box = element.getBoundingClientRect()
            const button = element.querySelector("button").getBoundingClientRect()
            const select = element.querySelector(".select").getBoundingClientRect()
            const divider = getComputedStyle(element.querySelector(".select")).borderInlineStartColor
            const reference = getComputedStyle(
              document.querySelector(".composition-output .sequence-options > summary"),
            ).borderInlineEndColor
            return {
              sameTone: divider === reference,
              framed: getComputedStyle(element).borderTopWidth === "1px",
              joined: Math.abs(button.right - select.left) < 1,
              aligned: Math.abs(button.y - select.y) < 1 && Math.abs(button.height - select.height) < 1,
              fills: Math.abs(button.x - box.x - 1) < 1 && Math.abs(select.right - box.right + 1) < 1,
            }
          })
          assert.deepEqual(
            alignment,
            { sameTone: true, framed: true, joined: true, aligned: true, fills: true },
            `${engine.name()}, ${width}: profile actions share one field frame`,
          )
          await options.click()
          assert.equal(await perFile.isChecked(), false)
          const panel = input.locator(".profile-options:popover-open")
          const bounds = await panel.boundingBox()
          assert.ok(
            bounds.x >= 0 && bounds.x + bounds.width <= width + 1 && bounds.y >= 0 && bounds.y + bounds.height <= 1101,
            `${engine.name()}, ${width}: options stay in the viewport`,
          )
          await panel.screenshot({ path: `../.local/tmp/web/layout/profiles/${engine.name()}-${width}.png` })
          await page.keyboard.press("Escape")
          await input
            .locator(".style-profile")
            .first()
            .screenshot({ path: `../.local/tmp/web/layout/profiles/${engine.name()}-${width}-selector.png` })
        }
        await page.setViewportSize({ width: 1440, height: 1100 })
        await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
        assert.equal(await options.evaluate((button) => button === document.activeElement), true)
        const workers = await page.evaluate(
          () => window.workers.filter(({ url }) => url.includes("processor.worker")).length,
        )
        await profile("Alpha").selectOption("alpha-fine")
        await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
        assert.equal(
          await page.evaluate(() => window.workers.filter(({ url }) => url.includes("processor.worker")).length),
          workers + 1,
          "Unused files do not start processing",
        )
        await activate("Beta")
        await tab(input, "List")
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
        await tab(input, "Style")
        assert.equal(await profile("Beta").inputValue(), "beta-fine", "Different IDs and set names still match")
        assert.equal(
          await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(),
          "0.08",
        )
        await options.click()
        await perFile.check()
        await page.keyboard.press("Escape")
        await profile("Beta").selectOption("generic")
        await activate("Alpha")
        assert.equal(await profile("Alpha").inputValue(), "alpha-fine", "Per-file selection leaves other files intact")
        await options.click()
        assert.equal(await perFile.isChecked(), true, "Scope follows the workspace across Input switches")
        await perFile.uncheck()
        await page.keyboard.press("Escape")
        await profile("Alpha").selectOption("generic")
        await profile("Alpha").selectOption("alpha-fine")
        await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.06")
        await activate("Beta")
        assert.equal(await profile("Beta").inputValue(), "beta-fine", "Different pre-edit values remain intact")
        assert.equal(
          await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(),
          "0.08",
        )
        await options.click()
        await perFile.check()
        await page.keyboard.press("Escape")
        await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.06")
        await options.click()
        await perFile.uncheck()
        await page.keyboard.press("Escape")
        await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.07")
        await activate("Alpha")
        assert.equal(
          await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(),
          "0.07",
          "Custom edits propagate when pre-edit values match",
        )
        await input.getByRole("button", { name: "Reset Guide Width", exact: true }).click()
        await activate("Beta")
        assert.equal(
          await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(),
          "0.07055555555555555",
          "Reset removes the matching destination override",
        )
        await activate("Alpha")
        await profile("Alpha").selectOption("alpha-fine")
        await activate("Gamma")
        await tab(input, "List")
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
        await tab(input, "Style")
        assert.equal(
          await profile("Gamma").inputValue(),
          "generic",
          "An identical ID cannot substitute for a different name",
        )
        await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
        await page.evaluate(() => (window.peakStylePlans = 0))
        await profile("Gamma").selectOption("alpha-fine")
        await profile("Gamma").selectOption("generic")
        await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
        assert.equal(
          await page.evaluate(() => window.peakStylePlans),
          1,
          "Cross-file previews process one file at a time",
        )
        await activate("Alpha")
        await profile("Alpha").selectOption("alpha-fine")
        await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
        const unchanged = await page.evaluate(() => window.workers.length)
        await profile("Alpha").selectOption("alpha-fine")
        assert.equal(
          await page.evaluate(() => window.workers.length),
          unchanged,
          "Matching choices reuse completed previews",
        )
        await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.06")
        await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
        const completed = page.waitForEvent("download")
        await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
        const downloaded = await completed
        const bytes = [...(await readFile(await downloaded.path()))]
        const description = await page.evaluate(async (pdfBytes) => {
          const { Processor } = await import("/src/processor.ts")
          const processor = new Processor()
          try {
            return (await processor.run(new Uint8Array(pdfBytes), 1)).description
          } finally {
            processor.dispose()
          }
        }, bytes)
        assert.equal(description.pageCount, 3)
        for (const [name, expected] of [
          ["Alpha", 0.06],
          ["Beta", 0.08],
          ["Gamma", undefined],
        ]) {
          const set = description.profileSets.find((candidate) => candidate.name === `${name} choices`)
          assert.equal(
            description.parameters[set.parameters[0]].parameter.value,
            expected,
            `${engine.name()}: ${name} Output styles`,
          )
        }
      } finally {
        await browser.close()
      }
    }
  },
)

test("Opaque profile-set IDs keep their annotations across Input switches", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    const input = page.locator(".selection-panel")
    const sets = [
      {
        id: "x y  ",
        name: "Line profile",
        parameters: ["guides-stroke-width"],
        profiles: [
          { id: "generic", name: "Generic", overrides: {} },
          {
            id: "inkjet",
            name: "Fine guides with a deliberately long profile name for narrow panes",
            description: "Fine guides",
            details: "Fine lines use less ink.\n\n<b>Çizgi</b> stays plain text.",
            overrides: { "guides-stroke-width": 0.04 },
          },
        ],
      },
      {
        id: "a#:/!",
        name: "Color profile",
        parameters: ["guides-stroke-color"],
        profiles: [
          { id: "generic", name: "Generic", description: "Styles from Generic.", details: " \n", overrides: {} },
          {
            id: "inkjet",
            name: "Red guides",
            description: "Red guides",
            details: "Red guide lines.\n\n<script>throw new Error('profile')</script>",
            overrides: { "guides-stroke-color": "#ff0000" },
          },
        ],
      },
    ]
    for (let index = 0; index < 2; index++) {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: `Profiles-${index}.pdf`,
          mimeType: "application/pdf",
          buffer: fixture({ count: 7, profileSets: index ? sets.toReversed() : sets }),
        })
      await input
        .locator(".input-current")
        .filter({ hasText: `Profiles-${index}.pdf` })
        .waitFor()
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      await tab(input, "Style")
      for (const set of sets) {
        const profile = input.getByRole("combobox", { name: set.name, exact: true })
        const group = input
          .locator(".style-profile")
          .filter({ has: page.getByRole("combobox", { name: set.name, exact: true }) })
        assert.equal(await group.getByRole("button", { name: /^Details for / }).count(), 0)
        assert.equal(
          await profile.evaluate((select) => {
            const ids = select.getAttribute("aria-describedby").split(/\s+/)
            return ids.length === 1 && document.getElementById(ids[0])?.textContent.trim() === "Styles from Generic."
          }),
          true,
        )
        await profile.selectOption("inkjet")
        assert.equal(
          await profile.evaluate((select) =>
            document.getElementById(select.getAttribute("aria-describedby"))?.textContent.trim(),
          ),
          set.profiles[1].description,
        )
        const information = group.getByRole("button", { name: `Details for ${set.profiles[1].name}`, exact: true })
        await information.focus()
        await information.press("Enter")
        const panel = input.getByRole("region", { name: set.profiles[1].name, exact: true })
        await panel.waitFor()
        assert.equal(await panel.locator(".guidance-text").innerText(), set.profiles[1].details)
        assert.equal(await panel.locator("b, script").count(), 0)
        assert.equal(await profile.inputValue(), "inkjet", "Reading guidance does not change styles")
        await page.keyboard.press("Escape")
        await panel.waitFor({ state: "hidden" })
        assert.equal(await information.evaluate((element) => element === document.activeElement), true)
        await information.click()
        await profile.selectOption("generic")
        assert.equal(await input.locator(".guidance:popover-open").count(), 0)
        await profile.selectOption("inkjet")
      }
      const ids = await input
        .locator(".style-profile select")
        .evaluateAll((selects) => selects.map((select) => select.getAttribute("aria-describedby")))
      assert.equal(new Set(ids).size, 2, "Each set has its own DOM description")
      const targets = await input
        .getByRole("button", { name: /^Details for / })
        .evaluateAll((buttons) =>
          buttons
            .filter((button) => button.hasAttribute("popovertarget"))
            .map((button) => button.getAttribute("popovertarget")),
        )
      assert.equal(new Set(targets).size, 2, "Each profile set has its own details panel")
    }
    await page.locator(".input-picker > summary h2").click()
    await input.getByRole("button", { name: /Profiles-0.pdf/ }).click()
    for (const set of sets) {
      const profile = input.getByRole("combobox", { name: set.name, exact: true })
      assert.equal(await profile.inputValue(), "inkjet")
      assert.equal(
        await profile.evaluate((select) =>
          document.getElementById(select.getAttribute("aria-describedby"))?.textContent.trim(),
        ),
        set.profiles[1].description,
      )
    }
  } finally {
    await browser?.close()
  }
})

test("Authored details share one panel across Style owners and omit blank guidance", { timeout: 60000 }, async () => {
  const server = await serve()
  await mkdir("../.local/tmp/web/profiles", { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    const annotations = {
      group: { description: "Guide controls.", details: "Group guidance.\n\n<b>Text</b> remains plain." },
      parameters: {
        "guides-display": {
          title: "Guide object",
          description: "Controls the guide object.",
          details: "Object guidance.\n\nApplies to the whole guide object.",
        },
        "guides-stroke-color": {
          description: "Outline color.",
          details: `Color guidance.\n\n<script>not executable</script>\n\n${"More guidance. ".repeat(240)}End of guidance.`,
        },
      },
    }
    const set = {
      id: "appearance",
      name: "Appearance",
      description: "Choose guide styles.",
      details: "Set guidance.\n\nChoices share the same scope.",
      parameters: ["guides-stroke-color"],
      profiles: [
        { id: "original", name: "Original", overrides: {} },
        {
          id: "fine",
          name: "Fine guides",
          description: "Colored guide outlines.",
          details: "Profile guidance.\n\nUses the declared outline color.",
          overrides: { "guides-stroke-color": "#123456" },
        },
      ],
    }
    try {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
      await setup(page)
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel")
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Guidance.pdf",
          mimeType: "application/pdf",
          buffer: fixture({ count: 3, grouped: true, annotations, profileSets: [set] }),
        })
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      await tab(input, "Style")
      assert.equal(await input.locator(".guidance-trigger").count(), 3)
      const chooser = input.getByRole("combobox", { name: "Appearance", exact: true })
      await chooser.selectOption("fine")
      for (const [width, size] of [
        [1440, 100],
        [390, 200],
      ]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
        for (const [name, text] of [
          ["Guides", annotations.group.details],
          ["Guide object", annotations.parameters["guides-display"].details],
          [set.name, set.details],
          ["Fine guides", set.profiles[1].details],
        ]) {
          const trigger = input.getByRole("button", { name: `Details for ${name}`, exact: true })
          await trigger.scrollIntoViewIfNeeded()
          const alignment = await trigger.evaluate((button) => {
            const target = button.getBoundingClientRect(),
              previous = button.previousElementSibling,
              reference = previous.matches(".select") ? previous.querySelector("select") : previous,
              box = reference.getBoundingClientRect(),
              style = getComputedStyle(reference),
              path = button.querySelector("path"),
              bounds = path.getBBox(),
              center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(
                path.getScreenCTM(),
              )
            return {
              width: target.width,
              height: target.height,
              x: center.x - target.x - target.width / 2,
              y:
                center.y -
                box.y -
                (reference.matches("select")
                  ? box.height / 2
                  : parseFloat(style.paddingBlockStart) + parseFloat(style.lineHeight) / 2),
            }
          })
          assert.ok(
            alignment.width >= 44 && alignment.height >= 44 && Math.abs(alignment.x) < 1 && Math.abs(alignment.y) < 1,
            JSON.stringify({ engine: engine.name(), name, width, size, alignment }),
          )
          await trigger.click()
          const panel = input.getByRole("region", { name, exact: true })
          await panel.waitFor()
          assert.equal(await panel.locator(".guidance-text").innerText(), text)
          assert.equal(await panel.locator("b,script").count(), 0)
          assert.equal(
            await panel.locator(".guidance-text").evaluate((element) => getComputedStyle(element).fontWeight),
            "400",
          )
          await panel.locator(".guidance-text").click()
          assert.equal(await input.locator(".style-group").first().getAttribute("open"), "")
          const box = await panel.boundingBox()
          assert.ok(box.x >= 0 && box.y >= 0 && box.x + box.width <= width && box.y + box.height <= 1000)
          await panel.screenshot({
            path: `../.local/tmp/web/profiles/${engine.name()}-guidance-${width}-${name.replaceAll(" ", "-")}.png`,
          })
          await page.keyboard.press("Escape")
          assert.equal(await trigger.evaluate((button) => button === document.activeElement), true)
          assert.equal(await chooser.inputValue(), "fine")
          if (name === "Guides") {
            await trigger.click()
            await panel.getByRole("button", { name: "Close details", exact: true }).click()
            assert.equal(await panel.isVisible(), false)
            assert.equal(await input.locator(".style-group").first().getAttribute("open"), "")
          }
        }
      }
      for (const [width, size] of [
        [1440, 100],
        [390, 200],
      ]) {
        await page.setViewportSize({ width, height: 1000 })
        await page.evaluate((textSize) => (document.documentElement.style.fontSize = `${textSize}%`), size)
        const trigger = input.getByRole("button", { name: "Edit Stroke", exact: true })
        const details = input.getByLabel("Details for Guide Color", { exact: true })
        await trigger.click()
        await details.click()
        assert.equal(
          await input.locator(".parameter-details").innerText(),
          annotations.parameters["guides-stroke-color"].details,
        )
        const information = input.getByRole("region", { name: "Guide Color information", exact: true })
        const scroll = await information.evaluate((panel) => {
          panel.scrollTop = panel.scrollHeight
          return { top: panel.scrollTop, height: panel.clientHeight, total: panel.scrollHeight }
        })
        assert.ok(scroll.top > 0 && scroll.height <= 500 && scroll.top + scroll.height >= scroll.total - 1)
        await information.focus()
        await page.keyboard.press("Home")
        await page.waitForFunction(() => document.activeElement.scrollTop === 0)
        await page.keyboard.press("Escape")
        assert.equal(await information.isVisible(), false)
        assert.equal(await input.locator(".quartet-panel").isVisible(), true)
        assert.equal(await details.evaluate((element) => element === document.activeElement), true)
        await page.keyboard.press("Escape")
        assert.equal(await input.locator(".quartet-panel").count(), 0)
        assert.equal(await trigger.evaluate((element) => element === document.activeElement), true)
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await page.setViewportSize({ width: 1440, height: 1000 })
      const blank = { description: "Short description.", details: " \n\t\u00a0\u2003\u202f\ufeff " }
      await page.waitForFunction(() => !document.querySelector('input[aria-label="Open PDF"]').disabled)
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
      await page.getByLabel("Open PDF", { exact: true }).setInputFiles({
        name: "Blank-guidance.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          count: 3,
          grouped: true,
          annotations: { group: blank, parameters: { "guides-display": blank } },
          profileSets: [
            {
              ...set,
              ...blank,
              profiles: [
                { ...set.profiles[0], ...blank },
                { ...set.profiles[1], ...blank },
              ],
            },
          ],
        }),
      })
      await page.locator(".status-input").filter({ hasText: "Blank-guidance.pdf" }).waitFor({ state: "attached" })
      await tab(input, "List")
      await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
      await tab(input, "Style")
      assert.equal(await input.locator(".guidance-trigger").count(), 0)
    } finally {
      await browser.close()
    }
  }
})

test("Profile details stay readable and aligned across layouts", { timeout: 180000 }, async () => {
  const server = await serve()
  await mkdir("../.local/tmp/web/profiles", { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    let page
    try {
      page = await browser.newPage({ viewport: { width: 1440, height: 1080 }, reducedMotion: "reduce", hasTouch: true })
      await setup(page)
      await page.goto(`${server.resolvedUrls.local[0]}?demo=single&paint`)
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const chooser = input.getByRole("combobox", { name: "Style profile", exact: true })
      await chooser.waitFor()
      assert.deepEqual(await chooser.locator("option").allTextContents(), [
        "Outlined",
        "Filled",
        "Outlined+",
        "Filled+",
      ])
      const information = input.getByRole("button", { name: "Details for Filled", exact: true })
      await tab(input, "Grid")
      await tab(input, "Style")
      for (const [width, height] of [
        [320, 568],
        [390, 844],
        [768, 1024],
        [1440, 1080],
      ])
        for (const theme of ["light", "dark"])
          for (const scale of [100, 200]) {
            const label = `${engine.name()}-${width}-${theme}-${scale}`
            await page.setViewportSize({ width, height })
            await page.evaluate(
              (value) => {
                document.documentElement.dataset.theme = value.theme
                document.documentElement.style.fontSize = `${value.scale}%`
              },
              { theme, scale },
            )
            await information.scrollIntoViewIfNeeded()
            const geometry = await information.evaluate((button) => {
              const target = button.getBoundingClientRect(),
                text = button.previousElementSibling
              const style = getComputedStyle(text),
                paragraph = text.getBoundingClientRect()
              const path = button.querySelector("path"),
                bounds = path.getBBox()
              const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(
                path.getScreenCTM(),
              )
              return {
                width: target.width,
                height: target.height,
                x: center.x - (target.x + target.width / 2),
                y: center.y - (paragraph.y + parseFloat(style.paddingBlockStart) + parseFloat(style.lineHeight) / 2),
              }
            })
            assert.ok(geometry.width >= 44 && geometry.height >= 44, `${label}: usable information target`)
            assert.ok(
              Math.abs(geometry.x) < 1 && Math.abs(geometry.y) < 1,
              `${label}: information icon shares the first text line's center`,
            )
            const before = await output.boundingBox()
            await information.focus()
            await information.press("Enter")
            const panel = input.getByRole("region", { name: "Filled", exact: true })
            await panel.waitFor()
            await page.waitForFunction(() => document.activeElement?.matches(".guidance"))
            assert.match(await panel.innerText(), /preferred starting point for inkjet printers/)
            assert.equal(
              await panel.evaluate((element) => element.scrollTop),
              0,
              `${label}: guidance starts at its title`,
            )
            const bounds = await panel.boundingBox()
            assert.ok(
              bounds.x >= 0 &&
                bounds.y >= 0 &&
                bounds.x + bounds.width <= width + 1 &&
                bounds.y + bounds.height <= height + 1,
              JSON.stringify({ label, bounds, button: await information.boundingBox() }),
            )
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, label)
            assert.deepEqual(await output.boundingBox(), before, `${label}: guidance does not move Output`)
            if (await panel.evaluate((element) => element.scrollHeight - element.clientHeight > 1)) {
              const ended = panel.evaluate(
                (element) => new Promise((resolve) => element.addEventListener("scrollend", resolve, { once: true })),
              )
              await panel.press("End")
              await ended
              const bottom = await panel.evaluate((element) => element.scrollTop)
              assert.ok(bottom > 0, `${label}: End scrolls the guidance`)
              const returned = panel.evaluate(
                (element) => new Promise((resolve) => element.addEventListener("scrollend", resolve, { once: true })),
              )
              await panel.press("PageUp")
              await returned
              assert.ok(
                await panel.evaluate((element, offset) => element.scrollTop < offset, bottom),
                `${label}: Page Up scrolls the guidance`,
              )
            }
            if (
              (width === 390 && theme === "light" && scale === 100) ||
              (width === 1440 && theme === "dark" && scale === 200)
            )
              await page.screenshot({ path: `../.local/tmp/web/profiles/${label}.png` })
            await page.keyboard.press("Escape")
            await panel.waitFor({ state: "hidden" })
            assert.equal(await information.evaluate((element) => element === document.activeElement), true, label)
          }
      await page.setViewportSize({ width: 1440, height: 1080 })
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
      await information.click()
      await input.getByRole("region", { name: "Filled", exact: true }).waitFor()
      await input.getByRole("tab", { name: "Style", exact: true }).click()
      assert.equal(await input.locator(".guidance:popover-open").count(), 0)
      assert.equal(await chooser.inputValue(), "inkjet")
      await information.click()
      await input.getByRole("button", { name: "Close details", exact: true }).click()
      assert.equal(await input.locator(".guidance:popover-open").count(), 0)
    } catch (error) {
      if (page) {
        const details = await page.evaluate(() => ({
          font: document.documentElement.style.fontSize,
          active: document.activeElement?.outerHTML.slice(0, 250),
          panels: [...document.querySelectorAll(".guidance:popover-open")].map((element) => ({
            top: element.scrollTop,
            height: element.clientHeight,
            scroll: element.scrollHeight,
          })),
        }))
        await captureLayout(page, `profile-details-${engine.name()}`, details)
      }
      throw error
    } finally {
      await browser.close()
    }
  }
})

test("Style reset clears saved overrides and retains keyboard focus", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 768, height: 1024 },
      hasTouch: true,
      reducedMotion: "reduce",
    })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single`)
    const input = page.locator(".selection-panel")
    await tab(input, "Style")
    const reset = input.getByRole("button", { name: "Reset all styles", exact: true })
    const profile = input.locator(".style-profile select")
    await reset.click()
    await reset.waitFor({ state: "detached" })
    assert.equal(await reset.count(), 0)
    await profile.selectOption("inkjet")
    await reset.waitFor()
    await reset.focus()
    await reset.press("Enter")
    await reset.waitFor({ state: "detached" })
    assert.equal(await profile.inputValue(), "generic")
    assert.equal(
      await input
        .getByRole("tab", { name: "Style", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    )
    await profile.selectOption("inkjet")
    await reset.waitFor()
    await profile.selectOption("generic")
    await reset.waitFor({ state: "detached" })
    const choice = input.getByRole("checkbox").first()
    const original = await choice.isChecked()
    await choice.setChecked(!original)
    await reset.waitFor()
    await reset.click()
    await reset.waitFor({ state: "detached" })
    assert.equal(await choice.isChecked(), original)
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
  } finally {
    await browser?.close()
  }
})

test(
  "Style requires applicable Output references and retains independent Source choices",
  { timeout: 60000 },
  async () => {
    const server = await serve()
    let browser
    try {
      browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
      page.setDefaultTimeout(10000)
      await setup(page)
      await page.addInitScript(() => {
        window.styleRequests = 0
        const Original = window.Worker
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (message.changes || message.plan) window.styleRequests++
            super.postMessage(message, ...rest)
          }
        }
      })
      await page.goto(server.resolvedUrls.local[0])
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output")
      const open = async (name, buffer) => {
        const count = await page.locator(".input-list button[data-source]").count()
        await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
        await page.locator(".status-input").filter({ hasText: name }).waitFor({ state: "attached" })
        await page.waitForFunction(
          (previous) => document.querySelectorAll(".input-list button[data-source]").length === previous + 1,
          count,
        )
      }
      const choose = async (index) => {
        await page.locator(".input-picker > summary h2").click()
        await page.locator(".input-list button[data-source]").nth(index).click()
      }
      const style = () => input.getByRole("tab", { name: "Style", exact: true }).click()
      const color = () =>
        input
          .locator("article.control")
          .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
          .locator("input[type=text]")
      const ready = () => output.locator('button[aria-label="Download"]:enabled').waitFor()
      const add = async (selection) => {
        await tab(input, "Grid")
        await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(selection)
        await input.getByRole("button", { name: "Add to Output", exact: true }).click()
        await ready()
      }
      await open("Styled.pdf", fixture({ profileCount: 2 }))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await input.getByRole("tab", { name: "Page", exact: true }).click()
      await input.getByRole("button", { name: "Next Input page", exact: true }).click()
      assert.equal(await page.evaluate(() => window.styleRequests), 0)
      await add("2,3")
      await style()
      const authoredColor = await color().inputValue()
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
      await ready()
      await color().fill("#123456")
      await ready()
      await open("Styled.pdf", fixture({ profileCount: 2 }))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await add("2")
      await style()
      assert.equal(await color().inputValue(), authoredColor)
      await color().fill("#abcdef")
      await ready()
      await output.getByRole("tab", { name: "Page", exact: true }).click()
      await output.getByRole("button", { name: "Select all", exact: true }).click()
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true")
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      const requests = await page.evaluate(() => window.styleRequests)
      await open("Ordinary.pdf", fixture({ prepared: false }))
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).count(), 0)
      await add("1")
      await choose(0)
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await add("2")
      await style()
      assert.equal(await color().inputValue(), "#123456")
      await choose(1)
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true)
      await add("2")
      await style()
      assert.equal(await color().inputValue(), "#abcdef")
      assert.equal(await page.evaluate(() => window.styleRequests), requests)
      const pending = page.waitForEvent("download")
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
      const downloaded = await pending
      const bytes = await readFile(await downloaded.path())
      const colors = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts")
        const processor = new Processor()
        try {
          const result = await processor.run(Uint8Array.from(buffer), 1)
          return Object.values(result.description.parameters)
            .filter((entry) => entry.parameter.schema.title === "Guide color")
            .map((entry) => entry.parameter.value)
            .toSorted()
        } finally {
          processor.dispose()
        }
      }, Array.from(bytes))
      assert.deepEqual(colors, ["#123456", "#abcdef"])
    } finally {
      await browser?.close()
    }
  },
)

test("Style and Download cancellation release preview workers and retain choices", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    page.setDefaultTimeout(10000)
    await setup(page)
    await page.addInitScript(trackWorkers)
    await page.addInitScript(() => {
      window.downloadURLs = []
      const create = URL.createObjectURL,
        revoke = URL.revokeObjectURL
      URL.createObjectURL = (blob) => {
        const url = create(blob)
        if (blob.type === "application/pdf") window.downloadURLs.push({ url, revoked: false })
        return url
      }
      URL.revokeObjectURL = (url) => {
        const entry = window.downloadURLs.find((item) => item.url === url)
        if (entry) entry.revoked = true
        revoke(url)
      }
    })
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Preview.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ profileCount: 2 }),
      })
    await page.locator(".composer[aria-busy=false]").waitFor()
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-3")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await tab(input, "Style")
    await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts")
      const task = await openPDF(new Uint8Array(await (await fetch("/dolor.pdf")).arrayBuffer()))
      const pdf = await task.promise
      const prototype = Object.getPrototypeOf(await pdf.getPage(1))
      const render = prototype.render
      window.holdPDFRendering = true
      window.pdfContinuations = []
      prototype.render = function (...args) {
        if (window.failPDFRendering) throw new Error("Verification render failed.")
        const drawing = render.apply(this, args)
        drawing.onContinue = (proceed) => (window.holdPDFRendering ? window.pdfContinuations.push(proceed) : proceed())
        return drawing
      }
      await task.destroy()
    })
    const initialWorkers = await page.evaluate(() => window.workers.length)
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    const cancelledStyle = await page.waitForFunction(
      (count) =>
        window.pdfContinuations.length > 0 &&
        window.workers.slice(count).find((worker) => worker.url.includes("pdf.worker")),
      initialWorkers,
    )
    await page.getByRole("button", { name: "Cancel style processing", exact: true }).click()
    await page.waitForFunction((worker) => worker.terminated, cancelledStyle)
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
    assert.equal(await outputCount(page).textContent(), "2 pages")
    assert.equal(await page.locator(".header-feedback").getByRole("alert").count(), 1)
    await page.evaluate(() => {
      window.holdPDFRendering = false
      window.pdfContinuations = []
    })
    await page.locator(".header-feedback").getByRole("alert").getByRole("button").click()
    await page.getByRole("button", { name: "Retry Input styles", exact: true }).click()
    await output.locator('button[aria-label="Download"]:enabled').waitFor()
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(), "0.04")
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    const previewWorkers = await page.evaluate(() => {
      window.holdPDFRendering = true
      window.pdfContinuations = []
      return window.workers.length
    })
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("generic")
    const supersededStyle = await page.waitForFunction(
      (count) =>
        window.pdfContinuations.length > 0 &&
        window.workers.slice(count).find((worker) => worker.url.includes("pdf.worker")),
      previewWorkers,
    )
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet")
    await page.waitForFunction((worker) => worker.terminated, supersededStyle)
    assert.equal(
      await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).isEnabled(),
      true,
    )
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    await page.evaluate(() => (window.pdfContinuations = []))
    const downloads = []
    page.on("download", (download) => downloads.push(download))
    const downloadWorkers = await page.evaluate(() => {
      window.holdPDFRendering = true
      return window.workers.length
    })
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const cancelledDownload = await page.waitForFunction(
      (count) =>
        window.pdfContinuations.length > 0 &&
        window.workers.slice(count).find((worker) => worker.url.includes("pdf.worker")),
      downloadWorkers,
    )
    await page.getByRole("dialog", { name: "Download", exact: true }).press("Escape")
    await page.waitForFunction((worker) => worker.terminated, cancelledDownload)
    assert.equal(await page.getByRole("dialog", { name: "Download", exact: true }).isVisible(), false)
    assert.equal(downloads.length, 0)
    assert.equal(await page.evaluate(() => window.downloadURLs.length), 0, "Cancellation creates no downloadable URL")
    assert.equal(await outputCount(page).textContent(), "2 pages")
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet")
    await page.evaluate(() => {
      window.holdPDFRendering = false
      window.pdfContinuations = []
    })
    await page.clock.install()
    const saved = page.waitForEvent("download")
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    assert.equal(await (await saved).failure(), null)
    assert.equal(downloads.length, 1)
    const replacement = page.waitForEvent("download")
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    await replacement
    assert.deepEqual(
      await page.evaluate(() => window.downloadURLs.map(({ revoked }) => revoked)),
      [true, false],
      "A replacement revokes the preceding PDF URL",
    )
    await page.clock.runFor(30001)
    assert.deepEqual(
      await page.evaluate(() => window.downloadURLs.map(({ revoked }) => revoked)),
      [true, true],
      "The retained PDF URL expires",
    )
    await page.evaluate(() => (window.failPDFRendering = true))
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const dialog = page.getByRole("dialog", { name: "Download", exact: true })
    await dialog.getByRole("alert").waitFor()
    assert.match(await dialog.getByRole("alert").innerText(), /Verification render failed/)
    assert.equal(downloads.length, 2, "Failed verification cannot download")
    await page.evaluate(() => (window.failPDFRendering = false))
    const retried = page.waitForEvent("download")
    await dialog.getByRole("button", { name: "Retry", exact: true }).click()
    assert.equal(await (await retried).failure(), null)
    assert.equal(downloads.length, 3)
  } finally {
    await browser?.close()
  }
})

test("Style selectors retain touch height and inset arrows across workspace widths", { timeout: 90000 }, async (t) => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ reducedMotion: "reduce" })
    await setup(page)
    await page.goto(`${server.resolvedUrls.local[0]}?demo=single&paint`)
    const chooser = page.getByRole("combobox", { name: "Style profile", exact: true })
    await chooser.waitFor()
    for (const width of [320, 390, 744, 768, 810, 1024, 1080, 1133, 1440, 1920, 2560, 3840]) {
      await page.setViewportSize({ width, height: 1080 })
      for (const theme of ["light", "dark"])
        for (const scale of [100, 200]) {
          const label = `${width}px, ${theme}, ${scale}% text`
          t.diagnostic(label)
          await page.evaluate(
            (value) => {
              document.documentElement.dataset.theme = value.theme
              document.documentElement.style.fontSize = `${value.scale}%`
            },
            { theme, scale },
          )
          await chooser.evaluate((select) => select.scrollIntoView({ block: "center" }))
          const geometry = await chooser.evaluate((select) => {
            const field = select.getBoundingClientRect()
            const frame = select.closest(".entry").getBoundingClientRect()
            const svg = select.nextElementSibling
            const path = svg.querySelector("path")
            const bounds = path.getBBox(),
              matrix = path.getScreenCTM()
            const center = new DOMPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2).matrixTransform(
              matrix,
            )
            const icon = svg.getBoundingClientRect()
            const inset = parseFloat(getComputedStyle(svg).insetInlineEnd)
            return {
              height: field.height,
              frameHeight: frame.height,
              x: center.x - (field.right - inset - icon.width / 2),
              y: center.y - (field.y + field.height / 2),
              inset: field.right - icon.right,
              target: document.elementFromPoint(center.x, center.y) === select,
              overflow: document.documentElement.scrollWidth > innerWidth,
            }
          })
          assert.ok(geometry.height >= 44, `${label}: full-height select target`)
          assert.ok(geometry.frameHeight >= 46, `${label}: full-height profile field`)
          assert.ok(Math.abs(geometry.x) < 1 && Math.abs(geometry.y) < 1, `${label}: visible arrow center`)
          assert.ok(geometry.inset >= 12, `${label}: inset arrow`)
          assert.equal(geometry.target, true, `${label}: the arrow retains the native select target`)
          assert.equal(geometry.overflow, false, `${label}: no horizontal overflow`)
          const control = await page
            .locator(".style-group .control:not(.compact)")
            .first()
            .evaluate((element) => {
              const label = element.querySelector(".control-label").getBoundingClientRect(),
                field = element.querySelector(".entry").getBoundingClientRect(),
                group = element.closest("fieldset").getBoundingClientRect()
              return { left: field.left - group.left, right: field.right - group.right, gap: field.top - label.bottom }
            })
          assert.ok(
            Math.abs(control.left) < 1 && Math.abs(control.right) < 1 && control.gap >= -1,
            `${label}: individual Style fields retain the group's full width ${JSON.stringify(control)}`,
          )
          const output = page.locator(".composition-output .sequence-entry > .entry")
          if (await output.isVisible()) {
            const reference = await output.boundingBox(),
              field = await page.locator(".profile-choice").first().boundingBox()
            assert.ok(Math.abs(field.y - reference.y) < 1, `${label}: profile and Output field share a row`)
            assert.ok(
              Math.abs(field.height - reference.height) < 1,
              `${label}: profile and Output field share a height`,
            )
          }
        }
    }
    await page.setViewportSize({ width: 1440, height: 1080 })
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"))
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Enum styles.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ profileCount: 2, widthConstraints: { enum: [0.04, 0.2, 1] } }),
      })
    const input = page.locator(".selection-panel")
    await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "Enum styles.pdf")
    await input.getByLabel("Page selection", { exact: true }).fill("1")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    const choice = input.getByRole("combobox", { name: "Guide Width (mm)", exact: true })
    await choice.selectOption("1")
    assert.equal(await choice.inputValue(), "1", "The shared select preserves enum edits")
    assert.ok((await choice.boundingBox()).height >= 44, "Enum fields retain full touch height")
    assert.ok((await choice.locator("..").locator("svg").boundingBox()).width > 0, "Enum fields share the inset arrow")
  } finally {
    await browser?.close()
  }
})

test("Style toolbar folds multiple groups and follows individual disclosures", { timeout: 60000 }, async () => {
  const server = await serve()
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      for (const width of [390, 1440]) {
        const page = await browser.newPage({
          viewport: { width, height: 1100 },
          colorScheme: width === 390 ? "dark" : "light",
          reducedMotion: "reduce",
          hasTouch: width === 390,
        })
        await setup(page)
        await page.goto(server.resolvedUrls.local[0])
        if (width === 1440) await page.evaluate(() => (document.documentElement.style.fontSize = "200%"))
        for (const grouped of [false, true]) {
          await page
            .locator('input[type=file][aria-label="Open PDF"]')
            .first()
            .setInputFiles({
              name: `Groups-${grouped}.pdf`,
              mimeType: "application/pdf",
              buffer: fixture({ grouped, count: 1 }),
            })
          await page.locator(".composer[aria-busy=false]").waitFor()
          const input = page.locator(".selection-panel")
          await input.getByLabel("Page selection", { exact: true }).fill("1")
          await input.getByRole("button", { name: "Add to Output", exact: true }).click()
          await tab(input, "Style")
          const groups = input.locator(".style-group")
          const toggle = input.getByRole("button", { name: /^(Fold|Unfold) all Style groups$/ })
          assert.equal(await groups.count(), grouped ? 1 : 2)
          if (grouped) {
            assert.equal(await toggle.count(), 0)
            continue
          }
          await toggle.press("Enter")
          await page.waitForFunction(() => !document.querySelector(".style-group[open]"))
          assert.equal(await toggle.getAttribute("aria-label"), "Unfold all Style groups")
          await groups.first().locator("summary").first().press("Enter")
          await input.getByRole("button", { name: "Fold all Style groups", exact: true }).waitFor()
          assert.equal(await input.locator(".style-group[open]").count(), 1)
          await toggle.click()
          await page.waitForFunction(() => !document.querySelector(".style-group[open]"))
          await toggle.click()
          await page.waitForFunction(() => document.querySelectorAll(".style-group[open]").length === 2)
          assert.equal(await input.getByRole("button", { name: "Reset all styles", exact: true }).count(), 0)
          const bounds = await toggle.boundingBox()
          assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= width)
          await mkdir("../.local/tmp/web/layout/style-groups", { recursive: true })
          await page.screenshot({ path: `../.local/tmp/web/layout/style-groups/${engine.name()}-${width}.png` })
          await toggle.click()
          await tab(input, "Grid")
          await tab(input, "Style")
          assert.equal(await input.locator(".style-group[open]").count(), 0)
        }
        await page.close()
      }
    } finally {
      await browser.close()
    }
  }
})

test("Quartets and profiles preserve PDF edits and open files without profiles", { timeout: 180000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      reducedMotion: "reduce",
    })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    const sample = await readFile("test/fixtures/dolor.pdf")
    const open = async (name, buffer) => {
      await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer })
      await page.waitForFunction((label) => document.querySelector(".status-input")?.textContent === label, name, {
        timeout: 60000,
      })
      await page.locator(".composer:not([inert])").waitFor()
    }
    await open("dolor.pdf", sample)
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const chooser = input.getByRole("combobox", { name: "Style profile", exact: true })
    assert.equal(await chooser.inputValue(), "generic")
    const profileBox = await input.locator(".profile-choice").first().boundingBox()
    const selectionBox = await output.locator(".sequence-entry > .entry").boundingBox()
    assert.ok(Math.abs(profileBox.y - selectionBox.y) < 1, `Profile ${profileBox.y}, Output ${selectionBox.y}`)
    assert.ok(Math.abs(profileBox.height - selectionBox.height) < 1)
    assert.ok(await input.locator(".quartet").count())
    assert.equal(await page.locator(".status-input").textContent(), "dolor.pdf")
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 })
      await page.getByRole("button", { name: "Help", exact: true }).click()
      await page.getByRole("button", { name: "Start Tour", exact: true }).click()
      const tour = page.getByRole("dialog", { name: "Product tour", exact: true })
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "input",
      )
      for (const step of ["input-grid", "input-list", "input-page", "style", "style-profile"]) {
        await tour.getByRole("button", { name: "Next", exact: true }).click()
        await page.waitForFunction(
          (key) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === key,
          step,
        )
      }
      const target = page.locator('[data-tour-target="style-profile"]')
      assert.match(await tour.locator(".tour-progress").textContent(), /\/ 11/)
      assert.equal(await target.isVisible(), true)
      assert.equal(await target.getAttribute("data-tour-active"), "true")
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await chooser.inputValue(), "generic")
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-grid",
      )
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-list",
      )
      assert.equal(await output.getByRole("tab", { name: "List", exact: true }).getAttribute("aria-selected"), "true")
      assert.equal(await output.locator(".page-list").isVisible(), true)
      await tour.getByRole("button", { name: "Next", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-selection",
      )
      for (const name of ["Remove selected Output pages", "Duplicate selected Output pages"])
        assert.equal(await output.getByRole("button", { name, exact: true }).isEnabled(), true)
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1-2")
      await tour.getByRole("button", { name: "Back", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-list",
      )
      await tour.getByRole("button", { name: "Back", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-grid",
      )
      await tour.getByRole("button", { name: "Back", exact: true }).click()
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "style-profile",
      )
      assert.equal(await target.isVisible(), true)
      await page.keyboard.press("Escape")
      assert.equal(await chooser.inputValue(), "generic")
      assert.equal(await output.locator(".composition-card").count(), 2)
    }
    await page.setViewportSize({ width: 1440, height: 1000 })
    assert.deepEqual(
      await input.locator(".style-group > summary > span:not(.count) > span:first-child").allTextContents(),
      ["Patterns", "Guides", "Margins", "Watermark"],
    )
    assert.equal(await input.getByText("Practice shapes and repeats.", { exact: true }).isVisible(), true)
    const pattern = input.getByRole("group", { name: "Pattern", exact: true })
    const patternSection = input
      .locator(".style-group")
      .filter({ has: page.locator("summary").getByText("Patterns", { exact: true }) })
    assert.equal(await patternSection.getByRole("img", { name: "1 Style object", exact: true }).textContent(), "1")
    assert.equal(
      await pattern
        .getByText("Full sheet or first row/column.", {
          exact: true,
        })
        .isVisible(),
      true,
    )
    assert.equal(await pattern.getByRole("checkbox").count(), 1)
    assert.deepEqual(
      await pattern
        .getByRole("img", { name: "Fill color: #000000", exact: true })
        .locator("span")
        .evaluate((element) => ({
          color: getComputedStyle(element).backgroundColor,
          opacity: getComputedStyle(element).opacity,
        })),
      { color: "rgb(0, 0, 0)", opacity: "1" },
    )
    assert.equal((await pattern.locator('.quartet-text[title^="Fill opacity:"]').textContent()).trim(), "0%")
    await checkGeometry(pattern)
    const watermark = input.locator('.style-object[aria-label="Watermark"]')
    await checkGeometry(watermark)
    for (const label of ["Stroke Paint duo", "Width", "Visibility"])
      assert.equal(await watermark.getByRole("note", { name: `${label}: not applicable`, exact: true }).count(), 1)
    assert.equal(await watermark.getByRole("checkbox").count(), 0)
    assert.match(
      await watermark.getByRole("note", { name: "Visibility: not applicable", exact: true }).getAttribute("title"),
      /original visibility/,
    )
    await watermark.getByLabel("Edit Fill", { exact: true }).click()
    await watermark.getByRole("textbox", { name: "Watermark", exact: true }).fill("#336699")
    await watermark.getByRole("spinbutton", { name: "Watermark Fill Opacity (%)", exact: true }).fill("60")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await chooser.inputValue(), "generic")
    assert.match(await watermark.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /60%/)
    await page.keyboard.press("Escape")
    const guides = input.getByRole("group", { name: "Minors", exact: true })
    assert.match(
      await guides.getByRole("note", { name: "Fill Paint duo: not applicable", exact: true }).getAttribute("title"),
      /neither fill color nor fill opacity/,
    )
    const reveal = async (title, label) => {
      const group = input.getByRole("group", { name: title, exact: true })
      const summary = group.getByLabel(`Edit ${label === "Color" || label === "Opacity" ? "Stroke" : label}`, {
        exact: true,
      })
      if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click()
      return group
    }
    const minor = input.getByRole("group", { name: "Minors", exact: true })
    const major = input.getByRole("group", { name: "Majors", exact: true })
    assert.equal(await input.getByRole("group", { name: "Slants", exact: true }).count(), 1)
    const guideSection = input
      .locator(".style-group")
      .filter({ has: page.locator("summary").getByText("Guides", { exact: true }) })
    await guideSection.locator(":scope > summary").click()
    assert.equal(await minor.isVisible(), false)
    const guideHelp = input.getByText("Stroke alignment guides.", {
      exact: true,
    })
    assert.equal(await guideHelp.isVisible(), true)
    await guideSection.locator(":scope > summary").press("Enter")
    assert.equal(await minor.isVisible(), true)
    assert.equal(await guideHelp.isVisible(), true)
    const labels = await guideSection
      .locator(".style-object")
      .evaluateAll((objects) => objects.map((object) => object.getAttribute("aria-label")))
    assert.deepEqual(labels, ["Slants", "Angles", "Minors", "Majors", "Halves"])
    const visibility = pattern.getByRole("checkbox")
    await visibility.uncheck()
    assert.equal(await visibility.isChecked(), false)
    assert.equal(await pattern.locator(".quartet-panel:visible").count(), 0)
    await visibility.check()
    assert.equal(await visibility.isChecked(), true)
    await reveal("Minors", "Width")
    const baselineWidth = await minor
      .getByRole("spinbutton", { name: "Minors Stroke Width (mm)", exact: true })
      .inputValue()
    assert.ok(Math.abs(Number(baselineWidth) - 0.08) < 1e-6)
    await chooser.selectOption("inkjet")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await pattern.getByRole("img", { name: "Fill color: #6B7F99", exact: true }).count(), 1)
    await reveal("Minors", "Width")
    const widthHelp = minor.locator(".quartet-panel").getByText("Outline thickness in mm.", { exact: true })
    assert.equal(await widthHelp.isVisible(), true)
    const widthControl = minor.getByRole("spinbutton", {
      name: "Minors Stroke Width (mm)",
      exact: true,
    })
    assert.equal(
      (await widthControl.getAttribute("aria-describedby")).split(" ").includes(await widthHelp.getAttribute("id")),
      true,
    )
    await page.mouse.move(0, 0)
    assert.equal(await minor.locator(".quartet-panel:visible > section").count(), 1)
    assert.equal(
      await minor
        .locator(".quartet-component")
        .nth(2)
        .locator(".quartet-value")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgba(0, 0, 0, 0)",
    )
    assert.equal(
      await input.getByRole("spinbutton", { name: "Minors Stroke Width (mm)", exact: true }).inputValue(),
      "0.04",
    )
    assert.match(await input.locator(".style-profile").textContent(), /Finer guides and soft blue pattern fills/)
    const fillTrigger = pattern.getByLabel("Edit Fill", { exact: true })
    await fillTrigger.click()
    assert.equal(await minor.locator(".quartet-panel:visible").count(), 0)
    await pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true }).focus()
    await page.keyboard.press("Escape")
    assert.equal(await pattern.locator(".quartet-panel:visible").count(), 0)
    assert.equal(await fillTrigger.evaluate((element) => element === document.activeElement), true)
    await reveal("Minors", "Width")
    await checkStatus(page)
    const pending = page.waitForEvent("download", { timeout: 60000 })
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const download = await pending
    assert.equal(await download.failure(), null)
    const saved = await readFile(await download.path())
    await open("inkjet.pdf", saved)
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click()
    await output.getByRole("button", { name: "Remove Output page 2", exact: true }).click()
    await output.getByRole("button", { name: "Remove Output page 1", exact: true }).click()
    await tab(input, "Grid")
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    assert.equal(await chooser.inputValue(), "inkjet")
    await reveal("Minors", "Width")
    const width = input.getByRole("spinbutton", {
      name: "Minors Stroke Width (mm)",
      exact: true,
    })
    await width.fill("0.05")
    assert.equal(await chooser.inputValue(), "")
    assert.match(await chooser.textContent(), /Custom/)
    assert.equal(await input.locator(".profile-summary > button").count(), 0)
    await chooser.selectOption("generic")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await width.inputValue(), baselineWidth)
    await reveal("Minors", "Opacity")
    const strokePaint = minor.getByRole("region", {
      name: "Stroke Paint duo editor",
      exact: true,
    })
    assert.equal(await strokePaint.getByRole("textbox", { name: "Minors Stroke Color", exact: true }).count(), 1)
    assert.equal(
      await strokePaint.getByRole("spinbutton", { name: "Minors Stroke Opacity (%)", exact: true }).count(),
      1,
    )
    const minorOpacity = input.getByRole("spinbutton", {
      name: "Minors Stroke Opacity (%)",
      exact: true,
    })
    const majorOpacity = major.locator('.quartet-text[title^="Stroke opacity:"]')
    const originalMajorOpacity = await majorOpacity.textContent()
    await minorOpacity.fill("30")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.equal(await minorOpacity.inputValue(), "30")
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity)
    const minorVisibility = minor.getByRole("checkbox")
    await minorVisibility.uncheck()
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.match(await minor.locator('.quartet-text[title^="Stroke opacity:"]').textContent(), /30%/)
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity)
    const editedPending = page.waitForEvent("download", { timeout: 60000 })
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const edited = await editedPending
    assert.equal(await edited.failure(), null)
    await open("custom.pdf", await readFile(await edited.path()))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    await reveal("Minors", "Opacity")
    assert.equal(await minorOpacity.inputValue(), "30")
    assert.equal(await watermark.getByRole("img", { name: "Fill color: #336699", exact: true }).count(), 1)
    assert.match(await watermark.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /60%/)
    assert.equal(await minorVisibility.isChecked(), false)
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity)
    await minorVisibility.check()
    assert.match(await minor.locator('.quartet-text[title^="Stroke opacity:"]').textContent(), /30%/)
    await open("single.pdf", fixture({ profileCount: 1 }))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    assert.equal(await input.locator(".style-profile").count(), 0)
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).count(), 1)
    await open("no-profile.pdf", fixture())
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    assert.equal(await input.locator(".style-profile").count(), 0)
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).count(), 1)
    await open("fill-only.pdf", fixture({ grouped: true, fillOnly: true }))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const filled = input.getByRole("group", { name: "Guides", exact: true })
    await checkGeometry(filled)
    for (const label of ["Stroke Paint duo", "Width"])
      assert.equal(await filled.getByRole("note", { name: `${label}: not applicable`, exact: true }).count(), 1)
    await filled.getByLabel("Edit Fill", { exact: true }).click()
    await filled.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#A9A9A9")
    await filled.getByRole("spinbutton", { name: "Fill Opacity (%)", exact: true }).fill("40")
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    assert.match(await filled.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/)
    await page.keyboard.press("Escape")
    await filled.getByRole("checkbox").uncheck()
    assert.match(await filled.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/)
    await filled.getByRole("checkbox").check()
    await open("mixed-paint.pdf", fixture({ mixedDisplay: true, grouped: true }))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const mixed = input.getByRole("group", { name: "Guides", exact: true }).getByRole("checkbox")
    assert.equal(await mixed.evaluate((element) => element.indeterminate), true)
    await mixed.focus()
    await mixed.press("Space")
    assert.equal(await mixed.isChecked(), true)
    assert.equal(await mixed.evaluate((element) => element.indeterminate), false)
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"))
    await input.getByRole("button", { name: "Reset all styles", exact: true }).click()
    assert.equal(await mixed.evaluate((element) => element.indeterminate), true)
    await open("bounded-choices.pdf", fixture({ widthConstraints: { enum: [0.02, 0.08], minimum: 0.05 } }))
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await input.getByRole("tab", { name: "Style", exact: true }).click()
    const choices = input.getByRole("combobox", { name: "Guide Width (mm)", exact: true })
    assert.equal(await choices.getByRole("option", { name: "0.02", exact: true }).isDisabled(), true)
    assert.equal(await choices.getByRole("option", { name: "0.08", exact: true }).isEnabled(), true)
    await choices.selectOption("0.08")
    await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
    assert.equal(await choices.inputValue(), "0.08")
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    await page.close()
  } finally {
    await browser?.close()
  }
})

async function opacityPage(browser, server) {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
  await setup(page)
  await page.goto(server.resolvedUrls.local[0])
  await page
    .locator("input[type=file]")
    .first()
    .setInputFiles({
      name: "Opacity.pdf",
      mimeType: "application/pdf",
      buffer: fixture({
        grouped: true,
        profileSets: [
          {
            id: "opacity",
            name: "Opacity profile",
            parameters: ["guides-stroke-opacity"],
            profiles: [
              { id: "original", name: "Original", overrides: {} },
              { id: "precise", name: "Precise", overrides: { "guides-stroke-opacity": 0.789764747191011 } },
            ],
          },
        ],
      }),
    })
  const input = page.locator(".selection-panel")
  await tab(input, "List")
  await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
  await tab(input, "Style")
  return { page, input }
}

test(
  "Opacity percentages preserve precision, invalid entry, reset, and saved values",
  { timeout: 120000 },
  async () => {
    const server = await serve()
    await mkdir("../.local/tmp/web/layout/opacity", { recursive: true })
    for (const engine of engines) {
      const browser = await launch(engine)
      try {
        const { page, input } = await opacityPage(browser, server)
        const profile = input.getByRole("combobox", { name: "Opacity profile", exact: true })
        await profile.selectOption("precise")
        await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
        const field = input.getByRole("spinbutton", { name: "Guide Opacity (%)", exact: true })
        const slider = input.getByRole("slider", { name: "Adjust Guide Opacity", exact: true })
        assert.equal(await field.inputValue(), "79")
        assert.equal(await slider.getAttribute("aria-valuetext"), "79%")
        await field.focus()
        assert.equal(await field.inputValue(), "79")
        assert.ok(Math.abs(parseFloat(await field.getAttribute("title")) - 78.9764747191011) < 1e-12)
        await field.press("Tab")
        assert.equal(await field.inputValue(), "79")
        assert.equal(await slider.inputValue(), "0.789764747191011")
        assert.equal(await profile.inputValue(), "precise", "Focus and display rounding assign nothing")
        await field.fill("7")
        assert.equal(await field.inputValue(), "7", "Typing does not expose floating-point conversion noise")
        const compact = await field.boundingBox()
        await field.fill("12.3456789")
        assert.ok(Math.abs((await field.boundingBox()).width - compact.width) < 1, "Precise entry keeps the same width")
        await field.press("Tab")
        assert.equal(await field.inputValue(), "12.3")
        assert.equal(await slider.inputValue(), "0.123456789")
        await page.getByRole("button", { name: "Edit Stroke", exact: true }).click()
        const download = page.waitForEvent("download")
        await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
        const saved = await download
        await page
          .locator(".composer")
          .locator('input[type=file][aria-label="Open PDF"]')
          .setInputFiles({
            name: "Saved opacity.pdf",
            mimeType: "application/pdf",
            buffer: await readFile(await saved.path()),
          })
        await page.locator(".status-input").filter({ hasText: "Saved opacity.pdf" }).waitFor({ state: "attached" })
        await tab(input, "List")
        await input.getByLabel("Page selection", { exact: true }).fill("1")
        await input.getByLabel("Page selection", { exact: true }).press("Enter")
        await tab(input, "Style")
        await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
        assert.equal(await slider.inputValue(), "0.123456789")
        await field.fill("101")
        assert.equal(await field.getAttribute("aria-invalid"), "true")
        await page.locator(".header-feedback [role=alert]").waitFor()
        assert.match(await page.locator(".header-feedback .message-details").textContent(), /between 0% and 100%/)
        await input.getByRole("button", { name: "Reset Guide Opacity", exact: true }).click()
        assert.equal(await field.inputValue(), "100")
      } finally {
        await browser.close()
      }
    }
  },
)

test("Opacity sliders retain alignment across text sizes and themes", { timeout: 120000 }, async () => {
  const server = await serve()
  await mkdir("../.local/tmp/web/layout/opacity", { recursive: true })
  for (const engine of engines) {
    const browser = await launch(engine)
    try {
      const { page, input } = await opacityPage(browser, server)
      const profile = input.getByRole("combobox", { name: "Opacity profile", exact: true })
      await profile.selectOption("precise")
      await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
      const field = input.getByRole("spinbutton", { name: "Guide Opacity (%)", exact: true })
      for (const width of process.env.MAINZ_TEST_MODE === "full" ? [320, 390, 768, 1440] : [390, 1440]) {
        await page.setViewportSize({ width, height: 1100 })
        for (const text of ["100%", "200%"]) {
          await page.evaluate((size) => (document.documentElement.style.fontSize = size), text)
          for (const colorScheme of ["light", "dark"]) {
            await page.emulateMedia({ colorScheme })
            await field.scrollIntoViewIfNeeded()
            const bounds = await field.evaluate((element) => {
              const entry = element.parentElement
              const track = entry.querySelector(".slider").getBoundingClientRect()
              const value = element.getBoundingClientRect()
              const unit = entry.querySelector(".unit").getBoundingClientRect()
              const reset = entry.querySelector(".reset").getBoundingClientRect()
              return {
                track: track.width,
                value: value.width,
                aligned: [track, unit, reset].every(
                  (box) => Math.abs(box.y + box.height / 2 - value.y - value.height / 2) < 1,
                ),
                separate: track.right <= value.left && value.right <= unit.left && unit.right <= reset.left,
                fits: entry.scrollWidth <= entry.clientWidth,
              }
            })
            const label = `${engine.name()}, ${width}, ${text}, ${colorScheme}`
            assert.ok(
              bounds.track >= 44 && bounds.aligned && bounds.separate && bounds.fits,
              `${label}: ${JSON.stringify(bounds)}`,
            )
            await field.focus()
            assert.ok(
              Math.abs((await field.boundingBox()).width - bounds.value) < 1,
              `${label}: precision keeps the same width`,
            )
            await field.press("Tab")
            await input.locator(".quartet-panel").screenshot({
              path: `../.local/tmp/web/layout/opacity/${engine.name()}-${width}-${text}-${colorScheme}.png`,
            })
          }
        }
      }
    } finally {
      await browser.close()
    }
  }
})

test("Opaque parameter IDs retain style edits, draft errors, and downloaded values", { timeout: 60000 }, async () => {
  const server = await serve()
  let browser
  try {
    browser = await launch(chromium, { channel: process.env.PLAYWRIGHT_CHANNEL || undefined })
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" })
    await setup(page)
    const errors = []
    page.on("pageerror", (error) => errors.push(error.message))
    let pdf = fixture({ profileCount: 2, grouped: true }).toString()
    for (const [id, name] of [
      ["guides-stroke-color", "__proto__"],
      ["guides-stroke-width", "toString"],
      ["guides-stroke-opacity", "constructor"],
      ["guides-display", "hasOwnProperty"],
    ]) {
      // JSON whitespace keeps the PDF's stream length and xref offsets intact.
      pdf = pdf.replaceAll(JSON.stringify(id), JSON.stringify(name).padEnd(id.length + 2))
    }
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Opaque.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(pdf),
      })
    const input = page.locator(".selection-panel")
    await tab(input, "List")
    await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).press("Enter")
    await tab(input, "Style")
    assert.equal(await input.getByRole("button", { name: "Edit Stroke", exact: true }).count(), 1)
    assert.deepEqual(errors, [])
    await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
    const color = input.getByRole("textbox", { name: "Guide Color", exact: true })
    await color.fill("invalid")
    assert.equal(await color.getAttribute("aria-invalid"), "true")
    assert.match(await page.locator(".header-feedback .message-details").textContent(), /six hexadecimal digits/)
    assert.equal(await input.locator('.quartet-text[title^="Stroke color:"] > span:last-child').innerText(), "Invalid")
    assert.equal(await input.locator(".control .scope").first().textContent(), "Input pages: 1-7")
    await color.fill("#ff0000")
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    assert.equal(await color.inputValue(), "#ff0000")
    assert.equal(await input.locator('.quartet-text[title^="Stroke color:"] > span:last-child').innerText(), "#ff0000")
    await input.getByRole("button", { name: "Edit Width", exact: true }).click()
    await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.4")
    await page.waitForFunction(() => !document.querySelector(".header-feedback .style-progress"))
    const completed = page.waitForEvent("download")
    await page.locator(".composer").getByRole("button", { name: "Download", exact: true }).click()
    const downloaded = await completed
    await page
      .locator(".composer")
      .locator('input[type=file][aria-label="Open PDF"]')
      .setInputFiles({
        name: downloaded.suggestedFilename(),
        mimeType: "application/pdf",
        buffer: await readFile(await downloaded.path()),
      })
    await page.locator(".status-input").filter({ hasText: downloaded.suggestedFilename() }).waitFor()
    await tab(input, "Grid")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    await input.getByRole("button", { name: "Edit Stroke", exact: true }).click()
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#ff0000")
    await input.getByRole("button", { name: "Reset Guide Color", exact: true }).click()
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#333333")
    assert.deepEqual(errors, [])
  } finally {
    await browser?.close()
  }
})

test("Mixed visibility retains its unset baseline through keyboard changes and reset", { timeout: 30000 }, async () => {
  const server = await serve(),
    browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } })
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Mixed visibility.pdf",
        mimeType: "application/pdf",
        buffer: fixture({ mixedDisplay: true }),
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
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
    await reset.click()
    assert.equal(await show.isChecked(), false)
    assert.equal(await hide.isChecked(), false)
    assert.match(await visibility.innerText(), /No single value/)
    assert.equal(await reset.isDisabled(), true)
    await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" })
    assert.equal(await page.locator(".header-feedback .feedback[data-kind=error]").count(), 0)
  } finally {
    await browser.close()
  }
})

test("Style group folds survive removal of their first applicable parameter", async () => {
  const server = await serve()
  const browser = await launch(chromium)
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" })
    await setup(page)
    await page.goto(server.resolvedUrls.local[0])
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Scoped.pdf",
        mimeType: "application/pdf",
        buffer: fixture({
          grouped: true,
          count: 2,
          targets: { first: ["page0"], guides: ["page1"] },
          parameterTargets: { "guides-stroke-color": ["first"] },
        }),
      })
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output")
    await input.getByLabel("Page selection", { exact: true }).fill("1-2")
    await input.getByRole("button", { name: "Add to Output", exact: true }).click()
    await tab(input, "Style")
    const group = input.locator(".style-group")
    await group.locator("summary").first().click()
    assert.equal(await group.getAttribute("open"), null)
    await output.getByLabel("Page selection", { exact: true }).fill("1")
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click()
    await page.waitForFunction(
      () =>
        document.querySelector(".style-group") &&
        !document.querySelector('.composition-output .composition-card[data-index="1"]'),
    )
    assert.equal(await group.getAttribute("open"), null)
    await group.locator("summary").first().click()
    assert.equal(await input.getByLabel("Guide color", { exact: true }).count(), 0)
    assert.ok(await group.locator("input").count())
  } finally {
    await browser.close()
  }
})
