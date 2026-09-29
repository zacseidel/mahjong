// Card hands: parse line notation, compile to a pattern, expand to concrete targets, match (SPEC §5).

import {
  COPIES, KINDS, JOKER, FLOWER, NORTH_WIND, EAST_WIND, WEST_WIND, SOUTH_WIND, WHITE_DRAGON,
  SUITS, numberTile, dragonForSuit, toStr, toCounts,
} from './tiles.js';

export const HAND_SIZE = 14;
const COLORS = 'grb';
const FIXED_CHARS = { 0: WHITE_DRAGON, F: FLOWER, N: NORTH_WIND, E: EAST_WIND, W: WEST_WIND, S: SOUTH_WIND };
const MAX_JOKERS = COPIES[JOKER];

/** A parse or validation error. `pos` is a 0-based index into the line, or null. */
export class CardError extends Error {
  /** @param {string} message @param {number|null} [pos] */
  constructor(message, pos = null) {
    super(pos == null ? message : `${message} (at position ${pos + 1})`);
    this.name = 'CardError';
    this.detail = message;
    this.pos = pos;
  }
}

/**
 * @typedef {{kind: 'fixed', tile: number, count: number}
 *   | {kind: 'num', suitVar: string, numVar: string|null, offset: number, count: number}
 *   | {kind: 'dragon', suitVar: string, count: number}} Slot
 *   A 'num' slot has rank offset + (value of numVar, or 0 when numVar is null).
 *
 * @typedef {Object} Pattern
 * @property {Slot[]} slots
 * @property {string[]} suitVars  Distinct suit variables, in order of first use.
 * @property {Record<string, [number, number]>} numVars  Inclusive range per number variable.
 *
 * @typedef {Object} Target  One concrete instantiation of a card hand.
 * @property {string} handId
 * @property {Object} hand         The card hand it came from.
 * @property {number} value
 * @property {boolean} concealed
 * @property {{tile: number, count: number}[]} layout  Every slot in printed order.
 * @property {{tile: number, count: number}[]} groups  Slots of 3 or more (jokers allowed).
 * @property {Int8Array} single    Per-tile counts of pair/single slots (no jokers).
 * @property {Int8Array} group     Per-tile counts of group slots.
 * @property {boolean} hasGroups
 * @property {string} key          Identity for de-duplication.
 *
 * @typedef {{tile: number, count: number, jokers: number}} Exposure
 */

/**
 * Parse a line in the §5.3 notation.
 * @param {string} line
 * @param {'fixed'|'shift'} [numbers]
 * @returns {Pattern}
 */
export function parseLine(line, numbers = 'fixed') {
  if (numbers !== 'fixed' && numbers !== 'shift') throw new CardError(`numbers must be "fixed" or "shift", not "${numbers}"`);
  if (typeof line !== 'string' || line.trim() === '') throw new CardError('The line is empty');

  const slots = [];
  const digits = [];
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    const token = m[0];
    const start = m.index;
    let body = token;
    let color = null;
    if (COLORS.includes(token[token.length - 1])) {
      color = token[token.length - 1];
      body = token.slice(0, -1);
    }
    if (body === '') throw new CardError(`"${token}" has a color but no tiles`, start);
    for (let i = 0; i < body.length; i++) {
      const ch = body[i];
      if (COLORS.includes(ch)) throw new CardError(`Color "${ch}" must come at the end of a group`, start + i);
      if (!isTileChar(ch)) throw new CardError(`Unknown character "${ch}"`, start + i);
    }
    if (!color && [...body].some(needsColor)) {
      throw new CardError(`"${token}" needs a color (g, r, or b) because it has numbers or dragons`, start);
    }
    const same = [...body].every((c) => c === body[0]);
    const pieces = same ? [[body[0], body.length]] : [...body].map((c) => [c, 1]);
    for (const [ch, count] of pieces) {
      if (ch >= '1' && ch <= '9') {
        const d = Number(ch);
        digits.push(d);
        slots.push({ kind: 'num', suitVar: color, numVar: numbers === 'shift' ? 's' : null, offset: d, count });
      } else if (ch === 'D') {
        slots.push({ kind: 'dragon', suitVar: color, count });
      } else {
        slots.push({ kind: 'fixed', tile: FIXED_CHARS[ch], count });
      }
    }
  }

  const numVars = {};
  if (numbers === 'shift' && digits.length) numVars.s = [1 - Math.min(...digits), 9 - Math.max(...digits)];
  return finishPattern(slots, numVars);
}

function isTileChar(ch) {
  return (ch >= '1' && ch <= '9') || ch === 'D' || ch in FIXED_CHARS;
}

function needsColor(ch) {
  return (ch >= '1' && ch <= '9') || ch === 'D';
}

function finishPattern(slots, numVars) {
  const total = slots.reduce((n, s) => n + s.count, 0);
  if (total !== HAND_SIZE) throw new CardError(`Hand has ${total} tiles; it needs ${HAND_SIZE}`);
  const suitVars = [];
  for (const s of slots) if (s.kind !== 'fixed' && !suitVars.includes(s.suitVar)) suitVars.push(s.suitVar);
  if (suitVars.length > SUITS.length) throw new CardError(`Hand uses ${suitVars.length} suits; there are only 3`);
  return { slots, suitVars, numVars };
}

/**
 * Parse the advanced compiled-group format (§5.3):
 * `{ groups: [{ tile: "n+1", suit: "A", count: 3 }, ...], constraints: { n: [1, 8] } }`.
 * `tile` is a digit 1–9, a number variable (one lowercase letter) with an optional +k/−k,
 * or 0, F, N, E, W, S, D. Numbers and D need a `suit` variable. Variables default to 1–9.
 * @param {Object} pattern
 * @returns {Pattern}
 */
export function parsePattern(pattern) {
  if (!pattern || typeof pattern !== 'object' || !Array.isArray(pattern.groups) || pattern.groups.length === 0) {
    throw new CardError('Advanced pattern needs a non-empty "groups" array');
  }
  const slots = [];
  const used = new Set();
  pattern.groups.forEach((g, i) => {
    const where = `Group ${i + 1}`;
    if (!g || typeof g !== 'object') throw new CardError(`${where} is not an object`);
    if (!Number.isInteger(g.count) || g.count < 1) throw new CardError(`${where}: count must be a positive integer`);
    const tile = String(g.tile ?? '');
    const suit = typeof g.suit === 'string' && g.suit !== '' ? g.suit : null;
    let v;
    if (/^[1-9]$/.test(tile)) {
      slots.push({ kind: 'num', suitVar: suit, numVar: null, offset: Number(tile), count: g.count });
    } else if ((v = /^([a-z])(?:([+-])([0-8]))?$/.exec(tile))) {
      const offset = v[2] ? (v[2] === '+' ? 1 : -1) * Number(v[3]) : 0;
      used.add(v[1]);
      slots.push({ kind: 'num', suitVar: suit, numVar: v[1], offset, count: g.count });
    } else if (tile === 'D') {
      slots.push({ kind: 'dragon', suitVar: suit, count: g.count });
    } else if (tile in FIXED_CHARS) {
      slots.push({ kind: 'fixed', tile: FIXED_CHARS[tile], count: g.count });
      return;
    } else {
      throw new CardError(`${where}: unknown tile "${tile}"`);
    }
    if (!suit) throw new CardError(`${where}: numbers and dragons need a "suit" variable`);
  });

  const numVars = {};
  for (const name of used) numVars[name] = [1, 9];
  const constraints = pattern.constraints ?? {};
  if (typeof constraints !== 'object') throw new CardError('"constraints" must be an object');
  for (const [name, range] of Object.entries(constraints)) {
    if (!used.has(name)) throw new CardError(`Constraint on "${name}", which no group uses`);
    if (!Array.isArray(range) || range.length !== 2 || !range.every((x) => Number.isInteger(x) && x >= 1 && x <= 9) || range[0] > range[1]) {
      throw new CardError(`Constraint on "${name}" must be [low, high] within 1–9`);
    }
    numVars[name] = [range[0], range[1]];
  }
  return finishPattern(slots, numVars);
}

/**
 * Compile a card hand: its advanced `pattern` if present, else its `line`.
 * @param {{line?: string, numbers?: 'fixed'|'shift', pattern?: Object}} hand
 * @returns {Pattern}
 */
export function compileHand(hand) {
  return hand.pattern ? parsePattern(hand.pattern) : parseLine(hand.line, hand.numbers ?? 'fixed');
}

/** Every way to assign `k` distinct suits, in order. */
function suitAssignments(k) {
  if (k === 0) return [[]];
  const out = [];
  for (const rest of suitAssignments(k - 1)) {
    for (const s of SUITS) if (!rest.includes(s)) out.push([...rest, s]);
  }
  return out;
}

/** Cartesian product of number-variable ranges. */
function numAssignments(numVars) {
  let out = [{}];
  for (const [name, [lo, hi]] of Object.entries(numVars)) {
    const next = [];
    for (const partial of out) for (let x = lo; x <= hi; x++) next.push({ ...partial, [name]: x });
    out = next;
  }
  return out;
}

/**
 * All legal concrete instantiations of a pattern, de-duplicated.
 * @param {Pattern} pattern
 * @param {{id?: string, value?: number, concealed?: boolean}} [hand]
 * @returns {Target[]}
 */
export function expandPattern(pattern, hand = {}) {
  const targets = [];
  const seen = new Set();
  for (const nums of numAssignments(pattern.numVars)) {
    for (const perm of suitAssignments(pattern.suitVars.length)) {
      const suitOfVar = Object.fromEntries(pattern.suitVars.map((v, i) => [v, perm[i]]));
      const layout = [];
      let ok = true;
      for (const slot of pattern.slots) {
        let tile;
        if (slot.kind === 'fixed') tile = slot.tile;
        else if (slot.kind === 'dragon') tile = dragonForSuit(suitOfVar[slot.suitVar]);
        else {
          const rank = slot.offset + (slot.numVar ? nums[slot.numVar] : 0);
          if (rank < 1 || rank > 9) { ok = false; break; }
          tile = numberTile(suitOfVar[slot.suitVar], rank);
        }
        layout.push({ tile, count: slot.count });
      }
      if (!ok) continue;
      const target = buildTarget(layout, hand);
      if (!target || seen.has(target.key)) continue;
      seen.add(target.key);
      targets.push(target);
    }
  }
  return targets;
}

function buildTarget(layout, hand) {
  const single = new Int8Array(KINDS);
  const group = new Int8Array(KINDS);
  const groups = [];
  for (const { tile, count } of layout) {
    if (count >= 3) {
      group[tile] += count;
      groups.push({ tile, count });
    } else {
      single[tile] += count;
    }
  }
  let jokersNeeded = 0;
  for (let t = 0; t < KINDS; t++) {
    if (single[t] > COPIES[t]) return null;
    jokersNeeded += Math.max(0, single[t] + group[t] - COPIES[t]);
  }
  if (jokersNeeded > MAX_JOKERS) return null;
  const sortedGroups = groups.map((g) => `${g.tile}x${g.count}`).sort().join(',');
  return {
    handId: hand.id,
    hand,
    value: hand.value,
    concealed: !!hand.concealed,
    layout,
    groups,
    single,
    group,
    hasGroups: groups.length > 0,
    key: `${sortedGroups}|${single.join('')}`,
  };
}

/**
 * All legal concrete instantiations of a card hand. Throws CardError if the hand doesn't parse.
 * @param {Object} hand @returns {Target[]}
 */
export function expandHand(hand) {
  return expandPattern(compileHand(hand), hand);
}

const cardCache = new WeakMap();

/**
 * Every concrete target on a card, cached per card object (treat cards as immutable).
 * Hands that fail to compile are skipped; use validateCard to report them.
 * @param {{hands: Object[]}} card @returns {Target[]}
 */
export function expandCard(card) {
  let targets = cardCache.get(card);
  if (!targets) {
    targets = [];
    for (const hand of card.hands) {
      try {
        targets.push(...expandHand(hand));
      } catch (e) {
        if (!(e instanceof CardError)) throw e;
      }
    }
    cardCache.set(card, targets);
  }
  return targets;
}

/**
 * Fit exposures into a target's groups. Each exposure must equal a distinct target group
 * (same tile, same size); a concealed target takes no exposures.
 * @param {Target} target
 * @param {Exposure[]} exposures
 * @returns {Int8Array|null}  Per-tile group counts left for concealed tiles, or null if they don't fit.
 */
export function fitExposures(target, exposures) {
  if (target.concealed && exposures.length) return null;
  const group = Int8Array.from(target.group);
  const unused = target.groups.slice();
  for (const e of exposures) {
    const i = unused.findIndex((g) => g.tile === e.tile && g.count === e.count);
    if (i < 0) return null;
    unused.splice(i, 1);
    group[e.tile] -= e.count;
  }
  return group;
}

/**
 * Does a complete hand match this target? Exposures must fit (see fitExposures);
 * concealed tiles fill the rest, with jokers only in groups.
 * @param {Target} target
 * @param {{concealed: number[], exposures?: Exposure[]}} hand
 * @returns {boolean}
 */
export function matchTarget(target, { concealed, exposures = [] }) {
  const group = fitExposures(target, exposures);
  if (!group) return false;
  const total = exposures.reduce((n, e) => n + e.count, concealed.length);
  if (total !== HAND_SIZE) return false;
  const counts = toCounts(concealed);
  for (let t = 0; t < KINDS; t++) {
    if (t === JOKER) continue;
    if (counts[t] < target.single[t] || counts[t] > target.single[t] + group[t]) return false;
  }
  // Tile totals are equal and every real tile fits, so the jokers exactly fill group slots.
  return true;
}

/**
 * All card targets this hand matches, highest value first.
 * @param {{hands: Object[]}} card
 * @param {{concealed: number[], exposures?: Exposure[]}} hand
 * @returns {{target: Target, jokerless: boolean}[]}
 */
export function matchHand(card, hand) {
  const exposures = hand.exposures ?? [];
  const jokerless = !hand.concealed.includes(JOKER) && exposures.every((e) => e.jokers === 0);
  return expandCard(card)
    .filter((t) => matchTarget(t, hand))
    .sort((a, b) => b.value - a.value)
    .map((target) => ({ target, jokerless }));
}

/**
 * Short text form of a target for debugging, e.g. "F×2 2C×4 4B×2 WD".
 * @param {Target} target @returns {string}
 */
export function describeTarget(target) {
  return target.layout.map(({ tile, count }) => (count > 1 ? `${toStr(tile)}×${count}` : toStr(tile))).join(' ');
}

/**
 * Check a card's structure and every hand. Returns a list of problems (empty if valid).
 * @param {unknown} card
 * @returns {{index: number|null, id: string|null, message: string, pos: number|null}[]}
 */
export function validateCard(card) {
  const errors = [];
  const cardError = (message) => errors.push({ index: null, id: null, message, pos: null });
  if (!card || typeof card !== 'object') {
    cardError('Card is not an object');
    return errors;
  }
  if (card.schema !== 1) cardError(`Unsupported card schema: ${card.schema}`);
  if (typeof card.name !== 'string' || card.name.trim() === '') cardError('Card needs a name');
  if (!Array.isArray(card.hands) || card.hands.length === 0) {
    cardError('Card needs at least one hand');
    return errors;
  }
  const ids = new Set();
  card.hands.forEach((hand, index) => {
    const id = hand && typeof hand.id === 'string' ? hand.id : null;
    const err = (message, pos = null) => errors.push({ index, id, message, pos });
    if (!hand || typeof hand !== 'object') return err('Hand is not an object');
    if (!id) err('Hand needs an id');
    else if (ids.has(id)) err(`Duplicate hand id "${id}"`);
    else ids.add(id);
    if (typeof hand.line !== 'string' || hand.line.trim() === '') err('Hand needs a line');
    if (!Number.isInteger(hand.value) || hand.value <= 0) err('Value must be a positive whole number');
    if (typeof hand.concealed !== 'boolean') err('concealed must be true or false');
    const numbersOk = hand.numbers === 'fixed' || hand.numbers === 'shift';
    if (!numbersOk) err('numbers must be "fixed" or "shift"');
    const hasLine = typeof hand.line === 'string' && hand.line.trim() !== '';
    if (!numbersOk || !(hand.pattern || hasLine)) return;
    try {
      if (expandHand(hand).length === 0) err('No legal way to make this hand with the tiles in a set');
    } catch (e) {
      if (!(e instanceof CardError)) throw e;
      err(e.detail, e.pos);
    }
  });
  return errors;
}
