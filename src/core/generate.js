// generate.js — turn "20 hours of coursework by the 3rd" into actual sittings.
//
// This is design/WEEKLY-PLANNING.md §4.1.1, decided 2026-08-12 after seven
// candidates were written down and evaluated twice. **Six lost. Do not rebuild
// from the candidate list — this is the one.** §4.1.2 adds the ordering.
//
// The property that made candidate 5 win, and the one to protect above all:
// **sittings are GAP-SHAPED.** Each takes the length of the gap it was chosen
// for rather than a computed size, so the placer cannot undo the plan — step 6
// bounds each sitting to a single day (`from === to`, the DATES-P1 idiom) and
// the day already has room for it by construction.
//
// ⚠️ §4.1.1 step 4 previously read "s ← A / n, EQUALISE, do not skip this line".
// That was CORRECTED and is wrong: equalising re-imports the disease candidate 5
// does not have. A = 5h with gaps 4h/1h/1h picks n = 2, and equalising gives two
// sittings of 2h30 — on a day whose longest run is one hour. Do not add it back.
//
// No invented constants. `s_min`/`s_max`/`maxPerDay` are the user's own words
// and the rest is arithmetic over their own calendar — P-2 forbids the app
// asserting a number it has not earned, and `learnedCapacity()` is still null.

import { addDays, dayStart, addMinutes, minutesBetween, dateKey } from './time.js';
import { computeWindows, intervalsOf, placeTask, recurrenceIntervals, subtractIntervals, dayCapacityMin } from './placement.js';
import { breakMinForFill } from './gaps.js';
import { Task } from './Task.js';
import { loadForTask, energyBudget, LOAD_AXES } from './energy.js';

/**
 * Step 1 — R*, the period ending one fifth of the runway early.
 *
 * The buffer is §4.4's, and it is a fifth of the RUNWAY rather than of the
 * task's own length: that correction was made in session 7 after a probe showed
 * the length-based version scoring a 20-minute task identically at Monday 17:00
 * and Friday 16:45. Finishing early has to mean something relative to the time
 * you had.
 */
export function runwayEnd(from, until) {
  const runway = until.getTime() - from.getTime();
  if (runway <= 0) return new Date(until.getTime());
  return new Date(until.getTime() - runway / 5);
}

/** A commitment's own admissible minutes inside R* — the Ω of §4.1.2's ρ. */
export function openMinutesFor(schedule, probe, from, to, occupied, after = null) {
  let total = 0;
  for (const day of eachDay(from, to)) {
    // `after` matters here too: rho is A / Ω, and counting hours that have
    // already gone as "open" understates how constrained a commitment is —
    // exactly backwards, since a half-spent week is MORE constrained.
    for (const g of gapsOnDay(schedule, probe, day, occupied, after)) total += g.minutes;
  }
  return total;
}

function eachDay(from, to) {
  const out = [];
  let d = dayStart(from);
  const last = dayStart(to);
  while (d.getTime() <= last.getTime()) { out.push(d); d = addDays(d, 1); }
  return out;
}

/**
 * Step 2 — the REAL open runs on one day, for THIS commitment.
 *
 * `computeWindows` is the door: it already subtracts zones (symmetrically),
 * blocked days, the deadline and the sleep guard, so a gap that comes back here
 * is one the placer will accept. That is why the plan survives step 6.
 *
 * ⚠️ Ω is per (task, day), never per day (§4.1.2). The same fortnight is 101h30
 * open to a study task and 33h30 to a work one, because a zone routes matching
 * tags IN and carves itself out for everyone else. Two commitments' numbers are
 * not comparable as percentages of one week.
 */
export function gapsOnDay(schedule, probe, date, occupied = [], after = null) {
  const windows = computeWindows(schedule, probe, date);
  if (!windows.length) return [];
  const capacity = dayCapacityMin(schedule.config, date) || 1;
  const dayOcc = occupied.filter((iv) => iv.end > windows[0].start && iv.start < windows[windows.length - 1].end);
  const occMin = dayOcc.reduce((n, iv) => n + Math.max(0, minutesBetween(iv.start, iv.end)), 0);
  const breakMin = breakMinForFill(Math.min(1, occMin / capacity), schedule.config);

  // ⚠️ NOT `walkGaps`. That is a slot GENERATOR — it returns candidate slots of
  // exactly `durationMin`, so asking it for "1 minute" yields one-minute slots,
  // not the free runs. Step 2 needs the runs themselves, because step 4 gives
  // each sitting its own gap's LENGTH.
  const free = subtractIntervals(windows, dayOcc);
  const out = [];
  for (const run of free) {
    // Break padding, but only where the run actually abuts a task — the window
    // edge is not something you need a breather after. This mirrors what
    // `walkGaps` does internally, so a run reported here is one the placer will
    // still accept at step 6.
    let { start, end } = run;
    if (breakMin > 0) {
      if (dayOcc.some((iv) => Math.abs(iv.end.getTime() - start.getTime()) < 60000)) start = addMinutes(start, breakMin);
      if (dayOcc.some((iv) => Math.abs(iv.start.getTime() - end.getTime()) < 60000)) end = addMinutes(end, -breakMin);
    }
    // ⚠️ HOURS THAT HAVE GONE ARE NOT OPEN TIME. `after` floors today's runs at
    // the clock. Without it this function reported today's window from its
    // 08:00 opening however late it already was, and a plan built at noon on
    // Wednesday booked a three-hour sitting at 10:30 THAT MORNING — 90 minutes
    // into the past. Same defect `redistribute` was fixed for (it floors at
    // `now`, not `dayStart(now)`), and the same one the use-case run found in
    // `placeTask`'s parking branch. Found by probe-commitment-cases.mjs A3/A4.
    if (after && start.getTime() < after.getTime()) start = new Date(after.getTime());
    const minutes = minutesBetween(start, end);
    if (minutes > 0 && start.getTime() < end.getTime()) out.push({ date, start, end, minutes });
  }
  return out;
}

/**
 * Steps 3–4 — how many sittings, and how long each is.
 *
 * Longest gaps first, never below `sMin`, never more than `maxPerDay` on one
 * day. The LAST sitting is the remainder, not a share: that is what keeps a
 * 45-minute amount at `1 × 45m` instead of booking a four-hour block, which is
 * the failure that eliminated candidates 2, 4, 6 and 7.
 */
export function chooseSittings(gaps, amountMin, { sMin, sMax, maxPerDay = Infinity }) {
  const usable = gaps
    .map((g) => ({ ...g, minutes: Math.min(g.minutes, sMax) }))
    .filter((g) => g.minutes >= sMin)
    .sort((a, b) => b.minutes - a.minutes || a.start - b.start);

  const perDay = new Map();
  const picked = [];
  for (const g of usable) {
    const k = dateKey(g.date);
    const used = perDay.get(k) || 0;
    if (used >= maxPerDay) continue;
    perDay.set(k, used + 1);
    picked.push(g);
    if (picked.reduce((n, x) => n + x.minutes, 0) >= amountMin) break;
  }
  if (!picked.length) return { sittings: [], shortfall: amountMin };

  // Step 4, re-derived if the tail will not fit.
  for (let n = picked.length; n >= 1; n -= 1) {
    const chosen = picked.slice(0, n);
    const head = chosen.slice(0, -1);
    const headTotal = head.reduce((acc, g) => acc + g.minutes, 0);
    let tail = amountMin - headTotal;

    if (tail >= sMin) {
      const last = chosen[chosen.length - 1];
      const sittings = head.map((g) => ({ gap: g, minutes: g.minutes }));
      sittings.push({ gap: last, minutes: Math.min(tail, last.minutes, sMax) });
      const got = sittings.reduce((acc, x) => acc + x.minutes, 0);
      return { sittings, shortfall: Math.max(0, amountMin - got) };
    }
    // The remainder is below the minimum: fold it back into the previous
    // sitting if that one has room, otherwise drop a sitting and try again.
    if (head.length) {
      const prev = head[head.length - 1];
      const room = Math.min(prev.gap ? prev.gap.minutes : prev.minutes, sMax) - prev.minutes;
      if (room >= tail && tail > 0) {
        const sittings = head.map((g, i) => ({ gap: g, minutes: g.minutes + (i === head.length - 1 ? tail : 0) }));
        const got = sittings.reduce((acc, x) => acc + x.minutes, 0);
        return { sittings, shortfall: Math.max(0, amountMin - got) };
      }
    }
    if (n === 1) {
      const only = chosen[0];
      const minutes = Math.min(Math.max(amountMin, sMin), only.minutes, sMax);
      return { sittings: [{ gap: only, minutes }], shortfall: Math.max(0, amountMin - minutes) };
    }
    tail = 0; // fall through to a smaller n
  }
  return { sittings: [], shortfall: amountMin };
}

/**
 * Step 5's energy preference.
 *
 * Added after a probe found the shipped placer putting 80% of a 20-hour project
 * onto the four mentally heaviest days of a fortnight whose time occupancy was
 * identical everywhere — `balance` counts MINUTES, so a day holding two hours of
 * the hardest work you do reads as 83% empty.
 *
 * Gated: a commitment with no load has no opinion, because the app may not
 * invent one (P-2). Spending seeks the least-depleted day, restoring the most.
 */
function energyRank(schedule, probe, date) {
  const load = loadForTask(schedule, probe);
  const axis = LOAD_AXES.reduce((best, a) => (Math.abs(load[a]) > Math.abs(load[best]) ? a : best), LOAD_AXES[0]);
  if (!load[axis]) return 0; // no load, no opinion
  const low = energyBudget(schedule, date)[axis].low; // ≤ 0, deeper = more spent
  return load[axis] > 0 ? low : -low;
}

/**
 * Step 5 — spread `n` sittings EVENLY across the days that can hold them.
 *
 * Not the earliest n days. This is the whole finding: **burnout is clustering,
 * not sitting length.** 5 × 4h taken greedily lands on five consecutive
 * evenings, and shortening the sitting to "fix" that produces NINE consecutive
 * evenings; the same 5 × 4h on alternate days gives a streak of one.
 *
 * `taken` carries the days another commitment already claimed (§4.1.2) and this
 * commitment's sittings from the previous period, so three commitments do not
 * all aim at day 0, day 2, day 4.
 */
export function spreadDays(candidates, n, { taken = new Set(), rank = () => 0 } = {}) {
  const free = candidates.filter((d) => !taken.has(dateKey(d)));
  const pool = free.length >= n ? free : candidates;
  if (n >= pool.length) return pool.slice(0, n);

  const chosen = [];
  const step = (pool.length - 1) / Math.max(1, n - 1);
  for (let i = 0; i < n; i += 1) {
    const ideal = n === 1 ? (pool.length - 1) / 2 : i * step;
    // Nearest unused day to the even position, energy breaking ties.
    let best = null;
    let bestScore = Infinity;
    pool.forEach((d, idx) => {
      if (chosen.includes(d)) return;
      const distance = Math.abs(idx - ideal);
      const s = distance - rank(d) * 0.25; // energy nudges, never overrides
      if (s < bestScore) { bestScore = s; best = d; }
    });
    if (best) chosen.push(best);
  }
  return chosen.sort((a, b) => a - b);
}

/**
 * The whole of §4.1.1 for ONE commitment, placed into the schedule.
 *
 * @returns {{ sittings: Task[], shortfall: number, days: string[] }}
 */
export function generateSittings(schedule, commitment, opts = {}) {
  const now = opts.now || new Date();
  const occupied = opts.occupied || baseOccupied(schedule, dayStart(commitment.from), commitment.until);
  const from = new Date(Math.max(dayStart(commitment.from).getTime(), dayStart(now).getTime()));
  const rEnd = runwayEnd(from, commitment.until);
  const probe = probeTask(commitment, from);

  const days = eachDay(from, rEnd);
  const gaps = days.flatMap((d) => gapsOnDay(schedule, probe, d, occupied, now));
  const sMin = commitment.minSitting;
  const sMax = commitment.maxSitting;
  const bounds = { sMin, sMax, maxPerDay: commitment.maxPerDay };
  let plan = chooseSittings(gaps, commitment.amountMin, bounds);
  let usable = gaps;

  // ⚠️ R* IS A PREFERENCE, NOT A WALL — decided 2026-08-16 (PLAN D-10).
  //
  // §4.4 argues the finish-early buffer is a preference, and `scoring.js`
  // already applies it (`bufferScore`, with `runwayStart`). Truncating the
  // CANDIDATE DAYS at R* applied it a SECOND time, as physics. For a Mon–Sun
  // week the wall lands on Saturday, because runwayEnd(Mon, next Mon) is
  // Sat 14:24 — so SUNDAY WAS NEVER OFFERED AT ALL.
  //
  // Measured: a week whose only real space was the weekend reported
  // "540/600m short 60m" with Sunday holding a free 840m run, and 47 of 3000
  // fuzzed weeks lost minutes this way — every single one a Sunday. For a
  // student, the weekend is exactly where the long runs live (§4.5).
  //
  // So: prefer R*, but never MANUFACTURE a shortfall with it. Re-plan over the
  // whole window only when the buffered one falls short, and keep the wider
  // plan only if it is strictly better. A week that already fits is untouched,
  // so finishing early is preserved wherever the week can afford it — and
  // §4.3's shortfall goes back to meaning "the week had no room" rather than
  // "the buffer ate the day that did".
  if (plan.shortfall > 0) {
    const wide = eachDay(from, addMinutes(commitment.until, -1))
      .flatMap((d) => gapsOnDay(schedule, probe, d, occupied, now));
    const retry = chooseSittings(wide, commitment.amountMin, bounds);
    if (retry.shortfall < plan.shortfall) { plan = retry; usable = wide; }
  }
  if (!plan.sittings.length) return { sittings: [], shortfall: commitment.amountMin, days: [] };

  // Step 5: re-home the chosen sittings onto an evenly spread set of days.
  const dayCandidates = uniqueDays(usable.filter((g) => g.minutes >= sMin));
  const spread = spreadDays(dayCandidates, plan.sittings.length, {
    taken: opts.taken || new Set(),
    rank: (d) => energyRank(schedule, probe, d),
  });

  // ⚠️ Sittings are DESCENDING by minutes; `spread` is ASCENDING by date. They
  // used to be paired POSITIONALLY (`spread[i]`), which handed the longest
  // sitting the earliest candidate day whatever that day's longest free run
  // actually was — so a 3h sitting was re-homed onto a day whose longest run
  // was one hour, `placeTask` fell through to its last-resort park, and the app
  // reported "240/240m short 0m" with a sitting sitting on top of an eight-hour
  // booking. In a 2000-week fuzz, 68 of 77 parked sittings were this.
  //
  // It also falsified this module's own header ("the day already has room for
  // it by construction") and broke `maxPerDay`: when `spread` came back shorter
  // than the sitting list, `|| sit.gap.date` refilled the tail from the
  // original gaps and the per-day counter `chooseSittings` had maintained was
  // never re-checked. Safe at maxPerDay 1 by luck (picked days are distinct);
  // broken from 2 up.
  //
  // So days are now matched by CAPACITY, in spread order, with the per-day
  // count enforced. A sitting that no day can hold is dropped into the
  // shortfall rather than parked on top of something — §4.3 says state it.
  const longestRun = new Map();
  for (const g of usable) {
    const k = dateKey(g.date);
    longestRun.set(k, Math.max(longestRun.get(k) || 0, g.minutes));
  }
  const perDay = new Map();
  const dayCap = commitment.maxPerDay ?? Infinity;
  const hasRoom = (d, mins) => {
    const k = dateKey(d);
    return (perDay.get(k) || 0) < dayCap && (longestRun.get(k) || 0) >= mins;
  };
  const claim = (d) => { const k = dateKey(d); perDay.set(k, (perDay.get(k) || 0) + 1); return d; };
  const pool = [...spread];
  // Candidate days the spread did not pick. ⚠️ The spread is a PREFERENCE for
  // which days, not a shortlist of the only legal ones — running out of it is
  // no reason to report a shortfall while a day with room sits idle. Without
  // this, 6 of 3000 fuzzed weeks silently lost a sitting: one week dropped 160m
  // while Tuesday held a free 175m run and no sittings at all. That was a
  // regression introduced BY the capacity-matching fix above.
  const rest = dayCandidates.filter((d) => !spread.includes(d));
  const dayFor = (sit) => {
    let i = pool.findIndex((d) => hasRoom(d, sit.minutes));
    if (i >= 0) return claim(pool.splice(i, 1)[0]);
    // Nothing left in the spread can hold it. Its OWN gap's day fits by
    // construction — take that if the day still has room under maxPerDay.
    if (hasRoom(sit.gap.date, sit.minutes)) return claim(sit.gap.date);
    // Last resort before giving up the minutes: any candidate day with room.
    i = rest.findIndex((d) => hasRoom(d, sit.minutes));
    if (i >= 0) return claim(rest.splice(i, 1)[0]);
    return null;
  };

  const made = [];
  const usedDays = [];
  let dropped = 0;
  plan.sittings.forEach((sit) => {
    const day = dayFor(sit);
    if (!day) { dropped += sit.minutes; return; }
    const child = new Task({
      title: commitment.title,
      tags: [...(commitment.tags || [])],
      type: 'flexible',
      priority: commitment.priority ?? 3,
      parentId: commitment.id || null,
      startTime: day,
      endTime: addMinutes(day, sit.minutes),
      deadline: commitment.until,
      ...(commitment.load ? { load: commitment.load } : {}),
    });
    // Step 6: `from === to` bounds the scored search to that one day, so the
    // placer chooses WHERE in the day and the generator keeps WHICH day.
    //
    // `from` is floored at `now` for TODAY. Step 2 already refuses to offer a
    // gap that has gone, but `placeTask` searches from the `from` it is handed
    // and would otherwise be free to pick 08:00 this morning — the past-placement
    // floor is only ever as good as the `from` given to it, which is the exact
    // wording of the bug already fixed in `redistribute`.
    const searchFrom = day.getTime() < now.getTime() ? now : day;
    const res = placeTask(schedule, child, { from: searchFrom, to: day, occupied });
    if (res && res.warning) child.schedulingWarning = true;
    schedule.tasks.push(child);
    occupied.push({ start: child.startTime, end: child.endTime, task: child });
    usedDays.push(dateKey(child.startTime));
    made.push(child);
  });

  // Anything no day could hold joins the shortfall, so conservation still
  // holds: placed + shortfall === amount (§4.3).
  return { sittings: made, shortfall: plan.shortfall + dropped, days: usedDays };
}

/**
 * §4.1.2 — several commitments, in `ρ` descending order.
 *
 * ρ = A / Ω, the amount owed over the open time inside its OWN R*. It combines
 * the two things that make something hard to place: a bigger amount raises the
 * numerator, a nearer deadline shrinks the denominator. Priority breaks ties
 * only — ordering decides who picks days first, not who gets good days — and
 * title breaks the rest, so replanning an untouched week is idempotent.
 *
 * Sequential, because independent spreading makes every commitment aim at the
 * same day indices — the identical "no sibling awareness" flaw the engine
 * evaluation found in `scoring.js`, relocated into the generator.
 */
export function generateAll(schedule, commitments, opts = {}) {
  const now = opts.now || new Date();
  const scored = commitments.map((c) => {
    const from = new Date(Math.max(dayStart(c.from).getTime(), dayStart(now).getTime()));
    const probe = probeTask(c, from);
    const omega = openMinutesFor(schedule, probe, from, runwayEnd(from, c.until), baseOccupied(schedule, dayStart(c.from), c.until), now);
    return { c, rho: omega > 0 ? c.amountMin / omega : Infinity };
  });
  scored.sort((a, b) => b.rho - a.rho
    || (b.c.priority ?? 3) - (a.c.priority ?? 3)
    || String(a.c.title).localeCompare(String(b.c.title)));

  // ⚠️ The SHARED occupied set must span every commitment being planned, and
  // this line is the one that was broken: it passed `null`, which fell back to
  // the UNIX epoch, so `recurrenceIntervals` expanded 1970 and came back empty.
  // Every commitment then planned against a week with no gym and no classes in
  // it. Derive the real span instead — earliest start (floored at today, since
  // nothing is placed before now anyway) to latest end.
  const spanFrom = new Date(Math.min(...commitments.map((c) => dayStart(c.from).getTime())));
  const spanTo = new Date(Math.max(...commitments.map((c) => c.until.getTime())));
  const occupied = baseOccupied(schedule, spanFrom, spanTo);
  const taken = new Set();
  const out = [];
  for (const { c, rho } of scored) {
    const r = generateSittings(schedule, c, { ...opts, now, occupied, taken });
    for (const k of r.days) taken.add(k);
    out.push({ commitment: c, rho, ...r });
  }
  return out;
}

/** A stand-in task carrying the commitment's tags, so zones route it correctly. */
function probeTask(commitment, from) {
  return new Task({
    title: commitment.title,
    tags: [...(commitment.tags || [])],
    type: 'flexible',
    startTime: from,
    endTime: addMinutes(from, commitment.minSitting || 30),
    deadline: commitment.until,
    ...(commitment.load ? { load: commitment.load } : {}),
  });
}

/**
 * Everything already in the day: real tasks plus recurrence occurrences, which
 * are anchors (§4.4) — filtering `!t.recurrence` alone drops them (sharp #3).
 *
 * ⚠️ TAKES AN EXPLICIT RANGE, and that is the whole fix for a severe defect.
 * It used to accept a nullable commitment and fall back to
 * `from = new Date(0)`, `to = addDays(new Date(), 90)` when given none — which
 * is exactly what `generateAll` did. `recurrenceIntervals` walks weeks forward
 * from `weekStart(from)` under a 60-week guard, so starting at the UNIX EPOCH
 * it expanded 1970 and returned NOTHING for the week being planned.
 *
 * `generateAll` then handed that empty set to every commitment, so the button
 * scheduled straight through pinned recurring gyms and classes. Measured: a
 * recurring Mon/Wed/Sat 08:00–17:00 block, and 3 of 4 sittings laid on top of
 * it. `generateSittings` called alone was fine, because it passed a real
 * commitment — so the only broken path was the one the UI actually uses.
 *
 * Sharp edge #3, reintroduced. The fallback also read the wall clock inside the
 * engine (sharp edge #8). A nullable argument with a silent default was the
 * mechanism for both; there is no default now.
 */
function baseOccupied(schedule, from, to) {
  return intervalsOf(schedule.tasks.filter((t) => !t.chunking && !t.recurrence))
    .concat(recurrenceIntervals(schedule, from, to));
}

function uniqueDays(gaps) {
  const seen = new Map();
  for (const g of gaps) seen.set(dateKey(g.date), g.date);
  return [...seen.values()].sort((a, b) => a - b);
}
