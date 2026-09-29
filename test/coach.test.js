// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { explainStep } from '../js/engine/coach.js';
import { handView, colorLegend, suggestion, closestHands } from '../js/engine/tips.js';
import { splitTerms, GLOSSARY } from '../js/glossary.js';
import { expandHand } from '../js/engine/card.js';
import { DEFAULT_RULES, resolveRules } from '../js/engine/rules-config.js';
import { newGame, pending, act } from '../js/engine/game.js';
import { observe } from '../js/engine/observe.js';
import { createAI } from '../js/engine/ai/index.js';
import { parseTiles, fromStr, JOKER, BAM, CRAK, numberTile } from '../js/engine/tiles.js';

const CARD = {
  schema: 1,
  name: 'Coach test',
  hands: [
    { id: 'kongs', category: 'Evens', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
    { id: 'mixed', category: 'Mixed', line: 'FF 2222g 44r 44b 8888g', numbers: 'fixed', value: 30, concealed: false },
    { id: 'winds', category: 'Winds', line: 'NNN EEE 777g 888g SS', numbers: 'fixed', value: 30, concealed: false },
  ],
};
const P = parseTiles;
const T = fromStr;
const names = (s) => ['You', 'Right', 'Across', 'Left'][s];

function obs(hand, decision, extra = {}) {
  return {
    seat: 0, dealer: 0, phase: extra.phase ?? 'turn', turnSeat: 0, turnNumber: 10, wallCount: 60,
    card: CARD, rules: extra.rules ?? DEFAULT_RULES, trainingWheels: extra.trainingWheels ?? true,
    hand: P(hand), drawn: extra.drawn ?? null,
    exposures: extra.exposures ?? [[], [], [], []],
    concealedCounts: [13, 13, 13, 13], dead: [false, false, false, false],
    discards: [], discardHistory: extra.discardHistory ?? [{ seat: 1, tile: T('9D'), called: false }],
    passesReceived: [], passesSent: [], log: [], decision, result: null,
  };
}
const turn = (extra = {}) => ({ seat: 0, kind: 'turn', afterCall: false, exchanges: [], mahJongg: false, canDeclareMahJongg: false, deadTargets: [], ...extra });

// ---------- Step explanations ----------

test('every decision kind gets a plain-language explanation', () => {
  const kinds = [
    { seat: 0, kind: 'pass', round: 0, direction: 'right', blindAllowed: false },
    { seat: 0, kind: 'pass', round: 2, direction: 'left', blindAllowed: true },
    { seat: 0, kind: 'pass', round: 3, direction: 'left', blindAllowed: false },
    { seat: 0, kind: 'vote' },
    { seat: 0, kind: 'courtesyRequest' },
    { seat: 0, kind: 'courtesyPass', count: 2 },
    turn(),
    { seat: 0, kind: 'claim', tile: T('4C'), discarder: 2, options: [{ type: 'expose', tile: T('4C'), count: 3, minJokers: 0, maxJokers: 0 }] },
  ];
  for (const d of kinds) {
    const e = explainStep(obs('F F 2C', d, { phase: d.kind === 'turn' || d.kind === 'claim' ? d.kind : 'charleston' }), { nameOf: names });
    assert.ok(e && e.title && e.text.length > 40, d.kind);
  }
});

test('Charleston explanations name who you pass to and receive from', () => {
  const first = explainStep(obs('F', { seat: 0, kind: 'pass', round: 0, direction: 'right', blindAllowed: false }, { phase: 'charleston' }), { nameOf: names });
  assert.match(first.text, /pass them right to Right/);
  assert.match(first.text, /3 back from Left/);
  assert.match(first.text, /Jokers can never be passed/);
  const blind = explainStep(obs('F', { seat: 0, kind: 'pass', round: 2, direction: 'left', blindAllowed: true }, { phase: 'charleston' }), { nameOf: names });
  assert.match(blind.text, /blind pass/);
  assert.match(blind.text, /coming to you from Right/, 'passing left, tiles arrive from the right');
});

test('turn explanations: first discard, after a call, exchanges, training wheels, dead hands', () => {
  const east = explainStep(obs('F', turn(), { discardHistory: [] }), { nameOf: names });
  assert.match(east.text, /As East/);
  assert.match(explainStep(obs('F', turn({ afterCall: true })), { nameOf: names }).text, /anyone in between is skipped/);
  assert.match(explainStep(obs('F', turn({ exchanges: [{ seat: 1, index: 0, tile: T('NW') }] })), { nameOf: names }).text, /swap it for the joker/);
  assert.match(explainStep(obs('F', turn(), { trainingWheels: false }), { nameOf: names }).text, /penalty/);
  assert.match(explainStep(obs('F', turn({ deadTargets: [2] })), { nameOf: names }).text, /Across’s exposures/);
});

test('claim explanation follows the call-priority setting', () => {
  const d = { seat: 0, kind: 'claim', tile: T('4C'), discarder: 1, options: [{ type: 'expose', tile: T('4C'), count: 3, minJokers: 0, maxJokers: 0 }] };
  assert.match(explainStep(obs('F', d, { phase: 'claim' }), { nameOf: names }).text, /a Mah Jongg call wins/);
  const off = explainStep(obs('F', d, { phase: 'claim', rules: resolveRules({ mahJonggBeatsExposure: false }) }), { nameOf: names });
  assert.doesNotMatch(off.text, /Mah Jongg call wins/);
  const win = explainStep(obs('F', { ...d, options: [{ type: 'mahjong', matches: [] }] }, { phase: 'claim' }), { nameOf: names });
  assert.equal(win.title, 'You can win!');
});

// ---------- Glossary ----------

test('splitTerms marks each term once, longest match first, case-insensitive', () => {
  const parts = splitTerms('Call a pung. A pung needs jokers; a joker exchange too.');
  const terms = parts.filter((p) => p.term).map((p) => [p.text, p.term]);
  assert.deepEqual(terms, [['Call', 'call'], ['pung', 'pung'], ['jokers', 'joker'], ['joker exchange', 'exchange']]);
  assert.equal(parts.map((p) => p.text).join(''), 'Call a pung. A pung needs jokers; a joker exchange too.');
  const seen = new Set(['pung']);
  assert.ok(!splitTerms('a pung', seen).some((p) => p.term), 'already-defined terms are skipped');
  for (const [key, g] of Object.entries(GLOSSARY)) assert.ok(g.text.length > 20 && g.match.length, key);
});

// ---------- Hand view and color legend ----------

test('handView marks held, joker-filled, exposed, and needed tiles; pairs before groups', () => {
  const [target] = expandHand(CARD.hands[1]).filter((t) => t.layout[1].tile === numberTile(CRAK, 2) && suitOf4(t) === BAM);
  // FF 2222C 44B 44D 8888C (g = Craks, r = Bams, b = Dots)
  const view = handView(target, P('F 2C 2C 2C 4B 4B 8C J J'), []);
  assert.deepEqual(view.map((g) => g.cells), [
    ['have', 'need'],
    ['have', 'have', 'have', 'joker'],
    ['have', 'have'],
    ['need', 'need'],
    ['have', 'joker', 'need', 'need'],
  ]);
  const exposed = handView(target, P('F F 4B 4B 4D 4D 8C 8C 8C 8C'), [{ tile: T('2C'), count: 4, jokers: 1 }]);
  assert.deepEqual(exposed[1].cells, ['exposed', 'exposed', 'exposed', 'exposed-joker']);
});
function suitOf4(t) { return Math.floor(t.layout[2].tile / 9); }

test('colorLegend says which suit each color is in this version', () => {
  const t = expandHand(CARD.hands[1]).find((x) => x.layout[1].tile === numberTile(CRAK, 2) && suitOf4(x) === BAM);
  assert.deepEqual(colorLegend(t), { g: 'Craks', r: 'Bams', b: 'Dots' });
  const winds = expandHand(CARD.hands[2]).find((x) => x.layout[2].tile === numberTile(BAM, 7));
  assert.deepEqual(colorLegend(winds), { g: 'Bams' });
});

test('closest hands include the view and legend', () => {
  const [c] = closestHands(obs('F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D', turn()));
  assert.equal(c.handId, 'kongs');
  assert.deepEqual(c.legend, { g: 'Craks' });
  assert.equal(c.view.flatMap((g) => g.cells).filter((x) => x === 'need').length, c.distance);
});

// ---------- Suggestions ----------

test('suggestion: one concrete move for each decision', () => {
  const near = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D 9B';
  assert.equal(suggestion(obs(near, turn())).action.type, 'discard');
  assert.deepEqual(suggestion(obs(near, turn({ mahJongg: true }))).action, { type: 'mahjong' });
  const pass = suggestion(obs('F F 2C 2C 2C 4C 4C 4C 6C 9D 9B 1D J', { seat: 0, kind: 'pass', round: 0, direction: 'right', blindAllowed: false }, { phase: 'charleston' }));
  assert.equal(pass.action.type, 'pass');
  assert.equal(pass.action.tiles.length + pass.action.blind, 3);
  assert.ok(!pass.action.tiles.includes(JOKER));
  const blind = suggestion(obs('F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D', { seat: 0, kind: 'pass', round: 2, direction: 'left', blindAllowed: true }, { phase: 'charleston' }));
  assert.deepEqual(blind.action, { type: 'pass', tiles: [T('9D')], blind: 2 });
  const claim = suggestion(obs('F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 9D 9B', { seat: 0, kind: 'claim', tile: T('4C'), discarder: 1, options: [{ type: 'expose', tile: T('4C'), count: 4, minJokers: 0, maxJokers: 0 }] }));
  assert.deepEqual(claim.action, { type: 'claim', call: 'expose', count: 4, jokers: 0 });
});

test('suggested actions are always legal in real games', () => {
  const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));
  let n = 0;
  for (let g = 0; g < 8; g++) {
    const state = newGame({ seed: 900 + g, card });
    const ais = [0, 1, 2, 3].map((seat) => createAI('intermediate', { seat, seed: 900 + g }));
    while (state.phase !== 'end') {
      for (const d of pending(state)) {
        const o = observe(state, d.seat);
        if (d.seat === 2) {
          // Seat 2 follows the tips: the engine rejects anything illegal.
          const s = suggestion(o);
          assert.ok(s, `no suggestion for ${d.kind}`);
          act(state, d.seat, s.action);
          n++;
        } else {
          act(state, d.seat, ais[d.seat].decide(o));
        }
      }
    }
  }
  assert.ok(n > 80);
});
