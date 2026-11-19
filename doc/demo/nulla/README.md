# Practice session Recipe

`nulla.json` owns the Recipe seed. The generated `nulla.json` has three logical Inputs: `book` binds
[dolor](../dolor/README.md), `guides` binds [minim](../minim/README.md), and `crossings` binds
[culpa](../culpa/README.md). Output contains their first physical pages, in that order. Its title is `Practice session`,
and its cover is physical page 1.

Use the explicit `nulla` task in the [demo guide](../README.md#explicit-production). `nulla.rb` uses the native CLI's
`align` command to compute PDF references. It reads Input titles and XMP metadata and renders embedded PNG covers with
Poppler at a maximum edge of 512 pixels. It enforces the cover size limit and uses `resolve` to verify replay before
publishing the Recipe.

Remake nulla after replacing any of its three PDFs. Keep the logical IDs unchanged. The retained snapshot uses the
original browser-rendered covers; remakes use Poppler. PDF artwork retains its authored rights information.
