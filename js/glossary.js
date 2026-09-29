// Glossary of mah jongg terms, and a pure helper that finds them in text so the UI can make
// them tappable. No DOM here; runs under Node for tests.

/** Term → plain-language definition. Keys are the canonical names; `match` lists spellings. */
export const GLOSSARY = Object.freeze({
  pung: { match: ['pung', 'pungs'], text: 'Three identical tiles, like three 5 Dots. Jokers may stand in for any of them.' },
  kong: { match: ['kong', 'kongs'], text: 'Four identical tiles. Jokers may stand in for any of them.' },
  quint: { match: ['quint', 'quints'], text: 'Five identical tiles. There are only four of each tile, so a quint always needs at least one joker.' },
  sextet: { match: ['sextet'], text: 'Six identical tiles (needs jokers).' },
  pair: { match: ['pair', 'pairs'], text: 'Two identical tiles. Jokers can never be used in a pair.' },
  single: { match: ['single', 'singles'], text: 'One tile on its own in a hand, like each digit of 2026. Jokers can never be used as a single.' },
  exposure: { match: ['exposure', 'exposures', 'exposed', 'expose', 'exposing'], text: 'A group you completed by calling a discard, placed face up for everyone to see. It can’t be rearranged, and it rules out concealed hands.' },
  concealed: { match: ['concealed'], text: 'A hand marked C on the card: you may not call discards to build it (except the very last tile, to win).' },
  charleston: { match: ['Charleston'], text: 'The tile-passing before play: right, across, left; then optionally left, across, right; then a courtesy pass.' },
  blind: { match: ['blind pass'], text: 'On the last pass of each Charleston, you may pass along 1–3 of the tiles coming to you without looking at them.' },
  courtesy: { match: ['courtesy pass'], text: 'An optional final trade of 0–3 tiles with the player across from you. You trade the smaller number either of you asks for.' },
  joker: { match: ['joker', 'jokers'], text: 'Stands in for any tile in a group of three or more (pung, kong, quint). Never in a pair or single. A discarded joker can’t be called.' },
  exchange: { match: ['joker exchange', 'joker exchanges'], text: 'On your turn, swap a real tile for a joker in any exposure where the joker stands for that tile.' },
  call: { match: ['call', 'calling', 'called'], text: 'Taking another player’s discard: only to complete a group of 3 or more (then exposed), or to win.' },
  mahjong: { match: ['Mah Jongg'], text: 'Winning: 14 tiles that exactly match one hand on the card, with jokers only in groups of three or more.' },
  jokerless: { match: ['jokerless'], text: 'A winning hand with no jokers at all. It scores double (except singles-and-pairs hands).' },
  selfdrawn: { match: ['self-drawn'], text: 'Winning with a tile you drew from the wall yourself. Everyone pays double.' },
  dead: { match: ['dead hand', 'hand is dead'], text: 'A hand that can’t win, for example because its exposures fit no hand on the card. The player stops playing but still pays.' },
  wallgame: { match: ['wall game'], text: 'The wall runs out and nobody has won. Nobody pays.' },
  soap: { match: ['Soap'], text: 'The white dragon. It also stands for zero, as in 2026. It goes with the Dots suit.' },
  dragon: { match: ['dragon', 'dragons'], text: 'Red goes with Craks, green with Bams, white (Soap) with Dots. On the card, a D takes the dragon of its color’s suit.' },
  wall: { match: ['the wall'], text: 'The face-down tiles you draw from. When it runs out with no winner, it’s a wall game.' },
  discard: { match: ['discard', 'discards'], text: 'The tile you throw face up at the end of your turn. Others may call it.' },
  away: { match: ['away'], text: 'How many more tiles you need to complete that hand, counting jokers you hold as filling group spots.' },
});

const ENTRIES = Object.entries(GLOSSARY).flatMap(([key, { match }]) => match.map((m) => ({ key, m })))
  .sort((a, b) => b.m.length - a.m.length); // longest first: "joker exchange" before "joker"

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERM_RE = new RegExp(`\\b(${ENTRIES.map((e) => escape(e.m)).join('|')})\\b`, 'gi');

/**
 * Split text into plain and term segments. Each term is marked only the first time it appears
 * (and only once per key across calls that share `seen`).
 * @param {string} text
 * @param {Set<string>} [seen]
 * @returns {({text: string}|{text: string, term: string})[]}
 */
export function splitTerms(text, seen = new Set()) {
  const out = [];
  let last = 0;
  for (const m of text.matchAll(TERM_RE)) {
    const entry = ENTRIES.find((e) => e.m.toLowerCase() === m[0].toLowerCase());
    if (!entry || seen.has(entry.key)) continue;
    seen.add(entry.key);
    if (m.index > last) out.push({ text: text.slice(last, m.index) });
    out.push({ text: m[0], term: entry.key });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last) });
  return out;
}
