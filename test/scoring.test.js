import test from 'node:test';
import assert from 'node:assert/strict';
import { settle, effectiveValue } from '../js/engine/scoring.js';
import { DEFAULT_RULES, resolveRules } from '../js/engine/rules-config.js';
import { EAST, SOUTH, WEST, NORTH } from '../js/engine/seats.js';

const R = DEFAULT_RULES;
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const win = (extra) => ({ winner: SOUTH, discarder: null, selfDrawn: false, value: 25, jokerless: false, hasGroups: true, ...extra });

test('win on a discard: discarder pays 2×, others 1×', () => {
  const pay = settle(win({ discarder: WEST }), R);
  assert.deepEqual(pay, [-25, 100, -50, -25]);
  assert.equal(sum(pay), 0);
});

test('self-drawn win: all three pay 2×', () => {
  assert.deepEqual(settle(win({ selfDrawn: true }), R), [-50, 150, -50, -50]);
});

test('jokerless doubles and stacks with self-draw', () => {
  assert.deepEqual(settle(win({ discarder: EAST, jokerless: true }), R), [-100, 200, -50, -50]);
  assert.deepEqual(settle(win({ selfDrawn: true, jokerless: true }), R), [-100, 300, -100, -100]);
});

test('singles-and-pairs hands are not doubled for jokerless', () => {
  assert.equal(effectiveValue({ value: 50, jokerless: true, hasGroups: false }, R), 50);
  assert.deepEqual(settle(win({ value: 50, discarder: NORTH, jokerless: true, hasGroups: false }), R), [-50, 200, -50, -100]);
});

test('wall game: no payments', () => {
  assert.deepEqual(settle({ winner: null }, R), [0, 0, 0, 0]);
});

test('dead players pay like anyone else', () => {
  // settle doesn't know who's dead; every non-winner pays. This documents that.
  assert.deepEqual(settle(win({ winner: EAST, discarder: SOUTH }), R), [100, -50, -25, -25]);
});

test('house rules: self-draw and discarder doubles can be turned off', () => {
  const flat = resolveRules({ selfDrawDouble: false, discarderPaysDouble: false });
  assert.deepEqual(settle(win({ selfDrawn: true }), flat), [-25, 75, -25, -25]);
  assert.deepEqual(settle(win({ discarder: WEST }), flat), [-25, 75, -25, -25]);
  const noJokerless = resolveRules({ jokerlessDouble: false });
  assert.deepEqual(settle(win({ discarder: WEST, jokerless: true }), noJokerless), [-25, 100, -50, -25]);
});

test('house rule: discarder pays for all when throwing to an obvious hand', () => {
  const rules = resolveRules({ discarderPaysAllForObviousHand: true });
  assert.deepEqual(settle(win({ discarder: WEST, obvious: true }), rules), [0, 100, -100, 0]);
  assert.deepEqual(settle(win({ discarder: WEST, obvious: false }), rules), [-25, 100, -50, -25]);
  assert.deepEqual(settle(win({ selfDrawn: true, obvious: true }), rules), [-50, 150, -50, -50]);
  assert.deepEqual(settle(win({ discarder: WEST, obvious: true }), R), [-25, 100, -50, -25], 'off by default');
});

test('settlements always sum to zero', () => {
  for (const selfDrawn of [true, false]) {
    for (const jokerless of [true, false]) {
      for (const winner of [0, 1, 2, 3]) {
        for (const discarder of [0, 1, 2, 3]) {
          if (discarder === winner) continue;
          const pay = settle(win({ winner, discarder: selfDrawn ? null : discarder, selfDrawn, jokerless, obvious: true }),
            resolveRules({ discarderPaysAllForObviousHand: true }));
          assert.equal(sum(pay), 0);
        }
      }
    }
  }
});
