# Placement is energy-blind — `balance` measures the wrong kind of full

**Session 8, 2026-08-13. Status: SPEC, one decision open.** Found by probe after
the user asked whether project placement had been tested on "weeks with a heavy
mental overload at the front." It had not. It is, now, and the answer is no.

---

## 1. The finding

Fourteen days, **identical time occupancy** — every day carries exactly one
two-hour block at 09:00. Days 0–3 are mentally brutal (`load.mental` +2/hour);
days 4–13 are mentally free (0/hour). Then a 20-hour, five-sitting project is
placed across the fortnight.

```
  day         d+0   d+1   d+2   d+3   d+4   d+5   d+6   d+7  …  d+13
  before     -4.0  -4.0  -4.0  -4.0   0.0   0.0   0.0   0.0  …   0.0
  after     -12.0 -12.0 -12.0 -12.0   0.0  -8.0   0.0   0.0  …   0.0
  project    240m  240m  240m  240m     .  240m     .     .  …      .

  minutes placed on the 4 mentally-heavy days:  960
  minutes placed on the 10 mentally-light days: 240
  deepest dip anywhere BEFORE: -4.0   AFTER: -12.0
```

**Eighty percent of the work landed on the four worst days**, tripling their
depletion, while ten free days took one sitting between them. The engine had the
numbers the whole time: `loadForTask` returns `{mental: 2, …}` for these chunks,
and `energyTrajectory` reports the dip per day. Nothing in the placement path
asks.

**Confirmed by grep, not inferred:** `scoring.js`, `placement.js`,
`autoSchedule.js` and `gaps.js` contain no reference to `energy`, `loadForTask`
or `reserve`. The only matches are the words "reserves" and "carry" in prose
comments.

## 2. Why — `balance` is the right idea measuring the wrong quantity

`scoring.js` already has a term for *don't pile onto a loaded day*:

```
balance = 1 − dayFillRatioAfterPlacement
```

It works, and it is why the project spread across five days rather than three in
the fixture above. But `dayFillRatio` is **minutes occupied ÷ minutes
available** — it counts *time*, and a day with two hours of the hardest work you
do reads as 83% empty. So the scorer confidently rates a mentally-shattered
Tuesday as one of the emptiest days of the fortnight, because by its measure it
is.

**This is the same shape as the deadline-buffer finding** (`WEEKLY-PLANNING`
§4.4): `report.js#buildDeadlineBuffer` measured finish-early slack for months
while nothing optimised for it. Here `energy.js` computes a per-axis battery, a
deepest dip and an over-budget flag, the Cabana renders a card from it — and
placement, the one thing that could act on it, never reads it. **The app reports
on a quality it does not optimise for**, twice.

## 3. This is NOT the spread weight, and the difference is the whole argument

§4.5 rejected a `spread` scoring weight on evidence, so a new scoring term needs
to answer why it is different rather than the same mistake twice.

**`spread` failed because it is a property of a RELATIONSHIP.** "Don't put these
five sittings on consecutive days" is a fact about siblings, and the scorer sees
one task at a time with no idea which others share a parent. A global term
therefore imposed the project's medicine on unrelated tasks and drifted ordinary
work later for no benefit.

**Energy is a property of a SLOT.** "How depleted is this day, and how much worse
does this task make it" is answerable for a single task against a single day —
exactly like `dayFillAfter`, which the scorer already computes per candidate
slot. There is no sibling knowledge required and no cross-task inference. It is
structurally the kind of thing the scorer *can* know.

That is the test any future scoring term should have to pass: **relationship →
generation time; slot property → the scorer.**

## 4. P-2 — it must compare, never judge

The obvious form, "don't exceed the day's mental capacity", is forbidden:
`learnedCapacity()` returns `null` until calibrated and the prior stays invisible
until then (`energy.js:125`), precisely so the app never states a ceiling it has
not earned. A placement rule keyed to a capacity would smuggle that ceiling in
through the back door and *act* on it, which is worse than displaying it.

**So the term is purely comparative: among the slots this task could take,
prefer the one that leaves the shallower dip.** No capacity, no threshold, no
constant — the same standing as `balance`, which also has no notion of "too
full", only "fuller than that one". Ranking days against each other is
arithmetic over the user's own authored loads; ranking them against a number the
app invented is not.

Two consequences worth stating:

- It is **honest from day one**, needing no calibration and no ratings, because
  load comes from buckets the user authored. (And it is **inert** for anyone
  whose buckets carry no load — which is exactly why shipping `STARTER_BUCKETS`
  *with* load values mattered: a neutral bucket computes to zero and switches
  nothing on.)
- It **never says the day is too much.** It picks the better of two days and
  stays quiet. The over-budget language stays where it already lives, in the
  card and the report, behind calibration.

## 5. Proposed: a `reserve` weight

```
reserve = 1 − ( depthAfterPlacement / worstDepthAmongCandidates )
```

- Computed like `balance`: the dip the day would have **after** this task lands,
  so a task's own load is counted where it falls. A mentally heavy task deepens
  whatever day it goes on; the term picks the day where that hurts least.
- Normalised **against the other candidate days for this task**, not against a
  capacity. Pure ranking, no invented denominator. Where every candidate day is
  equally deep the term is flat and cannot skew anything — the same
  "a constant cannot change a ranking" property `bufferScore` relies on.
- Renormalised with the other weights by `normalizeWeights`, so it is a
  preference an urgent week can outvote — the mechanism that let the `buffer`
  weight avoid special-case logic.
- **Multi-axis:** a task spends on the axes its tags spend on. Compare per axis
  and take the worst affected, so a physically-heavy task is not waved onto a day
  you are physically wrecked because your *mental* reserve is fine.

### The open decision — D-1

**Weight, generation rule, or both?**

- **As a weight** it improves *every* placement in the app, including ordinary
  tasks and the ones you drop by hand into a re-optimise. It is also a change to
  every placement in the app, which is the thing this codebase has twice got
  wrong (the inert buffer, the rejected spread).
- **As a generation rule** — §4.1.1 step 5 choosing mentally-light days when it
  spreads — it is contained entirely inside the repeating-projects feature, ships
  with it, and cannot regress anything else. But it leaves every non-project task
  as blind as today.

**My lean: build it in step 5 first, as a weight second.** Step 5 already picks
days and already has the schedule in hand, so the cost is small and the blast
radius is the feature being built. Then, with that shipped and lived with, decide
whether the general weight earns its risk. Shipping both at once repeats the
mistake of not being able to tell which change did what.

**Whichever it is, prove it by printing placements.** 573 tests passed with the
rejected `spread` change and 573 without it; the suite cannot see placement
quality and has never been able to.

## 6. Test plan

- **The regression this doc exists for:** the fixture above — identical
  occupancy, opposite load — must stop putting 80% of the work on the heavy days.
- A task with **no** load (no matching bucket, or a neutral one) is placed
  byte-identically to today. The term must be provably inert with no data.
- A **physically** heavy task avoids physically-depleted days even when the
  mental axis is untouched (the per-axis rule of §5).
- Equal-depth candidate days leave the ranking unchanged — flat term, no skew.
- An urgent deadline still overrides: a task due tomorrow lands tomorrow even if
  tomorrow is the worst day of the fortnight. It is a preference, not a rule.
- **No capacity appears anywhere in the output.** No "too much", no over-budget
  verdict, no coral — the scheduler ranks and stays quiet (P-1, P-2).

## 7. What this does NOT do

- **It does not schedule rest**, propose recovery, or move anything on its own.
  It changes which of several legal slots is chosen, nothing else.
- **It does not need the learning module** and is unaffected by the ratings bug
  in `RATINGS-AND-LEARNING.md` — load is authored, not learned. It is the one
  energy-shaped improvement available *before* that fix lands.
- **It does not touch the energy card, the budget, or calibration.** Those stay
  exactly as they are, behind their honest gate.
