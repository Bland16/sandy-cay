# Candidate 6 — what does taking this slot do to the rest of the day?

**Session 8, 2026-08-13. STATUS: candidate, not evaluated.** The sixth candidate,
written after a real week showed that neither C1 (the day's depth) nor C3 (the
reserve when you sit down) can express the user's actual complaint:

> *"it hit during my break times and I needed rest"*

C3 reads a slot **backwards** — how depleted are you when you start. It cannot
see that an 08:00 slot precedes a six-hour teaching day. On the user's real
Wednesday (580 committed minutes, dip −11.6) an 08:00 sitting scores perfectly
fresh, because at 08:00 nothing has happened yet.

---

## ⚠️ First, the finding that constrains every version of this

**Idle time is invisible to the battery.** Proven
(`probe-idle-recovery.mjs`) — two 3-hour classes at mental +3/h:

```
gap of 0h → deepest dip -12.0      gap of 3h → -12.0
gap of 1h → -12.0                  gap of 6h → -12.0
the same 3h gap with a 2h REST TASK in it → -8.0
```

`reserveWalk` iterates **tasks**; the time between them contributes nothing. So
six hours of doing nothing leaves you exactly as depleted as going straight
through, and **"the gap was my break" has no representation in the model.**

This kills the obvious formulation before it is written. "A gap has recovery
value that consuming it destroys" cannot be computed, because the model says a
gap has no value at all.

## Three ways forward, and only one is available today

### (a) Make idle time restore — NOT AVAILABLE

Give idle time a recovery rate and the intuition becomes directly computable.
But that rate is an **invented constant**, the exact species that disqualified
`κ`, `δ`, `s_free` and `τ` in the first evaluation. It can only become honest by
being *learned* from the user's own energy ratings — which is blocked behind
`design/RATINGS-AND-LEARNING.md` (recurring ratings currently reach nothing) and
then a term of data. **Do not build this now.** Note it as the thing the ratings
fix eventually unlocks.

### (b) Rank by what FOLLOWS — the candidate

Do not claim the gap restores anything. Claim only that **working before a heavy
afternoon is worse than working before an empty one**, which is arithmetic over
the user's own calendar.

```
forward(slot) = Σ over tasks starting after slot.end, same day, of
                max(0, load[axis]) × durationHours          // demanding work only

score(slot)   = 1 − forward(slot) / max forward over candidate slots
```

- **Comparative, no constant.** Same standing as `balance`, `buffer` and the C1/C3
  family: it ranks candidates against each other and never states a limit.
- **Restorative work after the slot does not count** (`max(0, …)`), because a nap
  at 18:00 does not make a 08:00 sitting cheaper — it repays the reserve later.
- **Per axis**, like the rest: a physically heavy evening does not make a mental
  sitting worse.
- **Gated on the task carrying load**, exactly as C3 is, so a characterless task
  is untouched.
- **It composes with C3 rather than replacing it.** C3 says how you arrive;
  candidate 6 says what you are arriving *before*. The natural pairing is
  `C3 + C6 + sibling spacing`, and whether the pair beats C3 alone is precisely
  what an evaluation has to establish.

**On the user's real Wednesday** this is the term that would finally say
something: 08:00 scores well on C3 (fresh) and badly on C6 (580 minutes of
demanding work still to come), where today nothing marks that day at all.

### (c) The gap should have been a rest TASK — the cheap alternative

The model *already* has a way to say "this time is recovery": a protected tag
carrying negative load. The probe above shows it works — the same gap with a
real rest task in it moves the dip from −12.0 to −8.0.

So the user's breaks were not invisible because the model is wrong. They were
invisible **because they were never on the calendar.** If the person schedules
their breaks the way they schedule their classes, C3 alone reads them correctly,
placement routes around them (a protected tag is never auto-evicted), and
candidate 6 may be unnecessary.

**This should be tried before (b) is built**, because it costs nothing and it
tests whether the gap is a modelling problem or a data-entry one. It is also the
more honest framing: the app should not infer that an empty hour was sacred.

## What an evaluation has to answer

1. **Does it change any decision on the real weeks?** If C3 + spacing already
   produces the same plan as C3 + C6 + spacing on both of the user's weeks, the
   term is theatre. Run it before writing code.
2. **Does it just restate `balance`?** `balance` measures time-fill *after
   placement*; forward-load measures demanding work *after this slot*. On a day
   whose load is uniform they may correlate strongly. **Measure how often they
   disagree** — a term that mostly agrees with an existing one is not worth its
   risk (the standing rule from the first evaluation).
3. **Does it push work to the END of the week?** The last slot of the last day
   has nothing after it and therefore scores perfectly. That is a real hazard:
   the term's maximum is always "latest", which fights `buffer` and the user's
   explicit ask to finish earlier. Check the interaction; a term whose optimum is
   "do it last" may need bounding to the day rather than the runway.
4. **What does it do on a day that is heavy at the START?** Symmetric case: a
   slot after the heavy morning has little ahead of it and scores well, while C3
   scores it badly. C3 and C6 will disagree there, and which is right is a
   question about the person, not the arithmetic.
5. **Cold start and no-load** — identical to the others: gated, inert, no claim.

## What this does NOT do

- It does not assert that rest happened, or should have, or would have helped.
- It does not introduce a recovery rate, a capacity, or any threshold.
- It does not look past the end of the day. Tomorrow's load is the **sleep
  guard's** business (`config.sleep.minHoursBeforeNextDay`), which is a hard clip
  and already built; overlapping the two would be two descriptions of one idea.
