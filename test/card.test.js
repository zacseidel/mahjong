// Every hand in this file is invented for testing. None is from an official card.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CardError, parseLine, parsePattern, compileHand, expandHand, expandPattern, expandCard,
  matchTarget, matchHand, describeTarget, validateCard, HAND_SIZE,
} from '../js/engine/card.js';
import {
  CRAK, BAM, DOT, JOKER, FLOWER, WHITE_DRAGON, RED_DRAGON, GREEN_DRAGON,
  numberTile, parseTiles, suitOf, rankOf, isNumber, dragonForSuit,
} from '../js/engine/tiles.js';

const hand = (line, extra = {}) => ({ id: 'h', line, numbers: 'fixed', value: 25, concealed: false, ...extra });
const descs = (targets) => targets.map(describeTarget).sort();

// Build the tiles of a target with no jokers.
function tilesOf(target) {
  return target.layout.flatMap(({ tile, count }) => Array(count).fill(tile));
}

function throwsAt(fn, pos, pattern) {
  assert.throws(fn, (e) => {
    assert.ok(e instanceof CardError, `expected CardError, got ${e}`);
    assert.equal(e.pos, pos);
    if (pattern) assert.match(e.message, pattern);
    return true;
  });
}

// ---------- Parsing ----------

test('same-character token is one group; mixed token is singles', () => {
  const p = parseLine('FF 5555g NEWS 2468g');
  assert.deepEqual(p.slots.map((s) => s.count), [2, 4, 1, 1, 1, 1, 1, 1, 1, 1]);
  assert.equal(p.slots[1].kind, 'num');
  assert.equal(p.slots[1].offset, 5);
});

test('repeated characters inside a mixed token stay singles', () => {
  const p = parseLine('FF 2026g 2026r 2026b');
  assert.deepEqual(p.slots.map((s) => s.count), [2, ...Array(12).fill(1)]);
});

test('numbers and D need a color; F, winds, and 0 do not', () => {
  assert.doesNotThrow(() => parseLine('FF NNNN EEEE 0000'));
  throwsAt(() => parseLine('FF 1111 NNNN EEEE'), 3, /needs a color/);
  throwsAt(() => parseLine('FF DDDD NNNN EEEE'), 3, /needs a color/);
});

test('parse errors report their position', () => {
  throwsAt(() => parseLine('FF 11X1g NNNN SSSS'), 5, /Unknown character "X"/);
  throwsAt(() => parseLine('FF 11g1g NNNN SSSS'), 5, /end of a group/);
  throwsAt(() => parseLine('FF g NNNN SSSS'), 3, /no tiles/);
  throwsAt(() => parseLine('FF 1111j NNNN SSSS'), 7, /Unknown character "j"/);
  throwsAt(() => parseLine('   '), null, /empty/);
  throwsAt(() => parseLine('FF 111g NNNN SSSS'), null, /has 13 tiles/);
  throwsAt(() => parseLine('FF 1111g NNNN SSSS', 'any'), null, /fixed" or "shift/);
});

test('position is included in the message, 1-based', () => {
  assert.throws(() => parseLine('FF 11X1g NNNN SSSS'), /at position 6/);
});

test('0 is always the white dragon, even with a color', () => {
  for (const line of ['FF 0000 NNNN SSSS', 'FF 0000g NNNN SSSS']) {
    const targets = expandHand(hand(line));
    assert.equal(targets.length, 1);
    assert.equal(targets[0].group[WHITE_DRAGON], 4);
  }
});

// ---------- Expansion ----------

test('one color expands to each of 3 suits', () => {
  const targets = expandHand(hand('FF 2222g 4444g 6666g'));
  assert.equal(targets.length, 3);
  assert.deepEqual(new Set(targets.map((t) => suitOf(t.groups[0].tile))), new Set([CRAK, BAM, DOT]));
  for (const t of targets) {
    const suits = new Set(t.groups.filter((g) => isNumber(g.tile)).map((g) => suitOf(g.tile)));
    assert.equal(suits.size, 1, 'same color means same suit');
  }
});

test('two colors expand to 6 ordered suit pairs, always different suits', () => {
  const targets = expandHand(hand('FF 3333g 3333r NNNN'));
  // 3333g/3333r is symmetric, so ordered pairs collapse to 3 unordered pairs.
  assert.equal(targets.length, 3);
  const asym = expandHand(hand('FF 3333g 5555r NNNN'));
  assert.equal(asym.length, 6);
  for (const t of asym) {
    const [a, b] = t.groups.filter((g) => isNumber(g.tile)).map((g) => suitOf(g.tile));
    assert.notEqual(a, b, 'different colors mean different suits');
  }
});

test('three colors expand to 6 permutations', () => {
  assert.equal(expandHand(hand('FF 1111g 555r 999b SS')).length, 6);
});

test('symmetric three-color hand de-duplicates to one target', () => {
  const targets = expandHand(hand('FF 1357g 1357r 1357b', { concealed: true }));
  assert.equal(targets.length, 1);
});

test('shift moves all digits together and stays within 1–9', () => {
  const targets = expandHand(hand('111g 222g 333g 444g 55g', { numbers: 'shift' }));
  assert.equal(targets.length, 5 * 3); // start at 1..5, three suits
  for (const t of targets) {
    const ranks = t.layout.map((s) => rankOf(s.tile));
    assert.ok(ranks.every((r) => r >= 1 && r <= 9));
    assert.deepEqual(ranks.map((r) => r - ranks[0]), [0, 1, 2, 3, 4]);
  }
  const lows = new Set(targets.map((t) => rankOf(t.layout[0].tile)));
  assert.deepEqual([...lows].sort(), [1, 2, 3, 4, 5]);
});

test('fixed numbers do not shift', () => {
  assert.equal(expandHand(hand('111g 222g 333g 444g 55g')).length, 3);
});

test('shift leaves soap (0), dragons, winds, and flowers alone', () => {
  const targets = expandHand(hand('FFF 0000 7777g DDDr', { numbers: 'shift' }));
  assert.equal(targets.length, 9 * 6);
  for (const t of targets) {
    assert.equal(t.layout[0].tile, FLOWER);
    assert.equal(t.layout[1].tile, WHITE_DRAGON);
  }
});

test('D takes the dragon paired with its color’s suit', () => {
  const targets = expandHand(hand('1111g DDDg 9999r DDDr'));
  assert.equal(targets.length, 6);
  for (const t of targets) {
    const [n1, d1, n2, d2] = t.layout.map((s) => s.tile);
    assert.equal(d1, dragonForSuit(suitOf(n1)));
    assert.equal(d2, dragonForSuit(suitOf(n2)));
  }
  const craks = targets.find((t) => t.layout[0].tile === numberTile(CRAK, 1) && t.layout[2].tile === numberTile(BAM, 9));
  assert.deepEqual([craks.layout[1].tile, craks.layout[3].tile], [RED_DRAGON, GREEN_DRAGON]);
});

test('instantiations needing too many copies without jokers are dropped', () => {
  // Five 1s as singles and pairs in the same suit: impossible (only 4 copies).
  assert.equal(expandHand(hand('11g 11g 1g NNNN SSSS F')).length, 0);
  // Soap as singles plus a white-dragon pair: 5 whites with no jokers allowed.
  const t = expandHand(hand('FF 2020g 2020r DDb 99b', { concealed: true }));
  // g/r are symmetric, so 3 distinct targets by b's suit; b=dots makes D white (6 whites) and is dropped.
  assert.equal(t.length, 2);
  assert.ok(t.every((x) => x.single[WHITE_DRAGON] <= 4));
});

test('groups may exceed 4 copies using jokers, up to 8 jokers', () => {
  assert.equal(expandHand(hand('55555g 55555r FFFF')).length, 3);
  assert.equal(expandHand(hand('NNNNNNN NNNNNNN')).length, 0, 'needs 10 jokers');
});

test('shift range is limited by the widest digits', () => {
  const t = expandHand(hand('1111g 9999g FFF NNN', { numbers: 'shift' }));
  assert.equal(t.length, 3, 'only 1 and 9 fit');
});

// ---------- Advanced pattern ----------

test('advanced pattern with a number variable and constraints', () => {
  const pattern = {
    groups: [
      { tile: 'n', suit: 'A', count: 4 },
      { tile: 'n+1', suit: 'A', count: 4 },
      { tile: 'm', suit: 'B', count: 3 },
      { tile: 'F', count: 3 },
    ],
    constraints: { n: [2, 3], m: [9, 9] },
  };
  const targets = expandPattern(parsePattern(pattern));
  assert.equal(targets.length, 2 * 6);
  for (const t of targets) {
    const [a, b, c] = t.layout.map((s) => s.tile);
    assert.equal(rankOf(b), rankOf(a) + 1);
    assert.ok([2, 3].includes(rankOf(a)));
    assert.equal(rankOf(c), 9);
    assert.notEqual(suitOf(c), suitOf(a));
  }
});

test('advanced pattern variables drop out-of-range ranks', () => {
  const targets = expandPattern(parsePattern({
    groups: [{ tile: 'n', suit: 'A', count: 5 }, { tile: 'n+2', suit: 'A', count: 5 }, { tile: 'D', suit: 'A', count: 4 }],
  }));
  assert.equal(targets.length, 7 * 3);
});

test('a hand with a pattern uses it instead of the line', () => {
  const h = hand('(see pattern)', {
    pattern: { groups: [{ tile: '4', suit: 'A', count: 7 }, { tile: '4', suit: 'B', count: 7 }] },
  });
  assert.equal(compileHand(h).slots.length, 2);
  assert.equal(expandHand(h).length, 3);
});

test('advanced pattern errors', () => {
  const bad = (p, re) => assert.throws(() => parsePattern(p), (e) => e instanceof CardError && re.test(e.message));
  bad({}, /non-empty "groups"/);
  bad({ groups: [{ tile: 'X', count: 14 }] }, /Group 1: unknown tile "X"/);
  bad({ groups: [{ tile: '5', count: 14 }] }, /need a "suit"/);
  bad({ groups: [{ tile: 'F', count: 0 }] }, /count must be/);
  bad({ groups: [{ tile: 'n', suit: 'A', count: 14 }], constraints: { m: [1, 2] } }, /no group uses/);
  bad({ groups: [{ tile: 'n', suit: 'A', count: 14 }], constraints: { n: [0, 12] } }, /within 1–9/);
  bad({ groups: [{ tile: 'n', suit: 'A', count: 13 }] }, /has 13 tiles/);
});

// ---------- Matching ----------

const CARD = {
  schema: 1,
  name: 'Test',
  hands: [
    { id: 'kongs', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
    { id: 'pairs', line: 'FF 11g 22g 33g 44g 55g 66g', numbers: 'shift', value: 50, concealed: true },
    { id: 'mixed', line: 'NNNN 2468g 2468r SS', numbers: 'fixed', value: 35, concealed: false },
    { id: 'concealed-groups', line: 'EEE WWW 1111g 1111r', numbers: 'shift', value: 40, concealed: true },
  ],
};
const P = parseTiles;

test('natural hand matches', () => {
  const m = matchHand(CARD, { concealed: P('F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C') });
  assert.deepEqual(m.map((x) => x.target.handId), ['kongs']);
  assert.equal(m[0].jokerless, true);
});

test('jokers fill groups', () => {
  const m = matchHand(CARD, { concealed: P('F F 2B 2B J J 4B 4B 4B 4B 6B J 6B 6B') });
  assert.deepEqual(m.map((x) => x.target.handId), ['kongs']);
  assert.equal(m[0].jokerless, false);
});

test('a joker can never be a pair or a single', () => {
  // Joker as one of the flower pair.
  assert.equal(matchHand(CARD, { concealed: P('F J 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C') }).length, 0);
  // Joker in a singles-and-pairs hand.
  assert.equal(matchHand(CARD, { concealed: P('F F 1D 1D 2D 2D 3D 3D 4D 4D 5D 5D 6D J') }).length, 0);
  // Joker as a single in a mixed token, or in the wind pair.
  assert.equal(matchHand(CARD, { concealed: P('NW NW NW NW 2C 4C 6C 8C 2B 4B 6B J SW SW') }).length, 0);
  assert.equal(matchHand(CARD, { concealed: P('NW NW NW NW 2C 4C 6C 8C 2B 4B 6B 8B SW J') }).length, 0);
  // The same hand with the joker in the kong is fine.
  assert.deepEqual(
    matchHand(CARD, { concealed: P('NW NW NW J 2C 4C 6C 8C 2B 4B 6B 8B SW SW') }).map((m) => m.target.handId),
    ['mixed'],
  );
});

test('singles-and-pairs hand matches any shift and suit', () => {
  const m = matchHand(CARD, { concealed: P('F F 4D 4D 5D 5D 6D 6D 7D 7D 8D 8D 9D 9D') });
  assert.deepEqual(m.map((x) => x.target.handId), ['pairs']);
});

test('wrong tile count does not match', () => {
  assert.equal(matchHand(CARD, { concealed: P('F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C') }).length, 0);
  assert.equal(matchHand(CARD, { concealed: P('F F 2C 2C 2C 2C 4C 4C 4C 4C 6C 6C 6C 6C 6C') }).length, 0);
});

test('exposures must equal a target group exactly', () => {
  const kong4 = { tile: numberTile(CRAK, 4), count: 4, jokers: 1 };
  const m = matchHand(CARD, { concealed: P('F F 2C 2C 2C 2C 6C 6C 6C 6C'), exposures: [kong4] });
  assert.deepEqual(m.map((x) => x.target.handId), ['kongs']);
  assert.equal(m[0].jokerless, false, 'joker in an exposure counts');

  const pung4 = { tile: numberTile(CRAK, 4), count: 3, jokers: 0 };
  assert.equal(matchHand(CARD, { concealed: P('F F 2C 2C 2C 2C 4C 6C 6C 6C 6C'), exposures: [pung4] }).length, 0);

  const wrongSuit = { tile: numberTile(BAM, 4), count: 4, jokers: 0 };
  assert.equal(matchHand(CARD, { concealed: P('F F 2C 2C 2C 2C 6C 6C 6C 6C'), exposures: [wrongSuit] }).length, 0);
});

test('a concealed hand matches only with no exposures', () => {
  const allIn = P('EW EW J WW WW WW 1C 1C 1C 1C 1B 1B J 1B');
  assert.deepEqual(matchHand(CARD, { concealed: allIn }).map((x) => x.target.handId), ['concealed-groups']);
  const exposed = { tile: parseTiles('EW')[0], count: 3, jokers: 1 };
  const rest = P('WW WW WW 1C 1C 1C 1C 1B 1B J 1B');
  assert.equal(matchHand(CARD, { concealed: rest, exposures: [exposed] }).length, 0);
});

test('matchHand sorts by value, highest first', () => {
  const card = {
    schema: 1, name: 'Overlap',
    hands: [
      { id: 'cheap', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 25, concealed: false },
      { id: 'dear', line: 'FF 2222g 4444g 6666g', numbers: 'fixed', value: 45, concealed: false },
    ],
  };
  const m = matchHand(card, { concealed: P('F F 2D 2D 2D 2D 4D 4D 4D 4D 6D 6D 6D 6D') });
  assert.deepEqual(m.map((x) => x.target.handId), ['dear', 'cheap']);
});

test('matchTarget works directly on every expansion', () => {
  for (const h of CARD.hands) {
    for (const t of expandHand(h)) assert.ok(matchTarget(t, { concealed: tilesOf(t) }), describeTarget(t));
  }
});

test('expandCard caches per card and skips bad hands', () => {
  const card = { schema: 1, name: 'x', hands: [...CARD.hands, { id: 'bad', line: 'FF 11g', numbers: 'fixed', value: 25, concealed: false }] };
  const a = expandCard(card);
  assert.equal(expandCard(card), a);
  assert.ok(a.every((t) => t.handId !== 'bad'));
  assert.ok(a.every((t) => t.layout.reduce((n, s) => n + s.count, 0) === HAND_SIZE));
});

test('targets carry value, concealed, and hasGroups', () => {
  const [t] = expandHand({ ...CARD.hands[1] });
  assert.equal(t.value, 50);
  assert.equal(t.concealed, true);
  assert.equal(t.hasGroups, false);
  assert.equal(expandHand(CARD.hands[0])[0].hasGroups, true);
});

test('describeTarget', () => {
  const t = expandHand(hand('FF 2026g 0000 NNNN')).find((x) => suitOf(x.layout[1].tile) === DOT);
  assert.equal(describeTarget(t), 'F×2 2D WD 2D 6D WD×4 NW×4');
  assert.equal(JOKER, 35);
});

// ---------- Validation ----------

test('validateCard accepts a good card', () => {
  assert.deepEqual(validateCard(CARD), []);
});

test('validateCard reports card and hand problems', () => {
  assert.deepEqual(validateCard(null).map((e) => e.message), ['Card is not an object']);
  const errs = validateCard({
    schema: 2,
    name: '',
    hands: [
      CARD.hands[0],
      { ...CARD.hands[0] },
      { id: 'x', line: 'FF 11X1g NNNN SSSS', numbers: 'fixed', value: 25, concealed: false },
      { id: 'y', line: 'FF 1111g NNNN SSSS', numbers: 'any', value: 0, concealed: 'no' },
      { id: 'z', line: '11g 11g 1g NNNN SSSS F', numbers: 'fixed', value: 25, concealed: false },
    ],
  });
  const summary = errs.map((e) => [e.index, e.message]);
  assert.deepEqual(summary, [
    [null, 'Unsupported card schema: 2'],
    [null, 'Card needs a name'],
    [1, 'Duplicate hand id "kongs"'],
    [2, 'Unknown character "X"'],
    [3, 'Value must be a positive whole number'],
    [3, 'concealed must be true or false'],
    [3, 'numbers must be "fixed" or "shift"'],
    [4, 'No legal way to make this hand with the tiles in a set'],
  ]);
  assert.equal(errs.find((e) => e.index === 2).pos, 5);
});
