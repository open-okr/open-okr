#!/usr/bin/env python3
"""Restyle pandoc's default reference.docx into the OpenOKR document look.

Rewrites word/styles.xml, sets A4 page geometry, and adds a page footer.
Called by build.sh with the unpacked reference directory as its argument.
"""
import re
import sys
from pathlib import Path

ROOT = Path(sys.argv[1])

BODY = 'Calibri'
HEAD = 'Calibri Light'
INK = '1F2937'
BRAND_DARK = '1E1B4B'
BRAND = '4338CA'
BRAND_LINE = 'C7D2FE'
BRAND_WEAK = 'EEF2FF'
MUTED = '6B7280'
RULE = 'E2E8F0'
RULE_2 = 'CBD5E1'

CONTENT_W = 9458  # A4 minus the left and right margins, in twips


def font(name, extra=''):
    return f'<w:rFonts w:ascii="{name}" w:hAnsi="{name}" w:cs="{name}"/>{extra}'


STYLES = {
    'Normal': f'''
    <w:name w:val="Normal"/><w:qFormat/>
    <w:pPr><w:spacing w:after="0" w:line="264" w:lineRule="auto"/></w:pPr>
    <w:rPr>{font(BODY)}<w:color w:val="{INK}"/><w:sz w:val="21"/><w:szCs w:val="21"/></w:rPr>''',

    'BodyText': f'''
    <w:name w:val="Body Text"/><w:basedOn w:val="Normal"/><w:link w:val="BodyTextChar"/><w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="150"/></w:pPr>''',

    'FirstParagraph': '''
    <w:name w:val="First Paragraph"/><w:basedOn w:val="BodyText"/><w:qFormat/>''',

    'Compact': '''
    <w:name w:val="Compact"/><w:basedOn w:val="BodyText"/><w:qFormat/>
    <w:pPr><w:spacing w:before="30" w:after="30"/></w:pPr>''',

    'Title': f'''
    <w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Subtitle"/>
    <w:link w:val="TitleChar"/><w:uiPriority w:val="10"/><w:qFormat/>
    <w:pPr><w:spacing w:before="2600" w:after="80" w:line="240" w:lineRule="auto"/><w:contextualSpacing/></w:pPr>
    <w:rPr>{font(HEAD)}<w:b/><w:color w:val="{BRAND_DARK}"/><w:spacing w:val="-30"/>
      <w:sz w:val="96"/><w:szCs w:val="96"/></w:rPr>''',

    'Subtitle': f'''
    <w:name w:val="Subtitle"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:link w:val="SubtitleChar"/><w:uiPriority w:val="11"/><w:qFormat/>
    <w:pPr><w:spacing w:before="0" w:after="420" w:line="264" w:lineRule="auto"/></w:pPr>
    <w:rPr>{font(HEAD)}<w:color w:val="{BRAND}"/><w:sz w:val="30"/><w:szCs w:val="30"/></w:rPr>''',

    'Heading1': f'''
    <w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:link w:val="Heading1Char"/><w:uiPriority w:val="9"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/>
      <w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="{BRAND_LINE}"/></w:pBdr>
      <w:spacing w:before="520" w:after="220"/><w:outlineLvl w:val="0"/></w:pPr>
    <w:rPr>{font(HEAD)}<w:b/><w:color w:val="{BRAND_DARK}"/><w:spacing w:val="-8"/>
      <w:sz w:val="40"/><w:szCs w:val="40"/></w:rPr>''',

    'Heading2': f'''
    <w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:link w:val="Heading2Char"/><w:uiPriority w:val="9"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="340" w:after="120"/><w:outlineLvl w:val="1"/></w:pPr>
    <w:rPr>{font(HEAD)}<w:b/><w:color w:val="{BRAND}"/><w:sz w:val="28"/><w:szCs w:val="28"/></w:rPr>''',

    'Heading3': f'''
    <w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:link w:val="Heading3Char"/><w:uiPriority w:val="9"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="260" w:after="90"/><w:outlineLvl w:val="2"/></w:pPr>
    <w:rPr>{font(BODY)}<w:b/><w:color w:val="111827"/><w:sz w:val="23"/><w:szCs w:val="23"/></w:rPr>''',

    'Heading4': f'''
    <w:name w:val="heading 4"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/>
    <w:link w:val="Heading4Char"/><w:uiPriority w:val="9"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:keepLines/><w:spacing w:before="220" w:after="70"/><w:outlineLvl w:val="3"/></w:pPr>
    <w:rPr>{font(BODY)}<w:b/><w:i/><w:color w:val="{BRAND}"/><w:sz w:val="21"/></w:rPr>''',

    'BlockText': f'''
    <w:name w:val="Block Text"/><w:basedOn w:val="BodyText"/><w:next w:val="BodyText"/><w:qFormat/>
    <w:pPr>
      <w:pBdr><w:left w:val="single" w:sz="18" w:space="10" w:color="{BRAND_LINE}"/></w:pBdr>
      <w:spacing w:before="160" w:after="160"/><w:ind w:left="280" w:right="0" w:firstLine="0"/></w:pPr>
    <w:rPr><w:color w:val="374151"/></w:rPr>''',

    'Figure': '''
    <w:name w:val="Figure"/><w:basedOn w:val="BodyText"/><w:next w:val="ImageCaption"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="260" w:after="60"/><w:jc w:val="center"/></w:pPr>''',

    'CaptionedFigure': '''
    <w:name w:val="Captioned Figure"/><w:basedOn w:val="Figure"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="260" w:after="60"/><w:jc w:val="center"/></w:pPr>''',

    'ImageCaption': f'''
    <w:name w:val="Image Caption"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/>
    <w:pPr><w:keepLines/><w:spacing w:before="20" w:after="340" w:line="240" w:lineRule="auto"/>
      <w:ind w:left="340" w:right="340"/><w:jc w:val="center"/></w:pPr>
    <w:rPr>{font(BODY)}<w:i/><w:color w:val="{MUTED}"/><w:sz w:val="17"/><w:szCs w:val="17"/></w:rPr>''',

    'Caption': f'''
    <w:name w:val="Caption"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/>
    <w:pPr><w:keepLines/><w:spacing w:before="20" w:after="260"/><w:jc w:val="center"/></w:pPr>
    <w:rPr><w:i/><w:color w:val="{MUTED}"/><w:sz w:val="17"/></w:rPr>''',

    'TableCaption': f'''
    <w:name w:val="Table Caption"/><w:basedOn w:val="Caption"/><w:qFormat/>''',

    'TOCHeading': f'''
    <w:name w:val="TOC Heading"/><w:basedOn w:val="Normal"/><w:next w:val="BodyText"/><w:qFormat/>
    <w:pPr><w:keepNext/><w:spacing w:before="0" w:after="220"/>
      <w:pBdr><w:bottom w:val="single" w:sz="8" w:space="8" w:color="{BRAND_LINE}"/></w:pBdr></w:pPr>
    <w:rPr>{font(HEAD)}<w:b/><w:color w:val="{BRAND_DARK}"/><w:sz w:val="40"/></w:rPr>''',

    'Hyperlink': f'''
    <w:name w:val="Hyperlink"/><w:basedOn w:val="DefaultParagraphFont"/><w:uiPriority w:val="99"/>
    <w:rPr><w:color w:val="{BRAND}"/><w:u w:val="single"/></w:rPr>''',
}

TABLE_STYLE = f'''<w:style w:type="table" w:default="1" w:styleId="Table">
    <w:name w:val="Table"/><w:basedOn w:val="TableNormal"/><w:qFormat/>
    <w:pPr><w:spacing w:before="50" w:after="50" w:line="252" w:lineRule="auto"/></w:pPr>
    <w:rPr>{font(BODY)}<w:color w:val="{INK}"/><w:sz w:val="19"/><w:szCs w:val="19"/></w:rPr>
    <w:tblPr>
      <w:tblInd w:w="0" w:type="dxa"/>
      <w:tblBorders>
        <w:top w:val="single" w:sz="6" w:color="{RULE_2}"/>
        <w:bottom w:val="single" w:sz="6" w:color="{RULE_2}"/>
        <w:insideH w:val="single" w:sz="4" w:color="{RULE}"/>
      </w:tblBorders>
      <w:tblCellMar>
        <w:top w:w="70" w:type="dxa"/><w:left w:w="110" w:type="dxa"/>
        <w:bottom w:w="70" w:type="dxa"/><w:right w:w="110" w:type="dxa"/>
      </w:tblCellMar>
    </w:tblPr>
    <w:tblStylePr w:type="firstRow">
      <w:rPr><w:b/><w:color w:val="{BRAND_DARK}"/></w:rPr>
      <w:tcPr>
        <w:shd w:val="clear" w:color="auto" w:fill="{BRAND_WEAK}"/>
        <w:tcBorders><w:bottom w:val="single" w:sz="8" w:color="{BRAND_LINE}"/></w:tcBorders>
        <w:vAlign w:val="center"/>
      </w:tcPr>
    </w:tblStylePr>
    <w:tblStylePr w:type="firstCol">
      <w:rPr><w:color w:val="111827"/></w:rPr>
    </w:tblStylePr>
  </w:style>'''


def patch_styles(path: Path) -> None:
    xml = path.read_text(encoding='utf-8')

    for style_id, body in STYLES.items():
        pattern = re.compile(
            r'<w:style [^>]*w:styleId="%s"\s*>.*?</w:style>' % re.escape(style_id), re.S)
        kind = 'paragraph'
        default = ' w:default="1"' if style_id == 'Normal' else ''
        custom = ' w:customStyle="1"' if style_id in (
            'Compact', 'FirstParagraph', 'ImageCaption', 'TableCaption',
            'Figure', 'CaptionedFigure') else ''
        if style_id == 'Hyperlink':
            kind, custom = 'character', ''
        replacement = (f'<w:style w:type="{kind}"{default}{custom} '
                       f'w:styleId="{style_id}">{body}\n  </w:style>')
        xml, n = pattern.subn(lambda _m, r=replacement: r, xml, count=1)
        if not n:  # style absent from the default reference, append it
            xml = xml.replace('</w:styles>', replacement + '\n</w:styles>')

    xml = re.sub(r'<w:style w:type="table" [^>]*w:styleId="Table"\s*>.*?</w:style>',
                 lambda _m: TABLE_STYLE, xml, count=1, flags=re.S)

    path.write_text(xml, encoding='utf-8')


def patch_page_and_footer(root: Path) -> None:
    doc = root / 'word' / 'document.xml'
    rels = root / 'word' / '_rels' / 'document.xml.rels'
    types = root / '[Content_Types].xml'

    run = (f'<w:rPr>{font(BODY)}<w:color w:val="94A3B8"/><w:sz w:val="16"/>'
           f'<w:szCs w:val="16"/></w:rPr>')
    ns = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
          'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')

    (root / 'word' / 'footer1.xml').write_text(
        f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr {ns}>
  <w:p>
    <w:pPr>
      <w:pBdr><w:top w:val="single" w:sz="4" w:space="8" w:color="{RULE}"/></w:pBdr>
      <w:tabs><w:tab w:val="right" w:pos="{CONTENT_W}"/></w:tabs>
      <w:spacing w:before="0" w:after="0"/>{run}
    </w:pPr>
    <w:r>{run}<w:t xml:space="preserve">OpenOKR  ·  Product overview  ·  August 2026</w:t></w:r>
    <w:r>{run}<w:tab/></w:r>
    <w:fldSimple w:instr=" PAGE ."><w:r>{run}<w:t>1</w:t></w:r></w:fldSimple>
  </w:p>
</w:ftr>''', encoding='utf-8')

    # An empty first-page footer keeps the title page clean.
    (root / 'word' / 'footer2.xml').write_text(
        f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr {ns}><w:p><w:pPr><w:spacing w:before="0" w:after="0"/></w:pPr></w:p></w:ftr>''',
        encoding='utf-8')

    rx = rels.read_text(encoding='utf-8')
    base = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer'
    rx = rx.replace('</Relationships>',
                    f'<Relationship Id="rIdFtrMain" Type="{base}" Target="footer1.xml"/>'
                    f'<Relationship Id="rIdFtrFirst" Type="{base}" Target="footer2.xml"/>'
                    '</Relationships>')
    rels.write_text(rx, encoding='utf-8')

    tx = types.read_text(encoding='utf-8')
    ct = ('application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml')
    tx = tx.replace('</Types>',
                    f'<Override PartName="/word/footer1.xml" ContentType="{ct}"/>'
                    f'<Override PartName="/word/footer2.xml" ContentType="{ct}"/>'
                    '</Types>')
    types.write_text(tx, encoding='utf-8')

    dx = doc.read_text(encoding='utf-8')
    sect = ('<w:sectPr>'
            '<w:footerReference w:type="default" r:id="rIdFtrMain"/>'
            '<w:footerReference w:type="first" r:id="rIdFtrFirst"/>'
            '<w:pgSz w:w="11906" w:h="16838"/>'
            '<w:pgMar w:top="1247" w:right="1224" w:bottom="1247" w:left="1224" '
            'w:header="680" w:footer="600" w:gutter="0"/>'
            '<w:cols w:space="708"/>'
            '<w:titlePg/>'
            '<w:docGrid w:linePitch="360"/>'
            '</w:sectPr>')
    dx, n = re.subn(r'<w:sectPr[^>]*>.*?</w:sectPr>', lambda _m: sect, dx, count=1, flags=re.S)
    if not n:
        dx = re.sub(r'<w:sectPr[^>]*/>', lambda _m: sect, dx, count=1)
    doc.write_text(dx, encoding='utf-8')


patch_styles(ROOT / 'word' / 'styles.xml')
patch_page_and_footer(ROOT)
print('reference restyled')
