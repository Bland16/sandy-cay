# Wrap report — every addition recommended

**2026-09-02.** Consolidated from five independent analyses (subtraction audit ·
untapped engine data · P-1 adversary · Sunday-night/user · form & dataviz), run
against the working tree with the pruning pass applied but uncommitted.

Additions only. Deletions, dead-code sweeps and the pruning-pass bug fixes are
tracked separately at the bottom under *Prerequisites*.

**Convergence is the ranking signal.** Where three independent lenses landed on
the same addition without seeing each other's work, it is listed first.

---

## STATUS — what is built

**Updated 2026-09-03 after implementation.**

| Item | Commit |
|---|---|
| Prerequisite 1 — blocked days have no capacity (+ `blocked` per day, for A1) | `f50fd95` |
| Prerequisite 2 — the insight sign, evidence gate, plain labels | `f50fd95` |
| Prerequisite 3 — the P-1 print violation: exits now print as text | `bfa0daa` |
| Prerequisite 4 — `deadlineBufferHours` declared | `bfa0daa` |
| Prerequisite 5 — the deadline sentence that could be false | `bfa0daa` |
| Prerequisite 6 — `fmtBuf` printing "0h" | `bfa0daa` |
| Prerequisite 7 — the dead ternary and the bare `0` | `bfa0daa` |
| Prerequisite 8 — the empty day's 2px sliver | `bfa0daa` |
| Prerequisite 10 — the stale `google.js` origins comment | `bfa0daa` |
| Prerequisite 11 — dead CSS, dead helpers, the stale print comment | `f50fd95`, `bfa0daa` |
| **Tier 2 restorations** — Breathing room, the matrix *with cell counts*, plan-vs-actual reframed | `bfa0daa` |
| A22/A23 partial — the capacity reference and its numeral | `f50fd95` |
| A27–A29 — repeating table headers, unsplittable KPI row, `--hair` on paper | `bfa0daa` |

The sand bars, the energy butterfly, the insight sentence and the restored
sections are now covered by tests (`wrap-sand-bars.test.jsx`,
`ui-energy-shape.test.jsx`, `learning-guards.test.js`) — the point being that
"nothing failed when they were cut" is exactly why they were cut.

**A1 and A2 are now built** (`2bed2b0`+). Day notes and blocked days print as
facts under the sand bars, governed by D-4's copy rule and guarded by a test
that fails on "because" or on sympathy. The commitment ledger states the amount
set beside the amount laid out, reading `placedMin`/`remainingMin`/`settled`/
`owedMin` and deliberately NOT `state`, which is `now`-relative and marks every
commitment `passed` on a retrospective call.

**Still open:** A3 (the day timeline strip), and the rest of Tiers 3–5. A35/A36
are designed, not built.

### New, found while building A2

**An empty week that owed commitments says "nothing to report", and that is
false.** `isEmpty` is `real.length === 0`, so a week where a 4h commitment was
set and the grid laid out none of it renders the empty-week page: *"Nothing was
scheduled this week. A quiet week is a week. There's nothing to report and
nothing to fix."* The commitment is exactly what there was to report, and
"nothing to fix" is wrong in the one direction that matters — the packer found
no room, which is a fact about the plan and not about the person.

Not changed unilaterally: the empty-week page is a deliberate P-1 decision and
its wording was chosen carefully. The fix is probably to let `isEmpty` mean
"nothing scheduled AND nothing owed", and give the owed-but-unplaced week its
own sentence. **Product call.**

---

## Two claims that did NOT survive verification

Recorded so nobody re-derives them.

1. **"The recurring-ratings plumbing is unbuilt, so cold start is permanent."**
   FALSE. `Schedule#ratedSamples()` exists (`Schedule.js:434`), `retrain` uses it
   (`:1068`), `energyCalibration` uses it (`energy.js:73`), and
   `tests/rated-samples.test.js` guards it. Only the *doc header* is stale —
   `design/RATINGS-AND-LEARNING.md` still reads "Status: SPEC. Nothing built."
   **Fix that header.** Nothing here is blocked on it.

2. **"The pruning deleted `.rp-drestore`'s dash, losing the §10 encoding."**
   Half true. The CSS was NOT deleted — `.rp-diamond` … `.rp-dnum` are all still
   in `styles.css:1528-1534`, now dead. The *rendered* dash is gone because the
   JSX went. Net effect on paper is the same; the remedy is different (relocate
   the encoding to the butterfly, then sweep the dead rules).

---

## Tier 1 — decided, unbuilt, data already loaded

### A1. Day notes and blocked days, as facts
**Three lenses converged, and it is already a resolved decision.**
`design/DAY-NOTES.md` **D-4, RESOLVED 2026-08-11** decides day notes reach the
report and supplies the copy rule:

> *"**YES, as facts.** … The line it must not cross: a fact explains, a story
> excuses. 'Thanksgiving fell on Thursday' is a fact. 'You did less because of
> Thanksgiving' is the report doing your thinking for you … State the day, state
> the count, stop."*

- **Source:** `Schedule.notesForDate` (`Schedule.js:499`), `schedule.blockedDays`
  (`:89`), `isDayBlocked` (`:719`), `DayNote#kind` / `#coversDate` / `#dayCount`
  (`DayNote.js:48,61,68`). All present, all persisted.
- **Denominator:** the seven days.
- **Why first:** the live user file holds **21 day notes and 12 full-day
  blockers** across Thanksgiving, both finals periods and spring break. A
  zero-height Thursday currently reads as a failure; a caption turns it into a
  decision the user made. Highest P-1 return per line in the whole list.
- **Bundle with:** the `dayCapacityMin` blocked-day bug (see *Prerequisites*) —
  they are the same piece of work.

### A2. The commitment ledger
**Three lenses converged. Called "the single largest gap" and "the strongest
unused denominator in the codebase."**

- **Source:** `previewWeek()` (`commitmentWeek.js:52`) → `placedMin`,
  `remainingMin`, `owedMin`, `settled`, `sittings`; amount
  (`Commitment.js:75`); `_commitmentDone` (`Schedule.js:134`, read `:564`,
  serialised `:1105`).
- **Denominator: the weekly hours you set yourself.** Neither invented (P-2 safe)
  nor a grade (P-1 safe), and it belongs to the week the report is about.
- **Copy already written** — WEEKLY-PLANNING §4.3: *"Maths homework — 1h 30m of
  2h placed; the week had no room for the rest."*
- **⚠️ Implementation trap:** `previewWeek`'s `state` is `now`-relative and
  returns `passed` for any retrospective call. Read `placedMin` / `remainingMin`
  / `settled` / `owedMin` directly (`commitmentWeek.js:64-89`) and ignore
  `state`. Honour its own rule: *"a shortfall must never be manufactured by the
  passage of time."*
- Closes the loop on commit `0afd707`, which taught the engine this and gave it
  no retrospective voice.

### A3. "When it happened" — the day timeline strip
**Two lenses converged; both named it the single biggest hole.**

The report currently has **zero time-of-day information**. It says how much, and
what, and never *when* — which reverses the request behind commit `b3631f2`
("it put the tasks at 11pm after a very full day").

- **Form:** seven rows, **one shared wall-clock x-axis** — not per-day spans.
  Ink density carries load (solid / hatch / open), never colour. Each row prints
  its own denominator at the right edge.

```
        08   10   12   14   16   18   20   22
  MON   ░░▓▓▓▓▓▓▓▓▓▓░░░░░░░░▒▒▒▒░░░░▓▓▓▓▓▓     6.5 / 10h
  TUE   ░░░░▓▓▓▓░░░░░░░░░░░░░░░░░░░░░░░        2.0 / 10h
  THU   ── nothing scheduled ──                  —  / 10h
  SUN            ▓▓▓▓░░░░                       1.0 /  4h
```

- **Source:** `sched.getTasksForWeek(ws)` (already in hand, `report.js:376`) +
  `dayWindowBounds` (`placement.js:36`). ~25-line builder, ~40 lines of SVG/CSS.
- **Denominator:** a full row is that day's open window — 08:00–23:00, or 10:00
  Sunday. The row *is* the denominator.
- **Why it succeeds where DayShapes failed:** no learned quantity, no
  calibration, works in week one, and it makes the sand bars' clipping defect
  *visible* — an 11pm block draws at the right edge instead of vanishing.
- **Learn from the corpse:** DayShapes used a **per-day** x span
  (`span = windowEnd - windowStart`), so a 2h task drew 2.5× wider on Sunday than
  Monday — while its own docblock shouted about sharing the y scale. Small
  multiples must share *every* axis.

---

## Tier 2 — restorations (builders already run; nothing renders them)

`report.js:390-392` still computes `matrix`, `breaks` and `plan` into a view
model with **zero readers**. Three query walks per render, discarded.
**SPEC.md:200 names five Statistics items; the pruned sheet renders two.**

### A4. Breathing room — restore
**Three lenses agreed the cut was wrong.** It was collateral damage from
collapsing `.rp-cols`, not a denominator failure: it printed *"3 of 11 gaps were
at the 5-minute floor"* — explicit numerator and denominator, in prose.

- **Source:** `getBreakCompression` (`queries.js:111`), sharing `dayGaps`
  (`:90`) with the grid's overpack notice *specifically so the two surfaces can
  never disagree*. Right now the grid says "this week is squeezed" and the report
  is silent.
- Its best line is the best P-1 sentence in the file — *"Gaps are what the packer
  left you between one thing and the next"* — it attributes compression to **the
  packer**, not the user. Keep verbatim.
- One touch: *"The packer left {n} gaps at its {minimum}-minute floor."*

### A5. Tag × time-of-day — restore, with counts, as sentences
SPEC §7.1-mandated. The real defect was never the denominator (every cell is a
mean out of 5): it was that **cell counts were hidden**, so a `5.0` from one
rating looked identical to a `5.0` from six. `queries.js:181-183` already returns
`count` per cell and the view threw it away.

- Reframe from grid to sentence so the eye can't hunt for the lowest cell:
  > *"study rated higher in the morning than in the evening — 4.2 against 2.8,
  > from 9 ratings."*

### A6. Plan versus what happened — restore, reframed
SPEC §7.1-mandated (snapshot diff). Self-suppresses honestly with no baseline
(`report.js:112` returns null).

- **Make the plan the subject, not the person.** Drop the intact count and the
  intact-days list — *"Went to plan: Tuesday, Friday"* makes the unlisted days a
  failure list by omission, an inverted skip list.
  > *"The plan moved 6h this week. The biggest change: Thesis, 2h later than
  > planned."*

### A7. Model insight — restore the list, fix the sign, humanise the labels
The replacement is **strictly worse than what it replaced** and is factually
broken (see *Prerequisites*). Restore the sign-carrying list, and add:

- `humanLabel()`: `tag:study` → "study", `time:morning` → "in the morning",
  `dur:45-90` → "45–90 minute blocks".
- **Exclude the bare machine features from the report entirely** — `priority`,
  `dayFill`, `placedByUser`, `moveCount` should never print on paper.
- Rank by evidence, not `|weight|` — `inspect()` already returns `observations`
  and `gated`, both discarded today.

---

## Tier 3 — new facts the engine already computes

### A8. Deadline buffer against the runway
Replaces a threshold nobody set. `bufferScore()` (`scoring.js:79`) already
targets **one fifth of the runway** and saturates — a real denominator the app
owns and never gave the report.
> *"Due in 10 days; the plan aimed to be clear 2 days ahead, and you finished
> with 2 days spare."*

Needs one export line — `bufferScore` isn't in the barrel (`index.js:67`).

### A9. Recurrence exceptions — the pattern you set vs. the week you ran
> *"Your patterns put 12 sessions on this week. 9 ran as written, 2 you moved,
> 1 you skipped, and you added 1 that isn't in the pattern."*

- **Source:** `task.recurrence.exceptions[]` (`recurrence.js:294`, applied
  `:136-200`). `getTasksForWeek` already materialises occurrences.
- **Denominator:** occurrences the pattern itself scheduled this week.
- Whole domain currently invisible; `driftCheck` reads this array but only speaks
  at ≥4-of-5. The plain count is free.

### A10. Routines — elapsed vs. attention
> *"Laundry took 2h20 of your evening and 25 minutes of your attention."*

- **Source:** `RoutineInstance#spanMin` / `#attentionMin`
  (`RoutineInstance.js:152,157`), `routineWaits()` (`routines.js:210,233`).
- **Denominator:** the run's own elapsed span. Pure physics; `overrun` is
  explicitly *"a statement, never a refusal."*
- The only number that makes a routine feel like it earned its place.

### A11. Placement physics the report already receives and discards
`getWeekLoad().warnings` is **already on `stats.load`** and never rendered.
> *"3 of the 21 things on this week could not be given a proper slot."*
> *"2 study blocks were placed outside your study zone because the zone was full."*

- **Source:** `queries.js:29,48`; `task.schedulingWarning` (`placement.js:395`),
  `schedulingInfo === 'outside-zone'` (`:396`), `missedDeadline`
  (`carryOver.js:46`), project no-room (`projects.js:112`).
- **Coral is legal here** — this is scheduling physics, exactly what P-1 reserves
  the colour for. Near-zero cost for the warnings count.

### A12. Model readiness, stated as a fact about the model
> *"14 ratings. The model can speak about study and gym, and nothing else yet."*

- **Source:** `energyCalibration()` (`energy.js:66`), `modelCanSpeak`
  (`openings.js:43`), `ratingsUntilLearned` (`:52`), `learning.inspect()`
  (`learning.js:224`).
- Turns P-2 from a silence into a statement, and gives week 1 something honest.
- **Must not be a quota.** Follow EnergyShape's own argument: *"the forbidden
  thing was inventing a ceiling, not declining to narrate its absence."* No
  "{n} of {needed} ratings so far" — that is a progress bar in prose against a
  number the user must fill.

### A13. Rest, named — what you asked for and did not get
`protectedTags` (`rest`, `break`, `recovery`) are the user's **own declared
intentions**, so this is the one legitimate shortfall in a no-guilt app.
> *"You asked for 4h of rest this week. The grid found 1h 30m."*

Frame as the packer's report on itself, never as the user's failure.

### A14. Project progress as a *weekly* fact
`p.thisWeek` is computed at `report.js:69`, returned at `:75`, and has **zero
readers**. So every project ever created prints in every report forever, with a
lifetime figure, reading as standing debt.

- Render `thisWeek`, and filter to projects touched this week.
- Blocked on persisting `chunking.actualMinutes` / `plannedMinutes` — written at
  `projects.js:187-188`, read nowhere, and **omitted from `chunkingToJSON`**
  (`Task.js:297-305`), so destroyed on reload. Two lines fixes it.

---

## Tier 4 — the report as a document (framing additions)

### A15. Report on the plan, not the person
The unifying move behind almost every copy rewrite proposed. *The app wrote the
schedule; when the week didn't match, the newsworthy party is the plan.* A
dashboard cannot say this because a dashboard has no author. This one does.

### A16. State what the app cannot know, by name
> *"Sandy Cay only knows what was ticked. A day with nothing marked and a day
> with nothing done look identical from here."*

Otherwise every blank reads as the user's failure. Precedent already in the file:
`EnergyShape.jsx:84-88`, the best empty state in the codebase, because it names
the cause.

### A17. Quote the user back to themselves
The satisfaction data holds the only sentences on the sheet the user actually
authored. One per report, chosen for being high and *unexpected*.
> *"The 7am study block rated 5. That's the only one you've tried."*

This is the DayShapes payload, rescued from the chart that couldn't carry it.

### A18. Let the report be closed
Every suggestion is already an answerable question with a real "let it go"
mutation (`applySuggestion`, `report.js:260-299`). Give the sheet a terminal
state: *"Everything the report asked, you've answered."* A dashboard is never
finished; a document can be — which is what a tired reader needs at 9pm.

### A19. Report on the app's own advice, not on a trend line
A trend line grades the user and always names a decline. This doesn't:
> *"Last week's report suggested pinning Reading — you did, and it stayed put."*

No dashboard is built to grade its own recommendations.

### A20. Open loops, triaged · the opening line · the closing line
- The report is the **only home for all five detectors** (`HANDOFF.md:1352`) and
  has almost no evidence of ever being read. Lead with what's open.
- Opening line governed by D-4: *state the day, state the count, stop.*
  → *"Reading week — five of the seven days were blocked."*
- Ask once. WEEKLY-PLANNING §8: *"the app states the truth once, and never nags
  and never accumulates. Making work disappear is one failure. Repeating a
  number at someone is the other."*

### A21. A thin-week gate
A bad week currently renders **nine consecutive absences** then a list of what is
failing: `0 finished · — · — · none rated · nothing marked done · 4 let go · net
14.2 · 0 of 10 ratings · two things that haven't happened.`

`isEmpty` (`report.js:403`) is `real.length === 0` and does not fire. The data
model already knows: `acc.items.length === 0 && acc.ratedCount === 0`. Collapse
the degraded halves into the one-sentence treatment the empty week gets.

---

## Tier 5 — form and print additions

**The governing measurement:** converted to 8-bit greyscale, `--pinned` (spend)
is **173** and `--rest` (restore) is **176** — 3 levels apart out of 255, a
contrast ratio of **1.03:1**. `--hair` is 199, i.e. 1.69:1, effectively white.
**On this sheet hue is not a channel.** The surviving channels are position,
outline, texture, ink density and numerals.

Corollary, and the best single rule to come out of all five analyses:
> **The reference mark must never be drawn softer than the data it gives meaning
> to.** A faint dashed capacity line under a solid bar, a 7%-alpha track under a
> saturated fill — in each case the thing that makes the data mean anything is
> the first thing the printer drops.

| # | Addition | Where |
|---|---|---|
| A22 | **Capacity as a frame the fill sits inside and can escape**, replacing the dashed line. Overshoot becomes a shape event that grows with it | `WrapReport.jsx:86-92`, `styles.css:1895-1898` |
| A23 | **Print the denominator as a numeral** under every bar — `9h / 10h`. §10 generalised past colour: no quantity may live in one fragile channel | `WrapReport.jsx:95` |
| A24 | **Butterfly: absolute load-hour axis with labelled ticks**, replacing `max` (the week's own largest value). Makes the energy section comparable week to week without claiming a ceiling | `EnergyShape.jsx:91-95` |
| A25 | **Butterfly: hairline ink border on `.rp-bftrack`** — the track *is* the denominator's container and it prints at ≈grey 240, i.e. not at all | `styles.css:1542` |
| A26 | **Restore/spend as texture, not hue** — restore 45° hatch, spend solid, one ink tone. Recovers the §10 redundancy that left with the Diamond | `styles.css:1544-1545` |
| A27 | **`.rp-table thead { display: table-header-group }`** — the tag table is uncapped and *will* cross a page, arriving as four unlabelled number columns | print block |
| A28 | **`font-variant-numeric: tabular-nums` on `.rp-table td`** — the one place a column of numbers must align is the one place that doesn't (Nunito, proportional figures) | `styles.css:1489` |
| A29 | **Print override `--hair` → `rgba(42,38,32,.25)`** — repairs every table rule, card border and tag chip in the document at a stroke | print block |
| A30 | **9.5px floor for `--font-type` on paper** — `.rp-bar-val` at 8.5px is ≈6.4pt of a *distressed* typewriter face whose strokes are broken by design | `styles.css:1482` |
| A31 | **Running head with the week key** (`wrap-2026-W36`) — a loose sheet 3 of a 5-page document is currently unattributable | print block |
| A32 | **`orphans`/`widows` on `.rp-list` and `.rp-sugg-detail`; protect `.rp-stats` as a group** so the KPI row can't split 3-and-1 | print block |
| A33 | **Inline bar column in the tag table** (ranked table, not a pie or stacked bar — hue is unavailable and the tag cap was lifted). ~90% built already | `WrapReport.jsx:241-259` |
| A34 | **Suggestion actions as static text in print** — see *Prerequisites*, this is a P-1 violation not a nicety | `styles.css:1569` |

**Deferred forms** (right idea, not yet earned): multi-week sparkline strip for
the energy axes — the Diamond's real intent was comparative across weeks, which
no single-week glyph can serve; renders nothing until ≥3 weeks exist. Dumbbell
rows for week-over-week. Strip plot for buffer/gap distributions (below ~5 points,
list them instead).

---

## A35 / A36 — designed 2026-09-03 (user)

Both were "needs a product decision." The user has now given direction on each.

### A35. Which week is the denominator?

> *"I'm not sure if it should be last week or the last week with a similar
> payload/workload."*

**The instinct is right and adjacent-week is the wrong answer.** Comparing finals
week against reading week manufactures a shortfall out of the calendar — the
purest P-1 failure available, because the "decline" is an artefact of the term,
not of the person.

But "the most similar week" carries a tautology risk that has to be designed out:
**if you select the comparison week by scheduled hours and then report on
scheduled hours, you have said nothing.** The comparison is guaranteed to come
back "about the same," by construction.

**The resolution — similarity is defined on what you did NOT choose; comparison
is on what you did.**

| Defines the cohort (structural, not chosen this week) | Compared across it (lived) |
|---|---|
| days blocked / day-window capacity | what got done |
| commitments due, and their `amountMinPerWeek` | how it felt (shells) |
| deadline density in the week | gap compression |
| day notes marking term phase (finals, reading week) | where the hours went, by tag |

Those two lists must stay disjoint. A quantity may define the cohort or be
compared across it, never both.

**Prefer a cohort median over a single matched week.** One "most similar week" is
n=1 and as noisy as the thing it is measuring. The median of the matched cohort
is robust, degrades gracefully (at n=1 it *is* that week), and has a nameable
denominator.

**And the report must name the cohort, in the sentence.** An unnamed denominator
is the exact defect this whole document exists to prevent.

> *"Compared with your three other full teaching weeks, this one held about two
> hours more study and rated about the same."*

**Gate:** below 2 matched weeks, print nothing — do not fall back to "last week"
silently, and do not fall back to a median over dissimilar weeks. The
EnergyShape rule applies: declining to narrate an absence claims nothing.

⚠️ Still a genuine spec change: `design/SPEC-COMB-2026-08.md:176` states as a
*property* of the report that *"the wrap report never looks further back than the
week it covers."* That sentence has to be amended or this cannot be built.

---

### A36. "Lay next week out" — from tags, not named activities

> *"if I have a social lunch around noon most weeks instead of using real names
> just use lunch social etc — add in my commitments routines ideas with tags
> instead of set activities."*

**This is the design that makes the feature safe.** The recorded danger was
`HANDOFF.md:485-488`: *"It will move the user's gym and be wrong to. They
deliberately placed Mon 16:15 / Wed 19:00 / Sat 14:00 against their hard days;
the generator spreads evenly."*

A tag-shape layout **does not spread evenly** — it proposes blocks *where the
pattern actually recurs*. Mining the user's own week for "gym, Mon ~16:00 / Wed
~19:00 / Sat ~14:00, 5 of the last 6 weeks" reproduces the deliberate placement
instead of overwriting it, because the deliberate placement **is** the evidence.
The tag framing turns the hazard into the mechanism.

#### The unit: normalized tag set × weekday × time bucket

Mine the trailing N weeks. For each task take its **sorted tag set** — so
`lunch`+`social` is one thing, distinct from `social` in the evening — its
weekday, and its time bucket. Count how many *distinct weeks* contain at least
one such block. Emit the ones clearing a recurrence threshold.

Output is a skeleton of **unnamed shape blocks**:

```
MON   study · 2h, ~09:00          (5 of last 6 weeks)
      lunch · social, ~12:00      (6 of last 6)
      gym, ~16:15                 (5 of last 6)
WED   gym, ~19:00                 (5 of last 6)
SAT   gym, ~14:00                 (4 of last 6)
```

Never "Lunch with Sarah." The app genuinely does not know you will have lunch
with Sarah; it knows you reliably spend an hour on `lunch`+`social` around noon.
**Saying only what it knows is the honest version and also the more useful one** —
a shape you fill in beats a guess you have to correct.

#### Why tags, and not the activity library ✅ verified

`activityUsage` (`activityList.js:32`) already does trailing-window frequency —
but it keys on `activityId` and **explicitly skips every task without one**
(`:37`). It can only see library-instantiated items, and most of a real week is
not that. Tag mining sees the whole week.

It also matches the app's own model everywhere else: energy derives from tags,
zones claim tags, buckets carry load by tag. `Commitment.js:35` already argues
exactly this — *"tags touch, so a commitment tagged `study` already has the right
character."*

*(This reverses the rejection of `activityUsage` in the Rejected list above. It
was rejected for the **report**, where its 90-day window is not the week. For
**next week's shape** a trailing window is precisely right — the unit just has to
be tags rather than activity ids.)*

#### Commitments and routines fold in natively

- **Commitments** carry `tags` (`Commitment.js:70`) and `amountMinPerWeek`
  (`:75`). So a commitment emits *"study · 4h across the week"* as an amount in
  its usual shape, without the layout having to pick sittings. Its `dueDay`
  (`:100`) constrains where the shape may fall.
- **Routines** carry tags through their source `Activity` (`Activity.js:73`),
  plus a frozen step program. So a routine emits its **chain shape** — active
  touchpoints with the passive waits between them — under its tags, not its step
  labels.

#### The safety mechanism already exists ✅ verified

`planWeek(schedule, ws, now)` (`commitmentWeek.js:160`) is
`layOutWeek(Schedule.fromJSON(schedule.toJSON()), ws, now)` — it lays out a week
**on a deep copy** and returns the result without touching the live schedule.
That is exactly the non-destructive preview the handoff demanded, already built
and already exported (`index.js:42`).

#### Rules it must obey

1. **Proposal, never an action.** It renders a shape; the user places it. Per the
   handoff, it must not be the report's `.cta`.
2. **P-2 gate with named evidence.** Only propose a pattern present in ≥N of the
   last M weeks, and **print the count** — "5 of your last 6 weeks". A pattern
   below threshold is not shown, not shown greyed out.
3. **P-1 framing.** It describes next week's *shape*, never last week's
   shortfall. "Most weeks you…" not "you usually manage to…".
4. **Blocked days and day notes are respected**, since they are already known for
   the week being laid out — do not propose a Thursday shape into Thanksgiving.
5. **Never invent a time it has not seen.** The time bucket comes from where the
   pattern actually sat, not from where the packer would prefer it.

---

## Rejected, with reasons

- **Completion rate** (done ÷ scheduled) — a grade. §7.1 already forbids listing
  skipped; a percentage is the same verdict with better manners.
- **Any energy chart with a capacity ring before calibration** — P-2.
- **Churn as a week statistic** — `history.moveCount` and friends are *lifetime*
  counters (`Task.js:20`). "6 things were moved this week" is not derivable and
  presenting it would be precisely the no-denominator failure. Needs a per-week
  delta stamped at rollover first.
- **`activityUsage`** — its window is `frequencyDays`, not the week.
- **`Schedule#changeCount`** — an edit counter is not a fact about your week.
- **`net` on the energy totals** — a single signed balance has exactly one idiom
  (positive = overdrawn), which is the judgement `EnergyShape.jsx:117` forbids
  four lines above where it's printed. And since restorative tags are rare, it is
  positive essentially every week: the section ends on a permanent deficit.

---

## Prerequisites — fix before or alongside

Verified defects, all confirmed against source. The two marked ⚠️ are **in the
uncommitted pruning pass itself**.

1. ⚠️ **The new capacity line lies on blocked days.** `dayCapacityMin(config,
   date)` (`placement.js:50-53`) cannot see `blockedDays` — that needs the
   schedule. The placer knows (`computeWindows` returns `[]`, `:160`);
   `getWeekLoad` doesn't (`queries.js:33`). A day you barred the scheduler from
   draws a **full-height reference line over an empty bar**. Same work as A1.
2. ⚠️ **The new insight sentence can print the opposite of the truth.**
   `buildInsight` sorts by `Math.abs(weight)` (`report.js:325`), so `top[0]` may
   be strongly negative — and the copy says "leans toward" unconditionally. It
   also prints raw labels, so it can read *"the model leans toward moveCount."*
   The list it replaced carried the sign and was correct. See A7.
3. **P-1 violation in print:** `.rp-sugg-actions { display: none !important }`
   (`styles.css:1569`). SPEC.md:11 requires every diagnostic to offer a graceful
   exit *with equal visual weight*. The PDF is the artifact that persists — it
   prints the accusation and drops the release. See A34.
4. **`config.detectors.deadlineBufferHours` does not exist.** It appears once in
   the codebase, at the read site (`report.js:340`). `?? 24` has always fired.
   See A8.
5. **The deadline sentence can be false.** `count` counts only *completed*
   deadlined tasks (`report.js:341`), so missing three of five prints *"2 tasks
   had a deadline this week, all finished with room to spare."*
6. **`fmtBuf` rounds to hours** (`WrapReport.jsx:19-24`) — a 24-minute buffer
   prints *"finished 0h before it was due."*
7. **Dead ternary + bare zero** (`WrapReport.jsx:175`):
   `label={acc.completedCount === 1 ? 'finished' : 'finished'}`, and `value` is
   unguarded, so a week with nothing done renders `0` as the largest glyph on the
   page — against the file's own header rule at line 11.
8. **`.rp-bar-fill { min-height: 2px }`** (`styles.css:1478`) — an empty day
   draws a sliver of ink while its label says `—`.
9. **Stale doc header** — `RATINGS-AND-LEARNING.md` says "Nothing built"; it is
   built.
10. **Stale code comment** — `google.js:34` claims the OAuth client is
    origin-restricted to `localhost:5173`; it is not, which cost a session.
11. **Dead code from the prune:** `.rp-diamond`/`.rp-d*` (`styles.css:1528-1534`),
    `.rp-progress` (`1463-1467`), `.rp-cols` (`1422`, `1514`), `.rp-matrix`
    (`1490-1491`), `.rp-plain` (`1492-1493`); `ringPoly`/`valuePoly` in
    `EnergyShape.jsx`; the print comment at `1577` describing a deleted chart;
    and `tests/ui-report.test.jsx:327` asserting a value nothing renders.

---

## Suggested order

1. **A1 + prerequisite 1** — day notes, blocked days, honest capacity. Small,
   decided, and it repairs the section the prune just rewrote.
2. **A2** — the commitment ledger. Largest missing domain, best denominator.
3. **A3** — the day timeline strip. Restores *when* to the report.
4. **A7 + prerequisite 2**, then **A8 + prerequisite 4** — the two broken
   sentences.
5. **A4, A5, A6** — restorations, back into SPEC §7.1 compliance. Builders
   already run.
6. **A22–A29** — the print pass. Cheap, and the greyscale measurement says the
   document currently loses most of its reference marks on paper.
7. **A9–A14** — new domains, cheapest first.
8. **A15–A21** — the copy and framing pass, once the structure is settled.
