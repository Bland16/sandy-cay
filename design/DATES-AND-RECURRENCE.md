# Dates and recurrence — putting an event on a *date*

**Session 6, 2026-08-11.** Status: **SPEC — awaiting sign-off. Nothing built.**

This spec covers one complaint with four causes: **you cannot put an event on a
date.** You can only pick a day of the week, in the week you happen to be looking
at, repeating weekly.

| Phase | What | Ship |
|---|---|---|
| **P1** | **A date, not a weekday** — `AddTaskPanel` takes a real date; adding outside the viewed week works | **first, on its own** |
| **P2** | Monthly by date ("the 15th"), by ordinal weekday ("3rd Tuesday"), and yearly | after P1 is in use |
| **P3** | `.ics` import/export stops dropping monthly + yearly patterns | with P2 |
| **P4** | "More options" — a flexible task's placement range, beyond this week | with P1 (small) |

**Build order is deliberate.** P1 is the thing blocking real use *right now* — the
user has a school year of dated events to enter. It is a panel change over an
engine that already stores absolute times, so it can ship while P2's engine work
is still being specced. Do not bundle them.

---

## 1. The problem, proven

Three places are weekday-indexed, and one silently loses data.

**1. `AddTaskPanel.jsx:149` — the "When" control is a weekday `<select>`.**

```jsx
<select value={day} onChange={…}>{DAY_NAMES.map((d, i) => <option value={i}>{d}</option>)}</select>
```

resolved as `atTime(addDays(weekStart, day), start)`. The **date is implicit in
whichever week the grid is showing**. To add "Orientation, Aug 26" you jump the
grid to that week, add, and jump back. The submit button says "Add to the week",
which is honest about the limit.

Flexible tasks are clamped to the same week:
`from: placementFrom(weekStart), to: addDays(weekStart, 6)`.

**2. `RecurrenceEditor.jsx:47` — windows are `{day: 'mon', start, end}`.**
Frequency offers `every week / every weekday / every 2nd–4th week`. There is no
way to say "the 15th", "3rd Tuesday", or "every year".

**3. `recurrence.js:76` — the *engine's* expansion is weekday-indexed.**
`const dayIdx = DAY_KEYS.indexOf(w.day); const date = addDays(weekStartDate, dayIdx);`
A pattern can only land on a weekday offset from the week's Monday. This is the
real constraint; the editor is downstream of it.

**4. `ical.js:84` — non-weekly RRULEs are dropped, silently.**

```js
if ((kv.FREQ || '').toUpperCase() !== 'WEEKLY') return null; // only weekly maps to our model
```

`fromRRULE` returning null does **not** skip the event — `eventToTask` still
builds the task, just without `recurrence`. **Proven by probe** (2026-08-11,
`parseICS` + `importEvents` on a four-event calendar):

```
Rent due         recurrence=null  <-- DROPPED, now a one-off  start=Tue Sep 01 2026
Book club        recurrence=null  <-- DROPPED, now a one-off  start=Tue Sep 15 2026
Mum's birthday   recurrence=null  <-- DROPPED, now a one-off  start=Thu Sep 03 2026
Lecture          recurrence=YES                               start=Wed Sep 02 2026
```

So importing a real calendar turns "rent, monthly" into a single event on one
day, with **no warning**. The user is told nothing and has no way to notice
except by finding the hole months later. That is a P-1 violation in the strict
sense — a surprise the person did not consent to.

---

## 2. P1 — a date, not a weekday

### 2.0 ⚠️ REVISED 2026-08-11 after the first cut was reviewed

The first build of P1 followed §2.1–2.2 as originally written and was **wrong in
three ways**, all caught by the user looking at the real panel:

1. **The whole "When" block was hidden while Repeats was on** (§2.2 said the date
   field hides for a repeating task). On screen this reads as *the feature was
   never built* — you toggle Repeats and the date field you were promised is
   simply absent. **Fixed:** the date is always shown; when repeating it is
   labelled **"Starts"** and means the first week the pattern runs. A field that
   disappears is worse than a field that changes meaning.
2. **A flexible task showed a date by default, and the date only chose the
   week.** So the control said "3 September" and the task could land on the 1st.
   **Fixed:** a flexible task shows nothing until you tick **"pick a date"**, and
   once you do, the task is placed **on that day** (`from === to`, which bounds
   the scored search to one day — `to` is inclusive of its own day; proven by
   probe). The label and the behaviour now agree.
3. **The opt-in said "pick a time"; it should say "pick a date"**, with the time
   *optional* on top of it. A blank time means "that day, you choose when",
   which is what flexible means. Giving a time pins it (`placedBy: 'user'`).

Plus one presentational defect the suite could not see: the label rendered as
**"Whenpick a time"**, because the original code's trailing space in
`{type === 'fixed' ? 'When' : 'When '}` was dropped. Now a `<span>` and a
`margin-left`, so it cannot recur.

**The lesson is the one this project keeps relearning:** all 484 tests were green
across every one of these. Behaviour tests cannot see a field that isn't there,
a label that reads wrong, or a control that lies about what it does. The states
were only found by *dumping what the panel actually renders* in each combination
— which is now the first thing to do when changing a panel.

**Who shows what, as built:**

| | date | time | placement |
|---|---|---|---|
| flexible, default | — | — | scored, the viewed week (unchanged from before P1) |
| flexible + "pick a date" | ✓ | optional | scored, **that day** |
| flexible + date + time | ✓ | ✓ | pinned, `placedBy: 'user'` |
| fixed | ✓ | ✓ (required) | pinned |
| repeating | ✓ as **"Starts"** | — (pattern carries times) | pattern |

### 2.1 The control

The weekday `<select>` becomes a **date + time pair**:

```
WHEN   [ 2026-09-03 ]  [ 14:00 ]
       Thursday · 3 weeks ahead
```

- `<input type="date" className="timein">` alongside the existing time input, in
  the same `.winrow`.
- A **`.psub-note` readback** under it naming the weekday and the distance from
  today — "Thursday · 3 weeks ahead", "Tuesday · this week", "Monday · next
  week". A bare ISO date does not tell you what day of the week it is, and that
  is exactly what the person is thinking in.
- Default: **today if today is in the viewed week, else that week's Monday** —
  the same rule `defaultDayIndex` already implements, expressed as a date rather
  than an index. Opening the panel on the current week and adding without
  touching anything keeps today's behaviour exactly.

**Vocabulary: this is panel scope, not Cabana scope.** `.field` / `.control` /
`.field-help` (EDITOR-REDESIGN §4) are styled in the Cabana's dark palette
(`#e9dcc4` text, `--cab-accent` focus ring). The right panel is light and uses
`.fieldrow` / `.flabel` / `.timein` / `.psub-note`. **P1 uses the panel
vocabulary.** Do not import the Cabana primitives into the panel to look
consistent with a spec — they will read as a colour bug. Unifying the two
vocabularies is its own job and is not in scope here.

### 2.2 What changes behind it

- **Fixed / timed task** — `startTime = atTime(dateFromKey(dateStr), start)`.
  There are no bounds to honour: the date *is* the answer.
- **Flexible task, no time picked** — the scored search window becomes the week
  **containing the chosen date**, not the viewed week:
  `from = placementFrom(weekStart(chosenDate))`, `to = addDays(weekStart(chosenDate), 6)`.
  Adding "read the chapter" while looking at August, dated in September, must
  search September.
- **Repeating task** — unchanged. The pattern supplies the times, so the date
  field is hidden exactly as the weekday select is today (`!repeats &&`).

**Sharp edge #4 is load-bearing here.** `new Date('2026-09-03')` is **UTC
midnight** and lands a day early in every timezone west of Greenwich. Parse with
the engine's `dateFromKey()`. This has already caused a real bug once (deadlines
a day early, session 1).

**Sharp edge #12 still applies.** A flexible task with no picked time passes
`durationMin` and leaves `startTime` unset, so scored placement actually runs.
Do not "helpfully" precompute a slot from the new date.

### 2.3 Landing outside the viewed week

Once the date can be anywhere, a task can be added into a week you are not
looking at — and then vanish, because the grid never moves. Two changes:

- **The button reads "Add"**, not "Add to the week". The old label was accurate
  and stops being so.
- **The toast names the destination and offers to go there** when the task lands
  outside the viewed week: `Added "Orientation" · Thu 3 Sep` + a **Go there**
  action that jumps the grid. `onJump` already exists (`TopBar`'s DateJump uses
  it) — thread it into the panel.

Silently adding something into a week the person cannot see is the same class of
surprise as the import drop.

### 2.4 P4 — "more options": the placement range

Per the user's call: **the wider range is behind a disclosure, not on the face of
the panel.** Default behaviour is unchanged, so the common case stays one field.

For a **flexible** task only, a collapsed row:

```
＋ more options
```

opens:

```
PLACE IT   ( that week ▾ )        ← default, = today's behaviour
           ( any time before [ date ] )
```

- **"that week"** — the week containing the chosen date. Today's behaviour.
- **"any time before <date>"** — the search runs from the chosen date to that
  bound, so the scorer may place it in any of those weeks. This is what makes
  "sometime in the next three weeks" expressible.

The bound is a *search window*, not a deadline — they are different fields and
must not be conflated. A deadline is a promise the engine protects and reports
on; a search window is only where to look. **D-3 below asks whether setting the
window should offer to set a matching deadline.**

### 2.5 Edge cases

| Case | Behaviour |
|---|---|
| Date in the past | Allowed for a **fixed** task (recording something that happened); a **flexible** one is floored to now by `placeTask` — sharp edge, already handled by the past-placement floor |
| Date cleared / invalid | Submit blocked with the field marked; do not fall back to today silently |
| Date far future (years) | Allowed. `getTasksForWeek` expands on demand, so there is no cost until you look |
| Repeating toggled on after a date is set | Date field hides; the pattern's `effectiveFrom` uses the chosen date's week rather than the viewed week |

That last row is a real improvement worth calling out: `buildRecurrence` defaults
`effectiveFrom` to `weekStart(anchor)` where the anchor is the **viewed** week.
Passing the chosen date instead means "gym every Tuesday, starting the week of
the 8th" works without navigating there.

---

## 3. P2 — monthly, ordinal weekday, yearly

### 3.1 The data model — additive, `schemaVersion` stays 1

Sharp edge #15's rule: new state is additive and absent keys load clean. A period
gains an optional `freq`; **absent means `'weekly'`**, so every save already in
`localStorage` loads with identical behaviour and the existing 472 tests describe
the same engine.

```js
period = {
  freq: 'weekly' | 'monthly' | 'yearly',   // absent → 'weekly'
  windows: [ … ],                          // shape depends on freq
  interval, effectiveFrom, effectiveUntil,
}
```

| `freq` | window shape | means |
|---|---|---|
| `weekly` (default) | `{ day:'tue', start, end }` | unchanged |
| `monthly` | `{ monthDay: 15, start, end }` | the 15th of the month |
| `monthly` | `{ day:'tue', nth: 3, start, end }` | the 3rd Tuesday |
| `yearly` | `{ month: 9, monthDay: 3, start, end }` | 3 September, `month` 1-based |

`monthDay: -1` means **the last day of the month**, and `nth: -1` means **the
last** such weekday. Both are needed and neither is expressible by clamping.

### 3.2 Expansion

`expandRecurrence(task, weekStartDate)` keeps its signature and its contract —
occurrences still get id `taskId@YYYY-MM-DD`, still behave as fixed anchors,
still carry `occurrenceData`. Only pass 1 branches on `freq`:

- **weekly** — today's `DAY_KEYS.indexOf` walk, untouched.
- **monthly / yearly** — compute the date the pattern lands on *for the month(s)
  the requested week touches* (a week can straddle two months), then keep the
  ones inside the week. `inWeek()` already filters, so the branch only has to
  produce candidate dates.

Pass 2 (exceptions: `move`, `add`) is frequency-independent and does not change.

### 3.3 The edge rules — decide these, do not clamp

**Clamping invents a session on a date the person never chose.** RFC 5545 skips,
and so should we.

| Case | Rule |
|---|---|
| "the 31st" in a 30-day month | **Skip that month.** Use `monthDay: -1` for "last day" |
| "the 29th" in February, non-leap | **Skip that year.** Same reasoning |
| "5th Friday" in a month with four | **Skip that month.** Use `nth: -1` for "last Friday" |
| `nth: -1` | Always fires — every month has a last Tuesday |

This must be **visible in the editor**, not just correct in the engine — a rule
the person only discovers by a missing session in November is a bug regardless of
what RFC 5545 says. §3.5 discharges this with the live preview: the skipped
months are named in the panel, before you save.

### 3.4 Interval semantics

`interval` currently means "every Nth **week**", checked by
`intervalMatches` via `weeksBetween(anchorDate, weekStartDate)`. For a monthly
period it must mean "every Nth **month**", and for yearly, Nth year.

Needs `monthsBetween(a, b)` in `time.js` (there is `weeksBetween` and
`daysBetween`; this is the missing sibling). `intervalMatches` branches on
`freq`. **Every-2nd-month parity counts from `anchorDate`, same as weeks.**

### 3.5 The editor — no mode picker, ever

**Decided 2026-08-11 after the first mockup was rejected as confusing, and the
reasoning is the important part.** The first draft asked the user to choose
between "on a date" and "on the …" *before* showing them anything. That forces
them to hold an abstract distinction — by-date versus by-position — in their head
before they can express a thing they already know perfectly well ("it's the first
Monday"). The user's words: *"it's confusing to me."* They were right, and they
also observed correctly that **by-position is the common case** and by-date is
mostly bills.

**The distinction is real in the data and must be invisible in the UI.** Because
P1 already makes the user pick a date, that date answers *both* questions at
once. So the editor writes the options out as **finished sentences generated from
the chosen date**, in one flat list:

```
WHEN        [ 2026-09-01 ]  [ 18:00 ]
            Tuesday · the first Tuesday of the month

HOW OFTEN   ( every month on the first Tuesday ▾ )
              every week on Tuesday
              every weekday (Mon–Fri)
              every other week on Tuesday
              every 3rd week on Tuesday
              every 4th week on Tuesday
            ▸ every month on the first Tuesday
              every month on the 1st
              every year on 1 September

            IT WILL RUN ON
            Tue 1 Sep · Tue 6 Oct · Tue 3 Nov · Tue 1 Dec
```

**Fortnightly already works and keeps working.** `interval` (every Nth week,
parity against `anchorDate`) has been in the engine since Phase 1. **Verified by
probe 2026-08-11** — a Tuesday pattern with `interval: 2` starting 1 Sep
materialises on 1, 15, 29 Sep and 13 Oct, and `interval: 3` / `interval: 4` step
correctly too. P2 must not regress this.

Two wording changes fall out of it:

- **"every other week", not "every 2nd week".** It is what people say, and the
  numeric phrasing made a fortnightly pattern genuinely hard to spot in the list
  — the user had to ask whether it existed at all. Change this in the *existing*
  `RecurrenceEditor` as part of P1; it is a one-line label fix and does not wait
  for P2.
- **Say what the parity counts from.** "Counted from the date you picked — not
  from the start of the month" sits under the preview for the interval options.
  `anchorDate` makes "every other week from the 15th" mean the 15th, the 29th and
  so on; nothing in the UI said so.

- **Every option is a complete sentence.** Nothing reads as a setting.
- **The list is derived, never fixed.** Pick the 15th and the monthly options
  become "on the third Tuesday" and "on the 15th". Pick a date in the last week
  and a fourth option appears: **"on the last Tuesday"** — offered only when the
  chosen date genuinely is the last such weekday.
- **The preview is the feature.** Four real dates under the control settle every
  doubt the wording can't, including the skip rules in §3.3 — which is why they
  no longer need explaining in prose. Set 31 October and the preview says
  *"Skips November, February — those months have no 31st. Pick 'the last day' if
  you mean the end of the month."*
- **Only the weekly options get extra rows.** "Mon *and* Wed" is real, so weekly
  keeps `＋ also on another day`. Monthly and yearly need no rows at all: the
  sentence already said everything. This is what deletes the confusing UI rather
  than relabelling it.

This is the same approach Google Calendar and Apple Calendar take, for the same
reason.

**Keep the readback principle.** `isWeekdayPattern` derives "every weekday" from
the windows rather than storing a flag, so hand-editing one day honestly stops
claiming it. Monthly works the same way and more strongly: the option list is
*regenerated from the date* on every render, so there is no stored mode that can
drift out of sync with the pattern. When an existing task is opened for edit, the
selected option is read back by matching the stored window shape (`monthDay` →
by-date; `nth` → by-position; `nth === -1` → last).

**Sharp edge to add:** changing the *date* on a saved monthly pattern changes
what the pattern means ("first Tuesday" → "third Tuesday"). The preview must
update live so this is never silent, and an existing task's option must stay
selected if it still exists in the regenerated list.

**Verified by probe (2026-08-11)** — the two cases that break naive
implementations both come out right: a month that *starts* on the target weekday
(1 Oct 2026 is a Thursday, so "first Thursday" is the 1st, not the 8th), and
"fifth Friday" correctly skipping August, September and November 2026.

---

## 4. P3 — `.ics` fidelity

**Import** — `fromRRULE` handles `FREQ=MONTHLY` (`BYMONTHDAY=15`, `BYDAY=3TU`)
and `FREQ=YEARLY`, mapping to the P2 shapes. `BYSETPOS` maps to `nth` where it is
a single ordinal.

**Export** — `toRRULE` emits `FREQ=MONTHLY;BYMONTHDAY=…` / `FREQ=MONTHLY;BYDAY=3TU`
/ `FREQ=YEARLY;BYMONTH=…;BYMONTHDAY=…`. The `UNTIL` conversion via `lastRunDay`
is unchanged and still load-bearing (sharp edge #11).

**Anything still unmappable must be reported, not dropped.** Even after P2 there
will be RRULEs we cannot express (`FREQ=DAILY`, multi-`BYSETPOS`, `BYWEEKNO`).
`importEvents` returns a **`dropped` list** — title + the RRULE we could not
read — and the import UI shows *"3 events imported as one-offs: their repeat
patterns could not be read"* with the names. **This part is worth doing even if
P2 slipped**, because it converts silent data loss into a visible fact.

---

## 5. Open decisions — sign-off needed before build

- **D-1.** P1's date readback wording: "Thursday · 3 weeks ahead" vs just
  "Thursday". The distance is useful when you have typed a date months out and
  want to be sure you did not fat-finger the year.
- **D-2.** Should the **week grid's** day header, and the day view, gain an
  "add on this day" affordance that opens the panel pre-dated? Cheap once P1
  exists, and it is how most people add a dated event — by pointing at the day.
- **D-3.** Does setting P4's "any time before <date>" window offer to set a
  **deadline** to match? They are different things (§2.4) but a person who says
  "before the 20th" usually means both.
- **D-4. RESOLVED 2026-08-11** — no mode picker; options are generated from the
  chosen date as finished sentences, worded "the **first Tuesday**" (words, not
  "1st"), with a live four-date preview. See §3.5. What remains open is small:
  should the monthly *interval* ("every 2nd month on the first Tuesday") be in
  the same list, or is it rare enough to leave out until asked for? Leaving it
  out keeps the list at seven or eight entries.
- **D-5.** After P2, should the **Zones** editor get the same frequency options?
  Zones are weekday-windowed too ("Work, Mon–Fri"). A monthly zone is plausible
  ("lab, first Monday") but nobody has asked for one. SPEC §4.3 already claims
  zones and recurrence share a window-row component and they **do not** — see
  HANDOFF "Then, roughly in order" #4. Deciding this decides that too.

---

## 6. Test plan

**P1**
- Adding a fixed task dated outside the viewed week lands on that date (not the
  viewed week's same weekday) — the regression this whole spec exists for.
- `dateFromKey` path: a date entered as `2026-09-03` produces a task on the 3rd
  in a `TZ=America/New_York` run, not the 2nd (sharp edge #4).
- A flexible task dated in a future week is placed *in that week*, by score, with
  `startTime` unset before placement (sharp edge #12).
- Default date = today when the current week is viewed → today's toast/placement
  is byte-identical to before.
- Toast names the date and offers **Go there** only when off-week.

**P2**
- "The 15th" expands in a week straddling two months (e.g. Mon 30 Nov – Sun 6
  Dec) — the straddle is where a naive implementation drops a session.
- The 31st skips November; `monthDay: -1` fires on the 30th.
- "3rd Tuesday" across a month starting on a Tuesday and one starting on a
  Wednesday — the off-by-one is real.
- "5th Friday" fires only in months that have one; `nth: -1` always fires.
- Yearly Feb 29 skips non-leap years.
- `interval: 2` monthly counts months from `anchorDate`, not weeks.
- **A save written before P2 loads and expands identically** (absent `freq`).

**P3**
- The four-event probe calendar in §1 round-trips: all four keep their pattern.
- An unmappable `FREQ=DAILY` event imports as a one-off **and appears in
  `dropped`**.
- `toRRULE`'s `UNTIL` stays inclusive-converted for the new frequencies.

---

## 7. What this does not do

- **No daily frequency.** `FREQ=DAILY` is expressible today as "every weekday"
  only for Mon–Fri; a true 7-day daily is not in scope and no one has asked.
- **No `COUNT`.** Patterns end by date (`effectiveUntil`), not after N runs.
- **No timezone handling.** Everything stays local-time, as the engine is
  throughout. Importing a `TZID`-bearing calendar from another timezone is a
  known and unchanged limitation.
</content>
</invoke>
