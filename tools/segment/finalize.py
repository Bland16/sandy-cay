"""Finalize segmentation: apply chrome fixes, name every sprite per the asset
map (FRONTEND-SPEC §3), key the exterior paper to alpha, export PNGs + a
manifest, and build a labeled montage for visual verification.
"""
import os, json, shutil
import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = r'C:/ACTIVE_Coding_Projects/tidepool-app'
SHEETS = {
    'chrome': ROOT + '/Gemini_Generated_Image_eqjipceqjipceqji.png',
    'icons':  ROOT + '/Gemini_Generated_Image_pm0fdapm0fdapm0f.png',
}
OUT = 'assets-out'

def key_exterior(rgb):
    a = np.asarray(rgb).astype(np.int16)
    lum = a.mean(axis=2); chroma = a.max(axis=2) - a.min(axis=2)
    paper = (lum > 150) & (chroma < 28)
    from scipy import ndimage
    lbl, _ = ndimage.label(paper)
    border = set(np.unique(np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])))
    border.discard(0)
    ext = np.isin(lbl, list(border))
    out = np.dstack([np.asarray(rgb), np.where(ext, 0, 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')

CHROME_NAMES = {
    (1,1):'frame-scroll', (1,2):'sign-wood-post', (1,3):'frame-scalloped', (1,4):'shield-priority', (1,5):'sign-hanging',
    (2,1):'btn-circle', (2,2):'btn-rounded-square', (2,3):'btn-oval', (2,4):'btn-inset-pressed', (2,7):'btn-pill', (2,8):'btn-pill-wide',
    (3,1):'frame-square', (3,2):'frame-arched', (3,3):'input-rounded', (3,4):'input-search-pill', (3,5):'input-rounded-2', (3,6):'input-rounded-3',
    (4,1):'frame-deep-inset', (4,2):'badge-padlock', (4,3):'plaque-toast', (4,6):'btn-calendar', (4,7):'cameo', (4,8):'keypad-grid',
}
CHROME_SKIP = {(2,5),(2,6),(4,4),(4,5)}       # merged/replaced below
CHROME_EXTRA = [                               # explicit fixes (band,col cosmetic)
    ('toggle-pill',          [725,305,903,409]),
    ('chip-pennant-deadline',[570,595,634,688]),
    ('flag-warning',         [640,584,793,697]),
]
ICONS_NAMES = {
    (1,1):'crab',(1,2):'palm',(1,3):'cabana-hut',(1,4):'surfboard',(1,5):'umbrella',
    (2,1):'sandcastle',(2,2):'beach-ball',(2,3):'life-ring',(2,4):'trunks',(2,5):'visor',(2,6):'seagull',(2,7):'starfish',(2,8):'seashell',
    (3,1):'treasure-chest',(3,2):'key',(3,3):'anchor',(3,4):'message-bottle',(3,5):'bucket-spade',(3,6):'flip-flops',(3,7):'ring',(3,8):'blank-rect',(3,9):'sun-face',
    (4,1):'compass',(4,2):'lighthouse',(4,3):'radio',(4,4):'spyglass',(4,5):'flip-flop',(4,6):'hammock',(4,7):'life-vest',(4,8):'whistle',(4,9):'wave',
}

def finalize(sheet, names, skip, extra, raw):
    im = Image.open(SHEETS[sheet]).convert('RGB')
    os.makedirs(os.path.join(OUT, sheet), exist_ok=True)
    entries = []
    warned = []
    for c in raw[sheet]:
        key = (c['band'], c['col'])
        if key in skip: continue
        nm = names.get(key)
        if not nm:
            warned.append(key); continue
        crop = key_exterior(im.crop(tuple(c['box'])))
        fn = f'{nm}.png'; crop.save(os.path.join(OUT, sheet, fn))
        entries.append({'name': nm, 'file': f'{sheet}/{fn}', 'sheet': sheet, 'cell': list(key), 'box': c['box']})
    for nm, box in (extra or []):
        crop = key_exterior(im.crop(tuple(box)))
        fn = f'{nm}.png'; crop.save(os.path.join(OUT, sheet, fn))
        entries.append({'name': nm, 'file': f'{sheet}/{fn}', 'sheet': sheet, 'cell': None, 'box': box})
    if warned: print(f'  {sheet}: UNMAPPED cells {warned}')
    print(f'  {sheet}: {len(entries)} sprites')
    return entries

def montage(entries, path):
    cols = 8; cell = 150; pad = 10; lblh = 22
    rows = (len(entries) + cols - 1) // cols
    W = cols * (cell + pad) + pad; H = rows * (cell + lblh + pad) + pad
    canvas = Image.new('RGB', (W, H), (32, 30, 26))
    dr = ImageDraw.Draw(canvas)
    try: font = ImageFont.truetype('arial.ttf', 12)
    except Exception: font = ImageFont.load_default()
    for i, e in enumerate(entries):
        r, cc = divmod(i, cols)
        x = pad + cc * (cell + pad); y = pad + r * (cell + lblh + pad)
        dr.rectangle([x, y, x + cell, y + cell], fill=(241, 233, 216))
        spr = Image.open(os.path.join(OUT, e['file'])).convert('RGBA')
        spr.thumbnail((cell - 12, cell - 12))
        canvas.paste(spr, (x + (cell - spr.width)//2, y + (cell - spr.height)//2), spr)
        dr.text((x + 2, y + cell + 4), e['name'], fill=(230, 220, 200), font=font)
    canvas.save(path)
    print('  montage ->', path)

if __name__ == '__main__':
    raw = json.load(open('seg-out/raw-manifest.json'))
    if os.path.isdir(OUT): shutil.rmtree(OUT)
    all_entries = []
    all_entries += finalize('chrome', CHROME_NAMES, CHROME_SKIP, CHROME_EXTRA, raw)
    all_entries += finalize('icons', ICONS_NAMES, set(), None, raw)
    # scenes: copy raw for now (border-crop + sparkle inpaint deferred to integration)
    os.makedirs(os.path.join(OUT, 'scenes'), exist_ok=True)
    for nm, src in [('beach-scene', ROOT + '/Gemini_Generated_Image_qd2nq3qd2nq3qd2n.png'),
                    ('cabana-interior', ROOT + '/Gemini_Generated_Image_xjbjx6xjbjx6xjbj.png')]:
        shutil.copy(src, os.path.join(OUT, 'scenes', nm + '.png'))
        all_entries.append({'name': nm, 'file': f'scenes/{nm}.png', 'sheet': 'scenes', 'cell': None,
                            'box': None, 'note': 'raw — film-border crop + watermark inpaint pending'})
    json.dump({'schemaVersion': 1, 'sprites': all_entries}, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    montage([e for e in all_entries if e['sheet'] in ('chrome', 'icons')], os.path.join(OUT, '_montage.png'))
    print('done:', len(all_entries), 'entries')
