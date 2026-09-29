// Rule variants and house rules (SPEC §4.9, §11.2). Every engine module that depends on a
// variant reads it from a rules object built here, never from a hard-coded constant.

/**
 * Allowed values per key. The first value listed is the default.
 * @type {Readonly<Record<string, readonly (string|boolean)[]>>}
 */
export const RULE_OPTIONS = Object.freeze({
  // [verify] Deal passes to the right after every hand, whoever won, including wall games.
  dealerRotation: Object.freeze(['always', 'winnerKeeps']),
  // [verify] Partners across trade 0–3 tiles; the smaller number requested is used.
  courtesyPass: Object.freeze(['min', 'off']),
  // [verify] A Mah Jongg call beats an exposure call. Otherwise (and between two calls of the
  // same kind) the player next in turn after the discarder wins. false = next in turn always wins.
  mahJonggBeatsExposure: Object.freeze([true, false]),
  // [verify] A concealed hand may take a discard as its final, winning tile.
  concealedCanCallForMahJongg: Object.freeze([true, false]),
  // [verify] Training wheels off: a false Mah Jongg makes the declarer's hand dead.
  // 'retract' lets the player take it back with no penalty. Official penalties are v2.
  falseMahJongg: Object.freeze(['deadHand', 'retract']),

  // House rules for settlement (SPEC §11.2).
  jokerlessDouble: Object.freeze([true, false]),
  selfDrawDouble: Object.freeze([true, false]),
  discarderPaysDouble: Object.freeze([true, false]),
  // [verify, house rule]
  discarderPaysAllForObviousHand: Object.freeze([false, true]),
  wallGamePayment: Object.freeze([false, true]),
});

/**
 * @typedef {Object} Rules
 * @property {'always'|'winnerKeeps'} dealerRotation
 * @property {'min'|'off'} courtesyPass
 * @property {boolean} mahJonggBeatsExposure
 * @property {boolean} concealedCanCallForMahJongg
 * @property {'deadHand'|'retract'} falseMahJongg
 * @property {boolean} jokerlessDouble
 * @property {boolean} selfDrawDouble
 * @property {boolean} discarderPaysDouble
 * @property {boolean} discarderPaysAllForObviousHand
 * @property {boolean} wallGamePayment
 */

/** @type {Readonly<Rules>} */
export const DEFAULT_RULES = Object.freeze(
  /** @type {Rules} */ (Object.fromEntries(Object.entries(RULE_OPTIONS).map(([k, opts]) => [k, opts[0]]))),
);

/**
 * Merge overrides (e.g. loaded from storage) onto the defaults. Unknown keys and invalid
 * values are ignored, so stale or hand-edited settings can never break a game.
 * @param {Record<string, unknown>} [overrides]
 * @returns {Readonly<Rules>}
 */
export function resolveRules(overrides = {}) {
  const rules = { ...DEFAULT_RULES };
  if (overrides && typeof overrides === 'object') {
    for (const [key, opts] of Object.entries(RULE_OPTIONS)) {
      if (Object.hasOwn(overrides, key) && opts.includes(/** @type {any} */ (overrides[key]))) {
        rules[key] = overrides[key];
      }
    }
  }
  return Object.freeze(rules);
}
