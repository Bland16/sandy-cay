# Sprite segmentation

Cuts the Gemini sprite sheets into individual, alpha-keyed PNGs using the
project's **connected-components** segmenter (`sprite_tools_new.py` at the repo
root: detect background → mask → fill holes → label blobs).

The sheets are ink-on-aged-paper inside a black film border, so two preprocessing
steps make the connected-components approach work: (1) **strip the film border**
so `_detect_background` reads cream paper from the corners, and (2) use a **high
background tolerance** (~70) so faint gridlines and paper texture count as
background, leaving only the dark ink outlines — otherwise texture bridges the
blobs and fill-holes collapses each region into one.

- **`run_user_seg.py <tol>`** — tuning/inspection: runs the segmenter at a given
  tolerance and writes per-sheet `_montage_*.png` + crops to `user-seg-out/`.
  Use it to pick the tolerance and eyeball the cut.
- **`finalize_cc.py`** — the final export: clean alpha (transparent where the
  paper shows), thin-line artifact filter (drops gridline fragments), robust row
  split by largest gaps, and a per-row merge down to the known asset count (fixes
  the cameo / sandcastle over-splits). Names every sprite (FRONTEND-SPEC §3) and
  writes named PNGs + `manifest.json` + a labeled `_montage.png` to `assets-cc/`.

## Run
```bash
python tools/segment/run_user_seg.py 70   # -> user-seg-out/ (tune, verify montages)
python tools/segment/finalize_cc.py        # -> assets-cc/ (verify _montage.png)
```
Then copy `assets-cc/{chrome,icons,scenes,manifest.json}` into `src/assets/`.

Deps: Pillow, numpy, scipy. Paths point at the repo-root source sheets; edit
`ROOT`/`TOL` if the layout changes, and re-check the montage before trusting a
new cut. Chrome ships outline-on-transparent (bucket-fill `--paper` in CSS);
scenes are copied raw (border-crop + watermark inpaint still pending).
