# Repeated practice pages

`magna.pdf` contains 240 pages: sixty repetitions of all four pages from [dolor](../dolor/README.md). `magna.json` owns
repetition and page order. It exercises large, scrollable PDF grids.

Use the explicit `magna` task in the [demo guide](../README.md#explicit-production). The task composes the Plan with the
native CLI and verifies the page count and prepared-PDF contract.

Mainz retains the Plan in `web/test/fixtures/magna.json`. Production and offline startup compose it in the browser from
dolor. The large PDF stays outside production assets and the offline cache. The explicit `install` task copies it to
`.local/var/fixtures/magna.pdf` for development and native geometry collection. Keep Megic's authored rights metadata.
