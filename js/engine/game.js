// Game state machine and event log (SPEC §6.1).
//
// The engine never calls players. A driver (the UI, or a simulation) reads `pending(state)` to see
// who must decide what, and applies each decision with `act(state, seat, action)`. `act` validates
// every action and throws on anything illegal: the engine is the rules authority. Every accepted
// action is recorded in `state.actions`, so `replay` rebuilds a hand exactly from its seed.
//
// State is a plain object that `act` mutates. The event log holds full information (including
// concealed tiles) for post-hand review; players and AI must only ever see `observe()` output.

import { createRng } from './rng.js';
import { COPIES, KINDS, JOKER, TOTAL, fullSet, toCounts } from './tiles.js';
import { buildWall, deal, draw, remaining } from './wall.js';
import { EAST, rightOf, acrossOf, nextDealer } from './seats.js';
import { ROUNDS, resolvePass, checkPassChoice, checkPassTiles, courtesyCount, resolveCourtesy } from './charleston.js';
import {
  legalCalls, resolveClaims, applyExposure, jokerExchanges, applyJokerExchange,
  mahJonggMatches, deadHandReason,
} from './rules.js';
import { DEFAULT_RULES } from './rules-config.js';
import { settle, effectiveValue } from './scoring.js';
import { HAND_SIZE } from './card.js';

/**
 * @typedef {import('./rules.js').Player} Player
 * @typedef {import('./rules.js').CallOption} CallOption
 *
 * @typedef {Object} GameOptions
 * @property {number} seed
 * @property {{hands: Object[]}} card
 * @property {import('./rules-config.js').Rules} [rules]
 * @property {number} [dealer]           Seat dealing this hand (East for the hand). Default EAST.
 * @property {boolean} [trainingWheels]  true: Mah Jongg may be declared only when valid. Default true.
 * @property {number[]} [wallTiles]      Test hook: a full 152-tile set in draw order, instead of shuffling.
 * @property {boolean} [charleston]      false skips the Charleston (tests and drills). Default true.
 *
 * @typedef {{type: 'pass', tiles: number[], blind?: number}
 *   | {type: 'vote', stop: boolean}
 *   | {type: 'courtesyRequest', count: number}
 *   | {type: 'courtesyPass', tiles: number[]}
 *   | {type: 'discard', tile: number}
 *   | {type: 'exchange', seat: number, index: number}
 *   | {type: 'mahjong'}
 *   | {type: 'declareDead', target: number}
 *   | {type: 'claim', call: 'pass'|'mahjong'|'expose', count?: number, jokers?: number}} Action
 */

/**
 * Start a hand: shuffle, deal, and open the first Charleston pass.
 * @param {GameOptions} options
 */
export function newGame({ seed, card, rules = DEFAULT_RULES, dealer = EAST, trainingWheels = true, wallTiles = null, charleston = true }) {
  let wall;
  if (wallTiles) {
    if (wallTiles.length !== TOTAL || toCounts(wallTiles).join() !== toCounts(fullSet()).join()) {
      throw new Error('wallTiles must be a full tile set');
    }
    wall = { tiles: wallTiles.slice(), next: 0 };
  } else {
    wall = buildWall(createRng(seed));
  }
  const hands = deal(wall, dealer);
  const state = {
    seed, card, rules, dealer, trainingWheels,
    wall,
    players: hands.map((concealed) => ({ concealed, exposures: [], dead: false })),
    discards: [],
    events: [],
    actions: [],
    phase: 'charleston',
    charleston: null,
    turn: null,
    claim: null,
    result: null,
  };
  log(state, { type: 'deal', dealer, hands: hands.map((h) => h.slice()) });
  if (charleston) openPassRound(state, 0);
  else startPlay(state);
  return state;
}

/**
 * Rebuild a hand from its options and recorded actions.
 * @param {GameOptions} options
 * @param {{seat: number, action: Action}[]} actions
 */
export function replay(options, actions) {
  const state = newGame(options);
  for (const { seat, action } of actions) act(state, seat, action);
  return state;
}

function log(state, event) {
  state.events.push(event);
}

// ---------- Pending decisions ----------

/**
 * Decisions the game is waiting for. Several seats may be pending at once (Charleston rounds,
 * claim windows); order among them doesn't matter.
 * @returns {Object[]} Each has `seat` and `kind`, plus the legal options for that kind.
 */
export function pending(state) {
  switch (state.phase) {
    case 'charleston': {
      const c = state.charleston;
      return [0, 1, 2, 3].filter((s) => c.choices[s] === null).map((seat) => {
        if (c.step === 'pass') {
          const round = ROUNDS[c.round];
          return { seat, kind: 'pass', round: c.round, direction: round.direction, blindAllowed: round.blind };
        }
        if (c.step === 'courtesyPass') return { seat, kind: 'courtesyPass', count: c.counts[seat] };
        return { seat, kind: c.step };
      });
    }
    case 'turn': {
      const { seat } = state.turn;
      const player = state.players[seat];
      const mahJongg = mahJonggMatches(player, state.card).length > 0;
      return [{
        seat,
        kind: 'turn',
        afterCall: state.turn.afterCallFrom !== null,
        exchanges: jokerExchanges(player, state.players.map((p) => p.exposures)),
        mahJongg,
        canDeclareMahJongg: mahJongg || !state.trainingWheels,
        deadTargets: [0, 1, 2, 3].filter((t) => t !== seat && !state.players[t].dead
          && deadHandReason(state.players[t], state.card, HAND_SIZE - 1) !== null),
      }];
    }
    case 'claim': {
      const { options, responses } = state.claim;
      return [0, 1, 2, 3]
        .filter((s) => options[s] && responses[s] === null)
        .map((seat) => ({ seat, kind: 'claim', tile: state.claim.tile, discarder: state.claim.discarder, options: options[seat] }));
    }
    default:
      return [];
  }
}

// ---------- Acting ----------

/**
 * Apply one decision. Throws if it isn't this seat's decision to make, or isn't legal.
 * @param {Object} state
 * @param {number} seat
 * @param {Action} action
 */
export function act(state, seat, action) {
  const decision = pending(state).find((d) => d.seat === seat);
  if (!decision) throw new Error(`Seat ${seat} has no decision to make`);
  switch (decision.kind) {
    case 'pass': actPass(state, seat, action, decision); break;
    case 'vote': actVote(state, seat, action); break;
    case 'courtesyRequest': actCourtesyRequest(state, seat, action); break;
    case 'courtesyPass': actCourtesyPass(state, seat, action, decision); break;
    case 'turn': actTurn(state, seat, action, decision); break;
    case 'claim': actClaim(state, seat, action, decision); break;
    default: throw new Error(`Unknown decision ${decision.kind}`);
  }
  state.actions.push({ seat, action: structuredClone(action) });
}

function expectType(action, ...types) {
  if (!action || !types.includes(action.type)) throw new Error(`Expected action ${types.join(' or ')}`);
}

// ----- Charleston -----

function openPassRound(state, round) {
  state.charleston = { step: 'pass', round, choices: [null, null, null, null] };
}

function actPass(state, seat, action, decision) {
  expectType(action, 'pass');
  checkPassChoice(state.players[seat].concealed, action, decision.blindAllowed);
  const c = state.charleston;
  c.choices[seat] = { tiles: action.tiles.slice(), blind: action.blind ?? 0 };
  if (c.choices.includes(null)) return;

  const round = ROUNDS[c.round];
  const { hands, sent, received } = resolvePass(state.players.map((p) => p.concealed), round.direction, c.choices, round.blind);
  hands.forEach((h, s) => { state.players[s].concealed = h; });
  log(state, { type: 'pass', round: c.round, direction: round.direction, blind: c.choices.map((x) => x.blind), sent, received });

  if (c.round === 2) state.charleston = { step: 'vote', choices: [null, null, null, null] };
  else if (c.round === 5) openCourtesy(state);
  else openPassRound(state, c.round + 1);
}

function actVote(state, seat, action) {
  expectType(action, 'vote');
  const c = state.charleston;
  c.choices[seat] = !!action.stop;
  if (c.choices.includes(null)) return;
  const stopped = c.choices.some(Boolean);
  log(state, { type: 'vote', stop: c.choices.slice(), stopped });
  if (stopped) openCourtesy(state);
  else openPassRound(state, 3);
}

function openCourtesy(state) {
  if (state.rules.courtesyPass === 'off') return startPlay(state);
  state.charleston = { step: 'courtesyRequest', choices: [null, null, null, null] };
}

function actCourtesyRequest(state, seat, action) {
  expectType(action, 'courtesyRequest');
  courtesyCount(action.count, 0, 'min'); // validates 0–3
  const c = state.charleston;
  c.choices[seat] = action.count;
  if (c.choices.includes(null)) return;
  const counts = [0, 1, 2, 3].map((s) => courtesyCount(c.choices[s], c.choices[acrossOf(s)], state.rules.courtesyPass));
  log(state, { type: 'courtesyRequest', requests: c.choices.slice(), counts });
  // Seats with nothing to pass are done already.
  state.charleston = { step: 'courtesyPass', counts, choices: counts.map((n) => (n === 0 ? [] : null)) };
  if (!state.charleston.choices.includes(null)) finishCourtesy(state);
}

function actCourtesyPass(state, seat, action, decision) {
  expectType(action, 'courtesyPass');
  if (!Array.isArray(action.tiles) || action.tiles.length !== decision.count) {
    throw new Error(`Courtesy pass must be ${decision.count} tiles`);
  }
  checkPassTiles(state.players[seat].concealed, action.tiles);
  const c = state.charleston;
  c.choices[seat] = action.tiles.slice();
  if (!c.choices.includes(null)) finishCourtesy(state);
}

function finishCourtesy(state) {
  const c = state.charleston;
  if (c.counts.some((n) => n > 0)) {
    const { hands, sent, received } = resolveCourtesy(state.players.map((p) => p.concealed), c.choices, c.counts);
    hands.forEach((h, s) => { state.players[s].concealed = h; });
    log(state, { type: 'courtesy', counts: c.counts.slice(), sent, received });
  }
  startPlay(state);
}

// ----- Play -----

function startPlay(state) {
  state.charleston = null;
  state.phase = 'turn';
  // East starts by discarding. A win on the dealt 14 counts as self-drawn.
  state.turn = { seat: state.dealer, selfDrawn: true, afterCallFrom: null };
}

/** Next live seat after `from`, or null if nobody is left. */
function nextLiveSeat(state, from) {
  let s = from;
  for (let k = 0; k < 4; k++) {
    s = rightOf(s);
    if (!state.players[s].dead) return s;
  }
  return null;
}

function beginTurnAfter(state, from) {
  const seat = nextLiveSeat(state, from);
  if (seat === null || remaining(state.wall) === 0) return endWallGame(state);
  const tile = draw(state.wall);
  state.players[seat].concealed.push(tile);
  log(state, { type: 'draw', seat, tile });
  state.phase = 'turn';
  state.claim = null;
  state.turn = { seat, selfDrawn: true, afterCallFrom: null };
}

function actTurn(state, seat, action, decision) {
  expectType(action, 'discard', 'exchange', 'mahjong', 'declareDead');
  const player = state.players[seat];
  switch (action.type) {
    case 'discard': {
      const i = player.concealed.indexOf(action.tile);
      if (i < 0) throw new Error('That tile is not in your hand');
      player.concealed.splice(i, 1);
      state.discards.push({ seat, tile: action.tile });
      log(state, { type: 'discard', seat, tile: action.tile });
      openClaimWindow(state, seat, action.tile);
      return;
    }
    case 'exchange': {
      const ok = decision.exchanges.some((x) => x.seat === action.seat && x.index === action.index);
      if (!ok) throw new Error('That joker exchange is not available');
      const tile = state.players[action.seat].exposures[action.index].tile;
      state.players = applyJokerExchange(state.players, seat, action);
      log(state, { type: 'exchange', seat, from: action.seat, index: action.index, tile });
      return;
    }
    case 'mahjong': {
      const matches = mahJonggMatches(player, state.card);
      if (matches.length) {
        const from = state.turn.afterCallFrom;
        return finishWin(state, seat, { selfDrawn: from === null && state.turn.selfDrawn, discarder: from, matches });
      }
      if (state.trainingWheels) throw new Error('That hand is not Mah Jongg');
      // [verify] False Mah Jongg (training wheels off): see rules.falseMahJongg.
      log(state, { type: 'falseMahjong', seat, tiles: player.concealed.slice() });
      if (state.rules.falseMahJongg === 'deadHand') {
        markDead(state, seat, 'falseMahJongg');
        beginTurnAfter(state, seat);
      }
      return;
    }
    case 'declareDead': {
      if (!decision.deadTargets.includes(action.target)) throw new Error("That player's hand is not dead");
      markDead(state, action.target, deadHandReason(state.players[action.target], state.card, HAND_SIZE - 1), seat);
      return;
    }
  }
}

function markDead(state, seat, reason, by = null) {
  state.players[seat] = { ...state.players[seat], dead: true };
  log(state, { type: 'dead', seat, reason, by });
}

function openClaimWindow(state, discarder, tile) {
  const options = [null, null, null, null];
  let any = false;
  for (let s = 0; s < 4; s++) {
    if (s === discarder) continue;
    const opts = legalCalls(state.players[s], tile, state.card, state.rules);
    if (opts.length) {
      options[s] = opts;
      any = true;
    }
  }
  if (!any) return beginTurnAfter(state, discarder);
  state.phase = 'claim';
  state.turn = null;
  state.claim = { discarder, tile, options, responses: [null, null, null, null] };
}

function actClaim(state, seat, action, decision) {
  expectType(action, 'claim');
  const c = state.claim;
  if (action.call === 'pass') {
    c.responses[seat] = { call: 'pass' };
  } else if (action.call === 'mahjong') {
    if (!decision.options.some((o) => o.type === 'mahjong')) throw new Error('You cannot call Mah Jongg on this tile');
    c.responses[seat] = { call: 'mahjong' };
  } else if (action.call === 'expose') {
    const opt = decision.options.find((o) => o.type === 'expose' && o.count === action.count);
    if (!opt) throw new Error('You cannot expose that many of this tile');
    const jokers = action.jokers ?? opt.minJokers;
    if (!Number.isInteger(jokers) || jokers < opt.minJokers || jokers > opt.maxJokers) throw new Error('Bad joker count for this call');
    c.responses[seat] = { call: 'expose', count: action.count, jokers };
  } else {
    throw new Error(`Unknown call ${action.call}`);
  }
  if (c.options.some((o, s) => o && c.responses[s] === null)) return;
  resolveClaimWindow(state);
}

function resolveClaimWindow(state) {
  const c = state.claim;
  const claims = [];
  c.responses.forEach((r, s) => {
    if (r && r.call !== 'pass') claims.push({ seat: s, type: r.call === 'mahjong' ? 'mahjong' : 'expose' });
  });
  const winner = resolveClaims(c.discarder, claims, state.rules);
  if (!winner) return beginTurnAfter(state, c.discarder);

  state.discards.pop(); // the called tile leaves the discard pile
  const response = c.responses[winner.seat];
  log(state, { type: 'call', seat: winner.seat, from: c.discarder, tile: c.tile, call: response.call });
  if (response.call === 'mahjong') {
    const matches = c.options[winner.seat].find((o) => o.type === 'mahjong').matches;
    state.players[winner.seat].concealed.push(c.tile);
    return finishWin(state, winner.seat, { selfDrawn: false, discarder: c.discarder, matches });
  }
  state.players[winner.seat] = applyExposure(state.players[winner.seat], c.tile, response.count, response.jokers);
  const exposures = state.players[winner.seat].exposures;
  log(state, { type: 'expose', seat: winner.seat, exposure: { ...exposures[exposures.length - 1] } });
  state.phase = 'turn';
  state.claim = null;
  state.turn = { seat: winner.seat, selfDrawn: false, afterCallFrom: c.discarder };
}

// ----- End of hand -----

function finishWin(state, seat, { selfDrawn, discarder, matches }) {
  // Score the match worth the most (after the jokerless bonus).
  let best = null;
  let bestValue = -1;
  for (const m of matches) {
    const v = effectiveValue({ value: m.target.value, jokerless: m.jokerless, hasGroups: m.target.hasGroups }, state.rules);
    if (v > bestValue) { best = m; bestValue = v; }
  }
  const win = {
    winner: seat,
    discarder,
    selfDrawn,
    value: best.target.value,
    jokerless: best.jokerless,
    hasGroups: best.target.hasGroups,
    obvious: state.players[seat].exposures.length >= 3, // [verify, house rule] definition of "obvious"
  };
  const payments = settle(win, state.rules);
  log(state, { type: 'mahjong', seat, handId: best.target.handId, selfDrawn, discarder, jokerless: best.jokerless });
  endHand(state, { ...win, handId: best.target.handId, payments });
}

function endWallGame(state) {
  log(state, { type: 'wallgame' });
  endHand(state, { winner: null, discarder: null, selfDrawn: false, handId: null, value: 0, jokerless: false, payments: [0, 0, 0, 0] });
}

function endHand(state, result) {
  log(state, { type: 'settle', payments: result.payments.slice() });
  state.phase = 'end';
  state.turn = null;
  state.claim = null;
  state.result = { ...result, nextDealer: nextDealer(state.dealer, result.winner, state.rules.dealerRotation) };
}

// ---------- Invariants ----------

/**
 * Count every tile in the game: wall (undrawn), concealed hands, exposures, and discards.
 * @returns {Int16Array}
 */
export function tileCounts(state) {
  const counts = new Int16Array(KINDS);
  for (let i = state.wall.next; i < state.wall.tiles.length; i++) counts[state.wall.tiles[i]]++;
  for (const p of state.players) {
    for (const t of p.concealed) counts[t]++;
    for (const e of p.exposures) {
      counts[e.tile] += e.count - e.jokers;
      counts[JOKER] += e.jokers;
    }
  }
  for (const d of state.discards) counts[d.tile]++;
  return counts;
}

/**
 * Throws if the 152 tiles aren't all accounted for exactly once.
 */
export function checkConservation(state) {
  const counts = tileCounts(state);
  for (let t = 0; t < KINDS; t++) {
    if (counts[t] !== COPIES[t]) throw new Error(`Tile ${t}: ${counts[t]} in play, expected ${COPIES[t]}`);
  }
}
