import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

test("Vite verifies Mainz packages and preserves watched asset directories during cleanup", () => {
  const temporary = resolve("../.local/tmp/web")
  mkdirSync(temporary, { recursive: true })
  const directory = mkdtempSync(join(temporary, "assets-"))
  const packagePath = join(directory, "package")
  const build = () =>
    spawnSync(process.execPath, ["node_modules/vite/bin/vite.js", "build", "--outDir", join(directory, "dist")], {
      encoding: "utf8",
      env: { ...process.env, MAINZ_WASM_DIR: packagePath },
      timeout: 30000,
    })
  try {
    let result = build()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Mainz WASM package is required/)
    mkdirSync(packagePath)
    for (const name of ["processor.mjs", "processor.wasm"]) writeFileSync(join(packagePath, name), "test")
    writeFileSync(join(packagePath, "provenance.json"), JSON.stringify({ files: {} }))
    result = build()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Mainz package digest mismatch/)
    const digest = createHash("sha256").update("test").digest("hex")
    writeFileSync(
      join(packagePath, "provenance.json"),
      JSON.stringify({ files: { "processor.mjs": digest, "processor.wasm": digest } }),
    )
    result = build()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Mainz package license notice is required/)
    mkdirSync(join(packagePath, "notices"))
    for (const name of ["mainz.txt", "qpdf.txt", "qpdf-notice.txt", "emscripten.txt", "zlib.txt", "jpeg.txt"])
      writeFileSync(join(packagePath, "notices", name), "Test notice.")
    result = build()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /Mainz WASM package must support version 1 Jobs/)
    const loader = "_mainz_input _mainz_clear_inputs _mainz_compose _mainz_report _mainz_report_size"
    writeFileSync(join(packagePath, "processor.mjs"), loader)
    writeFileSync(
      join(packagePath, "provenance.json"),
      JSON.stringify({
        files: {
          "processor.mjs": createHash("sha256").update(loader).digest("hex"),
          "processor.wasm": digest,
        },
      }),
    )
    const alternate = `${packagePath}-alternate`
    cpSync(packagePath, alternate, { recursive: true })
    writeFileSync(join(alternate, "processor.wasm"), "alternate")
    writeFileSync(
      join(alternate, "provenance.json"),
      JSON.stringify({
        files: {
          "processor.mjs": createHash("sha256").update(loader).digest("hex"),
          "processor.wasm": createHash("sha256").update("alternate").digest("hex"),
        },
      }),
    )
    const project = join(directory, "project")
    mkdirSync(project)
    copyFileSync("../VERSION", join(directory, "VERSION"))
    for (const name of ["vite.config.ts", "package.json", "index.html"]) copyFileSync(name, join(project, name))
    cpSync("public", join(project, "public"), { recursive: true })
    mkdirSync(join(project, "test", "fixtures"), { recursive: true })
    copyFileSync("test/fixtures/demo.pdf", join(project, "test", "fixtures", "demo.pdf"))
    symlinkSync(resolve("node_modules"), join(project, "node_modules"), "dir")
    const refreshed = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from "node:assert/strict";
      import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
      import { spawn } from "node:child_process";
      import { createServer } from "vite";
      const server = await createServer();
      const assets = server.config.publicDir;
      await server.close();
      const identity = statSync(assets).ino;
      writeFileSync(assets + "/obsolete.txt", "Test residue.");
      const next = await createServer();
      await next.close();
      await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", 'import { createServer } from "vite"; const server = await createServer(); await server.close();'], { stdio: ["ignore", "ignore", "pipe"] });
        let errors = "";
        child.stderr.on("data", (chunk) => errors += chunk);
        child.on("error", reject);
        child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(errors)));
      })));
      assert.equal(statSync(assets).ino, identity);
      assert.equal(existsSync(assets + "/obsolete.txt"), false);
      assert.ok(existsSync(assets + "/logo.svg"));
      assert.ok(existsSync(assets + "/processor.wasm"));
      assert.ok(existsSync(assets + "/demo.pdf"));
      const manifest = JSON.parse(readFileSync(assets + "/manifest.webmanifest", "utf8"));
      assert.equal(manifest.name, "PDF Composer");
      assert.equal(manifest.short_name, "PDF Composer");
      assert.equal(manifest.description, "Select, copy, and arrange PDF pages. Style prepared PDFs on your device.");
      assert.deepEqual(manifest.icons, [
        { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      ]);
      assert.match(readFileSync("index.html", "utf8"), /rel="apple-touch-icon" sizes="180x180" href="%BASE_URL%apple-touch-icon.png"/);
      for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
        const png = readFileSync(assets + "/" + name);
        assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
      }
      const first = await createServer({ server: { host: "127.0.0.1", port: 0 } });
      let second;
      try {
        await first.listen();
        const url = first.resolvedUrls.local[0] + "processor.wasm";
        assert.equal(await (await fetch(url)).text(), "test");
        process.env.MAINZ_WASM_DIR += "-alternate";
        second = await createServer({ server: { host: "127.0.0.1", port: 0 } });
        await second.listen();
        assert.equal(await (await fetch(second.resolvedUrls.local[0] + "processor.wasm")).text(), "alternate");
        assert.equal(await (await fetch(url)).text(), "test", "A second package cannot replace a running server's WASM");
      } finally {
        await second?.close();
        await first.close();
      }
    `,
      ],
      {
        cwd: project,
        encoding: "utf8",
        env: { ...process.env, MAINZ_WASM_DIR: packagePath },
        timeout: 30000,
      },
    )
    assert.equal(refreshed.status, 0, refreshed.stderr)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
