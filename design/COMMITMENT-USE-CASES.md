# Commitments — the lifecycle, run

**2026-08-16.** Written *before* the "Lay out this week" button, because the user
asked: *"week one I'm assuming it will either have the weeks work done by the
term day, or the first week will be off. How should I realistically use this?
Before you build set up some use cases, make sure it is airtight no matter
what."*

**22 cases. Every one RUN, not argued.** House method
(`USE-CASE-RUN-2026-08.md`): nothing here is called a pass or a fail on anyone's
opinion, and the invariants are checked mechanically by the probe rather than by
eye. Re-run it any time:

```bash
node design/probes/probe-commitment-cases.mjs
```

The probe also **defines the button** (`previewWeek` / `layOutWeek`) so the
DESIGN was tested rather than an implementation. That is deliberate: it is
cheaper to find out the design is wrong before there is a component to unpick.

## 3 real defects found, all fixed and regression-tested

### 1. Work was placed in hours that had already gone (A3, A4)

**The third appearance of this exact class.** `redistribute` once laid chunks
into a Monday that had gone; `placeTask`'s parking branch once put overdue work
at 08:00 *that same morning*. Both were floored at `now`. `generateSittings`
floored at **`dayStart(now)` — midnight today** — so today's gaps were reported
from the 08:00 window opening however late it already was.

```
A3  clock = Wed 12:00
    BEFORE   laid  09-09 10:30 180m     ← ninety minutes into the past
    AFTER    laid  09-09 12:00 180m
```

Fixed in two places, and **each needed its own test because they fix different
halves**:

- `placeTask` is handed `from: max(day, now)`. This is what stops the bad
  placement — *the past-placement floor is only ever as good as the `from` given
  to it*, which is the exact wording of the `redistribute` bug.
- `gapsOnDay` takes an `after` floor. This one **nearly shipped unproven**:
  reverting it left both placement tests green. It earns its place for a
  different reason — step 3 picks the *longest* gaps first, so without it a
  half-spent Wednesday advertises 08:00–23:00 and gets chosen over a genuinely
  empty Saturday. The same over-count reaches `ρ` through `openMinutesFor`,
  understating exactly the commitment that is most constrained.

### 2. A 30-minute job booked a 60-minute block (C3)

With `amountMinPerWeek: 30` and `minSitting: 60`, `chooseSittings`' single-sitting
branch takes `max(amountMin, sMin)` — so it booked 60m and reported **shortfall
0**, breaking `placed + shortfall === amount`. That is §4.3's stated property and
one the engine's own tests lock.

Clamped in `Commitment` (`minSitting ≤ amountMinPerWeek`) so the incoherent state
cannot be stored, rather than patching the engine.

### 3. A week whose due day had passed manufactured a shortfall

Found by the earlier `probe-mixed-terms.mjs` and fixed before this run — see
that probe and D-7. Case **A5** now locks it: due Thursday, asked Friday, owes
nothing.

## The answer to "how should I realistically use this?"

**Week one is fine, and it is fine in both of the shapes you guessed.**

| you | what happens |
|---|---|
| set the term to start **Monday** and lay it out on the Monday | full week, full amount (A1) |
| set the term to start **mid-week** | week one is Wed–Sun and still owes the **full** amount. It fits in a normal week (A2) |
| forget until **Wednesday** | it plans Wed–Sun from the clock forward, nothing in the past (A3) |
| set a **due weekday** and ask before it | the week ends there; Fri/Sat/Sun are not offered (A4) |
| set a due weekday and ask **after** it | **nothing is owed.** No shortfall, no nagging (A5) |

**Partial weeks are never pro-rated.** A stub week owes its full amount, and
§4.3 states any shortfall as a fact. This is decided, not accidental: pro-rating
means inventing arithmetic you did not ask for, and a threshold ("skip weeks
under N days") is the invented constant P-2 forbids.

**So the realistic pattern is:** set the term to your real term dates, set the
weekly hours, and lay out each week when you get to it. You never need to think
about week one specially.

## What the run shows, case by case

### A — week one

| # | case | result |
|---|---|---|
| A1 | starts Monday, asked Monday | `240/240m short 0m` · Mon 19:30 180m, Sat 08:00 60m |
| A2 | term starts **Wednesday** | window `09-09 → 09-14`, `240/240m short 0m` |
| A3 | asked **Wednesday noon** | `240/240m short 0m`, earliest placement **12:00** |
| A4 | due **Thursday**, asked Wed | window `09-07 → 09-11`, nothing after Thu |
| A5 | due Thursday, asked **Friday** | `PASSED` — nothing owed, no shortfall |
| A6 | due **Monday** (one-day window) | `120/120m short 0m` on the Monday |

### B — term end

| # | case | result |
|---|---|---|
| B1 | term ends Wednesday | window `09-07 → 09-10`, full amount placed |
| B2 | the week after it ends | `OUTSIDE` — nothing owed |
| B3 | a single-day term | one 120m sitting on the day |

⚠️ **B2 was a bad fixture first**, and the correction is worth keeping: leaving
`from` at the week's Monday while setting `until` earlier made the *constructor
swap them*, producing a 1-day term and testing nothing. A swap-guard makes a bad
range harmless and a bad test invisible.

### C — when it does not fit (§4.3)

| # | case | result |
|---|---|---|
| C1 | 20h into a real term week | `1080/1200m short 120m` across six days |
| C2 | week booked 08:00–21:00 solid | `230/240m short 10m` — the evening is real availability by config |
| C3 | amount **below** one minimum sitting | `30/30m short 0m` (was 60/30) |
| C4 | every day **blocked** | `0/240m short 240m` — stated, nothing crammed |
| C5 | three days blocked | full amount into the remaining four |
| C6 | needs 4 sittings, 2 days free | `240/480m short 240m` |

**A shortfall is a fact, once.** It is never re-stated by opening the week,
never grown by time passing, never scored.

### D — several commitments (§4.1.2)

| # | case | result |
|---|---|---|
| D1 | three competing | ρ order, **no day claimed twice** |
| D2 | nine commitments, seven days | all nine placed; three share a Wednesday |
| D3 | mixed terms in one week | running/starts-Wed laid, not-yet `OUTSIDE` |

**D2 is correct, and my first invariant was wrong.** §4.1.2 asks a commitment to
count another's days as *taken* — a strong preference, not a prohibition.
`spreadDays` falls back to the full candidate pool when free days run out, which
is right: nine commitments cannot have nine days in a seven-day week, and
refusing to place two of them would be worse than sharing a Wednesday. The probe
now *reports* shared days rather than failing them.

### E — pressing it again

| # | case | result |
|---|---|---|
| E1 | press once | 2 sittings |
| E2 | press again | **no-op** — 0 results, task count unchanged |
| E4 | move one by hand, press again | **the hand survives**, count unchanged (R-1) |

**E3 is an open question, not a defect.** Delete a sitting by hand and press
again: the week is **not** topped up, because "already laid out" is a per-week
boolean rather than a per-amount reconciliation.

Arguments both ways, and the decision belongs to the user:

- **Not topping up** respects R-1 — you deleted it on purpose — and cannot
  produce the growing-shortfall behaviour D-3 forbids.
- **But** the week now holds 1h of a 4h commitment while the app considers it
  done, so the preview must **state what is actually there** (`2h of 4h laid
  out`) rather than a bare `DONE`. Facts, not a verdict.
- The "Replace this week's sittings" verb is the deliberate way back, with a
  confirm, kept distinct from the everyday one — the same reason blocking a day
  and clearing a day stayed separate.

## Invariants the probe checks on every case

- `placed + shortfall === amount` (§4.3)
- every sitting within `[minSitting, maxSitting]`
- never more than `maxPerDay` on a day
- **nothing before the clock**
- nothing on a blocked day
- nothing before the window's start or on/after its exclusive end
- no overlap with anything already on the grid
- two commitments sharing a day is *reported*, and only expected when days ran out
