// 1,000 seeded all-AI games with invariants checked after every action (SPEC §15 stage 4).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { newGame, pending, act, checkConservation } from '../js/engine/game.js';
import { observe } from '../js/engine/observe.js';
import { createAI } from '../js/engine/ai/index.js';
import { resolveRules } from '../js/engine/rules-config.js';
import { handSize, mahJonggMatches, deadHandReason } from '../js/engine/rules.js';
import { JOKER } from '../js/engine/tiles.js';

const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));
const GAMES = 1000;
const TABLES = [
  ['intermediate', 'intermediate', 'intermediate', 'intermediate'],
  ['beginner', 'beginner', 'beginner', 'beginner'],
  ['intermediate', 'beginner', 'intermediate', 'beginner'],
];

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

test(`${GAMES} seeded all-AI games keep every invariant`, () => {
  const stats = { wins: 0, selfDrawn: 0, wall: 0, calls: 0, exchanges: 0, blind: 0, dead: 0, secondCharleston: 0 };
  for (let g = 0; g < GAMES; g++) {
    const rules = g % 4 === 3 ? resolveRules({ courtesyPass: 'off', mahJonggBeatsExposure: false }) : undefined;
    const state = newGame({ seed: g, card, rules, dealer: g % 4 });
    const levels = TABLES[g % TABLES.length];
    const ais = [0, 1, 2, 3].map((seat) => createAI(levels[seat], { seat, seed: g }));
    checkInvariants(state, 0);
    let steps = 0;
    while (state.phase !== 'end') {
      const ds = pending(state);
      assert.ok(ds.length > 0, 'stuck with no pending decision');
      for (const d of ds) {
        const before = state.events.length;
        act(state, d.seat, ais[d.seat].decide(observe(state, d.seat)));
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
