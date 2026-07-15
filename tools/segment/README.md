# Sprite segmentation

Cuts the Gemini sprite sheets into individual, alpha-keyed PNGs.

- **`seg.py`** — projection-profile segmentation: strips the black film border,
  finds the paper region, projects *ink only* (dark strokes, so faint gridlines
  don't register) onto rows to find content bands, then onto columns within each
  band to find cells; trims each to its ink bbox and border-floods the exterior
  paper to alpha (paper *inside* a frame/button is kept). Writes crops + a raw
  manifest + red-box `_overlay_*.png` debug images to `seg-out/`.
- **`finalize.py`** — applies the known chrome fixes (merge the two-circle toggle,
  merge the pennant, add the faint white warning flag), maps every cell to its
  asset name (FRONTEND-SPEC §3), keys, and writes named PNGs + `manifest.json` +
  a labeled `_montage.png` to `assets-out/`.

## Run
```bash
python tools/segment/seg.py       # -> seg-out/ (verify _overlay_*.png)
python tools/segment/finalize.py  # -> assets-out/ (verify _montage.png)
```
Then copy `assets-out/{chrome,icons,scenes,manifest.json}` into `src/assets/`.

Deps: Pillow, numpy, scipy. Paths point at the repo-root source sheets; edit
`ROOT` in both scripts if the layout changes. Tuned for 1408×768 sheets — if a
regenerated sheet has different spacing, adjust `row_gap`/`col_gap`/`ink_thr` and
re-check the overlay before trusting the cut.
