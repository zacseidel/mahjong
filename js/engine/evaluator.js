// Distance to a hand, liveness, and weighted target ranking (SPEC §7).
// Used by AI, tips, and defense. Works only from observation data.

import { COPIES, KINDS, JOKER, toCounts } from './tiles.js';
import { expandCard, fitExposures } from './card.js';

/** Tuning constants for weighting targets (intermediate AI and tips). */
export const WEIGHTS = Object.freeze({
  topN: 5,              // targets an intermediate player tracks
  distanceFalloff: 0.4, // weight multiplier per extra tile of distance behind the best
  baseValue: 25,        // value that counts as weight 1
  minLiveFactor: 0.25,  // weight floor for a target whose needed tiles are all gone
  jokerPenalty: 0.01,   // tiny extra cost for throwing a joker, to prefer other free tiles
  considerBehind: 5,    // targets more than this many tiles behind the best are not ranked
});

/**
 * @typedef {Object} Evaluation
 * @property {import('./card.js').Target} target
 * @property {Int8Array} group        Group slots left after exposures.
 * @property {number} missingReal     Unfilled pair/single slots.
 * @property {number} missingGroup    Unfilled group slots.
 * @property {number} jokers          Jokers held.
 * @property {number} distance        missingReal + max(0, missingGroup − jokers).
 * @property {boolean} dead           A pair/single tile it needs has no unseen copies left.
 * @property {number} liveness        0–1: share of still-needed tiles that are unseen.
 * @property {Int8Array} have         The hand's concealed counts it was evaluated against.
 */

/**
 * Tiles visible to an observer: their own hand, every exposure, and the discard pile.
 * @param {{hand: number[], exposures: import('./card.js').Exposure[][], discards: {tile: number}[]}} obs
 * @returns {Int16Array}
 */
export function visibleCounts(obs) {
  const counts = new Int16Array(KINDS);
  for (const t of obs.hand) counts[t]++;
  for (const exposures of obs.exposures) {
    for (const e of exposures) {
      counts[e.tile] += e.count - e.jokers;
      counts[JOKER] += e.jokers;
    }
  }
  for (const d of obs.discards) counts[d.tile]++;
  return counts;
}

/**
 * Copies of each tile the observer hasn't seen (in the wall or other players' hands).
 * @returns {Int16Array}
 */
export function unseenCounts(obs) {
  const visible = visibleCounts(obs);
  const unseen = new Int16Array(KINDS);
  for (let t = 0; t < KINDS; t++) unseen[t] = Math.max(0, COPIES[t] - visible[t]);
  return unseen;
}

/**
 * Evaluate one concrete target for a hand (SPEC §7 steps 1–6).
 * @param {import('./card.js').Target} target
 * @param {Int8Array} have       Concealed tile counts, jokers included.
 * @param {import('./card.js').Exposure[]} exposures
 * @param {ArrayLike<number>} [unseen]  Unseen copies per tile; without it nothing is dead.
 * @returns {Evaluation|null}  null if the exposures don't fit the target.
 */
export function evaluateTarget(target, have, exposures, unseen) {
  const group = fitExposures(target, exposures);
  if (!group) return null;
  const jokers = have[JOKER];
  let missingReal = 0;
  let missingGroup = 0;
  let dead = false;
  let needTotal = 0;
  let needLive = 0;
  const unseenJokers = unseen ? unseen[JOKER] : 0;
  // Tiles the target doesn't use can't reduce distance, so only its own kinds matter.
  for (const t of target.kinds) {
    const s = target.single[t];
    const g = group[t];
    const realShort = Math.max(0, s - have[t]);
    const groupShort = Math.max(0, g - Math.max(0, have[t] - s));
    missingReal += realShort;
    missingGroup += groupShort;
    if (unseen) {
      if (realShort > unseen[t]) dead = true;
      needTotal += realShort + groupShort;
      needLive += Math.min(realShort, unseen[t]) + Math.min(groupShort, Math.max(0, unseen[t] - realShort) + unseenJokers);
    }
  }
  return {
    target,
    group,
    missingReal,
    missingGroup,
    jokers,
    distance: missingReal + Math.max(0, missingGroup - jokers),
    dead,
    liveness: needTotal === 0 ? 1 : needLive / needTotal,
    have,
  };
}

/**
 * Tiles still needed for an evaluation, one entry per copy (jokers can stand in for group tiles).
 * @param {Evaluation} e
 * @returns {{tile: number, pairOrSingle: boolean}[]}
 */
export function neededTiles(e) {
  const out = [];
  for (const t of e.target.kinds) {
    const s = e.target.single[t];
    const realShort = Math.max(0, s - e.have[t]);
    const groupShort = Math.max(0, e.group[t] - Math.max(0, e.have[t] - s));
    for (let k = 0; k < realShort; k++) out.push({ tile: t, pairOrSingle: true });
    for (let k = 0; k < groupShort; k++) out.push({ tile: t, pairOrSingle: false });
  }
  return out;
}

/**
 * Evaluate every target on the card that fits the hand's exposures, best first
 * (distance, then value, then liveness).
 * @param {{concealed: number[], exposures: import('./card.js').Exposure[]}} hand
 * @param {Object} card
 * @param {ArrayLike<number>} [unseen]
 * @param {{sort?: boolean}} [options]  sort: false skips sorting (callers that only need topTargets).
 * @returns {Evaluation[]}
 */
export function evaluateHand(hand, card, unseen, { sort = true } = {}) {
  const have = toCounts(hand.concealed);
  const out = [];
  for (const target of expandCard(card)) {
    const e = evaluateTarget(target, have, hand.exposures, unseen);
    if (e) out.push(e);
  }
  return sort ? out.sort(compareEvaluations) : out;
}

export function compareEvaluations(a, b) {
  return a.distance - b.distance || b.target.value - a.target.value || b.liveness - a.liveness;
}

/**
 * Evaluate an observer's own hand, with liveness from what they can see.
 * @param {import('./observe.js').Observation} obs
 * @returns {Evaluation[]}
 */
export function evaluateObservation(obs, options) {
  return evaluateHand({ concealed: obs.hand, exposures: obs.exposures[obs.seat] }, obs.card, unseenCounts(obs), options);
}

/**
 * How much removing one copy of `tile` increases an evaluation's distance (0 or 1).
 * @param {Evaluation} e
 * @param {Int8Array} have
 * @param {number} tile
 * @returns {number}
 */
export function removalCost(e, have, tile) {
  if (tile === JOKER) return e.missingGroup > e.jokers - 1 ? 1 : 0;
  const s = e.target.single[tile];
  if (have[tile] <= s) return 1;
  if (have[tile] - s <= e.group[tile]) return e.missingGroup >= e.jokers ? 1 : 0;
  return 0;
}

/**
 * Weight of each evaluation for a player tracking several targets: value, liveness, and
 * closeness to the best one. Dead targets weigh 0.
 * @param {Evaluation[]} evals  Sorted best first.
 * @returns {number[]}
 */
export function targetWeights(evals) {
  const best = bestDistance(evals);
  return evals.map((e) => {
    if (e.dead) return 0;
    const live = WEIGHTS.minLiveFactor + (1 - WEIGHTS.minLiveFactor) * e.liveness;
    return (e.target.value / WEIGHTS.baseValue) * live * WEIGHTS.distanceFalloff ** (e.distance - best);
  });
}

function bestDistance(evals) {
  let best = Infinity;
  for (const e of evals) if (!e.dead && e.distance < best) best = e.distance;
  return best;
}

/**
 * The top-N targets by weight, with their weights. Distinct card hands are preferred, so the
 * list isn't five suit variants of one hand.
 * @param {Evaluation[]} evals
 * @param {number} [n]
 * @returns {{evaluation: Evaluation, weight: number}[]}
 */
export function topTargets(evals, n = WEIGHTS.topN) {
  // Targets far behind the best weigh almost nothing; skip them before sorting.
  const best = bestDistance(evals);
  const near = evals.filter((e) => e.distance <= best + WEIGHTS.considerBehind);
  const weights = targetWeights(near);
  const ranked = near.map((evaluation, i) => ({ evaluation, weight: weights[i] }))
    .filter((x) => x.weight > 0)
    .sort((a, b) => b.weight - a.weight || compareEvaluations(a.evaluation, b.evaluation));
  const out = [];
  const seen = new Set();
  for (const x of ranked) {
    if (seen.has(x.evaluation.target.handId)) continue;
    seen.add(x.evaluation.target.handId);
    out.push(x);
    if (out.length === n) break;
  }
  return out;
}

/**
 * Cost of discarding each distinct tile in the hand: the weighted increase in distance over the
 * tracked targets. Lower is better.
 * @param {number[]} concealed
 * @param {{evaluation: Evaluation, weight: number}[]} tracked
 * @returns {{tile: number, cost: number}[]}  Sorted cheapest first.
 */
export function discardCosts(concealed, tracked) {
  const have = toCounts(concealed);
  const out = [];
  for (let t = 0; t < KINDS; t++) {
    if (!have[t]) continue;
    let cost = t === JOKER ? WEIGHTS.jokerPenalty : 0;
    for (const { evaluation, weight } of tracked) cost += weight * removalCost(evaluation, have, t);
    out.push({ tile: t, cost });
  }
  return out.sort((a, b) => a.cost - b.cost);
}
