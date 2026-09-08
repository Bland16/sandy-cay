# Sandy Cay — Blind Use Cases, Pass 4 (B90–B117)

**Author:** adversarial QA pass, written 2026-09-08 against `SPEC.md`, `FRONTEND-SPEC.md`,
`HANDOFF.md`'s sharp-edge list and the design docs for the newest features
(`WRAP-REPORT-ADDITIONS.md`, `COMMITMENT-USE-CASES.md`, `ROUTINES.md`,
`ENERGY-PLACEMENT-EVAL.md`, `RATINGS-AND-LEARNING.md`, `CALENDAR-IMPORT.md`,
`GOOGLE-AS-STORAGE.md`, `DATES-AND-RECURRENCE.md`).

**Scope.** Deliberately disjoint from B1–B40 and B41–B80. Those two passes were written
blind from the spec and aimed at the placement engine, zones, projects and the original
four scoring weights. This pass aims at the code written since: the wrap report's day
strips and energy wash, the commitment ledger, the pattern-vs-week diff, routines'
elapsed-vs-attention, the learning model's skill gate and grouped cross-validation,
`arrivalDepletion` in placement, Google sync's two doors, and recurrence exceptions with
multi-session occurrence keys. **The newest code is the least exercised code**, and this
project's own record says so: eight bugs came out of one afternoon of real use while 992
tests were green.

**The shape being hunted.** Every confirmed bug in this repo has lived at a **seam between
two subsystems that each looked right alone**:

- a rating written to `occurrenceData` while **eight** separate readers walked `schedule.tasks`;
- `rippleShift` filtering `!t.recurrence` and never concatenating occurrences back, so a
  resize slid a task on top of a weekly gym with no toast and no warning;
- `deadlineBufferHours` read by `report.js` and declared nowhere; `reserveBias` a `?? 0.2`
  fallback declared nowhere;
- `spreadDays` summing array indices and load-hours as if commensurate;
- `arrivalDepletion` counting the task being placed against its own arrival state.

**The cases below are near-misses of those** — the same shape, one seam over.

**Reference week throughout:** Mon **2026-09-07** → Sun **2026-09-13** (ISO `2026-W37`;
the wrap report for it is `wrap-2026-W37.pdf`). "Now" is Tue **2026-09-08**. Windows are
the shipped defaults, **not** the SPEC §8 text: Mon–Sat 08:00–23:00, Sun 10:00–23:00
(`lightDay`, `maxTasks: 2`), `sleep.minHoursBeforeNextDay: 8`. Weights are
`{proximity 0.5, balance 0.35, stability 0.15, preference 0.15, buffer 0.4, energy 0.15}`
— **six** of them, renormalized. Energy axes are `mental, physical, social, creative`.

**Citation key:** `§n` = SPEC.md · `F§n` = FRONTEND-SPEC.md · `An` = an item in
`design/WRAP-REPORT-ADDITIONS.md` · `SE-n` = HANDOFF's "Sharp edges" list ·
`P-1` = "the app never guilts" · `P-2` = "never an invented ceiling" · `R-1` = "manual always wins".

`UNSPECIFIED` in capitals marks a place the specs genuinely do not decide. Those rows are
the highest-value ones: a case that reveals the spec has no answer is itself a finding.

---

## A. The wrap report's newest surfaces (B90–B99)

The day strips (A3), the energy wash, the commitment ledger (A2), the pattern-vs-week diff
(A9) and routines' elapsed-vs-attention (A10) all landed in the last three weeks. They
share one page, three different definitions of "a scheduled minute", and two different
definitions of "a day".

### B90 — A task crossing midnight stretches the shared clock axis on all seven rows
| | |
|---|---|
| **Setup** | Reference week. Exactly one task: "Lab writeup", flexible, Mon **2026-09-07 23:00 → Tue 2026-09-08 01:00** (120 min). Per SE-5 the grid is a **5am-anchored** day, so this is one unsplit box in Monday's column; per HANDOFF it is explicitly *not* cut, because 01:00 is before the anchor. Nothing else is scheduled all week. |
| **User action** | Week `⋯` → **Wrap report**, and read the "when it happened" strips. |
| **Expected** | Monday's block draws as a single run ending two hours after midnight, and **the six other rows keep a clock they can be read against**. The strips are small multiples: A3's own docblock says every axis must be shared and names the corpse (`buildTrajectories` scaled each day to its own window, so a 2 h task drew 2.5× wider on Sunday). The axis label at the far right must not read `01` sitting to the right of `23` with nothing saying a day boundary was crossed. `UNSPECIFIED`: the spec never says what the shared axis does when one day's content leaves the day. Three defensible answers — clamp the axis at 24:00 and cut the block (SE-5's own resolution for the grid), extend to 25:00 and **label the wrap**, or draw the tail on Tuesday's row. Only one can be right. |
| **Why it's risky** | The axis is `Math.max(axisTo, winTo, ...items.map(minsFrom(t.to)))` where `minsFrom` is minutes from **that date's midnight** — so the tail contributes 1500. Every row is then rescaled to a 25-hour day to accommodate two minutes past midnight on one of them: Sunday's 10:00–23:00 window shrinks by 4% of the chart, and the hour ticks stop landing on the hour. Worse, the tick label is `Math.floor(m/60) % 24`, so minute 1500 prints "**1**" — a tick reading `1` to the right of `23`, which is the exact "seven unrelated charts in a row" failure A3's docblock forbids, arriving through the one channel it was sure it had fixed. And the energy wash walks `0 → 1440` only, so the last hour of the chart has no background on *any* row while the block that caused it sits in that hour. |

### B91 — The energy wash is drawn in a different coordinate space from the blocks
| | |
|---|---|
| **Setup** | Reference week, ordinary content: Mon–Fri each hold three tagged tasks between 09:00 and 18:00; nothing before 08:00 or after 23:00. So the shared axis spans **480 → 1380** (08:00 → 23:00) after the hour-rounding. Buckets are the shipped `STARTER_BUCKETS`, so every task carries load and the wash has something to say. |
| **User action** | Generate the wrap report. Then print it (`@media print`) and look at the left and right edges of each strip. |
| **Expected** | The wash and the blocks occupy **the same track**. The wash was widened from `winFrom…winTo` to the whole day on 2026-09-07 at the user's explicit instruction ("it shouldn't only be during day hours"), which is right — but the track it is painted into is still the shared **axis**, not the day. So the segments outside `axisFrom…axisTo` must be **clipped to the track**, not merely positioned relative to it. Nothing may paint outside the strip's own box. |
| **Why it's risky** | The shade walk emits segments from **0 to 1440**; the renderer positions everything with `pc(m) = (m − axisFrom) / span × 100`. `pc(0)` is therefore **negative** — roughly −53% on an 08:00 axis — and `pc(1440)` is over 100. The track has a fixed 13px height and **no `overflow: hidden`**, so the first and last shade segments render outside their own row: a 0.055-alpha wash bleeding under the day label on the left and off the page on the right, on every row, in every report. It is invisible in review precisely because 0.055 alpha over paper-coloured background is almost nothing on screen and is exactly the kind of thing print makes visible. This is the same class as the failure the widening fixed — **a wash whose domain and whose denominator are two different intervals** — reintroduced by fixing only one half. |

### B92 — Two overlapping tasks make the wash walk backwards
| | |
|---|---|
| **Setup** | Wed **2026-09-09**. "Reading group" 09:00–17:00 (8 h, tag `study`, load mental +2). Inside it, "Coffee with Sam" 10:00–11:00 (tag `social`, load social +1). Overlapping tasks are legal — the grid is 24 h and R-1 lets a user drop anything anywhere — and this is the ordinary shape of a long block with something inside it. |
| **User action** | Generate the wrap report; read Wednesday's strip. |
| **Expected** | Wednesday's background darkens monotonically through the day and **each minute is shaded exactly once**. Whatever the reserve curve says, one minute of clock time must carry one opacity. |
| **Why it's risky** | `reserveWalk` sorts by `startTime` and pushes a point at each task's **`endTime`**. Sorted by start, the points come out at **17:00 then 11:00** — non-monotonic. The strip's walk is `if (at > prev) push(prev→at); prev = at;`, so it emits `0→1020`, then sets `prev = 660` (walking *backwards*, dropping the segment), and the tail push then emits `660→1440`. The result is two shade spans that **overlap between 11:00 and 17:00**, and since they are absolutely-positioned translucent boxes their alphas **compound**: six hours of Wednesday shade darker than the arithmetic says, for no reason a reader could ever reconstruct. The second symptom is quieter and worse — `depth` is applied to the interval *after* each point, so the first segment of every day is always `depth: 0`; a day that starts at 08:00 already deep in debt from yesterday shades as if it started fresh. Nothing throws, nothing is `NaN`, and the chart looks plausible. |

### B93 — The wash saturates at four steps, and the key says otherwise
| | |
|---|---|
| **Setup** | Two weeks. Week A (Mon 2026-09-07): a gentle week whose deepest reserve debt is **8 load-hours** across the four axes. Week B (Mon 2026-09-14): a punishing week whose deepest debt is **34 load-hours**. Both reports carry the key line "each step is 2 load-hours not yet recovered." |
| **User action** | Generate both reports and lay them side by side. |
| **Expected** | The absolute-step decision (A24's move, restated for the wash) exists precisely so that **a punishing week and a gentle one do not shade identically** — that was the deleted day-shapes chart's fatal flaw, scaling to `deepest`, the week's own worst day. Two weeks four times apart in depth must be visibly different, or the sentence promising an absolute scale is not true of the drawing. |
| **Why it's risky** | Opacity is `Math.min(4, Math.ceil(depth / shadeStep)) * 0.055`. The cap bites at **8 load-hours**, so week A is already at maximum darkness and week B — four times deeper — is byte-identical to it. Every genuinely heavy week in a user's life renders as the same grey. The printed key then makes it worse rather than better: "each step is 2 load-hours" invites the reader to *count* steps off the shading, and the shading stops counting at four. This is the "last chart that measured itself against itself" fixed in one direction and re-broken in the other — a fixed scale is not an absolute scale if it clips. Note also `Math.ceil(depth / shadeStep)` divides by a value read off the view model rather than a literal; `shadeStep: 0` yields `Infinity`, which `Math.min(4, …)` swallows into full darkness instead of erroring. |

### B94 — A week in which everything was skipped: two sections on the same page disagree
| | |
|---|---|
| **Setup** | Reference week. Twelve tasks were placed Mon–Fri (18 h total). The user was ill and marked **every one** `skipped` — a legitimate outcome, and §0 says so in as many words. No completions, no ratings. |
| **User action** | Generate the wrap report and read the Statistics section top to bottom. |
| **Expected** | One number, one meaning. Whatever the page decides "this week held 18 hours" means, the sand bars, the day strips and the Accomplished section must agree on it — and per P-1 the emptiness must read as fact, never as reproach. "Nothing ran this week" is a fact. A page that shows 18 hours of bars above an empty timeline is neither. |
| **Why it's risky** | The two builders filter differently and neither is wrong on its own. The strips drop skipped work deliberately (with a good argument: with one ink weight, drawing a skipped block would claim it happened) — so `items` is empty on all seven days, `any` is false, the builder returns `null`, and **the entire "when it happened" section vanishes from the document**. The sand bars read `getWeekLoad`, which counts every task in the week regardless of `completion` — so they show five days of substantial fill. The reader gets a chart saying the week was busy, directly above the absence of the chart that would have said when. Neither number is wrong; the *page* is. And the disappearance is silent: nothing says "this section has nothing to draw", so the report reads as though the strips were never a feature. |

### B95 — "Laid out" is the one word the ledger's number does not mean
| | |
|---|---|
| **Setup** | Commitment "Maths problem sets", `amountMinPerWeek: 240` (4 h). The generator laid out four 60-minute sittings across the reference week: Mon 19:00, Wed 19:00, Thu 14:00, Sat 10:00. The user did none of them and marked **all four** `skipped`. Nothing is marked settled. |
| **User action** | Generate the wrap report; read the commitment ledger table (columns: *commitment · set · laid out · sittings*). |
| **Expected** | The ledger's own copy rule (WEEKLY-PLANNING §4.3) is *"Maths homework — 1h 30m of 2h placed; the week had no room for the rest."* The subject of that sentence is **the packer**, not the person. Here the packer found room for all four hours. The honest row is "4h set, 4h laid out, 4 sittings — none of them ran", and the *skipping* belongs to §7.1's quiet count, not to this table. A row reading "0h laid out" would be a false statement about the app's own behaviour, and the natural reading of it — "the week had no room" — is false in a way that puts the blame on the week. |
| **Why it's risky** | `placedMin` excludes skipped sittings, and it is **right to**, for the reason its own comment gives (D-12: a skipped sitting is outstanding work, and a top-up may re-place it; counting it left a week that skipped everything reporting itself fully covered). That is the *generator's* meaning of "placed". The report imports the same field under a column headed **"laid out"**, where it means something else entirely — and the sittings count is filtered the same way, so the row reads `4h · 0h · —`. This is the ledger's warned-about trap (`state` is `now`-relative, read the arithmetic instead) avoided on one field and walked into on the next: the fix was "don't read `state`", and the fields it recommended instead carry the same time-dependence in different clothes. A P-1 tripwire sits on top of it — a row of zeros beside an amount the user typed themselves reads as a scorecard no matter how neutrally the header is worded. |

### B96 — A settled commitment makes an otherwise-empty week print the wrong empty page
| | |
|---|---|
| **Setup** | Reference week. Zero tasks — the user was away. One commitment, "Thesis reading", `amountMinPerWeek: 240`, covering the term. On returning, the user marks the week **settled** ("I did it on the train"), which per D-13 overrides the arithmetic and means the week owes nothing. |
| **User action** | Generate the wrap report for `2026-W37`. |
| **Expected** | Two different empty pages exist and the distinction was decided deliberately: a genuinely empty week gets "Nothing was scheduled this week. A quiet week is a week." — and a week that **owed something** gets its own sentence with the packer as the subject, because a commitment is exactly what there was to report. This week owed 4 h and the user has said it happened. The page must therefore say *something* about the commitment. Whether "settled" reaches the quiet page at all is `UNSPECIFIED` — a settled week is neither "nothing scheduled and nothing owed" in spirit nor "owed but unplaced" in fact. |
| **Why it's risky** | The report's top-level `owedMin` is `commitments.reduce((n, c) => n + c.remainingMin, 0)` — it sums `remainingMin`, not `owedMin`, under the same identifier the row objects use for the amount the user set. A settled commitment has `remainingMin === 0` by construction, so `isEmpty` (`real.length === 0 && owedMin === 0`) is **true**, and the week that had a commitment in it prints the sentence written for a week that had nothing. Every clause of "there's nothing to report and nothing to fix" is false in the one direction that matters, which is the exact wording problem this page was already fixed for once. Two identifiers spelled the same, one holding an amount and one holding a remainder, ten lines apart, is the same shape as the two `parentId` meanings and the two `recurrenceId`/`recurringEventId` fields — nearly the same name, opposite scope. |

### B97 — A session moved into next week is counted by both weeks' reports
| | |
|---|---|
| **Setup** | "Therapy", recurring weekly Thu 15:00–16:00, `anchorDate: 2026-09-03`, no other exceptions. The user cannot make Thu **2026-09-10** and moves that one session to Thu **2026-09-17** — one `move` exception, `{date: '2026-09-10', action: 'move', toDate: '2026-09-17'}`. Nothing else in either week uses recurrence. |
| **User action** | Generate the wrap report for `2026-W37` (the week the session left) **and** for `2026-W38` (the week it arrived in). Read the "the pattern, and the week" paragraph in each. |
| **Expected** | Across the two reports the session is described **once**. W37's pattern put one session on the week and the user moved it out — so W37 reads "1 session, 0 ran as written, 1 you moved". W38's pattern put one session on that week (Thu 2026-09-17, which the pattern itself scheduled) and it ran — so W38 reads "1 session, 1 ran as written". The moved session must **not** be counted as a move in W38 as well, and W37's denominator must **not** lose the session it is reporting on. |
| **Why it's risky** | The week filter is `inWeek(e.date) || (e.toDate && inWeek(e.toDate))` — an exception is in scope for **both** the week it left and the week it landed in. In W38 the exception matches on `toDate`, so `movedIn` is 1; but the occurrence also materialises there, so `occurrences` is 1 too, and `scheduled += occurrences + skippedIn − addedIn` counts it again: W38 reports **2 sessions on a week the pattern put one on**, one of them "moved". Meanwhile in W37 the occurrence does *not* materialise (it went elsewhere) and only `skippedIn` is added back to the denominator — never `movedIn` — so W37 reports **0 scheduled, 1 moved**, and `ranAsWritten = max(0, 0 − 1 − 0)` clamps a **negative** count to zero, hiding the arithmetic error behind a plausible number. The clamp is the tell: a `Math.max(0, …)` on a count that should never be able to go negative is a guard standing exactly where the bug is. |

### B98 — A week whose only recurrence event is one added session
| | |
|---|---|
| **Setup** | "Gym", recurring Mon/Wed/Fri 07:00–08:00, with `effectiveUntil` set so the pattern **does not run** during the reference week (term break). The user adds one extra session by exception on Sat **2026-09-12**: `{date: '2026-09-12', action: 'add', start: '10:00', end: '11:00'}` → occurrence key `2026-09-12#add`. No other recurring task exists. |
| **User action** | Generate the wrap report for `2026-W37`; read the pattern paragraph. |
| **Expected** | A sentence a person can read without flinching. The pattern put **nothing** on this week and the user did one session anyway — which is a good week, and the paragraph must not imply otherwise. If the honest form of the sentence requires a denominator the week does not have, the correct behaviour is to **say nothing**: A9's whole justification is that the denominator is "the pattern's own count… not a target, not a capacity, not anything the app decided". A denominator of zero is not a denominator. `UNSPECIFIED`: A9 never states what the section does when the pattern scheduled nothing but the user did something. |
| **Why it's risky** | `scheduled += occurrences + skippedIn − addedIn` subtracts the added session out of the denominator (correctly — it wasn't in the pattern) leaving `scheduled = 0`, while the guard is `scheduled + added <= 0`, which the `added` term rescues. The paragraph then renders as **"Your pattern put 0 sessions on this week. 0 ran as written, and you added 1 that is not in the pattern."** Read aloud, that is the app telling a person who did an unscheduled workout that zero of their sessions ran as written. Every clause is arithmetically true and the sentence is a P-1 breach by construction — the same shape as the empty-week page whose "nothing to report and nothing to fix" was false in the one direction that mattered. The fix is not new wording on the same numbers; it is that this section has nothing to say and should return `null`. |

### B99 — A routine whose every step was skipped still bills you for the travel
| | |
|---|---|
| **Setup** | Routine "Laundry" authored with three steps (load 5 min active · wash 55 min passive · hang 15 min active) and `travelMin: 10`. On Tue **2026-09-08** the user starts a run and then, in the per-run adjust panel, ticks **skip on all three steps** — the machine was already free, they did it by hand elsewhere. Per the model, a skipped step is dropped from this run's program entirely, so it places no touchpoint and contributes no wait; the saved routine is untouched. |
| **User action** | Generate the wrap report; read "What your routines actually cost". |
| **Expected** | A run with no steps is not a run. Either the row is absent, or it states plainly that nothing ran. What must not appear is a row asserting an elapsed span and an attention cost for a routine that had neither — A10's entire claim to needing no gate is that "nothing is estimated and nothing is invented", and a number produced from an empty program is invented in the most literal sense. |
| **Why it's risky** | `spanMin` reduces the steps array **with `travelMin` as the seed**, and so does `attentionMin`. With every step dropped, both reduce over `[]` and return the seed: `spanMin = 10`, `attentionMin = 10`, `waitingMin = 0`. The `if (!(spanMin > 0)) continue` guard — the only guard in the builder — is satisfied by the travel alone, so the row prints "**10m start to finish, 10m of your attention, 0m waiting**" for a routine that did not run. The guard was written to catch exactly this case and misses it because the quantity it tests is contaminated by the one term that survives an empty program. Second, unrelated exposure in the same builder: `attentionMin` is **not** guarded, and `fmtDur` does not sanitise — a non-finite `durationMin` on one step renders the literal string `NaNm` in the "your attention" and "waiting" columns of a hand-lettered document. |

---

## B. Placement, `arrivalDepletion` and the energy weight (B100–B104)

`w.energy` is three weeks old, its weight was measured rather than chosen, and it is the
only scoring term that can return "no opinion". Every case here is about what happens at
the edges of that gate.

### B100 — One non-numeric weight in the Cabana, and every placement becomes "the first slot"
| | |
|---|---|
| **Setup** | Cabana → Tuning. The user drags the proximity slider and the field commits a non-numeric value — a cleared text input, a locale decimal comma parsed by `Number`, or a value restored from a hand-edited footlocker file. `config.weights.proximity` is now `NaN`; the other five are the defaults. One flexible task "Read chapter 4" (60 min), the reference week half empty. |
| **User action** | Week `⋯` → Re-optimize, twice. |
| **Expected** | Either the Cabana refuses the value at the input (the `endTime` swap guard and the `priority` clamp are the model's own precedent for exactly this), or the normalizer treats a non-finite weight the way the sum-is-zero case is treated — fall back to an even split and carry on. What must never happen is a placement engine that ranks nothing and reports success. |
| **Why it's risky** | `normalizeWeights` reads each weight as `weights.proximity ?? 0` — and **`NaN` is not nullish**, so it passes straight through. The sum is then `NaN`, and the existing guard is `if (sum <= 0)`, which is `false` for `NaN`: the one defence in the function is stepped over by the one value it cannot see. Every returned weight is `NaN / NaN`. `score()` returns `NaN` for every candidate, and the selection loop compares `s > best.score + 1e-9` — false — and `Math.abs(s − best.score) <= 1e-9` — also false — so **`best` remains the first candidate the gap-walker produced**, forever. The app has silently degraded from six-term scoring to "earliest legal gap", with no error, no coral flag, and a Re-optimize that is perfectly stable and perfectly wrong. This is B41's descendant: the sum-is-zero hole was closed, and the same line has a second one two characters wide. |

### B101 — A capacity of exactly zero, and a capacity below zero
| | |
|---|---|
| **Setup** | Two variants of the reference week, both with one flexible task "Essay" (2 h, tag `study`, load `{mental: +2, creative: +0.5}`) and a Monday already carrying 6 h of mental work. **(a)** The user edits `config.energy.capacity.mental` to `0` in the Cabana (or a footlocker file carries it). **(b)** They set it to `-3`. Nothing is calibrated, so `learnedCapacity` returns `null` and the prior is what `arrivalDepletion` divides by. |
| **User action** | Add "Essay" and let it place; then read the energy card. |
| **Expected** | Neither value is a legitimate ceiling and both should be refused where they are typed, on the same footing as `priority` being clamped to 1–5. Failing that, the scoring term must be **inert** rather than inverted: a nonsense denominator means the app has no opinion about arrival state, which is precisely what the `null` return already expresses for a loadless task. The energy term must stay inside `[0, w.energy]`. |
| **Why it's risky** | `capOf` is `(learned ?? prior) || 1`. In (a) the `|| 1` converts a capacity of **0 into 1**, so every load-hour of debt reads as a full axis — a Monday six hours deep scores as maximally depleted and the essay is pushed off Monday by a value the user set to mean "no ceiling". In (b) `Number.isFinite(-3)` is true and `-3 || 1` is `-3`, so `spent / capOf(a)` is **negative**, `Math.min(1, negative)` keeps it negative, `acc / weightSum` is negative, and `scoring.js` computes `1 − depletion` — **greater than 1**. The energy term now exceeds its own renormalized weight and outvotes proximity, balance and buffer combined on a term whose entire published justification is that 0.15 is "the saturation point plus margin". A `|| 1` guarding one wrong value and passing a worse one through is the same shape as the `x.capacity || 1` that printed "8.0/null" on the energy card three commits ago — the fix went into the card and not into the divisor one layer down. |

### B102 — `excludeId` is passed by exactly one of the five callers
| | |
|---|---|
| **Setup** | Wed **2026-09-09**, otherwise empty, holding only "Long lab" 09:00–17:00 (8 h, tag `study`, load mental +2). The user opens the compass (What To Do) at 09:30, and separately asks Find-a-time for a 90-minute slot for a second `study` task, and separately runs the weekly generator for a commitment tagged `study`. |
| **User action** | Read the compass's top pick and its stated reason; read Find-a-time's ranking; read where the generator laid its sittings. |
| **Expected** | All three surfaces answer the same question with the same arithmetic. If placement now excludes the task under consideration from its own arrival state — because scoring candidates for a task already sitting in `schedule.tasks` counted its load as drain the user had supposedly already taken, producing depletion 1 at every later candidate **on an empty day** — then every other reader of arrival state owes the same exclusion, or the app holds two incompatible beliefs about how drained the user is at 14:00 on Wednesday. |
| **Why it's risky** | The `excludeId` option was added to `reserveAt` and to the closure `depletionAt`, and is passed at exactly **one** call site: `findBestSlot`. The one-shot export `arrivalDepletion(schedule, at, load)` takes three arguments and has no way to express it. So the surfaces that rank *existing* tasks — the compass, the openings ranker, the generator's day ranking, and the energy card — still count a task's own load against its own arrival, and now **disagree with placement by construction**: the scheduler will put the essay at 14:00 while the compass explains that 14:00 is when you will be most drained, citing the essay itself. This is the "I added a gate for placement and left three other surfaces reading the old one" failure, four commits after it was written down, in the module the same session was editing. The check that finds it is the habit the record already names: **grep for who reads the thing, not who writes it**. |

### B103 — A nap placed before the grind, and a mixed-sign task placed by whichever axis is louder
| | |
|---|---|
| **Setup** | Thu **2026-09-10**. 09:00–14:00 holds "Dissertation push" (5 h, load mental +2). Two flexible tasks to place, both 45 min, both unpinned, no deadlines: **(a)** "Nap", tags `['rest']` → Rest bucket, load `{mental −1.5, physical −1, creative −0.5}` — every axis negative. **(b)** "Swim", tags `['gym']` → Exercise bucket, load `{mental −1, physical +2}` — mixed sign. Candidate slots exist at 08:00 and at 14:00. |
| **User action** | Add both and let them place. |
| **Expected** | The nap goes **after** the grind (14:00) — restoring work wants the depleted slot. The swim is the genuinely hard one and the spec has no answer: it *spends* physically and *restores* mentally, so "arrive fresh" and "arrive drained" are both true of it on different axes. `UNSPECIFIED`: `ENERGY-PLACEMENT-EVAL` settles the quantity (C3, reserve at sit-down, weighted by what the task draws on) and never says what "what the task draws on" means when the draws point opposite ways. Whatever the answer, it must be **stated**, because the two axes here are weighted 1 and 2 and the result is decided by a magnitude the user typed into a bucket for an unrelated reason. |
| **Why it's risky** | The gate is `weightSum = Σ|load[a]|`, and `Math.abs` is what lets an all-negative load through it in the first place. The sign branch — `frac` for a spender, `1 − frac` for a restorer — was added because without it the nap scored exactly like a spender and was placed **before** the five-hour grind, overriding proximity to do so. Case (a) is the regression test for that. Case (b) is the one the branch does not resolve: `acc += w · frac` for physical (weight 2) and `w · (1 − frac)` for mental (weight 1), averaged over `weightSum = 3`. On a day 8 mental-hours deep and physically fresh, the two terms pull in opposite directions and the winner is 2-vs-1 — so the swim's placement is decided by the Exercise bucket's physical magnitude, a number authored to describe the swim, silently repurposed as a tiebreak between two theories of when to swim. Nothing in the code or the docs says this is the rule; it is an emergent property of `Math.abs` in the weight and a ternary in the term. |

### B104 — A tag no bucket carries, and the wash that says the day was free
| | |
|---|---|
| **Setup** | The user creates a tag `placement` for their teaching placement and never adds it to a bucket (the starter set carries `study`, `work`, `gym`, `chores`, `social`, `rest` and others, but nothing matches `placement`). Fri **2026-09-11** holds one task: "School placement", 08:00–17:00, 9 h, tags `['placement']`, no other tags. Nothing else all week. |
| **User action** | Generate the wrap report and read Friday's strip; then open the energy card; then add a flexible 1 h task and see where it lands. |
| **Expected** | The app must be able to say **"I don't know what this costs you"** and must not say "this costs you nothing". P-2 forbids inventing a ceiling; it equally forbids asserting a floor. A nine-hour day the app has no load model for must not shade as the emptiest day of the week, and it must not be the day the scheduler prefers to add work to. The honest render is an unshaded row that says why — the same argument the energy card already makes for drawing **no bar** on an axis with no earned ceiling: drawing nothing claims nothing. |
| **Why it's risky** | `loadForTask` returns `zeroLoad()` when no bucket matches — a **truthy object of four zeros**, which is not the same thing as `null` and is treated everywhere as data. So: `depthOf` is 0 for the whole of Friday, and Friday's strip has the **palest background of the week** on its heaviest day; `arrivalDepletionFor` gates the *placed* task to `null` (no opinion, correct); but `reserveAt` walks Friday and adds nothing, so every *other* task scored on Friday sees a day with no debt in it and the balance term sees a day that is full — two terms, opposite readings, on the same day. The bucket filter compounds it: `buckets.filter(b => b.load && …)` looks like a guard and is not, because `Bucket`'s constructor runs `normalizeLoad` and `b.load` is therefore **always truthy** — an all-zero bucket "matches" and pins `buckets.length !== 0`, so a tag the user *did* file, into a bucket they never gave values to, is indistinguishable from a tag no bucket carries. HANDOFF already records a real user found with 16 tags and 0 buckets and no sign the feature existed; this is that state one tag at a time, and the starter buckets do not fix it because a new tag is new. |

---

## C. The learning model's skill gate and cross-validation (B105–B108)

`_assessSkill` is the newest and most consequential gate in the app: it decides whether the
model is allowed to steer placement *and* whether it is allowed to speak in three other
surfaces. `null` and `0` mean opposite things and are one character apart.

### B105 — A user whose whole rating history is one recurring series
| | |
|---|---|
| **Setup** | A first-term student. The only thing they have rated is their twice-weekly gym session: **22 ratings**, all on occurrences of one recurring task, written by `rateOccurrence` into `parent.occurrenceData[key].satisfaction`. No one-off task has ever been rated. `coldStartRatings: 10` is comfortably cleared. |
| **User action** | Cabana → **Retrain now**, then Re-optimize the reference week; then open the compass and read the top pick's reason; then read the wrap report's model insight. |
| **Expected** | A model fitted on one series knows one thing about one activity and must not be described, in any of the four surfaces, as having learned about the user. The gate's own doctrine is that **authority is earned by being right, not by rating count**, and that a `null` skill means "too little to split honestly, not no skill". The question this case forces is what "not punished for being small" is allowed to *buy*: silence, or a licence. `UNSPECIFIED` — and it is the highest-value gap in §5, because the two readings are opposite behaviours from the same word. |
| **Why it's risky** | `_assessSkill` groups folds by `t.parentId || t.id`, and every one of those 22 samples is a synthesised occurrence carrying `parentId = <gym task id>`. So `groups.length` is **1**, the `groups.length < 3` guard fires, and skill is **`null`**. `modelMaySpeak` is `!(typeof skill === 'number' && skill <= 0)` — `null` is not a number, so it **passes**. The gate built to stop a model that fits noise from steering the week hands full authority to a model that has seen one activity, precisely *because* it could not be honestly tested. The blast radius is all four doors at once: `w.preference` goes live at 0.15 (taking ~10% off every other weight through renormalization), the compass narrates "you rate this kind of work well right now", the wrap report prints the learned weights, and the Cabana lists them as things the app has learned about the person. And `parentId` is overloaded — project chunks, commitment sittings and routine touchpoints all carry it — so the same collapse happens to a user who rates only their commitment sittings, or only one project's chunks. |

### B106 — Skill survives a retrain that produced no model
| | |
|---|---|
| **Setup** | A user with 30 well-spread ratings and a genuinely useful model: last `train` produced `skill = 0.19`, so the model steers and speaks. They then delete their rated tasks in a tidy-up — via §3.10's confirming path, which states the ML data loss — leaving **zero** rated samples. Rollover fires, or they press **Retrain now**. |
| **User action** | Re-optimize; open the compass; open the Cabana's model line. |
| **Expected** | With no samples there is no model, and every surface must fall silent. The Cabana line was rewritten specifically to say *why* the model is quiet — "not yet steering", "no better than guessing", "the last fit did not converge" — so it has a vocabulary for this and must use it. |
| **Why it's risky** | `train` has two early returns before `this.skill` is assigned: the zero-samples path and the divergence guard (any non-finite weight → zero the weights, reset the gates, `trained = false`). Both leave the **previous** `skill` in place. So `skill` stays `0.19`, `modelMaySpeak` sees a positive number and passes, and `_modelScore` is asked for a score from a model with no weights. The user is then told, in the Cabana, that the app has learned things about them, sourced from a fit that no longer exists. The divergence half is the sharper one: divergence is the case the guard was written for, and it is the one path on which the *other* guard's state is stale. Two guards, one door each, and the door between them is unlatched. |

### B107 — Twelve ratings, all fives, and the gate turns the model off for the user doing everything right
| | |
|---|---|
| **Setup** | A user who has rated exactly **14** completed tasks across **4** distinct one-off tasks and projects, `overall` between 4 and 5 on every one — they have been arranging their week well and it shows. `coldStartRatings: 10` is cleared; `_assessSkill`'s own floor (`rated.length < 12` → `null`) is cleared; `groups.length >= 3` is cleared. |
| **User action** | Cabana → Retrain now, and read the model line. |
| **Expected** | Whatever the gate decides, the Cabana must state it as a fact **about the model**, never about the person — the line exists precisely because "40 ratings, trained" said nothing about whether it works. "Tested against ratings it hadn't seen, and it did no better than your average" is a fact about a fit. Anything that reads as "your ratings are not useful enough" is P-1 in the one surface the user came to specifically to look at the model. |
| **Why it's risky** | Each fold trains a throwaway `LearningModule` on ~11–12 samples — **below `coldStartRatings`** — and `modelScore` returns a hard `0` under that threshold. So `pred` is 0 for every held-out sample while `truth` is ~0.85 (a 5 maps to 1.0, a 4 to 0.75), `errModel = Σ truth²` is enormous, `errMean` is tiny because the ratings barely vary, and skill comes out **strongly negative** — not marginally, catastrophically. The gate then reports the model as measured-and-failed and silences it in all four surfaces. The cause is not the fit: it is that the cross-validator's sub-models are gated by the *same count threshold* they are being used to evaluate, so the assessment is guaranteed to fail for every user between 12 and roughly 20 ratings — the entire population the gate was built to protect. Note the reciprocal boundary in the same function: `errMean === 0` (a user who rates everything identically) returns `null`, which **passes**, so perfect non-variance is trusted and near-perfect variance is not. |

### B108 — A rating saved before `endAt` existed teaches the model that you like zero-minute sessions
| | |
|---|---|
| **Setup** | A save from an older schema. `occurrenceData['2026-06-15']` on the weekly gym task holds `{completion: 'done', satisfaction: {overall: 5, timingFit: 1}, at: 1750000000000}` — an `at` but **no `endAt`**, because the field was added later. Eleven such legacy occurrence ratings exist alongside nine current ones. |
| **User action** | Cabana → Retrain now; then read the plain-language preferences and the wrap report's model insight. |
| **Expected** | A sample whose duration cannot be recovered must be handled the way its own sibling case already is: `ratedSamples` deliberately **skips** an occurrence with no stamped `at`, on the stated grounds that reconstructing its time from today's pattern would be a guess presented as data. A missing `endAt` is the same guess about the same object, so either the sample is skipped, or the duration feature is left unset for it — never defaulted to a value that means something. |
| **Why it's risky** | `ratedSamples` synthesises `endTime: od.endAt ? new Date(od.endAt) : start`, so a legacy sample gets `endTime === startTime` and `getDuration()` of **0**. The feature vector's duration one-hot uses `DURATION_EDGES = [15, 30, 45, 90, 150, 240]`, so 0 lands in the **first bucket** — the same column a genuine 10-minute task uses. Eleven five-star gym sessions therefore train the column "very short sessions" with a strong positive weight, `modelScore` starts preferring the shortest available slot, and the Cabana renders it in plain language as a preference for short sessions that the user has never expressed. The two halves of the same function disagree about what a missing field means — `at` missing is a reason to drop the sample, `endAt` missing is a reason to invent a zero — and the invented zero is not neutral, it is a *category*. This is also the case that would have shown up in the "identical ratings taught the model that you prefer study" family and did not, because the fixture never contained a pre-`endAt` save. |

---

## D. Commitments and generated sittings (B109–B111)

The generator is engine-only code proven by printing placements, and its conservation
rule — `placed + shortfall === amount`, never crammed — is the whole contract. Two of
these cases are about callers who reach it without passing through the door that keeps it.

### B109 — A commitment of amount zero, reached from the wrong side
| | |
|---|---|
| **Setup** | Commitment "Language practice", `amountMinPerWeek: 0`. The user set it to zero on purpose — they are pausing it for the term but want to keep the row, its tags and its `minSitting: 30` for when they come back. It is `from`/`until`-bounded across the reference week, so it covers it. |
| **User action** | Cabana → Commitments → **Lay out this week**. Then, separately, whatever surface calls the generator over *all* commitments at once (the weekly "lay next week out" flow, A36). |
| **Expected** | Nothing is placed and nothing is claimed. Zero is a real answer here — the amount validator accepts 0 deliberately, unlike `minSitting`/`maxSitting`/`maxPerDay`, which treat 0 as missing and fall back — so "0 minutes owed" must produce zero sittings, no shortfall, and no ledger row. Per P-1 the pause must also not be narrated: a commitment set to zero is not a lapsed commitment. |
| **Why it's risky** | The zero is guarded in exactly two places, **both in `commitmentWeek.js`** — `state = 'outside'` when the amount is 0, and `layOutWeek`'s filter on `state === 'owes' && remainingMin > 0 && input`. The generator itself has no such guard, and its own comment records that this was already found once: without the state rule, "it reached the generator with `amountMin: 0`, and `chooseSittings`' running total satisfies `>= 0` on the first gap, so it booked a sitting for work the user had set to zero." The fix went into the caller. So any second caller — the multi-commitment path, a probe, the "lay next week out" flow being designed now — reintroduces it in full: `effectiveMinSitting()` is `min(minSitting, amount)` = **0**, so `sMin` is 0, every gap passes the usability filter, and the greedy loop books a **zero-minute sitting** (`endTime === startTime`) on Monday morning. That task then has `getDuration() === 0`, which lands in the learning model's first duration bucket (see B108), draws a zero-width block on the day strip, and contributes 0 to `placedMin` while occupying a row in the ledger. **One guard, in the caller, for a rule that belongs in the engine** — the exact shape of the `clearRange` ownership predicate that was optional-by-comment until it deleted a week. |

### B110 — A 20-minute commitment books 30 minutes and reports no shortfall
| | |
|---|---|
| **Setup** | Commitment "Duolingo", `amountMinPerWeek: 20`, `minSitting: 30` (left at the default), `maxSitting: 180`, `maxPerDay: 1`. The reference week has exactly **one** usable gap of 45 minutes, on Sat 2026-09-12 10:00. |
| **User action** | Lay out the week; then read the commitment ledger in the wrap report. |
| **Expected** | The user asked for 20 minutes. The engine's stated invariant is `placed + shortfall === amount` and its stated bias is that **a shortfall is stated, never crammed**. So either one 20-minute sitting is placed (the `minSitting` floor yields to an amount smaller than it, which is what `effectiveMinSitting()` exists to express), or nothing is placed and a 20-minute shortfall is reported. What must not happen is 30 minutes on the grid described as satisfying a 20-minute commitment. |
| **Why it's risky** | The single-sitting branch of `chooseSittings` computes `Math.min(Math.max(amountMin, sMin), gap.minutes, sMax)` — `max(20, 30)` is **30** — and then reports `shortfall: 0`. The invariant is broken by 10 minutes in the *user's* direction, which is the direction nobody writes a test for. It is saved today by exactly one thing: `Commitment.effectiveMinSitting()` clamps `minSitting` down to the amount, and `engineInputForWeek` substitutes it on the way past. That is a **view**, deliberately never written back, so the stored `minSitting` is still 30 — and any caller that builds an engine input by hand, or reads `commitment.minSitting` directly, reopens it. The engine was proven by printing placements against a fixture whose amounts always exceeded `minSitting`, so the branch has never been exercised in the direction that fails. Note the neighbouring branch is worse: the "fold the remainder back into the previous sitting" path is **unreachable** — its `room` is computed as `min(prev.minutes, sMax) − prev.minutes`, and `prev.minutes` was already capped at `sMax` upstream, so `room` is identically 0 and the condition can never be true. A conservation lever that has never once fired is indistinguishable from one that works. |

### B111 — A week the user blocked, and the "I did it anyway" mark
| | |
|---|---|
| **Setup** | Commitment "Thesis reading", `amountMinPerWeek: 240`, `dueDay: 'sun'`. The user blocks **every day** of the reference week via `blockRange(Mon 2026-09-07, Sun 2026-09-13, 'Fieldwork')` — seven full-day protected blockers, so `computeWindows` yields nothing on any day. They lay the week out anyway, get nothing, and later — having read on the train — open the commitment and mark the week **done**. Then they change their mind and unmark it. |
| **User action** | (1) Lay out the week on the blocked schedule. (2) Mark the week done. (3) Unmark it. (4) Generate the wrap report. |
| **Expected** | (1) Zero sittings and a stated shortfall of the full 240 minutes — the packer found no room, and the sentence's subject is the packer, not the person (the C4 design case is literally `0/240m short 240m`). (2) The mark overrides the arithmetic per D-13 and the week owes nothing; the ledger still reports honestly that 0 h is on the grid. (3) **Unmarking must restore the state that marking destroyed**, or the toggle is not a toggle. (4) The report must distinguish "the week had no room" from "you did nothing" — the two are the same numbers and opposite facts. |
| **Why it's risky** | `markCommitmentWeekDone` **removes unresolved sittings** from the schedule, keeping only ones already resolved; `unmarkCommitmentWeekDone` clears the flag and **does not resurrect them**. So the round trip is lossy in the one direction a user will actually travel — mark, then think better of it — and what comes back is a week with the flag off, no sittings, and `remainingMin` back at the full amount: the app has silently converted "I did this away from the app" into "you have four hours outstanding and no plan". The blocked-week half is a second seam: blocked days get `capacityMin: 0` from the query layer, so the sand bars draw no capacity tick, the day strips still contribute the *window* bounds to the shared axis (`dayWindowBounds` returns a window for a blocked day regardless), and the ledger's row says "4h set, — laid out". Three surfaces, three different opinions about whether Monday exists. And `sittingsFor` selects by **calendar day string keys**, while the report's routine section selects by a half-open millisecond range and the strips select by grid day — a commitment sitting placed at 23:30 Sunday and a routine touchpoint at 00:30 Monday are, between them, in three different weeks depending on which section is asking. |

---

## E. Recurrence exceptions and the occurrence key (B112–B114)

The multi-session key (`YYYY-MM-DD`, `#2`, `#add`) exists so that "the evening dose" and
"one extra this week" are expressible. It is a string with structure, and three separate
places take it apart with different tools.

### B112 — An unpadded window time renumbers the day and takes the lived data with it
| | |
|---|---|
| **Setup** | "Medication", recurring daily, **two** windows on each weekday: one at `start: '9:00'` (typed by hand into the recurrence editor, or arriving from an import that does not zero-pad) and one at `start: '21:00'`. Occurrence keys for Wed 2026-09-09 are therefore `2026-09-09` and `2026-09-09#2`. The user has been rating and completing the **morning** dose for six weeks; `occurrenceData['2026-09-09']` and its five predecessors hold that history. There is a standing `skip` exception on `2026-09-09#2` — they never take the evening one on Wednesdays. |
| **User action** | Open the recurrence editor and change nothing but the *evening* window's start from `21:00` to `20:00`. Save. Then look at Wednesday, and at the six weeks of history. |
| **Expected** | Editing the evening window must not touch the morning one. The session ordinal is documented as coming from the window's **declared** time precisely so that "moving a session cannot renumber it and carry its lived data to a different one" — that guarantee is the whole reason the numbering is declared-time-based rather than adjusted-time-based, and it must survive an edit to a *different* window on the same day. |
| **Why it's risky** | The ordinal is assigned by sorting the day's entries with `String(a.w.start).localeCompare(String(b.w.start))` — a **lexical** compare on the raw string. `'21:00'` and `'9:00'` sort as `'2' < '9'`, so the *evening* dose has always been session 1 (bare key) and the morning dose session 2. Six weeks of morning ratings are sitting under keys the app believes describe the evening. The moment the evening window is edited to `'20:00'` nothing changes (still `'2' < '9'`); edit it to `'8:00'` and the order flips, and every one of those six `occurrenceData` entries silently re-attaches to the other dose. Nothing errors, nothing is lost, and the wrap report's tag×time satisfaction matrix quietly moves six data points from morning to evening. Zero-padding is the invariant the sort depends on and **nothing enforces it** — `resolveTime` accepts `'HH:MM'`, a `Date`, or an epoch number, and `normalizeExceptionTimes` converts `Date` to `'HH:MM'` on save but leaves a raw number alone. Three accepted representations, one lexical sort. |

### B113 — Adding an extra session deletes the skip on the same day
| | |
|---|---|
| **Setup** | "Gym", recurring Mon/Wed/Fri 07:00–08:00. On Wed **2026-09-09** the user skips the morning session — `{date: '2026-09-09', action: 'skip'}`. Later the same day they decide to go in the evening instead and add an extra session: `{date: '2026-09-09', action: 'add', start: '18:00', end: '19:00'}` → key `2026-09-09#add`. This is the everyday shape of "skip today, do it tomorrow" pointed at the same day, and the `#add` namespace exists specifically so that an extra session on a day the pattern already fills is expressible. |
| **User action** | Skip the 07:00 occurrence via the occurrence menu, then add an 18:00 session on the same date. Reload the week. |
| **Expected** | Both exceptions hold. The 07:00 session is gone and an 18:00 session exists — that is the entire point of giving added sessions their own namespace rather than the next free ordinal. The occurrence menu offers Move / Skip / Cancel with **no silent default** (§3.1), and nothing about adding a session is a decision about skipping one. |
| **Why it's risky** | `addException` replaces by **bare date key**: `exceptions.filter(e => e.date !== dateKeyStr)` before pushing the new one. The `add` therefore **removes the `skip`**, the 07:00 occurrence reappears, and the user's week now shows two gym sessions on the day they went once. The suffix machinery is doing its job everywhere it is read — the expander matches exceptions on the *session* key, and the `#add` namespace never collides — and the one function that *writes* them keys on the date. It is the same asymmetry as `dateOfOccurrence()`, which strips the suffix and has exactly two callers, both in drag handling: the codebase treats the key as opaque by policy and as a date in the two places that mutate. Downstream, the pattern-vs-week diff counts `skippedIn` and `addedIn` off the same array, so the report will describe a week that never existed — and no error, no toast, and a schedule that looks merely wrong rather than corrupt. |

### B114 — A session moved across midnight
| | |
|---|---|
| **Setup** | "Late seminar", recurring weekly Thu 20:00–21:30. The user cannot make Thu 2026-09-10 and moves that session to Fri 2026-09-11 **23:00–00:30** — the only slot they have. The exception is `{date: '2026-09-10', action: 'move', toDate: '2026-09-11', start: '23:00', end: '00:30'}`. |
| **User action** | Write the move from the occurrence menu, then view the week, then generate the wrap report, then export to `.ics`. |
| **Expected** | The session renders as one box in Friday's grid column (per SE-5, 00:30 is before the 5am anchor, so both ends belong to the same grid day and it is *not* cut), the identity stays `late-seminar@2026-09-10` so the lived data follows the session rather than the date, and every surface agrees it is 90 minutes long. |
| **Why it's risky** | Pass 2 of the expander resolves both times against **the host date**: `resolveTime(host, '23:00')` and `resolveTime(host, '00:30')` both land on 2026-09-11, so `end` is **fourteen and a half hours before `start`**. Nothing normalises it — the emit gate checks the *start* only. From there every consumer disagrees in its own way: `Task.getDuration()` on a materialised occurrence is negative or, via the `end<=start → swap` guard, becomes a 22.5-hour session; `durationHours` in the reserve walk is `Math.max(0, …)` so the energy battery reads **zero drain** for it; the day strip's `scheduledMin` is `Math.max(0, to − from)` so Friday's row shows 0 minutes with a block drawn at negative width; and `getWeekLoad` clamps it to the window and contributes nothing to the sand bars. Five surfaces, five different wrong answers, none of them an error. The `end<=start` swap guard on the model is exactly the defence that should catch this and it is on the **constructor**, while `emit` builds the occurrence field by field — the same route by which `buildOccurrence` lost `load` and `activityId`. `UNSPECIFIED`: §4.2 gives the exception shape as `{date, action, start?, end?}` and says nothing about a `move` whose window crosses a day boundary, which is the one shape a person moves a session *into*. |

---

## F. Interchange — the two doors (B115–B116)

Both doors have destroyed real data once. These are the seams next to the seams that
were fixed.

### B115 — Exporting a term whose pattern has been edited, with a skipped second session
| | |
|---|---|
| **Setup** | "Statistics lecture", recurring **twice on Tuesdays** (09:00–10:00 and 15:00–16:00), `anchorDate: 2026-09-01`, term-bounded with `effectiveUntil` in December. Mid-term the user permanently moved the afternoon lecture, which built a **period split** — so `recurrence.periods` now holds a closed slice (Sep–Oct) and a current slice (Oct–Dec). They have also skipped the afternoon session of one week: `{date: '2026-10-06#2', action: 'skip'}`. |
| **User action** | Cabana → export `.ics` (`sandy-cay.ics`), open the file, and separately push to Google. |
| **Expected** | The exported rule describes the pattern **as it runs now**, the EXDATE names a real instant, and `UNTIL` names the last day the lecture actually runs. Ranges are half-open inside and inclusive at every edge, and `lastRunDay`/`untilAfterLastRun` are the only functions allowed to cross that boundary — "every edge must use them", which the `.ics` writer and reader both are. |
| **Why it's risky** | Three failures stack in one file. (1) The rule builder picks `periods.find(p => !p.effectiveUntil) || periods[0]`. A **fully bounded** term has no open-ended period, so the fallback fires and it exports `periods[0]` — the **oldest closed slice**, the pattern the user stopped using in October. The same expression appears in four places, so the `.ics` file, the Google RRULE, the split-part encoder and the sync hash all agree on the wrong period, which is what makes it invisible: nothing disagrees with anything. (2) The EXDATE line is built from the exception's `date`, which here is `'2026-10-06#2'`; parsing that as a date yields `Invalid Date`, `toICSDate` emits **`NaNNaNNaNTNaNNaN00`**, and it survives the `.filter(Boolean)` that is the only guard on the list — a malformed line in a calendar file that other clients will reject wholesale or, worse, accept and ignore, so the skipped lecture reappears on every device the user owns. (3) The multi-session pattern hits the `windows-differ` refusal on the Google side (a rule carrying more than one `start-end` cannot be expressed as one RRULE), so the *reason* is recorded on the event — and the `.ics` path has no equivalent refusal and emits something anyway. The two doors disagree about whether this task is exportable at all. |

### B116 — A term's holidays import as timed tasks the night before
| | |
|---|---|
| **Setup** | The user imports their university calendar from Google. It contains eight all-day events — "Reading Week", "Bank Holiday", "Term ends" — each with `start.date: '2026-11-23'` and `end.date: '2026-11-30'` and no `dateTime`. It also contains their weekly lecture series. The user's machine is on a **negative** UTC offset (they are studying abroad). |
| **User action** | Import ← Class Schedule, review the plan panel, confirm. |
| **Expected** | An all-day event is a **day note**, not a task — the `.ics` door already knows this, sets `allDay` from `VALUE=DATE`, converts the exclusive DTEND back to an inclusive last day, and plants it as a note. That behaviour was built because "every holiday arrived as a 24-hour task on the wrong day", and the fix must hold for **every route in**, which is why the refusal for `sc.*` events was put in core rather than in one door. The Google door must reach the same answer. |
| **Why it's risky** | The Google normaliser does `ev.start.dateTime || ev.start.date` and **never sets `allDay`**. So `new Date('2026-11-23')` is parsed as **UTC midnight** — the evening of the 22nd in a negative offset — the all-day branch is never taken, and each holiday lands as a *timed* `fixed` task at 19:00 on the wrong day with a 60-minute default duration, because the end is also mis-parsed and fails the `end > start` test. Eight of them, in the week the user is trying to plan. The `.ics` path is correct and the Google path is not, which is precisely the shape of the bug the same import door was just fixed for: `recurrenceId` versus `recurringEventId`, "two fields, nearly the same name, opposite scope", where the line was right for `.ics` and catastrophic for Google. That fix moved dedupe into a pure, decision-logged planner so it could be tested without a network — and the planner's address space is keyed on `source.uid` **scoped to `calendarId`**, with `null` deliberately not a wildcard, so a hand-made task is invisible to it. A holiday imported as a task on the wrong day is therefore also outside the wipe scope of the next refresh: it is created once and never cleaned up, and re-importing on Monday adds eight more. |

---

## G. The undignified state (B117)

### B117 — The fall-back Sunday: twenty-five hours, one repeated hour, and four surfaces
| | |
|---|---|
| **Setup** | Week Mon **2026-10-26** → Sun **2026-11-01** (`2026-W44`). The local zone observes US DST and Sun 2026-11-01 is the fall-back day: the wall clock reads 01:00–02:00 **twice**, so the calendar day is 25 hours long. Sunday's window is 10:00–23:00 (`lightDay`, `maxTasks: 2`). On the grid: a recurring "Sunday long run" occurrence at 08:00–09:30, one flexible task the user dragged to **01:30** (legal — the grid is 24 h and R-1 lets the hand go anywhere), and a commitment sitting at 21:00. Every task carries a bucket load. |
| **User action** | Open the week; run Re-optimize; generate the wrap report for `2026-W44`; read Sunday's row on the day strips and Sunday's bar on the sand chart. |
| **Expected** | `UNSPECIFIED`, deliberately and at four levels, and this is the finding. §1's only rule is "all date math local-time, minute precision, seconds zeroed", and HANDOFF states plainly that the spec says local-time and **never mentions DST**. What must be decided: (a) which of the two 01:30s the dragged task occupies, and whether it is drawn once or twice; (b) whether Sunday's capacity is the window (10:00–23:00 = 780 min, unaffected — the repeated hour is outside it), which is almost certainly right and must be *asserted*, not inherited from whichever subtraction the code happens to do; (c) whether the day strip's x-axis is 1440 minutes or 1500; (d) whether the energy reserve walk double-counts the repeated hour. Whatever the answers, the **user-visible** requirement is narrow and testable: Sunday's capacity is 780 minutes, the sand bar's denominator does not move, no card is drawn twice, and nothing anywhere says the day was 4% emptier than it was. |
| **Why it's risky** | Nothing here throws, and every subsystem is wrong in a different unit. `dayCapacityMin` derived from the window strings is safe; derived from `endOfDay − startOfDay` in milliseconds it returns 1500 and Sunday's `fillRatio` silently drops by 4%, which then feeds `balance` scoring for every task in the week and the overpack detector's break arithmetic. The day strip computes `minsFrom(d) = (d − midnight)/60000`, so a 23:30 task on the fall-back Sunday sits at minute **1470** and stretches the shared axis on all seven rows — the same failure as B90 arriving from the calendar rather than from the user. The reserve walk multiplies each task's load by `(end − start)/3600000`, which is *correct* real elapsed time and therefore **disagrees with the wall clock** by an hour for anything spanning 01:00 — so the energy wash and the grid tell different stories about the same block. And `sleep.minHoursBeforeNextDay: 8` clips tonight's window by counting hours to tomorrow's first commitment; on the spring-forward weekend (Sun 2027-03-14, where 02:00–03:00 does not exist) the same subtraction gains an hour and the guard that exists *specifically for the early mornings* is off by one on the two weekends a year when the early morning is different. The drift detector then has a standing invitation to learn a phantom pattern shift from it — `driftMin: 30` against a one-hour artefact, once a year, in the same direction every time. |

---

## Top 10 most likely to be broken

Ranked by `P(broken) × blast radius`, on the assumption that everything above is written
by people who have already read this repo's own bug record.

1. **B100 — a non-numeric weight makes every placement "the first slot".** `?? 0` does not
   catch `NaN`, and the guard beneath it is `sum <= 0`, which `NaN` walks straight past.
   The engine degrades from six-term scoring to earliest-legal-gap, app-wide, silently,
   stably, with a green suite. B41 closed the sum-is-zero hole in the same three lines.
2. **B105 — a single-series rating history buys full model authority.** Folds group by
   `parentId`, one recurring task is one group, `groups.length < 3` returns `null`, and
   `null` **passes** `modelMaySpeak`. The gate written so a model must earn authority hands
   it over precisely when it could not be tested — and `parentId` is overloaded across
   chunks, sittings and touchpoints, so three different users reach it three ways.
3. **B107 — the cross-validator's sub-models are gated by the threshold they are testing.**
   Below `coldStartRatings` a fold model returns a hard 0, so held-out error is enormous and
   skill is strongly negative for every user between 12 and ~20 ratings. The gate turns the
   model off for exactly the population it was built to protect, and the Cabana explains why
   in a sentence about the fit that a person will read as a sentence about themselves.
4. **B113 — `add` deletes the `skip` on the same date.** `addException` keys on the bare date
   while every reader keys on the session. "Skip this morning, go this evening" is the
   commonest thing a person does to a recurring pattern, it is two clicks, and the result is
   a duplicated session with no error.
5. **B95 / B96 — the ledger's two words.** `placedMin` means "not skipped" to the generator
   and is printed under "laid out"; the report's top-level `owedMin` sums `remainingMin`
   under the same identifier the rows use for the amount. One makes the app understate its
   own work; the other makes a week with a settled commitment print the empty page.
6. **B102 — `excludeId` is passed by one caller of five.** Placement now excludes a task from
   its own arrival state; the compass, the openings ranker, the generator and the energy card
   do not. The scheduler and the surface explaining the scheduler will disagree, citing the
   same task. This is the "I added a gate for placement and left three other surfaces reading
   the old one" failure, four commits later, in the module being edited.
7. **B92 — the wash walks backwards on overlapping tasks.** `reserveWalk` sorts by start and
   emits points at end, so nested tasks produce non-monotonic points; the strip's walk drops
   a segment and then overlaps two translucent spans whose alphas compound. A long block with
   something inside it is an ordinary Wednesday.
8. **B110 — `max(amountMin, sMin)` breaks conservation upward.** A 20-minute commitment books
   30 and reports `shortfall: 0`. It is held off by a *view* (`effectiveMinSitting`) that is
   deliberately never written back, so any second caller reopens it — and the neighbouring
   fold-back lever is provably unreachable, so a conservation rule nobody has ever seen fire
   is sitting next to it.
9. **B115 — `periods[0]` is the oldest slice, in four places.** A fully bounded term has no
   open-ended period, so the fallback always fires and every export describes a pattern the
   user stopped using. Nothing disagrees with anything, which is why it survives; and the
   EXDATE for a `#2` key emits `NaNNaNNaNTNaNNaN00` into the file beside it.
10. **B90 / B117 — one late block rescales all seven rows.** The day strips share an axis by
    design and derive it from `minutes since that date's midnight`, so a 23:00→01:00 task, or
    a fall-back Sunday, stretches the chart to 25 hours and prints a tick reading `1` to the
    right of `23`. The corpse this chart was built over died of unshared axes.

**Honourable mentions** — real, concrete, and not given a row of their own:

- **`bufferScore` returns 1 for a deadline already past** (`target <= 0 → 1`), so an overdue
  task scores a **full** buffer at every candidate on the largest single weight in the sum
  (`buffer: 0.4`). Meanwhile `carryOver` flags `missedDeadline` and refuses to move it while
  Re-optimize has no such rule — B43's disagreement, now with a weight taking the wrong side.
- **`anchorDate` defaults to `dayStart(new Date())` on revive** when a saved pattern has none,
  so `interval > 1` parity is decided by **the clock at load time** — an every-other-week task
  that lands on different weeks depending on when you opened the app. SE-8 says the engine must
  never read the wall clock; this is a reader inside the deserializer.
- **`fromRRULE` accepts `COUNT` and then ignores it**, importing a 10-session rule as unbounded.
  Stated in a comment, invisible in the UI, and permanent once written back.
- **A 24-hour task** (`00:00→24:00`, or a `.ics` event with `end === start + 1d`) passes the
  `end > start` test, fills a day strip row edge to edge, and multiplies its bucket load by 24
  in the reserve walk — the wash goes to maximum darkness on a day with one item in it.
- **`touchpointsFor` sorts by `stepIndex`, not by time.** Drag one routine step earlier than the
  one before it and `routineWaits` computes a **negative** gap between them; `overrun` compares
  it against `maxWaitMin` and reports nothing, so the one surface that could say "these are out
  of order" is the one that cannot see it.
