// Modal dialogs: end of hand, settings, card viewer, opponent details.

import { h, mount, button } from './dom.js';
import { tileRow } from './tileArt.js';
import { exposureEl } from './table.js';
import { nameOf, windOf, formatPoints, cardLine, WINDS } from './format.js';
import { SPEEDS } from './session.js';
import { LEVELS } from '../engine/ai/index.js';
import { RULE_OPTIONS, DEFAULT_RULES } from '../engine/rules-config.js';
import { tileName } from './format.js';

let current = null;

/** Open a modal dialog with a title and body; returns a close function. */
export function openModal(title, body, { wide = false, onClose } = {}) {
  closeModal();
  const dialog = h('dialog', { class: `modal${wide ? ' modal-wide' : ''}`, 'aria-label': title },
    h('header', { class: 'modal-head' },
      h('h2', {}, title),
      button('Close', () => closeModal(), { variant: 'ghost' })),
    h('div', { class: 'modal-body' }, body));
  dialog.addEventListener('close', () => {
    dialog.remove();
    if (current === dialog) current = null;
    onClose?.();
  });
  document.body.append(dialog);
  current = dialog;
  dialog.showModal();
  return closeModal;
}

export function closeModal() {
  if (current?.open) current.close();
}

function handById(card, id) {
  return card.hands.find((x) => x.id === id);
}

function handSummary(hand) {
  if (!hand) return h('span', {}, '—');
  return h('span', { class: 'hand-summary' },
    h('span', { class: 'cat' }, hand.category), ' ', cardLine(hand.line), ' ',
    h('span', { class: 'val' }, `${hand.value}${hand.concealed ? ' C' : ' X'}`));
}

/**
 * End-of-hand review: result, payments, every hand revealed, what each opponent was building.
 * @param {Object} record  From Session.finish.
 * @param {Object} state   Full game state (safe to reveal: the hand is over).
 * @param {Object} session
 * @param {{onNext: () => void, onReplay: () => void, extra?: HTMLElement}} actions
 */
export function showEndOfHand(record, state, session, { onNext, onReplay, extra }) {
  const r = record.result;
  const human = record.human;
  const mode = session.settings.points;
  let title;
  let summary;
  if (r.winner === null) {
    title = 'Wall game';
    summary = h('p', {}, 'The wall ran out with no winner. Nobody pays.');
  } else {
    const hand = handById(state.card, r.handId);
    title = r.winner === human ? 'You win!' : `${nameOf(r.winner, human)} wins`;
    const how = r.selfDrawn ? 'self-drawn' : `on ${nameOf(r.discarder, human) === 'You' ? 'your' : `${nameOf(r.discarder, human)}’s`} discard`;
    summary = h('div', {},
      h('p', {}, handSummary(hand)),
      h('p', { class: 'muted' }, `Won ${how}${r.jokerless ? ' · jokerless' : ''}. Hand value ${r.value}.`));
  }

  const rows = [0, 1, 2, 3].map((seat) => h('tr', { class: seat === human ? 'is-me' : '' },
    h('th', { scope: 'row' }, `${nameOf(seat, human)} (${windOf(seat, record.dealer)})`),
    h('td', {}, formatPoints(r.payments[seat], mode)),
    h('td', {}, formatPoints(session.totals[seat], mode))));
  const payments = h('table', { class: 'payments' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', {}, 'This hand'), h('th', {}, 'Session'))),
    h('tbody', {}, ...rows));

  const reveal = h('div', { class: 'reveal' }, ...[0, 1, 2, 3].map((seat) => {
    const p = state.players[seat];
    const building = record.building[seat];
    const target = building && handById(state.card, building.handId);
    return h('div', { class: 'reveal-row' },
      h('div', { class: 'reveal-name' }, `${nameOf(seat, human)}${p.dead ? ' (dead)' : ''}`),
      h('div', { class: 'reveal-tiles' },
        ...p.exposures.map((e) => exposureEl(e, 'sm')),
        tileRow(p.concealed.slice().sort((a, b) => a - b), { size: 'sm' })),
      seat !== human && seat !== r.winner && target ? h('div', { class: 'muted' }, 'Was building: ', handSummary(target)) : null);
  }));

  openModal(title, [
    summary,
    payments,
    extra ?? null,
    h('h3', {}, 'All hands'),
    reveal,
    h('div', { class: 'modal-actions' },
      button('Replay this deal', () => { closeModal(); onReplay(); }),
      button('Next hand', () => { closeModal(); onNext(); }, { variant: 'primary' })),
  ], { wide: true });
}

/** The active card, grouped by category. */
export function showCard(card) {
  const groups = new Map();
  for (const hand of card.hands) {
    if (!groups.has(hand.category)) groups.set(hand.category, []);
    groups.get(hand.category).push(hand);
  }
  const body = h('div', { class: 'card-view' },
    h('p', { class: 'muted' }, 'Colors are suits: same color, same suit; different colors, different suits. D is the dragon of that color’s suit; 0 is Soap (white dragon). X = exposed, C = concealed.'),
    ...[...groups].map(([cat, hands]) => h('section', {},
      h('h3', {}, cat),
      h('ul', {}, ...hands.map((hand) => h('li', {},
        cardLine(hand.line),
        h('span', { class: 'val' }, ` ${hand.value} ${hand.concealed ? 'C' : 'X'}`),
        hand.notes ? h('span', { class: 'muted' }, ` — ${hand.notes}`) : null))))));
  openModal(card.name, body, { wide: true });
}

const RULE_TEXT = {
  dealerRotation: ['Dealer rotation', { always: 'Passes right every hand', winnerKeeps: 'Winning dealer deals again' }],
  courtesyPass: ['Courtesy pass', { min: 'On (smaller request wins)', off: 'Off' }],
  mahJonggBeatsExposure: ['Mah Jongg call beats an exposure call', null],
  concealedCanCallForMahJongg: ['Concealed hands may take a discard to win', null],
  falseMahJongg: ['False Mah Jongg (training wheels off)', { deadHand: 'Hand is dead', retract: 'Take it back, no penalty' }],
  jokerlessDouble: ['Jokerless doubles the value', null],
  selfDrawDouble: ['Self-drawn win: everyone pays double', null],
  discarderPaysDouble: ['Discarder pays double', null],
  discarderPaysAllForObviousHand: ['Discarder pays for all when throwing to an obvious hand (3+ exposures)', null],
  wallGamePayment: ['Wall-game payment (not defined yet; no effect)', null],
};
const VERIFY = new Set(['dealerRotation', 'courtesyPass', 'mahJonggBeatsExposure', 'concealedCanCallForMahJongg', 'falseMahJongg', 'discarderPaysAllForObviousHand']);

/**
 * Settings. Changes apply from the next hand, except speed, tips, and point display.
 * @param {Object} settings  Mutated in place.
 * @param {{onChange: () => void, extraSections?: HTMLElement[]}} options
 */
export function showSettings(settings, { onChange, extraSections = [] }) {
  const select = (value, options, onPick, label) => {
    const el = h('select', { 'aria-label': label, onchange: (e) => { onPick(e.target.value); onChange(); } },
      ...options.map(([v, text]) => h('option', { value: v, selected: String(v) === String(value) }, text)));
    return el;
  };
  const checkbox = (checked, onPick, label) => h('label', { class: 'check' },
    h('input', { type: 'checkbox', checked, onchange: (e) => { onPick(e.target.checked); onChange(); } }), label);

  const human = settings.humanSeat;
  const opponents = [1, 2, 3].map((k) => (human + k) % 4);
  const rules = { ...DEFAULT_RULES, ...settings.rules };

  const body = h('div', { class: 'settings' },
    h('section', {},
      h('h3', {}, 'Opponents'),
      ...opponents.map((seat) => h('div', { class: 'field' },
        h('span', {}, nameOf(seat, human)),
        select(settings.levels[seat], LEVELS.map((l) => [l, l[0].toUpperCase() + l.slice(1)]), (v) => { settings.levels[seat] = v; }, `${nameOf(seat, human)} difficulty`))),
      h('div', { class: 'field' },
        h('span', {}, 'Speed'),
        select(settings.speed, Object.keys(SPEEDS).map((k) => [k, `${k[0].toUpperCase()}${k.slice(1)}${SPEEDS[k] ? ` (${SPEEDS[k]} ms)` : ''}`]), (v) => { settings.speed = v; }, 'AI speed'))),
    h('section', {},
      h('h3', {}, 'Play'),
      checkbox(settings.trainingWheels, (v) => { settings.trainingWheels = v; }, 'Training wheels: Mah Jongg button only when your hand is valid'),
      h('div', { class: 'field' },
        h('span', {}, 'Your seat'),
        select(settings.humanSeat, WINDS.map((w, i) => [i, `${w} on the first hand`]), (v) => { settings.humanSeat = Number(v); }, 'Your seat')),
      h('div', { class: 'field' },
        h('span', {}, 'Show scores as'),
        select(settings.points, [['points', 'Points'], ['dollars', 'Dollars (1 pt = $0.01)'], ['both', 'Both']], (v) => { settings.points = v; }, 'Point display'))),
    ...extraSections,
    h('section', {},
      h('h3', {}, 'Rules'),
      h('p', { class: 'muted' }, 'Rules marked ✱ vary between tables or need checking against your rules booklet. Rule changes apply from the next hand.'),
      ...Object.entries(RULE_OPTIONS).map(([key, opts]) => {
        const [text, names] = RULE_TEXT[key];
        const label = `${text}${VERIFY.has(key) ? ' ✱' : ''}`;
        const set = (v) => { settings.rules = { ...settings.rules, [key]: v }; };
        if (typeof opts[0] === 'boolean') return checkbox(rules[key], set, label);
        return h('div', { class: 'field' }, h('span', {}, label),
          select(rules[key], opts.map((o) => [o, names[o]]), set, text));
      })),
    h('p', { class: 'muted' }, 'Settings are saved in this browser.'));
  openModal('Settings', body, { wide: true });
}

/**
 * Opponent details: what you can see of them (SPEC §10.2). Stage 7 adds candidate hands.
 */
export function showOpponent(obs, seat, extra = null) {
  const human = obs.seat;
  const passed = obs.passesReceived.filter((p) => p.from === seat).flatMap((p) => p.tiles);
  const discards = obs.discardHistory.filter((d) => d.seat === seat).map((d) => d.tile);
  const body = h('div', { class: 'opponent' },
    h('p', {}, `${obs.concealedCounts[seat]} concealed tiles${obs.dead[seat] ? ' · hand is dead' : ''}.`),
    h('h3', {}, 'Exposures'),
    obs.exposures[seat].length ? h('div', { class: 'exposures' }, ...obs.exposures[seat].map((e) => exposureEl(e, 'sm'))) : h('p', { class: 'muted' }, 'None yet.'),
    h('h3', {}, 'Tiles they passed you'),
    passed.length ? tileRow(passed, { size: 'sm' }) : h('p', { class: 'muted' }, 'None.'),
    h('h3', {}, 'Their discards'),
    discards.length ? tileRow(discards, { size: 'sm' }) : h('p', { class: 'muted' }, 'None yet.'),
    extra);
  openModal(`${nameOf(seat, human)} (${windOf(seat, obs.dealer)})`, body);
}

export { tileName };
