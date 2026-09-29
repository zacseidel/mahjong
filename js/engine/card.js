// Card hands: parse line notation, compile to a pattern, expand to concrete targets, match (SPEC §5).

import {
  COPIES, KINDS, JOKER, FLOWER, NORTH_WIND, EAST_WIND, WEST_WIND, SOUTH_WIND, WHITE_DRAGON,
  SUITS, numberTile, dragonForSuit, toStr, toCounts,
} from './tiles.js';

export const HAND_SIZE = 14;
const COLORS = 'grb';
const ANY_SUIT = 'x';
const SUFFIXES = COLORS + ANY_SUIT;
const FIXED_CHARS = { 0: WHITE_DRAGON, F: FLOWER, N: NORTH_WIND, E: EAST_WIND, W: WEST_WIND, S: SOUTH_WIND };
const MAX_JOKERS = COPIES[JOKER];
const MAX_VARIANTS = 64;

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
 *   Suit variables starting with '*' are free ("any suit"): each takes any suit, independently,
 *   and may match another group's suit. Other suit variables take distinct suits.
 *
 * @typedef {Object} Variant  One way to read a hand (a hand with "/" alternatives has several).
 * @property {Slot[]} slots
 * @property {string[]} suitVars  Distinct (colored) suit variables, in order of first use.
 * @property {string[]} freeVars  Free ("any suit") variables.
 * @property {Record<string, number[]>} numVars  Allowed values per number variable.
 *
 * @typedef {Variant & {variants: Variant[]}} Pattern  The first variant's fields, plus every variant.
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
 * @property {number[]} kinds       Tile ids this target uses (single or group), ascending.
 * @property {string} key          Identity for de-duplication.
 *
 * @typedef {{tile: number, count: number, jokers: number}} Exposure
 */

function checkLowest(lowest, numbers) {
  if (lowest == null) return null;
  if (numbers !== 'shift') throw new CardError('A limit on the lowest number only applies to “any numbers” hands');
  if (!Array.isArray(lowest) || !lowest.length || !lowest.every((x) => Number.isInteger(x) && x >= 1 && x <= 9)) {
    throw new CardError('The lowest-number limit must be a list of numbers from 1 to 9');
  }
  return lowest;
}

/** Parse one group token (no "/"), starting at `start` in the line. */
function parseToken(token, start, numbers, freshFree) {
  let body = token;
  let suffix = null;
  if (SUFFIXES.includes(token[token.length - 1])) {
    suffix = token[token.length - 1];
    body = token.slice(0, -1);
  }
  if (body === '') throw new CardError(`"${token}" has a color but no tiles`, start);
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (SUFFIXES.includes(ch)) throw new CardError(`Color "${ch}" must come at the end of a group`, start + i);
    if (!isTileChar(ch)) throw new CardError(`Unknown character "${ch}"`, start + i);
  }
  if (!suffix && [...body].some(needsColor)) {
    throw new CardError(`"${token}" needs a color (g, r, or b; x for any suit) because it has numbers or dragons`, start);
  }
  const suitVar = suffix === ANY_SUIT ? freshFree() : suffix;
  const same = [...body].every((c) => c === body[0]);
  const pieces = same ? [[body[0], body.length]] : [...body].map((c) => [c, 1]);
  return pieces.map(([ch, count]) => {
    if (ch >= '1' && ch <= '9') return { kind: 'num', suitVar, numVar: numbers === 'shift' ? 's' : null, offset: Number(ch), count };
    if (ch === 'D') return { kind: 'dragon', suitVar, count };
    return { kind: 'fixed', tile: FIXED_CHARS[ch], count };
  });
}

/** For an "any numbers" variant: every shift that keeps all digits in 1–9 (and meets `lowest`). */
function shiftValues(slots, lowest) {
  const digits = slots.filter((x) => x.kind === 'num' && x.numVar === 's').map((x) => x.offset);
  if (!digits.length) return {};
  const lo = Math.min(...digits);
  const hi = Math.max(...digits);
  const values = [];
  for (let s = 1 - lo; s <= 9 - hi; s++) if (!lowest || lowest.includes(lo + s)) values.push(s);
  return { s: values };
}

/**
 * Parse a line in the §5.3 notation.
 * Extensions: "a/b" in one group means either group a or group b; the suffix "x" means any suit
 * (independent of the other groups, so "DDx" is any dragon).
 * @param {string} line
 * @param {'fixed'|'shift'} [numbers]
 * @param {{lowest?: number[]|null}} [options]  For "shift": allowed values of the lowest number.
 * @returns {Pattern}
 */
export function parseLine(line, numbers = 'fixed', { lowest = null } = {}) {
  if (numbers !== 'fixed' && numbers !== 'shift') throw new CardError(`numbers must be "fixed" or "shift", not "${numbers}"`);
  const allowedLowest = checkLowest(lowest, numbers);
  if (typeof line !== 'string' || line.trim() === '') throw new CardError('The line is empty');

  let free = 0;
  const freshFree = () => `*${++free}`;
  const choices = []; // per group: the alternatives, each a list of slots
  const re = /\S+/g;
  let m;
  while ((m = re.exec(line))) {
    const token = m[0];
    let pos = m.index;
    const alternatives = token.split('/').map((part) => {
      const at = pos;
      pos += part.length + 1;
      if (part === '') throw new CardError(`"${token}" has an empty alternative around "/"`, at);
      return parseToken(part, at, numbers, freshFree);
    });
    choices.push(alternatives);
  }

  let variants = [[]];
  for (const alternatives of choices) {
    variants = variants.flatMap((v) => alternatives.map((slots) => [...v, ...slots]));
    if (variants.length > MAX_VARIANTS) throw new CardError(`Too many “/” alternatives (more than ${MAX_VARIANTS} combinations); split this into separate hands`);
  }
  return finishPattern(variants.map((slots) => ({ slots, numVars: numbers === 'shift' ? shiftValues(slots, allowedLowest) : {} })));
}

function isTileChar(ch) {
  return (ch >= '1' && ch <= '9') || ch === 'D' || ch in FIXED_CHARS;
}

function needsColor(ch) {
  return (ch >= '1' && ch <= '9') || ch === 'D';
}

function finishPattern(raw) {
  const variants = raw.map(({ slots, numVars }, i) => {
    const total = slots.reduce((n, x) => n + x.count, 0);
    if (total !== HAND_SIZE) {
      const which = raw.length > 1 ? `Alternative ${i + 1} of this hand has` : 'Hand has';
      throw new CardError(`${which} ${total} tiles; it needs ${HAND_SIZE}`);
    }
    const suitVars = [];
    const freeVars = [];
    for (const x of slots) {
      if (x.kind === 'fixed') continue;
      const list = x.suitVar.startsWith('*') ? freeVars : suitVars;
      if (!list.includes(x.suitVar)) list.push(x.suitVar);
    }
    if (suitVars.length > SUITS.length) throw new CardError(`Hand uses ${suitVars.length} colors; there are only 3 suits`);
    return { slots, suitVars, freeVars, numVars };
  });
  return { ...variants[0], variants };
}

/** A constraint as a list of allowed values: [low, high], {from, to}, or {oneOf: [...]}. */
function constraintValues(name, c) {
  const inRange = (x) => Number.isInteger(x) && x >= 1 && x <= 9;
  let lo;
  let hi;
  if (Array.isArray(c) && c.length === 2) [lo, hi] = c;
  else if (c && typeof c === 'object' && 'oneOf' in c) {
    if (!Array.isArray(c.oneOf) || !c.oneOf.length || !c.oneOf.every(inRange)) {
      throw new CardError(`Constraint on "${name}": oneOf must list numbers from 1 to 9`);
    }
    return [...new Set(c.oneOf)].sort((a, b) => a - b);
  } else if (c && typeof c === 'object') ({ from: lo, to: hi } = c);
  if (!inRange(lo) || !inRange(hi) || lo > hi) {
    throw new CardError(`Constraint on "${name}" must be [low, high], {"from", "to"}, or {"oneOf": [...]} within 1–9`);
  }
  return Array.from({ length: hi - lo + 1 }, (_, k) => lo + k);
}

/**
 * Parse the advanced compiled-group format (§5.3):
 * `{ groups: [{ tile: "n+1", suit: "A", count: 3 }, ...], constraints: { n: [1, 8] } }`.
 * `tile` is a digit 1–9, a number variable (one lowercase letter) with an optional +k/−k,
 * or 0, F, N, E, W, S, D. Numbers and D need a `suit`: a variable name (different names are
 * different suits) or "*" for any suit. Variables default to 1–9; a constraint may be
 * [low, high], {"from": low, "to": high}, or {"oneOf": [values]}.
 * @param {Object} pattern
 * @returns {Pattern}
 */
export function parsePattern(pattern) {
  if (!pattern || typeof pattern !== 'object' || !Array.isArray(pattern.groups) || pattern.groups.length === 0) {
    throw new CardError('Advanced pattern needs a non-empty "groups" array');
  }
  const slots = [];
  const used = new Set();
  let free = 0;
  pattern.groups.forEach((g, i) => {
    const where = `Group ${i + 1}`;
    if (!g || typeof g !== 'object') throw new CardError(`${where} is not an object`);
    if (!Number.isInteger(g.count) || g.count < 1) throw new CardError(`${where}: count must be a positive integer`);
    const tile = String(g.tile ?? '');
    let suit = typeof g.suit === 'string' && g.suit !== '' ? g.suit : null;
    if (suit === '*') suit = `*${++free}`;
    else if (suit?.startsWith('*')) throw new CardError(`${where}: suit names can’t start with "*" (use "*" alone for any suit)`);
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
  for (const name of used) numVars[name] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
  const constraints = pattern.constraints ?? {};
  if (typeof constraints !== 'object') throw new CardError('"constraints" must be an object');
  for (const [name, c] of Object.entries(constraints)) {
    if (!used.has(name)) throw new CardError(`Constraint on "${name}", which no group uses`);
    numVars[name] = constraintValues(name, c);
  }
  return finishPattern([{ slots, numVars }]);
}

/**
 * Compile a card hand: its advanced `pattern` if present, else its `line`.
 * @param {{line?: string, numbers?: 'fixed'|'shift', lowest?: number[], pattern?: Object}} hand
 * @returns {Pattern}
 */
export function compileHand(hand) {
  return hand.pattern ? parsePattern(hand.pattern) : parseLine(hand.line, hand.numbers ?? 'fixed', { lowest: hand.lowest ?? null });
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

/** Every way to give `k` free variables any suit (repeats allowed). */
function freeAssignments(k) {
  let out = [[]];
  for (let i = 0; i < k; i++) out = out.flatMap((rest) => SUITS.map((s) => [...rest, s]));
  return out;
}

/** Cartesian product of number-variable values. */
function numAssignments(numVars) {
  let out = [{}];
  for (const [name, values] of Object.entries(numVars)) {
    out = out.flatMap((partial) => values.map((x) => ({ ...partial, [name]: x })));
  }
  return out;
}

/**
 * All legal concrete instantiations of a pattern (every variant), de-duplicated.
 * @param {Pattern} pattern
 * @param {{id?: string, value?: number, concealed?: boolean}} [hand]
 * @returns {Target[]}
 */
export function expandPattern(pattern, hand = {}) {
  const targets = [];
  const seen = new Set();
  for (const variant of pattern.variants ?? [pattern]) {
    const freeVars = variant.freeVars ?? [];
    for (const nums of numAssignments(variant.numVars)) {
      for (const perm of suitAssignments(variant.suitVars.length)) {
        for (const freePerm of freeAssignments(freeVars.length)) {
          const suitOfVar = Object.fromEntries([
            ...variant.suitVars.map((v, i) => [v, perm[i]]),
            ...freeVars.map((v, i) => [v, freePerm[i]]),
          ]);
          const layout = [];
          let ok = true;
          for (const slot of variant.slots) {
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
    kinds: [...new Set(layout.map((x) => x.tile))].sort((a, b) => a - b),
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
 * @returns {Int8Array|null}  Per-tile group counts left for concealed tiles, or null if they don't
 *   fit. Treat it as read-only: with no exposures it is the target's own array.
 */
export function fitExposures(target, exposures) {
  if (exposures.length === 0) return target.group;
  if (target.concealed) return null;
  for (const e of exposures) if (target.group[e.tile] < e.count) return null; // cheap reject
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
  const total = exposures.reduce((n, e) => n + e.count, concealed.length);
  return total === HAND_SIZE && matchCounts(target, toCounts(concealed), exposures);
}

/** matchTarget for a hand already known to hold 14 tiles, with concealed tiles as counts. */
function matchCounts(target, counts, exposures) {
  const group = fitExposures(target, exposures);
  if (!group) return false;
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
  if (exposures.reduce((n, e) => n + e.count, hand.concealed.length) !== HAND_SIZE) return [];
  const counts = toCounts(hand.concealed);
  const jokerless = counts[JOKER] === 0 && exposures.every((e) => e.jokers === 0);
  return expandCard(card)
    .filter((t) => matchCounts(t, counts, exposures))
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
