// probe-b-placement.mjs — placement substrate: occupied-set construction and
// window/occupied disagreement. Fixed dates only (sharp edge #8).
//
// A: does findBestSlot see occupied intervals that lie OUTSIDE config.windows
//    but INSIDE a zone window? (SPEC §2.1 amendment: a zone defines its own
//    window and is no longer clipped to config.windows.)
// B: does Schedule#_occupiedExcluding see recurring occurrences in the NEXT
//    week, which a 3-day lookahead from Fri/Sat reaches? (sharp edge #3)

import { Schedule } from '../../src/core/Schedule.js';
import { dateFromKey, dateKey, formatHHMM } from '../../src/core/time.js';
import { findBestSlot, recurrenceIntervals } from '../../src/core/placement.js';

const line = (s = '') => console.log(s);
const fmt = (d) => `${dateKey(d)} ${formatHHMM(d)}`;
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };

// ============================================================ A
line('=== A. occupied inside a zone window but outside config.windows ===');
{
  // Monday 2026-08-17. Day window 08:00-23:00 (default). Gym zone 06:00-08:00,
  // i.e. entirely BEFORE the day window — the exact case the SPEC §2.1
  // amendment was written for.
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({
    label: 'Gym', matchTags: ['gym'], exclusive: true,
    windows: [{ day: 'mon', start: '06:00', end: '08:00' }],
  });
  // An existing gym task already sitting at 06:00-07:00 on that Monday.
  const existing = s.addFixed({ title: 'Morning run', tags: ['gym'], startTime: at('2026-08-17', '06:00'), durationMin: 60 });
  line(`existing : ${existing.title} ${fmt(existing.startTime)} -> ${fmt(existing.endTime)}`);

  // Now ask where a SECOND 60-minute gym task should go on that same Monday.
  const probeTask = { tags: ['gym'], deadline: null, placedBy: 'auto', startTime: at('2026-08-17', '06:00'), getDuration: () => 60 };
  const occupied = s._occupiedExcluding(probeTask, dateFromKey('2026-08-17'));
  line(`occupied set passed in: ${occupied.map((iv) => `${fmt(iv.start)}-${fmt(iv.end)}`).join(', ')}`);
  const best = findBestSlot(s, probeTask, {
    from: at('2026-08-17', '05:00'), to: at('2026-08-17', '23:00'), occupied,
  });
  line(`findBestSlot -> ${best ? `${fmt(best.slot.start)} -> ${fmt(best.slot.end)}` : 'null'}`);
  const clash = best && best.slot.start < existing.endTime && existing.startTime < best.slot.end;
  line(`OVERLAPS the existing 06:00 task? ${clash ? 'YES — double booked' : 'no'}`);

  // And through the real public door, addFlexible:
  const s2 = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s2.addZone({ label: 'Gym', matchTags: ['gym'], exclusive: true, windows: [{ day: 'mon', start: '06:00', end: '08:00' }] });
  const e2 = s2.addFixed({ title: 'Morning run', tags: ['gym'], startTime: at('2026-08-17', '06:00'), durationMin: 60 });
  const t2 = s2.addFlexible({ title: 'Weights', tags: ['gym'], durationMin: 60, from: at('2026-08-17', '05:00'), to: at('2026-08-17', '23:00') });
  line(`addFlexible -> ${t2.title} ${fmt(t2.startTime)} -> ${fmt(t2.endTime)}`);
  line(`OVERLAPS ${e2.title} (${fmt(e2.startTime)}-${fmt(e2.endTime)})? ${t2.overlaps(e2) ? 'YES — double booked' : 'no'}`);
}

// ============================================================ B
line('');
line('=== B. _occupiedExcluding across a week boundary (recurrence) ===');
{
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  // A recurring Monday 09:00-11:00 lecture, pinned/fixed by §4.4.
  s.addFixed({
    title: 'Lecture', tags: ['class'], startTime: at('2026-08-10', '09:00'), durationMin: 120,
    recurrence: { anchorDate: at('2026-08-10', '09:00'), periods: [{ freq: 'weekly', windows: [{ day: 'mon', start: '09:00', end: '11:00' }] }] },
  });

  // Placing on SATURDAY 2026-08-22. maxPlacementLookahead = 3 days, so the
  // search reaches Mon 2026-08-24 — which is in the NEXT week.
  const from = at('2026-08-22', '08:00');
  const ws = dateFromKey('2026-08-17'); // week containing Saturday the 22nd
  const probeTask = { tags: ['study'], deadline: null, placedBy: 'auto', startTime: from, getDuration: () => 120 };
  const occ = s._occupiedExcluding(probeTask, ws);
  line(`_occupiedExcluding(ws=${dateKey(ws)}): ${occ.map((iv) => fmt(iv.start)).join(', ') || '(empty)'}`);
  const proper = recurrenceIntervals(s, from, at('2026-08-25', '00:00'));
  line(`recurrenceIntervals(from..from+3d): ${proper.map((iv) => fmt(iv.start)).join(', ') || '(empty)'}`);
  const sawMonday = occ.some((iv) => dateKey(iv.start) === '2026-08-24');
  line(`occupied set contains Mon 2026-08-24 lecture? ${sawMonday ? 'yes' : 'NO — blind past the week boundary'}`);

  // Does it actually double-book?
  const s3 = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s3.addFixed({
    title: 'Lecture', tags: ['class'], startTime: at('2026-08-10', '09:00'), durationMin: 120,
    recurrence: { anchorDate: at('2026-08-10', '09:00'), periods: [{ freq: 'weekly', windows: [{ day: 'mon', start: '09:00', end: '11:00' }] }] },
  });
  // Fill Sat + Sun so the only room in the 3-day lookahead is Monday morning.
  s3.addFixed({ title: 'Sat busy', startTime: at('2026-08-22', '08:00'), durationMin: 15 * 60 });
  s3.addFixed({ title: 'Sun busy', startTime: at('2026-08-23', '10:00'), durationMin: 13 * 60 });
  const t3 = s3.addFlexible({ title: 'Essay', tags: ['study'], durationMin: 120, from: at('2026-08-22', '08:00') });
  line(`addFlexible on Sat 22nd -> ${fmt(t3.startTime)} -> ${fmt(t3.endTime)}`);
  const mondayOccs = s3.getTasksForWeek(dateFromKey('2026-08-24')).filter((t) => dateKey(t.startTime) === '2026-08-24');
  for (const o of mondayOccs) {
    line(`  Monday holds: ${o.title} ${fmt(o.startTime)}-${fmt(o.endTime)}` + (o.id !== t3.id && t3.overlaps(o) ? '   <-- OVERLAPS the new task' : ''));
  }
}
