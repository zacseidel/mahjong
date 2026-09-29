# SPEC.md — American Mah Jongg Practice Site

Status: v1 design. Items marked **[verify]** are rules I am not fully certain of; implement them as settings with the stated default.

---

## 1. Goals

A beginner-friendly practice site for American mah jongg that:

- lets one human play full hands against three simulated opponents, each with a selectable skill level;
- offers toggleable strategy tips (offense and defense) that explain *why*;
- keeps score and tracks stats that show improvement over time;
- works with an **original practice card** out of the box, and with the **user's own purchased card**, which they enter in a card editor and which stays in their browser;
- explains the game for someone who has never played;
- runs entirely as a static site on GitHub Pages, and works well on an iPad.

Non-goals for v1: online multiplayer, accounts, sound, animations beyond simple transitions, the advanced defensive AI (v2), photo/OCR card import.

---

## 2. Legal constraints on card data

The annual NMJL card is copyrighted. This repo must never contain its hands, current or past, in any form.

- The site ships with an original practice card written for this project (§5).
- Users may enter their own card in the card editor. It is stored in their browser's localStorage and can be exported and imported as a JSON file for backup. It is never sent anywhere.
- No sharing, gallery, or upload features for cards.
- The UI may describe itself as "for use with your own card." It must not use the NMJL name or logo in a way that implies affiliation.

---

## 3. Tiles

152 tiles:

| Tiles | Ids | Copies each | Total |
|---|---|---|---|
| Craks 1–9 | 0–8 | 4 | 36 |
| Bams 1–9 | 9–17 | 4 | 36 |
| Dots 1–9 | 18–26 | 4 | 36 |
| Winds N, E, W, S | 27–30 | 4 | 16 |
| Dragons: Red, Green, White ("soap") | 31–33 | 4 | 12 |
| Flowers (all interchangeable) | 34 | 8 | 8 |
| Jokers | 35 | 8 | 8 |

**Suit–dragon pairing:** Craks ↔ Red, Bams ↔ Green, Dots ↔ White. White dragon ("soap") also serves as **zero** in year hands (e.g., the 0 in 2026).

Helpers in `js/engine/tiles.js`: `suitOf(id)`, `rankOf(id)`, `dragonForSuit(suit)`, `isNumber(id)`, `isJoker(id)`, display names, and a compact string form for tests and debugging (e.g., `3C`, `7B`, `5D`, `NW`, `EW`, `RD`, `GD`, `WD`, `F`, `J`).

---

## 4. Rules of play (American)

### 4.1 Setup
- Four seats: East (dealer), South, West, North. The human's seat is selectable; default South.
- Shuffle with the seeded PRNG and build the wall. Deal 14 to East, 13 to each other player.
- **Dealer rotation:** after each hand, East passes to the player on the right, whoever won. **[verify]**

### 4.2 The Charleston
Before play, players pass tiles. Each pass is exactly 3 tiles. **Jokers may never be passed.**

1. **First Charleston (mandatory):** pass right, then across, then left.
   - The final pass (left) may be a **blind pass**: a player may pass on 1–3 of the tiles just received without looking at them, making up the rest of the 3 from their own hand.
   - Passes in a round are simultaneous. A blind passer forwards the first 1–3 tiles they receive and keeps the rest; forwarded tiles are traced back to whoever passed them from their own hand, so blind passes can chain around the table. If all four players blind all 3, no tile leaves anyone's hand and nothing moves.
2. **Second Charleston (optional):** any player may stop it before it starts. If played: left, then across, then right. The final pass (right) may be blind.
3. **Courtesy pass (optional):** each pair of players sitting across from each other agree to trade 0–3 tiles. The smaller number requested is used. **[verify]**

AI opponents decide whether to stop the second Charleston (§9). The UI offers the human the same choice.

### 4.3 Turn order and play
- East starts by discarding (East already has 14 tiles and doesn't draw first).
- Play proceeds to the right: East → South → West → North.
- A normal turn: draw from the wall, optionally make joker exchanges (§4.5), optionally declare Mah Jongg, otherwise discard one tile.
- Discards are placed face up and named.

### 4.4 Calling a discard
- A discard may be called only:
  - to complete an **exposure** of 3 or more identical tiles (pung, kong, quint, sextet), which the caller then places face up, jokers allowed; or
  - to complete **Mah Jongg**. This is the only time a discard can be taken to complete a pair or single.
- The engine offers an exposure call only when the new exposure, together with the caller's earlier exposures, still fits at least one exposed hand on the loaded card. A call that fits nothing would make the hand dead at once (§4.7), so it is never offered.
- There are no chows (runs are never called).
- A discarded joker can't be called.
- **Priority:** a Mah Jongg call beats an exposure call. Between two exposure calls, the player next in turn after the discarder wins. Between two Mah Jongg calls, also the player next in turn. **[verify]**
- After an exposure call, the caller discards, and play continues to the caller's right. Skipped players lose their turn.
- **Concealed hands** (marked C on the card) may not make exposures, but may call the final tile for Mah Jongg. **[verify]**
- Exposures can never be rearranged once placed.

### 4.5 Jokers
- A joker may stand in for any tile in a group of 3 or more identical tiles.
- A joker may **never** be used in a pair or a single, including in year hands and singles-and-pairs hands.
- **Joker exchange:** on your own turn, you may exchange a real tile from your hand for a joker in any player's exposure (including your own), if your tile matches what the joker represents there. Multiple exchanges per turn are allowed.

### 4.6 Mah Jongg
- A winning hand is exactly 14 tiles (exposed plus concealed) matching one concrete instantiation of one hand on the loaded card (§5), with all joker placements legal and all exposures consistent with that hand.
- Default ("training wheels on"): the Mah Jongg button is enabled only when the engine confirms a valid hand.
- "Training wheels off": the button is always enabled; a false Mah Jongg makes that player's hand dead. Official penalties for false Mah Jongg are more detailed; v1 uses this simplification. **[verify]** The dead player keeps their 14 tiles and play passes to the next player, who draws. With `falseMahJongg: 'retract'`, nothing happens and the player continues their turn. False Mah Jongg can only be declared on your own turn; the claim window offers Mah Jongg only when it is valid.
- A win on the dealt 14 tiles (East, before discarding) counts as self-drawn. If a player calls a discard for an exposure and then has Mah Jongg (for example after a joker exchange), it scores as a win on that discard.

### 4.7 Dead hands
- A player's hand is dead if their exposures can't fit any hand on the loaded card, or their tile count is wrong.
- A dead player stops drawing and discarding, can't win, and still pays when someone else wins.
- AI opponents detect and declare dead hands. The human is offered the option via a dead-hand alert (§10.6).

### 4.8 End of hand
- Mah Jongg: settle payments (§11).
- **Wall game:** if the wall runs out with no winner, nobody pays.

### 4.9 Rule variant settings
Every **[verify]** rule above is a setting in `js/engine/rules-config.js`. The default is the rule as written above. Users can change these in Settings, and the values are stored locally. Engine code reads a rules object from `resolveRules()`, which ignores unknown keys and invalid values.

| Key | Default | Alternatives | Rule |
|---|---|---|---|
| `dealerRotation` | `'always'` | `'winnerKeeps'` | §4.1 |
| `courtesyPass` | `'min'` | `'off'` | §4.2 |
| `mahJonggBeatsExposure` | `true` | `false` (next in turn always wins) | §4.4 |
| `concealedCanCallForMahJongg` | `true` | `false` | §4.4 |
| `falseMahJongg` | `'deadHand'` | `'retract'` (no penalty) | §4.6 |

The §11.2 scoring house rules live in the same rules object.

---

## 5. Card data

### 5.1 Card JSON schema

```json
{
  "schema": 1,
  "name": "Practice Card",
  "year": null,
  "source": "practice",
  "hands": [ /* Hand objects */ ]
}
```

`source` is `"practice"` or `"user"`. `year` is the year the card's year hands spell out, or `null`; the practice card uses the current year (2026). Multiple cards can be stored; one is active.

### 5.2 Hand object

```json
{
  "id": "run-3",
  "category": "Consecutive Run",
  "line": "FF 111g 222g 3333r DDr",
  "numbers": "shift",
  "value": 25,
  "concealed": false,
  "notes": "Any 3 consecutive numbers"
}
```

- `line`: the hand as printed, in the notation below.
- `numbers`: how the digits vary.
  - `"fixed"`: exactly as printed.
  - `"shift"`: all digits shift together by the same amount, staying within 1–9. This covers both "any consecutive" and "any like numbers."
- `value`: points.
- `concealed`: true for C hands, false for X hands.
- `pattern` (optional): the advanced compiled-group form (§5.3). When present, it is used for matching instead of `line`, and `line` is kept only for display.
- The engine compiles each hand into a pattern of groups; apart from an advanced `pattern`, the compiled form is internal and is not stored.

### 5.3 Line notation
Groups are separated by spaces.

- **Same tile:** a token of one repeated character is one group of that tile. `1111` is a kong of 1s, `FF` a pair of flowers, `DDD` a pung of dragons.
- **Mixed tiles:** a token with different characters is a sequence of **singles**. Examples: `2026` (single 2, single soap, single 2, single 6), `NEWS` (one of each wind).
- **Characters:**
  - `1`–`9`: number tiles.
  - `0`: white dragon used as zero. It is always the white dragon, whatever its color.
  - `F`: flower.
  - `N`, `E`, `W`, `S`: winds.
  - `D`: dragon, with the dragon determined by its color (below).
- **Color suffix:** `g`, `r`, or `b` after a token gives the color printed on the card. Colors are **suit variables**, not specific suits. Different colors mean different suits; the same color means the same suit. Numbers and `D` need a color; `F`, winds, and `0` don't.
- **Dragons:** a `D` in a color takes the dragon paired (§3) with whatever suit that color is assigned.
- **Expansion:** assign distinct suits to the colors in every possible way (up to 6 permutations for 3 colors), and apply number shifts if `numbers` is `"shift"`. Discard instantiations that need more copies of a tile than exist (without jokers for pairs and singles).

Edge cases the notation can't express are handled by an **advanced JSON editor** in the card editor (§12), which accepts compiled groups directly:

```json
{ "groups": [ { "tile": "n", "suit": "A", "count": 3 },
              { "tile": "n+1", "suit": "A", "count": 3 } ],
  "constraints": { "n": [1, 8] } }
```

In this format, `tile` is a digit 1–9, a number variable (one lowercase letter, with an optional `+k` or `-k`), or `0`, `F`, `N`, `E`, `W`, `S`, `D`. Numbers and `D` need a `suit` variable, and different suit variables mean different suits. Number variables range over 1–9 unless `constraints` narrows them, and instantiations with a rank outside 1–9 are dropped.

The notation is the primary input; the compiled-group format is the fallback.

### 5.4 The practice card
`data/practice-card.json`: an **original** card of about 35–45 hands written for this project. Requirements:

- Cover the usual American category types: a year hand (use the current year), 2468, like numbers, additions (e.g., a group of 1s, a group of 2s, and a group of 3s arranged as 1+2=3), quints, consecutive runs, 13579, winds and dragons, 369, singles and pairs.
- Values from 25 to 50 points, higher for harder hands; singles and pairs hands concealed.
- Include both exposed and concealed hands, and hands of 1, 2, and 3 suits.
- Do not copy or lightly modify any official NMJL hand. Write patterns fresh. Simple patterns in the common categories will inevitably be similar in kind; the selection and specifics must be ours.
- Add a validation test that expands every practice-card hand and asserts each has at least one legal 14-tile instantiation.

---

## 6. Engine modules

```
js/engine/
  rng.js         seeded PRNG (mulberry32) and shuffle
  tiles.js       tile ids, helpers, string forms
  seats.js       seat ids, right/across/left, turn distance, dealer rotation
  rules-config.js  rule variants and house rules (§4.9, §11.2)
  wall.js        building the wall, dealing, drawing
  card.js        parse line notation, compile, expand, match a hand to the card
  rules.js       joker legality, legal calls, joker exchanges, dead-hand checks
  charleston.js  Charleston state machine
  game.js        full game state machine and event log
  observe.js     builds per-player observation objects (§8)
  evaluator.js   distance-to-hand and candidate ranking (§7)
  scoring.js     settlement (§11)
  defense.js     opponent profiles, threat, tile danger (§10)
  tips.js        turns evaluator and defense output into tip text
  ai/
    beginner.js
    intermediate.js
```

### 6.1 Game state machine
The states are:

`deal → charleston (pass rounds, stop vote, courtesy pass) → east discard → [claim window → resolve claims] → next turn (draw → exchanges → Mah Jongg? → discard) → … → end (Mah Jongg or wall game) → settlement`

- The engine emits an **event log** (deal, pass, draw, discard, call, expose, exchange, dead, mahjong, wallgame, settle). The UI renders from state plus events. The log also drives post-hand review.
- **Claim window:** after each discard, every non-discarding, non-dead player gets a chance to claim. The engine computes each player's legal claims first. The human is **only prompted when they have a legal claim**. AI players answer instantly.
- A seed plus the list of human decisions reproduces a hand exactly ("replay this deal").
- **Driver model:** the engine never calls a player. `pending(state)` lists the decisions it is waiting for (several seats at once during Charleston rounds and claim windows), each with its legal options. `act(state, seat, action)` validates and applies one decision, throwing on anything illegal, and records it in `state.actions`. `replay(options, actions)` rebuilds the hand. The UI, the AI (through observations), and tests all drive the game this way.
- Test and drill hooks on `newGame`: `wallTiles` (a preset 152-tile order instead of a shuffle) and `charleston: false`.
- The event log holds full information, including concealed tiles, for post-hand review. Players and AI see only `observe()` output (§8).

---

## 7. The evaluator (distance to a hand)

The core computation, used by AI, tips, defense, and dead-hand checks.

For one **concrete** target (a card hand with suits and numbers fixed):

1. Take the tile counts required by the target. Split them into:
   - **group slots** (groups of 3 or more, where jokers are allowed), and
   - **pair/single slots** (where jokers are not allowed).
2. Remove the player's exposures. They must fit into the target's groups exactly as exposed, or the target is impossible for this player.
3. Assign the player's concealed real tiles to pair/single slots first, then to group slots.
4. `missingReal` = unfilled pair/single slots. `missingGroup` = unfilled group slots.
5. **distance = missingReal + max(0, missingGroup − jokersHeld)**.
6. The target is **dead** if `missingReal` needs tiles with no live copies left (live = 4 minus copies visible anywhere, or 8 for flowers).

Across the card: expand every hand (§5.3), compute the distance for each concrete target, and return targets ranked by distance, then by value. Cache the expansion per card. A card of ~60 hands expands to a few thousand concrete targets, which is cheap to scan every turn.

Also expose **liveness**: for each still-needed tile, how many copies remain unseen from this player's view. The AI uses this to prefer hands whose needed tiles are still available.

---

## 8. Observations and information hiding

`observe(state, seat)` returns everything that seat could legitimately know, and nothing else:

- its own concealed tiles and jokers;
- every player's exposures;
- every discard, in order, with who discarded it;
- the tiles it received in each Charleston pass, and from whom;
- wall count, turn number, dealer, whose turn it is;
- which players are dead;
- the active card (all players use the same card).

AI modules and `tips.js` / `defense.js` import **only** observations. A test builds a full state, runs every AI decision function with a spy on its input, and fails if any hidden field (other players' concealed tiles, wall order) is reachable.

---

## 9. Opponents

All opponents are deterministic JS given the seed. Each seat's difficulty is set independently. A short pause (default 600 ms, adjustable, including "instant") before each AI action lets the human follow along.

### 9.1 Beginner
- Charleston: picks its single best target at the start and passes tiles not in it. Never stops the second Charleston.
- Commits to that target and doesn't switch unless it becomes dead.
- Calls every legal exposure that fits its target.
- Discards the tile least useful to its target, breaking ties randomly (seeded).
- Makes joker exchanges only 30% of the time they're available.
- Declares Mah Jongg whenever it can.
- No defense.

### 9.2 Intermediate
- Charleston: keeps tiles that support the most of its top ~5 targets, weighted by value and liveness. Stops the second Charleston when its best target is 3 tiles or fewer away.
- Tracks its top ~5 targets every turn and switches when another target becomes clearly better.
- Calls an exposure only when it reduces distance for its current best target and doesn't close off a strictly better target. Avoids exposing when its best targets are concealed hands.
- Discards the tile whose removal increases distance to its weighted top targets the least.
- Always takes joker exchanges that help it.
- Detects and declares dead hands.
- No defense in v1.

### 9.3 Advanced (v2)
Intermediate plus defense: reads opponents with §10, folds when appropriate, avoids feeding exposures to near-complete hands.

---

## 10. Tips (toggleable)

Tips are off by default for a returning player and on by default for a first-time player. Offense and defense tips can be toggled separately. Each tip shows a one-line reason; tapping it expands the explanation.

### 10.1 Offense tips
- **Closest hands:** the top 3 targets with distance, value, and the tiles still needed. Tap one to highlight the tiles in your rack it uses.
- **Charleston:** suggested tiles to pass, with the reason ("these don't fit any of your 3 closest hands").
- **Discard:** the recommended discard and why, plus how much worse the next-best choice is.
- **Calls:** when prompted to call, whether calling helps and what it costs (e.g., "Calling commits you to an exposed hand; your best hand is concealed").
- **Joker exchanges:** available exchanges that help you.

### 10.2 Opponent profiles
For each opponent, maintain:
- their exposures;
- tiles they passed to the human in the Charleston;
- their discards;
- how many tiles they still hold concealed.

### 10.3 Candidate hands per opponent
- Keep only card hands consistent with the opponent's exposures. Any exposure rules out all concealed hands.
- Weight each candidate:
  - start at 1.0;
  - multiply by 0.3 for each distinct tile the opponent passed to you that the hand needs;
  - multiply by 0.7 for each distinct tile they discarded that the hand needs;
  - drop it if it needs a pair or single tile with no live copies.
  - These multipliers are starting guesses; make them constants in one place for tuning.
- Display: tapping an opponent shows "consistent with N hands on your card" and lists them. This teaches reading exposures.

### 10.4 Threat level
Low / medium / high per opponent, from:
- exposures: 0 → low base, 1–2 → medium base, 3 or more → high;
- wall remaining: raise one level in the last quarter of the wall;
- a single surviving candidate raises one level.

Never show a percentage.

### 10.5 Tile danger
`danger(t) = Σ over opponents of threatWeight(opp) × (weighted share of opp's candidates that still need t)`

- Shown as a colored mark on each rack tile: safe / low / medium / high.
- **Jokers are always safe** (they can't be called). A tip notes that throwing a joker is usually bad for your hand, but can be correct very late against high threat.
- A tile no candidate of any threatening opponent needs is safe.

### 10.6 Fold suggestion and dead-hand alert
- **Fold suggestion:** "Consider playing defensively" when all hold:
  - your best target is 3 or more tiles away,
  - fewer than about 25 tiles remain in the wall,
  - some opponent's threat is high.
  - Then the discard tip switches to "safest tile that hurts your hand least," and shows the stakes: "Throwing West's winning tile costs you 50 instead of 25."
- **Dead-hand alert:** "West's exposures don't match any hand on your card. You can declare their hand dead." Offer a button. Warn once, in the card editor, that a mistyped card causes false alerts.

---

## 11. Scoring

### 11.1 Settlement

```js
function settle({ winner, discarder, selfDrawn, value, jokerless, hasGroups }, rules) {
  const pay = [0, 0, 0, 0];               // positive = receives
  if (winner == null) return pay;          // wall game
  let v = value;
  if (jokerless && hasGroups && rules.jokerlessDouble) v *= 2;
  for (let p = 0; p < 4; p++) {
    if (p === winner) continue;
    const amt = selfDrawn ? 2 * v : (p === discarder ? 2 * v : v);
    pay[p] -= amt;
    pay[winner] += amt;
  }
  return pay;
}
```

- Value comes from the card line.
- **Jokerless bonus:** doubles the value when the whole 14-tile hand has no jokers. It doesn't apply to hands without any groups of 3 or more (e.g., singles and pairs), since jokers couldn't be used anyway.
- **Win on a discard:** the discarder pays 2×; the other two pay 1×.
- **Self-drawn win:** all three pay 2×. This stacks with jokerless.
- **No special East payments.**
- Dead players still pay.
- Wall game: no payments.

### 11.2 House-rule settings
All but point display (a UI setting) are keys in `rules-config.js` (§4.9).

| Setting | Default |
|---|---|
| Jokerless double | on |
| Self-draw double | on |
| Discarder pays double | on |
| Point display: points / dollars (1 pt = $0.01) / both | points |
| Discarder pays for all when throwing to an obvious hand **[verify, house rule]** | off |
| Wall-game payment **[house rule]** | off |

- "Obvious hand" means the winner has 3 or more exposures (the same threshold as high threat in §10.4). With the rule on, the discarder pays everyone's share and the other two pay nothing. **[verify]**
- Wall-game payment is not defined yet, so the setting has no effect in v1. Define it or remove it before the settings UI (stage 9).

### 11.3 Ledger and stats
Every hand record stores: timestamp, seed, card id, winner, winning hand id, value, jokerless, selfDrawn, discarder, payments, whether tips were on, and the human's decisions (for replay).

Session: running net total per player, CSV export.

Stats for the human, split by tips on and off:
- win rate;
- deal-in rate (how often your discard gave someone else Mah Jongg) — the key defensive stat;
- self-draw share of wins;
- average winning value;
- jokerless rate;
- wall-game rate;
- how often the fold suggestion was followed.

---

## 12. Card editor (`card.html`)

- Lists stored cards and lets the user choose which one is active. The practice card is always present and read-only.
- **New card:** name and year, then add hands one at a time.
- **Hand entry:** category (free text with suggestions), line notation, numbers (fixed / shift), X or C, value, optional notes.
  - A **live preview** renders 2–3 example instantiations as tile images as the user types ("e.g., 4444 bam, 5555 crak, 6666 dot"), so they can check against the printed card.
  - Parse errors are shown inline with the position.
  - The advanced JSON editor is available per hand for edge cases.
- Reorder, edit, duplicate, and delete hands.
- **Export** the card as a JSON file; **import** from one. Validate imports and report which hands failed.
- Storage: localStorage key `mj.cards.v1`. Schema version inside the data allows future migration.
- **iPad data loss:** Safari may clear site data after about 7 days without a visit unless the site is added to the home screen. The editor shows a reminder to export a backup and to add the site to the home screen. The game shows a clear "no card loaded" screen with import and practice-card options.

---

## 13. UI

### 13.1 Pages
- `index.html`: the game.
- `card.html`: card editor.
- `learn.html`: explainer.
- `stats.html`: ledger and stats (or a panel in the game).

### 13.2 Game screen
- Human's rack at the bottom: tap to select, tap again or use a button to discard. Drag to reorder, plus an auto-sort button.
- The human's exposures above the rack; each opponent's exposures and concealed tile count on its side.
- A shared discard area showing the most recent discard prominently, with the full history viewable.
- Claim bar: appears only when the human has a legal claim — Call, Mah Jongg, Pass.
- Charleston panel: select 3 tiles, pass, blind-pass option on eligible rounds, stop-second-Charleston choice, courtesy-pass count.
- Tips panel: collapsible. Offense and defense toggles.
- Settings: difficulty per seat, AI speed, tips, training wheels, house rules, point display, active card, human's seat.
- After each hand: reveal all hands, show what each opponent was building, the settlement, and highlight any human discards that differed from the tip recommendation. "Next hand" and "Replay this deal" buttons.

### 13.3 Tile art
Generate original SVG tiles in code (`js/ui/tileArt.js`) rather than using third-party art. This avoids licensing questions and covers jokers and flowers, which Riichi-oriented tile sets lack. Numbers with a clear suit symbol and color; honors with a clear letter or symbol. Legible at small sizes. Light and dark themes.

### 13.4 Accessibility and layout
- Works on iPad landscape and desktop; usable on phone landscape.
- Touch targets at least 44px.
- Color is never the only signal: danger marks also have a shape or letter.

---

## 14. Explainer (`learn.html`)

Plain-language sections, each with tile images:
1. What American mah jongg is, and how it differs from other styles (the card; no runs called; jokers; the Charleston).
2. The tiles, including the dragon–suit pairing and soap as zero.
3. The card: how to read colors, X/C, values, and the notes.
4. The Charleston, step by step.
5. A turn: draw, exchange, discard. Calling discards and what you can't call.
6. Jokers: where they can and can't go; exchanges.
7. Winning, dead hands, and wall games.
8. Scoring with worked examples: a win on a discard, a self-drawn win, a jokerless win.
9. Beginner strategy: keep several hands open early, commit around the end of the Charleston, watch exposures, and when defense is worth it.
10. How to use this site: tips, the card editor, and backing up your card.

Use only practice-card hands in examples.

---

## 15. Build order

1. `rng`, `tiles`, `wall`: tile ids, seeded shuffle, deal. Tests: 152 tiles, correct counts, deterministic by seed.
2. `card`: parse notation, compile, expand, match a 14-tile hand. Tests: every parse rule in §5.3, color permutations, shift bounds, dragon pairing, soap as zero, jokers rejected in pairs and singles, concealed rules, invented test hands only. Practice-card validation test.
3. `rules`: joker exchanges, legal calls, dead-hand checks. Tests for each rule in §4.
4. `charleston` and `game`: the full state machine, the event log, the claim window, and `scoring`. Simulation test: 1,000 seeded all-AI games (until stage 5, a simple test-only bot policy stands in for the AI) with invariants checked every turn (tile conservation, hand sizes 13/14, no jokers passed, no illegal calls, settlements sum to zero).
5. `observe`, `evaluator`, then the beginner and intermediate AI. The information-hiding test.
6. UI: game screen, rack, discards, claim bar, Charleston.
7. Tips (offense, then defense), `learn.html`.
8. Card editor with preview, import/export.
9. Ledger, stats, settings persistence.

---

## 16. Tests (`test/`)

Minimum coverage:
- `rng.test.js`: determinism by seed, ranges, shuffle is a permutation.
- `tiles.test.js`: ids, helpers, counts.
- `seats.test.js`: pass directions, turn order, dealer rotation.
- `wall.test.js`: deal sizes, deal order, determinism, conservation while drawing.
- `rules-config.test.js`: defaults, overrides, invalid values ignored.
- `card.test.js`: notation parsing and errors, expansion, matching, jokers in pairs/singles rejected, concealed vs exposed, practice-card validity.
- `rules.test.js`: calls allowed and disallowed, call priority, joker exchanges, dead hands.
- `charleston.test.js`: pass directions, blind passes, stop vote, courtesy pass, jokers never passed.
- `scoring.test.js`: discarder 2×/others 1×, self-draw 2×, jokerless stacking, singles-and-pairs not doubled, wall game, dead players pay, settlements sum to zero.
- `evaluator.test.js`: distance examples including joker coverage and dead targets.
- `observe.test.js`: no hidden information reachable.
- `simulation.test.js`: 1,000 seeded games with invariants.

---

## 17. v2 backlog

- Advanced defensive AI.
- Drills: "which hand should you go for" after a deal, "what to pass," "is this Mah Jongg."
- Manual scoring ledger for real-table games.
- Full false-Mah-Jongg penalty rules.
- Hand replay viewer with a step-through timeline.
- Tuning the defense weights from simulation data.
