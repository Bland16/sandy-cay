// probe-b-model.mjs — Zone window validation, updateTask invariants, and the
// UPDATE_WHITELIST. Fixed dates (#8).

import { Schedule } from '../../src/core/Schedule.js';
import { dateFromKey, dateKey, formatHHMM } from '../../src/core/time.js';
import { computeWindows } from '../../src/core/placement.js';

const line = (s = '') => console.log(s);
const fmt = (d) => `${dateKey(d)} ${formatHHMM(d)}`;
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };
const wins = (ws) => ws.map((w) => `${formatHHMM(w.start)}-${formatHHMM(w.end)}`).join(' | ') || '(none)';
const MON = dateFromKey('2026-08-17');

// ================================================= 1. reversed zone window
line('=== 1. a zone window whose end is before its start (22:00 -> 02:00) ===');
line('    ZonesEditor renders two bare <input type="time"> with no ordering check.');
for (const [name, w] of [
  ['normal  20:00-23:00', { day: 'mon', start: '20:00', end: '23:00' }],
  ['reversed 22:00-02:00', { day: 'mon', start: '22:00', end: '02:00' }],
  ['degenerate 12:00-12:00', { day: 'mon', start: '12:00', end: '12:00' }],
]) {
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({ label: 'Study', matchTags: ['study'], exclusive: true, windows: [w] });
  const matching = computeWindows(s, { tags: ['study'], deadline: null }, MON);
  const other = computeWindows(s, { tags: ['admin'], deadline: null }, MON);
  const t = s.addFlexible({ title: 'Read', tags: ['study'], durationMin: 60, from: at('2026-08-17', '08:00'), to: at('2026-08-17', '23:00') });
  line(`  ${name.padEnd(24)} matching=${wins(matching).padEnd(24)} non-matching=${wins(other)}`);
  line(`  ${''.padEnd(24)} a study task lands ${fmt(t.startTime)}  outsideZone=${t.schedulingInfo}  warn=${t.schedulingWarning}`);
}

// ================================================= 2. updateTask invariants
line('');
line('=== 2. updateTask writes startTime/endTime with no invariant check ===');
{
  const s = new Schedule({});
  const t = s.addFixed({ title: 'Meeting', startTime: at('2026-08-17', '10:00'), durationMin: 60 });
  line(`  before: ${fmt(t.startTime)} -> ${fmt(t.endTime)}  duration=${t.getDuration()}`);
  s.updateTask(t.id, { startTime: at('2026-08-17', '14:00') }); // start pushed past end
  line(`  after updateTask({startTime:14:00}): ${fmt(t.startTime)} -> ${fmt(t.endTime)}  duration=${t.getDuration()}`);
  const other = s.addFixed({ title: 'Other', startTime: at('2026-08-17', '13:30'), durationMin: 120 });
  line(`  overlaps a 13:30-15:30 task? ${t.overlaps(other)}  (the inverted task is invisible to conflict detection)`);
  const back = s.constructor.fromJSON(JSON.parse(JSON.stringify(s.toJSON())));
  const rt = back.tasks.find((x) => x.id === t.id);
  line(`  after a save/load round-trip the constructor SWAPS it: ${fmt(rt.startTime)} -> ${fmt(rt.endTime)}`);
  line(`  -> the same task occupies a different span before and after a reload.`);
}

// ================================================= 3. whitelist
line('');
line('=== 3. UPDATE_WHITELIST: fields updateTask silently drops ===');
{
  const s = new Schedule({});
  const t = s.addFixed({ title: 'T', startTime: at('2026-08-17', '10:00'), durationMin: 60 });
  const probes = {
    placedBy: 'user', load: { mental: 1 }, activityId: 'a-1', parentId: 'p-1',
    schedulingWarning: true, schedulingInfo: 'x', missedDeadline: true,
    energyAt: { mental: 1 }, dayFillAtCompletion: 0.5, history: { moveCount: 9 },
    isOccurrence: true, occurrenceDate: '2026-08-17',
  };
  for (const [k, v] of Object.entries(probes)) {
    const before = JSON.stringify(t[k]);
    s.updateTask(t.id, { [k]: v });
    const after = JSON.stringify(t[k]);
    line(`  ${k.padEnd(20)} ${before === after ? 'DROPPED' : 'applied'}  (${before} -> ${after})`);
  }
}

// ================================================= 4. id spaces
line('');
line('=== 4. commitment ids vs task ids after _dedupeIds ===');
{
  // Two commitments whose titles slug identically, restored from a save.
  const s = Schedule.fromJSON({
    schemaVersion: 1,
    tasks: [
      { schemaVersion: 1, id: 'maths-0001', title: 'Maths', startTime: at('2026-08-17', '10:00').getTime(), endTime: at('2026-08-17', '11:00').getTime() },
    ],
    commitments: [
      { id: 'maths-commit', title: 'Maths', from: '2026-08-01', until: '2026-12-01' },
      { id: 'maths-commit', title: 'Maths', from: '2026-08-01', until: '2026-12-01' },
    ],
  });
  line(`  commitment ids after load: ${s.commitments.map((c) => c.id).join(', ')}`);
  line(`  task ids after load      : ${s.tasks.map((t) => t.id).join(', ')}`);
  line('  (a reissued commitment id orphans any sitting still carrying the old parentId)');
  const orphan = new Schedule({
    tasks: [{ schemaVersion: 1, id: 't1', title: 'Sitting', parentId: 'maths-commit', startTime: at('2026-08-17', '10:00').getTime(), endTime: at('2026-08-17', '11:00').getTime() }],
    commitments: [
      { id: 'maths-commit', title: 'Maths', from: '2026-08-01', until: '2026-12-01' },
      { id: 'maths-commit', title: 'Maths', from: '2026-08-01', until: '2026-12-01' },
    ],
  });
  for (const c of orphan.commitments) {
    line(`  sittingsFor(${c.id}) = ${orphan.sittingsFor(c.id).length}`);
  }
}
