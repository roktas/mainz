// Installs verified application assets and retains explicitly requested public demos separately.

declare const VERSION: string
declare const ASSETS: { path: string; sha256: string }[]
declare const EXAMPLES: { path: string; sha256: string; bytes: number }[]
const worker = self as unknown as ServiceWorkerGlobalScope
const prefix = `mainz:${worker.registration.scope}:`
const cacheName = `${prefix}${VERSION}`
const exampleCache = `${prefix}examples`
const examples = new Map(EXAMPLES.map((asset) => [new URL(asset.path, worker.registration.scope).href, asset]))
const exampleKeys = new Map([...examples].map(([url, asset]) => [url, `${url}?sha256=${asset.sha256}`]))
const urls = ASSETS.map((asset) => new URL(asset.path, worker.registration.scope).href)
const entry = new URL("index.html", worker.registration.scope).href
const entries = [worker.registration.scope, entry]

async function remember(url: string, bytes: ArrayBuffer, headers: HeadersInit) {
  const asset = examples.get(url)!
  const digest = await crypto.subtle.digest("SHA-256", bytes)
  const sha256 = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")
  if (bytes.byteLength !== asset.bytes || sha256 !== asset.sha256) throw new Error("Incompatible demo asset.")
  try {
    await (await caches.open(exampleCache)).put(exampleKeys.get(url)!, new Response(bytes, { headers }))
  } catch {
    // A storage limit must not prevent using a verified demo while online.
  }
}

async function example(url: string) {
  try {
    const cached = await caches.match(exampleKeys.get(url)!, { cacheName: exampleCache, ignoreVary: true })
    if (cached) return cached
  } catch {
    // The network can still supply verified bytes when demo storage is unavailable.
  }
  let response: Response
  try {
    response = await fetch(new Request(url, { cache: "reload" }))
  } catch {
    return new Response("Connect to download this demo before using it offline.", { status: 503 })
  }
  if (!response.ok) return response
  const bytes = await response.arrayBuffer()
  try {
    await remember(url, bytes, response.headers)
  } catch {
    return new Response("Demo asset failed integrity verification.", { status: 503 })
  }
  return new Response(bytes, { status: response.status, statusText: response.statusText, headers: response.headers })
}

async function download(url: string) {
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined
    try {
      response = await fetch(new Request(url, { cache: "reload" }))
      if (response.ok) {
        const bytes = await response.arrayBuffer()
        return {
          response: new Response(bytes, {
            status: response.status,
            statusText: response.statusText,
            headers: response.headers,
          }),
          bytes,
        }
      }
    } catch (error) {
      if (attempt === 2) throw error
      response = undefined
    }
    if (response) {
      if ((response.status < 500 && response.status !== 429) || attempt === 2)
        throw new Error("Missing application asset.")
      await response.body?.cancel()
    }
    await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
  }
}

worker.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(cacheName)
        for (let index = 0; index < urls.length; index += 4) {
          const results = await Promise.allSettled(
            urls.slice(index, index + 4).map(async (url, offset) => {
              const { response, bytes } = await download(url)
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
      const existing = await caches.keys()
      for (const name of existing)
        if (name.startsWith(prefix) && name !== cacheName && name !== exampleCache) await caches.delete(name)
      if (existing.includes(exampleCache)) {
        const validKeys = new Set(exampleKeys.values())
        const cache = await caches.open(exampleCache)
        for (const request of await cache.keys()) if (!validKeys.has(request.url)) await cache.delete(request)
      }
      await worker.clients.claim()
    })(),
  )
})

worker.addEventListener("message", (event) => {
  if (event.data?.type === "remember-example") {
    const { url, bytes } = event.data
    if (examples.has(url) && bytes instanceof ArrayBuffer && bytes.byteLength === examples.get(url)!.bytes)
      event.waitUntil(
        remember(url, bytes, { "Content-Type": url.endsWith(".pdf") ? "application/pdf" : "application/json" }).catch(
          () => {},
        ),
      )
    return
  }
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
  if (examples.has(url.href)) {
    event.respondWith(example(url.href))
    return
  }
  const navigation = event.request.mode === "navigate" && entries.includes(`${url.origin}${url.pathname}`)
  if (!navigation && !urls.includes(url.href)) return
  event.respondWith(
    (async () => {
      // Cached static bytes already match their build digest, independent of hosting Vary headers.
      const response = await caches.match(navigation ? entry : url.href, { cacheName, ignoreVary: true })
      return (
        response ??
        new Response("Offline application assets are unavailable. Reconnect and reload.", {
          status: 503,
        })
      )
    })(),
  )
})
