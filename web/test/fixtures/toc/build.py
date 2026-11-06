#!/usr/bin/env python3
"""Build compact reading PDFs with real hierarchical outlines from retained public-domain text."""

from html import escape
from io import BytesIO
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.platypus.tableofcontents import TableOfContents
from svglib.svglib import svg2rlg

root = Path(__file__).parent
data = json.loads((root / "sources.json").read_text())
ink = colors.HexColor("#203c4c")
muted = colors.HexColor("#596168")
styles = {
    "cover": ParagraphStyle("cover", fontName="Times-Roman", fontSize=32, leading=36, textColor=ink, spaceAfter=18),
    "author": ParagraphStyle("author", fontName="Times-Roman", fontSize=15, leading=20, spaceAfter=16),
    "note": ParagraphStyle("note", fontName="Helvetica", fontSize=9, leading=13, textColor=muted, spaceAfter=12),
    "part": ParagraphStyle("part", fontName="Times-Bold", fontSize=21, leading=25, textColor=ink, spaceBefore=12, spaceAfter=18, keepWithNext=True),
    "chapter": ParagraphStyle("chapter", fontName="Times-Bold", fontSize=15, leading=19, textColor=ink, spaceBefore=18, spaceAfter=10, keepWithNext=True),
    "body": ParagraphStyle("body", fontName="Times-Roman", fontSize=11, leading=15, spaceAfter=8, alignment=TA_LEFT, allowWidows=False, allowOrphans=False),
}


def text(value):
    return escape(value.replace("\u2060", "").replace("\u2011", "-").replace("\u200a", " "))


class Reading(SimpleDocTemplate):
    def afterFlowable(self, flowable):
        if hasattr(flowable, "outline"):
            depth, title, key = flowable.outline
            self.canv.bookmarkPage(key)
            self.canv.addOutlineEntry(title, key, level=depth, closed=False)
            self.notify("TOCEntry", (depth, text(title), self.page, key))


def heading(title, depth, key):
    paragraph = Paragraph(text(title), styles["part" if depth == 0 else "chapter"])
    paragraph.outline = (depth, title, key)
    return paragraph


def build(name, title, author, note, source, sections):
    target = root / f"{name}.pdf"
    document = Reading(str(target), pagesize=A5, leftMargin=42, rightMargin=42, topMargin=42, bottomMargin=42,
                       title=title, author=author, subject="Public-domain reading sample with PDF section navigation")
    story = [Spacer(1, 58), Paragraph(text(title), styles["cover"]), Paragraph(text(author), styles["author"]),
             Paragraph(text(note), styles["note"]), Spacer(1, 30),
             Paragraph('Source: <link href="' + escape(source, quote=True) + '">' + text(source) + '</link>', styles["note"]),
             Paragraph("Public-domain source text. Prepared for the Mainz reading demos.", styles["note"]),
             PageBreak(), Paragraph("Contents", styles["part"])]
    contents = TableOfContents()
    contents.levelStyles = [ParagraphStyle("toc-part", fontName="Times-Bold", fontSize=12, leading=16, spaceBefore=10),
                            ParagraphStyle("toc-chapter", fontName="Times-Roman", fontSize=10, leading=14, leftIndent=14, firstLineIndent=0, spaceBefore=4)]
    story += [contents, PageBreak()]
    for index, section in enumerate(sections):
        if section.get("break"):
            story.append(PageBreak())
        story.append(heading(section["title"], section["depth"], f"section-{index}"))
        for block in section.get("blocks", []):
            if "text" in block:
                story.append(Paragraph(text(block["text"]), styles["body"]))
            else:
                drawing = svg2rlg(BytesIO(block["svg"].encode()))
                scale = min(document.width / drawing.width, 150 / drawing.height, 1)
                drawing.width *= scale
                drawing.height *= scale
                drawing.scale(scale, scale)
                story += [Spacer(1, 8), drawing, Spacer(1, 8)]

    def frame(canvas, doc):
        canvas.saveState()
        if doc.page > 1:
            canvas.setFont("Helvetica", 7)
            canvas.setFillColor(muted)
            canvas.drawString(doc.leftMargin, A5[1] - 25, title)
            canvas.setStrokeColor(colors.HexColor("#d5dadd"))
            canvas.line(doc.leftMargin, 30, A5[0] - doc.rightMargin, 30)
        canvas.setFont("Helvetica", 8)
        canvas.drawRightString(A5[0] - doc.rightMargin, 19, str(doc.page))
        canvas.restoreState()

    document.multiBuild(story, onFirstPage=frame, onLaterPages=frame,
                        canvasmaker=lambda *args, **kwargs: Canvas(*args, **{**kwargs, "invariant": 1, "pageCompression": 1}))
    assert target.stat().st_size <= 250 * 1024, "Reading PDF exceeds its demo size budget"
    print(f"{target.name}: {target.stat().st_size} bytes")


flatland = []
numerals = {1: "I", 2: "II", 3: "III", 13: "XIII", 14: "XIV", 15: "XV"}
for chapter in data["flatland"]:
    if chapter["number"] in [1, 13]:
        flatland.append({"title": "Part I: This World" if chapter["number"] == 1 else "Part II: Other Worlds", "depth": 0, "break": chapter["number"] == 13})
    flatland.append({"title": f'{numerals[chapter["number"]]}: {chapter["title"]}', "depth": 1, "blocks": chapter["blocks"]})
build("flatland", "Flatland", "Edwin A. Abbott", "Selected chapters: I-III and XIII-XV (1884). Original illustrations are retained; editorial endnotes are omitted.",
      "https://standardebooks.org/ebooks/edwin-a-abbott/flatland", flatland)
build("bridge", "An Occurrence at Owl Creek Bridge", "Ambrose Bierce", "The complete three-part story (1890).",
      "https://www.gutenberg.org/ebooks/375", [{**section, "depth": 0} for section in data["bridge"]])
