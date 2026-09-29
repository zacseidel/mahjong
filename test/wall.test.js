import test from 'node:test';
import assert from 'node:assert/strict';
import { createRng } from '../js/engine/rng.js';
import { buildWall, deal, draw, remaining } from '../js/engine/wall.js';
import { COPIES, KINDS, TOTAL, toCounts } from '../js/engine/tiles.js';
import { EAST, SOUTH, WEST, NORTH } from '../js/engine/seats.js';

function assertConserved(hands, wall, drawn = []) {
  const all = [...hands.flat(), ...wall.tiles.slice(wall.next), ...drawn];
  assert.equal(all.length, TOTAL);
  const counts = toCounts(all);
  for (let id = 0; id < KINDS; id++) assert.equal(counts[id], COPIES[id], `id ${id}`);
}

test('new wall is a shuffled full set', () => {
  const wall = buildWall(createRng(1));
  assert.equal(remaining(wall), TOTAL);
  assertConserved([], wall);
});

test('deal gives 14 to the dealer, 13 to others, leaves 99', () => {
  const wall = buildWall(createRng(2));
  const hands = deal(wall, EAST);
  assert.deepEqual(hands.map((h) => h.length), [14, 13, 13, 13]);
  assert.equal(remaining(wall), 99);
  assertConserved(hands, wall);
});

test('non-East dealer gets 14', () => {
  for (const dealer of [SOUTH, WEST, NORTH]) {
    const hands = deal(buildWall(createRng(3)), dealer);
    hands.forEach((h, seat) => assert.equal(h.length, seat === dealer ? 14 : 13));
  }
});

test('deal order is dealer first, in turn order', () => {
  const wall = buildWall(createRng(4));
  const t = wall.tiles.slice();
  const hands = deal(wall, WEST);
  assert.deepEqual(hands[WEST].slice(0, 2), [t[0], t[4]]);
  assert.deepEqual(hands[NORTH].slice(0, 2), [t[1], t[5]]);
  assert.deepEqual(hands[EAST].slice(0, 2), [t[2], t[6]]);
  assert.deepEqual(hands[SOUTH].slice(0, 2), [t[3], t[7]]);
  assert.equal(hands[WEST][13], t[52]);
});

test('deal is deterministic by seed', () => {
  const a = deal(buildWall(createRng(77)), EAST);
  const b = deal(buildWall(createRng(77)), EAST);
  const c = deal(buildWall(createRng(78)), EAST);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
});

test('drawing the wall dry conserves tiles and then returns null', () => {
  const wall = buildWall(createRng(5));
  const hands = deal(wall, EAST);
  const drawn = [];
  let tile;
  while ((tile = draw(wall)) !== null) {
    drawn.push(tile);
    assertConserved(hands, wall, drawn);
  }
  assert.equal(drawn.length, 99);
  assert.equal(remaining(wall), 0);
  assert.equal(draw(wall), null);
  assert.equal(remaining(wall), 0);
});

test('deal refuses a short wall', () => {
  const wall = buildWall(createRng(6));
  wall.next = TOTAL - 52;
  assert.throws(() => deal(wall, EAST), /Not enough tiles/);
});
