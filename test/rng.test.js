import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng, shuffle } from '../js/engine/rng.js';

const take = (rng, n) => Array.from({ length: n }, () => rng.next());

test('same seed gives the same sequence', () => {
  assert.deepEqual(take(createRng(42), 50), take(createRng(42), 50));
});

test('different seeds give different sequences', () => {
  assert.notDeepEqual(take(createRng(1), 20), take(createRng(2), 20));
});

test('next() stays in [0, 1)', () => {
  const rng = createRng(7);
  for (let i = 0; i < 10000; i++) {
    const x = rng.next();
    assert.ok(x >= 0 && x < 1, `out of range: ${x}`);
  }
});

test('int(n) stays in range and rejects bad n', () => {
  const rng = createRng(9);
  for (let i = 0; i < 5000; i++) {
    const k = rng.int(6);
    assert.ok(Number.isInteger(k) && k >= 0 && k < 6);
  }
  assert.throws(() => rng.int(0), RangeError);
  assert.throws(() => rng.int(2.5), RangeError);
});

test('int(n) is roughly uniform', () => {
  const rng = createRng(12345);
  const buckets = new Array(10).fill(0);
  const draws = 10000;
  for (let i = 0; i < draws; i++) buckets[rng.int(10)]++;
  for (const b of buckets) assert.ok(Math.abs(b - draws / 10) < 150, `bucket ${b}`);
});

test('getState allows resuming a sequence', () => {
  const a = createRng(5);
  take(a, 10);
  const b = createRng(a.getState());
  assert.deepEqual(take(a, 10), take(b, 10));
});

test('shuffle is a deterministic permutation and leaves its input alone', () => {
  const input = Array.from({ length: 50 }, (_, i) => i);
  const copy = input.slice();
  const s1 = shuffle(input, createRng(99));
  const s2 = shuffle(input, createRng(99));
  assert.deepEqual(input, copy);
  assert.deepEqual(s1, s2);
  assert.deepEqual(s1.slice().sort((x, y) => x - y), input);
  assert.notDeepEqual(s1, input);
  assert.notDeepEqual(s1, shuffle(input, createRng(100)));
});
