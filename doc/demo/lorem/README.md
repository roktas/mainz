# Lorem Ipsum

`lorem.pdf` is an illustrated A4 reading document with 42 pages, EB Garamond typography, and linked printed contents.
All authored text, including headings, is lorem ipsum. The supplied historical cover scan retains its original
lettering. `lorem.tex` owns layout, cover, headings, and text. `lorem.png` is the owner-supplied cover image.

The PDF has 40 outline entries: four chapters, twelve sections, and twenty-four subsections. A metadata-only Mainz
manifest names its first page Cover. It exposes no editable paint.

Use the explicit `lorem` task in the [demo guide](../README.md#explicit-production). ConTeXt runs until references and
contents converge. The Ruby producer in `lorem/lorem.rb` disables runtime dates, normalizes the trailer ID with QPDF,
and verifies outlines and the 2 MiB size budget before publication. Intermediate files stay under root
`.local/tmp/demo/lorem/`. The [demo guide](../README.md#review-and-rights) records tools, review requirements, and
artwork attribution.
