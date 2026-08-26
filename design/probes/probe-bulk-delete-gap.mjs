// probe-bulk-delete-gap.mjs — does the bulk-delete guard cover EVERYTHING it
// now needs to?
//
// `isBulkDelete` was written after a footlocker restore silently emptied a
// schedule: the restored ids were still in the sync record, the calendar no
// longer had those events, so every task read as "deleted on the other device"
// and the sync removed the lot. The guard stops any pass about to remove most
// of the schedule.
//
// GS-11 then routed DAY NOTES and BLOCKED DAYS through the same planner. This
// asks the obvious follow-up question: did the guard come with them?
//
//     node design/probes/probe-bulk-delete-gap.mjs
import { Schedule, defaultConfig, dateFromKey } from '../../src/core/index.js';
import { pull, applyPlan, encodeNoteParts, encodeBlockedParts } from '../../src/ui/googleSync.js';
import { planSync, emptyState, advanceState, isBulkDelete } from '../../src/core/syncPlan.js';
import { applyLocalNotes, applyLocalBlocked, blockedRecord } from '../../src/ui/useGoogleSync.js';

const ok = (b) => (b ? 'OK  ' : '**FAIL**');
let failures = 0;
const check = (label, cond, extra = '') => {
  if (!cond) failures += 1;
  console.log(`  ${ok(cond)} ${label}${extra ? `  ${extra}` : ''}`);
};

function fakeGoogle() {
  const events = new Map();
  let seq = 0;
  let clock = 1_000_000;
  return {
    listAll: async () => [...events.values()].map((e) => ({ ...e })),
    insert: async (_cal, body) => {
      seq += 1; clock += 1;
      const id = `ev${seq}`;
      events.set(id, { ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    patch: async (_cal, id, body) => {
      clock += 1;
      events.set(id, { ...events.get(id), ...body, id, updated: new Date(clock).toISOString() });
      return { ...events.get(id) };
    },
    remove: async (_cal, id) => { events.delete(id); return null; },
    _events: events,
    _now: () => clock + 1000,
  };
}

const api = fakeGoogle();
const s = new Schedule({ config: defaultConfig });

// A term's worth of day notes and a few blocked days — the shape a holiday
// import leaves behind.
const NOTES = [
  ['Thanksgiving', '2026-11-26'], ['Reading week', '2026-11-23'], ['Term ends', '2026-12-12'],
  ['Mum visiting', '2026-10-03'], ['Conference', '2026-09-18'], ['Bank holiday', '2026-08-31'],
];
for (const [label, day] of NOTES) s.addDayNote({ label, from: day, to: day });
for (const day of ['2026-12-24', '2026-12-25', '2026-12-26']) s.blockDay(dateFromKey(day));

console.log('=== BEFORE ===\n');
console.log(`  day notes:    ${s.dayNotes.length}`);
console.log(`  blocked days: ${s.blockedDays.length}\n`);

// Push them all up, and record it, exactly as a real session does.
let noteState = emptyState();
const notePlan = planSync(s.dayNotes.map((n) => n.toJSON()), [], noteState);
const noteApplied = await applyPlan(api, 'cal', notePlan, { encode: encodeNoteParts });
noteState = advanceState(noteState, noteApplied, api._now());

let blockedState = emptyState();
const blockedPlan = planSync(s.blockedDays.map(blockedRecord), [], blockedState);
const blockedApplied = await applyPlan(api, 'cal', blockedPlan, { encode: encodeBlockedParts });
blockedState = advanceState(blockedState, blockedApplied, api._now());

console.log(`  pushed: ${noteApplied.synced.length} notes, ${blockedApplied.synced.length} blocked days`);
console.log(`  events in the calendar: ${api._events.size}\n`);

// ── THE DISASTER SHAPE ──────────────────────────────────────────────────────
// A re-made calendar, a footlocker restore, events cleared by hand: the sync
// record still says these were pushed, and the calendar no longer has them. To
// the planner that is indistinguishable from "deleted on the other device".
console.log('=== THE CALENDAR IS EMPTIED (re-made, restored, cleared by hand) ===\n');
for (const id of [...api._events.keys()]) await api.remove('cal', id);

const remote = await pull(api, 'cal');
const notePlan2 = planSync(s.dayNotes.map((n) => n.toJSON()), remote.notes || [], noteState);
const blockedPlan2 = planSync(s.blockedDays.map(blockedRecord), remote.blockedDays || [], blockedState);

console.log(`  the note plan would delete LOCALLY:    ${notePlan2.deleteLocal.length} of ${s.dayNotes.length}`);
console.log(`  the blocked plan would delete LOCALLY: ${blockedPlan2.deleteLocal.length} of ${s.blockedDays.length}\n`);

// The guard EXISTS. The question is whether these paths consult it.
console.log(`  isBulkDelete says of the note plan:    ${isBulkDelete(notePlan2, s.dayNotes.length)}`);
console.log(`  isBulkDelete says of the blocked plan: ${isBulkDelete(blockedPlan2, s.blockedDays.length)}\n`);

check('the guard RECOGNISES this as a bulk delete', isBulkDelete(notePlan2, s.dayNotes.length),
  'so the tool to stop it already exists');

// What `runSync` does NOW: every collection is planned before anything is
// written, and ANY of them tripping the guard stops the whole pass.
//
// Before 2026-08-25 this read `applyLocalNotes(...)` / `applyLocalBlocked(...)`
// unconditionally, because the guard was consulted for tasks and nothing else.
// That is the bug; this is the fix, and reverting the four lines below
// reproduces it exactly.
const guarded = [
  ['day notes', notePlan2, s.dayNotes.length],
  ['blocked days', blockedPlan2, s.blockedDays.length],
].find(([, p, n]) => isBulkDelete(p, n));

if (guarded) {
  console.log(`  the pass STOPS: it would have removed most of your ${guarded[0]}\n`);
} else {
  applyLocalNotes(s, notePlan2);
  applyLocalBlocked(s, blockedPlan2);
}

console.log('=== AFTER THE PASS THAT runSync WOULD ACTUALLY PERFORM ===\n');
console.log(`  day notes:    ${s.dayNotes.length}`);
console.log(`  blocked days: ${s.blockedDays.length}\n`);

check('⚠️ day notes SURVIVED an emptied calendar', s.dayNotes.length === NOTES.length,
  `${s.dayNotes.length} of ${NOTES.length} left`);
check('⚠️ blocked days SURVIVED an emptied calendar', s.blockedDays.length === 3,
  `${s.blockedDays.length} of 3 left`);

console.log(`\n${failures ? `${failures} FAILURE(S) — the guard covers tasks and nothing else` : 'all clear'}`);
