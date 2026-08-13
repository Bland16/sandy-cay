// recurrenceSerde.js — (de)serialization for a recurrence object.
//
// A LEAF module on purpose: it imports only from time.js, so both Task and
// DayNote can use it without the cycle that `recurrence.js` would create
// (recurrence.js imports Task to build occurrences).
//
// ⚠️ These two functions rebuild periods from an explicit field list, so ANY new
// period field must be added to BOTH or it is silently dropped — on construction
// by the reviver and on save by the serializer. `freq` was lost exactly that way
// and expanded as weekly with no error. Having ONE copy of each is the point of
// this file: previously Task.js held the only pair, and a second consumer would
// have meant a second pair to forget.

import { dateToJSON, dateFromJSON, dayStart } from './time.js';

// Both of these rebuild periods from an explicit field list, so ANY new period
// field must be added in BOTH or it is silently dropped — on construction by
// the reviver, and on save by the serializer. `freq` (P2) was lost exactly this
// way and expanded as weekly with no error, which is the same shape of bug as
// the footlocker import dropping `snapshots` (sharp edge #15).
// `freq` is written only when present, so a weekly pattern serializes byte-for
// -byte as it always did and old saves round-trip unchanged.
export function reviveRecurrence(rec) {
  return {
    periods: (rec.periods || []).map((p) => ({
      ...(p.freq ? { freq: p.freq } : {}),
      windows: (p.windows || []).map((w) => ({ ...w })),
      interval: p.interval ?? 1,
      effectiveFrom: p.effectiveFrom ? dateFromJSON(p.effectiveFrom) : null,
      effectiveUntil: p.effectiveUntil ? dateFromJSON(p.effectiveUntil) : null,
    })),
    anchorDate: rec.anchorDate ? dateFromJSON(rec.anchorDate) : dayStart(new Date()),
    exceptions: (rec.exceptions || []).map((e) => ({ ...e })),
  };
}

export function recurrenceToJSON(rec) {
  if (!rec) return null;
  return {
    periods: rec.periods.map((p) => ({
      ...(p.freq ? { freq: p.freq } : {}),
      windows: p.windows.map((w) => ({ ...w })),
      interval: p.interval,
      effectiveFrom: dateToJSON(p.effectiveFrom),
      effectiveUntil: dateToJSON(p.effectiveUntil),
    })),
    anchorDate: dateToJSON(rec.anchorDate),
    exceptions: rec.exceptions.map((e) => ({ ...e })),
  };
}
