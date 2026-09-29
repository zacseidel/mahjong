// Calls, call priority, joker exchanges, Mah Jongg checks, and dead hands (SPEC §4.4–4.7).
// Functions here are pure: they take plain player data and return new data, never mutating input.

import { JOKER } from './tiles.js';
import { expandCard, fitExposures, matchHand, HAND_SIZE } from './card.js';
import { turnDistance } from './seats.js';

/**
 * @typedef {import('./card.js').Exposure} Exposure
 * @typedef {import('./card.js').Target} Target
 * @typedef {import('./rules-config.js').Rules} Rules
 *
 * @typedef {Object} Player
 * @property {number[]} concealed   Concealed tile ids, jokers included.
 * @property {Exposure[]} exposures  Exposed groups: {tile, count, jokers}.
 * @property {boolean} [dead]
 *
 * @typedef {{type: 'mahjong', matches: {target: Target, jokerless: boolean}[]}
 *   | {type: 'expose', tile: number, count: number, minJokers: number, maxJokers: number}} CallOption
 *
 * @typedef {{seat: number, type: 'mahjong'|'expose'}} Claim
 */

const MAX_GROUP = 8;

function countOf(tiles, id) {
  let n = 0;
  for (const t of tiles) if (t === id) n++;
  return n;
}

/** Remove `n` copies of `id` (first occurrences). Throws if there aren't enough. */
function removeTiles(tiles, id, n) {
  const out = tiles.slice();
  for (let k = 0; k < n; k++) {
    const i = out.indexOf(id);
    if (i < 0) throw new Error(`Player doesn't hold ${n} of tile ${id}`);
    out.splice(i, 1);
  }
  return out;
}

/**
 * Tiles a player holds, concealed plus exposed.
 * @param {Player} player @returns {number}
 */
export function handSize(player) {
  return player.exposures.reduce((n, e) => n + e.count, player.concealed.length);
}

/**
 * Card targets that the player's exposures still fit. With no exposures, every target fits.
 * @param {{hands: Object[]}} card
 * @param {Exposure[]} exposures
 * @returns {Target[]}
 */
export function targetsFittingExposures(card, exposures) {
  return expandCard(card).filter((t) => fitExposures(t, exposures) !== null);
}

/**
 * Winning matches for a player's 14 tiles on their own turn (self-drawn or after exchanges).
 * @param {Player} player
 * @param {{hands: Object[]}} card
 * @returns {{target: Target, jokerless: boolean}[]}  Empty if the hand isn't Mah Jongg.
 */
export function mahJonggMatches(player, card) {
  if (player.dead) return [];
  return matchHand(card, player);
}

/**
 * Legal ways for a player to call a discard. A discarded joker can't be called; dead players
 * can't call. Mah Jongg: the discard completes the hand (a concealed target only if
 * rules.concealedCanCallForMahJongg). Exposure: 3 or more of the discarded tile, the rest from
 * the player's real copies and jokers, and the new exposure must still fit some exposed hand
 * on the card alongside the player's existing exposures.
 * @param {Player} player
 * @param {number} discard
 * @param {{hands: Object[]}} card
 * @param {Rules} rules
 * @returns {CallOption[]}
 */
export function legalCalls(player, discard, card, rules) {
  if (player.dead || discard === JOKER) return [];
  const options = [];

  const withDiscard = { concealed: [...player.concealed, discard], exposures: player.exposures };
  const matches = matchHand(card, withDiscard).filter(
    (m) => rules.concealedCanCallForMahJongg || !m.target.concealed,
  );
  if (matches.length) options.push({ type: 'mahjong', matches });

  const real = countOf(player.concealed, discard);
  const jokers = countOf(player.concealed, JOKER);
  const fitting = targetsFittingExposures(card, player.exposures).filter((t) => !t.concealed);
  for (let count = 3; count <= Math.min(MAX_GROUP, real + jokers + 1); count++) {
    const exposures = [...player.exposures, { tile: discard, count, jokers: 0 }];
    if (!fitting.some((t) => fitExposures(t, exposures))) continue;
    const need = count - 1;
    options.push({
      type: 'expose',
      tile: discard,
      count,
      minJokers: Math.max(0, need - real),
      maxJokers: Math.min(jokers, need),
    });
  }
  return options;
}

/**
 * Pick the winning claim on a discard (SPEC §4.4). With rules.mahJonggBeatsExposure, a Mah
 * Jongg claim beats any exposure claim; ties (and every claim when the rule is off) go to the
 * player next in turn after the discarder. Claims by the discarder are ignored.
 * @param {number} discarder
 * @param {Claim[]} claims
 * @param {Rules} rules
 * @returns {Claim|null}
 */
export function resolveClaims(discarder, claims, rules) {
  let best = null;
  for (const c of claims) {
    if (c.seat === discarder) continue;
    if (!best || beats(c, best, discarder, rules)) best = c;
  }
  return best;
}

function beats(a, b, discarder, rules) {
  if (rules.mahJonggBeatsExposure && a.type !== b.type) return a.type === 'mahjong';
  return turnDistance(discarder, a.seat) < turnDistance(discarder, b.seat);
}

/**
 * Expose a called discard: the discard plus (count − 1 − jokers) real copies and `jokers` jokers
 * from the player's concealed tiles.
 * @param {Player} player
 * @param {number} discard
 * @param {number} count
 * @param {number} jokers
 * @returns {Player}
 */
export function applyExposure(player, discard, count, jokers) {
  if (discard === JOKER) throw new Error('A discarded joker cannot be called');
  if (!Number.isInteger(count) || count < 3) throw new Error('An exposure needs 3 or more tiles');
  if (!Number.isInteger(jokers) || jokers < 0 || jokers > count - 1) throw new Error(`Bad joker count ${jokers}`);
  let concealed = removeTiles(player.concealed, discard, count - 1 - jokers);
  concealed = removeTiles(concealed, JOKER, jokers);
  return { ...player, concealed, exposures: [...player.exposures, { tile: discard, count, jokers }] };
}

/**
 * Joker exchanges available to a player on their own turn: any exposure (theirs or another
 * player's) holding a joker, where the player has a real copy of the exposure's tile.
 * @param {Player} player
 * @param {Exposure[][]} exposuresBySeat
 * @returns {{seat: number, index: number, tile: number}[]}
 */
export function jokerExchanges(player, exposuresBySeat) {
  if (player.dead) return [];
  const out = [];
  exposuresBySeat.forEach((exposures, seat) => {
    exposures.forEach((e, index) => {
      if (e.jokers > 0 && player.concealed.includes(e.tile)) out.push({ seat, index, tile: e.tile });
    });
  });
  return out;
}

/**
 * Apply a joker exchange: the actor puts a real tile into an exposure and takes its joker.
 * @param {Player[]} players  Indexed by seat.
 * @param {number} actor
 * @param {{seat: number, index: number}} exchange
 * @returns {Player[]}  New players array; untouched players are the same objects.
 */
export function applyJokerExchange(players, actor, { seat, index }) {
  const exposure = players[seat].exposures[index];
  if (!exposure || exposure.jokers < 1) throw new Error('That exposure has no joker');
  if (!players[actor].concealed.includes(exposure.tile)) throw new Error("Player doesn't hold the matching tile");
  const out = players.slice();
  const exposures = players[seat].exposures.slice();
  exposures[index] = { ...exposure, jokers: exposure.jokers - 1 };
  out[seat] = { ...players[seat], exposures };
  const concealed = [...removeTiles(out[actor].concealed, exposure.tile, 1), JOKER];
  out[actor] = { ...out[actor], concealed };
  return out;
}

/**
 * Why a player's hand is dead, or null if it isn't (SPEC §4.7): their exposures fit no exposed
 * hand on the card, or they hold the wrong number of tiles.
 * @param {Player} player
 * @param {{hands: Object[]}} card
 * @param {number} [expectedSize]  13 between turns, 14 on the player's turn before discarding.
 * @returns {'count'|'exposures'|null}
 */
export function deadHandReason(player, card, expectedSize) {
  const size = handSize(player);
  if (expectedSize !== undefined ? size !== expectedSize : size !== HAND_SIZE && size !== HAND_SIZE - 1) {
    return 'count';
  }
  if (player.exposures.length && targetsFittingExposures(card, player.exposures).length === 0) return 'exposures';
  return null;
}
