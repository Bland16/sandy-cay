// Scenario harness — turns a declarative scenario into a run.
//
// The blind agents generate SCENARIOS; this file EXECUTES them. Nothing here
// decides whether a scenario passes: it prints what actually happened and the
// numbers a human (or the scenario's own "what would reveal a defect") can judge.
//
// Real schedule data may be passed in as a fixture. It must NEVER be committed —
// design/import/ and *.ics are gitignored because this repo is public and a real
// week carries other people's names. Anonymise (titles -> "Class A") before any
// scenario built from real data goes into the tree.
import { Schedule } from '../../src/core/Schedule.js';
import { Task } from '../../src/core/Task.js';
import { energyTrajectory, loadForTask } from '../../src/core/energy.js';
import { placeTask } from '../../src/core/placement.js';

const AXES = ['mental', 'physical', 'social', 'creative'];
const DAY = 86400000;
const mag = (a) => Math.sqrt(AXES.reduce((n, k) => n + a[k] * a[k], 0));
const dominant = (L) => AXES.reduce((b, a) => (L[a] > L[b] ? a : b), AXES[0]);

/**
 * @param {object} sc scenario
 *   sc.start        Date — day 0
 *   sc.days         int  — length of the runway
 *   sc.config       partial config override (e.g. { windows: {...} })
 *   sc.buckets      [{ label, tags, load }]
 *   sc.zones        [{ label, matchTags, windows, exclusive }]
 *   sc.fixed        [{ day, start:'HH:MM', end:'HH:MM', title, tags, recurrence? }]
 *   sc.commitments  [{ id, amountMin, sMin, sMax, maxPerDay, tags, dueDay }]
 *   sc.sitHour      int — nominal sit-down hour used to score a day (default 13)
 */
export function buildSchedule(sc) {
  const s = new Schedule(sc.config ? { config: sc.config } : {});
  for (const b of sc.buckets || []) s.addBucket(b);
  for (const z of sc.zones || []) s.addZone(z);
  for (const f of sc.fixed || []) {
    const d = new Date(sc.start.getTime() + f.day * DAY);
    const [sh, sm] = f.start.split(':').map(Number);
    const [eh, em] = f.end.split(':').map(Number);
    s.addFixed({
      title: f.title || `Fixed ${f.day}`,
      tags: f.tags || [],
      startTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), sh, sm),
      endTime: new Date(d.getFullYear(), d.getMonth(), d.getDate(), eh, em),
      ...(f.recurrence ? { recurrence: f.recurrence } : {}),
    });
  }
  return s;
}

const dayOf = (sc, n) => new Date(sc.start.getTime() + n * DAY);

function reserveBefore(s, sc, d, axis) {
  const pts = energyTrajectory(s, dayOf(sc, d)).points
    .filter((p) => p.at && p.at.getHours() < (sc.sitHour ?? 13));
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
}
function dipAfter(s, sc, d, proto, minutes) {
  const base = dayOf(sc, d);
  const h = sc.sitHour ?? 13;
  const st = new Date(base.getFullYear(), base.getMonth(), base.getDate(), h, 0);
  const t = new Task({ ...proto, startTime: st, endTime: new Date(st.getTime() + minutes * 60000) });
  s.tasks.push(t);
  const low = energyTrajectory(s, dayOf(sc, d)).low;
  s.tasks.pop();
  return low;
}

/** Gap runs available to `proto` on day d, longest first. */
function longestRun(s, sc, d, proto) {
  const slots = s.findFreeSlots({
    from: dayOf(sc, d),
    to: dayOf(sc, d),
    durationMin: 15,
  });
  // findFreeSlots returns fixed-length slots; merge adjacent to recover runs.
  let best = 0, runStart = null, runEnd = null;
  for (const sl of slots) {
    if (runEnd && sl.start.getTime() <= runEnd.getTime()) runEnd = new Date(Math.max(runEnd, sl.end));
    else { if (runStart) best = Math.max(best, (runEnd - runStart) / 60000); runStart = sl.start; runEnd = sl.end; }
  }
  if (runStart) best = Math.max(best, (runEnd - runStart) / 60000);
  return best;
}

/** Size the sittings: gap-shaped, last takes the remainder (WEEKLY-PLANNING 4.1.1). */
function sizeSittings(s, sc, c, proto) {
  const runs = [];
  for (let d = 0; d < sc.days; d++) runs.push({ d, run: Math.min(longestRun(s, sc, d, proto), c.sMax) });
  runs.sort((a, b) => b.run - a.run);
  const sizes = [];
  let left = c.amountMin;
  for (const r of runs) {
    if (left <= 0) break;
    if (r.run < c.sMin) continue;
    const take = Math.min(r.run, left);
    sizes.push(take);
    left -= take;
  }
  // fold a sub-minimum tail into the previous sitting
  if (sizes.length > 1 && sizes[sizes.length - 1] < c.sMin) {
    const tail = sizes.pop();
    sizes[sizes.length - 1] = Math.min(sizes[sizes.length - 1] + tail, c.sMax);
  }
  return { sizes, shortfall: Math.max(0, left) };
}

/**
 * Run one commitment with a given rule.
 * rule: { energy: 'reserve'|'depth'|'none', spacing: bool }
 */
export function planCommitment(s, sc, c, rule) {
  const proto = { title: c.id, tags: c.tags || [], type: 'flexible' };
  const probe = new Task({ ...proto, startTime: sc.start, endTime: new Date(sc.start.getTime() + 3600000) });
  const L = loadForTask(s, probe);
  const axis = dominant(L);
  const hasLoad = mag(L) > 0;
  const { sizes, shortfall } = sizeSittings(s, sc, c, proto);

  const chosen = [];
  const perDay = new Map();
  for (const size of sizes) {
    const avail = [];
    for (let d = 0; d <= (c.dueDay ?? sc.days - 1); d++) {
      const used = perDay.get(d) || 0;
      if (used >= (c.maxPerDay ?? 1)) continue;
      if (longestRun(s, sc, d, proto) < size) continue;
      avail.push(d);
    }
    if (!avail.length) break;
    const worstAfter = Math.max(...avail.map((d) => Math.abs(dipAfter(s, sc, d, proto, size)[axis])), 1);
    const worstRes = Math.max(...avail.map((d) => Math.abs(reserveBefore(s, sc, d, axis))), 1);
    let best = null;
    for (const d of avail) {
      let energy = 0;
      if (hasLoad && rule.energy === 'reserve') energy = 1 - Math.abs(reserveBefore(s, sc, d, axis)) / worstRes;
      else if (hasLoad && rule.energy === 'depth') energy = 1 - Math.abs(dipAfter(s, sc, d, proto, size)[axis]) / worstAfter;
      const gaps = chosen.map((x) => Math.abs(x - d));
      const space = rule.spacing ? (gaps.length ? Math.min(...gaps) : sc.days) / sc.days : 0;
      const sc2 = energy + space;
      if (!best || sc2 > best.sc + 1e-9) best = { d, sc: sc2 };
    }
    const base = dayOf(sc, best.d);
    const t = new Task({ ...proto, startTime: base, endTime: new Date(base.getTime() + size * 60000) });
    placeTask(s, t, { from: base, to: base });
    t.placedBy = 'auto';
    s.tasks.push(t);
    chosen.push(best.d);
    perDay.set(best.d, (perDay.get(best.d) || 0) + 1);
  }
  return { id: c.id, days: [...chosen].sort((a, b) => a - b), sizes, shortfall, hasLoad, axis };
}

export function streakOf(days) {
  const idx = [...days].sort((a, b) => a - b);
  let st = idx.length ? 1 : 0, run = 1;
  for (let i = 1; i < idx.length; i++) { run = idx[i] === idx[i - 1] + 1 ? run + 1 : 1; if (run > st) st = run; }
  return st;
}

/** Run a whole scenario under one rule. Commitments generate in rho order. */
export function runScenario(sc, rule) {
  const s = buildSchedule(sc);
  const list = [...(sc.commitments || [])];
  // rho = amount / open time available to THIS commitment (per task, never per day)
  const rho = (c) => {
    const proto = { title: c.id, tags: c.tags || [], type: 'flexible' };
    let open = 0;
    for (let d = 0; d <= (c.dueDay ?? sc.days - 1); d++) open += longestRun(s, sc, d, proto);
    return open > 0 ? c.amountMin / open : Infinity;
  };
  list.sort((a, b) => (rho(b) - rho(a)) || ((b.priority ?? 3) - (a.priority ?? 3)) || a.id.localeCompare(b.id));
  const results = list.map((c) => planCommitment(s, sc, c, rule));

  const dips = [];
  for (let d = 0; d < sc.days; d++) dips.push(energyTrajectory(s, dayOf(sc, d)).low);
  return { schedule: s, results, dips, order: list.map((c) => c.id) };
}

export function report(name, sc, rule) {
  const { results, dips, order } = runScenario(sc, rule);
  console.log(`\n--- ${name}  [${rule.energy}${rule.spacing ? '+spacing' : ''}]  generation order: ${order.join(' → ')}`);
  for (const r of results) {
    console.log(`    ${r.id.padEnd(14)} days=[${r.days.join(',')}]  sizes=[${r.sizes.join(',')}]  streak=${streakOf(r.days)}` +
      `${r.shortfall ? `  SHORTFALL=${r.shortfall}m` : ''}${r.hasLoad ? '' : '  (no load — spacing only)'}`);
  }
  console.log(`    deepest mental dip/day: ${dips.map((x) => x.mental.toFixed(1)).join(' ')}`);
}
