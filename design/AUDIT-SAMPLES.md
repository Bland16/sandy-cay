# AUDIT — what lands in the sample set

Scope: `Schedule#ratedSamples()` (`src/core/Schedule.js:472`) and its five readers —
`retrain` (`Schedule.js:1107`), `energyCalibration` (`energy.js:89`),
`learnedCapacity` (`energy.js:352`), `steerBias`/`recentRated` (`suggest.js:62`),
`whatToDo`'s rest-boost (`whatToDo.js:87`), plus the wrap report's duration-fit
finding (`report.js:252` → `detectors.js:138`).

Every finding below was produced by running code. Probes were throwaway
(`tests/zz-samples-*.test.js`, deleted); source and output are inline.

The whole of `ratedSamples()` is 30 lines and worth having in view:

```js
ratedSamples() {
  const out = [];
  for (const t of this.tasks) {
    if (t.chunking) continue;
    if (t.satisfaction) out.push(t);
    for (const key of Object.keys(t.occurrenceData || {})) {
      const od = t.occurrenceData[key];
      if (!od || !od.satisfaction || !od.at) continue;
      ...
    }
  }
  return out;
}
```

Two filters exist: `chunking`, and "an occurrence must have a stamped `at`".
That is all. There is no completion filter, no date filter, no tag filter, and
no de-duplication.

---

## CONFIRMED PROBLEM

### 1. There are no time bounds anywhere, and the weekly wrap report says so out loud

`ratedSamples()` returns every rating ever recorded. `buildSuggestions` takes
the tag list from **this week's** tasks (`report.js:230`) and then hands the
**all-time** pool to the detector (`report.js:252`). The sentence that gets
printed states a numerator and denominator, which makes the staleness
legible — and wrong.

Probe: rate twelve gym sessions Feb–Apr 2026, then build the wrap report for the
week of 7 September 2026.

```
rated 12 sessions, dates: 2026-02-03 2026-02-10 ... 2026-04-14 2026-04-21
ratedSamples span: 2026-02-03 -> 2026-04-21
report week starting 2026-09-07
ALL suggestion headlines:
   * skip-streak | Gym hasn't happened in 4 weeks
   * duration-fit | gym blocks may want to be shorter
  -> 12 of 12 rated gym sessions said the block ran long. Worth trying shorter next time.
days between last evidence and report week: 139
```

The same report tells the user their gym has not happened in four weeks and
that their gym blocks should be shorter based on twelve sessions, all of which
are more than four months old. "12 of 12" reads as *recent and unanimous*.

The other unbounded readers, same probe:

```
energyCalibration (only Feb ratings): {"calibrated":true,"weeksRated":4,"weeksNeeded":3}
retrain sampleCount: 4
```

`energyCalibration` counts *distinct weeks ever*, so a user who rated four weeks
in February is permanently "calibrated" and the budget card will never return to
its honest "still learning" shape, however long they go without rating.

**`recentRated` is the only reader with a window, and it opts out of it when the
window is empty.** `suggest.js:62-68` takes `within` (trailing 14 days) or
`lastN` (last 10 by recency), *whichever yields more*:

```
steering TODAY (2026-09-09) from Feb-Apr ratings only:
  trained: true  energyBalance: -10  restorativeFlat: false
```

`within` is empty, so `lastN` wins and today's suggestions are steered by ten
February ratings. The window never actually bounds staleness — it only chooses
between "recent" and "old", and prefers whichever set is bigger.

Anti-vacuity: under any window the duration-fit finding would be absent (0
sessions in range) and `steerBias.trained` would be `false`. The probe prints
both as present, and the day-count arithmetic (139) is computed from the sample
timestamps rather than asserted.

**User notices:** advice from last term presented in a report titled with this
week's dates, next to a finding that says the thing has not happened.

---

### 2. One lived block is counted once per tag, so a single session inflates several denominators

`durationFitSuggestion` filters `t.tags.includes(tag)` (`detectors.js:139`), and
the caller loops over every tag on this week's tasks. Tags are not exclusive, so
a session tagged `['gym','health','morning']` is a full sample in three separate
populations.

```
sessions rated (each is ONE lived block): 12
ratedSamples length: 12
gym     {"suggest":true,"direction":"shorter","tag":"gym","count":12,"total":12}
health  {"suggest":true,"direction":"shorter","tag":"health","count":12,"total":12}
morning {"suggest":true,"direction":"shorter","tag":"morning","count":12,"total":12}
```

and in the report itself:

```
report suggestion ids: ["fit:gym","fit:health"]
  -> gym blocks may want to be shorter | 12 of 12 rated gym sessions said the block ran long.
  -> health blocks may want to be shorter | 12 of 12 rated health sessions said the block ran long.
```

Twelve blocks produce two (or three) findings that look like independent
evidence about different parts of the user's life. They are the same twelve
blocks. The `answered.length < 3` floor — the guard added precisely because
small denominators had produced a false finding before — is cleared once and
then re-cleared for free by every co-tag.

Anti-vacuity: `ratedSamples length: 12` is printed alongside the three `total:
12`s, so the reader can see the same twelve rows serving three denominators. If
tags were exclusive, two of the three would be `{"suggest":false}`.

**User notices:** the wrap report repeating one observation under two or three
headlines, each claiming its own count.

---

### 3. A one-off that is later made recurring is counted twice — as the pattern *and* as its own occurrence

`ratedSamples()` pushes `t` if `t.satisfaction` is set, then *also* walks
`t.occurrenceData`. A task can have both: rate a session, then turn on
recurrence in the task panel (`TaskPanel#applyPattern` sets `parent.recurrence`
on the existing task and never clears `satisfaction`).

```
as a one-off, samples: 1
after making it weekly, samples: 4
TASK run-0001            @ 2026-09-08T11:00
OCC  run-0001@2026-09-08 @ 2026-09-08T11:00
OCC  run-0001@2026-09-15 @ 2026-09-15T11:00
OCC  run-0001@2026-09-22 @ 2026-09-22T11:00
dates: 2026-09-08 2026-09-08 2026-09-15 2026-09-22 | duplicated date? true
durationFit gym: {"suggest":true,"direction":"shorter","tag":"gym","count":4,"total":4}
```

Three lived Tuesdays, four samples, with 8 September present twice at the same
minute. The duplicate is not merely a count: for `retrain` it is a repeated
training point (double weight), and `learning.js:384` folds by `parentId || id`,
so the pattern row (`parentId` null, id `run-0001`) and the occurrence rows
(`parentId` `run-0001`) land in the **same** fold — the cross-validation guard
that exists to stop "predict Tuesday gym from eleven other Tuesday gyms" still
holds here, so the damage is confined to weighting and to the report's
denominator.

Worse than the duplicate is *when* the pattern row claims to be. Its `startTime`
is the pattern's current start, not the moment the rating was given. Edit the
pattern to Thursdays at 18:00 and that sample silently relocates — which is
exactly the failure `ratedSamples()`'s own header forbids for occurrences
("reconstructing its time from today's pattern would be a guess presented as
data") and then permits for the pattern itself.

Anti-vacuity: the probe prints ids and timestamps, not just a count; the
`duplicated date? true` line is computed from the sample set. If the pattern row
were excluded the output would be 3 samples and `false`.

**User notices:** rarely, and that is the problem — a favourite one-off promoted
to a routine quietly weighs double forever.

---

### 4. Work the user did not do is evidence, and only this door thinks so

`ratedSamples()` has no completion filter. `completion === 'skipped'` is
excluded at nine call sites in `energy.js` alone (`:143, :193, :225, :319, :369,
:408`) and treated as "unrated" by the skip-streak detector
(`detectors.js:76`) — but a skipped item carrying a `satisfaction` object is a
full training sample and a full denominator entry.

```
samples: 1 completion of sample: [ 'skipped' ]
plain skipped task in samples: true
retrain sampleCount (skipped included?): 2
```

It is reachable without the user ever rating something they skipped, because the
skip happens *after* the rating. `letThemGo` (`carryOver.js:74`) requires only
`completion === null` and writes `completion = 'skipped'`, leaving
`satisfaction` untouched; the same is true of the clear-day panel
(`ClearDayPanel.jsx:284`) and the report's own "Let it go" action
(`report.js:322`).

```
released: 1  completion now: skipped  satisfaction kept: {"overall":2,"durationFit":1}
still a sample: 1 | retrain: 1
```

So: rate a block two stars and "ran long", never tick it done, let the week go —
and that block still tells the model what you like and still counts in "N of M
rated study sessions". A `durationFit` answer about a session that did not
happen is not a small inaccuracy; it is an answer to a question that was never
asked.

The same holds for an occurrence that is rated and *then* skipped by exception:

```
occurrences on the grid after skipping it: 0
but ratedSamples still holds it: 1 ["2026-09-08"]
```

Note `letThemGo`'s docstring says skipping "also feeds honest ML data" — so
*recording* the skip is deliberate. Whether a **satisfaction rating attached to a
skipped block** should count is the open half, and every other reader in the
codebase has already answered no.

Anti-vacuity: `retrain` is the strict reader (`Number.isFinite` on `overall`)
and still returns 2 and 1 respectively; the counts are printed, not asserted.

**User notices:** a duration-fit finding built partly on blocks their own
calendar shows as skipped.

---

### 5. Deleting a recurring pattern deletes every rating it ever collected

Ratings for recurring work live in `parent.occurrenceData`. `removeTask`
(`Schedule.js:324`) splices the parent out of `this.tasks`; there is no
tombstone, no migration, no warning.

```
before delete: samples 12 retrain 12
after  delete: samples 0  retrain 0
```

A term of gym ratings disappears the moment the user deletes the pattern — which
is the natural thing to do when a routine ends. Note the asymmetry with tag
retirement, which was designed explicitly to *preserve* history ("stays on
historical tasks and in insights", `Schedule.js:849`): the tag path keeps the
evidence, the delete path silently burns it. Until the next `retrain`,
`learning.sampleCount` also still reports a model trained on rows that no longer
exist.

Anti-vacuity: both numbers are printed before and after a single `removeTask`
call in the same schedule; nothing else changes between the two lines.

**User notices:** the model gets quieter (`modelMaySpeak` can flip off) with no
stated cause, right after an unrelated cleanup.

---

## SOUND

Checked and behaving correctly — recorded so the next audit does not re-derive
them.

- **`chunking` parents are excluded, and so is anything hanging off them.** A
  project parent given a `satisfaction` object is not a sample; its four chunks
  are. Attaching `occurrenceData` to a chunking parent adds nothing, because the
  `continue` precedes the occurrence walk.
  ```
  children created: 4  child tags: ["study"]
  samples: 4  parent among them: false
  samples after chunking parent gains occurrenceData: 4
  ```
  (A project cannot currently be recurring, so the second line is defence in
  depth rather than a live path.)

- **All three occurrence-key shapes materialise, with their own times and
  durations.** `YYYY-MM-DD`, `#2` (a second window the same day) and `#add` (an
  extra session) each become a distinct sample:
  ```
  occurrence keys on the grid: ["2026-09-08","2026-09-08#add","2026-09-08#2"]
  id=gym-0002@2026-09-08      occDate=2026-09-08      start=...T07:00 dur=60
  id=gym-0002@2026-09-08#add  occDate=2026-09-08#add  start=...T12:00 dur=30
  id=gym-0002@2026-09-08#2    occDate=2026-09-08#2    start=...T18:00 dur=60
  ```
  The suffixed keys are **not** parseable as dates (`new Date('2026-09-08#2')`
  is Invalid Date), so I checked every reader: nothing downstream of
  `ratedSamples()` parses `occurrenceDate` as a date. Readers use it as an
  opaque `occurrenceData` key (`detectors.js:75`, `App.jsx:321`), as an
  exception key, or via `dateOfOccurrence()` which strips the suffix by design
  (`recurrence.js:193`). Time-based readers use `startTime`, which is stamped
  from `od.at`. No suffix hazard.

- **Moving a session does not orphan or duplicate its rating.** The
  `occurrenceData` key stays the pattern date while the grid position moves, so
  one lived session stays one sample:
  ```
  after move, grid keys: ["2026-09-08@2026-09-10T07:00"]
  does the moved session still carry its rating? [ true ]
  occurrenceData keys: ["2026-09-08"]
  samples for ONE lived session: 1
  ```

- **`retrain`'s numeric guard holds.** Three tasks with a `satisfaction` object
  but `overall` missing / `null` / `'4'` (string) are all in `ratedSamples()`
  and all correctly refused by training: `retrain sampleCount: 0`.
  `durationFitSuggestion` counts them (3 of 3) — which is right, since
  `durationFit` is its own answered question and does not need a star rating.
  The two doors disagree about what "rated" means, but each is internally
  correct; the consequence is only that the wrap report can speak while the
  model is still at cold start.

- **`partial` completion is a sample, with its planned duration.**
  `completion: partial, durationMin: 120`. Partial work was lived, and the block
  really was two hours long, so both are right.

---

## UNDECIDED

Product questions, not defects — I could not settle them from the code.

1. **Retired tags still generate actionable suggestions.** Retiring `health`
   leaves `fit:health` in the report, complete with "Worth trying shorter next
   time" — advice about a tag the user can no longer pick for a new task.
   `retireTag`'s docstring says retirement is hide-from-new and that retired tags
   "stay ... in insights", so the observed behaviour matches the written rule.
   Whether an *observation* about a retired tag should also carry an
   *instruction* is a call I cannot make. (Note it only surfaces while a live
   task still carries the tag, since the tag list comes from this week's tasks.)

2. **Should each chunk of one project be its own sample?** Four chunks of a
   single six-hour project, each rated, produce `{count:4,total:4}` for `study`
   — clearing the ≥3 floor from **one** piece of work. Defensible (each chunk was
   a real block that really ran long) and also exactly the shape of the
   small-denominator problem the floor was added to prevent.

3. **String `overall` from import/sync.** `'4'` trains nothing and reports no
   error. I did not establish whether the Google/library import path can produce
   one, so I am not claiming it can.
