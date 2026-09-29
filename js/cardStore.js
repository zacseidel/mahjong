// The user's card library: pure functions over plain data (no DOM, no storage), so they run
// under Node for tests. storage.js persists the result; the card editor calls these.
//
// Store shape (localStorage key mj.cards.v1):
//   { schema: 1, activeId: 'practice' | <card id>, cards: [{ id, card, updatedAt }] }
// The practice card is not stored; it always ships with the site.

import { validateCard, compileHand, expandPattern, CardError } from './engine/card.js';
import { suitOf, rankOf, isNumber, toStr } from './engine/tiles.js';

export const STORE_SCHEMA = 1;
export const PRACTICE_ID = 'practice';

/** Category suggestions for the hand form (practice-card categories; no card data). */
export const CATEGORY_SUGGESTIONS = Object.freeze([
  'Year', '2468', 'Like Numbers', 'Addition', 'Quints', 'Consecutive Run', '13579',
  'Winds & Dragons', '369', 'Singles & Pairs',
]);

export function emptyStore() {
  return { schema: STORE_SCHEMA, activeId: PRACTICE_ID, cards: [] };
}

function isObject(x) {
  return !!x && typeof x === 'object' && !Array.isArray(x);
}

/**
 * Coerce whatever was in storage into a valid store. Malformed entries are dropped; an active
 * id that no longer exists falls back to the practice card.
 */
export function normalizeStore(raw) {
  if (!isObject(raw) || raw.schema !== STORE_SCHEMA || !Array.isArray(raw.cards)) return emptyStore();
  const seen = new Set();
  const cards = raw.cards.filter((entry) => {
    if (!isObject(entry) || typeof entry.id !== 'string' || !entry.id || entry.id === PRACTICE_ID || seen.has(entry.id)) return false;
    if (!isObject(entry.card) || !Array.isArray(entry.card.hands)) return false;
    seen.add(entry.id);
    return true;
  }).map((entry) => ({ id: entry.id, card: entry.card, updatedAt: typeof entry.updatedAt === 'string' ? entry.updatedAt : '' }));
  const activeId = typeof raw.activeId === 'string' && (raw.activeId === PRACTICE_ID || seen.has(raw.activeId)) ? raw.activeId : PRACTICE_ID;
  return { schema: STORE_SCHEMA, activeId, cards };
}

/** A blank user card. */
export function blankCard(name = 'My card', year = null) {
  return { schema: 1, name, year, source: 'user', hands: [] };
}

export function getCard(store, id) {
  return store.cards.find((c) => c.id === id)?.card ?? null;
}

/** Add or replace a card. Returns a new store. */
export function putCard(store, id, card, now = new Date().toISOString()) {
  const cards = store.cards.some((c) => c.id === id)
    ? store.cards.map((c) => (c.id === id ? { id, card, updatedAt: now } : c))
    : [...store.cards, { id, card, updatedAt: now }];
  return { ...store, cards };
}

export function removeCard(store, id) {
  return {
    ...store,
    cards: store.cards.filter((c) => c.id !== id),
    activeId: store.activeId === id ? PRACTICE_ID : store.activeId,
  };
}

export function setActive(store, id) {
  if (id !== PRACTICE_ID && !store.cards.some((c) => c.id === id)) throw new Error(`No card with id ${id}`);
  return { ...store, activeId: id };
}

/** A user-editable copy of any card (including the practice card). */
export function copyOfCard(card, name = `${card.name} (copy)`) {
  return { ...structuredClone(card), name, source: 'user' };
}

// ---------- Hands ----------

function slug(text) {
  return String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'hand';
}

/** An id not used by any other hand on the card, based on the category. */
export function uniqueHandId(card, base, except = -1) {
  const used = new Set(card.hands.filter((_, i) => i !== except).map((h) => h.id));
  const root = slug(base);
  for (let n = 1; ; n++) {
    const id = `${root}-${n}`;
    if (!used.has(id)) return id;
  }
}

/** Normalize a hand from the form: trimmed text, numeric value, id filled in. */
export function cleanHand(card, hand, index = -1) {
  const out = {
    id: typeof hand.id === 'string' && hand.id && !card.hands.some((h, i) => i !== index && h.id === hand.id)
      ? hand.id : uniqueHandId(card, hand.category, index),
    category: String(hand.category ?? '').trim(),
    line: String(hand.line ?? '').trim().replace(/\s+/g, ' '),
    numbers: hand.numbers === 'shift' ? 'shift' : 'fixed',
    value: Number(hand.value),
    concealed: !!hand.concealed,
  };
  const notes = String(hand.notes ?? '').trim();
  if (notes) out.notes = notes;
  if (hand.pattern) out.pattern = hand.pattern;
  return out;
}

export function addHand(card, hand) {
  return { ...card, hands: [...card.hands, cleanHand(card, hand)] };
}

export function updateHand(card, index, hand) {
  const hands = card.hands.slice();
  hands[index] = cleanHand(card, hand, index);
  return { ...card, hands };
}

export function removeHand(card, index) {
  return { ...card, hands: card.hands.filter((_, i) => i !== index) };
}

export function duplicateHand(card, index) {
  const copy = { ...structuredClone(card.hands[index]), id: uniqueHandId(card, card.hands[index].category) };
  const hands = card.hands.slice();
  hands.splice(index + 1, 0, copy);
  return { ...card, hands };
}

export function moveHand(card, from, to) {
  if (to < 0 || to >= card.hands.length) return card;
  const hands = card.hands.slice();
  const [h] = hands.splice(from, 1);
  hands.splice(to, 0, h);
  return { ...card, hands };
}

// ---------- Import / export ----------

/** The card as a JSON file's text. */
export function exportCard(card) {
  return `${JSON.stringify({ ...card, schema: 1 }, null, 2)}\n`;
}

/** A safe file name for an exported card. */
export function exportFileName(card) {
  return `${slug(card.name) || 'card'}${card.year ? `-${card.year}` : ''}.json`;
}

/**
 * Read a card from a JSON file's text. Hands that fail validation are kept (so they can be fixed
 * in the editor) and reported; the game skips them until they're fixed.
 * @returns {{card: Object|null, errors: {index: number|null, id: string|null, message: string, pos: number|null}[], fatal: string|null}}
 */
export function importCard(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return { card: null, errors: [], fatal: 'That file isn’t valid JSON.' };
  }
  if (!isObject(data) || !Array.isArray(data.hands)) {
    return { card: null, errors: [], fatal: 'That file isn’t a card: it has no list of hands.' };
  }
  if (data.schema !== undefined && data.schema !== 1) {
    return { card: null, errors: [], fatal: `That card uses schema ${data.schema}, which this site can’t read.` };
  }
  let card = {
    schema: 1,
    name: typeof data.name === 'string' && data.name.trim() ? data.name.trim() : 'Imported card',
    year: Number.isInteger(data.year) ? data.year : null,
    source: 'user',
    hands: [],
  };
  for (const raw of data.hands) {
    if (!isObject(raw)) continue;
    const hand = cleanHand(card, raw);
    card = { ...card, hands: [...card.hands, hand] };
  }
  const errors = validateCard(card);
  return { card, errors, fatal: null };
}

// ---------- Preview ----------

const SUIT_WORDS = ['crak', 'bam', 'dot'];

function groupText({ tile, count }) {
  if (isNumber(tile)) return `${String(rankOf(tile)).repeat(count)} ${SUIT_WORDS[suitOf(tile)]}`;
  const names = { NW: 'N', EW: 'E', WW: 'W', SW: 'S', RD: 'red D', GD: 'green D', WD: 'soap', F: 'F' };
  const code = toStr(tile);
  const n = names[code] ?? code;
  return count > 1 ? `${n}×${count}` : n;
}

/**
 * Live preview for the hand form: a few example instantiations, or the parse error.
 * @param {{line: string, numbers: string, pattern?: Object}} hand
 * @param {number} [n]
 * @returns {{ok: true, total: number, examples: {layout: {tile: number, count: number}[], text: string}[]}
 *   | {ok: false, error: string, pos: number|null}}
 */
export function previewHand(hand, n = 3) {
  let targets;
  try {
    targets = expandPattern(compileHand(hand), hand);
  } catch (e) {
    if (e instanceof CardError) return { ok: false, error: e.detail, pos: e.pos };
    throw e;
  }
  if (!targets.length) return { ok: false, error: 'No legal way to make this hand with the tiles in a set', pos: null };
  const picks = [...new Set([0, Math.floor(targets.length / 2), targets.length - 1])].slice(0, n);
  return {
    ok: true,
    total: targets.length,
    examples: picks.map((i) => ({
      layout: targets[i].layout,
      text: targets[i].layout.map(groupText).join(', '),
    })),
  };
}

/** Is a card playable (at least one valid hand)? Invalid hands are skipped in play. */
export function playableHands(card) {
  const errors = validateCard(card);
  const bad = new Set(errors.filter((e) => e.index !== null).map((e) => e.index));
  return card.hands.length - bad.size;
}
