// probe-b-roundtrip.mjs — does every piece of Schedule state survive
// toJSON/fromJSON, and does useEngine#replace copy every field the constructor
// assigns? (sharp edge #15, sprung three times.)
//
// Read-only on src/. Fixed dates only (sharp edge #8).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Schedule } from '../../src/core/Schedule.js';
import { dateFromKey } from '../../src/core/time.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const line = (s = '') => console.log(s);

// ---------------------------------------------------------------- 1. static
line('=== 1. constructor fields vs useEngine#replace ===');
const schedSrc = fs.readFileSync(path.join(ROOT, 'src/core/Schedule.js'), 'utf8');
const ctorBody = schedSrc.slice(
  schedSrc.indexOf('constructor(init = {})'),
  schedSrc.indexOf('// ---- weight / model helpers'),
);
const ctorFields = [...new Set([...ctorBody.matchAll(/this\.(_?\w+)\s*=/g)].map((m) => m[1]))];
const engineSrc = fs.readFileSync(path.join(ROOT, 'src/ui/useEngine.js'), 'utf8');
const replaceBody = engineSrc.slice(engineSrc.indexOf('replace: useCallback'));
const replaceFields = [...new Set([...replaceBody.matchAll(/\bs\.(_?\w+)\s*=/g)].map((m) => m[1]))];
line(`constructor assigns : ${ctorFields.join(', ')}`);
line(`replace copies      : ${replaceFields.join(', ')}`);
const missing = ctorFields.filter((f) => !replaceFields.includes(f));
line(`NOT copied by replace: ${missing.length ? missing.join(', ') : '(none)'}`);

const toJsonBody = schedSrc.slice(schedSrc.indexOf('  toJSON() {'), schedSrc.indexOf('  static fromJSON'));
const jsonKeys = [...new Set([...toJsonBody.matchAll(/^\s{6}(\w+):/gm)].map((m) => m[1]))];
line(`toJSON writes       : ${jsonKeys.join(', ')}`);

// ---------------------------------------------------------------- 2. runtime
line('');
line('=== 2. deep round-trip of a fully-populated Schedule ===');
const s = new Schedule({});
s.addFixed({ title: 'Lecture', tags: ['study'], startTime: dateFromKey('2026-08-17'), durationMin: 60 });
s.addZone({ label: 'Work', matchTags: ['work'], windows: [{ day: 'mon', start: '09:00', end: '18:30' }], effectiveUntil: dateFromKey('2026-07-25') });
s.addBucket({ label: 'Study', tags: ['study'], color: '#ff0000' });
s.addActivity({ label: 'Run', tags: ['gym'] });
s.addDayNote({ label: 'Thanksgiving', from: '2026-11-26', to: '2026-11-26', kind: 'holiday' });
s.blockDay(dateFromKey('2026-08-19'));
s.addCommitment({ title: 'Maths', tags: ['study'], from: '2026-09-01', until: '2026-12-12', amountMinPerWeek: 120, dueDay: 'thu' });
s.retireTag('old-tag');
s.markWeekSeen(dateFromKey('2026-08-17'));
s.dismissSuggestion('drift:study', dateFromKey('2026-08-17'));
s.snapshot(dateFromKey('2026-08-17'));

const a = JSON.parse(JSON.stringify(s.toJSON()));
const b = JSON.parse(JSON.stringify(Schedule.fromJSON(a).toJSON()));

function diff(x, y, p = '') {
  const out = [];
  const keys = new Set([...Object.keys(x || {}), ...Object.keys(y || {})]);
  for (const k of keys) {
    const px = `${p}${p ? '.' : ''}${k}`;
    const vx = x ? x[k] : undefined;
    const vy = y ? y[k] : undefined;
    if (vx && vy && typeof vx === 'object' && typeof vy === 'object') out.push(...diff(vx, vy, px));
    else if (JSON.stringify(vx) !== JSON.stringify(vy)) out.push(`${px}: ${JSON.stringify(vx)} -> ${JSON.stringify(vy)}`);
  }
  return out;
}
const d = diff(a, b);
line(`round-trip diffs: ${d.length === 0 ? 'NONE (clean)' : ''}`);
for (const x of d) line(`  ${x}`);

// second pass — does a value stabilise or keep mutating?
const c = JSON.parse(JSON.stringify(Schedule.fromJSON(b).toJSON()));
const d2 = diff(b, c);
line(`second-pass diffs: ${d2.length === 0 ? 'NONE (stable)' : ''}`);
for (const x of d2) line(`  ${x}`);

// ---------------------------------------------------------------- 3. replace
line('');
line('=== 3. simulated useEngine#replace: which live fields go stale? ===');
const live = new Schedule({});
const next = Schedule.fromJSON(a);
for (const f of replaceFields) live[f] = next[f];
for (const f of ctorFields) {
  const same = JSON.stringify(live[f]) === JSON.stringify(next[f]);
  if (!same) line(`  MISMATCH after replace: ${f} live=${JSON.stringify(live[f])} imported=${JSON.stringify(next[f])}`);
}
line('  (fields listed above were not transferred by replace)');
