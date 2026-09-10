# AUDIT — evidence thresholds in every detector and report-suggestion

Audited 2026-09-09. Scope: every detector in `src/core/detectors.js`, every branch of
`buildSuggestions` and `buildInsight` in `src/ui/report.js`, and the two steering
surfaces that also print sentences to the user (`src/core/suggest.js`,
`src/core/whatToDo.js`). `durationFitSuggestion` is the already-known defect and is
included only where the audit turned up something the earlier fix did not cover.

Every finding below was produced by running code, not by reading it. Probe sources and
verbatim output are inline. All probes were `tests/zz-det-*.test.js`, run with
`npx vitest run <file> --maxWorkers=2 --minWorkers=1`, and deleted afterwards.

**Full inventory found.** `driftCheck`, `starvationCheck`, `skipStreakCheck`,
`pinnedRatioNote`, `overpackCheck`, `durationFitSuggestion` (detectors.js);
`buildInsight` (report.js); `steerBias` + `lastFinishedLoad`/`suggestActivities`
(suggest.js); the `drainedToday` rest-boost and the `pref >= 0.6` line (whatToDo.js);
`buildDeadlineBuffer` (report.js). Nothing else in `src/` prints a claim about the
user's behaviour.

---

## Ranking — how wrong the printed claim can get

| # | Detector | Worst printed claim it can make | Verdict |
|---|---|---|---|
| 1 | `skipStreakCheck` | "Gym hasn't happened in 3 weeks" about three sessions the user marked **done** | WRONG — the claim is false, not merely thin |
| 2 | `driftCheck` | "4 of the last 5 sessions" when only 4 moves have ever existed and 20 sessions occurred | WRONG DENOMINATOR |
| 3 | `starvationCheck` | "Tax forms keeps getting pushed… Pinning it gives it right of way next week" about a task finished in March | WRONG DENOMINATOR (no time scope, no completion filter) |
| 4 | `steerBias` — `restorativeFlat` | "Rest's felt flat lately" off **one** restorative rating | THIN EVIDENCE |
| 5 | `buildInsight` | "Across 24 ratings, late evenings run about a shell below your others" — that column has 4 observations | WRONG DENOMINATOR |
| 6 | `steerBias` — `energyBalance` | "You've been running down" off a net of −1 across 10 ratings | THIN EVIDENCE |
| 7 | `overpackCheck` | "This week is packed — breaks are compressed on 3 days" about three two-hour days | THIN EVIDENCE / WRONG DENOMINATOR |
| 8 | `pinnedRatioNote` | "100% of this week was pinned" for one pinned half-hour | WRONG DENOMINATOR (mild) |
| 9 | `lastFinishedLoad` (variety nudge) | silently wrong ranking — no false sentence | MISSES RECURRING |
| 10 | `durationFitSuggestion` | September's report resting entirely on three March sessions | WRONG DENOMINATOR (residual; time axis) |
| — | `drainedToday` (whatToDo) | "a lighter pick — you have been drained today" off one rating | THIN, but the sentence is literally true — SOUND |
| — | `buildDeadlineBuffer` | states its own count and target | SOUND |

---

## 1. `skipStreakCheck` — VERDICT: WRONG (false claim)

**What it prints.** `src/ui/report.js:199-202`:

> **Gym hasn't happened in 3 weeks**
> It may have run its course, or it may just be in the wrong slot. Both are fine.
> [Change the pattern] [Let it go]

**Evidence base.** `src/core/detectors.js:68-84`. For each of the last
`skipStreak + 1 = 4` weeks it expands the pattern and asks whether **every** occurrence
that week was skipped *or unrated*:

```js
if (od && od.completion === 'skipped') return true;
if (!od || !od.satisfaction) return true; // unrated
```

The second line is the defect. An occurrence marked `completion: 'done'` with no
satisfaction rating satisfies `!od.satisfaction`, so **a session the user completed and
recorded as completed counts as a session that did not happen.** Rating is optional
everywhere else in the app; here its absence is read as absence of the event.

**Minimum firing input.** Three consecutive weeks with one occurrence each, every one
of them explicitly `completion: 'done'`. Confirmed at exactly 3 (2 weeks does not fire).

**Sample source.** `schedule._expand` + `task.occurrenceData` — correct. Not a
`schedule.tasks` bug.

**Does the sentence state its evidence?** No, and it cannot: it asserts an event did not
occur, so there is no numerator to show. The claim is categorical.

**Stale denominator?** No — `recentWeeks` scopes it to the trailing weeks correctly.

**P-1.** This is the worst P-1 breach in the set. The app offers "Let it go" for a habit
the user is *keeping*, on the strength of their not having filled in an optional rating.

### Probe (excerpt) and output

```js
const { s } = gymSchedule();                 // weekly Tuesday 07:00 Gym, no exceptions
for (let w = 0; w < 4; w += 1) {
  for (const o of s.getTasksForWeek(addDays(MON, w * 7)).filter((t) => t.isOccurrence)) {
    s.rateOccurrence(o, { completion: 'done' });   // DONE. No rating.
  }
}
const out = buildWrapReport(s, addDays(MON, 21)).suggestions.filter((x) => x.kind === 'skip-streak');
```

```
B1 occurrences marked completion:"done" = 4
B1 stored occurrenceData = {"2026-09-08":{"completion":"done"},"2026-09-15":{"completion":"done"},
                            "2026-09-22":{"completion":"done"},"2026-09-29":{"completion":"done"}}
B2 skip-streak suggestions = 1
B2 headline = Gym hasn't happened in 4 weeks
B3 CONTROL rated -> skip-streak suggestions = 0
B4 CONTROL nothing recorded -> skip-streak = 1 | headline = Gym hasn't happened in 4 weeks
H1 2 unrated weeks -> skip-streak = 0 | headline = undefined
H1 3 unrated weeks -> skip-streak = 1 | headline = Gym hasn't happened in 3 weeks
```

**Anti-vacuity check.** Three separate controls, each of which printed a *different*
result: B3 (same sessions, rated) → 0 suggestions, proving the trigger is the missing
rating and not the `done` marker or the fixture's shape; B4 (nothing recorded at all) →
identical output to B1, proving `done` buys the user literally nothing; H1 at 2 weeks →
0, proving the `skipStreak: 3` floor is the thing being crossed and not some incidental
week-boundary effect. No `if` guard wraps any assertion — every line is an unconditional
`console.log` of a value.

---

## 2. `driftCheck` — VERDICT: WRONG DENOMINATOR

**What it prints.** `src/ui/report.js:183-187`:

> **Gym keeps moving later**
> 4 of the last 5 sessions started about 30m later than the pattern says.
> [Make that the pattern] [Leave it as it is]

**Evidence base.** `src/core/detectors.js:34-57`. The pool is **not sessions.** It is
`task.recurrence.exceptions` filtered to `action === 'move'` — i.e. only the occurrences
the user explicitly dragged. Untouched occurrences are never in `deltas` at all. Then
`recent = deltas.slice(-driftN)` takes the last 5 *moves*, and fires at
`driftHits = 4`.

Two independent problems:

1. **"sessions" is the wrong noun.** With 20 weekly sessions of which 4 were dragged
   later, the report says "4 of the last 5 sessions started about 45m later" — the other
   16 sessions started exactly on the pattern and are invisible to the count. This is
   structurally identical to the duration-fit bug that was just fixed: the denominator
   silently excludes everyone who agreed with the plan.
2. **The printed denominator is a config constant, not the sample size.** The sentence
   interpolates `config.detectors.driftN` (5) regardless of how many deltas exist. With
   exactly 4 move-exceptions in the whole history, `recent.length === 4`, `later === 4`,
   the check passes — and the sentence still says "of the last 5". The fifth session is
   fictional.

**Minimum firing input.** **Four** move-exceptions, ever, each ≥ `driftMin` (30) minutes
in the same direction. No lower bound on the number of occurrences and no time window.

**Sample source.** `task.recurrence.exceptions` — recurring-only by construction, so no
`ratedSamples()` issue.

**Stale denominator?** Yes, badly. There is no date filter anywhere in `driftCheck`.
Four moves from autumn 2025 still produce a suggestion in September 2026.

### Probe (excerpt) and output

```js
// A: exactly four move-exceptions, nothing else
const exc = [8, 15, 22, 29].map((d) => ({ date: dateKey(new Date(2026, 8, d)), action: 'move', start: '07:30' }));
// H2: twenty weekly sessions, only the last four moved
// M: four moves, all in 2025, report built for September 2026
```

```
A1 exceptions in the task = 4
A1 drift suggestions = 1
A1 headline = Gym keeps moving later
A1 detail   = 4 of the last 5 sessions started about 30m later than the pattern says.
A2 CONTROL with 3 moves -> drift suggestions = 0
A3 CONTROL with 4 x 20min moves -> drift suggestions = 0
A4 occurrences that existed across those 4 weeks = 4

H2 sessions that occurred = 20 | sessions moved = 4
H2 detail = 4 of the last 5 sessions started about 45m later than the pattern says.

M1 newest move exception = 2025-12-02 | report week = Sep 2026
M1 drift suggestions = 1
M1 detail = 4 of the last 5 sessions started about 1h later than the pattern says.
```

**Anti-vacuity check.** A2 (3 moves) and A3 (4 moves of 20 minutes) both printed **0**,
so the fixture is not firing on some unrelated property of a recurring task — it is
crossing `driftHits: 4` and `driftMin: 30` specifically. H2 is the load-bearing run: the
schedule contains 20 real occurrences (counted and printed, `occ = 20`), so "4 of the
last 5 sessions" is measurably a claim about 5 of 20. M1 changed only the exception
dates and the sentence survived unchanged, isolating the missing time window.

---

## 3. `starvationCheck` — VERDICT: WRONG DENOMINATOR

**What it prints.** `src/ui/report.js:217-221`:

> **Write the essay keeps getting pushed**
> Moved or carried 3 times. Pinning it gives it right of way next week.
> [Pin it next week] [Let it go]

**Evidence base.** `src/core/detectors.js:60-63` — `history.displacedCount +
history.carriedCount >= 3`. Both are **lifetime counters**, incremented at
`src/core/conflicts.js:93` and `src/core/carryOver.js:55`, and never reset, decayed, or
stamped with a date.

The suggestion guard at `report.js:214` is
`st.starving && !task.pinned && !task.chunking && task.completion !== 'skipped'` —
note what is *not* there: no `completion === 'done'` exclusion and no week scope. So:

- A task the user **finished** still generates "keeps getting pushed" and an offer to pin
  it next week.
- A task from **any week in history** is eligible, because `buildSuggestions` iterates
  `sched.tasks` rather than `weekTasks`. A March task appears in the September report.
- Worse, the two combine with `isEmpty`: a week with nothing scheduled renders the
  empty-week page *and* carries a starvation suggestion about a March task.

"3 times" is true but unanchored — three times over what period? The reader cannot name
the denominator, which is exactly the denominator rule.

**Minimum firing input.** One task, `displacedCount + carriedCount === 3`, in any week,
in any completion state except `skipped`.

**Sample source.** `sched.tasks`. Recurring work can never trigger this — occurrences are
anchors and are skipped by both `conflicts.js` (`isAnchored` → never evicted) and
`carryOver.js` (`if (t.recurrence) { dropped.push(t); continue; }`), so the counters stay
at 0 for patterns forever. That is a **blind spot rather than a false claim**: a routine
that genuinely keeps getting pushed is undetectable. Worth recording, but it does not
print anything wrong.

### Probe (excerpt) and output

```js
const t = s.addFlexible({ title: 'Write the essay', ... });
t.history.displacedCount = 2; t.history.carriedCount = 1;   // total 3
t.completion = 'done';
```

```
C1 total displaced+carried = 3 completion = done
C1 starvation suggestions = 1
C1 headline = Write the essay keeps getting pushed
C1 detail   = Moved or carried 3 times. Pinning it gives it right of way next week.
C2 CONTROL total=2 -> starvation suggestions = 0
C3 CONTROL completion=skipped -> starvation suggestions = 0

L1 task week = March 2026 | report week = September 7 – 13, 2026
L1 taskCount in the reported week = 0
L1 starvation suggestions = 1
L1 headline = Tax forms keeps getting pushed
L1 isEmpty (report thinks the week is empty) = true
```

**Anti-vacuity check.** C2 (total 2) printed 0, proving the `starvation: 3` floor is what
is crossed. C3 is the important one: `completion = 'skipped'` printed **0**, which proves
the guard *does* read `task.completion` — so `'done'` passing through at C1 is a real
omission from the guard's condition, not a field the code never looks at. L1 prints
`taskCount = 0` and `isEmpty = true` alongside the suggestion, so the mismatch between
the reported week and the task's week is visible in the output rather than inferred.

---

## 4. `steerBias` — `restorativeFlat` — VERDICT: THIN EVIDENCE

**What it prints.** `src/core/suggest.js:127`, rendered at
`src/ui/components/panels/WhatToDoPanel.jsx:179,197`:

> Rest's felt flat lately — a creative project?

**Evidence base.** `src/core/suggest.js:100-110`. The cold-start gate is
`if (recent.length < cfg.coldStart) return none` — ten **rated tasks of any kind**. But
the claim is about restorative time specifically, and its own sample is built separately:

```js
if (netLoad(loadOf(schedule, t)) < 0) restorativeOveralls.push(t.satisfaction.overall);
const restAvg = restorativeOveralls.length ? mean(restorativeOveralls) : null;
const restorativeFlat = restAvg != null && restAvg <= cfg.restFlat;  // restFlat = 3
```

`restorativeOveralls.length` has **no floor of its own**. One restorative session rated 3
out of 5, inside a pool of ten ratings that are otherwise all demanding work rated 5,
produces "Rest's felt flat lately" — and it is the strongest bias in the function
(`0.35`, and it stacks with the running-down bias for a total of `0.7`).

Note also that "3 out of 5" is the middle of the scale. `restFlat: 3` means *neutral*
counts as flat.

**Minimum firing input.** 10 rated samples total, of which **exactly one** is restorative
and rated ≤ 3.

**Sample source.** `recentRated` → `schedule.ratedSamples()` at `suggest.js:62` — correct,
recurring sessions included.

**Does the sentence state its evidence?** No. "lately" implies a run of them.

---

## 5. `buildInsight` — VERDICT: WRONG DENOMINATOR

**What it prints.** `src/ui/components/WrapReport.jsx:761-776`:

> Across 24 ratings, **late evenings (9 onward)** run about **a shell below** your others.
> That's what nudges automatic placement.

**Evidence base.** `src/ui/report.js:388-411`. Each narratable column must clear
`observations >= interactionMinSamples` (**4**) and `|shells| >= 1`. So the evidence for
any individual claim is as few as **four** rated sessions in that bucket.

The printed number is `insight.sampleCount` — the model's **total** rating count. The two
are not the same denominator, and the sentence joins them: "Across 24 ratings, late
evenings run…" invites the reader to attach 24 to the evening claim. In the probe the
evening column had 4.

`buildInsight` **computes `observations` per column and the rendering site drops it** —
the value is right there in `insight.top[i].observations` and never printed. The fix is
already half-built.

**Minimum firing input.** `modelMaySpeak()` (≥ 10 ratings and positive held-out skill),
plus 4 samples in one bucket differing from its family mean by ≥ 0.25 of weight.

**Sample source.** `learning.inspect()`, trained via `retrain()` → `ratedSamples()` —
correct.

**Stale denominator?** Yes on the time axis: `learning.sampleCount` is all-time, so a
weekly report's "Across N ratings" can be dominated by months-old sessions. This is
defensible for a model-behaviour sentence (the model *is* trained on all of it) and I
have not flagged it as a separate defect.

### Probe output

```
I1 sampleCount = 24 skill = 0.9919195895244589 modelMaySpeak = true
I1 insight = {"cold":false,"sampleCount":24,"top":[
  {"label":"time:afternoon","text":"afternoons (2–5)","observations":20,"shells":1.445},
  {"label":"time:night","text":"late evenings (9 onward)","observations":4,"shells":-1.445}]}
I1 PRINTED: "Across 24 ratings, late evenings (9 onward) run about a shell below your others"
     <-- ACTUAL observations behind that column: 4
```

**Anti-vacuity check.** The probe deliberately made the two columns asymmetric (20
afternoon vs 4 evening) and printed `observations` for both. Had the rendering been
honest, the two lines would carry different denominators; they carry the same one (24).
`modelMaySpeak` and `skill` are printed rather than assumed, so the "cold" branch cannot
have silently swallowed the test — the insight object shows `cold: false` and a populated
`top`.

---

## 6. `steerBias` — `energyBalance` — VERDICT: THIN EVIDENCE

**What it prints.** `src/core/suggest.js:122`:

> You've been running down — something restful?

**Evidence base.** `energyBalance = Σ satisfaction.energy` over the recent pool, and the
test is `energyBalance < 0`. It is a **sum, not a mean**, so nine sessions rated neutral
and one rated draining gives −1 and fires. Ten ratings gate the pool; one rating decides
the verdict.

**Minimum firing input.** 10 rated samples whose energy values sum to −1 (e.g. nine 0s and
one −1). Proven at F4.

```
F4 nine "neutral" + ONE draining -> energyBalance = -1
   | biasFor(restful) = {"bias":0.35,"reason":"You've been running down — something restful?"}
```

Directionally this nudge is harmless — it suggests rest — so the P-1 damage is low. The
sentence is still an assertion about the user's state with n≈1 behind it.

### Probe (F) source excerpt

```js
// 9 demanding one-offs rated overall 5 / energy +1, plus ONE restorative rated overall 3
const sb = steerBias(s, D(10, 9, 0));
// then flip all nine to energy 0 and one to -1
```

```
F1 trained = true energyBalance = 10 restorativeFlat = true
F1 restorative samples behind that verdict = 1 of 10 rated
F1 biasFor(creative) = {"bias":0.7,"reason":"Rest's felt flat lately — a creative project?"}
F2 CONTROL restorative rated 5 -> restorativeFlat = false | biasFor(creative) = {"bias":0.35,"reason":"Nothing pressing — time for something you enjoy?"}
F3 CONTROL zero restorative samples -> restorativeFlat = false
```

**Anti-vacuity check for findings 4 and 6.** F2 changes exactly one number — the single
restorative session's `overall`, 3 → 5 — and `restorativeFlat` flips to false and the
reason string changes. That isolates the effect to that one rating, and rules out the
fixture's bucket/load setup being the cause. F3 removes the restorative sample entirely
and confirms `restAvg == null` short-circuits, so the `<= 3` comparison is genuinely
being reached in F1 rather than being skipped. F1 also prints `trained = true`, so the
cold-start gate is not silently returning `none` (which would have made every assertion
vacuous — the exact failure mode to watch for here).

---

## 7. `overpackCheck` — VERDICT: THIN EVIDENCE / WRONG DENOMINATOR

**What it prints.** `src/ui/components/OverpackNotice.jsx:20` — the one grid-side notice:

> This week is packed — breaks are compressed on 3 days.
> [Block some recovery time?]

**Evidence base.** `src/core/detectors.js:101-117`. Per day: `avgBreak = mean(dayGaps)`,
flagged when `avgBreak <= breaks.minimum × overpackBreakFactor` = `5 × 1.5` = **7.5
minutes**. Fires at `overpackDays: 3`.

`dayGaps` (`src/core/queries.js:102-114`) counts **only the gaps between consecutive
tasks** — the day's run-up and tail are excluded by design. That is right for "how
squeezed were your breaks" and wrong for "this week is packed". A day holding two
back-to-back one-hour tasks and nothing else has one gap of 0 minutes, an average break
of 0, and counts as packed. Three such days — six hours of work across an entire week —
produce "This week is packed".

The inverse is also true and shows the denominator is the wrong one: a day with a single
uninterrupted **twelve-hour** block has *no* gaps at all, `avgBreak = null`, and is never
packed. The genuinely full day is invisible; the nearly empty one is flagged.

**Minimum firing input.** Three days, each with exactly two adjacent tasks.

**Sample source.** `dayGaps` → `getTasksForWeek` — includes recurring occurrences.
Correct.

**Denominator statement.** The notice says "on 3 days" — it names its numerator and the
period. Better than most here. What it does not name is that "compressed" means the
*average* gap between adjacent items, which on a two-task day is a single number.

### Probe output

```
E1 threshold minutes = 7.5 (breaks.minimum × overpackBreakFactor)
E1 perDay avgBreak = [{"date":"mon","avgBreak":0},{"date":"tue","avgBreak":0},{"date":"wed","avgBreak":0},
                      {"date":"thu","avgBreak":null},...]
E1 packedDays = 3 overpacked = true
E1 SENTENCE => This week is packed — breaks are compressed on 3 days.
E1 scheduled hours on each "packed" day = 2
E2 CONTROL 30-min gaps -> packedDays = 0 overpacked = false
E3 CONTROL one 12-hour block/day -> packedDays = 0 avgBreaks = ,,,,,,
```

**Anti-vacuity check.** E2 moves the second task 30 minutes later and `packedDays` drops
to 0 — the flag tracks the gap, not the presence of two tasks. E3 is the control that
makes the finding non-trivial: three genuinely saturated 12-hour days print
`packedDays = 0` and seven `null` averages, so the detector is demonstrably measuring
something other than how full the week is.

---

## 8. `pinnedRatioNote` — VERDICT: WRONG DENOMINATOR (mild)

**What it prints.** `src/ui/report.js:278-281`:

> **100% of this week was pinned**
> Pinned time is time the scheduler leaves alone — that may be exactly what you wanted.

**Evidence base.** `weekLoad.pinnedRatio > 0.5`, where
`pinnedRatio = pinnedMin / scheduledMin` (`src/core/queries.js:61`). The denominator is
**scheduled minutes**, but the headline says "of this week", which a reader will take to
mean the week's hours. A single pinned 30-minute dentist appointment in an otherwise
empty week reads "100% of this week was pinned".

`capacityMin` is computed in the same function and is the denominator the sentence
implies. Nothing in the headline lets the reader tell which was used.

**Minimum firing input.** One pinned task and nothing else scheduled.

**Sample source.** `getWeekLoad` → `getTasksForWeek` — **includes recurring occurrence
minutes**, verified: a 1-hour pinned one-off against a 3-hour recurring lecture gave
`pinnedRatio = 0.25` with `scheduledMin = 240`. Correct.

**P-1.** The copy is careful ("that may be exactly what you wanted") and there is no
action attached, so the harm is a confusing number rather than a verdict.

### Probe output

```
D1 scheduled minutes in the week = 30
D1 pinned-ratio suggestions = 1
D1 headline = 100% of this week was pinned
D2 CONTROL 50/50 -> pinned-ratio suggestions = 0

K1 pinnedRatio = 0.25 | scheduledMin = 240
K1 pinned-ratio suggestions = 0
```

**Anti-vacuity check.** D2 adds one equal unpinned block, putting the ratio at exactly
0.5, and the suggestion disappears — so the trigger is the ratio crossing
`pinnedRatioNote: 0.5`, not the mere presence of a pinned task. K1's `scheduledMin = 240`
is the arithmetic proof that the recurring occurrence's 180 minutes reached the
denominator; had occurrences been missed, the ratio would have printed 1.0 and fired.

---

## 9. `lastFinishedLoad` / the variety nudge — VERDICT: MISSES RECURRING

**This is a ninth instance of the `schedule.tasks` bug**, in a file whose other two
readers were fixed in the last pass.

`src/core/suggest.js:141-148`:

```js
function lastFinishedLoad(schedule, now) {
  let last = null;
  for (const t of schedule.tasks) {            // <-- not ratedSamples()
    if (t.completion === null || t.startTime.getTime() > now.getTime()) continue;
    ...
```

A completed recurring session lives in `parent.occurrenceData[date]` and is never in
`schedule.tasks`, so the "don't suggest the same kind of thing twice" penalty
(`varietyPenalty: 0.15`) never applies after a routine. `recentRated` two functions above
uses `ratedSamples()`; this one was not converted.

It prints no false sentence — the reasons array never mentions variety — so the damage is
a silently wrong ranking, not a wrong claim. That is why it ranks below the sentence-level
defects, but the mechanism is identical to the eight before it.

### Probe output — same workout, one-off vs recurring, nothing else changed

```
N1 one-off workout finished 10 min ago -> Read a chapter:1.000  Another workout:0.650
N2 ratedSamples sees the session = Workout/done
N2 schedule.tasks completed entries = (none)
N2 recurring workout finished 10 min ago -> Read a chapter:1.000  Another workout:0.800
N3 variety penalty applied in case 1?  true
```

`0.800 − 0.650 = 0.150` = `varietyPenalty` exactly.

**Anti-vacuity check.** The two cases are the same workout at the same time with the same
load vector and the same activity library; only the storage form differs. The probe prints
both sides of the door — `ratedSamples()` sees `Workout/done` while
`schedule.tasks` completed entries is `(none)` — so the missing penalty is attributable to
the store the function reads and not to a difference in the fixture's loads. And the delta
is numerically equal to the named constant, which rules out an incidental scoring shift.

---

## 10. `durationFitSuggestion` — residual: NO TIME WINDOW

Out of scope as the known defect, but the audit turned up an axis the denominator fix did
not cover. `sched.ratedSamples()` is unbounded in time and `buildSuggestions` filters only
by tag, so three sessions rated in **March** produce a suggestion in **September**, with a
sentence whose "3 of 3 rated gym sessions" is true but reads as this week's evidence:

```
J1 rated gym sessions THIS week = 0 | rated in March = 3
J1 duration-fit suggestions = 1
J1 headline = gym blocks may want to be shorter
J1 detail   = 3 of 3 rated gym sessions said the block ran long. Worth trying shorter next time.
J2 CONTROL tag absent this week -> duration-fit = 0
```

**Anti-vacuity check.** J2 removes the unrated September task carrying the `gym` tag and
the suggestion vanishes — confirming the tag loop is driven by `weekTasks` while the
*sample pool* is not, which is precisely the mismatch. The floor of
`answered.length < 3` is unchanged and remains, as stated in the brief, satisfiable by
2 of 3.

---

## Detectors judged SOUND

**`drainedToday` (`src/core/whatToDo.js:87`)** — "a lighter pick — you have been drained
today". Minimum evidence is one rating (`.some(... energy === -1 && sameDay)`), which is
thin, but the sentence claims only that a draining session happened today, and one did.
It reads `ratedSamples()`, so recurring sessions count. Verified at G1/G2: with the single
rating at `energy: 0` the reason disappears. No change recommended.

**`buildDeadlineBuffer` (`src/ui/report.js:423-469`)** — "3 came in later than the plan
aims for — about 6h clear of the deadline"; "Closest to the wire: X". States its own
count, names the target it is measured against, and the target is the same one
`bufferScore` optimises for (a fifth of the runway) rather than an invented constant.
Scoped to `weekTasks`. The only soft spot is that the runway is anchored at week start
because `Task` has no `createdAt`, which the code documents.

**`pref >= 0.6` → "you rate this kind of work well right now"
(`src/core/whatToDo.js:150`)** — gated on `modelMaySpeak()`, which is a held-out skill
test rather than a rating count. Correct gate.

---

## Thresholds at a glance

"Floor" = the refusal-to-speak gate. "Bar" = the ratio or count that then makes it fire.
"Min real input" = the smallest concrete input I confirmed by execution.

| Detector | Floor (gate) | Bar (trigger) | Min real input (proven) | Time-scoped? | Sample source | Verdict |
|---|---|---|---|---|---|---|
| `driftCheck` | none (`slice(-5)` of however many exist) | 4 of last 5 *moves*, each ≥30 min | **4 move-exceptions, ever** | **no** | `recurrence.exceptions` | WRONG DENOMINATOR |
| `starvationCheck` | none | `displaced + carried ≥ 3` (lifetime) | **1 task, counters = 3, any week, done or not** | **no** | `sched.tasks` (recurring can never fire) | WRONG DENOMINATOR |
| `skipStreakCheck` | occurrence must exist each week | 3 consecutive weeks all "skipped **or unrated**" | **3 weeks of sessions marked `done`** | yes (trailing 4 weeks) | `_expand` + `occurrenceData` | WRONG (false claim) |
| `pinnedRatioNote` | none | `pinnedMin / scheduledMin > 0.5` | **1 pinned 30-min task in an empty week** | yes (the week) | `getTasksForWeek` ✓ | WRONG DENOMINATOR (mild) |
| `overpackCheck` | day needs ≥2 tasks to have a gap | 3 days with mean gap ≤ 7.5 min | **3 days × 2 adjacent tasks (6 h/week)** | yes (the week) | `getTasksForWeek` ✓ | THIN / WRONG DENOMINATOR |
| `durationFitSuggestion` | `answered.length < 3` | ≥60% of answers agree | **2 of 3** (unchanged); pool is all-time | **no** | `ratedSamples()` ✓ | THIN + stale pool |
| `buildInsight` | `modelMaySpeak()` (≥10 ratings **and** skill > 0) | column `observations ≥ 4` **and** `\|shells\| ≥ 1` | **4 samples in one bucket** | no (all-time, defensible) | `ratedSamples()` ✓ | WRONG DENOMINATOR (prints total, not per-claim) |
| `steerBias` energyBalance | `recent.length ≥ 10` | `Σ energy < 0` | **1 draining rating among 10** | yes (14 days or last 10) | `ratedSamples()` ✓ | THIN EVIDENCE |
| `steerBias` restorativeFlat | `recent.length ≥ 10` (**pool-wide, not restorative-wide**) | `mean(restorative overall) ≤ 3` | **1 restorative rating of 3** | yes | `ratedSamples()` ✓ | THIN EVIDENCE |
| `lastFinishedLoad` (variety) | none | last completed thing shares dominant axis | 1 completed task | no | **`sched.tasks`** ✗ | MISSES RECURRING |
| `drainedToday` (whatToDo) | none | any rating today with `energy === -1` | 1 rating | yes (today) | `ratedSamples()` ✓ | SOUND |
| `buildDeadlineBuffer` | needs ≥1 deadlined done task | `buffer < runway/5` | 1 task | yes (the week) | `weekTasks` ✓ | SOUND |

---

## What I could not test

- **`applySuggestion` outcomes.** I confirmed which suggestions *fire* but did not run
  the apply/letgo paths, so I cannot say what "Pin it next week" does to an
  already-completed task (`report.js:299`). Worth a follow-up — a finished task being
  pinned into next week would compound finding 3.
- **Live rendering.** Every sentence above is reconstructed from the JSX at the
  rendering site plus the object the builder returns; I did not mount `WrapReport.jsx`.
  The interpolations are simple template literals so I am confident in the strings, but
  the wording around them (surrounding prose, punctuation) I read rather than rendered.
  Per the project's own standard, a browser pass on the wrap report would confirm the
  final copy.
- **`buildInsight` at the true minimum.** My probe reached `observations = 4` with a
  24-rating fixture. I did not construct the absolute minimum (10 ratings with a 4-sample
  bucket clearing the 1-shell threshold *and* positive held-out skill), because skill is
  a cross-validated quantity and a 10-sample fixture is fragile. The 4-observation floor
  is read from `interactionMinSamples` and confirmed by the `observations: 4` column
  actually being narrated.
- **`getSatisfactionMatrix` / `getBreakCompression` / `buildPatternDiff` /
  `buildDayStrips` / `buildRoutines`.** These are stat tables, not claims — they render
  numbers the user can trace to their own entries and make no assertion about the user.
  I checked that none of them contains a threshold or a verdict word, but did not probe
  their arithmetic; that is a different audit.
- **`overpackCheck`'s dismissal lifecycle.** The notice is dismissible "until the next
  full autoSchedule" per its own comment. I did not test whether a re-optimise re-raises
  it on unchanged data, which would turn finding 7 into repeated nagging.
