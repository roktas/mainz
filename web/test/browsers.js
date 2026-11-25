// Reuses default browser processes per file and closes each scenario's isolated contexts.

import { after } from "node:test"
import { chromium, webkit } from "playwright"

export const engines = process.env.MAINZ_SKIP_WEBKIT === "1" ? [chromium] : [chromium, webkit]

const processes = new Map()

export async function launch(engine, options = {}) {
  const channel = options.channel ?? (engine === chromium ? process.env.PLAYWRIGHT_CHANNEL || undefined : undefined)
  const launchOptions = channel === undefined ? options : { ...options, channel }
  if (
    Object.entries(options).some(([key, value]) => key !== "channel" && value !== undefined) ||
    (channel && channel !== process.env.PLAYWRIGHT_CHANNEL)
  )
    return engine.launch(launchOptions)
  const key = `${engine.name()}:${channel ?? ""}`
  if (!processes.has(key))
    processes.set(
      key,
      engine.launch(launchOptions).catch((error) => {
        processes.delete(key)
        throw error
      }),
    )
  const browser = await processes.get(key)
  const contexts = new Set()
  function track(context) {
    contexts.add(context)
    context.on("close", () => contexts.delete(context))
    return context
  }
  return {
    async newContext(settings) {
      return track(await browser.newContext(settings))
    },
    async newPage(settings) {
      const page = await browser.newPage(settings)
      track(page.context())
      return page
    },
    version: () => browser.version(),
    async close() {
      await Promise.all([...contexts].map((context) => context.close()))
    },
  }
}

after(async () => {
  for (const pending of processes.values()) {
    const browser = await pending.catch(() => undefined)
    await browser?.close()
  }
})
