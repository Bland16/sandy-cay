"""Segment a Sandy Cay sprite sheet by projection profiles.

Steps: strip the black film border -> find the paper region -> project ink
(dark strokes only, so faint gridlines don't register) onto rows to find
content bands separated by gutters -> project onto columns within each band to
find cells -> trim each cell to its ink bbox -> key the exterior paper to alpha
(border flood, so paper *inside* a frame/button is kept) -> export PNG + emit a
raw manifest. Also writes a red-box debug overlay for visual verification.
"""
import sys, os, json
import numpy as np
from PIL import Image, ImageDraw

def find_paper_bbox(lum):
    # film border is near-black; paper is bright. Rows/cols whose mean is bright.
    rb = lum.mean(axis=1); cb = lum.mean(axis=0)
    ys = np.where(rb > 95)[0]; xs = np.where(cb > 95)[0]
    return xs.min(), ys.min(), xs.max() + 1, ys.max() + 1

def segments(profile, thresh, min_gap, min_run):
    on = profile > thresh
    segs = []; i = 0; N = len(on)
    while i < N:
        if not on[i]:
            i += 1; continue
        start = i; end = i; gap = 0; k = i
        while k < N:
            if on[k]:
                end = k; gap = 0
            else:
                gap += 1
                if gap >= min_gap:
                    break
            k += 1
        if end - start + 1 >= min_run:
            segs.append((start, end + 1))
        i = max(k, start + 1)
    return segs

def key_exterior(rgb):
    # paper mask: bright + low chroma (cream). Flood from the crop border over
    # paper -> transparent; enclosed interior paper stays opaque.
    a = np.asarray(rgb).astype(np.int16)
    lum = a.mean(axis=2)
    chroma = a.max(axis=2) - a.min(axis=2)
    paper = (lum > 150) & (chroma < 28)
    H, W = paper.shape
    ext = np.zeros_like(paper)
    ext[0, :] |= paper[0, :]; ext[-1, :] |= paper[-1, :]
    ext[:, 0] |= paper[:, 0]; ext[:, -1] |= paper[:, -1]
    try:
        from scipy import ndimage
        lbl, n = ndimage.label(paper)
        border_ids = set(np.unique(np.concatenate([lbl[0, :], lbl[-1, :], lbl[:, 0], lbl[:, -1]])))
        border_ids.discard(0)
        ext = np.isin(lbl, list(border_ids))
    except Exception:
        # iterative border flood restricted to paper
        changed = True
        while changed:
            grown = ext.copy()
            grown[1:, :] |= ext[:-1, :]; grown[:-1, :] |= ext[1:, :]
            grown[:, 1:] |= ext[:, :-1]; grown[:, :-1] |= ext[:, 1:]
            grown &= paper
            changed = grown.sum() != ext.sum()
            ext = grown
    out = np.dstack([np.asarray(rgb), np.where(ext, 0, 255).astype(np.uint8)])
    return Image.fromarray(out, 'RGBA')

def run(path, name, outdir, ink_thr, row_gap, col_gap, min_run):
    im = Image.open(path).convert('RGB')
    a = np.asarray(im).astype(np.int16)
    lum = a.mean(axis=2)
    x0, y0, x1, y1 = find_paper_bbox(lum)
    # inset to avoid torn-paper shadow at the film edge
    mx = int((x1 - x0) * 0.015); my = int((y1 - y0) * 0.015)
    x0 += mx; x1 -= mx; y0 += my; y1 -= my
    sub = lum[y0:y1, x0:x1]
    ink = sub < ink_thr  # dark strokes only

    os.makedirs(os.path.join(outdir, name), exist_ok=True)
    overlay = im.copy(); dr = ImageDraw.Draw(overlay)
    dr.rectangle([x0, y0, x1, y1], outline=(0, 120, 255), width=2)

    W = ink.shape[1]
    rowprof = ink.sum(axis=1)
    bands = segments(rowprof, thresh=max(10, W * 0.008), min_gap=row_gap, min_run=min_run)
    cells = []
    for bi, (ry0, ry1) in enumerate(bands):
        band_ink = ink[ry0:ry1, :]
        colprof = band_ink.sum(axis=0)
        cols = segments(colprof, thresh=max(6, (ry1 - ry0) * 0.05), min_gap=col_gap, min_run=min_run)
        for ci, (cx0, cx1) in enumerate(cols):
            # tight trim within the cell to the ink bbox
            cellink = ink[ry0:ry1, cx0:cx1]
            ys = np.where(cellink.any(axis=1))[0]; xs = np.where(cellink.any(axis=0))[0]
            if len(ys) == 0 or len(xs) == 0:
                continue
            pad = 6
            ty0 = ry0 + max(0, ys.min() - pad); ty1 = ry0 + min(cellink.shape[0], ys.max() + pad)
            tx0 = cx0 + max(0, xs.min() - pad); tx1 = cx0 + min(cellink.shape[1], xs.max() + pad)
            # to full-image coords
            fx0, fy0, fx1, fy1 = tx0 + x0, ty0 + y0, tx1 + x0, ty1 + y0
            crop = im.crop((fx0, fy0, fx1, fy1))
            keyed = key_exterior(crop)
            fn = f"{name}_r{bi+1}c{ci+1}.png"
            keyed.save(os.path.join(outdir, name, fn))
            cells.append({"file": f"{name}/{fn}", "band": bi + 1, "col": ci + 1,
                          "box": [int(fx0), int(fy0), int(fx1), int(fy1)],
                          "w": int(fx1 - fx0), "h": int(fy1 - fy0)})
            dr.rectangle([fx0, fy0, fx1, fy1], outline=(230, 60, 60), width=3)
    overlay.save(os.path.join(outdir, f"_overlay_{name}.png"))
    counts = {}
    for c in cells: counts[c["band"]] = counts.get(c["band"], 0) + 1
    print(f"{name}: {len(cells)} cells, per-band {counts}")
    return cells

if __name__ == '__main__':
    ROOT = r'C:/ACTIVE_Coding_Projects/tidepool-app'
    outdir = 'seg-out'
    manifest = {}
    manifest['chrome'] = run(ROOT + '/Gemini_Generated_Image_eqjipceqjipceqji.png',
                             'chrome', outdir, ink_thr=120, row_gap=4, col_gap=6, min_run=16)
    manifest['icons'] = run(ROOT + '/Gemini_Generated_Image_pm0fdapm0fdapm0f.png',
                            'icons', outdir, ink_thr=135, row_gap=4, col_gap=6, min_run=16)
    with open(os.path.join(outdir, 'raw-manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    print('done')
