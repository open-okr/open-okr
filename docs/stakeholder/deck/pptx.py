#!/usr/bin/env python3
"""A small PowerPoint writer.

Enough OOXML to lay out a deck by hand: rounded rectangles, text boxes with
mixed weight runs, pictures with a border and shadow, and simple tables.
Everything is positioned in points on a 960 x 540 slide (16:9).

No third-party dependencies. A .pptx is a zip of XML parts, and this writes
them directly so the deck can use the same design tokens as the mockups.
"""
import os
import re
import shutil
import struct
import zipfile

PT = 12700              # English Metric Units per point
W, H = 960.0, 540.0     # slide size in points

NS_A = 'http://schemas.openxmlformats.org/drawingml/2006/main'
NS_P = 'http://schemas.openxmlformats.org/presentationml/2006/main'
NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

BOLD = re.compile(r'\*\*(.+?)\*\*', re.S)


def emu(points):
    return int(round(points * PT))


def esc(text):
    return (text.replace('&', '&amp;').replace('<', '&lt;')
                .replace('>', '&gt;').replace('"', '&quot;'))


def png_size(path):
    """Read width and height straight out of the PNG header."""
    with open(path, 'rb') as handle:
        head = handle.read(26)
    if head[:8] != b'\x89PNG\r\n\x1a\n':
        raise ValueError('not a PNG: %s' % path)
    return struct.unpack('>II', head[16:24])


def runs(text, size, color, bold=False, italic=False, face='Calibri',
         spacing=0, caps=False):
    """Turn a string with **bold** spans into drawingml runs."""
    out = []
    for index, chunk in enumerate(BOLD.split(text)):
        if not chunk:
            continue
        strong = bold or index % 2 == 1
        props = ['lang="en-GB"', 'sz="%d"' % int(size * 100),
                 'b="%d"' % (1 if strong else 0), 'dirty="0"']
        if italic:
            props.append('i="1"')
        if spacing:
            props.append('spc="%d"' % int(spacing * 100))
        if caps:
            props.append('cap="all"')
        out.append(
            '<a:r><a:rPr %s><a:solidFill><a:srgbClr val="%s"/></a:solidFill>'
            '<a:latin typeface="%s"/><a:cs typeface="%s"/></a:rPr>'
            '<a:t>%s</a:t></a:r>'
            % (' '.join(props), color, face, face, esc(chunk)))
    return ''.join(out)


class Slide:
    def __init__(self):
        self.shapes = []
        self.rels = []          # (rId, target)
        self.log = []           # semantic record, used by preview.py
        self._id = 1

    def _next(self):
        self._id += 1
        return self._id

    # ---- shapes -------------------------------------------------------

    def rect(self, x, y, w, h, fill=None, line=None, line_w=1, radius=None,
             shadow=False, gradient=None):
        self.log.append(dict(kind='rect', x=x, y=y, w=w, h=h, fill=fill,
                             line=line, line_w=line_w, radius=radius,
                             shadow=shadow, gradient=gradient))
        geom = ('<a:prstGeom prst="roundRect"><a:avLst>'
                '<a:gd name="adj" fmla="val %d"/></a:avLst></a:prstGeom>'
                % int(radius / min(w, h) * 100000)) if radius else \
               '<a:prstGeom prst="rect"><a:avLst/></a:prstGeom>'

        if gradient:
            start, stop, angle = gradient
            body = ('<a:gradFill rotWithShape="1"><a:gsLst>'
                    '<a:gs pos="0"><a:srgbClr val="%s"/></a:gs>'
                    '<a:gs pos="100000"><a:srgbClr val="%s"/></a:gs></a:gsLst>'
                    '<a:lin ang="%d" scaled="0"/></a:gradFill>'
                    % (start, stop, int(angle * 60000)))
        elif fill:
            body = '<a:solidFill><a:srgbClr val="%s"/></a:solidFill>' % fill
        else:
            body = '<a:noFill/>'

        stroke = ('<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill>'
                  '</a:ln>' % (emu(line_w), line)) if line else '<a:ln><a:noFill/></a:ln>'

        effect = ('<a:effectLst><a:outerShdw blurRad="140000" dist="30000" '
                  'dir="5400000" rotWithShape="0"><a:srgbClr val="0F172A">'
                  '<a:alpha val="13000"/></a:srgbClr></a:outerShdw></a:effectLst>'
                  ) if shadow else ''

        self.shapes.append(
            '<p:sp><p:nvSpPr><p:cNvPr id="%d" name="r%d"/><p:cNvSpPr/><p:nvPr/>'
            '</p:nvSpPr><p:spPr><a:xfrm><a:off x="%d" y="%d"/>'
            '<a:ext cx="%d" cy="%d"/></a:xfrm>%s%s%s%s</p:spPr>'
            '<p:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="en-GB"/>'
            '</a:p></p:txBody></p:sp>'
            % (self._next(), self._id, emu(x), emu(y), emu(w), emu(h),
               geom, body, stroke, effect))
        return self

    def text(self, x, y, w, h, paragraphs, anchor='t'):
        """paragraphs: list of dicts with text, size, color and layout keys."""
        self.log.append(dict(kind='text', x=x, y=y, w=w, h=h, anchor=anchor,
                             paragraphs=[dict(p) for p in paragraphs]))
        body = []
        for para in paragraphs:
            align = para.get('align', 'l')
            space_before = para.get('before', 0)
            space_after = para.get('after', 0)
            line = para.get('line', 116)
            bullet = para.get('bullet')
            indent = para.get('indent', 0)

            props = ['algn="%s"' % align]
            if bullet or indent:
                props.append('marL="%d" indent="%d"'
                             % (emu(indent + (14 if bullet else 0)),
                                emu(-14) if bullet else 0))
            marker = ''
            if bullet:
                marker = ('<a:buClr><a:srgbClr val="%s"/></a:buClr>'
                          '<a:buSzPct val="90000"/>'
                          '<a:buFont typeface="Arial"/><a:buChar char="%s"/>'
                          % (para.get('bullet_color', '4F46E5'), bullet))
            elif para.get('nobullet'):
                marker = '<a:buNone/>'

            body.append(
                '<a:p><a:pPr %s><a:lnSpc><a:spcPct val="%d"/></a:lnSpc>'
                '<a:spcBef><a:spcPts val="%d"/></a:spcBef>'
                '<a:spcAft><a:spcPts val="%d"/></a:spcAft>%s</a:pPr>%s</a:p>'
                % (' '.join(props), line * 1000, int(space_before * 100),
                   int(space_after * 100), marker,
                   runs(para['text'], para.get('size', 14),
                        para.get('color', '0F172A'), para.get('bold', False),
                        para.get('italic', False), para.get('face', 'Calibri'),
                        para.get('spacing', 0), para.get('caps', False))))

        self.shapes.append(
            '<p:sp><p:nvSpPr><p:cNvPr id="%d" name="t%d"/>'
            '<p:cNvSpPr txBox="1"/><p:nvPr/></p:nvSpPr>'
            '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/>'
            '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:noFill/>'
            '</p:spPr><p:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" '
            'rIns="0" bIns="0" anchor="%s"><a:noAutofit/></a:bodyPr>'
            '<a:lstStyle/>%s</p:txBody></p:sp>'
            % (self._next(), self._id, emu(x), emu(y), emu(w), emu(h),
               anchor, ''.join(body)))
        return self

    def picture(self, path, x, y, w, h, border='CBD5E1', shadow=True):
        self.log.append(dict(kind='pic', path=path, x=x, y=y, w=w, h=h,
                             border=border))
        rid = 'rId%d' % (len(self.rels) + 2)
        self.rels.append((rid, path))
        stroke = ('<a:ln w="%d"><a:solidFill><a:srgbClr val="%s"/></a:solidFill>'
                  '</a:ln>' % (emu(0.75), border)) if border else ''
        effect = ('<a:effectLst><a:outerShdw blurRad="160000" dist="36000" '
                  'dir="5400000" rotWithShape="0"><a:srgbClr val="0F172A">'
                  '<a:alpha val="18000"/></a:srgbClr></a:outerShdw></a:effectLst>'
                  ) if shadow else ''
        self.shapes.append(
            '<p:pic><p:nvPicPr><p:cNvPr id="%d" name="p%d"/>'
            '<p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/>'
            '</p:nvPicPr><p:blipFill><a:blip r:embed="%s"/>'
            '<a:stretch><a:fillRect/></a:stretch></p:blipFill>'
            '<p:spPr><a:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/>'
            '</a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom>%s%s</p:spPr>'
            '</p:pic>'
            % (self._next(), self._id, rid, emu(x), emu(y), emu(w), emu(h),
               stroke, effect))
        return self

    def fit_picture(self, path, x, y, w, h, **kwargs):
        """Scale to fit the box, centred horizontally and vertically."""
        pw, ph = png_size(path)
        scale = min(w / pw, h / ph)
        fw, fh = pw * scale, ph * scale
        self.picture(path, x + (w - fw) / 2, y + (h - fh) / 2, fw, fh, **kwargs)
        return fw, fh

    def table(self, x, y, widths, rows, row_h=26, header=True, size=11):
        self.log.append(dict(kind='table', x=x, y=y, widths=list(widths),
                             rows=[list(r) for r in rows], row_h=row_h,
                             header=header, size=size))
        grid = ''.join('<a:gridCol w="%d"/>' % emu(cw) for cw in widths)
        body = []
        for index, row in enumerate(rows):
            head = header and index == 0
            cells = []
            for cell in row:
                fill = 'EEF2FF' if head else 'FFFFFF'
                colour = '1E1B4B' if head else '334155'
                cells.append(
                    '<a:tc><a:txBody><a:bodyPr/><a:lstStyle/>'
                    '<a:p><a:pPr algn="l"><a:lnSpc><a:spcPct val="106000"/>'
                    '</a:lnSpc></a:pPr>%s</a:p></a:txBody>'
                    '<a:tcPr marL="%d" marR="%d" marT="%d" marB="%d" anchor="ctr">'
                    '<a:lnB w="%d" cap="flat"><a:solidFill>'
                    '<a:srgbClr val="%s"/></a:solidFill></a:lnB>'
                    '<a:solidFill><a:srgbClr val="%s"/></a:solidFill></a:tcPr></a:tc>'
                    % (runs(cell, size, colour, bold=head),
                       emu(8), emu(8), emu(5), emu(5), emu(0.75),
                       'C7D2FE' if head else 'E2E8F0', fill))
            body.append('<a:tr h="%d">%s</a:tr>' % (emu(row_h), ''.join(cells)))

        self.shapes.append(
            '<p:graphicFrame><p:nvGraphicFramePr>'
            '<p:cNvPr id="%d" name="tbl%d"/>'
            '<p:cNvGraphicFramePr><a:graphicFrameLocks noGrp="1"/>'
            '</p:cNvGraphicFramePr><p:nvPr/></p:nvGraphicFramePr>'
            '<p:xfrm><a:off x="%d" y="%d"/><a:ext cx="%d" cy="%d"/></p:xfrm>'
            '<a:graphic><a:graphicData uri="%s/table"><a:tbl>'
            '<a:tblPr firstRow="1" bandRow="0"/><a:tblGrid>%s</a:tblGrid>%s'
            '</a:tbl></a:graphicData></a:graphic></p:graphicFrame>'
            % (self._next(), self._id, emu(x), emu(y), emu(sum(widths)),
               emu(row_h * len(rows)), NS_A, grid, ''.join(body)))
        return self

    def xml(self):
        return (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n'
            '<p:sld xmlns:a="%s" xmlns:r="%s" xmlns:p="%s"><p:cSld><p:spTree>'
            '<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/>'
            '</p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/>'
            '<a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/>'
            '</a:xfrm></p:grpSpPr>%s</p:spTree></p:cSld>'
            '<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>'
            % (NS_A, NS_R, NS_P, ''.join(self.shapes)))


THEME = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="%s" name="OpenOKR"><a:themeElements>
<a:clrScheme name="OpenOKR"><a:dk1><a:srgbClr val="0F172A"/></a:dk1>
<a:lt1><a:srgbClr val="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1E1B4B"/></a:dk2>
<a:lt2><a:srgbClr val="F8FAFC"/></a:lt2><a:accent1><a:srgbClr val="4F46E5"/></a:accent1>
<a:accent2><a:srgbClr val="7C3AED"/></a:accent2><a:accent3><a:srgbClr val="0EA5E9"/></a:accent3>
<a:accent4><a:srgbClr val="22C55E"/></a:accent4><a:accent5><a:srgbClr val="F59E0B"/></a:accent5>
<a:accent6><a:srgbClr val="EF4444"/></a:accent6><a:hlink><a:srgbClr val="4338CA"/></a:hlink>
<a:folHlink><a:srgbClr val="7C3AED"/></a:folHlink></a:clrScheme>
<a:fontScheme name="OpenOKR">
<a:majorFont><a:latin typeface="Calibri Light"/><a:ea typeface=""/><a:cs typeface=""/></a:majorFont>
<a:minorFont><a:latin typeface="Calibri"/><a:ea typeface=""/><a:cs typeface=""/></a:minorFont>
</a:fontScheme>
<a:fmtScheme name="OpenOKR">
<a:fillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst>
<a:lnStyleLst>
<a:ln w="6350"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="12700"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln>
<a:ln w="19050"><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst>
<a:effectStyleLst>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle>
<a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst>
<a:bgFillStyleLst>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill>
<a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst>
</a:fmtScheme></a:themeElements></a:theme>''' % NS_A

MASTER = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="%s" xmlns:r="%s" xmlns:p="%s"><p:cSld>
<p:bg><p:bgPr><a:solidFill><a:srgbClr val="FFFFFF"/></a:solidFill>
<a:effectLst/></p:bgPr></p:bg>
<p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>
<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2"
 accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6"
 hlink="hlink" folHlink="folHlink"/>
<p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/></p:sldLayoutIdLst>
</p:sldMaster>''' % (NS_A, NS_R, NS_P)

LAYOUT = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="%s" xmlns:r="%s" xmlns:p="%s" type="blank" preserve="1">
<p:cSld name="Blank"><p:spTree>
<p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr>
<p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/>
<a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr>
</p:spTree></p:cSld>
<p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>''' % (NS_A, NS_R, NS_P)


def write(slides, path, title, author):
    tmp = path + '.parts'
    if os.path.isdir(tmp):
        shutil.rmtree(tmp)

    parts = {}
    media = {}         # source path -> media file name

    for number, slide in enumerate(slides, start=1):
        parts['ppt/slides/slide%d.xml' % number] = slide.xml()
        rels = ['<Relationship Id="rId1" Type="%s/slideLayout" '
                'Target="../slideLayouts/slideLayout1.xml"/>' % NS_R]
        for rid, source in slide.rels:
            if source not in media:
                media[source] = 'image%d.png' % (len(media) + 1)
                parts['ppt/media/' + media[source]] = ('@file', source)
            rels.append('<Relationship Id="%s" Type="%s/image" '
                        'Target="../media/%s"/>' % (rid, NS_R, media[source]))
        parts['ppt/slides/_rels/slide%d.xml.rels' % number] = (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/'
            '2006/relationships">%s</Relationships>' % ''.join(rels))

    slide_ids = ''.join('<p:sldId id="%d" r:id="rId%d"/>' % (255 + i, 1 + i)
                        for i in range(1, len(slides) + 1))
    parts['ppt/presentation.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:presentation xmlns:a="%s" xmlns:r="%s" xmlns:p="%s" saveSubsetFonts="1">'
        '<p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/>'
        '</p:sldMasterIdLst><p:sldIdLst>%s</p:sldIdLst>'
        '<p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/>'
        '</p:presentation>' % (NS_A, NS_R, NS_P, slide_ids))

    pres_rels = ['<Relationship Id="rId1" Type="%s/slideMaster" '
                 'Target="slideMasters/slideMaster1.xml"/>' % NS_R]
    for i in range(1, len(slides) + 1):
        pres_rels.append('<Relationship Id="rId%d" Type="%s/slide" '
                         'Target="slides/slide%d.xml"/>' % (1 + i, NS_R, i))
    base = 2 + len(slides)
    pres_rels += [
        '<Relationship Id="rId%d" Type="%s/presProps" Target="presProps.xml"/>'
        % (base, NS_R),
        '<Relationship Id="rId%d" Type="%s/viewProps" Target="viewProps.xml"/>'
        % (base + 1, NS_R),
        '<Relationship Id="rId%d" Type="%s/theme" Target="theme/theme1.xml"/>'
        % (base + 2, NS_R),
        '<Relationship Id="rId%d" Type="%s/tableStyles" Target="tableStyles.xml"/>'
        % (base + 3, NS_R)]
    parts['ppt/_rels/presentation.xml.rels'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        'relationships">%s</Relationships>' % ''.join(pres_rels))

    parts['ppt/slideMasters/slideMaster1.xml'] = MASTER
    parts['ppt/slideMasters/_rels/slideMaster1.xml.rels'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        'relationships">'
        '<Relationship Id="rId1" Type="%s/slideLayout" '
        'Target="../slideLayouts/slideLayout1.xml"/>'
        '<Relationship Id="rId2" Type="%s/theme" Target="../theme/theme1.xml"/>'
        '</Relationships>' % (NS_R, NS_R))
    parts['ppt/slideLayouts/slideLayout1.xml'] = LAYOUT
    parts['ppt/slideLayouts/_rels/slideLayout1.xml.rels'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        'relationships"><Relationship Id="rId1" Type="%s/slideMaster" '
        'Target="../slideMasters/slideMaster1.xml"/></Relationships>' % NS_R)
    parts['ppt/theme/theme1.xml'] = THEME
    parts['ppt/presProps.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:presentationPr xmlns:a="%s" xmlns:r="%s" xmlns:p="%s"/>'
        % (NS_A, NS_R, NS_P))
    parts['ppt/viewProps.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<p:viewPr xmlns:a="%s" xmlns:r="%s" xmlns:p="%s"/>' % (NS_A, NS_R, NS_P))
    parts['ppt/tableStyles.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<a:tblStyleLst xmlns:a="%s" def="{5C22544A-7EE6-4342-B048-85BDC9FD1C3A}"/>'
        % NS_A)

    parts['docProps/core.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/'
        '2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/">'
        '<dc:title>%s</dc:title><dc:creator>%s</dc:creator>'
        '<cp:lastModifiedBy>%s</cp:lastModifiedBy></cp:coreProperties>'
        % (esc(title), esc(author), esc(author)))
    parts['docProps/app.xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/'
        '2006/extended-properties"><Slides>%d</Slides></Properties>' % len(slides))

    overrides = [
        '<Override PartName="/ppt/presentation.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>',
        '<Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType='
        '"application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/>',
        '<Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType='
        '"application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/>',
        '<Override PartName="/ppt/theme/theme1.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.theme+xml"/>',
        '<Override PartName="/ppt/presProps.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.presentationml.presProps+xml"/>',
        '<Override PartName="/ppt/viewProps.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.presentationml.viewProps+xml"/>',
        '<Override PartName="/ppt/tableStyles.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.presentationml.tableStyles+xml"/>',
        '<Override PartName="/docProps/core.xml" ContentType="application/'
        'vnd.openxmlformats-package.core-properties+xml"/>',
        '<Override PartName="/docProps/app.xml" ContentType="application/'
        'vnd.openxmlformats-officedocument.extended-properties+xml"/>']
    for number in range(1, len(slides) + 1):
        overrides.append(
            '<Override PartName="/ppt/slides/slide%d.xml" ContentType="application/'
            'vnd.openxmlformats-officedocument.presentationml.slide+xml"/>' % number)
    parts['[Content_Types].xml'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-'
        'package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Default Extension="png" ContentType="image/png"/>%s</Types>'
        % ''.join(overrides))
    parts['_rels/.rels'] = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/'
        'relationships">'
        '<Relationship Id="rId1" Type="%s/officeDocument" Target="ppt/presentation.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/'
        '2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>'
        '<Relationship Id="rId3" Type="%s/extended-properties" Target="docProps/app.xml"/>'
        '</Relationships>' % (NS_R, NS_R))

    order = ['[Content_Types].xml', '_rels/.rels']
    order += [name for name in parts if name not in order]

    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as archive:
        for name in order:
            value = parts[name]
            if isinstance(value, tuple) and value[0] == '@file':
                archive.write(value[1], name)
            else:
                archive.writestr(name, value)
    return path
