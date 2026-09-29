// The Charleston (SPEC §4.2): pass rounds, blind passes, and the courtesy pass.
// Pure functions: they take hands and choices and return new hands.

import { JOKER } from './tiles.js';
import { rightOf, acrossOf, leftOf } from './seats.js';

/** @typedef {'right'|'across'|'left'} Direction */

/** The six pass rounds, in order. Rounds 3–5 are the optional second Charleston. */
export const ROUNDS = Object.freeze([
  Object.freeze({ charleston: 1, direction: 'right', blind: false }),
  Object.freeze({ charleston: 1, direction: 'across', blind: false }),
  Object.freeze({ charleston: 1, direction: 'left', blind: true }),
  Object.freeze({ charleston: 2, direction: 'left', blind: false }),
  Object.freeze({ charleston: 2, direction: 'across', blind: false }),
  Object.freeze({ charleston: 2, direction: 'right', blind: true }),
]);

export const PASS_SIZE = 3;

/**
 * Seat that `seat` passes to.
 * @param {number} seat @param {Direction} direction @returns {number}
 */
export function passTarget(seat, direction) {
  return direction === 'right' ? rightOf(seat) : direction === 'left' ? leftOf(seat) : acrossOf(seat);
}

/**
 * Seat that passes to `seat`.
 * @param {number} seat @param {Direction} direction @returns {number}
 */
export function passSource(seat, direction) {
  return direction === 'right' ? leftOf(seat) : direction === 'left' ? rightOf(seat) : acrossOf(seat);
}

/** Remove the given tiles (a multiset) from a hand. Throws if any is missing. */
function removeAll(hand, tiles) {
  const out = hand.slice();
  for (const t of tiles) {
    const i = out.indexOf(t);
    if (i < 0) throw new Error(`Tile ${t} is not in the hand`);
    out.splice(i, 1);
  }
  return out;
}

/**
 * Check that passed tiles come from the hand and include no jokers.
 * @param {number[]} hand @param {number[]} tiles
 */
export function checkPassTiles(hand, tiles) {
  if (tiles.includes(JOKER)) throw new Error('Jokers may never be passed');
  removeAll(hand, tiles);
}

/**
 * Check one player's pass choice. `tiles` come from their hand; `blind` is how many of the
 * incoming tiles they forward unseen. Together they make exactly 3. Jokers are never passed.
 * @param {number[]} hand
 * @param {{tiles: number[], blind?: number}} choice
 * @param {boolean} blindAllowed
 */
export function checkPassChoice(hand, choice, blindAllowed) {
  const blind = choice.blind ?? 0;
  if (!Number.isInteger(blind) || blind < 0 || blind > PASS_SIZE) throw new Error(`Bad blind count ${blind}`);
  if (blind > 0 && !blindAllowed) throw new Error('A blind pass is not allowed in this round');
  if (!Array.isArray(choice.tiles) || choice.tiles.length + blind !== PASS_SIZE) {
    throw new Error(`A pass is exactly ${PASS_SIZE} tiles`);
  }
  checkPassTiles(hand, choice.tiles);
}

/**
 * Resolve one simultaneous pass round.
 * A player who blinds k tiles forwards the first k tiles they receive, unseen, and keeps the rest.
 * Forwarded tiles are traced back to whoever passed them from their own hand. If all four
 * players blind all 3, no tile leaves anyone's hand, so nothing moves.
 * @param {number[][]} hands  Indexed by seat.
 * @param {Direction} direction
 * @param {{tiles: number[], blind?: number}[]} choices  Indexed by seat.
 * @param {boolean} [blindAllowed]
 * @returns {{hands: number[][], sent: number[][], received: number[][]}}
 *   sent[s]: tiles s passed; received[s]: tiles s received (those it forwarded come first).
 */
export function resolvePass(hands, direction, choices, blindAllowed = false) {
  choices.forEach((c, seat) => checkPassChoice(hands[seat], c, blindAllowed));
  const own = choices.map((c) => c.tiles);
  const blind = choices.map((c) => c.blind ?? 0);

  if (own.every((t) => t.length === 0)) {
    return { hands: hands.map((h) => h.slice()), sent: [[], [], [], []], received: [[], [], [], []] };
  }

  // Slot j of seat s's outgoing pass: an own tile, or incoming slot (j − own) from s's source.
  const slot = (s, j) => {
    for (let guard = 0; guard < 16; guard++) {
      if (j < own[s].length) return own[s][j];
      j -= own[s].length;
      s = passSource(s, direction);
    }
    throw new Error('Unresolvable blind pass');
  };
  const sent = [0, 1, 2, 3].map((s) => Array.from({ length: PASS_SIZE }, (_, j) => slot(s, j)));
  const received = [0, 1, 2, 3].map((s) => sent[passSource(s, direction)]);
  const next = hands.map((h, s) => [...removeAll(h, own[s]), ...received[s].slice(blind[s])]);
  return { hands: next, sent, received };
}

/**
 * Tiles traded between partners across, from their requests (0–3 each).
 * @param {number} a @param {number} b
 * @param {'min'|'off'} mode  rules.courtesyPass
 * @returns {number}
 */
export function courtesyCount(a, b, mode) {
  if (mode === 'off') return 0;
  for (const n of [a, b]) if (!Number.isInteger(n) || n < 0 || n > PASS_SIZE) throw new Error(`Bad courtesy request ${n}`);
  return Math.min(a, b); // [verify] the smaller number requested is used
}

/**
 * Resolve the courtesy pass: each player gives `counts[seat]` tiles to the player across.
 * @param {number[][]} hands
 * @param {number[][]} choices  Tiles each seat passes across.
 * @param {number[]} counts     Agreed count per seat (partners share a count).
 * @returns {{hands: number[][], sent: number[][], received: number[][]}}
 */
export function resolveCourtesy(hands, choices, counts) {
  choices.forEach((tiles, seat) => {
    if (tiles.length !== counts[seat]) throw new Error(`Courtesy pass must be ${counts[seat]} tiles`);
    if (tiles.includes(JOKER)) throw new Error('Jokers may never be passed');
  });
  const received = [0, 1, 2, 3].map((s) => choices[acrossOf(s)].slice());
  const next = hands.map((h, s) => [...removeAll(h, choices[s]), ...received[s]]);
  return { hands: next, sent: choices.map((c) => c.slice()), received };
}
