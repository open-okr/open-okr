#!/usr/bin/env python3
"""Give every table sensible column widths and repeating headers.

Pandoc emits equal-width columns for pipe tables, which wastes space when one
column holds a label and the next holds a paragraph. This allocates width from
how much text each column actually carries, with damping so a very long column
does not swallow the table, then marks header rows to repeat across pages.

Called by build.sh with the unpacked output directory as its argument.
"""
import re
import sys
from pathlib import Path

DOC = Path(sys.argv[1]) / 'word' / 'document.xml'

DAMPING = 0.62   # < 1 pulls wide and narrow columns towards each other
MIN_SHARE = 0.12
MAX_SHARE = 0.70
TOTAL = 9458     # content width in twips: A4 less the left and right margins

CELL = re.compile(r'<w:tc>.*?</w:tc>', re.S)
ROW = re.compile(r'<w:tr>.*?</w:tr>', re.S)
TEXT = re.compile(r'<w:t(?: [^>]*)?>(.*?)</w:t>', re.S)  # not <w:tcPr/>, <w:tblPr>


def shares(columns):
    """Turn per-column text volume into clamped, normalised width shares."""
    weights = [max(volume, 1) ** DAMPING for volume in columns]
    total = sum(weights)
    share = [w / total for w in weights]

    for _ in range(4):
        clamped = [min(max(s, MIN_SHARE), MAX_SHARE) for s in share]
        drift = sum(clamped) - 1.0
        if abs(drift) < 1e-6:
            share = clamped
            break
        free = [i for i, s in enumerate(share)
                if MIN_SHARE < clamped[i] < MAX_SHARE]
        if not free:
            share = [c / sum(clamped) for c in clamped]
            break
        for i in free:
            clamped[i] -= drift / len(free)
        share = clamped
    return share


def fit(table_xml):
    rows = ROW.findall(table_xml)
    if not rows:
        return table_xml

    volume = []
    for row in rows:
        for index, cell in enumerate(CELL.findall(row)):
            text = ''.join(TEXT.findall(cell))
            while len(volume) <= index:
                volume.append(0)
            volume[index] += len(text)
    if len(volume) < 2:
        return table_xml

    widths = [max(1, round(s * TOTAL)) for s in shares(volume)]
    widths[-1] += TOTAL - sum(widths)

    grid = '<w:tblGrid>%s</w:tblGrid>' % ''.join(
        '<w:gridCol w:w="%d" />' % w for w in widths)
    table_xml = re.sub(r'<w:tblGrid>.*?</w:tblGrid>', lambda _m: grid,
                       table_xml, count=1, flags=re.S)

    # Repeat the header row when a table crosses a page boundary.
    if 'w:firstRow="1"' in table_xml:
        first = rows[0]
        if '<w:trPr>' not in first:
            marked = first.replace('<w:tr>', '<w:tr><w:trPr><w:tblHeader /></w:trPr>', 1)
            table_xml = table_xml.replace(first, marked, 1)
    return table_xml


xml = DOC.read_text(encoding='utf-8')
count = 0


def replace(match):
    global count
    count += 1
    return fit(match.group(0))


xml = re.sub(r'<w:tbl>.*?</w:tbl>', replace, xml, flags=re.S)
DOC.write_text(xml, encoding='utf-8')
print('fitted %d tables' % count)
