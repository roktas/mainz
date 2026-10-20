# Prepared PDF sample

[demo.pdf](demo.pdf) contains the cover and six practice Pages from Megic's Ital Winters 7.9 mm A4 Book. PDF Composer's
`?demo` mode opens it in development, production, and offline after application installation.

The sample has eight Style objects and 34 parameters for patterns, guide lines, and the SAMPLE watermark. Pattern fills
start at `#999999` with 40% opacity and remain editable. Marks and Frame remain fixed. Embedded Generic and Inkjet
profiles provide named style choices. Opening the sample preserves its saved appearance. Generic restores the sample's
gray pattern fills. Inkjet uses 0.04 mm thin guides and soft blue (`#6B7F99`) Pattern and Partial Pattern fills at 40%
opacity. The Style groups appear in this order: Patterns, Guides, Watermark.

The Stamp Style object controls the small, distressed red SAMPLE stamp at the center of all seven pages, including the
cover. Its fill color and opacity remain editable. Visibility is unavailable. Its frame and letter outlines stay fixed
and visible outside the editable targets. Megic maintains the vector source and declaration in
`test/integration/watermark.svg` and `test/integration/watermark.json`.

## Rebuild

Build the native Mainz CLI and install Megic's Ruby dependencies first. The script uses Megic's existing
`ital-book-79a4-wxaa` PDF for the cover. Run from the sibling Megic checkout, on `main`:

```sh
direnv exec . env PATH="$PWD/../mainz/.local/var/cpp/build/native:$PATH" bundle exec ./test/integration/sample.rb . ../mainz/.local/var/cpp/build/native/mainz
cp .local/sample/demo.pdf ../mainz/web/test/fixtures/demo.pdf
```

The script checks the contract, saved overrides, reset, and protected content with independent HexaPDF inspection. It
also compares the fixed watermark outline with an independent SVG export after setting fill opacity to zero. Poppler
requires exact original/reset raster equality at 150/300 DPI. The separate Cairo Inkjet reference permits a maximum
24/255 difference in 0.001% of raster channels. That bound permits subpixel differences from re-export while retaining
exact protected-content comparisons. Vite copies this maintained fixture into the application assets on each start or
build.

## Grid fixture

The development Grid sample composes 240 physical pages from `demo.pdf`. Its maintained Job and Input bindings are
[`grid-job.json`](grid-job.json) and [`grid-inputs.json`](grid-inputs.json).
[`DESIGN.md`](../../doc/DESIGN.md#workspace) defines Normal and Compact geometry and expected desktop capacities.

If `.local/tmp/web/grid/sample.pdf` is absent, run these commands from the repository root after building the native
CLI:

```sh
mkdir -p .local/tmp/web/grid
.local/var/cpp/build/native/mainz compose web/test/fixtures/grid-job.json --inputs web/test/fixtures/grid-inputs.json --output .local/tmp/web/grid/sample.pdf > .local/tmp/web/grid/report.json
```

Reuse an existing `sample.pdf`. With the development server running, open `http://127.0.0.1:5173/?demo=grid`. Add
`&input=page` or `&output=page` to compare Grid with Page. The fixture stays outside production assets and the offline
cache. Both densities remain available in production with local PDFs and the bundled seven-page demo.

## Geometry collection and calibration

The development-only `?geometry` entry opens the Grid fixture and provides local JSON/CSV exports. Keep both panes in
Grid and wait for loading to finish before capture. The probe records rendered CSS bounds, viewport units, safe areas,
matching media queries, and all four pane/density combinations. Capture restores the previous pane, densities, focus,
and scroll. The export contains no PDF content. Device labels are explicit metadata. The probe leaves unknown hardware
and browser configuration values unknown.

The probe page uses a development-only manifest that preserves its fixture URL when installed. Its separate Mainz
geometry app opens the probe again. The production manifest and normal installation start URL remain unchanged.

With the development server running, collect the maintained viewport references from the repository root:

```sh
npm run measure
npm run calibrate
```

The collector writes `.local/tmp/web/viewport/synthetic/`. The search writes `.local/tmp/web/viewport/search/`.
`inventory.json` records source hashes, fixture digest, software versions, coverage, and failed rules. Each sample has
JSON, CSV, and four screenshots. `search.json` retains every candidate and rejection. `index.html` compares shortlisted
screenshots. Command arguments that name files are relative to `web/`.

Screenshots capture the visible viewport. Full-page capture can change Chromium's emulated input capabilities on a
scrolling document. The collector rejects a capture that changes pointer or hover capabilities.

The search tries 27 deterministic combinations of card width, height, and spacing, plus up to four measured fits for an
extra row or column in either density. Fits use the available column budget while preserving image-size floors, balanced
margins, card proportions, and control space. Their dimensions are constrained by DESIGN's rendered bounds. It evaluates
Normal and Compact together through the actual renderer. DESIGN bounds reject candidates before ranking. The report
retains the Pareto frontier. A recommendation must increase capacity without a density losing cards, reduce unused
height without a material image-size loss, or correct a failing baseline. Current reference matrices verify the
baseline. Candidate counts can improve; frame budgets remain acceptance gates. The search writes no production CSS.
Native rendered review and boundary tests precede a calibration change.

To collect one reference or use installed Chrome on a logged-in desktop, run:

```sh
npm run measure -- --case 810x1080-coarse
npm run measure -- --native --channel chrome --environment ../.local/tmp/web/viewport/host.json --out ../.local/tmp/web/viewport/native
npm run calibrate -- --input ../.local/tmp/web/viewport/native --out ../.local/tmp/web/viewport/native-search
```

The optional host JSON supplies known `source`, `device`, and `display` values. For a verified physical display, use
`"source": "physical"`. Without this metadata, native acquisition keeps the source unknown. Native collection uses a
dedicated browser profile with `viewport: null`. It attempts normal, maximized, fullscreen, and installed PWA windows. A
mode is accepted only when the native window state matches the request. The collector removes its own temporary PWA
after the run.

Keep the Mac display awake and the native browser window visible during capture. Sleeping displays can suspend animation
frames. A capture timeout is failed acquisition evidence. Check that source hashes match after file synchronization
before starting a remote run.

Synthetic collection controls CSS viewport dimensions. Native collection measures actual browser content space. Replay
uses recorded dimensions in synthetic Chromium. Replay does not reproduce Safari, browser bars, safe areas, display
scaling, or physical touch behavior. Original environment metadata remains provenance. Simulator and physical Safari/PWA
evidence requires the same in-page export plus a corresponding native screenshot.

On a Mac with full Xcode and compatible Simulator runtimes, make the development URL reachable from the simulator. Run
the representative native sweep from the repository root:

```sh
npm run measure:simulator -- --search
npm run measure:simulator -- --case 744x1133-coarse,810x1080-coarse --search --out ../.local/tmp/web/viewport/tablets
npm run measure:simulator -- --case 375x667-coarse --orientation landscape --mode browser-tabbed --out ../.local/tmp/web/viewport/phone
npm run measure:simulator -- --case 744x1133-coarse --mode standalone-pwa --search --out ../.local/tmp/web/viewport/pwa
```

The collector reuses one UI-test build. It creates dedicated simulators for the selected groups in `viewports.json`,
opens actual Safari, and installs a separate fixture web app through Add to Home Screen. It reuses that fixture app when
its Home Screen icon is already present. It checks portrait and landscape in both shells. Fullscreen is attempted only
when the native page exposes the API. Every exported state must match the requested mode and orientation at visual
scale 1. On integrated displays, the export must match the selected screen geometry and native screenshot dimensions.
The collector supports app placement on the primary display. Alternate integrated displays and rotation failures remain
explicit gaps; powering another integrated screen off is not a supported placement method. Unsupported and failed states
remain coverage gaps. Native search retains all candidates, named baseline/candidate screenshots, and the Xcode result
bundle. `catalog.json` groups actual viewport, safe area, input capabilities, pane layout, and all four Grid frame
bounds. Model names remain provenance.

For a manual capture, set `SIMULATOR_UDID` to an available simulator's UUID, then open the probe:

```sh
xcrun simctl openurl "$SIMULATOR_UDID" 'http://127.0.0.1:5173/?demo=grid&geometry'
```

Use Geometry → Capture all views → Copy JSON in the simulator, then save its clipboard and native screen:

```sh
xcrun simctl pbpaste "$SIMULATOR_UDID" > geometry.json
xcrun simctl io "$SIMULATOR_UDID" screenshot geometry.png
```

Repeat after rotation and after actual Home Screen installation. Verify the recorded presentation mode; do not infer it
from the launch method or screen dimensions.

Coverage rows keep Safari, Chrome-like, and installed-app shells separate. They also separate presentation mode and
orientation. `synthetic-only` does not establish native browser coverage. Unavailable configurations, including physical
iOS Chrome and portrait monitors, remain explicit gaps until their own measurements exist.
