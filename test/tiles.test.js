import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CRAK, BAM, DOT, KINDS, COPIES, TOTAL,
  NORTH_WIND, EAST_WIND, WEST_WIND, SOUTH_WIND, RED_DRAGON, GREEN_DRAGON, WHITE_DRAGON, FLOWER, JOKER,
  isNumber, isWind, isDragon, isFlower, isJoker, suitOf, rankOf, numberTile,
  dragonForSuit, suitForDragon, toStr, fromStr, parseTiles, formatTiles, displayName,
  toCounts, fromCounts, fullSet,
} from '../js/engine/tiles.js';

test('id layout matches SPEC §3', () => {
  assert.equal(numberTile(CRAK, 1), 0);
  assert.equal(numberTile(CRAK, 9), 8);
  assert.equal(numberTile(BAM, 1), 9);
  assert.equal(numberTile(BAM, 9), 17);
  assert.equal(numberTile(DOT, 1), 18);
  assert.equal(numberTile(DOT, 9), 26);
  assert.deepEqual([NORTH_WIND, EAST_WIND, WEST_WIND, SOUTH_WIND], [27, 28, 29, 30]);
  assert.deepEqual([RED_DRAGON, GREEN_DRAGON, WHITE_DRAGON], [31, 32, 33]);
  assert.equal(FLOWER, 34);
  assert.equal(JOKER, 35);
  assert.equal(KINDS, 36);
});

test('full set has 152 tiles with correct copies', () => {
  const set = fullSet();
  assert.equal(set.length, TOTAL);
  assert.equal(TOTAL, 152);
  const counts = toCounts(set);
  for (let id = 0; id < KINDS; id++) {
    assert.equal(counts[id], id === FLOWER || id === JOKER ? 8 : 4, `id ${id}`);
    assert.equal(COPIES[id], counts[id]);
  }
  assert.ok(Object.isFrozen(COPIES));
});

test('category predicates at every range boundary', () => {
  const kind = (id) => [isNumber, isWind, isDragon, isFlower, isJoker].map((f) => f(id));
  assert.deepEqual(kind(0), [true, false, false, false, false]);
  assert.deepEqual(kind(26), [true, false, false, false, false]);
  assert.deepEqual(kind(27), [false, true, false, false, false]);
  assert.deepEqual(kind(30), [false, true, false, false, false]);
  assert.deepEqual(kind(31), [false, false, true, false, false]);
  assert.deepEqual(kind(33), [false, false, true, false, false]);
  assert.deepEqual(kind(34), [false, false, false, true, false]);
  assert.deepEqual(kind(35), [false, false, false, false, true]);
  // Every id is exactly one kind.
  for (let id = 0; id < KINDS; id++) assert.equal(kind(id).filter(Boolean).length, 1, `id ${id}`);
});

test('suitOf and rankOf', () => {
  assert.deepEqual([suitOf(8), rankOf(8)], [CRAK, 9]);
  assert.deepEqual([suitOf(9), rankOf(9)], [BAM, 1]);
  assert.deepEqual([suitOf(26), rankOf(26)], [DOT, 9]);
  for (const id of [27, 30, 31, 33, 34, 35]) {
    assert.equal(suitOf(id), null);
    assert.equal(rankOf(id), null);
  }
  for (let id = 0; id <= 26; id++) assert.equal(numberTile(suitOf(id), rankOf(id)), id);
  assert.throws(() => numberTile(CRAK, 0), RangeError);
  assert.throws(() => numberTile(CRAK, 10), RangeError);
  assert.throws(() => numberTile(3, 1), RangeError);
});

test('dragon–suit pairing: Crak↔Red, Bam↔Green, Dot↔White', () => {
  assert.equal(dragonForSuit(CRAK), RED_DRAGON);
  assert.equal(dragonForSuit(BAM), GREEN_DRAGON);
  assert.equal(dragonForSuit(DOT), WHITE_DRAGON);
  for (const s of [CRAK, BAM, DOT]) assert.equal(suitForDragon(dragonForSuit(s)), s);
  assert.throws(() => dragonForSuit(3), RangeError);
  assert.throws(() => suitForDragon(NORTH_WIND), RangeError);
});

test('string codes match SPEC and round-trip for every id', () => {
  assert.deepEqual(
    [numberTile(CRAK, 3), numberTile(BAM, 7), numberTile(DOT, 5), 27, 28, 29, 30, 31, 32, 33, 34, 35].map(toStr),
    ['3C', '7B', '5D', 'NW', 'EW', 'WW', 'SW', 'RD', 'GD', 'WD', 'F', 'J'],
  );
  const seen = new Set();
  for (let id = 0; id < KINDS; id++) {
    const code = toStr(id);
    assert.ok(!seen.has(code), `duplicate code ${code}`);
    seen.add(code);
    assert.equal(fromStr(code), id);
  }
});

test('parseTiles / formatTiles', () => {
  assert.deepEqual(parseTiles(' 3C  3C J\tWD '), [2, 2, 35, 33]);
  assert.deepEqual(parseTiles(''), []);
  assert.equal(formatTiles([2, 2, 35, 33]), '3C 3C J WD');
  assert.throws(() => parseTiles('3C 0C'), /Unknown tile code/);
  assert.throws(() => fromStr('3c'), /Unknown tile code/);
  assert.throws(() => fromStr('X'), /Unknown tile code/);
});

test('displayName', () => {
  assert.equal(displayName(numberTile(CRAK, 3)), '3 Crak');
  assert.equal(displayName(numberTile(BAM, 7)), '7 Bam');
  assert.equal(displayName(numberTile(DOT, 1)), '1 Dot');
  assert.equal(displayName(NORTH_WIND), 'North Wind', 'not just “North”, which reads like a direction');
  assert.equal(displayName(GREEN_DRAGON), 'Green Dragon');
  assert.equal(displayName(WHITE_DRAGON), 'Soap');
  assert.equal(displayName(FLOWER), 'Flower');
  assert.equal(displayName(JOKER), 'Joker');
  assert.throws(() => displayName(36), RangeError);
  assert.throws(() => toStr(-1), RangeError);
});

test('toCounts / fromCounts round-trip', () => {
  const ids = parseTiles('J 3C F 3C RD J');
  const counts = toCounts(ids);
  assert.equal(counts.length, KINDS);
  assert.equal(counts[JOKER], 2);
  assert.equal(counts[fromStr('3C')], 2);
  assert.deepEqual(fromCounts(counts), ids.slice().sort((a, b) => a - b));
  assert.throws(() => toCounts([40]), RangeError);
});
