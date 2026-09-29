// Beginner opponent (SPEC §9.1). Picks one target and sticks with it.
//  - Picks its best target at the start of the Charleston and passes tiles not in it; re-picks
//    once when play starts (the Charleston reshapes the hand), then commits unless the target
//    becomes dead or stops fitting its exposures.
//  - Never stops the second Charleston or blind-passes.
//  - Calls every legal exposure that fits its target; always declares Mah Jongg.
//  - Discards the tile least useful to its target, ties broken by the seeded rng.
//  - Takes an available joker exchange 30% of the time. No defense, no dead-hand declarations.

import { createRng } from '../rng.js';
import { JOKER, toCounts } from '../tiles.js';
import { fitExposures } from '../card.js';
import { evaluateObservation, evaluateTarget, unseenCounts, discardCosts, removalCost } from '../evaluator.js';
import { choose, seatSeed } from './common.js';

export const EXCHANGE_RATE = 0.3;

export function createBeginner({ seat, seed }) {
  const rng = createRng(seatSeed(seed, seat));
  let target = null;
  let pickedForPlay = false;
  let exchangeRolledOn = -1;

  function pick(obs) {
    const evals = evaluateObservation(obs).filter((e) => !e.dead);
    if (!evals.length) return null;
    const best = evals.filter((e) => e.distance === evals[0].distance && e.target.value === evals[0].target.value);
    return choose(rng, best).target;
  }

  /** The committed target's current evaluation, re-picking when required. */
  function current(obs) {
    if (obs.phase !== 'charleston' && !pickedForPlay) {
      pickedForPlay = true;
      target = null;
    }
    const have = toCounts(obs.hand);
    const unseen = unseenCounts(obs);
    let e = target && evaluateTarget(target, have, obs.exposures[obs.seat], unseen);
    if (!e || e.dead) {
      target = pick(obs);
      e = target && evaluateTarget(target, have, obs.exposures[obs.seat], unseen);
    }
    return e;
  }

  /** Tiles to give away: those the target doesn't use first, then the least harmful. */
  function giveaway(obs, n) {
    const e = current(obs);
    const tiles = obs.hand.filter((t) => t !== JOKER);
    const have = toCounts(obs.hand);
    const out = [];
    const pool = tiles.slice();
    while (out.length < n && pool.length) {
      const cost = (t) => (e ? removalCost(e, have, t) : 0);
      const min = Math.min(...pool.map(cost));
      const t = choose(rng, pool.filter((x) => cost(x) === min));
      out.push(t);
      pool.splice(pool.indexOf(t), 1);
      have[t]--;
    }
    return out;
  }

  function spareCount(obs) {
    const e = current(obs);
    if (!e) return 3;
    const have = toCounts(obs.hand);
    let n = 0;
    for (const t of obs.hand) {
      if (t === JOKER) continue;
      if (removalCost(e, have, t) === 0) { n++; have[t]--; }
    }
    return Math.min(3, n);
  }

  function decide(obs) {
    const d = obs.decision;
    switch (d.kind) {
      case 'pass': return { type: 'pass', tiles: giveaway(obs, 3), blind: 0 };
      case 'vote': return { type: 'vote', stop: false };
      case 'courtesyRequest': return { type: 'courtesyRequest', count: spareCount(obs) };
      case 'courtesyPass': return { type: 'courtesyPass', tiles: giveaway(obs, d.count) };
      case 'claim': {
        if (d.options.some((o) => o.type === 'mahjong')) return { type: 'claim', call: 'mahjong' };
        const e = current(obs);
        const fits = e && !e.target.concealed && d.options.find((o) => o.type === 'expose'
          && fitExposures(e.target, [...obs.exposures[obs.seat], { tile: o.tile, count: o.count, jokers: 0 }]));
        if (fits) return { type: 'claim', call: 'expose', count: fits.count, jokers: fits.minJokers };
        return { type: 'claim', call: 'pass' };
      }
      case 'turn': {
        if (d.mahJongg) return { type: 'mahjong' };
        if (d.exchanges.length && exchangeRolledOn !== obs.turnNumber) {
          exchangeRolledOn = obs.turnNumber;
          if (rng.next() < EXCHANGE_RATE) return { type: 'exchange', seat: d.exchanges[0].seat, index: d.exchanges[0].index };
        }
        const e = current(obs);
        const costs = e ? discardCosts(obs.hand, [{ evaluation: e, weight: 1 }]) : discardCosts(obs.hand, []);
        const cheapest = costs.filter((c) => c.cost === costs[0].cost).map((c) => c.tile);
        return { type: 'discard', tile: choose(rng, cheapest) };
      }
    }
    throw new Error(`Beginner has no policy for ${d.kind}`);
  }

  return {
    level: 'beginner',
    decide,
    /** What this player is aiming for (for post-hand review). */
    describe: () => (target ? { handId: target.handId, target } : null),
  };
}
