// routineParse.js — a routine, typed as one sentence (design/ROUTINES.md §UI).
//
//   load 2m, wait 45m, switch 2m, wait 60m, fold 10-15m
//   waffles in the air fryer 2m then wait 5-10m then eat 10m
//
// ════════════════════════════════════════════════════════════════════════════
// THE BAR THIS EXISTS TO MEET
// ════════════════════════════════════════════════════════════════════════════
//
// §"The bar for the routine editor: SEAMLESS" is unusually specific, and it is
// specific because this project has already got it wrong once: the first
// monthly-recurrence control asked the user to choose "by date" or "by
// position" in the abstract, they called it confusing, and the fix was to
// generate FINISHED SENTENCES from what they had already chosen.
//
// So a grid of `kind` / `durationMin` / `durationMax` rows is the failure mode,
// not the target. Two rules follow, and this module exists to honour the second:
//
//   1. Say it the way a person says it — one line you read, not a form you fill.
//   2. ⚠️ NEVER MAKE THEM NAME `active` vs `passive`. "A wait is the thing with
//      no verb; if a row has 'I do this' in it, it is active. INFER it, the way
//      `isWeekdayPattern` reads a pattern back rather than storing a flag that
//      can drift."
//
// So the kind is inferred here and never asked for: a chunk that says "wait" is
// a wait, and anything else is something you do.
//
// ⚠️ A RANGE MEANS DIFFERENT THINGS EITHER SIDE OF THAT LINE, and this is R-1
// rather than a syntax convenience:
//
//   active  `fold 10-15m`   the elastic LENGTH of the thing you do
//   wait    `wait 5-10m`    floor–ceiling. The floor is PHYSICS (the machine is
//                           not finished). The ceiling is a PREFERENCE — "and
//                           get back to it within this" — which is stated and
//                           never enforced.
//
// One syntax, because a person writing "5 to 10 minutes" means the same shape
// both times; two meanings, because a wash and a fold are not the same kind of
// thing. Said out loud here so the next reader does not "simplify" them into one.

const UNIT = /^(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)$/i;
const isHour = (u) => /^h/i.test(u);

/** "90", "90m", "1h", "1h30", "1.5h" → minutes, or null if it is not a duration. */
function parseDuration(raw) {
  const s = String(raw).trim().toLowerCase();
  if (!s) return null;
  // "1h30" / "1h 30m" — an hour-and-minutes pair, which is how people write it.
  const hm = s.match(/^(\d+(?:\.\d+)?)\s*(?:h|hr|hrs|hour|hours)\s*(\d+(?:\.\d+)?)\s*(?:m|min|mins|minute|minutes)?$/);
  if (hm) return Math.round(Number(hm[1]) * 60 + Number(hm[2]));
  const one = s.match(/^(\d+(?:\.\d+)?)\s*([a-z]*)$/);
  if (!one) return null;
  const n = Number(one[1]);
  if (!Number.isFinite(n)) return null;
  const unit = one[2];
  if (unit && !UNIT.test(unit)) return null;
  // A bare number is MINUTES. "wait 45" means 45 minutes to everyone who has
  // ever set a kitchen timer; defaulting to hours would be the app inventing.
  return Math.round(isHour(unit) ? n * 60 : n);
}

/**
 * Pull a trailing duration (or range) off a chunk.
 * @returns {{ label, min, max } | null}
 */
function splitLabelAndDuration(chunk) {
  const text = chunk.trim().replace(/[.;]+$/, '');
  if (!text) return null;
  // Walk backwards over the words until the tail stops being a duration. That
  // handles "in the air fryer 2m" and "wait 1h 30m" without a grammar.
  const words = text.split(/\s+/);
  for (let take = Math.min(3, words.length); take >= 1; take -= 1) {
    const tail = words.slice(words.length - take).join(' ');
    const range = tail.match(/^(.+?)\s*(?:-|–|—|to)\s*(.+)$/);
    if (range) {
      const lo = parseDuration(range[1]);
      const hi = parseDuration(range[2]);
      // "5-10m": the low half may carry no unit, so borrow the high half's.
      if (lo !== null && hi !== null) {
        return { label: words.slice(0, words.length - take).join(' ').trim(), min: lo, max: hi };
      }
    }
    const one = parseDuration(tail);
    if (one !== null) {
      return { label: words.slice(0, words.length - take).join(' ').trim(), min: one, max: one };
    }
  }
  return { label: text, min: null, max: null };
}

/**
 * Is this chunk a WAIT? INFERRED, never asked (the rule above).
 *
 * Two markers, and the second is the spec's own distinction made mechanical:
 *
 *   1. it says **wait**
 *   2. it is a **gerund** — "washing", "heating", "cooking". A gerund is the
 *      machine getting on with it; an IMPERATIVE is you doing something.
 *      "preheat" is a thing you do (you press the button); "heating" is the
 *      oven doing it while you are free.
 *
 * ⚠️ The first version keyword-matched machine NAMES — wash, dry, run, cook,
 * bake, preheat — and it classified the oven's `preheat 2m` as a WAIT, which is
 * exactly backwards: pressing the button is the touchpoint. Printed by
 * probe-routine-parse.mjs before any of it was believed. Guessing at nouns
 * cannot work, because "run 90m" (the dishwasher) and "unload 5m" are both
 * verbs; the imperative/gerund split is the real signal and it is the one
 * §"the bar" is pointing at.
 *
 * The rule is teachable in one line, which matters more than cleverness:
 * **say what YOU do as a command, and what the MACHINE does as an -ing word.**
 * And "wait" always works.
 */
function looksLikeWait(label) {
  const text = label.trim();
  if (!text) return true;
  if (/^(then\s+)?wait(ing)?\b/i.test(text)) return true;
  const last = text.split(/\s+/).pop();
  // "-ing" and long enough not to catch "sing"/"ring" as whole labels.
  return /ing$/i.test(last) && last.length > 4;
}

/**
 * Parse one typed line into routine steps.
 *
 * @returns {{ steps: Array, errors: Array<{chunk, reason}> }}
 *
 * Errors are RETURNED, not thrown: a half-typed line is the normal state of a
 * text field, and the editor shows the preview for what parsed plus a plain
 * note about what did not. Throwing would blank the preview on every keystroke.
 */
export function parseRoutineLine(text) {
  const steps = [];
  const errors = [];
  if (typeof text !== 'string' || !text.trim()) return { steps, errors };

  const chunks = text
    .split(/\n|,|;|\bthen\b|→|->/i)
    .map((c) => c.trim())
    .filter(Boolean);

  for (const chunk of chunks) {
    const parsed = splitLabelAndDuration(chunk);
    if (!parsed) continue;
    let { label } = parsed;
    const { min, max } = parsed;

    if (min === null) {
      errors.push({ chunk, reason: 'no time given' });
      continue;
    }
    if (min <= 0) {
      errors.push({ chunk, reason: 'a step needs more than zero minutes' });
      continue;
    }

    const wait = looksLikeWait(label) || !label;
    if (wait) {
      // "wait 45m" → the word `wait` is scaffolding, not a name. A machine step
      // that names itself ("wash 45m") keeps its name.
      const stripped = label.replace(/^(then\s+)?wait(ing)?\s*(for\s*)?/i, '').trim();
      label = stripped || 'wait';
    }

    steps.push({
      label: label || (wait ? 'wait' : 'step'),
      kind: wait ? 'passive' : 'active',
      durationMin: min,
      // On an ACTIVE step the range is the elastic length. On a WAIT the high
      // half is the degrade CEILING, so `durationMax` stays at the floor and the
      // ceiling goes where R-1 put it.
      durationMax: wait ? min : Math.max(min, max),
      maxWaitMin: wait && max > min ? max : null,
    });
  }

  return { steps, errors };
}

/**
 * The inverse — steps back to a line, so an authored routine can be re-edited
 * as text rather than becoming read-only the moment it is saved.
 *
 * Round-trips: `parseRoutineLine(routineToLine(steps))` gives back the same
 * steps. That is locked by a test, because a lossy inverse would silently eat
 * a ceiling the first time someone reopened the field.
 */
export function routineToLine(steps) {
  const dur = (n) => (n % 60 === 0 && n >= 60 ? `${n / 60}h` : `${n}m`);
  // ⚠️ A RANGE USES ONE UNIT FOR BOTH ENDS. Formatting each half on its own
  // produced "workout 45-1h", which parses back correctly and reads like a
  // typo. Whole hours both sides → hours; otherwise minutes.
  const range = (lo, hi) => (lo % 60 === 0 && hi % 60 === 0 && lo >= 60
    ? `${lo / 60}-${hi / 60}h`
    : `${lo}-${hi}m`);
  return (steps || []).map((s) => {
    if (s.kind === 'passive') {
      const tail = s.maxWaitMin && s.maxWaitMin > s.durationMin
        ? range(s.durationMin, s.maxWaitMin) : dur(s.durationMin);
      return s.label && s.label !== 'wait' ? `${s.label} ${tail}` : `wait ${tail}`;
    }
    const tail = s.durationMax > s.durationMin
      ? range(s.durationMin, s.durationMax) : dur(s.durationMin);
    return `${s.label} ${tail}`;
  }).join(', ');
}
