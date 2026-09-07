# Calendar import — provenance, and the door that has none

**Session 11, 2026-09-07. STATUS: §2.4 and §2.5 FIXED and tested. §2.1–2.3 and
§2.6-adjacent work specced, not built.**

Read §4 Tier 3 for exactly what shipped. In short: the two doors can no longer
corrupt the store calendar, but **the reported bug (§2.1) is still open** — an
import still appends blindly, because fixing it properly needs the provenance
field in Tier 1.

Reported by the user: *"there is a bug with loading from the calender where it
doesn't clear out current tasks and the resultant schedule is weird"*.

That is real (§2.1). Chasing it found five more, one of which destroys the store
calendar (§2.5). Everything here was verified by reading the call sites and, where
it is stated as proven, by running it.

---

## 1. The frame: there are TWO identity spaces, and the code has one door too few

Everything in this document follows from keeping these apart.

| | `sc.id` | foreign `UID` |
|---|---|---|
| authored by | this app | you, elsewhere |
| lives in | the store calendar (GS-5, dedicated) | your own calendars |
| covers | tasks, routine steps, commitment sittings, chunk parents | classes, meetings |
| encoded by | `core/googleEncode.js` — namespaced, chunked, checksummed | nothing; it is someone else's event |
| read by | the **sync** door (`useGoogleSync`) | the **import** door (`CalendarCard`) |
| truth | Google (GS-3) | you |

**The sync door restores state that already existed. The import door interprets
something new.** They are not two flavours of the same operation, and the bugs
below are all a consequence of code that treats them as if they were.

⚠️ **A generated task is not an unidentified task.** Routine touchpoints,
commitment sittings and chunk parents carry no foreign UID and never will — but
they are fully identified in the left-hand column, and they are stored in the
calendar like anything else. `kindOf` (`googleEncode.js:186`) classifies them
explicitly and `sc.ref` / `sc.i` make them queryable. An early draft of this
document proposed an exception list for them in the import planner. That was
wrong: they are not in the import door's address space at all, so there is
nothing to except.

**Verified by execution.** A three-step laundry routine and a weekly maths
commitment were built, encoded with `encodeTask`, handed back as Google would
hand them back, and decoded:

```
touchpoints: 2                    (the passive `wash` is a wait, not a task — correct)
  load:   kind=routine-step       ok=true routineId=laundry-run stepIndex=0 activityId=laundry-act
  switch: kind=routine-step       ok=true routineId=laundry-run stepIndex=2 activityId=laundry-act
  Maths:  kind=commitment-sitting ok=true parentId=maths-commit  type=flexible
library: routineInstances 1 -> 1, commitments 1 -> 1, steps preserved
```

Round-trip fidelity is intact, including `stepIndex` surviving a skipped step.
**No bug was found in routines or commitments themselves.** They are only ever
damaged from outside, by §2.4 and §2.5.

One latent sharp edge noted while there, not currently reachable: `encodeTask`
writes `sc.ref` from `parentId` and then overwrites it from `routineId`
(`googleEncode.js:441-442`). A task holding both would lose the `parentId` index.
Nothing constructs such a task today, and the payload keeps both regardless, so
this costs a query and not data.

---

## 2. Findings

### 2.1 The import door appends blindly — the reported bug

`CalendarCard.jsx:60` (`.ics`) and `:129` (Google pull) both end in:

```js
mutate((s) => { for (const t of tasks) s.tasks.push(t); });
```

No reconciliation, no dedupe, no clearing. Import the same week twice and every
event exists twice. Import over a planned week and the calendar's events land *on
top of* what was already there — and since `eventToTask` produces
`type: 'fixed', placedBy: 'user'` (`ical.js:369`), they are immovable anchors that
overlap everything. That is the "weird schedule".

It also bypasses `_uniqueInColl`, the id-collision guard every other collection
gets.

### 2.2 The root cause: `eventToTask` discards the UID

`parseICS` reads `UID` (`ical.js:330`). `normalizeGoogleEvent` sets `uid: ev.id`
(`google.js:206`). **Both paths have the identifier. `eventToTask` never copies it
onto the Task.**

So an imported task carries no record of where it came from, and a re-import mints
a brand-new id. Deduping is not merely unimplemented — it is not *expressible*.
Neither is "clear what I imported last time", because nothing distinguishes an
imported task from one you wrote by hand.

### 2.3 Imported tasks are silently adopted into the store

Because an imported task has no sync-state entry, the next debounced sync (GS-6,
~5s after any edit) reaches `planSync`'s ambiguous branch (`syncPlan.js:186`):

> *"Seen before means it was deleted on the other device; never seen means it is
> new here."*

`markDirty` skips it (`syncPlan.js:65`, `// never synced; CREATE will handle it`),
so it falls to `plan.create` with reason `'never synced'` and is written into the
store calendar as an app-owned event with a fresh `sc.id`.

**"Never synced" and "new here" are the same state.** The planner cannot tell an
event you authored from an event you imported, because §2.2 destroyed the only
thing that could have told them apart.

Compounding: the GS-8 library gate cannot see this, because `LIBRARY_KEYS`
(`googleLibrary.js:52`) holds zones, buckets, activities, retiredTags, commitments,
commitmentDone, routineInstances, config, model, snapshots, lastSeenWeek,
dismissed — **tasks are not in the library.** A device that has just imported forty
class events still hashes to `freshLibraryHash()`, takes the FRESH branch, and
adopts.

### 2.4 The import door mangles the app's own events

`normalizeGoogleEvent` passes the raw private properties through as `x`
(`google.js:214`). `eventToTask` reads `x.type`, `x.pinned`, `x.priority`,
`x.deadline` — the flat names written by §2.5's encoding — and **never looks at
`sc.*` at all.**

The Cabana calendar picker lists every calendar `listCalendars` returns, including
the store calendar. Nothing excludes it.

So: pull your own store calendar through the import door, and every event decodes
by falling through every branch — `type: 'fixed'` (the default), `pinned: false`,
`priority: 3`. `routineId`, `stepIndex`, `parentId`, `chunking` and `activityId`
sit inside `x['sc.json.0']` as a JSON string that nothing parses. Routine chains,
commitment sittings and project structure are flattened into anonymous fixed
blocks, duplicated alongside the originals, then pushed back up by §2.3.

The encoding that exists precisely to make these reconstructable is bypassed,
because the import door does not know it exists.

### 2.5 ⚠️ Cabana "Export → Google" destroys the store calendar

The sharpest finding, and independent of the reported bug.

**There are two incompatible encodings of a task into a Google event.**

| | `googleEncode.js` (sync) | `google.js:243` `taskToGoogleEvent` (Cabana push) |
|---|---|---|
| identity | `sc.id` | `sandycayId` |
| payload | chunked JSON + checksum + `sc.kind` + version | five flat strings |
| carries | every field, incl. routine / commitment / chunk structure | type, pinned, priority, tags |
| recognised by `isOurs` | ✅ | ❌ |

`isOurs` (`googleSync.js:36`) tests `sc.id` or `sc.kind === 'library'` **only**.

Now trace `pushToGoogle` (`CalendarCard.jsx:86`). Its target defaults to a calendar
matching `/sandy\s*cay/i` — *the store calendar*, by name. It then calls:

```js
const removed = await clearRange(token, target, from, to);
```

and `clearRange` (`google.js:345`) deletes **every event in the range,
unconditionally** — no ownership check, no `isOurs`, no filter of any kind.

The full path:

1. Cabana → Export → Google, target defaulted to the store calendar.
2. `clearRange` deletes that week's `sc.*` events — tasks, day notes, blocked days.
3. The week is re-inserted in the flat encoding, invisible to `decodeEvent`, which
   returns `notOurs: true` without `sc.id`.
4. Next sync: `pull` skips them as foreign, so every task reads as *deleted on
   another device* → `plan.deleteLocal`.
5. The bulk guard (`isBulkDelete`, floor 3 **and** 50% share) catches this only if
   the week is most of the schedule. **One week out of a term is not, so it
   proceeds silently.**
6. GS-5 `inspectCalendar` now reports the store calendar as unsafe, naming your own
   task titles back to you as events "that are not ours".

Two doors writing two encodings into one calendar, and the older one wins by
deleting first.

### 2.6 Import silently discards two of its own return values

`importEvents` computes day notes for all-day events (`ical.js:415` — added
specifically because a 1440-minute anchor *"drew in the PREVIOUS day's column and
sterilised it"*) and returns them as a non-enumerable `.dayNotes`. It also returns
`.dropped`, the repeat rules it could not read, whose own comment says flattening
them silently is *"data loss they have no way to notice"*.

**Neither caller reads either property.** Both are computed and thrown away.

---

## 3. Decided (user, 2026-09-07)

| # | Question | Answer |
|---|---|---|
| **CI-1** | Re-import over a locally edited task | **Google wins, always.** An edit made on the phone is a hand edit, and GS-3 already makes Google truth. No merge, no timestamp comparison. |
| **CI-2** | Do imported tasks push to the store? | **Yes**, so they restore to a new device. Guest-mode import → sign in → push remains the deliberate route for laundering an import into app-owned state. |
| **CI-3** | What is removed on a pull | **Anything in scope without a matching UID**, so the week mirrors the calendar. |
| **CI-4** | How it is confirmed | **A panel with rows, modelled on `ClearDayPanel`** — never a silent wipe, never a bare confirm dialog. |
| **CI-5** | Tag-filter interaction | Removal is computed **before** the filter. The filter decides what is *imported*; the full fetched set decides what *survives*. Otherwise `only tags: study` means "delete everything that isn't study". |
| **CI-6** | Range | Removal is scoped to the **fetched range only** (today `weekStart → +7d`). Nothing outside it is touched, so a pull can never reach the term. |

---

## 4. The fix

### Tier 1 — provenance

Add to `Task`:

```js
source = { uid, calendarId, importedAt } | null
```

- ⚠️ **`toJSON` omits it when null.** Existing tasks then serialise
  byte-identically, so no `taskHash` moves, so the first sync after deploy does not
  mass-update the whole term.
- It rides to Google for free: the payload is chunked whole-task JSON
  (`sc.json.0…n`), not a field registry. Unlike `LIBRARY_FIELD` there is nothing to
  forget to register.
- It stays **off** `UPDATE_WHITELIST` (`Schedule.js:46`). Provenance is a fact about
  origin, not a user-editable field. `upsertTaskFromJSON` — the adopt path —
  bypasses the whitelist, so it survives sync.
- `eventToTask` stops discarding the uid it already receives.

### Tier 2 — make import reconcile

New `core/importPlan.js`, mirroring `syncPlan.js` in shape and testability:

```js
planImport(localTasks, incoming, { calendarId, from, to })
  → { create, update, remove, untouched, decisions }
```

Matched on `source.uid` + `source.calendarId`:

| local | in this pull | → |
|---|---|---|
| `source == null` (hand-authored) | — | **untouched** |
| uid matches | present | `update` (CI-1: incoming wins) |
| uid from **this** calendar, in range | absent | `remove` |
| uid from another calendar | — | untouched |
| — | new uid | `create` |

That first row is the whole safety story: "clear the week" is safe *because* the
wipe is scoped to this calendar's own prior imports, and cannot reach anything you
planned yourself.

`decisions` is a row per task saying what was decided and why — the same device
that made every `syncPlan` bug diagnosable from the outside.

Both doors go through it. The blind `s.tasks.push` disappears from both.

### Tier 3 — the guards that should have caught all of this

1. ✅ **`importEvents` refuses app-authored events.** If an incoming event carries
   `sc.id` or `sc.kind`, it is ours: skip it and report it on `.refused`. The guard
   is in core so it holds for every caller and every route in.

   ⚠️ **A correction to an earlier draft of this document,** which justified the
   placement by claiming a re-imported `sandy-cay.ics` "has the same shape". It does
   not. The `.ics` export writes `X-SANDYCAY-*`, which `parseICS` lowercases into
   exactly the `x.type` / `x.pinned` / `x.priority` vocabulary `eventToTask` reads —
   that path is a deliberate, lossy-but-honest re-import and **must keep working**.
   Only the `sc.*` namespace means "this is the save file". A guard written to the
   draft's reasoning would have broken `.ics` re-import entirely. Pinned by a test.
2. ✅ **Both pickers exclude the store calendar**, and the push refuses it even if a
   stale `target` survives a re-connect. The default target no longer selects by
   name — `/sandy\s*cay/i` matched the store calendar, which is step 1 of §2.5.
3. ✅ **`clearRange` takes a REQUIRED ownership predicate.** Not optional: the safe
   default and the dangerous one look identical at a call site. It returns
   `{removed, kept}` and the toast says what it left alone.
4. **Retire `taskToGoogleEvent`.** NOT DONE — one encoding, or the two keep
   diverging. Deferred because the Cabana pull is paired with it: `eventToTask`
   reads the flat vocabulary, so changing the push without changing the pull breaks
   the round trip. Now confined to non-store calendars, where the sync never looks,
   so it is no longer dangerous — just duplicated. Do it with Tier 2.
5. **A bulk-CREATE guard** mirroring `isBulkDelete` — same floor-and-proportion
   shape, opposite sign. NOT DONE; belongs with Tier 2, which is what makes large
   creates possible in the first place.
6. ✅ **`.dayNotes`, `.dropped` and `.refused` are wired up** in both doors. Day
   notes are planted; the other two are reported in the toast. ⚠️ An import of
   nothing but all-day events is no longer "no events found" while silently
   changing the schedule.

### Tier 4 — NOT in this change

`dirtyAt` is newest-*noticed*, not newest-*edited*. `syncPlan.js:25` explains why it
was built that way; `useGoogleSync.js:330` explains what it costs — a stale device
wins conflicts *because* it woke up last. Tier 2 removes the interaction that made
this acute (you no longer end up with stale originals and fresh duplicates side by
side), but the rule is still wrong for a device that has been asleep. Fixing it
means a real per-task `editedAt` stamped at mutation time, which means every mutator
must stamp it and missing one is invisible.

**Left open deliberately.** Recorded here so it is not rediscovered a third time.

---

## 5. Still open

- **The removal panel's rows.** `ClearDayPanel`'s contract is that commit stays
  disabled until every row is resolved — *"what the scope buys you is the obligation
  to look"*. Does the import panel inherit that, or does it default to the plan and
  let you veto rows? The first is safer; the second is what a weekly class-schedule
  refresh actually wants.
- **What `update` does to lived data.** CI-1 says the calendar's content wins, but
  `satisfaction`, `completion`, `history` and `occurrenceData` are not the
  calendar's to have an opinion about. Proposal: incoming wins for
  title / time / tags / recurrence; lived data is preserved from the local task.
  This needs confirming — it is the one place CI-1 should probably not be read
  literally.
