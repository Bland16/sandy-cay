# All-day events as day notes, not blocks

**Session 6, 2026-08-11.** Status: **MOSTLY BUILT** — corrected 2026-08-21, the
line below had been understating this for two sessions.

**Shipped:** the model (`DayNote`, `Schedule.dayNotes`, `notesForDate`); the
`.ics` **import**, so an all-day event becomes a note on the right day instead of
a 1440-minute task on the wrong one; the **day-header line** (§4 — `DayNoteBar`,
wired into `WeekGrid`, `DayView` and `RightPanel`); **"Block this day"** in the
note panel; the blocker-conversion offer in the Cabana; and **all-day events in
Google** (GS-11, `core/googleDayNotes.js`).

**Still spec:** the Cabana card for managing notes directly (§7), `.ics`
**export** of notes (import works, export does not), and the holiday / ask packs
of §8 — no code for those exists at all.

A holiday is not 09:00–17:00. Neither is a birthday, a reading week, or "Mum
visiting". They are **facts about a day**, not appointments inside it — so they
belong in the day's header, not in its grid.

---

## 1. What happens today, proven

An all-day `.ics` event (`DTSTART;VALUE=DATE:20261126`) imports and fails three
ways at once:

```
imported as: Thanksgiving | fixed | Thu Nov 26 00:00 -> Fri Nov 27 00:00
duration: 1440 minutes
gridDayOf -> 2026-11-25   (WEDNESDAY)
gridHour  -> 24
```

1. **It lands on the wrong day.** The grid is 5am-anchored (sharp edge #5), so a
   00:00 start belongs to the *previous* night's column. Thanksgiving draws on
   Wednesday.
2. **It consumes twenty-four hours** as a single block.
3. **It is a `fixed` anchor**, so the scheduler treats the whole day as
   unavailable — which is accidentally tolerable for a public holiday and
   completely wrong for a birthday.

`parseICS` has **no `VALUE=DATE` handling at all**: the date is parsed as a
midnight timestamp and treated like any other event. Every Google calendar
carrying holidays or birthdays hits this.

---

## 2. The model — a day note is NOT a task

```js
dayNote = {
  id,
  from,          // 'YYYY-MM-DD'
  to,            // 'YYYY-MM-DD' — INCLUSIVE, the last day it covers
  label,         // "Thanksgiving", "Reading week", "Mum visiting"
  kind,          // 'holiday' | 'note'  — colour and icon only, no behaviour
  tags,          // optional, so it can tint like anything else
  source,        // optional: the calendar it was imported from
}
```

Held on `Schedule` as `dayNotes: []`. **Additive** — absent on every existing
save, loads as empty, `schemaVersion` stays 1 (sharp edge #15). Written in
`toJSON` **and** read in the constructor, because a field in only one of the two
is silently dropped — that is exactly how `freq` was lost from recurrence
periods.

**Why not a `Task` with an `allDay` flag.** A Task drags in placement, duration,
energy load, completion, satisfaction, ratings, recurrence and history — every
one of which is meaningless for Thanksgiving. Modelling it as one means teaching
a dozen call sites to skip it, and every one of them is a place to forget. The
project has been here before: `role` was a redundant second description of a
bucket's character and was eventually ripped out. A day note is a genuinely
different thing, and cheaper as one.

**Ranges are inclusive**, unlike the engine's half-open interiors — "Reading week
23–27 Nov" covers the 27th. Sharp edge #11's rule holds: the core is half-open,
edges convert. `.ics` `DTEND` is exclusive, so import subtracts a day and export
adds one back, in exactly the place `untilAfterLastRun` / `lastRunDay` already
do this for recurrence.

---

## 3. It does not consume time, and does not block

**A day note has no effect on placement whatsoever.** This is the important
call. A holiday does not decide for you that you aren't working — plenty of
people study on Thanksgiving, and the app's whole posture is that it observes
rather than instructs (P-1).

But the two are one click apart: a note offers **"Block this day"**, which runs
the existing `blockRange` and creates the protected blocker it always has. So
the *fact* and the *decision* stay separate, and the decision stays yours.

That separation is also what makes the import safe. Right now importing a
holiday silently sterilises a day; after this, importing a holiday tells you it
is a holiday.

---

## 4. Where it shows — the day header

```
   MON 23      TUE 24      WED 25      THU 26           FRI 27
                                       🏷 Thanksgiving
  ┌────────┐  ┌────────┐  ┌────────┐  ┌────────┐      ┌────────┐
```

- **One line under the day's date**, in the sticky header. Compact: the label,
  truncated, with a count if there are several ("Thanksgiving +1").
- **Click the header to see them all** — the day header already opens the day
  view, and the day `⋯` menu already exists, so this needs no new affordance.
  The list shows each note, its range, where it came from, and the **Block this
  day** action.
- **A multi-day note draws on every day it covers**, so a reading week reads as
  a band across the week rather than a mark on its first day.
- Not coloured like a warning. A holiday is not a scheduling problem, and coral
  is reserved for physics (P-1).

---

## 5. `.ics`, both ways

- **Import**: `DTSTART;VALUE=DATE` → a day note, never a task. `DTEND` is
  exclusive, so a one-day event with `DTSTART:20260815` / `DTEND:20260816`
  covers **the 15th only** — the case an adversarial use case (UC-E9) already
  flagged and the code does not yet handle.
- **Export**: day notes go out as `VALUE=DATE` events with the exclusive `DTEND`
  restored.
- **Recurring all-day events** — birthdays are `FREQ=YEARLY` all-day — should
  reuse the P2 recurrence vocabulary rather than growing a second one. See D-3.

---

## 6. Open decisions

- **D-1. RESOLVED 2026-08-11 — no tint for a note; tint means BLOCKED.** The
  user's call, and it is the more principled one. A note is an annotation, and
  colouring a day because something is written on it says nothing about the day.
  A **blocked** day is different: it is a real scheduling state, nothing can be
  placed there, and that is exactly the "physics, never moral bookkeeping" that
  P-1 reserves colour for. So:

  | | header line | day tint |
  |---|---|---|
  | a day note | ✓ | ✗ |
  | a blocked day | ✓ (what blocked it) | **✓ the whole column** |

  Tags stay available on the note for tinting *its own chip* and for the wrap
  report, but they do not colour the day.

  **D-6. RESOLVED 2026-08-12 — the tint REPLACES the card. Reason corrected
  2026-08-13; the decision stands, but it is a MODEL change, not a rendering
  one.**

  The original reason given was *"tasks can still be scheduled on a blocked day,
  so a full-height protected card is a lie about the day."* **That was false as
  built**, and the probe is unambiguous:

  ```
  blocker: Blocked  fixed  tags ['rest']  spans Wed 08:00 -> Wed 18:00 (600 min)
  manual drop at Wed 10:00 -> {"rejected":true,"reason":"Conflicts with fixed: Blocked"}
  ```

  The blocker covers the **entire** schedulable day window, so automatic
  placement has no legal room; and a manual drop is rejected outright, because
  `isHardBlocker` treats a protected task as a wall. Nothing could be scheduled
  there, by engine or by hand. The card was not lying — it was doing the work.

  **So removing it removes a behaviour, and that behaviour has to be rebuilt
  deliberately.** What replaces it is the user's actual intent, which is sharper
  than the original wording and is best stated through their own test case —
  **Christmas brunch**:

  > *"Would I want homework scheduled on Christmas? No. Should I be able to
  > schedule my own brunch on that date as a fixed task, and do something to
  > fill my time if I feel like it? Yes."*

  | | before | after |
  |---|---|---|
  | autoScheduler places work there | no | **no** |
  | you drop something there by hand | **rejected** | **allowed** |
  | What-To-Do / "Do it now" offers something | n/a | **allowed** |
  | a full-height card sits on the grid | yes | **no** — the tint says it |

  **Blocked means "the scheduler stays out", not "you may not go here."** That is
  R-1 applied honestly: the zone constrains the scheduler, not the hand, and a
  block you set yourself is the clearest possible case of a rule you are entitled
  to overrule. Opening the picker *is* asking, so a blocked day must not silence
  What-To-Do either.

  **The model:** a `blockedDays` collection beside `dayNotes`, subtracted from
  the legal windows in `computeWindows`. That one subtraction covers every
  automatic path at once — `autoSchedule`, displacement, `carryOver` and ripple's
  overflow branch **all** route through `placeTask` → `computeWindows` (SPEC
  §2.2). `createBlocker` survives only for the explicit "protect this gap" case
  (§3.9), which genuinely *is* an appointment.

  **⚠️ The one automatic path that does NOT route through `placeTask` is ripple's
  plain-shift branch** — pure arithmetic, and it has been caught by exactly this
  before: it could slide a flexible into an exclusive zone until it was taught to
  hand such a task to `placeTask` instead. Blocked days must join that same
  check, or a ripple will quietly slide Tuesday's homework onto Christmas Day.

  **Known cost, unchanged:** `evacuate.js`, `carryOver` and anything counting
  tasks currently see the blocker as a task and will need the day's blocked
  *state* instead.
- **D-2. RESOLVED 2026-08-12 — neither. The import CONFIRMS DATES, on pages, and
  it is the same form as an ask pack.** The user's reframing, and it collapses
  two designs into one. The question assumed the import's job was to ask about
  *blocking*; its actual job is to let you confirm **what lands and on what day**,
  which is the identical job §8.3's ask pack does. So there is one component:

  ```
  US HOLIDAYS · 20 found                    page 1 of 3
  Confirm the dates. Blank adds nothing.

    [✓] confirm all on this page
      Thanksgiving        [ 2026-11-26 ]
      Christmas Day       [ 2026-12-25 ]
      Labor Day           [ 2026-09-07 ]
      …
                          ‹ back   next ›   [ Add 7 ]
  ```

  - **Imported notes arrive with their dates filled in** from the `.ics`; you are
    confirming, and correcting anything wrong.
  - **Ask-pack notes arrive blank**; you are supplying. Rosh Hashanah, BC's fall
    break, anything lunisolar or institutional.
  - **§8.3's rule holds unchanged: a blank date adds nothing.** No error, no
    placeholder, no nag. Declining a row is just leaving it alone.
  - **Pages of 7–10**, because twenty rows at once is a wall and because the
    per-page "confirm all" is only a kindness if a page is small enough to take
    in at a glance.
  - **Blocking is not asked here at all.** It stays the per-note "Block this day"
    action of §3, where the fact and the decision remain one click apart.

  This is also why the year-less form matters (§8.2): a confirmed date with no
  year is how a birthday or a fixed-date holiday enters once and never asks again.
- **D-3. RESOLVED 2026-08-11 — REUSE.** A recurring day note carries the same
  `{ freq, windows, interval, effectiveFrom, effectiveUntil }` period shape P2
  built for tasks, with the yearly window `{ month, monthDay }` doing exactly
  what it already does for "every 3 September". A birthday is that shape.
  Building a second, notes-only repeat vocabulary would be the design debt this
  project keeps paying down — two descriptions of one idea, drifting apart (see
  `role`, and SPEC §4.3's window-row that exists twice). It also means the skip
  rules come free: 29 February appears only in leap years, without a line of
  new code.
- **D-4. RESOLVED 2026-08-11 — YES, as facts.** The report states what the week
  contained and nothing more: *"Thanksgiving fell on Thursday 26 Nov"*, *"2 days
  blocked (Thu–Fri)"*. That is context a reader needs to make sense of an
  unusual week's numbers.

  **The line it must not cross:** a fact explains, a story excuses. *"Thanksgiving
  fell on Thursday"* is a fact. *"You did less because of Thanksgiving"* is the
  report doing your thinking for you, and *"understandably quiet week"* is
  sympathy — both are the judgement §7.1 forbids. State the day, state the
  count, stop.
- **D-5. RESOLVED — yes, all surfaces, via ONE shared helper.** Not really a
  choice: a note missing from the phone view is a fact the app knows and doesn't
  tell you, on the surface you use most. The risk sharp edge #14 names is real
  though — `zoneBands` had to be added to `WeekGrid` **and** `DayView`
  separately, and #17's weekend drawer is a third real grid. So the rule is:
  **one `notesForDate` call site rendered by one component**, dropped into each
  header, never a per-surface reimplementation. Three copies of a day-walk is
  how zone bands painted weeks the zone didn't run in.

---

---

## 7. Where they live — the Cabana, with a quick-add on the day

**Decided 2026-08-11.** Zones settle this: they are dated things that render on
the grid as bands and are **managed in the Cabana**. A day note is the same
shape — dated, drawn on the grid, standing rather than momentary — so it goes
where its nearest relative already is.

**The Cabana card is the home.** A `Day notes` card beside `Zones`, on the
existing `DrillList` → `DrillEditor` idiom the other editors share, so it costs
no new vocabulary:

```
DAY NOTES                                     ＋ new

  Thanksgiving          Thu 26 Nov            holiday · imported
  Reading week          23–27 Nov             note
  Mum's birthday        3 Sep · every year    note · repeats
```

**Where day notes come from — nothing ships.** The app has no holiday database
and never invents a note. There are exactly two sources: you type one, or you
import a calendar that contains all-day events. Subscribe to a holidays calendar
in Google and import it and you get ~20 a year; don't, and you have none.

**Filtering by source (decided 2026-08-11).** Because imports arrive in bulk,
the card groups by the `source` field the model already carries, with a
**per-source toggle**:

```
DAY NOTES                                     ＋ new

  ▾ US Holidays          20 notes    [ shown ▾ ]
      Thanksgiving          Thu 26 Nov
      Labor Day             Mon 7 Sep
      …
  ▾ Typed by me           2 notes    [ shown ▾ ]
      Spring break          9–13 Mar
      Mum's birthday        3 Sep · every year
```

Turning a source off hides its notes from the day headers **without deleting
them**, so re-importing doesn't resurrect a set you deliberately hid, and you
can bring them back without fetching again. Deleting stays available per note
and per source. `importEvents` already accepts a `tagFilter`, so filtering can
also happen *before* anything lands.

Three reasons it is the Cabana and not only the day header:

1. **Imports arrive in bulk.** A Google holidays calendar is ~20 entries a year.
   Reviewing, pruning and re-tagging that is a list job; a day header shows one
   day.
2. **A recurring note is standing configuration**, not a fact about one date —
   the same argument that puts Zones there.
3. **You need to see them together** to answer "what have I got this term?",
   which no per-day surface can do.

**The day header keeps a quick-add.** `＋ note` on the day you are looking at,
because "Mum's visiting that week" occurs to you while looking at that week.
This is **quick capture handing off to a full editor**, exactly the split
`AddTaskPanel` and `TaskPanel` already are — not a second editor. It writes a
label and a range and nothing else; anything further drills into the card.

**Deliberately NOT a third surface.** Sharp edge #14's warning is that a third
copy of a day-walk drifts from the other two, and §4.3's window-row proves it —
it exists twice and the two have already diverged. One editor, one quick-add.

---

## 8. Holiday packs, paste, and the optional year

**Proposed 2026-08-12.** Short codes that add a named set: `US`, `CHRISTIAN`,
`JEWISH`. Plus paste-many and one-at-a-time, as the buckets already have.

### 8.1 The split that decides the design

Some holidays are a **rule** — computable forever, never stale. Others are a
**table** someone published, which runs out. **A pack must declare which it is**,
or it quietly goes wrong in 2029.

| Kind | Example | Us |
|---|---|---|
| Fixed date | Christmas, 4 July | ✅ **works today** — `yearly { month, monthDay }` |
| Ordinal weekday | Thanksgiving (4th Thu Nov), Labor Day, MLK, Memorial | ⚠️ **small extension** — yearly must accept `{ month, nth, day }`; the nth-weekday maths already exists for monthly |
| Computed | Easter, and Ash Wednesday / Good Friday / Pentecost as offsets from it | ⚠️ **~20 lines** — the computus is deterministic; one function unlocks the set |
| Another calendar | Rosh Hashanah, Yom Kippur · Ramadan, Eid · Lunar New Year | 🟡 **ASK PACK** (§8.3) — the app knows the names, you supply the dates |
| Institutional | BC's fall break, reading period | 🟡 **ASK PACK** or an import — the registrar decides yearly, and no algorithm exists |

**Two kinds of pack, and the second is the interesting one.** A **rule pack** is
permanent and silent. An **ask pack** knows *what* it contains but not *when* —
so it asks.

### 8.3 Ask packs — the app names them, you date them

**The user's design, and it is the right answer.** Rather than hand-roll the
Hebrew, Islamic or Chinese calendars — or ship a table that silently runs out —
a pack can carry the **names** and ask for the **dates** for the year ahead:

```
JEWISH HOLIDAYS · 2026–27
These move each year. Fill in what you want; leave the rest blank.

  Rosh Hashanah   [ 2026-09-11 ] → [ 2026-09-13 ]     optional range
  Yom Kippur      [ 2026-09-20 ] → [            ]
  Sukkot          [            ] → [            ]     ← left blank, not added
  Hanukkah        [            ] → [            ]
  Passover        [            ] → [            ]

  ＋ one that isn't listed                    [ Add 2 ]
```

**A blank date adds nothing.** No error, no placeholder, no nag — the same way
an unrated day contributes nothing to capacity. You take the two you observe and
leave the rest.

**Why this is better than a bundled table.** A table is wrong silently; an ask
pack is simply empty until you fill it, and asks again when the year turns. And
it puts the dates with the person who actually knows them — you, or the calendar
your community publishes — rather than with a guess baked into a build.

**This is the same rule the energy model already follows.** `learnedCapacity`
returns `null` until your ratings earn a number, because the app may not state
what it has not learned (P-2). A lunisolar date it cannot compute is the same
kind of thing: **not knowing and saying so beats inventing.** Getting someone's
Yom Kippur subtly wrong is exactly the failure that rule exists to prevent.

**When it asks.** On adding the pack, and once when the covered year runs out —
as an **offer**, in the same shape as the rollover banner, never a repeated
prompt. Ignoring it is a real answer; the pack simply stays as far as you filled
it.

**BC becomes an ask pack too**, or an import. Either is honest; a bundled `BC`
code that rots every August is not.

### 8.2 The year is optional — and that IS "every year"

**The user's call, and it removes a control.** Write the year and it happens
once; leave it out and it happens every year. No "repeats" toggle for the common
case, because the way people already write a birthday says it — a birthday has a
month and a day and no year.

| Typed | Means | Stored |
|---|---|---|
| `Commencement \| 2027-05-24` | once | `from`/`to`, no recurrence |
| `Mum's birthday \| 09-03` | every 3 September | `yearly { month: 9, monthDay: 3 }` |
| `Fall break \| 2026-10-05 \| 2026-10-06` | once, two days | `from`/`to`, inclusive |
| `Spring break \| 03-09 \| 03-13` | every year, 9–13 March | `yearly { month: 3, monthDay: 9, spanDays: 5 }` |

**D-8. RESOLVED 2026-08-12 — a year-less RANGE repeats too.** The rule is one
rule and it applies to whatever shape you typed: **no year means every year.**
Making a range the exception would mean the same omission meant "annually" on one
line and was an error on the next.

**What it costs:** the yearly window gains **`spanDays`** (default 1), so
"9–13 March" is one window that covers five days, not five windows. One optional
integer, and it keeps the P2 vocabulary that D-3 committed to rather than growing
a notes-only second one.

- `spanDays` must be added to **both** `reviveRecurrence` and `recurrenceToJSON`
  — the field-whitelist trap that silently dropped `freq` and expanded every
  monthly pattern as weekly (HANDOFF, session 6's lesson). Any new period field,
  both functions, no exceptions.
- A span that runs off the end of a month simply continues into the next; it is a
  count of days, not a month-day arithmetic problem.
- **`spanDays` is meaningful on a day note and meaningless on a task** (added
  2026-08-13). D-3 committed both to one period shape, which is right, but a task
  window already carries `start`/`end` times — "every 9 March, 18:00–19:00, for
  five days" says nothing coherent. So a task period carrying `spanDays` is
  **rejected at validation, not silently ignored.** Silent tolerance of an
  unexpected period field is precisely how `freq` was dropped by the serialiser
  whitelist and every monthly pattern quietly expanded as weekly for a session.
- **⚠️ Selection must be by OVERLAP, not by start** (added 2026-08-13).
  `expandRecurrence` keeps an occurrence only when its **start** falls inside the
  requested week (`if (!inWeek(start)) return`). A five-day note beginning on a
  Saturday would therefore appear in that week and **vanish from the next one**,
  where four of its five days actually fall. `notesForDate` must select notes
  whose span *covers* the day. This is cheap to get right now and invisible until
  the first multi-day note straddles a Sunday — i.e. until November, in front of
  the user.
- The old argument for refusing this — *breaks move every year, so an
  institutional calendar should be an import* — is still true, and it is an
  argument about **which source you use**, not about what the model can express.
  A fixed-date multi-day observance (a festival, a week you always take off) is a
  real thing, and it should not be forced into five separate notes.

---

## 9. Build order

1. **The model + `.ics` import** — a day note is data; getting holidays in
   correctly is the whole payoff, and it is provable by probe with no UI at all.
2. **The header line + the day list** — the visible half.
3. **"Block this day"** — one call to existing machinery.
4. **Export**, then the recurring case if D-3 says reuse.
