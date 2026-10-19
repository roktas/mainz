// Caches verified application assets per deployment and coordinates offline updates across tabs.

declare const VERSION: string
declare const ASSETS: { path: string; sha256: string }[]
const worker = self as unknown as ServiceWorkerGlobalScope
const prefix = `mainz:${worker.registration.scope}:`
const cacheName = `${prefix}${VERSION}`
const urls = ASSETS.map((asset) => new URL(asset.path, worker.registration.scope).href)
const entry = new URL("index.html", worker.registration.scope).href

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName)
        for (let index = 0; index < urls.length; index += 4) {
          const results = await Promise.allSettled(
            urls.slice(index, index + 4).map(async (url, offset) => {
              const response = await fetch(new Request(url, { cache: "reload" }))
              if (!response.ok) throw new Error("Missing application asset.")
              const bytes = await response.clone().arrayBuffer()
              const digest = await crypto.subtle.digest("SHA-256", bytes)
              const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
              if (sha256 !== ASSETS[index + offset].sha256) throw new Error("Incompatible application asset.")
              await cache.put(url, response)
            }),
          )
          // Finish all writes before deleting a failed installation's cache.
          const failure = results.find((result) => result.status === "rejected")
          if (failure) throw failure.reason
        }
      } catch (error) {
        await caches.delete(cacheName)
        throw error
      }
    })(),
  )
})

worker.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Retire caches owned by the previously deployed application in this scope.
      for (const name of await caches.keys())
        if (name.startsWith(prefix) && name !== cacheName) await caches.delete(name)
      await worker.clients.claim()
    })(),
  )
})

worker.addEventListener("message", (event) => {
  if (event.data !== "activate-idle") return
  event.waitUntil(
    (async () => {
      const clients = (await worker.clients.matchAll({ type: "window", includeUncontrolled: true })).filter((client) =>
        client.url.startsWith(worker.registration.scope),
      )
      const source = event.source
      // Other tabs may own a PDF or an active job. Keep their compatible assets active.
      if (clients.length !== 1 || !source || !("id" in source) || clients[0].id !== source.id) {
        source?.postMessage("update-blocked", [])
        return
      }
      await worker.skipWaiting()
    })(),
  )
})

worker.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return
  const url = new URL(event.request.url)
  url.hash = ""
  if (url.origin !== worker.location.origin) return
  const navigation =
    event.request.mode === "navigate" && [worker.registration.scope, entry].includes(`${url.origin}${url.pathname}`)
  if (!navigation && !urls.includes(url.href)) return
  event.respondWith(
    (async () => {
      // Cached static bytes already match their build digest, independent of hosting Vary headers.
      const response = await (await caches.open(cacheName)).match(navigation ? entry : url.href, { ignoreVary: true })
      return (
        response ??
        new Response("Offline application assets are unavailable. Reconnect and reload.", {
          status: 503,
        })
      )
    })(),
  )
})
