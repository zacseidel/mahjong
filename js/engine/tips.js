// Strategy tips (SPEC §10). Turns evaluator and defense output into short reasons plus longer
// explanations. Works only from the observer's observation. Recommendations use the same
// weighting as the intermediate AI.

import { JOKER, toCounts, displayName } from './tiles.js';
import { fitExposures } from './card.js';
import {
  evaluateObservation, evaluateTarget, unseenCounts, topTargets, discardCosts, removalCost, neededTiles,
} from './evaluator.js';
import { defenseReport, DEFENSE } from './defense.js';

const GROUP = { 3: 'pung', 4: 'kong', 5: 'quint', 6: 'sextet' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (tiles) => tiles.map(displayName).join(', ');

/**
 * @typedef {{kind: string, line: string, detail: string, tiles?: number[], tile?: number}} Tip
 *   `line` is the one-line reason; `detail` the expanded explanation.
 */

/** Tiles from the hand that a target uses (one entry per copy). */
function usedTiles(e, hand) {
  const left = toCounts(hand);
  const out = [];
  for (const t of e.target.kinds) {
    const use = Math.min(left[t], e.target.single[t] + e.group[t]);
    for (let k = 0; k < use; k++) out.push(t);
  }
  const jokersUsed = Math.min(left[JOKER], e.missingGroup);
  for (let k = 0; k < jokersUsed; k++) out.push(JOKER);
  return out;
}

/**
 * Closest hands (§10.1): the top 3 distinct card hands by distance then value.
 * @returns {{handId: string, hand: Object, target: Object, distance: number, value: number, concealed: boolean,
 *   dead: boolean, needed: number[], uses: number[]}[]}
 */
export function closestHands(obs, evals = evaluateObservation(obs), n = 3) {
  const out = [];
  const seen = new Set();
  for (const e of evals) {
    if (e.dead || seen.has(e.target.handId)) continue;
    seen.add(e.target.handId);
    out.push({
      handId: e.target.handId,
      hand: e.target.hand,
      target: e.target,
      distance: e.distance,
      value: e.target.value,
      concealed: e.target.concealed,
      dead: e.dead,
      needed: neededTiles(e).map((x) => x.tile),
      uses: usedTiles(e, obs.hand),
    });
    if (out.length === n) break;
  }
  return out;
}

/** Greedily choose n tiles (never jokers) that cost the tracked targets least. Deterministic. */
function cheapestTiles(obs, tracked, n) {
  const unseen = unseenCounts(obs);
  let hand = obs.hand.slice();
  let current = tracked;
  const picks = [];
  for (let k = 0; k < n; k++) {
    const costs = discardCosts(hand, current).filter((c) => c.tile !== JOKER);
    if (!costs.length) break;
    picks.push(costs[0]);
    hand.splice(hand.indexOf(costs[0].tile), 1);
    const have = toCounts(hand);
    current = current.map(({ evaluation, weight }) => ({
      evaluation: evaluateTarget(evaluation.target, have, obs.exposures[obs.seat], unseen) ?? evaluation,
      weight,
    }));
  }
  return picks;
}

/** How many tracked hands lose ground if this tile goes. */
function handsHurt(tracked, hand, tile) {
  const have = toCounts(hand);
  return tracked.filter(({ evaluation }) => removalCost(evaluation, have, tile) > 0).length;
}

/**
 * Offense tips for the current decision.
 * @param {import('./observe.js').Observation} obs
 * @param {{nameOf?: (seat: number) => string}} [options]
 * @returns {{closest: ReturnType<typeof closestHands>, tips: Tip[], recommendedDiscard: number|null}}
 */
export function offenseTips(obs, { nameOf = (s) => `Seat ${s}` } = {}) {
  const evals = evaluateObservation(obs);
  const closest = closestHands(obs, evals);
  const tracked = topTargets(evals);
  const d = obs.decision;
  const tips = [];
  let recommendedDiscard = null;
  const best = closest[0];
  const bestText = best ? `${best.hand.category} ${best.hand.line}` : 'no hand';

  if (!d || !best) return { closest, tips, recommendedDiscard };

  if (d.kind === 'pass' || d.kind === 'courtesyPass') {
    const n = d.kind === 'pass' ? 3 : d.count;
    const picks = cheapestTiles(obs, tracked, n);
    const free = picks.filter((p) => p.cost === 0);
    const line = free.length === picks.length
      ? `Pass ${names(picks.map((p) => p.tile))}: they don’t fit any of your closest hands.`
      : `Pass ${names(picks.map((p) => p.tile))}: they hurt your closest hands least.`;
    let detail = `Your closest hands are ${closest.map((c) => `${c.hand.line} (${plural(c.distance, 'tile')} away)`).join('; ')}. `
      + 'Early on, keep tiles that serve several hands and let go of tiles that serve none. Jokers can never be passed.';
    if (d.kind === 'pass' && d.blindAllowed && free.length < 3) {
      detail += ` Only ${free.length} of your tiles are truly spare, so a blind pass of ${3 - free.length} is worth considering: you pass on tiles you haven’t seen instead of breaking up useful ones.`;
    }
    tips.push({ kind: 'charleston', line, detail, tiles: picks.map((p) => p.tile) });
  }

  if (d.kind === 'vote') {
    const stop = best.distance <= 3;
    tips.push({
      kind: 'vote',
      line: stop ? `Consider stopping: your best hand is only ${plural(best.distance, 'tile')} away.`
        : `Keep going: your best hand is ${plural(best.distance, 'tile')} away, and another Charleston can help.`,
      detail: `Best hand: ${bestText}. The second Charleston swaps nine more tiles. That helps a hand that still needs a lot, and risks breaking up one that is nearly ready.`,
    });
  }

  if (d.kind === 'courtesyRequest') {
    const free = cheapestTiles(obs, tracked, 3).filter((p) => p.cost === 0).length;
    tips.push({
      kind: 'courtesy',
      line: `Ask for ${free}: that’s how many tiles you can spare without hurting your closest hands.`,
      detail: 'The courtesy pass trades the smaller number either of you asks for. Asking for more than you can spare means giving away tiles you need.',
    });
  }

  if (d.kind === 'turn') {
    if (d.mahJongg) {
      tips.push({ kind: 'mahjong', line: 'You have Mah Jongg! Declare it.', detail: 'Your 14 tiles match a hand on the card.' });
    }
    const unseen = unseenCounts(obs);
    const hand = { concealed: obs.hand, exposures: obs.exposures[obs.seat] };
    for (const x of d.exchanges) {
      const after = [...obs.hand];
      after.splice(after.indexOf(x.tile), 1);
      after.push(JOKER);
      const have = toCounts(after);
      const before = tracked.reduce((n, t) => n + t.weight * t.evaluation.distance, 0);
      const now = tracked.reduce((n, t) => n + t.weight * (evaluateTarget(t.evaluation.target, have, hand.exposures, unseen)?.distance ?? t.evaluation.distance), 0);
      const owner = x.seat === obs.seat ? 'your own' : `${nameOf(x.seat)}’s`;
      if (now <= before) {
        tips.push({
          kind: 'exchange', tile: x.tile,
          line: `Swap your ${displayName(x.tile)} for ${owner} joker.`,
          detail: 'A joker can stand in for any tile in a group of three or more, so it is worth more than the tile you give up, which your closest hands don’t need for a pair or single.',
        });
      } else {
        tips.push({
          kind: 'exchange', tile: x.tile,
          line: `Keep your ${displayName(x.tile)} rather than swapping it for ${owner} joker.`,
          detail: 'Your closest hands need that tile for a pair or single, where a joker can’t be used.',
        });
      }
    }
    if (!d.mahJongg) {
      const costs = discardCosts(obs.hand, tracked);
      const pick = costs[0];
      recommendedDiscard = pick.tile;
      const next = costs.find((c) => c.tile !== pick.tile);
      const line = pick.cost === 0
        ? `Discard ${displayName(pick.tile)}: none of your closest hands use it.`
        : `Discard ${displayName(pick.tile)}: every tile helps somewhat, and this one costs the least.`;
      let detail = `Best hand: ${bestText}, ${plural(best.distance, 'tile')} away.`;
      if (next) {
        const hurt = handsHurt(tracked, obs.hand, next.tile);
        detail += Math.abs(next.cost - pick.cost) < 1e-9
          ? ` ${displayName(next.tile)} would be just as good.`
          : ` Next best is ${displayName(next.tile)}, which would set back ${hurt} of your top hands.`;
      }
      if (pick.tile === JOKER) detail += ' Throwing a joker is usually bad; here none of your hands can use it.';
      tips.push({ kind: 'discard', tile: pick.tile, line, detail });
    }
  }

  if (d.kind === 'claim') {
    const who = nameOf(d.discarder);
    if (d.options.some((o) => o.type === 'mahjong')) {
      tips.push({ kind: 'call', line: `Call it: ${displayName(d.tile)} completes your hand!`, detail: 'Taking a discard for Mah Jongg is always allowed when it completes a hand on the card.' });
    } else {
      const top = tracked[0]?.evaluation;
      const concealedTop = tracked.slice(0, 3).filter((x) => x.evaluation.target.concealed).length;
      const opt = d.options.find((o) => o.type === 'expose' && top && fitExposures(top.target, [...obs.exposures[obs.seat], { tile: o.tile, count: o.count, jokers: 0 }]));
      if (top && (top.target.concealed || concealedTop >= 2)) {
        tips.push({
          kind: 'call', line: 'Pass: calling commits you to an exposed hand, and your best hands are concealed.',
          detail: `Best hand: ${top.target.hand.line} (concealed). Any exposure rules out every concealed hand on the card.`,
        });
      } else if (opt) {
        tips.push({
          kind: 'call', line: `Call it: a ${GROUP[opt.count]} of ${displayName(d.tile)} fits your best hand.`,
          detail: `It brings ${top.target.hand.line} one tile closer. The cost: your exposure tells everyone what you’re building, and you can’t switch to a hand it doesn’t fit.`,
        });
      } else {
        tips.push({
          kind: 'call', line: `Pass: this ${displayName(d.tile)} doesn’t fit your best hand.`,
          detail: `Best hand: ${bestText}. An exposure you don’t need locks you out of other hands. ${who} threw it; you can pass.`,
        });
      }
    }
  }

  return { closest, tips, recommendedDiscard };
}

/**
 * Defense tips: opponent threat, tile danger, fold suggestion, dead-hand alerts (§10.4–10.6).
 * @param {import('./observe.js').Observation} obs
 * @param {{nameOf?: (seat: number) => string}} [options]
 */
export function defenseTips(obs, { nameOf = (s) => `Seat ${s}` } = {}) {
  const report = defenseReport(obs);
  const tips = [];
  const d = obs.decision;
  const inPlay = obs.phase === 'turn' || obs.phase === 'claim';

  for (const t of d?.deadTargets ?? []) {
    tips.push({
      kind: 'dead', seat: t,
      line: `${nameOf(t)}’s exposures don’t match any hand on your card. You can declare their hand dead.`,
      detail: 'A dead hand can’t win, stops playing, and still pays. If your card was entered by hand, check it first: a typo can cause a false alert.',
    });
  }

  let fold = null;
  if (inPlay && d?.kind === 'turn' && !d.mahJongg) {
    const evals = evaluateObservation(obs);
    const tracked = topTargets(evals);
    const bestDistance = evals.find((e) => !e.dead)?.distance ?? Infinity;
    const high = report.opponents.filter((o) => o.threat === 'high');
    if (bestDistance >= DEFENSE.foldDistance && obs.wallCount < DEFENSE.foldWall && high.length) {
      // Safest band first, then least harm to your hand. Jokers are always safe but usually
      // too valuable to throw: only when every other tile is medium or high danger.
      const rank = { safe: 0, low: 1, medium: 2, high: 3 };
      const ranked = discardCosts(obs.hand, tracked)
        .map((c) => ({ ...c, band: rank[report.level(c.tile)] }))
        .sort((a, b) => a.band - b.band || a.cost - b.cost);
      const nonJoker = ranked.find((c) => c.tile !== JOKER);
      const safest = !nonJoker || (nonJoker.band >= rank.medium && obs.hand.includes(JOKER))
        ? ranked.find((c) => c.tile === JOKER) ?? nonJoker
        : nonJoker;
      const threat = high[0];
      const v = threat.hands[0]?.hand.value ?? 25;
      fold = { tile: safest.tile, seat: threat.seat };
      tips.push({
        kind: 'fold', tile: safest.tile,
        line: `Consider playing defensively: discard ${displayName(safest.tile)}, the safest tile that hurts your hand least.`,
        detail: `Your best hand is ${plural(bestDistance, 'tile')} away with ${obs.wallCount} tiles left, and ${nameOf(threat.seat)} looks close. Throwing ${nameOf(threat.seat)}’s winning tile costs you ${2 * v} instead of ${v}.`,
      });
    }
  }

  if (inPlay && obs.hand.includes(JOKER)) {
    tips.push({
      kind: 'joker', line: 'Jokers are always safe to throw, since they can’t be called.',
      detail: 'Throwing a joker usually hurts your own hand badly. It can be right very late against a high threat.',
    });
  }

  return { report, tips, fold };
}

/**
 * The tip's recommended discard for the current turn (defense overrides offense when folding).
 * Used to review the human's discards after the hand.
 * @returns {number|null}
 */
export function recommendedDiscard(obs) {
  if (obs.decision?.kind !== 'turn' || obs.decision.mahJongg) return null;
  const fold = defenseTips(obs).fold;
  return fold ? fold.tile : offenseTips(obs).recommendedDiscard;
}

