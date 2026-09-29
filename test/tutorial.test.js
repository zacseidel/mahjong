// The guided first hand must keep telling its story. If AI, tips, or card changes alter how
// it plays out, this test fails: choose a new seed (see TUTORIAL in js/engine/tutorial.js).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TUTORIAL, requiredAction, lessonNote } from '../js/engine/tutorial.js';
import { newGame, pending, act } from '../js/engine/game.js';
import { observe } from '../js/engine/observe.js';
import { createAI } from '../js/engine/ai/index.js';

const card = JSON.parse(readFileSync(new URL('../data/practice-card.json', import.meta.url), 'utf8'));

test('following the guided hand ends in a win that shows the key moments', () => {
  const state = newGame({ seed: TUTORIAL.seed, card, dealer: TUTORIAL.dealer });
  const ais = [0, 1, 2, 3].map((seat) => (seat === TUTORIAL.human ? null : createAI(TUTORIAL.levels[seat], { seat, seed: TUTORIAL.seed })));
  const seen = new Set();
  const order = [];
  let turns = 0;
  while (state.phase !== 'end') {
    for (const d of pending(state)) {
      const o = observe(state, d.seat);
      if (d.seat === TUTORIAL.human) {
        // Notes appear one at a time, as the player dismisses each.
        for (let note = lessonNote(o, seen); note; note = lessonNote(o, seen)) {
          seen.add(note.id);
          order.push(note.id);
        }
        const a = requiredAction(o);
        assert.ok(a, `no required action for ${d.kind}`);
        if (a.type === 'discard') turns++;
        act(state, d.seat, a);
      } else {
        act(state, d.seat, ais[d.seat].decide(o));
      }
    }
    assert.ok(turns < 30, 'the guided hand is taking too long');
  }
  const r = state.result;
  assert.equal(r.winner, TUTORIAL.human, 'the player wins');
  assert.equal(r.selfDrawn, true);
  const mine = (type) => state.events.filter((e) => e.type === type && e.seat === TUTORIAL.human).length;
  assert.ok(mine('expose') >= 1, 'the player makes a call');
  assert.ok(mine('exchange') >= 1, 'the player makes a joker exchange');
  assert.ok(state.events.some((e) => e.type === 'expose' && e.seat !== TUTORIAL.human), 'an opponent exposes');
  for (const id of ['start', 'blind', 'vote', 'play', 'oppExposure', 'call', 'exchange', 'mahjong']) {
    assert.ok(order.includes(id), `lesson note "${id}" was shown`);
  }
  assert.ok(turns <= 12, `short enough for a first hand (${turns} discards)`);
});
