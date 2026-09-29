// AI factory. Every AI exposes `decide(observation) → action`; it never sees the game state.

import { createBeginner } from './beginner.js';
import { createIntermediate } from './intermediate.js';

export const LEVELS = Object.freeze(['beginner', 'intermediate']);

/**
 * @param {'beginner'|'intermediate'} level
 * @param {{seat: number, seed: number}} options
 * @returns {{level: string, decide: (obs: import('../observe.js').Observation) => Object, describe: () => Object|null}}
 */
export function createAI(level, options) {
  if (level === 'beginner') return createBeginner(options);
  if (level === 'intermediate') return createIntermediate(options);
  throw new Error(`Unknown AI level: ${level}`);
}
