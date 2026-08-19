// syncLog.js — say what the sync did, per task, when asked.
//
// ⚠️ OFF BY DEFAULT, and deliberately the ONLY place this app writes to the
// console. Logging that is always on stops being read: it becomes background
// noise you scroll past, and then the one line that mattered is invisible. It
// is switched on for a debugging session and off again.
//
// Turn it on from the Cabana, or from the console:
//     localStorage.setItem('sandycay.sync.debug', '1')
// or add ?syncdebug to the URL for one visit.
//
// This module stays DUMB on purpose. The reasoning lives in `planSync`, which
// records a decision per task with the values behind it; this only formats what
// it is handed. That split is what lets the decisions be unit-tested while the
// printing stays untestable and unimportant.

export const SYNC_DEBUG_KEY = 'sandycay.sync.debug';

export function isSyncDebug() {
  try {
    if (globalThis.localStorage?.getItem(SYNC_DEBUG_KEY) === '1') return true;
    return /[?&]syncdebug\b/.test(globalThis.location?.search || '');
  } catch { return false; }
}

export function setSyncDebug(on) {
  try {
    if (on) globalThis.localStorage.setItem(SYNC_DEBUG_KEY, '1');
    else globalThis.localStorage.removeItem(SYNC_DEBUG_KEY);
  } catch { /* session only */ }
}


const time = () => new Date().toLocaleTimeString();

/** What the sync found before deciding anything. */
export function logPull(remote, localCount) {
  if (!isSyncDebug()) return;
  console.groupCollapsed(`%c[sync ${time()}] pulled — ${remote.tasks.length} task(s) in the calendar, ${localCount} here`, 'color:#2E8C99');
  if (remote.dropped?.length) {
    console.warn(`${remote.dropped.length} event(s) could not be read — those tasks are left untouched:`);
    console.table(remote.dropped.map((d) => ({ task: d.taskId || '(unknown)', event: d.id, error: d.error })));
  }
  if (remote.incomplete?.length) {
    console.warn('tasks missing some of their parts:');
    console.table(remote.incomplete);
  }
  if (remote.libraryError) console.warn(`library: ${remote.libraryError}`);
  console.groupEnd();
}

/**
 * The decision for every task, and why.
 *
 * One row per task, so "why did THIS one not sync" is answerable directly
 * rather than inferred from a summary count.
 */
export function logPlan(plan) {
  if (!isSyncDebug()) return;
  const rows = (plan.decisions || []).map((d) => ({
    task: d.title,
    id: d.id,
    decision: d.decision,
    why: d.reason
      || (d.localChanged !== undefined
        ? `localChanged=${d.localChanged} remoteChanged=${d.remoteChanged}`
        : ''),
    events: Array.isArray(d.eventIds) ? d.eventIds.join(', ') : '',
  }));
  const quiet = rows.filter((r) => r.decision === 'unchanged').length;
  console.groupCollapsed(
    `%c[sync ${time()}] plan — ${rows.length - quiet} to do, ${quiet} unchanged`,
    'color:#2E8C99;font-weight:bold',
  );
  if (rows.length) console.table(rows);
  console.groupEnd();
}

/** What Google actually confirmed — which is not always what was planned. */
export function logApplied(applied) {
  if (!isSyncDebug()) return;
  const ok = applied.synced?.length || 0;
  const bad = applied.failed?.length || 0;
  console.groupCollapsed(
    `%c[sync ${time()}] wrote — ${ok} confirmed, ${applied.forgotten?.length || 0} removed, ${bad} failed`,
    bad ? 'color:#E2685F;font-weight:bold' : 'color:#7FBE8B',
  );
  if (ok) {
    console.table(applied.synced.map((s) => ({
      task: s.task?.title, id: s.task?.id, events: (s.eventIds || [s.eventId]).join(', '),
    })));
  }
  // ⚠️ Failures are console.error, not part of the collapsed group — a write
  // that did not land is the thing you opened the console to find.
  if (bad) console.error('these did NOT save and will be retried:', applied.failed);
  console.groupEnd();
}

export function logStopped(reason) {
  if (!isSyncDebug()) return;
  console.error(`[sync ${time()}] STOPPED — ${reason}`);
}
