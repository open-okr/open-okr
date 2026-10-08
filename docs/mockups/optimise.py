#!/usr/bin/env python3
"""Shrink the rendered mockups in place.

They are flat interface screenshots, so a 256-colour palette is visually
lossless and roughly thirds the size of the Word document that embeds them.
"""
import glob
import os

from PIL import Image

saved = 0
for path in sorted(glob.glob(os.path.join(os.path.dirname(__file__), 'png', '*.png'))):
    before = os.path.getsize(path)
    image = Image.open(path).convert('RGB')
    image.quantize(colors=256, method=Image.MEDIANCUT,
                   dither=Image.FLOYDSTEINBERG).save(path, optimize=True)
    saved += before - os.path.getsize(path)

print('optimised, saved %.1f MB' % (saved / 1048576))
