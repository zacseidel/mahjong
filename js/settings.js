// Player settings: defaults and validation of whatever was saved. Pure (no DOM, no storage).
// storage.js persists them under mj.settings.v1.

import { RULE_OPTIONS } from './engine/rules-config.js';

export const SETTINGS_SCHEMA = 1;
export const SPEED_NAMES = Object.freeze(['instant', 'fast', 'normal', 'slow']);
export const LEVEL_NAMES = Object.freeze(['beginner', 'intermediate']);
export const POINT_MODES = Object.freeze(['points', 'dollars', 'both']);

/**
 * Defaults. Tips are on by default (SPEC §10); a player's own on/off choice (tipsChosen) is kept.
 */
export function defaultSettings() {
  return {
    schema: SETTINGS_SCHEMA,
    humanSeat: 1,
    levels: ['beginner', 'beginner', 'beginner', 'beginner'], // per seat; the human's is ignored. Beginner suits new players.
    speed: 'normal',
    trainingWheels: true,
    rules: {},
    tips: { offense: true, defense: true },
    tipsChosen: false,
    explain: true, // "How this works" explanations for each step
    points: 'points',
  };
}

const pick = (value, allowed, fallback) => (allowed.includes(value) ? value : fallback);

/**
 * Merge saved settings onto the defaults, keeping only valid values. Unknown keys are dropped.
 * @param {unknown} raw  What was saved (may be anything).
 */
export function normalizeSettings(raw) {
  const d = defaultSettings();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.schema !== SETTINGS_SCHEMA) return d;
  const out = { ...d };
  if (Number.isInteger(raw.humanSeat) && raw.humanSeat >= 0 && raw.humanSeat <= 3) out.humanSeat = raw.humanSeat;
  if (Array.isArray(raw.levels) && raw.levels.length === 4) out.levels = raw.levels.map((l, i) => pick(l, LEVEL_NAMES, d.levels[i]));
  out.speed = pick(raw.speed, SPEED_NAMES, d.speed);
  if (typeof raw.trainingWheels === 'boolean') out.trainingWheels = raw.trainingWheels;
  if (typeof raw.explain === 'boolean') out.explain = raw.explain;
  out.points = pick(raw.points, POINT_MODES, d.points);
  if (raw.rules && typeof raw.rules === 'object') {
    out.rules = {};
    for (const [key, opts] of Object.entries(RULE_OPTIONS)) {
      if (Object.hasOwn(raw.rules, key) && opts.includes(raw.rules[key])) out.rules[key] = raw.rules[key];
    }
  }
  if (raw.tipsChosen === true && raw.tips && typeof raw.tips === 'object') {
    out.tipsChosen = true;
    out.tips = { offense: raw.tips.offense === true, defense: raw.tips.defense === true };
  }
  return out;
}
