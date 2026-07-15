"""Segment the green-screen combined sheet. Solid chroma-key bg -> clean key:
mask the green (keep grayscale/cream/brown sprites, incl. paper chassis), label
connected components, drop the black border, order into rows, save clean alpha
PNGs + a montage. Also writes a foreground-mask preview to catch any bridging.
"""
import sys, os, json, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = r'C:/ACTIVE_Coding_Projects/tidepool-app'
sys.path.insert(0, ROOT)
import sprite_tools_new as st

SRC = 'green-sheet.png'
OUT = 'green-out'
GREEN = (117, 249, 26)
TOL = 90

def run():
    im0 = Image.open(SRC).convert('RGBA')
    a0 = np.array(im0)
    # crop the thin black outer border: keep pixels that are green-ish or sprite,
    # i.e. drop near-black frame. find bbox of "not near-black".
    lum = a0[..., :3].mean(2)
    notblack = lum > 30
    ys, xs = np.where(notblack)
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    im = im0.crop((x0, y0, x1, y1))
    arr = np.array(im)

    bg = st._bg_mask(arr, (*GREEN, 255), tolerance=TOL)
    fore = st._fill_holes(~bg)
    # preview
    Image.fromarray((fore * 255).astype('uint8')).save('green-fore.png')

    # despill: neutralise green cast on kept pixels (fringe -> gray)
    rgb = arr[..., :3].astype(int)
    Rc, Gc, Bc = rgb[..., 0], rgb[..., 1], rgb[..., 2]
    greenish = (Gc > Rc + 12) & (Gc > Bc + 12)
    arr[..., 1] = np.where(greenish, np.maximum(Rc, Bc), Gc).astype('uint8')
    # 1px erode of the kept region removes the anti-aliased halo ring
    alpha_er = ndimage.binary_erosion(~bg, iterations=1)
    arr[..., 3] = (alpha_er * 255).astype('uint8')
    imf = Image.fromarray(arr, 'RGBA')

    lbl, n = ndimage.label(fore)
    H, W = fore.shape
    blobs = []
    for i in range(1, n + 1):
        ys, xs = np.where(lbl == i)
        if len(ys) < 300:
            continue
        bx0, by0, bx1, by1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        if (bx1 - bx0) > 0.9 * W and (by1 - by0) > 0.9 * H:   # border/whole-sheet remnant
            continue
        if min(bx1 - bx0, by1 - by0) < 14:                    # thin line artifact
            continue
        blobs.append({'box': [bx0, by0, bx1, by1], 'count': int(len(ys))})

    # order into rows by largest vertical gaps (auto row count)
    blobs.sort(key=lambda b: (b['box'][1] + b['box'][3]) / 2)
    cys = [(b['box'][1] + b['box'][3]) / 2 for b in blobs]
    heights = sorted(b['box'][3] - b['box'][1] for b in blobs)
    med_h = heights[len(heights) // 2]
    rows, cur = [], []
    for b in blobs:
        cy = (b['box'][1] + b['box'][3]) / 2
        if cur and cy - (cur[-1]['box'][1] + cur[-1]['box'][3]) / 2 > med_h * 0.6:
            rows.append(sorted(cur, key=lambda b: b['box'][0])); cur = []
        cur.append(b)
    if cur: rows.append(sorted(cur, key=lambda b: b['box'][0]))

    if os.path.isdir(OUT): shutil.rmtree(OUT)
    os.makedirs(OUT, exist_ok=True)
    entries = []
    for ri, row in enumerate(rows):
        for ci, b in enumerate(row):
            bx0, by0, bx1, by1 = b['box']
            fn = f'r{ri+1}c{ci+1}.png'
            imf.crop((bx0, by0, bx1, by1)).save(os.path.join(OUT, fn))   # despilled + eroded alpha
            entries.append({'r': ri + 1, 'c': ci + 1, 'file': fn, 'box': b['box']})
    print('rows:', [len(r) for r in rows], '=', len(entries), 'blobs')

    # montage
    cols = max(len(r) for r in rows); cell = 118; pad = 8; lblh = 16
    canvas = Image.new('RGB', (cols * (cell + pad) + pad, len(rows) * (cell + lblh + pad) + pad), (30, 30, 34))
    dr = ImageDraw.Draw(canvas)
    try: font = ImageFont.truetype('arial.ttf', 10)
    except Exception: font = ImageFont.load_default()
    for ri, row in enumerate(rows):
        for ci, b in enumerate(row):
            x = pad + ci * (cell + pad); y = pad + ri * (cell + lblh + pad)
            dr.rectangle([x, y, x + cell, y + cell], fill=(70, 70, 78))
            spr = Image.open(os.path.join(OUT, f'r{ri+1}c{ci+1}.png')).convert('RGBA'); spr.thumbnail((cell - 8, cell - 8))
            canvas.paste(spr, (x + (cell - spr.width)//2, y + (cell - spr.height)//2), spr)
            dr.text((x + 2, y + cell + 2), f'r{ri+1}c{ci+1}', fill=(200, 200, 205), font=font)
    canvas.save(os.path.join(OUT, '_montage.png'))
    print('montage -> green-out/_montage.png')

run()
