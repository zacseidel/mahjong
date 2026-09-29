// Seeded PRNG (mulberry32) and shuffle. The only source of randomness in the engine.

/**
 * @typedef {Object} Rng
 * @property {() => number} next      Float in [0, 1).
 * @property {(n: number) => number} int  Integer in [0, n).
 * @property {() => number} getState  Current internal state (uint32), for replay/debugging.
 */

/**
 * Create a seeded generator.
 * @param {number} seed  Any number; coerced to uint32.
 * @returns {Rng}
 */
export function createRng(seed) {
  let state = seed >>> 0;

  function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  function int(n) {
    if (!Number.isInteger(n) || n <= 0) throw new RangeError(`int(n) needs a positive integer, got ${n}`);
    return Math.floor(next() * n);
  }

  return { next, int, getState: () => state };
}

/**
 * Fisher–Yates shuffle. Returns a new array; the input is not modified.
 * @template T
 * @param {readonly T[]} array
 * @param {Rng} rng
 * @returns {T[]}
 */
export function shuffle(array, rng) {
  const out = array.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    const tmp = out[i];
    out[i] = out[j];
    out[j] = tmp;
  }
  return out;
}
