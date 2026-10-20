import { defineConfig, transformWithOxc } from "vite"
import { svelte } from "@sveltejs/vite-plugin-svelte"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs"
import { createHash } from "node:crypto"
import { execFileSync } from "node:child_process"
import { dirname, join, resolve } from "node:path"

const version = readFileSync(resolve("../VERSION"), "utf8").trim()
const now = new Date()
const builtAt = now.toISOString()
const clock = Object.fromEntries(
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 2,
    hourCycle: "h23",
  })
    .formatToParts(now)
    .map(({ type, value }) => [type, value]),
)
const buildId = `${clock.year}-${clock.month}${clock.day}-${clock.hour}${clock.minute}-${clock.second}${clock.fractionalSecond}`
let revision = ""
try {
  revision = execFileSync("git", ["rev-parse", "--short=7", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim()
} catch {
  /* Source archives can build without Git metadata. */
}
const wasm = resolve(process.env.MAINZ_WASM_DIR ?? "../.local/var/package/wasm")
let outputDirectory = resolve("../.local/var/js/dist")

function prepare() {
  if (!existsSync(`${wasm}/provenance.json`))
    throw new Error(`Mainz WASM package is required at ${wasm}. Build roktas/mainz or set MAINZ_WASM_DIR.`)
  const provenanceBytes = readFileSync(`${wasm}/provenance.json`)
  const provenance = JSON.parse(provenanceBytes.toString("utf8"))
  const files = new Map<string, Buffer>()
  for (const name of ["processor.mjs", "processor.wasm"]) {
    const bytes = readFileSync(`${wasm}/${name}`)
    if (createHash("sha256").update(bytes).digest("hex") !== provenance.files?.[name])
      throw new Error(`Mainz package digest mismatch: ${name}`)
    files.set(name, bytes)
  }
  for (const name of ["mainz.txt", "qpdf.txt", "qpdf-notice.txt", "emscripten.txt", "zlib.txt", "jpeg.txt"])
    if (!existsSync(`${wasm}/notices/${name}`) || !statSync(`${wasm}/notices/${name}`).isFile())
      throw new Error(`Mainz package license notice is required: ${name}`)
  const loader = files.get("processor.mjs")!.toString("utf8")
  for (const name of ["_mainz_input", "_mainz_clear_inputs", "_mainz_compose", "_mainz_report", "_mainz_report_size"])
    if (!new RegExp(`\\b${name}\\b`).test(loader))
      throw new Error(`Mainz WASM package must support version 1 Jobs: missing ${name}.`)
  const contents = new Map<string, Buffer>()
  function collect(source: string, destination: string) {
    if (statSync(source).isDirectory()) {
      for (const name of readdirSync(source)) collect(join(source, name), join(destination, name))
    } else contents.set(destination, readFileSync(source))
  }
  collect("public", "")
  collect("test/fixtures/demo.pdf", "demo.pdf")
  collect("node_modules/pdfjs-dist/build/pdf.worker.mjs", "pdfjs/pdf.worker.mjs")
  for (const name of ["cmaps", "standard_fonts", "iccs", "wasm"])
    collect(`node_modules/pdfjs-dist/${name}`, `pdfjs/${name}`)
  for (const [name, bytes] of files) contents.set(name, bytes)
  contents.set("provenance.json", provenanceBytes)
  collect(`${wasm}/notices`, "notices")
  collect("node_modules/pdfjs-dist/LICENSE", "pdfjs/LICENSE")
  collect("node_modules/svelte/LICENSE.md", "notices/svelte.txt")
  contents.set(
    "manifest.webmanifest",
    Buffer.from(
      JSON.stringify({
        name: "PDF Composer",
        short_name: "PDF Composer",
        description: "Select, copy, and arrange PDF pages. Style prepared PDFs on your device.",
        start_url: "./",
        scope: "./",
        display: "standalone",
        theme_color: "#800080",
        background_color: "#ffffff",
        icons: [
          { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
          { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
        ],
      }),
    ),
  )
  const hash = createHash("sha256")
  for (const name of [...contents.keys()].toSorted()) {
    const bytes = contents.get(name)!
    hash.update(JSON.stringify([name, bytes.length])).update(bytes)
  }
  const assets = resolve("../.local/tmp/web/assets", hash.digest("hex").slice(0, 16))
  if (!existsSync(assets)) {
    mkdirSync(dirname(assets), { recursive: true })
    const staging = mkdtempSync(join(dirname(assets), "stage-"))
    try {
      for (const [name, bytes] of contents) {
        const target = resolve(staging, name)
        mkdirSync(dirname(target), { recursive: true })
        writeFileSync(target, bytes)
      }
      try {
        // Publish a complete snapshot; another process may have published the same bytes first.
        renameSync(staging, assets)
      } catch (error) {
        if (!["EEXIST", "ENOTEMPTY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error
      }
    } finally {
      rmSync(staging, { recursive: true, force: true })
    }
  }
  for (const path of (readdirSync(assets, { recursive: true }) as string[]).toSorted((a, b) => b.length - a.length)) {
    const file = resolve(assets, path)
    if (statSync(file).isDirectory()) {
      if (!readdirSync(file).length) rmSync(file, { recursive: true })
    } else if (!contents.has(path)) rmSync(file)
  }
  return assets
}
const assets = prepare()

export default defineConfig({
  base: "./",
  build: { outDir: outputDirectory, emptyOutDir: true },
  cacheDir: "../.local/var/js/cache/vite",
  publicDir: assets,
  define: {
    "import.meta.env.VERSION": JSON.stringify(version),
    "import.meta.env.BUILD_ID": JSON.stringify(buildId),
    "import.meta.env.BUILD_TIME": JSON.stringify(builtAt),
    "import.meta.env.BUILD_REVISION": JSON.stringify(revision),
  },
  plugins: [
    svelte(),
    {
      name: "grid-fixture",
      configureServer(server) {
        server.middlewares.use((request, response, next) => {
          if (request.url?.split("?")[0] !== `${server.config.base}grid.pdf`) return next()
          const file = resolve("../.local/tmp/web/grid/sample.pdf")
          if (!existsSync(file)) {
            response.statusCode = 404
            response.end("The Grid demo PDF is unavailable.")
            return
          }
          response.setHeader("Content-Type", "application/pdf")
          response.setHeader("Cache-Control", "no-store")
          response.end(readFileSync(file))
        })
      },
    },
    {
      name: "mainz-assets",
      configResolved(config) {
        outputDirectory = resolve(config.build.outDir)
      },
      async closeBundle() {
        const files = (readdirSync(outputDirectory, { recursive: true }) as string[])
          .filter((path) => statSync(resolve(outputDirectory, path)).isFile() && path !== "sw.js")
          .toSorted()
        const { code: source } = await transformWithOxc(
          readFileSync("src/offline.worker.ts", "utf8"),
          "src/offline.worker.ts",
        )
        const hash = createHash("sha256").update(source)
        const list = files.map((path) => {
          const bytes = readFileSync(resolve(outputDirectory, path))
          hash.update(path).update(bytes)
          return { path, sha256: createHash("sha256").update(bytes).digest("hex") }
        })
        writeFileSync(
          resolve(outputDirectory, "sw.js"),
          `const VERSION = '${hash.digest("hex")}';\nconst ASSETS = ${JSON.stringify(list)};\n${source}`,
        )
      },
    },
  ],
})
