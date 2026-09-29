// Names, narration, and formatting for the UI.

import { displayName } from '../engine/tiles.js';
import { h } from './dom.js';

export const WINDS = ['East', 'South', 'West', 'North'];
const POSITIONS = ['You', 'Right', 'Across', 'Left'];
const GROUP_NAMES = { 3: 'pung', 4: 'kong', 5: 'quint', 6: 'sextet' };

/** Position of `seat` relative to the human: 0 you, 1 right, 2 across, 3 left. */
export function relative(seat, human) {
  return (seat - human + 4) % 4;
}

/** "You", "Right", "Across", or "Left". */
export function nameOf(seat, human) {
  return POSITIONS[relative(seat, human)];
}

/** This hand's wind for a seat. */
export function windOf(seat, dealer) {
  return WINDS[(seat - dealer + 4) % 4];
}

export function groupName(count) {
  return GROUP_NAMES[count] ?? `group of ${count}`;
}

export function tileName(id) {
  return displayName(id);
}

/**
 * Points in the chosen display: 'points', 'dollars' (1 pt = $0.01), or 'both'.
 * @param {number} n @param {'points'|'dollars'|'both'} mode
 */
export function formatPoints(n, mode = 'points') {
  const sign = n > 0 ? '+' : n < 0 ? '−' : '';
  const abs = Math.abs(n);
  const pts = `${sign}${abs}`;
  const dollars = `${sign}$${(abs / 100).toFixed(2)}`;
  if (mode === 'dollars') return dollars;
  if (mode === 'both') return `${pts} (${dollars})`;
  return pts;
}

const DIRECTION_TEXT = { right: 'right', across: 'across', left: 'left' };

/**
 * One line of narration for a public event, or null to skip it.
 * @param {Object} e  An event from an observation's log.
 * @param {number} human
 * @returns {string|null}
 */
export function narrate(e, human) {
  const who = (s) => nameOf(s, human);
  const verb = (s, you, other) => (s === human ? you : other);
  switch (e.type) {
    case 'deal': return `New hand. ${who(e.dealer)} ${verb(e.dealer, 'are', 'is')} East and deal${e.dealer === human ? '' : 's'}.`;
    case 'pass': {
      if (!e.sent.length && !e.received.length) return 'Everyone passed blind; no tiles moved.';
      const blind = e.blind ? ` (${e.blind} blind)` : '';
      return `Charleston: you passed ${DIRECTION_TEXT[e.direction]}${blind} and received ${e.received.map(displayName).join(', ')}.`;
    }
    case 'vote': return e.stopped ? 'The second Charleston was stopped.' : 'Everyone agreed to a second Charleston.';
    case 'courtesyRequest': return null;
    case 'courtesy': return e.received.length ? `Courtesy pass: you received ${e.received.map(displayName).join(', ')}.` : 'Courtesy pass: others traded tiles.';
    case 'draw': return e.seat === human ? `You drew ${displayName(e.tile)}.` : null;
    case 'discard': return `${who(e.seat)} discarded ${displayName(e.tile)}.`;
    case 'call': return e.call === 'mahjong'
      ? `${who(e.seat)} called ${displayName(e.tile)} for Mah Jongg!`
      : `${who(e.seat)} called ${displayName(e.tile)}.`;
    case 'expose': return `${who(e.seat)} exposed a ${groupName(e.exposure.count)} of ${displayName(e.exposure.tile)}${e.exposure.jokers ? ` (${e.exposure.jokers} joker${e.exposure.jokers > 1 ? 's' : ''})` : ''}.`;
    case 'exchange': return `${who(e.seat)} swapped ${displayName(e.tile)} for a joker from ${e.from === e.seat ? verb(e.seat, 'your', 'their') : `${who(e.from)}${e.from === human ? 'r' : '’s'}`} exposure.`;
    case 'dead': return `${who(e.seat)}${e.seat === human ? 'r' : '’s'} hand is dead${e.reason === 'exposures' ? ': exposures fit no hand on the card' : e.reason === 'falseMahJongg' ? ' (false Mah Jongg)' : ''}.`;
    case 'falseMahjong': return `${who(e.seat)} declared Mah Jongg, but the hand doesn’t match the card.`;
    case 'mahjong': return `${who(e.seat)} ${verb(e.seat, 'have', 'has')} Mah Jongg!`;
    case 'wallgame': return 'The wall is empty: wall game, nobody pays.';
    default: return null;
  }
}

/**
 * A card line in its printed colors (g, r, b suffixes), e.g. "FF 2222g 44r".
 * @param {string} line
 * @returns {HTMLElement}
 */
export function cardLine(line) {
  const out = h('span', { class: 'card-line' });
  line.trim().split(/\s+/).forEach((token, i) => {
    const color = /[grb]$/.test(token) ? token.at(-1) : null;
    const text = color ? token.slice(0, -1) : token;
    if (i) out.append(' ');
    out.append(h('span', { class: `tok${color ? ` tok-${color}` : ''}` }, text));
  });
  return out;
}
