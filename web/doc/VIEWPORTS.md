# Viewport measurement and calibration

This document owns platform setup, viewport acquisition, calibration, and retained evidence. Read only the relevant
section. [SPEC](SPEC.md) owns product behavior. [DESIGN](DESIGN.md#grid-and-page) owns visual limits and calibration
rules. The maintained [inventory](../test/viewports.json) owns device groups, source attribution, and reference
matrices.

- [Tool storage](#tool-storage): SDK locations, moves, and cleanup boundaries.
- [Browser checks](#browser-checks): pinned tools and cross-platform test behavior.
- [Visual regression](#visual-regression): routine checks and native sampling.
- [Native mobile setup](#native-mobile-setup): Xcode, Simulator, and Android prerequisites.
- [Coverage](#coverage): representative groups and evidence limits.
- [Collection and calibration](#collection-and-calibration): capture commands and acceptance.
- [Retained evidence](#retained-evidence): archive contents and completed measurement scope.

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

Use the pinned Node version and the root commands in [AGENTS](../../AGENTS.md#setup-and-checks). Run one browser suite
per host at a time. Tests start their own servers. Install a missing browser with:

```sh
npm --prefix web exec -- playwright install chromium
```

`PLAYWRIGHT_CHANNEL=chrome` selects installed Chrome. Kant uses `chrome-beta`; record the actual browser version with
its results. On macOS, use Playwright's `ControlOrMeta` for native selection and modified pointer actions. Keep explicit
Control shortcuts where they test the application's documented keyboard contract. Wait for stable rendered geometry
before comparing dimensions. Use floating DOM bounds rather than rounded `clientWidth` for subpixel assertions.

For remote runs, use complete, hash-verified source and WASM package snapshots outside Dropbox. Set `MAINZ_WASM_DIR` to
the package snapshot. Rebuilding a shared package can synchronize its temporary deletion before its replacement arrives.
Shared Git metadata can also overwrite a host's index during concurrent work. Use one host to edit and commit; run
remote validation from the private snapshot. Keep both snapshots fixed for the entire run and retain their digests with
the result.

Asset preparation hashes the complete public, PDF.js, and verified WASM asset contents. It publishes complete snapshots
atomically. Different asset revisions use separate directories; consumers of identical contents share one snapshot.

## Visual regression

Start or reuse the preview server and share a working URL before the first visual edit. Keep it available until push.
Choose checks from the affected behavior rather than repeating the full device inventory for each change.

| Change                                                                     | Required evidence                                                                                                                                                                 |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local spacing, labels, icons, or colors                                    | Focused browser regression at narrow phone, regular phone, large phone, and tablet widths; both themes and relevant selection states. Include enlarged text when controls change. |
| Page/Grid sizing, scrolling, touch, safe areas, or presentation mode       | The browser checks above, plus native Simulator samples at the affected boundaries and modes.                                                                                     |
| Shared viewport calibration, a new device group, or a new OS/browser shell | Recollect affected native groups; use the full inventory when the change affects all groups. Retain measured and synthetic coverage separately.                                   |

The Page regression in `geometry.test.js` checks one-row controls, frame-edge alignment, image gutters, initial zoom,
Fit, and retained manual zoom. It includes narrow widths, adjacent layout boundaries, enlarged text, and both themes.
The composition suite checks addition, removal, and movement, including reduced motion. These browser checks are the
routine CI gate. They do not establish native Safari behavior.

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

### Android

Install official Android command-line tools, platform tools, the emulator, and a compatible system image in the home
SDK. Discover available packages with `sdkmanager --list`; accept required SDK licenses. Use `avdmanager` to create a
dedicated test AVD and keep its image in `~/.android/avd/`. Record API level, image revision, launcher, Chrome version,
screen geometry, and emulator acceleration. A Google Play image includes a browser, but its bundled version can be old.

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

## Coverage

Use one compatible representative for equal screen geometries, then split groups if native usable bounds differ. Screen
profile points, browser CSS viewport, safe area, and rendered Grid bounds are different measurements. Capture
orientation and browser UI independently. An installed web app has its own shell; do not count it once for Safari and
again for Chrome. Do not subtract an estimated toolbar allowance from an already measured browser viewport.

The recorded iOS inventory contains 63 compatible profiles, 19 preliminary groups, and 20 integrated screen geometries.
The lower bounds are iPhone SE generation 2/iPhone 11 and normal iPad generation 9. Generation 8 is incompatible with
the installed runtimes. iOS 27.0 serves the standard groups; Duo requires the installed iOS 27.1 runtime. This is a
snapshot of available simulator profiles, not a claim that each profile was independently tested.

| Portrait profile points | iPhone representative | Covered profiles                         |
| ----------------------- | --------------------- | ---------------------------------------- |
| 360 × 780               | 13 mini               | 12 mini, 13 mini                         |
| 375 × 667               | SE, generation 3      | SE, generations 2–3                      |
| 375 × 812               | 11 Pro                | 11 Pro                                   |
| 390 × 844               | 16e                   | 12, 12 Pro, 13, 13 Pro, 14, 16e, 17e     |
| 393 × 852               | 16                    | 14 Pro, 15, 15 Pro, 16                   |
| 402 × 874               | 17 Pro                | 16 Pro, 17, 17 Pro, 18 Pro               |
| 414 × 896               | 11                    | 11, 11 Pro Max                           |
| 420 × 912               | Air                   | Air                                      |
| 428 × 926               | 13 Pro Max            | 12 Pro Max, 13 Pro Max, 14 Plus          |
| 430 × 932               | 15 Pro Max            | 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus |
| 440 × 956               | 16 Pro Max            | 16 Pro Max, 17 Pro Max, 18 Pro Max       |
| 466 × 678 and 669 × 951 | Duo                   | Duo, both integrated displays            |

| Portrait profile points | iPad representative       | Covered profiles                                                     |
| ----------------------- | ------------------------- | -------------------------------------------------------------------- |
| 744 × 1133              | mini, generation 6        | mini generation 6, mini A17 Pro                                      |
| 810 × 1080              | normal, generation 9      | Generation 9                                                         |
| 820 × 1180              | Air 11-inch M3            | Normal generation 10 and A16; Air generations 4–5; Air 11-inch M2–M4 |
| 834 × 1194              | Pro 11-inch, generation 4 | Pro 11-inch, generations 2–4                                         |
| 834 × 1210              | Pro 11-inch M4            | Pro 11-inch M4–M5                                                    |
| 1024 × 1366             | Air 13-inch M3            | Air 13-inch M2–M4; Pro 12.9-inch, generations 4–6                    |
| 1032 × 1376             | Pro 13-inch M4            | Pro 13-inch M4–M5                                                    |

### Desktop references

Mac notebooks and desktop displays use the same schema and search as mobile. A Mac mini, Studio, or Pro has no intrinsic
screen size. The inventory retains model scope and source attribution for each logical-screen reference. Panel pixels
are not CSS pixels. Reported scaled modes and inferred 2× modes remain explicitly attributed in the inventory.

Where native acquisition is unavailable, the agreed fallback uses the full logical screen and a browser estimate at the
same width with `round(0.91 * screenHeight)`. These are synthetic tuning references. They do not measure actual browser
bars or native macOS fullscreen. The 15 distinct groups produce 30 fullscreen/estimated-browser viewports, including
FHD, QHD, and UHD:

| Logical screen | Representative and scope                                                         | 0.91-height seed |
| -------------- | -------------------------------------------------------------------------------- | ---------------- |
| 1408 × 881     | MacBook Neo, A18 Pro; reported scaled mode                                       | 1408 × 802       |
| 1440 × 900     | MacBook Air M1 and 13-inch Retina MacBook Pro; supported scaled reference        | 1440 × 819       |
| 1470 × 956     | 13-inch MacBook Air M2–M5; reported scaled mode                                  | 1470 × 870       |
| 1710 × 1107    | 15-inch MacBook Air M2–M5; reported scaled mode                                  | 1710 × 1007      |
| 1512 × 982     | 14-inch MacBook Pro M1–M5 family, at 2× Retina                                   | 1512 × 894       |
| 1728 × 1117    | 16-inch MacBook Pro M1–M5 family, at 2× Retina                                   | 1728 × 1016      |
| 2240 × 1260    | 24-inch iMac M1/M3/M4, at 2× Retina                                              | 2240 × 1147      |
| 2560 × 1440    | QHD display; 27-inch 5K iMac, Studio Display, or Studio Display XDR at 2× Retina | 2560 × 1310      |
| 3008 × 1692    | Pro Display XDR, at 2× Retina                                                    | 3008 × 1540      |
| 1920 × 1080    | FHD display; UHD display at an explicit 2× Retina mode                           | 1920 × 983       |
| 3840 × 2160    | UHD display at an explicit 1× mode                                               | 3840 × 1966      |
| 1280 × 800     | 12-inch MacBook (2017), supported scaled reference                               | 1280 × 728       |
| 1680 × 1050    | 15-inch Retina MacBook Pro (2012–2019), supported scaled reference               | 1680 × 956       |
| 1792 × 1120    | 16-inch Intel MacBook Pro (2019), supported scaled reference                     | 1792 × 1019      |
| 2048 × 1152    | 21.5-inch Retina 4K iMac (2017/2019), at 2× Retina                               | 2048 × 1048      |

### Evidence limits

Keep simulator, physical, synthetic, and replay evidence distinct. Chromium touch emulation is useful for regression; it
does not reproduce Safari bars, safe areas, or physical gestures. A screenshot and matching exported geometry are
required for native evidence. Retail iOS Chrome is unavailable in the installed Simulator runtimes. Duo
alternate-display and landscape failures remain explicit gaps. Physical mobile validation is outside the agreed scope of
this analysis. Native Mac Safari timeouts and failed Chrome fullscreen entry do not count as measured coverage. Windows
display scaling requires a Windows measurement.

## Collection and calibration

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

The collector reuses one UI-test build. It creates dedicated simulators for the selected groups in
[`viewports.json`](../test/viewports.json), opens actual Safari, and installs a separate fixture web app through Add to
Home Screen. It reuses that fixture app when its Home Screen icon is already present. It checks portrait and landscape
in both shells. Fullscreen is attempted only when the native page exposes the API. Every exported state must match the
requested mode and orientation at visual scale 1. On integrated displays, the export must match the selected screen
geometry and native screenshot dimensions. The collector supports app placement on the primary display. Alternate
integrated displays and rotation failures remain explicit gaps; powering another integrated screen off is not a
supported placement method. Unsupported and failed states remain coverage gaps. Native search retains all candidates,
named baseline/candidate screenshots, and the Xcode result bundle. `catalog.json` groups actual viewport, safe area,
input capabilities, pane layout, and all four Grid frame bounds. Model names remain provenance.

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

## Retained evidence

The completed analysis is retained under root `.local/var/viewport/`. It is generated evidence, excluded from Git, and
must survive temporary-output cleanup. Keep that directory in a backed-up workspace. The interactive `index.html` links
the raw artifacts; `report.md` and `summary.md` explain results and limitations.

| Artifact                                     | Purpose                                                                                                   |
| -------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `scope.json`, `catalog.json`, `changes.json` | Coverage, geometry groups, accepted changes                                                               |
| `native/`                                    | Native JSON/CSV, named screenshots, candidate searches, acquisition logs                                  |
| `desktop/`                                   | Thirty desktop viewports, before/applied records, candidate searches and screenshots                      |
| `source/`                                    | Source snapshots, manifests, hashes, and the original planning record                                     |
| `checks/`                                    | Validation logs and acceptance records                                                                    |
| `followup/`                                  | Later fixes, screenshots, source provenance, and validation results                                       |
| `page/`                                      | Page sizing and animation follow-up: before/after geometry, native samples, source hashes, and test logs. |

The completed search evaluated 2,238 candidates across 82 distinct native environments and 833 candidates across 30
desktop references: 3,071 paired-density candidates. Successful native test bodies alone took 2.63 hours, excluding
setup, failures, and review. The initial timing estimate underestimated retries. No paid device service was used;
model/API monetary cost is not available from the workspace.

Current application verification covers all 72 primary modes across the 18 standard phone/tablet groups and two Duo
portrait modes. Six Duo primary modes remain unavailable. Optional fullscreen observations and earlier-CSS captures have
separate status in the report. The final reference run contains 110 records and 440 pane/density views across both
themes. Nine touch and six desktop CSS bands were accepted; DESIGN owns their current dimensions. Native captures and
logical desktop estimates retain distinct provenance.

Before cleanup, retain successful and failed logs, source revision/hashes, fixture digests, capture metadata, accepted
and rejected candidates, and representative native screenshots. Verify report links and hashes. Remove disposable build
products and videos only after their needed exports are retained. Do not overwrite historical measurements with new
results; add a clearly identified capture or follow-up record. These artifacts document measured environments, not
universal physical-device certification.
