// Coaching for new players: the coach box in the decision panel ("How this works", the tip,
// Why?, Show me), the tips side panel, rack decorations, opponent threat badges, glossary
// terms, and the post-hand learning review. Everything comes from the human's observation via
// coach.js, tips.js, and defense.js; after the hand ends, the review may show all tiles.

import { h, mount, button } from './dom.js';
import { tileEl } from './tileArt.js';
import { nameOf, cardLine } from './format.js';
import { richText } from './glossaryUI.js';
import { explainStep } from '../engine/coach.js';
import { offenseTips, defenseTips, suggestion, handView, colorLegend } from '../engine/tips.js';
import { matchHand } from '../engine/card.js';
import { evaluateHand } from '../engine/evaluator.js';
import { JOKER, displayName } from '../engine/tiles.js';
import { sameAction, describeAction as describe } from '../engine/actions.js';

const DANGER = {
  safe: { symbol: '✓', label: 'Safe to discard' },
  low: { symbol: '·', label: 'Low danger' },
  medium: { symbol: '!', label: 'Medium danger' },
  high: { symbol: '!!', label: 'High danger' },
};
const THREAT_TEXT = { none: 'No threat', low: 'Low threat', medium: 'Medium threat', high: 'High threat' };
const COLOR_WORD = { g: 'green', r: 'red', b: 'blue' };

/** One computation per observation, shared by the coach box, panel, rack, and badges. */
let cache = { key: null };
function compute(obs, settings) {
  const key = `${obs.seat}|${obs.log.length}|${obs.hand.join(',')}|${obs.decision?.kind}|${obs.phase}|${settings?.tips.defense}`;
  if (cache.key !== key) {
    const nameOfSeat = (s) => nameOf(s, obs.seat);
    cache = {
      key,
      off: offenseTips(obs, { nameOf: nameOfSeat }),
      def: defenseTips(obs, { nameOf: nameOfSeat }),
      sug: suggestion(obs, { nameOf: nameOfSeat, defense: settings?.tips.defense ?? true }),
      step: explainStep(obs, { nameOf: nameOfSeat }),
    };
  }
  return cache;
}

/** Identifies the current decision, so "Show me" highlights reset when it changes. */
export function decisionKey(obs) {
  return `${obs.log.length}:${obs.decision?.kind ?? ''}`;
}

function tipItem(tip, extra = null) {
  const seen = new Set();
  return h('details', { class: `tip tip-${tip.kind}` },
    h('summary', {}, tip.tile !== undefined ? tileEl(tip.tile, { size: 'xs' }) : null, h('span', {}, richText(tip.line, seen))),
    h('p', {}, richText(tip.detail, seen)),
    extra);
}

/** A hand laid out against its card line: held tiles solid, jokers marked, missing tiles faded. */
export function handViewEl(view) {
  return h('span', { class: 'hand-view' }, ...view.map((g) => h('span', { class: 'hv-group' },
    ...g.cells.map((cell) => {
      const el = tileEl(cell === 'exposed-joker' ? JOKER : g.tile, { size: 'xs', className: `cell cell-${cell}` });
      if (cell === 'joker') el.append(h('span', { class: 'cell-badge', title: 'A joker you hold fills this' }, 'J'));
      el.title = cell === 'need' ? `Still needed: ${displayName(g.tile)}` : cell === 'joker' ? `A joker fills this ${displayName(g.tile)}` : displayName(g.tile);
      return el;
    }))));
}

function legendEl(legend) {
  const entries = Object.entries(legend);
  if (!entries.length) return null;
  return h('span', { class: 'legend' }, 'Here: ', ...entries.flatMap(([c, suit], i) => [
    i ? ', ' : '', h('span', { class: `tok-${c}` }, COLOR_WORD[c]), ` = ${suit}`]));
}

/**
 * Register with the game page.
 * @param {typeof import('./main.js').hooks} hooks
 */
export function installTips(hooks) {
  const review = { entries: [] };

  /** The coach box inside the decision panel: works on every screen size. */
  hooks.coach = (obs, session, ui, rack, rerender) => {
    const s = session.settings;
    if (obs.phase === 'end') return null;
    const { step, sug } = compute(obs, s);
    const showTip = sug && ((sug.kind === 'fold' && s.tips.defense) || (sug.kind !== 'fold' && s.tips.offense));
    const showStep = s.explain && step;
    if (!showTip && !showStep) return null;
    const seen = new Set();
    const box = h('div', { class: 'coach' });
    const guide = ui.tutorial;
    if (guide?.note) {
      box.append(h('div', { class: 'lesson' },
        h('span', { class: 'coach-label' }, 'Lesson'), ' ', h('strong', {}, guide.note.title),
        h('p', {}, richText(guide.note.text, seen)),
        button('Got it', guide.dismiss, { variant: 'small' })));
    }
    if (showStep) {
      // While a lesson note is showing, it's the focus: keep the step explanation folded.
      const details = h('details', { class: 'coach-step', open: guide?.note ? false : ui.stepOpen !== false },
        h('summary', {}, h('span', { class: 'coach-label' }, 'How this works'), ` ${step.title}`),
        h('p', {}, richText(step.text, seen)));
      details.addEventListener('toggle', () => { ui.stepOpen = details.open; });
      box.append(details);
    }
    if (showTip) {
      const key = decisionKey(obs);
      const why = h('p', { class: 'coach-why', hidden: ui.whyOpen !== key }, richText(sug.detail, seen));
      const showMe = () => {
        const a = sug.action;
        if (a.type === 'pass') { ui.blind = a.blind ?? 0; rack.selectTiles(a.tiles); }
        if (a.type === 'courtesyPass') rack.selectTiles(a.tiles);
        if (a.type === 'discard') rack.selectTiles([a.tile]);
        ui.showMe = { key, action: a };
        rerender();
      };
      const how = { pass: 'Tap the highlighted tiles, then press Pass.', courtesyPass: 'Tap the highlighted tiles, then press Pass.', discard: 'Tap the highlighted tile, then press Discard.' }[sug.action.type]
        ?? 'Press the highlighted button.';
      box.append(h('div', { class: 'coach-tip' },
        h('span', { class: 'coach-label tip-label' }, guide ? 'Your move' : 'Tip'),
        h('span', { class: 'coach-line' }, richText(sug.line, seen), guide ? h('span', { class: 'coach-how' }, ` ${how}`) : null),
        h('span', { class: 'coach-buttons' },
          button('Why?', () => { ui.whyOpen = ui.whyOpen === key ? null : key; rerender(); }, { variant: 'small' }),
          guide ? null : button('Show me', showMe, { variant: 'small' }))),
      why);
    }
    return box;
  };

  hooks.renderSide = (el, obs, session, ui, rerender, act) => {
    const tipsOn = session.settings.tips;
    if (!tipsOn.offense && !tipsOn.defense) {
      mount(el, h('h2', { class: 'side-title' }, 'Tips'),
        h('p', { class: 'muted' }, 'Tips are off. Turn them on in Settings.'));
      return;
    }
    const { off, def } = compute(obs, session.settings);
    const sections = [h('h2', { class: 'side-title' }, 'Tips')];

    const folding = tipsOn.defense && def.fold;
    const foldTip = folding ? def.tips.find((t) => t.kind === 'fold') : null;
    if (foldTip) sections.push(h('section', {}, h('h3', {}, 'Suggestion'), tipItem(foldTip)));
    if (tipsOn.offense && obs.phase !== 'end') {
      const contextTips = off.tips.filter((t) => t.kind !== 'exchange' && !(folding && t.kind === 'discard'));
      const exchangeTips = off.tips.filter((t) => t.kind === 'exchange');
      if (contextTips.length) sections.push(h('section', {}, h('h3', {}, 'Suggestion'), ...contextTips.map((t) => tipItem(t))));
      if (exchangeTips.length) sections.push(h('section', {}, h('h3', {}, 'Joker exchanges'), ...exchangeTips.map((t) => tipItem(t))));
      sections.push(h('section', {},
        h('h3', {}, 'Your closest hands'),
        h('p', { class: 'muted small' }, 'Solid tiles you have; faded tiles you still need; J means a joker you hold fills that spot. Tap a hand to highlight its tiles in your rack.'),
        ...off.closest.map((c) => {
          const on = ui.highlightHand === c.handId;
          return h('button', {
            type: 'button',
            class: `closest${on ? ' is-on' : ''}`,
            'aria-pressed': on ? 'true' : 'false',
            onclick: () => { ui.highlightHand = on ? null : c.handId; rerender(); },
          },
          h('span', { class: 'closest-top' },
            h('span', { class: 'closest-cat' }, c.hand.category),
            h('span', { class: 'closest-dist' }, c.distance === 0 ? 'Complete!' : `${c.distance} away`),
            h('span', { class: 'closest-val' }, `${c.value} ${c.concealed ? 'C' : 'X'}`)),
          cardLine(c.hand.line),
          handViewEl(c.view),
          legendEl(c.legend),
          c.concealed ? h('span', { class: 'muted small' }, 'Concealed: build it without calling discards (except the winning tile).') : null);
        })));
    }

    if (tipsOn.defense && (obs.phase === 'turn' || obs.phase === 'claim')) {
      sections.push(h('section', {},
        h('h3', {}, 'Defense'),
        ...def.tips.filter((t) => t.kind !== 'fold').map((t) => tipItem(t, t.kind === 'dead'
          ? button(`Declare ${nameOf(t.seat, obs.seat)} dead`, () => act({ type: 'declareDead', target: t.seat }), { variant: 'primary' })
          : null)),
        h('ul', { class: 'threats' }, ...def.report.opponents.map((o) => h('li', {},
          h('span', { class: `threat threat-${o.threat}` }, THREAT_TEXT[o.threat]),
          ` ${nameOf(o.seat, obs.seat)}: `,
          h('span', { class: 'muted' }, obs.dead[o.seat] ? 'dead hand' : `${o.hands.length} possible hand${o.hands.length === 1 ? '' : 's'} on your card`)))),
        h('p', { class: 'muted small' }, richText(def.report.active
          ? 'Marks on your tiles show the danger of feeding a threatening player’s hand: ✓ safe, · low, ! medium, !! high. Tap an opponent’s name to see what they might be building.'
          : 'Nobody looks close to winning yet, so no tile is especially dangerous. Threat rises when players make exposures and late in the wall; then marks appear on your tiles.'))));
    }
    if (obs.phase === 'end') sections.push(h('p', { class: 'muted' }, 'Hand over.'));
    mount(el, ...sections);
  };

  hooks.decorate = (obs, rack, ui) => {
    const settings = hooks.getSettings?.();
    const tipsOn = settings?.tips ?? { offense: true, defense: true };
    if (obs.phase === 'end') return;
    const { off, def } = compute(obs, settings);
    if (tipsOn.offense && ui.highlightHand) {
      const c = off.closest.find((x) => x.handId === ui.highlightHand);
      if (c) rack.highlight = new Set(c.uses);
      else ui.highlightHand = null;
    }
    // Danger marks only once someone is a real threat (medium or high).
    if (tipsOn.defense && (obs.phase === 'turn' || obs.phase === 'claim') && def.report.active) {
      for (const t of new Set(obs.hand)) {
        const level = def.report.level(t);
        rack.marks.set(t, { level, ...DANGER[level] });
      }
    }
  };

  hooks.opponentBadges = (obs, seat) => {
    const settings = hooks.getSettings?.();
    if (!settings?.tips.defense || obs.phase === 'charleston' || obs.phase === 'end') return [];
    const o = compute(obs, settings).def.report.opponents.find((x) => x.seat === seat);
    return o ? [h('span', { class: `threat threat-${o.threat}` }, THREAT_TEXT[o.threat])] : [];
  };

  hooks.opponentExtra = (obs, seat) => {
    if (obs.phase === 'charleston') return null;
    const o = compute(obs, hooks.getSettings?.()).def.report.opponents.find((x) => x.seat === seat);
    if (!o || obs.dead[seat]) return null;
    const exposed = obs.exposures[seat].length > 0;
    return h('section', {},
      h('h3', {}, `Consistent with ${o.hands.length} hand${o.hands.length === 1 ? '' : 's'} on your card`),
      h('p', { class: 'muted small' }, richText(exposed
        ? 'Only hands their exposures fit, so no concealed hands. Hands they seem to be avoiding (tiles they passed you or threw) rank lower. Reading exposures like this is how you avoid feeding a winning tile.'
        : 'No exposures yet, so almost anything is possible. Hands they seem to be avoiding (tiles they passed you or threw) rank lower.')),
      h('ol', { class: 'cands' }, ...o.hands.slice(0, 12).map((c) => h('li', {},
        h('span', { class: 'bar', style: `--w:${Math.max(0.05, c.weight / o.hands[0].weight)}` }),
        h('span', { class: 'cat' }, c.hand.category), ' ', cardLine(c.hand.line)))),
      o.hands.length > 12 ? h('p', { class: 'muted small' }, `…and ${o.hands.length - 12} more.`) : null);
  };

  hooks.onHumanAction = (obs, action) => {
    const settings = hooks.getSettings?.();
    const s = suggestion(obs, { defense: settings?.tips.defense ?? true });
    const fold = obs.decision?.kind === 'turn' ? defenseTips(obs).fold : null;
    if (action.type === 'exchange' || action.type === 'declareDead') return; // extras, not the decision itself
    review.entries.push({ kind: obs.decision?.kind, chosen: action, suggested: s?.action ?? null, line: s?.line ?? '', fold: fold ? fold.tile : null });
  };

  hooks.onNewHand = () => {
    review.entries = [];
  };

  /** For the ledger: how often the fold suggestion came up this hand, and was followed. */
  hooks.handReport = () => {
    const folds = review.entries.filter((e) => e.fold !== null);
    return { fold: { suggested: folds.length, followed: folds.filter((e) => e.chosen.type === 'discard' && e.chosen.tile === e.fold).length } };
  };

  /** Post-hand learning review: how the hand was won, your closest hand, and choices vs. tips. */
  hooks.endExtra = (record, session) => {
    const state = session.state;
    const r = record.result;
    const human = record.human;
    const parts = [];

    if (r.winner !== null) {
      const p = state.players[r.winner];
      const match = matchHand(state.card, p).find((m) => m.target.handId === r.handId);
      if (match) {
        parts.push(h('section', { class: 'review' },
          h('h3', {}, r.winner === human ? 'Your winning hand' : 'How the hand was won'),
          h('p', {}, cardLine(match.target.hand.line), ' ', legendEl(colorLegend(match.target))),
          handViewEl(handView(match.target, p.concealed, p.exposures)),
          h('p', { class: 'muted small' }, 'Each group lines up with the card: same color, same suit. Jokers appear only in groups of 3 or more.')));
      }
    }

    if (r.winner !== human) {
      const me = state.players[human];
      const evals = evaluateHand(me, state.card);
      const best = evals.find((e) => !e.dead) ?? evals[0];
      if (best) {
        parts.push(h('section', { class: 'review' },
          h('h3', {}, 'Your closest hand at the end'),
          h('p', {}, h('strong', {}, best.target.hand.category), ' ', cardLine(best.target.hand.line), ` — ${best.distance} away. `, legendEl(colorLegend(best.target))),
          handViewEl(handView(best.target, me.concealed, me.exposures))));
      }
    }

    const decided = review.entries.filter((e) => e.suggested);
    if (decided.length) {
      const differed = decided.filter((e) => !sameAction(e.chosen, e.suggested));
      const byKind = (k) => decided.filter((e) => e.kind === k);
      const score = (k, label) => {
        const all = byKind(k);
        if (!all.length) return null;
        const ok = all.filter((e) => sameAction(e.chosen, e.suggested)).length;
        return h('li', {}, `${label}: ${ok} of ${all.length} matched the tips`);
      };
      parts.push(h('section', { class: 'review' },
        h('h3', {}, 'Your choices vs. the tips'),
        h('ul', { class: 'review-score' },
          score('pass', 'Charleston passes'), score('vote', 'Second-Charleston vote'),
          score('courtesyRequest', 'Courtesy pass'), score('claim', 'Calls'), score('turn', 'Discards')),
        differed.length ? h('details', { class: 'review-diff' },
          h('summary', {}, `See the ${differed.length} that differed`),
          h('ul', {}, ...differed.map((e) => h('li', {},
            h('span', {}, `You chose to ${describe(e.chosen)}; the tip said ${describe(e.suggested)}.`),
            e.line ? h('span', { class: 'muted small' }, ` (${e.line})`) : null)))) : h('p', {}, 'Every choice matched the tips. Nice!'),
        h('p', { class: 'muted small' }, 'Tips aren’t always right; they’re a second opinion. Try the same tiles again with Replay this deal.')));
    }
    return parts.length ? h('div', {}, ...parts) : null;
  };

  hooks.settingsSections = (settings, onChange) => [h('section', {},
    h('h3', {}, 'Learning'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings.explain, onchange: (e) => { settings.explain = e.target.checked; onChange(); } }),
      'Explain each step (“How this works”)'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings.tips.offense, onchange: (e) => { settings.tips.offense = e.target.checked; settings.tipsChosen = true; onChange(); } }),
      'Offense tips: closest hands, what to pass, discard, and call'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings.tips.defense, onchange: (e) => { settings.tips.defense = e.target.checked; settings.tipsChosen = true; onChange(); } }),
      'Defense tips: opponent threat, tile danger, when to fold'))];
}
