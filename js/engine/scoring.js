// Settlement (SPEC §11.1–11.2).

/**
 * @typedef {Object} WinInfo
 * @property {number|null} winner     Seat, or null for a wall game.
 * @property {number|null} [discarder]  Seat that threw the winning tile, or null if self-drawn.
 * @property {boolean} [selfDrawn]
 * @property {number} [value]         Card value of the winning hand.
 * @property {boolean} [jokerless]    No jokers anywhere in the 14 tiles.
 * @property {boolean} [hasGroups]    The hand has a group of 3 or more (so jokers were possible).
 * @property {boolean} [obvious]      The winner's hand was obvious (3 or more exposures).
 */

/**
 * Value after the jokerless bonus.
 * @param {{value: number, jokerless: boolean, hasGroups: boolean}} win
 * @param {import('./rules-config.js').Rules} rules
 * @returns {number}
 */
export function effectiveValue({ value, jokerless, hasGroups }, rules) {
  return jokerless && hasGroups && rules.jokerlessDouble ? 2 * value : value;
}

/**
 * Payments for a finished hand. Positive = receives. Always sums to zero.
 * Dead players pay like anyone else.
 * @param {WinInfo} win
 * @param {import('./rules-config.js').Rules} rules
 * @returns {number[]}
 */
export function settle(win, rules) {
  const pay = [0, 0, 0, 0];
  const { winner, discarder = null, selfDrawn = false } = win;
  if (winner == null) return pay; // Wall game. (rules.wallGamePayment is not defined yet; see SPEC §11.2.)
  const v = effectiveValue(/** @type {any} */ (win), rules);
  const owed = [0, 0, 0, 0];
  for (let p = 0; p < 4; p++) {
    if (p === winner) continue;
    if (selfDrawn) owed[p] = rules.selfDrawDouble ? 2 * v : v;
    else owed[p] = p === discarder && rules.discarderPaysDouble ? 2 * v : v;
  }
  // [verify, house rule] Throwing to an obvious hand: the discarder covers everyone's share.
  if (!selfDrawn && discarder != null && win.obvious && rules.discarderPaysAllForObviousHand) {
    for (let p = 0; p < 4; p++) {
      if (p !== winner && p !== discarder) {
        owed[discarder] += owed[p];
        owed[p] = 0;
      }
    }
  }
  for (let p = 0; p < 4; p++) {
    pay[p] -= owed[p];
    pay[winner] += owed[p];
  }
  return pay;
}
