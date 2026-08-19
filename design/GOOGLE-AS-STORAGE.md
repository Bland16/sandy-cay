# Google Calendar as the store — an account without a database

**Session 9, 2026-08-18. STATUS: spec + mockup. NOTHING BUILT.**

The ask, in the user's words:

> *"Could we save certain code notes in my google calander so that if we pull
> from google calander all ui stays the same effectively using google calender
> as persistant storage?"* … *"for each task since we don't store task notes
> just make the task with notes our app can read and interpret to create the
> correct objects ie routine vs commitment vs regular task etc"*

**One event per task**, carrying enough metadata that a pull can rebuild the
right object. Not a JSON blob dumped into a calendar — a round-trippable
encoding, with the calendar staying genuinely useful in Google's own UI.

## 1. It works, and here are the measured numbers

Every figure below was measured or read from Google's documentation, not
recalled.

| | |
|---|---|
| per-task app metadata | **531 bytes** — 1.6% of one event's budget |
| `extendedProperties` ceiling | **32 kB/event**, **1024 bytes/value**, 300 properties |
| ⚠️ over 1024 bytes | **silently truncated** — Google's word, not mine |
| event `id` charset | base32hex: **lowercase a–v and 0–9 only**, 5–1024 chars |
| term-scale state | ~39 kB · **26.5 kB rides on events**, **12.4 kB does not** |

The per-task fields are exactly the discriminators the user named:
`type · routineId · stepIndex · activityId · parentId · chunking · tags · load ·
priority · pinned · placedBy · deadline · completion · satisfaction · history ·
occurrenceData`.

**An unexpected upside.** A Google event stores `{dateTime, timeZone}` — an
explicit IANA zone. `Task.startTime` is raw epoch-ms. `probe-b-tz.mjs` proves a
device timezone change silently rewrites the week; round-tripping through Google
*carries the zone*, so this makes that bug **less** reachable, not more. It does
not fix it (`blockedDays`/`dayNotes` are still bare `'YYYY-MM-DD'`), and that
remains its own open decision.

### What has no event to live on

| homeless | size | why it is not an appointment |
|---|---|---|
| activities | 9.4 kB | 49 templates, never scheduled |
| buckets | 1.7 kB | vocabulary + load vectors |
| config | 1.1 kB | windows, sleep, weights |
| learning model | 0.1 kB, **grows** | trained weights and gates |
| commitments | ~0, grows | "2h/week over a term" is a rule; its *sittings* are events |
| routineInstances | ~0, grows | the **stored program** — see `RoutineInstance.js`'s header |
| zones | ~0 | a zone is a RULE about hours, not a booking |
| retiredTags · snapshots · dismissed · lastSeenWeek | ~0, grows | bookkeeping |

**12.4 kB fits inside ONE event's 32 kB budget** (~13 properties). So this is
achievable with **no new OAuth scope** — `calendar.events` is already held.

⚠️ **Do not build for exactly one library event.** The model and `occurrenceData`
grow all term. Chunk across `sc.lib.0…N` from the start, with an explicit count,
so passing 32 kB is a second event and not a rewrite.

## 2. Decided by the user, 2026-08-18

| # | Question | Answer |
|---|---|---|
| **GS-1** | Where do a task's app fields live? | **Hidden properties + a human summary.** `extendedProperties.private` is the machine truth; the description gets a short readable line. Hand-edits to the notes cannot corrupt data, and the app never parses prose |
| **GS-2** | Where does the homeless 12.4 kB go? | **One hidden event on the same calendar**, chunked. No new scope |
| **GS-3** | Source of truth | **Google is truth, read on open.** Plus: a **guest mode** (localStorage only), a **pirate entry screen**, and a **reminder to export before closing the tab** |
| **GS-4** | A hand edit made in Google Calendar | **It wins** — consistent with R-1, the locked rule that your own hand outranks the scheduler |

## 3. ⚠️ This overturns a locked decision, with authorization

`google.js` opens: *"NOT a sync engine: no sync tokens, no tombstones, no
conflict resolution."* HANDOFF's Decisions section says *"Neither calendar path
syncs. A push sends, a pull reads, nothing reconciles."*

**GS-3 replaces that.** Recorded here rather than quietly contradicted. Two
things that made it true are now known to be available:

- **`syncToken`** — incremental sync is a supported parameter on `events.list`.
- **`showDeleted`** — tombstones are readable, so a deletion propagates.

**And one thing that must NOT survive the change:** today's export uses
`clearRange`, which **deletes every event in the target week** before writing.
That is safe only against a dedicated calendar and is completely wrong for a
store. Per-event `id` operations only. `clearRange` must not be on this path.

## 4. The encoding

### 4.1 Task → event

**Google assigns the event id; we never mint one.** Task ids look like
`x-0001` — a hyphen, and `x` is outside base32hex's a–v — so they are **not
legal Google event ids**. Instead the task id is stored as a property and looked
up with `events.list?privateExtendedProperty=sc.id=x-0001`, which Google
supports as a repeatable filter.

```
summary       task.title
start / end   {dateTime, timeZone}   ← explicit zone, see §1
recurrence    RRULE                  ← ical.js#toRRULE already does this
description   "⚓ Sandy Cay · routine 'laundry', step 2 of 3"   ← human only
extendedProperties.private:
  sc.v        schema version of THIS encoding, independent of schemaVersion
  sc.id       task id
  sc.type     task | routine-step | commitment-sitting | project-chunk
  sc.ref      routineId / commitmentId / parentId, per type
  sc.i        stepIndex / chunk index
  sc.json     the remaining app fields, chunked at 900 bytes: sc.json.0…N
  sc.n        chunk count
  sc.sum      checksum over the reassembled string
```

⚠️ **`sc.sum` and `sc.n` are not ceremony.** Google truncates an over-long value
**silently**. Without a count and a checksum, a chunking bug corrupts a task with
no error anywhere — the exact failure mode this repo has been bitten by
repeatedly (`freq` dropped by both serialisers; a recurring session losing its
`load`). Chunk at 900, not 1024, so the encoding has headroom.

**The description is written but NEVER read.** It exists so the event is legible
in Google Calendar on a phone. If the app ever parses it, a user tidying their
own notes silently changes their schedule.

### 4.2 Day notes and blocked days

All-day events (`start.date`). `blockersToNotes.js` and the `.ics` all-day import
already establish this shape.

### 4.3 The library event

One all-day event parked far in the past (proposed: **1970-01-01**, out of every
realistic view), `sc.type = library`, holding buckets · activities · zones ·
config · model · commitments · routineInstances · retiredTags · snapshots ·
dismissed · lastSeenWeek, chunked exactly as §4.1 describes.

## 5. The entry screen — `design/login-mockup.html`

Three treatments, to be picked **by eye**, the way the day-header bar was:

- **A — the chart table.** Parchment on dark wood, torn edge (an SVG
  displacement filter), a drawn coastline with an X, compass rose, and the gull
  perched on the top edge. Two wax-seal doors.
- **B — the chest at night.** Sea, moon, drifting swells, a gull crossing, the
  chest lighting up on hover. Loudest.
- **C — the bottle.** One object, one line, the choice underneath. Quietest.

All three use **real tokens** from `styles.css` and **real sprites** from
`src/assets/icons` — `seagull`, `treasure-chest`, `compass`, `message-bottle`,
`anchor`.

⚠️ **`image-rendering: pixelated` is load-bearing.** These are ~60–100px pixel
art. The standing decision *"only 3 sprites wired — badges render at ~11px where
art turns to mud"* is about **small** sizes; this screen is the opposite case,
and crisp upscaling is what makes them read as deliberate. **`key.png` is
deliberately avoided** — it is one of the 8 that predate the green sheet.

**Two doors, and the guest door is not a lesser one.** Guest = today's app,
localStorage, nothing leaves the device.

### The export reminder

A guest's week lives in one browser. On `beforeunload` with unsaved changes,
warn. ⚠️ **State the limits honestly when building it:** browsers show their own
generic wording — the custom string is ignored — and `beforeunload` is
unreliable on mobile, which is exactly where a tab gets closed. So it is a
courtesy, **not** a guarantee, and the guest door's own copy has to carry the
warning rather than relying on it.

## 6. Build order — one at a time, each provable alone

| P | What | Provable by |
|---|---|---|
| **P0** | ✅ **BUILT 2026-08-18** — `src/core/googleEncode.js`, `tests/google-encode.test.js`, `design/probes/probe-google-encode.mjs`. 26 tests, 13 mutations bite | see below |
| **P1** | ✅ **BUILT** — `googleLibrary.js`. Term-scale library measures **16.1 kB**, half of one event (the 12.4 kB estimate above missed property keys and the JSON wrapper), so it splits across N events from the start | 16 tests |
| **P2** | ✅ **BUILT** — `LandingScreen.jsx`, `session.js`. Everyone sees it until they choose; changeable from the Cabana; guest proven never to touch the network | 12 tests |
| **P3** | ✅ **BUILT, NEVER RUN FOR REAL** — `core/syncPlan.js` (decisions), `ui/googleSync.js` (execution), `ui/useGoogleSync.js` (wiring), driven end to end by a fake Google | 60 tests |
| **P4** | The export reminder | Manual — still to do |

### ⚠️ P3 is built but has NEVER touched a real Google account

Everything is proven against an in-memory fake. **The first real run wants a
throwaway calendar**, because the GS-5 guard has never actually refused a real
calendar — and a guard that has never run is not evidence.

**Three bugs were found by reviewing P3 rather than by testing it**, and all
three were invisible to a green suite. They are recorded because the *shape*
recurs, not for the history:

1. **The sync never fired.** `now = () => Date.now()` as a default parameter
   rebuilt a function every render, changing `runSync`, re-running the debounce
   effect, whose cleanup cancelled the pending timer. Every sync test called the
   planner and executor DIRECTLY, so not one exercised the trigger. Nothing
   would ever have saved and nothing would have said so.
2. **A corrupt event deleted the local task.** An event failing its checksum is
   dropped from `remote`, so the task looks absent, so it reads as "deleted on
   the other device". The check that exists to CATCH corruption was the thing
   that completed it. `unreadable` now threads from `decodeEvent` → `pull` →
   `planSync`, and those tasks are left completely alone.
3. **Adopting a task lost ten fields.** `updateTask` drops everything absent
   from `UPDATE_WHITELIST` — `load`, `routineId`, `parentId`, `chunking`,
   `history` and more. Correct for a form, catastrophic for a store. Restores go
   through `Schedule#upsertTaskFromJSON`.

**The lesson, in one line:** the round trip was tested exhaustively and the
things *around* it — what triggers it, what happens when a read fails, which
door a write goes through — were not tested at all.

**P0 and P1 need no Google account at all** and are where the risk actually
lives. Do them first.

## 7. Open — NOT decided, do not guess

| # | Question |
|---|---|
| **GS-5** | **Which calendar?** Writing 37 tasks into `Class Schedule` would be a disaster. Proposed: the user picks, it must be dedicated, and the app refuses if it finds events it did not write. Not agreed |
| **GS-6** | **Write cadence.** Every change would burn Google's quota. Debounced? On blur? Explicit save? |
| **GS-7** | **Conflict.** GS-4 says a hand edit wins. But if the same task changed in *both* places while offline, which wins — newest `updated`, or ask? |
| **GS-8** | **Guest → signed-in.** A guest builds a week, then signs in. Upload it, adopt what is in Google, or ask? |
| **GS-9** | ✅ **Defaulted and built:** retried silently once, then said out loud. Change it if the silent retry ever hides something worth knowing |
| **GS-10** | ⚠️ **Opened by P0.** A hand edit to a single event's TIME is honoured (times live only on the event). A hand edit to its **repeat rule** is not — recurrence lives in the payload, because RRULE is strictly poorer than this app's model and storage has to be lossless. So the two hand edits behave differently. Accept the asymmetry and say so in the UI, or try to read RRULE changes back? **Gates P3.** |

## 8. Explicitly not proposed

- **No backend, no database.** That was the constraint and it holds — everything
  here is the user's own Google account.
- **No `auth/calendar` scope.** Still never creating or deleting calendars.
- **No Drive `appDataFolder`.** It was offered (a non-sensitive scope, no size
  limit, no truncation hazard) and **not chosen**; GS-2 keeps everything in the
  calendar with no new consent. Recorded so it is not re-proposed as new.
- **Not a general sync engine.** One user, their own calendars, last-writer-wins
  per event. No multi-user, no sharing, no offline queue beyond localStorage.
