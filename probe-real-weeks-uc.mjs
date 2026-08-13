// The blind use-case scenarios, run against the user's REAL weeks (anonymised:
// course codes, club names, locations and people's names stripped — this repo is
// public). Two shapes: a DENSE term week and a SPARSE early-term week.
//
// Where a scenario invented its own calendar, the QUESTION is posed against the
// real week instead. Scenarios that need a shape a real week cannot express
// (DST, past deadlines, six-month runways) or that test UI wording are listed as
// not-run rather than quietly skipped.
import { Schedule } from './src/core/Schedule.js';
import { Task } from './src/core/Task.js';
import { energyTrajectory, loadForTask } from './src/core/energy.js';
import { placeTask, sleepCutoff, computeWindows } from './src/core/placement.js';

const DAY = 86400000;
const AXES = ['mental', 'physical', 'social', 'creative'];
const dominant = (L) => AXES.reduce((b, a) => (Math.abs(L[a]) > Math.abs(L[b]) ? a : b), AXES[0]);

function mkWeek(spec) {
  const s = new Schedule({});
  s.addBucket({ label: 'Classes', tags: ['class'], color: '#E2685F', load: { mental: 3, physical: 0, social: 1, creative: 0 } });
  s.addBucket({ label: 'Clubs', tags: ['club'], color: '#8A5FA8', load: { mental: 1, physical: 0, social: 3, creative: 1 } });
  s.addBucket({ label: 'Rest', tags: ['rest'], color: '#A9B8D8', load: { mental: -2, physical: 1, social: 1, creative: 0 } });
  s.addBucket({ label: 'Study', tags: ['study'], color: '#C9A96E', load: { mental: 4, physical: 0, social: 0, creative: 0 } });
  for (const [d, sh, sm, eh, em, title, tags] of spec.events) {
    const day = new Date(spec.base.getTime() + d * DAY);
    s.addFixed({
      title, tags,
      startTime: new Date(day.getFullYear(), day.getMonth(), day.getDate(), sh, sm),
      endTime: new Date(day.getFullYear(), day.getMonth(), day.getDate(), eh, em),
    });
  }
  return s;
}

// ---------- DENSE term week (Sun-Sat) ----------
const DENSE = {
  name: 'DENSE term week', base: new Date(2026, 2, 8, 0, 0, 0, 0),
  events: [
    [0, 9, 0, 10, 30, 'Gym with a friend', ['rest']],
    [0, 11, 45, 15, 0, 'Focus block', ['club']],
    [1, 10, 0, 11, 15, 'Class A', ['class']], [1, 12, 0, 14, 30, 'Office hours', ['class']],
    [1, 14, 0, 14, 50, 'Class B', ['class']], [1, 19, 0, 20, 30, 'Club board', ['club']],
    [2, 9, 0, 10, 15, 'Class C', ['class']], [2, 10, 30, 11, 50, 'Class D lab', ['class']],
    [2, 13, 30, 14, 45, 'Class E', ['class']], [2, 17, 30, 19, 30, 'Club programme', ['club']],
    [2, 19, 30, 21, 0, 'Gym with a friend', ['rest']], [2, 21, 0, 22, 0, 'Tea', ['rest']],
    [3, 10, 0, 11, 15, 'Class A', ['class']], [3, 12, 15, 14, 0, 'Project meeting', ['club']],
    [3, 14, 0, 14, 50, 'Class B', ['class']], [3, 16, 30, 18, 50, 'Class F', ['class']],
    [3, 19, 30, 20, 30, 'Club build', ['club']], [3, 20, 0, 22, 30, 'Movie night', ['rest']],
    [4, 9, 0, 10, 15, 'Class C', ['class']], [4, 10, 30, 12, 20, 'Class D lab', ['class']],
    [4, 13, 30, 14, 45, 'Class E', ['class']], [4, 15, 30, 16, 30, 'Club meeting', ['club']],
    [4, 19, 30, 21, 0, 'Gym with a friend', ['rest']], [4, 21, 0, 22, 0, 'Tea', ['rest']],
    [5, 10, 0, 11, 50, 'Class A', ['class']], [5, 12, 0, 12, 50, 'Class G', ['class']],
    [5, 14, 0, 14, 50, 'Class B', ['class']], [5, 17, 0, 21, 0, 'Standing social evening', ['rest']],
  ],
};

// ---------- SPARSE early-term week ----------
const SPARSE = {
  name: 'SPARSE early-term week', base: new Date(2025, 8, 28, 0, 0, 0, 0),
  events: [
    [1, 10, 0, 11, 15, 'Class H', ['class']], [1, 12, 0, 12, 50, 'Class J', ['class']],
    [1, 13, 0, 13, 50, 'Class K', ['class']], [1, 14, 0, 16, 0, 'Workshop skills', ['class']],
    [1, 16, 0, 17, 0, 'Reflection', ['class']], [1, 20, 0, 22, 0, 'Club build night', ['club']],
    [2, 10, 30, 11, 50, 'Class L', ['class']], [2, 16, 30, 17, 30, 'Seminar', ['class']],
    [2, 20, 0, 21, 0, 'Club board', ['club']],
    [3, 12, 0, 12, 50, 'Class J', ['class']], [3, 13, 0, 13, 50, 'Class K', ['class']],
    [3, 14, 0, 15, 0, 'Workshop', ['class']], [3, 14, 30, 15, 30, 'Machine training', ['class']],
    [4, 9, 0, 10, 0, 'Appointment', []], [4, 10, 30, 11, 50, 'Class L', ['class']],
    [4, 13, 0, 13, 50, 'Class K', ['class']], [4, 16, 0, 17, 0, 'Class J', ['class']],
    [4, 18, 0, 19, 15, 'Class L lab', ['class']],
    [5, 10, 0, 11, 50, 'Class L lab', ['class']], [5, 12, 0, 12, 50, 'Class J', ['class']],
    [5, 13, 0, 13, 50, 'Class K', ['class']],
  ],
};

const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const reserveAt = (s, spec, d, hour, axis) => {
  const day = new Date(spec.base.getTime() + d * DAY);
  const pts = energyTrajectory(s, day).points.filter((p) => p.at && p.at.getHours() < hour);
  return pts.length ? pts[pts.length - 1].reserve[axis] : 0;
};

/** H5 + both fixes: gated, sign-flipped energy at sit-down + sibling spacing. */
function plan(s, spec, c) {
  const proto = { title: c.id, tags: c.tags, type: 'flexible' };
  const L = loadForTask(s, new Task({ ...proto, startTime: spec.base, endTime: new Date(spec.base.getTime() + 3600000) }));
  const axis = dominant(L);
  const hasLoad = AXES.some((a) => L[a] !== 0);
  const sign = Math.sign(L[axis]) || 1;
  const chosen = [];
  const out = [];
  for (let k = 0; k < c.n; k++) {
    const avail = [0, 1, 2, 3, 4, 5, 6].filter((d) => !chosen.includes(d));
    const worst = Math.max(...avail.map((d) => Math.abs(reserveAt(s, spec, d, c.hour ?? 13, axis))), 1);
    let best = null;
    for (const d of avail) {
      const depth = Math.abs(reserveAt(s, spec, d, c.hour ?? 13, axis)) / worst;
      const energy = !hasLoad ? 0 : (sign > 0 ? 1 - depth : depth);
      const gaps = chosen.map((x) => Math.abs(x - d));
      const space = (gaps.length ? Math.min(...gaps) : 7) / 7;
      const sc = energy + space;
      if (!best || sc > best.sc + 1e-9) best = { d, sc };
    }
    chosen.push(best.d);
    const day = new Date(spec.base.getTime() + best.d * DAY);
    const t = new Task({ ...proto, startTime: day, endTime: new Date(day.getTime() + c.mins * 60000) });
    const res = placeTask(s, t, { from: day, to: day });
    s.tasks.push(t);
    out.push({ d: best.d, t, warn: res.warning });
  }
  return { out, hasLoad, sign, axis };
}

const fmt = (t) => `${t.startTime.toTimeString().slice(0, 5)}–${t.endTime.toTimeString().slice(0, 5)}`;
const say = (id, verdict, msg) => console.log(`  ${id.padEnd(5)} ${verdict.padEnd(9)} ${msg}`);

for (const spec of [DENSE, SPARSE]) {
  console.log(`\n${'='.repeat(78)}\n${spec.name}\n${'='.repeat(78)}`);

  // shape
  const s0 = mkWeek(spec);
  console.log('  day    committed   mental dip   free 08:00-23:00');
  for (let d = 0; d < 7; d++) {
    const day = new Date(spec.base.getTime() + d * DAY);
    const tasks = s0.getTasksForDay(day).filter((t) => !t.chunking);
    const mins = tasks.reduce((n, t) => n + t.getDuration(), 0);
    const wins = computeWindows(s0, { tags: ['study'], deadline: null }, day);
    const free = wins.reduce((n, w) => n + (w.end - w.start) / 60000, 0) - mins;
    console.log(`  ${NAMES[d]}    ${String(mins).padStart(5)}m     ${energyTrajectory(s0, day).low.mental.toFixed(1).padStart(7)}      ~${String(Math.max(0, Math.round(free))).padStart(4)}m   res@13 ${reserveAt(s0, spec, d, 13, 'mental').toFixed(1).padStart(6)}   res@20 ${reserveAt(s0, spec, d, 20, 'mental').toFixed(1).padStart(6)}`);
  }

  console.log('\n  -- scenarios --');

  // A1 / N2: does it pick a fresh morning over a day whose weight lands later?
  {
    const s = mkWeek(spec);
    const { out } = plan(s, spec, { id: 'A', tags: ['study'], n: 3, mins: 120 });
    const dows = out.map((o) => `${NAMES[o.d]} ${fmt(o.t)}`);
    const late = out.filter((o) => o.t.startTime.getHours() >= 20).length;
    say('A1/N2', late === 0 ? 'PASS' : 'FLAG', `3x2h study -> ${dows.join(' | ')}${late ? `  (${late} after 20:00)` : ''}`);
  }

  // X6: is the sitting minimum satisfiable? 90-min minimum against real gaps.
  {
    const s = mkWeek(spec);
    let fits = 0;
    for (let d = 0; d < 7; d++) {
      const day = new Date(spec.base.getTime() + d * DAY);
      const slots = s.findFreeSlots({ from: day, to: day, durationMin: 90 });
      if (slots.length) fits++;
    }
    say('X6', fits >= 3 ? 'PASS' : 'FLAG', `days offering a 90-min run: ${fits}/7`);
  }

  // M1/M5/M13: three commitments, sequential — do they collide on the good days?
  {
    const s = mkWeek(spec);
    const a = plan(s, spec, { id: 'maths', tags: ['study'], n: 2, mins: 90 });
    const b = plan(s, spec, { id: 'reading', tags: ['study'], n: 2, mins: 90 });
    const c = plan(s, spec, { id: 'gym', tags: ['rest'], n: 2, mins: 60 });
    const days = [a, b, c].map((r) => r.out.map((o) => o.d));
    const overlap = days[0].filter((d) => days[1].includes(d)).length;
    const perDay = new Map();
    for (const set of days) for (const d of set) perDay.set(d, (perDay.get(d) || 0) + 1);
    const worstDay = Math.max(...perDay.values());
    say('M1/M5', overlap === 0 ? 'PASS' : 'FLAG',
      `maths[${days[0].map((d) => NAMES[d])}] reading[${days[1].map((d) => NAMES[d])}] gym[${days[2].map((d) => NAMES[d])}] — shared days ${overlap}, busiest day carries ${worstDay}`);
    say('M6', c.sign < 0 ? 'PASS' : 'FLAG', `restorative gym sign=${c.sign} (should be -1), landed ${days[2].map((d) => NAMES[d]).join(',')}`);
  }

  // N5 / A11: a commitment with NO load — inert energy, spacing only, deterministic
  {
    const r1 = plan(mkWeek(spec), spec, { id: 'unbucketed', tags: ['nothing-xyz'], n: 3, mins: 60 });
    const r2 = plan(mkWeek(spec), spec, { id: 'unbucketed', tags: ['nothing-xyz'], n: 3, mins: 60 });
    const same = r1.out.map((o) => o.d).join() === r2.out.map((o) => o.d).join();
    say('N5/A11', (!r1.hasLoad && same) ? 'PASS' : 'FLAG',
      `no-load commitment: energy gated ${!r1.hasLoad}, deterministic ${same}, days ${r1.out.map((o) => NAMES[o.d]).join(',')}`);
  }

  // X13: replan five times, nothing done — plan must not move
  {
    const runs = [];
    for (let i = 0; i < 5; i++) runs.push(plan(mkWeek(spec), spec, { id: 'A', tags: ['study'], n: 3, mins: 120 }).out.map((o) => o.d).join());
    say('X13', new Set(runs).size === 1 ? 'PASS' : 'FLAG', `5 replans, distinct plans: ${new Set(runs).size}`);
  }

  // sleep guard on the real week
  {
    const s = mkWeek(spec);
    const bites = [];
    for (let d = 0; d < 7; d++) {
      const day = new Date(spec.base.getTime() + d * DAY);
      const cut = sleepCutoff(s, day);
      if (cut && cut.getDate() === day.getDate() && cut.getHours() < 23) bites.push(`${NAMES[d]}→${cut.toTimeString().slice(0, 5)}`);
    }
    say('sleep', 'INFO', bites.length ? `guard binds on ${bites.join(', ')}` : 'never binds — no day starts before 07:00');
  }

  // N11: deadline crunch — 6h due in 3 days, spacing must yield
  {
    const s = mkWeek(spec);
    const { out } = plan(s, spec, { id: 'crunch', tags: ['study'], n: 3, mins: 120 });
    const within = out.filter((o) => o.d <= 3).length;
    say('N11', 'INFO', `3 sittings unconstrained landed on ${out.map((o) => NAMES[o.d]).join(',')} (${within} within first 4 days)`);
  }
}

console.log(`\n${'='.repeat(78)}`);
console.log('NOT RUN — need a shape a real week cannot express, or have no UI to test:');
console.log('  X3 past deadline · X5 six-month runway · X12 DST + spring-forward');
console.log('  X10 exact load cancellation · X2/X7 impossible amounts · X9 all-restorative week');
console.log('  A12 mid-week term start · A7 cross-period (covered by probe-two-fixes)');
console.log('  N1,N3,N4,N6,N7,N8,N9,N12 — these test WORDING and offer/impose behaviour.');
console.log('  There is no UI for a standing commitment yet, so the sentences they forbid');
console.log('  cannot be produced or checked. They are acceptance criteria for the build,');
console.log('  not probes — and they are the ones most likely to be quietly skipped.');
