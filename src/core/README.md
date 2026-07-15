# `src/core` — the scheduling engine

Pure JavaScript. **Zero DOM imports** (enforced by the ESLint override in
`eslint.config.js`, per SPEC §12). Everything here runs headless under Vitest so
the Phase 2 UI binds to a finished, tested engine.

Authoritative references, in precedence order:

1. `USE-CASE-ANALYSIS.md` — the decision record; arbitrates ambiguity.
2. `SPEC.md` — consolidated build spec (engine + data model authoritative).
3. `FRONTEND-SPEC.md` — supersedes SPEC §10–§11 (Phase 2 only).

Build order for this module is SPEC §13 Phase 1.
