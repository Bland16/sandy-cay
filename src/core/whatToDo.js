// whatToDo.js — rank EXISTING tasks for the current moment (SPEC §6, R-6).
// Never invents tasks. Cold start (<10 ratings): urgency/fit/priority only.
// Reasons are generated from the actual scoring terms.

import { sameDay, minutesBetween, clamp } from './time.js';
import { dayWindowBounds } from './placement.js';

function currentGapMin(schedule, now) {
  const b = dayWindowBounds(schedule.config, now);
  let nextStart = b.end;
  for (const t of schedule.getTasksForDay(now)) {
    if (t.startTime.getTime() > now.getTime() && t.startTime.getTime() < nextStart.getTime()) {
      nextStart = t.startTime;
    }
  }
  return Math.max(0, minutesBetween(now, nextStart));
}

export function whatToDo(schedule, now = new Date()) {
  const config = schedule.config;
  const trained = schedule.learning.trained && schedule.learning.sampleCount >= config.coldStartRatings;
  const gapMin = currentGapMin(schedule, now);

  // Recent same-day energy signal (rest-boost).
  const drainedToday = schedule.tasks.some(
    (t) => t.satisfaction && t.satisfaction.energy === -1 && sameDay(t.startTime, now),
  );

  const candidates = schedule.tasks.filter(
    (t) => !t.chunking && !t.recurrence && t.completion === null,
  );

  const ranked = candidates.map((t) => {
    const reasons = [];
    const dur = t.getDuration() || config.defaultDuration;

    // 1) gap fit
    const fit = gapMin >= dur ? 1 : clamp(gapMin / dur, 0, 1);
    if (fit >= 1 && gapMin > 0) reasons.push(`fits your ${gapMin}-minute gap`);

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

    return { task: t, score, reasons };
  });

  ranked.sort((a, b) => b.score - a.score || b.task.priority - a.task.priority || a.task.title.localeCompare(b.task.title));
  return ranked.slice(0, 3);
}
