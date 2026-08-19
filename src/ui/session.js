// session.js — guest or signed in (design/GOOGLE-AS-STORAGE.md GS-3).
//
// Two ways to use Sandy Cay, and the guest door is NOT the lesser one:
//
//   guest   everything stays in this browser. Exactly the app as it was before
//           any of this existed. Nothing is sent anywhere.
//   google  the schedule lives in the user's own Google Calendar, so it follows
//           them to their phone.
//
// The choice is remembered, and CHANGEABLE from the Cabana — the user's call.
// A one-way door would mean clearing browser storage to switch, which is a
// terrible answer to "actually, I do want this on my phone".
//
// ⚠️ localStorage, NOT `config`. Same argument as the grid zoom: `config` is
// engine data, it round-trips through Schedule#toJSON and `exportState` spreads
// it wholesale, so a session marker kept there would ride a footlocker export
// onto another machine and sign it in. Whose session this is is a property of
// THIS browser.

export const SESSION_KEY = 'sandycay.session';

export const SESSION = {
  GUEST: 'guest',
  GOOGLE: 'google',
};

const VALID = new Set([SESSION.GUEST, SESSION.GOOGLE]);

/**
 * The recorded choice, or `null` when nobody has chosen yet — which is what
 * puts the entry screen on screen.
 *
 * Guarded like every other storage read here: a session marker is the least
 * important thing in the app and must never be able to stop it loading. Garbage
 * reads as "not chosen", which shows the entry screen — the safe direction,
 * because it asks rather than assuming.
 */
export function loadSession() {
  try {
    const v = globalThis.localStorage.getItem(SESSION_KEY);
    return VALID.has(v) ? v : null;
  } catch {
    return null;
  }
}

export function saveSession(v) {
  try {
    if (VALID.has(v)) globalThis.localStorage.setItem(SESSION_KEY, v);
    else globalThis.localStorage.removeItem(SESSION_KEY);
  } catch { /* session only */ }
}

/** Forget the choice, so the entry screen comes back. Used by the Cabana. */
export function clearSession() {
  saveSession(null);
}
