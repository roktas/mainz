// Reuses one Vite transform cache per test file while browsers keep isolated storage.

import { after } from "node:test"
import { createServer } from "vite"
import type { ViteDevServer } from "vite"

let started: Promise<ViteDevServer> | undefined

export function serve() {
  return (started ??= (async () => {
    let server: ViteDevServer | undefined
    try {
      server = await createServer({ server: { port: 0, host: "127.0.0.1" } })
      await server.listen()
      return server
    } catch (error) {
      started = undefined
      await server?.close()
      throw error
    }
  })())
}

after(async () => {
  const server = await started?.catch(() => undefined)
  await server?.close()
})
