// Strategy tips (SPEC §10). Turns evaluator and defense output into short reasons plus longer
// explanations. Works only from the observer's observation. Recommendations use the same
// weighting as the intermediate AI.

import { JOKER, toCounts, displayName, suitOf, suitForDragon, isNumber, isDragon } from './tiles.js';
import { fitExposures, compileHand, CardError } from './card.js';
import {
  evaluateObservation, evaluateTarget, unseenCounts, topTargets, discardCosts, removalCost, neededTiles,
} from './evaluator.js';
import { defenseReport, DEFENSE } from './defense.js';

const GROUP = { 3: 'pung', 4: 'kong', 5: 'quint', 6: 'sextet' };
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const names = (tiles) => tiles.map(displayName).join(', ');

/**
 * @typedef {{kind: string, line: string, detail: string, tiles?: number[], tile?: number, action?: Object}} Tip
 *   `line` is the one-line reason; `detail` the expanded explanation; `action` the move it
 *   recommends, in the engine's action format (used for "Show me" and the post-hand review).
 */

const SUIT_NAMES = ['Craks', 'Bams', 'Dots'];

/**
 * A target laid out group by group, with each tile marked: 'exposed' (in your exposure),
 * 'exposed-joker', 'have' (in your hand), 'joker' (a joker you hold fills it), or 'need'.
 * Real tiles fill pairs and singles first, then groups; jokers fill only groups (SPEC §7).
 * @param {import('./card.js').Target} target
 * @param {number[]} concealed
 * @param {import('./card.js').Exposure[]} [exposures]
 * @returns {{tile: number, count: number, cells: string[]}[]}
 */
export function handView(target, concealed, exposures = []) {
  const slots = target.layout.map(({ tile, count }) => ({ tile, count, cells: Array(count).fill(null) }));
  const exposedSlots = new Set();
  for (const e of exposures) {
    const i = slots.findIndex((x, k) => !exposedSlots.has(k) && x.tile === e.tile && x.count === e.count);
    if (i < 0) continue;
    exposedSlots.add(i);
    slots[i].cells = slots[i].cells.map((_, k) => (k < e.count - e.jokers ? 'exposed' : 'exposed-joker'));
  }
  const left = toCounts(concealed);
  for (const small of [true, false]) {
    slots.forEach((x, i) => {
      if (exposedSlots.has(i) || (x.count < 3) !== small) return;
      x.cells = x.cells.map((c) => (c || (left[x.tile] > 0 ? (left[x.tile]--, 'have') : null)));
    });
  }
  slots.forEach((x, i) => {
    if (exposedSlots.has(i) || x.count < 3) return;
    x.cells = x.cells.map((c) => (c || (left[JOKER] > 0 ? (left[JOKER]--, 'joker') : null)));
  });
  return slots.map((x) => ({ tile: x.tile, count: x.count, cells: x.cells.map((c) => c ?? 'need') }));
}

/**
 * Which suit each printed color stands for in this version of the hand, e.g. {g: 'Bams', r: 'Craks'}.
 * Returns {} when it can't be worked out (for example an advanced pattern).
 * @param {import('./card.js').Target} target
 */
export function colorLegend(target) {
  let pattern;
  try {
    pattern = compileHand(target.hand);
  } catch (e) {
    if (e instanceof CardError) return {};
    throw e;
  }
  const variant = pattern.variants.find((v) => v.slots.length === target.layout.length
    && v.slots.every((x, i) => x.kind !== 'fixed' || x.tile === target.layout[i].tile));
  if (!variant) return {};
  const legend = {};
  variant.slots.forEach((x, i) => {
    if (x.kind === 'fixed' || !'grb'.includes(x.suitVar)) return;
    const tile = target.layout[i].tile;
    const suit = isNumber(tile) ? suitOf(tile) : isDragon(tile) ? suitForDragon(tile) : null;
    if (suit !== null) legend[x.suitVar] = SUIT_NAMES[suit];
  });
  return legend;
}

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
  // Live hands first. If none is left, show the nearest dead ones (marked dead) so the player
  // can see why their hand can't be finished.
  const anyLive = evals.some((e) => !e.dead);
  for (const e of evals) {
    if ((anyLive && e.dead) || seen.has(e.target.handId)) continue;
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
      view: handView(e.target, obs.hand, obs.exposures[obs.seat]),
      legend: colorLegend(e.target),
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

  if (!d) return { closest, tips, recommendedDiscard };

  // No hand on the card can still be completed: say so, and play defense.
  if (!best || best.dead) {
    const why = best
      ? `Your nearest hand, ${best.hand.line}, needs a pair or single tile whose copies are all gone, and jokers can’t fill pairs or singles.`
      : 'Your exposures don’t fit any hand on the card.';
    if (d.kind === 'turn' && d.mahJongg) {
      tips.push({ kind: 'mahjong', action: { type: 'mahjong' }, line: 'You have Mah Jongg! Declare it.', detail: 'Your 14 tiles match a hand on the card.' });
    } else if (d.kind === 'turn') {
      const report = defenseReport(obs);
      const pick = obs.hand.slice().sort((a, b) => report.scores[a] - report.scores[b] || (a === JOKER) - (b === JOKER))[0];
      recommendedDiscard = pick;
      tips.push({
        kind: 'discard', tile: pick, action: { type: 'discard', tile: pick },
        line: `Your hand can’t be completed now, so play defense: discard ${displayName(pick)}, a safe tile.`,
        detail: `${why} You can’t win this hand, but you can still avoid paying double by not throwing someone else’s winning tile.`,
      });
    } else if (d.kind === 'claim') {
      const win = d.options.some((o) => o.type === 'mahjong');
      tips.push(win
        ? { kind: 'call', action: { type: 'claim', call: 'mahjong' }, line: `Call it: ${displayName(d.tile)} completes your hand!`, detail: 'Taking a discard for Mah Jongg is always allowed when it completes a hand on the card.' }
        : { kind: 'call', action: { type: 'claim', call: 'pass' }, line: 'Pass: your hand can’t be completed now, so calling won’t help.', detail: why });
    }
    // Charleston decisions (no exposures yet, so a dead nearest hand is rare) get the usual advice.
    if (d.kind === 'turn' || d.kind === 'claim') return { closest, tips, recommendedDiscard };
  }

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
    const blind = d.kind === 'pass' && d.blindAllowed && free.length < 3 ? 3 - free.length : 0;
    const action = d.kind === 'pass'
      ? { type: 'pass', tiles: (blind ? free : picks).map((p) => p.tile), blind }
      : { type: 'courtesyPass', tiles: picks.map((p) => p.tile) };
    // When a blind pass is the suggestion, say so: the line must describe the suggested move.
    const blindLine = blind
      ? `Blind pass: ${free.length ? `pass ${names(free.map((p) => p.tile))} and ` : ''}${plural(blind, 'unseen tile')}. ${free.length ? `Only ${plural(free.length, 'tile')} of yours ${free.length === 1 ? 'is' : 'are'}` : 'None of your tiles are'} truly spare.`
      : line;
    tips.push({ kind: 'charleston', line: blindLine, detail, tiles: action.tiles, action });
  }

  if (d.kind === 'vote') {
    const stop = best.distance <= 3;
    tips.push({
      kind: 'vote',
      action: { type: 'vote', stop },
      line: stop ? `Consider stopping: your best hand is only ${plural(best.distance, 'tile')} away.`
        : `Keep going: your best hand is ${plural(best.distance, 'tile')} away, and another Charleston can help.`,
      detail: `Best hand: ${bestText}. The second Charleston swaps nine more tiles. That helps a hand that still needs a lot, and risks breaking up one that is nearly ready.`,
    });
  }

  if (d.kind === 'courtesyRequest') {
    const free = cheapestTiles(obs, tracked, 3).filter((p) => p.cost === 0).length;
    tips.push({
      kind: 'courtesy',
      action: { type: 'courtesyRequest', count: free },
      line: `Ask for ${free}: that’s how many tiles you can spare without hurting your closest hands.`,
      detail: 'The courtesy pass trades the smaller number either of you asks for. Asking for more than you can spare means giving away tiles you need.',
    });
  }

  if (d.kind === 'turn') {
    if (d.mahJongg) {
      tips.push({ kind: 'mahjong', action: { type: 'mahjong' }, line: 'You have Mah Jongg! Declare it.', detail: 'Your 14 tiles match a hand on the card.' });
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
          action: { type: 'exchange', seat: x.seat, index: x.index },
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
      // Feedback on the draw: a tile helps if losing it would set back one of your top hands.
      if (obs.drawn !== null) {
        const helped = handsHurt(tracked, obs.hand, obs.drawn);
        if (obs.drawn === pick.tile) detail = `The ${displayName(obs.drawn)} you just drew doesn’t help, so throw it back. ${detail}`;
        else if (helped) detail = `Good draw: ${displayName(obs.drawn)} helps ${helped === 1 ? 'one of your top hands' : `${helped} of your top hands`}. ${detail}`;
      }
      tips.push({ kind: 'discard', tile: pick.tile, action: { type: 'discard', tile: pick.tile }, line, detail });
    }
  }

  if (d.kind === 'claim') {
    const who = nameOf(d.discarder);
    if (d.options.some((o) => o.type === 'mahjong')) {
      tips.push({ kind: 'call', action: { type: 'claim', call: 'mahjong' }, line: `Call it: ${displayName(d.tile)} completes your hand!`, detail: 'Taking a discard for Mah Jongg is always allowed when it completes a hand on the card.' });
    } else {
      const top = tracked[0]?.evaluation;
      const concealedTop = tracked.slice(0, 3).filter((x) => x.evaluation.target.concealed).length;
      const opt = d.options.find((o) => o.type === 'expose' && top && fitExposures(top.target, [...obs.exposures[obs.seat], { tile: o.tile, count: o.count, jokers: 0 }]));
      if (top && (top.target.concealed || concealedTop >= 2)) {
        tips.push({
          kind: 'call', action: { type: 'claim', call: 'pass' }, line: 'Pass: calling commits you to an exposed hand, and your best hands are concealed.',
          detail: `Best hand: ${top.target.hand.line} (concealed). Any exposure rules out every concealed hand on the card.`,
        });
      } else if (opt) {
        tips.push({
          kind: 'call', action: { type: 'claim', call: 'expose', count: opt.count, jokers: opt.minJokers },
          line: `Call it: a ${GROUP[opt.count]} of ${displayName(d.tile)} fits your best hand.`,
          detail: `It brings ${top.target.hand.line} one tile closer. The cost: your exposure tells everyone what you’re building, and you can’t switch to a hand it doesn’t fit.`,
        });
      } else {
        tips.push({
          kind: 'call', action: { type: 'claim', call: 'pass' }, line: `Pass: this ${displayName(d.tile)} doesn’t fit your best hand.`,
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
        kind: 'fold', tile: safest.tile, action: { type: 'discard', tile: safest.tile },
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


/**
 * The single move the tips recommend right now, with its reason: Mah Jongg first, then a
 * helpful joker exchange, then the fold discard when folding is advised, then the offense tip.
 * @param {import('./observe.js').Observation} obs
 * @param {{nameOf?: (seat: number) => string, defense?: boolean}} [options]
 * @returns {{action: Object, line: string, detail: string, kind: string}|null}
 */
export function suggestion(obs, { nameOf, defense = true } = {}) {
  if (!obs.decision) return null;
  const off = offenseTips(obs, { nameOf });
  const withAction = off.tips.filter((t) => t.action);
  const mj = withAction.find((t) => t.action.type === 'mahjong' || t.action.call === 'mahjong');
  if (mj) return mj;
  const swap = withAction.find((t) => t.action.type === 'exchange');
  if (swap) return swap;
  if (defense && obs.decision.kind === 'turn') {
    const fold = defenseTips(obs, { nameOf }).tips.find((t) => t.kind === 'fold');
    if (fold) return fold;
  }
  return withAction[0] ?? null;
}
