# Spec comb — does the code match what the docs claim?

**Session 6, 2026-08-11.** Method: read the claim, then **check it against the
code or prove it with a probe**. Nothing here is reasoned from the spec alone —
that method scored 3-of-5 and 1-of-2 in the blind passes, against 6-of-6 for the
code-grounded audit (HANDOFF, "Audit passes").

**Everything is pushed.** `main` == `origin/main` at `6360864`; the P1 work is on
`origin/dates-and-recurrence`. No local-only commits, no unpushed branches.

| # | Claim | Verdict | Cost to close |
|---|---|---|---|
| 1 | `recurrence.js` handles an `add` exception | **BUG, proven** | small |
| 2 | SPEC §4.3 — "one shared window-row component used by zones and recurrence" | **FALSE** | medium, or delete the claim |
| 3 | SPEC §231 — the colour palette | **FICTION** | tiny (bookkeeping) |
| 4 | SPEC §10 — keyboard drag/resize | **NOT BUILT** | large |
| 5 | Retention policy for `history` / `occurrenceData` / `snapshots` / `dismissed` | **NOT BUILT** | medium |
| 6 | Chunk ops reachable from the UI | **UNREACHABLE** — 6 engine functions, 0 UI callers | product call |
| 7 | `time.js` isoWeek comment | **WRONG, and now diagnosed** | fixed here |
| 8 | UI-CONTROL-MAP 5A / 4D | **STALE as of P1** | fixed here |
| 9 | PWA service worker | **wired, unverified** | needs a browser |
| 10 | Export → Google | **built, never run** | needs the real account |

---

## 1. `recurrence.js` drops an extra session on a day the pattern already fills

**Proven by probe**, not read. A Tuesday pattern, plus an `add` exception for an
extra Tuesday evening session:

```
A) extra session on a FREE day (Thu):
   expected 2 (Tue 07:00 + Thu 18:00) -> got 2 : Tue Sep 01 07:00 | Thu Sep 03 18:00
B) extra session on a day the pattern FILLS (Tue):
   expected 2 (Tue 07:00 + Tue 18:00) -> got 1 : Tue Sep 01 07:00
```

**Cause.** `emit()` dedupes on the identity `${task.id}@${key}`, and pass 2's
`add` branch reuses the *same* key as the pattern occurrence pass 1 already
emitted, so `seen.has(identity)` is true and it returns early
(`recurrence.js:62–70, 105–108`).

**Why it matters.** "One extra gym this week" is inexpressible on a day the
routine already runs — which is the *likely* day to want a second session. It
fails silently: no error, no warning, the session simply never appears.

**The fix is not just a different key.** §4.4 makes identity load-bearing —
one task = one identity = continuous ML history. An added session needs an
identity that is stable across re-renders, distinct from the pattern
occurrence, and still traceable to the parent. A suffix (`@2026-09-01#add`) is
the obvious candidate, but `occurrenceData` is keyed by date too, so lived data
for the extra session needs a home. **This needs a small decision, not just a
patch** — see D-6 below.

## 2. SPEC §4.3's shared window-row component does not exist

> **4.3 Editor:** one shared window-row component (day+start+end+remove) used by
> zones and recurrence.

`RecurrenceEditor.jsx` is imported by `AddTaskPanel` and `TaskPanel` only.
`ZonesEditor.jsx` builds its own `.winrow` markup inline (line 56ff) and never
imports it. So **the weekday affordance exists twice**, which is exactly how the
two drifted: the recurrence editor has `toWeekdayWindows` / `isWeekdayPattern`
and the Cabana has a separate "＋ every weekday" button.

This is already on the HANDOFF's list ("Extract the row for real, or delete the
claim"). **Left for the user to call** — it is a real refactor, and P2's monthly
work will touch this component anyway, so doing it *before* P2 avoids doing it
twice. That is an argument for now rather than later.

## 3. SPEC §231's palette is fiction

Not one of the `--color-*` names it defines exists in `styles.css` (grep count:
**0**), and the values differ:

| token | SPEC.md says | the app ships |
|---|---|---|
| bg / paper | `#F0F8FF` | `#F1E9D8` |
| primary | `#1A9BAB` | `#2E8C99` |
| cta | `#FFD166` | `#E8B94D` |
| warning | `#FF6B6B` | `#E2685F` |
| fixed | `#4ECDC4` | `#5FB8B0` |
| cab-accent | `#FFD166` | `#FFD166` ✓ |

The app was reskinned to the "hand-tinted film" palette (ported from
`design/layout-interactive.html`, per the `styles.css` header) and §231 was never
updated. Harmless today, actively misleading to anyone — human or agent — who
reads the spec to pick a colour. **Corrected in this pass** by pointing §231 at
`styles.css` as the source of truth rather than duplicating a list that will
drift again.

## 4–6. Genuinely not built

- **§10 keyboard drag/resize** (Space/arrows/Enter, Shift+↑↓, Alt+↑↓). The only
  key handling on a card is Enter/Space → open (`TaskCard.jsx:99`). The app is
  mouse-and-touch only. This is an **accessibility gap**, not just a missing
  feature.
- **Retention.** No `prune`/retention anywhere in `src/core`. `history`,
  `occurrenceData`, `snapshots` and `dismissed` all grow forever; the designed
  end state is localStorage exhaustion, and the starvation detector becomes a
  permanent nag (a P-1 violation) long before that.
- **Chunk ops.** `growChunk` / `shrinkChunk` / `resizeChunk` / `deleteChunk` /
  `finishProject` / `redistribute` are all exported from `projects.js` and have
  **zero** references in `src/ui` or `App.jsx`. Tested engine code with no way to
  reach it. This is the standing product call: build a surface or accept it as
  internal.

## 7–8. Fixed in this pass

- **`time.js` isoWeek comment.** It claimed "2027-01-01 is a Friday, so it
  belongs to 2026-W53, and 2026-12-28 is a Monday already in 2027-W01."
  Verified: 2027-01-01 → **2026-W53** ✓, but 2026-12-28 → **2026-W53**, not
  2027-W01. The two dates are in the *same* week, so the example contradicted
  itself. The function is correct; only the comment lied.
- **UI-CONTROL-MAP**, stale as of P1: **5A** ("task two weeks out") described the
  old workaround — navigate two weeks with `›` then add — which was the only way
  when the panel took a weekday. **4D** said "every 2nd week", now relabelled
  "every other week".

## 9–10. Built but unverified — needs the user, not the terminal

- **PWA.** `main.jsx:13` registers `sw.js` in PROD, so it *is* wired. Install and
  offline behaviour have never been exercised.
- **Export → Google.** `insertEvent` / `clearRange` / `taskToGoogleEvent` all
  exist and are tested in isolation. **Never run against the real account.**
  Note it *replaces* the target week, so the first real run wants a throwaway
  calendar.

---

## Open decisions

- **D-6.** The `add`-exception identity (§1). Suffix the id (`@date#add`) and
  give the extra session its own `occurrenceData` key, or model an extra session
  as something other than an exception? The suffix is smaller; the second is
  cleaner if extra sessions ever need to be more than one per day.
- **D-7.** Extract the shared window-row (§2) **before** P2 touches
  `RecurrenceEditor`, or delete SPEC §4.3's claim and accept two editors?
- **D-8.** Retention policy (§5): what is the horizon? Ratings feed learning, so
  cutting history costs model quality. A year of `occurrenceData` is a lot of
  rows but not a lot of bytes.

## What this comb did NOT cover

`USE-CASE-ANALYSIS.md` (75KB) was grepped for specific claims, **not** read end
to end, per the standing instruction. A full pass against its ~90 numbered cases
is the natural companion to the use-case exercise the user has planned next —
that is the right place to catch what this missed.
</content>
