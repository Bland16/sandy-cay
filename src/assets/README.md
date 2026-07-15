# `src/assets` — segmented sprites

Cut from the four source sheets in the repo root (FRONTEND-SPEC §3–§4,
Appendix A) with a **connected-components segmenter** (`tools/segment/`, built on
the project's `sprite_tools_new.py`). Every sprite is decorative and has an
inline-SVG/CSS fallback in the UI, so the app is fully functional if a sprite is
missing (§10, hard rule).

- `chrome/` — 26 UI-chrome pieces (frames, buttons, the toggle, badges) from
  sheet 1 (`…eqjipce…`). **Outline-on-transparent** — the aged-paper chassis is
  transparent; bucket-fill it in CSS with `--paper` (`#F1E9D8`, recorded as
  `chromeChassisFill` in the manifest) where a solid button/frame is wanted.
- `icons/` — 31 beach icons from sheet 2 (`…pm0fda…`), clean transparent alpha.
- `scenes/` — backgrounds from images 3 (`…qd2nq3…`, beach) and 4
  (`…xjbjx6…`, cabana interior). **Raw for now** — film-border crop + Gemini
  watermark inpaint (the treasure-chest sparkle) are pending the integration pass.
- `manifest.json` — `{ schemaVersion, segmenter, chromeChassisFill,
  sprites:[{ name, file, sheet, cell, box }] }`. Manifest-driven so a regenerated
  sheet is a **re-segmentation, not a code change**.

Regenerate: `python tools/segment/finalize_cc.py` from the repo root (writes to
`assets-cc/`, incl. a labeled `_montage.png` for verification, then copy
`{chrome,icons,scenes,manifest.json}` into here). Use
`tools/segment/run_user_seg.py <tol>` to sweep the background tolerance and
inspect the per-sheet montages when tuning.

**Not yet wired into the UI** — Phase 2 uses the SVG fallbacks first; sprites swap
in via the manifest later.
