// Reuses default browser processes per file and closes each scenario's isolated contexts.

import { after } from "node:test"

const processes = new Map()

export async function launch(engine, options = {}) {
  if (
    Object.entries(options).some(([key, value]) => key !== "channel" && value !== undefined) ||
    (options.channel && options.channel !== process.env.PLAYWRIGHT_CHANNEL)
  )
    return engine.launch(options)
  const key = `${engine.name()}:${options.channel ?? ""}`
  if (!processes.has(key)) processes.set(key, engine.launch(options))
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
  for (const pending of processes.values()) await (await pending).close()
})
