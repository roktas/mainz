# Screencasts

This directory retains optional producers for the application's screencasts. Record again only on explicit request.
Normal builds and tests use the published media without capture or encoding tools.

| Screencast | Source                          | Result                                                                         |
| ---------- | ------------------------------- | ------------------------------------------------------------------------------ |
| `booklet`  | [Scenario](booklet/booklet.mjs) | Two practice pages, each repeated once, with darker fills and thicker outlines |
| `recipe`   | [Scenario](recipe/recipe.mjs)   | The same booklet saved as a Recipe, reopened, and downloaded                   |

Both scenarios use `../megic/srv/ital/book/ital-book-60a4-wxga/ital-book-60a4-wxga.pdf` from the repository root. That
external input is required only for a new capture. The published screencasts contain no personal directory paths.

The shared [runner](record.mjs) drives the real application through Playwright. It records a visible cursor, click
rings, and short English overlays. Each instruction appears before its action, with pauses around the action.

Booklet opens Output Page before styling. It shows a print profile and introduces custom styling with a centered “Or…”
cue. It darkens Pattern Fill Color and increases Pattern Stroke Width with +. Compare page shows the original in Input
beside the styled Output page. The recording shows the remaining Output pages, downloads the booklet, and ends with
Print. The instruction clears before the recording ends.

Recipe uses a full-screen “Some time later” transition before a fresh application visit. It shows the source PDF match
details before it applies the Recipe. It uses the Lens to show the restored style and opens all four Output pages in
Page view before Download.

The runner selects files through the application's actual file inputs. Playwright supplies each file after the picker
click. Native operating-system dialogs stay outside the capture. The viewer sees the picker control, an instruction, and
the selected file. No simulated operating-system dialog appears.

## Record again

Requirements are the pinned web dependencies, full Playwright Chromium, FFmpeg with VP9 and H.264 encoders, `ffprobe`,
and `img2webp`. The native Mainz CLI at `.local/var/cpp/build/native/mainz` inspects each downloaded PDF. The runner
uses Playwright's `page.screencast` API from the [pinned web dependencies](../../web/package.json).

Run these commands from the repository root:

1. Build the application:

   ```sh
   npm run build
   ```

2. Start a preview server in a separate terminal:

   ```sh
   npm run preview -- --port 4173 --strictPort
   ```

3. Record both scenarios:

   ```sh
   node doc/help/record.mjs all http://127.0.0.1:4173/
   ```

To record one scenario, replace `all` with `booklet` or `recipe`. The Recipe scenario prepares its initial booklet
before capture starts. No previous browser session is required. Use a production preview to prevent development reloads
during capture.

## Published files

Full screencasts use 1920 × 1080 pixels and contain no audio:

| Format        | Encoding                              | Purpose                                                             |
| ------------- | ------------------------------------- | ------------------------------------------------------------------- |
| WebM          | VP9, 30 frames per second             | First video source                                                  |
| MP4           | H.264, 30 frames per second           | Native playback alternative, including browsers without VP9 support |
| Animated WebP | 8 frames per second, 125 ms per frame | Explicit animation format                                           |
| Preview WebP  | 960 × 540 at 8 frames per second      | Menu animation                                                      |
| PNG           | First frame                           | Player poster                                                       |

The runner retains captures, downloaded PDFs, a Recipe, and step timestamps under `.local/var/help/<name>/`. It encodes
media there first. It then copies each format and `preview.webp` to `web/public/help/<name>/`. It publishes screencast
IDs, titles, and purpose descriptions to `web/public/help/catalog.json`.

Assertions require four Output pages in ARCH, ARCH, MIXB, MIXB order, with pattern fill color `#606060`, opacity `0.4`,
and stroke width `0.3704` mm. The runner also requires 1080p video streams and an animated 1080p WebP. Inspect
representative frames and playback after each new capture. Assertions do not prove visual quality.

## Application access

`/help/` opens the screencast menu. `/help/booklet/` and `/help/recipe/` open the named screencasts. All paths remain
within the application's deployment base. The landing page and Help dialog link to the menu.

The menu shows PNG posters and loading feedback while the 960 × 540 WebP previews load. Reduced motion uses static PNG
posters. Open a preview to watch at full resolution and choose a format. The player has native video controls and format
tabs, with WebP first. The browser chooses a supported video source, with MP4 after WebM. Video playback requires a user
action. The WebP tab starts the animation after an explicit choice. The help page does not load the PDF workspace or its
processor.

Offline installation excludes screencast media. Opening a screencast requires network access or the browser's existing
HTTP cache. This keeps application installation independent of the media size.

Restart the development server after publishing media because Vite retains an immutable public-asset snapshot.
