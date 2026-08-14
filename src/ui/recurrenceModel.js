// recurrenceModel.js — translate the RecurrenceEditor's UI state into the
// engine's recurrence object (SPEC §4). Kept out of components so both Add and
// Edit paths build identical structures.

import {
  dateFromKey, weekStart, untilAfterLastRun, dayKeyOf, addDays, dayStart,
  time,
} from '../core/index.js';
import { Task } from '../core/Task.js';
import { expandRecurrence } from '../core/recurrence.js';
import { DAY_FULL, MONTHS } from './format.js';

const { nthWeekdayOfMonth, isLastWeekdayOfMonth, daysInMonth, weekdayIndex } = time;

export const WEEKDAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri'];
export const ALL_DAY_KEYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];

const ORDINAL_WORDS = ['first', 'second', 'third', 'fourth', 'fifth'];
const MONTH_FULL = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** 1 → "1st". For "every month on the 15th". */
export function ordinalNumber(n) {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

/**
 * The repeat control is TWO levels: a short top list of the cadences people
 * actually reach for, and — only where it means something — the detail folded
 * inside the branch you picked.
 *
 * A single flat list had to carry "every 3rd week", "every month on the first
 * Tuesday" and "every month on the 15th" all at once, which is a lot of reading
 * to do before you find the one line you wanted.
 */
export const TOP_FREQUENCIES = [
  { value: 'daily', label: 'every day' },
  { value: 'weekday', label: 'every weekday (Mon–Fri)' },
  { value: 'week', label: 'every week' },
  { value: 'month', label: 'every month' },
  { value: 'year', label: 'every year' },
  { value: 'other', label: 'other…' },
];

/**
 * What "every month" can mean, written out of the chosen date. These are the
 * only two ideas — keep the weekday and move the date ("the first Tuesday"), or
 * keep the date and let the weekday move ("the 15th") — and the user should
 * never have to name that distinction, only recognise the sentence.
 *
 * "The last Tuesday" appears only when the chosen date genuinely is one.
 */
export function monthlyModesForDate(date) {
  const d = date || new Date();
  const dayName = DAY_FULL[weekdayIndex(d)];
  const nth = nthWeekdayOfMonth(d);
  const out = [{ value: 'mnth', label: `on the ${ORDINAL_WORDS[nth - 1]} ${dayName}` }];
  if (isLastWeekdayOfMonth(d)) out.push({ value: 'mlast', label: `on the last ${dayName}` });
  out.push({ value: 'mdate', label: `on the ${ordinalNumber(d.getDate())}` });
  return out;
}

/** Split a model's option + interval into the two-level UI choice. */
export function uiChoiceOf(model) {
  const option = optionOfModel(model);
  const interval = Number(model && model.interval) || 1;
  const base = { monthMode: 'mnth', unit: 'weeks', n: 2 };
  if (option === 'daily') return { ...base, top: 'daily' };
  if (option === 'weekday') return { ...base, top: 'weekday' };
  if (option === 'y') return { ...base, top: 'year' };
  if (option === 'mnth' || option === 'mlast' || option === 'mdate') {
    return interval > 1
      ? { ...base, top: 'other', unit: 'months', n: interval, monthMode: option }
      : { ...base, top: 'month', monthMode: option };
  }
  const n = Number(option) || 1;
  return n === 1 ? { ...base, top: 'week' } : { ...base, top: 'other', n };
}

/** The option + interval a UI choice means. */
export function choiceToOption(choice) {
  const n = Math.max(2, Number(choice.n) || 2);
  switch (choice.top) {
    case 'daily': return { option: 'daily', interval: 1 };
    case 'weekday': return { option: 'weekday', interval: 1 };
    case 'month': return { option: choice.monthMode || 'mnth', interval: 1 };
    case 'year': return { option: 'y', interval: 1 };
    case 'other':
      return choice.unit === 'months'
        ? { option: choice.monthMode || 'mnth', interval: n }
        : { option: String(n), interval: n };
    case 'week':
    default: return { option: '1', interval: 1 };
  }
}

/**
 * The repeat options as ONE flat list of finished sentences. Still the source of
 * truth for reading a pattern back and for validity, and used by the preview;
 * the editor presents them two-level (see `TOP_FREQUENCIES`).
 *
 * There is no "by date vs by position" mode to understand, because picking a
 * date already answers both. The first design asked the user to choose between
 * those two ideas in the abstract and they rightly called it confusing: the
 * distinction is real in the data and must be invisible in the UI. Same approach
 * Google and Apple Calendar take.
 *
 * "The last Tuesday" is offered only when the chosen date genuinely IS the last
 * such weekday of its month — otherwise it would mean something the date didn't.
 */
export function optionsForDate(date) {
  const d = date || new Date();
  const dayName = DAY_FULL[weekdayIndex(d)];
  const nth = nthWeekdayOfMonth(d);
  // The WEEKLY options deliberately don't name a day: weekly patterns carry
  // editable day rows underneath ("Mon and Wed" is a real thing to want), so a
  // day in the label would go stale the moment a row changed. Monthly and
  // yearly have no rows, so their labels carry the whole sentence.
  // Weekly option values stay the interval-as-string / 'weekday' they have
  // always been, so saved patterns and existing callers keep working; the
  // monthly and yearly ones are new names alongside them.
  const opts = [
    // `daily` must be here as well as in TOP_FREQUENCIES: this list is what the
    // editor validates the selected option AGAINST, so an option missing from it
    // is silently reset to "every week". Caught by dumping the rendered control.
    { value: 'daily', label: 'every day' },
    { value: '1', label: 'every week' },
    { value: 'weekday', label: 'every weekday (Mon–Fri)' },
    // "every other week", not "every 2nd week" — the numeric wording made a
    // fortnightly pattern hard enough to spot that the user asked whether it
    // existed at all. The stored interval is unchanged.
    { value: '2', label: 'every other week' },
    { value: '3', label: 'every 3rd week' },
    { value: '4', label: 'every 4th week' },
    { value: 'mnth', label: `every month on the ${ORDINAL_WORDS[nth - 1]} ${dayName}` },
  ];
  if (isLastWeekdayOfMonth(d)) {
    opts.push({ value: 'mlast', label: `every month on the last ${dayName}` });
  }
  opts.push({ value: 'mdate', label: `every month on the ${ordinalNumber(d.getDate())}` });
  opts.push({ value: 'y', label: `every year on ${d.getDate()} ${MONTH_FULL[d.getMonth()]}` });
  return opts;
}

/**
 * The option a model is currently on. `option` is optional: when absent it is
 * DERIVED from the windows and interval, the same readback principle as
 * `isWeekdayPattern` — so a model built by setting `interval` alone still means
 * what it says, rather than being silently overridden by a stale `option`.
 */
export function optionOfModel(model) {
  if (model && model.option) return model.option;
  const interval = Number(model && model.interval) || 1;
  if (interval === 1 && isEveryDayPattern(model && model.windows)) return 'daily';
  if (interval === 1 && isWeekdayPattern(model && model.windows)) return 'weekday';
  return String(interval);
}

/**
 * The freq + windows a chosen option means, given the date and a time row.
 * `intervalOverride` carries "every 2nd month" — for a weekly option the
 * interval IS the option, so it is ignored there.
 */
export function windowsForOption(value, date, times, weeklyWindows, intervalOverride) {
  const t = { start: times.start, end: times.end };
  const dayKey = dayKeyOf(date);
  const every = Math.max(1, Number(intervalOverride) || 1);
  switch (value) {
    // Day-spanning presets keep EVERY time the pattern runs at, so "twice a day"
    // is two times over seven days rather than a frequency of its own.
    case 'daily':
      return { freq: 'weekly', interval: 1, windows: toEveryDayWindows(weeklyWindows) };
    case 'weekday':
      return { freq: 'weekly', interval: 1, windows: toWeekdayWindows(weeklyWindows) };
    case 'mnth':
      return { freq: 'monthly', interval: every, windows: [{ day: dayKey, nth: nthWeekdayOfMonth(date), ...t }] };
    case 'mlast':
      return { freq: 'monthly', interval: every, windows: [{ day: dayKey, nth: -1, ...t }] };
    case 'mdate':
      return { freq: 'monthly', interval: every, windows: [{ monthDay: date.getDate(), ...t }] };
    case 'y':
      return { freq: 'yearly', interval: every, windows: [{ month: date.getMonth() + 1, monthDay: date.getDate(), ...t }] };
    default: {
      // '1' / '2' / '3' / '4' — keep whatever day rows the user has built up,
      // since "Mon and Wed" is a real thing to want.
      const windows = (weeklyWindows && weeklyWindows.length)
        ? weeklyWindows.map((w) => ({ day: w.day, start: w.start, end: w.end }))
        : [{ day: dayKey, ...t }];
      return { freq: 'weekly', interval: Number(value) || 1, windows };
    }
  }
}

/** Read an existing period BACK to an option — never a stored mode that can
 *  drift from the windows (the same principle as `isWeekdayPattern`). */
export function optionFromPeriod(period) {
  if (!period) return 'w1';
  const freq = period.freq || 'weekly';
  const w = (period.windows || [])[0] || {};
  if (freq === 'yearly') return 'y';
  if (freq === 'monthly') {
    if (w.monthDay != null) return 'mdate';
    return w.nth === -1 ? 'mlast' : 'mnth';
  }
  if ((period.interval ?? 1) === 1 && isEveryDayPattern(period.windows)) return 'daily';
  if ((period.interval ?? 1) === 1 && isWeekdayPattern(period.windows)) return 'weekday';
  return String(period.interval ?? 1);
}

/**
 * The next few dates a pattern actually lands on, plus the months/years it
 * skips. Computed by running the REAL engine (`expandRecurrence`) week by week
 * rather than reimplementing the rule — sharp edge #14's lesson is that a second
 * copy of a calendar rule drifts from the first.
 */
export function previewDates(model, anchorDate, want = 4) {
  const rec = buildRecurrence(model, anchorDate);
  if (!rec) return { dates: [], skipped: [] };
  const task = new Task({ title: 'preview', type: 'fixed', recurrence: rec });
  const freq = rec.periods[0].freq || 'weekly';
  // Enough weeks to find `want` hits: a year is plenty for weekly/monthly, and
  // a yearly pattern needs one per year (plus slack for 29 February).
  const maxWeeks = freq === 'yearly' ? want * 53 + 320 : freq === 'monthly' ? want * 6 + 20 : want * 5;
  const dates = [];
  let ws = weekStart(anchorDate);
  for (let i = 0; i < maxWeeks && dates.length < want; i++) {
    for (const o of expandRecurrence(task, ws)) {
      if (dates.length < want) dates.push(o.startTime);
    }
    ws = addDays(ws, 7);
  }
  return { dates, skipped: skippedFor(model, anchorDate) };
}

/** Which upcoming months (or years) the pattern has no date in — the skip rule
 *  made visible, so it is discovered in the panel and not in November. */
function skippedFor(model, date) {
  const out = [];
  if (model.option === 'mdate') {
    const day = date.getDate();
    for (let i = 0; i < 12; i++) {
      const m = new Date(date.getFullYear(), date.getMonth() + i, 1);
      if (daysInMonth(m.getFullYear(), m.getMonth()) < day) out.push(MONTHS[m.getMonth()]);
    }
  } else if (model.option === 'mnth') {
    const nth = nthWeekdayOfMonth(date);
    if (nth === 5) {
      for (let i = 0; i < 12; i++) {
        const m = new Date(date.getFullYear(), date.getMonth() + i, 1);
        if (!time.nthWeekdayDate(m.getFullYear(), m.getMonth(), date.getDay(), 5)) {
          out.push(MONTHS[m.getMonth()]);
        }
      }
    }
  } else if (model.option === 'y' && date.getMonth() === 1 && date.getDate() === 29) {
    for (let i = 1; i <= 4; i++) {
      const y = date.getFullYear() + i;
      if (daysInMonth(y, 1) < 29) out.push(String(y));
    }
  }
  return [...new Set(out)];
}

/**
 * The distinct TIMES a pattern runs at, in order. **"Twice a day" is two times,
 * not a separate frequency** — which is why the top list stays six entries
 * instead of sprouting "twice a day", "three times a day", "twice a weekday"
 * and the rest. Derived from the windows, never stored, so the pattern cannot
 * claim a shape its rows don't have.
 */
export function timesOf(windows) {
  const seen = new Map();
  for (const w of windows || []) {
    const k = `${w.start}-${w.end}`;
    if (!seen.has(k)) seen.set(k, { start: w.start, end: w.end });
  }
  const out = [...seen.values()].sort((a, b) => String(a.start).localeCompare(String(b.start)));
  return out.length ? out : [{ start: '09:00', end: '10:00' }];
}

/**
 * Does this cover exactly `dayKeys`, with the SAME set of times on each? That is
 * what makes "every weekday" or "every day" a true description, and comparing
 * the whole time SET (rather than one time) is what lets a twice-a-day pattern
 * read back correctly. Change one day's times and it honestly stops claiming it.
 */
function coversDaysAlike(windows, dayKeys) {
  if (!windows || !windows.length) return false;
  const byDay = new Map();
  for (const w of windows) {
    if (!byDay.has(w.day)) byDay.set(w.day, []);
    byDay.get(w.day).push(`${w.start}-${w.end}`);
  }
  if (byDay.size !== dayKeys.length || !dayKeys.every((d) => byDay.has(d))) return false;
  const sig = (arr) => [...arr].sort().join('|');
  const first = sig(byDay.get(dayKeys[0]));
  return dayKeys.every((d) => sig(byDay.get(d)) === first);
}

/** "Every weekday", at one or more times a day. A readback, not a stored flag:
 *  change Tuesday to 13:00 and it stops describing itself that way. */
export function isWeekdayPattern(windows) {
  return coversDaysAlike(windows, WEEKDAY_KEYS);
}

/** "Every day", at one or more times a day. */
export function isEveryDayPattern(windows) {
  return coversDaysAlike(windows, ALL_DAY_KEYS);
}

/** Seven days × every time the pattern runs at. */
export function toEveryDayWindows(windows) {
  const ts = timesOf(windows);
  return ALL_DAY_KEYS.flatMap((day) => ts.map((t) => ({ day, ...t })));
}

/** Mon–Fri × every time — "lunch every weekday at noon" is one choice, not five
 *  rows retyped, and "meds twice a weekday" is two times, not ten. */
export function toWeekdayWindows(windows) {
  const ts = timesOf(windows);
  return WEEKDAY_KEYS.flatMap((day) => ts.map((t) => ({ day, ...t })));
}

/** Rewrite a day-spanning pattern to a new set of times, keeping its days. */
export function withTimes(option, times) {
  const ts = times && times.length ? times : [{ start: '09:00', end: '10:00' }];
  const days = option === 'daily' ? ALL_DAY_KEYS : WEEKDAY_KEYS;
  return days.flatMap((day) => ts.map((t) => ({ day, ...t })));
}

/** A fresh, empty editor model. `option` is the selected sentence (see
 *  `optionsForDate`); `windows` holds the weekly day rows, and its first row
 *  doubles as the times a monthly/yearly pattern runs at. */
export function emptyRecurrence() {
  return {
    enabled: false,
    // `option` is deliberately ABSENT here, not defaulted: `optionOfModel`
    // derives it from the windows + interval, so a caller that sets only
    // `interval` still gets the cadence it asked for instead of having it
    // silently overridden.
    windows: [{ day: 'mon', start: '09:00', end: '10:00' }],
    interval: 1,
    scope: 'future', // 'future' = from now on · 'all' = including past
    temporary: null, // null | { from: 'YYYY-MM-DD', until: 'YYYY-MM-DD' }
  };
}

/** Turning Repeats on should assume the day you already chose, not Monday. */
export function seedForDate(model, date) {
  if (!date) return model;
  const day = dayKeyOf(date);
  const w = (model.windows || [])[0];
  if (!w || w.day === day) return model;
  return { ...model, windows: [{ ...w, day }, ...model.windows.slice(1)] };
}

/** Derive an editor model from an existing task's recurrence (for the edit panel). */
export function modelFromTask(task) {
  if (!task.recurrence) return emptyRecurrence();
  const rec = task.recurrence;
  const active = rec.periods.find((p) => !p.effectiveUntil) || rec.periods[0] || {};
  const freq = active.freq || 'weekly';
  const w0 = (active.windows || [])[0] || {};
  return {
    enabled: true,
    option: optionFromPeriod(active),
    // A monthly/yearly period's windows carry no weekday row, so keep one
    // synthetic row purely as the times the editor edits.
    windows: freq === 'weekly'
      ? (active.windows || []).map((w) => ({ ...w }))
      : [{ day: 'mon', start: w0.start || '09:00', end: w0.end || '10:00' }],
    interval: active.interval ?? 1,
    scope: 'future',
    temporary: null,
  };
}

/**
 * Build the engine `recurrence` object for a NEW task, or the base pattern used
 * when enabling recurrence on an existing one.
 *
 * ONE period, always bounded at the start. It used to emit `effectiveFrom: null`
 * — a pattern active since the dawn of time — so lunch added this week appeared
 * every weekday of every week already gone. `periodActiveOn` treats a null
 * `effectiveFrom` as "no lower bound", and a routine you invented on Wednesday
 * was never true in March.
 *
 * It also used to build a period "sandwich" for a temporary run: a base period
 * from forever until `from`, then a bounded period with THE SAME windows. That
 * is the 4E shape for changing an EXISTING routine, and it is meaningless for a
 * new one — there is no surrounding pattern to sandwich into, so all it did was
 * re-open the unbounded past. A new task's "from…until" is simply when it runs.
 * (Editing a live pattern still goes through the engine's `temporaryChange`,
 * which builds the real sandwich — see TaskPanel.)
 *
 * The MODEL's dates are inclusive — `temporary.until` is the last day it runs,
 * because that is what a person means. The engine is half-open, so the bound is
 * converted here via `untilAfterLastRun` (see time.js). Edges convert; the core
 * does not.
 */
export function buildRecurrence(model, anchor = new Date()) {
  if (!model.enabled || !model.windows || model.windows.length === 0) return null;
  const date = anchor instanceof Date ? anchor : new Date(anchor);
  const times = model.windows[0] || { start: '09:00', end: '10:00' };
  const { freq, interval, windows } = windowsForOption(
    optionOfModel(model), date, times, model.windows, model.interval,
  );
  if (!windows.length) return null;

  const temp = model.temporary;
  // Default start: the week you're adding it in for a weekly pattern — you
  // can't attend a lunch that hadn't been invented yet. A monthly or yearly
  // pattern starts on the DAY itself, because its week-start can fall in the
  // previous month and would shift the every-Nth-month parity by one.
  const defaultFrom = freq === 'weekly' ? weekStart(date) : dayStart(date);
  const effectiveFrom = temp && temp.from ? dateFromKey(temp.from) : defaultFrom;
  const effectiveUntil = temp && temp.until ? untilAfterLastRun(dateFromKey(temp.until)) : null;
  return {
    periods: [{
      // Written only when it isn't the default, so a weekly pattern serializes
      // exactly as it did before P2 and old saves round-trip untouched.
      ...(freq !== 'weekly' ? { freq } : {}),
      windows,
      interval,
      effectiveFrom,
      effectiveUntil,
    }],
    // Parity for "every Nth" counts from where the pattern STARTS, so "every
    // other week from the 13th" means the 13th, the 27th, and so on — and
    // "every 2nd month from September" means September, November, January.
    anchorDate: freq === 'weekly' ? weekStart(effectiveFrom) : dayStart(effectiveFrom),
    exceptions: [],
  };
}
