// Seat indices and table geometry. Seats are numbered in turn order (play passes to the right).

export const EAST = 0;
export const SOUTH = 1;
export const WEST = 2;
export const NORTH = 3;
export const SEATS = [EAST, SOUTH, WEST, NORTH];
export const SEAT_NAMES = ['East', 'South', 'West', 'North'];

/** Player to the right: the next player in turn. @param {number} seat @returns {number} */
export function rightOf(seat) {
  return (seat + 1) % 4;
}

/** Player across. @param {number} seat @returns {number} */
export function acrossOf(seat) {
  return (seat + 2) % 4;
}

/** Player to the left: the previous player in turn. @param {number} seat @returns {number} */
export function leftOf(seat) {
  return (seat + 3) % 4;
}

/**
 * How many turns after `from` the seat `to` plays (1–3; 0 if the same seat).
 * Used for call priority: the smaller distance from the discarder wins ties.
 * @param {number} from @param {number} to @returns {number}
 */
export function turnDistance(from, to) {
  return (to - from + 4) % 4;
}

/**
 * Dealer for the next hand.
 * @param {number} dealer        Current dealer.
 * @param {number|null} winner   Winner of the hand just played, or null for a wall game.
 * @param {'always'|'winnerKeeps'} rotation  See rules-config.js `dealerRotation`.
 * @returns {number}
 */
export function nextDealer(dealer, winner, rotation = 'always') {
  if (rotation === 'winnerKeeps' && winner === dealer) return dealer;
  return rightOf(dealer);
}
