import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateCard, expandHand, compileHand, matchHand, describeTarget, HAND_SIZE } from '../js/engine/card.js';
import { COPIES, JOKER } from '../js/engine/tiles.js';

const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));

test('practice card is valid', () => {
  assert.deepEqual(validateCard(card), []);
  assert.equal(card.source, 'practice');
});

// Real tiles for a target: pairs and singles first, then groups, using jokers once copies run out.
function tilesFor(target) {
  const used = new Int8Array(COPIES.length);
  const out = [];
  for (const small of [true, false]) {
    for (const { tile, count } of target.layout) {
      if ((count < 3) !== small) continue;
      for (let k = 0; k < count; k++) out.push(used[tile] < COPIES[tile] ? (used[tile]++, tile) : JOKER);
    }
  }
  return out;
}

test('every hand has at least one legal 14-tile instantiation, and each one matches its hand', () => {
  for (const hand of card.hands) {
    const targets = expandHand(hand);
    assert.ok(targets.length > 0, hand.id);
    for (const t of targets) {
      const tiles = tilesFor(t);
      assert.equal(tiles.length, HAND_SIZE);
      assert.ok(matchHand(card, { concealed: tiles }).some((m) => m.target.handId === hand.id), describeTarget(t));
    }
  }
});

test('practice card meets SPEC §5.4 coverage', () => {
  assert.ok(card.hands.length >= 35 && card.hands.length <= 45, `${card.hands.length} hands`);
  const categories = new Set(card.hands.map((h) => h.category));
  for (const c of [String(card.year), '2468', 'Like Numbers', 'Addition', 'Quints', 'Consecutive Run',
    '13579', 'Winds & Dragons', '369', 'Singles & Pairs']) {
    assert.ok(categories.has(c), `missing category ${c}`);
  }
  for (const h of card.hands) assert.ok(h.value >= 25 && h.value <= 50, `${h.id} value ${h.value}`);
  for (const h of card.hands.filter((x) => x.category === 'Singles & Pairs')) assert.equal(h.concealed, true, h.id);
  assert.ok(card.hands.some((h) => h.concealed) && card.hands.some((h) => !h.concealed));
  const suitCounts = new Set(card.hands.map((h) => compileHand(h).suitVars.length));
  for (const n of [1, 2, 3]) assert.ok(suitCounts.has(n), `no ${n}-suit hand`);
  assert.ok(card.hands.some((h) => h.category === String(card.year) && h.line.includes(String(card.year))));
});
