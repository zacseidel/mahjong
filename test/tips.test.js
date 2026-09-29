// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { candidates, candidateHands, threatLevel, dangerScores, dangerLevel, defenseReport, DEFENSE } from '../js/engine/defense.js';
import { offenseTips, defenseTips, closestHands, recommendedDiscard } from '../js/engine/tips.js';
import { newGame, pending, act } from '../js/engine/game.js';
import { observe } from '../js/engine/observe.js';
import { createAI } from '../js/engine/ai/index.js';
import { DEFAULT_RULES } from '../js/engine/rules-config.js';
import { parseTiles, fromStr, JOKER } from '../js/engine/tiles.js';

const CARD = {
  schema: 1,
  name: 'Tips test',
  hands: [
    { id: 'kongs', category: 'Evens', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
    { id: 'winds', category: 'Winds', line: 'NNN EEE 777g 888g SS', numbers: 'fixed', value: 30, concealed: false },
    { id: 'pairs', category: 'Pairs', line: 'FF 11g 22g 33g 44g 55g 66g', numbers: 'shift', value: 50, concealed: true },
  ],
};
const P = parseTiles;
const T = fromStr;

function obs(hand, decision, extra = {}) {
  return {
    seat: 0, dealer: 0, phase: extra.phase ?? 'turn', turnSeat: 0, turnNumber: 10, wallCount: extra.wallCount ?? 60,
    card: CARD, rules: DEFAULT_RULES, trainingWheels: true,
    hand: P(hand), drawn: null,
    exposures: extra.exposures ?? [[], [], [], []],
    concealedCounts: [13, 13, 13, 13], dead: extra.dead ?? [false, false, false, false],
    discards: extra.discards ?? [], discardHistory: extra.discardHistory ?? [],
    passesReceived: extra.passesReceived ?? [], passesSent: [], log: [],
    decision, result: null,
  };
}
const turn = (extra = {}) => ({ seat: 0, kind: 'turn', afterCall: false, exchanges: [], mahJongg: false, canDeclareMahJongg: false, deadTargets: [], ...extra });
const NEAR_KONGS = 'F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D 9B';
const pungN = { tile: T('NW'), count: 3, jokers: 0 };

// ---------- Defense ----------

test('candidates: any exposure rules out concealed hands and hands it doesn’t fit', () => {
  const o = obs(NEAR_KONGS, turn(), { exposures: [[], [pungN], [], []] });
  const c = candidates(o, 1);
  assert.ok(c.length > 0);
  assert.ok(c.every((x) => x.target.handId === 'winds'));
  assert.deepEqual(candidateHands(c).map((x) => x.handId), ['winds']);
  const none = candidates(obs(NEAR_KONGS, turn()), 2);
  assert.ok(none.some((x) => x.target.concealed), 'with no exposures, concealed hands stay in');
});

test('candidate weights: 0.3 per tile passed to you, 0.7 per tile discarded, that the hand needs', () => {
  const o = obs(NEAR_KONGS, turn(), {
    exposures: [[], [pungN], [], []],
    passesReceived: [{ round: 0, from: 1, tiles: P('EW 1D 1D') }],
    discardHistory: [{ seat: 1, tile: T('SW'), called: false }, { seat: 1, tile: T('9C'), called: false }],
  });
  const [c] = candidates(o, 1);
  assert.ok(Math.abs(c.weight - DEFENSE.passedPenalty * DEFENSE.discardedPenalty) < 1e-9, `weight ${c.weight}`);
});

test('candidates needing a pair or single with no live copies are dropped', () => {
  // All four South winds are visible, so the winds hand (needs SS) is impossible for seat 1.
  const o = obs('SW SW SW SW 1C 3C 5C 7C 9C 1B 3B 5B 7B', turn(), { exposures: [[], [pungN], [], []] });
  assert.deepEqual(candidates(o, 1), []);
});

test('threat: exposures set the base; late wall and a single candidate raise it', () => {
  const none = obs(NEAR_KONGS, turn());
  assert.equal(threatLevel(none, 1, candidates(none, 1)), 'low');
  const one = obs(NEAR_KONGS, turn(), { exposures: [[], [pungN], [], []] });
  // One exposure → medium base; the only surviving hand ("winds") raises it to high.
  assert.equal(threatLevel(one, 1, candidates(one, 1)), 'high');
  const late = obs(NEAR_KONGS, turn(), { wallCount: 20 });
  assert.equal(threatLevel(late, 1, candidates(late, 1)), 'medium');
  const dead = obs(NEAR_KONGS, turn(), { dead: [false, true, false, false] });
  assert.equal(threatLevel(dead, 1, candidates(dead, 1)), 'none');
});

test('danger: jokers are always safe; tiles no candidate needs are safe; needed tiles are dangerous', () => {
  const o = obs(`${NEAR_KONGS} J`, turn(), { exposures: [[], [pungN], [], []] });
  const report = defenseReport(o);
  assert.equal(report.level(JOKER), 'safe');
  assert.equal(report.level(T('WW')), 'safe', 'no hand on the card uses West');
  assert.equal(report.level(T('9D')), 'safe', 'only low-threat players might need 9s, and low threat doesn’t count');
  assert.equal(report.active, true);
  assert.equal(defenseReport(obs(NEAR_KONGS, turn())).active, false, 'nobody threatening early on');
  assert.equal(report.level(T('EW')), 'high', 'West-facing threat needs East winds');
  assert.equal(dangerLevel(0), 'safe');
  assert.equal(dangerLevel(0.05), 'low');
  assert.equal(dangerLevel(0.2), 'medium');
  assert.equal(dangerLevel(0.9), 'high');
  assert.equal(dangerScores([])[JOKER], 0);
});

// ---------- Offense ----------

test('closest hands: top distinct hands with tiles needed and tiles used', () => {
  const c = closestHands(obs(NEAR_KONGS, turn()));
  assert.equal(c[0].handId, 'kongs');
  assert.equal(c[0].distance, 2);
  assert.deepEqual(c[0].needed, [T('4C'), T('6C')]);
  assert.equal(c[0].uses.length, 12);
  assert.equal(new Set(c.map((x) => x.handId)).size, c.length);
});

test('discard tip: throw the tile none of your closest hands use', () => {
  const { tips, recommendedDiscard: rec } = offenseTips(obs(NEAR_KONGS, turn()));
  const tip = tips.find((t) => t.kind === 'discard');
  assert.ok([T('9D'), T('9B')].includes(tip.tile));
  assert.equal(rec, tip.tile);
  assert.match(tip.line, /none of your closest hands use it/);
  assert.match(tip.detail, /just as good/);
});

test('Charleston tip: pass the tiles that fit none of your closest hands', () => {
  const pass = { seat: 0, kind: 'pass', round: 0, direction: 'right', blindAllowed: false };
  const { tips } = offenseTips(obs('F F 2C 2C 2C 4C 4C 4C 6C 9D 9B 1D J', pass, { phase: 'charleston' }));
  const tip = tips.find((t) => t.kind === 'charleston');
  assert.deepEqual(tip.tiles.slice().sort((a, b) => a - b), P('9B 1D 9D').sort((a, b) => a - b));
  assert.ok(!tip.tiles.includes(JOKER));
});

test('Charleston tip suggests a blind pass when fewer than 3 tiles are spare', () => {
  const pass = { seat: 0, kind: 'pass', round: 2, direction: 'left', blindAllowed: true };
  const { tips } = offenseTips(obs('F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 6C 9D', pass, { phase: 'charleston' }));
  assert.match(tips[0].detail, /blind pass of 2/);
});

test('vote tip: stop when close, continue when far', () => {
  const vote = { seat: 0, kind: 'vote' };
  assert.match(offenseTips(obs(NEAR_KONGS.slice(0, -3), vote, { phase: 'charleston' })).tips[0].line, /Consider stopping/);
  assert.match(offenseTips(obs('1C 3C 5C 7C 9C 1B 3B 5B 7B 9B 1D 3D 5D', vote, { phase: 'charleston' })).tips[0].line, /Keep going/);
});

test('call tips: Mah Jongg, a useful exposure, a concealed best hand, and a useless call', () => {
  const claim = (tile, options) => ({ seat: 0, kind: 'claim', tile: T(tile), discarder: 1, options });
  const expose = (tile, count) => ({ type: 'expose', tile: T(tile), count, minJokers: 0, maxJokers: 0 });
  const mj = offenseTips(obs(NEAR_KONGS.slice(0, -3), claim('4C', [{ type: 'mahjong', matches: [] }]))).tips[0];
  assert.match(mj.line, /completes your hand/);
  const useful = offenseTips(obs('F F 2C 2C 2C 2C 4C 4C 4C 6C 6C 9D 9B', claim('4C', [expose('4C', 4)]))).tips[0];
  assert.match(useful.line, /Call it: a kong/);
  const concealed = offenseTips(obs('F F 1C 1C 2C 2C 3C 3C 4C 4C 5C 6C 6C', claim('6C', [expose('6C', 3)]))).tips[0];
  assert.match(concealed.line, /best hands are concealed/);
  const useless = offenseTips(obs('F F 2C 2C 2C 2C 4C 4C 4C 6C 6C NW NW', claim('NW', [expose('NW', 3)]))).tips[0];
  assert.match(useless.line, /doesn’t fit your best hand/);
});

test('joker exchange tips: take a helpful swap, keep a tile you need for a pair', () => {
  const take = offenseTips(obs(`${NEAR_KONGS.slice(0, -3)} 7B`, turn({ exchanges: [{ seat: 1, index: 0, tile: T('7B') }] }))).tips;
  assert.match(take.find((t) => t.kind === 'exchange').line, /^Swap your 7 Bam/);
  const keep = offenseTips(obs('F F 1C 1C 2C 2C 3C 3C 4C 4C 5C 5C 6C 9D', turn({ exchanges: [{ seat: 1, index: 0, tile: T('6C') }] }))).tips;
  assert.match(keep.find((t) => t.kind === 'exchange').line, /^Keep your 6 Crak/);
});

// ---------- Fold and dead hands ----------

test('fold suggestion: far from a hand, late in the wall, against a high threat', () => {
  const far = '1C 3C 5C 7C 9C 1B 3B 5B 7B 9B 1D 3D EW 5D';
  const threatening = { exposures: [[], [pungN], [], []], wallCount: 20 };
  const { tips, fold } = defenseTips(obs(far, turn(), threatening), { nameOf: (s) => ['You', 'Right', 'Across', 'Left'][s] });
  const tip = tips.find((t) => t.kind === 'fold');
  assert.ok(tip, 'fold suggested');
  assert.notEqual(fold.tile, T('EW'), 'avoids the tile Right needs');
  assert.match(tip.detail, /costs you 60 instead of 30/);
  assert.equal(recommendedDiscard(obs(far, turn(), threatening)), fold.tile);
  assert.equal(defenseTips(obs(far, turn(), { ...threatening, wallCount: 40 })).fold, null, 'not early in the wall');
  assert.equal(defenseTips(obs(NEAR_KONGS, turn(), threatening)).fold, null, 'not when close to a hand');
});

test('fold suggestion keeps jokers unless every other tile is dangerous', () => {
  const threatening = { exposures: [[], [pungN], [], []], wallCount: 20 };
  const far = '1C 3C 5C 7C 9C 1B 3B 5B 7B 9B 1D 3D J 5D';
  assert.notEqual(defenseTips(obs(far, turn(), threatening)).fold.tile, JOKER);
});

test('dead-hand alert when the engine reports one', () => {
  const { tips } = defenseTips(obs(NEAR_KONGS, turn({ deadTargets: [2] })), { nameOf: () => 'Across' });
  assert.match(tips.find((t) => t.kind === 'dead').line, /Across’s exposures don’t match any hand/);
});

test('tips run at every decision of real games without error', () => {
  const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));
  let n = 0;
  for (let g = 0; g < 15; g++) {
    const state = newGame({ seed: 300 + g, card });
    const ais = [0, 1, 2, 3].map((seat) => createAI(seat % 2 ? 'beginner' : 'intermediate', { seat, seed: 300 + g }));
    while (state.phase !== 'end') {
      for (const d of pending(state)) {
        const o = observe(state, d.seat);
        if (d.seat === 1) {
          const off = offenseTips(o);
          defenseTips(o);
          assert.ok(off.tips.length > 0 || d.kind === 'claim' || d.kind === 'courtesyPass', `no tip for ${d.kind}`);
          if (d.kind === 'turn' && !d.mahJongg) assert.ok(o.hand.includes(recommendedDiscard(o)));
          n++;
        }
        act(state, d.seat, ais[d.seat].decide(o));
      }
    }
  }
  assert.ok(n > 100);
});
