#!/usr/bin/env python3
"""Cuts Noto Sans Bengali down to the Bangla figures (U10-20; Decisions log).

Hind Siliguri, the Bangla text face, draws the digit one (U+09E7) as a small hook high in its box, so "৳১৫,০০০"
reads as "৳ ৫,০০০"; and the comma between Bangla digits came from Geist. The figures face takes the Bangla digits,
the taka sign and the separators (comma, full stop, colon) from Noto Sans Bengali, so every number in Bangla is
drawn by one face whose digits read clearly. Only those glyphs are kept, so each file is a few kilobytes.

Run from frontend/ with fonttools and brotli installed:  python3 scripts/subset-figures.py
The source is the pinned dev dependency @fontsource/noto-sans-bengali (SIL Open Font License 1.1).
"""
from pathlib import Path
from fontTools import subset

SRC = Path('node_modules/@fontsource/noto-sans-bengali/files')
OUT = Path('src/shared/language/figures')
PARTS = {
    'digits': ('bengali', [*range(0x09E6, 0x09F0), 0x09F3]),     # ০ to ৯ and ৳
    'marks': ('latin', [0x2C, 0x2E, 0x3A]),                       # , . :
}

OUT.mkdir(parents=True, exist_ok=True)
for weight in (400, 500, 600, 700):
    for part, (block, codepoints) in PARTS.items():
        options = subset.Options()
        options.flavor = 'woff2'
        options.layout_features = ['kern', 'tnum', 'lnum']
        options.name_IDs = ['*']                                   # keep the copyright and licence names (OFL 1.1)
        font = subset.load_font(str(SRC / f'noto-sans-bengali-{block}-{weight}-normal.woff2'), options)
        sub = subset.Subsetter(options)
        sub.populate(unicodes=codepoints)
        sub.subset(font)
        target = OUT / f'figures-{part}-{weight}.woff2'
        subset.save_font(font, str(target), options)
        print(target, target.stat().st_size, 'bytes')
