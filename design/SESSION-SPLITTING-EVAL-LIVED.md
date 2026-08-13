# Session splitting — the lived evaluation

**Session 7, 2026-08-12. Evaluates `design/SESSION-SPLITTING.md` candidates 1–7 +
the hybrid.** This is the *lived* half of the review: every equation was
implemented, run over 15 scenarios, and the tables below are what came out —
not what I expect would come out. The engine-side review is separate; where I
touch code it is only to check that my model of placement is faithful.

Method: a throwaway `.mjs` implemented all seven candidates, the document's
hybrid, and two variants of my own. Candidates 1–4, 6 and 7 emit `(n, s)`, so
each was then **placed** into the scenario's real gaps by earliest-fit — faithful
to the shipped scorer, because with identical days `balanceScore` (`1 −
dayFillAfter`, `scoring.js:93`) cannot discriminate between them and `proximity`
breaks the tie toward the front. Candidate 5 and the hybrids place directly.
Candidates 6 and 7 train **the real `src/core/learning.js`** on synthetic rated
tasks. The script was deleted; every table below is its output.

---

## 1. The recommendation, and the strongest objection to it

> ### Take candidate 5, add **spacing**, and add nothing else.

Concretely — the row labelled **H\*** in every table below:

```
sizing   = candidate 5, unchanged: the week's real gaps, longest first,
           clamped to the user's own s_max, honouring s_min and maxPerDay
spacing  = aim for one sitting every  span(R*) / n  days; relax the spacing
           requirement one day at a time until the amount fits
constants invented: NONE.  s_min, s_max, maxPerDay are the user's own.
```

**Why, in one line:** across 15 scenarios H\* is the only candidate that never
leaves placeable work unplaced, never books a sitting the week cannot hold, never
produces a plan that changes when you replan tomorrow, and collapses to
`1 × 45m` for a 45-minute task — while giving the user the four-hour runs they
said they wanted.

**The finding that drove it, and it contradicts the document's premise.** The
document assumes "fewest sessions" is the burnout machine and builds candidates
2, 3, 4 and 7 to fight *sitting length*. The scenarios say the danger is not
length, it is **clustering** — and not one of the seven candidates looks at it.
On the even-4h fortnight, candidate 1 and candidate 5 both give `5 × 4h` **on
five consecutive evenings** (`longest consecutive streak = 5`, `days eaten whole
= 5`). That is the burnout case, and it is not fixed by making the sittings
shorter: candidates 2, 3, 4 and 7 all answer it with **nine consecutive
evenings** instead, which is worse in every way a person actually feels. H\*
gives the same `5 × 4h` on days 0, 2, 4, 6, 8 — `streak = 1`. Identical sitting
length, completely different fortnight.

Every candidate that fights sitting length pays for it in unplaced work,
invented constants, and a plan that reshuffles under you. Spacing costs none of
those.

### The strongest objection to my own recommendation

**H\* still eats five whole evenings.** On the doc's baseline week it books
100% of the open time on each of five days (`days eaten whole = 5`), which is
precisely the harm candidate 2 exists to prevent — "consuming every free hour
you had, which is a different way to burn out than a ten-hour day but not a
better one" (SESSION-SPLITTING §C1). My defence is that a whole evening with a
clear day either side is a different animal from five in a row, and that the
user said in as many words *"I can work for four hours straight if my week has
that chunk open."* **I cannot prove that defence.** It is a claim about how this
person feels, and the only thing that can settle it is their ratings — which is
exactly the hook §7 asks about, and the one place I would let learning in.

The document's hybrid, with a day cap, is the honourable alternative, and it is
my second choice. But I ran it (row **H+**, with the band edges smoothed to a
continuous `κ(ρ)` and a floor so the cap never bites below two minimum sittings)
and the price is visible: on the doc's baseline it turns `5 × 4h` into
`6 × ~3h20`; on the 6-month runway it turns `5 × 4h` into `9 × 2h`, which is a
worse answer to a question with no pressure in it at all; and its output moves
between 6 and 7 sittings as you replan across the week while H\* does not move.

---

## 2. Ranking

| # | Candidate | Verdict |
|---|---|---|
| **1** | **H\*** — C5 sizing + even spread | Places everything placeable in all 15 scenarios. Perfectly stable on replan. Zero invented constants. Collapses correctly to `1 × 45m` and `1 × 2h`. Only weakness: whole evenings. |
| **2** | **C5** — fewest-longest against real gaps | The same sizing, and §4.1's literal reading. Identical to H\* everywhere except *which days*. Its one flaw is the one the document names: five consecutive evenings. Adding spacing is a smaller change than any other candidate is. |
| **3** | **Hybrid / H+** — C5 + a day cap | Genuinely good and the only one that keeps `days eaten whole = 0` on the baseline. Costs: one invented constant, more sittings than asked for on a relaxed runway, band-edge jumps unless made continuous, and it under-books tight weeks (see §6). |
| **4** | **C1** — cap and fill | Cheap, stable, passes the named test, collapses correctly for small work. But it is blind: it places **nothing at all** in 3 of 15 scenarios (fragmented week, 6h fortnight, exam week) because it asks for a 4h run in a week whose longest gap is 45 minutes. |
| **5** | **C6@mature** — learned sitting length | Only defensible as an *advisory* on `s_max`. As a mechanism it is unstable (§9): at 60 ratings, the same person's 20h project comes out as 5, 7 or 10 sittings depending on which 60. |
| **6** | **C4** — pressure-banded | The band edges are a real legibility failure: **+48 minutes of work turns `4 × 4h` into `6 × 2h24`.** Also books a 4-hour block for a 45-minute task. |
| **7** | **C3** — fatigue-discounted | Three invented constants, and the document's own worked example is wrong at 15-minute resolution (§7). Places nothing in the three short-gap weeks. |
| **8** | **C2** — intensity-capped | **Effectively fails the named acceptance test.** On 20h/14d it declares the plan *infeasible* and comes up 48 minutes short — on a week that C5 fills comfortably in five sittings. The failure mode is not `n = 2`, it is a false "this doesn't fit". |
| **9** | **C7** — learned κ | Cannot deliver what it promises. `dayFill` is a single **linear** scalar; a linear weight gives a direction, never a level (§10). Wiring `dayFill` is still urgent — but not for this. |

---

## 3. The named acceptance test

`A = 20h`, `R = 14d`. **No candidate produces `n = 2`.** The named test is not
discriminating; every equation in the document passes it. What discriminates is
what happens *around* it:

- **C2 fails it a different way.** It asks for 9 sittings on 8 usable days,
  declares infeasible, and places 19h12 of 20h. The document's own worry —
  *"a wrong κ makes the app refuse work that would have been fine"* — is not
  hypothetical, it is what the default κ = 0.6 does on the named case.
- **C6 at 10 ratings fails it too**, in the same way: it asks for 10 × 2h on
  8 usable days and comes up **4 hours short**.

---

## 4. The scenario tables

Legend: **asks for** is `(n, s)` as the equation computes it. **actually placed**
is what survives contact with the week. **days eaten whole** counts days where
this one thing took ≥90% of that day's open time. **longest consecutive streak**
is the burnout number.

Constants throughout: `s_min` 30m, `s_max` 4h, `maxPerDay` 1, `κ` 0.6,
`s_free` 90m, `δ` 0.75, `τ` 15%. `R* = 0.8·R` per the shipped buffer rule.

### 20h / 14d — doc baseline (4h evenings, 3 days off)

`A` 20h · `R` 14.00d → `R*` 11.20d · `Ω` 32h · `D` 8 · longest single run 4h · `ρ` 0.63 · m=1

| candidate | asks for | sitting | actually placed | short by | days used | longest consecutive streak | days eaten whole | % of open time | note |
|---|---|---|---|---|---|---|---|---|---|
| C1 cap+fill | 5 × 4h | 4h | 5 × = 20h | — | 5 | 2 | 5 | 63% |  |
| C2 intensity | 9 × 2h24 | 2h24 | 8 × = 19h12 | **48m** | 8 | 4 | 0 | 60% | declares INFEASIBLE (n 9 > D·m 8) |
| C3 fatigue | 9 × 2h30 | 2h30 | 8 × = 20h | — | 8 | 4 | 0 | 63% | waste 2h30 (13%) |
| C4 pressure | 8 × 2h30 | 2h30 | 8 × = 20h | — | 8 | 4 | 0 | 63% | ρ=0.63 tight |
| C5 greedy gaps | 5 × (gaps) | 4h | 5 × = 20h | — | 5 | 2 | 5 | 63% |  |
| Hybrid 5+cap | 7 × (gaps) | 3h12/48m | 7 × = 20h | — | 7 | 3 | 0 | 63% | ρ=0.63 tight, cap 80%·day |
| C6 learned — cold | 5 × 4h | 4h | 5 × = 20h | — | 5 | 2 | 5 | 63% | cold: no learned sitting → stated default s_max |
| C6 learned — 10 ratings | 10 × 2h | 2h | 8 × = 16h | **4h** | 8 | 4 | 0 | 50% | learned dur:90-150 → 2h |
| C6 learned — 60 ratings | 7 × 3h15 | 3h15 | 7 × = 22h45 | — | 7 | 3 | 0 | 71% | learned dur:150-240 → 3h15 |
| C7 learned κ — cold | 9 × 2h24 | 2h24 | 8 × = 19h12 | **48m** | 8 | 4 | 0 | 60% | κ PRIOR 0.60 · INFEASIBLE |
| C7 learned κ — 10 | 9 × 2h24 | 2h24 | 8 × = 19h12 | **48m** | 8 | 4 | 0 | 60% | κ PRIOR 0.60 · INFEASIBLE |
| C7 learned κ — 60 | 7 × 3h12 | 3h12 | 7 × = 22h24 | — | 7 | 3 | 0 | 70% | κ 0.80 |
| **H+ spaced, continuous κ(ρ)** | 6 × (gaps) | 3h24/3h | 6 × = 20h | — | 6 | 2 | 0 | 63% | ρ=0.63, κ(ρ)=0.85, spaced |
| **H\* spread-only (C5 sizing, no day cap)** | 5 × (gaps) | 4h | 5 × = 20h | — | 5 | 2 | 5 | 63% | aimed ~1 sitting / 2d |

### 20h / 14d — even 4h every day

`A` 20h · `R` 14.00d → `R*` 11.20d · `Ω` 44h · `D` 11 · longest single run 4h · `ρ` 0.45 · m=1

| candidate | asks for | sitting | actually placed | short by | days used | longest consecutive streak | days eaten whole | % of open time | note |
|---|---|---|---|---|---|---|---|---|---|
| C1 cap+fill | 5 × 4h | 4h | 5 × = 20h | — | 5 | **5** | 5 | 45% |  |
| C2 intensity | 9 × 2h24 | 2h24 | 9 × = 21h36 | — | 9 | **9** | 0 | 49% |  |
| C3 fatigue | 9 × 2h30 | 2h30 | 9 × = 22h30 | — | 9 | **9** | 0 | 51% | waste 2h30 (13%) |
| C4 pressure | 9 × 2h24 | 2h24 | 9 × = 21h36 | — | 9 | **9** | 0 | 49% | ρ=0.45 steady |
| C5 greedy gaps | 5 × (gaps) | 4h | 5 × = 20h | — | 5 | **5** | 5 | 45% |  |
| Hybrid 5+cap | 9 × (gaps) | 2h24/48m | 9 × = 20h | — | 9 | **9** | 0 | 45% | ρ=0.45 steady, cap 60%·day |
| C6 learned — cold | 5 × 4h | 4h | 5 × = 20h | — | 5 | 5 | 5 | 45% | cold → s_max |
| C6 learned — 10 ratings | 10 × 2h | 2h | 10 × = 20h | — | 10 | **10** | 0 | 45% | learned dur:90-150 → 2h |
| C6 learned — 60 ratings | 7 × 3h15 | 3h15 | 7 × = 22h45 | — | 7 | 7 | 0 | 52% | learned dur:150-240 → 3h15 |
| C7 learned κ — cold | 9 × 2h24 | 2h24 | 9 × = 21h36 | — | 9 | 9 | 0 | 49% | κ PRIOR 0.60 |
| C7 learned κ — 10 | 9 × 2h24 | 2h24 | 9 × = 21h36 | — | 9 | 9 | 0 | 49% | κ PRIOR 0.60 |
| C7 learned κ — 60 | 7 × 3h12 | 3h12 | 7 × = 22h24 | — | 7 | 7 | 0 | 51% | κ 0.80 |
| **H+ spaced, continuous κ(ρ)** | 7 × (gaps) | 3h07/1h21 | 7 × = 20h | — | 7 | 3 | 0 | 45% | ρ=0.45, κ(ρ)=0.78, spaced |
| **H\* spread-only** | 5 × (gaps) | 4h | 5 × = 20h | — | 5 | **1** | 5 | 45% | aimed ~1 sitting / 2d |

**This is the decisive table.** Nine of the fourteen rows put the person on
consecutive evenings for five to ten days running. Making the sittings shorter
makes the streak *longer*. Only the spaced rows break it, and H\* breaks it
while keeping the four-hour runs.

### 20h / 14d — one 8h Saturday per week, nothing else

`A` 20h · `R` 14.00d → `R*` 11.20d · `Ω` 8h · `D` 1 · longest single run 8h · `ρ` 2.50 · m=1

| candidate | asks for | actually placed | short by | note |
|---|---|---|---|---|
| C1 cap+fill | 5 × 4h | 1 × = 4h | **16h** | |
| C2 intensity | 5 × 4h | 1 × = 4h | **16h** | declares INFEASIBLE |
| C3 fatigue | 9 × 2h30 | 1 × = 2h30 | **17h30** | takes *less* of the one day it has |
| C4 pressure | 5 × 4h | 1 × = 4h | **16h** | ρ=2.50 tight |
| C5 / Hybrid / H+ / H\* | 1 × 4h | 1 × = 4h | **16h** | |
| C6 — 10 ratings | 10 × 2h | 1 × = 2h | **18h** | learned 2h caps the one big day |
| C7 — 60 | 5 × 4h | 1 × = 4h | **16h** | κ 0.80 · INFEASIBLE |

Everyone is 16h short — correctly, the fortnight has 8 open hours and `s_max` is
4h. Note C3 and C6@10 do **worse** than everyone else: their sitting cap throws
away time on the one day the person actually had.

### 20h / 14d — fragmented: six 45m gaps a day, `maxPerDay = 1`

`A` 20h · `Ω` 50h15 · `D` 12 · **longest single run 45m** · `ρ` 0.40

| candidate | asks for | actually placed | short by |
|---|---|---|---|
| C1 cap+fill | 5 × 4h | **0 × = 0m** | **20h** |
| C2 intensity | 8 × 2h31 | **0 × = 0m** | **20h** |
| C3 fatigue | 9 × 2h30 | **0 × = 0m** | **20h** |
| C4 pressure | 8 × 2h31 | **0 × = 0m** | **20h** |
| C7 learned κ (cold/10/60) | 8 × 2h31 … 6 × 3h21 | **0 × = 0m** | **20h** |
| C5 / Hybrid / H+ / H\* / C6 | 12 × 45m | 12 × = 9h | 11h |
| — same week, `maxPerDay = 6` | | | |
| C1 cap+fill | 5 × 4h | **0 × = 0m** | **20h** |
| C3 fatigue | 9 × 2h30 | **0 × = 0m** | **20h** |
| C2 / C4 / C7 | 40 × 30m | 40 × = 20h | — |
| C5 | 27 × 45m/30m | 27 × = 20h (5 days, **4 eaten whole**) | — |
| **H+ spaced** | 27 × | 27 × = 20h (7 days, streak 3, **0 eaten**) | — |
| **H\* spread-only** | 27 × | 27 × = 20h (12 days, streak 12) | — |

**Five of the seven candidates plan a fortnight of work and place none of it.**
This is the strongest single argument in the document, and it is candidate 5's:
an equation that computes `s` without looking at the gaps produces a number the
week cannot honour. Note also that `maxPerDay = 1` — a control the spec
recommends by default — costs this person **11 of their 20 hours**. The Cabana
control needs to say so.

### 20h / 3 days · 20h / 180 days · 20h with only 6h open

| scenario | C1 | C3 | C4 | C5 | H+ | H\* |
|---|---|---|---|---|---|---|
| **20h / 3d** (Ω 8h) | 2 × 4h = 8h, **100% of open time**, 12h short | 2 × 2h30 = 5h, 15h short | 2 × 4h = 8h, 12h short | 2 × 4h = 8h, 12h short | 2 × 3h24 = 6h48, 13h12 short | 2 × 4h = 8h, 12h short |
| **20h / 180d** (Ω 576h) | 5 × 4h, **streak 5** | 9 × 2h30, streak 9 | 5 × 4h, streak 5 | 5 × 4h, streak 5 | 9 × 2h, streak 1 | **5 × 4h, streak 1, ~1 sitting / 28 days** |
| **20h / 6h open** (Ω 6h, longest gap 2h) | **0 placed**, 20h short | **0 placed** | **0 placed** | 3 × 2h = 6h, 14h short | 3 × 1h42 = 5h06, 14h54 short | 3 × 2h = 6h, 14h short |

The 6-month row is where the day cap fails on its own terms: with 144 usable
days and a pressure of 0.03, H+ still refuses a four-hour evening and hands back
nine two-hour ones. Nothing in the person's life justifies that. H\* gives them
five four-hour sittings, one roughly every four weeks.

The 6h-fortnight row is where the *un*-capped candidates fail: C1, C3 and C4
place **nothing** when there was 6 hours of room, and would have to word a "no
room at all" that is false.

### The standing commitment — 2h/week

| candidate | roomy week (4h evenings) | busy week (1h evenings) |
|---|---|---|
| C1 cap+fill | 1 × 2h | **0 placed, 2h short** |
| C2 intensity | 1 × 2h20 *(20 min of nothing)* | 4 × 36m |
| C3 fatigue | 1 × 2h15 *(15 min of nothing)* | **0 placed, 2h short** |
| C4 pressure | **1 × 4h** *(a 4-hour block for 2 hours of maths)* | 4 × 36m |
| C5 / Hybrid | 1 × 2h | 2 × 1h |
| C6 — cold | **1 × 4h** | 2 × 1h |
| C6 — 60 | **1 × 3h15** | 2 × 1h |
| C7 — 60 | **1 × 3h07** | 3 × 48m |
| **H+ / H\*** | 1 × 2h | 2 × 1h |

### The 45-minute task, deadline Friday

| candidate | what lands on Friday's calendar |
|---|---|
| C1, C3, C5, Hybrid, H+, H\* | **1 × 45m** ✓ |
| C2 intensity | 1 × **1h57** |
| C4 pressure | 1 × **4h** |
| C6 — cold | 1 × **4h** |
| C6 — 60 ratings | 1 × **3h15** |
| C7 — 60 | 1 × **2h36** |

**This is a disqualifier as the equations are written.** Candidates 2, 4, 6 and
7 fix `s` first and derive `n = ceil(A/s)`; nothing then shrinks the sitting back
to the work that exists. A 45-minute errand books a four-hour block. The repair
is one line — the line candidate 1 already has:

| scenario | candidate | as written | with `s ← A/n` |
|---|---|---|---|
| 45m task | C2 intensity | 1 × 1h57 | 1 × 45m |
| 45m task | C4 pressure | 1 × 4h | 1 × 45m |
| 45m task | C6 — cold | 1 × 4h | 1 × 45m |
| 45m task | C6 — 60 | 1 × 3h15 | 1 × 45m |
| 45m task | C7 — 60 | 1 × 2h36 | 1 × 45m |
| 2h commitment | C2 intensity | 1 × 2h20 | 1 × 2h |
| 2h commitment | C4 pressure | 1 × 4h | 1 × 2h |
| 2h commitment | C6 — cold | 1 × 4h | 1 × 2h |
| 2h commitment | C6 — 60 | 1 × 3h15 | 1 × 2h |
| 2h commitment | C7 — 60 | 1 × 3h07 | 1 × 2h |

It is not cosmetic and it is not obvious from the pseudocode: **`n` and `s` must
be solved as a pair, and `s = A/n` must be the last line of every candidate.**
Candidate 5 and the hybrids are immune because they never compute `s` at all.

### 5h essay due 09:00 tomorrow, planned 18:00 tonight

`R*` = 12h, `Ω` = 5h (19:00–24:00), `ρ` = 1.00.

| candidate | plan | short |
|---|---|---|
| C1 | 1 × 2h30 | 2h30 |
| C2 | 1 × 3h (declares infeasible) | 2h |
| C3 | 1 × 1h45 | 3h15 |
| C4 / C5 / H+ / H\* / C6-cold | 1 × 4h | 1h |
| C6 — 10 ratings | 1 × 2h | 3h |

A person with an essay due at 09:00 does not want to be told "2 hours tonight,
you're 3 hours short". C3's and C6@10's fatigue caps are exactly wrong here, and
C1's `A/n` split hands back 2h30 for no reason at all.

### 40h thesis chapter / 6 weeks

`Ω` 140h, `D` 30, `ρ` 0.29.

| candidate | plan | streak | days eaten whole |
|---|---|---|---|
| C1 / C4 / C5 / Hybrid | 10 × 4h | **6** | 9 |
| C2 | 15 × 2h48 | **6** | 0 |
| C3 | 18 × 2h30 (45h of clock for 40h of work) | **6** | 0 |
| C6 — 10 | 20 × 2h | 6 | 0 |
| C6 — 60 | 13 × 3h15 | 6 | 0 |
| **H+** | 13 × (4h…36m) | **1** | 0 |
| **H\*** | 10 × 4h | **1** | 7 |

Six consecutive days on a thesis chapter, twice, is the plan a person overrides
on sight. Both spaced variants fix it; H\* fixes it without changing a single
sitting length.

### Three commitments in one week: 2h maths + 3h reading + 3h gym vs 20h open

Run sequentially against one shared week, as they would be.

| candidate | maths 2h | reading 3h | gym 3h | total | days | streak | days eaten |
|---|---|---|---|---|---|---|---|
| C1 | 1 × 2h | 1 × 3h | 1 × 3h | 8h | 3 | 3 | 0 |
| C2 | 1 × 2h24 | 2 × 2h24 | 2 × 2h24 | **12h booked for 8h owed** | 5 | 5 | 0 |
| C3 | 1 × 2h15 | 2 × 1h30 | 2 × 1h30 | 8h15 | 3 | 3 | 1 |
| C4 | 1 × 4h | 1 × 4h | 1 × 4h | **12h booked for 8h owed** | 3 | 3 | **3** |
| C5 / Hybrid / H\* | 1 × 2h | 1 × 3h | 1 × 3h | 8h | 3 | 3 | 0 |
| C6 — cold | 1 × 4h | 1 × 4h | 1 × 4h | **12h** | 3 | 3 | 3 |
| C6 — 60 | 1 × 3h15 | 1 × 3h15 | 1 × 3h15 | 9h45 | 3 | 3 | 0 |
| **H+** | 1 × 2h | 2 × 2h30/30m | 2 × 2h30/30m | 8h | 4 | 4 | 0 |

The `s ← A/n` bug compounds here: C4 and C6-cold book **twelve hours of a
person's week for eight hours of commitments**, and three of their five evenings
are gone entirely. That is a plan you delete, not a plan you follow.

### Exam week — 3 open hours all week, 8h of work owed

| candidate | places | short |
|---|---|---|
| C1 / C3 / C4 | **0m** | **8h** |
| C2 / C7 cold | 1h48 | 6h12 |
| C7 — 60 | 2h24 | 5h36 |
| **C5 / H+ / H\* / C6** | **3h** (everything there was) | 5h |

---

## 5. Stability — replanning the same project each day

The document's question 3. Cells read `asked → placed`; nothing has been done
yet, so any change is the app reshuffling a plan the person has already seen.

| replanned on day | C1 | C2 | C3 | C4 | C5 | Hybrid | C6 @10 | C6 @60 | H+ | **H\*** |
|---|---|---|---|---|---|---|---|---|---|---|
| day 0 | 5×4h | 9×2h24 → short 48m | 9×2h30 → 8 | 8×2h30 | 5×4h | 7×3h12 | 10×2h → short 4h | 7×3h15 | 6×3h24 | **5×4h** |
| day 1 | 5×4h | 9×2h24 → short 3h12 | 9×2h30 → short 2h30 | **8×2h51** | 5×4h | 7×3h12 | 10×2h → short 6h | 7×3h15 | 6×3h24 | **5×4h** |
| day 2 | 5×4h | **9×2h21** → short 3h34 | 9×2h30 → short 2h30 | 8×2h51 | 5×4h | 7×3h12 | 10×2h → short 6h | 7×3h15 | **7×3h24** | **5×4h** |
| day 3 | 5×4h | 9×2h24 → short 3h12 | 9×2h30 → short 2h30 | 8×2h51 | 5×4h | 7×3h12 | 10×2h → short 6h | 7×3h15 | 6×3h24 | **5×4h** |
| day 4 | 5×4h | 9×2h24 → short 5h36 | 9×2h30 → short 5h | **6×3h20** | 5×4h | 6×3h12 | 10×2h → short 8h | 6×3h15 | 6×3h24 | **5×4h** |
| day 5 | 5×4h | 9×2h24 → short 8h | 9×2h30 → short 7h30 | **5×4h** | 5×4h | 5×3h12 | 10×2h → short 10h | 5×3h15 | 5×3h24 | **5×4h** |
| day 6 | 5×4h | 9×2h24 → short 8h | 9×2h30 → short 7h30 | 5×4h | 5×4h | 5×3h12 | 10×2h → short 10h | 5×3h15 | 5×3h24 | **5×4h** |

C1, C5 and H\* never move. C4 walks 2h30 → 2h51 → 3h20 → 4h with nothing in the
person's life having changed — the runway shrank, `r = A/D` grew, the band
flipped. C2, C3 and C6@10 keep asking for a fixed number of sittings while the
week loses days, so the *shortfall* they report grows every day even though
nothing was missed. **A shortfall message that appears because you looked again
is a P-1 problem, not just a stability one.**

### Band edges — walking `A` across ρ = 0.3 and ρ = 0.6 (even fortnight, Ω 44h)

| A | ρ | C4 band | C4 asks | Hybrid | C1 | C3 |
|---|---|---|---|---|---|---|
| 12h30 | 0.284 | room | **4 × 4h** | 4 × 4h | 4 × 3h08 | 7 × 2h |
| 13h18 | 0.302 | steady | **6 × 2h24** | 6 × 2h24 | 4 × 3h20 | 6 × 2h30 |
| 14h | 0.318 | steady | 6 × 2h24 | 6 × 2h24 | 4 × 3h30 | 7 × 2h15 |
| 26h12 | 0.595 | steady | **11 × 2h24** | 11 × 2h24 | 7 × 3h45 | 10 × 3h |
| 26h24 | 0.600 | tight | 11 × 2h24 | **9 × 3h12** | 7 × 3h46 | 11 × 2h45 |

**Adding 48 minutes of work to a 12½-hour project changes the plan from four
four-hour sittings to six two-and-a-half-hour ones.** That is not a plan a
person can predict, and it is not a difference they can feel a reason for. The
band structure has to go, or become continuous, in any candidate that uses it —
mine included, which is why H+ uses a continuous `κ(ρ)`.

---

## 6. Where the intensity cap actively hurts

Quantifying the document's own worry about κ, on the named case:

| κ | C2/C7 sitting | n asked | placed on the doc-baseline week | shortfall |
|---|---|---|---|---|
| 0.4 | 1h36 | 13 | 8 × = 12h48 | **7h12** |
| 0.5 | 2h | 10 | 8 × = 16h | **4h** |
| **0.6 (the spec's prior)** | 2h24 | 9 | 8 × = 19h12 | **48m** |
| 0.7 | 2h48 | 8 | 8 × = 22h24 | — |
| 0.75 | 3h | 7 | 7 × = 21h | — |
| 0.8 | 3h12 | 7 | 7 × = 22h24 | — |
| 1.0 (no cap) | 4h | 5 | 5 × = 20h | — |

A κ that is wrong by 0.2 manufactures a **four-hour shortfall out of nothing**.
The person is told their fortnight cannot hold a project that fits in it with
room to spare. There is no visible reason, no way to argue, and — because the
number is invented — no evidence behind it. That is the P-2 violation in its
most concrete form: the app stating a limit about this person that it has not
learned, and *acting* on it.

---

## 7. Candidate 3's worked example is wrong

The document samples four values of `s`. On the 15-minute grid the app actually
uses:

| s | E(s) | n | clock | waste | within τ=15%? | within τ=20%? |
|---|---|---|---|---|---|---|
| 1h | 60.0 | 20 | 20h | 0m (0%) | ✓ | ✓ |
| 1h30 | 90.0 | 14 | 21h | 1h (5%) | ✓ | ✓ |
| 2h | 112.5 | 11 | 22h | 2h (10%) | ✓ | ✓ |
| 2h15 | 123.8 | 10 | 22h30 | 2h30 (13%) | ✓ | ✓ |
| **2h30** | 135.0 | **9** | 22h30 | 2h30 (13%) | **✓** | ✓ |
| 2h45 | 146.3 | 9 | 24h45 | 4h45 (24%) | · | · |
| 3h | 157.5 | 8 | 24h | 4h (20%) | · | ✓ |
| 3h15 | 168.8 | 8 | 26h | 6h (30%) | · | · |
| 3h30 | 180.0 | 7 | 24h30 | 4h30 (23%) | · | · |
| 4h | 202.5 | 6 | 24h | 4h (20%) | · | ✓ |

At τ = 15% the answer is **9 × 2h30**, not the "~11 × 2h" the document states.
Worse, `waste(s)` is **not monotonic** — 3h is admissible at τ = 20% but 3h15
and 3h30 and 3h45 are not, and 4h is again. So "the smallest `n` whose waste
stays inside τ" is a search over a jagged function, and moving `s_max` from 3h45
to 4h changes the plan from 12 sittings to 6. Nobody can predict that, and the
jaggedness is an artefact of `ceil`, not of fatigue.

---

## 8. P-1 — the actual wording each candidate would produce when it does not fit

Real numbers from the exam-week scenario (**3 open hours all week, 8h owed**).
✅ = states a fact. ⚠️ = states a fact *the app has not learned*. ❌ = verdict.

| candidate | the wording it forces | |
|---|---|---|
| **C1** | *"Nothing fits. Your week has no run long enough for a sitting."* | ❌ **False**, and it reads as a verdict on the week. There were three hours. C1 has nothing to say about them because it never looked. |
| **C3** | *"Nothing fits."* — same, plus the app privately decided the 1-hour gaps weren't worth using | ❌ Same falsehood, from a fatigue curve nobody measured. |
| **C4** | *"This wants 267% of your open time. Nothing fits."* | ⚠️ The percentage is a genuine fact and a good one. "Nothing fits" is still false. |
| **C2 / C7** | *"1h 48m of 8h placed. The rest would take more of each day than is sustainable."* | ⚠️ **"than is sustainable" is the P-2 breach** — κ is invented, and this sentence reports it as a finding about the person. Also leaves 1h12 of real open time unused while saying there is no room. |
| **C5 / H+ / H\*** | *"3 hours of the 8 have a place this week. Your week has 3 open hours between now and Friday; the other 5 hours have nowhere to go."* | ✅ A fact, twice. No debt, no red, no verdict — exactly §4.3. |
| **C6 (any maturity)** | same as C5, plus whatever the learned line says | ✅ if the learned line is separate (see §11) |

Three drafts I would **reject** whichever candidate wins:

- ❌ *"You're overcommitted this week."* — a verdict about the person.
- ❌ *"This will burn you out."* — asserts a state the app cannot observe.
- ❌ *"You can't do 20 hours in three days."* — a verdict. The fact version is
  *"Between now and Thursday you have 8 open hours."*

And two that are fine:

- ✅ *"This wants 62% of your open time for the next two weeks."* (C4's own line —
  the single best sentence in the document, and it is available to **every**
  candidate because `ρ` is just arithmetic. Keep it regardless of which equation
  wins.)
- ✅ *"5 sittings of 4 hours, about one every four weeks."* (H\* on the 6-month
  case — the plan explains itself.)

One more P-1 finding, from §5: **C2, C3 and C6 grow their reported shortfall
every day you look at the week without doing anything.** Day 1: "3h12 short."
Day 4: "5h36 short." Day 5: "8h short." Nothing was missed; the runway shrank
and the fixed `n` no longer fits. A number that gets worse because you *looked*
is the shape of a nag, and the same instinct that killed the re-raising detector
card should kill this.

---

## 9. Legibility — one sentence each

Ranked most predictable to least. "Could you guess what the app will do before
it does it?"

1. **H\*** — *"It takes the longest runs your week actually has, up to your
   maximum, and spreads them out."* You can point at your own calendar and count.
2. **C5** — *"It takes the longest runs your week actually has, up to your
   maximum."* Identical, minus the spreading, and equally checkable.
3. **C1** — *"It divides the work by your maximum sitting and rounds up."*
   Perfectly predictable — and predictably wrong when the week has no four-hour
   run.
4. **H+ / Hybrid** — *"Like the above, but it won't give one thing more than
   about four fifths of a free evening."* One extra clause, still checkable, but
   you now have to know `κ` and how full your evening was.
5. **C4** — *"It has three modes, and which one you get depends on a ratio you
   can't see crossing a threshold you weren't told."* Two projects 48 minutes
   apart get visibly different plans.
6. **C6** — *"It uses the sitting length your ratings liked best."* Sounds the
   most legible of all and is the least: you cannot predict an argmax over seven
   noisy weights, and it changes when you rate an unrelated task (§10).
7. **C2 / C7** — *"It caps each day at 60% of your free time"* is explainable;
   what is not explainable is why the app says a fortnight with 32 open hours
   cannot hold 20 hours of work.
8. **C3** — *"It picks the fewest sittings whose wasted clock time stays under
   15%."* Two sentences of theory before you get to a number, and the number
   moves non-monotonically with the slider you *can* see (§7).

---

## 10. The tuning constants — which are settable, which are opaque

| constant | what it is | expose in the Cabana? |
|---|---|---|
| `s_min`, `s_max` | *"never bother me for less than 30 minutes; I'll do 4 hours straight."* | **Already exposed** (`.rangefield`), and correctly. This is the only burnout knob a person can actually reason about. Keep it as the primary one. |
| `maxPerDay` | *"don't stack two maths sessions on one evening."* | **Already exposed. Keep — but say what it costs.** The fragmented week shows `maxPerDay = 1` losing 11 of 20 hours. The help line should read *"On a week made of short gaps, this is what stops the work fitting."* |
| **spacing** (my addition) | *"leave a clear day between sittings when the runway allows."* | **Yes — add it, as a checkbox, on by default.** It is the one new control I would introduce, it is the only one that addresses the actual burnout mechanism, and it is a sentence a person can hold in their head. Off = candidate 5. |
| `κ` | *"the sustainable share of a day"* | **No.** Not as a number — 0.6 vs 0.75 is meaningless to set and costs 4 hours of placement when wrong (§6). If the day cap survives at all, it should be worded, not numbered: *"How much of a free evening may one thing take?"* → `some / most / all of it`. Default `all of it`, because that is what the user said. |
| `δ`, `s_free` | the fatigue curve | **Never.** Nobody can set an exchange rate for the back half of their own concentration, and the app has not measured it. |
| `τ` | the waste tolerance | **Never**, and it should not exist: §7 shows it is a slider whose effect is non-monotonic. |
| band edges 0.3 / 0.6 | posture thresholds | **Never** — and they should not exist at all; make `ρ` continuous or drop it from the mechanism and keep it only in the sentence. |

The general rule this evaluation suggests: **a constant a person cannot set is a
constant the app should not act on.** `s_min`, `s_max` and `maxPerDay` pass.
`κ`, `δ`, `s_free` and `τ` do not — and `ρ` earns its keep as *narration*, not
as a lever.

---

## 11. The learned candidates — cold start, drift, and the confound

All of the following trained the real `src/core/learning.js` on synthetic rated
tasks. The simulated person — a fact the app is never told — has satisfaction
peaking around 3½-hour sittings and still good at 4h, and a day that is
sustainable up to **75% full**, so the spec's prior `κ = 0.6` is wrong in exactly
the direction the document fears. Ratings are integers 1–5 with realistic noise.

### 11.1 What the learned duration curve actually looks like

| ratings | trained? | dur:<15 | dur:15-30 | dur:30-45 | dur:45-90 | dur:90-150 | dur:150-240 | dur:>240 | argmax → sitting |
|---|---|---|---|---|---|---|---|---|---|
| 0 | **no — cold start** | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | 0.000 | — |
| 5 | **no — cold start** | 0.000 | 0.000 | 0.000 | 0.017 | 0.109 | 0.014 | 0.000 | — |
| 10 | yes | 0.000 | 0.000 | 0.000 | -0.015 | **0.136** | 0.018 | 0.000 | dur:90-150 → 2h |
| 20 | yes | 0.000 | 0.000 | 0.019 | 0.008 | 0.060 | **0.089** | 0.010 | dur:150-240 → 3h15 |
| 40 | yes | 0.000 | 0.000 | -0.008 | 0.051 | 0.021 | **0.068** | 0.056 | dur:150-240 → 3h15 |
| 60 | yes | 0.000 | 0.000 | -0.005 | 0.048 | 0.047 | **0.071** | 0.027 | dur:150-240 → 3h15 |
| 120 | yes | 0.000 | 0.000 | 0.000 | 0.042 | 0.035 | **0.091** | 0.019 | dur:150-240 → 3h15 |

Two things to note before anything else. The curve is **jagged**, exactly as the
document warned: at 40 ratings `dur:45-90` (0.051) beats `dur:90-150` (0.021),
which is not a fatigue curve, it is noise. And `durationBucket` is a strict `<`,
so a sitting of **exactly 240 minutes falls in the bucket labelled `dur:>240`** —
the default `s_max` sits on the boundary, in a bucket whose name is a lie about
its contents. Any Cabana line built on these labels inherits that.

### 11.2 Cold start: the fallback *is* the product

At 0 ratings there is nothing, and `modelScore` returns 0 until
`sampleCount ≥ coldStartRatings` (10). In this project's terms that is a real
delay: chunked-project sittings are a fraction of what gets rated, so ten of
*them* is comfortably a month or two of use. During that month the app's entire
behaviour is the fallback.

In the scenario tables, **"C6 — cold" is a different product depending on the
fallback chosen.** With `s_max` as the stated default it books a 4-hour block for
a 45-minute task and 12 hours of a week for 8 hours of commitments. With
candidate 5 as the fallback it is correct everywhere. So:

> **The cold-start answer must be a complete, defensible design in its own right,
> because it is the only design most weeks will ever see.** Learning cannot be
> the mechanism; it can only be an adjustment to a mechanism that already works.

That alone rules candidate 6 out as *the* answer, and is the strongest argument
for a non-learned core with a learned advisory bolted beside it.

### 11.3 Does a changing answer read as intelligence or as instability?

**Instability. Measurably, and not marginally.** Same simulated person, same
ground truth, same policy — only *which* ratings differ:

| seed | argmax at 10 ratings | n for the 20h case | argmax at 60 ratings | n for the 20h case |
|---|---|---|---|---|
| 1 | dur:90-150 → 2h | 10 | dur:150-240 → 3h15 | 7 |
| 2 | dur:150-240 → 3h15 | 7 | dur:150-240 → 3h15 | 7 |
| 3 | dur:90-150 → 2h | 10 | **dur:>240 → 4h** | **5** |
| 4 | dur:90-150 → 2h | 10 | dur:150-240 → 3h15 | 7 |
| 5 | dur:90-150 → 2h | 10 | **dur:90-150 → 2h** | **10** |
| 6 | dur:150-240 → 3h15 | 7 | dur:150-240 → 3h15 | 7 |
| 7 | dur:90-150 → 2h | 10 | dur:150-240 → 3h15 | 7 |
| 8 | **dur:>240 → 4h** | **5** | **dur:90-150 → 2h** | **10** |

At ten ratings the same 20-hour project comes out as **5, 7 or 10 sittings**
depending on which ten evenings the person happened to rate. **At sixty ratings
it is still 5, 7 or 10.** It does not settle. And it is worse than that: the
argmax is over a *ridge-regularised linear model whose other columns are tags,
time of day and weekday*, so rating a Tuesday-morning gym session moves the
duration weights. The app would tell you 2h in March, 3h15 in May, and 2h again
in July, with nothing in your life having changed and no way for you to see why.

**My judgement, and it is the thing I feel most strongly in this report: a
learned number must not silently change the plan.** A plan that changes for
reasons the person cannot reconstruct is not a system that knows them, it is a
system they stop trusting — and this project has already decided that case once,
when it ruled that rollover offers rather than imposes. The learned duration
belongs in a **sentence**, and at most in a **one-time offer** to move `s_max` —
a control the person already owns, whose movement they can see and undo.

### 11.4 The confound, measured

Same ground truth in every row. Only the policy that *chose* the sittings differs.

| history generated by | 20 ratings | 60 | 150 | 400 |
|---|---|---|---|---|
| **short** — never offers >90m | dur:90-150 (2h) | dur:90-150 (2h) | dur:90-150 (2h) | **dur:90-150 (2h)** |
| mixed | dur:150-240 (3h15) | dur:150-240 (3h15) | dur:150-240 (3h15) | dur:150-240 (3h15) |
| long | dur:150-240 (3h15) | dur:150-240 (3h15) | dur:150-240 (3h15) | dur:150-240 (3h15) |
| **explore** — short, 1 in 7 long | dur:90-150 (2h) | dur:90-150 (2h) | dur:90-150 (2h) | dur:150-240 (3h15) |

**The trap is real and permanent.** A scheduler that never offers more than 90
minutes still reports "your best sittings are about two hours" after four
hundred ratings — and note the second-order dishonesty: the winning bucket's
representative length (120 min) is *longer than any sitting the person was ever
given* (90 min). The app would be reporting, as a finding about the person, a
number extrapolated from a bucket edge.

And ε-exploration does not rescue it cleanly:

| ratings (≈ weeks at 4/wk) | short-only policy | explore policy (1 in 7 long) |
|---|---|---|
| 12 (≈3w) | 1h07 | 2h |
| 20 (≈5w) | 2h | 2h |
| 40 (≈10w) | 2h | **3h15** |
| 60 (≈15w) | 2h | **2h** |
| 100 (≈25w) | 2h | 2h |
| 150 (≈38w) | 2h | 2h |
| 250 (≈63w) | 2h | **3h15** |
| 400 (≈100w) | 2h | 3h15 |

The explorer finds the right answer at ten weeks, **loses it again at fifteen**,
and does not hold it until it has more than a year of data. A person watching
that would experience the app changing its mind about them four times in two
years.

**Would a person tolerate the app occasionally trying a longer sitting?** Yes —
but only as a *question*, never as a surprise. A four-hour block appearing where
a ninety-minute one was expected is a plan they drag, and the drag is
`placedBy: 'user'`, which the stability weight then defends, which poisons the
very sample the exploration was for. Framed as an ask — *"you've never had a long
run at this; want to try three hours on Saturday?"*, once, ignorable — it costs
nothing and the answer is honest either way. That is the same offer-never-impose
shape the rest of this app already uses, and it is the only form of exploration
I would ship.

### 11.5 Candidate 7 cannot produce κ from the feature it names

`dayFill` (`learning.js:71`) enters the vector as a **single linear scalar**. A
linear term has no interior maximum: its weight tells you which direction is
better, never *where the good level is*. Trained on a person whose true κ is
0.75:

| ratings | learned linear `dayFill` weight | κ̂ from banded means | true κ |
|---|---|---|---|
| 10 | +0.0747 | **not enough evidence** | 0.75 |
| 20 | −0.0423 | 0.60 | 0.75 |
| 60 | +0.0155 | 0.80 | 0.75 |
| 150 | +0.0029 | 0.80 | 0.75 |
| 400 | −0.0203 | 0.80 | 0.75 |

The weight **flips sign four times** and never approaches a level. What does
work is banding the evidence directly — and this is the table a person could
actually be shown:

| day was this full | ratings | mean satisfaction |
|---|---|---|
| 0–20% | 82 | 3.04 |
| 20–40% | 107 | 3.30 |
| 40–60% | 59 | 3.58 |
| 60–80% | 53 | 3.53 |
| 80–100% | 99 | 3.17 |

So: **candidate 7 as written does not work, and the fix is not a fix to
candidate 7 — it is a change to the feature vector** (one-hot `dayFill` like
`duration`), which means `MODEL_LAYOUT_VERSION` 4 and the retrain-on-load path
`fromJSON` already implements. Worth doing eventually. Not worth doing *for a
sitting cap I am recommending against*.

**But wire `dayFill` now anyway.** The document's deadline argument is correct
and independent of everything above: every week used without it is training data
that cannot be reconstructed, exactly as with `energyAt`. Record it; decide later
what it answers.

### 11.6 What it says out loud — drafts, and where they cross the line

**Cold start.**

- ✅ *"I don't have enough ratings yet to say anything about your sittings. For
  now this uses your own limits: 30 minutes to 4 hours."*
  States what it lacks, names the rule actually in force, promises nothing.
- ⚠️ *"Still learning your best sitting length."* Softer, but it implies the app
  will eventually assert one — and §11.3 says it should not.
- ❌ *"Starting with 2-hour sittings until I learn what suits you."* Presents an
  invented default as a provisional finding about the person. This is the
  fabricated-capacity-ceiling shape that `learnedCapacity()` returning `null`
  was written to avoid.

**Learned state.**

- ✅ *"Of the sittings you've rated (30 min to 4 h, 62 of them), the 2½–4 hour
  ones scored highest."* States the finding, its sample size, **and the range it
  was drawn from** — which is the only defence against the confound of §11.4.
- ⚠️ *"Your best sittings have been about 3 hours."* This is the coordinator's
  suggested phrasing and it is *nearly* fine — it says "have been", which is
  past tense and evidential. It crosses only when the app has never offered
  anything longer, at which point it is a fact about the scheduler wearing a
  fact about the person. The range clause fixes it; without the range clause I
  would not ship it.
- ❌ *"You work best in 3-hour blocks."* Present tense, no sample, no range — an
  assertion about the person from a jagged argmax over 60 noisy points. P-2.
- ❌ *"You should work in 3-hour sittings."* Instruction. **P-1**, and the
  clearest possible case of it: the app has moved from observing to telling
  someone how to work. The distinction the coordinator drew is exactly right and
  worth writing into the spec as a rule: *findings use the past tense and name
  their sample; the app never uses "should".*
- ❌ *"You rated short sittings poorly."* True, possibly, and still a verdict —
  it reads as the app keeping score of the person's performance rather than of
  its own guesses.

**One more that matters:** whatever the learned line says, it must live in the
**Cabana or the wrap report**, never on the grid. That is already locked
("Insights live in the report/Cabana; the grid stays quiet"), and a learned
sitting length is an insight.

### 11.7 Would I expose it, and what would the control say?

**Show it. Do not let them set it.** Two controls where one will do is how the
role enum happened.

```
YOUR SITTINGS

  Of the 62 sittings you've rated, between 30 min and 4 h,
  the longest ones scored highest.

  ▁▂▃▅▆▇▇        under 45m   45m–1½h   1½–2½h   2½–4h
                                                  ↑ best

  Your limit is 4 h.                        [ change ]

  ⓘ  This is a record of what you rated, not advice.
     Sitting length comes from the runs your week has room for.
```

`[ change ]` opens the `.rangefield` that already exists — the learned line is
**evidence for a control the person already owns**, not a second control beside
it. And when the evidence disagrees with their setting, the app may offer, once:

> *"The longest sittings you've rated — 2½ to 4 hours — scored highest, and your
> limit is set to 2 hours. Raise it?"*  **[ Raise to 4 h ]  [ Leave it ]**

That is an observation and an offer, in the shape this app has already settled
on twice (rollover, carry-forward). It never changes a plan by itself, so §11.3's
instability cannot reach the calendar: the worst a wobbling argmax can do is
offer once and be declined.

---

## 12. Question 7 — how the ML actually gets incorporated into the recommendation

For **H\***, concretely:

1. **Which constants become priors the model overrides: none, because there are
   none.** H\* invents nothing. `s_min`, `s_max` and `maxPerDay` are the user's
   own settings and the spacing rule is arithmetic on the runway. This is the
   quiet strength of the recommendation — there is no fabricated number for P-2
   to object to, and therefore nothing that *needs* learning to become honest.
2. **Which quantity is read from `inspect()`:** the seven `dur:*` weights, and
   nothing else. They render the Cabana card in §11.7 and generate the one-time
   `s_max` offer. **No new feature, no `MODEL_LAYOUT_VERSION` bump, no migration**
   — `inspect()` already returns exactly these labels, and this was the reason it
   was built.
3. **Cold-start behaviour:** identical to the mature behaviour. H\* at 0 ratings
   and H\* at 600 ratings produce the same plan for the same week. The only thing
   that changes is whether the Cabana card has anything in it, and whether the
   `s_max` offer has ever appeared. **The app never surprises the person with a
   different plan for the same inputs**, which is the property §11.3 says is
   worth more than optimality.
4. **How the confound is handled:** by refusing to be confounded. Because the
   learned value never drives placement, the feedback loop is broken at the
   source — the scheduler's sitting lengths come from the week's gaps, which are
   set by the person's real calendar, not by the model's own previous opinion.
   Exploration then costs nothing and can be *asked for* rather than smuggled in
   (§11.4). If the person accepts a longer `s_max`, the longer sittings appear,
   get rated, and the evidence improves — driven by a decision they made and can
   reverse.
5. **`dayFill`:** wire it now, in `Schedule#_snapshotEnergy`, for the
   unrecoverable-data reason. Do **not** use it for κ (§11.5). When there is a
   year of it, band it (`MODEL_LAYOUT_VERSION` 4 + the existing retrain-on-load)
   and use it to answer the question this evaluation actually raised and could
   not settle: **is a whole evening spent on one thing worse than half an
   evening, once there is a clear day either side?** That is the empirical
   question behind my strongest objection to my own recommendation (§1), and
   `dayFill` × the spacing rule is precisely the data that would settle it.
6. **What learning would look like if it *did* drive the plan** — for the record,
   since candidate 6 may still be argued for: it would need the argmax replaced
   by something that cannot flip on noise (a monotone fit across ordered buckets,
   or a confidence interval with a "no opinion" state like `learnedCapacity()`),
   a hysteresis rule so the plan cannot change more than once a term, and the
   `dur:>240` bucket boundary fixed so `s_max = 4h` is not filed under ">240".
   That is a lot of machinery to buy an answer the week's own gaps give for free.

---

## 13. What would change my mind

- **The user says a whole evening gone is fine, five nights running.** Then the
  clustering finding is not a finding, spacing is unnecessary, and candidate 1
  wins on cost — it is three lines and it never moves. I would switch
  immediately. This is one question and it should be asked before anything is
  built: *"Twenty hours over a fortnight. Would you rather have five four-hour
  evenings in a row, or five four-hour evenings spread a couple of days apart?"*
- **The `balance` weight already spaces sittings on their real calendar.** I
  modelled identical open days, where `1 − dayFillAfter` cannot discriminate and
  `proximity` decides — that is faithful, but a real week is not identical days.
  A probe placing five chunks into their actual August calendar would settle
  whether the spacing rule is a new feature or a duplicate of one that already
  works. **If it is a duplicate, my recommendation collapses into plain
  candidate 5**, which is the outcome I would be happiest with.
- **Ratings arrive showing long sittings score badly for this person.** Then κ
  stops being invented, candidate 7's programme becomes worth its
  `MODEL_LAYOUT_VERSION` bump, and the hybrid overtakes H\*. Note this is
  precisely what §11.7's card is for: it is the instrument that would tell us.
- **`maxPerDay > 1` turns out to be normal for them.** The fragmented-week
  collapse changes character entirely — with `m = 6` the intensity-capped
  candidates suddenly place everything, and the gap between the families
  narrows. My tables assume the spec's own `m = 1` default.
- **Someone shows me a real week where H\*'s spacing pushes work past a deadline
  it would otherwise have made.** My relaxation loop is meant to prevent that
  (it drops the spacing requirement a day at a time until the amount fits, and
  no scenario here lost a minute to it), but it is greedy, and a counterexample
  would mean the spacing has to be a *scoring preference* rather than a
  placement constraint — which is, notably, exactly how the `buffer` weight was
  eventually got right.

---

**One last thing, said plainly.** The user's stated preference — *finish in as
few sessions as possible without burning out* — is not the risk this document
treats it as. Five of the seven candidates exist to talk them out of four-hour
sittings, and every one of them pays for it: in work that never gets placed, in
constants nobody can justify, in plans that change overnight, and in four-hour
blocks booked for forty-five-minute errands. The person asked for long sittings
and said why. The scenarios say they can have them. What they should not have is
five of them in a row — and that is a different sentence in the spec, not a
different equation.
