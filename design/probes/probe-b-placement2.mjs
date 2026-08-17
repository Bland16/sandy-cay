// probe-b-placement2.mjs — follow-ups to probe-b-placement.mjs.
//  A2: pinpoint the mechanism of finding A (the dayOccupied filter in
//      findBestSlot clips the occupied set to config.windows).
//  A3: the mirror case — a zone window AFTER the config day window ends.
//  C : the same week-boundary occupied-set blindness in conflicts.js
//      (displacement), which uses expandRecurrence(ws) but searches from..+3d.

import { Schedule } from '../../src/core/Schedule.js';
import { dateFromKey, dateKey, formatHHMM } from '../../src/core/time.js';
import { dayWindowBounds } from '../../src/core/placement.js';

const line = (s = '') => console.log(s);
const fmt = (d) => `${dateKey(d)} ${formatHHMM(d)}`;
const at = (key, hhmm) => { const d = dateFromKey(key); const [h, m] = hhmm.split(':').map(Number); d.setHours(h, m, 0, 0); return d; };

// ============================================================ A2
line('=== A2. the dayOccupied filter in findBestSlot (placement.js:273) ===');
{
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  const d = dateFromKey('2026-08-17'); // Monday
  const b = dayWindowBounds(s.config, d);
  line(`config day window Mon: ${fmt(b.start)} .. ${fmt(b.end)}`);
  const occupied = [{ start: at('2026-08-17', '06:00'), end: at('2026-08-17', '07:00') }];
  const kept = occupied.filter((iv) => iv.end > b.start && iv.start < b.end);
  line(`occupied 06:00-07:00 survives the filter? ${kept.length ? 'yes' : 'NO — dropped, so the zone window is walked as if free'}`);
}

// ============================================================ A3
line('');
line('=== A3. mirror case: zone window AFTER the config day window ends ===');
{
  // Day window narrowed to 08:00-18:00 (the pre-2026-08-13 default, and what
  // any user who narrows their evenings still has). Study zone 18:00-22:00.
  const cfg = { sleep: { minHoursBeforeNextDay: 0 }, windows: { monFri: { start: '08:00', end: '18:00' } } };
  const s = new Schedule({ config: cfg });
  s.addZone({ label: 'Study', matchTags: ['study'], exclusive: true, windows: [{ day: 'mon', start: '18:00', end: '22:00' }] });
  const e = s.addFixed({ title: 'Seminar', tags: ['study'], startTime: at('2026-08-17', '18:00'), durationMin: 120 });
  const t = s.addFlexible({ title: 'Reading', tags: ['study'], durationMin: 60, from: at('2026-08-17', '08:00'), to: at('2026-08-17', '23:00') });
  line(`existing  : ${e.title} ${fmt(e.startTime)} -> ${fmt(e.endTime)}`);
  line(`addFlexible: ${t.title} ${fmt(t.startTime)} -> ${fmt(t.endTime)}`);
  line(`OVERLAPS? ${t.overlaps(e) ? 'YES — double booked' : 'no'}`);
}

// ============================================================ A4
line('');
line('=== A4. the case that needs NO config change: Sunday starts at 10:00 ===');
{
  // defaultConfig: sun { start: '10:00' }. Any Sunday-morning zone is outside it.
  const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
  s.addZone({ label: 'Gym', matchTags: ['gym'], exclusive: true, windows: [{ day: 'sun', start: '08:00', end: '10:00' }] });
  const e = s.addFixed({ title: 'Long run', tags: ['gym'], startTime: at('2026-08-23', '08:00'), durationMin: 60 });
  const t = s.addFlexible({ title: 'Stretch', tags: ['gym'], durationMin: 45, from: at('2026-08-23', '07:00'), to: at('2026-08-23', '23:00') });
  line(`  existing  : ${e.title} ${fmt(e.startTime)} -> ${fmt(e.endTime)}`);
  line(`  addFlexible: ${t.title} ${fmt(t.startTime)} -> ${fmt(t.endTime)}`);
  line(`  OVERLAPS? ${t.overlaps(e) ? 'YES — double booked, on stock config' : 'no'}`);
}

// ============================================================ C
line('');
line('=== C. displacement (conflicts.js:65) across the week boundary ===');
{
  const mk = () => {
    const s = new Schedule({ config: { sleep: { minHoursBeforeNextDay: 0 } } });
    s.addFixed({
      title: 'Lecture', tags: ['class'], startTime: at('2026-08-10', '09:00'), durationMin: 120,
      recurrence: { anchorDate: at('2026-08-10', '09:00'), periods: [{ freq: 'weekly', windows: [{ day: 'mon', start: '09:00', end: '11:00' }] }] },
    });
    return s;
  };
  const s = mk();
  // A flexible task sitting on Saturday morning, and the rest of Sat+Sun full,
  // so the only room inside the 3-day search is Monday morning — next week.
  const victim = s.addFlexible({ title: 'Victim', tags: ['study'], startTime: at('2026-08-22', '08:00'), durationMin: 120 });
  s.addFixed({ title: 'Sat rest', startTime: at('2026-08-22', '10:00'), durationMin: 13 * 60 });
  s.addFixed({ title: 'Sun rest', startTime: at('2026-08-23', '10:00'), durationMin: 13 * 60 });
  // Now drop something on top of the victim.
  const dropped = s.addFixed({ title: 'Dropped', pinned: true, startTime: at('2026-08-22', '08:00'), durationMin: 120 });
  const res = s.resolveDropConflicts(dropped, { now: at('2026-08-22', '07:00') });
  line(`displaced: ${res.displaced.map((t) => `${t.title} -> ${fmt(t.startTime)}-${fmt(t.endTime)}`).join(', ') || '(none)'}`);
  const monOccs = s.getTasksForWeek(dateFromKey('2026-08-24')).filter((t) => dateKey(t.startTime) === '2026-08-24');
  for (const o of monOccs) {
    const clash = o.id !== victim.id && victim.overlaps(o);
    line(`  Monday 24th holds: ${o.title} ${fmt(o.startTime)}-${fmt(o.endTime)}${clash ? '   <-- OVERLAPS the displaced task' : ''}`);
  }
}
