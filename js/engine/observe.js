// Per-seat observations (SPEC §8). AI, tips, and defense code receive only these.
// Everything returned is a fresh copy or public data (the card, legal options); nothing
// references the game state's hidden parts (other players' concealed tiles, the wall).

import { pending } from './game.js';
import { passSource, passTarget } from './charleston.js';
import { acrossOf } from './seats.js';

/**
 * @typedef {Object} Observation
 * @property {number} seat
 * @property {number} dealer
 * @property {string} phase               'charleston' | 'turn' | 'claim' | 'end'
 * @property {number|null} turnSeat       Whose turn it is (null outside a turn).
 * @property {number} turnNumber          Discards made so far.
 * @property {number} wallCount           Tiles left to draw.
 * @property {Object} card
 * @property {import('./rules-config.js').Rules} rules
 * @property {boolean} trainingWheels
 * @property {number[]} hand              This seat's concealed tiles.
 * @property {number|null} drawn          The tile this seat just drew, on its own turn.
 * @property {import('./card.js').Exposure[][]} exposures  Every seat's exposures.
 * @property {number[]} concealedCounts   How many concealed tiles each seat holds.
 * @property {boolean[]} dead
 * @property {{seat: number, tile: number}[]} discards        The discard pile now.
 * @property {{seat: number, tile: number, called: boolean}[]} discardHistory  Every discard, in order.
 * @property {{round: number|'courtesy', from: number, tiles: number[]}[]} passesReceived
 * @property {{round: number|'courtesy', to: number, tiles: number[]}[]} passesSent
 * @property {Object[]} log               Public events, plus this seat's private ones.
 * @property {Object|null} decision       This seat's pending decision, with its legal options.
 * @property {Object|null} result         Hand result once it has ended (public).
 */

/**
 * @param {Object} state  Full game state (from game.js).
 * @param {number} seat
 * @returns {Observation}
 */
export function observe(state, seat) {
  const log = [];
  const discardHistory = [];
  const passesReceived = [];
  const passesSent = [];

  for (const e of state.events) {
    switch (e.type) {
      case 'deal':
        log.push({ type: 'deal', dealer: e.dealer });
        break;
      case 'pass': {
        const from = passSource(seat, e.direction);
        const received = e.received[seat].slice();
        const sent = e.sent[seat].slice();
        log.push({ type: 'pass', round: e.round, direction: e.direction, received, sent, blind: e.blind[seat] });
        if (received.length) passesReceived.push({ round: e.round, from, tiles: received });
        if (sent.length) passesSent.push({ round: e.round, to: passTarget(seat, e.direction), tiles: sent });
        break;
      }
      case 'courtesy': {
        const across = acrossOf(seat);
        const received = e.received[seat].slice();
        const sent = e.sent[seat].slice();
        log.push({ type: 'courtesy', counts: e.counts.slice(), received, sent });
        if (received.length) passesReceived.push({ round: 'courtesy', from: across, tiles: received });
        if (sent.length) passesSent.push({ round: 'courtesy', to: across, tiles: sent });
        break;
      }
      case 'vote':
        log.push({ type: 'vote', stop: e.stop.slice(), stopped: e.stopped });
        break;
      case 'courtesyRequest':
        log.push({ type: 'courtesyRequest', requests: e.requests.slice(), counts: e.counts.slice() });
        break;
      case 'draw':
        log.push(e.seat === seat ? { type: 'draw', seat, tile: e.tile } : { type: 'draw', seat: e.seat });
        break;
      case 'discard':
        discardHistory.push({ seat: e.seat, tile: e.tile, called: false });
        log.push({ ...e });
        break;
      case 'call':
        if (discardHistory.length) discardHistory[discardHistory.length - 1].called = true;
        log.push({ ...e });
        break;
      case 'expose':
        log.push({ type: 'expose', seat: e.seat, exposure: { ...e.exposure } });
        break;
      case 'falseMahjong':
        log.push({ type: 'falseMahjong', seat: e.seat });
        break;
      case 'settle':
        log.push({ type: 'settle', payments: e.payments.slice() });
        break;
      default: // exchange, dead, mahjong, wallgame: public and flat
        log.push({ ...e });
    }
  }

  const me = state.players[seat];
  const lastEvent = state.events[state.events.length - 1];
  const myTurn = state.phase === 'turn' && state.turn.seat === seat;
  const decision = pending(state).find((d) => d.seat === seat) ?? null;

  return {
    seat,
    dealer: state.dealer,
    phase: state.phase,
    turnSeat: state.phase === 'turn' ? state.turn.seat : null,
    turnNumber: discardHistory.length,
    wallCount: state.wall.tiles.length - state.wall.next,
    card: state.card,
    rules: state.rules,
    trainingWheels: state.trainingWheels,
    hand: me.concealed.slice(),
    drawn: myTurn && lastEvent.type === 'draw' && lastEvent.seat === seat ? lastEvent.tile : null,
    exposures: state.players.map((p) => p.exposures.map((e) => ({ ...e }))),
    concealedCounts: state.players.map((p) => p.concealed.length),
    dead: state.players.map((p) => p.dead),
    discards: state.discards.map((d) => ({ ...d })),
    discardHistory,
    passesReceived,
    passesSent,
    log,
    decision: decision && { ...decision },
    result: state.result && structuredClone(state.result),
  };
}
