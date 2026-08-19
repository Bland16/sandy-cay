# Probes — the evidence behind session 8's decisions

Run with `node design/probes/<name>.mjs` from the repo root. They import
`src/core` directly and need no build and no `node_modules`.

**These are kept, unlike session 7's, because several carry FIXTURES worth
re-running** — two real week shapes, the front-loaded energy case, and the
week-shape family. A decision that was made by probe should be re-checkable by
the same probe.

**⚠️ Real-schedule data is ANONYMISED and must stay that way.** Course codes,
club names, locations and people's names were stripped before anything was
written down. `design/import/` and `*.ics` are gitignored because this repo is
public; never paste raw calendar data into a probe.

| probe | what it settled |
|---|---|
| `probe-google-bounded-repeat.mjs` | why every course failed to reach Google — a repeat with an END DATE, the shape no fixture had |
| `probe-google-second-device.mjs` | a second device: adopts if fresh, freezes if stale. Was RED (it lost the whole library); green since GS-8 |
| `probe-google-day-notes.mjs` | GS-11 — the exclusive `end.date`, which silently lengthens every holiday by a day if it is wrong |
| `probe-library-merge.mjs` | the two import doors on the SAME file — add-what's-missing vs restore-the-setup, and what each costs |
| `probe-horizon.mjs` | the `spread`/proximity-renormalisation experiment — **rejected**, it lengthens the streak (WEEKLY-PLANNING §4.5) |
| `probe-week-shapes.mjs` | four week shapes; the ~40%-full week concentrates work **harder** than an empty one |
| `probe-mental-frontload.mjs` | placement is energy-blind: 960 of 1200 minutes onto the four worst days |
| `probe-energy-candidates.mjs` | the five candidates + hybrids; C2 dies on arithmetic, H-family emerges |
| `probe-stability-and-c3.mjs` | stability (all churn is the spacing term) and the C3 fixture (C1 is blind to within-day order) |
| `probe-two-fixes.mjs` | the restorative sign flip and cross-period spacing, both proven |
| `probe-uc-adversarial.mjs` | X11 (busy ≠ depleting) and X8 (a day chooser cannot express "before the clinic") |
| `probe-uc-design-breakers.mjs` | M6 and N10 — the two blind scenarios that attacked the equation |
| `probe-real-week.mjs` | a real dense term week; H5 avoids the slots the user actually skipped |
| `probe-real-weeks-uc.mjs` | the blind scenarios against both real weeks; **the day ranking inverts with the scoring hour** |
| `probe-c6-eval.mjs` | candidate 6 **rejected**: `C3 + C6` is identically `C1` |
| `probe-idle-recovery.mjs` | idle time is invisible to the battery — a gap has no recovery value in the model |
| `scenario-harness.mjs` | a declarative scenario runner, unused so far — kept for the build |

## The standing rule these exist to serve

573 tests passed with the rejected `spread` change and 573 passed without it,
while every deadlined task with a runway over three days moved. **The suite
cannot see placement quality and never has.** Anything that changes where work
lands must be proven by printing placements.
