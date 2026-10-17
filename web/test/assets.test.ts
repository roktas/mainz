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
    const project = join(directory, "project")
    mkdirSync(project)
    copyFileSync("../VERSION", join(directory, "VERSION"))
    for (const name of ["vite.config.ts", "package.json"]) copyFileSync(name, join(project, name))
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
      import { createServer } from "vite";
      const server = await createServer();
      await server.close();
      const identity = statSync("../.local/tmp/web/assets").ino;
      writeFileSync("../.local/tmp/web/assets/obsolete.txt", "Test residue.");
      const next = await createServer();
      await next.close();
      assert.equal(statSync("../.local/tmp/web/assets").ino, identity);
      assert.equal(existsSync("../.local/tmp/web/assets/obsolete.txt"), false);
      assert.ok(existsSync("../.local/tmp/web/assets/logo.svg"));
      assert.ok(existsSync("../.local/tmp/web/assets/processor.wasm"));
      assert.ok(existsSync("../.local/tmp/web/assets/demo.pdf"));
      const manifest = JSON.parse(readFileSync("../.local/tmp/web/assets/manifest.webmanifest", "utf8"));
      assert.equal(manifest.name, "PDF Composer");
      assert.equal(manifest.short_name, "PDF Composer");
      assert.equal(manifest.description, "Select, copy, and arrange PDF pages. Style prepared PDFs on your device.");
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
