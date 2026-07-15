# Sandy Cay — Blind Use Cases (B1–B40)

**Author:** independent QA pass. Written from `SPEC.md` + `FRONTEND-SPEC.md` only, with no sight of `USE-CASE-ANALYSIS.md`, the control map, the mockups, or `src/`. Deliberately disjoint from the seven situations already analysed (rescheduling a lunch, busy class schedule, disrupted week, recurrence vs real life, planning ahead, reviewing, quick capture).

**Reference week throughout:** Mon 2026-07-13 → Sun 2026-07-19 (the week the spec's own header mock displays). "Today" is Wed 2026-07-15.

**Citation key:** `§n` = SPEC.md section · `F§n` = FRONTEND-SPEC.md section · `P-1` = "the app never guilts" · `R-1` = "manual always wins" · `7B` = the semantics table in §1.1 · `OD-n` / `R-n` = open decisions and rulings referenced by the spec.

`UNSPECIFIED` in **Expected** means the two specs genuinely do not decide the case. Those are flagged deliberately — they are the highest-value rows here.

---

## A. Time boundaries & the 24-hour grid

### B1 — Resize a task across midnight
| | |
|---|---|
| **Setup** | "Standup" flexible, Sun 2026-07-19, 23:00–23:30. Grid is 24h × 7 columns (F§5). |
| **User action** | Grab the sand strip (bottom border, §10 / F§6) and drag down past the 24:00 line, aiming for 00:45 Monday. |
| **Expected** | `UNSPECIFIED`. §1.1's only guard is `end<=start → swap; equal → +defaultDuration`, which assumes `startTime`/`endTime` are full `Date`s that *can* differ in day. But §1.1 also encodes the day into `startTime`, `getDayIndex(weekStart)` returns a single index, and F§5 renders 7 discrete columns — so a 23:00→00:45 task has one start day and one end day and no column to live in. The spec never says whether midnight-spanning tasks are legal, clamped at 23:59, or split. **Ambiguity to resolve:** does `getDuration()` on a midnight-crossing task return 105, or a negative/1395-minute value after the swap guard fires? |
| **Why it's risky** | Two plausible bad outcomes: (a) the swap guard reads `end < start` in *time-of-day* terms, silently swaps, and produces a 23-hour task; (b) the resize is clamped to 23:59 with no feedback, so the user's drag just stops and looks broken. Neither is stated, so both will ship somewhere. |

### B2 — Recurring occurrence lands on the spring-forward gap
| | |
|---|---|
| **Setup** | "Morning swim", recurrence with one window `{day:'sun', start:'02:15', end:'03:15'}`, `interval:1`, `anchorDate: 2026-01-04`, no `effectiveUntil`. Local zone observes US DST; on Sun 2026-03-08 the wall clock jumps 02:00 → 03:00, so 02:15 does not exist. |
| **User action** | Navigate to the week of 2026-03-08 and read the day column. |
| **Expected** | `UNSPECIFIED`. §1 says only "All date math local-time, minute precision, seconds zeroed". §4.4 materialises occurrences at read time with id `taskId@date` and treats them as fixed anchors — but never says what a window whose start time does not exist on that date resolves to. **Ambiguity:** skip the occurrence, shift it to 03:15, or clamp to 03:00 and shorten to 15 minutes? Each is defensible; only one can be right, and the choice changes `getWeekLoad`. |
| **Why it's risky** | Naive `new Date(y, m, d, 2, 15)` in a DST-observing zone silently returns 03:15 in most engines — so the occurrence appears an hour late with no indication, and the drift detector (§7.2, `driftMin:30`) may then "learn" a phantom pattern shift from one weekend a year. |

### B3 — Fall-back day has 25 hours of capacity
| | |
|---|---|
| **Setup** | Week of Mon 2026-10-26 → Sun 2026-11-01. Fall-back is Sun 2026-11-01 (01:00 repeats). `config.windows.sun` = 10:00–14:00, `lightDay`, `maxTasks:2` (§8). |
| **User action** | Open the load bar / call `getWeekLoad(2026-10-26)` and read `capacityMin` and `fillRatio`. |
| **Expected** | Sunday's *automatic* capacity is unaffected — the repeated hour is 01:00–02:00, outside the 10:00–14:00 window (§2.1), so `capacityMin` for Sunday stays 240. But any task the user manually dragged into 01:00–02:00 (legal: "the grid is 24h and users may drag anywhere", §2.1) now exists in an ambiguous hour. `UNSPECIFIED` for that task: which of the two 01:30s does it occupy? |
| **Why it's risky** | Capacity computed as `(endOfDay − startOfDay)` in milliseconds rather than from `config.windows` yields 1500 minutes for that Sunday and quietly wrong `fillRatio` — which then feeds the break-padding thresholds (§2.4 step 4, `breakThresholds`) and the overpack detector (§7.3). One wrong day-length constant corrupts three downstream rules. |

### B4 — Task is longer than the only window that can hold it
| | |
|---|---|
| **Setup** | Empty week. Add flexible task "Write thesis chapter", duration 6h, `deadline: Sun 2026-07-19 14:00`, tags `[]`. Sunday's window is 10:00–14:00 = 4h (§2.1). No other day is before the deadline except Sat, which the user has fully blocked via `blockRange(Sat, Sat, 'away')` (§3.5). |
| **User action** | Submit the Add Task panel. |
| **Expected** | Per §2.2: no pre-deadline capacity at all → **park in the best pre-deadline gap**, set `schedulingWarning`, coral badge (F§3: coral flag sprite planted top-right, F§6). The task must be *visible and parked*, never hidden or silently dropped ("Visible beats invisible", §0). Coral is legitimate here — this is scheduling physics, not moral bookkeeping (P-1). |
| **Why it's risky** | The obvious implementation of `_walkGaps` returns `[]` when no gap ≥ `durationMin` exists, and the caller then does nothing — the task is created but never placed and never rendered, which is exactly the "silently dropped" failure §0 forbids. "Best pre-deadline gap" also implies scoring gaps *smaller than the task*, which the shared gap-walker probably filters out before scoring. |

### B5 — Custom duration of zero via the popover
| | |
|---|---|
| **Setup** | "Email triage" flexible, Wed 2026-07-15, 09:00–09:30. |
| **User action** | Hover → EditPopover (§11 / F§6) → duration chips → "custom" → type `0` → commit. |
| **Expected** | §1.1 guard: `equal → +defaultDuration` — so end becomes 10:00 and the task is 60 min. The UI should reflect the 60 immediately rather than accepting 0 and correcting on next load. Note §10/F§6 separately assert **min duration 15** for *resize*; a 0 typed into the popover is not a resize, so the `+defaultDuration` guard (60), not the 15-minute floor, governs. |
| **Why it's risky** | Two different minimums exist in the spec for the same quantity (15 via resize snap, 60 via the equal-times guard) and an implementation will likely apply whichever one the code path happens to reach — so `0` becomes 15 via the popover and 60 via JSON import, for the same task. Also: is `-30` clamped, or does it swap and produce a 30-min task ending at 09:00? |

### B6 — Week rolls over while an edit is uncommitted
| | |
|---|---|
| **Setup** | It is Sun 2026-07-19, 23:59:40. The detail modal is open on "Budget review" (Sun 21:00–22:00) with an unsaved deadline change typed in. `autoSchedule()` runs on week rollover (§2.4), and retraining runs at rollover before the Wrap report (§5). |
| **User action** | Wait 20 seconds without committing; the clock passes midnight into Mon 2026-07-20. |
| **Expected** | `UNSPECIFIED`. §2.4 says autoSchedule "Runs on: initial load, explicit Re-optimize, week rollover. **Never as a side effect of drags**" — an open modal is not a drag, so rollover fires. Nothing says whether the open editor's task may be moved underneath it, whether the uncommitted edit is discarded, or whether rollover is deferred until the modal closes. The `clone()` used for optimistic edits is explicitly "never enters tasks[]" (§1.1), so the modal is editing a detached copy whose `id` matches a task that autoSchedule may have just relocated. |
| **Why it's risky** | Committing the clone after rollover writes stale `startTime`/`endTime` back over autoSchedule's fresh placement — a lost update that looks like "the app moved my task back". Worse, `carryOver` (§3.6) may have already re-placed it as `placedBy:'auto'`, and the commit will stamp `placedBy:'user'` on a position the user never chose. |

---

## B. Conflicting rules — where two rules both apply

### B7 — A `fixed` task carrying a protected tag
| | |
|---|---|
| **Setup** | "Physio appointment", `type:'fixed'`, `tags:['recovery']` (in `config.protectedTags`, §8), Thu 2026-07-16 15:00–16:00. |
| **User action** | Run Re-optimize from the week `⋯` menu. Then drag a flexible "Errands" card onto 15:30 Thu. |
| **Expected** | Both rows of the 7B table agree on the outcome here and that agreement should be asserted: autoSchedule never moves it (fixed = "never"; protected = "not post-placement"), displacement never evicts it (both "never"), the drop is **rejected with snap-back + shake + toast** (§3.1), and the user may still drag the physio card itself (7B: fixed → "yes (R-1)"). The card should render **both** the anchor badge (F§3, fixed-type) **and** the hammock badge (F§3, protected) — F§6 describes protected as a "full `--tint-rest` wash" and fixed as a `--tint-fixed` tint fill, which cannot both fill the card. |
| **Why it's risky** | The badge/tint collision is unresolved in F§6: an implementation picks one branch of an if/else and the card loses either its anchor or its hammock, violating F§9's "meaning = icon first, tint second" — the icon is the *primary* carrier, so dropping one icon drops real meaning, not decoration. |

### B8 — A `flexible` task carrying a protected tag, on first placement
| | |
|---|---|
| **Setup** | Fresh state. Add "Afternoon nap", `type:'flexible'`, `pinned:false`, `tags:['rest']`, duration 45 min. Nothing else scheduled. |
| **User action** | Submit, then immediately press Re-optimize. |
| **Expected** | §2.4 step 1 lists "protected-tag (post-placement)" among **anchors**; step 2 defines candidates as "flexible ∧ unpinned" — this task is both an anchor and a candidate. The parenthetical "(post-placement)" resolves it in prose: the *first* run places it, subsequent runs treat it as an anchor. But `UNSPECIFIED`: **no field records whether a task has been placed yet.** `placedBy` defaults to `'auto'` and is only flipped to `'user'` by manual action (§1.1), so it cannot distinguish "never placed" from "auto-placed last week". |
| **Why it's risky** | Without a "has been placed" bit, an implementation either (a) treats protected-flexible tasks as anchors always — so a brand-new rest task is anchored at whatever `Date` the constructor defaulted to and never gets scored placement at all, or (b) treats them as candidates always — so every Re-optimize shuffles the user's rest blocks, which is the precise behaviour "not post-placement" exists to prevent. Both are one-word bugs. |

### B9 — Zone contradicts the deadline
| | |
|---|---|
| **Setup** | Zone "Study", `matchTags:['study']`, `exclusive:true`, windows `[{day:'wed', start:'14:00', end:'18:00'}]` only. Task "Problem set", flexible, `tags:['study']`, 2h, `deadline: Wed 2026-07-15 12:00`. Wed 09:00–12:00 is free. |
| **User action** | Submit the task. |
| **Expected** | §2.2, verbatim precedence: **deadline > zone > general windows.** The Study zone has no pre-deadline capacity, so **the zone relaxes** and the task is placed in Wed 09:00–11:00 (or 10:00–12:00 per scoring, §2.3) with an **info badge** reading in the shape of "placed outside Study zone — due Wed". Info badge is `--tint-info #8AA7C2` (F§2), **not** coral — nothing failed here, so P-1's reservation of coral for physics-that-won't-fit is not triggered. |
| **Why it's risky** | An implementation that filters candidate slots by zone *before* filtering by deadline finds zero slots and falls through to the §2.2 parking rule — producing a coral `schedulingWarning` on a task that fits perfectly well. That is the exact inversion of the stated precedence, and it dresses a successful placement as a failure. |

### B10 — Pinned task inside a range the user then blocks
| | |
|---|---|
| **Setup** | "Dentist", `pinned:true`, `type:'flexible'`, Fri 2026-07-17 11:00–12:00. Also on Fri: two unpinned flexibles at 09:00 and 14:00. |
| **User action** | Week `⋯` → Block days… → `blockRange(Fri 2026-07-17, Fri 2026-07-17, 'Away')`. |
| **Expected** | `UNSPECIFIED`. §3.5 says blockRange emits "one full-day protected blocker per day (individually deletable); **existing flexibles evacuate forward**". The two unpinned flexibles evacuate. The pinned Dentist is flexible-typed but pinned, and 7B is unambiguous that pinned tasks are never moved by the engine — so it stays, and now **overlaps a full-day protected blocker**. Nothing in the spec says whether that overlap is legal, drawn, or warned. Contrast §3.4 (Clear Day), which *does* address this: "Full clear requires resolving each pinned/fixed row individually". blockRange has no equivalent resolution step. |
| **Why it's risky** | Two paths that both produce a full-day protected blocker (§3.4 with block-day toggle on, and §3.5) have different pinned-task contracts, and only one of them says so. The likely implementation reuses one code path for both and either silently moves the pinned Dentist (violating 7B and R-1) or leaves an undrawn overlap where the blocker paints over the card. |

### B11 — Drop a flexible onto a pinned task: R-1 vs 7B
| | |
|---|---|
| **Setup** | "Team sync", `pinned:true`, Tue 2026-07-14 10:00–11:00. "Read paper", flexible unpinned, Tue 15:00–16:00. |
| **User action** | Drag "Read paper" body onto Tue 10:15. |
| **Expected** | **Snap-back + shake + toast** (§3.1: "Target fixed/pinned/protected → snap-back"; 7B: pinned → "drop onto it: rejected, snap-back"). R-1 ("A user drop/edit overrides the algorithm **unconditionally**") does *not* override this: R-1's own text scopes itself to the algorithm — "priority values influence `autoSchedule()` ordering only, never manual conflict outcomes". R-1 is user-beats-engine, not user-beats-user's-own-earlier-pin. |
| **Why it's risky** | R-1 is stated in absolutist language in §0 ("unconditionally") and a developer reading §0 before §3.1 can reasonably implement "the drop always wins, the pin yields" — which makes pinning meaningless. This case exists to force the reading order: **7B is the arbiter, R-1 is the tiebreak for engine-vs-user only.** |

### B12 — Pinned task sits after its own deadline
| | |
|---|---|
| **Setup** | "Submit grant", `type:'flexible'`, `pinned:true`, `deadline: Thu 2026-07-16 17:00`, currently placed by the user at Fri 2026-07-17 09:00–10:00 (they dragged it there, so `placedBy:'user'`). |
| **User action** | Press Re-optimize. |
| **Expected** | `UNSPECIFIED`. autoSchedule cannot move it (7B: pinned → never). §2.2's parking rule governs *placement*, and no placement is occurring. So the task simply sits in violation of its own deadline. Does it get a `schedulingWarning` + coral flag? The spec's only description of a passed deadline is in `carryOver` (§3.6: "deadline-passed: flag `missedDeadline`, don't move"), which fires at week rollover, not now. **Ambiguity:** is there any live indicator that a pinned task is scheduled past its deadline, or does the user find out only in the Wrap report? |
| **Why it's risky** | A coral flag here is defensible physics ("this can't meet its deadline where you put it") but slides toward P-1 violation if worded as failure — and R-1 means the app must not "fix" it. The lazy implementation shows nothing at all, and the user's pin silently eats their deadline. |

### B13 — Urgent task's only pre-deadline capacity is inside a rest blocker
| | |
|---|---|
| **Setup** | Wed 2026-07-15 08:00–18:00 is fully booked except 13:00–15:00, which holds "Recovery block", `tags:['recovery']`, flexible, protected. Add "Tax return", flexible, 90 min, `deadline: Wed 2026-07-15 18:00`. `urgencyFactor: 1.5` (§8) — slack (0 free capacity − 90) is far below `duration × 1.5`, so this is maximally urgent (§2.4 step 2). |
| **User action** | Submit. |
| **Expected** | Protected wins: 7B says protected-tag is **never** evicted by displacement, and §2.4 step 1 makes it an anchor. Urgency only affects **ordering** of candidates (§2.4 step 2), never the right to evict. So no slot exists → §2.2 parking rule: park in the best pre-deadline gap, `schedulingWarning`, coral flag. The rest block is untouched and unmentioned. |
| **Why it's risky** | "Urgent first" is easy to over-read as "urgent wins", and an implementation that lets urgency raise a task's eviction rights turns the protected-tag guarantee into a soft preference. This is also a P-1 tripwire: any copy that implies the user should give up their recovery time to make room ("Free up your recovery block?") is exactly the moral bookkeeping §0 forbids. Coral is allowed; a nudge to sacrifice rest is not. |

### B14 — Sunday `maxTasks: 2` vs a Sunday deadline
| | |
|---|---|
| **Setup** | Mon–Sat 2026-07-13→18 are each ~90% full (so §2.1's "used only when other days ≥ ~80% full" condition is met and Sunday is in play). Sunday 2026-07-19 already holds two auto-placed flexibles inside 10:00–14:00. Add a third flexible, 45 min, `deadline: Sun 2026-07-19 14:00`. |
| **User action** | Submit. |
| **Expected** | `UNSPECIFIED`. §2.1 gives Sunday `maxTasks: 2` and `lightDay`. §2.2 gives deadline top precedence over "zone > general windows" — but `maxTasks` is neither a zone nor a window; it is an unranked third constraint. So: does the deadline relax `maxTasks` the way it relaxes a zone (with an info badge), or does `maxTasks` hold and the task parks with a coral warning despite Sunday having two free hours? **The precedence chain in §2.2 has exactly three terms and `maxTasks` is not one of them.** |
| **Why it's risky** | Both readings produce a visible artefact the user will call a bug: relax and they get a third Sunday task on the day the app promised to keep light; hold and they get a coral "won't fit" on a day that visibly has room. The spec must pick. Note this also collides with P-1 — a coral flag next to obviously-empty Sunday space reads as the app moralising about rest rather than reporting physics. |

### B15 — Shrinking a protected project chunk
| | |
|---|---|
| **Setup** | Project "Reef survey" via `addProject()`: `chunking:{ totalMinutes:480, minChunk:60, maxChunk:120, range:{from: Mon 2026-07-13, until: Fri 2026-07-17} }` → four 120-min children with `parentId`. The user adds the tag `recovery` to one child (Wed 10:00–12:00), making it protected (§8 `protectedTags`). |
| **User action** | Drag the Wed child's sand strip from 12:00 up to 11:00 (shrink by 60). |
| **Expected** | `UNSPECIFIED` — direct collision. §3.7 conservation: "shrink chunk → Δ flows to siblings (≤maxChunk) or spawns chunk (≥minChunk) or merges residue" — the 60 minutes must go somewhere. But the *shrunk* chunk is now protected, and §3.7 also says "Completed & user-placed chunks never auto-flexed" and "Re-optimize may re-slice auto-placed chunks". The resize itself sets `placedBy:'user'` (§1.1), so this chunk is now *both* protected *and* user-placed — doubly immune to auto-flexing. The siblings absorbing the Δ are still auto-placed and fair game, so conservation probably still works — **but the spec never says whether a protected tag on a chunk excludes it from its parent's conservation math entirely** (i.e. does `totalMinutes` drop to 420, or do siblings grow to 180 and blow past `maxChunk:120`, forcing a spawn?). |
| **Why it's risky** | The `maxChunk` ceiling means three siblings can absorb at most 60 total (120→120 each is already at cap) — so the Δ *cannot* flow to siblings, must spawn a new ≥60 chunk, and if `range.until` (Fri) has no capacity, the parent gets `schedulingWarning`. An implementation that tries siblings-first, finds no headroom, and forgets the spawn branch silently loses an hour of the user's project. Work conservation failing *silently* is the worst class of bug in §3.7. |

---

## C. Multi-feature interactions

### B16 — `blockRange` over a recurring occurrence
| | |
|---|---|
| **Setup** | "Yoga", recurring, `periods:[{windows:[{day:'thu', start:'18:00', end:'19:00'}], interval:1, effectiveFrom: 2026-01-01}]`, `anchorDate: 2026-01-01`, no exceptions. Thu 2026-07-16 shows the virtual occurrence `yoga-a1b2@2026-07-16`. |
| **User action** | Week `⋯` → Block days… → `blockRange(Thu 2026-07-16, Thu 2026-07-16, 'Conference')`. |
| **Expected** | `UNSPECIFIED`. §3.5: "existing flexibles evacuate forward". §4.4: virtual occurrences "behave as fixed anchors" — so the Yoga occurrence is *not* a flexible and does not evacuate; it stays, overlapping the full-day protected blocker. **The spec never says whether blockRange writes `skip` exceptions (§4.2) for recurring occurrences it covers.** Compare §3.1, which for a drop onto a recurring occurrence *mandates* an occurrence menu with "no silent default" — blockRange has no such requirement, yet it affects the same objects. |
| **Why it's risky** | Whatever blockRange does here, it does to a whole range at once, which is where silent defaults do the most damage. Auto-writing skip exceptions across a blocked week is a bulk mutation of the recurrence pattern's exception list that the user never confirmed; doing nothing leaves the user's "I'm away" instruction visibly contradicted by yoga sitting on the blocked day. §3.1's "no silent default" principle plainly wants to apply here and doesn't reach. |

### B17 — Drift detector fires on occurrences the user moved via exceptions
| | |
|---|---|
| **Setup** | "Standup", recurring Mon 09:00–09:30, `interval:1`. Over the last 5 weeks the user dragged the occurrence to 09:45 on 4 of them, each writing a `move` exception (§3.1, §4.2). `detectors: { driftN:5, driftHits:4, driftMin:30 }` — hmm, each move is only +45 min ≥ 30, and 4/5 in the same direction. Detector fires. |
| **User action** | Open the Wrap report / Cabana, click the drift detector's **one-click pattern update** (§7.2). |
| **Expected** | The period's window updates to 09:45–10:15. `UNSPECIFIED`: **are the four `move` exceptions cleared?** If they are not, each of those four dates now has an exception that says "move to 09:45" relative to a pattern that already says 09:45 — harmless if exceptions store absolute times, catastrophic if they store deltas. §4.2 defines the exception shape as `{date, action:'move', start?, end?}` — absolute-looking, but the field is optional and undefined semantics for `move` without `start` are not given. Also unstated: does the update **split the period** (§4.1: permanent change = period split, "From now on, or including the past?" default from now on) or mutate the existing window in place? §7.2 says "one-click", which implies no prompt — contradicting §4.1's explicit prompt for permanent changes. |
| **Why it's risky** | §7.2's "one-click" and §4.1's "From now on, or including the past?" cannot both be honoured. An implementation picks one. If it picks one-click-mutate-in-place, it silently rewrites history: past weeks' rendering changes retroactively, and the ML history (§4.4: "continuous ML history across pattern changes") now disagrees with the timestamps it trained on. |

### B18 — `rippleShift` pushes a task past its own deadline
| | |
|---|---|
| **Setup** | Wed 2026-07-15: "Client call" fixed 09:00–10:00; "Draft memo" flexible 10:30–11:30 with `deadline: Wed 2026-07-15 12:00`; "Lunch" flexible 12:00–13:00; nothing fixed after. Break padding currently 30 min default. |
| **User action** | Resize "Client call"'s bottom edge from 10:00 to 11:00 (+60). Per §3.2's encoded cases (+15 resize→ripple, +4h resize→displace), a +60 resize with `strategyBias 0.8` favouring ripple is likely to pre-highlight **ripple**. Press Enter to accept the default. |
| **Expected** | `UNSPECIFIED`. §3.3 defines ripple's three stages — compress breaks to `breaks.minimum` (5), shift movable tasks by residual, overflow evacuates forward via scoring — and defines walls only as "Fixed/pinned downstream". **A deadline is not a wall.** So "Draft memo" gets shifted to ~11:35–12:35, past its 12:00 deadline, by a mechanism that §2.2 would never have allowed at placement time. Does the shifted task get `schedulingWarning` + coral? Does `chooseConflictStrategy` count deadline violations in `cost(ripple)`? §3.2's cost function is "downstream shift minutes + forced evacuations × `evacuationPenalty`" — **deadline breaches cost zero.** |
| **Why it's risky** | The cost function is stated as a complete formula, so a competent implementer will implement exactly it — and ripple will cheerfully choose to break a deadline over evicting one task, because breaking a deadline is free. This makes §2.2's "deadline > everything" precedence true at placement and false everywhere else, which is worse than not having it. |

### B19 — `rippleShift` pushes a non-matching task into an exclusive zone
| | |
|---|---|
| **Setup** | Zone "Study", `matchTags:['study']`, `exclusive:true`, windows `[{day:'thu', start:'14:00', end:'18:00'}]`. Thu 2026-07-16: "Errands" flexible `tags:['home']` 13:00–14:00; the zone region 14:00–18:00 holds one study task at 16:00. "Errands" runs long. |
| **User action** | Resize "Errands" bottom edge 14:00 → 15:00 and accept ripple. |
| **Expected** | `UNSPECIFIED`. `exclusive:true` means "zone time reserved; **non-matching tasks excluded**" (§1.2). But §2.1 scopes constraints tightly: "Windows bound **automatic** placement only". A ripple is not automatic placement (it's a consequence of a manual resize) and it is not a manual drop either — it is engine motion caused by user action. So does exclusivity bind it? §3.3's stage 3 says "overflow evacuates forward **via scoring**", and scoring (§2.3) has no zone term at all — zones live in §2.2's precedence chain, which §3.3 never invokes. |
| **Why it's risky** | Ripple/displace almost certainly calls a shared placement helper. If that helper enforces zones, ripple mysteriously refuses legal shifts; if it doesn't, `exclusive:true` is a lie for every non-autoSchedule code path — and the user's Study zone fills with errands one resize at a time. Either way, `exclusive` needs to name *which flows* it binds. |

### B20 — Learning module sees project chunks
| | |
|---|---|
| **Setup** | 14 ratings exist (≥ `coldStartRatings:10`), so `w.preference` is live at 0.15 (§5). Of those, 9 are on children of the "Reef survey" project — the user consistently rates 2h afternoon chunks 2/5 with `energy:-1`, and 1h morning chunks 5/5. |
| **User action** | Cabana → "Retrain now". Then add a new project with `minChunk:60, maxChunk:120` and watch chunk placement. |
| **Expected** | §5's feature list is explicit and closed: "top-N tag indicators, time-of-day bucket (6), day-of-week, duration bucket, priority, day-fill at completion, placedBy, moveCount". **`parentId` is not a feature and neither is "is a chunk".** So chunk ratings train the general model via their duration bucket and time-of-day — which is arguably correct and arguably contamination. `modelScore(task, slot)` will correctly push new 1h-ish work to mornings. But `UNSPECIFIED`: **does the learning signal feed chunk *sizing*?** §3.7 sizes chunks in `[minChunk, maxChunk]` by §2 placement; §2.3's score is per-slot, and slot length for a chunk is a free variable the scorer never sees. |
| **Why it's risky** | The model has learned "this user hates 2h blocks" from 9 samples and has no way to act on it, because chunk size is chosen before scoring runs. The user will rate afternoon 2h chunks 2/5 forever and the Cabana's "plain-language preferences" (§5) will cheerfully display "you prefer shorter morning sessions" while the app keeps making 2h afternoon chunks. That is a credibility bug, not a crash. |

### B21 — `carryOver` of a zone-matching task
| | |
|---|---|
| **Setup** | Zone "Study" `matchTags:['study']`, `exclusive:true`, windows Mon–Fri 14:00–18:00. Task "Read chapter 4", flexible, `tags:['study']`, incomplete, sat in the Study zone Thu 2026-07-16 14:00–15:00 but was never completed. No deadline. `history.carriedCount: 2`. |
| **User action** | Week `⋯` → "Wrap up week" → carry forward. |
| **Expected** | §3.6: not recurring, no deadline passed → "rest: re-place as `placedBy:'auto'`; increments `history.carriedCount`" → 3. Re-placement goes through §2 scoring, so §2.2's precedence applies and the task should route back into the Study zone in the new week. `carriedCount` hits 3, which is *not* the starvation trigger — §7.2 starvation is `displaced+carried ≥ 3`, so with `displacedCount:0` this fires at exactly 3. The detector output must be **report/Cabana only** (§7.2, "P-1 corollary") and must offer "Pin next week / **Let it go**" at equal visual weight (§0). |
| **Why it's risky** | Two failure modes stack. (1) The re-placement drops `placedBy` to `'auto'` per spec — correct — but a naive implementation carries the old `startTime` forward via `bump()` ("preserves time-of-day", §1.1) instead of re-scoring, which silently ignores the zone and every other constraint. (2) `displaced+carried ≥ 3` reads a *lifetime* counter (`history` has no per-week reset in §1.1), so starvation fires once and then fires forever, every week, on the same task — a nagging loop that P-1 exists to prevent. **The spec never says `history` counters reset.** |

### B22 — Recurring task inside a project
| | |
|---|---|
| **Setup** | User opens Add Project, fills in "Thesis": `totalMinutes:600, minChunk:60, maxChunk:120, range:{from: Mon 2026-07-13, until: Fri 2026-07-31}`, and tries to also set a recurrence (the detail modal exposes the recurrence editor on all tasks, §11/F§6). |
| **User action** | Set recurrence "every Tue 10:00–12:00" on the project parent, then on one materialized child. |
| **Expected** | `UNSPECIFIED`. §1.1 gives every Task both `recurrence` and `chunking` fields with no stated exclusivity. But they are semantically incompatible: `chunking` says "distribute N minutes of finite work across a range and stop"; `recurrence` says "regenerate this forever". A recurring parent would materialize children (§3.7) *and* expand virtual occurrences (§4.4) from the same object. On a **child**: children are materialized chunks with `parentId`; §4.4 says occurrences behave as fixed anchors, which would exempt the child from conservation (§3.7). |
| **Why it's risky** | The data model permits the combination and the UI exposes both editors on the same modal, so a user *will* do this. Nothing validates it. The plausible outcome is unbounded materialization — a recurring project regenerating chunks weekly against a `totalMinutes` budget it already spent — or an id collision between a chunk's id and a virtual occurrence id `taskId@date`. **Recommendation for the spec: state the exclusivity explicitly and have the UI disable one editor when the other is populated.** |

### B23 — Duplicate a project chunk
| | |
|---|---|
| **Setup** | "Reef survey" project, four children, one at Wed 2026-07-15 10:00–12:00. |
| **User action** | Right-click the Wed child → context menu → **duplicate** (§11: "TaskCard … context menu: duplicate/delete"). |
| **Expected** | `UNSPECIFIED`. §1.1 `duplicate()`: "**new id**; resets completion/satisfaction/history/placedBy; **recurrence NOT copied**; placed via scoring". `parentId` is not in the reset list and not in the exclusion list — so by omission it **is** copied, and the project silently gains a fifth child worth 120 minutes that `chunking.totalMinutes:480` never budgeted. Conservation (§3.7) is now violated by an operation that isn't in §3.7 at all. |
| **Why it's risky** | `duplicate()`'s field list was clearly written thinking about recurrence and lived data, not projects — `parentId` fell through the gap. The bug is invisible: the castle glyph (F§3) shows five buckets, the parent's `totalMinutes` says 480, the sum of children says 600, and nothing reconciles them. Either `duplicate()` must null `parentId` (making it a free-standing task), or it must route through §3.7 conservation and raise the parent's total. |

### B24 — `whatToDo` when everything is protected
| | |
|---|---|
| **Setup** | It is Wed 2026-07-15 13:00. The next 4 hours contain only: a `recovery`-tagged rest block 13:00–15:00 and a `rest`-tagged block 15:00–17:00. Three flexible tasks exist later in the week, none urgent, none with deadlines. The user's last three ratings all carry `energy:-1`, so §6's **rest-boost** is active. |
| **User action** | Click the compass in the header (F§7). |
| **Expected** | `UNSPECIFIED`. §6 says `whatToDo(now)` "ranks **existing** tasks for the current moment" and "**never suggests tasks**" (§5 boundary) — it returns top 3 with reasons from actual scoring terms. Here the honest answer is "you're resting; nothing needs you" — but §6 mandates **top 3**, and F§7 mandates a "Now" card with "top pick with its reasons, two smaller alternates beneath". Nothing defines the empty/zero-candidate rendering. F§3 assigns "Message in bottle → Empty states (empty day, no Find-Times results)" — the compass surface is not listed. |
| **Why it's risky** | Forced to produce three picks, the implementation ranks the three later-in-the-week flexibles and shows them — so the app, at the exact moment its own rest-boost fired, hands the user a to-do list during their protected recovery block. That is a textbook P-1 violation produced by a UI contract ("top 3") overriding a semantic one ("rest-boost"). The correct empty state is the bottle and a sentence with no imperative in it. |

### B25 — `interval: 2` parity survives an `effectiveFrom` edit
| | |
|---|---|
| **Setup** | "Payroll", recurring, `anchorDate: 2026-01-05` (a Monday), `periods:[{windows:[{day:'mon', start:'09:00', end:'10:00'}], interval:2, effectiveFrom: 2026-01-05}]`. Parity vs `anchorDate` (§4.1) means it lands on 01-05, 01-19, 02-02 … and on Mon **2026-07-13** (27 weeks after anchor — odd, so it does *not* land; it lands 2026-07-06 and 2026-07-20). |
| **User action** | Open the recurrence editor and change this period's `effectiveFrom` to 2026-02-02 (nothing else). |
| **Expected** | Parity is computed **vs `anchorDate`**, not vs `effectiveFrom` (§4.1: "`interval` (every Nth week, parity vs `anchorDate`)"). `anchorDate` is unchanged, so the occurrence set is unchanged except for being truncated before 2026-02-02. Payroll still lands 07-06 and 07-20, still skips 07-13. |
| **Why it's risky** | `effectiveFrom` is the natural thing to count weeks from — it's right there in the period object, while `anchorDate` lives one level up on the task. An implementation that computes `weeksBetween(period.effectiveFrom, date) % interval` flips the parity of the entire pattern the moment a user edits an unrelated boundary date, moving every future occurrence by one week. Silent, total, and only visible if you know the answer beforehand. This is also why §4.1's "period sandwich" for temporary changes is dangerous: it creates *three* periods, and if each computes parity from its own `effectiveFrom`, the pattern desynchronises at every seam. |

---

## D. Data & lifecycle

### B26 — Import a file from a future schema
| | |
|---|---|
| **Setup** | The app persists `schemaVersion: 1` (§1). The user has `schedule-2027-03-02.json` exported by a later build, containing `schemaVersion: 2` and a task with an unrecognised field `energyBudget: 40`. |
| **User action** | Cabana → Footlocker (treasure chest, F§3) → Key/import → select the file. |
| **Expected** | §9: "import = **validate → dry-run summary → replace/merge**". The validate step must **reject or explicitly warn** on `schemaVersion > 1` before the dry-run summary, because the summary cannot honestly describe data whose semantics this build doesn't know. `UNSPECIFIED`: the spec names the pipeline but not the version policy — is a higher version a hard error, a lossy-import-with-warning, or ignored? There is no migration story in either doc. |
| **Why it's risky** | The overwhelmingly likely implementation checks `schemaVersion !== 1` never, or checks it only to reject *lower* versions (the direction people think about). A v2 file imported with **replace** destroys the user's real schedule and silently drops every field this build doesn't parse — and §9's export is the *only* backup mechanism, so there is nothing to restore from. This is the single highest-blast-radius case in this document. |

### B27 — Orphaned chunk: the parent project was deleted
| | |
|---|---|
| **Setup** | "Reef survey" project with four children. One child (Wed 10:00–12:00) is marked `completion:'done'` with a 4-shell rating. |
| **User action** | Delete the **parent** task via `removeTask(parentId)`. |
| **Expected** | `UNSPECIFIED`. §1.3 lists `removeTask(id)` with no cascade semantics. §3.7 defines "**Delete chunk** → ask: remove work vs redistribute" — that is deleting a *child*. Deleting the parent is not specified anywhere. The children still carry `parentId` pointing at a task that no longer exists, so every conservation lookup, the sandcastle glyph (F§3), and the Wrap report's "chunk progress" (§7.1) now dereference a dangling id. Note that §3.7 *does* define a graceful path — "**Finish project here** → remaining chunks vanish, undo toast, actual-vs-planned recorded" — which is what a user deleting a parent probably means. |
| **Why it's risky** | Three bad outcomes are all plausible: (a) cascade-delete the children, destroying the completed chunk and its rating (ML data loss with no confirmation — §3.10 requires confirmation for exactly this, "Entire task & history (only confirming path; states ML data loss)"); (b) orphan them, and every subsequent conservation call throws on `undefined.chunking`; (c) orphan them silently and they render as ordinary tasks with a bucket-and-spade glyph pointing at nothing. The spec should route parent-deletion into the §3.7 "Finish project here" flow. |

### B28 — Retrain on contradictory ratings
| | |
|---|---|
| **Setup** | Exactly 12 ratings (≥ `coldStartRatings:10`). Six are Tue 14:00, 60 min, tag `admin`, `overall:5`, `timingFit:+1`. Six are **identical in every §5 feature** (Tue 14:00, 60 min, `admin`, same priority, same day-fill, same `placedBy`, same `moveCount`) but `overall:1`, `timingFit:-1`. Per §5, `timingFit≠0` **doubles sample weight on time features** — so all 12 are double-weighted and they cancel exactly. |
| **User action** | Cabana → "Retrain now" (which "shows sample count", §5). |
| **Expected** | Ridge regression (§5) is well-posed under contradiction — the ridge penalty guarantees a unique solution, and the fit converges to the mean (`overall ≈ 0.5` normalised, §5: "Target: overall∈[0,1]"). `modelScore` returns ~0.5 for every slot, so `w.preference` (0.15) contributes a **constant** to §2.3's score and therefore changes no ranking. That is the correct outcome: the model has learned nothing and behaves as if it had learned nothing. The Cabana's "plain-language preferences" (§5: "weights inspectable → Cabana renders plain-language preferences") must render **near-zero weights honestly** — ideally as "no clear pattern yet", not as a confident-sounding sentence built from noise. |
| **Why it's risky** | Two things break. (1) "Plain-JS gradient descent" (§5) with a fixed learning rate and unnormalised features (`moveCount` is unbounded; `priority` is 1–5; indicators are 0/1) can oscillate or overflow to `NaN` — and a `NaN` weight makes `modelScore` `NaN`, which makes every §2.3 `score(slot)` `NaN`, which makes `highest wins` compare `false` for every pair and **placement silently degrades to "first slot"** app-wide. There is no stated `NaN` guard anywhere. (2) The Cabana will happily render "You prefer Tuesday afternoons" off a weight of 0.003. |

### B29 — Export while a drag is in flight
| | |
|---|---|
| **Setup** | The user is mid-drag: "Grocery run" picked up, ghost at 0.85 opacity following the cursor (F§8), not yet dropped. §1.1: `clone()` is used for "ghosts, optimistic edits; **never enters tasks[]**" and keeps the **same id**. Auto-save is debounced 2 s (§9) and the drag has lasted 6 s. |
| **User action** | While still holding the drag, the 2 s debounce fires an auto-save; the user then presses Esc to cancel the drag (§10 keyboard contract: "Esc cancel"). |
| **Expected** | Auto-save must persist `tasks[]` — which by §1.1's own rule **does not contain the ghost** — so the saved state shows "Grocery run" at its original position. Esc cancels; nothing changed; the persisted state was already correct. The `snapshot()` used for planned-vs-actual (§7.1) must likewise see only `tasks[]`. |
| **Why it's risky** | The "same id" property of `clone()` is a loaded gun: any implementation that puts the ghost into `tasks[]` for rendering convenience (the easy way to make the grid draw it) now has **two objects with the same id** in the serialized array. Import (§9) would then either dedupe silently or create a real duplicate task. §1.1's "never enters tasks[]" is a one-line rule guarding a whole class of corruption, and it is exactly the kind of rule a rushed frontend violates for a render shortcut. |

### B30 — Corrupt task on load
| | |
|---|---|
| **Setup** | localStorage holds a valid state blob except one task whose `endTime` deserialises to `Invalid Date` (hand-edited file, or a truncated write). Seven other tasks are fine. |
| **User action** | Load the app. |
| **Expected** | `UNSPECIFIED`. §1 says every class implements `fromJSON()` with `schemaVersion: 1`; §9 defines the adapter chain and a status dot; neither defines per-record error handling. The principle that should govern is §0's "**Visible beats invisible** — a task that can't be placed well is parked with a warning badge — never hidden, never silently dropped" — a task that can't be *parsed* deserves at least as much. `getDuration()` is documented "null-safe→0", which suggests the model anticipates missing times but only guards `null`, not `Invalid Date`. |
| **Why it's risky** | A single `Invalid Date` propagates: `getDuration()` returns `NaN` (not 0 — `NaN` is not `null`, so the null-safe guard misses it), `getWeekLoad().scheduledMin` becomes `NaN`, `fillRatio` becomes `NaN`, the break-threshold comparisons (§2.4 step 4) all return `false`, and the sand-fill load meter (F§5) renders at zero. **One bad record silently zeroes the whole week's load display.** The likely coded behaviour is either that, or a top-level `try/catch` that discards the entire state blob — losing seven good tasks to save one bad one. |

### B31 — The tenth rating is deleted
| | |
|---|---|
| **Setup** | Exactly 10 ratings exist. §5: `w.preference` is "default 0.15; **forced 0 until ≥10 ratings**", and §2.3's weights are "renormalized". So preference is currently live and the other three weights are scaled down to accommodate it. |
| **User action** | Delete a completed, rated task via §3.10's "Entire task & history" path (the confirming path that "states ML data loss"). Sample count drops to 9. Then press Re-optimize. |
| **Expected** | `w.preference` returns to a forced 0 and the remaining weights **renormalize back** (§2.3: "Weights renormalized"), so proximity/balance/stability recover their full share. Placement decisions may legitimately change. The §3.10 confirmation already warned about ML data loss, so no additional notice is owed — and per P-1, none should scold ("you no longer have enough ratings" is a fact; "you deleted your training data" is bookkeeping). |
| **Why it's risky** | The cold-start gate is almost certainly evaluated once at load or at retrain (§5: retraining happens at "week rollover + Cabana Retrain now"), not on every scoring call — so after deleting the 10th rating the model keeps scoring with 9 samples until the next rollover. The renormalisation is the subtler half: if weights are renormalized once at config-read and `preference` is zeroed *afterwards*, the remaining weights sum to 0.85 and every score is uniformly deflated — harmless for ranking, but it silently changes the `score(slot)` values that §7.1's suggestions and §6's "reasons generated from actual scoring terms" quote back to the user. |

---

## E. P-1 — the app never guilts

### B32 — Skip-streak detector on a pattern the user has consciously abandoned
| | |
|---|---|
| **Setup** | "Gym", recurring Mon/Wed/Fri 07:00–08:00. The user has marked every occurrence `skipped` for 4 consecutive weeks (12 skips). `detectors.skipStreak: 3` (§8). |
| **User action** | Open the Wrap report for the 4th week, and separately look at the Mon 07:00 grid cell. |
| **Expected** | The grid cell shows **nothing** beyond the ordinary recurring card — §7.2 is explicit that detectors are "**report/Cabana only — P-1 corollary**". §7.3 names the overpack notice as "**the one** grid-side notice (physics)", so a skip-streak notice on the grid is forbidden by exclusion. In the report, the skip-streak offers "**Change pattern / Let it go via `effectiveUntil`**" at equal visual weight (§0: "Every diagnostic offers a graceful exit ('Let it go') with equal visual weight to the fix"). In the Accomplished section, skips are "**quiet count only**" (§7.1) — a number, no adjective, no streak language, no comparison to previous weeks. |
| **Why it's risky** | Every instinct in reporting UI pushes the wrong way here: a 4-week streak is a "finding", findings get emphasis, emphasis gets coral. But coral is reserved for scheduling physics (§0, F§2: "coral — scheduling physics only (P-1)") and a skipped gym session is not physics. The second trap is the fourth-week firing: the detector triggered at week 3 and the user did nothing, which *is* an answer. Re-firing every week with the same prompt is nagging by repetition even if each instance is politely worded. **The spec does not say whether a dismissed/ignored detector re-fires — it should.** |

### B33 — The seagull that doesn't come
| | |
|---|---|
| **Setup** | F§3: "Seagull — Rare delight: **perches on the week sign after a fully-completed day.** Never obstructs." The user completes 6 of 7 tasks on Tue 2026-07-14 and skips one. Monday was fully completed and got the seagull. |
| **User action** | Finish the day on Tuesday with one task marked `skipped`. |
| **Expected** | No seagull. And crucially, **no absence-marking** — no empty perch, no greyed-out seagull, no "so close!" toast, no streak counter that resets visibly. The seagull is defined as delight, and F§9 states decorative delight "never carries information". If its absence is legible as information, it has become information — and specifically it becomes a reward withdrawn for skipping, which is the purest form of the moral bookkeeping P-1 forbids ("Skipping things is a legitimate outcome", §0). |
| **Why it's risky** | The natural implementation is a persistent perch element whose seagull sprite toggles — leaving a conspicuous empty spot on days you didn't earn it. Gamified-streak framing arrives by accident here, not by design: nobody decides to guilt the user, they just implement `<Perch>{allDone && <Seagull/>}</Perch>` and the negative space does the guilting. The seagull must not have a reserved slot; it must be absent-by-default and appear as an addition. |

### B34 — Export nag at 25 changes during a heavy editing session
| | |
|---|---|
| **Setup** | §9: "Exit reminder: `beforeunload` on unexported changes + badge on export button + **gentle toast at 25+ changes**. Reminder concerns *export*; auto-save runs regardless." The user is doing a big weekly replan and makes 80 edits over 40 minutes. Storage is healthy (green dot, §9). |
| **User action** | Keep editing past 25, 50, 80 changes. |
| **Expected** | `UNSPECIFIED`, and the ambiguity matters. "Gentle toast at 25+ changes" — is that **once** at the 25th change, or **every** change past 25, or every 25? The `carryOver` past-week banner is explicitly specified as "**once, dismissible**" (§3.6), and the overpack notice as "**one-time** non-modal dismissible" (§7.3) — the spec's established idiom for recurring-condition notices is fire-once. By that pattern the export toast fires once and is done. |
| **Why it's risky** | `if (changeCount >= 25) showToast()` inside the change handler is the two-second implementation and it fires 56 times. Even at "gentle", a toast that reappears on every edit is nagging — and it's nagging about something the user has no real reason to do, since §9 says auto-save runs regardless and the storage dot is green. The toast's *content* is also a P-1 tripwire: "You have 80 unexported changes" is a fact; "Don't lose your work!" is manufactured anxiety about a risk the app has already mitigated. **The badge on the export button is the right persistent channel; the toast should be the one-shot.** |

### B35 — Early completion must not read as a verdict
| | |
|---|---|
| **Setup** | "Deep work", flexible, Thu 2026-07-16 09:00–12:00 (3h). At 09:50 the user is done. |
| **User action** | Click the check control → `done` (§3.9). |
| **Expected** | §3.9: early done "**truncates block** (crosshatch remainder) + fires **removal toast** for remainder". The remainder is 130 min ≥ `backfillOfferThreshold: 45` (§8), so §3.8's toast appears with three options and **"Leave open" is the default**: Leave open / Backfill / Protect (umbrella icon, F§3). The rating prompt is "shells + **3 optional** facet taps" (§3.9) — optional means dismissible with zero friction and no re-prompt. Backfill, if chosen, pulls "warned → urgent-deadline → auto-placed score-improvers; **never user-placed**" (§3.8). |
| **Why it's risky** | Three slips, all natural. (1) Making **Backfill** the default — it's the "productive" answer and it's what a scheduling app wants to do — but §3.8 names *Leave open* as default, and defaulting to backfill converts every early finish into more work, teaching users not to finish early. (2) The crosshatch remainder (F§6) reading as *unused time you owe* rather than neutral texture. (3) The rating prompt blocking or re-appearing: §5 says "Facets optional always", and a rating prompt you must dismiss is a demand for self-assessment on someone who just did well. |

---

## F. Accessibility & input

### B36 — Enter is overloaded: keyboard drop vs the ripple/displace chooser
| | |
|---|---|
| **Setup** | Keyboard-only user. §10 keyboard contract: "**Space** pick up, **arrows** move, **Enter** drop, **Esc** cancel". §3.2 chooser contract: "the always-shown inline chooser (**Enter = default, Esc = snap back**)". Wed 2026-07-15 has a dense cluster 09:00–17:00. |
| **User action** | Tab to "Read paper", Space to pick up, arrow down to 11:15 (inside the cluster), press **Enter** to drop. The drop triggers a conflict → the inline chooser appears with ripple pre-highlighted (§3.2: "15 min drop into cluster→ripple"). Press **Enter** again. |
| **Expected** | First Enter = drop. Chooser opens, focus **moves into it**, and the pre-highlighted default (wave icon = ripple, F§6) is announced — not merely highlighted, since F§9 requires meaning by icon/text, and a *pre-highlight* is a visual affordance a screen reader user cannot see. Second Enter = accept ripple. Esc at the chooser = "snap back" (§3.2) — note this is **snap-back of the drop**, i.e. Esc after a completed drop undoes the drop, which is a different meaning from Esc during a drag ("cancel"). Both are Esc; both are correct; they must not be handled by the same listener. |
| **Why it's risky** | The chooser is "always-shown inline" — a non-modal element that appears after a completed action and steals the meaning of Enter/Esc. If focus doesn't move into it, the second Enter goes to the grid and picks up the next task, while the chooser sits there waiting; if the drag's keydown handler is still mounted, Esc cancels a drag that already ended. This is the highest-traffic keyboard path in the app (every conflicted drop) and it has two keys with two meanings each. |

### B37 — Shift+↓ resize below the 15-minute floor
| | |
|---|---|
| **Setup** | "Check email", flexible, Fri 2026-07-17 09:00–09:15 (already at the 15-min minimum, §10/F§6: "15-min snap, **min duration 15**"). Focus is on the card. |
| **User action** | Press **`Shift+↑`** (end-resize, §10) to pull the end time earlier, 09:15 → 09:00. Separately, press **`Alt+↓`** (start-resize) to push the start later, 09:00 → 09:15. Each gesture attempts to shrink an already-minimal task from one edge. |
| **Expected** | Both must be refused at the floor: the task cannot go below 15 min from either edge. `UNSPECIFIED`: **what is announced?** A silently-ignored keypress is indistinguishable from a broken app to a keyboard user — there is no visual "it didn't move" cue if you can't see the card. §10 requires `aria-grabbed` and labeled gridcells but says nothing about live-region feedback for resize, and F§9 only restates the existing rules. The §1.1 `equal → +defaultDuration` guard must **not** fire here — if `Shift+↑` sets end == start, snapping the task to 60 minutes would be a spectacular inversion of a shrink gesture. |
| **Why it's risky** | The floor is enforced in three places with three different values (15 for resize, 60 via the equal-times guard, whatever the popover accepts — see B5) and the keyboard path is the least-tested of the three. The likely bug: `Shift+↑` at the floor sets `endTime = startTime`, the model guard fires, and the 15-minute task becomes 60 minutes. Silent, and the opposite of what the user asked for. |

### B38 — Sprite sheet fails to load
| | |
|---|---|
| **Setup** | The app is installed as a PWA (§12) and opened offline with a cold cache, or `/src/assets/icons/` 404s after a bad deploy. On screen: a pinned task (padlock badge), a fixed task (anchor badge), a protected task (hammock badge), a parked task (coral flag), a deadline chip (pennant), and a 3-shell rating. |
| **User action** | Load the week. |
| **Expected** | F§10 is unambiguous: "**every sprite has a CSS/SVG fallback (app ships art-less if needed)**"; §10: "sprites decorative `aria-hidden` with CSS fallbacks"; F§9: "**Meaning = icon first, tint second, never tint alone**". So with zero sprites, all six meanings must still be conveyed — by CSS/SVG fallback shapes plus text equivalents. This is the hard corner: F§1 argues the art *improves* accessibility because "every state now has an *icon* … doing primary duty, with tint as reinforcement" — but if the icon is a sprite and the sprite is gone, **the primary carrier is gone and only the tint remains**, which F§9 explicitly forbids as sufficient. |
| **Why it's risky** | The sprites are `aria-hidden` (§10) precisely because their meaning is supposed to live in text — but if that text was never written (because the sprite "obviously" showed it), a sprite failure downgrades pinned/fixed/protected/warning to four tint colours with no labels, failing both F§9 and the no-color-alone rule at once. F§10 also puts "sprites **last**" in the build order with "fallbacks first proves the skeleton" — a good plan that a rushed team inverts, shipping sprites and backfilling fallbacks never. Test with the asset directory renamed. |

### B39 — Reduced motion during a displacement cascade
| | |
|---|---|
| **Setup** | `prefers-reduced-motion: reduce` is set. Tue 2026-07-14 has five stacked flexibles 09:00–15:00. The user drops a 2h task at 10:00 — §3.2's encoded case: "2 h drop→**displace**". Three cards get evicted and re-placed. |
| **User action** | Drop, then Enter to accept displace. |
| **Expected** | Per §10 and F§8: **all transitions 0 ms**, "wipes → fades", grain removed, no squash-and-stretch settle (F§8 assigns that 180ms rubber-hose animation specifically to "displaced/relocated cards"). So three cards teleport to their new positions with no motion at all. **This is the accessibility requirement and it destroys the affordance**: the squash-and-stretch settle is what tells the user *which* cards moved and *where they went*. With motion at 0, three tasks silently relocate across the week. `UNSPECIFIED`: what replaces it? |
| **Why it's risky** | This is the genuine design gap, not an implementation slip. Reduced-motion is specified purely subtractively — every rule is "→ 0ms" / "→ fade" / "grain removed" — with no compensating channel. A displacement cascade is the one interaction whose *meaning* was carried by animation, and for reduced-motion users that meaning is simply deleted. A toast ("3 tasks moved" + undo) or a brief non-animated highlight on relocated cards would carry it; neither is specified. Note this also affects the drag ghost ("raw follow, 150ms drop snap" — is the ghost itself removed at 0ms?) and the seagull. |

---

## G. Failure modes

### B40 — localStorage quota exceeded mid-session
| | |
|---|---|
| **Setup** | Deployed on GitHub Pages, so §9's adapter chain selects **localStorage primary**. Status dot is **green (persistent)**. The user has a large state (long `occurrenceData` histories on several recurring tasks — §1.1 stores per-occurrence completion, satisfaction *and* history keyed by date, forever, with no stated pruning). The 5MB origin quota is nearly full. |
| **User action** | Make one more edit; the debounced 2 s auto-save fires and `setItem` throws `QuotaExceededError`. |
| **Expected** | `UNSPECIFIED`. §9 defines the adapter's *selection* priority ("env-detected") and a two-state dot ("green persistent / amber session") but no **runtime demotion**: the adapter chose localStorage at boot and there is no described path from a successful adapter to a failed one. The right behaviour is plainly to fall back to in-memory, flip the dot to **amber (session)**, and surface the footlocker/export prompt — this is the one moment the export nag (§9, and B34) is genuinely earned. Nothing says it happens. |
| **Why it's risky** | Two compounding problems. (1) `setItem` throwing inside a debounced timer has no user-facing call stack — the throw is swallowed by the timer, the dot stays green, and the app **lies about durability for the rest of the session**. Every subsequent save fails identically and silently; the user closes the tab on a green dot and loses the week. (2) The root cause is a data-model decision: `occurrenceData` is unbounded per-date growth with no retention policy, and §5's "one task = one identity = **continuous ML history**" (§4.4) actively argues against pruning it. So quota exhaustion is not a hypothetical — it's the designed end state of a long-lived recurring task. **The spec needs both a demotion path and a retention story.** |

---

## Top 10 most likely to be broken

Ranked by `P(broken) × blast radius`, assuming competent but rushed implementers.

1. **B26 — future-schema import.** Version checks are the classic write-it-later item, and the failure mode is *destroying the user's entire schedule* via `replace` with no backup, since export is the only backup. Highest blast radius in the document; the guard is four lines.
2. **B18 — ripple pushes a task past its deadline.** §3.2 states `cost(ripple)` as a complete formula in which deadline breaches cost **zero**. A good implementer will implement exactly the formula, and §2.2's headline precedence quietly becomes placement-only. The bug is *in the spec*, so the code will be "correct".
3. **B40 — silent storage failure.** A throw inside a debounced timer with a status dot that never demotes. The app affirmatively lies about durability, and `occurrenceData`'s unbounded growth makes it inevitable rather than rare.
4. **B28 — `NaN` weights poison every score.** Plain-JS gradient descent over unnormalised features (`moveCount` unbounded, indicators 0/1) diverges; one `NaN` weight makes every `score(slot)` `NaN`, `highest wins` compares `false` everywhere, and placement app-wide degrades to "first slot" with no error. Catastrophic, invisible, and no `NaN` guard is specified anywhere.
5. **B8 — protected-flexible has no "has been placed" bit.** §2.4 lists the same task as both anchor (step 1) and candidate (step 2), resolved only by the parenthetical "(post-placement)" — and **no field in §1.1 can express it**. Whichever branch is coded, one of the two spec sentences is violated on every Re-optimize.
6. **B29 — the ghost enters `tasks[]`.** `clone()` keeps the **same id** and the frontend's easiest render path is to push it into the array. Result: duplicate ids in serialized state, and §9's import either dedupes or duplicates. A one-line render shortcut that corrupts the save file.
7. **B23 — `duplicate()` copies `parentId`.** The method's field list was written thinking about recurrence, not projects; `parentId` fell through by omission. Conservation is violated invisibly — five buckets, a 480-minute budget, and nothing reconciles them.
8. **B33 / B34 — guilt by negative space and by loop.** `<Perch>{allDone && <Seagull/>}</Perch>` and `if (count >= 25) toast()` are both the two-second implementation and both violate P-1 without anyone deciding to. P-1 is the project's stated first principle and it will be breached by convenience, not intent.
9. **B36 — Enter/Esc overloaded on the conflict chooser.** The "always-shown inline chooser" appears after a completed keyboard drop and re-binds both keys the drag just used. Focus management on a non-modal is the thing everyone skips, and this is the highest-traffic keyboard path in the app.
10. **B9 — zone filtered before deadline.** Filtering candidate slots by zone before deadline is the natural loop order and inverts §2.2's stated precedence — turning a task that fits perfectly into a coral "won't fit". Wrong answer *and* a P-1-adjacent false alarm.

**Honourable mentions:** B25 (parity from `effectiveFrom` instead of `anchorDate` — silently shifts every future occurrence by a week); B21 (lifetime `history` counters never reset, so the starvation detector fires forever on the same task); B30 (`Invalid Date` → `getDuration()` returns `NaN`, not 0, because the guard checks `null` — one bad record zeroes the whole week's load meter).
