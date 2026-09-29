// Intermediate opponent (SPEC §9.2). Tracks its top ~5 targets, weighted by value, liveness,
// and distance, and plays to keep as many of them alive as it can.
//  - Charleston: passes the tiles that support its weighted targets least; blind-passes rather
//    than break up useful tiles; stops the second Charleston when its best target is ≤ 3 away.
//  - Calls an exposure only when its best target is exposed, the call fits it and brings it
//    closer, and its top targets aren't mostly concealed hands.
//  - Discards the tile whose removal costs its weighted targets least.
//  - Takes joker exchanges that don't hurt it; declares dead hands; always declares Mah Jongg.
//  - No defense in v1.

import { createRng } from '../rng.js';
import { JOKER, toCounts } from '../tiles.js';
import { fitExposures } from '../card.js';
import {
  evaluateObservation, evaluateTarget, unseenCounts, topTargets, discardCosts, WEIGHTS,
} from '../evaluator.js';
import { afterExposure, reevaluate, weightedDistance, without, choose, seatSeed } from './common.js';

export const STOP_CHARLESTON_AT = 3;

export function createIntermediate({ seat, seed }) {
  const rng = createRng(seatSeed(seed, seat));
  let lastBest = null;

  function track(obs) {
    const evals = evaluateObservation(obs, { sort: false });
    const tracked = topTargets(evals);
    lastBest = tracked[0]?.evaluation.target ?? null;
    return { evals, tracked, unseen: unseenCounts(obs) };
  }

  /** Greedily pick up to n tiles (never jokers) that cost the tracked targets least. */
  function cheapestTiles(obs, n) {
    const { tracked, unseen } = track(obs);
    let hand = { concealed: obs.hand.slice(), exposures: obs.exposures[obs.seat] };
    let current = tracked;
    const picks = [];
    for (let k = 0; k < n; k++) {
      const costs = discardCosts(hand.concealed, current).filter((c) => c.tile !== JOKER);
      if (!costs.length) break;
      const best = costs.filter((c) => c.cost === costs[0].cost);
      const { tile, cost } = choose(rng, best);
      picks.push({ tile, cost });
      hand = { ...hand, concealed: without(hand.concealed, [tile]) };
      current = reevaluate(current, hand, unseen);
    }
    return picks;
  }

  function pass(obs, blindAllowed) {
    const picks = cheapestTiles(obs, 3);
    if (blindAllowed) {
      const free = picks.filter((p) => p.cost === 0);
      if (free.length < 3) return { type: 'pass', tiles: free.map((p) => p.tile), blind: 3 - free.length };
    }
    return { type: 'pass', tiles: picks.map((p) => p.tile), blind: 0 };
  }

  function claim(obs, d) {
    if (d.options.some((o) => o.type === 'mahjong')) return { type: 'claim', call: 'mahjong' };
    const { tracked, unseen } = track(obs);
    if (!tracked.length) return { type: 'claim', call: 'pass' };
    const best = tracked[0].evaluation;
    const concealedTop = tracked.slice(0, 3).filter((x) => x.evaluation.target.concealed).length;
    if (best.target.concealed || concealedTop >= 2) return { type: 'claim', call: 'pass' };
    let choice = null;
    for (const o of d.options) {
      if (o.type !== 'expose') continue;
      if (!fitExposures(best.target, [...obs.exposures[obs.seat], { tile: o.tile, count: o.count, jokers: 0 }])) continue;
      for (let j = o.minJokers; j <= o.maxJokers; j++) {
        const hand = afterExposure(obs, o, j);
        const e = evaluateTarget(best.target, toCounts(hand.concealed), hand.exposures, unseen);
        if (e && e.distance < best.distance && (!choice || e.distance < choice.distance)) {
          choice = { count: o.count, jokers: j, distance: e.distance };
        }
      }
    }
    return choice ? { type: 'claim', call: 'expose', count: choice.count, jokers: choice.jokers } : { type: 'claim', call: 'pass' };
  }

  function turn(obs, d) {
    if (d.mahJongg) return { type: 'mahjong' };
    if (d.deadTargets.length) return { type: 'declareDead', target: d.deadTargets[0] };
    const { evals, tracked, unseen } = track(obs);
    const hand = { concealed: obs.hand, exposures: obs.exposures[obs.seat] };
    const now = weightedDistance(tracked);
    for (const x of d.exchanges) {
      const next = { ...hand, concealed: [...without(hand.concealed, [x.tile]), JOKER] };
      if (weightedDistance(reevaluate(tracked, next, unseen)) <= now) return { type: 'exchange', seat: x.seat, index: x.index };
    }
    const costs = discardCosts(obs.hand, tracked);
    let tied = costs.filter((c) => c.cost === costs[0].cost).map((c) => c.tile);
    if (tied.length > 1) {
      // Break ties by a wider set of targets, then randomly.
      const wide = discardCosts(obs.hand, topTargets(evals, WEIGHTS.topN * 4)).filter((c) => tied.includes(c.tile));
      tied = wide.filter((c) => c.cost === wide[0].cost).map((c) => c.tile);
    }
    return { type: 'discard', tile: choose(rng, tied) };
  }

  function decide(obs) {
    const d = obs.decision;
    switch (d.kind) {
      case 'pass': return pass(obs, d.blindAllowed);
      case 'vote': {
        const { tracked } = track(obs);
        return { type: 'vote', stop: tracked.length > 0 && tracked[0].evaluation.distance <= STOP_CHARLESTON_AT };
      }
      case 'courtesyRequest':
        return { type: 'courtesyRequest', count: cheapestTiles(obs, 3).filter((p) => p.cost === 0).length };
      case 'courtesyPass':
        return { type: 'courtesyPass', tiles: cheapestTiles(obs, d.count).map((p) => p.tile) };
      case 'claim': return claim(obs, d);
      case 'turn': return turn(obs, d);
    }
    throw new Error(`Intermediate has no policy for ${d.kind}`);
  }

  return {
    level: 'intermediate',
    decide,
    describe: () => (lastBest ? { handId: lastBest.handId, target: lastBest } : null),
  };
}
