# PDF Composer

PDF Composer builds one PDF from pages you choose across local PDFs. Extract pages, duplicate or repeat them, remove
unwanted pages, and arrange the result. Prepared PDFs also expose declared styles, such as colors, line widths, opacity,
and visibility. Your PDFs stay on your device.

The application works offline after its service worker successfully installs and caches the application assets. The
service worker is the browser's background component for offline use. Adding a Home Screen icon is a separate action.
The application's offline-ready notice confirms that the assets are available.

PDF Composer uses modern browser features. Older systems, including iOS 16, can show a broken layout or fail to open
PDFs. We do not claim a tested minimum OS or browser version.

Grid shows thumbnails, and Page shows one large page. Both views share selections and page operations. Input shows the
PDF as opened. Style changes applicable Output pages from the active Input.

Each pane offers Normal and Compact Grid density. Selection actions use the shared bar. Without a selection, card
buttons and Page actions use their own page. Help explains keyboard, mouse, and touch controls and opens the Product
tour.

Try [mainz.roktas.dev](https://mainz.roktas.dev/). The [specification and glossary](doc/SPEC.md) define the workspace.
[VIEW.md](doc/VIEW.md) defines its appearance.

## Development

| Entry point                                               | Responsibility                                       |
| --------------------------------------------------------- | ---------------------------------------------------- |
| [App.svelte](src/App.svelte)                              | PDF opening, Source lifetimes, and style processing. |
| [Composer.svelte](src/Composer.svelte)                    | Pane views, selections, Output edits, and transfers. |
| [model.ts](src/model.ts) and [styles.ts](src/styles.ts)   | Composition and style rules shared by UI flows.      |
| [pdf.ts](src/pdf.ts) and [processor.ts](src/processor.ts) | PDF.js resources and cancellable processor workers.  |

Use the Node.js version in [`.node-version`](../.node-version) and the
[root build dependencies](../AGENTS.md#build-and-validation). Run from the repository root:

```sh
direnv exec . bundle exec rake build:wasm package:wasm setup:web
npm run dev
```

Open the Vite URL and choose or drop PDFs. Add `?demo` to try the bundled eight-page sample. See
[AGENTS.md](../AGENTS.md#web) for checks, build configuration, and mockups. The
[fixture guide](test/fixtures/README.md#grid-fixture) describes the local 240-page Grid sample.

Vite prepares complete static-asset snapshots under `.local/tmp/web/assets/`. Each directory depends on all staged file
names and bytes, including public files, PDF.js resources, the demo, verified WASM files, and license notices.
Concurrent servers retain their own snapshot when these inputs differ.

Restart the development server after changing these inputs. Use separate checkouts for concurrent application-source
revisions.

To inspect or remove old snapshots, first stop all Vite development and preview servers, builds, and browser tests in
the checkout. Then run:

```sh
du -sh .local/tmp/web/assets
rm -rf .local/tmp/web/assets
```

The next Vite command creates the required snapshot again. Do not remove snapshots while a server, build, or test uses
them.
