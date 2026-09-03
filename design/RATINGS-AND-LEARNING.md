# Ratings that never arrive — one door in, for everything the model learns from

> **⚠️ STATUS CORRECTED 2026-09-03: THIS IS BUILT.** The header below said
> "Nothing built" for three weeks after it shipped, and that cost real work — a
> reader this session concluded from it that a recurring-heavy user faces a
> *permanent* cold start, which is false. `Schedule#ratedSamples()` exists
> (`Schedule.js:434`), `retrain` uses it (`:1068`), `energyCalibration` uses it
> (`energy.js:73`), and `tests/rated-samples.test.js` guards it.
>
> One consumer was missed until now and is also fixed: `learnedCapacity` still
> walked `schedule.tasks` thirty lines below the calibration gate that had been
> routed through the door, so the gate opened while the estimator behind it
> stayed blind (`b1bb52e`). §4's "two stores, one reader" argument was right and
> incompletely applied — check every reader, not the one the bug was found in.
>
> The §6 findings — recency weighting, drift across a term — remain open.

**Session 8, 2026-08-13. Status: SPEC. Nothing built.** Written after a review
probe found that **a rating given to a recurring session reaches nothing that
learns.** This is not a tuning problem or a model-quality problem; it is a
plumbing problem, and it silently disables the learning half of the app for
exactly the person this app was built for.

Fixing it is a prerequisite for anything that reads the model —
`WEEKLY-PLANNING` §4.6's duration margin, the Cabana insight line, the energy
budget's calibration, and the whole session-7 argument about learned sitting
length, which was conducted on synthetic non-recurring data and so could not see
this.

---

## 1. The finding, proven

```
occurrences rated (written to occurrenceData): 12
parent task .satisfaction: null
retrain() sampleCount AFTER 12 recurring ratings -> 0
learning.trained? false   modelScore gated at coldStartRatings = 10
retrain() sampleCount after ONE ordinary rated task -> 1
```

Twelve rated gym sessions train **nothing**. One rated one-off task trains one.

## 2. Why — three doors in, and two of them lead nowhere

An occurrence's lived data belongs on the parent's `occurrenceData`, never on the
pattern (SPEC §4.4, and it is right — writing to the pattern would make Friday's
gym overwrite Monday's). `TaskPanel.jsx:60–71` implements that correctly. But
everything that *consumes* ratings looks somewhere else:

| consumer | reads | sees a recurring rating? |
|---|---|---|
| `Schedule#retrain` (`:587`) | `this.tasks.filter(t => t.satisfaction …)` | **NO** |
| `energyCalibration` (`energy.js:69–71`) | `for (const t of schedule.tasks)` | **NO** |
| `Schedule#_snapshotEnergy` (`:231`) | fires only inside `updateTask`, keyed on `changes.satisfaction` | **NO** — occurrence ratings bypass `updateTask` entirely |
| wrap report (`report.js:52–57`) | `getTasksForWeek` | yes ✓ |
| detectors (`detectors.js:75`) | `task.occurrenceData[key]` directly | yes ✓ |

The two that work are the two that either materialize occurrences or read
`occurrenceData` by hand. The three that fail all iterate `schedule.tasks`,
where a materialized occurrence has never existed —
`getTasksForWeek` builds them fresh on every call and throws them away.

**The near-miss is worth recording.** `TaskPanel.jsx:52` already warns that
writing satisfaction onto the pattern *"would leave `retrain()` seeing ONE sample
no matter how many sessions were rated."* The author saw the hazard, routed the
data correctly, and did not check the other end. The result is zero samples
instead of one — a worse outcome than the bug being guarded against.

## 3. What it costs

- **`w.preference` is permanently 0** for a recurring-heavy user, because
  `sampleCount` never reaches `coldStartRatings` (10). The learning module is
  triple-gated (`Schedule.js:94`, `:99`, `learning.js:186`), so it fails closed
  and silently — no error, no empty state, just a weight that is always zero.
- **`learnedCapacity()` returns `null` forever**, so the energy card is stuck in
  its "still learning" shape and never earns a ceiling — indistinguishable from
  a user who simply has not rated anything.
- **`energyAt` is never captured for a recurring session**, so even the context
  that *was* designed to be snapshotted at rating time is missing for them.
- **The Cabana insight line has nothing to say**, and the wrap report's learned
  weights section is empty, while the report's own per-week rating stats look
  fine — which makes the failure look like a display bug rather than a data one.

For a user whose week is gym, classes, lunch and a standing commitment, **most
of their rated life trains nothing.** That is the user this app has.

## 4. The fix — one door

```
ratedSamples(schedule) → Task-shaped samples, from BOTH stores
```

A single exported helper, and the only thing `retrain`, `energyCalibration` and
any future consumer may call. Two stores, one reader — because the reason this
bug exists is that there were two readers and one of them was forgotten.

**The sample shape already exists.** `buildOccurrence` (`recurrence.js`) merges
`od.completion`, `od.satisfaction` and `od.history` onto a real `Task` with the
session's own `startTime`/`endTime`. That is exactly what `featureVector` wants —
time-of-day, weekday, duration and tags all fall out of it. Nothing new has to be
invented to describe a rated session; it only has to be *reached*.

## 5. The context problem, and where it is solved

A sample needs the session **as it actually ran**, not as the pattern would
render it today. Reconstructing by expansion is right for an unchanged pattern
and wrong for one that has since been split or moved — and `occurrenceData`
deliberately outlives pattern changes.

So the context is **stamped at rating time**, in the one hook that already exists
for exactly this reason. `_snapshotEnergy` is documented as writing once, on
first rating, refusing to recompute, *"because deriving it later from the current
schedule would train the model on a day that never happened."* That argument
applies unchanged here. The hook grows from one field to three:

| stamped at rating time | today | after |
|---|---|---|
| `energyAt` | ✓ for tasks, ✗ for occurrences | both |
| `dayFill` | ✗ — hardcoded `0` in `featureVector`, `_dayFillAtCompletion` has one repo hit, is not a `Task` field and is not serialised | both |
| the session's `startTime` / `endTime` | ✗ | occurrences (a task already carries its own) |

**This absorbs session 7's step-0 item 2** (wire `dayFill`) rather than doing it
separately — same hook, same rationale, same commit. Note the standing warning
that `dayFill` must **not** be used as an intensity cap: its learned linear
weight flips sign four times and yields no level. Record it because it is
unrecoverable; decide later what it answers.

**And the hook has to be reachable.** Occurrence ratings currently bypass
`updateTask`, so `_snapshotEnergy` never fires for them. Either route occurrence
lived-data through a real `Schedule` method — `rateOccurrence(parentId, key,
patch)`, which is where this belongs anyway — or call the snapshot explicitly
from the mutation. The method is better: `TaskPanel` and `App`'s completion path
currently hand-write `parent.occurrenceData` in two places, which is the same
two-doors mistake one level down.

## 6. The past is not recovered — decided

**Existing ratings carry no stamped context and will not be back-filled.** Two
reasons, and the user's is the stronger:

1. A reconstructed session time is a guess presented as data, and this app does
   not state what it has not earned.
2. **The old ratings describe a different life.** In the user's words: one-on-one
   time with friends dominates the summer and group time dominates term, and
   those are not the same experience even under the same tag. Importing summer's
   ratings into a term model would train it on a person who is not there any
   more — and there is a months-wide gap in the middle of the data either way.

The model therefore starts from the non-recurring ratings that already work, and
recurring sessions begin contributing from the fix onward.

**Two consequences worth stating rather than discovering:**

- **This argues for recency-weighting**, which `ENERGY-MODEL.md` already flags
  ("capacity drifts — recency-weight, not average all history") and nothing
  implements. Not proposed here; noted as the same finding arriving twice.
- **Tag granularity is now load-bearing.** If one-on-one and group time feel
  different, they must be **different tags**, because energy derives from tags
  and a single `social` tag averages the two into a number matching neither —
  and the distinction cannot be recovered later, since it was never recorded.
  Same argument as `WEEKLY-PLANNING` §4.6's tag hygiene note, from the other end.

## 7. It changes the retention decision

`SPEC-COMB` D-8 prunes `occurrenceData` at 12 months. **`occurrenceData` is where
recurring ratings live**, so once this fix lands, that prune deletes training
data — the exact thing the same decision says to keep. The horizon must key on
whether an entry carries a rating, not on the store it lives in. See the amended
table there.

## 8. Test plan

- **The regression this doc exists for:** N rated occurrences → `retrain()`
  reports N, not 0. Written as a probe first, because a unit test asserting
  `sampleCount > 0` is exactly the test that did not exist.
- Energy calibration reaches `calibrated` from recurring ratings alone, across
  `calibrationWeeks` distinct weeks.
- A rated occurrence's sample carries **its own** weekday and time-of-day, not
  the parent's, and not today's rendering of the pattern.
- Rating a session **after** the pattern has been split keeps the stamped
  context, not the new window's.
- `energyAt` and `dayFill` are written once, on first rating, and a re-rating
  does not overwrite them.
- Round-trip: a stamped occurrence entry survives `toJSON`/`fromJSON` — **both
  halves**, because a field written in one and not read in the other is silently
  dropped, which is how `freq` was lost for a whole session.
- Old saves with unstamped `occurrenceData` load clean and simply contribute
  nothing (§6).

## 9. What this does NOT do

- **No new features and no model changes.** No `featureVector` term, no
  `MODEL_LAYOUT_VERSION` bump required by this work — the vector's shape is
  untouched. (`dayFill` going live changes a column's *values*, not the layout;
  bumping anyway is cheap and forces a clean retrain, and the retrain-on-load
  migration already exists.)
- **No new tracking.** Every quantity here is one the app already believed it was
  recording. Nothing new is observed about the user, and the P-1 boundary is
  unchanged: this counts what you did and rated, never what you skipped.
- **It does not make the duration curve trustworthy.** The session-7
  disagreement about whether learned sitting length can set a plan stands
  unresolved, and its safe reading — advisory only, never silently changes the
  plan — is unaffected by there being more data.
