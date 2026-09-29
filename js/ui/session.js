// A playing session: runs hands, drives AI seats with a short pause, keeps running totals.
// UI-side: it may use timers. It drives the engine only through newGame/pending/act, gives the
// AI only observations, and exposes the human's observation for rendering.

import { newGame, pending, act } from '../engine/game.js';
import { observe } from '../engine/observe.js';
import { createAI } from '../engine/ai/index.js';
import { resolveRules } from '../engine/rules-config.js';
import { SOUTH, EAST } from '../engine/seats.js';

export const SPEEDS = Object.freeze({ instant: 0, fast: 250, normal: 600, slow: 1200 });

export function defaultSettings() {
  return {
    humanSeat: SOUTH,
    levels: ['intermediate', 'beginner', 'intermediate', 'beginner'], // per seat; the human's is ignored
    speed: 'normal',
    trainingWheels: true,
    rules: {},
    tips: { offense: true, defense: true },
    points: 'points',
  };
}

/** A fresh seed. Randomness here is UI-side; the engine only ever uses the seed. */
export function randomSeed() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return a[0];
}

export class Session {
  /**
   * @param {{card: Object, settings: Object, onChange: () => void, onEnd: (record: Object) => void}} options
   */
  constructor({ card, settings, onChange, onEnd }) {
    this.card = card;
    this.settings = settings;
    this.onChange = onChange;
    this.onEnd = onEnd;
    this.totals = [0, 0, 0, 0];
    this.hands = [];
    this.nextDealer = EAST;
    this.state = null;
    this.timer = null;
  }

  /** Start a hand. With no arguments, a new shuffle and the next dealer. */
  newHand({ seed = randomSeed(), dealer = this.nextDealer } = {}) {
    clearTimeout(this.timer);
    const s = this.settings;
    this.human = s.humanSeat;
    this.info = { seed, dealer };
    this.finished = false;
    this.state = newGame({ seed, card: this.card, rules: resolveRules(s.rules), dealer, trainingWheels: s.trainingWheels });
    this.ais = [0, 1, 2, 3].map((seat) => (seat === this.human ? null : createAI(s.levels[seat], { seat, seed })));
    this.pump();
  }

  /** Play the same deal again (same seed and dealer; the human may choose differently). */
  replay() {
    this.newHand(this.info);
  }

  /** What the human can see right now. */
  observation() {
    return observe(this.state, this.human);
  }

  /**
   * Apply the human's decision. Returns an error message if the engine rejects it.
   * @returns {string|null}
   */
  act(action) {
    try {
      act(this.state, this.human, action);
    } catch (e) {
      return e.message;
    }
    this.pump();
    return null;
  }

  /** Is the game waiting on an AI? */
  get aiThinking() {
    return !!this.state && this.state.phase !== 'end' && pending(this.state).some((d) => this.ais[d.seat]);
  }

  pump() {
    clearTimeout(this.timer);
    this.onChange();
    const state = this.state;
    if (state.phase === 'end') return this.finish();
    const decisions = pending(state);
    const aiDecisions = decisions.filter((d) => this.ais[d.seat]);
    if (!aiDecisions.length) return; // waiting for the human
    // AI turns get a pause so the human can follow; simultaneous choices (Charleston, claims) don't.
    const simultaneous = state.phase !== 'turn';
    const delay = simultaneous ? 0 : SPEEDS[this.settings.speed] ?? SPEEDS.normal;
    this.timer = setTimeout(() => {
      if (this.state !== state) return;
      for (const d of aiDecisions) act(state, d.seat, this.ais[d.seat].decide(observe(state, d.seat)));
      this.pump();
    }, delay);
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    const r = this.state.result;
    r.payments.forEach((p, s) => { this.totals[s] += p; });
    this.nextDealer = r.nextDealer;
    const record = {
      ...this.info,
      result: r,
      human: this.human,
      building: this.ais.map((ai) => (ai ? ai.describe() : null)),
    };
    this.hands.push(record);
    this.onEnd(record);
  }
}
