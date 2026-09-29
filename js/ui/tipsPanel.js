// Tips side panel, rack decorations, opponent threat badges, and the post-hand discard review.
// Everything here comes from the human's observation via tips.js and defense.js.

import { h, mount, button } from './dom.js';
import { tileEl, tileRow } from './tileArt.js';
import { nameOf, cardLine, tileName } from './format.js';
import { offenseTips, defenseTips, recommendedDiscard } from '../engine/tips.js';

const DANGER = {
  safe: { symbol: '✓', label: 'Safe to discard' },
  low: { symbol: '·', label: 'Low danger' },
  medium: { symbol: '!', label: 'Medium danger' },
  high: { symbol: '!!', label: 'High danger' },
};
const THREAT_TEXT = { none: 'No threat', low: 'Low threat', medium: 'Medium threat', high: 'High threat' };

/** Cache per observation-render so the panel, rack, and badges share one computation. */
let cache = { key: null, off: null, def: null };
function compute(obs) {
  const key = `${obs.seat}|${obs.log.length}|${obs.hand.join(',')}|${obs.decision?.kind}|${obs.phase}`;
  if (cache.key !== key) {
    const nameOfSeat = (s) => nameOf(s, obs.seat);
    cache = {
      key,
      off: offenseTips(obs, { nameOf: nameOfSeat }),
      def: defenseTips(obs, { nameOf: nameOfSeat }),
    };
  }
  return cache;
}

function tipItem(tip, extra = null) {
  return h('details', { class: `tip tip-${tip.kind}` },
    h('summary', {}, tip.tile !== undefined ? tileEl(tip.tile, { size: 'xs' }) : null, h('span', {}, tip.line)),
    h('p', {}, tip.detail),
    extra);
}

/**
 * Register with the game page.
 * @param {typeof import('./main.js').hooks} hooks
 */
export function installTips(hooks) {
  const review = { state: null, entries: [] };

  hooks.renderSide = (el, obs, session, ui, rerender, act) => {
    const tipsOn = session.settings.tips;
    if (!tipsOn.offense && !tipsOn.defense) {
      mount(el, h('h2', { class: 'side-title' }, 'Tips'),
        h('p', { class: 'muted' }, 'Tips are off. Turn them on in Settings.'));
      return;
    }
    const { off, def } = compute(obs);
    const sections = [h('h2', { class: 'side-title' }, 'Tips')];

    // When folding is advised, the fold tip replaces the offense discard tip (§10.6).
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
        h('p', { class: 'muted small' }, 'Tap one to highlight the tiles it uses.'),
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
            h('span', { class: 'closest-val' }, `${c.value}${c.concealed ? ' C' : ''}`)),
          cardLine(c.hand.line),
          c.needed.length ? h('span', { class: 'closest-need' }, 'Needs ', tileRow(c.needed.slice(0, 8), { size: 'xs' }), c.needed.length > 8 ? ' …' : '') : null);
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
        h('p', { class: 'muted small' }, 'Marks on your tiles: ✓ safe, · low, ! medium, !! high danger of feeding someone’s hand. Tap an opponent’s name to see what they might be building.')));
    }
    if (obs.phase === 'end') sections.push(h('p', { class: 'muted' }, 'Hand over.'));
    mount(el, ...sections);
  };

  hooks.decorate = (obs, rack, ui) => {
    const settings = hooks.getSettings?.();
    const tipsOn = settings?.tips ?? { offense: true, defense: true };
    if (obs.phase === 'end') return;
    const { off, def } = compute(obs);
    if (tipsOn.offense && ui.highlightHand) {
      const c = off.closest.find((x) => x.handId === ui.highlightHand);
      if (c) rack.highlight = new Set(c.uses);
      else ui.highlightHand = null;
    }
    if (tipsOn.defense && (obs.phase === 'turn' || obs.phase === 'claim')) {
      for (const t of new Set(obs.hand)) {
        const level = def.report.level(t);
        rack.marks.set(t, { level, ...DANGER[level] });
      }
    }
  };

  hooks.opponentBadges = (obs, seat) => {
    const settings = hooks.getSettings?.();
    if (!settings?.tips.defense || obs.phase === 'charleston' || obs.phase === 'end') return [];
    const o = compute(obs).def.report.opponents.find((x) => x.seat === seat);
    return o ? [h('span', { class: `threat threat-${o.threat}` }, THREAT_TEXT[o.threat])] : [];
  };

  hooks.opponentExtra = (obs, seat) => {
    if (obs.phase === 'charleston') return null;
    const o = compute(obs).def.report.opponents.find((x) => x.seat === seat);
    if (!o || obs.dead[seat]) return null;
    const exposed = obs.exposures[seat].length > 0;
    return h('section', {},
      h('h3', {}, `Consistent with ${o.hands.length} hand${o.hands.length === 1 ? '' : 's'} on your card`),
      h('p', { class: 'muted small' }, exposed
        ? 'Only hands their exposures fit, so no concealed hands. Hands they seem to be avoiding (tiles they passed you or threw) rank lower.'
        : 'No exposures yet, so almost anything is possible. Hands they seem to be avoiding rank lower.'),
      h('ol', { class: 'cands' }, ...o.hands.slice(0, 12).map((c) => h('li', {},
        h('span', { class: 'bar', style: `--w:${Math.max(0.05, c.weight / o.hands[0].weight)}` }),
        h('span', { class: 'cat' }, c.hand.category), ' ', cardLine(c.hand.line)))),
      o.hands.length > 12 ? h('p', { class: 'muted small' }, `…and ${o.hands.length - 12} more.`) : null);
  };

  hooks.onHumanAction = (obs, action) => {
    if (action.type !== 'discard') return;
    const rec = recommendedDiscard(obs);
    const fold = defenseTips(obs).fold;
    review.entries.push({ turn: obs.turnNumber, chosen: action.tile, recommended: rec, fold: fold ? fold.tile : null });
  };

  hooks.onNewHand = () => {
    review.entries = [];
  };

  /** For the ledger: how often the fold suggestion came up this hand, and was followed. */
  hooks.handReport = () => {
    const folds = review.entries.filter((e) => e.fold !== null);
    return { fold: { suggested: folds.length, followed: folds.filter((e) => e.chosen === e.fold).length } };
  };

  hooks.endExtra = () => {
    const differed = review.entries.filter((e) => e.recommended !== null && e.recommended !== e.chosen);
    if (!review.entries.length) return null;
    return h('section', { class: 'review' },
      h('h3', {}, 'Your discards vs. the tips'),
      differed.length
        ? h('ul', {}, ...differed.map((e) => h('li', {},
          `Your discard ${review.entries.indexOf(e) + 1}: you threw `, tileEl(e.chosen, { size: 'xs' }), ` ${tileName(e.chosen)}; the tip suggested `,
          tileEl(e.recommended, { size: 'xs' }), ` ${tileName(e.recommended)}.`)))
        : h('p', {}, `All ${review.entries.length} of your discards matched the tips.`),
      differed.length ? h('p', { class: 'muted small' }, `${review.entries.length - differed.length} of ${review.entries.length} matched. Tips aren’t always right; they’re a second opinion.`) : null);
  };

  hooks.settingsSections = (settings, onChange) => [h('section', {},
    h('h3', {}, 'Tips'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings.tips.offense, onchange: (e) => { settings.tips.offense = e.target.checked; settings.tipsChosen = true; onChange(); } }),
      'Offense tips: closest hands, what to pass, discard, and call'),
    h('label', { class: 'check' },
      h('input', { type: 'checkbox', checked: settings.tips.defense, onchange: (e) => { settings.tips.defense = e.target.checked; settings.tipsChosen = true; onChange(); } }),
      'Defense tips: opponent threat, tile danger, when to fold'))];
}
