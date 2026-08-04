#!/usr/bin/env python3
"""Render the deck's slide geometry to HTML so it can be eyeballed as PNGs.

make-deck.py records every shape it draws. This replays that record with CSS
at the same point coordinates, which catches text overflow and collisions
without needing PowerPoint. Fonts are approximate, so treat it as a proof of
layout rather than a pixel-accurate preview.

Usage: python3 preview.py  (writes .preview/slides.html)
"""
import html
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, '.preview')
BOLD = re.compile(r'\*\*(.+?)\*\*', re.S)

HEAD = '''<!doctype html><meta charset="utf-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { background: #64748B; font-family: Calibri, Carlito, "Helvetica Neue", Arial, sans-serif }
  .slide { position: relative; width: 960px; height: 540px; overflow: hidden;
           background: #fff; margin: 0 0 14px; }
  .n { position: absolute; right: 6px; top: 4px; font: 700 10px monospace;
       color: #CBD5E1; z-index: 99 }
  .sh { position: absolute }
  .tx { position: absolute; white-space: normal }
  .tx p { margin: 0 }
  .tb { position: absolute; border-collapse: collapse; table-layout: fixed }
  .tb td { vertical-align: middle; overflow: hidden }
  img { display: block }
</style>
'''


def spans(text, color, bold, italic, face, spacing, size):
    out = []
    for index, chunk in enumerate(BOLD.split(text)):
        if not chunk:
            continue
        strong = bold or index % 2 == 1
        style = ('color:#%s;font-weight:%s;font-style:%s;font-family:%s;'
                 'letter-spacing:%.2fpt;font-size:%.2fpt'
                 % (color, '700' if strong else '400',
                    'italic' if italic else 'normal',
                    'Calibri, Carlito, Arial' if face == 'Calibri'
                    else '"Calibri Light", Carlito, Arial',
                    spacing, size))
        out.append('<span style="%s">%s</span>'
                   % (style, html.escape(chunk).replace('\n', '<br>')))
    return ''.join(out)


def render(slide, number):
    parts = ['<div class="slide"><div class="n">%d</div>' % number]
    for item in slide.log:
        kind = item['kind']

        if kind == 'rect':
            if item.get('gradient'):
                start, stop, angle = item['gradient']
                fill = ('linear-gradient(%ddeg, #%s, #%s)'
                        % (90 - angle, start, stop))
            elif item.get('fill'):
                fill = '#' + item['fill']
            else:
                fill = 'transparent'
            border = ('%.2fpt solid #%s' % (item['line_w'], item['line'])
                      if item.get('line') else 'none')
            shadow = ('box-shadow:0 3pt 10pt rgba(15,23,42,.13);'
                      if item.get('shadow') else '')
            radius = ('border-radius:%.1fpt;' % item['radius']
                      if item.get('radius') else '')
            parts.append('<div class="sh" style="left:%.2fpt;top:%.2fpt;'
                         'width:%.2fpt;height:%.2fpt;background:%s;border:%s;%s%s"></div>'
                         % (item['x'], item['y'], item['w'], item['h'],
                            fill, border, radius, shadow))

        elif kind == 'text':
            body = []
            for para in item['paragraphs']:
                size = para.get('size', 14)
                lead = para.get('line', 116) / 100.0
                style = ('text-align:%s;line-height:%.2f;margin-top:%.1fpt;'
                         'margin-bottom:%.1fpt;'
                         % ({'l': 'left', 'ctr': 'center', 'r': 'right'}
                            [para.get('align', 'l')], lead,
                            para.get('before', 0), para.get('after', 0)))
                if para.get('bullet'):
                    style += 'padding-left:14pt;text-indent:-14pt;'
                content = spans(para['text'], para.get('color', '0F172A'),
                                para.get('bold', False), para.get('italic', False),
                                para.get('face', 'Calibri'),
                                para.get('spacing', 0), size)
                if para.get('bullet'):
                    content = ('<span style="color:#%s;font-size:%.1fpt">%s </span>'
                               % (para.get('bullet_color', '4F46E5'), size * 0.9,
                                  para['bullet'])) + content
                if para.get('caps'):
                    style += 'text-transform:uppercase;'
                body.append('<p style="%s">%s</p>' % (style, content))
            anchor = {'t': 'flex-start', 'ctr': 'center', 'b': 'flex-end'}[
                item.get('anchor', 't')]
            parts.append('<div class="tx" style="left:%.2fpt;top:%.2fpt;'
                         'width:%.2fpt;min-height:%.2fpt;display:flex;'
                         'flex-direction:column;justify-content:%s"><div>%s</div></div>'
                         % (item['x'], item['y'], item['w'], item['h'],
                            anchor, ''.join(body)))

        elif kind == 'pic':
            border = ('border:0.75pt solid #%s;' % item['border']
                      if item.get('border') else '')
            parts.append('<img src="%s" style="position:absolute;left:%.2fpt;'
                         'top:%.2fpt;width:%.2fpt;height:%.2fpt;%s'
                         'box-shadow:0 3pt 12pt rgba(15,23,42,.18)">'
                         % (os.path.relpath(item['path'], OUT),
                            item['x'], item['y'], item['w'], item['h'], border))

        elif kind == 'table':
            cols = ''.join('<col style="width:%.2fpt">' % cw
                           for cw in item['widths'])
            body = []
            for index, row in enumerate(item['rows']):
                head = item['header'] and index == 0
                cells = ''.join(
                    '<td style="background:%s;border-bottom:0.75pt solid #%s;'
                    'padding:5pt 8pt;height:%.2fpt">%s</td>'
                    % ('#EEF2FF' if head else '#fff',
                       'C7D2FE' if head else 'E2E8F0', item['row_h'],
                       spans(cell, '1E1B4B' if head else '334155', head,
                             False, 'Calibri', 0, item['size']))
                    for cell in row)
                body.append('<tr>%s</tr>' % cells)
            parts.append('<table class="tb" style="left:%.2fpt;top:%.2fpt;'
                         'width:%.2fpt">%s%s</table>'
                         % (item['x'], item['y'], sum(item['widths']),
                            cols, ''.join(body)))

    parts.append('</div>')
    return ''.join(parts)


def write(deck):
    """Write the whole deck as one scrollable page, plus one page per slide."""
    os.makedirs(OUT, exist_ok=True)
    pages = [render(slide, number) for number, slide in enumerate(deck, 1)]
    path = os.path.join(OUT, 'slides.html')
    with open(path, 'w') as handle:
        handle.write(HEAD + ''.join(pages))
    single = HEAD.replace('margin: 0 0 14px;', 'margin: 0;')
    for number, page in enumerate(pages, 1):
        with open(os.path.join(OUT, 'slide-%02d.html' % number), 'w') as handle:
            handle.write(single + page)
    return path
