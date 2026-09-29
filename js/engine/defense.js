// Reading opponents (SPEC §10.2–10.6): profiles, candidate hands, threat, and tile danger.
// Works only from the observer's observation.

import { JOKER, KINDS } from './tiles.js';
import { expandCard, fitExposures } from './card.js';
import { unseenCounts } from './evaluator.js';

/** Tuning constants (§10.3–10.5); starting guesses, kept in one place. */
export const DEFENSE = Object.freeze({
  passedPenalty: 0.3,     // per distinct tile the opponent passed you that the hand needs
  discardedPenalty: 0.7,  // per distinct tile the opponent discarded that the hand needs
  threatWeight: Object.freeze({ none: 0, low: 0.2, medium: 0.5, high: 1 }),
  lastQuarter: 25,        // wall count at or below which threat rises a level
  foldWall: 25,           // fold suggestion only when fewer tiles than this remain
  foldDistance: 3,        // ... and your best hand is at least this far away
  dangerBands: Object.freeze({ low: 0.12, medium: 0.3 }), // score thresholds (below low → low, etc.)
});

const LEVELS = ['low', 'medium', 'high'];

/**
 * What the observer can see of one opponent (§10.2).
 * @param {import('./observe.js').Observation} obs
 * @param {number} seat
 */
export function opponentProfile(obs, seat) {
  return {
    seat,
    exposures: obs.exposures[seat],
    passedToMe: obs.passesReceived.filter((p) => p.from === seat).flatMap((p) => p.tiles),
    discards: obs.discardHistory.filter((d) => d.seat === seat).map((d) => d.tile),
    concealedCount: obs.concealedCounts[seat],
    dead: obs.dead[seat],
  };
}

/**
 * Card targets consistent with an opponent's exposures, weighted by what they passed and threw
 * (§10.3). Sorted by weight, heaviest first.
 * @returns {{target: import('./card.js').Target, weight: number, remaining: Int8Array}[]}
 */
export function candidates(obs, seat, unseen = unseenCounts(obs)) {
  const profile = opponentProfile(obs, seat);
  if (profile.dead) return [];
  const passed = new Set(profile.passedToMe);
  const thrown = new Set(profile.discards);
  const out = [];
  for (const target of expandCard(obs.card)) {
    const group = fitExposures(target, profile.exposures);
    if (!group) continue;
    let dead = false;
    for (const t of target.kinds) if (target.single[t] > unseen[t]) dead = true;
    if (dead) continue;
    const remaining = new Int8Array(KINDS);
    for (const t of target.kinds) remaining[t] = target.single[t] + group[t];
    let weight = 1;
    for (const t of passed) if (remaining[t] > 0) weight *= DEFENSE.passedPenalty;
    for (const t of thrown) if (remaining[t] > 0) weight *= DEFENSE.discardedPenalty;
    out.push({ target, weight, remaining });
  }
  return out.sort((a, b) => b.weight - a.weight);
}

/**
 * Distinct card hands among the candidates, each with its heaviest weight.
 * @returns {{handId: string, hand: Object, weight: number}[]}
 */
export function candidateHands(cands) {
  const byHand = new Map();
  for (const c of cands) {
    const prev = byHand.get(c.target.handId);
    if (!prev || c.weight > prev.weight) byHand.set(c.target.handId, { handId: c.target.handId, hand: c.target.hand, weight: c.weight });
  }
  return [...byHand.values()].sort((a, b) => b.weight - a.weight);
}

/**
 * Threat level (§10.4): exposures set the base; the last quarter of the wall and a single
 * surviving candidate hand each raise it one level. Dead players are no threat.
 * @returns {'none'|'low'|'medium'|'high'}
 */
export function threatLevel(obs, seat, cands) {
  if (obs.dead[seat]) return 'none';
  const n = obs.exposures[seat].length;
  let level = n === 0 ? 0 : n <= 2 ? 1 : 2;
  if (obs.wallCount <= DEFENSE.lastQuarter) level++;
  if (candidateHands(cands).length === 1) level++;
  return LEVELS[Math.min(2, level)];
}

/**
 * Danger of each tile kind (§10.5): Σ over opponents of threatWeight × weighted share of their
 * candidates that still need it. Jokers are always safe.
 * @returns {Float64Array}  Indexed by tile id.
 */
export function dangerScores(opponents) {
  const score = new Float64Array(KINDS);
  for (const { cands, threat } of opponents) {
    const w = DEFENSE.threatWeight[threat];
    if (!w || !cands.length) continue;
    const total = cands.reduce((n, c) => n + c.weight, 0);
    if (!total) continue;
    const need = new Float64Array(KINDS);
    for (const c of cands) for (const t of c.target.kinds) if (c.remaining[t] > 0) need[t] += c.weight;
    for (let t = 0; t < KINDS; t++) score[t] += w * (need[t] / total);
  }
  score[JOKER] = 0;
  return score;
}

/** 'safe' | 'low' | 'medium' | 'high' for a danger score. */
export function dangerLevel(score) {
  if (score <= 0) return 'safe';
  if (score < DEFENSE.dangerBands.low) return 'low';
  if (score < DEFENSE.dangerBands.medium) return 'medium';
  return 'high';
}

/**
 * Everything defense-related for the observer.
 * @param {import('./observe.js').Observation} obs
 */
export function defenseReport(obs) {
  const unseen = unseenCounts(obs);
  const opponents = [1, 2, 3].map((k) => (obs.seat + k) % 4).map((seat) => {
    const cands = candidates(obs, seat, unseen);
    return {
      seat,
      profile: opponentProfile(obs, seat),
      cands,
      hands: candidateHands(cands),
      threat: threatLevel(obs, seat, cands),
    };
  });
  const scores = dangerScores(opponents);
  return { opponents, scores, level: (tile) => dangerLevel(scores[tile]) };
}
