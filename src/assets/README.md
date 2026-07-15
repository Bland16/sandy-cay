# `src/assets` — segmented sprites

Cut from the four source sheets in the repo root (FRONTEND-SPEC §3–§4,
Appendix A). Every sprite is decorative and has an inline-SVG/CSS fallback in the
UI, so the app is fully functional if a sprite is missing (§10, hard rule).

- `chrome/` — 26 UI-chrome pieces (frames, buttons, the toggle, badges) from
  sheet 1 (`…eqjipce…`).
- `icons/` — 31 beach icons from sheet 2 (`…pm0fda…`).
- `scenes/` — backgrounds from images 3 (`…qd2nq3…`, beach) and 4
  (`…xjbjx6…`, cabana interior). **Raw for now** — film-border crop + Gemini
  watermark inpaint (the treasure-chest sparkle) are pending the integration pass.
- `manifest.json` — `{ schemaVersion, sprites:[{ name, file, sheet, cell, box }] }`.
  Manifest-driven so a regenerated sheet is a **re-segmentation, not a code
  change** (`tools/segment/`).

Regenerate with `python tools/segment/seg.py && python tools/segment/finalize.py`
(from the repo root), which also writes a labeled `_montage.png` for verification.

**Not yet wired into the UI** — Phase 2 uses the SVG fallbacks first; sprites swap
in via the manifest later.
