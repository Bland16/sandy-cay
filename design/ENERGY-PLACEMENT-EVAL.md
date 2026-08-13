# The five candidates, evaluated — every number below was run

**Session 8, 2026-08-13.** Evaluates `design/ENERGY-PLACEMENT-CANDIDATES.md`.
All five were implemented as day-choice rules, run over four fixtures, and scored.
Sizing was held constant at 5 × 240m so the **only** variable is which days get
chosen. Probe: `probe-energy-candidates.mjs`.

## Recommendation

> ### Build **H4 — relative depth (C1) for energy, GATED on the task having any load, plus sibling spacing for clustering.**

```
score(day) =  ( |L(t)| > 0 ? 1 − |dip⁺(day)| / max|dip⁺| over candidates : 0 )   ← energy
            + ( min gap to the sittings ALREADY CHOSEN ) / |R*|                  ← clustering
```

It clears both bars at once — **0 minutes on the depleted days and a consecutive
streak of 1** — and every individual candidate fails one or the other.

**The gate was added 2026-08-13** after the user asked what task actually has no
energy measure. If a task carries no load it cannot make any day worse, so it
should have **no opinion**, rather than inheriting a preference from the day's
own state. Ungated (H3) a characterless task still gets steered; gated (H4) it
does not, and every loaded case is byte-identical:

| | acceptance | all-axes-deep | physical front | zero-load task |
|---|---|---|---|---|
| H3 ungated | 4,6,8,10,13 · streak 1 | 0,3,6,9,13 | 2/4 | **4,6,8,10,13** |
| **H4 gated** | 4,6,8,10,13 · streak 1 | 0,3,6,9,13 | 2/4 | **0,3,6,9,13** |

**This dissolves D-2** — there is nothing left to decide, and it is one line.

### And what *does* have no energy measure? Three cases, two of them common

The premise is worth stating because it is easy to assume tags imply energy:

1. **No tags at all.** `addFlexible({title})` is 7A's defaults cascade and lands
   with `tags: []`. Quick capture is the app's flagship case.
2. **Tags that match no bucket** — `energy.js:35` returns `zeroLoad()`. This is
   the **default state of every new tag**: `ACTIVITY-LIBRARY.md` has a new tag
   land in "Unbucketed" as *"an invitation to sort it, never a forced step,
   never a nag."*
3. **All matching buckets neutral.** A user-created bucket defaults to load 0
   (RECONCILIATION P-2); only `STARTER_BUCKETS` ships values.

So **a tag carries energy only once it is in a bucket that has load**, and the
app deliberately never forces that. The failure at full scale is already on
record — a real user found with 16 tags and 0 buckets, with the entire energy
model silently inert. The gate means that user's placement is simply unchanged
rather than subtly wrong.

## The acceptance table

Front-loaded mental fixture: identical time occupancy every day, days 0–3 at
`dip` −4.0, days 4–13 at 0.0. The shipped placer puts **960 of 1200 minutes** on
days 0–3.

| rule | days chosen | minutes on the depleted front | streak |
|---|---|---|---|
| C1 relative depth | 4,5,6,7,8 | **0** | 5 |
| C2 marginal | 0,1,2,3,4 | **960** ❌ | 5 |
| C3 reserve at start | 4,5,6,7,8 | **0** | 5 |
| C4 complementarity | 4,5,6,7,8 | **0** | 5 |
| C5 recovery spacing | 0,5,8,10,13 | 240 | **1** |
| H1 = C1 + C5 | 4,5,8,10,13 | **0** | 2 |
| H2 = C1×C4 + C5 | 4,5,8,10,13 | **0** | 2 |
| **H3 = C1 + sibling spread** | **4,6,8,10,13** | **0** | **1** |

## What the run settled

**1. C2 is dead, exactly as predicted — and it fails by reproducing the bug.**
It chose days 0,1,2,3,4: 960 minutes on the worst days, the shipped behaviour to
the minute. The battery is additive within a day, so the *marginal* cost of a
sitting is identical wherever it lands (−4 → −12 and 0 → −8 are both a deepening
of 8) and the term is a constant. A constant cannot change a ranking. **Reject.**

**2. C1, C3 and C4 all fix energy and all re-create clustering.** Each put zero
minutes on the depleted days — and then chose **five consecutive days**. The
mechanism is worth stating because it will recur: once a term has excluded the
bad days it is *flat* across the rest, and a flat term hands the decision back to
the tie-break, which is earliest-first. **An energy rule alone converts an energy
problem into a clustering problem.**

**3. C5 alone breaks the streak but tolerates the worst day**, putting 240
minutes on day 0. Worse, for a task carrying no load it chose days 9–13 — the far
end of the runway, straight into the deadline and against the `buffer` weight.
The cause is a silent default: C5 ranks days by spend on the task's *dominant
axis*, and a zero-load task has no dominant axis, so the implementation picked
the first one alphabetically and gave a confident, arbitrary answer. **That is
the class of silent default this project has been bitten by before.**

**4. The winning insight is that the two problems are orthogonal, and H1/H2
conflated them.** Both hybrids measured spacing against *energy-heavy days*,
which entangles clustering with load and only reached streak 2. Clustering is a
fact about **siblings** — five sittings of one thing, in a row — and has nothing
to do with energy. Measure it against the sittings already chosen and it drops to
streak 1, the arbitrary-axis bug disappears, and the energy term is free to be
purely about the day. **Two concerns, two inputs, one score.**

**5. When every day is equally bad, only spacing still discriminates.** On a
fortnight deep on every axis, C1/C3/C4 all went flat → 0,1,2,3,4 → streak 5;
everything containing a spacing term gave streak 1. This is a strong argument for
spacing being **always on**, independent of whether energy has anything to say.

**6. The per-axis rule is validated.** Against a front that is *physically*
hammered but mentally free, C1/C3/C4 correctly **used** those days for mental
work (4 of 4). A naive "avoid the busy days" rule gets this wrong; comparing per
axis gets it right. Keep it.

## Corrections to the candidates document

- **Its objection to C4 was wrong.** It predicted C4 would uniquely "approve a day
  that is catastrophic on every axis". C1 and C3 approve it too — all three go
  flat when every candidate is equally deep. That is not a C4 weakness, it is a
  property of every comparative energy term, and it is why spacing has to exist.
- **C4's real distinguishing property is the null case.** It is the only candidate
  keyed to the *interaction* between task and day rather than to the day alone,
  so it is the only one that leaves a characterless task untouched. That is a
  point in its favour that the document did not identify.
- **C3 is not disproven — it is untested.** It gave results identical to C1 on all
  four fixtures, because none of them varies load *within* a day. Its whole claim
  is time-of-day sensitivity, and no fixture here could see it. Building the
  uneven-day fixture is the one piece of evaluation still owed.
- **My own hybrids H1/H2 were badly formed**, for the reason in finding 4. H2 in
  particular was designed as a "gate" and does not gate: complementarity returns
  1 (neutral) for a zero-load task, so it multiplies the depth term straight
  through instead of switching it off.

## Inertness — the requirement was two requirements

The candidates document asked that a task with no load be placed "byte-identically
to today". The run shows that was conflating two things:

| | inert? |
|---|---|
| **The energy term**, when no buckets carry load at all | **Yes, provably** — every dip is 0, the term is flat, and a flat term cannot skew a ranking. *(Follows from the arithmetic; must still be locked by a test.)* |
| **The energy term**, when the *task* has no load but the *days* do | **No** — H3 still steers a characterless task away from wrecked days. Defensible: adding anything to a brutal day makes it worse. But it is a behaviour change and should be a decision, not a side effect. |
| **The spacing term**, ever | **No, and it should not be.** Five consecutive evenings of anything is the harm; it is load-independent by design. |

## Open, and needing a decision

- **D-1 (unchanged): weight or generation rule?** Everything above was run at
  generation time. C3 is slot-shaped and could not live in a day chooser at all,
  which is another reason to settle C3's fixture before choosing.

  **Scope, stated plainly so it is not assumed away:** v1 lives in §4.1.1 step 5,
  which runs **only when a standing commitment generates its sittings.** Every
  ordinary task stays energy-blind, including the 80%-on-the-worst-days behaviour
  that motivated this whole document. That is the containment trade — a small
  blast radius now, the general problem still open behind D-1.
- ~~**D-2: should a characterless task be steered away from wrecked days?**~~
  **DISSOLVED 2026-08-13 by the gate** (see the recommendation). A task with no
  load cannot make a day worse, so it gets no opinion. One line, no decision.
- ~~**Stability was not measured.**~~ **RUN 2026-08-13 — see below.**

---

# The two owed tests — run 2026-08-13

Probe: `probe-stability-and-c3.mjs`.

## Stability: the energy terms are innocent; spacing causes all the churn

Re-planned on each of days 0…10 with nothing else changing, counting sittings on
days ≥ r+1 that moved between consecutive replans.

| rule | unprovoked moves |
|---|---|
| C1 only (depth) | **0** |
| C3 only (reserve) | **0** |
| H4 = depth + spacing | **4** |
| H5 = reserve + spacing | **4** |

**The prediction was wrong about which term was at risk.** The candidates
document expected C1's moving denominator to be the problem; it is perfectly
stable, because re-normalising against a shifting candidate set does not change
the *ranking*. All churn comes from **spacing**: when a chosen day drops out of
the window the greedy comb re-phases from a new start —
`[4,6,8,10,13]` → `[5,7,9,11,13]` at r=5, three future sittings moving with
nothing in the user's life having changed.

**Mitigation, and it is the shape the codebase already uses:** on replan, **keep
the previously chosen days that are still available and only fill the gaps**,
rather than re-deriving the comb. `redistribute` already preserves chunks that
are lived or user-placed (`projects.js:70`); this extends the same instinct to
"a plan you have already been shown". Without it, four moves per fortnight is
the floor.

## The C3 fixture: C1 is structurally blind, and C3 wins

The fixture the earlier evaluation could not build. Every day carries an
identical 2-hour mental block; days 0–6 in the **morning**, days 7–13 in the
**evening**. Because the battery is additive, the day's total dip is **identical**
either way — only the order within the day differs.

```
  day dip        -4.0 everywhere        <- C1's quantity: no information at all
  reserve@13:00  -4.0 (d+0..6)  0.0 (d+7..13)   <- C3's quantity
```

| rule | days chosen | sat down fresh |
|---|---|---|
| C1 only | 0,1,2,3,4 | 0/5 |
| C3 only | 7,8,9,10,11 | **5/5** |
| H4 depth + spacing | 0,3,6,9,13 | 2/5 |
| **H5 reserve + spacing** | 7,8,9,10,13 | **5/5** |

And on the acceptance fixture C3 **ties** C1 exactly (front 0m; streak 1 for both
hybrids). So C3 is never worse and sometimes much better.

> ### The recommendation changes: build **H5** — gated *reserve-at-sit-down* (C3) for energy, sibling spacing for clustering.

### Two caveats that must not be lost

1. **The better equation wants the riskier home.** C3's quantity is defined at a
   **slot**, not a day; this probe finessed it by scoring a nominal 13:00
   sitting. A real day-chooser must either fix an arbitrary nominal slot — which
   invents a number — or the term belongs in `scoring.js`, which is D-1's
   riskier branch. **This is now the deciding question for D-1**, and it did not
   exist while C1 was the front-runner.
2. **C3 optimises the moment, not the day, and that is a human question.** On the
   fixture both day types still *end* at −12; C3 chose the ones where you start
   fresh. Whether "fresh start, wrecked finish" beats "spent start, equally
   wrecked finish" is not something the model can adjudicate. C3 has strictly
   more information than C1; whether that information should decide is a
   judgement, and it is the user's.

### Corrections to this probe, recorded

`'C3only'` never matched the `rule === 'C3'` string check, so it silently ran C1
and produced a table that looked like proof C3 was blind. Replaced with explicit
`{energy, spacing}` flags, which is when C3's real behaviour appeared. **A
string-matched mode selector that fails closed is exactly the kind of silent
default this evaluation criticised C5 for.**

## The no-load fallback — confirmed

Per the user: with no tags, use the single equation rather than the hybrid. That
is already the gate's behaviour — energy contributes 0 and **sibling spacing
alone** decides. Worth being precise that the surviving term is *sibling*
spacing, **not C5**: C5 ranks by the task's dominant axis, which a tagless task
does not have, and its silent alphabetical default is what sent a characterless
task to the end of the runway.

---

# A real term week, and why the user's own failed blocks failed

**2026-08-13.** The user supplied real calendar weeks. Their term week contains
**8 self-assigned study blocks — "Project time", "Review notes", "Work on
Homework" — totalling 11.8 hours, none of which they did.** Everything that did
happen involved other people: classes, club boards, gym with a friend, tea, a
standing Friday evening.

**My first reading was wrong and the user corrected it.** I took those blocks to
be what this feature outputs, and concluded the feature was automating something
with a zero completion rate. It is not the same thing. Their diagnosis, which is
the one to build against:

| why the hand-placed blocks failed | what the feature must therefore do |
|---|---|
| **Unspecific** — "Project time" names no work | a sitting carries its commitment's name and the amount owed, so there is a specific thing to sit down to. Do not let generated sittings inherit generic titles. |
| **Not tailored to real times** — hand-placed guesses | generation reads the week's actual gaps (§4.1.1 steps 2–3) |
| **They landed on break time, when rest was needed** | ⭐ the equation question — see below |

## The third cause is the strongest evidence yet for C3 over C1

Run against the real week, anonymised, H5 placed 6h as:

```
Sun 08:00–10:00 · Sat 08:00–10:00 · Wed 08:00–10:00
0 of 3 sittings overlapped a block the user wrote and skipped
```

It chose mornings-before-the-day-starts and the free Saturday — **not** the 11:20
and 15:30 inter-class gaps that failed in real life. That is precisely because
*reserve at sit-down* reads a gap between two classes as already depleted, while
*whole-day depth* would have rated those gaps as fine. **The user's lived failure
mode is the exact case that separates C3 from C1.**

## The limit it exposes, which is real and unfixed

**C3 only looks backwards.** An 08:00 slot before a six-hour teaching day reads
perfectly fresh, because nothing has happened yet. The real week's Wednesday
carries 580 committed minutes and a −11.6 dip; placing two hours at 08:00 makes
that day materially worse and the measure cannot say so.

So the honest statement of the quantity we actually want is neither "the day's
deepest dip" nor "the reserve when you sit down", but something closer to **"what
does taking this slot do to the rest of the day that follows it"** — a gap
between two demanding blocks has *recovery value* that consuming it destroys.
Neither C1 nor C3 expresses that. It is the next candidate, and it did not exist
until a real week was looked at.

**Nothing in this section is committed as real data.** Course codes, club names,
locations and people's names were stripped before the fixture was written; the
repo is public and `design/import/` and `*.ics` stay gitignored.

*(Probe defect recorded: `probe-real-week.mjs`'s "longest free run" column merged
slots incorrectly and printed 15m for every day. The placements are unaffected —
they come from the real placer — but that column means nothing.)*

---

# Two defects from the blind pass — FIXED and proven, 2026-08-13

Probe: `probe-two-fixes.mjs`.

## Fix 1 — the restorative sign flip (scenario M6)

"Prefer the least depleted day" is **backwards for a task that restores.** A
meditation or recovery commitment was being pushed onto the freshest days, where
there is nothing to restore, while the two crunch days it should have been
protecting sat untouched.

**The fix:** the sign of the task's own dominant-axis load flips the preference.

```
depth = |reserve at sit-down| / worst among candidates
score = sign > 0 ?  1 − depth      // spending work seeks SHALLOW days
                 :  depth          // restoring work seeks DEEP ones
```

```
restorative commitment   BEFORE [2,4] (fresh days)   AFTER [0,1] (the crunch days)
spending commitment      BEFORE [2,4]                AFTER [2,4]  unchanged
```

The dominant axis is chosen by **magnitude**, so a task that spends one axis and
restores another follows whichever it moves most. A task whose load is exactly
zero still falls through the gate and is spaced only.

## Fix 2 — spacing across the period boundary (scenario A7)

Spacing was measured **within one period**, so a sitting on the Sunday of week 1
and one on the Monday of week 2 were each "perfectly spaced" and eighteen hours
apart, with four empty midweek days in both.

**The fix:** seed the spacing memory with the commitment's sittings from the
*previous* period, carried as negative day-offsets.

```
period 1 sat on its LAST day:  BEFORE period 2 picks day 0 → gap of 1 day
                               AFTER  period 2 picks day 6 → gap of 7 days
```

## A modelling subtlety this exposed, worth its own note

The first run of the fix reported "still broken" — **my fixture, not the fix.**
It scored a nominal 13:00 sit-down, which fell *inside* a 09:00–16:00 block, and
the reserve walk records a point per task completion, so 13:00 read as **0
depletion on a day that ends at −14.**

That is the third independent piece of evidence that **the energy term is
slot-shaped and does not belong in a day chooser.** A nominal hour is not a
detail to be tuned; it is a number the design would be inventing, and it can be
wrong by the entire depth of the day. See D-1.

## The user's own study pattern, and what it asks of the design

> *"Normally my time studying came from long 8 hour blocks on Saturday and
> 8pm–midnight on weekdays. It worked for me but cut into my sleep and stressed
> me out… it would be good for this scheduler to force me to finish my work
> earlier."*

Two things already in the spec are aimed exactly at this — the spread rule
(§4.1.1 step 5) breaks up the eight-hour Saturday, and the `buffer` weight (§4.4)
pulls work off the midnight tail by aiming to finish a fifth of the runway early.
This is the clearest statement so far that **`buffer` deserves its high weight**,
and that a user may legitimately want the scheduler to push.

**⚠️ But do NOT express the evening as a zone.** The user proposed a 20:00–22:00
homework zone. A zone **defines** the window for its matching tags and is not
clipped by `config.windows` (SPEC §2.1, verified by probe: a 06:00–08:00 gym zone
places at 06:00 while the day officially starts at 08:00). So a homework zone at
20:00–22:00 makes 20:00–22:00 the **only** time homework may ever be placed —
locking the work into precisely the late slot the user is trying to escape.

What achieves the stated goal instead:

- **Widen `config.windows`** so evenings are *legal* — they currently end at
  18:00, which is why the scheduler cannot see the real 8pm–midnight work at all.
- **Let `buffer` and `proximity` pull earlier.** Earlier is then a *preference*
  an overloaded week can override, rather than a wall.
- **A zone only if a guaranteed protected slot is wanted**, accepting that it
  becomes the only slot.

## What did not change

The learned upgrade path is unaffected: all of these are comparative, none states
a capacity, and the move to `learnedCapacity()` as the normaliser remains blocked
on the recurring-ratings fix (`design/RATINGS-AND-LEARNING.md`) while none of the
candidates is.

---

# The blind scenarios, run against two REAL weeks — 2026-08-13

Probe: `probe-real-weeks-uc.mjs`. Two anonymised shapes from the user's own
calendar: a **dense** term week (285–580 committed minutes a day) and a
**sparse** early-term week (0–475). Where a scenario invented a calendar, its
*question* was posed against the real week instead.

| scenario | dense | sparse |
|---|---|---|
| A1/N2 fresh mornings, nothing late | PASS — Sun 10:00, Sat 08:00, Wed 08:00 | PASS, same |
| X6 is a 90-min sitting satisfiable? | PASS — 7/7 days | PASS — 7/7 days |
| M6 restorative direction | PASS — sign −1 | PASS |
| N5/A11 no-load gated + deterministic | PASS | PASS |
| X13 five replans, nothing done | PASS — 1 distinct plan | PASS |
| M1/M5 commitments sharing days | 1 shared day | Sunday carries all 3 |
| sleep guard | never binds | never binds |

## ⭐ The finding: the day ranking INVERTS with the hour you score

```
DENSE week        res@13:00                res@20:00
  Wed               -2.5  (4th best)         -10.6  (worst day of the week)
  Fri               -5.3  (6th)               -7.0  (3rd best)
```

Wednesday is fourth-best at 1pm and the **single worst day of the week at 8pm**;
Friday moves the other way. A nominal sit-down hour is therefore not a parameter
to tune — **it is the answer.**

This lands precisely on the user's own pattern: their real studying happened
20:00–24:00, where Wednesday sits at −10.6. A day chooser scoring at 13:00 hands
them Wednesday evening and calls it a good pick. The probe's plan only *looks*
right because `placeTask` independently chose 08:00 slots — **the day chooser and
the placer were measuring different moments, and only the placer's moment was
real.**

> ### D-1 is settled on evidence: the energy term belongs in `scoring.js`, evaluated at the candidate slot.

Four independent findings now point there — the C3 fixture, scenario X8, the
nominal-13:00 bug in the sign-flip probe, and this. The containment argument for
a day chooser rested on C1 winning, and C1 lost.

## Two smaller readings, stated so they are not inflated

- **The identical plan across a dense and a sparse week is benign.** The free
  weekend days genuinely are the least depleted in both, so the same answer is
  the right answer twice — not evidence that the energy term is inert.
- **The sparse Sunday taking all three commitments is 4h on a 13h empty day**, so
  M13's "short day swamped" does not fire. Cross-commitment spacing is still
  worth having; it is not urgent.

## Not run — and why, so nothing is quietly skipped

- **Need a shape a real week cannot express:** X3 past deadline · X5 six-month
  runway · X12 DST/spring-forward · X10 exact load cancellation · X2/X7
  impossible amounts · X9 all-restorative week · A12 mid-week term start.
- **Test WORDING, and there is no commitment UI yet:** N1, N3, N4, N6, N7, N8,
  N9, N12. What the app may say on a brutal week, and the sentences it must never
  produce ("you're behind", "streak broken", "more than you can handle"). These
  are **acceptance criteria for the build**, not probes — and they are the ones
  most likely to be dropped, because nothing fails when they are.
