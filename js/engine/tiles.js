// Tile ids, helpers, and string forms (SPEC §3).

/** Suits. */
export const CRAK = 0;
export const BAM = 1;
export const DOT = 2;
export const SUITS = [CRAK, BAM, DOT];

/** Id ranges. Number tiles: suit * 9 + (rank - 1). */
export const NUM_START = 0;
export const NUM_END = 26;
export const NORTH_WIND = 27;
export const EAST_WIND = 28;
export const WEST_WIND = 29;
export const SOUTH_WIND = 30;
export const RED_DRAGON = 31;
export const GREEN_DRAGON = 32;
export const WHITE_DRAGON = 33;
export const FLOWER = 34;
export const JOKER = 35;

/** Number of distinct tile kinds (length of a count array). */
export const KINDS = 36;

/** Copies of each kind in a full set. */
export const COPIES = Object.freeze(
  Array.from({ length: KINDS }, (_, id) => (id === FLOWER || id === JOKER ? 8 : 4)),
);

/** Tiles in a full set. */
export const TOTAL = 152;

const SUIT_LETTERS = ['C', 'B', 'D'];
const SUIT_NAMES = ['Crak', 'Bam', 'Dot'];
const HONOR_CODES = { 27: 'NW', 28: 'EW', 29: 'WW', 30: 'SW', 31: 'RD', 32: 'GD', 33: 'WD', 34: 'F', 35: 'J' };
const HONOR_NAMES = {
  27: 'North Wind', 28: 'East Wind', 29: 'West Wind', 30: 'South Wind',
  31: 'Red Dragon', 32: 'Green Dragon', 33: 'Soap', 34: 'Flower', 35: 'Joker',
};
const CODE_TO_ID = new Map();
for (let id = 0; id < KINDS; id++) CODE_TO_ID.set(toStr(id), id);

function checkId(id) {
  if (!Number.isInteger(id) || id < 0 || id >= KINDS) throw new RangeError(`Not a tile id: ${id}`);
}

/** @param {number} id @returns {boolean} */
export function isNumber(id) {
  return id >= NUM_START && id <= NUM_END;
}

/** @param {number} id @returns {boolean} */
export function isWind(id) {
  return id >= NORTH_WIND && id <= SOUTH_WIND;
}

/** @param {number} id @returns {boolean} */
export function isDragon(id) {
  return id >= RED_DRAGON && id <= WHITE_DRAGON;
}

/** @param {number} id @returns {boolean} */
export function isFlower(id) {
  return id === FLOWER;
}

/** @param {number} id @returns {boolean} */
export function isJoker(id) {
  return id === JOKER;
}

/**
 * Suit of a number tile, or null for anything else.
 * @param {number} id @returns {number|null}
 */
export function suitOf(id) {
  return isNumber(id) ? Math.floor(id / 9) : null;
}

/**
 * Rank 1–9 of a number tile, or null for anything else.
 * (Soap-as-zero is a card-notation concept and lives in card.js.)
 * @param {number} id @returns {number|null}
 */
export function rankOf(id) {
  return isNumber(id) ? (id % 9) + 1 : null;
}

/**
 * Id of the number tile with this suit and rank.
 * @param {number} suit @param {number} rank 1–9 @returns {number}
 */
export function numberTile(suit, rank) {
  if (!SUITS.includes(suit) || !Number.isInteger(rank) || rank < 1 || rank > 9) {
    throw new RangeError(`Bad number tile: suit ${suit}, rank ${rank}`);
  }
  return suit * 9 + rank - 1;
}

/**
 * Dragon paired with a suit: Crak ↔ Red, Bam ↔ Green, Dot ↔ White.
 * @param {number} suit @returns {number}
 */
export function dragonForSuit(suit) {
  if (!SUITS.includes(suit)) throw new RangeError(`Not a suit: ${suit}`);
  return RED_DRAGON + suit;
}

/**
 * Suit paired with a dragon.
 * @param {number} id @returns {number}
 */
export function suitForDragon(id) {
  if (!isDragon(id)) throw new RangeError(`Not a dragon: ${id}`);
  return id - RED_DRAGON;
}

/**
 * Compact code: 3C, 7B, 5D, NW, EW, WW, SW, RD, GD, WD, F, J.
 * @param {number} id @returns {string}
 */
export function toStr(id) {
  checkId(id);
  return isNumber(id) ? `${rankOf(id)}${SUIT_LETTERS[suitOf(id)]}` : HONOR_CODES[id];
}

/**
 * Inverse of toStr. Throws on an unknown code.
 * @param {string} code @returns {number}
 */
export function fromStr(code) {
  const id = CODE_TO_ID.get(code);
  if (id === undefined) throw new Error(`Unknown tile code: "${code}"`);
  return id;
}

/**
 * Parse a space-separated list of codes, e.g. "3C 3C J".
 * @param {string} text @returns {number[]}
 */
export function parseTiles(text) {
  const trimmed = text.trim();
  return trimmed === '' ? [] : trimmed.split(/\s+/).map(fromStr);
}

/**
 * Format ids as a space-separated list of codes.
 * @param {Iterable<number>} ids @returns {string}
 */
export function formatTiles(ids) {
  return Array.from(ids, toStr).join(' ');
}

/**
 * Human-readable name, e.g. "3 Crak", "North Wind", "Soap".
 * @param {number} id @returns {string}
 */
export function displayName(id) {
  checkId(id);
  return isNumber(id) ? `${rankOf(id)} ${SUIT_NAMES[suitOf(id)]}` : HONOR_NAMES[id];
}

/**
 * Count array (length KINDS) from a list of ids.
 * @param {Iterable<number>} ids @returns {Int8Array}
 */
export function toCounts(ids) {
  const counts = new Int8Array(KINDS);
  for (const id of ids) {
    checkId(id);
    counts[id]++;
  }
  return counts;
}

/**
 * Sorted list of ids from a count array.
 * @param {ArrayLike<number>} counts @returns {number[]}
 */
export function fromCounts(counts) {
  const ids = [];
  for (let id = 0; id < KINDS; id++) {
    for (let k = 0; k < counts[id]; k++) ids.push(id);
  }
  return ids;
}

/**
 * All 152 tiles, sorted by id.
 * @returns {number[]}
 */
export function fullSet() {
  return fromCounts(COPIES);
}
