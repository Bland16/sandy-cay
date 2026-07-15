"""Final sprite export using the user's connected-components segmenter
(sprite_tools_new.py). Clean alpha (transparent where the paper shows -> fixes
the 'dirty background' issue), thin-line artifact filter, robust row split by
largest gaps, and a per-row merge down to the known asset count (fixes the
cameo/sandcastle over-splits). Chrome stays outline-on-transparent; the paper
chassis colour is recorded so the UI can bucket-fill it in CSS.
"""
import sys, os, json, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from scipy import ndimage

ROOT = r'C:/ACTIVE_Coding_Projects/tidepool-app'
sys.path.insert(0, ROOT)
import sprite_tools_new as st

TOL = 70
PAPER_FILL = '#F1E9D8'  # --paper: CSS bucket-fill colour for chrome chassis
SHEETS = {'chrome': ROOT + '/Gemini_Generated_Image_eqjipceqjipceqji.png',
          'icons':  ROOT + '/Gemini_Generated_Image_pm0fdapm0fdapm0f.png'}
OUT = 'assets-cc'

NAMES = {
    'chrome': [
        ['frame-scroll', 'sign-wood-post', 'frame-scalloped', 'shield-priority', 'sign-hanging'],
        ['btn-circle', 'btn-rounded-square', 'btn-oval', 'btn-inset-pressed', 'toggle-pill', 'btn-pill', 'btn-pill-wide'],
        ['frame-square', 'frame-arched', 'input-rounded', 'input-search-pill', 'input-rounded-2', 'input-rounded-3'],
        ['frame-deep-inset', 'badge-padlock', 'plaque-toast', 'chip-pennant-deadline', 'flag-warning', 'btn-calendar', 'cameo', 'keypad-grid'],
    ],
    'icons': [
        ['crab', 'palm', 'cabana-hut', 'surfboard', 'umbrella'],
        ['sandcastle', 'beach-ball', 'life-ring', 'trunks', 'visor', 'seagull', 'starfish', 'seashell'],
        ['treasure-chest', 'key', 'anchor', 'message-bottle', 'bucket-spade', 'flip-flops', 'ring', 'blank-rect', 'sun-face'],
        ['compass', 'lighthouse', 'radio', 'spyglass', 'flip-flop', 'hammock', 'life-vest', 'whistle', 'wave'],
    ],
}

def paper_crop(path):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16); lum = a.mean(2)
    xs = np.where(lum.mean(0) > 95)[0]; ys = np.where(lum.mean(1) > 95)[0]
    x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
    mx = int((x1 - x0) * 0.03); my = int((y1 - y0) * 0.03)
    return im.crop((x0 + mx, y0 + my, x1 - mx, y1 - my))

def get_blobs(sheet):
    im = paper_crop(SHEETS[sheet]).convert('RGBA')
    arr = np.array(im)
    bg = st._detect_background(arr)
    mask_bg = st._bg_mask(arr, bg, tolerance=TOL)
    fore = st._fill_holes(~mask_bg)
    lbl, n = ndimage.label(fore)
    bs = []
    for i in range(1, n + 1):
        ys, xs = np.where(lbl == i)
        if len(ys) < 350:
            continue
        x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()) + 1, int(ys.max()) + 1
        if min(x1 - x0, y1 - y0) < 16:      # thin gridline fragment
            continue
        bs.append({'box': [x0, y0, x1, y1], 'count': int(len(ys))})
    return im, mask_bg, bs

def split_rows(bs, nrows):
    bs = sorted(bs, key=lambda b: (b['box'][1] + b['box'][3]) / 2)
    cys = [(b['box'][1] + b['box'][3]) / 2 for b in bs]
    gaps = sorted(range(1, len(cys)), key=lambda i: cys[i] - cys[i - 1], reverse=True)
    cuts = sorted(gaps[:nrows - 1])
    rows, start = [], 0
    for c in cuts + [len(bs)]:
        rows.append(sorted(bs[start:c], key=lambda b: b['box'][0])); start = c
    return rows

def edge_gap(a, b):
    ax0, _, ax1, _ = a['box']; bx0, _, bx1, _ = b['box']
    return bx0 - ax1 if bx0 > ax1 else (ax0 - bx1 if ax0 > bx1 else 0)

def merge_to(row, expected):
    while len(row) > expected:
        i = min(range(len(row)), key=lambda k: row[k]['count'])   # smallest blob = the fragment
        cand = [j for j in (i - 1, i + 1) if 0 <= j < len(row)]
        j = min(cand, key=lambda k: edge_gap(row[min(i, k)], row[max(i, k)]))
        a, b = row[i], row[j]
        ux = [min(a['box'][0], b['box'][0]), min(a['box'][1], b['box'][1]),
              max(a['box'][2], b['box'][2]), max(a['box'][3], b['box'][3])]
        row[min(i, j)] = {'box': ux, 'count': a['count'] + b['count']}
        del row[max(i, j)]
    return row

def montage(entries, path):
    cols = 8; cell = 150; pad = 10; lblh = 20
    rows = (len(entries) + cols - 1) // cols
    canvas = Image.new('RGB', (cols * (cell + pad) + pad, rows * (cell + lblh + pad) + pad), (32, 30, 26))
    dr = ImageDraw.Draw(canvas)
    try: font = ImageFont.truetype('arial.ttf', 11)
    except Exception: font = ImageFont.load_default()
    for i, e in enumerate(entries):
        r, cc = divmod(i, cols); x = pad + cc * (cell + pad); y = pad + r * (cell + lblh + pad)
        dr.rectangle([x, y, x + cell, y + cell], fill=(232, 224, 208) if e['sheet'] == 'chrome' else (52, 50, 45))
        spr = Image.open(os.path.join(OUT, e['file'])).convert('RGBA'); spr.thumbnail((cell - 12, cell - 12))
        canvas.paste(spr, (x + (cell - spr.width)//2, y + (cell - spr.height)//2), spr)
        dr.text((x + 2, y + cell + 3), e['name'], fill=(150,140,120) if e['sheet']=='chrome' else (220,210,190), font=font)
    canvas.save(path)

if __name__ == '__main__':
    if os.path.isdir(OUT): shutil.rmtree(OUT)
    entries = []
    for sheet in ('chrome', 'icons'):
        im, mask_bg, bs = get_blobs(sheet)
        os.makedirs(os.path.join(OUT, sheet), exist_ok=True)
        rows = split_rows(bs, len(NAMES[sheet]))
        print(f'{sheet}: raw per-row {[len(r) for r in rows]} (want {[len(n) for n in NAMES[sheet]]})')
        for ri, row in enumerate(rows):
            row = merge_to(row, len(NAMES[sheet][ri]))
            for ci, b in enumerate(row):
                name = NAMES[sheet][ri][ci] if ci < len(NAMES[sheet][ri]) else f'{sheet}-r{ri+1}c{ci+1}'
                x0, y0, x1, y1 = b['box']
                crop = im.crop((x0, y0, x1, y1)).copy()
                a = np.array(crop); a[..., 3] = np.where(mask_bg[y0:y1, x0:x1], 0, 255)  # clean alpha
                Image.fromarray(a, 'RGBA').save(os.path.join(OUT, sheet, f'{name}.png'))
                entries.append({'name': name, 'file': f'{sheet}/{name}.png', 'sheet': sheet,
                                'cell': [ri + 1, ci + 1], 'box': b['box']})
    # scenes (raw, pending processing)
    os.makedirs(os.path.join(OUT, 'scenes'), exist_ok=True)
    for nm, src in [('beach-scene', ROOT + '/Gemini_Generated_Image_qd2nq3qd2nq3qd2n.png'),
                    ('cabana-interior', ROOT + '/Gemini_Generated_Image_xjbjx6xjbjx6xjbj.png')]:
        shutil.copy(src, os.path.join(OUT, 'scenes', nm + '.png'))
        entries.append({'name': nm, 'file': f'scenes/{nm}.png', 'sheet': 'scenes', 'cell': None, 'box': None,
                        'note': 'raw — film-border crop + watermark inpaint pending'})
    json.dump({'schemaVersion': 1, 'segmenter': 'sprite_tools_new (connected-components, tol=%d)' % TOL,
               'chromeChassisFill': PAPER_FILL, 'sprites': entries},
              open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    montage([e for e in entries if e['sheet'] in ('chrome', 'icons')], os.path.join(OUT, '_montage.png'))
    print('done:', len([e for e in entries if e['sheet'] != 'scenes']), 'sprites +', 2, 'scenes')
