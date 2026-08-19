# Find a time — ranked by whether the slot suits the thing

**Status:** spec, unbuilt. Written 2026-08-19 after the use case *"I need to
schedule a meeting between 2 and 5; can Find a time rank by best fit for a tag?"*

---

## 1. Half of it already works

**The window is built.** `FindPanel` has *"Only between (optional)"* with two
`<input type="time">` fields, and `Schedule#findFreeSlots({ window })` honours
it. "A meeting between 2 and 5" is expressible today: set the duration, toggle
the window, 14:00 → 17:00.

So this document is about **one** missing thing: the openings come back in
**chronological order**, and the ask is for them to come back in order of *how
well the slot suits what you are putting in it*.

---

## 2. What must NOT change

⚠️ **`findFreeSlots` is deliberately UNSCORED** — sharp edge #13: *"it returns
the first gap after `from`, not the best one. Fine for 'show me openings' (Find
Times), wrong for placing."* `findBestSlot`/`placeTask` are the scored path.

That distinction is load-bearing and this must not blur it. **Ranking is a
separate pass over the openings `findFreeSlots` returns**, not a change to how
gaps are found. `findFreeSlots` keeps returning every opening, in time order,
exactly as it does now; a new `rankOpenings()` reorders a copy.

Consequences, deliberately:
- With no tag given, the list is unchanged — chronological, as today.
- The ranking never *hides* an opening. It reorders and annotates.

---

## 3. The rule — decided by the user, 2026-08-19

> *"Learned once there is data; a combination of reserve-headroom and
> least-impact until then, with least impact dominant."*

```
if the model can speak about this tag   → rank by what you have actually done
otherwise                               → rank by least impact, then headroom
```

### 3.1 "Once there is data" is a gate that already exists

`LearningModule#modelScore(task, slot)` **returns 0 until
`sampleCount >= config.coldStartRatings` (10)**. That is this project's own
answer to "when may the model speak", already chosen, already used by
`scoring.js` for the `preference` weight. Reuse it; do not invent a second
threshold.

**Per-tag, on top of that** — PROPOSED, not decided: the tag must be in
`model.vocab`. The vocabulary is the top-N tags by frequency *among rated
tasks*, so a tag absent from it has no term in the feature vector at all and the
score carries no information about it. This is a precise, code-grounded meaning
for "there is data for this tag", rather than a number I picked.

⚠️ `inspect()` already warns about the failure mode here: *"A caller that ranks
on `weight` alone will rank an untried sitting length above one you have tried
and disliked."* Ranking openings is exactly such a caller. Using `modelScore`
(which is gated) rather than raw weights avoids it.

### 3.2 The fallback, until then

Two terms, both from `energy.js`, **least impact dominant**:

| term | from | meaning |
|---|---|---|
| **impact** (primary) | the day's deepest dip if this were placed here | how much worse the rest of your day gets |
| **headroom** (secondary) | `reserveAt(schedule, slot.start)` on the axes this tag spends | how much you have left at that moment |

The task's per-axis load comes from `loadForTask(schedule, draft)` where `draft`
carries the given tag and the chosen duration — the same derivation the grid and
the battery already use, so a slot's score and the card's colour agree.

**Impact needs one new export.** `energyTrajectory(schedule, date)` walks the
day's *real* tasks; ranking needs the dip *with a hypothetical one added*. Add
`dipIfPlaced(schedule, slot, draft)` beside it, sharing `reserveWalk`, so there
is one walk and not two.

---

## 4. What the user sees

- An optional **tag** field in Find times, beside the duration.
- With a tag set, the list reorders and each row gains **one short reason** —
  `"most mental left"`, `"barely dents your day"`, `"you usually do study here"`.
- A line saying which rule is in force, because the two behave differently and a
  silent switch between them is the surprise P-1 exists to prevent:
  - *"Ranked by what you have actually done."*
  - *"Ranked by energy — still learning your preferences (4 of 10 ratings)."*

That second line reuses the **"still learning" shape** the energy card already
uses. No fabricated confidence, and the count says how far off it is.

---

## 5. Open — needs an answer before building

| # | Question | Proposed |
|---|---|---|
| **F-1** | Is "data for this tag" = in `model.vocab` + past cold start? | Yes — §3.1. It is the only code-grounded meaning available |
| **F-2** | One tag, or several? | **One.** Several makes the reason line unexplainable, and `loadForTask` already blends multiple buckets if the one tag touches several |
| **F-3** | Does the ranked list stay capped at 30 rows? | Yes, as today — but **sorted before slicing**, or the cap silently discards the best openings |

---

## 6. Build order

| P | What | Provable by |
|---|---|---|
| **P0** | `dipIfPlaced` in `energy.js` | unit — a task placed into a full afternoon dips further than into an empty one |
| **P1** | `rankOpenings(schedule, slots, { tag, durationMin })` — pure, no DOM | probe printing a real afternoon's ordering under both rules |
| **P2** | The tag field + reason line in `FindPanel` | rendered and DUMPED, per the standing lesson |

⚠️ **P1 is where the risk is**, and it is the same risk as everywhere else here:
the ordering must be *checked against a real day*, not reasoned about. A probe
that prints "here are five openings and why each ranked where it did" is the
deliverable, not the unit test.
