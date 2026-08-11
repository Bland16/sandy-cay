# Portable brief — ask another LLM for use cases

Paste everything between the rules into ChatGPT, Gemini, or any other model.
It is self-contained: no repo access, no context from this project needed.

**Why bother with a second model.** This repo's own audit record (HANDOFF,
"Audit passes") says spec-only agents score badly at *finding bugs* — 3 of 5,
then 1 real and 1 false — against 6 of 6 for a code-grounded pass. But that is
about judgement, not imagination. A model that has never seen the code is
**better**, not worse, at inventing the scenarios a real person actually hits,
precisely because it cannot pattern-match to what the implementation happens to
do. So: **outside models generate, this repo verifies by execution.** Never let
a model's opinion that something is broken stand as a finding — run it.

Change the **YOUR TASK** paragraph to aim it at whatever area you want covered.

---

You are writing USE CASES for a personal scheduling app called Sandy Cay. You
have not seen its source code and should not guess at how it is built. Write
what a real user needs and what "handled it" would look like.

**The product.** A week-grid personal scheduler for a university student.

- A 7-day Mon–Sun grid. A "day" runs 5am→5am, so a 02:00 task belongs to the
  previous night's column.
- **Tasks** are **fixed** (you say exactly when) or **flexible** (you give a
  duration and a window, and the app places it by a scoring algorithm). A
  flexible task can be bounded to one day, one week, or "any time before
  &lt;date&gt;". Tasks carry tags, a priority 1–5, an optional deadline, and a
  "pinned" flag. Pinned and fixed tasks are anchors that flexible work must
  schedule around.
- **Zones**: named regions of time carrying tags — "Work, Mon–Fri
  09:00–18:30". An **exclusive** zone admits only work whose tags match it.
  Zones can be bounded to a date range, so they exist in some weeks and not
  others, and zones can overlap each other.
- **Recurrence**: every weekday (Mon–Fri); every week on any set of days; every
  month either by position ("the first Tuesday", "the last Friday") or by date
  ("the 15th", "the last day"); every year; or a custom "every N weeks / every
  N months". A pattern has a start date and optionally a last day it runs.
  Individual sessions can be **skipped**, **moved** to another date (even into
  another week), or an **extra** one **added**. A pattern can be changed
  permanently from now on, or temporarily between two dates.
- **Energy**: the user groups tags into buckets and gives each bucket a
  four-axis cost or restore — mental, physical, social, emotional. A task's
  energy is derived from its tags, never set on the task. The day is a battery
  that drains and repays in time order, so the signal is the deepest dip, not
  the daily total. **Capacity is learned from day-ratings, not assumed**: until
  about three weeks of ratings exist the app shows a "still learning" state with
  no ceiling and no verdict.
- **Interaction**: drag and resize on the grid; dropping onto occupied time
  offers **ripple** (push the following chain later) or **displace** (move the
  other task). A manual drag is respected even where the automatic scheduler
  would refuse — your action wins. There is also re-optimise, clear a day,
  block a range of days, and carry unfinished work forward from a past week (or
  let it go).
- **Reporting**: a weekly wrap report that states facts, with no scores and no
  praise or scolding. Projects can be split into chunks across a week.
- **Interchange**: import and export with Google Calendar and `.ics`.
- **Guiding principle**: the app never moralises, never nags, never invents a
  number it has not learned, and never moves a person's work without consent.

**Your task.** Write 12 concrete use cases drawn from a real university
student's life. *(Replace this paragraph to target an area: calendar and date
edge cases; energy, rest and burnout; adversarial or degenerate schedules;
importing a messy real calendar; the first ten minutes of a new user; and so
on.)*

**Format** — one block per use case, exactly:

```
ID: UC-?1
SCENARIO: one sentence, in the user's own words.
STEPS: what they do in the app, numbered.
EXPECT: the observable outcome that would mean it was handled.
WHY HARD: the specific thing that could plausibly go wrong. One sentence.
```

**Rules.**

- Every EXPECT must be **checkable**. "The schedule feels balanced" is useless.
  "The task lands on Tue 3 Feb, not Tue 27 Jan" is good. Name dates, counts, and
  which day something falls on.
- Where the app shows or says something, state what it **must not** say as well
  as what it must.
- Where the right answer is a refusal or a warning, say so plainly. "Handle it
  gracefully" is not an expectation. Silence is never correct.
- Today's date is **11 August 2026**. Use real dates in the 2026–27 academic
  year, and **double-check the weekday of every date you cite** — a wrong
  weekday makes the case worthless.
- Prefer cases that combine two features: a deadline *and* a zone; a recurring
  pattern *and* an exception to it.
- Do not speculate about the implementation, and do not claim bugs exist. You
  are writing the specification of correct behaviour, not an audit.

Return only the 12 blocks, nothing else.

---

## What to do with the answers

Save them into `design/USE-CASES-EXTERNAL.md` and hand them back to Claude Code.
Each case then gets triaged into one of three buckets:

1. **Engine-checkable** — provable by a node probe or a test against
   `src/core`. These get run, and the result recorded as pass or fail with the
   output. This is the only bucket where a "bug" may be declared.
2. **UI-checkable** — needs a browser and a human. Collected into a checklist
   for the user to drive, because this project's other standing lesson is that
   presentational and real-use bugs are found by *using* the app, and a green
   suite has repeatedly missed them.
3. **Out of scope** — describes a feature that does not exist. Recorded as a
   product question, not a defect.
