#!/usr/bin/env python3
"""
Convert JASIM Study Report Markdown to a professional Word document
with full Arabic RTL support and mixed-script font handling.
"""
import subprocess
import sys
from pathlib import Path

from docx import Document
from docx.shared import Inches, Pt, RGBColor, Cm
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.enum.table import WD_TABLE_ALIGNMENT
from docx.enum.section import WD_ORIENT
from docx.oxml.ns import qn, nsdecls
from docx.oxml import parse_xml
import lxml.etree as etree

# ── Configuration ──
MD_PATH = "/mnt/agents/output/JASIM_Study_Report.md"
OUTPUT_PATH = "/mnt/agents/output/JASIM_Study_Report.docx"
BASE_DOCX = "/mnt/agents/output/JASIM_Study_Report.base.docx"

# ── Font Configuration for Mixed Arabic/English ──
# Primary Arabic font + Latin fallback
ARABIC_FONT = "Arial"       # Widely available, good Arabic support
LATIN_FONT = "Calibri"       # Good Latin script support
ALT_ARABIC_FONT = "Traditional Arabic"
ALT_LATIN_FONT = "Cambria"

# ── Colors ──
COLOR_PRIMARY = RGBColor(0x1A, 0x52, 0x7C)     # Deep teal-blue for headings
COLOR_ACCENT = RGBColor(0x2E, 0x8B, 0x57)      # Sea green for accents
COLOR_TEXT = RGBColor(0x33, 0x33, 0x33)          # Dark gray for body text
COLOR_LIGHT = RGBColor(0x66, 0x66, 0x66)         # Medium gray


def set_run_font(run, text: str, size_pt: int = 11, bold: bool = False,
                 italic: bool = False, color=None, is_arabic: bool = True):
    """Configure a run with mixed-script font handling."""
    run.font.size = Pt(size_pt)
    run.font.bold = bold
    run.font.italic = italic
    if color:
        run.font.color.rgb = color

    # Set Latin font (always)
    run.font.name = LATIN_FONT

    # Set complex script (Arabic) font
    r = run._element
    rPr = r.find(qn('w:rPr'))
    if rPr is None:
        rPr = parse_xml(f'<w:rPr {nsdecls("w")}></w:rPr>')
        r.insert(0, rPr)

    # Complex script font (for Arabic)
    rFonts = rPr.find(qn('w:rFonts'))
    if rFonts is None:
        rFonts = parse_xml(f'<w:rFonts {nsdecls("w")}></w:rFonts>')
        rPr.insert(0, rFonts)

    rFonts.set(qn('w:ascii'), LATIN_FONT)
    rFonts.set(qn('w:hAnsi'), LATIN_FONT)
    rFonts.set(qn('w:cs'), ARABIC_FONT)
    rFonts.set(qn('w:cs'), ARABIC_FONT)
    # Set East Asian / Complex Script font
    rFonts.set(qn('w:eastAsia'), ARABIC_FONT)


def detect_language(text: str) -> str:
    """Detect if text is primarily Arabic or English."""
    arabic_chars = sum(1 for c in text if '\u0600' <= c <= '\u06FF' or
                       '\u0750' <= c <= '\u077F' or
                       '\uFB50' <= c <= '\uFDFF' or
                       '\uFE70' <= c <= '\uFEFF')
    return 'ar' if arabic_chars > len(text) * 0.3 else 'en'


def set_paragraph_rtl(paragraph, rtl: bool = True):
    """Set paragraph direction to RTL."""
    p = paragraph._element
    pPr = p.find(qn('w:pPr'))
    if pPr is None:
        pPr = parse_xml(f'<w:pPr {nsdecls("w")}></w:pPr>')
        p.insert(0, pPr)

    bidi = pPr.find(qn('w:bidi'))
    if bidi is None:
        bidi = parse_xml(f'<w:bidi {nsdecls("w")} w:val="1"/>')
        pPr.append(bidi)
    else:
        bidi.set(qn('w:val'), '1' if rtl else '0')

    jc = pPr.find(qn('w:jc'))
    if jc is None:
        jc = parse_xml(f'<w:jc {nsdecls("w")} w:val="right"/>')
        pPr.append(jc)
    else:
        jc.set(qn('w:val'), 'right' if rtl else 'left')


def style_table(table):
    """Apply professional styling to a table."""
    # Set table direction to RTL
    tbl = table._tbl
    tblPr = tbl.find(qn('w:tblPr'))
    if tblPr is None:
        tblPr = parse_xml(f'<w:tblPr {nsdecls("w")}></w:tblPr>')
        tbl.insert(0, tblPr)

    bidiVisual = tblPr.find(qn('w:bidiVisual'))
    if bidiVisual is None:
        bidiVisual = parse_xml(f'<w:bidiVisual {nsdecls("w")} w:val="1"/>')
        tblPr.append(bidiVisual)

    # Style header row
    if len(table.rows) > 0:
        for cell in table.rows[0].cells:
            # Header background
            shading = parse_xml(
                f'<w:shd {nsdecls("w")} w:fill="1A527C" w:val="clear"/>'
            )
            cell._element.get_or_add_tcPr().append(shading)
            for paragraph in cell.paragraphs:
                set_paragraph_rtl(paragraph, rtl=True)
                paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                for run in paragraph.runs:
                    run.font.color.rgb = RGBColor(0xFF, 0xFF, 0xFF)
                    run.font.bold = True
                    run.font.size = Pt(10)

    # Style data rows with alternating colors
    for i, row in enumerate(table.rows[1:], 1):
        bg_color = "F2F7FB" if i % 2 == 1 else "FFFFFF"
        for cell in row.cells:
            shading = parse_xml(
                f'<w:shd {nsdecls("w")} w:fill="{bg_color}" w:val="clear"/>'
            )
            cell._element.get_or_add_tcPr().append(shading)
            for paragraph in cell.paragraphs:
                set_paragraph_rtl(paragraph, rtl=True)
                paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
                for run in paragraph.runs:
                    run.font.size = Pt(10)
                    run.font.color.rgb = COLOR_TEXT

    # Set table borders
    tbl_borders = parse_xml(
        f'<w:tblBorders {nsdecls("w")}>'
        '  <w:top w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '  <w:left w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '  <w:bottom w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '  <w:right w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '  <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '  <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CCCCCC"/>'
        '</w:tblBorders>'
    )
    tblPr.append(tbl_borders)


def configure_section(section):
    """Configure page layout for RTL document."""
    section.page_width = Cm(21.0)    # A4 width
    section.page_height = Cm(29.7)   # A4 height
    section.top_margin = Cm(2.5)
    section.bottom_margin = Cm(2.5)
    section.left_margin = Cm(2.0)
    section.right_margin = Cm(2.0)


def process_document(doc):
    """Post-process the document for Arabic RTL support."""
    print("[1/5] Configuring page layout...")
    for section in doc.sections:
        configure_section(section)

    print("[2/5] Processing paragraphs for RTL and fonts...")
    heading_sizes = {0: 24, 1: 20, 2: 16, 3: 14, 4: 12}

    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        text = paragraph.text.strip()
        if not text:
            continue

        is_arabic = detect_language(text) == 'ar'

        # Determine if heading
        is_heading = style_name.startswith("Heading")
        heading_level = None
        if is_heading:
            try:
                heading_level = int(style_name.replace("Heading", "").strip())
            except ValueError:
                heading_level = 1

        # Set paragraph direction
        set_paragraph_rtl(paragraph, rtl=is_arabic)

        # Set alignment
        if is_heading:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        elif is_arabic:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT
        else:
            paragraph.alignment = WD_ALIGN_PARAGRAPH.LEFT

        # Style runs
        for run in paragraph.runs:
            if is_heading:
                level = heading_level or 1
                size = heading_sizes.get(level, 12)
                set_run_font(run, text, size_pt=size, bold=True,
                           color=COLOR_PRIMARY if level <= 2 else COLOR_ACCENT)
            else:
                set_run_font(run, text, size_pt=11, color=COLOR_TEXT)

    print("[3/5] Styling tables...")
    for table in doc.tables:
        style_table(table)

    print("[4/5] Processing list paragraphs...")
    for paragraph in doc.paragraphs:
        style_name = paragraph.style.name if paragraph.style else ""
        if "List" in style_name or "list" in style_name:
            text = paragraph.text.strip()
            if text:
                is_arabic = detect_language(text) == 'ar'
                set_paragraph_rtl(paragraph, rtl=is_arabic)
                paragraph.alignment = WD_ALIGN_PARAGRAPH.RIGHT if is_arabic else WD_ALIGN_PARAGRAPH.LEFT
                for run in paragraph.runs:
                    set_run_font(run, text, size_pt=11, color=COLOR_TEXT)

    print("[5/5] Finalizing document...")
    return doc


def add_title_page(doc):
    """Add a professional title page at the beginning."""
    # Clear existing content temporarily - we'll rebuild with title page
    # Actually, let's just add title at the top
    first_para = doc.paragraphs[0] if doc.paragraphs else doc.add_paragraph()

    # We don't need a separate title page; the markdown already has a title
    pass


def main():
    print("=" * 60)
    print("JASIM Study Report - Markdown to Word Conversion")
    print("Arabic RTL + Mixed-Script Font Support")
    print("=" * 60)

    # Step 1: Pandoc conversion
    print("\n[Step 1] Converting Markdown with Pandoc...")
    pandoc_cmd = [
        'pandoc', MD_PATH,
        '-o', BASE_DOCX,
        '--from=markdown', '--to=docx',
        '--standalone',
        f'--resource-path={Path(MD_PATH).parent}',
    ]
    result = subprocess.run(pandoc_cmd, capture_output=True, text=True)
    if result.returncode != 0:
        print(f"Pandoc error: {result.stderr}")
        sys.exit(1)
    print(f"  Base DOCX created: {BASE_DOCX}")

    # Step 2: Open and post-process
    print("\n[Step 2] Post-processing for Arabic RTL support...")
    doc = Document(BASE_DOCX)
    process_document(doc)

    # Step 3: Save final
    print(f"\n[Step 3] Saving final document to: {OUTPUT_PATH}")
    doc.save(OUTPUT_PATH)

    # Verify
    final_doc = Document(OUTPUT_PATH)
    para_count = len(final_doc.paragraphs)
    table_count = len(final_doc.tables)
    print(f"\n{'=' * 60}")
    print("Conversion complete!")
    print(f"  Output: {OUTPUT_PATH}")
    print(f"  Paragraphs: {para_count}")
    print(f"  Tables: {table_count}")
    print(f"{'=' * 60}")

    return OUTPUT_PATH


if __name__ == '__main__':
    main()
