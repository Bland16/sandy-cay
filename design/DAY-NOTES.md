# All-day events as day notes, not blocks

**Session 6, 2026-08-11.** Status: **SPEC — awaiting sign-off. Nothing built.**

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

- **D-1.** Does a day note carry **tags**, and therefore tint the day and touch
  the energy model? A "reading week" arguably has a character. Tags cost
  nothing to add and can be ignored; leaving them out is simpler.
- **D-2.** Should an imported **holiday** offer to block the day *at import
  time* ("3 holidays imported — block those days?"), or stay silent until you
  click one? Offering is helpful; asking during an import is a lot of dialogue.
- **D-3.** **Recurring** day notes — a birthday every year. Reuse the P2
  `freq: 'yearly'` window shape, or keep notes one-off and let the yearly
  repeat be an ordinary task? Reuse is tidier but couples two models.
- **D-4.** Does the **wrap report** mention them ("this week contained
  Thanksgiving")? It would explain an unusual week honestly, without judgement —
  which is the kind of fact the report is for.
- **D-5.** Do day notes appear on the **phone day view** and in the **weekend
  drawer**? Both render their own headers, so this is a third and fourth place
  to draw them — and sharp edge #14 warns that a third copy of a day-walk
  drifts from the first two.

---

## 7. Build order

1. **The model + `.ics` import** — a day note is data; getting holidays in
   correctly is the whole payoff, and it is provable by probe with no UI at all.
2. **The header line + the day list** — the visible half.
3. **"Block this day"** — one call to existing machinery.
4. **Export**, then the recurring case if D-3 says reuse.
</content>
