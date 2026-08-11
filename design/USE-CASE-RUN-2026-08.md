# Use-case run — 2026-08-11

**73 use cases, six independent sources, none of which had seen the code.**

| Source | Lens | Count |
|---|---|---|
| Agent A | a real university academic year | 12 |
| Agent E | calendar and date edge cases | 12 |
| Agent N | energy, rest, burnout, honesty | 12 |
| Agent X | adversarial and degenerate schedules | 13 |
| External LLM (user-supplied) | mixed, student-centred | 12 |
| External LLM (user-supplied) | mixed, student-centred | 12 |

**The division of labour is deliberate.** This repo's audit record (HANDOFF,
"Audit passes") shows spec-only agents score badly at *finding bugs* — 3 of 5,
then 1 real and 1 false — against 6 of 6 for a code-grounded pass. But that is
about judgement, not imagination: a model that has never seen the code is
*better* at inventing the scenarios a real person hits, because it cannot
pattern-match to what the implementation happens to do. So **they generate, and
this repo verifies by execution.** No case below is called a pass or a fail on
anyone's opinion; each was run.

---

## 1 real bug — found, fixed, regression-tested

### Overdue work was parked into hours that had already gone

From **UC-X4**, "a deadline three days in the past". Proven by probe: with the
clock at **15:00 Wednesday**, an overdue task was placed at **08:00 that same
morning** — 420 minutes into the past.

`placeTask` step 4 is the last resort: when nothing can satisfy a deadline it
parks the task somewhere visible rather than losing it. But it parked at the day
*window's* start and never clamped to `from` — **exactly the bug the scored
search was fixed for in session 2** ("a window already behind `from` was walked
from its own start"). The floor held on every path except the one that ignores
it, and that path only runs for tasks whose deadline is already impossible — so
it hit precisely the overdue work most likely to be carried forward.

Fixed in `placement.js` by taking the later of the window start and `from`. Two
regression tests, including the mirror case (a `from` *before* the window opens
must not drag the task out of its window).

---

## Verified passing — run, not assumed

| Case | What it proves |
|---|---|
| **A2** / **SET1-02** | Moving one session of a series does not drag the rest. Bio lab's "first Monday" moved off Labor Day to 14 Sep, and October stayed on the 5th. |
| **SET1-07** | An **extra** session added mid-month to a "first Thursday" pattern appears on 15 Oct without disturbing 5 Nov. |
| **SET1-11** | "Every 3 weeks, last day Tue 1 Dec" runs 8 Sep · 29 Sep · 20 Oct · 10 Nov · 1 Dec — **on** the stated last day, and not on 22 Dec. No fencepost error. |
| **SET1-12** | A Friday lab temporarily moved to Wednesdays runs Fri 20 Nov, Wed 2 Dec, Wed 9 Dec, then resumes Fri 18 Dec. The base pattern is intact, with no orphans. |
| **SET2-04** | Skipping January's "first Monday" leaves February's alone. |
| **A8** | A 30-minute task placed for a 1-hour zone lands **inside** it (Tue 15:00–15:30), not straddling the end. |
| **E1/E2 family** | Already locked by `tests/recurrence-monthly.test.js`: the 31st skips short months, "last" always fires, "fifth" mostly doesn't, 29 Feb is leap-only. |

---

## Not a bug — a configuration trap worth knowing

**SET2-05**: a "Physical Activity" zone at **06:00–08:00** never gets used, and
the gym task lands at 08:00–10:00 instead.

Proven cause: `config.windows.monFri` is **08:00–18:00**, so a 06:00–08:00 zone
has *no intersection with the schedulable day at all*. Legal windows come back
empty, placement relaxes out of the zone (SPEC §2.2 precedence: deadline > zone
> windows), and the task is flagged `outside-zone` so the UI badges it. Widen
the day to 06:00–22:00 and the same zone works perfectly — placed 06:00–08:00
with no flag. Proven both ways.

So the app is behaving as specified *and* telling the user. But **a zone outside
the day window can never be honoured**, and nothing says so at the moment you
draw it. This is the same trap the handoff already flags at the other end of the
day: the user's real 18:30 workday needs `config.windows` widened past 18:00.

**Worth doing:** warn when a zone window falls outside `config.windows`, at the
moment the zone is saved. That is the honest place to say it.

---

## Still open, confirmed by this run

- **Per-session deadlines do not exist.** UC-A1 wants eleven weekly psets each
  due its own Friday. `buildOccurrence` sets `deadline: null` on every
  occurrence, so a recurring task's sessions cannot carry deadlines at all.
  Product gap, not a defect — but it defeats a common student pattern.
- **The `add`-exception bug is unchanged and still real.** UC-A7 and SET1-07
  both pass because their extra session lands on a day the pattern does *not*
  fill. The failure is specifically an extra session on a day the pattern
  **already** fills, which is the likeliest day to want one. D-6 in
  `SPEC-COMB-2026-08.md`.
- **Zero and negative durations are silently coerced to 60 minutes** (UC-X12)
  rather than refused. API-level only — the duration control clamps — so low
  severity, but it is a silent coercion.
- **A task longer than a day is accepted whole** (UC-X3): a 30-hour task placed
  as one 30-hour block. No split, no warning.

---

## Two corrections to my own probes, recorded so they are not repeated

Both times a "failure" was mine, not the app's — which is the point of running
things rather than reasoning about them.

1. **Zones match on `matchTags`, not `tags`.** A probe passing `tags` produced a
   zone that matched nothing, making it look like zone constraints were being
   ignored entirely. The UI uses `matchTags` consistently; there was no bug.
2. **`config.windows` is keyed `monFri` / `sat` / `sun`**, not by individual
   weekday. A probe widening `windows.mon` changed nothing at all.

---

## What still needs a browser, not a terminal

These cannot be settled from here and are for the user to drive:

- **UC-01 (both external sets)** — a 02:30 task must render in the *previous*
  night's column. The engine's `gridDayOf` is tested; the rendering is not.
- **UC-N1, N2, N6, N11** — the honesty cases: what the energy card and the wrap
  report *say* on a bad week, and what they must not say. These are wording and
  presentation, which no test can see.
- **UC-05 / X8 / X10** — the drag, ripple-vs-displace and block-days
  confirmations: whether the user is actually told what is about to move,
  before it moves.
