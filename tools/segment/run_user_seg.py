"""Run the user's connected-components segmenter (sprite_tools_new.py) on the
Sandy Cay sheets. Preprocess: strip the black film border so the corners read
as cream paper (what _detect_background expects), then use the user's
_bg_mask / _fill_holes to find blobs. Order blobs into reading order, save
alpha PNGs, and render a labeled montage for visual judgement.
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = r'C:/ACTIVE_Coding_Projects/tidepool-app'
sys.path.insert(0, ROOT)
import sprite_tools_new as st  # user's segmenter

SHEETS = {
    'chrome': ROOT + '/Gemini_Generated_Image_eqjipceqjipceqji.png',
    'icons':  ROOT + '/Gemini_Generated_Image_pm0fdapm0fdapm0f.png',
}
OUT = 'user-seg-out'

def paper_crop(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16); lum = a.mean(2)
    xs = np.where(lum.mean(0) > 95)[0]; ys = np.where(lum.mean(1) > 95)[0]
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    mx = int((x1 - x0) * 0.03); my = int((y1 - y0) * 0.03)  # bigger inset kills edge shadow
    return im.crop((x0 + mx, y0 + my, x1 - mx, y1 - my))

def order_rows(comps, row_tol=55):
    # comps: list of (x0,y0,x1,y1). group by y-center into rows, sort each by x.
    comps = sorted(comps, key=lambda b: (b[1] + b[3]) / 2)
    rows = []; cur = []
    for b in comps:
        cy = (b[1] + b[3]) / 2
        if cur and cy - (cur[-1][1] + cur[-1][3]) / 2 > row_tol:
            rows.append(sorted(cur, key=lambda b: b[0])); cur = []
        cur.append(b)
    if cur: rows.append(sorted(cur, key=lambda b: b[0]))
    return rows

def segment(sheet, tol, min_area):
    im = paper_crop(SHEETS[sheet]).convert('RGBA')
    arr = np.array(im)
    bg = st._detect_background(arr)
    mask_bg = st._bg_mask(arr, bg, tolerance=tol)
    fore = st._fill_holes(~mask_bg)
    lbl, n = ndimage.label(fore)
    comps = []
    for i in range(1, n + 1):
        ys, xs = np.where(lbl == i)
        if len(ys) < min_area:
            continue
        comps.append((int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1))
    rows = order_rows(comps)
    os.makedirs(os.path.join(OUT, sheet), exist_ok=True)
    ordered = []
    for ri, row in enumerate(rows):
        for ci, (x0, y0, x1, y1) in enumerate(row):
            crop = im.crop((x0, y0, x1, y1)).copy()
            # alpha: transparent where original was bg (cream), inside this crop
            sub_bg = mask_bg[y0:y1, x0:x1]
            a = np.array(crop); a[..., 3] = np.where(sub_bg, 0, 255)
            Image.fromarray(a, 'RGBA').save(os.path.join(OUT, sheet, f'{sheet}_r{ri+1}c{ci+1}.png'))
            ordered.append({'sheet': sheet, 'r': ri + 1, 'c': ci + 1, 'box': [x0, y0, x1, y1],
                            'file': f'{sheet}/{sheet}_r{ri+1}c{ci+1}.png'})
    counts = {ri + 1: len(r) for ri, r in enumerate(rows)}
    print(f'{sheet}: bg={bg} tol={tol} -> {len(ordered)} blobs, per-row {counts}')
    return ordered, bg

def montage(entries, path):
    cols = 8; cell = 150; pad = 10; lblh = 20
    rows = (len(entries) + cols - 1) // cols
    W = cols * (cell + pad) + pad; H = rows * (cell + lblh + pad) + pad
    canvas = Image.new('RGB', (W, H), (32, 30, 26)); dr = ImageDraw.Draw(canvas)
    try: font = ImageFont.truetype('arial.ttf', 11)
    except Exception: font = ImageFont.load_default()
    for i, e in enumerate(entries):
        r, cc = divmod(i, cols); x = pad + cc * (cell + pad); y = pad + r * (cell + lblh + pad)
        dr.rectangle([x, y, x + cell, y + cell], fill=(60, 58, 52))
        spr = Image.open(os.path.join(OUT, e['file'])).convert('RGBA'); spr.thumbnail((cell - 12, cell - 12))
        canvas.paste(spr, (x + (cell - spr.width)//2, y + (cell - spr.height)//2), spr)
        dr.text((x + 2, y + cell + 3), f"{e['sheet'][0]} r{e['r']}c{e['c']}", fill=(220, 210, 190), font=font)
    canvas.save(path); print('montage ->', path)

if __name__ == '__main__':
    tol = int(sys.argv[1]) if len(sys.argv) > 1 else 40
    if os.path.isdir(OUT): import shutil; shutil.rmtree(OUT)
    ch, _ = segment('chrome', tol=tol, min_area=350)
    ic, _ = segment('icons', tol=tol, min_area=350)
    montage(ch, os.path.join(OUT, '_montage_chrome.png'))
    montage(ic, os.path.join(OUT, '_montage_icons.png'))
    print('done')
