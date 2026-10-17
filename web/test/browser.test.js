import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve as resolvePath } from "node:path";
import { build, createServer as createViteServer, preview } from "vite";
import { chromium, devices } from "playwright";
import { aligned, checkWorkspace, zoom } from "./workspace.js";

const parameter = (property, schema) => ({
  binding: { property, targets: ["guides"] },
  schema,
});
const stream = (dictionary, data) =>
  `<< ${dictionary} /Length ${Buffer.byteLength(data)} >>\nstream\n${data}\nendstream`;
const pixel = (canvas, y) =>
  canvas.evaluate(
    (element, fraction) =>
      Array.from(
        element
          .getContext("2d")
          .getImageData(Math.floor(element.width / 2), Math.floor(element.height * fraction), 1, 1).data,
      ),
    y,
  );
const tab = (pane, name) => pane.getByRole("tab", { name, exact: true }).click();
const image = (pane) => pane.locator(".page-scroll canvas");
const pagePosition = (pane) => pane.locator(".inspection-heading .page-position").innerText();
const hasCursor = (element = document.activeElement) => {
  const card = element.closest(".composition-card");
  if (!card) return false;
  const style = getComputedStyle(card);
  return (
    style.borderTopWidth === "2px" &&
    style.borderTopColor === getComputedStyle(document.querySelector(".workspace-icon")).color
  );
};
const createServer = (config) => createViteServer({ cacheDir: resolvePath("../.local/tmp/web/cache"), ...config });

function fixture(
  prepared = true,
  mixedDisplay = false,
  profileCount = 0,
  grouped = false,
  fillOnly = false,
  widthConstraints = {},
  count = prepared ? 7 : 1,
) {
  const pages = Object.fromEntries(Array.from({ length: count }, (_, index) => [`page${index}`, index]));
  const baseline = {
    paint: "S",
    width: "0.2",
    stroke: { operator: "G", operands: ["0.2"] },
    fill: { operator: "g", operands: ["0"] },
    strokeOpacity: "1",
    fillOpacity: "1",
    display: "inline",
    fillRule: "nonzero",
  };
  const regions = Object.fromEntries(
    Object.keys(pages).map((page, index) => [
      page,
      {
        page,
        marker: "Guides",
        records: [
          {
            path: [],
            marker: "Paint",
            baseline: mixedDisplay && index % 2 ? "hidden" : "guides",
            fill: "none",
          },
        ],
      },
    ]),
  );
  const manifest = {
    version: 1,
    pages,
    regions,
    baselines: {
      guides: baseline,
      ...(mixedDisplay ? { hidden: { ...baseline, display: "none" } } : {}),
    },
    targets: { guides: Object.keys(regions) },
    parameters: {
      "guides-display": parameter("display", {
        type: "string",
        title: "Show guides",
        enum: ["inline", "none"],
      }),
      "guides-stroke-color": parameter("stroke-color", { type: "string", title: "Guide color" }),
      "guides-stroke-width": parameter("stroke-width", {
        type: "number",
        title: "Guide width",
        exclusiveMinimum: 0,
        maximum: 2,
        ...widthConstraints,
      }),
      "guides-stroke-opacity": parameter("stroke-opacity", {
        type: "number",
        title: "Guide opacity",
        minimum: 0,
        maximum: 1,
      }),
    },
    groups: [
      {
        title: "Guides",
        parameters: ["guides-stroke-color", "guides-stroke-width", "guides-stroke-opacity", "guides-display"],
      },
    ],
  };
  if (fillOnly) {
    baseline.paint = "f";
    for (const region of Object.values(regions)) region.records[0].fill = "existing";
    manifest.parameters = {
      "guides-display": manifest.parameters["guides-display"],
      "guides-fill-color": parameter("fill-color", { type: "string", title: "Fill color" }),
      "guides-fill-opacity": parameter("fill-opacity", {
        type: "number",
        title: "Fill opacity",
        minimum: 0,
        maximum: 1,
      }),
    };
    manifest.groups[0].parameters = Object.keys(manifest.parameters);
  }
  if (!grouped) {
    manifest.groups[0].parameters = ["guides-stroke-color", "guides-stroke-width"];
    manifest.groups.push({
      title: "Guide visibility and opacity",
      parameters: ["guides-display", "guides-stroke-opacity"],
    });
  }
  if (profileCount)
    manifest.profileSets = [
      {
        id: "print",
        name: "Style profile",
        parameters: Object.keys(manifest.parameters),
        profiles: [
          { id: "generic", name: "Generic", overrides: {} },
          ...(profileCount > 1
            ? [
                {
                  id: "inkjet",
                  name: "Inkjet",
                  description: "Fine guides",
                  overrides: { "guides-stroke-width": 0.04 },
                },
              ]
            : []),
        ],
      },
    ];
  const objects = [
    `<< /Type /Catalog /Pages 2 0 R ${prepared ? "/Names << /EmbeddedFiles << /Names [(mainz.json) 4 0 R] >> >>" : ""} >>`,
    `<< /Type /Pages /Kids [${Array.from({ length: count }, (_, index) => `${5 + index * 2} 0 R`).join(" ")}] /Count ${count} /MediaBox [0 0 595.2756 841.8898] >>`,
    stream("/Type /EmbeddedFile /Subtype /application#2Fjson", JSON.stringify(manifest)),
    "<< /Type /Filespec /F (mainz.json) /UF (mainz.json) /EF << /F 3 0 R /UF 3 0 R >> >>",
  ];
  for (let index = 0; index < count; index++) {
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Contents ${6 + index * 2} 0 R ${prepared && index === count - 1 ? "/MediaBox [0 0 841.8898 595.2756]" : ""} /Resources << /Properties << /Guides <<>> /Paint <<>> >> /ExtGState << /Alpha << /Type /ExtGState /CA ${mixedDisplay && index % 2 ? 0 : 1} /ca ${mixedDisplay && index % 2 ? 0 : 1} >> >> >> >>`,
    );
    objects.push(
      stream(
        "",
        `/Figure /Guides BDC /Figure /Paint BDC q 0.2 w 0.2 G 0 g /Alpha gs 20 ${100 + (index % 7) * 20} 400 300 re ${fillOnly ? "f" : "S"} Q EMC EMC`,
      ),
    );
  }
  let pdf = "%PDF-1.7\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("")}trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf);
}

async function checkGrips(pane, label) {
  const page = pane.page();
  const button = pane.locator(".composition-card").first().locator(".page-image");
  for (let state = 0; state < 2; state++) {
    await button.click();
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      const offsets = await pane.locator(".composition-card").evaluateAll((cards) =>
        cards.map((card) => {
          const bounds = card.getBoundingClientRect();
          const header = card.querySelector(".page-label").getBoundingClientRect();
          const grip = card.querySelector(".page-grip svg").getBoundingClientRect();
          return [
            grip.left + grip.width / 2 - bounds.left - bounds.width / 2,
            grip.top + grip.height / 2 - header.top - header.height / 2,
          ];
        }),
      );
      assert.ok(
        offsets.every((axes) => axes.every((offset) => Math.abs(offset) < 1)),
        `${label}, ${colorScheme}`,
      );
    }
  }
}

async function checkGeometry(group) {
  assert.deepEqual(await group.locator(".quartet-fields .quartet-caption > span").allTextContents(), [
    "Fill",
    "Stroke",
    "Width",
    "Visibility",
  ]);
  const sizes = await group.locator(".quartet-fields .quartet-component").evaluateAll((elements) =>
    elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { width: box.width, height: box.height };
    }),
  );
  assert.ok(sizes.length >= 4);
  for (const size of sizes) {
    assert.ok(Math.abs(size.width - sizes[0].width) < 1, "Object components must have equal widths");
    assert.ok(Math.abs(size.height - sizes[0].height) < 1, "Object components must have equal heights");
    assert.ok(size.height >= 44);
  }
}

async function checkStatus(page) {
  for (const bottom of [false, true]) {
    await page.evaluate((end) => window.scrollTo(0, end ? document.documentElement.scrollHeight : 0), bottom);
    const box = await page.locator(".footnote").boundingBox();
    assert.ok(box.y >= 0 && box.y + box.height <= page.viewportSize().height + 1);
    assert.ok(Math.abs(box.y + box.height - page.viewportSize().height) < 1);
  }
  const footer = await page.locator(".footnote").boundingBox();
  const workspace = await page.locator(".composer").boundingBox();
  assert.ok(workspace.y + workspace.height <= footer.y, "Status must not cover the last workspace controls");
}

test("Page headings and navigation follow fitted image edges", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    for (const [width, height, colorScheme, text] of [
      [1280, 900, "light", "100%"],
      [1920, 720, "dark", "100%"],
      [375, 667, "light", "100%"],
      [320, 568, "dark", "100%"],
      [390, 844, "dark", "200%"],
      [640, 960, "light", "100%"],
      [641, 960, "dark", "100%"],
      [768, 1024, "light", "100%"],
    ]) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme });
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), text);
      for (const [selector, name] of [
        [".selection-panel", "Input"],
        [".composition-output", "Output"],
      ]) {
        const pane = page.locator(selector);
        const views = page.locator(".mobile-workspace-tabs");
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click();
        await tab(pane, "Page");
        const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true });
        for (const key of ["Home", "End"]) {
          await viewport.focus();
          await page.keyboard.press(key);
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          await pane.locator(".pdf-viewport[aria-busy=false]").waitFor();
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const fitted = await image(pane).boundingBox();
          for (const action of [undefined, "Zoom out", "Fit page", "Zoom in", "Fit page"]) {
            if (action) await zoom(pane, action);
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            );
            await pane.locator(".pdf-viewport[aria-busy=false]").waitFor();
            await page.evaluate(
              () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
            );
            const geometry = await pane.locator(".page-view").evaluate((view) => {
              const box = (query) => view.querySelector(query).getBoundingClientRect();
              const grip = view.querySelector(".inspection-heading .page-grip")?.getBoundingClientRect();
              const fit = [...view.querySelector('button[aria-label="Fit page"]').children].find(
                (child) => getComputedStyle(child).display !== "none",
              );
              const items = [...view.querySelector(".page-zoom").children]
                .map((child) => child.getBoundingClientRect())
                .filter((rect) => rect.width > 1);
              return {
                starts: [box(".page-current").left, box(".page-navigation > button:first-child svg").left],
                ends: [fit.getBoundingClientRect().right, box(".page-navigation > button:last-child svg").right],
                grip: grip && grip.x + grip.width / 2,
                gripTop: grip?.top,
                toolTop: box(".page-tools").top,
                items: items.length,
                centers: items.map((rect) => rect.x + rect.width / 2),
                targets: [...view.querySelectorAll(".page-tools button")].map((button) => {
                  const rect = button.getBoundingClientRect();
                  return { width: rect.width, height: rect.height };
                }),
                zoom: view.querySelector(".page-zoom output").textContent,
                fit: fit.tagName === "svg" ? "icon" : fit.textContent,
              };
            });
            const label = `${name}, ${width}×${height}, ${key}, ${action ?? "Fit"}`;
            assert.ok(
              geometry.starts.every((x) => Math.abs(x - fitted.x) < 1),
              `${label}: counter and Previous align with the image start`,
            );
            assert.ok(
              geometry.ends.every((x) => Math.abs(x - fitted.x - fitted.width) < 1),
              `${label}: Fit and Next align with the image end`,
            );
            if (geometry.grip !== undefined)
              assert.ok(Math.abs(geometry.grip - fitted.x - fitted.width / 2) < 1, `${label}: the grip stays centered`);
            const compact = width <= 640;
            assert.equal(geometry.items, compact ? 3 : 4, `${label}: the zoom group uses the screen layout`);
            const spacing = geometry.centers.slice(1).map((center, index) => center - geometry.centers[index]);
            assert.ok(
              spacing.every((gap) => Math.abs(gap - spacing[0]) < 1),
              `${label}: zoom items are evenly spaced`,
            );
            assert.ok(
              geometry.targets.every((target) => target.width >= 44 && target.height >= 44),
              `${label}: touch targets keep their size`,
            );
            assert.equal(
              geometry.fit,
              compact && geometry.zoom !== "100%" ? geometry.zoom : "icon",
              `${label}: Fit shows an icon or the current zoom`,
            );
            if (width === 375 && name === "Input" && key === "Home" && !action)
              assert.equal(geometry.toolTop, geometry.gripTop, `${label}: fitting tools stay on the first row`);
          }
        }
      }
    }
    assert.deepEqual(errors, [], "Page layout and resizing have no browser errors");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Workspace tools wrap without moving the view tabs", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ hasTouch: true, isMobile: true, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    for (const [width, text, colorScheme] of [
      [320, "100%", "light"],
      [375, "100%", "dark"],
      [430, "100%", "light"],
      [640, "100%", "dark"],
      [768, "100%", "light"],
      [1280, "100%", "dark"],
      [320, "200%", "dark"],
      [375, "200%", "light"],
    ]) {
      await page.setViewportSize({ width, height: 900 });
      await page.emulateMedia({ colorScheme });
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), text);
      for (const [selector, name] of [
        [".selection-panel", "Input"],
        [".composition-output", "Output"],
      ]) {
        const pane = page.locator(selector);
        const views = page.locator(".mobile-workspace-tabs");
        if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click();
        if (name === "Input") {
          if (text === "100%")
            assert.ok(
              await pane.locator(".input-current").evaluate((element) => element.scrollWidth <= element.clientWidth),
              `${width}px: the demo filename fits the chooser`,
            );
          await pane.locator(".input-picker > summary").click();
          assert.ok(
            await pane.getByRole("button", { name: "Remove Input", exact: true }).evaluate((button) => {
              const rect = button.getBoundingClientRect();
              return (
                rect.width >= 44 &&
                rect.height >= 44 &&
                rect.x >= 0 &&
                rect.right <= innerWidth &&
                document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") ===
                  button
              );
            }),
            `${width}px, ${text}: Input removal fits above the workspace`,
          );
          await page.keyboard.press("Escape");
        }
        if (name === "Output") await pane.getByRole("textbox", { name: "Page selection", exact: true }).fill("2");
        let reference;
        for (const view of name === "Input" ? ["Page", "Grid", "Style"] : ["Page", "Grid"]) {
          await tab(pane, view);
          const bounds = await pane.locator(".tabs").evaluate((tabs) => {
            const origin = tabs.getBoundingClientRect();
            return [...tabs.children].map((element) => {
              const rect = element.getBoundingClientRect();
              return { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
            });
          });
          reference ??= bounds;
          const label = `${name} ${view}, ${width}px, ${text}`;
          assert.deepEqual(bounds, reference, `${label}: adjacent tools preserve tab positions and sizes`);
          if (text === "100%")
            assert.ok(
              bounds.every((rect) => rect.y === 0),
              `${label}: tabs share one row`,
            );
          if (view === "Grid") {
            const tabs = await pane.locator(".tabs").boundingBox();
            const density = await pane.locator(".grid-density").boundingBox();
            assert.ok(
              density.y >= tabs.y + tabs.height || density.x >= tabs.x + tabs.width,
              `${label}: density controls do not cover tabs`,
            );
            assert.ok(density.x >= 0 && density.x + density.width <= width, `${label}: density controls fit`);
            if (text === "100%") assert.equal(density.y, tabs.y, `${label}: tabs and density controls share one row`);
          }
          if (text === "100%" && view !== "Style")
            assert.ok(
              await pane
                .locator(".sequence-help > span")
                .first()
                .evaluate((hint) => {
                  const range = document.createRange();
                  range.selectNodeContents(hint);
                  return range.getBoundingClientRect().height <= parseFloat(getComputedStyle(hint).lineHeight) + 1;
                }),
              `${label}: routine selection help fits one line`,
            );
          if (view !== "Style") {
            const bar = await pane.locator(".sequence-entry > .entry").boundingBox();
            const addition = await pane
              .getByRole("button", {
                name: name === "Input" ? "Add to Output" : "Duplicate selected Output pages",
                exact: true,
              })
              .boundingBox();
            assert.ok(
              Math.abs(addition.x + addition.width - bar.x - bar.width) < 1,
              `${label}: addition ends at the bar edge`,
            );
            assert.ok(
              await pane.locator(".sequence-entry .step").evaluateAll((buttons) =>
                buttons.every((button) => {
                  const rect = button.getBoundingClientRect();
                  return rect.width >= 44 && rect.height >= 44;
                }),
              ),
              `${label}: both panes retain full-size action targets`,
            );
            if (text === "100%")
              assert.ok(
                await pane.getByRole("textbox", { name: "Page selection", exact: true }).evaluate((field) => {
                  const style = getComputedStyle(field);
                  const canvas = document.createElement("canvas").getContext("2d");
                  canvas.font = style.font;
                  return (
                    field.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >=
                    canvas.measureText(innerWidth < 375 ? "2,4" : "2,4-6").width
                  );
                }),
                `${label}: the selection field fits a short page sequence`,
              );
          }
          assert.ok(
            await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            `${label}: no overflow`,
          );
        }
        if (name === "Output") {
          for (const [direction, number] of [
            ["earlier", "1"],
            ["later", "2"],
          ]) {
            const menu = pane.getByLabel("Output page actions", { exact: true });
            await menu.click();
            const movement = pane.getByRole("button", { name: `Move selected pages ${direction}`, exact: true });
            await movement.scrollIntoViewIfNeeded();
            assert.ok(
              await movement.evaluate((button) => {
                const rect = button.getBoundingClientRect();
                return (
                  rect.width >= 44 &&
                  rect.height >= 44 &&
                  rect.x >= 0 &&
                  rect.right <= innerWidth &&
                  document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)?.closest("button") ===
                    button
                );
              }),
              `${width}px, ${text}: movement remains reachable in the Output menu`,
            );
            await movement.click();
            assert.equal(await pane.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), number);
            assert.ok(
              await menu.evaluate((summary) => summary === document.activeElement && !summary.parentElement.open),
            );
          }
        }
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Help follows the primary pointer and touch tours retain visible focus", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const hasTouch of [false, true]) {
      const page = await browser.newPage({ hasTouch, reducedMotion: "reduce" });
      await page.goto(`${server.resolvedUrls.local[0]}?demo=empty`);
      const welcome = page.getByRole("dialog", { name: "Welcome to PDF Studio", exact: true });
      await welcome.getByRole("button", { name: "Take a tour", exact: true }).click();
      await page
        .getByRole("dialog", { name: "Product tour", exact: true })
        .getByRole("button", { name: "End tour", exact: true })
        .click();
      assert.equal(
        await page
          .getByRole("button", { name: hasTouch ? "Settings" : "Help", exact: true })
          .evaluate((button) => button === document.activeElement),
        true,
        "Ending the tour returns focus to a visible header control",
      );
      for (const width of [375, 1024]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(
          await page.locator(".help-button").isVisible(),
          !hasTouch,
          `${width}px: Help follows pointer type`,
        );
        assert.equal(await page.getByRole("button", { name: "Help", exact: true }).count(), hasTouch ? 0 : 1);
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Page controls retain space and alignment with wide fonts and enlarged mobile text", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    const output = page.locator(".composition-output");
    await tab(output, "Page");
    for (const font of ["DejaVu Sans", "ui-sans-serif"]) {
      for (const [width, text] of [
        [1440, "100%"],
        [320, "200%"],
        [375, "200%"],
      ]) {
        await page.setViewportSize({ width, height: 1100 });
        await page.evaluate(
          ({ font: family, text: scale }) => {
            document.body.style.fontFamily = family;
            document.documentElement.style.fontSize = scale;
          },
          { font, text },
        );
        const views = page.locator(".mobile-workspace-tabs");
        if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).click();
        assert.equal(
          await aligned(output),
          true,
          `${font}, ${width}px, ${text}: controls align and leave room for the grip`,
        );
        const tools = await output.getByRole("group", { name: "Output Page controls", exact: true }).boundingBox();
        assert.ok(tools.x >= 0 && tools.x + tools.width <= width, `${font}, ${width}px, ${text}: all tools fit`);
        const frame = await output.locator(".inspection-heading").boundingBox();
        assert.ok(
          tools.x >= frame.x && tools.x + tools.width <= frame.x + frame.width,
          `${font}, ${width}px, ${text}: the page frame does not clip tools`,
        );
        const percentage = await output.getByLabel("Output page zoom", { exact: true }).boundingBox();
        assert.ok(
          percentage.x >= frame.x &&
            percentage.x + percentage.width <= frame.x + frame.width &&
            percentage.y >= frame.y &&
            percentage.y + percentage.height <= frame.y + frame.height,
          `${font}, ${width}px, ${text}: the percentage remains inside the page heading`,
        );
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Landing compact headings fit phones and tablets and logos follow theme changes and reloads", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ reducedMotion: "reduce", hasTouch: true });
    await page.goto(server.resolvedUrls.local[0]);
    await page.evaluate(() => document.fonts.ready);
    const heading = page.getByRole("heading", { level: 1 });
    const ordinary = page.getByText("Ordinary PDFs also support page selection and repetition.", { exact: true });
    for (const [width, height] of [
      [320, 568],
      [375, 667],
      [390, 844],
      [414, 896],
      [430, 932],
      [440, 763],
      [480, 800],
      [481, 800],
      [640, 960],
    ]) {
      await page.setViewportSize({ width, height });
      assert.equal(await heading.innerText(), "Select & style prepared PDFs.");
      assert.equal(await ordinary.isVisible(), false, `${width}px: phone copy stays short`);
      for (const text of ["100%", "200%"]) {
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        if (text === "100%")
          assert.ok(
            await heading.evaluate(
              (element) =>
                Math.abs(element.getBoundingClientRect().height - parseFloat(getComputedStyle(element).lineHeight)) < 1,
            ),
            `${width}px: the phone heading fits one line`,
          );
        const layout = await page.evaluate(() => {
          const mark = document.querySelector(".hero-mark").getBoundingClientRect();
          const product = document.querySelector(".brand-title");
          const purpose = document.querySelector(".welcome h1");
          const area = document.querySelector(".drop-zone");
          const frame = area.getBoundingClientRect();
          return {
            mark: mark.width,
            gap: product.getBoundingClientRect().y - mark.bottom,
            inset: mark.y - frame.y,
            left: frame.x,
            right: document.querySelector("#app").getBoundingClientRect().right - frame.right,
            top: frame.y - document.querySelector(".header-inner").getBoundingClientRect().bottom,
            headerStart: frame.x - document.querySelector(".header-inner").getBoundingClientRect().x,
            headerEnd: frame.right - document.querySelector(".header-inner").getBoundingClientRect().right,
            product: parseFloat(getComputedStyle(product).fontSize),
            heading: parseFloat(getComputedStyle(purpose).fontSize),
          };
        });
        assert.ok(layout.mark >= 160, `${width}px: the logo has room above the text`);
        assert.ok(layout.gap >= 16 && layout.inset >= 18, `${width}px: the logo retains its surrounding space`);
        if (width > 375) {
          assert.ok(
            Math.abs(layout.left - layout.right) < 1 && Math.abs(layout.left - layout.top) < 1,
            `${width}px: mobile landing margins are equal`,
          );
          assert.ok(
            Math.abs(layout.headerStart) < 1 && Math.abs(layout.headerEnd) < 1,
            `${width}px: the header aligns with the landing border`,
          );
          if (text === "100%") assert.ok(layout.left >= 40, `${width}px: margins retain the largest existing gap`);
        } else if (text === "100%") assert.equal(layout.left, 28, "SE retains its compact margins");
        if (width <= 480) {
          assert.ok(layout.gap >= 28, `${width}px: more space separates the logo and product name`);
          if (text === "100%") {
            assert.ok(layout.mark >= 190, `${width}px: small phones use a larger logo`);
            assert.ok(Math.abs(layout.inset - 25) < 1, `${width}px: more space precedes the logo`);
          }
        }
        if (width <= 390) {
          assert.ok(Math.abs(layout.product / layout.heading - 0.75) < 0.01);
          if (text === "100%") assert.ok(layout.heading <= 26, `${width}px: phone headings use smaller type`);
        }
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
    }
    for (const [width, height] of [
      [768, 1024],
      [810, 1080],
      [820, 1180],
      [1024, 768],
      [1080, 810],
      [1180, 820],
      [1194, 834],
    ]) {
      await page.setViewportSize({ width, height });
      assert.equal(await heading.innerText(), "Select & style prepared PDFs.");
      assert.ok(
        await heading.evaluate(
          (element) =>
            Math.abs(element.getBoundingClientRect().height - parseFloat(getComputedStyle(element).lineHeight)) < 1,
        ),
        `${width}px: the tablet heading fits one line`,
      );
      const layout = await page.evaluate(() => {
        const area = document.querySelector(".drop-zone").getBoundingClientRect();
        const header = document.querySelector(".header-inner").getBoundingClientRect();
        return {
          inset: area.x,
          right: document.querySelector("#app").getBoundingClientRect().right - area.right,
          top: area.y - header.bottom,
          start: area.x - header.x,
          end: area.right - header.right,
        };
      });
      assert.ok(layout.inset >= 40, `${width}px: tablets have wider outer margins`);
      assert.ok(Math.abs(layout.start) < 1 && Math.abs(layout.end) < 1, `${width}px: header and landing edges align`);
      assert.ok(
        Math.abs(layout.inset - layout.right) < 1 && Math.abs(layout.inset - layout.top) < 1,
        `${width}px: tablet landing margins are equal`,
      );
    }
    await page.setViewportSize({ width: 1440, height: 1100 });
    assert.equal(await heading.innerText(), "Select pages and style prepared PDFs.");
    assert.equal(await ordinary.isVisible(), true, "Desktop copy explains ordinary PDF support");
    assert.match(await page.locator(".welcome > p").last().innerText(), /printer\. Ordinary PDFs/);
    await page.setViewportSize({ width: 768, height: 1024 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
    const colors = { light: [128, 0, 128], dark: [229, 195, 156] };
    const checkLogos = async (theme) => {
      for (const selector of [".brand .logo", ".hero-mark .logo"]) {
        const screenshot = await page.locator(selector).screenshot();
        const color = await page.evaluate(async (data) => {
          const bitmap = new Image();
          bitmap.src = `data:image/png;base64,${data}`;
          await bitmap.decode();
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d");
          context.drawImage(bitmap, 0, 0);
          return Array.from(
            context.getImageData(Math.floor(bitmap.width / 2), Math.floor(bitmap.height / 2), 1, 1).data,
          );
        }, screenshot.toString("base64"));
        assert.ok(
          colors[theme].every((value, index) => Math.abs(value - color[index]) <= 2),
          `${selector}: ${theme}`,
        );
      }
    };
    for (const system of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: system });
      await page.evaluate(() => localStorage.removeItem("mainz:theme"));
      await page.reload();
      await checkLogos(system);
      await page.getByRole("button", { name: "Toggle theme" }).click();
      await checkLogos(system === "light" ? "dark" : "light");
      await page.getByRole("button", { name: "Toggle theme" }).click();
      await checkLogos(system);
      await page.reload();
      await checkLogos(system);
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Landing logo replays entry and keeps parallax inside its framed area", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      reducedMotion: "no-preference",
    });
    await page.goto(server.resolvedUrls.local[0], { waitUntil: "domcontentloaded" });
    const mark = page.locator(".hero-mark");
    const logo = mark.locator(".logo");
    await mark.waitFor();
    const corner = async () => {
      const area = await page.locator(".drop-zone").boundingBox();
      await page.mouse.move(area.x + area.width - 8, area.y + area.height - 8);
    };
    await corner();
    assert.equal(
      await logo.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41),
      0,
      "Pointer movement waits for the opening animation",
    );
    await mark.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    for (const theme of ["light", "dark"]) {
      await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
      const replay = page.getByRole("button", { name: "Replay logo animation" });
      if (theme === "light") await replay.click();
      else await replay.press("Enter");
      assert.equal(
        await mark.evaluate((element) => element.getAnimations()[0]?.playState),
        "running",
        `${theme}: the header logo restarts the entry animation`,
      );
      await mark.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
      await page.mouse.move(10, 10);
      await corner();
      await page.waitForFunction(
        () => new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".hero-mark .logo")).transform).m41 > 10,
      );
      const position = await logo.evaluate((element) => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
        return { x: matrix.m41, y: matrix.m42 };
      });
      assert.ok(position.x <= 16 && position.y <= 12, `${theme}: parallax stays bounded`);
      await page.mouse.move(10, 10);
      await page.waitForFunction(() => {
        const matrix = new DOMMatrixReadOnly(getComputedStyle(document.querySelector(".hero-mark .logo")).transform);
        return Math.abs(matrix.m41) < 0.01 && Math.abs(matrix.m42) < 0.01;
      });
      await page.mouse.move(1300, 30);
      assert.ok(
        Math.abs(await logo.evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).m41)) <
          0.01,
        "Pointer movement outside the framed area leaves the logo centered",
      );
    }
    await corner();
    await page.getByRole("button", { name: "Replay logo animation" }).press("Space");
    assert.equal(await mark.evaluate((element) => element.getAnimations()[0]?.playState), "running");
    await page.emulateMedia({ reducedMotion: "reduce" });
    assert.equal(await logo.evaluate((element) => getComputedStyle(element).transform), "none");
    await page.getByRole("button", { name: "Replay logo animation" }).click();
    assert.equal(await mark.evaluate((element) => element.getAnimations().length), 0);
    const touch = await browser.newPage({
      viewport: { width: 375, height: 667 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "no-preference",
    });
    await touch.goto(server.resolvedUrls.local[0]);
    await touch
      .locator(".hero-mark")
      .evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished)));
    await touch.getByRole("button", { name: "Replay logo animation" }).tap();
    assert.equal(
      await touch.locator(".hero-mark").evaluate((element) => element.getAnimations()[0]?.playState),
      "running",
    );
    await touch.locator(".hero-mark").dispatchEvent("pointermove", {
      pointerType: "touch",
      clientX: 350,
      clientY: 500,
      bubbles: true,
    });
    assert.equal(
      await touch.locator(".hero-mark .logo").evaluate((element) => getComputedStyle(element).transform),
      "none",
    );
    await page.goto(server.resolvedUrls.local[0] + "?demo");
    await page.locator(".input-current").waitFor();
    assert.equal(await page.getByRole("link", { name: "PDF Studio home" }).count(), 1);
    assert.equal(await page.getByRole("button", { name: "Replay logo animation" }).count(), 0);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("PDF opening and composition work over non-secure HTTP", { timeout: 60000 }, async () => {
  const server = await createServer({
    server: { port: 0, host: "127.0.0.1", allowedHosts: ["mainz.test"] },
  });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({
      channel: process.env.PLAYWRIGHT_CHANNEL || undefined,
      args: ["--host-resolver-rules=MAP mainz.test 127.0.0.1"],
    });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.goto(server.resolvedUrls.local[0].replace("127.0.0.1", "mainz.test") + "?demo");
    assert.deepEqual(await page.evaluate(() => [isSecureContext, typeof crypto.randomUUID]), [false, "undefined"]);
    await page.locator(".input-current").waitFor();
    assert.equal(await page.locator(".input-current").textContent(), "demo.pdf");
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    );
    assert.equal(await page.locator(".composition-totals strong").textContent(), "6 PDF pages");
    assert.equal(await page.getByRole("alert").count(), 0);
    const output = page.locator(".composition-output");
    await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click();
    assert.equal(await page.locator(".composition-totals strong").textContent(), "7 PDF pages");
    const saved = page.waitForEvent("download");
    await output.getByRole("button", { name: "Download", exact: true }).click();
    const download = await saved;
    assert.equal(await download.failure(), null);
    const bytes = await readFile(await download.path());
    assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("The first PDF previews before validation and commits only after success", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  const gates = [];
  const release = () => {
    for (const proceed of gates.splice(0)) proceed();
  };
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.route("**/processor.mjs", async (route) => {
      await new Promise((resolve) => gates.push(resolve));
      await route.continue().catch(() => {});
    });
    await page.goto(server.resolvedUrls.local[0]);
    const bytes = fixture(true, false, 0, false, false, {}, 25);
    const input = page.locator(".selection-panel");
    const open = async (name, buffer) => {
      await page.locator('input[type="file"]').first().setInputFiles({ name, mimeType: "application/pdf", buffer });
      await page.locator(".composer[inert]").waitFor();
      await page.waitForFunction(() => document.querySelector(".selection-panel .page-image canvas")?.width > 0);
      assert.equal(await page.locator(".drop-zone").count(), 0);
      assert.equal(await page.locator(".composition-totals strong").innerText(), "0 PDF pages");
      assert.equal(await page.locator(".composer").getAttribute("aria-busy"), "true");
      assert.equal(await page.locator(".loading-status").isVisible(), true);
    };
    await open("Cancelled.pdf", bytes);
    await page.locator(".loading-status span").click();
    for (const key of ["Control+a", "Enter", "+"]) await page.keyboard.press(key);
    assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0);
    assert.equal(await page.locator(".composition-totals strong").innerText(), "0 PDF pages");
    await page.setViewportSize({ width: 390, height: 1100 });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.locator(".drop-zone").waitFor();
    release();
    assert.equal(await page.locator(".composer").count(), 0);
    await page.evaluate(() => document.documentElement.style.removeProperty("font-size"));
    await page.setViewportSize({ width: 2560, height: 1440 });
    await page.emulateMedia({ colorScheme: "light" });
    await open("Invalid.pdf", Buffer.from(bytes.toString().replace('"version":1', '"version":2')));
    release();
    await page.getByRole("alert").filter({ hasText: "style format" }).waitFor();
    await page.locator(".drop-zone").waitFor();
    assert.equal(await page.locator(".composer").count(), 0);
    await open("Ready.pdf", bytes);
    release();
    await page.locator(".composer:not([inert])").waitFor();
    await input.getByRole("tab", { name: "Style", exact: true }).waitFor();
    assert.equal(await input.getAttribute("data-density"), "compact");
    assert.equal(await input.locator(".input-picker .count").innerText(), "1");
    assert.equal(await page.locator(".loading-status").count(), 0);
    assert.equal(await input.locator(".card-menu-options canvas").count(), 0, "Closed details do not build previews");
    const details = input.getByRole("button", { name: "Details for Input page 1", exact: true });
    await details.press("Space");
    await input.locator(".card-menu-options:popover-open .thumbnail[aria-busy=false]").waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction(() => !document.querySelector(".card-menu-options canvas"));
    await input.getByLabel("Page selection", { exact: true }).fill("1");
    await input.getByLabel("Page selection", { exact: true }).press("Enter");
    assert.equal(await page.locator(".composition-totals strong").innerText(), "1 PDF page");
    assert.deepEqual(errors, []);
  } finally {
    release();
    await browser?.close();
    await server.close();
  }
});

test("Development assets remain available after a production build", { timeout: 60000 }, async () => {
  const temporary = resolvePath("../.local/tmp/web");
  await mkdir(temporary, { recursive: true });
  const outDir = await mkdtemp(join(temporary, "asset-rebuild-"));
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage();
    page.setDefaultTimeout(10000);
    const url = server.resolvedUrls.local[0];
    await page.goto(`${url}?demo`);
    await page.locator(".input-current").waitFor();
    for (let attempt = 0; attempt < 2; attempt++) {
      const previous = process.env.NODE_ENV;
      try {
        process.env.NODE_ENV = "production";
        await build({ build: { outDir, emptyOutDir: true }, logLevel: "warn" });
      } finally {
        if (previous === undefined) delete process.env.NODE_ENV;
        else process.env.NODE_ENV = previous;
      }
      const response = await fetch(`${url}processor.wasm`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-type"), /^application\/wasm/);
      assert.deepEqual(
        [...new Uint8Array(await response.arrayBuffer()).subarray(0, 4)],
        [0, 97, 115, 109],
        "The open development server keeps serving WASM, not the HTML fallback",
      );
      await page.reload();
      await page.locator(".input-current").waitFor();
      assert.equal(await page.locator(".input-current").textContent(), "demo.pdf");
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
      );
    }
  } finally {
    await browser?.close();
    await server.close();
    await rm(outDir, { recursive: true, force: true });
  }
});

test("Demo variants open the maintained Input with populated or empty Output", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [query, pages, selected] of [
      ["", 6, 4],
      ["=empty", 0, 0],
    ]) {
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      });
      page.setDefaultTimeout(10000);
      await page.goto(`${server.resolvedUrls.local[0]}?demo${query}`);
      await page.locator(".input-current").waitFor();
      await page.waitForFunction(
        (count) => document.querySelector(".composition-totals strong")?.textContent === `${count} PDF pages`,
        pages,
      );
      const input = page.locator(".selection-panel");
      assert.equal(await input.locator(".input-current").textContent(), "demo.pdf");
      assert.equal(await input.locator(".thumbnail").count(), 6);
      assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), selected);
      if (!query) {
        const output = page.locator(".composition-output");
        await output.getByLabel("Page selection", { exact: true }).fill("1");
        for (const button of [
          input.getByRole("button", { name: "Add to Output", exact: true }),
          output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }),
        ])
          assert.equal(await button.locator("svg").evaluate((svg) => getComputedStyle(svg).strokeWidth), "3px");
      }
      const welcome = page.getByRole("dialog", { name: "Welcome to PDF Studio", exact: true });
      if (query) {
        await welcome.getByRole("button", { name: "Close welcome", exact: true }).click();
        await page.locator(".page-flight:popover-open").waitFor();
        assert.equal(await input.locator(".page-image[aria-pressed=true]").count(), 0);
        assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages");
        assert.equal(await input.getByRole("button", { name: "Add to Output", exact: true }).count(), 0);
        const sequence = input.getByLabel("Page selection", { exact: true });
        await sequence.fill("1");
        await sequence.fill("1,");
        for (const theme of ["light", "dark"]) {
          await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
          await page.waitForFunction(() => {
            const button = document.querySelector(".selection-panel .transfer");
            return (
              getComputedStyle(button).borderRightColor === getComputedStyle(button.parentElement).borderRightColor
            );
          });
          const borders = await input.locator(".transfer").evaluate((button) => {
            const style = getComputedStyle(button);
            const frame = getComputedStyle(button.parentElement);
            return {
              disabled: button.disabled,
              top: style.borderTop,
              right: style.borderRight,
              bottom: style.borderBottom,
              frame: frame.borderRight,
            };
          });
          assert.equal(borders.disabled, true);
          assert.equal(borders.top, borders.frame, `${theme}: the disabled arrow keeps the selection frame`);
          assert.equal(borders.right, borders.frame);
          assert.equal(borders.bottom, borders.frame);
        }
      } else assert.equal(await welcome.isVisible(), false);
      await tab(input, "Page");
      assert.equal(
        (await input.locator(".inspection-heading .page-number").innerText()).replace(/\s+/g, ""),
        "1/7",
        "The Page counter does not repeat an identical PDF label",
      );
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Unknown demo variants report an error and permit opening a local PDF", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage();
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    for (const value of ["missing", "<unknown>"]) {
      await page.goto(`${server.resolvedUrls.local[0]}?demo=${encodeURIComponent(value)}`);
      const error = page.getByRole("alert");
      await error.waitFor();
      assert.ok((await error.innerText()).includes(`Unknown demo: ${value}. Choose a local PDF.`));
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Local.pdf",
          mimeType: "application/pdf",
          buffer: fixture(false),
        });
      await page.locator(".composer[aria-busy=false]").waitFor();
      assert.equal(await page.locator(".input-current").innerText(), "Local.pdf");
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Output Page removes the current occurrence, including Blank and the final page", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    await page.locator(".composer[aria-busy=false]").waitFor();
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await tab(output, "Page");
    const actions = output.locator(".page-actions");
    assert.deepEqual(
      await actions
        .getByRole("button")
        .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
      ["Remove Output page 1", "Duplicate Output page 1"],
    );
    await actions.getByRole("button", { name: "Remove Output page 1", exact: true }).click();
    assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages");
    assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "");
    await output.getByLabel("Output page actions", { exact: true }).click();
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click();
    assert.equal(await actions.getByRole("button").count(), 0, "Selection hides individual actions");
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    await output.getByRole("button", { name: "Next Output page", exact: true }).focus();
    await page.keyboard.press("End");
    await output.locator(".blank-sheet").waitFor();
    await actions.getByRole("button", { name: "Remove Output page 6", exact: true }).click();
    assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages");
    await output.getByRole("button", { name: "Select all", exact: true }).click();
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
    await input.getByLabel("Page selection", { exact: true }).fill("1");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    await actions.getByRole("button", { name: "Remove Output page 1", exact: true }).click();
    await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor();
    assert.equal(
      await output
        .getByRole("tab", { name: "Page", exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("A delayed demo cannot replace local pages or report obsolete failures", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const status of [200, 503]) {
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      const response = Promise.withResolvers();
      const request = Promise.withResolvers();
      await page.route("**/demo.pdf", async (route) => {
        request.resolve();
        await response.promise;
        await route.fulfill({ status, contentType: "application/pdf", body: fixture() });
      });
      await page.goto(`${server.resolvedUrls.local[0]}?demo`);
      await request.promise;
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Local.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      });
      await page.locator(".composer[aria-busy=false]").waitFor();
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-3");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      response.resolve();
      await page.waitForLoadState("networkidle");
      await page.locator(".loading-status").waitFor({ state: "detached" });
      assert.equal(await input.locator(".input-current").textContent(), "Local.pdf");
      assert.equal(await input.locator(".input-heading .count").textContent(), "1");
      assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages");
      assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1-2");
      assert.equal(await page.locator(".error-banner").count(), 0);
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Input density starts from two Normal batches and retains each Source choice", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, height, small, large] of [
      [1920, 1080, 12, 13],
      [2560, 1440, 24, 25],
      [390, 1100, 16, 17],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(server.resolvedUrls.local[0]);
      if (width === 390) {
        await page.emulateMedia({ colorScheme: "dark" });
        await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      }
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const open = async (name, count) => {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name,
            mimeType: "application/pdf",
            buffer: fixture(true, false, 0, false, false, {}, count),
          });
        await page.waitForFunction((label) => document.querySelector(".input-current")?.textContent === label, name);
        await page.waitForFunction(() => !!document.querySelector(".selection-panel .source-catalog")?.clientWidth);
        await page.evaluate(
          () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
        );
      };
      const choose = async (name) => {
        await input.locator(".input-picker > summary").click();
        await input.locator(".input-list button[data-source]").filter({ hasText: name }).click();
      };
      await open("Small.pdf", small);
      assert.equal(await input.getAttribute("data-density"), "normal", "Exactly two batches retain Normal");
      assert.equal(await output.getAttribute("data-density"), "normal");
      await input.getByRole("button", { name: "Compact Input grid", exact: true }).press("Space");
      await open("Large.pdf", large);
      await page.waitForFunction(
        () => document.querySelector(".selection-panel")?.getAttribute("data-density") === "compact",
      );
      assert.equal(await output.getAttribute("data-density"), "normal", "The heuristic affects only Input");
      if (width !== 390) {
        await page.setViewportSize({ width: width === 1920 ? 2560 : 3840, height: 2160 });
        await page.waitForFunction(
          () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") !== "0",
        );
        assert.equal(await input.getAttribute("data-density"), "compact", "A larger screen retains the initial choice");
        await page.setViewportSize({ width, height });
      }
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).press("Space");
      await tab(input, "Page");
      await tab(input, "Grid");
      assert.equal(await input.getAttribute("data-density"), "normal", "View switches retain the manual choice");
      await choose("Small.pdf");
      assert.equal(await input.getAttribute("data-density"), "compact", "The first Source retains its manual choice");
      await choose("Large.pdf");
      assert.equal(await input.getAttribute("data-density"), "normal", "The second Source retains its manual choice");
      await open("Another.pdf", large);
      await page.waitForFunction(
        () => document.querySelector(".selection-panel")?.getAttribute("data-density") === "compact",
      );
      assert.equal(await output.getAttribute("data-density"), "normal");
      assert.deepEqual(errors, []);
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Arrows enter Grid without selection and Page keys change thumbnail groups", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [density, width, theme, textSize] of [
      ["Normal", 2560, "light", "100%"],
      ["Compact", 2560, "dark", "100%"],
      ["Normal", 390, "light", "200%"],
      ["Compact", 390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height: 1440 },
        reducedMotion: width === 390 ? "reduce" : "no-preference",
        colorScheme: theme,
      });
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
      );
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`);
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      );
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize);
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).click();
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
        await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click();
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        );
        const field = pane.getByLabel("Page selection", { exact: true });
        const batch = Number(await pane.locator(".grid-view").getAttribute("data-batch"));
        await field.focus();
        await page.keyboard.press("ArrowRight");
        assert.equal(await field.evaluate((element) => document.activeElement === element), true, "Fields keep arrows");
        await page.keyboard.press("PageDown");
        assert.equal(await pane.locator(".batch-slider input").inputValue(), "0", "Fields keep PageDown");
        await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } });
        await page.keyboard.press("PageDown");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${batch + 1}`,
        );
        await page.keyboard.press("PageUp");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 1`,
        );
        for (const [key, expected] of [
          ["ArrowLeft", 2 * batch],
          ["ArrowRight", batch + 1],
        ]) {
          if (key === "ArrowLeft")
            await pane.getByRole("button", { name: `Next ${name} thumbnails`, exact: true }).click();
          await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } });
          await page.keyboard.press(key);
          await page.waitForFunction(
            (label) => document.activeElement?.getAttribute("aria-label") === label,
            `Select ${name} page ${expected}`,
          );
          assert.equal(await field.inputValue(), "", "Starting navigation leaves Selection empty");
          assert.equal(await pane.locator(".batch-slider input").inputValue(), "1", "Entry retains the current group");
          await page.waitForFunction(hasCursor);
          if (density === "Normal")
            assert.equal(
              await pane
                .getByRole("button", {
                  name: name === "Input" ? `Add Input page ${expected} to Output` : `Duplicate Output page ${expected}`,
                  exact: true,
                })
                .isVisible(),
              true,
              "The individual + stays available during keyboard navigation",
            );
        }
        await page.keyboard.press("PageUp");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 1`,
        );
        await page.keyboard.press("ArrowRight");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 2`,
        );
        assert.equal(await field.inputValue(), "");
        await page.keyboard.press("Space");
        assert.equal(await field.inputValue(), "2");
        await page.keyboard.press("PageDown");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${batch + 1}`,
        );
        assert.equal(await field.inputValue(), "2", "Changing groups retains Selection");
        await page.keyboard.press("PageUp");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 1`,
        );
        await page.keyboard.press("PageUp");
        assert.equal(await pane.locator(".batch-slider input").inputValue(), "0");
        await pane.getByRole("slider", { name: `${name} thumbnail range`, exact: true }).focus();
        await page.keyboard.press("PageDown");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page ${batch + 1}`,
        );
        assert.equal(
          await pane.locator(".batch-slider input").inputValue(),
          "1",
          "Pagination PageDown moves one group",
        );
        if (name === "Input" && width === 2560) {
          const other = page.locator(".composition-output");
          await tab(other, "Page");
          const before = await pagePosition(other);
          await field.fill("");
          await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } });
          await page.keyboard.press("ArrowRight");
          await page.waitForFunction(
            (label) => document.activeElement?.getAttribute("aria-label") === label,
            `Select Input page ${batch + 1}`,
          );
          assert.equal(await pagePosition(other), before, "Grid entry keeps the other pane's Page unchanged");
          await field.fill("2");
          await pane.getByRole("button", { name: `Select Input page ${batch + 1}`, exact: true }).focus();
          await page.keyboard.press("PageDown");
          await page.waitForFunction(
            (label) => document.activeElement?.getAttribute("aria-label") === label,
            `Select Input page ${2 * batch + 1}`,
          );
          assert.equal(await pagePosition(other), before, "Grid pagination keeps the other pane's Page unchanged");
          await tab(other, "Grid");
          await pane.getByRole("button", { name: `Select Input page ${2 * batch + 1}`, exact: true }).focus();
        }
        await page.keyboard.press("End");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 240`,
        );
        await page.keyboard.press("PageDown");
        assert.equal(await field.inputValue(), "2");
        assert.equal(await page.locator(".composition-totals strong").innerText(), "240 PDF pages");
        await field.fill("");
        await pane.locator(".sequence-help").click({ position: { x: 4, y: 4 } });
        await page.keyboard.press("ArrowLeft");
        await page.waitForFunction(
          (label) => document.activeElement?.getAttribute("aria-label") === label,
          `Select ${name} page 240`,
        );
      }
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Page bounds the shared frame by fitted geometry and Grid fills complete rows", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    );
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    for (const colorScheme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme });
      for (const [width, height, rows, capacity, fittedHeight] of [
        [1920, 1080, 6, 36, 718.44],
        [2240, 1260, 6, 42, 757.84],
        [2560, 1440, 7, 56, 860],
        [3840, 2160, 7, 84, 1290],
      ]) {
        await page.setViewportSize({ width, height });
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`);
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
        );
        await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
        await page.waitForFunction(
          (batch) => document.querySelector(".selection-panel .grid-view")?.dataset.batch === String(batch),
          capacity,
        );
        await tab(output, "Page");
        await output.locator(".pdf-viewport[aria-busy=false]").waitFor();
        const geometry = await page.evaluate(() => {
          const grid = document.querySelector(".grid-view"),
            view = document.querySelector(".page-view");
          const scroll = view.querySelector(".page-scroll").getBoundingClientRect();
          const sheet = view.querySelector("canvas").getBoundingClientRect();
          const actions = view.querySelector(".page-actions").getBoundingClientRect();
          const frame = view.getBoundingClientRect();
          return {
            rows: Number(grid.dataset.rows),
            frames: [grid, view].map((element) => element.getBoundingClientRect().height),
            image: [sheet.width, sheet.height],
            margins: [sheet.top - scroll.top, scroll.bottom - sheet.bottom],
            side: sheet.left - scroll.left,
            heading: view.querySelector(".inspection-heading").getBoundingClientRect().height,
            actionOffset: actions.x + actions.width / 2 - frame.x - frame.width / 2,
          };
        });
        assert.equal(geometry.rows, rows);
        assert.equal(geometry.heading, 45, "Output Page keeps its controls on one heading row");
        assert.ok(Math.abs(geometry.actionOffset) < 1, "Page actions stay centered");
        assert.equal(geometry.frames[0], geometry.frames[1], "Grid and Page keep one shared frame");
        assert.ok(
          geometry.margins.every((margin) => margin <= Math.max(48, geometry.side * 1.5) + 1),
          "Vertical margins balance the enlarged page within the Grid frame",
        );
        assert.ok(Math.abs(geometry.image[1] - fittedHeight) < 1, "The frame cap preserves the width-fitted PDF size");
        if (width === 2560)
          assert.ok(Math.abs(geometry.frames[0] - 1056) < 1, "QHD reserves room for the enlarged Page");
      }
    }
    await page.setViewportSize({ width: 1920, height: 1080 });
    const viewport = output.getByRole("region", { name: "PDF viewport", exact: true });
    const fittedFrame = await output.locator(".page-view").boundingBox();
    await zoom(output, "Zoom in");
    assert.equal(
      (await output.locator(".page-view").boundingBox()).height,
      fittedFrame.height,
      "Page zoom keeps the shared frame height",
    );
    await zoom(output, "Fit page");
    await viewport.focus();
    await page.keyboard.press("End");
    await output.locator(".pdf-viewport[aria-busy=false]").waitFor();
    await page.waitForFunction(() => {
      const sheet = document.querySelector(".page-view canvas");
      return sheet && sheet.clientWidth > sheet.clientHeight;
    });
    const landscape = await output.locator(".page-view").boundingBox();
    assert.ok(landscape.height < 650, "A landscape Page sets its own smaller height cap");
    await tab(input, "Page");
    await input.locator(".pdf-viewport[aria-busy=false]").waitFor();
    const heights = await page
      .locator(".page-view")
      .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height));
    assert.equal(heights[0], heights[1], "Two Pages share the height needed by the taller fitted page");
    assert.ok(heights[0] > landscape.height);
    await page.setViewportSize({ width: 390, height: 844 });
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Output", exact: true })
      .click();
    await page.waitForFunction(() => document.querySelector(".composition-output .page-view")?.clientHeight < 600);
    assert.ok(
      (await output.locator(".page-view").boundingBox()).height < 600,
      "The hidden mobile Page does not enlarge the visible Page's frame",
    );
    await page.setViewportSize({ width: 1920, height: 1080 });
    await tab(input, "Grid");
    await tab(output, "Grid");
    await output.getByRole("button", { name: "Normal Output grid", exact: true }).click();
    await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("Home");
    await tab(output, "Page");
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Output", exact: true })
      .click();
    await page.waitForFunction(
      () => document.querySelector(".composition-output .page-view canvas")?.clientWidth === 261,
    );
    await output.locator(".pdf-viewport[aria-busy=false]").waitFor();
    const natural = await image(output).boundingBox();
    await tab(output, "Grid");
    await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
    await tab(output, "Page");
    await page.waitForFunction(({ width, height }) => {
      const bounds = document.querySelector(".composition-output .page-view canvas")?.getBoundingClientRect();
      return bounds && Math.abs(bounds.width - width) < 1 && Math.abs(bounds.height - height) < 1;
    }, natural);
    await output.locator(".pdf-viewport[aria-busy=false]").waitFor();
    const compact = await image(output).boundingBox();
    assert.ok(
      Math.abs(compact.width - natural.width) < 1 && Math.abs(compact.height - natural.height) < 1,
      "The cap includes the full heading at 200% text without shrinking the PDF",
    );
    await page.evaluate(() => (document.documentElement.style.fontSize = ""));
    await page.setViewportSize({ width: 1920, height: 1080 });
    await output.getByRole("button", { name: "Select all", exact: true }).click();
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
    await output.getByRole("heading", { name: "Your Output starts here.", exact: true }).waitFor();
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.waitForFunction(() => document.querySelector(".selection-panel .grid-view")?.dataset.batch === "36");
    assert.equal(
      await input.locator(".grid-view").getAttribute("data-rows"),
      "6",
      "An empty Output Page leaves Input's fitted geometry in control",
    );
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Grid scales desktop capacity, balances Page, and retains compact actions", { timeout: 120000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, reducedMotion: "reduce" });
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    );
    const input = page.locator(".selection-panel");
    const output = page.locator(".composition-output");
    for (const [width, height] of [
      [1920, 1080],
      [2560, 1440],
    ]) {
      await page.setViewportSize({ width, height });
      const capacity = width === 1920 ? 6 : 12;
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`);
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      );
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click();
      assert.equal(await input.locator(".composition-card").count(), capacity);
      assert.equal(await output.locator(".composition-card").count(), capacity);
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".thumbnail")].every((element) => element.getAttribute("aria-busy") === "false"),
      );
      assert.equal(await page.locator("main").evaluate((element) => element.clientWidth), width === 1920 ? 1232 : 1472);
      assert.equal(await input.locator(".batch-marks > span").count(), width === 1920 ? 40 : 20);
      const imageHeight = await input
        .locator(".page-image canvas")
        .first()
        .evaluate((element) => element.clientHeight);
      assert.equal(imageHeight, 168, "Normal thumbnails retain their fitted image height");
      assert.deepEqual(
        await output
          .locator(".composition-card")
          .first()
          .locator(".occurrence-actions button")
          .evaluateAll((elements) => elements.map((element) => element.getAttribute("aria-label"))),
        ["Remove Output page 1", "Duplicate Output page 1"],
      );
      const controls = await output
        .locator(".composition-card")
        .first()
        .locator(".occurrence-actions button")
        .evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().toJSON()));
      for (let index = 1; index < controls.length; index++)
        assert.ok(controls[index].left - controls[index - 1].right >= 28, "Footer controls retain breathing room");
      await input.getByRole("button", { name: "Next Input thumbnails", exact: true }).click();
      await input.getByRole("button", { name: `Select Input page ${capacity + 1}`, exact: true }).waitFor();
      await tab(input, "Page");
      assert.match(await pagePosition(input), new RegExp(`^${capacity + 1}\\s*\\/ 240`));
      if (width === 2560) {
        await input.locator(".pdf-viewport[aria-busy=false]").waitFor();
        const margins = await input.locator(".page-scroll").evaluate((element) => {
          const frame = element.getBoundingClientRect();
          const canvas = element.querySelector("canvas").getBoundingClientRect();
          return [canvas.left - frame.left, frame.right - canvas.right];
        });
        assert.ok(
          margins.every((margin) => margin <= 72),
          "QHD Page side margins stay within 72 px",
        );
      }
      const frames = await page.locator(".page-content").evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height, top: box.y, bottom: box.bottom };
        }),
      );
      assert.deepEqual(frames[0], frames[1], "Grid and Page use equal pane widths and aligned top and bottom edges");
      await tab(input, "Grid");
      const first = input.getByRole("button", { name: `Select Input page ${capacity + 1}`, exact: true });
      await first.waitFor();
      await first.focus();
      await page.keyboard.press("End");
      await input.getByRole("button", { name: "Select Input page 240", exact: true }).waitFor();
      await page.waitForFunction(
        () =>
          document.querySelector('[aria-label="Select Input page 240"] .thumbnail')?.getAttribute("aria-busy") ===
          "false",
      );
      assert.ok(
        Math.abs(
          (await input
            .getByRole("button", { name: "Select Input page 240", exact: true })
            .locator("canvas")
            .evaluate((element) => element.getBoundingClientRect().width)) - (width === 1920 ? 170 : 152),
        ) < 1,
        "Landscape images fit the narrower Normal cards",
      );
      await page.keyboard.press("Home");
      await input.getByRole("button", { name: "Select Input page 1", exact: true }).waitFor();
    }
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).click();
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 6);
    await input.getByRole("button", { name: "Select Input page 12", exact: true }).waitFor();
    assert.equal(
      await input.locator(".composition-card").count(),
      6,
      "Resizing retains the inspected page in the new group",
    );
    const slider = input.getByRole("slider", { name: "Input thumbnail range", exact: true });
    await slider.focus();
    await page.keyboard.press("Home");
    for (let step = 0; step < 3; step++) await page.keyboard.press("ArrowRight");
    await input.getByRole("button", { name: "Select Input page 19", exact: true }).waitFor();
    assert.equal((await input.locator(".batch-caption").innerText()).replace(/\s+/g, ""), "4/40·19–24/240");
    assert.ok(
      (await input.locator(".batch-total").allTextContents()).every((text) => /^\s\/\s/.test(text)),
      "Pagination leaves visible space on both sides of each slash",
    );
    for (const theme of ["light", "dark"]) {
      await page.emulateMedia({ colorScheme: theme });
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`);
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      );
      const normalNumber = output.locator(".composition-card .page-origin > summary").first();
      await normalNumber.hover();
      const hoverColor = await normalNumber.evaluate((element) => getComputedStyle(element).color);
      await input.getByRole("button", { name: "Compact Input grid", exact: true }).click();
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
      await page.waitForFunction(() => document.querySelectorAll(".selection-panel .composition-card").length === 36);
      const density = input.getByRole("group", { name: "Input grid density", exact: true });
      await input.getByRole("button", { name: "Select Input page 12", exact: true }).click();
      await density.getByRole("button", { name: "Normal Input grid", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "6",
      );
      assert.equal(await input.getByRole("button", { name: "Select Input page 12", exact: true }).isVisible(), true);
      assert.equal(
        await output.locator(".composition-card").count(),
        36,
        "Input density leaves Output density independent",
      );
      await tab(input, "Page");
      assert.equal(await density.isVisible(), false, "Page hides Grid density controls");
      const frames = await page.locator(".page-content").evaluateAll((elements) =>
        elements.map((element) => {
          const box = element.getBoundingClientRect();
          return { width: box.width, height: box.height, top: box.y, bottom: box.bottom };
        }),
      );
      assert.deepEqual(frames[0], frames[1], "Mixed densities keep Grid and Page balanced");
      for (const mode of ["Normal", "Compact"]) {
        await output.getByRole("button", { name: `${mode} Output grid`, exact: true }).click();
        for (const [width, height, textSize] of [
          [960, 720, "100%"],
          [1280, 800, "100%"],
          [1920, 1080, "100%"],
          [2560, 1440, "100%"],
          [3840, 2160, "100%"],
          [3840, 2160, "200%"],
        ]) {
          await page.setViewportSize({ width, height });
          await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize);
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const navigation = await page.evaluate(() => {
            const grid = document.querySelector(".page-batches");
            const footer = document.querySelector(".page-navigation");
            const centers = [grid, footer].map((element) =>
              [...element.querySelectorAll(":scope > button")].map((button) => {
                const box = button.getBoundingClientRect();
                return box.y + box.height / 2;
              }),
            );
            const caption = grid.querySelector(".batch-caption").getBoundingClientRect();
            const track = grid.querySelector(".batch-slider").getBoundingClientRect();
            const cards = [...document.querySelectorAll(".composition-card")];
            return {
              arrows: centers[0].map((center, index) => center - centers[1][index]),
              captionGap: track.y + track.height / 2 - caption.bottom,
              cardGap: caption.top - Math.max(...cards.map((card) => card.getBoundingClientRect().bottom)),
              overflow: document.documentElement.scrollWidth > innerWidth,
            };
          });
          const label = `${mode} ${width}×${height}, ${textSize} text, ${theme}`;
          assert.ok(
            navigation.arrows.every((delta) => Math.abs(delta) < 1),
            `${label}: Grid and Page arrows align`,
          );
          assert.ok(navigation.captionGap >= 12, `${label}: Pagination stays above the slider`);
          assert.ok(navigation.cardGap >= 8, `${label}: Pagination leaves room below the cards`);
          assert.equal(navigation.overflow, false, `${label}: The workspace fits horizontally`);
        }
      }
      await page.evaluate(() => (document.documentElement.style.fontSize = ""));
      await page.setViewportSize({ width: 1920, height: 1080 });
      await tab(input, "Grid");
      assert.equal(
        await input.locator(".composition-card").count(),
        6,
        "Grid retains its density across Page inspection",
      );
      await density.getByRole("button", { name: "Compact Input grid", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "36",
      );
      await page.setViewportSize({ width: 2560, height: 1440 });
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "56",
      );
      assert.equal(await output.locator(".composition-card").count(), 56);
      await page.waitForFunction(
        () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
      );
      const geometry = await output.locator(".composition-grid").evaluate((element) => {
        const cards = [...element.children].map((card) => card.getBoundingClientRect());
        const card = element.firstElementChild;
        const heading = card.querySelector(".page-label").getBoundingClientRect();
        const frame = card.querySelector(".page-image .thumbnail").getBoundingClientRect();
        const canvas = card.querySelector(".page-image canvas").getBoundingClientRect();
        const panel = element.parentElement.getBoundingClientRect();
        return {
          columns: new Set(cards.map((box) => box.x)).size,
          rows: new Set(cards.map((box) => box.y)).size,
          card: [cards[0].width, cards[0].height],
          rowEdges: [cards[0].left - panel.left, panel.right - cards[7].right],
          heading: [heading.left - cards[0].left, heading.width, heading.height],
          numberSize: parseFloat(getComputedStyle(card.querySelector(".card-number")).fontSize),
          numberInset: card.querySelector(".card-number strong").getBoundingClientRect().left - cards[0].left,
          grip: card.querySelector(".page-grip svg").getBoundingClientRect().width,
          gripCenters: [...element.children].map((item) => {
            const bounds = item.getBoundingClientRect();
            const grip = item.querySelector(".page-grip svg").getBoundingClientRect();
            return Math.abs(grip.x + grip.width / 2 - bounds.x - bounds.width / 2);
          }),
          foldGap:
            element.children[1].querySelector(".page-fold").getBoundingClientRect().left -
            element.children[1].querySelector(".page-grip svg").getBoundingClientRect().right,
          targets: [...card.querySelectorAll(".page-label > .page-origin > button, .page-label > .page-grip")].map(
            (button) => [button.getBoundingClientRect().width, parseFloat(getComputedStyle(button, "::after").height)],
          ),
          nextTargetTop:
            element.children[8].querySelector(".card-number").getBoundingClientRect().top +
            parseFloat(getComputedStyle(element.children[8].querySelector(".card-number"), "::after").top) -
            cards[0].bottom,
          image: canvas.height,
          margins: [
            canvas.left - frame.left,
            frame.right - canvas.right,
            canvas.top - frame.top,
            frame.bottom - canvas.bottom,
          ],
        };
      });
      assert.deepEqual([geometry.columns, geometry.rows], [8, 7]);
      assert.deepEqual(geometry.card, [76.25, 125]);
      assert.deepEqual(geometry.rowEdges, [0, 0], "Compact rows fill the panel width");
      assert.deepEqual(geometry.heading, [0, 76.25, 26], "The header fills the card width");
      assert.equal(geometry.numberSize, 10.8, "Compact page numbers use a smaller text size");
      assert.equal(geometry.numberInset, 6, "Page numbers keep space from the card's left edge");
      assert.equal(geometry.grip, 15);
      assert.ok(
        geometry.gripCenters.every((offset) => offset < 0.5),
        "Every Compact grip is centered on its card",
      );
      assert.ok(geometry.foldGap >= 2, "The grip stays clear of the folded corner");
      assert.ok(geometry.targets.every(([width, height]) => width >= 24 && height === 44));
      assert.ok(geometry.nextTargetTop >= 0, "Heading targets do not overlap the previous row's cards");
      assert.equal(geometry.image, 82);
      assert.ok(
        geometry.margins.every((margin) => margin >= 7.5 && margin <= 8.2),
        "Enlarged images retain balanced inner margins",
      );
      const compactNumber = output.locator(".composition-card .card-number").first();
      await compactNumber.hover();
      assert.deepEqual(
        await compactNumber.evaluate((element) => {
          const style = getComputedStyle(element);
          return [style.color, style.backgroundColor, style.boxShadow];
        }),
        [hoverColor, "rgba(0, 0, 0, 0)", "none"],
        "Compact numbers use Normal's color-only hover",
      );
      for (const pane of [input, output]) {
        const first = pane.locator(".composition-card").first();
        await first.locator(".page-image").click();
        assert.equal(
          await first.evaluate((element) => {
            const card = element.getBoundingClientRect();
            const label = element.querySelector(".page-label");
            const heading = label.getBoundingClientRect();
            const divider = getComputedStyle(label, "::after");
            const stroke = parseFloat(getComputedStyle(element).borderInlineStartWidth);
            return (
              heading.left + parseFloat(divider.insetInlineStart) >= card.left + stroke &&
              heading.right - parseFloat(divider.insetInlineEnd) <= card.right - stroke
            );
          }),
          true,
          "The selected heading separator cannot cut through the selection contour",
        );
        await first.locator(".page-image").click();
      }
      assert.equal(await input.getByRole("slider", { name: "Input thumbnail range", exact: true }).isVisible(), true);
      const compactRange = input.getByRole("slider", { name: "Input thumbnail range", exact: true });
      await compactRange.press("End");
      for (const family of ["", "DejaVu Sans", "Liberation Sans"]) {
        await input.evaluate((pane, value) => (pane.style.fontFamily = value), family);
        const numberGaps = await input.locator(".composition-card").evaluateAll((cards) =>
          cards.map((card) => {
            const number = card.querySelector(".card-number strong").getBoundingClientRect();
            const grip = card.querySelector(".page-grip svg").getBoundingClientRect();
            return grip.left - number.right;
          }),
        );
        assert.ok(
          numberGaps.every((gap) => gap >= 2),
          `${family || "System font"}: three-digit numbers stay clear of the grips (${Math.min(...numberGaps)}px)`,
        );
      }
      await input.evaluate((pane) => pane.style.removeProperty("font-family"));
      await compactRange.press("Home");
      await page.setViewportSize({ width: 1920, height: 1080 });
      await page.waitForFunction(
        () => document.querySelector(".selection-panel .grid-view")?.getAttribute("data-batch") === "36",
      );
      const opener = output.getByRole("button", {
        name: "Details for Output page 1",
        exact: true,
      });
      await opener.focus();
      await page.keyboard.press("Enter");
      const menu = page.locator(".card-menu-options:popover-open");
      await menu.waitFor();
      await page.keyboard.press("Escape");
      assert.equal(await opener.evaluate((element) => element === document.activeElement), true);
      await opener.click();
      await menu.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "241 PDF pages",
      );
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      await opener.click();
      await menu.getByRole("button", { name: "Remove Output page 1", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".composition-totals strong")?.textContent === "240 PDF pages",
      );
    }
    const touch = await browser.newPage({
      viewport: { width: 1024, height: 1366 },
      isMobile: true,
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await touch.goto(`${server.resolvedUrls.local[0]}?demo`);
    const touchInput = touch.locator(".selection-panel");
    await touchInput.getByRole("button", { name: "Compact Input grid", exact: true }).click();
    const touchTargets = await touchInput
      .locator(".composition-card")
      .first()
      .locator(".page-label > .page-origin > button, .page-label > .page-grip")
      .evaluateAll((buttons) =>
        buttons.map((button) => [
          button.getBoundingClientRect().width,
          parseFloat(getComputedStyle(button, "::after").height),
        ]),
      );
    assert.ok(
      touchTargets.every(([width, height]) => width >= 24 && height === 44),
      "Touch retains separate heading targets of at least 24 by 44 px",
    );
    await touch.close();
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Compact pagination retains readable four- and five-digit numbers", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Numbers.pdf",
        mimeType: "application/pdf",
        buffer: fixture(false),
      });
    await page.locator(".composer[aria-busy=false]").waitFor();
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
    for (const [copies, total, columns] of [
      [1, 1000, 8],
      [9, 10000, 8],
    ]) {
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(Array(copies).fill("1").join(","));
      await input.getByLabel("Input page actions", { exact: true }).click();
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000");
      await page.keyboard.press("Escape");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      await page.waitForFunction(
        (batch) => document.querySelector(".composition-output .grid-view")?.dataset.batch === String(batch),
        columns * 7,
      );
      assert.equal(await output.locator(".composition-totals strong").textContent(), `${total} PDF pages`);
      assert.equal(await output.locator(".grid-view").getAttribute("data-columns"), String(columns));
      await output.getByRole("slider", { name: "Output thumbnail range", exact: true }).press("End");
      await output.getByRole("button", { name: `Select Output page ${total}`, exact: true }).waitFor();
      for (const family of ["DejaVu Sans", "Liberation Sans"]) {
        await output.evaluate((pane, value) => (pane.style.fontFamily = value), family);
        const spacing = await output.locator(".composition-card").evaluateAll((cards) =>
          cards.map((card) => {
            const number = card.querySelector(".card-number strong").getBoundingClientRect();
            const grip = card.querySelector(".page-grip svg").getBoundingClientRect();
            const bounds = card.getBoundingClientRect();
            return {
              numberGap: grip.left - number.right,
              foldGap: bounds.right - 15 - grip.right,
              offset: grip.left + grip.width / 2 - bounds.left - bounds.width / 2,
              font: parseFloat(getComputedStyle(card.querySelector(".card-number")).fontSize),
            };
          }),
        );
        assert.ok(
          spacing.every(({ numberGap, foldGap, offset }) => numberGap >= 2 && foldGap >= 2 && Math.abs(offset) < 1),
          `${family}: ${total} pages keep numbers, grips, and folds apart`,
        );
        const last = spacing.at(-1);
        assert.ok(last.font < (total === 10000 ? 9 : 10.8), "Long page numbers shrink to fit");
      }
      await output.evaluate((pane) => pane.style.removeProperty("font-family"));
    }
    await page.setViewportSize({ width: 390, height: 900 });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = "200%";
      document.documentElement.dataset.theme = "dark";
    });
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Output", exact: true })
      .click();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "View switches reuse painted PDFs and loading keeps thumbnails within their frames",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({
        viewport: { width: 2560, height: 1440 },
        deviceScaleFactor: 2,
        reducedMotion: "reduce",
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.route("**/grid.pdf", (route) =>
        route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
      );
      await page.addInitScript(() => {
        const overflows = (window.previewOverflows = []);
        const measure = () => {
          for (const frame of document.querySelectorAll(".page-image .thumbnail")) {
            const canvas = frame.querySelector("canvas");
            if (canvas && canvas.getBoundingClientRect().height > frame.getBoundingClientRect().height + 1)
              overflows.push(canvas.getBoundingClientRect().height);
          }
          requestAnimationFrame(measure);
        };
        requestAnimationFrame(measure);
      });
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&input=page`);
      const ready = () =>
        page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
      await page.waitForFunction(
        () => document.querySelectorAll(".composition-output .composition-card").length === 12,
      );
      await ready();
      await page.evaluate(async () => {
        const { openPDF } = await import("/src/pdf.ts");
        const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()));
        const pdf = await task.promise;
        const prototype = Object.getPrototypeOf(await pdf.getPage(1));
        const render = prototype.render;
        const cleanup = prototype.cleanup;
        window.pdfRenderCount = 0;
        window.pdfCleanups = new Set();
        window.holdPDFRendering = true;
        window.pdfContinuations = [];
        prototype.cleanup = function (...args) {
          const released = cleanup.apply(this, args);
          if (released) window.pdfCleanups.add(this.pageNumber);
          return released;
        };
        prototype.render = function (...args) {
          window.pdfRenderCount++;
          const drawing = render.apply(this, args);
          drawing.onContinue = (proceed) =>
            window.holdPDFRendering ? window.pdfContinuations.push(proceed) : proceed();
          return drawing;
        };
        await task.destroy();
      });
      const output = page.locator(".composition-output");
      const snapshots = new Map();
      const snapshot = () =>
        output
          .locator(".page-image canvas, .pdf-viewport canvas")
          .first()
          .evaluate((canvas) => canvas.toDataURL());
      snapshots.set("Normal", await snapshot());
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
      await page.waitForFunction(() => window.pdfContinuations.length > 0);
      const spinner = output.locator(".render-status").first();
      assert.equal(await spinner.innerText(), "");
      assert.equal(await spinner.getAttribute("aria-hidden"), "true");
      assert.equal(await spinner.evaluate((element) => getComputedStyle(element).borderTopWidth), "2px");
      await page.evaluate(() => new Promise(requestAnimationFrame));
      assert.deepEqual(
        await page.evaluate(() => window.previewOverflows),
        [],
        "Loading at 2× pixel density does not stretch thumbnails",
      );
      await page.evaluate(() => {
        window.holdPDFRendering = false;
        for (const proceed of window.pdfContinuations) proceed();
        window.pdfContinuations = [];
      });
      await ready();
      assert.equal(await page.evaluate(() => window.pdfRenderCount), 56);
      assert.ok(await page.evaluate(() => window.pdfCleanups.size >= 12), "Density changes release PDF page resources");
      snapshots.set("Compact", await snapshot());
      await tab(output, "Page");
      await ready();
      assert.ok(
        await page.evaluate(() => window.pdfCleanups.size >= 56),
        "Leaving Grid releases its PDF page resources",
      );
      snapshots.set("Page", await snapshot());
      for (const mode of ["Grid", "Normal", "Compact", "Page", "Grid"]) {
        await page.evaluate(() => (window.pdfRenderCount = 0));
        if (mode === "Normal" || mode === "Compact")
          await output.getByRole("button", { name: `${mode} Output grid`, exact: true }).click();
        else await tab(output, mode);
        await ready();
        assert.equal(
          await page.evaluate(() => window.pdfRenderCount),
          0,
          `${mode}: completed pages need no PDF redraw`,
        );
        assert.equal(
          await snapshot(),
          snapshots.get(mode === "Grid" ? "Compact" : mode),
          `${mode}: restored pixels match`,
        );
      }
      const input = page.locator(".selection-panel");
      await page
        .locator('input[type="file"]')
        .first()
        .setInputFiles({
          name: "Cold.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, false, 0, false, false, {}, 25),
        });
      await input.locator(".input-current").filter({ hasText: "Cold.pdf" }).waitFor();
      await tab(input, "Grid");
      await ready();
      const cold = input.locator(".page-image canvas").first();
      const compactPixels = await cold.evaluate((canvas) => canvas.toDataURL());
      const compactWidth = await cold.evaluate((canvas) => canvas.clientWidth);
      await page.evaluate(() => (window.holdPDFRendering = true));
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click();
      await page.waitForFunction(() => window.pdfContinuations.length > 0);
      assert.equal(
        await cold.evaluate((canvas) => canvas.toDataURL()),
        compactPixels,
        "The first Normal render retains the Compact image",
      );
      assert.ok(
        (await cold.evaluate((canvas) => canvas.clientWidth)) > compactWidth,
        "The retained image fits its Normal card immediately",
      );
      assert.equal(await input.locator(".render-status").count(), 0, "Existing images do not return to loading rings");
      await page.evaluate(() => {
        window.holdPDFRendering = false;
        for (const proceed of window.pdfContinuations) proceed();
        window.pdfContinuations = [];
      });
      await ready();
      assert.notEqual(
        await cold.evaluate((canvas) => canvas.toDataURL()),
        compactPixels,
        "Normal replaces the retained image with its sharper raster",
      );
      assert.deepEqual(await page.evaluate(() => window.previewOverflows), []);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Page fit preserves screen size across expanded desktop viewports", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.route("**/grid.pdf", (route) =>
      route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
    );
    const session = await page.context().newCDPSession(page);
    const input = page.locator(".selection-panel");
    const output = page.locator(".composition-output");
    const fitted = async (locator) => {
      const [bounds, factor] = await Promise.all([locator.boundingBox(), page.evaluate(() => devicePixelRatio)]);
      assert.ok(Math.abs(bounds.width * factor - 608.07) < 1, "Page keeps its fitted screen width");
      assert.ok(Math.abs(bounds.height * factor - 860) < 1, "Page keeps its fitted screen height");
    };
    for (const factor of [1, 0.8, 0.67]) {
      const viewport = { width: Math.round(2560 / factor), height: Math.round(1440 / factor) };
      await page.setViewportSize(viewport);
      await session.send("Emulation.setDeviceMetricsOverride", {
        ...viewport,
        deviceScaleFactor: factor,
        mobile: false,
      });
      await page.emulateMedia({ colorScheme: factor === 0.8 ? "dark" : "light" });
      await page.goto(`${server.resolvedUrls.local[0]}?demo=grid&input=page`);
      await input.locator(".pdf-viewport[aria-busy=false] canvas").waitFor();
      await fitted(image(input));
      if (factor < 1)
        await page.waitForFunction(
          () => document.querySelectorAll(".composition-output .composition-card").length > 12,
        );
      await page.waitForFunction(() =>
        [...document.querySelectorAll(".composition-output .thumbnail")].every(
          (element) => element.getAttribute("aria-busy") === "false",
        ),
      );
      const thumbnail = await output.locator(".page-image canvas").first().boundingBox();
      assert.ok(Math.abs(thumbnail.height - 168) < 1, "Grid thumbnails follow browser scaling");
      await tab(output, "Page");
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor();
      await fitted(image(output));
      await tab(output, "Grid");
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".composition-output .grid-view")?.getAttribute("data-rows") === "7",
      );
      await input.locator(".pdf-viewport[aria-busy=false] canvas").waitFor();
      await fitted(image(input));
      const surround = await input.locator(".page-scroll").boundingBox();
      const sheet = await image(input).boundingBox();
      assert.ok((sheet.y - surround.y) * factor < 90, "Seven Compact rows retain a balanced upper Page surround");
      assert.ok(
        (surround.y + surround.height - sheet.y - sheet.height) * factor < 90,
        "Seven Compact rows retain a balanced lower Page surround",
      );
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await input.locator(".inspection-heading .page-grip").dispatchEvent("dragstart", { dataTransfer: transfer });
      const first = output.locator(".composition-card").first(),
        destination = await first.boundingBox();
      await first.dispatchEvent("dragover", {
        dataTransfer: transfer,
        clientX: destination.x + destination.width / 4,
        clientY: destination.y + destination.height / 2,
      });
      await output.locator(".drop-placeholder").waitFor();
      assert.equal(
        await output.locator("[data-preview-hidden]").count(),
        1,
        "The drag preview stays within seven Compact rows at every browser zoom",
      );
      await page.keyboard.press("Escape");
      await transfer.dispose();
      await tab(output, "Page");
      await output.locator(".pdf-viewport[aria-busy=false] canvas").waitFor();
      await fitted(image(output));
      await output.getByLabel("Page selection", { exact: true }).fill("1");
      await output.locator(".output-options > summary").click();
      await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click();
      await page.keyboard.press("Escape");
      await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Home");
      await output.locator(".blank-sheet").waitFor();
      await fitted(output.locator(".blank-sheet"));
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Touch grips restrict Grid drops and keep Selection unfocused", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, height, colorScheme, reducedMotion] of [
      [810, 1080, "light", "no-preference"],
      [1080, 810, "dark", "reduce"],
      [390, 844, "dark", "no-preference"],
    ]) {
      const page = await browser.newPage({
        viewport: { width, height },
        hasTouch: true,
        isMobile: true,
        reducedMotion,
      });
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(`${server.resolvedUrls.local[0]}?demo`);
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      await output.locator(".composition-totals strong").waitFor({ state: "attached" });
      const views = page.locator(".mobile-workspace-tabs");
      if (await views.isVisible()) await views.getByRole("button", { name: "Output", exact: true }).tap();
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).tap();
      const cards = output.locator(".composition-card");
      const ids = () => cards.evaluateAll((items) => items.map((item) => item.id));
      const before = await ids();
      const selection = output.getByRole("textbox", { name: "Page selection", exact: true });
      const originalSelection = await selection.inputValue();
      const session = await page.context().newCDPSession(page);
      const send = (type, point) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
      const begin = async () => {
        const grip = cards.first().locator(".page-grip");
        await grip.scrollIntoViewIfNeeded();
        const bounds = await grip.boundingBox();
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        await send("touchStart", point);
        const press = await cards.first().evaluate((element) => ({
          border: getComputedStyle(element).borderColor,
          accent: getComputedStyle(element.querySelector(".page-grip")).color,
          dragging: document.querySelector(".composer").hasAttribute("data-touch-drag"),
        }));
        assert.equal(press.border, press.accent, "Pressing a grip highlights its card before any movement");
        assert.equal(press.dragging, false);
        await send("touchMove", { ...point, x: point.x + 10 });
        await page.locator(".composer[data-touch-drag]").waitFor();
      };
      await begin();
      const targets = await output.evaluate((element) => {
        const grid = element.querySelector(".composition-grid");
        const card = grid.querySelector(".composition-card");
        return {
          pane: getComputedStyle(element).outlineStyle,
          grid: getComputedStyle(grid).outlineStyle,
          duration: getComputedStyle(card).transitionDuration,
          selection: getComputedStyle(grid).userSelect,
        };
      });
      assert.equal(targets.pane, "none", "The pane header and Selection are outside the drop outline");
      assert.equal(targets.grid, "dashed");
      assert.equal(targets.selection, "none");
      assert.equal(targets.duration.split(", ")[0], reducedMotion === "reduce" ? "0s" : "0.28s");
      const heading = await output.locator(".editing-toolbar").boundingBox();
      await send("touchMove", { x: heading.x + heading.width / 2, y: heading.y + heading.height / 2 });
      await send("touchEnd");
      assert.deepEqual(await ids(), before, "Dropping on the toolbar leaves the document unchanged");
      assert.equal(await selection.inputValue(), originalSelection);
      await begin();
      const destination = await cards.nth(2).boundingBox();
      await send("touchMove", {
        x: destination.x + destination.width * 0.8,
        y: destination.y + destination.height / 2,
      });
      await page.locator(".composition-output[data-preview]").waitFor();
      assert.deepEqual(await ids(), before, "A preview does not commit the move");
      await send("touchEnd");
      await page.waitForFunction(
        (id) => document.querySelectorAll(".output-pages > .composition-card")[2]?.id === id,
        before[0],
      );
      assert.deepEqual(await ids(), [before[1], before[2], before[0], ...before.slice(3)]);
      assert.equal(await selection.inputValue(), originalSelection, "The release does not select the source grip");
      assert.equal(await selection.evaluate((element) => element === document.activeElement), false);
      assert.equal(
        await page.locator(".drag-image, .composer[data-touch-drag], .composition-output[data-preview]").count(),
        0,
      );
      await begin();
      await send("touchCancel");
      assert.deepEqual(await ids(), [before[1], before[2], before[0], ...before.slice(3)]);
      assert.equal(await page.locator(".drag-image, .composer[data-touch-drag]").count(), 0);

      if (await views.isVisible()) {
        await views.getByRole("button", { name: "Input", exact: true }).tap();
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).tap();
        const preparation = input.getByRole("textbox", { name: "Page selection", exact: true });
        await preparation.fill("1");
        const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true });
        await grip.scrollIntoViewIfNeeded();
        const bounds = await grip.boundingBox();
        await send("touchStart", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 });
        assert.equal(await input.locator(".input-drop-hint").count(), 0);
        await input.locator(".input-drop-hint").waitFor();
        assert.equal(
          await views
            .getByRole("button", { name: "Output", exact: true })
            .evaluate((element) => getComputedStyle(element).borderStyle),
          "dashed",
        );
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 - 20 });
        assert.equal(
          await input.locator(".input-drop-hint").count(),
          0,
          "Progress toward Output dismisses the delayed hint",
        );
        await send("touchEnd");
        assert.equal(await page.locator(".composition-totals strong").innerText(), "6 PDF pages");
        assert.equal(await preparation.inputValue(), "1", "Input rejects drops without consuming the preparation");
        await send("touchStart", { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 });
        await send("touchMove", { x: bounds.x + bounds.width / 2 + 10, y: bounds.y + bounds.height / 2 });
        const outputTab = await views.getByRole("button", { name: "Output", exact: true }).boundingBox();
        await send("touchMove", { x: outputTab.x + outputTab.width / 2, y: outputTab.y + outputTab.height / 2 });
        await page.waitForTimeout(750);
        assert.equal(await input.isVisible(), true, "Hovering Output does not change the pane before the drop");
        assert.equal(await input.locator(".input-drop-hint").count(), 0);
        await send("touchEnd");
        await output.waitFor({ state: "visible" });
        await page.waitForFunction(
          () => document.querySelector(".composition-totals strong")?.textContent === "7 PDF pages",
        );
        assert.equal(await input.locator('input[aria-label="Page selection"]').inputValue(), "");
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false);
      }
      assert.deepEqual(errors, []);
      await session.detach();
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Touch Selection keeps the keyboard closed and image gestures preserve pages", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, height, colorScheme, textSize] of [
      [810, 1080, "light", "100%"],
      [390, 844, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, hasTouch: true, isMobile: true });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(`${server.resolvedUrls.local[0]}?demo`);
      await page.locator(".composition-totals strong").waitFor({ state: "attached" });
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize);
      const session = await page.context().newCDPSession(page);
      const send = (type, point) =>
        session.send("Input.dispatchTouchEvent", { type, touchPoints: point ? [{ ...point, id: 1 }] : [] });
      const total = () => page.locator(".composition-totals strong").innerText();
      const lens = page.getByRole("region", { name: /^Magnified page / });
      for (const name of ["Input", "Output"]) {
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).tap();
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
        const field = pane.getByRole("textbox", { name: "Page selection", exact: true });
        assert.equal(await field.getAttribute("inputmode"), "numeric");
        await pane.getByRole("button", { name: `Compact ${name} grid`, exact: true }).tap();
        const cards = pane.locator(".composition-card");
        const clear = pane.getByRole("button", {
          name: name === "Input" ? "Clear page sequence" : "Clear Output selection",
          exact: true,
        });
        await field.fill("2-4,6");
        await clear.tap();
        assert.equal(await field.inputValue(), "");
        assert.equal(
          await pane.locator(".composition-grid").evaluate((element) => element === document.activeElement),
          true,
        );
        await cards.first().locator(".page-image").tap();
        assert.equal(await field.inputValue(), "1");
        await clear.tap();
        assert.equal(await field.inputValue(), "");
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false);
        await pane.getByRole("button", { name: "Select all", exact: true }).tap();
        assert.equal(await field.inputValue(), name === "Input" ? "1-7" : "1-6");
        assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false);
        await clear.press("Space");
        assert.equal(await field.inputValue(), "");
        assert.equal(await field.evaluate((element) => element === document.activeElement), true);
        if (name === "Output") {
          await field.fill("1");
          await pane.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).tap();
          assert.equal(await total(), "7 PDF pages");
          assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false);
          await pane.getByRole("button", { name: "Remove selected Output pages", exact: true }).tap();
          assert.equal(await total(), "6 PDF pages");
          assert.equal(await page.evaluate(() => document.activeElement instanceof HTMLInputElement), false);
        }
        await field.fill("2-4,6");
        await pane.getByRole("tab", { name: "Grid", exact: true }).tap();
        const before = await total();
        const target = cards.first().locator(".page-image canvas");
        await target.scrollIntoViewIfNeeded();
        const bounds = await target.boundingBox();
        const point = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
        await send("touchStart", point);
        await lens.waitFor();
        const crop = await lens.boundingBox();
        assert.ok(crop.x >= 12 && crop.x + crop.width <= width - 12);
        assert.ok(crop.y >= 12 && crop.y + crop.height <= height - 12);
        await send("touchMove", { ...point, x: point.x + 8 });
        await lens.waitFor();
        await send("touchEnd");
        await lens.waitFor({ state: "hidden" });
        assert.equal(await field.inputValue(), "2-4,6", "Holding and releasing the lens leaves Selection unchanged");
        assert.equal(await total(), before);
        await send("touchStart", point);
        await lens.waitFor();
        await session.send("Input.dispatchTouchEvent", {
          type: "touchStart",
          touchPoints: [
            { ...point, id: 1 },
            { x: width - 16, y: 100, id: 2 },
          ],
        });
        await lens.waitFor({ state: "hidden" });
        await send("touchCancel");
        await send("touchStart", point);
        await send("touchMove", { ...point, y: point.y - 40 });
        await send("touchCancel");
        await page.waitForTimeout(320);
        assert.equal(await lens.count(), 0, "Scrolling before the hold cancels a pending lens");
        assert.equal(await field.inputValue(), "2-4,6");
        await target.tap();
        await target.tap();
        await pane.locator(".page-view").waitFor();
        assert.equal(await field.inputValue(), "2-4,6", "Double tap restores Selection before opening Page");
        assert.match(await pagePosition(pane), name === "Input" ? /^1\s*\/\s*7$/ : /^1\s*\/\s*6$/);
        assert.equal(await total(), before);
        const sheet = pane.locator(".page-scroll canvas");
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor();
        await sheet.scrollIntoViewIfNeeded();
        const pageBounds = await sheet.boundingBox();
        await send("touchStart", {
          x: pageBounds.x + pageBounds.width / 2,
          y: Math.min(height - 16, Math.max(16, pageBounds.y + pageBounds.height / 2)),
        });
        await lens.waitFor();
        await send("touchEnd");
        await lens.waitFor({ state: "hidden" });
        assert.equal(await field.inputValue(), "2-4,6");
        assert.equal(await total(), before, "Holding a Page image does not add or duplicate it");
        if (name === "Output") {
          for (const expected of ["7 PDF pages", "8 PDF pages"]) {
            await sheet.tap();
            await sheet.tap();
            await page.waitForFunction(
              (text) => document.querySelector(".composition-totals strong")?.textContent === text,
              expected,
            );
            await page.waitForTimeout(400);
          }
          assert.equal(await field.inputValue(), "4-6, 8", "Double taps preserve the originally selected occurrences");
        }
      }
      assert.deepEqual(errors, []);
      await session.detach();
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "Grid layouts preserve column capacity, centered grips, usable targets, and Page thumbnail references",
  { timeout: 180000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      for (const hasTouch of [false, true]) {
        const page = await browser.newPage({ hasTouch, isMobile: hasTouch, reducedMotion: "reduce" });
        page.setDefaultTimeout(10000);
        await page.route("**/grid.pdf", (route) =>
          route.fulfill({ contentType: "application/pdf", body: fixture(true, false, 0, false, false, {}, 240) }),
        );
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
        await page.goto(`${server.resolvedUrls.local[0]}?demo=grid`);
        await page.locator(".composition-totals strong").waitFor({ state: "attached" });
        const cases = hasTouch
          ? [
              [320, 568, 1, 2],
              [390, 844, 2, 3],
              [440, 956, 2, 4],
              [640, 960, 3, 5],
              [744, 1133, 4, 7],
              [744, 600, 4, 7],
              [768, 1024, 4, 7],
              [810, 1080, 4, 8],
              [810, 790, 4, 8],
              [810, 600, 4, 8],
              [820, 1180, 4, 8],
              [834, 1194, 4, 8],
              [1024, 768, 3, 5],
              [1080, 810, 3, 5],
              [1133, 744, 3, 5],
              [1180, 820, 3, 5],
              [1440, 1100, 3, 5],
            ]
          : [
              [390, 844, 2, 4],
              [810, 1080, 4, 9],
              [1440, 1100, 3, 6],
              [1920, 1080, 3, 6],
              [2560, 1440, 4, 8],
            ];
        for (const [width, height, normal, columns] of cases) {
          await page.setViewportSize({ width, height });
          await page.emulateMedia({ colorScheme: width === 810 ? "light" : "dark" });
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs");
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click();
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
            await pane.getByRole("button", { name: `Normal ${name} grid`, exact: true }).click();
            assert.equal(
              await pane
                .locator(".composition-grid")
                .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
              normal,
            );
            const normalMargin = hasTouch ? { 1024: 14, 1080: 18 }[width] : undefined;
            if (normalMargin !== undefined) {
              await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor();
              const geometry = await pane
                .locator(".composition-card")
                .first()
                .evaluate((card) => {
                  const bounds = card.getBoundingClientRect(),
                    pageBounds = card.querySelector("canvas").getBoundingClientRect();
                  return {
                    width: pageBounds.width,
                    height: pageBounds.height,
                    margin: (bounds.width - pageBounds.width) / 2,
                  };
                });
              assert.ok(geometry.width > 118 && geometry.width < 120);
              assert.equal(geometry.height, 168);
              assert.ok(geometry.margin < normalMargin, "Normal adds a column without shrinking its image");
            }
            await checkGrips(pane, `${name} Normal, ${width}×${height}: grips stay centered in both selection states`);
            await pane.getByRole("button", { name: `Compact ${name} grid`, exact: true }).click();
            assert.equal(
              await pane
                .locator(".composition-grid")
                .evaluate((element) => getComputedStyle(element).gridTemplateColumns.split(" ").length),
              columns,
              `${name}, ${width}×${height}, ${hasTouch ? "touch" : "mouse"}`,
            );
            const margin = hasTouch ? { 440: 19, 744: 17, 768: 19, 810: 16, 1024: 16 }[width] : undefined;
            if (margin !== undefined) {
              await pane.locator('.thumbnail[aria-busy="false"] canvas').first().waitFor();
              const geometry = await pane
                .locator(".composition-card")
                .first()
                .evaluate((card) => {
                  const pageBounds = card.querySelector("canvas").getBoundingClientRect(),
                    bounds = card.getBoundingClientRect();
                  return {
                    image: pageBounds.width,
                    left: pageBounds.left - bounds.left,
                    right: bounds.right - pageBounds.right,
                    targets: [...card.querySelector(".page-label").children]
                      .slice(0, 2)
                      .map((element) => element.getBoundingClientRect().width),
                  };
                });
              assert.ok(geometry.left < margin && geometry.right < margin);
              assert.ok(Math.abs(geometry.left - geometry.right) < 1, "The image stays centered");
              assert.ok(geometry.image > 57 && geometry.image < 59, "The portrait thumbnail retains its size");
              assert.ok(
                geometry.targets.every((target) => target >= 24),
                "Both heading targets remain usable",
              );
              if (width === 810)
                await page.waitForFunction(
                  (selector) => document.querySelector(selector).children.length === 56,
                  name === "Input" ? ".selection-panel .composition-grid" : ".composition-output .composition-grid",
                );
            }
            await checkGrips(pane, `${name} Compact, ${width}×${height}: grips stay centered in both selection states`);
            const card = await pane.locator(".composition-card").first().boundingBox();
            await tab(pane, "Page");
            const reference = await pane.locator(".page-reference").evaluate((element) => ({
              columns: getComputedStyle(element).gridTemplateColumns.split(" ").length,
              width: element.firstElementChild.getBoundingClientRect().width,
            }));
            assert.equal(reference.columns, columns, "Page uses the same columns as Grid");
            assert.ok(Math.abs(reference.width - card.width) < 1, "Page retains Grid's thumbnail reference width");
            await tab(pane, "Grid");
            assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
          }
          if (hasTouch && width === 1080) {
            for (const [nextHeight, capacity] of [
              [1200, 25],
              [810, 25],
            ]) {
              await page.setViewportSize({ width, height: nextHeight });
              for (const selector of [".selection-panel", ".composition-output"]) {
                await page.waitForFunction(
                  (value) =>
                    document.querySelector(`${value.selector} .composition-grid`).children.length === value.capacity,
                  { selector, capacity },
                );
              }
            }
          }
          await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
          for (const name of ["Input", "Output"]) {
            const views = page.locator(".mobile-workspace-tabs");
            if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click();
            const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
            for (const density of ["Normal", "Compact"]) {
              await pane.getByRole("button", { name: `${density} ${name} grid`, exact: true }).click();
              await checkGrips(pane, `${name} ${density}, ${width}×${height}, 200% text`);
              assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
            }
          }
          await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
        }
        await page.close();
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Page pinch zoom preserves its anchor and shares the button zoom range", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, height, colorScheme] of [
      [810, 1080, "light"],
      [390, 844, "dark"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height }, isMobile: true, hasTouch: true });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.emulateMedia({ colorScheme });
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(`${server.resolvedUrls.local[0]}?demo`);
      await page.locator(".composition-totals strong").waitFor({ state: "attached" });
      const session = await page.context().newCDPSession(page);
      for (const name of ["Input", "Output"]) {
        await page.locator(".mobile-workspace-tabs").getByRole("button", { name, exact: true }).tap();
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
        const selection = pane.getByRole("textbox", { name: "Page selection", exact: true });
        const prepared = await selection.inputValue();
        await tab(pane, "Page");
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor();
        const canvas = pane.locator(".page-scroll canvas");
        await canvas.scrollIntoViewIfNeeded();
        const before = await canvas.boundingBox();
        const raster = await canvas.evaluate((element) => element.width);
        const center = { x: before.x + before.width * 0.6, y: Math.min(height - 100, before.y + before.height * 0.55) };
        const anchor = { x: (center.x - before.x) / before.width, y: (center.y - before.y) / before.height };
        const points = (distance) => [
          { x: center.x - distance / 2, y: center.y, id: 1 },
          { x: center.x + distance / 2, y: center.y, id: 2 },
        ];
        await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(80) });
        await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(140) });
        const enlarged = await canvas.boundingBox();
        assert.ok(Math.abs(enlarged.width - before.width * 1.75) < 1);
        assert.equal(
          await canvas.evaluate((element) => element.width),
          raster,
          "The live gesture reuses the existing raster",
        );
        await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
        await page.waitForFunction(
          (label) =>
            [...document.querySelectorAll("output")].some(
              (element) => element.getAttribute("aria-label") === label && element.textContent === "175%",
            ),
          `${name} page zoom`,
        );
        await page.waitForFunction(
          (selector) => {
            const element = document.querySelector(`${selector} .page-scroll canvas`);
            return element && !element.style.transform && element.parentElement.getAttribute("aria-busy") === "false";
          },
          name === "Input" ? ".selection-panel" : ".composition-output",
        );
        const after = await canvas.boundingBox();
        assert.ok(
          Math.abs(after.x + after.width * anchor.x - center.x) < 2,
          "Pinch keeps the horizontal anchor under the fingers",
        );
        assert.ok(
          Math.abs(after.y + after.height * anchor.y - center.y) < 2,
          "Pinch keeps the vertical anchor under the fingers",
        );
        assert.equal(await page.evaluate(() => visualViewport.scale), 1);
        assert.equal(await selection.inputValue(), prepared);
        assert.equal(await page.locator(".composition-totals strong").innerText(), "6 PDF pages");
        await zoom(pane, "Zoom in");
        assert.equal(await pane.locator("output").textContent(), "200%");
        await zoom(pane, "Zoom out");
        assert.equal(await pane.locator("output").textContent(), "150%");
        await zoom(pane, "Fit page");
        assert.equal(await pane.locator("output").textContent(), "100%");
        if (width === 810 && name === "Output") {
          await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor();
          await canvas.scrollIntoViewIfNeeded();
          const bounds = await canvas.boundingBox();
          const pointsAt = (distance) => [
            { x: width / 2 - distance / 2, y: bounds.y + 150, id: 1 },
            { x: width / 2 + distance / 2, y: bounds.y + 150, id: 2 },
          ];
          await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pointsAt(80) });
          await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pointsAt(160) });
          await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
          assert.equal(await pane.locator("output").textContent(), "100%", "Cancellation retains the previous zoom");
          assert.equal(await canvas.evaluate((element) => element.style.transform), "");
          for (const [start, end, expected] of [
            [80, 480, "400%"],
            [400, 40, "50%"],
          ]) {
            await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: pointsAt(start) });
            await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: pointsAt(end) });
            await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
            assert.equal(await pane.locator("output").textContent(), expected);
            await page.waitForFunction(() => {
              const element = document.querySelector(".composition-output .page-scroll canvas");
              return !element.style.transform && element.parentElement.getAttribute("aria-busy") === "false";
            });
          }
          assert.equal(await selection.inputValue(), prepared);
          assert.equal(await page.locator(".composition-totals strong").innerText(), "6 PDF pages");
        }
      }
      assert.deepEqual(errors, []);
      await session.detach();
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("The lens waits for a settled mouse and cancels pending openings", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, theme, textSize] of [
      [1440, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      await page.clock.install({ time: 0 });
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:onboarding", "19");
        localStorage.setItem("mainz:theme", choice);
      }, theme);
      await page.goto(`${server.resolvedUrls.local[0]}?demo`);
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize);
      const lens = page.getByRole("region", { name: /^Magnified page / });
      for (const name of ["Input", "Output"]) {
        for (const view of ["Grid", "Page"]) {
          await page.clock.resume();
          if (width === 390)
            await page
              .getByRole("navigation", { name: "Workspace view", exact: true })
              .getByRole("button", { name, exact: true })
              .click();
          const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
          await tab(pane, view);
          const canvas = pane.locator(view === "Grid" ? ".thumbnail canvas" : ".page-scroll canvas").first();
          await canvas.scrollIntoViewIfNeeded();
          await page.waitForFunction(
            (element) =>
              element.width > 0 &&
              !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]") &&
              !document.querySelector('.output-status[aria-hidden="false"]'),
            await canvas.elementHandle(),
          );
          await page.evaluate(() => document.fonts.ready);
          await page.mouse.move(0, 0);
          await page.clock.pauseAt(await page.evaluate(() => Date.now() + 1000));
          const bounds = await canvas.boundingBox();
          const move = async (fraction) => {
            const area = await canvas.boundingBox();
            await canvas.hover({ position: { x: area.width * fraction, y: area.height / 2 } });
          };
          for (const fraction of [0.2, 0.3, 0.4, 0.5]) {
            await move(fraction);
            await page.clock.runFor(100);
            assert.equal(await lens.count(), 0, `${name} ${view}: continuous movement does not open the lens`);
          }
          await page.clock.runFor(100);
          await lens.waitFor();
          assert.equal(await lens.isVisible(), true, `${name} ${view}: a brief stop opens the lens`);
          await page.clock.runFor(200);
          await lens.locator("canvas").waitFor();
          const before = await lens.locator("canvas").evaluate((element) => element.toDataURL());
          await move(0.7);
          assert.notEqual(
            await lens.locator("canvas").evaluate((element) => element.toDataURL()),
            before,
            `${name} ${view}: the open lens follows immediately`,
          );
          await page.mouse.move(0, 0);
          assert.equal(await lens.count(), 0, `${name} ${view}: leaving closes the lens`);
          for (const action of ["leave", "Escape", "click", "wheel"]) {
            await move(0.5);
            await page.clock.runFor(100);
            if (action === "leave") await page.mouse.move(0, 0);
            else if (action === "Escape") await page.keyboard.press("Escape");
            else if (action === "click")
              await page.mouse.click(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
            else await page.mouse.wheel(0, 1);
            await page.clock.runFor(300);
            assert.equal(await lens.count(), 0, `${name} ${view}: ${action} cancels a pending opening`);
            await page.mouse.move(0, 0);
          }
        }
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "Grid and Page share edits while inspection, original appearance, and Sources stay independent",
  { timeout: 120000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "reduce",
      });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(server.resolvedUrls.local[0]);
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const ready = () =>
        page.waitForFunction(
          () =>
            !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]") &&
            !document.querySelector('.output-status[aria-hidden="false"]'),
        );
      const open = async (buffer) => {
        const count = Number((await input.locator(".input-heading .count").allTextContents())[0] ?? 0);
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({ name: "Filled.pdf", mimeType: "application/pdf", buffer });
        await page.waitForFunction(
          (previous) => Number(document.querySelector(".input-heading .count")?.textContent) === previous + 1,
          count,
        );
        await ready();
      };
      const select = input.getByRole("textbox", { name: "Page selection", exact: true });
      const color = async (canvas, y, expected) => {
        await page.waitForFunction(
          ({ canvas: element, y: fraction, expected: rgba }) => {
            const actual = element
              .getContext("2d")
              .getImageData(Math.floor(element.width / 2), Math.floor(element.height * fraction), 1, 1).data;
            return rgba.every((value, index) => actual[index] === value);
          },
          { canvas: await canvas.elementHandle(), y, expected },
        );
        assert.deepEqual(await pixel(canvas, y), expected);
      };
      await open(fixture(true, false, 0, true, true));
      await select.fill("7,2,2");
      await tab(input, "Page");
      assert.match(await pagePosition(input), /1\s*\/ 7/);
      const inputGrip = input.getByRole("button", {
        name: "Select or drag Input page 1 to Output",
        exact: true,
      });
      await inputGrip.press("Space");
      assert.equal(await inputGrip.getAttribute("aria-pressed"), "true");
      assert.equal(await select.inputValue(), "7, 2, 2, 1");
      await inputGrip.press("Space");
      assert.equal(await inputGrip.getAttribute("aria-pressed"), "false");
      assert.equal(await select.inputValue(), "7, 2, 2");
      await select.fill("7,2,2");
      await input.getByRole("button", { name: "Next Input page", exact: true }).click();
      assert.equal(await select.inputValue(), "7,2,2");
      await tab(input, "Grid");
      await input.getByRole("button", { name: "Clear page sequence", exact: true }).click();
      await input.getByRole("button", { name: "Add Input page 2 to Output", exact: true }).press("Space");
      assert.equal(await select.inputValue(), "");
      assert.equal(await output.locator(".composition-totals strong").innerText(), "1 PDF page");
      await tab(input, "Page");
      await select.fill("7,2,2");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      assert.equal(await output.locator(".composition-totals strong").innerText(), "4 PDF pages");
      assert.equal(await select.inputValue(), "");
      await select.fill("7,2,2");
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      await output.getByRole("button", { name: "Select Output page 3", exact: true }).click();
      await tab(output, "Page");
      assert.match(await pagePosition(output), /3\s*\/ 4/);
      await tab(input, "Style");
      await input.getByLabel("Edit Fill", { exact: true }).click();
      await input.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#ff0000");
      await ready();
      await tab(input, "Page");
      await ready();
      const fold = await input.locator(".fold-fill").evaluate((el) => ({
        fill: getComputedStyle(el).fill,
        stroke: getComputedStyle(el).stroke,
        width: getComputedStyle(el).strokeWidth,
        edge: getComputedStyle(el.nextElementSibling).strokeWidth,
      }));
      assert.equal(fold.stroke, fold.fill);
      assert.equal(fold.width, "2px");
      assert.equal(fold.width, fold.edge);
      await color(image(input), 0.7, [0, 0, 0, 255]);
      await color(image(output), 0.7, [255, 0, 0, 255]);
      const dragFeedback = async (control, expected, layers = 1) => {
        await ready();
        const feedbackData = await page.evaluateHandle(() => {
          const dataTransfer = new DataTransfer();
          const setImage = dataTransfer.setDragImage.bind(dataTransfer);
          dataTransfer.setDragImage = (canvas, x, y) => {
            dataTransfer.rendered =
              canvas.isConnected &&
              getComputedStyle(canvas).visibility === "visible" &&
              canvas.getBoundingClientRect().width === canvas.width &&
              canvas.getBoundingClientRect().height === canvas.height;
            setImage(canvas, x, y);
            dataTransfer.image = canvas;
            dataTransfer.pointer = [x, y];
          };
          return dataTransfer;
        });
        await control.dispatchEvent("dragstart", { dataTransfer: feedbackData });
        const feedback = await feedbackData.evaluate((data) => ({
          width: data.image.width,
          height: data.image.height,
          pointer: data.pointer,
          rendered: data.rendered,
          color: Array.from(
            data.image
              .getContext("2d")
              .getImageData(Math.floor(data.image.width / 2), Math.floor(data.image.height * 0.7), 1, 1).data,
          ),
          lowerLeft: data.image.getContext("2d").getImageData(0, data.image.height - 3, 1, 1).data[3],
          lowerRight: data.image.getContext("2d").getImageData(data.image.width - 3, data.image.height - 3, 1, 1)
            .data[3],
          edges: [2, 8, 14].map((y) => {
            const row = data.image.getContext("2d").getImageData(0, y, data.image.width, 1).data;
            for (let x = data.image.width - 1; x >= 0; x--) if (row[x * 4 + 3]) return x;
          }),
        }));
        assert.ok(feedback.width > 44 && feedback.width <= 120);
        assert.ok(feedback.height > 44 && feedback.height <= 160);
        const offset = (layers - 1) * 6;
        assert.ok(Math.abs((feedback.width - offset) / (feedback.height - offset) - 210 / 297) < 0.02);
        assert.equal(feedback.lowerLeft, layers === 1 ? 255 : 0);
        assert.equal(feedback.lowerRight, 255);
        assert.deepEqual(
          feedback.edges.map((edge) => edge - feedback.edges[0]),
          [0, layers > 1 ? 6 : 0, offset],
          "The drag image shows the correct number of stacked sheets",
        );
        assert.deepEqual(feedback.color, expected);
        assert.deepEqual(feedback.pointer, [feedback.width / 2, 12]);
        assert.equal(feedback.rendered, true);
        await control.dispatchEvent("dragend", { dataTransfer: feedbackData });
        assert.equal(await page.locator(".composer[data-drag]").count(), 0);
        assert.equal(await page.locator(".drag-image").count(), 0);
        await feedbackData.dispose();
      };
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 3);
      await tab(input, "Grid");
      await ready();
      await dragFeedback(input.getByRole("button", { name: "Select Input page 2", exact: true }), [0, 0, 0, 255], 3);
      await dragFeedback(input.getByRole("button", { name: "Add to Output", exact: true }), [0, 0, 0, 255], 3);
      await tab(input, "Page");
      await tab(output, "Grid");
      await ready();
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 3", exact: true }),
        [255, 0, 0, 255],
      );
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 3);
      await select.fill("2,7");
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 2);
      await select.fill("2");
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255]);
      await input.getByLabel("Input page actions", { exact: true }).click();
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2");
      await input.getByLabel("Input page actions", { exact: true }).click();
      await dragFeedback(input.locator(".inspection-heading .page-grip"), [0, 0, 0, 255], 2);
      await input.getByRole("button", { name: "Clear page sequence", exact: true }).click();
      await select.fill("7,2,2");
      const outputField = output.getByRole("textbox", { name: "Page selection", exact: true });
      const session = await page.context().newCDPSession(page);
      // Keep selection-triggered thumbnail redraws in flight on fast runners.
      await session.send("Emulation.setCPUThrottlingRate", { rate: 6 });
      await outputField.fill("1-3");
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 3", exact: true }),
        [255, 0, 0, 255],
        3,
      );
      await outputField.fill("2-3");
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 3", exact: true }),
        [255, 0, 0, 255],
        2,
      );
      await outputField.fill("");
      await session.send("Emulation.setCPUThrottlingRate", { rate: 1 });
      await session.detach();
      await tab(output, "Page");
      await ready();
      const lensColor = async (pane, expected) => {
        await page.mouse.move(0, 0);
        const bounds = await image(pane).boundingBox();
        await image(pane).hover({ position: { x: bounds.width / 2, y: bounds.height * 0.7 } });
        await page.locator('.lens[aria-busy="false"]').waitFor();
        await color(page.locator(".lens canvas"), 0.5, expected);
        await page.mouse.move(0, 0);
      };
      await lensColor(input, [0, 0, 0, 255]);
      await lensColor(output, [255, 0, 0, 255]);
      await output.getByRole("button", { name: "Compare page", exact: true }).click();
      await ready();
      await lensColor(output, [0, 0, 0, 255]);
      const lensEdge = async (canvas) => {
        await canvas.scrollIntoViewIfNeeded();
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const bounds = await canvas.boundingBox();
        await canvas.hover({ position: { x: bounds.width / 2, y: bounds.height * 0.485 } });
        const lens = page.locator('.lens[aria-busy="false"] canvas');
        await lens.waitFor();
        return lens.evaluate((el) => {
          const pixels = el.getContext("2d").getImageData(Math.floor(el.width / 2), 0, 1, el.height).data;
          return Array.from({ length: el.height }, (_, y) => y).find((y) => pixels[y * 4 + 1] < 128);
        });
      };
      await tab(output, "Grid");
      await ready();
      const edge = await lensEdge(output.locator(".thumbnail canvas").nth(2));
      assert.ok(edge > 160 && edge < 240);
      await tab(output, "Page");
      await ready();
      const sideGap = () =>
        output.locator(".page-scroll").evaluate((el) => {
          const canvas = el.querySelector("canvas").getBoundingClientRect();
          return canvas.left - el.getBoundingClientRect().left + el.scrollLeft;
        });
      const fittedGap = await sideGap();
      assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "Page lens uses the Grid thumbnail scale");
      await zoom(output, "Zoom in");
      await ready();
      assert.ok(Math.abs((await sideGap()) - fittedGap) < 1, "150% zoom retains the fitted side gap");
      assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "150% zoom retains the thumbnail lens scale");
      await zoom(output, "Zoom in");
      await ready();
      assert.ok(Math.abs((await sideGap()) - fittedGap) < 1, "200% zoom retains the fitted side gap");
      assert.ok(Math.abs((await lensEdge(image(output))) - edge) < 8, "200% zoom retains the thumbnail lens scale");
      const trailingGap = await output.locator(".page-scroll").evaluate((el) => {
        el.scrollLeft = el.scrollWidth - el.clientWidth;
        return el.getBoundingClientRect().right - el.querySelector("canvas").getBoundingClientRect().right;
      });
      assert.ok(Math.abs(trailingGap - fittedGap) < 1, "Zoom retains the trailing side gap");
      await tab(output, "Grid");
      await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
      await ready();
      const compactEdge = await lensEdge(output.locator(".page-image canvas").nth(2));
      await tab(output, "Page");
      await ready();
      assert.ok(
        Math.abs((await lensEdge(image(output))) - compactEdge) < 8,
        "Page lens uses the enlarged Compact image scale",
      );
      await tab(output, "Grid");
      await output.getByRole("button", { name: "Normal Output grid", exact: true }).click();
      await tab(output, "Page");
      await ready();
      await output.locator(".page-scroll").evaluate((element) => {
        element.scrollLeft = (element.scrollWidth - element.clientWidth) * 0.3;
        element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.6;
      });
      await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollTop > 0);
      const viewport = output.locator(".page-scroll");
      const pan = async (pane) => {
        const scroller = pane.locator(".page-scroll");
        await scroller.scrollIntoViewIfNeeded();
        await scroller.evaluate((el) => {
          el.scrollLeft = (el.scrollWidth - el.clientWidth) * 0.3;
          el.scrollTop = (el.scrollHeight - el.clientHeight) * 0.6;
        });
        await page.evaluate(() => new Promise(requestAnimationFrame));
        const element = await scroller.elementHandle();
        const start = await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
        const box = await scroller.boundingBox();
        const x = box.x + box.width / 2,
          y = box.y + box.height / 2;
        await page.mouse.move(x, y);
        await page.mouse.down();
        for (let step = 1; step <= 3; step++) {
          await page.mouse.move(x + step * 10, y + step * 10);
          await page.waitForFunction(
            ({ element: el, start: offset, step: distance }) =>
              Math.abs(el.scrollLeft - offset.x + distance * 10) < 1 &&
              Math.abs(el.scrollTop - offset.y + distance * 10) < 1,
            { element, start, step },
          );
          assert.equal(await scroller.evaluate((el) => getComputedStyle(el).cursor), "grabbing");
        }
        await page.mouse.move(x, box.y - 10);
        await page.waitForFunction(({ element: el, start: offset }) => el.scrollTop > offset.y + 30, {
          element,
          start,
        });
        await page.mouse.up();
        const end = await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
        await page.mouse.move(x, y);
        assert.deepEqual(await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })), end);
        assert.equal(await scroller.evaluate((el) => getComputedStyle(el).cursor), "grab");
        await page.mouse.down();
        await scroller.evaluate((el) => el.releasePointerCapture(1));
        await page.mouse.move(x + 20, y + 20);
        await page.mouse.up();
        assert.deepEqual(await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })), end);
      };
      await pan(output);
      const region = await viewport.evaluate((element) => ({
        x: element.scrollLeft / (element.scrollWidth - element.clientWidth),
        y: element.scrollTop / (element.scrollHeight - element.clientHeight),
        width: element.querySelector("canvas").width,
      }));
      await page.setViewportSize({ width: 1100, height: 1100 });
      await page.waitForFunction((expected) => {
        const element = document.querySelector(".composition-output .page-scroll");
        return (
          element.querySelector("canvas").width < expected.width &&
          Math.abs(element.scrollLeft / (element.scrollWidth - element.clientWidth) - expected.x) < 0.02 &&
          Math.abs(element.scrollTop / (element.scrollHeight - element.clientHeight) - expected.y) < 0.02
        );
      }, region);
      await page.setViewportSize({ width: 1440, height: 1100 });
      await ready();
      await open(fixture(true, false, 0, true, true));
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true);
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      await tab(input, "Style");
      await input.getByLabel("Edit Fill", { exact: true }).click();
      await input.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#0000ff");
      await ready();
      const outputPosition = await pagePosition(output);
      await output.getByRole("button", { name: "Show original page", exact: true }).click();
      await ready();
      assert.equal(await page.locator(".input-current").innerText(), "Filled.pdf");
      assert.match(await pagePosition(input), /2\s*\/ 7/);
      assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "200%");
      assert.equal(await select.inputValue(), "7,2,2");
      assert.equal(await pagePosition(output), outputPosition);
      assert.equal(
        await output.getByRole("button", { name: "Compare page", exact: true }).getAttribute("aria-pressed"),
        "true",
      );
      const regions = await page.locator(".page-scroll").evaluateAll((elements) =>
        elements.map((el) => ({
          x: el.scrollLeft / Math.max(1, el.scrollWidth - el.clientWidth),
          y: el.scrollTop / Math.max(1, el.scrollHeight - el.clientHeight),
        })),
      );
      assert.ok(Math.abs(regions[0].y - regions[1].y) < 0.02, JSON.stringify(regions));
      assert.ok(Math.abs(regions[0].x - regions[1].x) < 0.02, JSON.stringify(regions));
      await pan(input);
      await input.getByRole("button", { name: "Next Input page", exact: true }).click();
      await zoom(output, "Zoom out");
      assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "200%");
      assert.equal(await pagePosition(output), outputPosition);
      const transfer = await page.evaluateHandle(() => new DataTransfer());
      await output.getByLabel("Page selection", { exact: true }).fill("3");
      await viewport.press("Control+ArrowRight");
      assert.match(await pagePosition(output), /4\s*\/ 5/);
      await viewport.press("Control+ArrowLeft");
      assert.match(await pagePosition(output), /3\s*\/ 5/);
      await viewport.press("Control+ArrowRight");
      assert.match(await pagePosition(output), /4\s*\/ 5/);
      await viewport.press("Control+ArrowLeft");
      assert.match(await pagePosition(output), /3\s*\/ 5/);
      await viewport.press("Delete");
      assert.match(await pagePosition(output), /3\s*\/ 4/);
      await output.getByRole("button", { name: "Duplicate Output page 3", exact: true }).click();
      assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages");
      await zoom(input, "Fit page");
      await zoom(output, "Fit page");
      await input.getByRole("button", { name: "Previous Input page", exact: true }).click();
      await ready();
      for (const pane of [input, output]) {
        const scroller = pane.locator(".page-scroll");
        await scroller.scrollIntoViewIfNeeded();
        const start = await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop }));
        const bounds = await scroller.boundingBox();
        await page.mouse.move(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2);
        await page.mouse.down();
        await page.mouse.move(bounds.x + bounds.width / 2 - 30, bounds.y + bounds.height / 2 - 40);
        await page.mouse.up();
        assert.deepEqual(await scroller.evaluate((el) => ({ x: el.scrollLeft, y: el.scrollTop })), start);
        assert.equal(await scroller.evaluate((el) => getComputedStyle(el).cursor), "auto");
      }
      const dropBox = await output.locator(".inspection-target").boundingBox();
      await input.locator(".inspection-heading .page-grip").dragTo(output.locator(".inspection-target"), {
        targetPosition: { x: dropBox.width - 2, y: 100 },
      });
      assert.equal(await output.locator(".composition-totals strong").innerText(), "8 PDF pages");
      assert.equal(await select.inputValue(), "");
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true");
      for (let position = 2; position < 7; position++)
        await input.getByRole("button", { name: "Next Input page", exact: true }).click();
      await ready();
      for (const theme of ["light", "dark"])
        for (const width of [320, 390, 768, 1440])
          for (const text of [100, 200]) {
            await page.setViewportSize({ width, height: 1000 });
            await page.evaluate(
              ({ theme: selectedTheme, text: scale }) => {
                document.documentElement.dataset.theme = selectedTheme;
                document.documentElement.style.fontSize = `${scale}%`;
              },
              { theme, text },
            );
            const views = page.locator(".mobile-workspace-tabs");
            for (const [name, pane] of [
              ["Output", output],
              ["Input", input],
            ]) {
              if (await views.isVisible()) await views.getByRole("button", { name, exact: true }).click();
              assert.equal(await pane.locator(".sequence-entry").isVisible(), true);
              assert.equal(
                await pane.getByRole("navigation", { name: `${name} page navigation`, exact: true }).isVisible(),
                true,
              );
              assert.equal(await pane.locator(".page-actions button").count(), name === "Input" ? 1 : 0);
              assert.equal(await aligned(pane), true, `${name} controls align: ${theme}, ${width}px, ${text}% text`);
              await page.waitForFunction(
                (element) => {
                  const area = element.getBoundingClientRect();
                  const sheet = element.querySelector("canvas").getBoundingClientRect();
                  const before = sheet.y - area.y,
                    after = area.bottom - sheet.bottom;
                  return before >= 18 && Math.abs(before - after) < 1;
                },
                await pane.locator(".pdf-viewport").elementHandle(),
              );
              assert.equal(
                await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
                true,
                `${name}: ${theme}, ${width}px, ${text}% text`,
              );
            }
          }
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
      const pending = page.waitForEvent("download");
      await output.getByRole("button", { name: "Download", exact: true }).click();
      const saved = await readFile(await (await pending).path());
      await output.getByRole("button", { name: "Select all", exact: true }).click();
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
      await open(saved);
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      await tab(input, "Style");
      await input.getByRole("button", { name: "Reset all styles", exact: true }).click();
      await tab(input, "Page");
      await ready();
      await color(image(input), 0.7, [255, 0, 0, 255]);
      if (
        (await output.getByRole("button", { name: "Compare page", exact: true }).getAttribute("aria-pressed")) ===
        "true"
      ) {
        await output.getByRole("button", { name: "Compare page", exact: true }).click();
        await ready();
      }
      await color(image(output), 0.7, [0, 0, 0, 255]);
      await output.getByRole("button", { name: "Compare page", exact: true }).click();
      await ready();
      await color(image(output), 0.7, [255, 0, 0, 255]);
      await output.getByLabel("Output page actions", { exact: true }).click();
      await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click();
      await output.getByRole("button", { name: "Previous Output page", exact: true }).click();
      await tab(output, "Grid");
      await dragFeedback(
        output.getByRole("button", { name: "Select or drag Output page 1", exact: true }),
        [255, 255, 255, 255],
      );
      await tab(output, "Page");
      await output.getByRole("button", { name: "Select all", exact: true }).click();
      await viewport.press("Delete");
      assert.equal(
        await viewport.evaluate((element) => element === document.activeElement),
        true,
        "Removing the final pages preserves viewport focus",
      );
      await select.fill(Array(10).fill("1").join(","));
      await input.getByLabel("Input page actions", { exact: true }).click();
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("1000");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      assert.equal(await output.locator(".composition-totals strong").innerText(), "10000 PDF pages");
      const beforeDrop = await pagePosition(output);
      await input.locator(".inspection-heading .page-grip").dispatchEvent("dragstart", {
        dataTransfer: transfer,
      });
      await output
        .getByRole("button", { name: "Next Output page", exact: true })
        .dispatchEvent("dragover", { dataTransfer: transfer });
      await page.waitForFunction(
        () =>
          document.querySelector(".composition-output .inspection-heading .page-current")?.textContent.trim() === "2",
      );
      await output.locator(".inspection-target").dispatchEvent("drop", { dataTransfer: transfer });
      assert.equal(await pagePosition(output), beforeDrop);
      assert.equal(await output.locator(".composition-totals strong").innerText(), "10000 PDF pages");
      assert.match(await page.locator(".error-banner").innerText(), /supports up to 10000/);
      assert.equal(await output.locator("[data-drop]").count(), 0);
      await page.setViewportSize({ width: 320, height: 900 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click();
      assert.equal(
        await output.locator(".inspection-heading").evaluate((element) => {
          const total = element.querySelector(".page-total").getBoundingClientRect();
          const tools = element.querySelector(".page-tools").getBoundingClientRect();
          return total.right <= tools.left || total.bottom <= tools.top;
        }),
        true,
        "Large page totals leave the controls clear with enlarged text",
      );
      for (let step = 0; step < 4; step++) await zoom(output, "Zoom in");
      await ready();
      const scroller = output.locator(".page-scroll");
      const offset = await scroller.evaluate(
        (element) =>
          new Promise((resolve) => {
            element.addEventListener("scroll", () => resolve({ x: element.scrollLeft, y: element.scrollTop }), {
              once: true,
            });
            element.scrollLeft = (element.scrollWidth - element.clientWidth) * 0.3;
            element.scrollTop = (element.scrollHeight - element.clientHeight) * 0.4;
          }),
      );
      assert.ok(offset.x > 0 && offset.y > 0);
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Input", exact: true }).click();
      await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).click();
      await page.waitForFunction((expected) => {
        const element = document.querySelector(".composition-output .page-scroll");
        return Math.abs(element.scrollLeft - expected.x) < 1 && Math.abs(element.scrollTop - expected.y) < 1;
      }, offset);
      await transfer.dispose();
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

async function checkMobile(browser, url) {
  const sample = await readFile("test/fixtures/demo.pdf");
  for (const [width, text, colorScheme] of [
    [320, "100%", "light"],
    [375, "100%", "dark"],
    [390, "100%", "dark"],
    [768, "100%", "light"],
    [320, "200%", "dark"],
    [375, "200%", "light"],
    [390, "200%", "light"],
    [768, "200%", "dark"],
  ]) {
    const context = await browser.newContext({
      ...devices["iPhone 13"],
      viewport: { width, height: width === 375 ? 667 : 900 },
      colorScheme,
      reducedMotion: "reduce",
    });
    try {
      const page = await context.newPage();
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(url);
      await page.evaluate((value) => (document.documentElement.style.fontSize = value), text);
      assert.equal(await page.evaluate(() => innerWidth), width);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      const picker = page.locator(".drop-zone .file-picker[aria-hidden=false]");
      const resting = await picker.evaluate((element) => getComputedStyle(element).backgroundColor);
      await picker.hover();
      assert.equal(
        await picker.evaluate((element) => getComputedStyle(element).backgroundColor),
        resting,
        "Touch screens do not retain hover paint on the PDF chooser",
      );
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "demo.pdf", mimeType: "application/pdf", buffer: sample });
      await page.locator(".composer").waitFor({ timeout: 60000 });
      await page.getByRole("button", { name: "Settings", exact: true }).tap();
      const settings = page.getByRole("dialog", { name: "Settings", exact: true });
      assert.equal(await settings.evaluate((element) => element.scrollWidth <= element.clientWidth), true);
      const identifier = await settings.locator("time").boundingBox();
      assert.ok(identifier.x >= 0 && identifier.x + identifier.width <= width);
      assert.ok(identifier.y >= 0 && identifier.y + identifier.height <= page.viewportSize().height);
      await settings.getByRole("button", { name: "Close Settings", exact: true }).tap();
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const views = page.getByRole("navigation", { name: "Workspace view", exact: true });
      assert.equal(await views.isVisible(), true);
      assert.equal(
        await views.getByRole("button").evaluateAll((buttons) =>
          buttons.every((button) => {
            const range = document.createRange();
            range.selectNodeContents(button.lastChild);
            const rects = [...range.getClientRects()];
            const bounds = button.getBoundingClientRect();
            return rects.length === 1 && rects[0].left >= bounds.left && rects[0].right <= bounds.right;
          }),
        ),
        true,
        "Mobile view labels remain complete on one line at enlarged text sizes",
      );
      assert.equal(await output.isVisible(), false);
      const navigationBox = await views.getByRole("button", { name: "Input", exact: true }).boundingBox();
      const openingBox = await input.locator(".file-picker").boundingBox();
      assert.ok(Math.abs(openingBox.width - navigationBox.width) < 1);
      assert.ok(Math.abs(openingBox.height - navigationBox.height) < 1);
      if (width <= 390) {
        assert.equal(await page.locator(".footnote > time").isVisible(), false);
        assert.equal(await page.locator(".footnote > .status-input").isVisible(), false);
        const footer = await page.locator(".footnote").boundingBox();
        assert.equal(footer.x, 0);
        assert.equal(footer.width, await page.evaluate(() => document.documentElement.clientWidth));
        assert.equal(
          await page.locator(".footnote").evaluate((element) => {
            const style = getComputedStyle(element);
            return parseFloat(style.paddingTop) >= 12 && parseFloat(style.paddingBottom) >= 12;
          }),
          true,
          "Mobile feedback has breathing room above and below",
        );
      }
      const selection = input.getByRole("textbox", { name: "Page selection", exact: true });
      const thumbnail = input.getByRole("button", { name: "Select Input page 1", exact: true });
      await thumbnail.tap();
      assert.equal(await selection.inputValue(), "1", "Touching an image selects the page");
      assert.equal(await thumbnail.evaluate((item) => item === document.activeElement), true);
      const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true });
      await grip.tap();
      assert.equal(await selection.inputValue(), "");
      assert.equal(await thumbnail.evaluate((item) => item === document.activeElement), true);
      await grip.tap();
      assert.equal(await selection.inputValue(), "1");
      assert.equal(await thumbnail.evaluate((item) => item === document.activeElement), true);
      await input.getByRole("button", { name: "Add to Output", exact: true }).tap();
      assert.equal(await output.locator(".output-state strong").textContent(), "1 PDF page");
      assert.equal(await selection.inputValue(), "");
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3");
      await input.getByRole("button", { name: "Add to Output", exact: true }).tap();
      await input.getByRole("tab", { name: "Style", exact: true }).tap();
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet");
      await page.waitForFunction(
        () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
      );
      const guides = input.getByRole("group", { name: "Minors", exact: true });
      await guides.getByLabel("Edit Width", { exact: true }).tap();
      const widthField = guides.getByRole("spinbutton", {
        name: "Minors Stroke Width (mm)",
        exact: true,
      });
      assert.equal(await widthField.inputValue(), "0.04");
      await widthField.fill("0.05");
      assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "");
      assert.match(await input.locator(".style-profile .control-description").textContent(), /Custom styles/);
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet");
      await page.waitForFunction(
        () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
      );
      assert.equal(await widthField.inputValue(), "0.04");
      const pattern = input.locator('.style-object[aria-label="Pattern"]');
      await checkGeometry(pattern);
      if (width <= 390)
        assert.equal(
          await pattern
            .locator(".quartet-component")
            .evaluateAll((elements) =>
              elements.every((element) => getComputedStyle(element).borderTopColor !== "rgba(0, 0, 0, 0)"),
            ),
          true,
          "Touch Quartet summaries retain visible boundaries",
        );
      for (const label of await pattern
        .locator(".quartet-caption > span, .quartet-text > span:not([aria-hidden])")
        .all())
        assert.ok(
          await label.evaluate(
            (element) => element.getBoundingClientRect().height <= parseFloat(getComputedStyle(element).fontSize) * 1.7,
          ),
          "Quartet captions and values must stay on one line",
        );
      await pattern.getByLabel("Edit Fill", { exact: true }).tap();
      assert.equal(
        await pattern.evaluate((element) => {
          const selected = element
            .querySelector('[aria-expanded="true"]')
            .closest(".quartet-property")
            .getBoundingClientRect();
          const dock = element.querySelector(".quartet-dock").getBoundingClientRect();
          const gap = parseFloat(getComputedStyle(element.querySelector(".quartet-fields")).rowGap);
          return dock.y >= selected.bottom && dock.y - selected.bottom <= gap * 3 + 1;
        }),
        true,
        "The editor opens directly below its selected summary row",
      );
      const colorField = pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true });
      assert.equal(
        await colorField.evaluate((element) => {
          const style = getComputedStyle(element);
          const canvas = document.createElement("canvas").getContext("2d");
          canvas.font = style.font;
          return (
            element.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) >=
            canvas.measureText(element.value).width
          );
        }),
        true,
        "The complete color code must fit in the editor",
      );
      assert.equal(
        await pattern.getByText("Fill opacity: 0% is transparent; 100% is opaque.", { exact: true }).isVisible(),
        true,
      );
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await checkStatus(page);
      await views.getByRole("button", { name: "Output", exact: true }).tap();
      assert.equal(await input.isVisible(), false);
      assert.equal(await output.isVisible(), true);
      await output.getByRole("tab", { name: "Page", exact: true }).tap();
      const downloadingBox = await output.getByRole("button", { name: "Download", exact: true }).boundingBox();
      assert.ok(Math.abs(downloadingBox.width - navigationBox.width) < 1);
      assert.ok(Math.abs(downloadingBox.height - navigationBox.height) < 1);
      if (width <= 390) {
        assert.equal(await output.locator(".sequence-entry").isVisible(), true);
        assert.equal(
          await output.locator(".page-tools .tool").evaluateAll((elements) => {
            const boxes = elements.map((element) => element.getBoundingClientRect());
            return boxes.every((box) => box.width >= 44 && box.height >= 44);
          }),
          true,
          "All compact Page tools retain full-size touch targets",
        );
      }
      assert.equal(await aligned(output), true, "Page controls align at narrow widths and enlarged text");
      const tools = output.getByRole("group", { name: "Output Page controls", exact: true });
      assert.equal(await tools.isVisible(), true);
      const toolsBox = await tools.boundingBox();
      assert.ok(toolsBox.x >= 0 && toolsBox.x + toolsBox.width <= width);
      await tools.getByRole("button", { name: "Zoom in", exact: true }).tap();
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%");
      await tools.getByRole("button", { name: "Fit page", exact: true }).tap();
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "100%");
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await views.getByRole("button", { name: "Input", exact: true }).tap();
      assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet");
    } finally {
      await context.close();
    }
  }
}

test("Page image activation repeats current-page copies and preserves selections", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Pages.pdf", mimeType: "application/pdf", buffer: fixture() });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    const options = input.getByLabel("Input page actions", { exact: true });
    const total = () => output.locator(".composition-totals strong").innerText();
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    const pageFocused = () => page.evaluate(() => !!document.activeElement?.matches(".page-image, .page-scroll"));
    await prepared.fill("4,2,2");
    await options.click();
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2");
    await input.getByLabel("Start each repeat on front", { exact: true }).check();
    await options.click();
    const thumbnail = input.getByRole("button", { name: "Select Input page 2", exact: true });
    await thumbnail.click();
    assert.equal(await prepared.inputValue(), "4", "A click toggles all repeated occurrences of the physical page");
    assert.equal(await pageFocused(), true, "Mouse selection permits immediate keyboard use");
    assert.equal(await total(), "0 PDF pages");
    await prepared.fill("4,2,2");
    await thumbnail.dblclick();
    assert.equal(await total(), "8 PDF pages", "Grid addition uses the exact prepared order, copies, and alignment");
    assert.equal(await prepared.inputValue(), "");
    assert.equal(await selected.inputValue(), "1-8");
    assert.equal(await pageFocused(), true);
    await ready();
    await tab(input, "Page");
    await ready();
    assert.match(await pagePosition(input), /2\s*\/ 7/);
    await image(input).click();
    assert.equal(await total(), "8 PDF pages", "A single Page click only focuses the image");
    await image(input).dblclick();
    assert.equal(await total(), "9 PDF pages", "Without a preparation, addition uses the current page");
    assert.equal(await pageFocused(), true);
    await prepared.fill("1,3");
    await image(input).dblclick();
    assert.equal(await total(), "10 PDF pages", "Page adds only the inspected page while preserving the preparation");
    assert.equal(await prepared.inputValue(), "1,3");
    assert.equal(await selected.inputValue(), "1-8");
    await input.getByRole("region", { name: "PDF viewport", exact: true }).dblclick({ position: { x: 2, y: 2 } });
    assert.equal(await total(), "10 PDF pages", "Viewport gutters do not add pages");
    await zoom(input, "Zoom in");
    await ready();
    await image(input).dblclick({ position: { x: 100, y: 100 } });
    assert.equal(await total(), "11 PDF pages", "Double-click works while the enlarged page supports panning");
    assert.equal(await pageFocused(), true);
    await ready();
    await tab(output, "Page");
    await selected.fill("1,3");
    await ready();
    await image(output).dblclick();
    assert.equal(await total(), "12 PDF pages", "A selection does not block copying the inspected page");
    await image(output).dblclick();
    assert.equal(await total(), "13 PDF pages", "A second double-click creates another copy");
    await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Space");
    assert.equal(await total(), "14 PDF pages", "Space uses the same current-page operation");
    assert.equal(await selected.inputValue(), "1, 6", "Inserted copies preserve the originally selected occurrences");
    assert.equal(
      await output.locator(".page-actions button").count(),
      0,
      "Selection temporarily removes individual Page actions",
    );
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click();
    assert.equal(await total(), "16 PDF pages");
    assert.equal(await selected.inputValue(), "7-8", "The selection bar still selects the complete new group");
    assert.equal(
      await output
        .getByRole("button", { name: "Duplicate selected Output pages", exact: true })
        .evaluate((button) => button === document.activeElement),
      true,
      "Group duplication retains focus in the selection actions",
    );
    assert.match(await pagePosition(output), /1\s*\/ 16/, "Page duplication retains the inspected occurrence");
    await output.getByLabel("Output page actions", { exact: true }).click();
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click();
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    for (let index = 0; index < 16; index++)
      await output.getByRole("button", { name: "Next Output page", exact: true }).click();
    await output.locator(".blank-sheet span").dblclick();
    assert.equal(await total(), "18 PDF pages", "Blank images support the same duplication action");
    assert.equal(await selected.inputValue(), "");
    assert.equal(await pageFocused(), true);
    await output.getByRole("button", { name: "Select all", exact: true }).click();
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
    await output.getByRole("region", { name: "PDF viewport", exact: true }).dblclick();
    assert.equal(await total(), "0 PDF pages", "An empty viewport cannot add a page");
    await output.getByRole("region", { name: "PDF viewport", exact: true }).focus();
    await page.keyboard.press("v");
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      "An empty Page returns focus to its Grid tab",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "Repeated Page copies emphasize the image and status without changing focus or geometry",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      for (const [width, height, colorScheme, hasTouch, reducedMotion] of [
        [1440, 1100, "light", false, "no-preference"],
        [810, 1080, "dark", true, "no-preference"],
        [390, 844, "light", true, "reduce"],
      ]) {
        const page = await browser.newPage({
          viewport: { width, height },
          colorScheme,
          hasTouch,
          isMobile: hasTouch,
          reducedMotion,
        });
        page.setDefaultTimeout(10000);
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
        await page.goto(`${server.resolvedUrls.local[0]}?demo`);
        await page.locator(".composition-totals strong").waitFor({ state: "attached" });
        if (hasTouch)
          await page.locator(".mobile-workspace-tabs").getByRole("button", { name: "Output", exact: true }).tap();
        const pane = page.locator(".composition-output");
        await tab(pane, "Page");
        await pane.locator('.pdf-viewport[aria-busy="false"]').waitFor();
        const canvas = image(pane),
          status = page.locator(".status-messages [role=status] .status-message");
        await canvas.scrollIntoViewIfNeeded();
        const before = await canvas.boundingBox();
        let previous = [-1, -1],
          message;
        for (const count of [7, 8]) {
          if (hasTouch) {
            await canvas.tap();
            await canvas.tap();
          } else await canvas.dblclick();
          assert.equal(await pane.locator(".composition-totals strong").innerText(), `${count} PDF pages`);
          assert.equal(await pane.getByLabel("Page selection", { exact: true }).inputValue(), "");
          assert.equal(
            await pane.locator(".page-scroll").evaluate((element) => element === document.activeElement),
            true,
          );
          const after = await canvas.boundingBox();
          assert.equal(after.width, before.width);
          assert.equal(after.height, before.height);
          if (message) assert.equal(await status.textContent(), message, "Repeated reports have the same text");
          message = await status.textContent();
          const starts = await Promise.all(
            [canvas, status].map((locator) =>
              locator.evaluate((element) => element.getAnimations()[0]?.startTime ?? -1),
            ),
          );
          if (reducedMotion === "reduce") assert.deepEqual(starts, [-1, -1]);
          else {
            starts.forEach((start, index) =>
              assert.ok(start > previous[index], "Both effects restart on a repeated copy"),
            );
            assert.equal(
              await status.evaluate(
                (element) =>
                  getComputedStyle(element).backgroundColor !== getComputedStyle(element.parentElement).backgroundColor,
              ),
              true,
            );
          }
          const statusBounds = await status.boundingBox(),
            column = await page.locator(".status-messages").boundingBox();
          if (width >= 810) assert.ok(statusBounds.width < column.width - 20, "Emphasis stays around the message");
          previous = starts;
          if (count === 7) await page.waitForTimeout(400);
        }
        await Promise.all(
          [canvas, status].map((locator) =>
            locator.evaluate((element) => Promise.all(element.getAnimations().map((animation) => animation.finished))),
          ),
        );
        assert.equal(await canvas.evaluate((element) => getComputedStyle(element).filter), "none");
        assert.equal(
          await status.evaluate(
            (element) =>
              getComputedStyle(element).backgroundColor === getComputedStyle(element.parentElement).backgroundColor,
          ),
          true,
        );
        assert.equal(
          await status.evaluate(
            (element) => getComputedStyle(element).color === getComputedStyle(element.parentElement).color,
          ),
          true,
        );
        assert.equal(await status.textContent(), message, "Emphasis ends without dismissing the report");
        await page.close();
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Grid and Page switches preserve selections, zoom, and the inspected page", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "reduce",
    });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Navigation.pdf",
        mimeType: "application/pdf",
        buffer: fixture(false, false, 0, false, false, {}, 17),
      });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    const pageFocused = () => page.evaluate(() => !!document.activeElement?.matches(".page-image, .page-scroll"));
    const ctrlClick = async (thumbnail) => {
      await thumbnail.scrollIntoViewIfNeeded();
      const box = await thumbnail.boundingBox();
      const focusedBefore = await thumbnail.evaluate((element) => element === document.activeElement);
      await page.keyboard.down("Control");
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await page.mouse.down();
      assert.equal(
        await thumbnail.evaluate((element) => element === document.activeElement),
        focusedBefore,
        "Ctrl-press preserves existing focus until the view switches",
      );
      await page.mouse.up();
      await page.keyboard.up("Control");
    };
    await prepared.fill("1-17");
    await prepared.press("Enter");
    await selected.fill("2,15");
    await prepared.fill("2,4");
    await input.getByRole("slider", { name: "Input thumbnail range", exact: true }).press("End");
    const inputImage = input.getByRole("button", { name: "Select Input page 16", exact: true });
    await ctrlClick(inputImage);
    await ready();
    assert.match(await pagePosition(input), /16\s*\/ 17/);
    assert.equal(await pageFocused(), false, "Mouse view switching leaves page focus to normal navigation");
    await zoom(input, "Zoom in");
    await ready();
    await image(input).click({ modifiers: ["Control"], position: { x: 100, y: 100 } });
    assert.equal(await inputImage.isVisible(), true, "Grid returns to the inspected thumbnail batch");
    assert.equal(await pageFocused(), false);
    await inputImage.click({ modifiers: ["Meta"] });
    await ready();
    assert.match(await pagePosition(input), /16\s*\/ 17/);
    assert.equal(await input.getByLabel("Input page zoom", { exact: true }).innerText(), "150%");
    await image(input).click({ modifiers: ["Meta"], position: { x: 100, y: 100 } });
    await inputImage.focus();
    await page.keyboard.down("v");
    await input.getByRole("region", { name: "PDF viewport", exact: true }).waitFor();
    await page.keyboard.down("v");
    await page.keyboard.up("v");
    assert.equal(
      await input.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"),
      "true",
      "Held V switches once",
    );
    await page.keyboard.press("Shift+V");
    assert.equal(await inputImage.evaluate((element) => element === document.activeElement), true);
    await prepared.press("v");
    assert.equal(
      await input.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"),
      "true",
      "Typing V in a field does not switch views",
    );
    await prepared.fill("2,4");
    const outputGrip = output.getByRole("button", { name: "Select or drag Output page 15", exact: true });
    await outputGrip.tap();
    assert.equal(await selected.inputValue(), "2", "Output grips unselect on touch activation");
    await outputGrip.tap();
    assert.equal(await selected.inputValue(), "2, 15");
    const outputImage = output.getByRole("button", { name: "Select Output page 15", exact: true });
    await ctrlClick(outputImage);
    await ready();
    assert.match(await pagePosition(output), /15\s*\/ 17/);
    assert.equal(await pageFocused(), false);
    await image(output).click({ modifiers: ["Control"] });
    assert.equal(await outputImage.isVisible(), true);
    assert.equal(await pageFocused(), false);
    await outputImage.focus();
    await page.keyboard.press("v");
    await ready();
    assert.match(await pagePosition(output), /15\s*\/ 17/);
    await page.keyboard.press("v");
    assert.equal(await outputImage.evaluate((element) => element === document.activeElement), true);
    assert.equal(await prepared.inputValue(), "2,4");
    assert.equal(await selected.inputValue(), "2, 15");
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    await outputImage.click();
    await page.keyboard.press("Control+ArrowRight");
    await page.keyboard.press("Control+ArrowRight");
    assert.equal(await pageFocused(), true, "Keyboard movement retains page focus");
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    await output.getByRole("button", { name: "Remove Output page 17", exact: true }).click();
    assert.equal(await pageFocused(), true, "Mouse removal focuses a surviving thumbnail");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Bulk page actions consume preparations and preserve selected occurrences", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Bulk.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByRole("textbox", { name: "Page selection", exact: true });
    const selected = output.getByRole("textbox", { name: "Page selection", exact: true });
    const inputOptions = input.getByLabel("Input page actions", { exact: true });
    const outputOptions = output.getByLabel("Output page actions", { exact: true });
    const inputRepeat = input.getByRole("textbox", { name: "Repetitions", exact: true });
    const outputRepeat = output.getByRole("textbox", { name: "Repeat selected sequence", exact: true });
    const inputFront = input.getByLabel("Start each repeat on front", { exact: true });
    const outputFront = output.getByLabel("Start each repeat on front", { exact: true });
    const order = () => output.locator(".page-origin-info .page-context").allTextContents();
    const total = () => output.locator(".composition-totals strong").innerText();
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click();
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input
      .getByRole("button", { name: "Select or drag Input page 4 to Output", exact: true })
      .click({ modifiers: ["Shift"] });
    assert.equal(await prepared.inputValue(), "4", "Addition consumes the preparation and resets its anchor");
    await input.getByRole("button", { name: "Select Input page 7", exact: true }).dblclick();
    assert.equal(await prepared.inputValue(), "");
    await input
      .getByRole("button", { name: "Select or drag Input page 6 to Output", exact: true })
      .click({ modifiers: ["Shift"] });
    assert.equal(await prepared.inputValue(), "6", "Double-click consumption resets the range anchor");
    await selected.fill("1-2");
    await selected.press("Enter");
    await prepared.fill("2,4");
    await inputOptions.click();
    await inputRepeat.fill("2");
    await inputFront.check();
    await prepared.press("Enter");
    assert.deepEqual(await order(), ["p. 2", "p. 4", "p. 2", "p. 4"]);
    assert.equal(await selected.inputValue(), "1-4");
    assert.equal(await prepared.inputValue(), "");
    await inputOptions.click();
    assert.equal(await inputRepeat.inputValue(), "1");
    assert.equal(await inputFront.isChecked(), false);
    await inputRepeat.fill("2");
    await prepared.fill("1,3,1");
    await input
      .getByRole("button", { name: "Select or drag Input page 6 to Output", exact: true })
      .dragTo(output.locator(".section-heading"));
    assert.equal(await prepared.inputValue(), "1,3,1");
    assert.equal(await selected.inputValue(), "5");
    await input
      .getByRole("button", { name: "Select or drag Input page 7 to Output", exact: true })
      .dragTo(output.locator(".section-heading"));
    assert.equal(await total(), "6 PDF pages");
    assert.equal(await prepared.inputValue(), "1,3,1");
    const data = await page.evaluateHandle(() => new DataTransfer());
    const grip = input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true });
    await grip.dispatchEvent("dragstart", { dataTransfer: data });
    await page.keyboard.press("Escape");
    assert.equal(await prepared.inputValue(), "1,3,1");
    assert.equal(await total(), "6 PDF pages");
    await grip.dragTo(output.getByRole("button", { name: "Select Output page 2", exact: true }), {
      targetPosition: { x: 5, y: 40 },
    });
    assert.deepEqual(await order(), [
      "p. 2",
      "p. 1",
      "p. 3",
      "p. 1",
      "p. 1",
      "p. 3",
      "p. 1",
      "p. 4",
      "p. 2",
      "p. 4",
      "p. 6",
      "p. 7",
    ]);
    assert.equal(await selected.inputValue(), "2-7");
    assert.equal(await prepared.inputValue(), "");
    await prepared.fill("1-7,1-4");
    await inputOptions.click();
    await inputRepeat.fill("1000");
    await inputFront.check();
    await prepared.press("Enter");
    assert.equal(await total(), "12 PDF pages");
    assert.equal(await prepared.inputValue(), "1-7,1-4");
    assert.equal(await inputRepeat.inputValue(), "1000");
    assert.equal(await inputFront.isChecked(), true);
    await input.getByRole("button", { name: "Clear page sequence", exact: true }).click();
    await inputOptions.click();
    assert.equal(await inputRepeat.inputValue(), "1");
    assert.equal(await inputFront.isChecked(), false);
    await selected.fill("1-12");
    await selected.press("Enter");
    assert.equal(await total(), "0 PDF pages");
    await prepared.fill("1-5");
    await prepared.press("Enter");
    await selected.fill("2,2,4");
    assert.equal(await output.locator(".composition-card.selected").count(), 2);
    await outputOptions.click();
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 0);
    await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).press("Enter");
    assert.equal(await outputOptions.evaluate((element) => element === document.activeElement), true);
    assert.deepEqual(await order(), ["p. 2", "p. 1", "p. 4", "p. 3", "p. 5"]);
    assert.equal(await selected.inputValue(), "1, 3");
    await outputOptions.click();
    assert.equal(await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).count(), 0);
    await output.getByRole("button", { name: "Move selected pages later", exact: true }).click();
    assert.deepEqual(await order(), ["p. 1", "p. 2", "p. 3", "p. 4", "p. 5"]);
    assert.equal(await selected.inputValue(), "2, 4");
    await ready();
    await output
      .getByRole("button", { name: "Select or drag Output page 4", exact: true })
      .dragTo(output.locator(".section-heading"));
    assert.deepEqual(await order(), ["p. 1", "p. 3", "p. 5", "p. 2", "p. 4"]);
    assert.equal(await selected.inputValue(), "4-5");
    await tab(output, "Page");
    assert.match(await pagePosition(output), /5\s*\/ 5/);
    await tab(output, "Grid");
    const moved = output.getByRole("button", { name: "Select or drag Output page 4", exact: true });
    await moved.dispatchEvent("dragstart", { dataTransfer: data });
    await output.locator(".composition-card").nth(4).dispatchEvent("dragover", { dataTransfer: data });
    await output.locator(".composition-card").nth(4).dispatchEvent("drop", { dataTransfer: data });
    assert.deepEqual(await order(), ["p. 1", "p. 3", "p. 5", "p. 2", "p. 4"]);
    assert.equal(await selected.inputValue(), "4-5");
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click();
    assert.equal(await selected.inputValue(), "6-7");
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
    assert.equal(await selected.inputValue(), "", "Group removal clears its targets");
    assert.equal(await selected.evaluate((element) => element === document.activeElement), true);
    await output.getByRole("button", { name: "Remove Output page 4", exact: true }).click();
    assert.equal(await selected.inputValue(), "");
    await selected.fill("2-3");
    await outputOptions.click();
    await outputRepeat.fill("3");
    await outputFront.check();
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click();
    assert.equal(await total(), "9 PDF pages");
    assert.equal(await selected.inputValue(), "7-8");
    await outputOptions.click();
    assert.equal(await outputRepeat.inputValue(), "2");
    assert.equal(await outputFront.isChecked(), false);
    await output.getByRole("button", { name: "Repeat selected pages", exact: true }).click();
    assert.equal(await total(), "11 PDF pages");
    assert.equal(await selected.inputValue(), "9-10");
    await selected.fill("99");
    assert.equal(await selected.getAttribute("aria-invalid"), "true");
    assert.equal(
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).isDisabled(),
      true,
    );
    await selected.press("Enter");
    assert.equal(await total(), "11 PDF pages");
    await selected.fill("9-11");
    await outputOptions.click();
    await outputRepeat.fill("4");
    await output.getByRole("button", { name: "Reset Output repetitions", exact: true }).click();
    assert.equal(await outputRepeat.inputValue(), "2");
    await outputRepeat.fill("3");
    await outputFront.check();
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    assert.equal(await selected.inputValue(), "");
    await selected.fill("9-11");
    await outputOptions.click();
    assert.equal(await outputRepeat.inputValue(), "2");
    assert.equal(await outputFront.isChecked(), false);
    await output.getByRole("button", { name: "Blank before first selected page", exact: true }).click();
    assert.equal(await selected.inputValue(), "9");
    await outputOptions.click();
    await output.getByRole("button", { name: "Add blank page at end", exact: true }).click();
    assert.equal(await selected.inputValue(), "13");
    await selected.fill("1-13");
    await selected.press("Enter");
    assert.equal(await total(), "0 PDF pages");
    assert.equal(await selected.inputValue(), "");
    await prepared.fill("3,1,3");
    await inputOptions.click();
    await inputRepeat.fill("2");
    await inputFront.check();
    await page.keyboard.press("Escape");
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Bulk.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    });
    await page.waitForFunction(() => document.querySelector(".input-heading .count")?.textContent === "2");
    assert.equal(await prepared.inputValue(), "", "Reopening a PDF starts an independent preparation");
    await inputOptions.click();
    assert.equal(await inputRepeat.inputValue(), "1");
    assert.equal(await inputFront.isChecked(), false);
    await page.keyboard.press("Escape");
    await prepared.fill("1,2");
    await page.locator(".input-picker > summary").click();
    await page.locator(".input-list button[data-source]").first().click();
    assert.equal(await prepared.inputValue(), "3,1,3", "Reopened PDFs keep independent ordered preparations");
    assert.equal(await input.locator(".composition-card.selected").count(), 2);
    assert.equal(await total(), "0 PDF pages");
    await data.dispose();
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Grid images and grips share selection and ordinary page focus", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19");
      localStorage.setItem("mainz:theme", "light");
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Ranges.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    });
    const input = page.locator(".selection-panel");
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    for (const theme of ["light", "dark"]) {
      if (theme === "dark") await page.getByRole("button", { name: "Toggle theme", exact: true }).click();
      for (const reducedMotion of ["reduce", "no-preference"]) {
        await page.emulateMedia({ reducedMotion });
        for (const [pane, clear] of [
          [input, "Clear page sequence"],
          [page.locator(".composition-output"), "Clear Output selection"],
        ]) {
          const reset = pane.getByRole("button", { name: clear, exact: true });
          if (await reset.count()) await reset.click();
          const selection = pane.getByRole("textbox", { name: "Page selection", exact: true });
          const cards = pane.locator(".composition-card");
          const frame = await cards.first().boundingBox();
          const colors = () =>
            cards.evaluateAll((items) => items.map((item) => getComputedStyle(item).backgroundColor));
          await selection.fill("1-3");
          const original = await colors();
          await selection.fill("");
          await cards.first().locator(".page-image").click();
          assert.equal(await selection.inputValue(), "1", "Image clicks select the page");
          assert.equal(await cards.first().evaluate((item) => getComputedStyle(item).outlineStyle), "none");
          const grip = await cards.first().locator(".page-grip").boundingBox();
          await page.mouse.click(grip.x - 10, grip.y + grip.height / 2);
          assert.equal(await selection.inputValue(), "", "The extended grip area toggles its page's selection");
          assert.equal(await cards.first().evaluate((item) => getComputedStyle(item).outlineStyle), "none");
          await cards.first().locator(".page-grip").click();
          assert.equal(await selection.inputValue(), "1", "Clicking the grip selects its page");
          assert.equal(
            await cards
              .first()
              .locator(".page-image")
              .evaluate((item) => item === document.activeElement),
            true,
            "Grip activation keeps ordinary page focus",
          );
          await cards.first().locator(".page-grip").click();
          assert.equal(await selection.inputValue(), "");
          assert.equal(
            await cards
              .first()
              .locator(".page-image")
              .evaluate((item) => item === document.activeElement),
            true,
            "Grip activation keeps the page ready for keyboard use",
          );
          await cards.first().locator(".page-grip").click();
          await cards
            .nth(2)
            .locator(".page-grip")
            .click({ modifiers: ["Shift"] });
          assert.equal(await selection.inputValue(), "1-3");
          const selectedFrame = await cards.first().boundingBox();
          assert.ok(Math.abs(selectedFrame.width - frame.width) < 0.1);
          assert.ok(Math.abs(selectedFrame.height - frame.height) < 0.1);
          assert.equal(
            await cards.first().evaluate((item) => {
              const card = item.getBoundingClientRect();
              const thumbnail = item.querySelector(".thumbnail").getBoundingClientRect();
              return thumbnail.left >= card.left + 1.9 && thumbnail.right <= card.right - 1.9;
            }),
            true,
            "The thumbnail stays inside the complete selection border",
          );
          const highlighted = await colors();
          assert.ok(highlighted.slice(0, 3).every((color, index) => color !== original[index]));
          assert.deepEqual(highlighted.slice(3), original.slice(3), "Only the chosen range gets a temporary tint");
          assert.equal(await cards.nth(2).evaluate((item) => getComputedStyle(item).outlineStyle), "none");
          await page.keyboard.down("Shift");
          assert.equal(
            await cards
              .nth(2)
              .locator(".page-grip")
              .evaluate((item) => {
                const style = getComputedStyle(item);
                return style.outlineStyle === "none" || style.outlineColor === "rgba(0, 0, 0, 0)";
              }),
            true,
            "Shift does not draw a box around the grip",
          );
          await page.keyboard.up("Shift");
          await page.waitForFunction(
            ({ selector, expected }) =>
              Array.from(document.querySelectorAll(selector)).every(
                (item, index) => getComputedStyle(item).backgroundColor === expected[index],
              ),
            {
              selector: pane === input ? ".source-catalog .composition-card" : ".output-pages .composition-card",
              expected: original,
            },
          );
          assert.equal(await selection.inputValue(), "1-3", "The range stays selected after its highlight ends");
          await cards.first().locator(".page-image").click();
          assert.equal(await selection.inputValue(), "2-3");
          assert.equal(
            await cards
              .first()
              .locator(".page-image")
              .evaluate((item) => item === document.activeElement),
            true,
            "Image selection makes that page current",
          );
          await page.keyboard.press("Space");
          assert.equal(
            await selection.inputValue(),
            pane === input ? "2-3, 1" : "1-3",
            "Space toggles the page last clicked with the mouse",
          );
          await cards
            .nth(4)
            .locator(".page-image")
            .click({ modifiers: ["Shift"] });
          assert.equal(
            await selection.inputValue(),
            pane === input ? "2-3, 1, 4-5" : "1-5",
            "Shift-clicking keeps Input order and extends the range",
          );
        }
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Dragging opens stable page slots, previews density, and commits only on drop", { timeout: 90000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const sizes = new Map();
    for (const density of ["Normal", "Compact"]) {
      for (const reducedMotion of ["no-preference", "reduce"]) {
        const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion });
        const errors = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.emulateMedia({ colorScheme: reducedMotion === "reduce" ? "dark" : "light" });
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
        await page.goto(server.resolvedUrls.local[0]);
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "Dragging.pdf",
            mimeType: "application/pdf",
            buffer: fixture(true, false, 0, true, true),
          });
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output");
        await input.getByLabel("Page selection", { exact: true }).fill("1-7");
        await input.getByRole("button", { name: "Add to Output", exact: true }).click();
        await output.locator(".composition-card").nth(6).waitFor();
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
        if (density === "Compact") {
          await input.getByRole("button", { name: "Compact Input grid", exact: true }).click();
          await output.getByRole("button", { name: "Compact Output grid", exact: true }).click();
        }
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        );
        const cards = output.locator(".composition-card");
        const ids = () => cards.evaluateAll((items) => items.map((item) => item.id));
        const settle = () =>
          page.waitForFunction(() =>
            [...document.querySelectorAll(".composer .composition-card")].every((item) => !item.getAnimations().length),
          );
        const transfer = await page.evaluateHandle(() => {
          const data = new DataTransfer();
          const setImage = data.setDragImage.bind(data);
          data.setDragImage = (canvas, x, y) => {
            data.image = canvas;
            setImage(canvas, x, y);
          };
          return data;
        });
        const source = input.getByRole("button", { name: "Select Input page 1", exact: true });
        const before = await ids();
        const bounds = await cards.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()));
        const target = cards.nth(3);
        const point = { clientX: bounds[3].left + bounds[3].width / 4, clientY: bounds[3].top + bounds[3].height / 2 };
        await source.dispatchEvent("dragstart", { dataTransfer: transfer });
        const raster = await transfer.evaluate((data) => {
          const canvas = data.image,
            context = canvas.getContext("2d");
          const edge = (fraction) => {
            const pixels = context.getImageData(0, Math.floor(canvas.height * fraction), canvas.width, 1).data;
            return Array.from({ length: canvas.width }, (_, x) => x).find((x) => pixels[x * 4 + 3] > 128);
          };
          return {
            width: canvas.width,
            height: canvas.height,
            top: edge(0.25),
            bottom: edge(0.75),
            color: Array.from(
              context.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.7), 1, 1).data,
            ),
          };
        });
        assert.ok(raster.width <= (density === "Compact" ? 84 : 120));
        assert.ok(raster.height <= (density === "Compact" ? 116 : 160));
        assert.ok(raster.color[0] < 64, "The visible page supplies the preview, including in Compact");
        assert.ok(raster.color[3] > 150);
        if (reducedMotion === "reduce")
          assert.equal(raster.top, raster.bottom, "Reduced motion keeps the sheet straight");
        else assert.ok(raster.bottom > raster.top, "The carried page has a slight tilt");
        if (density === "Normal") sizes.set(reducedMotion, raster.width * raster.height);
        else assert.ok(raster.width * raster.height < sizes.get(reducedMotion) * 0.75);
        await target.dispatchEvent("dragover", { dataTransfer: transfer, ...point });
        const hole = output.locator(".drop-placeholder");
        await hole.waitFor();
        await settle();
        const slot = await hole.boundingBox(),
          shifted = await target.boundingBox();
        assert.ok(Math.abs(slot.x - bounds[3].x) < 1 && Math.abs(slot.y - bounds[3].y) < 1);
        assert.ok(
          Math.abs(shifted.x - bounds[4].x) < 1 && Math.abs(shifted.y - bounds[4].y) < 1,
          "The target moves into its neighbor's old slot",
        );
        const ghost = await hole.locator("canvas").evaluate((canvas) => ({
          opacity: Number(getComputedStyle(canvas).opacity),
          color: Array.from(
            canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height * 0.7), 1, 1)
              .data,
          ),
        }));
        assert.ok(ghost.opacity > 0 && ghost.opacity < 0.5, "The destination shows a faint copy of the page");
        assert.deepEqual(ghost.color, [0, 0, 0, 255], "The destination keeps the dragged page's content");
        const grid = output.locator(".output-pages");
        for (let step = 0; step < 3; step++)
          await grid.dispatchEvent("dragover", {
            dataTransfer: transfer,
            clientX: slot.x + slot.width / 2,
            clientY: slot.y + slot.height / 2,
          });
        assert.deepEqual(await hole.boundingBox(), slot, "Holding over the open slot does not move it");
        assert.deepEqual(await ids(), before, "Hovering leaves document order unchanged");
        await page.keyboard.press("Escape");
        await settle();
        assert.equal(await hole.count(), 0);
        assert.deepEqual(await ids(), before);
        assert.equal(await output.locator("[data-preview-hidden]").count(), 0);
        await source.dispatchEvent("dragstart", { dataTransfer: transfer });
        await target.dispatchEvent("dragover", { dataTransfer: transfer, ...point });
        await grid.dispatchEvent("drop", { dataTransfer: transfer });
        await cards.nth(7).waitFor();
        const copied = await ids();
        assert.deepEqual(copied.slice(0, 3), before.slice(0, 3));
        assert.deepEqual(copied.slice(4), before.slice(3));
        await output.getByLabel("Page selection", { exact: true }).fill("1,4");
        await settle();
        const groupTarget = cards.nth(6),
          destination = await groupTarget.boundingBox();
        await cards.nth(0).locator(".page-grip").dispatchEvent("dragstart", { dataTransfer: transfer });
        await groupTarget.dispatchEvent("dragover", {
          dataTransfer: transfer,
          clientX: destination.x + destination.width * 0.75,
          clientY: destination.y + destination.height / 2,
        });
        await hole.waitFor();
        assert.equal(await output.locator("[data-preview-hidden]").count(), 2, "Moving pages vacate their old slots");
        await grid.dispatchEvent("drop", { dataTransfer: transfer });
        assert.deepEqual(await ids(), [
          copied[1],
          copied[2],
          copied[4],
          copied[5],
          copied[6],
          copied[0],
          copied[3],
          copied[7],
        ]);
        await output.getByLabel("Page selection", { exact: true }).fill("1-8");
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
        await page.waitForFunction(() => !document.querySelector(".composition-output .composition-card"));
        await source.dispatchEvent("dragstart", { dataTransfer: transfer });
        await output.dispatchEvent("dragover", { dataTransfer: transfer });
        await output.locator(".composition-empty .drop-placeholder").waitFor();
        await output.dispatchEvent("drop", { dataTransfer: transfer });
        assert.equal(await output.locator(".composition-totals strong").innerText(), "1 PDF page");
        assert.equal(await page.locator(".drag-image").count(), 0);
        assert.deepEqual(errors, []);
        await transfer.dispose();
        await page.close();
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Dragging page images and grips preserves selection and page focus", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Gestures.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    await prepared.fill("1-7");
    await prepared.press("Enter");
    await prepared.fill("1,3,3");
    await selected.fill("1,3");
    for (const pane of [input, output]) {
      const target = pane.locator(".composition-card").nth(1).locator(".page-image");
      for (const [selector, modified] of [
        [".page-image", false],
        [".page-grip", false],
        [".page-grip", true],
      ]) {
        const control = pane.locator(".composition-card").nth(2).locator(selector);
        await control.scrollIntoViewIfNeeded();
        await target.focus();
        const bounds = await control.boundingBox();
        const x = bounds.x + bounds.width / 2,
          y = bounds.y + bounds.height / 2;
        if (modified) await page.keyboard.down("Control");
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label")?.endsWith("page 2"));
        assert.equal(await target.evaluate((element) => element === document.activeElement), true);
        await page.mouse.move(x + 40, y + 40, { steps: 5 });
        await page.waitForFunction(() => !!document.querySelector(".composer")?.getAttribute("data-drag"));
        assert.equal(await prepared.inputValue(), "1,3,3");
        assert.equal(await selected.inputValue(), "1,3");
        assert.equal(
          await target.evaluate((element) => element === document.activeElement),
          true,
          "Starting a native drag preserves existing page focus",
        );
        await page.keyboard.press("Escape");
        await page.mouse.up();
        if (modified) await page.keyboard.up("Control");
        assert.equal(await prepared.inputValue(), "1,3,3");
        assert.equal(await selected.inputValue(), "1,3");
        assert.equal(await target.evaluate((element) => element === document.activeElement), true);
        assert.equal(await output.locator(".composition-totals strong").innerText(), "7 PDF pages");
      }
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Shortcut help follows the visible views, preserves focus, and starts the tour", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Shortcuts.pdf", mimeType: "application/pdf", buffer: fixture() });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true });
    await selection.fill("1,2");
    await selection.press("Enter");
    const help = page.getByRole("button", { name: "Help", exact: true });
    const helpDialog = page.getByRole("dialog", { name: "Help", exact: true });
    const tour = page.getByRole("dialog", { name: "Product tour", exact: true });
    await selection.press("?");
    assert.equal(await helpDialog.isVisible(), false, "Typing a question mark keeps help closed");
    assert.equal(await selection.inputValue(), "?");
    await selection.fill("");
    for (const [inputMode, outputMode] of [
      ["Grid", "Grid"],
      ["Page", "Grid"],
      ["Grid", "Page"],
      ["Page", "Page"],
      ["Style", "Page"],
    ]) {
      await tab(input, inputMode);
      await tab(output, outputMode);
      await help.click();
      const keyboardTopic = helpDialog.getByRole("tab", { name: "Keyboard", exact: true });
      await keyboardTopic.press("Control+ArrowRight");
      assert.equal(await keyboardTopic.getAttribute("aria-selected"), "true", "Modified arrows retain the Help topic");
      assert.equal(
        await helpDialog.getByRole("heading", { name: `Input ${inputMode}`, exact: true }).isVisible(),
        true,
      );
      assert.equal(
        await helpDialog.getByRole("heading", { name: `Output ${outputMode}`, exact: true }).isVisible(),
        true,
      );
      const inputHelp = helpDialog.getByRole("region", { name: `Input ${inputMode.toLowerCase()}`, exact: true });
      const outputHelp = helpDialog.getByRole("region", { name: `Output ${outputMode.toLowerCase()}`, exact: true });
      const shared = helpDialog.getByRole("region", { name: "Workspace shortcuts", exact: true });
      assert.ok(await shared.getByRole("heading", { name: "Workspace", exact: true }).isVisible());
      const hierarchy = await helpDialog.evaluate((element) => {
        const pane = element.querySelector(".shortcut-views section");
        const workspace = element.querySelector('[aria-label="Workspace shortcuts"]');
        return [
          pane.querySelector("h3").getBoundingClientRect().left,
          workspace.querySelector("h3").getBoundingClientRect().left,
          getComputedStyle(pane.querySelector("h3")).color,
          getComputedStyle(workspace.querySelector("h3")).color,
          getComputedStyle(element.querySelector('.shortcut-views section[aria-label^="Output"] h4')).color,
        ];
      });
      assert.ok(Math.abs(hierarchy[0] - hierarchy[1]) < 1, "Pane and Workspace headings share the outer alignment");
      assert.equal(hierarchy[2], hierarchy[3], "Top section headings share their secondary color");
      assert.notEqual(hierarchy[2], hierarchy[4], "Nested headings use a distinct text color");
      for (const [mode, pane] of [
        [inputMode, inputHelp],
        [outputMode, outputHelp],
      ])
        if (mode === "Grid") {
          assert.match(await pane.innerText(), /←\s+\/\s+→\s+Start navigation \(no selection\)/);
          assert.match(await pane.innerText(), /PgUp\s+\/\s+PgDn\s+Previous \/ next thumbnail group/);
        } else if (mode === "Page") {
          assert.match(await pane.innerText(), /0\s+or\s+Z\s+Fit page \(100%\)/);
          assert.match(await pane.innerText(), /PgUp\s+\/\s+PgDn\s+Show previous \/ next page/);
          assert.match(await pane.innerText(), /Home\s+\/\s+End\s+Show first \/ last page/);
          assert.match(await pane.innerText(), /G\s+Go to page/);
        }
      assert.deepEqual(await helpDialog.getByRole("heading", { level: 2 }).allTextContents(), ["Help"]);
      if (inputMode !== "Style") {
        assert.equal(await inputHelp.getByRole("heading", { name: "Selection Field", exact: true }).isVisible(), true);
        const inputField = await inputHelp.getByRole("heading", { name: "Selection Field", exact: true }).boundingBox();
        const outputField = await outputHelp
          .getByRole("heading", { name: "Selection Field", exact: true })
          .boundingBox();
        assert.ok(
          Math.abs(inputField.y - outputField.y) < 1,
          "Selection Field headings share one row across visible views",
        );
        assert.match(
          await inputHelp.locator(".shortcut-list").last().innerText(),
          /Enter\s+Add prepared pages to Output/,
        );
      }
      assert.equal(await outputHelp.getByRole("heading", { name: "Selection Field", exact: true }).isVisible(), true);
      assert.match(
        await outputHelp.locator(".shortcut-list").last().innerText(),
        /Enter\s+Remove selected Output pages/,
      );
      assert.match(
        await inputHelp.innerText(),
        inputMode === "Style"
          ? /move between Style controls/
          : inputMode === "Grid"
            ? /Select or unselect page/
            : /Add the current page to Output/,
      );
      assert.match(await outputHelp.innerText(), outputMode === "Grid" ? /Remove page/ : /Zoom in \/ out/);
      if (inputMode === "Grid")
        assert.match(await inputHelp.innerText(), /Shift\s+\+\s+←\s+\/\s+→\s+Select \/ unselect pages/);
      if (outputMode === "Grid") {
        assert.match(await outputHelp.innerText(), /Shift\s+\+\s+←\s+\/\s+→\s+Select \/ unselect pages/);
        assert.match(await outputHelp.innerText(), /Del\s+\/\s+−\s+Remove page/);
      }
      assert.ok(
        await helpDialog
          .getByRole("tabpanel", { name: "Keyboard", exact: true })
          .locator(".shortcut-list dd")
          .evaluateAll((items) =>
            items.every(
              (item) =>
                Math.abs(item.getBoundingClientRect().height - parseFloat(getComputedStyle(item).lineHeight)) < 1,
            ),
          ),
        "Desktop shortcut descriptions fit one line",
      );
      const dimensions = await helpDialog.boundingBox();
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).click();
      assert.deepEqual(await helpDialog.boundingBox(), dimensions, "Help retains its largest tab's dimensions");
      const mouseHelp = helpDialog.getByRole("tabpanel", { name: "Mouse", exact: true });
      assert.equal(await mouseHelp.isVisible(), true);
      assert.match(await mouseHelp.innerText(), /Switch the current page between Grid and Page/);
      assert.match(await mouseHelp.innerText(), /Select or unselect a page/);
      assert.match(await mouseHelp.innerText(), /Click a Page counter\s+Enter a page number/);
      await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).press("Home");
      assert.equal(
        await helpDialog.getByRole("tab", { name: "Keyboard", exact: true }).getAttribute("aria-selected"),
        "true",
      );
      await page.keyboard.press("ArrowRight");
      assert.equal(
        await helpDialog.getByRole("tab", { name: "Mouse", exact: true }).getAttribute("aria-selected"),
        "true",
      );
      assert.equal(await output.locator(".composition-totals strong").innerText(), "2 PDF pages");
      await page.keyboard.press("Escape");
      await helpDialog.waitFor({ state: "hidden" });
      assert.equal(await help.evaluate((item) => item === document.activeElement), true);
      await page.keyboard.press("?");
      await helpDialog.waitFor();
      for (const [mode, pane] of [
        [inputMode, inputHelp],
        [outputMode, outputHelp],
      ]) {
        assert.equal(await pane.isVisible(), true, "Both panes remain visible when Help reopens with ?");
        if (mode !== "Style") assert.equal(await pane.locator(".shortcut-list dd").first().isVisible(), true);
      }
      await page.keyboard.press("Escape");
    }
    await tab(input, "Grid");
    await tab(output, "Grid");
    for (const [width, height, theme, font] of [
      [2560, 1440, "dark", ""],
      [1920, 1080, "light", ""],
      [1440, 900, "dark", ""],
      [1440, 900, "light", "DejaVu Sans"],
      [1440, 900, "dark", "DejaVu Sans"],
      [1920, 900, "dark", "DejaVu Sans"],
      [2560, 900, "light", "DejaVu Sans"],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(
        ({ theme: scheme, font: family }) => {
          document.documentElement.dataset.theme = scheme;
          document.body.style.fontFamily = family;
        },
        { theme, font },
      );
      await help.click();
      for (const topic of ["Keyboard", "Mouse"]) {
        await helpDialog.getByRole("tab", { name: topic, exact: true }).click();
        const dimensions = await helpDialog.evaluate((dialog) =>
          [dialog, ...dialog.querySelectorAll(".help-panels > [role=tabpanel]")].map((element) => ({
            name: element.className || element.getAttribute("aria-labelledby"),
            width: element.clientWidth,
            height: element.clientHeight,
            scrollWidth: element.scrollWidth,
            scrollHeight: element.scrollHeight,
          })),
        );
        assert.ok(
          dimensions.every((size) => size.scrollHeight <= size.height + 1 && size.scrollWidth <= size.width + 1),
          `${topic} Help fits ${width}×${height} with ${font || "the system font"} without scrolling: ${JSON.stringify(dimensions)}`,
        );
      }
      await page.keyboard.press("Escape");
    }
    await page.evaluate(() => document.body.style.removeProperty("font-family"));
    await page.setViewportSize({ width: 1440, height: 1100 });
    await input.getByRole("button", { name: "Select or drag Input page 2 to Output", exact: true }).click();
    await page.keyboard.press("Space");
    await page.waitForFunction(() => document.activeElement?.matches(".page-image[aria-pressed=false]"));
    const helpCursor = await page.evaluate(() => document.activeElement.getAttribute("aria-label"));
    await page.keyboard.press("?");
    await helpDialog.waitFor();
    await page.keyboard.press("Escape");
    await page.waitForFunction((name) => document.activeElement?.getAttribute("aria-label") === name, helpCursor);
    await help.click();
    await helpDialog.getByRole("button", { name: "Start Tour", exact: true }).click();
    await tour.waitFor();
    assert.equal(await helpDialog.isVisible(), false);
    await tour.getByRole("button", { name: "Next", exact: true }).click();
    assert.match(await tour.innerText(), /Select pages using images, grips, or the page field/);
    assert.match(await tour.innerText(), /Borders and the page field show the same selection/);
    assert.match(await tour.innerText(), /clears the preparation/);
    assert.match(await tour.innerText(), /Without a selection, a card’s \+ adds one copy/);
    await tour.getByRole("button", { name: "End tour", exact: true }).click();
    assert.equal(await help.evaluate((item) => item === document.activeElement), true);
    assert.equal(await selection.inputValue(), "");
    assert.equal(await output.locator(".composition-totals strong").innerText(), "2 PDF pages");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Grid selection keeps painted pages in place", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, theme, textSize] of [
      [2560, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" });
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:onboarding", "19");
        localStorage.setItem("mainz:theme", choice);
      }, theme);
      await page.goto(server.resolvedUrls.local[0]);
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize);
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Selections.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      });
      const prepared = page.locator(".selection-panel").getByLabel("Page selection", { exact: true });
      await prepared.fill("1-7");
      await prepared.press("Enter");
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
            .click();
        const pane = page.locator(name === "Input" ? ".selection-panel" : ".composition-output");
        const field = pane.getByLabel("Page selection", { exact: true });
        await field.fill("");
        await page.waitForFunction(
          (selector) => {
            const panel = document.querySelector(selector);
            const canvases = [...panel.querySelectorAll(".composition-card canvas")];
            return (
              canvases.length === 7 &&
              canvases.every((canvas) => canvas.width && canvas.height) &&
              !panel.querySelector("[aria-busy=true]")
            );
          },
          name === "Input" ? ".selection-panel" : ".composition-output",
        );
        const painted = () =>
          pane.locator(".composition-card canvas").evaluateAll((canvases) =>
            canvases.map((canvas) => {
              const card = canvas.closest(".composition-card").getBoundingClientRect();
              const rectangle = canvas.getBoundingClientRect();
              return {
                x: rectangle.x - card.x,
                y: rectangle.y - card.y,
                width: rectangle.width,
                height: rectangle.height,
                pixels: canvas.toDataURL(),
              };
            }),
          );
        const footers = pane.locator(".composition-card > .input-footer, .composition-card > .occurrence-actions");
        const footerLines = async () => {
          assert.equal(await footers.count(), 7, `${name}: every card retains its footer`);
          assert.equal(
            await footers.evaluateAll((elements) =>
              elements.every((element) => {
                const style = getComputedStyle(element);
                return parseFloat(style.borderBlockStartWidth) > 0 && element.getBoundingClientRect().height > 0;
              }),
            ),
            true,
            `${name}: footer lines and space remain available`,
          );
        };
        const before = await painted();
        await footerLines();
        await pane.evaluate((element) => {
          element.dataset.loading = "false";
          const observer = new MutationObserver((mutations) => {
            if (
              mutations.some((mutation) =>
                [...mutation.addedNodes].some(
                  (node) =>
                    node instanceof Element && (node.matches(".render-status") || node.querySelector(".render-status")),
                ),
              )
            )
              element.dataset.loading = "true";
          });
          observer.observe(element, { childList: true, subtree: true });
        });
        for (const number of [1, 7]) {
          await pane.getByRole("button", { name: `Select ${name} page ${number}`, exact: true }).click();
          await page.waitForFunction(
            () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
          );
          const after = await painted();
          await footerLines();
          for (const [index, actual] of after.entries()) {
            const { pixels, ...bounds } = actual;
            const { pixels: original, ...expected } = before[index];
            assert.deepEqual(bounds, expected, `${name} page ${index + 1} keeps its position and size`);
            assert.ok(pixels === original, `${name} page ${index + 1} keeps its painted content`);
          }
        }
        await field.fill("");
        await page.waitForFunction(
          () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
        );
        assert.deepEqual(await painted(), before, `${name} restores controls without moving or repainting pages`);
        await footerLines();
        assert.equal(await pane.getAttribute("data-loading"), "false", "Selection does not flash a loading indicator");
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Unused and modified Grid keys preserve pointer controls and native shortcut priority", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    );
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    await prepared.fill("");
    for (const [name, pane] of [
      ["Input", input],
      ["Output", output],
    ]) {
      const thumbnail = pane.getByRole("button", { name: `Select ${name} page 1`, exact: true });
      await thumbnail.click();
      await thumbnail.click();
      for (const key of ["Control", "Alt", "Meta", "CapsLock", "x", "Shift"]) {
        await page.keyboard.press(key);
        assert.equal(await thumbnail.evaluate((element) => element === document.activeElement), true);
        assert.equal(await thumbnail.evaluate(hasCursor), false, `${name}: ${key} does not create a page cursor`);
        assert.equal(
          await pane
            .getByRole("button", {
              name: name === "Input" ? "Add Input page 1 to Output" : "Duplicate Output page 1",
              exact: true,
            })
            .isVisible(),
          true,
        );
      }
      await thumbnail.dispatchEvent("keydown", { key: "Dead" });
      await thumbnail.dispatchEvent("keydown", { key: "ArrowRight", isComposing: true });
      for (const key of ["Control+Space", "Control+Enter", "Alt+Space", "Shift+Space", "Shift+Enter"]) {
        await page.keyboard.press(key);
        assert.equal(await pane.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true");
        assert.equal(await thumbnail.evaluate((element) => element === document.activeElement), true);
        assert.equal(await (name === "Input" ? prepared : selected).inputValue(), "");
      }
      await thumbnail.press("ArrowRight");
      await page.keyboard.press("ArrowLeft");
      await page.waitForFunction(() => document.activeElement?.matches(".composition-grid"));
      const scroll = await page.evaluate(() => scrollY);
      await page.keyboard.press("Space");
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      assert.equal(
        await page.evaluate(() => scrollY),
        scroll,
        "Space at a Grid boundary does not scroll the workspace",
      );
      assert.equal(await (name === "Input" ? prepared : selected).inputValue(), "");
    }
    await selected.fill("2");
    for (const pane of [input, output]) {
      await pane.getByRole("tab", { name: "Grid", exact: true }).focus();
      await page.keyboard.press("Control+ArrowLeft");
      assert.equal(await selected.inputValue(), "1", "Ctrl+arrows move Output while focus is on a view tab");
      assert.equal(await pane.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true");
      await page.keyboard.press("Control+ArrowRight");
      assert.equal(await selected.inputValue(), "2");
    }
    await tab(output, "Page");
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).focus();
    for (const key of ["+", "=", "-"]) {
      await page.keyboard.press(key);
      assert.equal(
        await output.getByLabel("Output page zoom", { exact: true }).innerText(),
        "100%",
        "Input Grid zoom keys do not change a Page in the other pane",
      );
    }
    await prepared.fill("1");
    const total = await output.locator(".composition-totals strong").innerText();
    await prepared.dispatchEvent("keydown", { key: "Enter", isComposing: true });
    assert.equal(
      await output.locator(".composition-totals strong").innerText(),
      total,
      "IME confirmation does not add prepared pages",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Open menus retain page commands from both panes", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    await selected.fill("2");
    await input.getByLabel("Input page actions", { exact: true }).click();
    const thumbnail = output.getByRole("button", { name: "Select Output page 1", exact: true });
    await thumbnail.focus();
    for (const key of ["Shift+ArrowRight", "Space", "Enter", "Delete", "Control+ArrowLeft", "?", "v"]) {
      await page.keyboard.press(key);
      assert.equal(await selected.inputValue(), "2", `${key} retains selection while a menu is open`);
      assert.equal(await output.locator(".composition-totals strong").innerText(), "6 PDF pages");
      assert.equal(await output.getByRole("tab", { name: "Grid", exact: true }).getAttribute("aria-selected"), "true");
      assert.equal(await page.getByRole("dialog", { name: "Help", exact: true }).isVisible(), false);
    }
    await page.keyboard.press("Escape");
    assert.equal(await input.locator(".input-options").evaluate((element) => element.open), false);
    assert.equal(await prepared.inputValue(), "3-5,2,2,7");
    assert.equal(await selected.inputValue(), "2");
    await thumbnail.focus();
    await page.keyboard.press("Delete");
    assert.equal(await output.locator(".composition-totals strong").innerText(), "5 PDF pages");
    await prepared.fill("1");
    await input.getByLabel("Input page actions", { exact: true }).click();
    await prepared.press("Enter");
    assert.equal(
      await output.locator(".composition-totals strong").innerText(),
      "6 PDF pages",
      "The selection field retains its own Enter action after configuring repetitions",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Grid boundary duplication focuses the final new Output occurrence", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    const output = page.locator(".composition-output");
    await output.getByLabel("Page selection", { exact: true }).fill("2,6");
    await output.getByRole("button", { name: "Select Output page 6", exact: true }).press("ArrowRight");
    await page.waitForFunction(() => document.activeElement?.matches(".output-pages"));
    await page.keyboard.press("Enter");
    assert.equal(await output.locator(".composition-totals strong").innerText(), "8 PDF pages");
    assert.equal(await output.getByLabel("Page selection", { exact: true }).inputValue(), "7-8");
    assert.equal(
      await output
        .getByRole("button", { name: "Select Output page 8", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("v");
    assert.match(await pagePosition(output), /8\s*\/ 8/);
    assert.equal(
      await page.locator(".selection-panel").getByLabel("Page selection", { exact: true }).inputValue(),
      "3-5,2,2,7",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Home asks once before discarding changes and cancellation retains the workspace", async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(`${server.resolvedUrls.local[0]}?demo`);
    await page.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    );
    const preparation = page.locator(".selection-panel").getByLabel("Page selection", { exact: true });
    await preparation.fill("1");
    await preparation.press("Enter");
    const home = page.getByRole("link", { name: "PDF Studio home", exact: true });
    const warnings = [];
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type());
      await dialog.dismiss();
    });
    await home.click();
    assert.deepEqual(warnings, ["confirm"]);
    assert.equal(await page.locator(".composition-totals strong").innerText(), "7 PDF pages");
    page.once("dialog", async (dialog) => {
      warnings.push(dialog.type());
      await dialog.dismiss();
    });
    const reloadWarning = page.waitForEvent("dialog");
    await page.evaluate(() => location.reload());
    await reloadWarning;
    assert.deepEqual(warnings, ["confirm", "beforeunload"], "Reload retains its independent exit warning");
    assert.equal(await page.locator(".composition-totals strong").innerText(), "7 PDF pages");
    page.on("dialog", async (dialog) => {
      warnings.push(dialog.type());
      await dialog.accept();
    });
    await home.click();
    await page.locator(".drop-zone").waitFor();
    assert.deepEqual(warnings, ["confirm", "beforeunload", "confirm"], "Each Home attempt asks exactly once");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Grid keyboard selection toggles at the cursor and stops at boundaries", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const [width, theme, textSize] of [
      [1440, "light", "100%"],
      [390, "dark", "200%"],
    ]) {
      const page = await browser.newPage({ viewport: { width, height: 1100 }, reducedMotion: "reduce" });
      await page.addInitScript((choice) => {
        localStorage.setItem("mainz:onboarding", "19");
        localStorage.setItem("mainz:theme", choice);
      }, theme);
      await page.goto(server.resolvedUrls.local[0]);
      await page.evaluate((size) => (document.documentElement.style.fontSize = size), textSize);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Selection.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, false, 0, false, false, {}, 14),
        });
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click();
      const prepared = input.getByLabel("Page selection", { exact: true });
      await prepared.fill("1-14");
      await prepared.press("Enter");
      if (width === 390)
        await page
          .getByRole("navigation", { name: "Workspace view", exact: true })
          .getByRole("button", { name: "Output", exact: true })
          .click();
      await output.getByLabel("Page selection", { exact: true }).fill("");
      for (const name of ["Input", "Output"]) {
        if (width === 390)
          await page
            .getByRole("navigation", { name: "Workspace view", exact: true })
            .getByRole("button", { name, exact: true })
            .click();
        const panel = name === "Input" ? input : output;
        const selection = panel.getByLabel("Page selection", { exact: true });
        const cards = panel.locator("button.page-image");
        const cursor = async (number) => {
          const footers = panel.locator(".composition-card > .input-footer, .composition-card > .occurrence-actions");
          assert.equal(
            await footers
              .locator("button")
              .evaluateAll((buttons) => buttons.every((button) => getComputedStyle(button).visibility === "visible")),
            true,
            "Keyboard navigation keeps individual footer controls visible",
          );
          if (!number || number === 15) {
            await page.waitForFunction(() => document.activeElement?.matches(".composition-grid"));
            assert.equal(
              await cards.evaluateAll((buttons) => buttons.some((button) => button.matches(":focus-visible"))),
              false,
              "No page retains a focus frame at a boundary",
            );
            assert.equal(
              await cards.evaluateAll((buttons) =>
                buttons.some(
                  (button) =>
                    getComputedStyle(button.closest(".composition-card")).borderTopColor ===
                    getComputedStyle(document.querySelector(".workspace-icon")).color,
                ),
              ),
              false,
              "No page retains a cursor contour at a boundary",
            );
          } else {
            await page.waitForFunction(
              (expected) =>
                document.activeElement?.getAttribute("aria-label") ===
                `Select ${expected.name} page ${expected.number}`,
              { name, number },
            );
            assert.equal(
              await panel
                .getByRole("button", { name: `Select ${name} page ${number}`, exact: true })
                .evaluate(hasCursor),
              true,
              "The cursor stays visible on selected and unselected pages",
            );
          }
        };
        const steps = async (scenario) => {
          for (const [key, text, position] of scenario) {
            await page.keyboard.press(key);
            assert.equal(await selection.inputValue(), text, `${name}: ${key}`);
            await cursor(position);
          }
        };
        const range = panel.getByRole("slider", { name: `${name} thumbnail range`, exact: true });
        const firstBatch = () => range.press("Home");
        await firstBatch();
        await selection.fill("");
        await cards.first().click();
        assert.equal(await cards.first().evaluate(hasCursor), false, "Pointer selection has no page cursor");
        await steps([
          ["Shift", "1", 2],
          ["Shift+ArrowRight", "1-2", 3],
          ["Shift+ArrowLeft", "1", 2],
          ["Shift+ArrowLeft", "", 0],
          ["Shift+ArrowLeft", "", 0],
          ["ArrowRight", "", 1],
          ["Shift+ArrowRight", "1", 2],
          ["Shift+ArrowRight", "1-2", 3],
          ["ArrowRight", "1-2", 4],
          ["Shift+ArrowRight", "1-2, 4", 5],
          ["Shift+ArrowLeft", "1-2", 4],
          ["Shift+ArrowLeft", "1-3", 3],
          ["Shift+ArrowRight", "1-2", 4],
        ]);
        await selection.fill("");
        await panel.getByRole("button", { name: `Select ${name} page 2`, exact: true }).click();
        await steps([
          ["Shift+ArrowRight", "2-3", 4],
          ["ArrowRight", "2-3", 5],
          ["Shift+ArrowRight", "2-3, 5", 6],
          ["Shift+ArrowRight", "2-3, 5-6", 7],
          ["Shift+ArrowLeft", "2-3, 5", 6],
          ["Shift+ArrowLeft", "2-3", 5],
          ["ArrowLeft", "2-3", 4],
          ["ArrowLeft", "2-3", 3],
          ["Shift+ArrowRight", "2", 4],
          ["Shift+ArrowLeft", "2-3", 3],
          ["Shift+ArrowLeft", "3", 2],
        ]);
        await selection.fill(name === "Input" ? "7,7" : "7");
        await panel.getByRole("button", { name: `Select ${name} page 3`, exact: true }).focus();
        await steps([
          ["Shift+ArrowRight", name === "Input" ? "7, 7, 3" : "3, 7", 4],
          ["Shift+ArrowRight", name === "Input" ? "7, 7, 3-4" : "3-4, 7", 5],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7, 3" : "3, 7", 4],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7" : "7", 3],
          ["Shift+ArrowLeft", name === "Input" ? "7, 7, 2" : "2, 7", 2],
          ["Shift+ArrowRight", name === "Input" ? "7, 7" : "7", 3],
        ]);
        await selection.fill("");
        await cards.last().focus();
        const boundary = Number(await panel.locator(".grid-view").getAttribute("data-batch"));
        await steps([
          ["Shift+ArrowRight", String(boundary), boundary + 1],
          ["Shift+ArrowRight", `${boundary}-${boundary + 1}`, boundary + 2],
          ["Shift+ArrowLeft", String(boundary), boundary + 1],
          ["Shift+ArrowLeft", "", boundary],
        ]);
        await range.press("End");
        await panel.getByRole("button", { name: `Select ${name} page 14`, exact: true }).focus();
        await steps([
          ["Shift+ArrowRight", "14", 15],
          ["Shift+ArrowRight", "14", 15],
          ["ArrowRight", "14", 15],
          ["Shift+ArrowLeft", "", 14],
          ["Shift+ArrowRight", "14", 15],
          ["ArrowLeft", "14", 14],
        ]);
        await selection.fill("");
        await firstBatch();
        await cards.first().focus();
        for (let number = 1; number <= 14; number++) await page.keyboard.press("Shift+ArrowRight");
        assert.equal(await selection.inputValue(), "1-14");
        await cursor(15);
        for (let number = 14; number >= 1; number--) await page.keyboard.press("Shift+ArrowLeft");
        assert.equal(await selection.inputValue(), "");
        await cursor(0);
        if (name === "Input") {
          await selection.fill("1,9-10");
          await cards.first().focus();
          await page.keyboard.press("Delete");
          assert.equal(await selection.inputValue(), "1,9-10", "Delete keeps immutable Input pages and preparation");
        } else {
          const total = () => output.locator(".composition-totals strong").innerText();
          await selection.fill("1,13-14");
          await panel.getByRole("button", { name: "Select Output page 2", exact: true }).focus();
          await cards.last().dispatchEvent("keydown", { key: "Delete", repeat: true });
          await page.keyboard.press("Alt+Delete");
          assert.equal(await total(), "14 PDF pages", "Held or modified Delete keeps the composition");
          await page.keyboard.press("Delete");
          assert.equal(await total(), "11 PDF pages");
          assert.equal(await selection.inputValue(), "");
          await cursor(1);
          await page.keyboard.press("Space");
          await page.keyboard.press("Delete");
          assert.equal(await total(), "10 PDF pages");
          await cursor(1);
          await selection.fill("1-10");
          await cards.last().press("ArrowRight");
          await page.keyboard.press("Delete");
          await output.locator(".composition-empty").waitFor();
          assert.equal(
            await output
              .getByRole("tab", { name: "Grid", exact: true })
              .evaluate((element) => element === document.activeElement),
            true,
            "Removing every page from a boundary returns focus to its view tab",
          );
        }
      }
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Selection bars expose meaningful actions in both panes", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page.locator("input[type=file]").first().setInputFiles({
      name: "Selection.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    const inputAll = input.getByRole("button", { name: "Select all", exact: true });
    const inputClear = input.getByRole("button", { name: "Clear page sequence", exact: true });
    const add = input.getByRole("button", { name: "Add to Output", exact: true });
    const group = output.getByRole("group", { name: "Selected Output pages", exact: true });
    assert.equal(await selected.isDisabled(), true);
    assert.equal(await output.locator(".sequence-entry button, .sequence-options").count(), 0);
    assert.equal(await inputClear.count(), 0);
    assert.equal(await add.count(), 0);
    assert.equal(await input.locator(".input-footer button").count(), 7);
    assert.equal(
      await input.locator(".sequence-entry > .entry > :first-child").getAttribute("class"),
      "sequence-options input-options",
    );
    await prepared.fill("99");
    assert.equal(await prepared.getAttribute("aria-invalid"), "true");
    assert.equal(await add.count(), 0);
    await inputClear.click();
    await input.getByLabel("Input page actions", { exact: true }).click();
    await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("2");
    await page.keyboard.press("Escape");
    assert.equal(await inputClear.count(), 1, "Configuration can be cleared before selecting pages");
    await inputClear.click();
    for (const [text, all, copies] of [
      ["4", 1, 1],
      ["4,2,2", 1, 3],
      ["1-7", 0, 7],
      ["7,1-6", 1, 7],
      ["1-7,1", 1, 8],
    ]) {
      await prepared.fill(text);
      assert.equal(await inputAll.count(), all, text);
      assert.equal(await input.locator(".input-footer button").count(), 0, text);
      assert.match(await input.locator(".sequence-help").innerText(), new RegExp(`${copies} pages? selected`));
    }
    await prepared.fill("2,");
    assert.equal(await add.isDisabled(), true, "Invalid text keeps the last preparation but blocks addition");
    await inputAll.click();
    assert.equal(await prepared.inputValue(), "1-7");
    assert.equal(await prepared.evaluate((element) => element === document.activeElement), true);
    await tab(input, "Page");
    assert.equal(await input.locator(".page-actions button").count(), 0);
    await inputClear.click();
    assert.equal(await input.locator(".page-actions button").count(), 1);
    await tab(input, "Grid");
    await prepared.fill("1-7");
    await add.click();
    assert.equal(await prepared.evaluate((element) => element === document.activeElement), true);
    assert.equal(await inputClear.count(), 0);
    assert.equal(await input.locator(".input-footer button").count(), 7);
    assert.equal(
      await output.locator(".sequence-entry > .entry > :first-child").getAttribute("class"),
      "sequence-options output-options",
    );
    for (const [text, earlier, later] of [
      ["", false, false],
      ["1", false, true],
      ["4", true, true],
      ["7", true, false],
      ["2-4", true, true],
      ["1-3", false, true],
      ["5-7", true, false],
      ["1-7", false, false],
      ["1,7", false, false],
      ["2,4", true, true],
    ]) {
      await selected.fill(text);
      const expected = text ? ["Remove selected Output pages", "Duplicate selected Output pages"] : [];
      assert.deepEqual(
        await group
          .getByRole("button")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        expected,
        text,
      );
      await output.getByLabel("Output page actions", { exact: true }).click();
      assert.deepEqual(
        await output.locator('.selected-actions button[aria-label^="Move selected pages"]').allTextContents(),
        [...(earlier ? ["Move selected pages earlier"] : []), ...(later ? ["Move selected pages later"] : [])],
        text,
      );
      await page.keyboard.press("Escape");
      assert.equal(await output.locator(".occurrence-actions button").count(), text ? 0 : 14, text);
      assert.equal(
        await output.getByRole("button", { name: "Clear Output selection", exact: true }).count(),
        text ? 1 : 0,
        text,
      );
      assert.equal(
        await output.getByRole("button", { name: "Select all", exact: true }).count(),
        text === "1-7" ? 0 : 1,
        text,
      );
    }
    await output.getByLabel("Output page actions", { exact: true }).click();
    assert.equal(await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).count(), 0);
    assert.match(await output.locator(".menu-options").innerText(), /Select consecutive pages/);
    await page.keyboard.press("Escape");
    await selected.fill("2-4");
    await output.getByLabel("Output page actions", { exact: true }).click();
    await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("1");
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 0);
    await output.getByLabel("Start each repeat on front", { exact: true }).check();
    assert.equal(await output.getByRole("button", { name: "Repeat selected pages", exact: true }).count(), 1);
    await page.keyboard.press("Escape");
    await selected.fill("2,");
    assert.equal(
      await group.getByRole("button").evaluateAll((buttons) => buttons.every((button) => button.disabled)),
      true,
    );
    await selected.fill("1");
    await tab(output, "Page");
    assert.equal(await output.locator(".page-actions button").count(), 0);
    await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Space");
    assert.equal(await output.locator(".composition-totals strong").innerText(), "8 PDF pages");
    assert.equal(await selected.inputValue(), "1");
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    assert.equal(await output.locator(".page-actions button").count(), 2);
    await tab(output, "Grid");
    await selected.fill("1-8");
    await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await prepared.fill("3,1,3");
    await add.click();
    assert.deepEqual(await output.locator(".page-origin-info .page-context").allTextContents(), [
      "p. 3",
      "p. 1",
      "p. 3",
    ]);
    assert.equal(await selected.inputValue(), "1-3");
    await output.getByLabel("Output page actions", { exact: true }).focus();
    await page.keyboard.press("Delete");
    assert.equal(await output.locator(".composition-totals strong").innerText(), "0 PDF pages");
    assert.equal(
      await output
        .getByRole("tab", { name: "Grid", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
      "Removing all pages returns focus when the menu control disappears",
    );
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Output separates page controls from group actions for keyboard and mouse", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    for (const interaction of ["keyboard", "mouse"]) {
      // Keep all ten pages visible while checking group actions across copies.
      const page = await browser.newPage({ viewport: { width: 2560, height: 1440 }, reducedMotion: "reduce" });
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(server.resolvedUrls.local[0]);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Groups.pdf", mimeType: "application/pdf", buffer: fixture() });
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const prepared = input.getByRole("textbox", { name: "Page selection", exact: true });
      const selected = output.getByRole("textbox", { name: "Page selection", exact: true });
      const total = () => output.locator(".composition-totals strong").innerText();
      const contents = () =>
        output.locator(".composition-card:not([inert]) .page-origin-info .page-context").allTextContents();
      if (interaction === "keyboard") {
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).press("Space");
        await page.keyboard.press("Enter");
      } else {
        await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click();
      }
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      if (interaction === "keyboard") {
        await input.getByRole("button", { name: "Select Input page 2", exact: true }).focus();
        await page.keyboard.press("Shift+ArrowRight");
        await page.keyboard.press("Shift+ArrowRight");
        await page.keyboard.press("Shift+ArrowRight");
        await page.keyboard.press("Enter");
      } else {
        await input.getByRole("button", { name: "Select Input page 2", exact: true }).click();
        await input.getByRole("button", { name: "Select Input page 4", exact: true }).click({ modifiers: ["Shift"] });
        await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      }
      assert.equal(await total(), "4 PDF pages", "Addition transfers every selected Input page");
      assert.equal(await prepared.inputValue(), "", "Successful group addition resets the preparation");
      assert.equal(await selected.inputValue(), "2-4");
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3", "p. 4"]);
      assert.equal(
        await output.locator(".composition-card.range-highlight").count(),
        3,
        "Addition highlights the new group",
      );
      assert.equal(await output.getByRole("button", { name: "Move selected pages later", exact: true }).count(), 0);
      assert.equal(
        await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).isEnabled(),
        true,
        "Removal remains meaningful for a group",
      );
      assert.match(await output.locator(".sequence-help").innerText(), /3 pages selected/);
      assert.match(await output.locator(".sequence-help").innerText(), /Use the selection bar/);
      assert.equal(
        await output.locator(".occurrence-actions button").count(),
        0,
        "Selection temporarily removes every individual card action",
      );
      await selected.fill("99");
      await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Enter");
      assert.equal(await total(), "4 PDF pages", "Invalid selection text blocks group edits");
      await selected.fill("2-4");
      if (interaction === "keyboard") {
        await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Control+ArrowLeft");
      } else {
        await output.getByLabel("Output page actions", { exact: true }).click();
        await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click();
      }
      assert.deepEqual(
        await contents(),
        ["p. 2", "p. 3", "p. 4", "p. 1"],
        "Movement keeps the selected pages together and in order",
      );
      assert.equal(await selected.inputValue(), "1-3");
      assert.equal(
        await output.locator(".composition-card.range-highlight").count(),
        3,
        "Movement highlights the moved group",
      );
      if (interaction === "keyboard") await page.keyboard.press("Control+ArrowRight");
      else {
        await output.getByLabel("Output page actions", { exact: true }).click();
        await output.getByRole("button", { name: "Move selected pages later", exact: true }).click();
      }
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3", "p. 4"]);
      for (const position of [4, 7]) {
        if (interaction === "keyboard") await page.keyboard.press("Shift+Equal");
        else await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click();
        assert.equal(await total(), `${position + 3} PDF pages`, "Each addition makes exactly one group copy");
        assert.equal(await selected.inputValue(), `${position + 1}-${position + 3}`);
        assert.equal(
          await output.locator(".composition-card.range-highlight").count(),
          3,
          "Duplication highlights the new group copy",
        );
      }
      assert.deepEqual(await contents(), [
        "p. 1",
        "p. 2",
        "p. 3",
        "p. 4",
        "p. 2",
        "p. 3",
        "p. 4",
        "p. 2",
        "p. 3",
        "p. 4",
      ]);
      if (interaction === "keyboard") await page.keyboard.press("Delete");
      else await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
      assert.equal(await total(), "7 PDF pages", "Removal removes the selected copy and leaves other copies intact");
      await selected.fill("5-7");
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 7", exact: true }).press("-");
      else await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
      assert.equal(await total(), "4 PDF pages");
      await selected.fill("2,4");
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Enter");
      else await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).click();
      assert.deepEqual(
        await contents(),
        ["p. 1", "p. 2", "p. 3", "p. 4", "p. 2", "p. 4"],
        "Nonconsecutive targets copy in print order",
      );
      await selected.fill("2,4");
      if (interaction === "keyboard")
        await output.getByRole("button", { name: "Select Output page 4", exact: true }).press("Control+ArrowLeft");
      else {
        await output.getByLabel("Output page actions", { exact: true }).click();
        await output.getByRole("button", { name: "Move selected pages earlier", exact: true }).click();
      }
      assert.equal(await selected.inputValue(), "1, 3", "Movement preserves gaps in the selection");
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      assert.equal(await selected.inputValue(), "");
      assert.equal(await selected.evaluate((element) => element === document.activeElement), true);
      await selected.fill("1");
      assert.equal(await output.locator(".occurrence-actions button").count(), 0);
      const group = output.getByRole("group", { name: "Selected Output pages", exact: true });
      assert.deepEqual(
        await group
          .getByRole("button")
          .evaluateAll((buttons) => buttons.map((button) => button.getAttribute("aria-label"))),
        ["Remove selected Output pages", "Duplicate selected Output pages"],
      );
      assert.match(await output.locator(".sequence-help").innerText(), /1 page selected/);
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      assert.equal(await output.getByRole("button", { name: "Clear Output selection", exact: true }).count(), 0);
      assert.equal(await group.count(), 0);
      await output.getByRole("button", { name: "Duplicate Output page 4", exact: true }).click();
      assert.deepEqual(
        await contents(),
        ["p. 2", "p. 1", "p. 4", "p. 3", "p. 3", "p. 2", "p. 4"],
        "Without a selection, a card action uses its own occurrence",
      );
      await selected.fill("2,4");
      await selected.press("End");
      await selected.press(",");
      await selected.press("6");
      assert.equal(await selected.inputValue(), "2,4,6");
      assert.equal(await selected.evaluate((element) => element === document.activeElement), true);
      assert.match(await output.locator(".sequence-help").innerText(), /3 pages selected/);
      await page.close();
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "Grid shortcuts resolve both pane selections and allow mouse then keyboard actions",
  { timeout: 90000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
      const warnings = [];
      page.on("console", (entry) => {
        if (entry.type() === "warning") warnings.push(entry.text());
      });
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19");
      });
      await page.goto(server.resolvedUrls.local[0]);
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Selections.pdf",
        mimeType: "application/pdf",
        buffer: fixture(),
      });
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const prepared = input.getByLabel("Page selection", { exact: true });
      const selected = output.getByLabel("Page selection", { exact: true });
      const contents = () =>
        output.locator(".composition-card:not([inert]) .page-origin-info .page-context").allTextContents();
      const clear = async () => {
        if (!(await selected.isDisabled())) {
          const all = output.getByRole("button", { name: "Select all", exact: true });
          if (await all.count()) await all.click();
          await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
        }
        const reset = input.getByRole("button", { name: "Clear page sequence", exact: true });
        if (await reset.count()) await reset.click();
      };
      for (const pane of ["Input", "Output"]) {
        for (const inputSelection of [false, true]) {
          for (const outputSelection of [false, true]) {
            for (const key of [
              "Enter",
              "Shift+Equal",
              "Delete",
              "-",
              "Control+ArrowLeft",
              "Control+ArrowRight",
              "Escape",
            ]) {
              await clear();
              await prepared.fill("1-4");
              await prepared.press("Enter");
              if (outputSelection) await selected.fill("2,4");
              else await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
              if (inputSelection) await prepared.fill("2-3");
              const current = (pane === "Input" ? input : output).getByRole("button", {
                name: `Select ${pane} page 1`,
                exact: true,
              });
              await current.focus();
              if (key === "Escape") await page.mouse.move(pane === "Input" ? 8 : 1432, 20);
              await page.keyboard.press(key);
              let expected = ["p. 1", "p. 2", "p. 3", "p. 4"];
              if (pane === "Input" && key === "Enter" && inputSelection) {
                expected.push("p. 2", "p. 3");
              } else if (pane === "Output" && outputSelection && ["Enter", "Shift+Equal"].includes(key)) {
                expected.push("p. 2", "p. 4");
              } else if (key === "Delete" || (pane === "Output" && key === "-")) {
                if (outputSelection) expected = ["p. 1", "p. 3"];
              } else if (outputSelection && key === "Control+ArrowLeft") {
                expected = ["p. 2", "p. 1", "p. 4", "p. 3"];
              }
              const scenario = `${pane} ${key}; Input selection=${inputSelection}, Output selection=${outputSelection}`;
              assert.deepEqual(await contents(), expected, scenario);
              assert.equal(
                await prepared.inputValue(),
                inputSelection && !(pane === "Input" && ["Escape", "Enter"].includes(key)) ? "2-3" : "",
                scenario,
              );
              if (key === "Escape") {
                assert.equal(await selected.inputValue(), pane === "Input" && outputSelection ? "2,4" : "", scenario);
                assert.equal(
                  await (pane === "Input" ? input : output)
                    .getByRole("tab", { name: "Grid", exact: true })
                    .evaluate((element) => element === document.activeElement),
                  true,
                  "Escape ends page navigation without leaving a cursor on an unselected page",
                );
              }
            }
          }
        }
      }
      for (const selectInputAgain of [false, true]) {
        await clear();
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).click();
        await input.getByRole("button", { name: "Select Input page 3", exact: true }).click({ modifiers: ["Shift"] });
        await page.keyboard.press("Enter");
        assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"]);
        assert.equal(await selected.inputValue(), "1-3");
        assert.equal(await prepared.inputValue(), "");
        if (selectInputAgain) await input.getByRole("button", { name: "Select Input page 1", exact: true }).click();
        await page.keyboard.press("Delete");
        assert.deepEqual(
          await contents(),
          [],
          "Input → Enter → Delete removes the new Output group without changing pane",
        );
        assert.equal(
          await prepared.inputValue(),
          selectInputAgain ? "1" : "",
          "Output removal preserves Input selection",
        );
      }
      await clear();
      await prepared.fill("1-3");
      await prepared.press("Enter");
      await selected.fill("2-3");
      await prepared.fill("1");
      await prepared.press("Delete");
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"], "Delete in a text field only edits text");
      await output.getByLabel("Output page actions", { exact: true }).click();
      await page.keyboard.press("Delete");
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"], "Open menus retain their keys");
      await page.keyboard.press("Escape");
      await page.keyboard.press("Delete");
      assert.deepEqual(await contents(), ["p. 1"], "Delete works again after a menu closes");
      await clear();
      await prepared.fill("1-3");
      await prepared.press("Enter");
      await selected.fill("2-3");
      await output.getByRole("button", { name: "Select Output page 1", exact: true }).click();
      await page.keyboard.press("Enter");
      assert.deepEqual(
        await contents(),
        ["p. 1", "p. 2", "p. 3", "p. 1", "p. 2", "p. 3"],
        "Mouse selection can immediately duplicate with Enter",
      );
      await page.keyboard.press("Delete");
      assert.deepEqual(await contents(), ["p. 1", "p. 2", "p. 3"], "The copied group can immediately be removed");
      await prepared.fill("2-3");
      await selected.fill("1-3");
      await page.locator(".input-picker > summary").click();
      await page.keyboard.press("Escape");
      assert.equal(await prepared.inputValue(), "2-3", "Closing the Input chooser preserves preparation");
      assert.equal(await selected.inputValue(), "1-3", "Closing the Input chooser preserves Output selection");
      const inputOptions = input.getByLabel("Input page actions", { exact: true });
      const outputOptions = output.getByLabel("Output page actions", { exact: true });
      await inputOptions.click();
      await input.getByRole("textbox", { name: "Repetitions", exact: true }).fill("3");
      await input.getByLabel("Start each repeat on front", { exact: true }).check();
      await page.keyboard.press("Escape");
      await outputOptions.click();
      await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).fill("4");
      await output.getByLabel("Start each repeat on front", { exact: true }).check();
      await page.keyboard.press("Escape");
      await outputOptions.dispatchEvent("keydown", { key: "Escape", repeat: true });
      assert.equal(await prepared.inputValue(), "2-3", "Held Escape does not clear after dismissing a menu");
      assert.equal(await selected.inputValue(), "1-3");
      await page.getByRole("button", { name: "Help", exact: true }).click();
      await page.keyboard.press("Escape");
      assert.equal(await prepared.inputValue(), "2-3", "Closing a dialog preserves Input preparation");
      assert.equal(await selected.inputValue(), "1-3", "Closing a dialog preserves Output selection");
      await page.mouse.move(8, 20);
      await page.keyboard.press("Escape");
      assert.equal(await prepared.inputValue(), "", "Escape also works after a dialog returns focus to Help");
      assert.equal(await selected.inputValue(), "1-3", "Clearing Input preserves Output selection");
      await page.mouse.move(1432, 20);
      await page.keyboard.press("Escape");
      assert.equal(await selected.inputValue(), "");
      await inputOptions.click();
      assert.equal(await input.getByRole("textbox", { name: "Repetitions", exact: true }).inputValue(), "1");
      assert.equal(await input.getByLabel("Start each repeat on front", { exact: true }).isChecked(), false);
      await page.keyboard.press("Escape");
      await selected.fill("1-3");
      await outputOptions.click();
      assert.equal(
        await output.getByRole("textbox", { name: "Repeat selected sequence", exact: true }).inputValue(),
        "2",
      );
      assert.equal(await output.getByLabel("Start each repeat on front", { exact: true }).isChecked(), false);
      await page.keyboard.press("Escape");
      for (const reducedMotion of ["no-preference", "reduce"]) {
        await clear();
        await page.emulateMedia({ reducedMotion });
        await prepared.fill("1-3");
        await prepared.press("Enter");
        await input.getByRole("button", { name: "Select Input page 1", exact: true }).focus();
        await output.locator(".composition-card").evaluateAll((cards) => {
          window.removalFrames = [];
          for (const card of cards)
            card.addEventListener("outrostart", () =>
              queueMicrotask(() => {
                window.removalFrames.push({
                  inert: card.inert,
                  removing: card.classList.contains("removing"),
                  fade: card.getAnimations().some((animation) => animation.effect.getTiming().duration === 140),
                });
                // Deliver a resize while the last cards are still fading.
                const grid = card.closest(".grid-view");
                if (grid) grid.style.inlineSize = "calc(100% - 1px)";
              }),
            );
        });
        await page.keyboard.press("Delete");
        assert.equal(
          await output.locator(".composition-totals strong").innerText(),
          "0 PDF pages",
          "Removal changes data immediately",
        );
        await page.waitForFunction(() => window.removalFrames.length === 3);
        assert.deepEqual(
          await page.evaluate(() => window.removalFrames),
          Array.from({ length: 3 }, () => ({ inert: true, removing: true, fade: reducedMotion === "no-preference" })),
          "All removed cards receive feedback and cannot receive input",
        );
        await page.waitForFunction(() => !document.querySelector(".output-pages .composition-card"));
      }
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.mouse.move(0, 0);
      assert.equal(
        await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).isVisible(),
        true,
        "Returning to the mouse restores individual controls after keyboard navigation",
      );
      await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).click();
      assert.equal(
        await input
          .getByRole("button", { name: "Select Input page 4", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
      );
      await tab(input, "Page");
      assert.match(await pagePosition(input), /4\s*\/ 7/, "A card addition updates the page opened for inspection");
      await input.getByRole("button", { name: "Add Input page 4 to Output", exact: true }).click();
      assert.equal(
        await input
          .getByRole("region", { name: "PDF viewport", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Input Page addition keeps normal focus in Input",
      );
      await tab(output, "Page");
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      await output.getByRole("button", { name: "Duplicate Output page 1", exact: true }).click();
      assert.equal(
        await output
          .getByRole("region", { name: "PDF viewport", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Output Page editing retains normal viewport focus",
      );
      assert.equal(
        await output.locator(".sequence-entry.range-highlight").count(),
        1,
        "Page editing highlights its updated selection controls",
      );
      await prepared.fill("1");
      await page.mouse.move(1432, 20);
      await output.getByRole("region", { name: "PDF viewport", exact: true }).press("Escape");
      assert.equal(await prepared.inputValue(), "1");
      assert.equal(await selected.inputValue(), "");
      assert.equal(
        await output
          .getByRole("tab", { name: "Page", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Escape ends Page navigation as well as Grid navigation",
      );
      await prepared.fill("99");
      await selected.fill("1");
      await page.mouse.move(8, 20);
      await prepared.press("Escape");
      assert.equal(await prepared.inputValue(), "", "Escape clears invalid field text like Clear");
      assert.equal(await prepared.getAttribute("aria-invalid"), "false");
      assert.equal(await selected.inputValue(), "1");
      await prepared.fill("1");
      await selected.fill("1");
      await output.getByRole("button", { name: "Go to Output page", exact: true }).click();
      const entry = output.getByRole("textbox", { name: "Go to Output page", exact: true });
      await entry.fill("2");
      await entry.press("Escape");
      assert.equal(await prepared.inputValue(), "1", "Cancelling page entry preserves Input preparation");
      assert.equal(await selected.inputValue(), "1", "Cancelling page entry preserves Output selection");
      await page.keyboard.press("Escape");
      assert.equal(await prepared.inputValue(), "1", "Clearing Output preserves Input preparation");
      assert.equal(await selected.inputValue(), "");
      assert.deepEqual(warnings, []);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test(
  "Escape clears the target selection without moving inspection or scroll positions",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      for (const [name, width, scale, theme] of [
        ["Input", 1440, 100, "light"],
        ["Output", 1440, 100, "light"],
        ["Input", 390, 200, "dark"],
        ["Output", 390, 200, "dark"],
      ]) {
        const page = await browser.newPage({ viewport: { width: 1440, height: 500 }, reducedMotion: "reduce" });
        await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
        await page.goto(server.resolvedUrls.local[0]);
        await page.locator("input[type=file]").first().setInputFiles({
          name: "Position.pdf",
          mimeType: "application/pdf",
          buffer: fixture(),
        });
        const input = page.locator(".selection-panel"),
          output = page.locator(".composition-output");
        const prepared = input.getByLabel("Page selection", { exact: true });
        const selected = output.getByLabel("Page selection", { exact: true });
        const pane = name === "Input" ? input : output;
        await prepared.fill("1-7");
        await prepared.press("Enter");
        await page.evaluate((value) => (document.documentElement.dataset.theme = value), theme);
        for (const mode of ["Grid", "Page"]) {
          await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
          await page.setViewportSize({ width: 1440, height: 500 });
          await prepared.fill("2-3");
          await selected.fill("1-3");
          if (mode === "Grid") {
            await pane.getByRole("button", { name: `Select ${name} page 6`, exact: true }).focus();
            await page.keyboard.press("ArrowRight");
          } else {
            await zoom(pane, "Zoom in");
            await zoom(pane, "Zoom in");
          }
          await page.setViewportSize({ width, height: 500 });
          await page.evaluate((value) => (document.documentElement.style.fontSize = `${value}%`), scale);
          if (width === 390)
            await page
              .getByRole("navigation", { name: "Workspace view", exact: true })
              .getByRole("button", { name, exact: true })
              .click();
          if (mode === "Page") {
            await page.waitForFunction(
              () => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"),
            );
            await pane.getByRole("region", { name: "PDF viewport", exact: true }).evaluate((element) => {
              element.scrollTop = 200;
              element.scrollLeft = 50;
              element.focus({ preventScroll: true });
            });
          } else await pane.getByRole("button", { name: `Select ${name} page 7`, exact: true }).focus();
          await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          const before = await page.evaluate(() => ({ x: scrollX, y: scrollY }));
          assert.ok(before.y > 0, "The view tab is above the current viewport");
          const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true });
          const region =
            mode === "Page"
              ? await viewport.evaluate((element) => ({ x: element.scrollLeft, y: element.scrollTop }))
              : undefined;
          await page.mouse.move(name === "Input" ? 8 : width - 8, 20);
          await page.keyboard.press("Escape");
          await page.evaluate(
            () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))),
          );
          assert.equal(await prepared.inputValue(), name === "Input" ? "" : "2-3");
          assert.equal(await selected.inputValue(), name === "Output" ? "" : "1-3");
          assert.deepEqual(
            await page.evaluate(() => ({ x: scrollX, y: scrollY })),
            await page.evaluate(
              (position) => ({
                x: position.x,
                y: Math.min(position.y, document.documentElement.scrollHeight - innerHeight),
              }),
              before,
            ),
            `${name} ${mode}: Escape keeps the window position within the document bounds`,
          );
          if (mode === "Page") {
            assert.deepEqual(
              await viewport.evaluate((element) => ({ x: element.scrollLeft, y: element.scrollTop })),
              region,
            );
            assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), "200%");
          } else await tab(pane, "Page");
          assert.match(await pagePosition(pane), /7\s*\/ 7/, "Escape preserves the inspected page");
        }
        await page.close();
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Selection and view shortcuts target the mouse pane and preserve native keys", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Shortcuts.pdf",
        mimeType: "application/pdf",
        buffer: fixture(true, false, 0, false, false, {}, 13),
      });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await input.getByRole("button", { name: "Normal Input grid", exact: true }).press("Space");
    const prepared = input.getByLabel("Page selection", { exact: true });
    const selected = output.getByLabel("Page selection", { exact: true });
    await prepared.fill("1-13");
    await prepared.press("Enter");
    await prepared.fill("2,4");
    await selected.fill("3,5");
    await output.locator(".page-image").first().focus();
    await page.keyboard.press("Control+a");
    assert.equal(await selected.inputValue(), "1-13", "Before mouse use, shortcuts follow the focused pane");
    assert.equal(await prepared.inputValue(), "2,4");
    await page.keyboard.press("Escape");
    assert.equal(await selected.inputValue(), "");
    assert.equal(await prepared.inputValue(), "2,4");
    for (const mode of ["Grid", "Page"]) {
      await tab(input, mode);
      await tab(output, mode);
      for (const [name, pane, other, x] of [
        ["Input", input, output, 8],
        ["Output", output, input, 1432],
      ]) {
        await prepared.fill("2,4");
        await selected.fill("3,5");
        const focus =
          mode === "Grid"
            ? other.locator(".page-image").first()
            : other.getByRole("region", { name: "PDF viewport", exact: true });
        await focus.focus();
        await page.mouse.move(x, 20);
        for (const key of ["Control+a", "Control+a", "Meta+a"]) {
          await page.keyboard.press(key);
          assert.equal(await prepared.inputValue(), name === "Input" ? "1-13" : "2,4");
          assert.equal(await selected.inputValue(), name === "Output" ? "1-13" : "3,5");
          assert.equal(
            await focus.evaluate((element) => element === document.activeElement),
            true,
            `${name} ${mode}: selecting the mouse pane preserves focus in the other pane`,
          );
        }
        await page.keyboard.press("Escape");
        assert.equal(await prepared.inputValue(), name === "Input" ? "" : "2,4");
        assert.equal(await selected.inputValue(), name === "Output" ? "" : "3,5");
        assert.equal(
          await pane
            .getByRole("tab", { name: mode, exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        );
      }
    }
    await prepared.fill("2,4");
    await selected.fill("3,5");
    await page.mouse.move(1432, 20);
    await prepared.focus();
    await page.keyboard.press("Control+a");
    assert.deepEqual(await prepared.evaluate((element) => [element.selectionStart, element.selectionEnd]), [0, 3]);
    assert.equal(await selected.inputValue(), "3,5", "Ctrl+A in a field selects text");
    await prepared.press("v");
    assert.equal(await prepared.inputValue(), "v", "Fields retain letter entry");
    await prepared.fill("2,4");
    await output.getByLabel("Output page actions", { exact: true }).click();
    await page.keyboard.press("Control+a");
    assert.equal(await selected.inputValue(), "3,5", "An open menu keeps selection shortcuts");
    await page.keyboard.press("Escape");
    assert.equal(await prepared.inputValue(), "2,4");
    assert.equal(await selected.inputValue(), "3,5", "Escape closes the menu before clearing selection");
    await tab(input, "Grid");
    await tab(output, "Page");
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).focus();
    await page.mouse.move(1432, 20);
    for (const [key, number] of [
      ["End", 13],
      ["Home", 1],
    ]) {
      await page.keyboard.press(key);
      assert.equal(
        await input
          .getByRole("button", { name: `Select Input page ${number}`, exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Grid Home/End keep their focus target",
      );
      assert.equal(await prepared.inputValue(), "2,4");
      assert.match(await pagePosition(output), /1\s*\/ 13/, "Grid navigation does not browse the other Page");
    }
    await page.mouse.move(8, 20);
    await output.getByRole("region", { name: "PDF viewport", exact: true }).focus();
    await page.keyboard.press("v");
    const viewport = input.getByRole("region", { name: "PDF viewport", exact: true });
    assert.equal(await viewport.evaluate((element) => element === document.activeElement), true);
    assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true");
    await page.keyboard.press("Tab");
    assert.equal(
      await viewport.evaluate((element) => element === document.activeElement),
      false,
      "Tab moves focus normally",
    );
    await page.keyboard.press("Shift+Tab");
    assert.equal(await viewport.evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Shift+V");
    assert.equal(
      await input
        .getByRole("button", { name: "Select Input page 1", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    assert.equal(await prepared.inputValue(), "2,4");
    assert.equal(await selected.inputValue(), "3,5");
    await input.getByRole("button", { name: "Clear page sequence", exact: true }).click();
    const action = input.getByRole("button", { name: "Add Input page 1 to Output", exact: true });
    await action.focus();
    await page.mouse.move(8, 20);
    await page.keyboard.press("Control+a");
    assert.equal(
      await prepared.evaluate((element) => element === document.activeElement),
      true,
      "When selection removes the focused footer action, focus returns to the field",
    );
    await page.setViewportSize({ width: 390, height: 1000 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = "dark";
      document.documentElement.style.fontSize = "200%";
    });
    for (const [name, pane] of [
      ["Input", input],
      ["Output", output],
    ]) {
      await page
        .getByRole("navigation", { name: "Workspace view", exact: true })
        .getByRole("button", { name, exact: true })
        .click();
      const pages = pane.getByLabel("Page selection", { exact: true });
      await pages.fill("2,4");
      await pane.getByRole("tab", { name: name === "Input" ? "Grid" : "Page", exact: true }).focus();
      await page.mouse.move(name === "Input" ? 382 : 8, 20);
      await page.keyboard.press("Control+a");
      assert.equal(await pages.inputValue(), "1-13", "The visible mobile pane receives shortcuts from either half");
      await page.keyboard.press("Escape");
      assert.equal(await pages.inputValue(), "");
    }
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Page and Grid keyboard actions respect key priority and the visible page order", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Keyboard.pdf", mimeType: "application/pdf", buffer: fixture() });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    const selection = input.getByRole("textbox", { name: "Page selection", exact: true });
    const total = () => output.locator(".composition-totals strong").innerText();
    const ready = () =>
      page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    await input.getByRole("button", { name: "Select Input page 1", exact: true }).waitFor();
    const cards = input.locator("button.page-image");
    await input.getByRole("button", { name: "Select or drag Input page 1 to Output", exact: true }).click();
    assert.equal(await selection.inputValue(), "1", "Clicking a grip selects the page");
    assert.equal(
      await cards
        .first()
        .evaluate((element) => getComputedStyle(element.closest(".composition-card")).outlineStyle === "dashed"),
      false,
      "Mouse selection does not add a keyboard focus frame",
    );
    await page.keyboard.press("Space");
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowUp");
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".composition-grid")), true);
    await page.keyboard.press("ArrowRight");
    assert.equal(await cards.first().evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("ArrowRight");
    assert.equal(await cards.nth(1).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("Shift+P");
    assert.equal(await cards.first().evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("n");
    assert.equal(await cards.nth(1).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("ArrowDown");
    assert.equal(await cards.nth(4).evaluate((element) => element === document.activeElement), true);
    await page.keyboard.press("ArrowUp");
    assert.equal(await cards.nth(1).evaluate((element) => element === document.activeElement), true);
    assert.equal(await selection.inputValue(), "");
    await page.keyboard.press("Space");
    assert.equal(await selection.inputValue(), "2");
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Input page 3");
    assert.equal(await cards.nth(2).evaluate(hasCursor), true, "The keyboard position has a secondary contour");
    await page.keyboard.press("Enter");
    assert.equal(await total(), "1 PDF page");
    await cards.nth(1).dispatchEvent("keydown", { key: "Enter", repeat: true });
    assert.equal(await total(), "1 PDF page");
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus();
    assert.equal(await output.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "1");
    await page.keyboard.press("Enter");
    assert.equal(await total(), "2 PDF pages");
    await page.keyboard.press("ArrowRight");
    assert.equal(await page.evaluate(() => document.activeElement?.matches(".composition-grid")), true);
    await page.keyboard.press("ArrowLeft");
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("");
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus();
    await page.keyboard.press("ArrowRight");
    for (const [key, position] of [
      ["n", 0],
      ["p", 2],
      ["p", 1],
      ["Shift+N", 2],
    ]) {
      await page.keyboard.press(key);
      if (!position)
        assert.equal(await page.evaluate(() => document.activeElement?.matches(".composition-grid")), true);
      else
        assert.equal(
          await output
            .getByRole("button", { name: `Select Output page ${position}`, exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        );
      assert.equal(await total(), "2 PDF pages", "N/P navigate without editing the composition");
    }
    await page.keyboard.press("Space");
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).focus();
    await page.keyboard.press("Control+ArrowLeft");
    assert.equal(
      await output
        .getByRole("button", { name: "Select Output page 2", exact: true })
        .evaluate((element) => element === document.activeElement),
      true,
    );
    await page.keyboard.press("Control+ArrowLeft");
    assert.equal(await total(), "2 PDF pages");
    const movingCard = await output.locator(".composition-card").last().getAttribute("id");
    for (const [key, position] of [
      ["Control+ArrowRight", 1],
      ["Control+ArrowRight", 1],
      ["Control+ArrowLeft", 2],
      ["Control+ArrowLeft", 2],
      ["Control+ArrowRight", 1],
      ["Control+ArrowLeft", 2],
    ]) {
      await page.keyboard.press(key);
      assert.deepEqual(
        await output.locator(".output-pages").evaluate(() => {
          const focused = document.activeElement;
          const card = focused?.closest(".composition-card");
          return {
            id: card?.id,
            name: focused?.getAttribute("aria-label"),
            frame: card && getComputedStyle(card).outlineStyle,
          };
        }),
        { id: movingCard, name: `Select Output page ${position}`, frame: "none" },
        "Movement retains the same page focus without a separate card frame",
      );
    }
    await page.keyboard.press("Shift+Equal");
    assert.equal(await total(), "3 PDF pages");
    await page.keyboard.press("-");
    assert.equal(await total(), "2 PDF pages");
    await output.getByRole("button", { name: "Select Output page 1", exact: true }).waitFor();
    await page.waitForFunction(() => document.activeElement?.getAttribute("aria-label") === "Select Output page 2");
    await page.keyboard.press("p");
    await ready();
    await cards.nth(1).press("v");
    await tab(output, "Page");
    const inputViewport = input.getByRole("region", { name: "PDF viewport", exact: true });
    const outputViewport = output.getByRole("region", { name: "PDF viewport", exact: true });
    await page.setViewportSize({ width: 1440, height: 600 });
    for (const pane of [input, output]) {
      const viewport = pane.getByRole("region", { name: "PDF viewport", exact: true });
      await viewport.evaluate((element) => element.scrollIntoView({ block: "start" }));
      let bounds = await viewport.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, Math.max(bounds.y, 0) + 100);
      const beforeFit = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, -120);
      await page.waitForFunction((before) => scrollY < before, beforeFit);
      assert.equal(await viewport.evaluate((element) => element.scrollTop), 0);

      await zoom(pane, "Zoom in");
      await ready();
      await viewport.evaluate((element) => {
        element.scrollIntoView({ block: "start" });
        element.scrollTop = 0;
      });
      bounds = await viewport.boundingBox();
      await page.mouse.move(bounds.x + bounds.width / 2, Math.max(bounds.y, 0) + 100);
      const beforeZoom = await page.evaluate(() => scrollY);
      await page.mouse.wheel(0, 120);
      await page.waitForFunction((element) => element.scrollTop > 0, await viewport.elementHandle());
      assert.equal(await page.evaluate(() => scrollY), beforeZoom);
      await viewport.evaluate((element) => (element.scrollTop = element.scrollHeight));
      await page.mouse.wheel(0, 120);
      await page.waitForTimeout(100);
      assert.equal(await page.evaluate(() => scrollY), beforeZoom, "Zoom contains wheel scrolling at an edge");

      for (const key of ["0", "z", "Shift+Z"]) {
        await viewport.focus();
        await page.keyboard.press(key);
        assert.equal(await pane.locator(".page-tools output").innerText(), "100%");
        if (key !== "Shift+Z") await zoom(pane, "Zoom in");
      }
    }
    await page.setViewportSize({ width: 2560, height: 1100 });
    await ready();
    await inputViewport.focus();
    await outputViewport.hover();
    await page.keyboard.press("ArrowRight");
    assert.match(await pagePosition(input), /2\s*\/ 7/);
    assert.match(await pagePosition(output), /1\s*\/ 2/);
    await page.keyboard.press("n");
    assert.match(await pagePosition(input), /2\s*\/ 7/);
    assert.match(await pagePosition(output), /2\s*\/ 2/, "Mouse position chooses Page despite focus in the other pane");
    await input.locator(".inspection-heading").hover();
    await page.keyboard.press("Shift+P");
    await page.keyboard.press("Space");
    assert.equal(await total(), "3 PDF pages");
    await inputViewport.dispatchEvent("keydown", { key: " ", repeat: true });
    assert.equal(await total(), "3 PDF pages");
    assert.equal(await selection.inputValue(), "");
    for (let index = 0; index < 8; index++) await page.keyboard.press("p");
    assert.match(await pagePosition(input), /1\s*\/ 7/);
    for (let index = 0; index < 8; index++) await page.keyboard.press("n");
    assert.match(await pagePosition(input), /7\s*\/ 7/);
    await page.keyboard.press("Control+ArrowLeft");
    assert.match(await pagePosition(input), /7\s*\/ 7/);
    await outputViewport.focus();
    await outputViewport.hover();
    await page.keyboard.press("Space");
    assert.equal(await total(), "4 PDF pages");
    await page.keyboard.press("Home");
    await zoom(output, "Zoom in");
    await ready();
    await outputViewport.focus();
    await outputViewport.evaluate((element) => (element.scrollTop = 200));
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollTop > 200);
    const scrolled = await outputViewport.evaluate((element) => element.scrollTop);
    await page.keyboard.press("ArrowUp");
    await page.waitForFunction(
      (previous) => document.querySelector(".composition-output .page-scroll").scrollTop < previous,
      scrolled,
    );
    assert.match(await pagePosition(output), /1\s*\/ 4/);
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%");
    await page.keyboard.press("Shift+Equal");
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%");
    await ready();
    await outputViewport.evaluate((element) => (element.scrollLeft = 100));
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollLeft > 100);
    const horizontal = await outputViewport.evaluate((element) => element.scrollLeft);
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(
      (previous) => document.querySelector(".composition-output .page-scroll").scrollLeft < previous,
      horizontal,
    );
    assert.match(await pagePosition(output), /1\s*\/ 4/);
    await outputViewport.evaluate((element) => (element.scrollLeft = 0));
    await page.keyboard.press("ArrowLeft");
    assert.equal(await outputViewport.evaluate((element) => element.scrollLeft), 0);
    assert.match(await pagePosition(output), /1\s*\/ 4/);
    await outputViewport.evaluate((element) => (element.scrollLeft = element.scrollWidth));
    await page.keyboard.press("ArrowRight");
    assert.match(await pagePosition(output), /1\s*\/ 4/);
    await page.keyboard.press("n");
    assert.match(await pagePosition(output), /2\s*\/ 4/);
    await page.keyboard.press("p");
    assert.match(await pagePosition(output), /1\s*\/ 4/);
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%");
    await page.keyboard.press("-");
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%");
    for (let step = 0; step < 8; step++) await page.keyboard.press("Shift+Equal");
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "400%");
    for (let step = 0; step < 8; step++) await page.keyboard.press("-");
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "50%");
    await page.keyboard.press("Shift+Equal");
    await page.keyboard.press("Shift+Equal");
    await ready();
    await page.locator(".composition-output .section-heading h2").click();
    for (const zone of [".inspection-heading", ".page-scroll", ".page-navigation"]) {
      await output.locator(zone).hover({ position: { x: 4, y: 4 } });
      await page.keyboard.press("n");
    }
    assert.match(await pagePosition(output), /4\s*\/ 4/);
    await page.keyboard.press("Shift+Equal");
    assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "200%");
    await page.keyboard.press("-");
    assert.equal(await total(), "4 PDF pages");
    await ready();
    await outputViewport.evaluate((element) => (element.scrollLeft = 100));
    await page.keyboard.press("ArrowRight");
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollLeft > 100);
    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollLeft === 100);
    assert.match(await pagePosition(output), /4\s*\/ 4/);
    await outputViewport.evaluate((element) => (element.scrollTop = 200));
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction(() => document.querySelector(".composition-output .page-scroll").scrollTop > 200);
    await page.keyboard.press("ArrowUp");
    assert.match(await pagePosition(output), /4\s*\/ 4/);
    await output.getByRole("textbox", { name: "Page selection", exact: true }).fill("1");
    await output.getByRole("button", { name: "Duplicate selected Output pages", exact: true }).press("Space");
    assert.equal(await total(), "5 PDF pages");
    await selection.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("Space");
    assert.equal(await total(), "5 PDF pages");
    assert.match(await pagePosition(output), /5\s*\/ 5/, "Insertion before the inspected page preserves its identity");
    await output.getByRole("button", { name: "Previous Output page", exact: true }).click();
    await output.getByRole("button", { name: "Next Output page", exact: true }).focus();
    await page.keyboard.press("Space");
    assert.match(await pagePosition(output), /5\s*\/ 5/);
    assert.equal(await total(), "5 PDF pages");
    await page.setViewportSize({ width: 390, height: 900 });
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Input", exact: true })
      .click();
    await tab(input, "Grid");
    await cards.first().focus();
    await page.keyboard.press("ArrowDown");
    assert.equal(await cards.nth(2).evaluate((element) => element === document.activeElement), true);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "Page shortcuts follow the mouse side and page counters open a stable inline entry",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
      page.setDefaultTimeout(10000);
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(server.resolvedUrls.local[0]);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "Pages.pdf", mimeType: "application/pdf", buffer: fixture() });
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const prepared = input.getByLabel("Page selection", { exact: true });
      const selected = output.getByLabel("Page selection", { exact: true });
      await prepared.fill("1-7");
      await prepared.press("Enter");
      await prepared.fill("2,4");
      await selected.fill("3,5");
      await tab(input, "Page");
      await tab(output, "Page");
      for (const [name, pane, other, x] of [
        ["Input", input, output, 8],
        ["Output", output, input, 1432],
      ]) {
        const viewport = other.getByRole("region", { name: "PDF viewport", exact: true });
        await viewport.focus();
        await page.mouse.move(x, 20);
        for (const [key, value] of [
          ["=", "150%"],
          ["-", "100%"],
          ["Shift+Equal", "150%"],
          ["0", "100%"],
          ["Shift+Equal", "150%"],
          ["Shift+Z", "100%"],
        ]) {
          await page.keyboard.press(key);
          assert.equal(await pane.getByLabel(`${name} page zoom`, { exact: true }).innerText(), value);
          assert.equal(
            await viewport.evaluate((element) => element === document.activeElement),
            true,
            "Zoom never moves focus",
          );
        }
        for (const [key, number] of [
          ["PageDown", 2],
          ["PageUp", 1],
          ["n", 2],
          ["Shift+P", 1],
          ["End", 7],
          ["PageDown", 7],
          ["Home", 1],
          ["PageUp", 1],
        ]) {
          await page.keyboard.press(key);
          assert.match(await pagePosition(pane), new RegExp(`${number}\\s*\\/ 7`), `${name}: ${key}`);
          assert.equal(
            await viewport.evaluate((element) => element === document.activeElement),
            true,
            "Browsing never moves focus",
          );
        }
        const counter = () => pane.locator(".page-current").boundingBox();
        const total = () => pane.locator(".page-total").boundingBox();
        await aligned(pane);
        const before = [await counter(), await total()];
        await page.keyboard.press(name === "Input" ? "g" : "Shift+G");
        const field = pane.getByRole("textbox", { name: `Go to ${name} page`, exact: true });
        await field.waitFor();
        assert.equal(
          await field.evaluate(
            (element) =>
              element === document.activeElement &&
              element.selectionStart === 0 &&
              element.selectionEnd === element.value.length,
          ),
          true,
        );
        assert.deepEqual([await counter(), await total()], before, "G keeps both parts of the counter in place");
        for (const value of ["", "0", "8", "1.5", "-1", "2x", "9007199254740993"]) {
          await field.fill(value);
          await field.press("Enter");
          assert.equal(await field.getAttribute("aria-invalid"), "true", `Invalid page ${value} stays editable`);
          assert.equal(
            await pane.getByRole("button", { name: `Previous ${name} page`, exact: true }).isDisabled(),
            true,
            "Invalid entry does not navigate",
          );
        }
        await field.press("Escape");
        assert.match(await pagePosition(pane), /1\s*\/ 7/);
        await pane.locator(".page-total").click();
        await field.waitFor();
        assert.deepEqual([await counter(), await total()], before, "Clicking the total keeps the counter in place");
        await field.fill("3");
        await field.press("Enter");
        assert.match(await pagePosition(pane), /3\s*\/ 7/);
        assert.equal(
          await pane
            .getByRole("region", { name: "PDF viewport", exact: true })
            .evaluate((element) => element === document.activeElement),
          true,
        );
        assert.equal(await prepared.inputValue(), "2,4");
        assert.equal(await selected.inputValue(), "3,5");
      }
      await tab(input, "Grid");
      await page.evaluate(() => document.activeElement?.blur());
      await page.mouse.move(8, 20);
      await page.keyboard.press("End");
      assert.match(
        await pagePosition(output),
        /7\s*\/ 7/,
        "A closed Page on the pointer side falls back to the other Page",
      );
      await page.keyboard.press("Shift+Equal");
      assert.equal(await output.getByLabel("Output page zoom", { exact: true }).innerText(), "150%");
      const gridPage = input.getByRole("button", { name: "Select Input page 1", exact: true });
      await gridPage.focus();
      await page.keyboard.press("n");
      assert.equal(
        await input
          .getByRole("button", { name: "Select Input page 2", exact: true })
          .evaluate((element) => element === document.activeElement),
        true,
        "Conflicting Grid shortcuts keep their target",
      );
      await prepared.focus();
      await prepared.press("Home");
      assert.equal(await prepared.evaluate((element) => element.selectionStart === 0), true, "Fields retain Home");
      await tab(output, "Grid");
      await page.evaluate(() => {
        document.activeElement?.blur();
        scrollTo(0, 0);
      });
      for (const key of ["Shift+Equal", "-", "0", "z", "Home", "End", "g"]) await page.keyboard.press(key);
      assert.equal(
        await page.evaluate(() => document.activeElement === document.body && scrollY === 0),
        true,
        "No Page means no focus or scroll changes",
      );
      assert.equal(await page.locator(".page-jump").count(), 0);
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.evaluate(() => {
        document.documentElement.dataset.theme = "dark";
        document.documentElement.style.fontSize = "200%";
      });
      for (const [name, pane] of [
        ["Input", input],
        ["Output", output],
      ]) {
        await page
          .getByRole("navigation", { name: "Workspace view", exact: true })
          .getByRole("button", { name, exact: true })
          .click();
        await tab(pane, "Page");
        await pane.getByRole("button", { name: `Go to ${name} page`, exact: true }).scrollIntoViewIfNeeded();
        await aligned(pane);
        const counter = () =>
          pane.locator(".inspection-heading").evaluate((heading) => {
            const origin = heading.getBoundingClientRect();
            return [".page-current", ".page-total", ".page-grip"].map((selector) => {
              const rect = heading.querySelector(selector)?.getBoundingClientRect();
              return rect && { x: rect.x - origin.x, y: rect.y - origin.y, width: rect.width, height: rect.height };
            });
          });
        const before = await counter();
        await pane.getByRole("button", { name: `Go to ${name} page`, exact: true }).click();
        const field = pane.getByRole("textbox", { name: `Go to ${name} page`, exact: true });
        await field.waitFor();
        assert.deepEqual(await counter(), before, "Enlarged mobile text preserves the counter and Input grip");
        const bounds = await field.boundingBox();
        assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 390, "The larger entry stays in the pane");
        await field.press("Escape");
        await page.evaluate(() => document.activeElement?.blur());
        await page.mouse.move(name === "Input" ? 382 : 8, 20);
        await page.keyboard.press("Home");
        assert.match(await pagePosition(pane), /1\s*\/ 7/, "Hidden mobile Pages do not take shortcuts");
      }
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Input switching renders thumbnails and the lens from the selected PDF", { timeout: 60000 }, async () => {
  const temporary = resolvePath("../.local/tmp/web");
  await mkdir(temporary, { recursive: true });
  const outDir = await mkdtemp(join(temporary, "input-switching-"));
  let server, browser;
  try {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      await build({ build: { outDir, emptyOutDir: true }, logLevel: "warn" });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    server = await preview({
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
      logLevel: "warn",
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      reducedMotion: "reduce",
    });
    page.setDefaultTimeout(10000);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    const input = page.locator(".selection-panel");
    const thumbnail = input.locator(".page-image .thumbnail canvas");
    const lens = page.getByRole("region", { name: "Magnified page 1 at 16×", exact: true });
    const inspect = async (name, color) => {
      assert.equal(await page.locator(".input-current").textContent(), name);
      assert.equal(
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).getAttribute("aria-pressed"),
        String(name === "Filled.pdf"),
        "Production retains each Source's grid density",
      );
      await input.locator(".page-image .thumbnail[aria-busy=false]").waitFor();
      const expected = [color, color, color, 255];
      assert.deepEqual(await pixel(thumbnail, 0.7), expected, `${name}: thumbnail content`);
      await page.mouse.move(0, 0);
      const bounds = await thumbnail.boundingBox();
      await thumbnail.hover({ position: { x: bounds.width / 2, y: bounds.height * 0.7 } });
      await lens.waitFor();
      await page.waitForFunction(() => document.querySelector(".lens")?.getAttribute("aria-busy") === "false");
      assert.deepEqual(await pixel(lens.locator("canvas"), 0.5), expected, `${name}: lens content`);
    };
    const documents = [
      { name: "Filled.pdf", buffer: fixture(false, false, 0, false, true), color: 0 },
      { name: "Outline.pdf", buffer: fixture(false), color: 255 },
    ];
    for (const document of documents) {
      await page.locator("input[type=file]").first().setInputFiles({
        name: document.name,
        mimeType: "application/pdf",
        buffer: document.buffer,
      });
      await page.locator(".input-current").filter({ hasText: document.name }).waitFor();
      if (document.name === "Filled.pdf")
        await input.getByRole("button", { name: "Compact Input grid", exact: true }).click();
      await inspect(document.name, document.color);
    }
    for (const index of [0, 1, 0, 1]) {
      await page.locator(".input-picker > summary").focus();
      await page.keyboard.press("Enter");
      await page.locator(".input-list button[data-source]").nth(index).focus();
      await page.keyboard.press("Enter");
      await lens.waitFor({ state: "detached" });
      await inspect(documents[index].name, documents[index].color);
    }
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    if (server)
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
    await rm(outDir, { recursive: true, force: true });
  }
});

test(
  "Style requires applicable Output references and retains independent Source choices",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10000);
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19");
        window.styleRequests = 0;
        const Original = window.Worker;
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (message.changes) window.styleRequests++;
            super.postMessage(message, ...rest);
          }
        };
      });
      await page.goto(server.resolvedUrls.local[0]);
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      const open = async (name, buffer) => {
        const count = await page.locator(".input-list button[data-source]").count();
        await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer });
        await page.locator(".input-current").filter({ hasText: name }).waitFor();
        await page.waitForFunction(
          (previous) => document.querySelectorAll(".input-list button[data-source]").length === previous + 1,
          count,
        );
      };
      const choose = async (index) => {
        await page.locator(".input-picker > summary").click();
        await page.locator(".input-list button[data-source]").nth(index).click();
      };
      const style = () => input.getByRole("tab", { name: "Style", exact: true }).click();
      const color = () =>
        input
          .locator("article.control")
          .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
          .locator("input[type=text]");
      const ready = () => output.getByRole("button", { name: "Download", exact: true }).waitFor();
      const add = async (selection) => {
        await input.getByRole("tab", { name: "Grid", exact: true }).click();
        await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(selection);
        await input.getByRole("button", { name: "Add to Output", exact: true }).click();
        await ready();
      };
      await open("Styled.pdf", fixture(true, false, 2));
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true);
      await input.getByRole("tab", { name: "Page", exact: true }).click();
      await input.getByRole("button", { name: "Next Input page", exact: true }).click();
      assert.equal(await page.evaluate(() => window.styleRequests), 0);
      await add("2,3");
      await style();
      const authoredColor = await color().inputValue();
      await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet");
      await ready();
      await color().fill("#123456");
      await ready();
      await open("Styled.pdf", fixture(true, false, 2));
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true);
      await add("2");
      await style();
      assert.equal(await color().inputValue(), authoredColor);
      await color().fill("#abcdef");
      await ready();
      await output.getByRole("tab", { name: "Page", exact: true }).click();
      await output.getByRole("button", { name: "Select all", exact: true }).click();
      assert.equal(await output.getByRole("tab", { name: "Page", exact: true }).getAttribute("aria-selected"), "true");
      await output.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true);
      const requests = await page.evaluate(() => window.styleRequests);
      await open("Ordinary.pdf", fixture(false));
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).count(), 0);
      await add("1");
      await choose(0);
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true);
      await add("2");
      await style();
      assert.equal(await color().inputValue(), "#123456");
      await choose(1);
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).isDisabled(), true);
      await add("2");
      await style();
      assert.equal(await color().inputValue(), "#abcdef");
      assert.equal(await page.evaluate(() => window.styleRequests), requests);
      const pending = page.waitForEvent("download");
      await output.getByRole("button", { name: "Download", exact: true }).click();
      const downloaded = await pending;
      const bytes = await readFile(await downloaded.path());
      const colors = await page.evaluate(async (buffer) => {
        const { Processor } = await import("/src/processor.ts");
        const processor = new Processor();
        try {
          const result = await processor.run(Uint8Array.from(buffer), 1);
          return Object.values(result.description.parameters)
            .filter((entry) => entry.parameter.schema.title === "Guide color")
            .map((entry) => entry.parameter.value)
            .toSorted();
        } finally {
          processor.dispose();
        }
      }, Array.from(bytes));
      assert.deepEqual(colors, ["#123456", "#abcdef"]);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test(
  "Large Sources reuse selected-page PDFs and keep original page identities in Page and Compare",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await page.addInitScript(() => {
        localStorage.setItem("mainz:onboarding", "19");
        window.styleResults = [];
        const Original = window.Worker;
        window.Worker = class extends Original {
          postMessage(message, ...rest) {
            if (message.changes) {
              const record = { pages: message.changes.buffer?.pages, count: undefined };
              window.styleResults.push(record);
              this.addEventListener("message", function done(event) {
                if (event.data.revision === message.revision) {
                  record.count = event.data.description?.pageCount;
                  this.removeEventListener("message", done);
                }
              });
            }
            super.postMessage(message, ...rest);
          }
        };
      });
      await page.goto(server.resolvedUrls.local[0]);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Large.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, false, 0, false, false, {}, 51),
        });
      await page.locator(".input-current").filter({ hasText: "Large.pdf" }).waitFor();
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      await input.getByRole("button", { name: "Normal Input grid", exact: true }).click();
      const color = () =>
        input
          .locator("article.control")
          .filter({ has: page.locator("code.parameter-id", { hasText: "guides-stroke-color" }) })
          .locator("input[type=text]");
      const add = async (selection) => {
        await input.getByRole("tab", { name: "Grid", exact: true }).click();
        await input.getByRole("textbox", { name: "Page selection", exact: true }).fill(selection);
        await input.getByRole("button", { name: "Add to Output", exact: true }).click();
        await output.getByRole("button", { name: "Download", exact: true }).waitFor();
      };
      const change = async (value) => {
        await input.getByRole("tab", { name: "Style", exact: true }).click();
        await color().fill(value);
        await output.getByRole("button", { name: "Download", exact: true }).waitFor();
      };
      await add("47,3,25,3");
      await change("#123456");
      assert.deepEqual(await page.evaluate(() => window.styleResults), [{ pages: [2, 24, 46], count: 3 }]);
      for (const [position, original] of [
        [1, 47],
        [2, 3],
      ]) {
        const details = output.getByLabel(`Details for Output page ${position}`, { exact: true });
        await details.click();
        assert.match(
          await output.locator(".page-origin[open] .page-origin-info").innerText(),
          new RegExp(`Large\\.pdf\\s+p\\. ${original}`),
        );
        await details.click();
      }
      await output.getByRole("tab", { name: "Page", exact: true }).click();
      await output.locator('.page-scroll canvas[aria-label="PDF page 47"]').waitFor();
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor();
      const styled = await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL());
      await output.getByRole("button", { name: "Compare page", exact: true }).click();
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor();
      assert.notEqual(await output.locator(".page-scroll canvas").evaluate((canvas) => canvas.toDataURL()), styled);
      await output.getByRole("button", { name: "Show original page", exact: true }).click();
      await input.locator('.page-scroll canvas[aria-label="PDF page 47"]').waitFor();
      await input.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor();
      assert.match(await pagePosition(input), /47\s*\/ 51/);
      assert.equal(await input.getByRole("textbox", { name: "Page selection", exact: true }).inputValue(), "");
      await input.getByRole("tab", { name: "Grid", exact: true }).click();
      assert.equal(await input.getByRole("button", { name: "Select Input page 47", exact: true }).isVisible(), true);
      await output.getByRole("button", { name: "Compare page", exact: true }).click();
      await change("#654321");
      assert.deepEqual(await page.evaluate(() => window.styleResults.at(-1)), {
        pages: [2, 24, 46],
        count: 3,
      });
      await add("40");
      assert.deepEqual(await page.evaluate(() => window.styleResults.at(-1)), {
        pages: [2, 24, 39, 46],
        count: 4,
      });
      await output.getByRole("button", { name: "Next Output page", exact: true }).click();
      await output.locator('.page-scroll canvas[aria-label="PDF page 3"]').waitFor();
      await output.locator(".page-scroll .pdf-viewport[aria-busy=false]").waitFor();
      assert.match(await pagePosition(output), /2\s*\/ 5/);
      await add("1-13");
      assert.deepEqual(await page.evaluate(() => window.styleResults.at(-1)), {
        pages: undefined,
        count: 51,
      });
      assert.equal(await output.locator(".composition-totals strong").innerText(), "18 PDF pages");

      const sample = await readFile("test/fixtures/demo.pdf");
      const retained = await page.evaluate(async (bytes) => {
        const { Processor } = await import("/src/processor.ts");
        const processor = new Processor();
        const original = Uint8Array.from(bytes);
        const changes = { apply: {}, reset: [], buffer: { input: "ordinary-page", pages: [0] } };
        try {
          const first = await processor.run(original, 1, changes);
          const cached = await processor.run(original, 2, changes);
          return {
            first: first.description.pageCount,
            cached: cached.description.pageCount,
            size: cached.bytes.byteLength,
          };
        } finally {
          processor.dispose();
        }
      }, Array.from(sample));
      assert.equal(retained.first, 1);
      assert.equal(retained.cached, 1);
      assert.ok(retained.size > 0);
      assert.deepEqual(errors, []);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Style and Download cancellation release preview workers and retain choices", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    page.setDefaultTimeout(10000);
    await page.addInitScript(() => {
      localStorage.setItem("mainz:onboarding", "19");
      window.previewWorkers = [];
      const Original = window.Worker;
      window.Worker = class extends Original {
        constructor(url, options) {
          super(url, options);
          this.record = { url: String(url), terminated: false };
          window.previewWorkers.push(this.record);
        }
        terminate() {
          this.record.terminated = true;
          super.terminate();
        }
      };
    });
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Preview.pdf",
        mimeType: "application/pdf",
        buffer: fixture(true, false, 2),
      });
    await page.locator(".composer[aria-busy=false]").waitFor();
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2-3");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    await tab(input, "Style");
    await page.evaluate(async () => {
      const { openPDF } = await import("/src/pdf.ts");
      const task = await openPDF(new Uint8Array(await (await fetch("/demo.pdf")).arrayBuffer()));
      const pdf = await task.promise;
      const prototype = Object.getPrototypeOf(await pdf.getPage(1));
      const render = prototype.render;
      window.holdPDFRendering = true;
      window.pdfContinuations = [];
      prototype.render = function (...args) {
        const drawing = render.apply(this, args);
        drawing.onContinue = (proceed) => (window.holdPDFRendering ? window.pdfContinuations.push(proceed) : proceed());
        return drawing;
      };
      await task.destroy();
    });
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet");
    await page.waitForFunction(() => window.pdfContinuations.length > 0);
    await input.getByRole("button", { name: "Cancel style processing", exact: true }).click();
    await page.waitForFunction(
      () => window.previewWorkers.filter((worker) => worker.url.includes("pdf.worker")).at(-1).terminated,
    );
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet");
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages");
    assert.equal(await page.getByRole("button", { name: "Retry Input styles", exact: true }).count(), 1);
    await page.evaluate(() => {
      window.holdPDFRendering = false;
      window.pdfContinuations = [];
    });
    await page.getByRole("button", { name: "Retry Input styles", exact: true }).click();
    await output.getByRole("button", { name: "Download", exact: true }).waitFor();
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).inputValue(), "0.04");
    assert.equal(await page.locator(".error-banner").count(), 0);
    await page.evaluate(() => (window.holdPDFRendering = true));
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("generic");
    await page.waitForFunction(() => window.pdfContinuations.length > 0);
    await input.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet");
    await page.waitForFunction(
      () => window.previewWorkers.filter((worker) => worker.url.includes("pdf.worker")).at(-1).terminated,
    );
    assert.equal(await output.getByRole("button", { name: "Download", exact: true }).isEnabled(), true);
    assert.equal(await page.locator(".error-banner").count(), 0);
    await page.evaluate(() => (window.pdfContinuations = []));
    const downloads = [];
    page.on("download", (download) => downloads.push(download));
    await page.evaluate(() => (window.holdPDFRendering = true));
    await output.getByRole("button", { name: "Download", exact: true }).click();
    await page.waitForFunction(() => window.pdfContinuations.length > 0);
    await page.getByRole("dialog", { name: "Download", exact: true }).press("Escape");
    await page.waitForFunction(
      () => window.previewWorkers.filter((worker) => worker.url.includes("pdf.worker")).at(-1).terminated,
    );
    assert.equal(await page.getByRole("dialog", { name: "Download", exact: true }).isVisible(), false);
    assert.equal(downloads.length, 0);
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages");
    assert.equal(await input.getByRole("combobox", { name: "Style profile", exact: true }).inputValue(), "inkjet");
    await page.evaluate(() => {
      window.holdPDFRendering = false;
      window.pdfContinuations = [];
    });
    const saved = page.waitForEvent("download");
    await output.getByRole("button", { name: "Download", exact: true }).click();
    assert.equal(await (await saved).failure(), null);
    assert.equal(downloads.length, 1);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "Info reports actions, errors stay above the workspace, and newer feedback survives style processing",
  { timeout: 60000 },
  async () => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      page.setDefaultTimeout(10000);
      await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
      await page.goto(server.resolvedUrls.local[0]);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Status.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, false, 2),
        });
      const status = page.locator(".footnote [role=status]");
      await page.locator(".input-current").filter({ hasText: "Status.pdf" }).waitFor({ timeout: 60000 });
      const input = page.locator(".selection-panel"),
        output = page.locator(".composition-output");
      await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3");
      await input.getByRole("button", { name: "Add to Output", exact: true }).click();
      assert.equal(await status.textContent(), "Added 2 pages to Output.");
      await input.getByRole("tab", { name: "Style", exact: true }).click();
      const profile = input.getByRole("combobox", { name: "Style profile", exact: true });
      await profile.selectOption("inkjet");
      await status.filter({ hasText: "Applied Inkjet profile." }).waitFor();
      const width = input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true });
      assert.equal(await width.inputValue(), "0.04");
      await width.fill("0");
      const validation = page.locator(".error-banner");
      assert.match(await validation.textContent(), /Invalid value for Guide width\. Width must be greater than zero\./);
      assert.equal(await status.count(), 0);
      assert.equal(
        await validation.evaluate((element) => getComputedStyle(element).color),
        await input.locator(".style-status [role=status]").evaluate((element) => getComputedStyle(element).color),
      );
      assert.notEqual(
        await validation.evaluate((element) => getComputedStyle(element).color),
        await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
      );
      await input.getByRole("button", { name: "Reset Guide Width", exact: true }).click();
      await status.filter({ hasText: "Restored Guide width to the original style." }).waitFor();
      assert.equal(
        await status.evaluate((element) => getComputedStyle(element).color),
        await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
      );
      assert.equal(Number(await width.inputValue()), 0.2 * (25.4 / 72)); // The authored 0.2 pt width in mm.
      await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      await output.getByRole("button", { name: "Select Output page 2", exact: true }).click();
      await output.getByLabel("Output page actions", { exact: true }).click();
      // Both actions occur before the debounced style processing starts.
      await page.evaluate(() => {
        const select = document.querySelector(".style-profile select");
        select.value = "inkjet";
        select.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector('button[aria-label="Move selected pages earlier"]').click();
      });
      await output.getByRole("button", { name: "Download", exact: true }).waitFor();
      assert.equal(await width.inputValue(), "0.04");
      assert.equal(await status.textContent(), "Moved 1 page earlier.");
      await page.evaluate(() => {
        const select = document.querySelector(".style-profile select");
        select.value = "generic";
        select.dispatchEvent(new Event("change", { bubbles: true }));
      });
      await input.getByRole("button", { name: "Cancel style processing", exact: true }).click();
      assert.equal(await status.textContent(), "Cancelled style processing. Your choices are retained.");
      await page.setViewportSize({ width: 390, height: 1000 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await checkStatus(page);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.setViewportSize({ width: 1440, height: 1000 });
      await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
      await page.getByRole("button", { name: "Retry Input styles", exact: true }).click();
      await status.filter({ hasText: "Updated styles." }).waitFor();
      const pending = page.waitForEvent("download");
      await output.getByRole("button", { name: "Download", exact: true }).click();
      const saved = await pending;
      assert.equal(await saved.failure(), null);
      assert.equal(await status.textContent(), `Downloaded 2 pages · ${saved.suggestedFilename()}.`);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Broken.pdf",
          mimeType: "application/pdf",
          buffer: Buffer.from("invalid PDF"),
        });
      await page.locator(".error-banner").filter({ hasText: "Could not open Broken.pdf." }).waitFor();
      assert.equal(await status.count(), 0);
      assert.match(await page.locator(".error-banner").textContent(), /PDF Studio cannot read this PDF/);
      assert.equal(await page.locator(".composition-totals strong").textContent(), "2 PDF pages");
      assert.equal(await page.locator(".error-banner").count(), 1);
      // Preserve PDF byte offsets to isolate an unknown manifest field.
      const unknown = Buffer.from(fixture().toString().replace('"groups":', '"extra": '));
      await page.locator("input[type=file]").first().setInputFiles({
        name: "Unknown.pdf",
        mimeType: "application/pdf",
        buffer: unknown,
      });
      await page.locator(".error-banner").filter({ hasText: "Could not open Unknown.pdf." }).waitFor();
      assert.equal(await status.count(), 0);
      const banner = page.locator(".error-banner");
      assert.match(await banner.textContent(), /style information.*invalid or incompatible/);
      assert.match(await banner.textContent(), /Your workspace is retained\. Choose a PDF to retry\./);
      assert.match(await banner.textContent(), /prepare it again with the current Mainz format/);
      assert.equal(await page.locator(".composition-totals strong").textContent(), "2 PDF pages");
      for (const [viewportWidth, text, colorScheme] of [
        [1440, "100%", "light"],
        [320, "200%", "dark"],
        [390, "200%", "light"],
      ]) {
        await page.setViewportSize({ width: viewportWidth, height: 1000 });
        await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await page.evaluate((value) => (document.documentElement.style.fontSize = value), text);
        assert.notEqual(
          await banner.evaluate((element) => getComputedStyle(element).color),
          await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
        );
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
        const bounds = await banner.boundingBox(),
          workspace = await page.locator(".composer").boundingBox();
        assert.ok(bounds.y + bounds.height <= workspace.y, "Document errors stay above the workspace");
        await checkStatus(page);
      }
      await page.getByRole("button", { name: "Dismiss error", exact: true }).focus();
      await page.keyboard.press("Enter");
      assert.equal(await banner.count(), 0);
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Quartets and profiles preserve PDF edits and open files without profiles", { timeout: 180000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1000 },
      acceptDownloads: true,
      reducedMotion: "reduce",
    });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0]);
    const sample = await readFile("test/fixtures/demo.pdf");
    const open = async (name, buffer) => {
      await page.locator("input[type=file]").first().setInputFiles({ name, mimeType: "application/pdf", buffer });
      await page.waitForFunction((label) => document.querySelector(".input-current")?.textContent === label, name, {
        timeout: 60000,
      });
      await page.locator(".composer:not([inert])").waitFor();
    };
    await open("demo.pdf", sample);
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("2,3");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    const chooser = input.getByRole("combobox", { name: "Style profile", exact: true });
    assert.equal(await chooser.inputValue(), "generic");
    const profileBox = await chooser.boundingBox();
    const selectionBox = await output.locator(".sequence-entry > .entry").boundingBox();
    assert.ok(Math.abs(profileBox.y - selectionBox.y) < 1, `Profile ${profileBox.y}, Output ${selectionBox.y}`);
    assert.ok(Math.abs(profileBox.height - selectionBox.height) < 1);
    assert.ok(await input.locator(".quartet").count());
    assert.equal(await page.locator(".status-input").textContent(), "demo.pdf");
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.getByRole("button", { name: "Help", exact: true }).click();
      await page.getByRole("button", { name: "Start Tour", exact: true }).click();
      const tour = page.getByRole("dialog", { name: "Product tour", exact: true });
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "input",
      );
      for (const step of ["input-grid", "input-page", "style", "style-profile"]) {
        await tour.getByRole("button", { name: "Next", exact: true }).click();
        await page.waitForFunction(
          (key) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === key,
          step,
        );
      }
      const target = page.locator('[data-tour-target="style-profile"]');
      assert.match(await tour.locator(".tour-progress").textContent(), /\/ 8/);
      assert.equal(await target.isVisible(), true);
      assert.equal(await target.getAttribute("data-tour-active"), "true");
      assert.equal(await input.getByRole("tab", { name: "Style", exact: true }).getAttribute("aria-selected"), "true");
      assert.equal(await chooser.inputValue(), "generic");
      await tour.getByRole("button", { name: "Next", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "output-grid",
      );
      await tour.getByRole("button", { name: "Back", exact: true }).click();
      await page.waitForFunction(
        () => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === "style-profile",
      );
      assert.equal(await target.isVisible(), true);
      await page.keyboard.press("Escape");
      assert.equal(await chooser.inputValue(), "generic");
      assert.equal(await output.locator(".composition-card").count(), 2);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    assert.deepEqual(
      await input.locator(".style-group > summary > span:not(.count) > span:first-child").allTextContents(),
      ["Patterns", "Guides", "Watermark"],
    );
    assert.equal(
      await input.getByText("Reference shapes and lighter repeats for writing practice.", { exact: true }).isVisible(),
      true,
    );
    const pattern = input.getByRole("group", { name: "Pattern", exact: true });
    const patternSection = input
      .locator(".style-group")
      .filter({ has: page.locator("summary").getByText("Patterns", { exact: true }) });
    assert.equal(await patternSection.getByRole("img", { name: "1 Style object", exact: true }).textContent(), "1");
    assert.equal(
      await pattern
        .getByText("Reference shapes across a full sheet or the first row or column of a partial sheet.", {
          exact: true,
        })
        .isVisible(),
      true,
    );
    assert.equal(await pattern.getByRole("checkbox").count(), 1);
    assert.deepEqual(
      await pattern
        .getByRole("img", { name: "Fill color: #999999", exact: true })
        .locator("span")
        .evaluate((element) => ({
          color: getComputedStyle(element).backgroundColor,
          opacity: getComputedStyle(element).opacity,
        })),
      { color: "rgb(153, 153, 153)", opacity: "1" },
    );
    assert.match(await pattern.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/);
    await checkGeometry(pattern);
    const watermark = input.getByRole("group", { name: "Stamp", exact: true });
    await checkGeometry(watermark);
    for (const label of ["Stroke Paint duo", "Width"])
      assert.equal(await watermark.getByRole("note", { name: `${label}: not applicable`, exact: true }).count(), 1);
    await watermark.getByLabel("Edit Fill", { exact: true }).click();
    await watermark.getByRole("textbox", { name: "Stamp Fill Color", exact: true }).fill("#336699");
    await watermark.getByRole("spinbutton", { name: "Stamp Fill Opacity (ratio)", exact: true }).fill("0.6");
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    assert.equal(await chooser.inputValue(), "generic");
    assert.match(await watermark.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /60%/);
    await page.keyboard.press("Escape");
    const guides = input.getByRole("group", { name: "Minors", exact: true });
    assert.match(
      await guides.getByRole("note", { name: "Fill Paint duo: not applicable", exact: true }).getAttribute("title"),
      /neither fill color nor fill opacity/,
    );
    const reveal = async (title, label) => {
      const group = input.getByRole("group", { name: title, exact: true });
      const summary = group.getByLabel(`Edit ${label === "Color" || label === "Opacity" ? "Stroke" : label}`, {
        exact: true,
      });
      if ((await summary.getAttribute("aria-expanded")) !== "true") await summary.click();
      return group;
    };
    const minor = input.getByRole("group", { name: "Minors", exact: true });
    const major = input.getByRole("group", { name: "Majors", exact: true });
    assert.equal(await input.getByRole("group", { name: "Slants", exact: true }).count(), 1);
    const guideSection = input
      .locator(".style-group")
      .filter({ has: page.locator("summary").getByText("Guides", { exact: true }) });
    await guideSection.locator(":scope > summary").click();
    assert.equal(await minor.isVisible(), false);
    const guideHelp = input.getByText("Reference lines for letter alignment.", {
      exact: true,
    });
    assert.equal(await guideHelp.isVisible(), true);
    await guideSection.locator(":scope > summary").press("Enter");
    assert.equal(await minor.isVisible(), true);
    assert.equal(await guideHelp.isVisible(), true);
    const labels = await guideSection.locator(".style-object > h4 > span:first-child").allTextContents();
    assert.deepEqual(labels, ["Slants", "Angles", "Minors", "Majors", "Halves"]);
    const visibility = pattern.getByRole("checkbox");
    await visibility.uncheck();
    assert.equal(await visibility.isChecked(), false);
    assert.equal(await pattern.locator(".quartet-panel:visible").count(), 0);
    await visibility.check();
    assert.equal(await visibility.isChecked(), true);
    await reveal("Minors", "Width");
    const baselineWidth = await minor
      .getByRole("spinbutton", { name: "Minors Stroke Width (mm)", exact: true })
      .inputValue();
    assert.ok(Math.abs(Number(baselineWidth) - 0.08) < 1e-6);
    await chooser.selectOption("inkjet");
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    assert.equal(await pattern.getByRole("img", { name: "Fill color: #6B7F99", exact: true }).count(), 1);
    await reveal("Minors", "Width");
    const widthHelp = minor
      .locator(".quartet-panel")
      .getByText("Thickness of the outlines, in millimeters.", { exact: true });
    assert.equal(await widthHelp.isVisible(), true);
    const widthControl = minor.getByRole("spinbutton", {
      name: "Minors Stroke Width (mm)",
      exact: true,
    });
    assert.equal(
      (await widthControl.getAttribute("aria-describedby")).split(" ").includes(await widthHelp.getAttribute("id")),
      true,
    );
    await page.mouse.move(0, 0);
    assert.equal(await minor.locator(".quartet-panel:visible > section").count(), 1);
    assert.equal(
      await minor
        .locator(".quartet-component")
        .nth(2)
        .locator(".quartet-value")
        .evaluate((element) => getComputedStyle(element).backgroundColor),
      "rgba(0, 0, 0, 0)",
    );
    assert.equal(
      await input.getByRole("spinbutton", { name: "Minors Stroke Width (mm)", exact: true }).inputValue(),
      "0.04",
    );
    assert.match(await input.locator(".style-profile").textContent(), /Finer guides and soft blue pattern fills/);
    const fillTrigger = pattern.getByLabel("Edit Fill", { exact: true });
    await fillTrigger.click();
    assert.equal(await minor.locator(".quartet-panel:visible").count(), 0);
    await pattern.getByRole("textbox", { name: "Pattern Fill Color", exact: true }).focus();
    await page.keyboard.press("Escape");
    assert.equal(await pattern.locator(".quartet-panel:visible").count(), 0);
    assert.equal(await fillTrigger.evaluate((element) => element === document.activeElement), true);
    await reveal("Minors", "Width");
    await checkStatus(page);
    const pending = page.waitForEvent("download", { timeout: 60000 });
    await output.getByRole("button", { name: "Download", exact: true }).click();
    const download = await pending;
    assert.equal(await download.failure(), null);
    const saved = await readFile(await download.path());
    await open("inkjet.pdf", saved);
    await output.getByRole("button", { name: "Clear Output selection", exact: true }).click();
    await output.getByRole("button", { name: "Remove Output page 2", exact: true }).click();
    await output.getByRole("button", { name: "Remove Output page 1", exact: true }).click();
    await input.getByRole("tab", { name: "Grid", exact: true }).click();
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    assert.equal(await chooser.inputValue(), "inkjet");
    await reveal("Minors", "Width");
    const width = input.getByRole("spinbutton", {
      name: "Minors Stroke Width (mm)",
      exact: true,
    });
    await width.fill("0.05");
    assert.equal(await chooser.inputValue(), "");
    assert.match(await chooser.textContent(), /Custom/);
    await chooser.selectOption("generic");
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    assert.equal(await width.inputValue(), baselineWidth);
    await reveal("Minors", "Opacity");
    const strokePaint = minor.getByRole("region", {
      name: "Stroke Paint duo editor",
      exact: true,
    });
    assert.equal(await strokePaint.getByRole("textbox", { name: "Minors Stroke Color", exact: true }).count(), 1);
    assert.equal(
      await strokePaint.getByRole("spinbutton", { name: "Minors Stroke Opacity (ratio)", exact: true }).count(),
      1,
    );
    const minorOpacity = input.getByRole("spinbutton", {
      name: "Minors Stroke Opacity (ratio)",
      exact: true,
    });
    const majorOpacity = major.locator('.quartet-text[title^="Stroke opacity:"]');
    const originalMajorOpacity = await majorOpacity.textContent();
    await minorOpacity.fill("0.3");
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    assert.equal(await minorOpacity.inputValue(), "0.3");
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity);
    const minorVisibility = minor.getByRole("checkbox");
    await minorVisibility.uncheck();
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    assert.match(await minor.locator('.quartet-text[title^="Stroke opacity:"]').textContent(), /30%/);
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity);
    const editedPending = page.waitForEvent("download", { timeout: 60000 });
    await output.getByRole("button", { name: "Download", exact: true }).click();
    const edited = await editedPending;
    assert.equal(await edited.failure(), null);
    await open("custom.pdf", await readFile(await edited.path()));
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    await reveal("Minors", "Opacity");
    assert.equal(await minorOpacity.inputValue(), "0.3");
    assert.equal(await watermark.getByRole("img", { name: "Fill color: #336699", exact: true }).count(), 1);
    assert.match(await watermark.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /60%/);
    assert.equal(await minorVisibility.isChecked(), false);
    assert.equal(await majorOpacity.textContent(), originalMajorOpacity);
    await minorVisibility.check();
    assert.match(await minor.locator('.quartet-text[title^="Stroke opacity:"]').textContent(), /30%/);
    await open("single.pdf", fixture(true, false, 1));
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    assert.equal(await input.locator(".style-profile").count(), 0);
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).count(), 1);
    await open("no-profile.pdf", fixture());
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    assert.equal(await input.locator(".style-profile").count(), 0);
    assert.equal(await page.locator(".error-banner").count(), 0);
    assert.equal(await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).count(), 1);
    await open("fill-only.pdf", fixture(true, false, 0, true, true));
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    const filled = input.getByRole("group", { name: "Guides", exact: true });
    await checkGeometry(filled);
    for (const label of ["Stroke Paint duo", "Width"])
      assert.equal(await filled.getByRole("note", { name: `${label}: not applicable`, exact: true }).count(), 1);
    await filled.getByLabel("Edit Fill", { exact: true }).click();
    await filled.getByRole("textbox", { name: "Fill Color", exact: true }).fill("#A9A9A9");
    await filled.getByRole("spinbutton", { name: "Fill Opacity (ratio)", exact: true }).fill("0.4");
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    assert.match(await filled.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/);
    await page.keyboard.press("Escape");
    await filled.getByRole("checkbox").uncheck();
    assert.match(await filled.locator('.quartet-text[title^="Fill opacity:"]').textContent(), /40%/);
    await filled.getByRole("checkbox").check();
    await open("mixed-paint.pdf", fixture(true, true, 0, true));
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    const mixed = input.getByRole("group", { name: "Guides", exact: true }).getByRole("checkbox");
    assert.equal(await mixed.evaluate((element) => element.indeterminate), true);
    await mixed.focus();
    await mixed.press("Space");
    assert.equal(await mixed.isChecked(), true);
    assert.equal(await mixed.evaluate((element) => element.indeterminate), false);
    await page.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    await input.getByRole("button", { name: "Reset all styles", exact: true }).click();
    assert.equal(await mixed.evaluate((element) => element.indeterminate), true);
    await open("bounded-choices.pdf", fixture(true, false, 0, false, false, { enum: [0.02, 0.08], minimum: 0.05 }));
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,2");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    const choices = input.getByRole("combobox", { name: "Guide Width (mm)", exact: true });
    assert.equal(await choices.getByRole("option", { name: "0.02", exact: true }).isDisabled(), true);
    assert.equal(await choices.getByRole("option", { name: "0.08", exact: true }).isEnabled(), true);
    await choices.selectOption("0.08");
    await input.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" });
    assert.equal(await choices.inputValue(), "0.08");
    assert.equal(await page.locator(".error-banner").count(), 0);
    await page.close();
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Opaque parameter IDs retain style edits, draft errors, and downloaded values", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 }, reducedMotion: "reduce" });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    let pdf = fixture(true, false, 2, true).toString();
    for (const [id, name] of [
      ["guides-stroke-color", "__proto__"],
      ["guides-stroke-width", "toString"],
      ["guides-stroke-opacity", "constructor"],
      ["guides-display", "hasOwnProperty"],
    ]) {
      // JSON whitespace keeps the PDF's stream length and xref offsets intact.
      pdf = pdf.replaceAll(JSON.stringify(id), JSON.stringify(name).padEnd(id.length + 2));
    }
    await page.goto(server.resolvedUrls.local[0]);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({
        name: "Opaque.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.from(pdf),
      });
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await input.getByRole("button", { name: "Add Input page 1 to Output", exact: true }).click();
    await tab(input, "Style");
    assert.equal(await input.getByRole("button", { name: "Edit Stroke", exact: true }).count(), 1);
    assert.deepEqual(errors, []);
    await input.getByRole("button", { name: "Edit Stroke", exact: true }).click();
    const color = input.getByRole("textbox", { name: "Guide Color", exact: true });
    await color.fill("invalid");
    assert.equal(await color.getAttribute("aria-invalid"), "true");
    assert.match(await input.locator(".control .error").innerText(), /six hexadecimal digits/);
    await color.fill("#ff0000");
    await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'));
    assert.equal(await color.inputValue(), "#ff0000");
    await input.getByRole("button", { name: "Edit Width", exact: true }).click();
    await input.getByRole("spinbutton", { name: "Guide Width (mm)", exact: true }).fill("0.4");
    await page.waitForFunction(() => !document.querySelector('.output-status[aria-hidden="false"]'));
    const completed = page.waitForEvent("download");
    await output.getByRole("button", { name: "Download", exact: true }).click();
    const downloaded = await completed;
    await input.locator("input[type=file]").setInputFiles({
      name: downloaded.suggestedFilename(),
      mimeType: "application/pdf",
      buffer: await readFile(await downloaded.path()),
    });
    await input.locator(".input-current").filter({ hasText: downloaded.suggestedFilename() }).waitFor();
    await tab(input, "Grid");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await tab(input, "Style");
    await input.getByRole("button", { name: "Edit Stroke", exact: true }).click();
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#ff0000");
    await input.getByRole("button", { name: "Reset Guide Color", exact: true }).click();
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#333333");
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Page addition hint skips on any click", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage({
      viewport: { width: 1440, height: 1100 },
      hasTouch: true,
      reducedMotion: "no-preference",
    });
    await page.addInitScript(() => localStorage.setItem("mainz:onboarding", "19"));
    await page.goto(server.resolvedUrls.local[0] + "?demo=empty");
    const flight = page.locator(".page-flight:popover-open");
    const total = () => page.locator(".composition-totals strong").innerText();
    const pause = () => flight.evaluate((element) => element.getAnimations().forEach((animation) => animation.pause()));
    await flight.waitFor();
    await pause();
    await page.locator(".header-note").click();
    assert.equal(await flight.count(), 0, "Clicking outside page controls immediately skips a paused animation");
    assert.equal(
      await page.getByRole("banner").getByRole("status").count(),
      0,
      "Skipping also dismisses the addition notice",
    );
    assert.equal(await total(), "0 PDF pages");
    await page.reload();
    await flight.waitFor();
    await pause();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "Settings", exact: true });
    assert.equal(await settings.isVisible(), true, "The same click still opens Settings");
    assert.equal(await flight.count(), 0);
    await settings.getByRole("button", { name: "Close Settings", exact: true }).click();
    await page.setViewportSize({ width: 390, height: 900 });
    await page.reload();
    await flight.waitFor();
    await pause();
    await page
      .getByRole("navigation", { name: "Workspace view", exact: true })
      .getByRole("button", { name: "Output", exact: true })
      .tap();
    assert.equal(await flight.count(), 0, "Touch activation also skips the animation immediately");
    assert.equal(await page.locator(".composition-output").isVisible(), true);
    assert.equal(await total(), "0 PDF pages");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test("Onboarding reset is consumed once and preserves other preferences", { timeout: 60000 }, async () => {
  const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
  let browser;
  try {
    await server.listen();
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const page = await browser.newPage();
    const url = server.resolvedUrls.local[0];
    await page.goto(url);
    await page.evaluate(() => {
      localStorage.setItem("mainz:onboarding", "19");
      localStorage.setItem("mainz:theme", "dark");
    });
    const open = async () => {
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({ name: "welcome.pdf", mimeType: "application/pdf", buffer: fixture() });
      await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "welcome.pdf", null, {
        timeout: 30000,
      });
    };
    await page.goto(`${url}?reset&keep=1#practice`);
    await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).waitFor();
    assert.equal(new URL(page.url()).search, "?keep=1");
    assert.equal(new URL(page.url()).hash, "#practice");
    assert.deepEqual(
      await page.evaluate(() => [localStorage.getItem("mainz:onboarding"), localStorage.getItem("mainz:theme")]),
      [null, "dark"],
    );
    await open();
    const welcome = page.getByRole("dialog", { name: "Welcome to PDF Studio", exact: true });
    await welcome.waitFor();
    await welcome.getByRole("button", { name: "Skip", exact: true }).click();
    await page.reload();
    await open();
    assert.equal(await welcome.isVisible(), false);
    assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), "19");
  } finally {
    await browser?.close();
    await server.close();
  }
});

test(
  "PDF workspace preserves composition, styles, focus, and responsive controls",
  { timeout: 240000 },
  async (context) => {
    const server = await createServer({ server: { port: 0, host: "127.0.0.1" } });
    let browser;
    let page;
    try {
      await server.listen();
      browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await page.addInitScript(() => {
        const Original = Worker;
        window.Worker = class extends Original {
          #processor = false;
          constructor(url, options) {
            super(url, options);
            if (String(url).includes("processor.worker")) {
              this.#processor = true;
              const root = document.documentElement;
              root.dataset.processors = String(Number(root.dataset.processors ?? 0) + 1);
              root.dataset.activeProcessors = String(Number(root.dataset.activeProcessors ?? 0) + 1);
            }
          }
          terminate() {
            if (this.#processor) {
              const root = document.documentElement;
              root.dataset.activeProcessors = String(Number(root.dataset.activeProcessors) - 1);
              this.#processor = false;
            }
            super.terminate();
          }
        };
      });
      await page.goto(server.resolvedUrls.local[0]);
      await page.evaluate(() => localStorage.setItem("mainz:onboarding", "18"));
      await page.reload();
      const result = await checkWorkspace(page, fixture(), fixture(false));
      assert.equal(result.failed, 0);
      console.log(`${result.checks} browser checks passed.`);
      page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
      await page.goto(server.resolvedUrls.local[0]);
      await page
        .locator("input[type=file]")
        .first()
        .setInputFiles({
          name: "Mixed visibility.pdf",
          mimeType: "application/pdf",
          buffer: fixture(true, true),
        });
      await page.getByRole("button", { name: "Skip", exact: true }).click();
      assert.equal(await page.getByRole("dialog", { name: "Product tour", exact: true }).isVisible(), false);
      await page.locator(".selection-panel").getByRole("textbox", { name: "Page selection", exact: true }).fill("1-7");
      await page.getByRole("button", { name: "Add to Output", exact: true }).click();
      await page.getByRole("tab", { name: "Style", exact: true }).click();
      const visibility = page.getByRole("article", { name: "Show Guides", exact: true });
      const show = visibility.getByRole("radio", { name: "Show", exact: true });
      const hide = visibility.getByRole("radio", { name: "Hide", exact: true });
      const reset = visibility.getByRole("button", { name: "Reset Show Guides", exact: true });
      assert.equal(await show.isChecked(), false);
      assert.equal(await hide.isChecked(), false);
      assert.match(await visibility.innerText(), /No single value/);
      assert.equal(await reset.isDisabled(), true);
      await hide.check();
      assert.equal(await hide.isChecked(), true);
      assert.equal(await show.isChecked(), false);
      await hide.press("ArrowLeft");
      assert.equal(await show.isChecked(), true);
      assert.equal(await hide.isChecked(), false);
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.locator(".error-banner").count(), 0);
      await reset.click();
      assert.equal(await show.isChecked(), false);
      assert.equal(await hide.isChecked(), false);
      assert.match(await visibility.innerText(), /No single value/);
      assert.equal(await reset.isDisabled(), true);
      await page.getByRole("button", { name: "Cancel style processing", exact: true }).waitFor({ state: "hidden" });
      assert.equal(await page.locator(".error-banner").count(), 0);
      console.log("Mixed visibility, Show/Hide, keyboard selection, and reset checks passed.");
      const blankOutput = page.locator(".composition-output");
      await blankOutput.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
      await page.locator(".selection-panel").getByRole("tab", { name: "Grid", exact: true }).click();
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick();
      await blankOutput.locator(".output-options > summary").click();
      await blankOutput.getByRole("button", { name: "Add blank page at end", exact: true }).click();
      await blankOutput.getByRole("button", { name: "Clear Output selection", exact: true }).click();
      await blankOutput.getByRole("button", { name: "Remove Output page 1", exact: true }).click();
      await page.locator(".input-picker > summary").click();
      await page.locator(".input-picker").getByRole("button", { name: "Remove Input", exact: true }).click();
      await page.locator(".selection-panel").waitFor({ state: "hidden" });
      await page.getByRole("button", { name: "Help", exact: true }).click();
      await page.getByRole("button", { name: "Start Tour", exact: true }).click();
      const blankTour = page.getByRole("dialog", { name: "Product tour", exact: true });
      await blankTour.waitFor();
      for (const key of ["output-grid", "output-page", "download"]) {
        await page.waitForFunction(
          (value) => document.querySelector(".help-tour:popover-open")?.getAttribute("data-step") === value,
          key,
        );
        assert.equal(await page.locator(`[data-tour-target="${key}"]`).isVisible(), true);
        if (key !== "download") await blankTour.getByRole("button", { name: "Next", exact: true }).click();
      }
      assert.match(await blankTour.locator(".tour-progress").textContent(), /\/ 3/);
      await blankTour.getByRole("button", { name: "Finish", exact: true }).click();
      assert.equal(await blankOutput.locator(".composition-totals strong").textContent(), "1 PDF page");
      assert.equal(
        await blankOutput.locator(".composition-totals").getByText("1 duplex sheet", { exact: true }).isVisible(),
        true,
      );
      console.log("Blank-only Output has a tour without Input or Style steps.");
      page = await browser.newPage({
        viewport: { width: 1440, height: 1100 },
        reducedMotion: "no-preference",
      });
      await page.goto(server.resolvedUrls.local[0]);
      const openHintInput = async () => {
        await page
          .locator("input[type=file]")
          .first()
          .setInputFiles({
            name: "First action.pdf",
            mimeType: "application/pdf",
            buffer: fixture(false),
          });
        await page.locator(".input-current").waitFor();
      };
      await openHintInput();
      const instruction = "Select pages · Use + to add to Output.";
      const status = page.locator(".footnote [role=status] span");
      const notice = page.getByRole("banner").getByRole("status");
      const instructionText = notice.locator("p");
      const flight = page.locator(".page-flight:popover-open");
      const hintWelcome = page.getByRole("dialog", { name: "Welcome to PDF Studio", exact: true });
      const hintTour = page.getByRole("dialog", { name: "Product tour", exact: true });
      await hintWelcome.waitFor();
      const statusStyle = await status.evaluate((element) => ({
        font: getComputedStyle(element).fontSize,
        color: getComputedStyle(element).color,
        weight: getComputedStyle(element).fontWeight,
        background: getComputedStyle(element).backgroundColor,
      }));
      assert.equal(await notice.count(), 0);
      await hintWelcome.getByRole("button", { name: "Take a tour", exact: true }).click();
      await hintTour.waitFor();
      assert.equal(await notice.count(), 0);
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click();
      await flight.waitFor();
      await page.waitForFunction(
        () => Number(getComputedStyle(document.querySelector(".page-flight"), "::backdrop").opacity) > 0.9,
      );
      assert.equal(await flight.evaluate((element) => getComputedStyle(element).opacity), "0");
      assert.equal(await instructionText.textContent(), instruction);
      assert.equal(
        await page.getByRole("button", { name: "Select Input page 1", exact: true }).getAttribute("aria-pressed"),
        "true",
      );
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages");
      const origin = await page.locator('[data-tour-target="first-page"] .thumbnail canvas').boundingBox();
      const spotlight = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop");
        return [style.translate, style.insetInlineStart, style.insetBlockStart];
      });
      await page.waitForFunction(
        (left) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > left,
        origin.x + 8,
      );
      const fading = await flight.evaluate((element) => {
        const style = getComputedStyle(element, "::backdrop");
        return {
          position: [style.translate, style.insetInlineStart, style.insetBlockStart],
          opacity: Number(style.opacity),
        };
      });
      assert.deepEqual(fading.position, spotlight, "The spotlight stays over Input while the copy moves");
      assert.ok(
        fading.opacity > 0.25 && fading.opacity < 0.9,
        "The copy starts moving while the fading light is visible",
      );
      await page.waitForFunction(
        (right) => document.querySelector(".page-flight:popover-open")?.getBoundingClientRect().left > right,
        origin.x + origin.width,
      );
      assert.equal(
        await instructionText.evaluate((element) => getComputedStyle(element).opacity),
        "1",
        "Notice text keeps its full contrast during display",
      );
      await flight.waitFor({ state: "hidden" });
      assert.equal(await instructionText.textContent(), instruction);
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages");
      assert.ok(
        Number(await instructionText.evaluate((element) => getComputedStyle(element).fontWeight)) >
          Number(statusStyle.weight),
      );
      assert.ok(
        parseFloat(await instructionText.evaluate((element) => getComputedStyle(element).fontSize)) >
          parseFloat(statusStyle.font),
      );
      assert.equal(await notice.evaluate((element) => getComputedStyle(element).backgroundColor), "rgba(0, 0, 0, 0)");
      const headerBounds = await page.getByRole("banner").boundingBox();
      const noticeBounds = await notice.boundingBox();
      assert.ok(
        Math.abs(noticeBounds.x + noticeBounds.width / 2 - headerBounds.x - headerBounds.width / 2) < 1,
        "The compact Notice is centered in the header",
      );
      assert.match(await status.textContent(), /Opened 1 page/);
      await page.waitForFunction(() => {
        const element = document.querySelector(".notice");
        return element && Number(getComputedStyle(element).opacity) < 0.9;
      });
      await notice.waitFor({ state: "detached", timeout: 15000 });
      assert.match(await status.textContent(), /Opened 1 page/);
      await page.getByRole("button", { name: "Help", exact: true }).click();
      await page.getByRole("button", { name: "Start Tour", exact: true }).click();
      await hintTour.getByRole("button", { name: "End tour", exact: true }).click();
      assert.equal(await flight.isVisible(), false);
      await page.reload();
      await openHintInput();
      await flight.waitFor();
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick();
      await flight.waitFor({ state: "hidden" });
      assert.match(await status.textContent(), /Added 1 page to Output/);
      await notice.waitFor({ state: "detached" });
      assert.equal(await notice.count(), 0);
      assert.deepEqual(
        await status.evaluate((element) => ({
          font: getComputedStyle(element).fontSize,
          color: getComputedStyle(element).color,
          weight: getComputedStyle(element).fontWeight,
          background: getComputedStyle(element).backgroundColor,
        })),
        statusStyle,
      );
      await page.getByRole("button", { name: "Remove selected Output pages", exact: true }).click();
      assert.equal(await flight.isVisible(), false);
      assert.equal(await page.locator(".composition-empty").isVisible(), true);
      await page.reload();
      await openHintInput();
      await flight.waitFor();
      await page.emulateMedia({ reducedMotion: "reduce" });
      await flight.waitFor({ state: "hidden" });
      assert.equal(await instructionText.textContent(), instruction);
      assert.equal(await page.locator(".composition-totals strong").textContent(), "0 PDF pages");
      await page.reload();
      await openHintInput();
      await notice.filter({ hasText: instruction }).waitFor();
      assert.equal(await flight.isVisible(), false);
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick();
      assert.match(await status.textContent(), /Added 1 page to Output/);
      await page.setViewportSize({ width: 390, height: 900 });
      await page.emulateMedia({ reducedMotion: "no-preference" });
      await page.reload();
      await openHintInput();
      await flight.waitFor();
      const bounds = await notice.boundingBox();
      assert(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 391);
      assert(bounds.y >= 0 && bounds.y + bounds.height <= 901);
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).dblclick();
      await flight.waitFor({ state: "hidden" });
      assert.match(await status.textContent(), /Added 1 page to Output/);
      await page.setViewportSize({ width: 390, height: 650 });
      await page.reload();
      await page.evaluate(() => (document.documentElement.style.fontSize = "200%"));
      await openHintInput();
      assert.equal(await notice.count(), 0);
      await page.getByRole("button", { name: "Select Input page 1", exact: true }).scrollIntoViewIfNeeded();
      await notice.filter({ hasText: instruction }).waitFor();
      const enlarged = await notice.boundingBox();
      assert(enlarged && enlarged.x >= 0 && enlarged.x + enlarged.width <= 391);
      assert(enlarged.y >= 0 && enlarged.y + enlarged.height <= 651);
      await page.getByRole("button", { name: "Dismiss notification", exact: true }).focus();
      await page.keyboard.press("Enter");
      await notice.waitFor({ state: "detached" });
      assert.equal(await notice.count(), 0);
      assert.match(await status.textContent(), /Opened 1 page/);
      console.log(
        "The first-page animation waits for onboarding/tour and visibility, leaves Output and Selection unchanged, uses an expiring header Notice, stops on addition, and respects reduced motion and enlarged mobile text.",
      );
    } catch (error) {
      if (page) context.diagnostic((await page.locator("[role=alert], .footnote").allTextContents()).join("\n"));
      throw error;
    } finally {
      await browser?.close();
      await server.close();
    }
  },
);

test("Offline assets, scoped startup, and updates preserve a compatible workspace", { timeout: 180000 }, async () => {
  const temporary = resolvePath("../.local/tmp/web");
  await mkdir(temporary, { recursive: true });
  const outDir = await mkdtemp(join(temporary, "offline-"));
  let server, browser;
  let finishInstall;
  const installation = new Promise((resolve) => {
    finishInstall = resolve;
  });
  try {
    const previous = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = "production";
      await build({ base: "/studio/", build: { outDir, emptyOutDir: true }, logLevel: "warn" });
    } finally {
      if (previous === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = previous;
    }
    const worker = await readFile(join(outDir, "sw.js"), "utf8");
    assert.deepEqual(await readFile(join(outDir, "demo.pdf")), await readFile("test/fixtures/demo.pdf"));
    let paused = false,
      release = "initial",
      incompatible = false;
    server = await preview({
      base: "/studio/",
      build: { outDir },
      preview: { host: "127.0.0.1", port: 0 },
      plugins: [
        {
          name: "offline-release-test",
          configurePreviewServer(value) {
            value.middlewares.use((request, response, next) => {
              if (request.url === "/studio/sw.js") {
                response.setHeader("Content-Type", "text/javascript");
                response.setHeader("Cache-Control", "no-store");
                response.end(
                  `const activate = self.skipWaiting.bind(self);
                     self.skipWaiting = async () => {
                       await new Promise((resolve) => setTimeout(resolve, 500));
                       return activate();
                     };\n` + worker.replace(/const VERSION = '[^']+';/, `const VERSION = '${release}';`),
                );
              } else if (paused && request.url === "/studio/notices/svelte.txt") {
                void installation.then(next);
              } else if (incompatible && request.url === "/studio/processor.mjs") {
                response.setHeader("Content-Type", "text/javascript");
                response.end("throw new Error('incompatible processor');");
              } else next();
            });
          },
        },
      ],
    });
    browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || undefined });
    const context = await browser.newContext({ acceptDownloads: true });
    const page = await context.newPage();
    const url = server.resolvedUrls.local[0];
    await checkMobile(browser, url);
    const foreignCache = `mainz:${new URL("/elsewhere/", url).href}:other`;
    paused = true;
    await page.goto(url);
    const identifier = page.locator(".footnote > time");
    // Wider font metrics reproduce the enlarged landing layout failure.
    await identifier.evaluate((element) => {
      element.style.fontFamily = '"DejaVu Sans", sans-serif';
    });
    const buildId = await identifier.textContent();
    assert.match(buildId, /^\d{4}-\d{4}-\d{4}-\d{4}$/);
    assert.equal(await identifier.getAttribute("aria-label"), `Build ${buildId}`);
    assert.match(await identifier.getAttribute("title"), /^Built \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z \(UTC\)/);
    await page.getByText("Installing offline application…", { exact: true }).waitFor();
    const installingPage = await context.newPage();
    await installingPage.goto(`${url}?demo`);
    const feedback = installingPage.getByText("Demo workspace ready.", { exact: true });
    const offline = installingPage.getByText("Installing offline application…", {
      exact: true,
    });
    await feedback.waitFor();
    await offline.waitFor();
    for (const [width, text, colorScheme] of [
      [1440, "100%", "light"],
      [839, "100%", "dark"],
      [320, "200%", "dark"],
      [390, "200%", "light"],
      [768, "200%", "dark"],
    ]) {
      for (const view of [page, installingPage]) {
        await view.setViewportSize({ width, height: 900 });
        await view.emulateMedia({ colorScheme, reducedMotion: "reduce" });
        await view.evaluate((value) => (document.documentElement.style.fontSize = value), text);
        assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      }
      assert.equal(await identifier.isVisible(), true);
      assert.equal(
        await identifier.evaluate((element) => {
          const range = document.createRange();
          range.selectNodeContents(element);
          const bounds = range.getBoundingClientRect();
          const footer = element.closest("footer").getBoundingClientRect();
          return Math.abs(bounds.x + bounds.width / 2 - footer.x - footer.width / 2) < 1;
        }),
        true,
        "The landing Build ID stays at the bottom center",
      );
      const messageBox = await feedback.boundingBox(),
        offlineBox = await offline.boundingBox();
      assert.ok(messageBox.y + messageBox.height <= offlineBox.y);
      assert.ok(
        Math.abs(messageBox.x + messageBox.width / 2 - offlineBox.x - offlineBox.width / 2) < 1,
        "Offline installation and operation feedback share a centered column",
      );
      await checkStatus(installingPage);
    }
    await installingPage.close();
    paused = false;
    finishInstall();
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate(() => (document.documentElement.style.fontSize = "100%"));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, {
      timeout: 60000,
    });
    const initialCaches = await page.evaluate(() => caches.keys());
    assert.equal(initialCaches.length, 1);
    assert.ok(initialCaches[0].startsWith("mainz:"));
    assert.match(initialCaches[0], /\/studio\/:initial$/);
    const installed = page.getByText("PDF Studio is ready for offline use.", { exact: true });
    await installed.waitFor();
    assert.equal(await page.getByRole("banner").getByRole("status").count(), 1);
    const installedBox = await installed.boundingBox(),
      landingBox = await page.locator(".drop-zone").boundingBox();
    assert.ok(installedBox.y + installedBox.height <= landingBox.y);
    await installed.waitFor({ state: "detached", timeout: 15000 });
    await page.evaluate(() => localStorage.setItem("mainz:onboarding", "19"));
    await context.setOffline(true);
    const demo = await context.newPage();
    await demo.goto(`${url}?demo`);
    await demo.waitForFunction(() => document.querySelector(".input-current")?.textContent === "demo.pdf", null, {
      timeout: 60000,
    });
    await demo.waitForFunction(
      () => document.querySelector(".composition-totals strong")?.textContent === "6 PDF pages",
    );
    assert.equal(await demo.locator(".offline").count(), 0);
    assert.equal(await demo.locator(".footnote > time").textContent(), buildId);
    assert.equal(await demo.locator(".status-input").textContent(), "demo.pdf");
    assert.equal(await demo.locator(".composition-totals strong").textContent(), "6 PDF pages");
    assert.equal(await demo.getByRole("dialog", { name: "Welcome to PDF Studio", exact: true }).count(), 0);
    await demo.locator(".selection-panel").getByRole("tab", { name: "Style", exact: true }).click();
    await demo.getByRole("combobox", { name: "Style profile", exact: true }).selectOption("inkjet");
    await demo.waitForFunction(() => !document.querySelector(".composer[aria-busy=true], .composer [aria-busy=true]"));
    const demoSaved = demo.waitForEvent("download");
    await demo.locator(".composition-output").getByRole("button", { name: "Download", exact: true }).click();
    const demoArtifact = await demoSaved;
    assert.equal(await demoArtifact.failure(), null);
    assert.match((await readFile(await demoArtifact.path())).subarray(0, 8).toString(), /^%PDF-/);
    await demo.close();
    console.log("The bundled production demo opens, styles and downloads offline under /studio/.");
    await page.goto(`${url}?reset`);
    await page.waitForURL(url);
    assert.equal(await page.evaluate(() => localStorage.getItem("mainz:onboarding")), null);
    await page
      .locator("input[type=file]")
      .first()
      .setInputFiles({ name: "Offline.pdf", mimeType: "application/pdf", buffer: fixture() });
    await page.waitForFunction(() => document.querySelector(".input-current")?.textContent === "Offline.pdf", null, {
      timeout: 60000,
    });
    await page.getByRole("button", { name: "Skip", exact: true }).click();
    const input = page.locator(".selection-panel"),
      output = page.locator(".composition-output");
    await input.getByRole("textbox", { name: "Page selection", exact: true }).fill("1,1");
    await input.getByRole("button", { name: "Add to Output", exact: true }).click();
    await input.getByRole("tab", { name: "Style", exact: true }).click();
    await input.getByRole("textbox", { name: "Guide Color", exact: true }).fill("#884488");
    await page.waitForFunction(() => !document.querySelector(".output-status[aria-hidden=false]"));
    const saved = page.waitForEvent("download");
    await output.getByRole("button", { name: "Download", exact: true }).click();
    const artifact = await saved;
    assert.equal(await artifact.failure(), null);
    assert.match((await readFile(await artifact.path())).subarray(0, 8).toString(), /^%PDF-/);
    const cachedURLs = await page.evaluate(async () =>
      (await (await caches.open((await caches.keys())[0])).keys()).map((request) => request.url),
    );
    assert.ok(cachedURLs.length > 100);
    assert.ok(cachedURLs.every((path) => path.startsWith(new URL(url).origin + "/studio/")));
    assert.ok(cachedURLs.includes(new URL("demo.pdf", url).href));
    assert.ok(cachedURLs.every((path) => !/Offline\.pdf|blob:/.test(path)));
    await context.setOffline(false);
    await page.evaluate(async (name) => {
      await caches.open(name);
    }, foreignCache);
    release = "next";
    await page.evaluate(async () => (await navigator.serviceWorker.getRegistration()).update());
    const update = page.getByRole("button", { name: "Update application", exact: true });
    await update.waitFor({ timeout: 60000 });
    const updateNotice = page.getByRole("banner").getByRole("status");
    await page.waitForTimeout(5500);
    assert.equal(await updateNotice.isVisible(), true);
    assert.match(
      await updateNotice.textContent(),
      /An application update is ready\. Download and close your PDF before updating\./,
    );
    await updateNotice.waitFor({ state: "detached", timeout: 15000 });
    assert.equal(await update.isVisible(), true);
    assert.equal(await update.isDisabled(), true);
    assert.equal(await output.locator(".composition-totals strong").textContent(), "2 PDF pages");
    assert.equal(await input.getByRole("textbox", { name: "Guide Color", exact: true }).inputValue(), "#884488");
    await page.getByRole("link", { name: "PDF Studio home", exact: true }).click();
    await update.waitFor();
    assert.equal(await update.isEnabled(), true);
    const other = await context.newPage();
    await other.goto(url);
    await update.click();
    await page.getByText("Close other PDF Studio tabs before updating.", { exact: true }).waitFor();
    assert.notEqual(
      await page.locator(".error-banner").evaluate((element) => getComputedStyle(element).color),
      await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
    );
    assert.equal(await page.locator(".drop-zone input[type=file]").isEnabled(), true);
    assert.ok((await page.evaluate(() => caches.keys())).some((name) => name.endsWith(":initial")));
    await other.close();
    const reloaded = page.waitForEvent("load");
    await update.click();
    const opening = page.locator(".drop-zone input[type=file]");
    assert.equal(await opening.isDisabled(), true, "Opening waits for application activation");
    await opening.setInputFiles({
      name: "During update.pdf",
      mimeType: "application/pdf",
      buffer: fixture(),
    });
    assert.equal(await page.locator(".composer").count(), 0);
    assert.equal(await page.getByRole("button", { name: "Cancel", exact: true }).count(), 0);
    await reloaded;
    assert.equal(await opening.isEnabled(), true);
    assert.equal(await page.locator(".composer").count(), 0);
    await page.waitForFunction(async () => {
      const names = await caches.keys();
      return names.length === 2 && names.some((name) => name.endsWith(":next"));
    });
    assert.deepEqual(
      (await page.evaluate(() => caches.keys())).toSorted(),
      [foreignCache, `mainz:${url}:next`].toSorted(),
    );
    await page.evaluate((name) => caches.delete(name), foreignCache);
    await page.waitForFunction(() => !document.querySelector(".error-banner")?.textContent.includes("Close other"));
    incompatible = true;
    release = "broken";
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const completed = new Promise((resolve, reject) => {
        registration.addEventListener(
          "updatefound",
          () => {
            const installing = registration.installing;
            installing.addEventListener("statechange", () => {
              if (installing.state === "redundant") resolve();
              if (installing.state === "activated") reject(new Error("Incompatible update activated"));
            });
          },
          { once: true },
        );
      });
      await registration.update();
      await completed;
    });
    await page
      .getByText("Offline installation failed. The current application is retained.", {
        exact: true,
      })
      .waitFor();
    assert.notEqual(
      await page.locator(".error-banner").evaluate((element) => getComputedStyle(element).color),
      await page.locator(".footnote").evaluate((element) => getComputedStyle(element).color),
    );
    assert.ok((await page.evaluate(() => caches.keys())).every((name) => name.endsWith(":next")));
    await context.setOffline(true);
    await page.reload();
    assert.equal(
      await page.getByRole("heading", { name: "Select pages and style prepared PDFs.", exact: true }).isVisible(),
      true,
    );
    assert.deepEqual(
      await page.evaluate(async () =>
        (await document.fonts.load('500 32px "EB Garamond"', "PDF Studio Select pages and style prepared PDFs.")).map(
          (font) => font.status,
        ),
      ),
      ["loaded"],
      "Landing headings retain the embedded font offline under the application scope",
    );
    const fontLicense = await page.evaluate(async () => {
      const response = await fetch(new URL("fonts/eb-garamond.txt", document.baseURI));
      return { status: response.status, text: await response.text() };
    });
    assert.equal(fontLicense.status, 200);
    assert.match(fontLicense.text, /SIL OPEN FONT LICENSE Version 1\.1/);
    assert.equal(await page.locator(".error-banner").count(), 0);
  } finally {
    finishInstall();
    await browser?.close();
    if (server)
      await new Promise((resolve, reject) => server.httpServer.close((error) => (error ? reject(error) : resolve())));
    await rm(outDir, { recursive: true, force: true });
  }
});
