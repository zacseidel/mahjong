import test from 'node:test';
import assert from 'node:assert/strict';
import { ROUNDS, passTarget, passSource, resolvePass, courtesyCount, resolveCourtesy, checkPassChoice } from '../js/engine/charleston.js';
import { EAST, SOUTH, WEST, NORTH } from '../js/engine/seats.js';
import { parseTiles, formatTiles, toCounts } from '../js/engine/tiles.js';

const P = parseTiles;
const sorted = (tiles) => formatTiles(tiles.slice().sort((a, b) => a - b));
const allTiles = (hands) => toCounts(hands.flat());

// Each seat's hand holds a distinct suit/honor so tile movement is easy to read.
const HANDS = () => [
  P('1C 2C 3C 4C 5C 6C 7C 8C 9C 1C 2C 3C 4C J'), // East: 14 with a joker
  P('1B 2B 3B 4B 5B 6B 7B 8B 9B 1B 2B 3B 4B'),
  P('1D 2D 3D 4D 5D 6D 7D 8D 9D 1D 2D 3D 4D'),
  P('NW EW WW SW RD GD WD F F NW EW WW SW'),
];
const firstThree = (hands) => hands.map((h) => ({ tiles: h.slice(0, 3) }));

test('round order: right, across, left; then left, across, right; last of each may be blind', () => {
  assert.deepEqual(ROUNDS.map((r) => r.direction), ['right', 'across', 'left', 'left', 'across', 'right']);
  assert.deepEqual(ROUNDS.map((r) => r.blind), [false, false, true, false, false, true]);
  assert.deepEqual(ROUNDS.map((r) => r.charleston), [1, 1, 1, 2, 2, 2]);
});

test('pass directions', () => {
  assert.equal(passTarget(EAST, 'right'), SOUTH);
  assert.equal(passTarget(EAST, 'across'), WEST);
  assert.equal(passTarget(EAST, 'left'), NORTH);
  for (const d of ['right', 'across', 'left']) {
    for (let s = 0; s < 4; s++) assert.equal(passSource(passTarget(s, d), d), s);
  }
});

test('a plain pass moves 3 tiles in the given direction and keeps hand sizes', () => {
  const hands = HANDS();
  const { hands: next, received } = resolvePass(hands, 'right', firstThree(hands));
  assert.equal(sorted(received[SOUTH]), '1C 2C 3C');
  assert.equal(sorted(received[EAST]), 'NW EW WW');
  assert.deepEqual(next.map((h) => h.length), [14, 13, 13, 13]);
  assert.deepEqual(allTiles(next), allTiles(hands));
  assert.equal(hands[0].length, 14, 'input not mutated');
});

test('across and left passes', () => {
  const hands = HANDS();
  assert.equal(sorted(resolvePass(hands, 'across', firstThree(hands)).received[WEST]), '1C 2C 3C');
  assert.equal(sorted(resolvePass(hands, 'left', firstThree(hands)).received[NORTH]), '1C 2C 3C');
});

test('jokers may never be passed', () => {
  const hands = HANDS();
  const choices = firstThree(hands);
  choices[EAST] = { tiles: P('1C 2C J') };
  assert.throws(() => resolvePass(hands, 'right', choices), /Jokers may never be passed/);
  assert.throws(() => checkPassChoice(hands[0], { tiles: P('J'), blind: 2 }, true), /Jokers/);
});

test('a pass is exactly 3 tiles, from the hand', () => {
  const hand = HANDS()[1];
  assert.throws(() => checkPassChoice(hand, { tiles: P('1B 2B') }, false), /exactly 3/);
  assert.throws(() => checkPassChoice(hand, { tiles: P('1B 2B 3B 4B') }, false), /exactly 3/);
  assert.throws(() => checkPassChoice(hand, { tiles: P('1B 2B 1C') }, false), /not in the hand/);
  assert.throws(() => checkPassChoice(hand, { tiles: P('1B 1B 1B') }, false), /not in the hand/);
});

test('blind passes only where allowed', () => {
  const hand = HANDS()[1];
  assert.throws(() => checkPassChoice(hand, { tiles: P('1B'), blind: 2 }, false), /not allowed/);
  assert.doesNotThrow(() => checkPassChoice(hand, { tiles: P('1B'), blind: 2 }, true));
  assert.throws(() => checkPassChoice(hand, { tiles: [], blind: 4 }, true), /Bad blind/);
});

test('a blind pass forwards received tiles unseen', () => {
  const hands = HANDS();
  const choices = firstThree(hands);
  // Passing left: North receives from East. North blinds 2: forwards 2 of East's tiles to West.
  choices[NORTH] = { tiles: P('NW'), blind: 2 };
  const { hands: next, sent, received } = resolvePass(hands, 'left', choices, true);
  assert.equal(sorted(sent[NORTH]), '1C 2C NW');
  assert.equal(sorted(received[WEST]), '1C 2C NW');
  // North keeps only the third East tile.
  assert.ok(next[NORTH].includes(P('3C')[0]));
  assert.ok(!next[NORTH].includes(P('1C')[0]));
  assert.deepEqual(next.map((h) => h.length), [14, 13, 13, 13]);
  assert.deepEqual(allTiles(next), allTiles(hands));
});

test('blind passes chain around the table', () => {
  const hands = HANDS();
  const choices = [
    { tiles: P('1C 2C 3C') },
    { tiles: [], blind: 3 },
    { tiles: [], blind: 3 },
    { tiles: [], blind: 3 },
  ];
  // Passing right: East → South → West → North → East. East's tiles travel all the way round.
  const { hands: next, received } = resolvePass(hands, 'right', choices, true);
  assert.equal(sorted(received[EAST]), '1C 2C 3C');
  assert.deepEqual(next.map(sorted), hands.map(sorted), 'everyone ends where they started');
});

test('all four blinding all 3 moves nothing', () => {
  const hands = HANDS();
  const choices = [0, 1, 2, 3].map(() => ({ tiles: [], blind: 3 }));
  const { hands: next, sent } = resolvePass(hands, 'left', choices, true);
  assert.deepEqual(next, hands);
  assert.deepEqual(sent, [[], [], [], []]);
});

test('mixed blind counts conserve tiles and hand sizes', () => {
  const hands = HANDS();
  const choices = [
    { tiles: P('1C') , blind: 2 },
    { tiles: P('1B 2B'), blind: 1 },
    { tiles: [], blind: 3 },
    { tiles: P('NW EW WW') },
  ];
  const { hands: next, received } = resolvePass(hands, 'right', choices, true);
  assert.deepEqual(next.map((h) => h.length), [14, 13, 13, 13]);
  assert.deepEqual(allTiles(next), allTiles(hands));
  for (const r of received) assert.equal(r.length, 3);
});

test('courtesy pass count is the smaller request, or 0 when off', () => {
  assert.equal(courtesyCount(3, 1, 'min'), 1);
  assert.equal(courtesyCount(0, 3, 'min'), 0);
  assert.equal(courtesyCount(2, 2, 'min'), 2);
  assert.equal(courtesyCount(3, 3, 'off'), 0);
  assert.throws(() => courtesyCount(4, 1, 'min'), /Bad courtesy/);
});

test('courtesy pass trades across', () => {
  const hands = HANDS();
  const counts = [2, 0, 2, 0];
  const { hands: next, received } = resolveCourtesy(hands, [P('1C 2C'), [], P('1D 2D'), []], counts);
  assert.equal(sorted(received[EAST]), '1D 2D');
  assert.equal(sorted(received[WEST]), '1C 2C');
  assert.deepEqual(next[SOUTH], hands[SOUTH]);
  assert.deepEqual(allTiles(next), allTiles(hands));
  assert.throws(() => resolveCourtesy(hands, [P('1C'), [], P('1D 2D'), []], counts), /must be 2/);
  assert.throws(() => resolveCourtesy(hands, [P('1C J'), [], P('1D 2D'), []], counts), /Jokers/);
});
