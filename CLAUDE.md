# CLAUDE.md — American Mah Jongg Practice Site

Read `SPEC.md` before starting any task. It is the source of truth for rules, data formats, AI behavior, tips, scoring, and scope. If a task conflicts with SPEC.md, stop and ask rather than guessing. If you change a design decision, update SPEC.md in the same commit.

## What this is
A static, single-player practice site for **American (NMJL-style) mah jongg**: the user plays against three simulated opponents of selectable skill, with toggleable strategy tips, scorekeeping, stats, a card editor, and a beginner explainer. It is hosted on **GitHub Pages**: no backend, no server code, no API calls, no LLM calls. The opponents and tips are deterministic JavaScript.

## Stack and conventions
- Vanilla JavaScript, native ES modules, no build step, no framework, no bundler. The repo root is served as-is.
- No runtime dependencies loaded from CDNs unless explicitly approved. Dev-only tooling is fine.
- `js/engine/` is **pure logic**: no DOM, no `window`, no `localStorage`, no timers. Everything there must run under Node for tests.
- `js/ui/` renders and handles input only. It calls the engine; the engine never imports UI.
- `js/storage.js` is the only module that touches `localStorage`. Wrap every read and write in try/catch; the app must work when storage is empty or unavailable.
- Randomness only through the seeded PRNG in `js/engine/rng.js`. Never call `Math.random()` in the engine.
- Prefer small modules with named exports. Use JSDoc types on public engine functions.
- Tiles are integer ids (see SPEC §3). Hands are count arrays where practical.

## Commands
- Run tests: `node --test test/`
- Local preview: `python3 -m http.server 8000`, then open http://localhost:8000. Opening `file://` directly breaks ES module imports.
- Deploy: push to `main`. GitHub Pages serves from the repo root on `main`.

## Hard rules (never violate)
1. **No NMJL card data in the repo.** No current or past official card hands in code, fixtures, tests, comments, or docs. Only the original practice card in `data/practice-card.json` and hands invented for tests. User cards live only in the user's browser (localStorage) and in files they export themselves. Do not build any feature that uploads, shares, or publishes card data.
2. **Opponents never see hidden information.** AI and tip code receives only an observation object built by `js/engine/observe.js` (SPEC §8). Never pass the full game state to AI or tips code. Tests enforce this.
3. **Tile conservation.** 152 tiles at all times across wall, hands, exposures, and discards. The simulation test asserts this every turn.
4. **The engine is the rules authority.** The UI never decides legality; it asks the engine.

## Workflow
- Work in the build order in SPEC §15. Finish and test one stage before starting the next.
- Write or update tests with every engine change. Rules code without tests is not done.
- Run the full test suite before every commit. Commit in small, descriptive steps.
- When a rule in SPEC is marked **[verify]**, implement it as a configurable setting with the stated default and leave a `// [verify]` comment.
- Keep the UI usable on an iPad in landscape and on a desktop browser. Touch targets at least 44px.
