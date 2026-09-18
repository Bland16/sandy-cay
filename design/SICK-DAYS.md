# Sick days — a fact about a day that protects the learning

**Session 9, 2026-09-18.** Status: **SPEC — nothing built.** Every decision below
is the user's, taken in conversation on 2026-09-18. The evidence is from their
real schedule export, read once and anonymised (this repo is public).

A sick day is not a holiday, not a blocked day, and not a light day. It is a day
whose **absence of data is itself the distortion** — and the app currently cannot
tell it apart from a day you simply had little on.

---

## 1. What happens today, proven

From the user's own export, completed items per day:

```
30 Aug – 14 Sep     7–11 per day      <- a working fortnight
15 Sep               2
16 Sep               2
17 Sep               2
18 Sep               3                <- the export was taken here
```

**The damage is not skipping. It is absence.** Those four days carry a clean
completion record — two of two done — so nothing in the app registers a problem:
no skip streak, no starvation, no carry-over, no warning. The user stopped
*putting work in*, and to every detector that reads like a quiet week.

In their words: *"I will not schedule adequately on a sick day. This schedule
requires an active edit and rating system, I barely open the schedule."*

### 1.1 And it is steering the app right now

`steerBias` (`suggest.js`) tunes every activity suggestion from the **ten most
recent ratings**. At the moment of the export, seven of those ten fall inside the
sick stretch, three of them carrying `energy: -1`. Measured:

```
energyBalance: -3
  restful activity    bias = +0.350   "You've been running down — something restful?"
  demanding activity  bias =  0.000
  creative            bias =  0.000
  social              bias =  0.000
```

**The hole feeds itself.** Those ratings leave the window only when ten newer
ones replace them, and generating ten new ratings is exactly what a person who
has stopped opening the app cannot do. So the app will go on recommending rest
through the recovery and out the other side, with nothing to stop it.

That is the case for this feature, and it is also why the recovery tail in §4 is
**bounded and explicit** rather than left to emerge from a sliding window.

---

## 2. The model — a fourth `kind` of day note

```js
dayNote = { id, from, to, label, kind: 'sick', tags, source, recurrence }
```

**A sick day is a `DayNote` with `kind: 'sick'`.** The user's call, stated
plainly: *"kind it is not a tag."*

Everything `DayNote` already provides is what a sick day needs: an inclusive
`from`/`to` range, so a four-day illness is **one note**, not four; string dates
that cannot be misread as UTC midnight; and a home in the Cabana beside the other
notes.

### 2.1 This AMENDS `DAY-NOTES.md` D-1 and the `kind` contract

Two written rules give way here, and neither should be edited quietly:

- **`DayNote.js` says `kind` is "colour and icon only, no behaviour."** A sick day
  has behaviour — it removes a day from the evidence pool. The rule is amended,
  not evaded: `kind` may carry behaviour, and `'sick'` is the first and currently
  only kind that does.
- **D-1 says a note NEVER tints the day**, because a tint is reserved for a real
  scheduling state (blocked). A sick day tints. The user's call: *"Marking sick
  should just shade it maybe grey or an olive green."*

The tint is **olive green** (resolved 2026-09-18, D-3). Explicitly **not coral**:
P-1 reserves the warning colour for scheduling physics, and being ill is not a
scheduling problem. Nothing about the shading is a judgement. The exact value is
picked against the real `styles.css` palette in both light and dark, and must
clear AA against the day header's text.

---

## 3. What it excludes, and what it does not

**Excluded entirely from the learning — not down-weighted.** The user's reasoning
is the justification and it is stronger than a weighting argument: on a sick day
they barely open the app, so the data is not noisy-but-real, it is *absent*. A
down-weighted sample still asserts that the day is evidence of something.

| Surface | Sick day counts? |
|---|---|
| `Schedule#ratedSamples()` — the one door into the evidence pool | **no** |
| `retrain` / the preference model | **no** (it reads the door) |
| `energyCalibration` / `learnedCapacity` | **no** (they read the door) |
| `steerBias`'s ten-most-recent window | **no** (it reads the door) |
| the wrap report's counts, hours and statistics | **YES — unchanged** |

**The report keeps it.** The user's call: *"Not from week report."* This follows
`DAY-NOTES.md` D-4 exactly — a report states what the week contained and stops.
Removing the day's hours would make the week's arithmetic wrong, and a week that
silently omits four days is a report lying by subtraction. The report may state
the fact (*"3 days marked sick"*) and must not draw the conclusion (*"you did
less because you were ill"*). **A fact explains; a story excuses.**

### 3.1 The filter goes at the one door, and is evaluated at READ time

`ratedSamples()` is already the single door — its own header records that it
exists because two consumers each walked `this.tasks` and one of them was
forgotten. The sick filter goes **there and nowhere else**.

**Read time, not write time.** Marking a day sick must not edit, clear or delete
any rating. The exclusion is recomputed on every read, which is what makes it
**retroactive and reversible** — the user's requirement: mark yesterday sick and
its ratings stop counting; unmark it and they count again, unharmed.

**The audit must find every consumer before this is built.** This repo has
shipped the "second reader I forgot" bug at least three times (the `ratedSamples`
door exists because of it). **That audit is now done** — see
`design/AUDIT-UNMARKED-WORK.md` and the enumeration below, measured 2026-09-18.

### 3.2 What the door does NOT cover — measured, not assumed

A filter at `ratedSamples()` correctly reaches every surface in §3's table:
`retrain`, `energyCalibration`, `learnedCapacity`, `steerBias`, `whatToDo`'s
rest-boost, and the report's duration-fit finding. **These bypass it and still
make an evidence claim:**

| Bypasses the door | What it would still count | Call |
|---|---|---|
| `getSatisfactionMatrix` / `getTagBreakdown` | per-tag felt-quality, read off the grid | **leave unfiltered — §3 keeps sick days in the report.** But the tag×time chart is nearer "learning" than "hours", so this is a **decision, not an oversight** |
| `driftCheck` / `skipStreakCheck` | sick-day sessions | measured: all 9 of the user's patterns currently return `drift:false, skipStreak:0`, because "an unrated occurrence ends the streak" already protects an **absence-shaped** window. An **explicitly skipped** sick day would still feed the streak |
| `suggest.js#lastFinishedLoad`, `priorityPressure` | the sick stretch, steering the variety nudge | **must be fixed** — routing `lastFinishedLoad` through the door closes this and TODO E-5 at once |
| `activityList.js#activityUsage` | sick-day instantiations in "most used" | minor; decide explicitly |
| the battery (`reserveAt`, `energyBudget`, `energyTrajectory`, `dipIfPlaced`) | a sick day's blocks | **leave unfiltered — they still drained you.** Stated here because it was previously unstated |

**⚠️ `learnedCapacity` is two-legged, and the door is enough.** Its rated-days
map comes from `ratedSamples()` (filtered), while its per-day reserve walk uses
`getTasksForDay` (unfiltered). Filtering the door alone is **sufficient**, because
a sick day never enters `ratedDays` in the first place and so its reserve walk is
never reached. **Do not "fix" the second leg** — doing so changes what the
function means without changing what it currently returns.

---

## 4. The recovery tail — two days, 60% then 80%

> *"If I say the current day is a sick day use it to inform today and the next
> two-three days for scheduling purposes."* — then settled: **two days, counted
> from the LAST sick day.**

A four-day illness eases the two days **after it ends**, not two days after it
began. While still sick, the tail has not started.

| day | learned capacity scaled to |
|---|---|
| any day marked sick | — (excluded from evidence entirely) |
| first day after the last sick day | **60%** |
| second day after | **80%** |
| third day onward | 100% — normal |

**The mechanism is a scale on `learnedCapacity`, not a rule.** That is the whole
design: a reduced ceiling flows through `energyBudget` -> `arrivalDepletion` ->
the `w.energy` term in slot scoring, so new work drifts off the recovery days on
its own, through arithmetic that already exists. **No placement rule fires, no
day is closed, nothing is refused.** It is the same "weight, not a rule" posture
SPEC §2.1 took for the deadline buffer, and for the same reason: an overloaded
week can override it with no special-case logic.

**Ratings made during the tail still count.** Only days actually marked sick
leave the pool. A recovery day is a real day you lived and rated.

**`learnedCapacity` returns `null` until calibrated, and a null axis must stay
null.** Scaling must never turn an unearned axis into a number — `60% of null` is
null, not 0, and not the config prior. P-2 is not suspended by illness.

### 4.1 Where the scale is applied — and why it is NOT `learnedCapacity` alone

**Scale inside `capOf`, after the prior fallback, not on `learnedCapacity`'s
return.** `arrivalDepletionFor` falls back to `capacityPrior` per axis when the
learned value is null, so a scale applied only to the learned number would leave
unlearned axes running at full capacity while their learned neighbours were
reduced — a day that is 60% recovered on mental and 100% on creative, for no
reason a user could ever discover.

**Capacity is a DENOMINATOR, and the scale must not also become a numerator.**
`arrivalDepletionFor` computes `spent / capacity`, so reducing capacity raises
depletion, which correctly makes spending work look worse and restorative work
look better on a recovery day. Implementing the tail as a *load multiplier*
instead would double-count against `energyBudget`, which compares the day's dip
to capacity directly — the dip would grow and the ceiling would shrink for the
same illness. One scalar, one place.

### 4.2 ⚠️ The tail is INERT in the activity picker until the scorer is fixed

Found 2026-09-18 while speccing the What-To-Do work, and it is a real hole in
this document rather than a note about another one.

`suggestActivities` never reads capacity, `energyBudget`, `arrivalDepletionFor`
or `dipIfPlaced`. Its only energy input is `reserveAt(now)` reduced to **the sign
of the single worst axis**. Every load-derived term in its score is a predicate
on sign or argmax — nothing multiplies by a magnitude. Measured: giving every
activity a distinct load leaves the number of distinct scores within a bucket at
**one**, and the top five come out alphabetical.

So the recovery tail, built exactly as §4 specifies, would change **grid
placement** (which routes through `w.energy` and does read magnitudes) and would
change the activity picker's suggestions by **exactly nothing** — on the two days
the feature exists for.

**Consequence for the build order in §9:** the tail is not "done" when the scale
lands. Either the scorer is fixed first, or §9 step 4 ships with this written on
it, because a sick day that visibly does nothing to what the app suggests is
worse than no feature — it teaches the user the setting is decorative.

### 4.3 ⚠️ THE SCALE SATURATES `arrivalDepletion`, AND THAT BREAKS §4 AS WRITTEN

Measured 2026-09-18 against the real save, at 19:00 on a normal Friday. Reserve
spent against learned capacity:

```
axis        spent   cap(100%)  frac      cap(60%)  frac      cap(80%)  frac
mental       5.04     5.37     0.937       3.22    1.000 SAT   4.30    1.000 SAT
physical     0.50     7.31     0.068       4.39    0.114       5.85    0.085
social       8.51    11.84     0.719       7.10    1.000 SAT   9.47    0.898
creative     2.33     2.17     1.000 SAT   1.30    1.000 SAT   1.73    1.000 SAT

saturated axes:   at 100% → 1 of 4     at 80% → 2 of 4     at 60% → 3 of 4
```

`arrivalDepletionFor` computes `frac = Math.min(1, spent / capacity)`. **Once an
axis saturates, `frac` is pinned at 1 and that axis contributes an identical
constant to every candidate slot** — so it stops discriminating. A term that is
constant across candidates cannot move the arg-max; this is the same reasoning
that removed `moveCount` and `placedByUser` from the learning model (SPEC §5).

So §4's mechanism, applied naively, **inverts its own purpose**: on the first
recovery day it pins three of four axes, leaving placement steered almost
entirely by `physical` — the one axis this user barely spends. The energy term
goes progressively *blind* exactly on the days the feature exists to protect.

**Note the first column.** `creative` is saturated at **full** capacity, today,
with no illness involved. That is a pre-existing defect in the energy term, not
something the sick day introduces — the sick day only makes it the normal case
instead of the edge case. It belongs in the audit (`AUDIT-REAL-DATA.md` A-Q4) and
must be fixed or accounted for **before** the tail ships, or the tail will be
blamed for it.

**This is unresolved.** Three candidate directions, none chosen:

- **Soft saturation** — replace `min(1, x)` with `tanh(x)` or similar, so an axis
  past its ceiling still ranks "further past" above "just past". Changes
  user-visible placement for everyone, sick or not; needs its own evaluation.
- **Scale the numerator instead** — but §4.1 rejects this: it double-counts
  against `energyBudget`, which compares dip to capacity directly.
- **Cap the scale by headroom** — never scale an axis below what is already
  spent, so the tail can never pin an axis that was not already pinned. Cheapest
  and most conservative; weakens the feature on precisely the busiest days.

**D-4 (new, open): which of the three?** This must be settled before §9 step 4 is
built. Building the tail on a saturating denominator ships a feature that
measurably does the opposite of what this document promises.

---

## 5. What it deliberately does NOT do

**It does not offer to clear or block the day.** The user's call, and the reason
is theirs: *"I can choose to clear the week — the offer would annoy me since it
infringes on autonomy. Sick day is sick day."*

There is already a path for clearing a day (day `...` menu -> Clear this day,
which `UI-CONTROL-MAP.md` §3A literally calls "sick Tuesday, clear it"). It stays
exactly where it is, reached deliberately. Marking yourself ill does not put a
proposition on the screen.

This is the same separation `DAY-NOTES.md` §3 draws for holidays — **the fact and
the decision stay one click apart** — applied to a case where the user has stated
the preference outright.

**It does not consume time, block placement, or refuse a drop.** A sick day is not
a blocked day. You may put whatever you like on it, including retroactively.

---

## 6. Marking one

**Anything up to and including TOMORROW. Later dates are refused** (resolved
2026-09-18, D-1). *"If I'm marking it it would be in the past or in the
current."* You do not schedule an illness a week out, and a date further ahead
than tomorrow is a typo far more often than an intention — so the editor rejects
it rather than accepting a state whose recovery tail nobody has specified.

Tomorrow is allowed because the honest cases are real and immediate: marking it
late at night when you already know, or knowing you will be out for a procedure
the next day. The rule is a **validation** on the note's `from`, not a placement
constraint; nothing about a sick day ever constrains the grid (§5).

Reached from the day header's quick-add and from the Cabana's day-notes card,
both of which already exist. A sick note needs a range and nothing else; the
label defaults to "Sick" and is editable, because "flu", "migraine" and "food
poisoning" are things a person may want to see in their own record.

---

## 7. What this does NOT fix, and must not be described as fixing

**`steerBias`'s window is a separate defect.** It steers from the ten most recent
ratings whenever ten exist inside the 56-day window. Excluding sick days removes
the *worst* case, but a user who rates little for any other reason — travel, a
hard week, simple disengagement — still hands the picker a tiny, stale sample
that speaks with full confidence. A floor on how *recent* those ten must be, or
a widening of the window when they are sparse, is its own decision and is not
taken here. Recorded so nobody reads this document as having closed it.

---

## 8. Open decisions

- **D-1. RESOLVED 2026-09-18 — up to and including tomorrow; later is refused.**
  See §6.
- **D-2. RESOLVED 2026-09-18 — YES, the report names it.** A plain count in the
  week's facts: *"3 days marked sick (Tue–Thu)"*. D-4's line is the boundary and
  it is not optional — **state the day, state the count, stop.** *"You did less
  because you were ill"* is the report doing the user's thinking for them, and
  *"understandably quiet week"* is sympathy; both are forbidden. The sentence
  exists so an unusual week's numbers are legible, not so they are excused.
- **D-3. RESOLVED 2026-09-18 — olive green.** See §2.1.

---

## 9. Build order

1. **`kind: 'sick'` on `DayNote`** + a `Schedule#isDaySick(date)` reader. Data
   only, provable by probe with no UI.
2. **The audit** — every consumer of lived data, listed and tested, before the
   filter goes in. §3.1 is the whole risk of this feature.
3. **The exclusion at `ratedSamples()`**, with a regression test that is reverted
   and watched to fail.
4. **The recovery tail** on `learnedCapacity`, with the null-axis guard.
5. **The tint and the marking UI.**
6. **The report's fact line**, if D-2 says yes.
