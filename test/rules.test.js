// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  handSize, targetsFittingExposures, mahJonggMatches, legalCalls, resolveClaims,
  applyExposure, jokerExchanges, applyJokerExchange, deadHandReason,
} from '../js/engine/rules.js';
import { DEFAULT_RULES, resolveRules } from '../js/engine/rules-config.js';
import { parseTiles, fromStr, JOKER, toCounts } from '../js/engine/tiles.js';
import { EAST, SOUTH, WEST, NORTH } from '../js/engine/seats.js';

const CARD = {
  schema: 1,
  name: 'Rules test',
  hands: [
    { id: 'kongs', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
    { id: 'winds', line: 'NNN EEE 777g 888g SS', numbers: 'fixed', value: 30, concealed: false },
    { id: 'pairs', line: 'FF 11g 22g 33g 44g 55g 66g', numbers: 'shift', value: 50, concealed: true },
    { id: 'west', line: 'EEE WWW 1111g 1111r', numbers: 'shift', value: 40, concealed: true },
  ],
};
const P = parseTiles;
const T = fromStr;
const R = DEFAULT_RULES;
const player = (concealed, exposures = [], extra = {}) => ({ concealed: P(concealed), exposures, ...extra });
const exposeOpts = (opts) => opts.filter((o) => o.type === 'expose').map(({ count, minJokers, maxJokers }) => [count, minJokers, maxJokers]);
const types = (opts) => opts.map((o) => o.type);

// ---------- Legal calls ----------

test('a discarded joker can never be called', () => {
  const p = player('F J 2C 2C 2C J 4C 4C 4C 4C 6C 6C 6C');
  assert.deepEqual(legalCalls(p, JOKER, CARD, R), []);
});

test('a dead player cannot call', () => {
  const p = player('F F 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C', [], { dead: true });
  assert.deepEqual(legalCalls(p, T('2C'), CARD, R), []);
});

test('exposure calls must fit an exposed hand on the card', () => {
  // Two 2C in hand: a pung of 2s fits nothing (the card only has a kong of 2s).
  assert.deepEqual(legalCalls(player('2C 2C 9D 9D 9B 1C 1B 3D 5D 7D 7B 7C 3C'), T('2C'), CARD, R), []);
  // Two 2C plus a joker: a kong, which must use the joker.
  assert.deepEqual(exposeOpts(legalCalls(player('2C 2C J 9D 9B 1C 1B 3D 5D 7D 7B 7C 3C'), T('2C'), CARD, R)), [[4, 1, 1]]);
  // Three 2C and two jokers: a kong using 0–2 jokers; a quint fits nothing.
  assert.deepEqual(exposeOpts(legalCalls(player('2C 2C 2C J J 9B 1C 1B 3D 5D 7D 7B 7C'), T('2C'), CARD, R)), [[4, 0, 2]]);
});

test('a pung of winds can be called', () => {
  const opts = legalCalls(player('NW NW 9D 9B 1C 1B 3D 5D 7D 7B 7C 3C 2D'), T('NW'), CARD, R);
  assert.deepEqual(exposeOpts(opts), [[3, 0, 0]]);
});

test('an exposure that fits only a concealed hand is not offered', () => {
  // WWW appears only in a concealed hand.
  assert.deepEqual(legalCalls(player('WW WW 9D 9B 1C 1B 3D 5D 7D 7B 7C 3C 2D'), T('WW'), CARD, R), []);
});

test('existing exposures limit which new exposures fit', () => {
  const kong2 = { tile: T('2C'), count: 4, jokers: 0 };
  // With a kong of 2 Crak exposed, a pung of North fits no hand.
  assert.deepEqual(legalCalls(player('NW NW 9D 9B 1C 1B 3D 5D 7D', [kong2]), T('NW'), CARD, R), []);
  // A kong of 4 Crak still fits "kongs".
  assert.deepEqual(exposeOpts(legalCalls(player('4C 4C 4C 9B 1C 1B 3D 5D 7D', [kong2]), T('4C'), CARD, R)), [[4, 0, 0]]);
  // But 4 Bam doesn't (the kongs must share a suit).
  assert.deepEqual(legalCalls(player('4B 4B 4B 9B 1C 1B 3D 5D 7D', [kong2]), T('4B'), CARD, R), []);
});

test('a pair or single can be taken only for Mah Jongg', () => {
  // Waiting on the flower pair: Mah Jongg is the only option.
  const waiting = player('F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C');
  const opts = legalCalls(waiting, T('F'), CARD, R);
  assert.deepEqual(types(opts), ['mahjong']);
  assert.deepEqual(opts[0].matches.map((m) => m.target.handId), ['kongs']);
  // One flower away but not waiting: no call at all.
  assert.deepEqual(legalCalls(player('F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 9D'), T('F'), CARD, R), []);
});

test('Mah Jongg on a discard can complete a group with exposures present', () => {
  const kong2 = { tile: T('2C'), count: 4, jokers: 1 };
  const p = player('F F 4C 4C J 4C 6C 6C 6C', [kong2]);
  const opts = legalCalls(p, T('6C'), CARD, R);
  assert.deepEqual(types(opts), ['mahjong', 'expose']);
  assert.deepEqual(opts[0].matches.map((m) => m.target.handId), ['kongs']);
  assert.equal(opts[0].matches[0].jokerless, false, 'jokers in exposures count');
});

test('a concealed hand may call the winning tile, depending on the setting', () => {
  const p = player('F F 3D 3D 4D 4D 5D 5D 6D 6D 7D 7D 8D');
  assert.deepEqual(types(legalCalls(p, T('8D'), CARD, R)), ['mahjong']);
  const strict = resolveRules({ concealedCanCallForMahJongg: false });
  assert.deepEqual(legalCalls(p, T('8D'), CARD, strict), []);
});

test('Mah Jongg and exposure can both be offered', () => {
  // Waiting on the kong of 6s: a 6C both completes the hand and could be exposed.
  const p = player('F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C');
  assert.deepEqual(types(legalCalls(p, T('6C'), CARD, R)), ['mahjong', 'expose']);
});

// ---------- Call priority ----------

test('Mah Jongg beats an exposure call, whoever is closer', () => {
  const claims = [{ seat: NORTH, type: 'expose' }, { seat: SOUTH, type: 'mahjong' }];
  assert.deepEqual(resolveClaims(WEST, claims, R), { seat: SOUTH, type: 'mahjong' });
});

test('between two exposure calls, the player next in turn wins', () => {
  const claims = [{ seat: EAST, type: 'expose' }, { seat: NORTH, type: 'expose' }];
  assert.equal(resolveClaims(WEST, claims, R).seat, NORTH);
  assert.equal(resolveClaims(SOUTH, claims, R).seat, NORTH);
  assert.equal(resolveClaims(NORTH, [{ seat: SOUTH, type: 'expose' }, { seat: EAST, type: 'expose' }], R).seat, EAST);
});

test('between two Mah Jongg calls, the player next in turn wins', () => {
  const claims = [{ seat: SOUTH, type: 'mahjong' }, { seat: WEST, type: 'mahjong' }, { seat: NORTH, type: 'mahjong' }];
  assert.equal(resolveClaims(EAST, claims, R).seat, SOUTH);
  assert.equal(resolveClaims(SOUTH, claims, R).seat, WEST);
});

test('with mahJonggBeatsExposure off, the player next in turn always wins', () => {
  const rules = resolveRules({ mahJonggBeatsExposure: false });
  const claims = [{ seat: NORTH, type: 'expose' }, { seat: SOUTH, type: 'mahjong' }];
  assert.equal(resolveClaims(WEST, claims, rules).seat, NORTH);
});

test('no claims, or only the discarder’s, resolves to null', () => {
  assert.equal(resolveClaims(EAST, [], R), null);
  assert.equal(resolveClaims(EAST, [{ seat: EAST, type: 'mahjong' }], R), null);
});

// ---------- Exposing ----------

test('applyExposure moves tiles and leaves the input alone', () => {
  const p = player('2C 2C J J 9B 1C 1B 3D 5D 7D 7B 7C 3C');
  const before = structuredClone(p);
  const q = applyExposure(p, T('2C'), 4, 1);
  assert.deepEqual(p, before);
  assert.deepEqual(q.exposures, [{ tile: T('2C'), count: 4, jokers: 1 }]);
  assert.equal(q.concealed.length, 10);
  assert.equal(toCounts(q.concealed)[JOKER], 1);
  assert.equal(handSize(q), 14, '13 held plus the called discard');
});

test('applyExposure rejects illegal exposures', () => {
  const p = player('2C 2C J 9B 1C 1B 3D 5D 7D 7B 7C 3C 4C');
  assert.throws(() => applyExposure(p, JOKER, 3, 0), /joker cannot be called/);
  assert.throws(() => applyExposure(p, T('2C'), 2, 0), /3 or more/);
  assert.throws(() => applyExposure(p, T('2C'), 4, 0), /doesn't hold/);
  assert.throws(() => applyExposure(p, T('2C'), 4, 2), /doesn't hold/);
  assert.throws(() => applyExposure(p, T('2C'), 3, 3), /Bad joker count/);
});

// ---------- Joker exchanges ----------

test('joker exchanges are found in any exposure, including your own', () => {
  const me = player('4C 7B NW 9D', [{ tile: T('4C'), count: 4, jokers: 2 }]);
  const exposuresBySeat = [
    me.exposures,
    [{ tile: T('7B'), count: 3, jokers: 1 }, { tile: T('9D'), count: 3, jokers: 0 }],
    [{ tile: T('NW'), count: 3, jokers: 1 }],
    [{ tile: T('2D'), count: 3, jokers: 1 }],
  ];
  assert.deepEqual(jokerExchanges(me, exposuresBySeat), [
    { seat: 0, index: 0, tile: T('4C') },
    { seat: 1, index: 0, tile: T('7B') },
    { seat: 2, index: 0, tile: T('NW') },
  ]);
  assert.deepEqual(jokerExchanges({ ...me, dead: true }, exposuresBySeat), []);
});

test('applyJokerExchange swaps a real tile for the joker and conserves tiles', () => {
  const players = [
    player('7B 1C 1C 2C 3C 4C 5C 6C 7C 8C 9C 1D 2D'),
    player('1B 2B 3B 4B 5B 6B 7B 8B 9B 1D', [{ tile: T('7B'), count: 3, jokers: 1 }]),
    player('1D 1D 1D 1D 2D 2D 2D 2D 3D 3D 3D 3D 5D'),
    player('4D 4D 4D 4D 5D 5D 5D 6D 6D 6D 6D 7D 7D'),
  ];
  const all = (ps) => ps.flatMap((p) => [...p.concealed, ...p.exposures.flatMap((e) => [
    ...Array(e.count - e.jokers).fill(e.tile), ...Array(e.jokers).fill(JOKER)])]);
  const after = applyJokerExchange(players, 0, { seat: 1, index: 0 });
  assert.deepEqual(after[1].exposures[0], { tile: T('7B'), count: 3, jokers: 0 });
  assert.ok(after[0].concealed.includes(JOKER));
  assert.ok(!after[0].concealed.includes(T('7B')));
  assert.equal(handSize(after[0]), 13);
  assert.deepEqual(toCounts(all(after)), toCounts(all(players)));
  assert.equal(after[2], players[2], 'untouched players are reused');
  assert.equal(players[1].exposures[0].jokers, 1, 'input not mutated');
  assert.throws(() => applyJokerExchange(after, 0, { seat: 1, index: 0 }), /no joker/);
  assert.throws(() => applyJokerExchange(players, 2, { seat: 1, index: 0 }), /matching tile/);
});

// ---------- Mah Jongg and dead hands ----------

test('mahJonggMatches on your own turn', () => {
  const p = player('F F 2C 2C 2C J 4C 4C 4C 4C 6C 6C 6C 6C');
  assert.deepEqual(mahJonggMatches(p, CARD).map((m) => m.target.handId), ['kongs']);
  assert.deepEqual(mahJonggMatches({ ...p, dead: true }, CARD), []);
  assert.deepEqual(mahJonggMatches(player('F F 2C 2C 2C J 4C 4C 4C 4C 6C 6C 6C 9C'), CARD), []);
});

test('a hand is dead when its exposures fit no hand on the card', () => {
  const kong2 = { tile: T('2C'), count: 4, jokers: 0 };
  const pungN = { tile: T('NW'), count: 3, jokers: 0 };
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C 1C 1C 1C', [kong2]), CARD), null);
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C', [kong2, pungN]), CARD), 'exposures');
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C 1C 1C 1C 1C', [pungN]), CARD), null);
});

test('a hand is dead when its tile count is wrong', () => {
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C'), CARD), 'count');
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C'), CARD), null);
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C'), CARD, 14), 'count');
  assert.equal(deadHandReason(player('1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C 1C'), CARD, 14), null);
});

test('targetsFittingExposures: no exposures fit everything, any exposure rules out concealed hands', () => {
  const all = targetsFittingExposures(CARD, []);
  assert.ok(all.some((t) => t.concealed));
  const pungE = { tile: T('EW'), count: 3, jokers: 0 };
  const fit = targetsFittingExposures(CARD, [pungE]);
  assert.ok(fit.length > 0);
  assert.ok(fit.every((t) => t.handId === 'winds'));
});

test('call, expose, discard, then win on a later discard', () => {
  let p = player('NW NW EW EW EW 7B 7B 7B 8B 8B 8B SW 9D');
  const opts = legalCalls(p, T('NW'), CARD, R);
  const expose = opts.find((o) => o.type === 'expose');
  p = applyExposure(p, T('NW'), expose.count, expose.minJokers);
  p = { ...p, concealed: p.concealed.filter((t) => t !== T('9D')) }; // discard 9D
  assert.equal(handSize(p), 13);
  assert.equal(deadHandReason(p, CARD, 13), null);
  const win = legalCalls(p, T('SW'), CARD, R);
  assert.deepEqual(types(win), ['mahjong']);
  assert.equal(win[0].matches[0].jokerless, true);
});
