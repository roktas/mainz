# PDF Composer

[Open PDF Composer](https://mainz.roktas.dev/) to arrange pages from local PDFs. Choose pages, change their order,
repeat them, or insert blanks. A prepared PDF also exposes editable styles. Your PDFs stay on your device.

The offline-ready notice tells you when the browser has saved the application files. You can work offline after this
notice. You can also add a Home Screen icon.

Use a current browser. Older systems, including iOS 16, can show a broken layout or fail to open PDFs.

Grid shows thumbnails, List shows page names and numbers, and Page shows one large page. The views share selections and
page operations. Input shows the PDF as opened. Style changes applicable Output pages from the active Input. Open Help
for the Product tour and keyboard, mouse, and touch controls.

The [screencast menu](https://mainz.roktas.dev/help/) previews each full guide at a lower resolution. Open a preview for
the full-size player and its WebP, WebM, and MP4 formats. See the [capture guide](../doc/help/README.md) to remake the
screencasts.

Use **Export recipe** in the Output header to save page arrangements and style choices as JSON. Open that Recipe later
with its Input PDFs or replay it with the [CLI](../cli/README.md). If an Input changes, PDF Composer assesses the
difference and can offer an updated Recipe. A Recipe export saves the choices. Use **Download** to save the PDF.

The [workspace contract](../doc/spec/web.md) defines behavior and terms. The [GUI contract](../doc/spec/gui.md) defines
layout and interaction requirements.

## Development

| Entry point                                                       | Responsibility                                        |
| ----------------------------------------------------------------- | ----------------------------------------------------- |
| [App.svelte](src/App.svelte)                                      | Input opening, Input choices, and owner coordination. |
| [Composer.svelte](src/Composer.svelte)                            | Pane views, Output edit interactions, and transfers.  |
| [model.ts](src/model.ts) and [styles.ts](src/styles.ts)           | Output structure, Plan validation, and style rules.   |
| [output.svelte.ts](src/output.svelte.ts)                          | Accepted Parts, selection, and inspection.            |
| [Recipe.svelte](src/Recipe.svelte) and [recipe.ts](src/recipe.ts) | Portable Recipe capture, Input IDs, and JSON export.  |
| [preview.svelte.ts](src/preview.svelte.ts)                        | Input preview processing, cancellation, and handoff.  |
| [pdf.ts](src/pdf.ts) and [processor.ts](src/processor.ts)         | PDF.js resources and cancellable processor workers.   |

Set up the [root build dependencies](../AGENTS.md#build-and-validation). Use the Node.js version in
[`.node-version`](../.node-version). Run from the repository root.

```sh
bundle exec rake build:wasm package:wasm setup:web
npm run dev
```

Open the Vite URL and choose or drop PDFs. Add `?demo` to open the examples menu or `?demo=single` to open four sample
pages with eight Output occurrences. See the [fixture guide](test/fixtures/README.md) for the demo files.

Restart Vite after changing packaged WASM, public files, or demo assets. See [AGENTS.md](../AGENTS.md#web) for web
checks and preview rules. See the [test guide](../doc/test.md#asset-snapshots) for asset snapshots.
