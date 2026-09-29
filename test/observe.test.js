// Information hiding (SPEC §8): observations, AI, tips, and defense see only what a seat could know.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { newGame, pending, act } from '../js/engine/game.js';
import { observe } from '../js/engine/observe.js';
import { createAI } from '../js/engine/ai/index.js';
import { JOKER } from '../js/engine/tiles.js';

const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));

/** Play a game with AI, calling `visit(state)` before every decision. */
function playWith(seed, levels, visit) {
  const state = newGame({ seed, card });
  const ais = [0, 1, 2, 3].map((seat) => createAI(levels[seat], { seat, seed }));
  while (state.phase !== 'end') {
    for (const d of pending(state)) {
      visit(state, d.seat);
      act(state, d.seat, ais[d.seat].decide(observe(state, d.seat)));
    }
  }
  visit(state, 0);
  return state;
}

/** Every object reachable from a value. */
function reachable(root) {
  const seen = new Set();
  const stack = [root];
  while (stack.length) {
    const x = stack.pop();
    if (x === null || typeof x !== 'object' || seen.has(x)) continue;
    seen.add(x);
    for (const v of Object.values(x)) stack.push(v);
  }
  return seen;
}

/** A copy of the state with every hidden fact changed: other hands, the wall, their draws. */
function perturb(state, seat) {
  const s = structuredClone({ ...state, card: null });
  s.card = state.card;
  const others = [0, 1, 2, 3].filter((x) => x !== seat);
  // Rotate concealed tiles around the other players (keeping their counts) and reverse the wall.
  const pool = others.flatMap((x) => s.players[x].concealed);
  pool.push(...s.wall.tiles.slice(s.wall.next));
  pool.reverse();
  for (const x of others) {
    const n = s.players[x].concealed.length;
    s.players[x].concealed = pool.splice(0, n);
  }
  s.wall.tiles = [...s.wall.tiles.slice(0, s.wall.next), ...pool];
  for (const e of s.events) {
    if (e.type === 'draw' && e.seat !== seat) e.tile = (e.tile + 1) % 34;
    if (e.type === 'deal') e.hands = e.hands.map((h) => h.map(() => 0));
    if (e.type === 'pass' || e.type === 'courtesy') {
      // What others passed is hidden, except what reached this seat (e.received[seat], kept as is).
      for (const x of others) e.sent[x] = e.sent[x].map(() => 0);
      for (const x of others) e.received[x] = e.received[x].map(() => 0);
      if (e.blind) for (const x of others) e.blind[x] = 3;
    }
  }
  return s;
}

test('observation holds no reference to hidden state', () => {
  playWith(3, ['intermediate', 'beginner', 'intermediate', 'beginner'], (state, seat) => {
    const obs = observe(state, seat);
    const objs = reachable(obs);
    const hidden = [state.wall, state.wall.tiles, state.events, ...state.events, ...state.players];
    state.players.forEach((p, s) => { if (s !== seat) hidden.push(p.concealed); });
    for (const h of hidden) assert.ok(!objs.has(h), 'observation reaches hidden state');
  });
});

test('observations do not change when hidden information changes', () => {
  let checked = 0;
  playWith(8, ['beginner', 'intermediate', 'beginner', 'intermediate'], (state, seat) => {
    if (state.phase === 'end') return;
    const a = observe(state, seat);
    const b = observe(perturb(state, seat), seat);
    assert.deepEqual(b, a);
    checked++;
  });
  assert.ok(checked > 100);
});

test('AI decisions do not change when hidden information changes', () => {
  // Two copies of each AI: one fed real observations, one fed observations of a perturbed state.
  const seed = 21;
  const levels = ['intermediate', 'beginner', 'intermediate', 'beginner'];
  const shadow = [0, 1, 2, 3].map((seat) => createAI(levels[seat], { seat, seed }));
  const state = newGame({ seed, card });
  const ais = [0, 1, 2, 3].map((seat) => createAI(levels[seat], { seat, seed }));
  let n = 0;
  while (state.phase !== 'end') {
    for (const d of pending(state)) {
      const real = ais[d.seat].decide(observe(state, d.seat));
      const other = shadow[d.seat].decide(observe(perturb(state, d.seat), d.seat));
      assert.deepEqual(other, real);
      act(state, d.seat, real);
      n++;
    }
  }
  assert.ok(n > 50);
});

test('observation contents: own tiles, public exposures, private draws and passes', () => {
  const state = newGame({ seed: 5, card });
  const ais = [0, 1, 2, 3].map((seat) => createAI('beginner', { seat, seed: 5 }));
  for (let k = 0; k < 40 && state.phase !== 'end'; k++) {
    for (const d of pending(state)) act(state, d.seat, ais[d.seat].decide(observe(state, d.seat)));
  }
  const obs = observe(state, 1);
  assert.deepEqual(obs.hand, state.players[1].concealed);
  assert.deepEqual(obs.concealedCounts, state.players.map((p) => p.concealed.length));
  assert.deepEqual(obs.exposures, state.players.map((p) => p.exposures));
  assert.equal(obs.wallCount, state.wall.tiles.length - state.wall.next);
  for (const e of obs.log) {
    if (e.type === 'draw' && e.seat !== 1) assert.ok(!('tile' in e), 'another player’s draw is hidden');
    if (e.type === 'deal') assert.ok(!('hands' in e));
  }
  assert.equal(obs.passesReceived.filter((p) => p.round !== 'courtesy').length, state.events.filter((e) => e.type === 'pass').length);
  for (const p of obs.passesReceived) assert.ok(!p.tiles.includes(JOKER));
  assert.equal(obs.discardHistory.length, state.events.filter((e) => e.type === 'discard').length);
});

test('AI, tips, and defense modules never import the game state machine or the wall', () => {
  const dir = new URL('../js/engine/', import.meta.url);
  const files = [
    ...readdirSync(new URL('ai/', dir)).map((f) => new URL(`ai/${f}`, dir)),
    ...['tips.js', 'defense.js', 'evaluator.js'].map((f) => new URL(f, dir)),
  ];
  for (const f of files) {
    let src;
    try { src = readFileSync(f, 'utf8'); } catch { continue; } // tips/defense arrive in stage 7
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const i of imports) {
      assert.ok(!/(^|\/)(game|wall|observe)\.js$/.test(i), `${f.pathname} imports ${i}`);
    }
  }
});
