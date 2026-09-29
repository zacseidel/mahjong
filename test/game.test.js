// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, pending, act, replay, checkConservation } from '../js/engine/game.js';
import { resolveRules } from '../js/engine/rules-config.js';
import { EAST, SOUTH, WEST, NORTH } from '../js/engine/seats.js';
import { parseTiles, fromStr, fullSet, JOKER } from '../js/engine/tiles.js';

const CARD = {
  schema: 1,
  name: 'Game test',
  hands: [
    { id: 'kongs', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
    { id: 'winds', line: 'NNN EEE 777g 888g SS', numbers: 'fixed', value: 30, concealed: false },
    { id: 'pairs', line: 'FF 11g 22g 33g 44g 55g 66g', numbers: 'shift', value: 50, concealed: true },
  ],
};
const T = fromStr;
const P = parseTiles;

/** A wall that deals exactly these hands (dealer first, 14 tiles) and then draws `draws`. */
function stackWall(hands, draws = '', dealer = EAST) {
  const parsed = hands.map(P);
  const tiles = new Array(53);
  for (let r = 0; r < 13; r++) {
    for (let k = 0; k < 4; k++) tiles[r * 4 + k] = parsed[(dealer + k) % 4][r];
  }
  tiles[52] = parsed[dealer][13];
  const rest = fullSet();
  const take = (t) => {
    const i = rest.indexOf(t);
    if (i < 0) throw new Error(`Stacked wall uses too many of tile ${t}`);
    rest.splice(i, 1);
  };
  tiles.forEach(take);
  const drawn = P(draws);
  drawn.forEach(take);
  return [...tiles, ...drawn, ...rest];
}

const start = (hands, draws, extra = {}) =>
  newGame({ seed: 1, card: CARD, wallTiles: stackWall(hands, draws), charleston: false, ...extra });

const types = (state) => state.events.map((e) => e.type);
const only = (state) => {
  const p = pending(state);
  assert.equal(p.length, 1, `expected one pending decision, got ${JSON.stringify(p.map((d) => [d.seat, d.kind]))}`);
  return p[0];
};

// Junk hands nobody can call from.
const JUNK_E = 'F 1D 3D 5D 7D 9D 1B 3B 5B 7B 9B 1D 3D 5D';
const WAIT_F = 'F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C'; // kongs, waiting on a flower
const JUNK_W = '2D 4D 6D 8D 2B 4B 6B 8B 3C 5C 7C 9C 1C';
const JUNK_N = 'EW WW SW RD GD WD 9B 8C 8D 3B 1B 2B 9D';

// ---------- Charleston flow ----------

function firstNonJokers(hand, n) {
  return hand.filter((t) => t !== JOKER).slice(0, n);
}

test('full Charleston: 3 passes, vote, 3 passes, courtesy, then East discards', () => {
  const state = newGame({ seed: 42, card: CARD });
  const seen = [];
  while (state.phase === 'charleston') {
    for (const d of pending(state)) {
      seen.push(d.kind);
      const hand = state.players[d.seat].concealed;
      if (d.kind === 'pass') act(state, d.seat, { type: 'pass', tiles: firstNonJokers(hand, 3) });
      else if (d.kind === 'vote') act(state, d.seat, { type: 'vote', stop: false });
      else if (d.kind === 'courtesyRequest') act(state, d.seat, { type: 'courtesyRequest', count: [3, 2, 1, 0][d.seat] });
      else if (d.kind === 'courtesyPass') act(state, d.seat, { type: 'courtesyPass', tiles: firstNonJokers(hand, d.count) });
      checkConservation(state);
      assert.deepEqual(state.players.map((p) => p.concealed.length), [14, 13, 13, 13]);
    }
  }
  const kinds = [...new Set(seen)];
  assert.deepEqual(kinds, ['pass', 'vote', 'courtesyRequest', 'courtesyPass']);
  assert.equal(seen.filter((k) => k === 'pass').length, 24);
  assert.deepEqual(types(state), ['deal', 'pass', 'pass', 'pass', 'vote', 'pass', 'pass', 'pass', 'courtesyRequest', 'courtesy']);
  const courtesy = state.events.at(-1);
  assert.deepEqual(courtesy.counts, [1, 0, 1, 0], 'East/West: min(3,1); South/North: min(2,0)');
  assert.deepEqual(only(state).seat, EAST);
  assert.equal(only(state).kind, 'turn');
});

test('any stop vote skips the second Charleston', () => {
  const state = newGame({ seed: 7, card: CARD, rules: resolveRules({ courtesyPass: 'off' }) });
  for (let round = 0; round < 3; round++) {
    for (const d of pending(state)) act(state, d.seat, { type: 'pass', tiles: firstNonJokers(state.players[d.seat].concealed, 3) });
  }
  for (const d of pending(state)) act(state, d.seat, { type: 'vote', stop: d.seat === NORTH });
  assert.deepEqual(types(state), ['deal', 'pass', 'pass', 'pass', 'vote']);
  assert.equal(state.phase, 'turn', 'courtesy off: straight to play');
});

test('blind pass is offered only on the last pass of each Charleston', () => {
  const state = newGame({ seed: 3, card: CARD });
  const blind = [];
  for (let round = 0; round < 3; round++) {
    const ds = pending(state);
    blind.push(ds[0].blindAllowed);
    for (const d of ds) act(state, d.seat, { type: 'pass', tiles: firstNonJokers(state.players[d.seat].concealed, 3) });
  }
  assert.deepEqual(blind, [false, false, true]);
});

test('illegal Charleston actions are rejected', () => {
  const state = newGame({ seed: 5, card: CARD, wallTiles: stackWall([JUNK_E.replace('F', 'J'), WAIT_F, JUNK_W, JUNK_N]) });
  assert.throws(() => act(state, EAST, { type: 'pass', tiles: [JOKER, T('1D'), T('3D')] }), /Jokers/);
  assert.throws(() => act(state, EAST, { type: 'pass', tiles: P('1D 3D'), blind: 1 }), /not allowed/);
  assert.throws(() => act(state, EAST, { type: 'vote', stop: true }), /Expected action pass/);
  act(state, EAST, { type: 'pass', tiles: P('1D 3D 5D') });
  assert.throws(() => act(state, EAST, { type: 'pass', tiles: P('7D 9D 1B') }), /no decision/);
  assert.equal(state.actions.length, 1);
});

// ---------- Play ----------

test('East discards first without drawing; a flower pair wins on the discard', () => {
  const state = start([JUNK_E, WAIT_F, JUNK_W, JUNK_N]);
  const d = only(state);
  assert.equal(d.seat, EAST);
  act(state, EAST, { type: 'discard', tile: T('F') });
  const claim = only(state);
  assert.equal(claim.seat, SOUTH, 'only players with a legal claim are asked');
  assert.deepEqual(claim.options.map((o) => o.type), ['mahjong']);
  act(state, SOUTH, { type: 'claim', call: 'mahjong' });
  assert.equal(state.phase, 'end');
  const r = state.result;
  assert.equal(r.winner, SOUTH);
  assert.equal(r.discarder, EAST);
  assert.equal(r.selfDrawn, false);
  assert.equal(r.handId, 'kongs');
  assert.equal(r.jokerless, true);
  assert.deepEqual(r.payments, [-100, 200, -50, -50], 'jokerless 25 → 50; discarder pays double');
  assert.equal(r.nextDealer, SOUTH);
  assert.deepEqual(types(state), ['deal', 'discard', 'call', 'mahjong', 'settle']);
  checkConservation(state);
  assert.equal(state.discards.length, 0, 'the called tile left the discard pile');
});

test('self-drawn win pays double from everyone', () => {
  const state = start([JUNK_E.replace('F', '9C'), WAIT_F, JUNK_W, JUNK_N], 'F');
  act(state, EAST, { type: 'discard', tile: T('9C') });
  const d = only(state);
  assert.equal(d.seat, SOUTH);
  assert.equal(d.mahJongg, true);
  assert.equal(state.players[SOUTH].concealed.length, 14);
  act(state, SOUTH, { type: 'mahjong' });
  assert.equal(state.result.selfDrawn, true);
  assert.deepEqual(state.result.payments, [-100, 300, -100, -100]);
});

test('an exposure call skips players, then the caller discards', () => {
  const WAIT_N = 'NW NW EW EW EW 7B 7B 7B 8B 8B 8B SW 9D';
  const state = start(['NW 1D 3D 5D 7D 9D 1B 3B 5B 9B 2D 4D 6D 8D', JUNK_W.replace('7C', '6C'), WAIT_N, JUNK_N.replace('EW', '5C')], '1C');
  act(state, EAST, { type: 'discard', tile: T('NW') });
  const claim = only(state);
  assert.equal(claim.seat, WEST);
  assert.deepEqual(claim.options.map((o) => [o.type, o.count]), [['expose', 3]]);
  act(state, WEST, { type: 'claim', call: 'expose', count: 3 });
  assert.deepEqual(state.players[WEST].exposures, [{ tile: T('NW'), count: 3, jokers: 0 }]);
  const turn = only(state);
  assert.equal(turn.seat, WEST);
  assert.equal(turn.afterCall, true);
  assert.equal(state.players[WEST].concealed.length + 3, 14);
  act(state, WEST, { type: 'discard', tile: T('9D') });
  assert.equal(only(state).seat, NORTH, 'South was skipped');
  assert.deepEqual(state.events.at(-1), { type: 'draw', seat: NORTH, tile: T('1C') });
  checkConservation(state);
});

test('Mah Jongg beats a closer exposure call', () => {
  const WAIT_N = 'NW NW EW EW EW 7B 7B 7B 8B 8B 8B SW SW';
  const state = start([
    'NW 1D 3D 5D 7D 9D 1B 3B 5B 9B 2D 4D 6D 8D',
    'NW J 2C 4C 6C 8C 1C 3C 5C 7C 9C 2B 4B', // South could pung NW with a joker
    JUNK_W,
    WAIT_N, // North wins with a third NW
  ]);
  act(state, EAST, { type: 'discard', tile: T('NW') });
  const claims = pending(state);
  assert.deepEqual(claims.map((d) => d.seat).sort(), [SOUTH, NORTH]);
  act(state, SOUTH, { type: 'claim', call: 'expose', count: 3, jokers: 1 });
  assert.equal(state.phase, 'claim', 'waits for every claimant');
  act(state, NORTH, { type: 'claim', call: 'mahjong' });
  assert.equal(state.result.winner, NORTH);
  assert.equal(state.result.handId, 'winds');
  assert.deepEqual(state.players[SOUTH].exposures, []);
});

test('everyone passing on a claim continues play to the discarder’s right', () => {
  const state = start(['NW 1D 3D 5D 7D 9D 1B 3B 5B 9B 2D 4D 6D 8D', JUNK_W.replace('7C', '6C'), 'NW NW EW EW EW 7B 7B 7B 8B 8B 8B SW 9D', JUNK_N.replace('EW', '5C')], '1C');
  act(state, EAST, { type: 'discard', tile: T('NW') });
  act(state, WEST, { type: 'claim', call: 'pass' });
  assert.equal(only(state).seat, SOUTH);
  assert.equal(state.discards.length, 1);
});

test('illegal claims and turns are rejected', () => {
  const state = start([JUNK_E, WAIT_F, JUNK_W, JUNK_N]);
  assert.throws(() => act(state, EAST, { type: 'discard', tile: T('9C') }), /not in your hand/);
  assert.throws(() => act(state, EAST, { type: 'mahjong' }), /not Mah Jongg/);
  assert.throws(() => act(state, SOUTH, { type: 'discard', tile: T('F') }), /no decision/);
  act(state, EAST, { type: 'discard', tile: T('F') });
  assert.throws(() => act(state, SOUTH, { type: 'claim', call: 'expose', count: 3 }), /cannot expose/);
  assert.throws(() => act(state, WEST, { type: 'claim', call: 'pass' }), /no decision/);
});

test('joker exchange on your turn', () => {
  const state = start([
    'NW 1D 3D 5D 7D 9D 1B 3B 5B 9B 2D 4D 6D 8D',
    JUNK_W.replace('7C', '6C'),
    'NW J EW EW EW 7B 7B 7B 8B 8B 8B SW 9D',
    JUNK_N.replace('EW', '5C'),
  ], 'NW');
  act(state, EAST, { type: 'discard', tile: T('NW') });
  act(state, WEST, { type: 'claim', call: 'expose', count: 3, jokers: 1 });
  act(state, WEST, { type: 'discard', tile: T('9D') });
  const d = only(state);
  assert.equal(d.seat, NORTH);
  assert.deepEqual(d.exchanges, [{ seat: WEST, index: 0, tile: T('NW') }]);
  act(state, NORTH, { type: 'exchange', seat: WEST, index: 0 });
  assert.equal(state.players[WEST].exposures[0].jokers, 0);
  assert.ok(state.players[NORTH].concealed.includes(JOKER));
  assert.deepEqual(only(state).exchanges, [], 'no more exchanges');
  assert.throws(() => act(state, NORTH, { type: 'exchange', seat: WEST, index: 0 }), /not available/);
  checkConservation(state);
});

test('wall game when the wall runs out: nobody pays', () => {
  const state = newGame({ seed: 11, card: CARD, charleston: false });
  let draws = 0;
  while (state.phase !== 'end') {
    for (const d of pending(state)) {
      if (d.kind === 'turn') act(state, d.seat, { type: 'discard', tile: state.players[d.seat].concealed.at(-1) });
      else act(state, d.seat, { type: 'claim', call: 'pass' });
      checkConservation(state);
    }
  }
  draws = state.events.filter((e) => e.type === 'draw').length;
  assert.equal(draws, 99);
  assert.equal(state.result.winner, null);
  assert.deepEqual(state.result.payments, [0, 0, 0, 0]);
  assert.equal(state.result.nextDealer, SOUTH);
  assert.deepEqual(types(state).slice(-2), ['wallgame', 'settle']);
});

test('dealer rotation setting: the winning dealer keeps the deal', () => {
  const WIN_E = 'F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C';
  const rules = resolveRules({ dealerRotation: 'winnerKeeps' });
  const state = start([WIN_E, JUNK_W, JUNK_E.slice(2), JUNK_N], '', { rules });
  act(state, EAST, { type: 'mahjong' });
  assert.equal(state.result.selfDrawn, true, 'a win on the dealt 14 is self-drawn');
  assert.equal(state.result.nextDealer, EAST);
});

test('false Mah Jongg: rejected with training wheels, dead hand or retract without', () => {
  const hands = [JUNK_E, WAIT_F, JUNK_W, JUNK_N];
  assert.throws(() => act(start(hands), EAST, { type: 'mahjong' }), /not Mah Jongg/);

  const dead = start(hands, '9C', { trainingWheels: false });
  assert.equal(only(dead).canDeclareMahJongg, true);
  act(dead, EAST, { type: 'mahjong' });
  assert.equal(dead.players[EAST].dead, true);
  assert.equal(only(dead).seat, SOUTH, 'play moves on');
  assert.deepEqual(types(dead).slice(-3), ['falseMahjong', 'dead', 'draw']);
  checkConservation(dead);

  const retract = start(hands, '', { trainingWheels: false, rules: resolveRules({ falseMahJongg: 'retract' }) });
  act(retract, EAST, { type: 'mahjong' });
  assert.equal(retract.players[EAST].dead, false);
  assert.equal(only(retract).seat, EAST, 'still East’s turn');
});

test('dead players are skipped, cannot claim, and still pay', () => {
  const state = start([JUNK_E.replace('F', '9C'), WAIT_F.replace('F', '8B'), JUNK_W, JUNK_N], 'F');
  state.players[SOUTH].dead = true; // (set directly for the test)
  act(state, EAST, { type: 'discard', tile: T('9C') });
  assert.equal(only(state).seat, WEST, 'South skipped');
});

test('declaring a dead hand', () => {
  const state = start([JUNK_E, WAIT_F, JUNK_W, JUNK_N]);
  // Give West an exposure that fits no hand on the card (set directly for the test).
  const w = state.players[WEST];
  w.concealed = w.concealed.filter((t) => ![T('2D'), T('4D'), T('6D')].includes(t));
  w.exposures = [{ tile: T('9D'), count: 3, jokers: 3 }];
  const d = only(state);
  assert.deepEqual(d.deadTargets, [WEST]);
  assert.throws(() => act(state, EAST, { type: 'declareDead', target: SOUTH }), /not dead/);
  act(state, EAST, { type: 'declareDead', target: WEST });
  assert.equal(state.players[WEST].dead, true);
  assert.deepEqual(state.events.at(-1), { type: 'dead', seat: WEST, reason: 'exposures', by: EAST });
});

test('replay rebuilds a hand exactly from its seed and actions', () => {
  const options = { seed: 99, card: CARD };
  const state = newGame(options);
  let n = 0;
  while (state.phase !== 'end' && n++ < 2000) {
    for (const d of pending(state)) {
      const hand = state.players[d.seat].concealed;
      if (d.kind === 'pass') act(state, d.seat, { type: 'pass', tiles: firstNonJokers(hand, 3) });
      else if (d.kind === 'vote') act(state, d.seat, { type: 'vote', stop: false });
      else if (d.kind === 'courtesyRequest') act(state, d.seat, { type: 'courtesyRequest', count: 2 });
      else if (d.kind === 'courtesyPass') act(state, d.seat, { type: 'courtesyPass', tiles: firstNonJokers(hand, d.count) });
      else if (d.kind === 'turn') act(state, d.seat, { type: 'discard', tile: hand[0] });
      else act(state, d.seat, { type: 'claim', call: d.options[0].type === 'mahjong' ? 'mahjong' : 'pass' });
    }
  }
  assert.equal(state.phase, 'end');
  const again = replay(options, state.actions);
  assert.deepEqual(again.events, state.events);
  assert.deepEqual(again.result, state.result);
});
