// whatToDo.js — rank EXISTING tasks for the current moment (SPEC §6, R-6).
// Never invents tasks. Cold start (<10 ratings): urgency/fit/priority only.
// Reasons are generated from the actual scoring terms.

import { sameDay, minutesBetween, clamp } from './time.js';
import { dayWindowBounds } from './placement.js';

/**
 * The opening you could actually fill right now: from the later of `now` and
 * the day's window start, stepping past anything already in progress, until the
 * next task begins (or the window ends). null when the day's window is over or
 * there is no room left.
 *
 * Clamping into the window is the point: measuring raw distance to the next
 * task claims a "430-minute opening" at 00:50 that you are asleep through.
 */
export function currentOpening(schedule, now = new Date()) {
  const b = dayWindowBounds(schedule.config, now);
  if (now.getTime() >= b.end.getTime()) return null; // today's window has closed

  let start = now.getTime() < b.start.getTime() ? b.start : now;
  const dayTasks = schedule.getTasksForDay(now).filter((t) => t.completion === null);

  // Step past whatever is in progress at the cursor — that time isn't open.
  for (let i = 0; i < 8; i += 1) {
    const spanning = dayTasks.find(
      (t) => t.startTime.getTime() <= start.getTime() && t.endTime.getTime() > start.getTime(),
    );
    if (!spanning) break;
    start = spanning.endTime;
  }
  if (start.getTime() >= b.end.getTime()) return null;

  let end = b.end;
  let nextTask = null;
  for (const t of dayTasks) {
    const ts = t.startTime.getTime();
    if (ts > start.getTime() && ts < end.getTime()) {
      end = t.startTime;
      nextTask = t;
    }
  }
  const minutes = Math.max(0, minutesBetween(start, end));
  if (minutes <= 0) return null;
  return { start, end, minutes, nextTask, startsLater: start.getTime() > now.getTime() };
}

/** "45-minute" / "2-hour" — for reasons and the panel header. */
export function openingLabel(min) {
  if (min < 120) return `${min}-minute`;
  const h = Math.round((min / 60) * 10) / 10;
  return `${Number.isInteger(h) ? h : h.toFixed(1)}-hour`;
}

/**
 * whatToDo(schedule, now, { tags })
 * `tags` narrows the candidates ("what should I do in study mode?").
 */
export function whatToDo(schedule, now = new Date(), options = {}) {
  const { tags: filterTags = null } = options;
  const config = schedule.config;
  const trained = schedule.learning.trained && schedule.learning.sampleCount >= config.coldStartRatings;
  const opening = currentOpening(schedule, now);
  const openMin = opening ? opening.minutes : 0;

  // Recent same-day energy signal (rest-boost).
  const drainedToday = schedule.tasks.some(
    (t) => t.satisfaction && t.satisfaction.energy === -1 && sameDay(t.startTime, now),
  );

  const happeningNow = (t) =>
    t.startTime.getTime() <= now.getTime() && t.endTime.getTime() > now.getTime();

  // Only things you could actually do now: movable work, or an anchor that is
  // happening right now. A fixed dentist on Thursday is not a valid answer to
  // "what should I do at 13:00 on Monday" — the semantics table says anchors
  // never move (§1.1, 7B).
  const eligible = (t) => {
    if (t.completion !== null) return false;
    if (t.chunking) return false; // parent is a bookkeeping record, not a thing to do
    if (t.recurrence) return false; // pattern, not an occurrence
    const movable = t.type === 'flexible' && !t.pinned;
    return movable || happeningNow(t);
  };

  let candidates = schedule.tasks.filter(eligible);
  if (filterTags && filterTags.length) {
    candidates = candidates.filter((t) => (t.tags || []).some((x) => filterTags.includes(x)));
  }

  const ranked = candidates.map((t) => {
    const reasons = [];
    const dur = t.getDuration() || config.defaultDuration;

    if (happeningNow(t)) reasons.push('happening now');

    // 1) gap fit — against the real opening
    const fit = openMin === 0 ? 0 : dur <= openMin ? 1 : clamp(openMin / dur, 0, 1);
    if (opening && dur <= openMin && (openMin <= 180 || dur / openMin >= 0.5)) {
      // Only worth saying when the opening actually constrains the choice.
      reasons.push(`fits your ${openingLabel(openMin)} opening`);
    } else if (opening && dur > openMin) {
      reasons.push(`longer than your ${openingLabel(openMin)} opening`);
    }

    // 2) urgency
    let urgency = 0;
    if (t.schedulingWarning) {
      urgency = 1;
      reasons.push('needs a slot — flagged');
    } else if (t.deadline) {
      const untilMin = minutesBetween(now, t.deadline);
      urgency = clamp(1 - untilMin / (config.maxPlacementLookahead * 24 * 60), 0, 1);
      if (untilMin <= 24 * 60) reasons.push('due soon');
      else reasons.push('has a deadline');
    }

    // 3) preference (only when trained)
    let pref = 0;
    if (trained) {
      pref = schedule.learning.modelScore(t, { start: now, end: new Date(now.getTime() + dur * 60000) });
      if (pref >= 0.6) reasons.push('you rate this kind of work well right now');
    }

    // 4) priority tiebreak
    const priorityScore = t.priority / 5;
    if (t.priority >= 4) reasons.push('high priority');

    // 5) energy pattern
    let energyBoost = 0;
    if (drainedToday && (t.hasProtectedTag(config.protectedTags) || t.priority <= 2)) {
      energyBoost = 0.15;
      reasons.push('a lighter pick — you have been drained today');
    }

    const score =
      0.4 * fit +
      0.35 * urgency +
      0.25 * priorityScore +
      (trained ? 0.3 * pref : 0) +
      energyBoost;

    if (reasons.length === 0) reasons.push(`priority ${t.priority}`);
    return { task: t, score, reasons };
  });

  ranked.sort(
    (a, b) => b.score - a.score || b.task.priority - a.task.priority || a.task.title.localeCompare(b.task.title),
  );
  return ranked.slice(0, 3);
}
