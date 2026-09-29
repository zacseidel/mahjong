import test from 'node:test';
import assert from 'node:assert/strict';
import {
  makeRecord, emptyLedger, normalizeLedger, appendRecord, statsFor, computeStats, sessions, toCSV,
} from '../js/ledger.js';
import { defaultSettings, normalizeSettings } from '../js/settings.js';

// Human at seat 1 throughout. Payments are by absolute seat.
function rec(extra = {}, result = {}) {
  return makeRecord({
    timestamp: '2026-09-29T10:00:00.000Z', sessionId: 's1', seed: 7, dealer: 0, human: 1,
    cardId: 'practice', cardName: 'Practice Card', tipsOn: true, fold: { suggested: 0, followed: 0 }, decisions: [{ type: 'discard', tile: 3 }],
    ...extra,
    result: { winner: null, discarder: null, selfDrawn: false, handId: null, value: 0, jokerless: false, payments: [0, 0, 0, 0], ...result },
  });
}
const winOnDiscard = (extra) => rec(extra, { winner: 1, discarder: 2, handId: 'run-1', value: 25, payments: [-25, 100, -50, -25] });
const selfDrawn = (extra) => rec(extra, { winner: 1, selfDrawn: true, handId: 'pairs-1', value: 50, jokerless: true, payments: [-100, 300, -100, -100] });
const dealIn = (extra) => rec(extra, { winner: 3, discarder: 1, handId: 'odd-1', value: 30, payments: [-30, -60, -30, 120] });
const otherDealIn = (extra) => rec(extra, { winner: 3, discarder: 0, value: 30, payments: [-60, -30, -30, 120] });
const wall = (extra) => rec(extra);

test('makeRecord keeps the SPEC §11.3 fields', () => {
  const r = winOnDiscard();
  for (const k of ['timestamp', 'seed', 'cardId', 'winner', 'handId', 'value', 'jokerless', 'selfDrawn', 'discarder', 'payments', 'tipsOn', 'decisions']) {
    assert.ok(k in r, k);
  }
  assert.deepEqual(r.decisions, [{ type: 'discard', tile: 3 }]);
});

test('stats: win rate, deal-in rate, self-draw share, value, jokerless, wall games, net', () => {
  const s = statsFor([winOnDiscard(), selfDrawn(), dealIn(), otherDealIn(), wall()]);
  assert.equal(s.hands, 5);
  assert.equal(s.wins, 2);
  assert.equal(s.winRate, 2 / 5);
  assert.equal(s.dealInRate, 1 / 5, 'only your own discards count');
  assert.equal(s.selfDrawShare, 1 / 2);
  assert.equal(s.averageWinValue, (25 + 50) / 2);
  assert.equal(s.jokerlessRate, 1 / 2);
  assert.equal(s.wallGameRate, 1 / 5);
  assert.equal(s.net, 100 + 300 - 60 - 30 + 0);
});

test('stats with no data are null rather than zero', () => {
  const s = statsFor([wall()]);
  assert.equal(s.selfDrawShare, null);
  assert.equal(s.averageWinValue, null);
  assert.equal(statsFor([]).winRate, null);
  assert.equal(s.foldFollowedRate, null);
});

test('stats split by tips on and off; fold suggestions followed', () => {
  const st = computeStats([
    winOnDiscard({ tipsOn: true, fold: { suggested: 2, followed: 1 } }),
    dealIn({ tipsOn: false, fold: { suggested: 1, followed: 1 } }),
    wall({ tipsOn: false }),
  ]);
  assert.equal(st.all.hands, 3);
  assert.equal(st.tipsOn.hands, 1);
  assert.equal(st.tipsOn.winRate, 1);
  assert.equal(st.tipsOff.hands, 2);
  assert.equal(st.tipsOff.dealInRate, 1 / 2);
  assert.equal(st.all.foldSuggested, 3);
  assert.equal(st.all.foldFollowedRate, 2 / 3);
});

test('sessions: hands and net by position, newest first', () => {
  const list = sessions([
    winOnDiscard({ sessionId: 'a', timestamp: '2026-09-01T00:00:00Z' }),
    dealIn({ sessionId: 'a', timestamp: '2026-09-01T00:10:00Z' }),
    wall({ sessionId: 'b', timestamp: '2026-09-02T00:00:00Z' }),
  ]);
  assert.deepEqual(list.map((s) => s.sessionId), ['b', 'a']);
  const a = list[1];
  assert.equal(a.hands, 2);
  // Human at seat 1: You = seat 1, Right = 2, Across = 3, Left = 0.
  assert.deepEqual(a.net, [100 - 60, -50 - 30, -25 + 120, -25 - 30]);
  assert.equal(a.net.reduce((x, y) => x + y, 0), 0);
});

test('CSV: header, seats relative to you, quoting', () => {
  const csv = toCSV([winOnDiscard({ cardName: 'My "big", card' }), wall()]);
  const lines = csv.trim().split('\n');
  assert.equal(lines[0], 'time,session,card,winner,hand,value,self_drawn,jokerless,discarder,you,right,across,left,tips_on,seed');
  assert.match(lines[1], /,"My ""big"", card",You,run-1,25,false,false,Right,100,-50,-25,-25,true,7$/);
  assert.match(lines[2], /,wall game,,0,false,false,,0,0,0,0,true,7$/);
});

test('appendRecord caps history and drops old decisions', () => {
  let ledger = emptyLedger();
  for (let i = 0; i < 12; i++) ledger = appendRecord(ledger, wall({ seed: i }), { maxRecords: 10, keepDecisions: 3 });
  assert.equal(ledger.records.length, 10);
  assert.equal(ledger.records[0].seed, 2);
  assert.deepEqual(ledger.records.map((r) => r.decisions.length), [0, 0, 0, 0, 0, 0, 0, 1, 1, 1]);
});

test('normalizeLedger drops malformed records', () => {
  assert.deepEqual(normalizeLedger(null), emptyLedger());
  assert.deepEqual(normalizeLedger({ schema: 9, records: [] }), emptyLedger());
  const l = normalizeLedger({ schema: 1, records: [wall(), { junk: true }, { ...wall(), payments: [1] }] });
  assert.equal(l.records.length, 1);
});

// ---------- Settings ----------

test('tips are on by default; only a player’s own choice turns them off', () => {
  assert.deepEqual(defaultSettings().tips, { offense: true, defense: true });
  // Saved without an explicit choice: tips stay on.
  const saved = { ...defaultSettings(), speed: 'fast', tips: { offense: false, defense: false } };
  assert.deepEqual(normalizeSettings(saved).tips, { offense: true, defense: true });
  assert.equal(normalizeSettings(saved).speed, 'fast');
  // Chosen: the choice sticks across visits.
  const chosen = { ...defaultSettings(), tips: { offense: true, defense: false }, tipsChosen: true };
  assert.deepEqual(normalizeSettings(chosen).tips, { offense: true, defense: false });
});

test('normalizeSettings keeps valid values and drops the rest', () => {
  const s = normalizeSettings({
    schema: 1, humanSeat: 3, levels: ['beginner', 'expert', 'intermediate', 'beginner'], speed: 'warp',
    trainingWheels: false, points: 'both', rules: { dealerRotation: 'winnerKeeps', courtesyPass: 'maybe', bogus: 1 }, extra: 'x',
  });
  assert.equal(s.humanSeat, 3);
  assert.deepEqual(s.levels, ['beginner', 'beginner', 'intermediate', 'beginner']);
  assert.equal(s.speed, 'normal');
  assert.equal(s.trainingWheels, false);
  assert.equal(s.points, 'both');
  assert.deepEqual(s.rules, { dealerRotation: 'winnerKeeps' });
  assert.ok(!('extra' in s));
  assert.deepEqual(normalizeSettings('garbage'), defaultSettings());
  assert.deepEqual(normalizeSettings({ ...defaultSettings(), schema: 2, speed: 'fast' }), defaultSettings(), 'unknown schema → defaults');
});
