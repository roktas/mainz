# Open issues

This file owns unresolved device reports. [SPEC](SPEC.md) defines required behavior. Keep reproduction evidence here
until a fix and its regression test close the issue.

## iPhone Page comparison and navigation loop

**Status:** Reported by the user, not reproduced. Investigation is deferred at the user's request.

**Device:** iPhone 16 Pro Max with regular updates. The exact iOS version and Safari-tab or Home Screen mode are
unknown.

**Reported sequence:**

1. Change a page's Stamp color in Style. A link between styling and the failure is unproven.
2. Inspect the page in Output Page and activate **Show original page**. The first navigation succeeds.
3. Return to Output. The user probably pinched to zoom before the next action.
4. Activate **Show original page** again, or possibly **Compare page**. The interface appears to enter a repeating loop.
5. Try switching Input and Output. Navigation does not escape the loop. The user distinguishes this from a frozen view.

**Expected behavior:** Repeated comparison, navigation, and pinch gestures remain responsive. Navigation preserves
selection, styles, and page positions.

**Evidence:** A synthetic Chromium touch viewport at 440 × 956 completed 20 cycles without reproducing the loop. The run
changed Stamp color and alternated both actions with pinch/end/cancel variants. It provides no iOS evidence.

**Next investigation:** Start with iPhone Simulator. Try both actions with and without styling, zoom, and interrupted
gestures, including navigation before rendering settles. Record the revision, exact OS/browser versions, presentation
mode, sequence, console events, component remounts, render generations, active PDF, and gesture state. Add physical
Safari and Home Screen evidence when needed. Link a confirmed reproduction and regression test here before closure.

The preview resource cleanup change does not establish a cause or close this report.

Relevant files: `Composer.svelte`, `Page.svelte`, `App.svelte`, `Pdf.svelte`, and `page.test.js` under `web/src/` and
`web/test/`. [VIEWPORTS](VIEWPORTS.md) defines device setup and evidence requirements.
