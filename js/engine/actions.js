// Comparing and describing player actions (for the post-hand review and the guided hand).

import { displayName } from './tiles.js';

const GROUP = { 3: 'pung', 4: 'kong', 5: 'quint', 6: 'sextet' };
const sameTiles = (x = [], y = []) => x.length === y.length && [...x].sort((a, b) => a - b).join() === [...y].sort((a, b) => a - b).join();

/**
 * Do two actions amount to the same move? (Order of passed tiles doesn't matter; for a call,
 * the joker count doesn't matter.)
 */
export function sameAction(a, b) {
  if (!a || !b || a.type !== b.type) return false;
  switch (a.type) {
    case 'pass': return sameTiles(a.tiles, b.tiles) && (a.blind ?? 0) === (b.blind ?? 0);
    case 'courtesyPass': return sameTiles(a.tiles, b.tiles);
    case 'courtesyRequest': return a.count === b.count;
    case 'vote': return a.stop === b.stop;
    case 'discard': return a.tile === b.tile;
    case 'claim': return a.call === b.call && (a.call !== 'expose' || a.count === b.count);
    case 'exchange': return a.seat === b.seat && a.index === b.index;
    case 'declareDead': return a.target === b.target;
    default: return true;
  }
}

/** A move in plain words, e.g. "discard 5 Dot" or "call a kong". */
export function describeAction(a) {
  if (!a) return 'no suggestion';
  switch (a.type) {
    case 'pass': return `pass ${a.tiles.map(displayName).join(', ') || 'nothing from your hand'}${a.blind ? ` + ${a.blind} blind` : ''}`;
    case 'courtesyPass': return `give ${a.tiles.map(displayName).join(', ')}`;
    case 'courtesyRequest': return `ask for ${a.count}`;
    case 'vote': return a.stop ? 'stop the second Charleston' : 'play the second Charleston';
    case 'discard': return `discard ${displayName(a.tile)}`;
    case 'exchange': return 'swap for a joker';
    case 'mahjong': return 'declare Mah Jongg';
    case 'declareDead': return 'declare a dead hand';
    case 'claim': return a.call === 'pass' ? 'pass' : a.call === 'mahjong' ? 'call Mah Jongg' : `call a ${GROUP[a.count] ?? 'group'}`;
    default: return a.type;
  }
}
