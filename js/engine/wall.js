// Building the wall, dealing, and drawing (SPEC §4.1).
// American play has no dead wall or replacement draws: after the deal, every remaining tile is drawable.

import { fullSet } from './tiles.js';
import { shuffle } from './rng.js';
import { rightOf } from './seats.js';

/**
 * @typedef {Object} Wall
 * @property {number[]} tiles  Shuffled tile ids, drawn from index `next` upward.
 * @property {number} next     Index of the next tile to draw.
 */

/**
 * Shuffle a full set into a new wall.
 * @param {import('./rng.js').Rng} rng
 * @returns {Wall}
 */
export function buildWall(rng) {
  return { tiles: shuffle(fullSet(), rng), next: 0 };
}

/**
 * Tiles left to draw.
 * @param {Wall} wall @returns {number}
 */
export function remaining(wall) {
  return wall.tiles.length - wall.next;
}

/**
 * Draw one tile, advancing the wall. Returns null when the wall is empty.
 * @param {Wall} wall @returns {number|null}
 */
export function draw(wall) {
  return wall.next < wall.tiles.length ? wall.tiles[wall.next++] : null;
}

/**
 * Deal 13 tiles to each seat, one at a time starting with the dealer and going in turn order,
 * then a 14th to the dealer. The order is fixed so a seed always reproduces the same deal.
 * @param {Wall} wall
 * @param {number} dealer  Seat of the dealer (East for this hand).
 * @returns {number[][]}   hands[seat]: tile ids in the order received.
 */
export function deal(wall, dealer) {
  if (remaining(wall) < 53) throw new Error('Not enough tiles to deal');
  const hands = [[], [], [], []];
  for (let round = 0; round < 13; round++) {
    for (let k = 0, seat = dealer; k < 4; k++, seat = rightOf(seat)) hands[seat].push(draw(wall));
  }
  hands[dealer].push(draw(wall));
  return hands;
}
