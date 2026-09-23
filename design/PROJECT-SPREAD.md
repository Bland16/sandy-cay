# A project spreads across its range

**Session 9, 2026-09-23.** Status: **SPEC → build.** Reported from the running
app: *"I added a new project from Friday to Thursday and it scheduled all
sessions during Saturday."*

---

## 1. Reproduced

A 600-minute project, 60–120 minute chunks, Fri 18 Sep → Thu 24 Sep:

```
Fri 08:00-10:00  120m
Fri 10:30-12:30  120m
Fri 13:00-15:00  120m
Fri 15:30-17:30  120m
Sat 08:00-10:00  120m
```

**Four of five on the first day, the fifth on the next, nothing on the remaining
five days of a seven-day range.** Which day it piles onto is simply where the
range starts — the user's landed on a Saturday.

## 2. Why

`redistribute` computes the search floor **once**, outside the loop, and gives
every chunk the same one:

```js
const from = (now > range.from && now < range.until) ? now : range.from;
for (const size of sizes) {
  const res = placeTask(schedule, child, { from, to: range.until, occupied });
}
```

Every chunk therefore searches from the same origin, and **`proximity` is the
heaviest weight in the scorer (0.5) against `balance` (0.35)**. Proximity wins;
chunks crowd the front and only move on when a day physically runs out of room.

**This is not the scorer misbehaving.** SPEC §3.7 says chunks are "placed by
§2", and §2's balance term was never going to outvote proximity on its own.
Spreading has to be asked for.

### 2.1 The tell — commitments already solve this, projects never call it

`generate.js` exports **`spreadDays(candidates, n, { taken, rank })`**: picks N
distinct days evenly across a range, with an energy nudge bounded to
`ENERGY_NUDGE_DAYS = 0.75` so spacing wins every disagreement wider than a day.
Its docblock carries the finding it was built on:

> *"burnout is clustering, not sitting length. 5 × 4h taken greedily lands on
> five consecutive evenings, and shortening the sitting to 'fix' that produces
> NINE consecutive evenings; the same 5 × 4h on alternate days gives a streak of
> one."*

Commitment layout calls it. **Projects never have.** Two features that lay N
sittings over a range, and only one of them spreads — which is exactly the
"two descriptions of one idea" debt this project keeps paying down, in the form
where one copy simply does not exist.

## 3. Decided — reuse `spreadDays`

Chosen over the alternatives, which were:

- **Advance the floor per chunk** (each searches from the end of the last). One
  line, but it only enforces *order*, not *distribution*: a free Friday still
  absorbs several before spilling.
- **Raise `balance` above `proximity`.** Global, changes every placement in the
  app for one feature's benefit. No.

**The mechanism:** compute the days the range covers, ask `spreadDays` for as
many as there are chunks, and give chunk *i* a floor of its assigned day's start
rather than the range's start. `to` stays `range.until`, so a day that turns out
to be full lets the chunk fall forward instead of failing — the floor steers,
it does not constrain.

### 3.1 More chunks than days — round-robin

Ten chunks over seven days must double up somewhere. Chunk *i* takes
`spread[i % spread.length]`, so the extras distribute evenly instead of all
landing back on day one. `spreadDays` already returns fewer days than asked when
the pool is smaller, so this is the only extra rule needed.

### 3.2 ⚠️ Do NOT pair by position without checking room

`commitmentWeek`'s own comment records what that cost: sittings were descending
by length while `spread` was ascending by date, so the longest sitting got the
earliest day whatever that day's longest free run was, `placeTask` fell through
to its last-resort park, and the app reported "240/240m short 0m" with a sitting
laid on top of an eight-hour booking. **In a 2000-week fuzz, 68 of 77 parked
sittings were this.**

Projects are safer by construction — chunks are near-equal by `sliceChunks`, and
the floor steers rather than constrains — but the failure mode is the same shape
and the guard is to keep `to = range.until` so a chunk can always fall forward.

## 4. Unchanged on purpose

- **Conservation.** `sliceChunks` and the preserved/auto split are untouched; the
  same minutes are laid, in the same sizes, on different days.
- **The `now` floor.** A project already underway still starts from now, not from
  its own start date — the fix that stopped chunks landing in time that had gone.
- **`placedBy: 'user'` and completed children are preserved**, as before. Only
  auto children flex.

## 5. Open

- **D-1. Should a project prefer days it is not already on?** `spreadDays` takes
  a `taken` set, which commitments use so three commitments do not all aim at day
  0, day 2, day 4. Two concurrent projects will currently collide the same way.
  **Not fixed here** — it needs a decision about whether projects compete with
  each other or with commitments too.
