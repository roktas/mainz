# Recipe Input cases

These authored inputs generate shared CLI, WASM, and web examples. Generated files stay under
`.local/var/fixtures/recipe/`.

```sh
direnv exec . bundle exec rake build:native fixtures:recipe
npm run dev -- --port 5173 --strictPort
```

| Case      | Result | Change                                                   |
| --------- | ------ | -------------------------------------------------------- |
| `ready`   | ready  | The original bytes match.                                |
| `update`  | update | Metadata changes; the named page sequence still matches. |
| `review`  | review | Named pages change order.                                |
| `count`   | review | The PDF has fewer pages; all current pages remain valid. |
| `unnamed` | review | Page names are absent.                                   |
| `compat`  | error  | The producer vetoes the saved `compat` value.            |
| `format`  | error  | The Mainz format version is unsupported.                 |
| `style`   | error  | A required profile family is unavailable.                |
| `page`    | error  | A fixed page position is outside the PDF.                |

Open `http://127.0.0.1:5173/?demo=recipe-<case>` to inspect each loading state. These development demos select their PDF
automatically. They are outside the logo menu and the production asset bundle. Click the short result in the PDF box to
open explanations and review acceptance. Details do not change the row geometry.

Each `<case>.json` records the base PDF reference. `cases.json` identifies the candidate PDF and expected state. Bind
`book` to that candidate through CLI `--inputs`. Use `apply`, `resolve`, or `align` with `--jsonl` to inspect
diagnostics. Review cases reject by default. `--force` accepts review for one operation; errors always reject.
