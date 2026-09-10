# Sandy Cay — open work

Consolidated 2026-09-10. Everything here is either **reproduced by execution** or
**explicitly flagged as unverified**. Nothing is a guess presented as a finding.

Sources: `design/AUDIT-DETECTORS.md` (12 claim-making surfaces),
`design/AUDIT-SAMPLES.md` (what reaches the evidence pool),
`design/HUNT-B105-B111.md`, `design/USE-CASES-BLIND-3.md`,
`design/ML-HEURISTICS-RECOMMENDATIONS.md`, `design/WRAP-REPORT-ADDITIONS.md`.

---

## 0. Waiting on the user — these block work, not the other way round

| # | Question | Why it blocks |
|---|---|---|
| **Q-1** | **The duration-fit floor.** What's the minimum number of answers before "your break blocks may want to be shorter" may print? | Everything else is built. Current floor is 3, so 2-of-3 clears the 60% bar — the thing reported unfounded twice. Recommendation: **6**, plus don't recommend changing something rated well. Comparison table computed and in `WRAP-REPORT-ADDITIONS.md` R-1. |
| **Q-2** | **Commitments on shrink.** Shrink a sitting — should a NEW block appear for the freed time, or just the owed number move? | The ledger already returns the right number (measured: 240→150 placed, 90 remaining). Projects conserve on resize ("siblings shrink to pay for it"); commitments have no equivalent. If it's the *number* that looks wrong on screen, a screenshot is needed — the engine is correct. |
| **Q-3** | **The phone Google Calendar sync bug — needs describing.** ⚠️ **Nothing verified. Placeholder only.** | Reported 2026-09-10 with no detail yet. What is the symptom: events not arriving, arriving twice, wrong times, wrong day, sync silently not running, or an auth failure? Does it differ from desktop? Which direction — app→gcal, gcal→app, or both? See §5 for what is already known to be wrong in that area, which may or may not be the same thing. |

---

## 1. The app says things that are not true

Ranked by how wrong the user-visible sentence can get. Three of the twelve
surfaces the detector audit found are already fixed (`ed4bf1a`, `a6a3a47`, and
the time bounds below).

- [x] **~~T-1 · `starvationCheck` counts a lifetime, inside a weekly report~~** — done.
      Proven firing on a task **completed in March** inside September's report,
      on a week whose `isEmpty` is `true`. The guard excludes `skipped` but not
      `done`; `buildSuggestions` iterates `sched.tasks`, not `weekTasks`; and
      `displacedCount`/`carriedCount` are lifetime counters. "Pushed 3 times" —
      over what period is unanswerable.
- [x] **~~T-2 · `buildInsight` prints the wrong denominator~~** — done. "Across 24 ratings,
      late evenings run about a shell below your others" where **that column has
      4 observations**. `buildInsight` already computes `observations` per
      column and the JSX drops it — the honest number is in hand at the render
      site.
- [ ] **T-3 · `pinnedRatioNote` says "100% of this week was pinned"** for one
      pinned half-hour. Denominator is scheduled minutes; the headline says
      "this week".
- [ ] **T-4 · `overpackCheck` calls three days of two tasks "packed"** — six
      hours across a whole week. Control that proves it is not merely strict:
      three genuinely saturated **12-hour** days give `packedDays = 0`, because
      `dayGaps` only counts gaps *between* tasks.
- [ ] **T-5 · `steerBias.restorativeFlat` fires on ONE rating.** "Rest's felt
      flat lately" off a single restorative 3. The cold-start gate counts the
      whole pool; `restorativeOveralls` has no floor of its own. It is also the
      largest single bias in the function (0.7 when it stacks).

## 2. The evidence pool

- [x] **~~No time bounds anywhere~~** — done. `ratedSamples({ since })`,
      `detectors.evidenceWindowDays = 56`, and the three readers that print
      time-anchored claims. `retrain` stays deliberately unbounded.
- [ ] **E-1 · One block feeds several denominators.** A session tagged
      `['gym','health','morning']` is a full sample in three separate
      populations — twelve lived blocks produce three independent-looking
      `{count:12,total:12}` findings. The `< 3` floor is cleared once and
      re-cleared free by every co-tag.
- [ ] **E-2 · A one-off later made recurring is counted TWICE.**
      `ratedSamples()` pushes the task if `t.satisfaction` is set *and* walks
      `t.occurrenceData`; `TaskPanel#applyPattern` turns on recurrence without
      clearing `satisfaction`. Three lived Tuesdays → four samples. Worse, the
      pattern row carries the pattern's *current* `startTime`, so editing the
      pattern silently relocates a historical sample.
- [ ] **E-3 · Deleting a recurring pattern deletes its whole rating history.**
      `removeTask` splices the parent; 12 samples → 0, no tombstone, no warning.
      Asymmetric with tag retirement, which was designed to preserve history.
- [ ] **E-4 · A rating on skipped work trains the model.** `skipped` is excluded
      at nine sites in `energy.js` and treated as unrated by the skip-streak
      detector, but a skipped item carrying a `satisfaction` object counts here.
      Reachable without rating anything: `letThemGo`, the clear-day panel, and
      the report's own "Let it go" all set `skipped` while leaving
      `satisfaction` intact. ⚠️ `letThemGo`'s docstring says feeding skips to ML
      is deliberate — the open half is whether a *rating* on one should count.
- [ ] **E-5 · Ninth "one door" instance.** `suggest.js:141`'s
      `lastFinishedLoad` still walks `schedule.tasks`; its two neighbours in the
      same file were converted last pass. Measured: identical workout, one-off
      vs recurring, scores 0.650 vs 0.800 — exactly the missing
      `varietyPenalty`. No false sentence, so it ranks below §1.

## 3. The learning model

- [ ] **M-1 · Cross-validation collapses in the band you are actually in.** Fold
      sub-models are muzzled by the same `coldStartRatings` they are being
      tested against, so every held-out prediction is 0 and skill craters:
      `n=12/3 groups → −49`, `n=14/3 → −34`, `n=12/4 → −27`. At `foldTrain=10`
      the same data gives `−0.039`. **The catastrophic band is n=12–14** — a
      user with a dozen ratings silences their own model.
- [ ] **M-2 · A single-series history buys full authority.** 22 ratings on one
      recurring series → 1 fold group → `skill = null` → `modelMaySpeak()` true,
      `preference` live at 0.088. Reciprocal: identical ratings → `errMean === 0`
      → `null` → full authority.
- [ ] **M-3 · `skill` survives a retrain that produced no model.** `trained`
      goes false while `skill` keeps its old value. Two downstream guards absorb
      most of it; what leaks is a diluted weight vector and `buildInsight`
      leaving its cold branch.
- [ ] **M-4 · A legacy rating trains an invented hour.** `Task`'s constructor
      turns `end === start` into `+DEFAULT_DURATION`, so a 20-minute session
      saved before `endAt` existed trains `dur:45-90`. Lowest reach — legacy
      saves only.
- [ ] **M-5 · Backlog from `ML-HEURISTICS-RECOMMENDATIONS.md`:** closed-form
      solve instead of gradient descent, λ by analytic LOO, per-column shrinkage
      `n_j/(n_j+4)`, `Math.max` capacity estimator, and `priority` — the last
      third of the "remove three columns in one bump" recommendation
      (`moveCount` and `placedByUser` are done).

## 4. Commitments and generation

- [ ] **C-1 · Conservation broken by 10 minutes, through the real button.**
      `Commitment#effectiveMinSitting()` clamps `minSitting` against the week's
      amount, but `layOutWeek` (`commitmentWeek.js:134`) then sends
      `amountMin: p.remainingMin` while keeping that same `minSitting`. A 120m
      commitment with 100m done asks for 20m and gets `[30] shortfall 0` —
      ledger ends at `placedMin 130 / owedMin 120`. No hand-built input needed.
- [ ] **C-2 · Dead branch:** the fold-back at `generate.js:154` is unreachable
      (`room` is identically 0). Costs nothing today; delete or fix.

## 5. Interchange — and the likely home of Q-3

⚠️ **These are separate confirmed bugs. Do NOT assume they are the phone sync
issue until Q-3 is described.**

- [ ] **I-1 · All-day Google events import as week-long timed blocks.** A
      "Reading Week" all-day event arrives as a **timed task starting 19:00 the
      night before**, spanning 10080 minutes, and produces **no day note**. The
      `.ics` door handles the same event correctly (0 tasks, 1 note). Timezone
      off-by-one plus wrong object type.
- [ ] **I-2 · `.ics` export writes a literal NaN.** A `#2` session key produces
      `EXDATE:NaNNaNNaNTNaNNaN00` — the date parser chokes on the ordinal
      suffix. Any calendar importing that file will reject or mangle it.
- [x] **~~I-2 · `.ics` export writes a literal NaN~~** — done. Exception keys are
      SESSION keys (`2026-09-07#2`), not dates; `atLocal` parsed them as dates.
      Also fixed the half nobody had noticed: `hhmmOf` took the first window
      matching the weekday, so skipping the EVENING of a twice-daily pattern
      exported an EXDATE at the MORNING's time — well-formed, wrong session,
      deletes the wrong one in whatever calendar reads it.
- [ ] **I-4 · A twice-daily pattern exports as once-daily.** Found while fixing
      I-2. `toICS` emits one VEVENT per TASK, so two windows on the same weekday
      collapse into a single series at `DTSTART`'s time and the second session
      never reaches the file. Needs a VEVENT per window. ⚠️ This makes I-2's
      EXDATE name a session the export does not contain — correct in our model,
      unresolvable in the file, until this is done.
- [ ] **I-3 · Google `safeRRULE` returns `windows-differ`** for a period-split
      pattern, so a term whose pattern was edited exports without its rule.
      Behaviour may be intentional; confirm before changing.

## 6. Report and UI

- [ ] **R-1 · Routines/duration recommendations** — see Q-1. Denominator is
      understood now; only the threshold is open.
- [ ] **R-2 · Midnight-crossing work is invisible to the wash on both days.** A
      task ending 01:00 contributes to neither day's energy lane, because the
      reserve resets at midnight and the cost lands at the task's end. Design
      question, not a defect.
- [ ] **R-3 · Backlog from `WRAP-REPORT-ADDITIONS.md`:** A22/A30/A31/A33 (Tier 5
      form), the Tier 4 copy pass, A35/A36 sign-off.

## 7. Known-shaky, unverified

- [ ] **U-1 · `applySuggestion`'s apply / let-go paths** are untested end to end.
- [ ] **U-2 · Does a re-optimize re-raise a dismissed overpack notice?** Unknown.
- [ ] **U-3 · `dayWindowBounds` vs the sand-bar axis** — structurally suspicious
      (`placement.js:37` takes `config` and cannot see blocked days), never
      probed.
- [ ] **U-4 · `timingFit` spec-vs-code divergence.** SPEC §5 says the double
      weight applies "on time features"; `learning.js` doubles the whole sample.
      Per-feature weighting is not expressible in one weighted least-squares
      fit, so one of the two has to give. Recorded, not reconciled.
