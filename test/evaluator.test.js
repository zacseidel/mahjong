// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateTarget, evaluateHand, visibleCounts, unseenCounts, removalCost, discardCosts,
  targetWeights, topTargets, neededTiles, WEIGHTS,
} from '../js/engine/evaluator.js';
import { expandHand } from '../js/engine/card.js';
import { parseTiles, fromStr, toCounts, formatTiles, COPIES, JOKER, FLOWER } from '../js/engine/tiles.js';

const P = parseTiles;
const T = fromStr;
const hand = (line, extra = {}) => ({ id: 'h', line, numbers: 'fixed', value: 25, concealed: false, ...extra });
const crak = (line, extra) => expandHand(hand(line, extra)).find((t) => t.layout.some((s) => formatTiles([s.tile]).endsWith('C')));
const evalOf = (target, tiles, exposures = [], unseen) => evaluateTarget(target, toCounts(P(tiles)), exposures, unseen);

const KONGS = crak('FF 2222g 4444g 6666g');

test('distance counts missing tiles, with jokers covering group slots only', () => {
  assert.equal(evalOf(KONGS, 'F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C').distance, 0);
  const e = evalOf(KONGS, 'F F 2C 2C 2C 4C 4C 6C 6C 6C 6C 9D 9D');
  assert.deepEqual([e.missingReal, e.missingGroup, e.distance], [0, 3, 3]);
  const j = evalOf(KONGS, 'F F 2C 2C 2C 4C 4C 6C 6C 6C 6C J J');
  assert.deepEqual([j.missingGroup, j.jokers, j.distance], [3, 2, 1], 'two jokers fill two group slots');
  const pair = evalOf(KONGS, 'F J 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C');
  assert.deepEqual([pair.missingReal, pair.missingGroup, pair.distance], [1, 1, 1], 'a joker cannot fill the flower pair');
});

test('real tiles fill pair/single slots before group slots', () => {
  // Pair of 1s and a kong of 1s, holding three 1s: the pair is filled first.
  const t = crak('11g 1111g 5555g 7777g');
  const e = evalOf(t, '1C 1C 1C 5C 5C 5C 5C 7C 7C 7C 7C J 9D');
  assert.deepEqual([e.missingReal, e.missingGroup, e.distance], [0, 3, 2]);
});

test('exposures must fit the target', () => {
  const kong2 = { tile: T('2C'), count: 4, jokers: 1 };
  const e = evalOf(KONGS, 'F F 4C 4C 4C 6C 6C 6C 6C 9D', [kong2]);
  assert.equal(e.distance, 1);
  assert.equal(evalOf(KONGS, 'F F 4C', [{ tile: T('2C'), count: 3, jokers: 0 }]), null);
});

test('a target is dead when a pair/single tile has no unseen copies', () => {
  const unseen = new Int16Array(COPIES);
  unseen[FLOWER] = 0;
  const e = evalOf(KONGS, 'F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C', [], unseen);
  assert.equal(e.dead, true);
  unseen[FLOWER] = 1;
  assert.equal(evalOf(KONGS, 'F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C', [], unseen).dead, false);
  // Group tiles with no unseen copies aren't dead: jokers can fill them.
  unseen[T('6C')] = 0;
  assert.equal(evalOf(KONGS, 'F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C', [], unseen).dead, false);
});

test('liveness is the share of needed tiles still unseen', () => {
  const unseen = new Int16Array(COPIES);
  unseen[JOKER] = 0;
  unseen[T('6C')] = 1;
  const e = evalOf(KONGS, 'F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 9D', [], unseen);
  assert.equal(e.liveness, 0.5);
  assert.deepEqual(neededTiles(e), [{ tile: T('6C'), pairOrSingle: false }, { tile: T('6C'), pairOrSingle: false }]);
});

test('visible and unseen counts come from the hand, exposures, and discards', () => {
  const obs = {
    hand: P('F F 2C J'),
    exposures: [[], [{ tile: T('2C'), count: 3, jokers: 1 }], [], []],
    discards: [{ seat: 2, tile: T('2C') }],
  };
  const v = visibleCounts(obs);
  assert.equal(v[T('2C')], 4);
  assert.equal(v[JOKER], 2);
  assert.equal(v[FLOWER], 2);
  const u = unseenCounts(obs);
  assert.equal(u[T('2C')], 0);
  assert.equal(u[JOKER], 6);
  assert.equal(u[FLOWER], 6);
});

test('removalCost: pair tiles, group tiles, surplus, and jokers', () => {
  const tiles = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C J 9D 9D';
  const have = toCounts(P(tiles));
  const e = evalOf(KONGS, tiles);
  assert.equal(e.distance, 2);
  assert.equal(removalCost(e, have, T('F')), 1, 'breaks the pair');
  assert.equal(removalCost(e, have, T('9D')), 0, 'not used');
  assert.equal(removalCost(e, have, T('2C')), 1, 'group tile; no spare jokers');
  assert.equal(removalCost(e, have, JOKER), 1, 'the joker is filling a group slot');
  // In a singles-and-pairs hand a joker is useless, so losing it is free.
  const pairs = crak('FF 11g 22g 33g 44g 55g 66g');
  const p = 'F F 1C 1C 2C 2C 3C 3C 4C 4C 5C 5C J';
  assert.equal(removalCost(evalOf(pairs, p), toCounts(P(p)), JOKER), 0);
});

test('discardCosts ranks tiles by weighted cost', () => {
  const tiles = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C J 9D 9D';
  const e = evalOf(KONGS, tiles);
  const costs = discardCosts(P(tiles), [{ evaluation: e, weight: 1 }]);
  assert.equal(costs[0].tile, T('9D'));
  assert.equal(costs[0].cost, 0);
  const joker = costs.find((c) => c.tile === JOKER);
  assert.equal(joker.cost, 1 + WEIGHTS.jokerPenalty);
});

test('evaluateHand ranks by distance then value', () => {
  const card = {
    schema: 1,
    name: 't',
    hands: [
      { id: 'cheap', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
      { id: 'dear', line: 'FF 2222g 4444g 8888g', numbers: 'fixed', value: 40, concealed: false },
      { id: 'far', line: 'NNNN EEEE WWWW SS', numbers: 'fixed', value: 50, concealed: false },
    ],
  };
  const evals = evaluateHand({ concealed: P('F F 2C 2C 2C 2C 4C 4C 4C 4C 9D 9D 9B'), exposures: [] }, card);
  assert.deepEqual(evals.slice(0, 2).map((e) => [e.target.handId, e.distance]), [['dear', 4], ['cheap', 4]]);
  assert.equal(evals.at(-1).target.handId, 'far');
  const top = topTargets(evals, 5);
  assert.deepEqual(top.map((x) => x.evaluation.target.handId), ['dear', 'cheap'], 'one entry per card hand; far is too far behind');
  const w = targetWeights(evals.slice(0, 2));
  assert.ok(w[0] > w[1], 'higher value weighs more at equal distance');
});

test('dead targets weigh nothing', () => {
  const unseen = new Int16Array(COPIES);
  unseen[FLOWER] = 0;
  const e = evalOf(KONGS, 'F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C', [], unseen);
  assert.deepEqual(targetWeights([e]), [0]);
  assert.deepEqual(topTargets([e]), []);
});
