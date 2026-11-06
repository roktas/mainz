#!/usr/bin/env python3
"""Build the complete Bierce reading fixture from retained public-domain text."""

from html import escape
import json
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A5
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfgen.canvas import Canvas
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak
from reportlab.platypus.tableofcontents import TableOfContents

root = Path(__file__).parent
data = json.loads((root / "sources.json").read_text())
ink = colors.HexColor("#203c4c")
muted = colors.HexColor("#596168")
styles = {
    "cover": ParagraphStyle("cover", fontName="Times-Roman", fontSize=32, leading=36, textColor=ink, spaceAfter=18),
    "author": ParagraphStyle("author", fontName="Times-Roman", fontSize=15, leading=20, spaceAfter=16),
    "note": ParagraphStyle("note", fontName="Helvetica", fontSize=9, leading=13, textColor=muted, spaceAfter=12),
    "part": ParagraphStyle("part", fontName="Times-Bold", fontSize=21, leading=25, textColor=ink, spaceBefore=12, spaceAfter=18, keepWithNext=True),
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


def heading(title, key):
    paragraph = Paragraph(text(title), styles["part"])
    paragraph.outline = (0, title, key)
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
    contents.levelStyles = [ParagraphStyle("toc-part", fontName="Times-Bold", fontSize=12, leading=16, spaceBefore=10)]
    story += [contents, PageBreak()]
    for index, section in enumerate(sections):
        if section.get("break"):
            story.append(PageBreak())
        story.append(heading(section["title"], f"section-{index}"))
        for block in section.get("blocks", []):
            story.append(Paragraph(text(block["text"]), styles["body"]))

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
    assert target.stat().st_size <= 2 * 1024 * 1024, "Reading PDF exceeds its demo size budget"
    print(f"{target.name}: {target.stat().st_size} bytes")


build("bridge", "An Occurrence at Owl Creek Bridge", "Ambrose Bierce", "The complete three-part story (1890).",
      "https://www.gutenberg.org/ebooks/375", data["bridge"])
