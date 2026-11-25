# Ipsum Dolor

`ipsum.pdf` is an illustrated A4 reading document with 11 pages, EB Garamond typography, and linked printed contents.
All authored text, including headings, is lorem ipsum. The supplied historical cover scan retains its original
lettering. `ipsum.tex` owns layout, cover, headings, and text. `ipsum.png` is the owner-supplied cover image.

The PDF has three chapter outlines. It is an ordinary PDF with no authored page names or editable paint.

Use the explicit `ipsum` task in the [demo guide](../README.md#explicit-production). ConTeXt runs until references and
contents converge. The Ruby producer in `lorem/lorem.rb` disables runtime dates, normalizes the trailer ID with QPDF,
and verifies outlines and the 2 MiB size budget before publication. Intermediate files stay under root
`.local/tmp/demo/ipsum/`. The [demo guide](../README.md#review-and-rights) records tools, review requirements, and
artwork attribution.
