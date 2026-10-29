// Checks package verification and complete asset publication before browser startup.

import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { copyFileSync, cpSync, mkdtempSync, mkdirSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { spawnSync } from "node:child_process"
import test from "node:test"

test("Vite verifies Mainz packages and publishes complete asset revisions", () => {
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
    assert.match(result.stderr, /Mainz WASM package.*missing _mainz_input/)
    const writePackage = (loader) => {
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
    }
    const jobs = "_mainz_input _mainz_clear_inputs _mainz_compose _mainz_report _mainz_report_size"
    writePackage(jobs)
    result = build()
    assert.notEqual(result.status, 0)
    assert.match(result.stderr, /missing _mainz_style/)
    const loader = `${jobs} _mainz_style`
    writePackage(loader)
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
    writeFileSync(join(project, "public", "revision.txt"), "first")
    writeFileSync(join(project, "public", "retired.txt"), "first only")
    writeFileSync(join(project, "public", "processor.wasm"), "Unverified public input.")
    writeFileSync(join(project, "public", "provenance.json"), "Unverified public metadata.")
    mkdirSync(join(project, "test", "fixtures"), { recursive: true })
    copyFileSync("test/fixtures/demo.pdf", join(project, "test", "fixtures", "demo.pdf"))
    mkdirSync(join(project, "node_modules"))
    for (const name of readdirSync("node_modules"))
      if (name !== "pdfjs-dist") symlinkSync(resolve("node_modules", name), join(project, "node_modules", name))
    cpSync("node_modules/pdfjs-dist", join(project, "node_modules", "pdfjs-dist"), { recursive: true })
    writeFileSync(join(project, "node_modules", "pdfjs-dist", "LICENSE"), "First PDF.js test notice.")
    const refreshed = spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `
      import assert from "node:assert/strict";
      import { existsSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
      import { spawn } from "node:child_process";
      import { createServer } from "vite";
      const server = await createServer();
      const assets = server.config.publicDir;
      await server.close();
      const identity = statSync(assets).ino;
      writeFileSync(assets + "/obsolete.txt", "Test residue.");
      const next = await createServer();
      await next.close();
      writeFileSync("public/revision.txt", "parallel");
      await Promise.all(Array.from({ length: 3 }, () => new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", 'import assert from "node:assert/strict"; import { readFileSync } from "node:fs"; import { createServer } from "vite"; const server = await createServer(); const assets = server.config.publicDir; await server.close(); assert.equal(JSON.parse(readFileSync(assets + "/manifest.webmanifest")).name, "PDF Composer"); assert.equal(readFileSync(assets + "/processor.wasm", "utf8"), "test"); assert.equal(readFileSync(assets + "/revision.txt", "utf8"), "parallel");'], { stdio: ["ignore", "ignore", "pipe"] });
        let errors = "";
        child.stderr.on("data", (chunk) => errors += chunk);
        child.on("error", reject);
        child.on("exit", (code) => code === 0 ? resolve() : reject(new Error(errors)));
      })));
      writeFileSync("public/revision.txt", "first");
      assert.equal(statSync(assets).ino, identity);
      assert.equal(existsSync(assets + "/obsolete.txt"), false);
      assert.ok(existsSync(assets + "/logo.svg"));
      assert.ok(existsSync(assets + "/processor.wasm"));
      assert.ok(existsSync(assets + "/demo.pdf"));
      assert.equal(readFileSync(assets + "/provenance.json", "utf8"), readFileSync(process.env.MAINZ_WASM_DIR + "/provenance.json", "utf8"));
      const manifest = JSON.parse(readFileSync(assets + "/manifest.webmanifest", "utf8"));
      assert.equal(manifest.name, "PDF Composer");
      assert.equal(manifest.short_name, "PDF Composer");
      assert.equal(manifest.description, "Select, copy, and arrange PDF pages. Style prepared PDFs on your device.");
      assert.deepEqual(manifest.icons, [
        { src: "icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
        { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
      ]);
      assert.match(readFileSync("index.html", "utf8"), /rel="apple-touch-icon" sizes="180x180" href="%BASE_URL%apple-touch-icon.png"/);
      for (const [name, size] of [["apple-touch-icon.png", 180], ["icon-192.png", 192], ["icon-512.png", 512]]) {
        const png = readFileSync(assets + "/" + name);
        assert.equal(png.subarray(1, 4).toString(), "PNG");
        assert.equal(png.readUInt32BE(16), size);
        assert.equal(png.readUInt32BE(20), size);
      }
      const first = await createServer({ server: { host: "127.0.0.1", port: 0 } });
      const originalPackage = process.env.MAINZ_WASM_DIR;
      let second;
      let third;
      let fourth;
      try {
        await first.listen();
        const url = first.resolvedUrls.local[0] + "processor.wasm";
        assert.equal(await (await fetch(url)).text(), "test");
        process.env.MAINZ_WASM_DIR += "-alternate";
        second = await createServer({ server: { host: "127.0.0.1", port: 0 } });
        await second.listen();
        assert.equal(await (await fetch(second.resolvedUrls.local[0] + "processor.wasm")).text(), "alternate");
        assert.equal(await (await fetch(url)).text(), "test", "A second package cannot replace a running server's WASM");
        process.env.MAINZ_WASM_DIR = originalPackage;
        writeFileSync("public/revision.txt", "second");
        rmSync("public/retired.txt");
        writeFileSync("public/added.txt", "second only");
        third = await createServer({ server: { host: "127.0.0.1", port: 0 } });
        await third.listen();
        const previous = first.resolvedUrls.local[0];
        const current = third.resolvedUrls.local[0];
        assert.equal(await (await fetch(current + "revision.txt")).text(), "second");
        assert.equal(await (await fetch(current + "added.txt")).text(), "second only");
        assert.equal(await (await fetch(current + "pdfjs/LICENSE")).text(), "First PDF.js test notice.");
        assert.equal((await fetch(current + "retired.txt", { headers: { Accept: "text/plain" } })).status, 404);
        assert.equal(await (await fetch(previous + "revision.txt")).text(), "first", "A public revision cannot replace a running server's assets");
        assert.equal(await (await fetch(previous + "retired.txt")).text(), "first only");
        assert.equal(await (await fetch(previous + "pdfjs/LICENSE")).text(), "First PDF.js test notice.");
        assert.equal((await fetch(previous + "added.txt", { headers: { Accept: "text/plain" } })).status, 404);
        writeFileSync("node_modules/pdfjs-dist/LICENSE", "Second PDF.js test notice.");
        fourth = await createServer({ server: { host: "127.0.0.1", port: 0 } });
        await fourth.listen();
        assert.equal(await (await fetch(fourth.resolvedUrls.local[0] + "pdfjs/LICENSE")).text(), "Second PDF.js test notice.");
        assert.equal(await (await fetch(current + "pdfjs/LICENSE")).text(), "First PDF.js test notice.", "A PDF.js revision cannot replace a running server's resources");
      } finally {
        await fourth?.close();
        await third?.close();
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
