// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  emptyStore, normalizeStore, blankCard, putCard, removeCard, setActive, getCard, copyOfCard,
  addHand, updateHand, removeHand, duplicateHand, moveHand, uniqueHandId, cleanHand,
  exportCard, exportFileName, importCard, previewHand, playableHands, PRACTICE_ID,
} from '../js/cardStore.js';
import { validateCard } from '../js/engine/card.js';

const HAND = { category: 'Kongs', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false };

// ---------- Store ----------

test('normalizeStore repairs anything that isn’t a valid store', () => {
  for (const bad of [null, 'x', [], { schema: 2, cards: [] }, { schema: 1 }]) assert.deepEqual(normalizeStore(bad), emptyStore());
  const store = normalizeStore({
    schema: 1,
    activeId: 'gone',
    cards: [
      { id: 'a', card: blankCard('A'), updatedAt: 't' },
      { id: 'a', card: blankCard('dup') },
      { id: PRACTICE_ID, card: blankCard('fake practice') },
      { id: 'b', card: { name: 'no hands' } },
      'junk',
      { id: 'c', card: blankCard('C') },
    ],
  });
  assert.deepEqual(store.cards.map((c) => c.id), ['a', 'c']);
  assert.equal(store.activeId, PRACTICE_ID, 'a missing active card falls back to the practice card');
  assert.equal(store.cards[1].updatedAt, '');
});

test('put, get, set active, and remove cards', () => {
  let store = putCard(emptyStore(), 'x', blankCard('X'), 't1');
  store = putCard(store, 'x', { ...blankCard('X2') }, 't2');
  assert.equal(store.cards.length, 1);
  assert.equal(getCard(store, 'x').name, 'X2');
  store = setActive(store, 'x');
  assert.equal(store.activeId, 'x');
  assert.throws(() => setActive(store, 'nope'), /No card/);
  store = removeCard(store, 'x');
  assert.deepEqual(store.cards, []);
  assert.equal(store.activeId, PRACTICE_ID, 'removing the active card falls back to practice');
});

test('copyOfCard makes an editable user copy', () => {
  const practice = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));
  const copy = copyOfCard(practice);
  assert.equal(copy.source, 'user');
  assert.equal(copy.name, 'Practice Card (copy)');
  copy.hands[0].value = 99;
  assert.notEqual(practice.hands[0].value, 99, 'deep copy');
});

// ---------- Hands ----------

test('adding hands fills in unique ids and cleans the fields', () => {
  let card = blankCard();
  card = addHand(card, { ...HAND, line: '  FF   2222g 4444g  6666g ', value: '25', notes: '  ' });
  card = addHand(card, HAND);
  assert.deepEqual(card.hands.map((h) => h.id), ['kongs-1', 'kongs-2']);
  assert.equal(card.hands[0].line, 'FF 2222g 4444g 6666g');
  assert.equal(card.hands[0].value, 25);
  assert.ok(!('notes' in card.hands[0]));
  assert.deepEqual(validateCard({ ...card, name: 'x' }), []);
});

test('update keeps the hand’s id unless it would clash', () => {
  let card = addHand(addHand(blankCard(), HAND), HAND);
  card = updateHand(card, 0, { ...card.hands[0], value: 30 });
  assert.equal(card.hands[0].id, 'kongs-1');
  assert.equal(card.hands[0].value, 30);
  card = updateHand(card, 1, { ...card.hands[1], id: 'kongs-1' });
  assert.notEqual(card.hands[1].id, 'kongs-1');
  assert.equal(uniqueHandId(card, 'Kongs'), 'kongs-3');
});

test('duplicate, move, and remove hands', () => {
  let card = addHand(addHand(blankCard(), HAND), { ...HAND, category: 'Winds', line: 'NNNN EEEE WWWW SS' });
  card = duplicateHand(card, 0);
  assert.deepEqual(card.hands.map((h) => h.category), ['Kongs', 'Kongs', 'Winds']);
  assert.equal(new Set(card.hands.map((h) => h.id)).size, 3);
  card = moveHand(card, 2, 0);
  assert.deepEqual(card.hands.map((h) => h.category), ['Winds', 'Kongs', 'Kongs']);
  assert.equal(moveHand(card, 0, -1), card, 'moving past the ends does nothing');
  card = removeHand(card, 0);
  assert.deepEqual(card.hands.map((h) => h.category), ['Kongs', 'Kongs']);
});

test('cleanHand keeps an advanced pattern', () => {
  const pattern = { groups: [{ tile: 'n', suit: 'A', count: 7 }, { tile: 'n', suit: 'B', count: 7 }] };
  const h = cleanHand(blankCard(), { ...HAND, pattern });
  assert.deepEqual(h.pattern, pattern);
});

// ---------- Import / export ----------

test('export then import round-trips a card', () => {
  const card = { ...addHand(blankCard('Round Trip', 2026), HAND) };
  const text = exportCard(card);
  const { card: back, errors, fatal } = importCard(text);
  assert.equal(fatal, null);
  assert.deepEqual(errors, []);
  assert.deepEqual(back, card);
  assert.equal(exportFileName(card), 'round-trip-2026.json');
});

test('import rejects files that aren’t cards', () => {
  assert.match(importCard('{nope').fatal, /valid JSON/);
  assert.match(importCard('[1,2]').fatal, /no list of hands/);
  assert.match(importCard('{"schema": 5, "hands": []}').fatal, /schema 5/);
});

test('import keeps bad hands and reports which failed', () => {
  const text = JSON.stringify({
    name: 'Mixed',
    hands: [
      HAND,
      { category: 'Broken', line: 'FF 22X2g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
      { category: 'Short', line: 'FF 222g', numbers: 'fixed', value: 25, concealed: false },
      'not a hand',
    ],
  });
  const { card, errors } = importCard(text);
  assert.equal(card.hands.length, 3);
  assert.equal(card.source, 'user');
  assert.deepEqual(errors.map((e) => [e.index, e.message]), [
    [1, 'Unknown character "X"'],
    [2, 'Hand has 5 tiles; it needs 14'],
  ]);
  assert.equal(playableHands(card), 1);
});

test('importing the practice card makes a user copy', () => {
  const text = readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8');
  const { card, errors } = importCard(text);
  assert.deepEqual(errors, []);
  assert.equal(card.source, 'user');
  assert.equal(card.hands.length, JSON.parse(text).hands.length);
});

// ---------- Preview ----------

test('preview shows up to 3 example instantiations with readable text', () => {
  const p = previewHand({ ...HAND, line: 'FF 1111g 2222g 3333g', numbers: 'shift' });
  assert.equal(p.ok, true);
  assert.equal(p.total, 7 * 3);
  assert.equal(p.examples.length, 3);
  assert.equal(p.examples[0].text, 'F×2, 1111 crak, 2222 crak, 3333 crak');
  assert.notEqual(p.examples[0].text, p.examples[2].text);
});

test('preview shows fewer examples when there are fewer ways', () => {
  const p = previewHand({ ...HAND, line: 'NNNN EEEE WWWW SS' });
  assert.equal(p.total, 1);
  assert.equal(p.examples.length, 1);
  assert.equal(p.examples[0].text, 'N×4, E×4, W×4, S×2');
});

test('preview reports parse errors with their position', () => {
  assert.deepEqual(previewHand({ ...HAND, line: 'FF 22X2g 4444g 6666g' }), { ok: false, error: 'Unknown character "X"', pos: 5 });
  assert.deepEqual(previewHand({ ...HAND, line: '11g 11g 1g NNNN SSSS F' }), { ok: false, error: 'No legal way to make this hand with the tiles in a set', pos: null });
});

test('preview uses an advanced pattern when present', () => {
  const pattern = { groups: [{ tile: 'D', suit: 'A', count: 7 }, { tile: 'D', suit: 'B', count: 7 }] };
  const p = previewHand({ ...HAND, line: '(pattern)', pattern });
  assert.equal(p.ok, true);
  assert.equal(p.total, 3);
  assert.match(p.examples[0].text, /D×7/);
});
