import test from 'node:test';
import assert from 'node:assert/strict';
import { EAST, SOUTH, WEST, NORTH, rightOf, acrossOf, leftOf, turnDistance, nextDealer } from '../js/engine/seats.js';

test('turn order is East → South → West → North', () => {
  assert.deepEqual([EAST, SOUTH, WEST, NORTH].map(rightOf), [SOUTH, WEST, NORTH, EAST]);
});

test('pass directions', () => {
  assert.equal(rightOf(EAST), SOUTH);
  assert.equal(acrossOf(EAST), WEST);
  assert.equal(leftOf(EAST), NORTH);
  assert.equal(acrossOf(SOUTH), NORTH);
  assert.equal(leftOf(SOUTH), EAST);
  for (let s = 0; s < 4; s++) {
    assert.equal(rightOf(leftOf(s)), s);
    assert.equal(acrossOf(acrossOf(s)), s);
  }
});

test('turnDistance counts turns after the discarder', () => {
  assert.equal(turnDistance(EAST, SOUTH), 1);
  assert.equal(turnDistance(EAST, NORTH), 3);
  assert.equal(turnDistance(NORTH, EAST), 1);
  assert.equal(turnDistance(WEST, SOUTH), 3);
  assert.equal(turnDistance(WEST, WEST), 0);
});

test('nextDealer', () => {
  assert.equal(nextDealer(EAST, EAST), SOUTH);
  assert.equal(nextDealer(EAST, null), SOUTH);
  assert.equal(nextDealer(NORTH, WEST), EAST);
  assert.equal(nextDealer(EAST, EAST, 'winnerKeeps'), EAST);
  assert.equal(nextDealer(EAST, WEST, 'winnerKeeps'), SOUTH);
  assert.equal(nextDealer(EAST, null, 'winnerKeeps'), SOUTH);
});
