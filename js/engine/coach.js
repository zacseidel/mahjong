// Plain-language explanations of each step of the game, for new players (SPEC §10.8).
// Pure: takes the player's observation and returns text. Follows the table's rule settings.

import { passSource, passTarget } from './charleston.js';
import { acrossOf } from './seats.js';

/**
 * Explain the decision the player is facing.
 * @param {import('./observe.js').Observation} obs
 * @param {{nameOf?: (seat: number) => string}} [options]
 * @returns {{title: string, text: string}|null}
 */
export function explainStep(obs, { nameOf = (s) => `Seat ${s}` } = {}) {
  const d = obs.decision;
  const rules = obs.rules;
  if (!d) {
    if (obs.phase === 'charleston') return { title: 'Charleston', text: 'Everyone passes at the same time. Waiting for the others to choose their tiles.' };
    return null;
  }
  const me = obs.seat;
  switch (d.kind) {
    case 'pass': {
      const to = nameOf(passTarget(me, d.direction));
      const from = nameOf(passSource(me, d.direction));
      const nth = ['First', 'Second', 'Third'][d.round % 3];
      const which = d.round < 3 ? 'first Charleston' : 'second Charleston';
      let text = d.round === 0
        ? `The Charleston comes before play: everyone trades tiles to improve their hand. Choose 3 tiles you don’t want and pass them ${d.direction} to ${to}. You’ll get 3 back from ${from}. Jokers can never be passed.`
        : `${nth} pass of the ${which}: 3 tiles ${d.direction} to ${to}; you’ll get 3 from ${from}. Jokers can never be passed.`;
      if (d.round === 3) text += ' The second Charleston goes the other way: left, across, right.';
      if (d.blindAllowed) {
        text += ` This pass can be a blind pass: instead of breaking up tiles you want, pass along 1–3 of the tiles coming to you from ${from} without looking at them, and make up the rest from your hand.`;
      }
      text += ' Tip: pass tiles that don’t fit any of the hands you’re considering.';
      return { title: `Charleston: pass ${d.direction}`, text };
    }
    case 'vote':
      return {
        title: 'Second Charleston?',
        text: 'The first Charleston is done. Now there can be a second one (left, across, right), but any one player can stop it. Stop if your hand is coming together nicely; continue if you still need a lot of help.',
      };
    case 'courtesyRequest':
      return {
        title: 'Courtesy pass',
        text: `Last, an optional trade with ${nameOf(acrossOf(me))} (across from you). You each say how many tiles you’d like to swap, 0 to 3, and you trade the smaller number. Ask for as many as you can spare.`,
      };
    case 'courtesyPass':
      return {
        title: 'Courtesy pass',
        text: `You and ${nameOf(acrossOf(me))} agreed to trade ${d.count} tile${d.count === 1 ? '' : 's'}. Choose which to give. Jokers can’t be passed.`,
      };
    case 'turn': {
      const parts = [];
      if (d.afterCall) {
        parts.push('You called a discard and placed your group face up (an exposure). Now discard one tile. Play then continues to your right, and anyone in between is skipped.');
      } else if (obs.drawn === null && obs.discardHistory.length === 0) {
        parts.push('As East you started with 14 tiles, so you begin by discarding instead of drawing.');
      } else {
        parts.push('Your turn: you drew a tile from the wall, so you hold 14. Discard one to get back to 13. The goal is 14 tiles that exactly match one hand on the card.');
      }
      if (d.mahJongg) parts.push('Your tiles match a hand on the card: declare Mah Jongg to win!');
      else if (obs.trainingWheels) parts.push('The Mah Jongg button lights up when your tiles match a hand on the card.');
      else parts.push('Training wheels are off: declaring Mah Jongg when your hand doesn’t match the card has a penalty.');
      if (d.exchanges.length) {
        parts.push('A joker in an exposure stands for a specific tile. You hold that real tile, so you may swap it for the joker. A joker can fill any group of 3 or more, so it’s usually worth more.');
      }
      if (d.deadTargets.length) {
        parts.push(`${d.deadTargets.map(nameOf).join(' and ')}’s exposures don’t fit any hand on the card, so that hand can never win. You may declare it dead: they stop playing but still pay the winner.`);
      }
      return { title: d.afterCall ? 'Discard after your call' : 'Your turn', text: parts.join(' ') };
    }
    case 'claim': {
      const who = nameOf(d.discarder);
      const canWin = d.options.some((o) => o.type === 'mahjong');
      const parts = [`${who} discarded a tile you could use.`];
      if (canWin) parts.push('It completes your hand: call Mah Jongg to win! A discard can be taken for a pair or single only when it wins.');
      else {
        parts.push('You may call it to complete a group of 3 or more identical tiles, which you then place face up (an exposure). Jokers may fill out the group. After calling, you discard, and play continues from you.');
        parts.push('Exposing shows everyone what you’re building and rules out every concealed hand on the card. You can’t call a tile for a pair or single unless it wins.');
      }
      if (rules.mahJonggBeatsExposure) parts.push('If two players want the same tile, a Mah Jongg call wins; otherwise the player next in turn gets it.');
      return { title: canWin ? 'You can win!' : 'Call this tile?', text: parts.join(' ') };
    }
    default:
      return null;
  }
}
