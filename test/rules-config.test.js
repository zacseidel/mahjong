import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_RULES, RULE_OPTIONS, resolveRules } from '../js/engine/rules-config.js';

test('defaults match SPEC §4.9 and §11.2', () => {
  assert.deepEqual({ ...DEFAULT_RULES }, {
    dealerRotation: 'always',
    courtesyPass: 'min',
    mahJonggBeatsExposure: true,
    concealedCanCallForMahJongg: true,
    falseMahJongg: 'deadHand',
    jokerlessDouble: true,
    selfDrawDouble: true,
    discarderPaysDouble: true,
    discarderPaysAllForObviousHand: false,
    wallGamePayment: false,
  });
  assert.ok(Object.isFrozen(DEFAULT_RULES));
});

test('every option list has at least two values, default first', () => {
  for (const [key, opts] of Object.entries(RULE_OPTIONS)) {
    assert.ok(opts.length >= 2, key);
    assert.equal(DEFAULT_RULES[key], opts[0]);
  }
});

test('resolveRules applies valid overrides', () => {
  const r = resolveRules({ dealerRotation: 'winnerKeeps', concealedCanCallForMahJongg: false });
  assert.equal(r.dealerRotation, 'winnerKeeps');
  assert.equal(r.concealedCanCallForMahJongg, false);
  assert.equal(r.courtesyPass, 'min');
  assert.ok(Object.isFrozen(r));
});

test('resolveRules ignores unknown keys and invalid values', () => {
  const r = resolveRules({ dealerRotation: 'sideways', jokerlessDouble: 'yes', madeUp: 1 });
  assert.deepEqual({ ...r }, { ...DEFAULT_RULES });
  assert.deepEqual({ ...resolveRules(null) }, { ...DEFAULT_RULES });
  assert.deepEqual({ ...resolveRules() }, { ...DEFAULT_RULES });
});
