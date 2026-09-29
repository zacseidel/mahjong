// The guided first hand (SPEC §10.9): a fixed deal on the practice card, Beginner opponents,
// and the player makes the coach's suggested move at each step. Because the opponents are
// deterministic, the hand always unfolds the same way. The deal was chosen so that it shows a
// full Charleston with blind passes, an opponent's exposure, your own calls, a joker exchange,
// and ends with you winning. test/tutorial.test.js checks that it still does.

import { suggestion } from './tips.js';
import { defenseReport } from './defense.js';

export const TUTORIAL = Object.freeze({
  seed: 460,
  dealer: 0,
  human: 1,
  levels: Object.freeze(['beginner', 'beginner', 'beginner', 'beginner']),
});

/** The move the player must make now. */
export function requiredAction(obs, options) {
  return suggestion(obs, options)?.action ?? null;
}

/**
 * Lesson notes for moments that happen for the first time. Each has an id; the UI shows each
 * once. Returns the first note whose moment has arrived and hasn't been seen.
 * @param {import('./observe.js').Observation} obs
 * @param {Set<string>} seen
 * @param {{nameOf?: (seat: number) => string}} [options]
 * @returns {{id: string, title: string, text: string}|null}
 */
export function lessonNote(obs, seen, { nameOf = (s) => `Seat ${s}` } = {}) {
  const d = obs.decision;
  const me = obs.seat;
  const oppExposed = [0, 1, 2, 3].find((s) => s !== me && obs.exposures[s].length > 0);
  const notes = [
    [d?.kind === 'pass' && d.round === 0, 'start', 'Your guided hand',
      'Welcome! In this hand the coach suggests every move, and you make it. Read “How this works” for the rule, tap Why? for the reasoning, and look for the highlighted tiles or button. Your goal: 14 tiles that match one hand on the card. You’re South, at the bottom.'],
    [d?.kind === 'pass' && d.blindAllowed, 'blind', 'A blind pass',
      'This pass may be blind. The coach suggests passing on some unseen tiles when you have fewer than three you truly don’t want. It’s a way to avoid giving up tiles that help you.'],
    [d?.kind === 'vote', 'vote', 'The halfway point',
      'The first Charleston is done. Notice how the “closest hands” list changed as tiles came in. That list is how you choose what to aim for.'],
    [d?.kind === 'turn' && obs.discardHistory.length > 0 && !seen.has('play'), 'play', 'Play has started',
      'Now each player draws and discards in turn. Look at the Tips panel: your closest hands are drawn tile by tile against the card. Solid tiles you have, faded ones you need. Discard tiles that none of them use.'],
    [oppExposed !== undefined, 'oppExposure', 'Someone exposed a group',
      `${nameOf(oppExposed)} called a discard and exposed a group. Exposures tell you what a player is building: only some hands on the card fit. Tap their name to see which. As they get closer, the tips warn you about tiles that could feed their hand.`],
    [d?.kind === 'claim' && requiredAction(obs)?.call === 'expose', 'call', 'Calling a discard',
      'That discard completes a group for your hand, so the coach suggests calling it. You’ll place the group face up, then discard. Calling skips the players between you and the discarder.'],
    [d?.kind === 'turn' && d.exchanges.length > 0, 'exchange', 'A joker exchange',
      'A joker in an exposure stands for a particular tile, and you hold that real tile. Swap it in and take the joker: a joker can fill any group of three or more.'],
    [(d?.kind === 'turn' || d?.kind === 'claim') && defenseReport(obs).active, 'danger', 'Watch what you throw',
      'Someone is getting close, so marks now appear on your tiles: ✓ safe, · low, ! medium, !! high danger of feeding their hand. Throwing a player’s winning tile costs you double.'],
    [d?.kind === 'turn' && d.mahJongg, 'mahjong', 'Mah Jongg!',
      'Your 14 tiles match a hand on the card. Press Mah Jongg to win. You drew the winning tile yourself, so it’s self-drawn and everyone pays double.'],
  ];
  for (const [when, id, title, text] of notes) {
    if (when && !seen.has(id)) return { id, title, text };
  }
  return null;
}
