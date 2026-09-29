// The only module that touches localStorage (CLAUDE.md). Every read and write is wrapped:
// the app must work when storage is empty, corrupt, full, or unavailable (private mode,
// blocked site data). Card data stays in this browser; nothing here sends it anywhere.

import { normalizeStore } from './cardStore.js';
import { normalizeSettings } from './settings.js';
import { normalizeLedger, emptyLedger } from './ledger.js';

export const KEYS = Object.freeze({
  cards: 'mj.cards.v1',
  flags: 'mj.flags.v1',
  settings: 'mj.settings.v1',
  ledger: 'mj.ledger.v1',
});

function storage() {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // Accessing localStorage can itself throw when site data is blocked.
  }
}

/** Parsed JSON at `key`, or `fallback` if missing, unreadable, or storage is unavailable. */
export function readJSON(key, fallback) {
  try {
    const raw = storage()?.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch {
    return fallback;
  }
}

/** Store JSON at `key`. Returns false if it couldn't be saved. */
export function writeJSON(key, value) {
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

/** Is storage usable right now? (Used to warn that cards won't be saved.) */
export function storageAvailable() {
  const probe = 'mj.probe';
  try {
    const s = storage();
    if (!s) return false;
    s.setItem(probe, '1');
    s.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

/** The user's card library (never the practice card, which ships with the site). */
export function loadCards() {
  return normalizeStore(readJSON(KEYS.cards, null));
}

export function saveCards(store) {
  return writeJSON(KEYS.cards, store);
}

/** One-time flags, e.g. whether a warning has been shown. */
export function loadFlags() {
  const f = readJSON(KEYS.flags, {});
  return f && typeof f === 'object' && !Array.isArray(f) ? f : {};
}

export function setFlag(name, value = true) {
  return writeJSON(KEYS.flags, { ...loadFlags(), [name]: value });
}

/** Saved settings merged onto the defaults. */
export function loadSettings() {
  return normalizeSettings(readJSON(KEYS.settings, null));
}

export function saveSettings(settings) {
  return writeJSON(KEYS.settings, settings);
}

/** Hand history. */
export function loadLedger() {
  return normalizeLedger(readJSON(KEYS.ledger, null));
}

export function saveLedger(ledger) {
  return writeJSON(KEYS.ledger, ledger);
}

export function clearLedger() {
  return writeJSON(KEYS.ledger, emptyLedger());
}
