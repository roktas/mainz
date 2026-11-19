# Browser checks and native evidence

This guide owns browser checks, SDK setup, viewport acquisition, calibration, and retained evidence. The
[workspace contract](spec/web.md) owns behavior. The [GUI contract](spec/gui.md) owns visual requirements.
[AGENTS.md](../AGENTS.md#build-and-validation) owns build commands and component gates.

Read the relevant section:

- [Tool storage](#tool-storage): SDK locations and cleanup boundaries.
- [Browser checks](#browser-checks): test modes, groups, and platform limits.
- [Visual regression](#visual-regression): focused checks and native sampling.
- [Native mobile setup](#native-mobile-setup): Xcode, Simulator, and Android prerequisites.
- [Coverage](#coverage): dimension inputs, source attribution, and evidence limits.
- [Collection and geometry](#collection-and-geometry): capture commands and acceptance.
- [Retained evidence](#retained-evidence): archive locations and preservation.

## Tool storage

Keep large SDKs, runtimes, toolchains, browser downloads, and shared caches outside Dropbox. Use the platform's standard
home locations. Keep project dependencies, build output, packages, and retained measurements in the root `.local/` tree.
Do not put a compatibility symlink from `.local/` to a moved SDK.

| Tool                         | Home location or selection                                        |
| ---------------------------- | ----------------------------------------------------------------- |
| Xcode and Simulator runtimes | `/Applications/Xcode.app` and Xcode-managed system locations      |
| Xcode DerivedData            | `~/Library/Developer/Xcode/DerivedData/Mainz`                     |
| Android SDK                  | `~/.local/share/android/`, selected through `ANDROID_HOME`        |
| Android virtual devices      | `~/.android/avd/`                                                 |
| Emscripten SDK               | `~/.local/share/emsdk/`, activated through its `emsdk_env.sh`     |
| Pinned Node distributions    | `~/.local/share/nodejs/`; use the version in root `.node-version` |
| Playwright browser downloads | The platform default user cache; do not override it into Dropbox  |

Vite keeps a separate cache for each checkout under `~/.cache/mainz/vite/` on Linux or `~/Library/Caches/Mainz/vite/` on
macOS. Browser tests use the same configuration. Do not share optimized dependency caches through Dropbox: another host
can invalidate module URLs and produce blank pages with HTTP 504 responses.

`ANDROID_HOME` selects the SDK. `EMSDK` must identify the activated SDK before CMake configuration or WASM packaging.
CMake uses that variable for Emscripten and its sysroot. CI can use its ephemeral workspace because it is outside
Dropbox. Select the host architecture when installing Node; do not synchronize executable tool distributions between
hosts.

Before moving tools, stop their consumers. Move the installed tree, update environment variables and absolute generated
configuration, and verify the new path. Reactivate Emscripten after its move. Update Android AVD `path` entries if an
AVD moves. Reconfigure build trees whose caches contain the old toolchain path. Check build and package tasks before
deleting obsolete download archives or caches. Preserve retained measurements before cleaning `.local/tmp/`.

## Browser checks

Use the pinned Node version and the root commands in [AGENTS](../AGENTS.md#setup-and-checks). Run one browser suite per
host at a time. Standard fixtures reuse one Vite server per file through `test/server.ts`. `test/browsers.js` reuses one
default browser process per engine and file. Each scenario closes its own contexts and storage. Custom launch
requirements retain separate processes. Production startup scenarios share one scoped build and keep separate preview
servers. Custom server scenarios own their server lifecycle. Install a missing browser with:

```sh
npm --prefix web exec -- playwright install chromium webkit
```

During development, run focused checks for the affected behavior. `npm run test:minimal` groups formatting, lint, types,
unit tests, and critical browser scenarios. Those scenarios cover PDF opening, render ownership, metadata cleanup,
Style, Download, cancellation, keyboard, touch, pinch zoom, closed-section drops, preparation priority, and long Output
scrolling. Reserve long suites and complete matrices for ship.

Before ship, run `npm run test:standard`. It adds asset publication checks, a production build, and the functional
browser regressions. Standard covers opening, editing, Style, Download, cancellation, PDF ownership, selection,
keyboard, touch, offline use, updates, and long Output scrolling. Animation checks use a desktop and phone without CPU
throttling. Standard uses representative desktop and touch cases for continuous Grid scrolling, shared frames, and
Normal card hit targets. The hit-target checks cover consecutive rows and verify that the scroll frame clears the status
bar after pane and text-size transitions. Standard omits the full alignment and Page geometry matrices, Grid viewport
matrices, and calibration tools. Opacity layout checks use representative phone and desktop widths; full mode retains
all four widths. The compact List checks use the minimum width and both sides of the page-actions breakpoint in standard
mode.

Before a release, run `npm run test:full`. It includes every application browser scenario, complete animation matrices
with CPU throttling, and viewport geometry checks. Animation command entrypoints run once. Core addition, removal,
movement, and reduced-motion operations cover each affected viewport. All modes include the same static rules and unit
tests. Native, WASM, sanitizer, and package tasks remain subject to [AGENTS](../AGENTS.md#build-and-validation).

The workspace suite checks Help sizing and panel scrolling in Chromium and WebKit. The export suite owns PDF export and
native PDF printing. Printing launches full Chromium with `channel: "chromium"`; CI installs it for the export group.
The Grid suite checks portrait phone geometry in both engines. The Page suite checks double activation zoom in both
engines and uses Chromium's native touch dispatch for swipe, pan, and pinch. WebKit tests do not establish native iPadOS
Safari behavior.

The startup group includes static screencast routes, native WebM/MP4 playback, format tabs, and reduced-motion previews
in Chromium and WebKit. Its checks cover scoped static hosting and enlarged text. Screencast capture remains an explicit
task in the [capture guide](help/README.md).

The focused `Header messages fit representative Apple touch layouts` check covers the inventory's SE generation 3,
iPhone 16, iPad mini generation 6, and standard iPad viewports in Chromium and WebKit. It samples normal and 200% text,
both themes, selected landscape layouts, and modal errors. Screenshots go to `.local/tmp/web/layout/feedback/`. These
are browser emulations; they do not establish physical-device or native Safari behavior.

On Linux, Playwright's screenshot CLI disables mobile and touch emulation for WebKit device presets. Use a Chromium
touch preset for CLI screenshots. The WebKit suites create contexts with explicit mobile and touch settings.

UI fonts follow the platform. The Page-label scenario covers the system font and DejaVu Sans at enlarged phone text.
Both fonts must pass the same readability, full-label access, and control separation checks. Font variants do not relax
content, geometry, or interaction requirements.

`npm run test:browser` defaults to standard mode. Add a mode and group to run focused checks, for example
`npm run test:browser -- full grid`. Append Node test flags after the group, for example
`npm run test:browser -- standard grid --test-name-pattern='scroll'`. The runner table defines the CI groups and their
browser requirements. Each browser file belongs to one group. Add new files to `test/run.ts`. Tests keep separate
servers, browser contexts, and storage between files. Grid and List have separate groups. The `sections` group owns
shared section behavior, `style` owns Style behavior, and `layout` owns broad workspace layout scenarios. The `preview`
group covers PDF ownership, processor-worker recovery, and lens tests. The `composition` group also runs transfer tests.
The `startup` group also runs installation and asset publication tests. The `workspace` group runs workspace and checks
tests. Feedback and export have separate groups.

`npm test` selects the fast `.test.ts` files. The browser runner selects `.test.js` integration files, including asset
verification. Minimal mode omits the asset case; standard and full include it. Both runners use Node's test runner. The
extension split is an existing selection convention. Node can also run TypeScript integration tests. A conversion must
update file selection and enable type checking for those tests.

The export suite resolves and composes the downloaded Recipe through WASM. Set `MAINZ_CLI` to the absolute path of the
native binary to compare the same Recipe through `mainz apply`. The native comparison uses QPDF and Poppler.

```sh
MAINZ_CLI="$PWD/.local/var/cpp/build/native/mainz" npm run test:browser -- standard export --test-name-pattern='through WASM replay'
```

Measure projection time and retained heap on the overlapping bookmark fixture.

```sh
node --expose-gc --test --test-name-pattern='Non-monotonic bookmarks' web/test/outline.test.ts
```

Grid tests own viewport boundaries and continuous scrolling. Boundary sweeps omit mouse viewports already covered by
desktop references. Historical reference matrices remain evidence, not current capacity requirements. Alignment tests
cover each distinct card geometry, both themes and panes, normal/200% text, selected states, and long page numbers. They
do not repeat every nearby calibration boundary. Geometry setup dispatches clicks directly to prevent incidental pointer
effects. Interaction tests retain real pointer and keyboard actions. Page geometry tests own fitted image and control
alignment. They cover fitted and enlarged pages across the matrix, with zoom limits at representative phone and desktop
widths. Production smoke tests cover enlarged phone text and a tablet. The development suites own the larger interaction
and layout matrices. Failure screenshots and asserted raster captures remain part of the suites.

### Output printing checks

The browser Print test substitutes the operating-system dialog only. It retains generated PDF bytes and checks their
page count, styles, filename, and equality with Download. This test does not establish native print-dialog support.
Native Safari acceptance uses its normal UI. Safari controlled by WebDriver can suppress `window.print()`.

Native checks on 2026-10-31 cover the separate-window Print path. macOS 27.0.1 (26A434), Safari 27.0.1
(22625.1.29.11.28), and an iPad (9th generation) simulator with iOS 27.0 (24A434) show all eight Output pages. The iOS
27.0 Home Screen app opens the PDF but does not open the native print sheet. Home Screen printing remains unaccepted on
this runtime. The available iOS 27.1 runtime supports only iPhone Duo. Its fixture navigation failed before Print. That
run supplies no printing result. On 2026-11-01, the user reports native print dialogs in Chrome and Safari Home Screen
on a physical iPad (8th generation), iPadOS 26.6.2. Safari sometimes requests permission to print. This browser prompt
is permitted. Physical printer output remains untested.

Evidence is retained in `.local/var/printing/followup/`, including source changes, browser logs, native logs,
screenshots, and the fixture digest. Keep native Safari and Home Screen results separate. A PDF tab alone does not prove
that the system print sheet opened or that all pages reached it.

The 2026-11-01 View follow-up uses the same iPad simulator and iOS 27.0 runtime. Home Screen Safari reserves its viewer
during the tap and loads the completed PDF after inspection. Closing it preserves a custom nine-page Output.
`view12.log` and `View12.swift` retain this native scenario. The user reports direct View without a second confirmation
in Chrome and Safari Home Screen on the physical iPad with iPadOS 26.6.2. Browser regressions cover Chrome opening
without a download and Home Screen cancellation closing the reserved window.

The user also reports working native Share on the physical iPad with iPadOS 26.6.2. Safari Home Screen opens the system
panel directly. Chrome in a tab requires a fresh Share tap after preparation. Share and Download then use the same ready
File. The user accepted this neutral ready-file step and the shorter button labels. Native Save to Files offered iCloud
and Dropbox, and the user completed an iCloud save. Android has browser regression coverage with its user agent and a
substitute for the native sharing API. No physical Android result is available.

Grid browser scenarios supply their PDF through request routing. They do not require the manual
`.local/var/fixtures/magna.pdf` fixture. Native geometry collectors use that copy. Explicitly remake and install `magna`
before collecting measurements. The [fixture guide](../web/test/fixtures/README.md) owns the refresh steps; the
[demo guide](demo/README.md) owns optional production.

Before merging changes to shared layout, Grid/Page geometry, or calibration rules, run the affected full groups:
`alignment`, `grid`, or `geometry`. Calibration-tool changes also require `viewport`. Record the commands and results in
the PR or handoff. Documentation-only changes do not require these matrices. Standard CI remains the functional gate for
ordinary PRs and pushes.

`npm run test:viewport` runs the full current Grid geometry and viewport checks. Keep the native measurement evidence
required below.

CI runs standard in thirteen browser groups for main pushes and pull requests: Grid, List, sections, Style, layout,
preview, composition, selection, startup, Page, workspace, feedback, and export. Preview covers PDF rendering, lens, and
processor tests. Workspace covers workspace and Recipe checks. Workspace and feedback both download the generated Recipe
cases; feedback uses them for its review demo. A `v*` version tag runs full in sixteen groups, adding alignment,
geometry, and viewport. Each job runs its browser files sequentially. Export installs full Chromium for native printing.
Every group that uses WebKit installs it, including full alignment. Failed jobs retain layout screenshots and their JSON
measurements. Native, sanitizer, and WASM checks run for both modes. Browser jobs wait for the native job that supplies
WASM. The sanitizer job runs independently. Deployment requires both jobs and all browser groups to pass. In GitHub
Actions, open **Check and publish Mainz → Run workflow** and select `standard` or `full` for a manual check. Manual
checks never upload a Pages artifact, deploy, or cancel a push run. Only a successful push to `main` deploys the web
application.

`PLAYWRIGHT_CHANNEL=chrome` selects installed Chrome; `chrome-beta` selects the Beta channel. Record the actual browser
version with its results. On macOS, use Playwright's `ControlOrMeta` for native selection and modified pointer actions.
Keep explicit Control shortcuts where they test the application's documented keyboard contract. Wait for stable rendered
geometry before comparing dimensions. Use floating DOM bounds rather than rounded `clientWidth` for subpixel assertions.

For remote runs, use complete, hash-verified source and WASM package snapshots outside Dropbox. Set `MAINZ_WASM_DIR` to
the package snapshot. Rebuilding a shared package can synchronize its temporary deletion before its replacement arrives.
Shared Git metadata can also overwrite a host's index during concurrent work. Use one host to edit and commit; run
remote validation from the private snapshot. Keep both snapshots fixed for the entire run and retain their digests with
the result.

### Asset snapshots

Asset preparation hashes the complete public, PDF.js, demo, and verified WASM files. Vite publishes complete snapshots
under `.local/tmp/web/assets/`. Different contents use separate directories. Identical contents share one snapshot.

Stop Vite servers, builds, and browser tests in the checkout before removing old snapshots. The next Vite command
creates a new snapshot.

## Visual regression

Start or reuse the preview server and share a working URL before the first visual edit. Keep it available until push.
Choose checks from the affected behavior rather than repeating the full device inventory for each change.

| Change                                                                     | Required evidence                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local spacing, labels, icons, or colors                                    | Focused browser regression at narrow phone, regular phone, large phone, and tablet widths; both themes and relevant selection states. Include enlarged text when controls change. |
| Page/Grid sizing, scrolling, touch, safe areas, or presentation mode       | The browser checks above, plus native Simulator samples at the affected boundaries and modes.                                                                                     |
| Shared viewport calibration, a new device group, or a new OS/browser shell | Recollect affected native groups; use the full inventory when the change affects all groups. Retain measured and synthetic coverage separately.                                   |

The Page regression in `geometry.test.js` checks one-row controls, frame-edge alignment, image gutters, initial zoom,
Fit, and retained manual zoom on touch and desktop screens. It includes smaller desktop headings, narrow widths,
adjacent layout boundaries, enlarged text, and both themes. The composition suite checks addition, removal, and
movement, including reduced motion. Full mode includes all these checks. Standard mode retains the composition checks
with the smaller animation matrix described above. Browser checks do not establish native Safari behavior.

Page interaction checks cover conditional horizontal keys and touch swipes, width fitting, unconditional keyboard reset,
and image double activation. They preserve selection, composition, focus, and panning at image edges. Scroll-limit
checks keep Chromium's native scrollbars enabled.

For Page sizing, sample SE generation 3, iPhone 16, iPhone 16 Pro Max, and iPad mini generation 6. These cover short,
regular, large, and tablet viewports. Safari in both orientations and portrait Home Screen mode give 12 native states.
Inspect both panes in each state. Use one representative for equal geometry. Do not repeat every compatible model when
these samples and the boundary tests cover the change. Expand the sample only when a result exposes another failure.
Keep source and fixture hashes, platform versions, native screenshots, bounds, and test outcomes with the evidence.

## Native mobile setup

### Xcode and Simulator

Use a Mac with full Xcode, a logged-in GUI session, and compatible Simulator runtimes. Prefer SSH execution with saved
artifacts. Screen Sharing is only needed when GUI permissions or first-run prompts require it. An SSH session alone does
not establish that WindowServer and Simulator automation are usable. Discover actual runtime support first:

```sh
sw_vers
xcodebuild -version
xcode-select -p
xcrun simctl list runtimes
xcrun simctl list devicetypes
xcrun simctl list devices available
```

Select the intended Xcode installation, accept its license, and complete its first-launch setup before testing. These
system setup steps can require local administrator authorization. Use an explicit device UDID; verify boot readiness,
URL access, and a native screenshot:

```sh
xcrun simctl boot "$SIMULATOR_UDID"
xcrun simctl bootstatus "$SIMULATOR_UDID" -b
xcrun simctl openurl "$SIMULATOR_UDID" 'http://127.0.0.1:5173/?demo=grid&geometry'
xcrun simctl io "$SIMULATOR_UDID" screenshot geometry.png
```

The URL must be reachable from the Mac. Use a local server or an SSH tunnel. Keep the display awake during browser/UI
tests. Animation-frame timeouts on a hidden or sleeping page are failed acquisitions. The maintained collector uses
XCUITest for rotation and Home Screen installation; `simctl` alone does not provide these interactions. Its build output
uses the home DerivedData directory above. Delete only the collector's dedicated test devices after retained evidence is
complete. Keep installed runtimes for future runs.

For a simulator with multiple displays, select the active display explicitly with
`simctl io ... screenshot --display=...`. On Duo, `primary-1` captures the Open inner display; XCTest screenshots can
capture the inactive outer display. Use Device Hub to rotate Duo when XCTest orientation changes do not rotate it.
Verify the exported content viewport and screenshot dimensions together; the browser's screen dimensions can still
describe the outer display.

### Android

Install official Android command-line tools, platform tools, the emulator, and a compatible system image in the home
SDK. Discover available packages with `sdkmanager --list`; accept required SDK licenses. Use `avdmanager` to create a
dedicated test AVD and keep its image in `~/.android/avd/`. Record API level, image revision, launcher, Chrome version,
screen geometry, CPU acceleration, and graphics backend. Retain boot logs and failed acquisitions when the guest or
browser stalls. A Google Play image includes a browser, but its bundled version can be old.

After boot readiness, expose the production preview to the emulator:

```sh
adb wait-for-device
adb shell getprop sys.boot_completed
adb reverse tcp:4173 tcp:4173
adb shell am start -a android.intent.action.VIEW -d 'http://127.0.0.1:4173/'
adb exec-out screencap -p > android.png
```

Check the actual Chrome install dialog, installed launcher icon, and app launch. A dialog alone does not prove
successful installation. Review the icon in light and dark contexts and with representative launcher masks. The
manifest's 512 px icon uses `any maskable`; the browser regression checks that important artwork fits the central safe
circle with radius 40% of the image width. See the [maskable icon guidance](https://web.dev/articles/maskable-icon).
Keep iOS touch icons and the in-page logo separate. Android installation evidence does not establish iOS behavior.

For Grid acquisition, use four primary environments per configured display: Chrome with expanded controls and an
installed app in `standalone` display mode, each in portrait and landscape. Export Input and Output Grid in each
environment. Keep text size, zoom, theme, and navigation configuration fixed. Standalone mode can retain Android status
and navigation bars; it does not mean the Fullscreen API or an immersive window.

Use native rotation and `adb` framebuffer screenshots. Attach to the guest Chrome through its remote debugging socket
for the existing geometry probe. Select the requested display mode and verify active animation frames: a background
Chrome target can report itself as visible while its frames are suspended. Check the exported mode, orientation, DPR,
visual scale, viewport units, and native browser controls before accepting a capture. Keep both pane views at the same
viewport. For the expanded-control reference, the content height must match the small viewport height (`svh`).

Set panel dimensions and density in a dedicated AVD configuration before boot. Verify the resulting native PNG
dimensions. A runtime logical-size override alone does not establish a matching physical framebuffer. Record the base
hardware profile, cutout, system image, and density. A custom Samsung or Xiaomi panel on a Google image measures that
emulator scenario; it does not establish manufacturer software behavior or factory CSS geometry.

Record whether installation produced a WebAPK or a Chrome-managed launcher shortcut. Accept a standalone measurement
only after launching the installed icon, confirming standalone display mode and checking that Chrome controls are
absent. Retain installation failures separately. A shortcut capture does not establish WebAPK coverage. Keep collapsed
controls, alternate navigation/taskbar settings, split-screen, Fullscreen API, and synthetic replay separate from the
four primary environments. Candidate search and application fine tuning follow delivery of the baseline.

## Coverage

Use one compatible representative for equal screen geometries. Split groups when native usable bounds differ. Screen
profile points, CSS viewport, safe area, and rendered Grid bounds are separate measurements. Capture orientation and
browser UI independently. An installed web app has its own shell; do not count one capture as both Safari and Chrome. Do
not subtract estimated browser bars from an already measured CSS viewport.

The shared [dimension inputs](../web/test/dim.json) contain:

| Section      | Responsibility                                                                            |
| ------------ | ----------------------------------------------------------------------------------------- |
| `cases`      | 65 viewport cases with input capabilities and source attribution                          |
| `simulators` | 19 representative groups, runtime selection, screen geometry, and represented model names |
| `desktops`   | Logical-screen references, scaling assumptions, and their sources                         |
| `coverage`   | Shell, presentation-mode, and orientation templates for collection reports                |

`cases` supplies regression dimensions, not expected Grid row counts. Current acceptance concerns readable cards,
correct spacing, bounded mounting, and complete scroll reachability. Historical capacity matrices do not define the
single-density Grid contract.

The Simulator catalog records 63 compatible profiles and 20 integrated screen geometries, captured on 2026-10-20. It
does not establish that every model was tested. Runtime compatibility and native usable bounds require collection.
Standard groups use the recorded iOS 27.0 runtime; Duo requires the recorded iOS 27.1 runtime.

### Android references

Historical Android measurements belong in retained evidence under `.local/var/viewport/android/2026-10-22/`. The
historical inventory is in `.local/var/viewport/inventory.json`. Active dimension inputs are in
[`web/test/dim.json`](../web/test/dim.json).

Keep panel pixels, configured density, target-model attribution, actual CSS bounds, and raw screenshots together. Target
names and custom density seeds do not establish tested OEM devices. Equal panels do not establish equal DPR, system
bars, cutouts, or usable CSS bounds. Factory display settings and native browser behavior require device evidence.

### Desktop references

A desktop computer has no intrinsic screen size. Panel pixels, logical screen dimensions, and DPR remain separate. The
dimension inputs retain model scope and sources for reported or inferred scaling.

When native acquisition is unavailable, synthetic cases use the logical screen and an estimated browser height of
`screenHeight - 120 CSS px`. The allowance approximates browser and desktop controls at ordinary scale. These cases do
not measure browser bars or native fullscreen. Actual CSS viewport measurements take precedence. Keep platform versions,
window bounds, screenshots, and source hashes with each measurement. Keep host names and personal display details in
local evidence, outside tracked documentation.

### Evidence limits

Keep simulator, physical, synthetic, and replay evidence distinct. Chromium touch emulation does not reproduce Safari
bars, safe areas, or physical gestures. Native evidence requires a screenshot paired with its exported geometry.
Matching model names or screen dimensions do not establish equivalent browser space.

Unavailable or failed acquisition remains a coverage gap. A capture timeout or failed fullscreen entry supplies no
measurement. Windows scaling requires Windows measurements. Retail iOS Chrome requires its own physical-device evidence.
Alternate Duo displays and Home Screen modes retain their own acquisition limits.

Physical Safari follow-up records include 2200 × 1298, 2400 × 1358, and 2560 × 1358 CSS px windows and a fullscreen 2560
× 1440 installed web app at DPR 1. These records do not establish Studio Display or iMac coverage. DPR 2 replay remains
synthetic. Earlier two-density captures remain historical evidence.

## Collection and geometry

The development-only `?geometry` entry opens the Grid fixture and provides local JSON/CSV exports. Keep both panes in
Grid and wait for loading to finish before capture. The probe records rendered CSS bounds, viewport units, safe areas,
matching media queries, and one Normal Grid measurement per pane. Captures include the total page count, mounted card
count, visible rows, internal scroll extent, and page geometry. The capture restores the previous pane, Pages
presentation, focus, and scroll. Exported measurements contain no PDF content. Device labels are explicit metadata. The
probe leaves unknown hardware and browser configuration values unknown.

The probe page uses a development-only manifest that preserves its fixture URL when installed. Its separate Mainz
geometry app opens the probe again. The production manifest and normal installation start URL remain unchanged.

With the development server running, collect maintained viewport samples from the repository root:

```sh
npm run measure
```

The collector writes `.local/tmp/web/viewport/synthetic/`. Its `inventory.json` records source hashes, fixture digests,
software versions, coverage, and failed rules. Each sample has JSON, CSV, and two Grid screenshots. The current
measurement schema is version 2. Old measurements and candidate-search reports remain retained evidence, but no longer
provide current capacity acceptance criteria.

Screenshots capture the visible viewport. Full-page capture can change Chromium's emulated input capabilities on a
scrolling document. The collector rejects captures that change pointer or hover capabilities. New calibrations must
preserve the Normal Grid image dimensions and scroll behavior; do not optimize the number of visible rows.

To collect one reference or use installed Chrome on a logged-in desktop, run:

```sh
npm run measure -- --case 810x1080-coarse
npm run measure -- --native --channel chrome --environment ../.local/tmp/web/viewport/host.json --out ../.local/tmp/web/viewport/native
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

Use native Safari/Chrome evidence to decide mobile geometry when a nominal DevTools profile gives a different result.
Physical-device evidence takes priority over a simulator. Compare measured content viewport, safe area, presentation
mode, and orientation; a matching device label or logical screen size does not establish equivalent Grid space. Keep
DevTools cases as additional regressions without sacrificing the native image and control limits.

On a Mac with full Xcode and compatible Simulator runtimes, make the development URL reachable from the simulator. Run
the representative native sweep from the repository root:

```sh
npm run measure:simulator --
npm run measure:simulator -- --case 744x1133-coarse,810x1080-coarse --out ../.local/tmp/web/viewport/tablets
npm run measure:simulator -- --case 375x667-coarse --orientation landscape --mode browser-tabbed --out ../.local/tmp/web/viewport/phone
npm run measure:simulator -- --case 744x1133-coarse --mode standalone-pwa --out ../.local/tmp/web/viewport/pwa
```

The collector reuses one UI-test build. It creates dedicated simulators for the selected groups in
[`dim.json`](../web/test/dim.json), opens actual Safari, and installs a separate fixture web app through Add to Home
Screen. It closes a restored Geometry dialog before waiting for its launcher. It reuses that fixture app when its Home
Screen icon is already present. It checks portrait and landscape in both shells. Fullscreen is attempted only when the
native page exposes the API. Every exported state must match the requested mode and orientation at visual scale 1. On
integrated displays, the export must match the selected screen geometry and native screenshot dimensions. The collector
supports app placement on the primary display. Alternate integrated displays and rotation failures remain explicit gaps;
powering another integrated screen off is not a supported placement method. Unsupported and failed states remain
coverage gaps. The collector retains native Grid screenshots, JSON/CSV, acquisition logs, and Xcode result bundles.
`catalog.json` groups actual viewport, safe area, input capabilities, pane layout, and the Normal Grid bounds for each
pane. Model names remain provenance.

For a manual capture, set `SIMULATOR_UDID` to an available simulator's UUID, then open the probe:

```sh
xcrun simctl openurl "$SIMULATOR_UDID" 'http://127.0.0.1:5173/?demo=grid&geometry'
```

Use Geometry → Capture → Copy JSON in the simulator, then save its clipboard and native screen:

```sh
xcrun simctl pbpaste "$SIMULATOR_UDID" > geometry.json
xcrun simctl io "$SIMULATOR_UDID" screenshot geometry.png
```

Repeat after rotation and after actual Home Screen installation. Verify the recorded presentation mode; do not infer it
from the launch method or screen dimensions.

Coverage rows keep Safari, Chrome-like, and installed-app shells separate. They also separate presentation mode and
orientation. `synthetic-only` does not establish native browser coverage. Unavailable configurations, including physical
iOS Chrome and portrait monitors, remain explicit gaps until their own measurements exist.

## Retained evidence

Thumbnail sampling measurements belong under `.local/var/clarity/`. Keep the baseline, candidate, and applied records
with source hashes, fixture digests, browser versions, viewport, density, pixel ratio, and profile. Include cold batch
completion, first-image timing, cached revisits, and simultaneous render-canvas bytes. The canvas measurements exclude
PDF.js allocations and browser overhead. Retain the independent Poppler reference and representative before/after
images. Synthetic browser measurements do not establish physical-device performance.

The completed analysis is retained under root `.local/var/viewport/`, or in `.local/var/viewport.tar.xz` after storage
cleanup. It is generated evidence, excluded from Git, and must survive temporary-output cleanup. Keep the measurements
in a backed-up workspace. The interactive `index.html` links the raw artifacts; `report.md` and `summary.md` explain
results and limitations.

The archive preserves paths relative to `.local/`. `.local/var/viewport.manifest.json` records file sizes and SHA-256
hashes. Before using the report links, restore the measurement directory:

```sh
tar -xJf .local/var/viewport.tar.xz -C .local var/viewport
```

| Artifact                                     | Purpose                                                                                                       |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `scope.json`, `catalog.json`, `changes.json` | Coverage, geometry groups, accepted changes                                                                   |
| `native/`                                    | Native JSON/CSV, named screenshots, candidate searches, acquisition logs                                      |
| `desktop/`                                   | Thirty desktop viewports, before/applied records, candidate searches and screenshots                          |
| `source/`                                    | Source snapshots, manifests, hashes, and the original planning record                                         |
| `checks/`                                    | Validation logs and acceptance records                                                                        |
| `followup/`                                  | Later fixes, screenshots, source provenance, and validation results                                           |
| `page/`                                      | Page sizing and animation follow-up: before/after geometry, native samples, source hashes, and test logs.     |
| `headers/`                                   | Narrow header and toolbar checks, Duo Open and SE Safari captures, source hashes, and spacing comparisons.    |
| `android/2026-10-22/`                        | Android Grid baseline: native captures, display scenarios, summary CSV, report, source snapshots, and checks. |

The original Grid analysis, candidate searches, and Android baseline use an earlier two-density implementation. Their
counts, capacity matrices, timings, failures, and follow-up status belong in the archived reports. The
[GUI contract](spec/gui.md#grid-and-page) defines current geometry. A historical passing result does not establish
current native support. Preserve unresolved native failures until a new native capture addresses them.

The local inventory snapshot preserves reference metadata only. Complete raw captures can be unavailable on a given
host; restore their archive before relying on report links or claiming measured coverage.

Before cleanup, retain successful and failed logs, source revision/hashes, fixture digests, capture metadata, accepted
and rejected candidates, and representative native screenshots. Make sure that report links and hashes agree. Remove
disposable build products and videos only after their required exports are retained. Add a separate capture or follow-up
record instead of replacing historical results. These artifacts document measured environments, not universal
physical-device certification.
