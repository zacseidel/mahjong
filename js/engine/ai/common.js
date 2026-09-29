// Helpers shared by the AI levels. Everything here works from observations only.

import { JOKER, toCounts } from '../tiles.js';
import { evaluateTarget } from '../evaluator.js';

/** Remove one copy of each listed tile. */
export function without(tiles, remove) {
  const out = tiles.slice();
  for (const t of remove) {
    const i = out.indexOf(t);
    if (i >= 0) out.splice(i, 1);
  }
  return out;
}

/** Pick one item uniformly with the seeded rng. */
export function choose(rng, items) {
  return items[rng.int(items.length)];
}

/**
 * The hand after exposing a called discard (before the caller's discard).
 * @returns {{concealed: number[], exposures: import('../card.js').Exposure[]}}
 */
export function afterExposure(obs, option, jokers) {
  const real = option.count - 1 - jokers;
  let concealed = obs.hand.slice();
  concealed = without(concealed, Array(real).fill(option.tile));
  concealed = without(concealed, Array(jokers).fill(JOKER));
  const exposures = [...obs.exposures[obs.seat], { tile: option.tile, count: option.count, jokers }];
  return { concealed, exposures };
}

/**
 * Re-evaluate a list of tracked targets for a different hand.
 * @returns {{evaluation: import('../evaluator.js').Evaluation, weight: number}[]}  Unfit targets dropped.
 */
export function reevaluate(tracked, hand, unseen) {
  const have = toCounts(hand.concealed);
  const out = [];
  for (const { evaluation, weight } of tracked) {
    const e = evaluateTarget(evaluation.target, have, hand.exposures, unseen);
    if (e) out.push({ evaluation: e, weight });
  }
  return out;
}

/** Σ weight × distance over tracked targets. */
export function weightedDistance(tracked) {
  return tracked.reduce((n, { evaluation, weight }) => n + weight * evaluation.distance, 0);
}

/** A deterministic per-seat seed from the game seed. */
export function seatSeed(seed, seat) {
  return (Math.imul(seed >>> 0, 2654435761) ^ Math.imul(seat + 1, 40503)) >>> 0;
}
