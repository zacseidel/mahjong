// 1,000 seeded all-bot games with invariants checked after every action (SPEC §15 stage 4).
// The bots here are a simple test-only policy, not the real AI (stage 5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, pending, act, checkConservation } from '../js/engine/game.js';
import { createRng } from '../js/engine/rng.js';
import { resolveRules } from '../js/engine/rules-config.js';
import { expandCard, fitExposures } from '../js/engine/card.js';
import { handSize, mahJonggMatches, deadHandReason } from '../js/engine/rules.js';
import { KINDS, JOKER, toCounts } from '../js/engine/tiles.js';

const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));
const GAMES = 1000;

function distance(target, player) {
  const group = fitExposures(target, player.exposures);
  if (!group) return Infinity;
  const have = toCounts(player.concealed);
  let missingReal = 0;
  let missingGroup = 0;
  for (let t = 0; t < KINDS; t++) {
    if (t === JOKER) continue;
    missingReal += Math.max(0, target.single[t] - have[t]);
    missingGroup += Math.max(0, group[t] - Math.max(0, have[t] - target.single[t]));
  }
  return missingReal + Math.max(0, missingGroup - have[JOKER]);
}

function bestTarget(player, rng) {
  let best = [];
  let bestD = Infinity;
  for (const t of expandCard(card)) {
    const d = distance(t, player);
    if (d < bestD) { best = [t]; bestD = d; } else if (d === bestD) best.push(t);
  }
  return best.length ? best[rng.int(best.length)] : null;
}

function pick(rng, arr, n) {
  const pool = arr.slice();
  const out = [];
  for (let k = 0; k < n; k++) out.push(pool.splice(rng.int(pool.length), 1)[0]);
  return out;
}

/** Tiles the player holds beyond what the target needs, jokers excluded. */
function spare(player, target) {
  if (!target) return player.concealed.filter((t) => t !== JOKER);
  const group = fitExposures(target, player.exposures) ?? target.group;
  const used = new Int8Array(KINDS);
  return player.concealed.filter((t) => {
    if (t === JOKER) return false;
    if (used[t] < target.single[t] + group[t]) { used[t]++; return false; }
    return true;
  });
}

function decide(state, d, rng, targets) {
  const player = state.players[d.seat];
  const nonJokers = player.concealed.filter((t) => t !== JOKER);
  switch (d.kind) {
    case 'pass': {
      const blind = d.blindAllowed && rng.next() < 0.3 ? 1 + rng.int(3) : 0;
      return { type: 'pass', tiles: pick(rng, nonJokers, 3 - blind), blind };
    }
    case 'vote': return { type: 'vote', stop: rng.next() < 0.3 };
    case 'courtesyRequest': return { type: 'courtesyRequest', count: rng.int(4) };
    case 'courtesyPass': return { type: 'courtesyPass', tiles: pick(rng, nonJokers, d.count) };
    case 'claim': {
      if (d.options.some((o) => o.type === 'mahjong')) return { type: 'claim', call: 'mahjong' };
      const target = targets[d.seat];
      const fits = d.options.find((o) => o.type === 'expose' && target && !target.concealed
        && fitExposures(target, [...player.exposures, { tile: o.tile, count: o.count, jokers: 0 }]));
      if (fits && rng.next() < 0.8) return { type: 'claim', call: 'expose', count: fits.count, jokers: fits.minJokers };
      return { type: 'claim', call: 'pass' };
    }
    case 'turn': {
      if (d.mahJongg) return { type: 'mahjong' };
      if (d.deadTargets.length) return { type: 'declareDead', target: d.deadTargets[0] };
      if (d.exchanges.length) return { type: 'exchange', seat: d.exchanges[0].seat, index: d.exchanges[0].index };
      if (!targets[d.seat] || rng.next() < 0.1) targets[d.seat] = bestTarget(player, rng);
      const extra = spare(player, targets[d.seat]);
      const pool = extra.length ? extra : nonJokers.length ? nonJokers : player.concealed;
      return { type: 'discard', tile: pool[rng.int(pool.length)] };
    }
  }
  throw new Error(`No policy for ${d.kind}`);
}

function checkInvariants(state, eventsBefore) {
  checkConservation(state);
  const sizes = state.players.map(handSize);
  state.players.forEach((p, s) => {
    const size = sizes[s];
    if (p.dead) assert.ok(size === 13 || size === 14, `dead seat ${s} holds ${size}`);
    else if (state.phase === 'charleston') assert.equal(size, s === state.dealer ? 14 : 13);
    else if (state.phase === 'turn') assert.equal(size, s === state.turn.seat ? 14 : 13, `seat ${s}`);
    else if (state.phase === 'claim') assert.equal(size, 13, `seat ${s} in claim window`);
  });
  for (const e of state.events.slice(eventsBefore)) {
    if (e.type === 'pass' || e.type === 'courtesy') {
      for (const tiles of e.sent) assert.ok(!tiles.includes(JOKER), 'a joker was passed');
    }
    if (e.type === 'expose') {
      assert.equal(deadHandReason(state.players[e.seat], card, 14), null, 'an exposure call left a dead hand');
    }
    if (e.type === 'draw') assert.equal(state.players[e.seat].dead, false, 'a dead player drew');
    if (e.type === 'mahjong') assert.ok(mahJonggMatches(state.players[e.seat], card).length > 0, 'invalid win');
  }
}

test(`${GAMES} seeded all-bot games keep every invariant`, () => {
  const stats = { wins: 0, selfDrawn: 0, wall: 0, calls: 0, exchanges: 0, blind: 0, dead: 0, secondCharleston: 0 };
  for (let g = 0; g < GAMES; g++) {
    const rng = createRng(1000 + g);
    const rules = g % 4 === 3 ? resolveRules({ courtesyPass: 'off', mahJonggBeatsExposure: false }) : undefined;
    const state = newGame({ seed: g, card, rules, dealer: g % 4 });
    const targets = [null, null, null, null];
    checkInvariants(state, 0);
    let steps = 0;
    while (state.phase !== 'end') {
      const ds = pending(state);
      assert.ok(ds.length > 0, 'stuck with no pending decision');
      for (const d of ds) {
        const before = state.events.length;
        const action = decide(state, d, rng, targets);
        act(state, d.seat, action);
        if (action.type === 'claim' && action.call === 'expose') targets[d.seat] = null;
        checkInvariants(state, before);
      }
      assert.ok(++steps < 5000, 'game did not end');
    }
    const r = state.result;
    assert.equal(r.payments.reduce((a, b) => a + b, 0), 0, 'settlement does not sum to zero');
    if (r.winner === null) stats.wall++;
    else { stats.wins++; if (r.selfDrawn) stats.selfDrawn++; }
    for (const e of state.events) {
      if (e.type === 'expose') stats.calls++;
      if (e.type === 'exchange') stats.exchanges++;
      if (e.type === 'dead') stats.dead++;
      if (e.type === 'pass' && e.blind.some(Boolean)) stats.blind++;
      if (e.type === 'pass' && e.round === 3) stats.secondCharleston++;
    }
  }
  // The runs are seeded, so these are fixed; they guard against the simulation silently
  // exercising nothing.
  assert.ok(stats.wins > 20, `wins: ${stats.wins}`);
  assert.ok(stats.selfDrawn > 0 && stats.selfDrawn < stats.wins);
  assert.ok(stats.wall > 20, `wall games: ${stats.wall}`);
  assert.ok(stats.calls > 100 && stats.exchanges > 0 && stats.blind > 0 && stats.secondCharleston > 0, JSON.stringify(stats));
  console.log(`simulation: ${JSON.stringify(stats)}`);
});
