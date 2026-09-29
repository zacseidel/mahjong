// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createAI, LEVELS } from '../js/engine/ai/index.js';
import { newGame, pending, act } from '../js/engine/game.js';
import { observe } from '../js/engine/observe.js';
import { DEFAULT_RULES } from '../js/engine/rules-config.js';
import { parseTiles, fromStr, JOKER } from '../js/engine/tiles.js';

const CARD = {
  schema: 1,
  name: 'AI test',
  hands: [
    { id: 'kongs', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
    { id: 'winds', line: 'NNN EEE 777g 888g SS', numbers: 'fixed', value: 30, concealed: false },
    { id: 'pairs', line: 'FF 11g 22g 33g 44g 55g 66g', numbers: 'shift', value: 50, concealed: true },
  ],
};
const P = parseTiles;
const T = fromStr;

/** A minimal observation for seat 0. */
function obs(hand, decision, extra = {}) {
  return {
    seat: 0, dealer: 0, phase: extra.phase ?? 'turn', turnSeat: 0, turnNumber: extra.turnNumber ?? 5, wallCount: 60,
    card: CARD, rules: DEFAULT_RULES, trainingWheels: true,
    hand: P(hand), drawn: null,
    exposures: extra.exposures ?? [[], [], [], []],
    concealedCounts: [13, 13, 13, 13], dead: [false, false, false, false],
    discards: [], discardHistory: [], passesReceived: [], passesSent: [], log: [],
    decision, result: null,
  };
}
const turn = (extra = {}) => ({ seat: 0, kind: 'turn', afterCall: false, exchanges: [], mahJongg: false, canDeclareMahJongg: false, deadTargets: [], ...extra });
const ai = (level, seed = 1) => createAI(level, { seat: 0, seed });

const NEAR_KONGS = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D';
const FAR = '1C 3C 5C 7C 9C 1B 3B 5B 7B 9B 1D 3D 5D';

test('both levels exist', () => {
  assert.deepEqual(LEVELS, ['beginner', 'intermediate']);
  assert.throws(() => createAI('expert', { seat: 0, seed: 1 }), /Unknown AI level/);
});

test('stop vote: beginner never stops; intermediate stops within 3 tiles', () => {
  const vote = { seat: 0, kind: 'vote' };
  assert.deepEqual(ai('beginner').decide(obs(NEAR_KONGS, vote, { phase: 'charleston' })), { type: 'vote', stop: false });
  assert.deepEqual(ai('intermediate').decide(obs(NEAR_KONGS, vote, { phase: 'charleston' })), { type: 'vote', stop: true });
  assert.deepEqual(ai('intermediate').decide(obs(FAR, vote, { phase: 'charleston' })), { type: 'vote', stop: false });
});

test('passes: never jokers; beginner passes tiles outside its target', () => {
  const pass = { seat: 0, kind: 'pass', round: 0, direction: 'right', blindAllowed: false };
  const hand = 'F F 2C 2C 2C 4C 4C 4C J 6C 9D 9B 1D';
  for (const level of LEVELS) {
    const a = ai(level).decide(obs(hand, pass, { phase: 'charleston' }));
    assert.equal(a.tiles.length + a.blind, 3);
    assert.ok(!a.tiles.includes(JOKER), level);
  }
  const b = ai('beginner').decide(obs(hand, pass, { phase: 'charleston' }));
  assert.deepEqual(b.tiles.slice().sort((x, y) => x - y), P('9B 1D 9D').sort((x, y) => x - y));
});

test('blind pass: intermediate blinds instead of breaking up useful tiles; beginner never blinds', () => {
  const pass = { seat: 0, kind: 'pass', round: 2, direction: 'left', blindAllowed: true };
  const hand = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D';
  const i = ai('intermediate').decide(obs(hand, pass, { phase: 'charleston' }));
  assert.deepEqual(i, { type: 'pass', tiles: [T('9D')], blind: 2 });
  const b = ai('beginner').decide(obs(hand, pass, { phase: 'charleston' }));
  assert.equal(b.blind, 0);
});

test('Mah Jongg is always declared, on a turn or a claim', () => {
  for (const level of LEVELS) {
    assert.deepEqual(ai(level).decide(obs(NEAR_KONGS, turn({ mahJongg: true, canDeclareMahJongg: true }))), { type: 'mahjong' });
    const claim = { seat: 0, kind: 'claim', tile: T('4C'), options: [{ type: 'mahjong', matches: [] }, { type: 'expose', tile: T('4C'), count: 4, minJokers: 0, maxJokers: 0 }] };
    assert.deepEqual(ai(level).decide(obs(NEAR_KONGS, claim)), { type: 'claim', call: 'mahjong' });
  }
});

test('discard: both levels throw the tile their hand does not use', () => {
  const hand = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D 4C';
  for (const level of LEVELS) assert.deepEqual(ai(level).decide(obs(hand, turn())), { type: 'discard', tile: T('9D') }, level);
});

test('exposure calls: beginner calls what fits its target', () => {
  const claim = { seat: 0, kind: 'claim', tile: T('4C'), options: [{ type: 'expose', tile: T('4C'), count: 4, minJokers: 0, maxJokers: 0 }] };
  const hand = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 9D 9B';
  assert.deepEqual(ai('beginner').decide(obs(hand, claim)), { type: 'claim', call: 'expose', count: 4, jokers: 0 });
  assert.deepEqual(ai('intermediate').decide(obs(hand, claim)), { type: 'claim', call: 'expose', count: 4, jokers: 0 });
});

test('exposure calls: intermediate declines when its best hand is concealed', () => {
  // Pairs hand nearly done; a kong call would abandon it.
  const hand = 'F F 1C 1C 2C 2C 3C 3C 4C 4C 5C 6C 6C';
  const claim = { seat: 0, kind: 'claim', tile: T('6C'), options: [{ type: 'expose', tile: T('6C'), count: 3, minJokers: 0, maxJokers: 0 }] };
  assert.deepEqual(ai('intermediate').decide(obs(hand, claim)), { type: 'claim', call: 'pass' });
});

test('dead hands: intermediate declares them; beginner does not', () => {
  const d = turn({ deadTargets: [2] });
  assert.deepEqual(ai('intermediate').decide(obs(NEAR_KONGS + ' 4C', d)), { type: 'declareDead', target: 2 });
  assert.equal(ai('beginner').decide(obs(NEAR_KONGS + ' 4C', d)).type, 'discard');
});

test('joker exchange: intermediate takes one that helps', () => {
  const hand = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D 7B';
  const exchanges = [{ seat: 1, index: 0, tile: T('7B') }];
  assert.deepEqual(ai('intermediate').decide(obs(hand, turn({ exchanges }))), { type: 'exchange', seat: 1, index: 0 });
});

test('decisions are deterministic for a seed', () => {
  const run = (seed) => {
    const state = newGame({ seed, card: CARD });
    const ais = [0, 1, 2, 3].map((seat) => createAI(seat % 2 ? 'beginner' : 'intermediate', { seat, seed }));
    while (state.phase !== 'end') for (const d of pending(state)) act(state, d.seat, ais[d.seat].decide(observe(state, d.seat)));
    return state.actions;
  };
  assert.deepEqual(run(4), run(4));
});

test('intermediate wins more often than beginner', () => {
  const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));
  const wins = { beginner: 0, intermediate: 0 };
  for (let g = 0; g < 120; g++) {
    const levels = g % 2 ? ['intermediate', 'beginner', 'intermediate', 'beginner'] : ['beginner', 'intermediate', 'beginner', 'intermediate'];
    const state = newGame({ seed: 5000 + g, card });
    const ais = [0, 1, 2, 3].map((seat) => createAI(levels[seat], { seat, seed: 5000 + g }));
    while (state.phase !== 'end') for (const d of pending(state)) act(state, d.seat, ais[d.seat].decide(observe(state, d.seat)));
    if (state.result.winner !== null) wins[levels[state.result.winner]]++;
  }
  assert.ok(wins.intermediate > wins.beginner * 1.2, JSON.stringify(wins));
});
