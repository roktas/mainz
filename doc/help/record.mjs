// Records the real workspace and publishes explicitly requested help media.

import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { chromium } from "../../web/node_modules/playwright/index.mjs"
import * as booklet from "./booklet/booklet.mjs"
import * as recipe from "./recipe/recipe.mjs"

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..")
const book = resolve(root, "../megic/srv/ital/book/ital-book-60a4-wxga/ital-book-60a4-wxga.pdf")
const origin = process.argv[3] ?? "http://127.0.0.1:4173/"
const scenarios = { booklet, recipe }
const requested = process.argv[2]
if (requested !== "all" && !Object.hasOwn(scenarios, requested)) {
  console.log("Usage: node doc/help/record.mjs <booklet|recipe|all> [application URL]")
  process.exit(requested ? 1 : 0)
}

function command(executable, args) {
  if (executable === "ffmpeg") args = ["-hide_banner", "-loglevel", "error", ...args]
  return execFileSync(executable, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
}

async function encode(id, capture, directory, steps) {
  const target = join(directory, "media")
  await mkdir(target, { recursive: true })
  command("ffmpeg", [
    "-y",
    "-i",
    capture,
    "-an",
    "-r",
    "30",
    "-c:v",
    "libvpx-vp9",
    "-crf",
    "30",
    "-b:v",
    "0",
    "-row-mt",
    "1",
    "-cpu-used",
    "3",
    "-threads",
    "4",
    join(target, `${id}.webm`),
  ])
  command("ffmpeg", [
    "-y",
    "-i",
    capture,
    "-an",
    "-r",
    "30",
    "-c:v",
    "libx264",
    "-preset",
    "fast",
    "-crf",
    "20",
    "-pix_fmt",
    "yuv420p",
    "-movflags",
    "+faststart",
    "-threads",
    "4",
    join(target, `${id}.mp4`),
  ])
  command("ffmpeg", ["-y", "-i", capture, "-frames:v", "1", join(target, `${id}.png`)])
  const frames = join(directory, "frames")
  for (const [name, width, height] of [
    [id, 1920, 1080],
    ["preview", 960, 540],
  ]) {
    await rm(frames, { recursive: true, force: true })
    await mkdir(frames, { recursive: true })
    command("ffmpeg", [
      "-y",
      "-i",
      capture,
      "-vf",
      `fps=8,scale=${width}:${height}:flags=lanczos`,
      join(frames, "%05d.png"),
    ])
    const destination = join(target, `${name}.webp`)
    command("img2webp", [
      "-loop",
      "0",
      "-mixed",
      "-q",
      "80",
      "-m",
      "4",
      "-d",
      "125",
      ...(await readdir(frames)).toSorted().map((frame) => join(frames, frame)),
      "-o",
      destination,
    ])
    const webp = await readFile(destination)
    assert.equal(webp.toString("ascii", 8, 12), "WEBP")
    assert.equal(webp.readUIntLE(24, 3) + 1, width)
    assert.equal(webp.readUIntLE(27, 3) + 1, height)
    assert.ok(webp.includes(Buffer.from("ANIM")))
    await rm(frames, { recursive: true })
  }
  for (const extension of ["webm", "mp4"]) {
    const details = JSON.parse(
      command("ffprobe", [
        "-v",
        "error",
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        join(target, `${id}.${extension}`),
      ]),
    )
    assert.equal(details.streams.length, 1)
    assert.equal(details.streams[0].width, 1920)
    assert.equal(details.streams[0].height, 1080)
    assert.ok(Number(details.format.duration) > 10)
  }
  await writeFile(join(directory, "steps.json"), JSON.stringify(steps, null, 2) + "\n")
  const published = join(root, "web/public/help", id)
  await mkdir(published, { recursive: true })
  for (const extension of ["webm", "mp4", "webp", "png"]) {
    await copyFile(join(target, `${id}.${extension}`), join(published, `${id}.${extension}`))
  }
  await copyFile(join(target, "preview.webp"), join(published, "preview.webp"))
}

const browser = await chromium.launch({ channel: "chromium" })
try {
  for (const id of requested === "all" ? Object.keys(scenarios) : [requested]) {
    const directory = join(root, ".local/var/help", id)
    await mkdir(directory, { recursive: true })
    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      deviceScaleFactor: 1,
      colorScheme: "light",
      reducedMotion: "reduce",
      acceptDownloads: true,
    })
    const page = await context.newPage()
    page.setDefaultTimeout(60000)
    await page.addInitScript(() => {
      // Keep the system print dialog outside the capture.
      window.print = () => {}
      if (location.protocol === "http:" || location.protocol === "https:") {
        localStorage.setItem("mainz:onboarding", "19")
        localStorage.setItem("mainz:theme", "light")
      }
    })
    const steps = []
    let annotation
    let capturing = false
    let started = 0
    const helper = {
      page,
      book,
      origin,
      directory,
      async pause(ms = 700) {
        if (capturing) await page.waitForTimeout(ms)
      },
      async cue(text, action, { centered = false } = {}) {
        if (text) console.log(`${id}: ${text}`)
        if (capturing) {
          await annotation?.dispose()
          annotation = undefined
          if (text) {
            const position = centered
              ? "inset-block-start:50%;translate:-50% -50%;font-size:56px"
              : "inset-block-start:8px;translate:-50% 0"
            annotation = await page.screencast.showOverlay(
              `<div style="position:fixed;inset-inline-start:50%;padding:16px 28px;border-radius:8px;background:oklch(18% 0 none / .94);color:oklch(100% 0 none);font:600 28px/1.4 system-ui;box-shadow:0 4px 24px oklch(0% 0 none / .2);white-space:nowrap;${position}">${text}</div>`,
            )
            steps.push({ at: Math.round((Date.now() - started) / 1000), text })
            await helper.pause(750)
          }
        }
        await action?.()
        await helper.pause(950)
      },
      async click(locator, row = false) {
        if (row) await locator.locator("xpath=ancestor::li[1]").hover()
        await locator.click()
      },
      async later(text) {
        console.log(`${id}: ${text}`)
        steps.push({ at: Math.round((Date.now() - started) / 1000), text })
        await annotation?.dispose()
        annotation = await page.screencast.showOverlay(
          `<div style="position:fixed;inset:0;display:grid;place-items:center;background:oklch(18% 0 none);color:oklch(100% 0 none);font:500 40px/1.4 system-ui">${text}</div>`,
        )
        await helper.pause(400)
        page.once("dialog", (dialog) => dialog.accept())
        await page.goto(origin, { waitUntil: "domcontentloaded" })
        await page.locator(".welcome").waitFor()
        await helper.pause(600)
        await annotation.dispose()
        annotation = undefined
      },
      async inspect() {
        const output = page.locator(".composition-output")
        await helper.click(output.getByRole("tab", { name: "Page", exact: true }))
        await helper.click(output.getByRole("button", { name: "Go to page in Output", exact: true }))
        const jump = output.getByRole("textbox", { name: "Output page number", exact: true })
        await jump.fill("1")
        await jump.press("Enter")
        await helper.ready()
        for (let next = 0; next < 3; next++) {
          await helper.pause(900)
          await helper.click(output.getByRole("button", { name: "Next Output page", exact: true }))
          await helper.ready()
        }
      },
      async magnify() {
        if (!capturing) return
        const output = page.locator(".composition-output")
        await helper.click(output.getByRole("tab", { name: "Grid", exact: true }))
        await helper.ready()
        const canvas = output.locator('.page-image[data-page="0"] canvas').first()
        const box = await canvas.boundingBox()
        assert.ok(box)
        await canvas.hover({ position: { x: box.width * 0.55, y: box.height * 0.5 } })
        await page.locator('.lens[aria-busy="false"]').waitFor()
        await helper.pause(1600)
        await canvas.hover({ position: { x: box.width * 0.7, y: box.height * 0.6 } })
        await helper.pause(900)
        await page.keyboard.press("Escape")
      },
      async choose(locator, file) {
        const selection = page.waitForEvent("filechooser")
        await helper.click(locator)
        await helper.pause(700)
        await (await selection).setFiles(file)
      },
      async ready() {
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        )
      },
      async pdf(name) {
        const pending = page.waitForEvent("download")
        await helper.click(page.locator(".composition-output").getByRole("button", { name: "Download", exact: true }))
        const download = await pending
        const output = join(directory, name)
        await download.saveAs(output)
        const details = JSON.parse(command(join(root, ".local/var/cpp/build/native/mainz"), ["describe", output]))
        assert.equal(details.pageCount, 4)
        assert.deepEqual(
          details.pages.map((item) => item.name),
          ["ITAL-ARCH-60A4-WXGF", "ITAL-ARCH-60A4-WXGF", "ITAL-MIXB-60A4-WXGF", "ITAL-MIXB-60A4-WXGF"],
        )
        assert.ok(
          Object.values(details.parameters).some(
            (entry) => entry.parameter.key === "pattern-fill-color" && entry.parameter.value === "#606060",
          ),
        )
        assert.ok(
          Object.values(details.parameters).some(
            (entry) => entry.parameter.key === "pattern-fill-opacity" && entry.parameter.value === 0.4,
          ),
        )
        assert.ok(
          Object.values(details.parameters).some(
            (entry) => entry.parameter.key === "pattern-stroke-width" && entry.parameter.value === 0.3704,
          ),
        )
        return output
      },
    }
    try {
      await page.goto(origin)
      await page.locator(".welcome").waitFor()
      await page.evaluate(async () => {
        await navigator.serviceWorker.ready
        await document.fonts.ready
      })
      await page.waitForFunction(() => !document.body.textContent.includes("Installing offline application…"))
      if (id === "recipe") await booklet.prepare(helper)
      const capture = join(directory, "capture.webm")
      await page.screencast.start({ path: capture, size: { width: 1920, height: 1080 }, fps: 30, quality: 95 })
      await page.screencast.showActions({
        cursor: "pointer",
        duration: 900,
        style: {
          title: "display:none",
          point:
            "width:24px;height:24px;border-radius:50%;background:oklch(42% .19 328 / .45);box-shadow:0 0 0 3px oklch(100% 0 none),0 0 0 5px oklch(42% .19 328)",
          highlight: "outline:2px solid oklch(42% .19 328);outline-offset:4px",
        },
      })
      capturing = true
      started = Date.now()
      await scenarios[id].record(helper)
      await helper.pause(1000)
      await page.screencast.stop()
      capturing = false
      await encode(id, capture, directory, steps)
      console.log(`${id}: recorded and encoded at 1920 × 1080`)
    } finally {
      await context.close()
    }
  }
} finally {
  await browser.close()
}

const catalog = Object.entries(scenarios).map(([id, scenario]) => ({
  id,
  title: scenario.title,
  description: scenario.description,
}))
await writeFile(join(root, "web/public/help/catalog.json"), JSON.stringify(catalog, null, 2) + "\n")
