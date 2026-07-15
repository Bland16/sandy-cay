# Sandy Cay

A scheduling app that never guilts. Skipping things is a legitimate outcome;
warnings are reserved for scheduling *physics* ("this won't fit"), never for
moral bookkeeping (SPEC §0, P-1).

Working title **Sandy Cay** (from the art). Formerly "Tidepool."

## Status

- **Phase 1 — engine (in progress):** pure-JS scheduling core in `src/core` with
  a full Vitest suite where every worked example in the spec is a named test.
- **Phase 2 — frontend (gated):** the "hand-tinted film" UI in `src/ui`, built
  after a layout is signed off (see `FRONTEND-SPEC.md`).

## Specs

| Doc | Role |
|---|---|
| `SPEC.md` | Primary build spec — engine & data model authoritative |
| `FRONTEND-SPEC.md` | Art direction & layout — supersedes SPEC §10–§11 |
| `USE-CASE-ANALYSIS.md` | Decision record — arbitrates ambiguity |

## Development

```bash
npm install
npm test         # watch mode
npm run test:run # single pass (used in CI)
npm run dev      # Vite dev server (Phase 2 shell)
npm run build    # production build
npm run lint
```

## Layout

```
src/core     pure-JS engine (Task, Zone, Schedule, scoring, learning, storage)
src/ui       Phase 2 React components
src/assets   segmented sprites (Phase 2)
tests        Vitest suite — one named test per spec worked example
```

## Deployment

GitHub Actions builds and deploys to GitHub Pages on push to `main`
(`.github/workflows/deploy.yml`). Vite `base` is `/sandy-cay/`. Installable PWA
with offline caching.
